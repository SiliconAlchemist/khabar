import { extname, resolve, sep } from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const publicDir = fileURLToPath(new URL('../web', import.meta.url));
const assetTypes = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'], ['.svg', 'image/svg+xml'],
  ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.png', 'image/png'],
  ['.webp', 'image/webp'], ['.avif', 'image/avif'], ['.ttf', 'font/ttf']
]);

export async function servePage(req, res) {
  const path = new URL(req.url, 'http://localhost').pathname;
  const name = path === '/' ? 'index.html' : path.slice(1);
  const type = assetTypes.get(extname(name)) ?? (name === 'fonts/LICENSE_STIX' && 'text/plain');
  if (!type || !/^[\w./-]+$/.test(name)) return false;
  const file = resolve(publicDir, name);
  if (!file.startsWith(publicDir + sep)) return false;
  let bytes;
  try { bytes = await readFile(file); }
  catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
    throw error;
  }
  res.writeHead(200, {
    'Content-Type': type, 'Content-Length': bytes.length,
    'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff'
  });
  res.end(req.method === 'HEAD' ? undefined : bytes);
  return true;
}
