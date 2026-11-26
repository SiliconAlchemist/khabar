import { readFileSync } from 'node:fs';
import { openDatabase } from './database.mjs';
import { publishStory, seedEdition } from './edition.mjs';

try {
  if (process.argv.length !== 3) throw new Error('Usage: node server/publish.mjs path/to/story.json');
  const story = JSON.parse(readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, ''));
  const db = openDatabase();
  try {
    seedEdition(db);
    publishStory(db, story);
    console.log(`Published ${story.id}`);
  } finally {
    db.close();
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
