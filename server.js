import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { openVideoStore } from './video-store.js';

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

const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  const path = request.url.split('?')[0];
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
});
