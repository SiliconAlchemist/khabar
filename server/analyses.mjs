import { fork } from 'node:child_process';
import { promptVersion } from '../workers/extract.mjs';

export const endpoint = (process.env.KHABAR_LLM_BASE_URL ?? 'http://127.0.0.1:8081/v1').replace(/\/+$/, '');
export const model = process.env.KHABAR_LLM_MODEL ?? 'khabar-qwen';

function runWorker(post) {
  return new Promise((resolve, reject) => {
    const child = fork(new URL('../workers/analyze.mjs', import.meta.url), [], { execArgv: [] });
    child.once('error', reject);
    child.once('exit', code => reject(new Error(`Analysis worker exited (${code})`)));
    child.once('message', message => {
      if (message.error) reject(new Error(message.error));
      else resolve(message.result);
    });
    child.send(post, error => { if (error) reject(error); });
  });
}

export function createAnalyzer(db, run = runWorker) {
  const pending = new Map();
  const stored = db.prepare('SELECT result FROM analyses WHERE post_id=? AND endpoint=? AND model=? AND prompt_version=?');
  const insert = db.prepare('INSERT OR IGNORE INTO analyses(post_id,endpoint,model,prompt_version,result) VALUES(?,?,?,?,?)');
  return async function analyze(id) {
    const key = [id, endpoint, model, promptVersion];
    const cached = stored.get(...key);
    if (cached) return JSON.parse(cached.result);
    if (!pending.has(id)) {
      const post = db.prepare('SELECT id,url,language,text,created_at FROM posts WHERE id=?').get(id);
      if (!post) throw Object.assign(new Error('Post not found'), { status: 404 });
      pending.set(id, (async () => {
        let extraction;
        try { extraction = await run(post); }
        catch (error) {
          console.error('Extraction failed:', error.message);
          throw Object.assign(new Error('Model unavailable or invalid extraction. Check the model endpoint and context size, then retry.'), { status: 502 });
        }
        insert.run(...key, JSON.stringify({ model, prompt_version: promptVersion, ...extraction }));
        return JSON.parse(stored.get(...key).result);
      })().finally(() => pending.delete(id)));
    }
    return pending.get(id);
  };
}
