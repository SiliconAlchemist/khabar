import { createHash, randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { videoLanguage } from '../feed-language.js';
import { analysisSource, currentPostBias, runPostAnalysis } from '../post-analysis.js';
import { videos } from '../public/videos.js';
import { openVideoStore } from '../video-store.js';
import { acquirePublisherTranscript, publisherTranscriptSources } from './publisher-transcripts.js';
import { createVideoIntelligence } from './video-intelligence.js';

const usage = 'Usage: node scripts/analyze-videos.js [--limit 3] [--interval-minutes 60] [--max-duration-minutes 30] [--id VIDEO_ID] [--transcripts-only]';
const defaultModel = 'gemini-3.5-flash-lite';
const minute = 60_000;

export async function analyzeVideos(store, overrides = {}) {
  const options = {
    limit: 3,
    maxDuration: 30 * 60,
    geminiKey: process.env.GEMINI_API_KEY?.trim(),
    transcriptModel: process.env.KHABAR_GEMINI_MODEL?.trim() || defaultModel,
    ...overrides,
  };
  if (!/^[a-zA-Z0-9_.-]+$/.test(options.transcriptModel)) throw new Error('Set KHABAR_GEMINI_MODEL to a Gemini model ID.');
  const intelligence = createVideoIntelligence({ ...options, store });
  try {
    return await processVideos(store, options, intelligence);
  } finally {
    intelligence.close();
  }
}

async function processVideos(store, { limit, maxDuration, id, geminiKey, fetchImpl, transcriptsOnly }, intelligence) {
  const published = store.published();
  const catalog = new Map(videos.map(video => [video.id, video]));
  for (const video of published) {
    const seed = catalog.get(video.id);
    catalog.set(video.id, { ...seed, ...video, durationSeconds: video.durationSeconds || seed?.durationSeconds });
  }
  if (transcriptsOnly && !id) {
    for (const video of store.pending()) {
      if (!catalog.has(video.id)) catalog.set(video.id, video);
    }
  }
  if (id && !catalog.has(id)) {
    const queued = store.video(id);
    if (queued) catalog.set(id, queued);
    else throw new Error('Video is not in Watch or the current review queue.');
  }
  const candidates = id ? [catalog.get(id)] : [...new Set([...published.map(video => video.id), ...catalog.keys()])]
    .map(videoId => catalog.get(videoId));
  let processed = 0;
  let failures = 0;
  let awaitingTranscripts = 0;
  for (const video of candidates) {
    if (processed >= limit) break;
    if (!/^[A-Za-z0-9_-]{11}$/.test(video.id)) continue;
    let transcript = store.transcript(video.id)?.trim();
    const hasPublisherTranscript = publisherTranscriptSources.has(video.id);
    if (transcript && (transcriptsOnly || !videoLanguage(video, transcript))) {
      if (id) console.log(video.id + (transcriptsOnly ? ': transcript already available.' : ': transcript language outside the Watch edition.'));
      continue;
    }
    if (!transcript && !hasPublisherTranscript && video.durationSeconds > maxDuration) {
      if (id) throw new Error('Video exceeds the duration limit. Raise --max-duration-minutes to include it.');
      continue;
    }
    if (!transcript && !geminiKey && !hasPublisherTranscript) {
      if (id) throw new Error('No transcript source for this video. Import a publisher transcript or set GEMINI_API_KEY for automatic YouTube transcription.');
      awaitingTranscripts += 1;
      continue;
    }
    let source = transcript && analysisSource('video', video, transcript);
    const editorial = store.hasEditorialChecks(video.id);
    if (source && currentPostBias(store, source)
      && (editorial || store.hasAutomatedChecks(video.id, source.sourceHash))) {
      if (id) console.log(video.id + ': analysis is up to date.');
      continue;
    }

    const lease = randomUUID();
    if (!store.leaseAnalysisWork(video.id, lease, Date.now())) {
      if (id) console.log(video.id + ': already processing or waiting to retry.');
      continue;
    }
    processed += 1;
    try {
      if (!transcript) {
        let input;
        if (hasPublisherTranscript) {
          try {
            input = await acquirePublisherTranscript(video.id);
          } catch (error) {
            if (!geminiKey || video.durationSeconds > maxDuration) throw error;
            console.warn(video.id + ': publisher transcript unavailable. Trying Gemini.');
          }
        }
        if (!input) {
          const text = await intelligence.transcribe(video);
          if (text) input = { text, source: 'gemini-youtube', fingerprint: createHash('sha256').update(text).digest('hex') };
        }
        if (!input) {
          store.retryAnalysisWork(video.id, lease, Date.now() + 7 * 24 * 60 * minute, 'No intelligible speech detected.');
          console.log(video.id + ': no intelligible speech detected.');
          continue;
        }
        if (!videoLanguage(video, input.text)) {
          store.retryAnalysisWork(video.id, lease, Date.now() + 7 * 24 * 60 * minute, 'Transcript language is outside the Watch edition.');
          console.log(video.id + ': transcript language outside the Watch edition.');
          continue;
        }
        store.saveGeneratedTranscript(video.id, input.text, input);
        transcript = store.transcript(video.id)?.trim();
        source = analysisSource('video', video, transcript);
        console.log(video.id + ': transcript saved.');
      }
      if (transcriptsOnly) {
        store.completeAnalysisWork(video.id, lease);
        continue;
      }
      let biasError;
      if (!currentPostBias(store, source)) {
        const result = await runPostAnalysis(store, source, { fetchImpl });
        if (result.status === 200) console.log(video.id + ': bias analysis saved.');
        else biasError = new Error(result.body.error);
      }
      if (!editorial && !store.hasAutomatedChecks(video.id, source.sourceHash)) {
        const checks = await intelligence.factCheck(transcript, video);
        if (store.transcript(video.id)?.trim() !== transcript) throw new Error('Transcript changed during analysis.');
        store.saveAutomatedChecks(video.id, source.sourceHash, checks);
        console.log(video.id + ': ' + checks.length + ' automated fact checks saved.');
      }
      if (biasError) throw biasError;
      store.completeAnalysisWork(video.id, lease);
    } catch (error) {
      const attempts = store.analysisWork(video.id)?.attempts ?? 0;
      const delay = Math.min(24 * 60, 5 * 2 ** Math.min(attempts, 9));
      store.retryAnalysisWork(video.id, lease, Date.now() + delay * minute, error.message);
      console.error(video.id + ': ' + error.message);
      failures += 1;
      if (error.pauseBatch) break;
    }
  }
  if (awaitingTranscripts) console.log(awaitingTranscripts + ' videos have no available transcript source. Import publisher transcripts or set GEMINI_API_KEY to transcribe public YouTube URLs.');
  return { processed, failures };
}

async function main() {
  const { values } = parseArgs({ options: {
    id: { type: 'string' }, limit: { type: 'string', default: '3' },
    'max-duration-minutes': { type: 'string', default: '30' },
    'interval-minutes': { type: 'string', default: '0' }, 'transcripts-only': { type: 'boolean' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log(usage);
    return;
  }
  const limit = Number(values.limit);
  const maxMinutes = Number(values['max-duration-minutes']);
  const interval = Number(values['interval-minutes']);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error('--limit must be from 1 to 50.');
  if (!Number.isSafeInteger(maxMinutes) || maxMinutes < 1 || maxMinutes > 60) throw new Error('--max-duration-minutes must be from 1 to 60.');
  if (!Number.isSafeInteger(interval) || interval < 0 || interval > 1440) throw new Error('--interval-minutes must be from 0 to 1440.');
  if (values.id !== undefined && !/^[A-Za-z0-9_-]{11}$/.test(values.id)) throw new Error('Pass an 11-character YouTube video ID.');
  const store = openVideoStore();
  try {
    do {
      const { processed, failures } = await analyzeVideos(store, {
        id: values.id, limit, maxDuration: maxMinutes * 60, transcriptsOnly: values['transcripts-only'],
      });
      console.log('Processed ' + processed + ' videos. ' + failures + ' will need a retry.');
      if (!interval) {
        if (failures) process.exitCode = 1;
        return;
      }
      await setTimeout(interval * minute);
    } while (true);
  } finally {
    store.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error('Video analysis: ' + error.message);
    process.exitCode = 1;
  }
}
