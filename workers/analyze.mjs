import { openDatabase } from '../server/database.mjs';
import { createAnalyzer, endpoint, model } from '../server/analyses.mjs';
import { extract, promptVersion } from './extract.mjs';

const run = post => extract(post, endpoint, model, process.env.KHABAR_LLM_API_KEY);

if (process.send) {
  process.once('message', async post => {
    let reply;
    try { reply = { result: await run(post) }; }
    catch (error) { reply = { error: error.message }; }
    process.send(reply, () => process.disconnect());
  });
} else if (process.argv.length === 3) {
  const db = openDatabase();
  try {
    const argument = process.argv[2];
    const jobs = argument === '--pending'
      ? db.prepare(`SELECT id FROM posts WHERE NOT EXISTS (
          SELECT 1 FROM analyses WHERE post_id=posts.id AND endpoint=? AND model=? AND prompt_version=?
        ) ORDER BY created_at, rowid`).all(endpoint, model, promptVersion)
      : [{ id: argument }];
    const analyze = createAnalyzer(db, run);
    for (const { id } of jobs) {
      try {
        const result = await analyze(id);
        console.log(`${id}: ${result.claims.length} claims`);
      } catch (error) {
        console.error(`${id}: ${error.message}`);
        process.exitCode = 1;
      }
    }
    if (!jobs.length) console.log('No pending posts');
  } finally {
    db.close();
  }
} else {
  console.error('Usage: node workers/analyze.mjs <post-id|--pending>');
  process.exitCode = 1;
}
