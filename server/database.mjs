import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export function openDatabase(path = process.env.KHABAR_DB ?? fileURLToPath(new URL('../data/khabar.sqlite', import.meta.url))) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA busy_timeout=5000;
  PRAGMA journal_mode=WAL;
  PRAGMA foreign_keys=ON;
  CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL UNIQUE, url TEXT NOT NULL,
    language TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS analyses (
    post_id TEXT NOT NULL REFERENCES posts(id), endpoint TEXT NOT NULL, model TEXT NOT NULL,
    prompt_version TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (post_id, endpoint, model, prompt_version)
  );
  CREATE TABLE IF NOT EXISTS published_stories (
    position INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE,
    story TEXT NOT NULL, card TEXT NOT NULL, search_text TEXT NOT NULL
  );`);
  return db;
}
