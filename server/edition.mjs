import { readFileSync } from 'node:fs';

function requireText(object, fields) {
  for (const field of fields) {
    if (typeof object?.[field] !== 'string' || !object[field].trim()) {
      throw new Error(`Missing or invalid story field: ${field}`);
    }
  }
}

export function publishStory(db, story) {
  requireText(story, ['id', 'title', 'summary', 'section', 'date', 'publisher', 'url', 'image']);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(story.id)) throw new Error('Expected a lowercase story slug');
  if (!Array.isArray(story.body) || !story.body.every(p => typeof p === 'string')) {
    throw new Error('Expected a body array containing paragraphs');
  }
  const collections = {
    timeline: ['date', 'title', 'detail', 'url'],
    perspectives: ['label', 'headline', 'detail', 'publisher', 'url'],
    sources: ['kind', 'title', 'detail', 'publisher', 'url']
  };
  for (const [name, fields] of Object.entries(collections)) {
    if (!Array.isArray(story[name])) throw new Error(`Expected a ${name} array`);
    for (const entry of story[name]) requireText(entry, fields);
  }
  const { body, sources, timeline, perspectives, ...card } = story;
  const themes = new Map();
  for (const { label, color } of perspectives) {
    if (!themes.has(label)) themes.set(label, { label, color });
  }
  card.themes = [...themes.values()].slice(0, 3);
  const search = [story.title, story.shortTitle, story.section, story.location, story.summary,
    story.publisher, ...body, ...sources.flatMap(s => [s.title, s.publisher, s.kind]),
    ...perspectives.flatMap(p => [p.label, p.headline, p.publisher])].join(' ').toLowerCase();
  db.prepare(`INSERT INTO published_stories(id,story,card,search_text) VALUES(?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET story=excluded.story, card=excluded.card, search_text=excluded.search_text`)
    .run(story.id, JSON.stringify(story), JSON.stringify(card), search);
}

export function seedEdition(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!db.prepare('SELECT 1 FROM published_stories LIMIT 1').get()) {
      const seed = JSON.parse(readFileSync(new URL('./seed/edition.json', import.meta.url), 'utf8'));
      for (const story of seed.reverse()) publishStory(db, story);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function feed(db, query = '') {
  const rows = db.prepare('SELECT card FROM published_stories WHERE instr(search_text, ?) > 0 ORDER BY position DESC')
    .all(query.trim().toLowerCase());
  return rows.map(row => JSON.parse(row.card));
}

export function findStory(db, id) {
  const row = db.prepare('SELECT story FROM published_stories WHERE id=?').get(id);
  return row ? JSON.parse(row.story) : null;
}
