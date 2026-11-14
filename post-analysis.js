import { createHash } from 'node:crypto';
import { analyseDraft, maxDraftLength } from './bias-analyser.js';
import { stories } from './public/stories.js';
import { videos } from './public/videos.js';

export function analysisSource(kind, post, transcript = '') {
  const text = kind === 'story'
    ? [post.summary, post.context, post.question].filter(Boolean).join('\n\n')
    : transcript.trim();
  const headline = post.title.trim().slice(0, 300);
  const draft = text.slice(0, maxDraftLength).trimEnd();
  const truncated = draft.length < text.length;
  const sourceHash = createHash('sha256').update(JSON.stringify([post.title, text])).digest('hex');
  return { key: `${kind}/${post.id}`, headline, draft, truncated, sourceHash };
}

export function postSources(store) {
  const transcripts = store.transcripts();
  const published = new Map(videos.map(video => [video.id, video]));
  for (const video of store.published()) published.set(video.id, video);

  const sources = stories.map(story => analysisSource('story', story));
  for (const video of published.values()) {
    sources.push(analysisSource('video', video, transcripts.get(video.id)));
  }
  return new Map(sources.map(source => [source.key, source]));
}

export function publicAnalysis(source, saved) {
  if (!source.draft) return { status: 'needs-transcript' };
  if (!saved) return { status: 'pending' };
  return { status: 'complete', ...saved };
}

export async function runPostAnalysis(store, source) {
  const startedAt = Date.now();
  const result = await analyseDraft(source.headline, source.draft);
  if (result.status !== 200) return result;

  const findings = { ...result.body, truncated: source.truncated };
  store.saveAnalysis(source.key, source.sourceHash, findings, startedAt);
  return { status: 200, body: publicAnalysis(source, store.analysis(source.key, source.sourceHash)) };
}
