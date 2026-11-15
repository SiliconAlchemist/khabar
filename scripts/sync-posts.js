import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { explainers } from '../public/explainers.js';
import { stories } from '../public/stories.js';
import { videos, youtubeIdFromUrl } from '../public/videos.js';
import { openVideoStore } from '../video-store.js';
import { syncArticles } from './sync-articles.js';
import { syncYouTube } from './sync-youtube.js';
import { prepareTranscript } from './transcript-input.js';
import { analyzeVideos } from './analyze-videos.js';
import { publicWatchVideos } from '../feed-catalog.js';
import { languageTag } from '../feed-language.js';

const seedVideos = new Map(videos.map(video => [video.id, video]));
const storyIds = new Set([...stories, ...explainers].map(story => story.id));
const usage = [
  'node scripts/sync-posts.js refresh [--articles FILE] [--videos FILE] [--channel @HANDLE] [--limit 5] [--interval-minutes 60] [--analyze-videos]',
  'node scripts/sync-posts.js import [--articles FILE] [--videos FILE]',
  'node scripts/sync-posts.js status [--limit 10]',
  '',
  'Refresh uses publisher RSS and YOUTUBE_API_KEY. Pass --skip-rss or --skip-youtube to run one source.',
  'All commands use the same SQLite database as the app.',
].join('\n');

function videoId(entry) {
  const url = typeof entry.url === 'string' ? URL.parse(entry.url) : null;
  let fromUrl;
  if (url?.protocol === 'https:' && !url.username && !url.password) {
    const embedHost = ['youtube.com', 'www.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'];
    const embedId = embedHost.includes(url.hostname) && /^\/embed\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname);
    fromUrl = embedId?.[1] ?? youtubeIdFromUrl(url.href);
  }
  const id = entry.id ?? fromUrl;
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(id) || (entry.url !== undefined && fromUrl !== id)) {
    throw new Error('Use a YouTube video ID or an HTTPS YouTube watch, Shorts, share, or embed URL.');
  }
  return id;
}

async function importVideo(store, entry, directory) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Expected a video record.');
  const id = videoId(entry);
  const seed = seedVideos.get(id);
  const { format, storyId, title, publisher, durationSeconds, sourcePublishedAt = null } = entry;
  const language = languageTag(entry.language);
  if (language === null) throw new Error('Only English and Hindi videos are supported.');
  if (format !== undefined && !['shorts', 'full'].includes(format)) throw new Error('format must be shorts or full.');
  if (storyId !== undefined && (!format || !storyIds.has(storyId))) throw new Error('storyId requires a format and an existing Khabar story ID.');
  if (entry.transcriptFile !== undefined && entry.mediaFile !== undefined) throw new Error('Supply one transcriptFile or one mediaFile.');
  const inputFile = name => {
    if (typeof entry[name] !== 'string' || !entry[name].trim()) throw new Error(name + ' must be a local file path.');
    return resolve(directory, entry[name]);
  };
  const transcriptFile = entry.transcriptFile === undefined ? undefined : inputFile('transcriptFile');
  const mediaFile = entry.mediaFile === undefined ? undefined : inputFile('mediaFile');
  let metadata;
  if (!store.knownVideo(id) && (!seed || format)) {
    const curatedTitle = title ?? seed?.title;
    const curatedPublisher = publisher ?? seed?.publisher;
    const duration = durationSeconds ?? seed?.durationSeconds ?? 0;
    if (typeof curatedTitle !== 'string' || !curatedTitle.trim() || typeof curatedPublisher !== 'string'
      || !curatedPublisher.trim() || !Number.isSafeInteger(duration) || duration < 0
      || (sourcePublishedAt !== null && (typeof sourcePublishedAt !== 'string' || !Number.isFinite(Date.parse(sourcePublishedAt))))) {
      throw new Error('New videos need a title and publisher. Supply a valid durationSeconds and sourcePublishedAt if known.');
    }
    metadata = {
      title: curatedTitle.trim(), publisher: curatedPublisher.trim(), durationSeconds: duration,
      sourcePublishedAt: sourcePublishedAt === null ? null : new Date(sourcePublishedAt).toISOString(), language,
    };
  }
  const transcript = await prepareTranscript(transcriptFile, mediaFile, store.transcriptInput(id));
  if (!store.importVideo(id, { metadata, format, storyId, transcript, seed: Boolean(seed) })) {
    throw new Error('Video changed during import. Retry the batch.');
  }
  if (transcript) console.log(id + ': saved ' + transcript.source + ' transcript.');
}

async function importVideos(store, file) {
  const entries = JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
  if (!Array.isArray(entries) || !entries.length) throw new Error('Expected a nonempty array of video records.');
  let imported = 0;
  for (const [index, entry] of entries.entries()) {
    try {
      await importVideo(store, entry, dirname(file));
      imported += 1;
    } catch (error) {
      console.error('Video row ' + (index + 1) + ': ' + error.message);
    }
  }
  console.log('Processed ' + imported + ' of ' + entries.length + ' video records.');
  return imported === entries.length;
}

function showStatus(store, limit) {
  const { total, full, excerpt, missing } = store.articleTextCounts();
  console.log('Read: ' + total + ' imported articles, ' + full + ' with full text, ' + excerpt + ' with excerpts, ' + missing + ' missing text.');
  for (const article of store.articlesMissingText(limit)) console.log('  ' + article.url + '  ' + article.title);

  const catalog = new Map(store.videoCoverage().map(video => [video.id, video]));
  for (const [id, seed] of seedVideos) {
    const current = catalog.get(id);
    catalog.set(id, { ...current, id, title: current?.title ?? seed.title, published: true,
      hasTranscript: current?.hasTranscript ?? Boolean(store.transcript(id)?.trim()) });
  }
  console.log('Public Watch: ' + publicWatchVideos(store).length + ' English/Hindi videos with transcripts.');
  for (const [published, label] of [[true, 'Watch catalog'], [false, 'Review queue']]) {
    const group = [...catalog.values()].filter(video => Boolean(video.published) === published);
    const missingTranscripts = group.filter(video => !video.hasTranscript);
    console.log(label + ': ' + group.length + ' videos, ' + (group.length - missingTranscripts.length)
      + ' with transcripts, ' + missingTranscripts.length + ' missing transcripts.');
    for (const video of missingTranscripts.slice(0, limit)) console.log('  ' + video.id + '  ' + video.title);
  }
}

async function runStep(label, action) {
  try {
    return await action();
  } catch (error) {
    console.error(label + ': ' + error.message);
    return false;
  }
}

async function loadArticles(store, file) {
  const count = await syncArticles(store, file);
  console.log('Synced ' + count + ' distinct article links.');
  return true;
}

async function importFiles(store, options) {
  const articlesOk = !options.articles || await runStep('Article import', () => loadArticles(store, options.articles));
  const videosOk = !options.videos || await runStep('Video import', () => importVideos(store, options.videos));
  return articlesOk && videosOk;
}

async function refresh(store, options, limit, interval) {
  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  if (!apiKey && !options['skip-youtube']) console.warn('YouTube refresh skipped. Set YOUTUBE_API_KEY to enable it.');
  do {
    const imported = await importFiles(store, options);
    let ok = options['skip-rss'] || await runStep('RSS', () => loadArticles(store));
    if (apiKey && !options['skip-youtube']) {
      const synced = await runStep('YouTube', () => syncYouTube(store, {
        apiKey, limit, includeFull: true, channel: options.channel,
      }));
      ok = ok && synced;
    }
    if (options['analyze-videos']) {
      const analysed = await runStep('Video analysis', async () => {
        const { processed, failures } = await analyzeVideos(store);
        console.log('Video analysis: ' + processed + ' processed, ' + failures + ' will need a retry.');
        return failures === 0;
      });
      ok = ok && analysed;
    }
    showStatus(store, 0);
    if (!interval) return imported && ok && Boolean(apiKey || options['skip-youtube']);
    await setTimeout(interval);
  } while (true);
}

async function main() {
  const { values, positionals: [command, ...extra] } = parseArgs({ allowPositionals: true, options: {
    articles: { type: 'string' }, videos: { type: 'string' }, channel: { type: 'string', multiple: true },
    limit: { type: 'string' }, 'interval-minutes': { type: 'string' }, 'skip-rss': { type: 'boolean' },
    'skip-youtube': { type: 'boolean' }, 'analyze-videos': { type: 'boolean' }, help: { type: 'boolean' },
  } });
  if (values.help || !command) {
    console.log(usage);
    return;
  }
  const allowed = {
    refresh: ['articles', 'videos', 'channel', 'limit', 'interval-minutes', 'skip-rss', 'skip-youtube', 'analyze-videos'],
    import: ['articles', 'videos'],
    status: ['limit'],
  };
  if (extra.length || !Object.hasOwn(allowed, command) || Object.keys(values).some(key => !allowed[command].includes(key))) {
    throw new Error(usage);
  }
  const limit = Number(values.limit ?? (command === 'refresh' ? 5 : 10));
  const interval = Number(values['interval-minutes'] ?? 0) * 60_000;
  if (!Number.isSafeInteger(limit) || limit < (command === 'refresh' ? 1 : 0) || limit > 50) throw new Error('Invalid --limit. Use up to 50.');
  if (!Number.isSafeInteger(interval) || interval < 0 || interval > 2_147_483_647) throw new Error('Invalid --interval-minutes.');
  if (values['skip-rss'] && values['skip-youtube'] && !values.articles && !values.videos && !values['analyze-videos']) {
    throw new Error('Select at least one source to refresh.');
  }
  if (command === 'import' && !values.articles && !values.videos) throw new Error('Pass --articles, --videos, or both.');
  const store = openVideoStore();
  try {
    if (command === 'refresh' && !await refresh(store, values, limit, interval)) process.exitCode = 1;
    if (command === 'status') showStatus(store, limit);
    if (command === 'import') {
      if (!await importFiles(store, values)) process.exitCode = 1;
      showStatus(store, 0);
    }
  } finally {
    store.close();
  }
}

try {
  await main();
} catch (error) {
  console.error('Post sync: ' + error.message);
  process.exitCode = 1;
}
