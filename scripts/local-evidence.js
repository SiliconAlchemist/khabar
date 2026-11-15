import { DatabaseSync } from 'node:sqlite';

const commonWords = new Set('a an the was were is are in on at by to from of for as and or with this that these those it its has had have who when why how what which'.split(' '));
const words = new Intl.Segmenter(undefined, { granularity: 'word' });

function publisherName(value) {
  return (value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

export function openEvidenceIndex(articles) {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE VIRTUAL TABLE evidence USING fts5(title, text, url UNINDEXED, publisher UNINDEXED, date UNINDEXED, tokenize='porter unicode61')");
  const add = db.prepare('INSERT INTO evidence VALUES (?, ?, ?, ?, ?)');
  for (const article of articles) {
    add.run(article.title, article.text, article.url, article.publisher, article.publishedAt);
  }
  const search = db.prepare(
    "SELECT title, url, publisher, date, snippet(evidence, 1, '', '', ' … ', 64) AS snippet FROM evidence WHERE evidence MATCH ? ORDER BY bm25(evidence, 3, 1) LIMIT 18"
  );
  return {
    find(claim, query, publisher) {
      const tokens = new Set();
      for (const word of words.segment((query + ' ' + claim).toLowerCase())) {
        if (!word.isWordLike || word.segment.length < 2 || commonWords.has(word.segment)) continue;
        tokens.add(word.segment);
        if (tokens.size >= 18) break;
      }
      if (!tokens.size) return [];
      const expression = [...tokens].map(token => '"' + token.replaceAll('"', '""') + '"').join(' OR ');
      const origin = publisherName(publisher);
      const urls = new Set();
      return search.all(expression).filter(row => {
        const url = URL.parse(row.url);
        const outlet = publisherName(row.publisher);
        const host = publisherName(url?.hostname?.replace(/^www\./i, '').split('.')[0]);
        if (!url || url.protocol !== 'https:' || url.username || url.password || !row.snippet
          || (origin && [outlet, host].includes(origin))) return false;
        url.hash = '';
        if (urls.has(url.href)) return false;
        urls.add(url.href);
        row.url = url.href;
        row.snippet = row.snippet.replace(/\s+/gu, ' ').trim().slice(0, 1000);
        return Boolean(row.snippet);
      }).slice(0, 5);
    },
    close: () => db.close(),
  };
}
