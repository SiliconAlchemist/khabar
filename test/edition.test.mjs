import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createApp } from '../server/app.mjs';
import { openDatabase } from '../server/database.mjs';

test('an active newsroom serves a newly published story and later corrections', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'khabar-edition-'));
  const dbPath = join(dir, 'test.sqlite');
  const draft = join(dir, 'story.json');
  const socketPath = process.platform === 'win32' ? '\\\\.\\pipe\\khabar-' + randomUUID() : join(dir, 'http.sock');
  const db = openDatabase(dbPath);
  const server = createApp(db, { port: 4181, addresses: ['192.168.1.42'] });
  const host = '192.168.1.42:4181';
  function get(path, requestHost = host) {
    return new Promise((resolve, reject) => {
      http.get({ socketPath, path, headers: { host: requestHost }, agent: false }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
        res.on('error', reject);
      }).on('error', reject);
    });
  }
  async function json(path) {
    const res = await get(path);
    assert.equal(res.status, 200, path);
    return JSON.parse(res.body);
  }
  function publish(story) {
    writeFileSync(draft, JSON.stringify(story));
    execFileSync(process.execPath, [fileURLToPath(new URL('../server/publish.mjs', import.meta.url)), draft], {
      env: { ...process.env, KHABAR_DB: dbPath }, stdio: 'pipe'
    });
  }
  try {
    server.listen(socketPath);
    await once(server, 'listening');
    assert.match((await get('/')).body, /app\.js/);
    assert.equal((await get('/server/seed/edition.json')).status, 404);
    assert.equal((await get('/api/feed', 'unrecognized:4181')).status, 403);
    const initial = (await json('/api/feed')).stories;
    assert.equal(initial.length, 7);
    assert.equal(initial[0].id, 'delhi-air');
    assert.ok(!('body' in initial[0]) && !('timeline' in initial[0]));
    const lead = await json('/api/stories/delhi-air');
    const eighth = { ...lead, id: 'edition-test', body: ['A searchable test phrase.'] };
    publish(eighth);
    const published = (await json('/api/feed')).stories;
    assert.equal(published.length, 8);
    assert.equal(published[0].id, eighth.id);
    assert.deepEqual(await json('/api/stories/edition-test'), eighth);
    assert.deepEqual((await json('/api/feed?q=SEARCHABLE%20test')).stories.map(s => s.id), [eighth.id]);
    assert.ok((await json('/api/feed?q=stubble')).stories.some(s => s.id === 'delhi-air'));
    publish({ ...lead, title: 'Corrected headline' });
    assert.equal((await json('/api/feed')).stories[1].title, 'Corrected headline');
    assert.equal((await json('/api/stories/delhi-air')).title, 'Corrected headline');
    assert.throws(() => publish({ ...lead, body: null }));
    assert.equal((await json('/api/stories/delhi-air')).title, 'Corrected headline');
    assert.equal((await get('/api/stories/absent')).status, 404);
  } finally {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    db.close();
    for (const file of [draft, dbPath, dbPath + '-shm', dbPath + '-wal']) rmSync(file, { force: true });
    rmdirSync(dir);
  }
});
