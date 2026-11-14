import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { readFile, stat } from 'node:fs/promises';
import { stories } from '../public/stories.js';
import { videos } from '../public/videos.js';
import { openVideoStore } from '../video-store.js';
import { analysisSource, runPostAnalysis } from '../post-analysis.js';
import { defaultChannels, discoverYouTube, refreshYouTubeVideos } from './discover-youtube.js';

const usage = `Usage:
  node scripts/sync-youtube.js sync [--api-key KEY] [--channel @HANDLE] [--limit 10] [--interval-minutes 60]
  node scripts/sync-youtube.js queue [--channel @HANDLE]
  node scripts/sync-youtube.js publish VIDEO_ID [--format shorts|full] [--story STORY_ID] [--transcript FILE | --media FILE]
  node scripts/sync-youtube.js transcript VIDEO_ID (--transcript FILE | --media FILE)
  node scripts/sync-youtube.js fact-check VIDEO_ID --file FILE
  node scripts/sync-youtube.js unpublish VIDEO_ID

Sync uses YOUTUBE_API_KEY when --api-key is omitted. Repeat --channel to select sources.
With no interval, sync runs once. A positive interval keeps it running in the foreground.
The server and this script use data/khabar.sqlite, or the same KHABAR_DATA_DIR if set.
`;

const runFile = promisify(execFile);
const whisperScript = fileURLToPath(new URL('./transcribe-video.py', import.meta.url));
const whisperCache = fileURLToPath(new URL('../data/local-ai/whisper-models/', import.meta.url));

async function transcribeMedia(file) {
  const media = resolve(file);
  const mediaStat = await stat(media).catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (!mediaStat?.isFile()) throw new Error('Pass a local audio or video file to --media.');
  const python = process.env.KHABAR_WHISPER_PYTHON || 'python';
  console.log('Transcribing with local Whisper. The first run downloads the model.');
  let transcript;
  try {
    const { stdout } = await runFile(python, [whisperScript, '--cache-dir', whisperCache, '--', media], { maxBuffer: 8 * 1024 * 1024 });
    transcript = stdout.trim();
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('Python is unavailable. Set KHABAR_WHISPER_PYTHON to the Whisper environment’s Python executable.');
    throw new Error(error.stderr?.trim() || error.message);
  }
  if (!transcript) throw new Error('Whisper did not detect any speech in the media file.');
  return transcript;
}

function normalizeChannel(channel) {
  const trimmed = channel.trim();
  return trimmed.startsWith('@') ? trimmed.toLowerCase() : trimmed;
}

async function syncChannel(store, apiKey, channel, limit) {
  const checkedAt = Date.now();
  const discovered = await discoverYouTube({ apiKey, channel, limit });
  const candidates = discovered.candidates.filter(video => !video.madeForKids);
  const discoveredIds = new Set(candidates.map(candidate => candidate.id));
  const toRecheck = store.publishedIds(channel).filter(id => !discoveredIds.has(id));
  let refreshed;
  try {
    refreshed = (await refreshYouTubeVideos({ apiKey, ids: toRecheck })).filter(video => !video.madeForKids);
  } catch (error) {
    store.sync(channel, candidates, [], checkedAt);
    throw error;
  }
  const refreshedIds = new Set(refreshed.map(candidate => candidate.id));
  const unavailable = toRecheck.filter(id => !refreshedIds.has(id));
  store.sync(channel, [...candidates, ...refreshed], unavailable, checkedAt);
  console.log(`${channel}: refreshed ${candidates.length} recent candidates.`);
}

async function runSync(store, values) {
  const apiKey = (values['api-key'] ?? process.env.YOUTUBE_API_KEY)?.trim();
  if (!apiKey) throw new Error('Pass --api-key or set YOUTUBE_API_KEY in your terminal.');
  const limit = Number(values.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('--limit must be from 1 to 50.');
  const interval = Number(values['interval-minutes']) * 60_000;
  if (!Number.isInteger(interval) || interval < 0 || interval > 2_147_483_647) {
    throw new Error('Provide an interval in minutes between zero and 35791.');
  }
  const channels = new Set((values.channel ?? defaultChannels).map(normalizeChannel));
  do {
    store.removeExpired(Date.now());
    let hadError = false;
    for (const channel of channels) {
      try {
        await syncChannel(store, apiKey, channel, limit);
      } catch (error) {
        hadError = true;
        console.error(`${channel}: ${error.message}`);
      }
    }
    if (!interval) {
      if (hadError) process.exitCode = 1;
      return;
    }
    await setTimeout(interval);
  } while (true);
}

function showQueue(store, channels) {
  const filter = new Set(channels?.map(normalizeChannel));
  const byChannel = new Map();
  for (const candidate of store.pending()) {
    const { channel, ...video } = candidate;
    if (filter.size && !filter.has(channel)) continue;
    if (!byChannel.has(channel)) byChannel.set(channel, []);
    byChannel.get(channel).push({ ...video, url: `https://www.youtube.com/watch?v=${video.id}` });
  }
  for (const [channel, candidates] of byChannel) console.log(JSON.stringify({ channel, candidates }));
}

function checkFactChecks(checks) {
  const hasText = value => typeof value === 'string' && Boolean(value.trim());
  const validSource = source => {
    if (!hasText(source?.title) || !hasText(source.publisher) || !hasText(source.url)) return false;
    const url = URL.parse(source.url);
    return url && ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
  };
  const verdicts = ['supported', 'contradicted', 'needs-context', 'unverified'];
  if (!Array.isArray(checks) || !checks.every(check =>
    hasText(check?.claim) && verdicts.includes(check.verdict) && hasText(check.explanation) &&
    (check.timestamp === undefined || (Number.isSafeInteger(check.timestamp) && check.timestamp >= 0)) &&
    Array.isArray(check.sources) && check.sources.every(validSource) &&
    (check.verdict === 'unverified' || check.sources.length > 0))) {
    throw new Error('Expected an array of checks with claim, verdict, explanation, and sources. See README for the format.');
  }
  return checks;
}

async function main() {
  const { values, positionals: [command, id, ...extra] } = parseArgs({
    allowPositionals: true,
    options: {
      'api-key': { type: 'string' },
      channel: { type: 'string', multiple: true },
      limit: { type: 'string', default: '10' },
      'interval-minutes': { type: 'string', default: '0' },
      format: { type: 'string', default: 'shorts' },
      story: { type: 'string' },
      transcript: { type: 'string' },
      media: { type: 'string' },
      file: { type: 'string' },
      help: { type: 'boolean' },
    },
  });
  if (values.help || !command) {
    console.log(usage.trim());
    return;
  }
  if (!['sync', 'queue', 'publish', 'transcript', 'fact-check', 'unpublish'].includes(command)) {
    throw new Error('Choose sync, queue, publish, transcript, fact-check, or unpublish.');
  }
  const editsVideo = ['publish', 'transcript', 'fact-check', 'unpublish'].includes(command);
  if (extra.length || (editsVideo ? !/^[A-Za-z0-9_-]{11}$/.test(id ?? '') : id !== undefined)) {
    throw new Error('Pass a YouTube video ID after publish, transcript, fact-check, or unpublish. See --help.');
  }
  if (command === 'fact-check' && !values.file) throw new Error('Pass --file with the fact-check JSON.');
  if (values.file && command !== 'fact-check') throw new Error('Use --file with fact-check.');
  if (values.transcript && values.media) throw new Error('Use either --transcript or --media.');
  if (command === 'transcript' && !values.transcript && !values.media) throw new Error('Pass --transcript with a UTF-8 text file or --media with a local media file.');
  if ((values.transcript || values.media) && !['publish', 'transcript'].includes(command)) {
    throw new Error('Use --transcript or --media with publish or transcript.');
  }
  const store = openVideoStore();
  try {
    if (command === 'sync') {
      await runSync(store, values);
    } else if (command === 'queue') {
      showQueue(store, values.channel);
    } else if (command === 'fact-check') {
      if (!store.video(id) && !videos.some(video => video.id === id)) throw new Error('Video unavailable. Run sync and check queue.');
      const checks = checkFactChecks(JSON.parse((await readFile(values.file, 'utf8')).replace(/^\uFEFF/, '')));
      store.setFactChecks(id, checks);
      console.log(`Saved ${checks.length} fact checks for ${id}.`);
    } else if (command === 'publish' || command === 'transcript') {
      if (!['shorts', 'full'].includes(values.format)) throw new Error('--format must be shorts or full.');
      if (values.story && !stories.some(story => story.id === values.story)) {
        throw new Error('Choose an existing story ID from public/stories.js.');
      }
      const video = store.video(id) ?? (command === 'transcript' ? videos.find(item => item.id === id) : undefined);
      if (!video) throw new Error('Video unavailable. Run sync and check queue.');
      const transcript = values.media ? await transcribeMedia(values.media)
        : values.transcript ? (await readFile(values.transcript, 'utf8')).trim() : '';
      if (values.transcript && !transcript) throw new Error('The transcript file is empty.');
      if (transcript) store.setTranscript(id, transcript);
      const source = analysisSource('video', video, store.transcripts().get(id));
      if (source.draft && !store.analysis(source.key, source.sourceHash)) {
        const result = await runPostAnalysis(store, source);
        if (result.status !== 200) console.warn(`Analysis pending for ${id}. ${result.body.error}`);
      }
      if (command === 'publish') {
        if (!store.publish(id, values.format, values.story)) throw new Error('Video unavailable. Run sync and check queue.');
        console.log(`Published ${id}. Refresh Watch to see it.`);
      } else {
        console.log(`Saved transcript for ${id}.`);
      }
    } else {
      if (!store.unpublish(id)) throw new Error('This video is not published from the queue.');
      console.log(`Removed ${id} from the published feed.`);
    }
  } finally {
    store.close();
  }
}

try {
  await main();
} catch (error) {
  console.error(`YouTube sync: ${error.message}`);
  process.exitCode = 1;
}
