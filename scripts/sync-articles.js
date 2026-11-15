import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { articleLanguage } from '../feed-language.js';
import { openVideoStore } from '../video-store.js';

const runFile = promisify(execFile);
const reader = fileURLToPath(new URL('./fetch-article-feeds.py', import.meta.url));
const canonicalParams = new Set(['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'utm_id', 'at_medium', 'at_campaign', 'CMP', 'ocid', 'fbclid', 'gclid']);

function normalizeArticle(entry) {
  if (!entry || typeof entry.url !== 'string' || typeof entry.publishedAt !== 'string') return null;
  const url = URL.parse(entry.url);
  const date = Date.parse(entry.publishedAt);
  const clean = (value, max) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
  const title = clean(entry.title, 350);
  const publisher = clean(entry.publisher, 100);
  if (!url || url.protocol !== 'https:' || url.username || url.password || !title || !publisher
    || !Number.isFinite(date) || date > Date.now() + 3600_000) return null;

  url.hash = '';
  for (const name of [...url.searchParams.keys()]) {
    if (canonicalParams.has(name)) url.searchParams.delete(name);
  }
  url.searchParams.sort();
  const id = 'article-' + createHash('sha256').update(url.href).digest('hex').slice(0, 24);
  return {
    id, url: url.href, title, publisher,
    author: clean(entry.author, 150),
    topic: clean(entry.topic, 40) || 'World',
    summary: clean(entry.summary, 350),
    publishedAt: new Date(date).toISOString(),
    language: entry.language,
  };
}

export async function syncArticles(store, file) {
  const { stdout: raw, stderr } = file ? { stdout: await readFile(file, 'utf8') }
    : await runFile(process.env.KHABAR_RSS_PYTHON || 'python', [reader], {
      timeout: 30_000, maxBuffer: 4 * 1024 * 1024,
    });
  if (stderr?.trim()) console.warn(stderr.trim());
  const entries = JSON.parse(raw.replace(/^\uFEFF/, ''));
  if (!Array.isArray(entries)) throw new Error('Expected an array of article records.');
  const articles = new Map();
  for (const entry of entries) {
    const article = normalizeArticle(entry);
    if (!article) {
      if (file) throw new Error('The import file contains invalid article metadata.');
      continue;
    }
    if (entry.excerpt !== undefined && typeof entry.excerpt !== 'string') {
      throw new Error('Article excerpts must be strings.');
    }
    const text = file && entry.textFile !== undefined
      ? await readArticleText(entry, file) : entry.excerpt?.trim().slice(0, 1000);
    article.language = articleLanguage(article, text);
    if (!article.language) continue;
    if (text) {
      const scope = file && entry.textFile !== undefined ? entry.textScope ?? 'full' : 'excerpt';
      article.sourceText = { text, source: file ? 'supplied' : 'rss', scope,
        ...(scope === 'full' && articleLicense(entry)) };
    }
    if (!article.sourceText && articles.has(article.url)) article.sourceText = articles.get(article.url).sourceText;
    articles.set(article.url, article);
  }
  if (!articles.size) throw new Error('No usable English or Hindi articles were found.');
  store.syncArticles(articles.values());
  return articles.size;
}

function articleLicense({ attribution, licenseName, licenseUrl }) {
  if (attribution === undefined && licenseName === undefined && licenseUrl === undefined) return {};
  const url = typeof licenseUrl === 'string' && URL.parse(licenseUrl);
  if (typeof attribution !== 'string' || !attribution.trim() || attribution.length > 500
    || typeof licenseName !== 'string' || !licenseName.trim() || licenseName.length > 200
    || !url || url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Publishable full text requires attribution, licenseName, and a valid HTTPS licenseUrl.');
  }
  return { attribution: attribution.trim(), licenseName: licenseName.trim(), licenseUrl: url.href };
}

async function readArticleText(entry, manifest) {
  if (typeof entry.textFile !== 'string' || !entry.textFile.trim()
    || !['full', 'excerpt'].includes(entry.textScope ?? 'full')) {
    throw new Error('Article text needs a textFile path and an optional textScope of full or excerpt.');
  }
  const text = (await readFile(resolve(dirname(manifest), entry.textFile), 'utf8')).trim();
  if (!text || text.length > 1_000_000) throw new Error('Article text files must contain 1 to 1,000,000 characters.');
  return text;
}

async function main() {
  const { values } = parseArgs({ options: { file: { type: 'string' }, help: { type: 'boolean' } } });
  if (values.help) {
    console.log('Usage: node scripts/sync-articles.js [--file FILE]\nWith no file, fetches publisher RSS feeds using Python.');
    return;
  }
  const store = openVideoStore();
  try {
    const count = await syncArticles(store, values.file);
    console.log(`Synced ${count} distinct article links. Read now serves ${store.articles().length} links.`);
  } finally {
    store.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(`Article sync: ${error.message}`);
    process.exitCode = 1;
  }
}
