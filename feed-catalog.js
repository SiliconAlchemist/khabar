import { articleLanguage, videoLanguage } from './feed-language.js';
import { explainers } from './public/explainers.js';
import { videos } from './public/videos.js';

const transcriptPages = new Map(explainers.filter(item => item.linkLabel === 'Read transcript')
  .map(item => [item.id, item.url]));
const publisherTranscript = 'publisher-transcript:';
const pmoLicense = 'https://www.pmindia.gov.in/en/website-policies/';

function getTranscriptUrl(store, video) {
  const input = store.transcriptInput(video.id)?.source;
  const url = URL.parse(input?.startsWith(publisherTranscript)
    ? input.slice(publisherTranscript.length)
    : transcriptPages.get(video.storyId) ?? '');
  return url?.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
}

function mayDisplayTranscript(url) {
  const source = URL.parse(url ?? '');
  return source?.origin === 'https://www.pmindia.gov.in' && source.pathname.startsWith('/hi/news_updates/');
}

export function publicWatchVideos(store) {
  const candidates = new Map(videos.map(video => [video.id, video]));
  for (const video of store.published()) {
    const seed = candidates.get(video.id);
    candidates.set(video.id, { ...seed, ...video,
      storyId: video.storyId ?? seed?.storyId, durationSeconds: video.durationSeconds || seed?.durationSeconds });
  }
  return [...candidates.values()].flatMap(video => {
    const transcript = store.transcript(video.id);
    if (!transcript?.trim()) return [];
    const language = videoLanguage(video, transcript);
    if (!language) return [];
    const transcriptUrl = getTranscriptUrl(store, video);
    return [{ ...video, language, hasTranscript: true, transcriptUrl, hasReadableTranscript: mayDisplayTranscript(transcriptUrl) }];
  });
}

export function publicVideoTranscript(store, id) {
  const video = publicWatchVideos(store).find(candidate => candidate.id === id);
  if (!video?.hasReadableTranscript) return null;
  const paragraphs = store.transcript(id).split(/\n+/).map(paragraph => paragraph.trim()).filter(Boolean);
  return { id, language: video.language, scope: 'full', paragraphs, sourceUrl: video.transcriptUrl,
    attribution: 'Prime Minister’s Office, Government of India', licenseName: 'PM India website copyright policy', licenseUrl: pmoLicense };
}

function publicArticle(row) {
  if (!row) return null;
  const language = articleLanguage(row, row.text);
  if (!language) return null;
  const { text, scope, attribution, licenseName, licenseUrl, ...metadata } = row;
  const hasFullText = scope === 'full' && Boolean(text && attribution && licenseName && licenseUrl);
  const hasExcerpt = scope === 'excerpt' && Boolean(text);
  return { ...metadata, language, hasFullText, hasExcerpt,
    summary: metadata.summary || (hasExcerpt ? text.slice(0, 320) : '') };
}

export function publicArticles(store) {
  const articles = [];
  for (const row of store.articleCandidates()) {
    const article = publicArticle(row);
    if (article) articles.push(article);
    if (articles.length === 200) break;
  }
  return articles;
}

export function publicArticleDetails(store, id) {
  const row = store.articleCandidate(id);
  const article = publicArticle(row);
  if (!article || (!article.hasFullText && !article.hasExcerpt)) return null;
  const { language, url: sourceUrl, publisher, hasFullText } = article;
  const text = hasFullText ? row.text : row.text.slice(0, 1400);
  const paragraphs = text.split(/\n+/).map(paragraph => paragraph.trim()).filter(Boolean);
  return {
    id, paragraphs, language, scope: hasFullText ? 'full' : 'excerpt', sourceUrl,
    attribution: hasFullText ? row.attribution : publisher,
    ...(hasFullText && { licenseName: row.licenseName, licenseUrl: row.licenseUrl }),
  };
}
