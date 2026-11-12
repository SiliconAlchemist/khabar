import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const defaultDataDir = fileURLToPath(new URL('./data/', import.meta.url));
const maxMetadataAge = 30 * 24 * 60 * 60 * 1000;

export function openVideoStore(directory = process.env.KHABAR_DATA_DIR || defaultDataDir) {
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(resolve(directory, 'khabar.sqlite'), { timeout: 5000 });
  db.exec(`
    CREATE TABLE IF NOT EXISTS youtube_videos (
      id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      title TEXT NOT NULL,
      duration_seconds INTEGER NOT NULL,
      source_published_at TEXT,
      checked_at INTEGER NOT NULL,
      published_at INTEGER,
      format TEXT,
      story_id TEXT
    );
  `);

  const upsert = db.prepare(`
    INSERT INTO youtube_videos (id, channel, title, duration_seconds, source_published_at, checked_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      duration_seconds = excluded.duration_seconds,
      source_published_at = excluded.source_published_at,
      checked_at = excluded.checked_at
    WHERE excluded.checked_at >= youtube_videos.checked_at
  `);
  const deleteUnavailable = db.prepare('DELETE FROM youtube_videos WHERE id = ? AND checked_at <= ?');
  const expire = db.prepare('DELETE FROM youtube_videos WHERE checked_at <= ?');
  const publishedIds = db.prepare(`
    SELECT id FROM youtube_videos WHERE channel = ? AND published_at IS NOT NULL
  `);
  const pending = db.prepare(`
    SELECT id, channel, title, duration_seconds AS durationSeconds, source_published_at AS sourcePublishedAt
    FROM youtube_videos WHERE published_at IS NULL ORDER BY source_published_at DESC, checked_at DESC, id
  `);
  const published = db.prepare(`
    SELECT id, channel AS publisher, title, format, story_id AS storyId, source_published_at AS sourcePublishedAt
    FROM youtube_videos WHERE published_at IS NOT NULL AND checked_at > ? ORDER BY published_at DESC, id
  `);
  const publish = db.prepare(`
    UPDATE youtube_videos
    SET published_at = COALESCE(published_at, ?), format = ?, story_id = ?
    WHERE id = ?
  `);
  const unpublish = db.prepare(`
    UPDATE youtube_videos SET published_at = NULL, format = NULL, story_id = NULL
    WHERE id = ? AND published_at IS NOT NULL
  `);

  function removeExpired(now) {
    expire.run(now - maxMetadataAge);
  }

  return {
    sync(channel, candidates, unavailable = [], checkedAt = Date.now()) {
      db.exec('BEGIN IMMEDIATE');
      try {
        removeExpired(checkedAt);
        for (const candidate of candidates) {
          upsert.run(candidate.id, channel, candidate.title, candidate.durationSeconds, candidate.sourcePublishedAt ?? null, checkedAt);
        }
        for (const id of unavailable) deleteUnavailable.run(id, checkedAt);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    publishedIds(channel, now = Date.now()) {
      removeExpired(now);
      return publishedIds.all(channel).map(row => row.id);
    },
    pending(now = Date.now()) {
      removeExpired(now);
      return pending.all();
    },
    published(now = Date.now()) {
      return published.all(now - maxMetadataAge);
    },
    publish(id, format, storyId = null, now = Date.now()) {
      removeExpired(now);
      return publish.run(now, format, storyId, id).changes > 0;
    },
    unpublish(id) {
      return unpublish.run(id).changes > 0;
    },
    removeExpired,
    close() {
      db.close();
    },
  };
}
