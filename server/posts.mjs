import { randomUUID, createHash } from 'node:crypto';

function fail(status, message) {
  return Object.assign(new Error(message), { status });
}

async function readPost(req) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw fail(415, 'Send application/json');
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 256000) throw fail(413, 'Post exceeds 256 KB');
    chunks.push(chunk);
  }
  let input;
  try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw fail(400, 'Invalid JSON'); }
  if (!input || typeof input.url !== 'string' || !URL.canParse(input.url)) throw fail(400, 'Expected a source URL');
  const url = new URL(input.url);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw fail(400, 'Invalid source URL');
  if (!['hi','en'].includes(input.language)) throw fail(400, 'language must be en or hi');
  if (typeof input.text !== 'string' || !input.text.trim()) throw fail(400, 'Expected article or transcript text');
  return { url: url.href, language: input.language, text: input.text };
}

export async function handlePost(req, send, db, analyze) {
  if (req.method === 'POST' && req.url === '/posts') {
    const post = await readPost(req);
    const hash = createHash('sha256').update(JSON.stringify(post)).digest('hex');
    const write = db.prepare('INSERT OR IGNORE INTO posts(id,fingerprint,url,language,text) VALUES (?,?,?,?,?)')
      .run(randomUUID(), hash, post.url, post.language, post.text);
    return send(write.changes ? 201 : 200, db.prepare('SELECT id FROM posts WHERE fingerprint=?').get(hash));
  }
  const route = /^\/posts\/([a-f0-9-]{36})(\/analyze)?$/.exec(req.url);
  if (!route) throw fail(404, 'Unknown route');
  const post = db.prepare('SELECT id,url,language,text,created_at FROM posts WHERE id=?').get(route[1]);
  if (!post) throw fail(404, 'Post not found');
  if (req.method === 'POST' && route[2]) return send(200, await analyze(post.id));
  if (req.method === 'GET' && !route[2]) {
    const rows = db.prepare('SELECT result FROM analyses WHERE post_id=? ORDER BY created_at, rowid').all(post.id);
    return send(200, { ...post, analyses: rows.map(row => JSON.parse(row.result)) });
  }
  throw fail(405, 'Unsupported method');
}
