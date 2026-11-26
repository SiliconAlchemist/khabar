import http from 'node:http';
import { createAnalyzer } from './analyses.mjs';
import { feed, findStory, seedEdition } from './edition.mjs';
import { handlePost } from './posts.mjs';
import { servePage } from './static.mjs';

export function createApp(db, { port, addresses = [] }) {
  seedEdition(db);
  const allowedHosts = new Set(['127.0.0.1', 'localhost', ...addresses].map(host => `${host}:${port}`));
  const analyze = createAnalyzer(db);
  return http.createServer(async (req, res) => {
    function send(status, body) {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    }
    try {
      const host = req.headers.host;
      if (!allowedHosts.has(host)) return send(403, { error: 'Unknown host' });
      if (req.headers.origin && req.headers.origin !== `http://${host}`) return send(403, { error: 'Unexpected origin' });
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET') {
        if (url.pathname === '/health') return send(200, { status: 'ok' });
        if (url.pathname === '/api/feed') return send(200, { stories: feed(db, url.searchParams.get('q') ?? '') });
        const route = /^\/api\/stories\/([a-z0-9-]+)$/.exec(url.pathname);
        if (route) {
          const story = findStory(db, route[1]);
          return story ? send(200, story) : send(404, { error: 'Story not found' });
        }
      }
      if ((req.method === 'GET' || req.method === 'HEAD') && await servePage(req, res)) return;
      if (url.pathname === '/posts' || url.pathname.startsWith('/posts/')) {
        if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) {
          return send(403, { error: 'Source analysis is available on the host PC.' });
        }
        return await handlePost(req, send, db, analyze);
      }
      send(404, { error: 'Unknown route' });
    } catch (error) {
      send(error.status ?? 500, { error: error.status ? error.message : 'Internal server error' });
    }
  });
}
