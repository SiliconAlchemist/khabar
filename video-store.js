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
      story_id TEXT,
      language TEXT
    );
    CREATE TABLE IF NOT EXISTS video_transcripts (
      id TEXT PRIMARY KEY,
      transcript TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS unavailable_videos (
      id TEXT PRIMARY KEY REFERENCES youtube_videos(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS news_articles (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      publisher TEXT NOT NULL,
      author TEXT NOT NULL,
      topic TEXT NOT NULL,
      summary TEXT NOT NULL,
      published_at TEXT NOT NULL,
      language TEXT
    );
    CREATE TABLE IF NOT EXISTS article_texts (
      id TEXT PRIMARY KEY REFERENCES news_articles(id),
      text TEXT NOT NULL,
      scope TEXT NOT NULL,
      source TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS article_read_rights (
      id TEXT PRIMARY KEY REFERENCES news_articles(id) ON DELETE CASCADE,
      attribution TEXT NOT NULL,
      license_name TEXT NOT NULL,
      license_url TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS transcript_inputs (
      id TEXT PRIMARY KEY REFERENCES video_transcripts(id),
      source TEXT NOT NULL,
      fingerprint TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS video_fact_checks (
      id TEXT PRIMARY KEY,
      checks TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS automated_video_checks (
      id TEXT PRIMARY KEY,
      source_hash TEXT NOT NULL,
      checks TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS video_analysis_work (
      id TEXT PRIMARY KEY,
      lease TEXT,
      next_attempt_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS post_analyses (
      post_key TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      findings TEXT NOT NULL,
      analysed_at INTEGER NOT NULL,
      PRIMARY KEY (post_key, source_hash)
    );
  `);

  const videoColumns = db.prepare('PRAGMA table_info(youtube_videos)');
  const articleColumns = db.prepare('PRAGMA table_info(news_articles)');
  if (!videoColumns.all().some(column => column.name === 'language')
    || !articleColumns.all().some(column => column.name === 'language')) {
    transaction(() => {
      if (!videoColumns.all().some(column => column.name === 'language')) db.exec('ALTER TABLE youtube_videos ADD COLUMN language TEXT');
      if (!articleColumns.all().some(column => column.name === 'language')) db.exec('ALTER TABLE news_articles ADD COLUMN language TEXT');
    });
  }

  const upsert = db.prepare(`
    INSERT INTO youtube_videos (id, channel, title, duration_seconds, source_published_at, checked_at, language)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      duration_seconds = excluded.duration_seconds,
      source_published_at = excluded.source_published_at,
      language = COALESCE(excluded.language, youtube_videos.language),
      checked_at = excluded.checked_at
    WHERE excluded.checked_at >= youtube_videos.checked_at
  `);
  const checkUnavailable = db.prepare('UPDATE youtube_videos SET checked_at = ? WHERE id = ? AND published_at IS NOT NULL AND checked_at <= ?');
  const markUnavailable = db.prepare('INSERT INTO unavailable_videos VALUES (?) ON CONFLICT(id) DO NOTHING');
  const markAvailable = db.prepare('DELETE FROM unavailable_videos WHERE id = ?');
  const updatePublished = db.prepare(`
    UPDATE youtube_videos SET title = ?, duration_seconds = ?, source_published_at = ?, checked_at = ?,
      language = COALESCE(?, language)
    WHERE id = ? AND published_at IS NOT NULL AND checked_at <= ?
  `);
  const expire = db.prepare('DELETE FROM youtube_videos WHERE published_at IS NULL AND checked_at <= ?');
  const publishedIds = db.prepare(`
    SELECT id FROM youtube_videos WHERE published_at IS NOT NULL ORDER BY checked_at, id
  `);
  const pending = db.prepare(`
    SELECT id, channel, title, duration_seconds AS durationSeconds, source_published_at AS sourcePublishedAt, language
    FROM youtube_videos WHERE published_at IS NULL AND id NOT IN (SELECT id FROM unavailable_videos)
    ORDER BY source_published_at DESC, checked_at DESC, id
  `);
  const published = db.prepare(`
    SELECT id, channel AS publisher, title, format, story_id AS storyId, source_published_at AS sourcePublishedAt,
      duration_seconds AS durationSeconds, language
    FROM youtube_videos WHERE published_at IS NOT NULL AND checked_at > ?
      AND id NOT IN (SELECT id FROM unavailable_videos) ORDER BY published_at DESC, id
  `);
  const publish = db.prepare(`
    UPDATE youtube_videos
    SET published_at = COALESCE(published_at, ?), format = ?, story_id = ?
    WHERE id = ?
  `);
  const insertCuratedVideo = db.prepare(`
    INSERT INTO youtube_videos (id, channel, title, duration_seconds, source_published_at, checked_at, language)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING
  `);
  const publishCurated = db.prepare(`
    UPDATE youtube_videos SET published_at = COALESCE(published_at, ?), format = ?,
      story_id = COALESCE(?, story_id) WHERE id = ?
  `);
  const unpublish = db.prepare(`
    UPDATE youtube_videos SET published_at = NULL, format = NULL, story_id = NULL
    WHERE id = ? AND published_at IS NOT NULL
  `);
  const video = db.prepare(`
    SELECT id, title, channel AS publisher, duration_seconds AS durationSeconds, source_published_at AS sourcePublishedAt, language
    FROM youtube_videos WHERE id = ? AND checked_at > ? AND id NOT IN (SELECT id FROM unavailable_videos)
  `);
  const knownVideo = db.prepare('SELECT id FROM youtube_videos WHERE id = ?');
  const latestArticles = db.prepare(`
    SELECT id, url, title, publisher, author, topic, summary, published_at AS publishedAt, language
    FROM news_articles ORDER BY published_at DESC, id LIMIT 200
  `);
  const getPublicArticle = db.prepare(`
    SELECT articles.id, url, title, publisher, author, topic, summary, published_at AS publishedAt, language,
      text, scope, attribution, license_name AS licenseName, license_url AS licenseUrl
    FROM news_articles AS articles LEFT JOIN article_texts USING (id) LEFT JOIN article_read_rights USING (id)
    WHERE articles.id = ?
  `);
  const publicArticleCandidates = db.prepare(`
    SELECT articles.id, url, title, publisher, author, topic, summary, published_at AS publishedAt, language,
      substr(text, 1, 1400) AS text, scope, attribution, license_name AS licenseName, license_url AS licenseUrl
    FROM news_articles AS articles LEFT JOIN article_texts USING (id) LEFT JOIN article_read_rights USING (id)
    ORDER BY (scope = 'full' AND license_url IS NOT NULL) IS TRUE DESC, published_at DESC, articles.id
  `);
  const upsertArticle = db.prepare(`
    INSERT INTO news_articles (id, url, title, publisher, author, topic, summary, published_at, language)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(url) DO UPDATE SET title = excluded.title, publisher = excluded.publisher,
      author = COALESCE(NULLIF(excluded.author, ''), news_articles.author),
      summary = COALESCE(NULLIF(excluded.summary, ''), news_articles.summary),
      topic = CASE WHEN excluded.topic = 'World' THEN news_articles.topic ELSE excluded.topic END,
      published_at = excluded.published_at, language = COALESCE(excluded.language, news_articles.language)
  `);
  const articleText = db.prepare('SELECT text, scope, source FROM article_texts WHERE id = ?');
  const evidenceArticles = db.prepare(
    'SELECT url, title, publisher, published_at AS publishedAt, substr(text, 1, 16000) AS text FROM article_texts JOIN news_articles USING (id) ORDER BY published_at DESC, id LIMIT 2000'
  );
  const upsertArticleText = db.prepare(`
    INSERT INTO article_texts (id, text, scope, source)
    SELECT id, ?, ?, ? FROM news_articles WHERE url = ?
    ON CONFLICT(id) DO UPDATE SET text = excluded.text, scope = excluded.scope, source = excluded.source
    WHERE article_texts.source = 'rss' OR excluded.source <> 'rss'
    RETURNING id
  `);
  const upsertArticleRights = db.prepare(`
    INSERT INTO article_read_rights VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET attribution = excluded.attribution, license_name = excluded.license_name,
      license_url = excluded.license_url
  `);
  const removeArticleRights = db.prepare('DELETE FROM article_read_rights WHERE id = ?');
  const articleTextCounts = db.prepare(`
    SELECT count(*) AS total, count(*) FILTER (WHERE scope = 'full') AS full,
      count(*) FILTER (WHERE scope = 'excerpt') AS excerpt, count(*) FILTER (WHERE scope IS NULL) AS missing
    FROM news_articles LEFT JOIN article_texts USING (id)
  `);
  const articlesMissingText = db.prepare(`
    SELECT id, title, url FROM news_articles LEFT JOIN article_texts USING (id)
    WHERE scope IS NULL ORDER BY published_at DESC, id LIMIT ?
  `);
  const transcripts = db.prepare('SELECT id, transcript FROM video_transcripts');
  const setTranscript = db.prepare(`INSERT INTO video_transcripts VALUES (?, ?)
    ON CONFLICT(id) DO UPDATE SET transcript = excluded.transcript`);
  const insertTranscript = db.prepare(`INSERT INTO video_transcripts VALUES (?, ?)
    ON CONFLICT(id) DO UPDATE SET transcript = excluded.transcript WHERE trim(video_transcripts.transcript) = ''`);
  const transcriptInput = db.prepare('SELECT source, fingerprint FROM transcript_inputs WHERE id = ?');
  const setTranscriptInput = db.prepare(`
    INSERT INTO transcript_inputs VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET source = excluded.source, fingerprint = excluded.fingerprint
  `);
  const deleteTranscriptInput = db.prepare('DELETE FROM transcript_inputs WHERE id = ?');
  const videoCoverage = db.prepare(`
    SELECT videos.id, videos.title, published_at IS NOT NULL AS published,
      transcripts.id IS NOT NULL AND trim(transcripts.transcript) <> '' AS hasTranscript
    FROM youtube_videos AS videos LEFT JOIN video_transcripts AS transcripts USING (id)
    WHERE checked_at > ? AND videos.id NOT IN (SELECT id FROM unavailable_videos)
    ORDER BY published DESC, source_published_at DESC, checked_at DESC, videos.id
  `);
  const transcript = db.prepare('SELECT transcript FROM video_transcripts WHERE id = ?');
  const factChecks = db.prepare('SELECT id, checks FROM video_fact_checks');
  const editorialChecks = db.prepare('SELECT checks FROM video_fact_checks WHERE id = ?');
  const setFactChecks = db.prepare(`INSERT INTO video_fact_checks VALUES (?, ?)
    ON CONFLICT(id) DO UPDATE SET checks = excluded.checks`);
  const automatedChecks = db.prepare('SELECT id, source_hash AS sourceHash, checks FROM automated_video_checks');
  const hasAutomatedChecks = db.prepare('SELECT 1 FROM automated_video_checks WHERE id = ? AND source_hash = ?');
  const saveAutomatedChecks = db.prepare(`INSERT INTO automated_video_checks VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET source_hash = excluded.source_hash, checks = excluded.checks`);
  const getAnalysisWork = db.prepare('SELECT attempts, error FROM video_analysis_work WHERE id = ?');
  const leaseAnalysisWork = db.prepare(`INSERT INTO video_analysis_work (id, lease, next_attempt_at) VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET lease = excluded.lease, next_attempt_at = excluded.next_attempt_at
    WHERE video_analysis_work.next_attempt_at <= ?`);
  const retryAnalysisWork = db.prepare(`UPDATE video_analysis_work SET lease = NULL, next_attempt_at = ?, attempts = attempts + 1, error = ?
    WHERE id = ? AND lease = ?`);
  const completeAnalysisWork = db.prepare('DELETE FROM video_analysis_work WHERE id = ? AND lease = ?');
  const analysis = db.prepare('SELECT findings, analysed_at AS analysedAt FROM post_analyses WHERE post_key = ? AND source_hash = ?');
  const saveAnalysis = db.prepare(`INSERT INTO post_analyses VALUES (?, ?, ?, ?)
    ON CONFLICT(post_key, source_hash) DO UPDATE SET findings = excluded.findings,
    analysed_at = excluded.analysed_at WHERE post_analyses.analysed_at <= excluded.analysed_at`);

  function removeExpired(now) {
    expire.run(now - maxMetadataAge);
  }

  function transaction(write) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = write();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function saveTranscript(id, transcript, input) {
    setTranscript.run(id, transcript);
    if (input) setTranscriptInput.run(id, input.source, input.fingerprint);
    else deleteTranscriptInput.run(id);
  }

  function flagUnavailable(ids, checkedAt) {
    for (const id of ids) {
      if (checkUnavailable.run(checkedAt, id, checkedAt).changes) markUnavailable.run(id);
    }
  }

  return {
    articles() {
      return latestArticles.all();
    },
    syncArticles(articles) {
      transaction(() => {
        for (const { id, url, title, publisher, author, topic, summary, publishedAt, language, sourceText } of articles) {
          upsertArticle.run(id, url, title, publisher, author, topic, summary, publishedAt, language ?? null);
          if (!sourceText) continue;
          const changed = upsertArticleText.get(sourceText.text, sourceText.scope, sourceText.source, url);
          if (!changed) continue;
          const { attribution, licenseName, licenseUrl } = sourceText;
          const license = typeof licenseUrl === 'string' && URL.parse(licenseUrl);
          if (sourceText.scope === 'full' && attribution?.trim() && licenseName?.trim()
            && license?.protocol === 'https:' && !license.username && !license.password) {
            upsertArticleRights.run(changed.id, attribution.trim(), licenseName.trim(), license.href);
          } else {
            removeArticleRights.run(changed.id);
          }
        }
      });
    },
    articleText: id => articleText.get(id),
    articleCandidate: id => getPublicArticle.get(id),
    articleCandidates: () => publicArticleCandidates.iterate(),
    evidenceArticles: () => evidenceArticles.iterate(),
    articleTextCounts: () => articleTextCounts.get(),
    articlesMissingText: limit => articlesMissingText.all(limit),
    sync(channel, candidates, unavailable = [], checkedAt = Date.now()) {
      transaction(() => {
        removeExpired(checkedAt);
        for (const candidate of candidates) {
          if (upsert.run(candidate.id, channel, candidate.title, candidate.durationSeconds,
            candidate.sourcePublishedAt ?? null, checkedAt, candidate.language ?? null).changes) markAvailable.run(candidate.id);
        }
        flagUnavailable(unavailable, checkedAt);
      });
    },
    publishedIds() {
      return publishedIds.all().map(row => row.id);
    },
    refreshPublished(candidates, unavailable, checkedAt) {
      transaction(() => {
        for (const candidate of candidates) {
          if (updatePublished.run(candidate.title, candidate.durationSeconds, candidate.sourcePublishedAt ?? null,
            checkedAt, candidate.language ?? null, candidate.id, checkedAt).changes) markAvailable.run(candidate.id);
        }
        flagUnavailable(unavailable, checkedAt);
      });
    },
    importVideo(id, { metadata, format, storyId, transcript, seed = false }, now = Date.now()) {
      return transaction(() => {
        if (metadata) {
          const { publisher, title, durationSeconds, sourcePublishedAt, language } = metadata;
          insertCuratedVideo.run(id, publisher, title, durationSeconds, sourcePublishedAt, now, language ?? null);
        }
        const row = knownVideo.get(id);
        if (!row && (!seed || format)) return false;
        if (format) publishCurated.run(now, format, storyId ?? null, id);
        if (transcript) saveTranscript(id, transcript.text, transcript);
        return true;
      });
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
    video(id, now = Date.now()) {
      return video.get(id, now - maxMetadataAge);
    },
    knownVideo: id => knownVideo.get(id),
    videoCoverage: (now = Date.now()) => videoCoverage.all(now - maxMetadataAge),
    transcript: id => transcript.get(id)?.transcript,
    transcripts: () => new Map(transcripts.all().map(({ id, transcript }) => [id, transcript])),
    transcriptInput: id => transcriptInput.get(id),
    setTranscript: (id, transcript, input) => transaction(() => saveTranscript(id, transcript, input)),
    saveGeneratedTranscript(id, text, input) {
      return transaction(() => {
        if (!insertTranscript.run(id, text).changes) return false;
        setTranscriptInput.run(id, input.source, input.fingerprint);
        return true;
      });
    },
    factChecks: () => new Map(factChecks.all().map(({ id, checks }) => [id, JSON.parse(checks)])),
    hasEditorialChecks: id => Boolean(JSON.parse(editorialChecks.get(id)?.checks ?? '[]').length),
    setFactChecks: (id, checks) => setFactChecks.run(id, JSON.stringify(checks)),
    automatedChecks: () => new Map(automatedChecks.all().map(({ id, sourceHash, checks }) => [id, { sourceHash, checks: JSON.parse(checks) }])),
    hasAutomatedChecks: (id, sourceHash) => Boolean(hasAutomatedChecks.get(id, sourceHash)),
    saveAutomatedChecks: (id, sourceHash, checks) => saveAutomatedChecks.run(id, sourceHash, JSON.stringify(checks)),
    analysisWork: id => getAnalysisWork.get(id),
    leaseAnalysisWork: (id, lease, now) => Boolean(leaseAnalysisWork.run(id, lease, now + 15 * 60_000, now).changes),
    retryAnalysisWork: (id, lease, next, error) => retryAnalysisWork.run(next, error, id, lease),
    completeAnalysisWork: (id, lease) => completeAnalysisWork.run(id, lease),
    analysis(postKey, sourceHash) {
      const row = analysis.get(postKey, sourceHash);
      return row && { ...JSON.parse(row.findings), analysedAt: row.analysedAt };
    },
    saveAnalysis: (postKey, sourceHash, findings, analysedAt) => saveAnalysis.run(postKey, sourceHash, JSON.stringify(findings), analysedAt),
    removeExpired,
    close() {
      db.close();
    },
  };
}
