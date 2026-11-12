import { setTimeout } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { stories } from '../public/stories.js';
import { openVideoStore } from '../video-store.js';
import { defaultChannels, discoverYouTube, refreshYouTubeVideos } from './discover-youtube.js';

const usage = `Usage:
  node scripts/sync-youtube.js sync [--api-key KEY] [--channel @HANDLE] [--limit 10] [--interval-minutes 60]
  node scripts/sync-youtube.js queue [--channel @HANDLE]
  node scripts/sync-youtube.js publish VIDEO_ID [--format shorts|full] [--story STORY_ID]
  node scripts/sync-youtube.js unpublish VIDEO_ID

Sync uses YOUTUBE_API_KEY when --api-key is omitted. Repeat --channel to select sources.
With no interval, sync runs once. A positive interval keeps it running in the foreground.
The server and this script use data/khabar.sqlite, or the same KHABAR_DATA_DIR if set.
`;

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
      help: { type: 'boolean' },
    },
  });
  if (values.help || !command) {
    console.log(usage.trim());
    return;
  }
  if (!['sync', 'queue', 'publish', 'unpublish'].includes(command)) {
    throw new Error('Choose sync, queue, publish, or unpublish.');
  }
  const editsVideo = command === 'publish' || command === 'unpublish';
  if (extra.length || (editsVideo ? !/^[A-Za-z0-9_-]{11}$/.test(id ?? '') : id !== undefined)) {
    throw new Error('Pass a YouTube video ID after publish or unpublish. See --help.');
  }
  const store = openVideoStore();
  try {
    if (command === 'sync') {
      await runSync(store, values);
    } else if (command === 'queue') {
      showQueue(store, values.channel);
    } else if (command === 'publish') {
      if (!['shorts', 'full'].includes(values.format)) throw new Error('--format must be shorts or full.');
      if (values.story && !stories.some(story => story.id === values.story)) {
        throw new Error('Choose an existing story ID from public/stories.js.');
      }
      if (!store.publish(id, values.format, values.story)) throw new Error('Video unavailable. Run sync and check queue.');
      console.log(`Published ${id}. Refresh Watch to see it.`);
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
