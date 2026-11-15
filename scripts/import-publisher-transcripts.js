import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { videoLanguage } from '../feed-language.js';
import { openVideoStore } from '../video-store.js';
import { acquirePublisherTranscript, publisherTranscriptSources } from './publisher-transcripts.js';

async function main() {
  const { values } = parseArgs({ options: {
    id: { type: 'string', multiple: true }, publish: { type: 'boolean' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('Usage: node scripts/import-publisher-transcripts.js [--id VIDEO_ID] [--publish]');
    console.log('Verify and import creator-published transcripts. New videos enter the review queue unless --publish is provided.');
    return;
  }
  const ids = new Set(values.id ?? publisherTranscriptSources.keys());
  for (const id of ids) {
    if (!publisherTranscriptSources.has(id)) throw new Error('No configured publisher transcript for ' + id + '.');
  }
  const store = openVideoStore();
  try {
    for (const id of ids) {
      try {
        const video = publisherTranscriptSources.get(id);
        const existing = store.transcript(id);
        const source = 'publisher-transcript:' + video.sourceUrl;
        let transcript;
        if (store.transcriptInput(id)?.source !== source || !existing?.trim()) {
          const acquired = await acquirePublisherTranscript(id);
          if (!existing?.trim()) transcript = acquired;
          else if (existing.replace(/\s+/gu, ' ').trim() === acquired.text.replace(/\s+/gu, ' ').trim()) {
            transcript = { ...acquired, text: existing, fingerprint: createHash('sha256').update(existing).digest('hex') };
          } else console.log(id + ': retained a different existing transcript.');
        }
        if (videoLanguage(video, transcript?.text ?? existing) !== video.language) {
          throw new Error('Stored transcript does not match the expected language.');
        }
        if (!store.importVideo(id, { metadata: video, transcript, format: values.publish ? 'full' : undefined })) {
          throw new Error('Could not import the publisher transcript.');
        }
        console.log(id + ': ' + (transcript ? 'saved publisher transcript' : 'transcript already available')
          + (values.publish ? ' and eligible for Watch.' : '.'));
      } catch (error) {
        console.error(id + ': ' + error.message);
        process.exitCode = 1;
      }
    }
  } finally {
    store.close();
  }
}

try {
  await main();
} catch (error) {
  console.error('Publisher transcripts: ' + error.message);
  process.exitCode = 1;
}
