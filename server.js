import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { openVideoStore } from './video-store.js';
import { handleBiasAnalysis, isLocalAnalysisRequest, sendJson } from './bias-analyser.js';
import { postSources, publicAnalysis, runPostAnalysis } from './post-analysis.js';

const assets = new Map([
  ['/', ['index.html', 'text/html']],
  ['/app.js', ['app.js', 'text/javascript']],
  ['/stories.js', ['stories.js', 'text/javascript']],
  ['/videos.js', ['videos.js', 'text/javascript']],
  ['/playback.js', ['playback.js', 'text/javascript']],
  ['/bias.js', ['bias.js', 'text/javascript']],
  ['/styles.css', ['styles.css', 'text/css']],
  ['/bias.css', ['bias.css', 'text/css']],
  ['/manifest.webmanifest', ['manifest.webmanifest', 'application/manifest+json']],
  ['/icon-192.png', ['icon-192.png', 'image/png']],
  ['/icon-512.png', ['icon-512.png', 'image/png']],
]);
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4173);
const pageHeaders = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' https://www.youtube.com https://s.ytimg.com",
    "style-src 'self'",
    "img-src 'self' https://i.ytimg.com https://upload.wikimedia.org",
    'frame-src https://www.youtube-nocookie.com https://www.youtube.com',
    "connect-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};
let videoStore;
const activeAnalyses = new Map();

function refreshAnalysis(source) {
  const current = activeAnalyses.get(source.key);
  if (current) return current.sourceHash === source.sourceHash
    ? current.promise
    : current.promise.then(() => refreshAnalysis(source));

  const promise = runPostAnalysis(videoStore, source).finally(() => activeAnalyses.delete(source.key));
  activeAnalyses.set(source.key, { sourceHash: source.sourceHash, promise });
  return promise;
}

async function backfillAnalyses() {
  try {
    videoStore ??= openVideoStore();
    for (const source of postSources(videoStore).values()) {
      if (!source.draft || videoStore.analysis(source.key, source.sourceHash)) continue;
      if (activeAnalyses.size && !activeAnalyses.has(source.key)) break;
      const result = await refreshAnalysis(source);
      if (result.status === 503 || result.status === 504) break;
    }
  } catch (error) {
    console.error('Could not backfill post analyses:', error.message);
  } finally {
    setTimeout(backfillAnalyses, 30_000).unref();
  }
}

const server = createServer(async (request, response) => {
  const path = request.url.split('?')[0];
  if (path === '/api/post-analyses' || path.startsWith('/api/post-analyses/')) {
    const listing = path === '/api/post-analyses';
    const method = listing ? 'GET' : 'POST';
    if (request.method !== method) return response.writeHead(405, { Allow: method }).end();
    const serverPort = server.address().port;
    const localAddress = request.socket.localAddress?.replace(/^::ffff:/, '') ?? '';
    const localHost = localAddress.includes(':') ? `[${localAddress}]:${serverPort}` : `${localAddress}:${serverPort}`;
    const sameOrigin = localAddress && request.headers.host === localHost && request.headers.origin === `http://${localHost}`;
    if (!listing && !sameOrigin && !isLocalAnalysisRequest(request, serverPort)) {
      return sendJson(response, 403, { error: 'Open Khabar directly on this computer or its local network address to refresh analysis.' });
    }
    try {
      videoStore ??= openVideoStore();
      const sources = postSources(videoStore);
      if (listing) {
        const checks = videoStore.factChecks();
        return sendJson(response, 200, Object.fromEntries([...sources].map(([key, source]) => {
          const analysis = publicAnalysis(source, videoStore.analysis(key, source.sourceHash));
          if (key.startsWith('video/')) analysis.factChecks = checks.get(key.slice('video/'.length)) ?? [];
          return [key, analysis];
        })));
      }
      const source = sources.get(path.slice('/api/post-analyses/'.length));
      if (!source) return sendJson(response, 404, { error: 'Post unavailable.' });
      if (!source.draft) return sendJson(response, 409, { error: 'A transcript is needed to analyse this video.' });
      if (activeAnalyses.size && !activeAnalyses.has(source.key)) {
        return sendJson(response, 429, { error: 'The local model is analysing another post. Try again shortly.' });
      }
      const result = await refreshAnalysis(source);
      return sendJson(response, result.status, result.body);
    } catch (error) {
      console.error('Post analysis failed:', error.message);
      return sendJson(response, 503, { error: 'Post analysis is unavailable.' });
    }
  }
  if (path === '/api/bias-analysis') {
    if (request.method !== 'POST') {
      response.writeHead(405, { Allow: 'POST' }).end();
      return;
    }
    await handleBiasAnalysis(request, response, server.address().port);
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  if (path === '/api/videos') {
    try {
      videoStore ??= openVideoStore();
      const body = JSON.stringify(videoStore.published());
      response.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      }).end(request.method === 'HEAD' ? undefined : body);
    } catch (error) {
      console.error(error);
      response.writeHead(503).end('Video feed unavailable');
    }
    return;
  }
  const asset = assets.get(path);
  if (!asset) {
    response.writeHead(404).end('Not found');
    return;
  }
  const [file, type] = asset;
  try {
    const content = await readFile(new URL(`./public/${file}`, import.meta.url));
    const contentType = type === 'image/png' ? type : `${type}; charset=utf-8`;
    response.writeHead(200, {
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff',
      ...(type === 'text/html' ? pageHeaders : {}),
    });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch (error) {
    console.error(error);
    response.writeHead(500).end('Could not load app asset');
  }
});

server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use on ${host}. If Khabar is already running, open http://${host}:${port}. Otherwise, set PORT to a free port and try again.`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});

server.listen(port, host, () => {
  console.log(`Khabar is running at http://${host}:${server.address().port}`);
  void backfillAnalyses();
});
