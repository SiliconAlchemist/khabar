import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { videoLanguage } from '../feed-language.js';

const runFile = promisify(execFile);
const reader = fileURLToPath(new URL('./fetch-publisher-transcript.py', import.meta.url));
const practicalEngineering = 'https://practical.engineering/blog/';
const primeMinistersOffice = 'https://www.pmindia.gov.in/hi/news_updates/';
export const publisherTranscriptSources = new Map([
  ['UF63eFJmbrQ', 'This Spillway Failed On Purpose', 'Practical Engineering', 'en', '2026-04-07', practicalEngineering + '2026/4/7/this-spillway-failed-on-purpose'],
  ['3YvwqMDDb3k', 'Why Roads Get Washboards', 'Practical Engineering', 'en', '2026-06-02', practicalEngineering + '2026/6/2/why-roads-get-washboards'],
  ['JsRiC6vGb1E', 'Windows Are Absurd', 'Practical Engineering', 'en', '2026-11-03', practicalEngineering + '2026/11/3/windows-are-absurd'],
  ['awV7FP9sAHE', 'Whatever Happened to Fire Escapes?', 'Practical Engineering', 'en', '2026-10-20', practicalEngineering + '2026/10/20/whatever-happened-to-fire-escapes'],
  ['DWLcmq_DiaA', 'Fixing the Most Dangerous Dam in the World', 'Practical Engineering', 'en', '2026-05-19', practicalEngineering + '2026/5/19/fixing-the-most-dangerous-dam-in-the-world'],
  ['lfS_dKUzHr4', 'जनजातीय गौरव दिवस पर प्रधानमंत्री का संबोधन', 'Prime Minister’s Office, India', 'hi', '2026-11-15', primeMinistersOffice + 'वीडियो-कॉन्फ्रेंसिंग-के-57/'],
  ['buGXXGJL368', 'मैसूर में तारामंडल के उद्घाटन पर प्रधानमंत्री का संबोधन', 'Prime Minister’s Office, India', 'hi', '2026-11-13', primeMinistersOffice + 'कर्नाटक-के-मैसूर-में-कॉसम/'],
  ['XMB3vFD2BzY', 'एशियाई पैरा गेम्स चैंपियनों से प्रधानमंत्री की बातचीत', 'Prime Minister’s Office, India', 'hi', '2026-11-05', primeMinistersOffice + 'भारत-के-एशियाई-पैरा-गेम्स/'],
].map(([id, title, publisher, language, date, sourceUrl]) => [
  id, { id, title, publisher, language, sourcePublishedAt: new Date(date).toISOString(),
    durationSeconds: 0, sourceUrl: new URL(sourceUrl).href },
]));

export async function acquirePublisherTranscript(id) {
  const video = publisherTranscriptSources.get(id);
  if (!video) return null;
  const { sourceUrl, language } = video;
  const python = process.env.KHABAR_RSS_PYTHON || 'python';
  let output;
  try {
    output = await runFile(python, [reader, id, sourceUrl], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
  } catch (error) {
    throw new Error(error.stderr?.trim() || 'Could not fetch transcript from the publisher.');
  }
  const text = JSON.parse(output.stdout);
  if (typeof text !== 'string' || !text.trim() || videoLanguage(video, text) !== language) {
    throw new Error('Publisher transcript did not match the expected language.');
  }
  return { text, source: 'publisher-transcript:' + sourceUrl, fingerprint: createHash('sha256').update(text).digest('hex') };
}
