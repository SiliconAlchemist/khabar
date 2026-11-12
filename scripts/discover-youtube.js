import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const defaultChannel = '@PeekTVOfficial';
export const defaultChannels = [
  '@ravishkumar.official',
  '@fayedsouza',
  '@UNFILTEREDbySamdish',
  '@mojostory',
  defaultChannel,
  '@newslaundry',
  '@ndtvindia',
  '@indianexpress',
];
const defaultLimit = 10;
const maxPages = 3;
const youtubeApi = 'https://www.googleapis.com/youtube/v3/';
const videoIdPattern = /^[A-Za-z0-9_-]{11}$/;
const channelIdPattern = /^UC[A-Za-z0-9_-]{22}$/;

const usage = `Usage: node scripts/discover-youtube.js [--api-key KEY] [--channel @HANDLE|CHANNEL_ID] [--limit 1-50]

Find recent public, embeddable YouTube uploads up to three minutes long that are available in India.
Review each candidate for news relevance and Shorts format before adding it to Khabar.

  --api-key  YouTube Data API key. Falls back to YOUTUBE_API_KEY when omitted.
  --channel  A channel handle or ID. Repeat to select several channels.
  --limit    Maximum candidates per channel (default: 10). Scans up to 150 recent uploads per channel.
  --help     Show this message.

Default channels: ${defaultChannels.join(', ')}.
One channel prints a JSON object. Multiple channels print one JSON object per line.
`;

async function requestYouTube(fetchImpl, apiKey, endpoint, params) {
  const url = new URL(endpoint, youtubeApi);
  url.search = new URLSearchParams(params);

  let response;
  try {
    response = await fetchImpl(url, {
      headers: { 'x-goog-api-key': apiKey },
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error('Could not reach the YouTube Data API. Check your connection and try again.');
  }

  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const reason = result?.error?.errors?.[0]?.reason ?? result?.error?.status ?? '';
    const detail = /^[A-Za-z][A-Za-z0-9_]{0,59}$/.test(reason) ? ` (${reason})` : '';
    throw new Error(`YouTube ${endpoint} request failed with HTTP ${response.status}${detail}.`);
  }
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error(`YouTube ${endpoint} returned an invalid response.`);
  }
  return result;
}

function toCandidate(video) {
  const { status, snippet, contentDetails } = video;
  if (status?.privacyStatus !== 'public' || status.embeddable !== true) {
    return null;
  }
  if (snippet?.liveBroadcastContent !== 'none' || typeof snippet.title !== 'string' || !snippet.title.trim()) return null;

  const restrictions = contentDetails?.regionRestriction;
  if (restrictions?.blocked?.includes('IN') || (restrictions?.allowed && !restrictions.allowed.includes('IN'))) {
    return null;
  }
  const duration = /^PT(?:(\d+)M)?(?:(\d+)S)?$/.exec(contentDetails?.duration ?? '');
  if (!duration) return null;

  const [, minutes = '0', seconds = '0'] = duration;
  const durationSeconds = Number(minutes) * 60 + Number(seconds);
  if (durationSeconds < 1 || durationSeconds > 180) return null;

  return {
    id: video.id,
    title: snippet.title,
    url: `https://www.youtube.com/watch?v=${video.id}`,
    durationSeconds,
    sourcePublishedAt: typeof snippet.publishedAt === 'string' ? snippet.publishedAt : null,
    madeForKids: status.madeForKids === true,
  };
}

async function videoDetails(request, ids) {
  const result = await request('videos', {
    part: 'snippet,status,contentDetails',
    id: ids.join(','),
    fields: 'items(id,snippet(title,liveBroadcastContent,publishedAt),status(privacyStatus,embeddable,madeForKids),contentDetails(duration,regionRestriction))',
  });
  if (!Array.isArray(result.items)) throw new Error('YouTube returned an incomplete video list.');
  return new Map(result.items.map(video => [video.id, toCandidate(video)]));
}

export async function refreshYouTubeVideos({ apiKey, ids, fetchImpl = fetch }) {
  const videos = [];
  const request = (endpoint, params) => requestYouTube(fetchImpl, apiKey, endpoint, params);
  for (let offset = 0; offset < ids.length; offset += 50) {
    const requested = ids.slice(offset, offset + 50);
    const batch = await videoDetails(request, requested);
    videos.push(...requested.map(id => batch.get(id)).filter(Boolean));
  }
  return videos;
}

export async function discoverYouTube({
  apiKey,
  channel = defaultChannel,
  limit = defaultLimit,
  fetchImpl = fetch,
}) {
  const channelFilter = channelIdPattern.test(channel) ? 'id' : 'forHandle';
  if (channelFilter === 'forHandle' && !/^@[^\s/@?#&]+$/.test(channel)) {
    throw new Error('Provide a YouTube channel handle such as @PeekTVOfficial or a UC channel ID.');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new Error('--limit must be an integer from 1 to 50.');
  }
  const key = apiKey?.trim();
  if (!key) throw new Error('Pass --api-key or set YOUTUBE_API_KEY in your terminal.');

  const request = (endpoint, params) => requestYouTube(fetchImpl, key, endpoint, params);
  const lookup = await request('channels', {
    part: 'contentDetails',
    [channelFilter]: channel,
    fields: 'items(contentDetails(relatedPlaylists(uploads)))',
  });
  const uploads = lookup.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) throw new Error(`Could not find an uploads playlist for ${channel}.`);

  const candidates = [];
  const seen = new Set();
  let pageToken;
  for (let page = 0; page < maxPages && candidates.length < limit; page += 1) {
    const playlist = await request('playlistItems', {
      part: 'contentDetails',
      playlistId: uploads,
      maxResults: 50,
      fields: 'nextPageToken,items(contentDetails(videoId))',
      ...(pageToken ? { pageToken } : {}),
    });
    const uniqueIds = new Set((playlist.items ?? []).map(item => item.contentDetails?.videoId));
    const ids = [...uniqueIds].filter(id => videoIdPattern.test(id ?? '') && !seen.has(id));
    for (const id of ids) seen.add(id);

    if (ids.length) {
      const byId = await videoDetails(request, ids);
      for (const id of ids) {
        if (candidates.length === limit) break;
        const candidate = byId.get(id);
        if (candidate) candidates.push(candidate);
      }
    }

    if (!playlist.nextPageToken || pageToken === playlist.nextPageToken) break;
    pageToken = playlist.nextPageToken;
  }

  return { channel, discoveredAt: new Date().toISOString(), candidates };
}

async function main() {
  const { values } = parseArgs({
    options: {
      'api-key': { type: 'string' },
      channel: { type: 'string', multiple: true },
      limit: { type: 'string', default: String(defaultLimit) },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log(usage.trim());
    return;
  }
  const apiKey = (values['api-key'] ?? process.env.YOUTUBE_API_KEY)?.trim();
  if (!apiKey) throw new Error('Pass --api-key or set YOUTUBE_API_KEY in your terminal.');
  const limit = Number(values.limit);
  if (!/^\d+$/.test(values.limit) || limit < 1 || limit > 50) {
    throw new Error('--limit must be an integer from 1 to 50.');
  }

  const channels = new Map();
  for (const input of values.channel ?? defaultChannels) {
    const channel = input.trim();
    const identifier = channel.startsWith('@') ? channel.toLowerCase() : channel;
    if (!channels.has(identifier)) channels.set(identifier, channel);
  }

  const indent = channels.size === 1 ? 2 : undefined;
  for (const channel of channels.values()) {
    try {
      const result = await discoverYouTube({ apiKey, channel, limit });
      console.log(JSON.stringify(result, null, indent));
    } catch (error) {
      console.error(`YouTube discovery (${channel}): ${error.message}`);
      process.exitCode = 1;
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(`YouTube discovery: ${error.message}`);
    process.exitCode = 1;
  }
}
