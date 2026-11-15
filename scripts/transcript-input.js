import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const runFile = promisify(execFile);
const whisperScript = fileURLToPath(new URL('./transcribe-video.py', import.meta.url));
const whisperCache = fileURLToPath(new URL('../data/local-ai/whisper-models/', import.meta.url));
const cueTiming = /^((?:\d{2,}:)?\d{2}:\d{2}[.,]\d{3})\s+-->\s+((?:\d{2,}:)?\d{2}:\d{2}[.,]\d{3})(?:\s|$)/;

function normalizeTimestamp(value) {
  const time = value.replace(',', '.');
  return time.split(':').length === 2 ? '00:' + time : time;
}

function captionText(raw) {
  const cues = [];
  for (const block of raw.split(/\n[ \t]*\n/)) {
    if (/^(?:WEBVTT|NOTE|STYLE|REGION)(?:\s|$)/.test(block.trimStart())) continue;
    const lines = block.split('\n');
    const index = lines.findIndex(line => cueTiming.test(line.trim()));
    if (index < 0) continue;
    const [, start, end] = lines[index].trim().match(cueTiming);
    const text = lines.slice(index + 1).join(' ').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    if (text) cues.push('[' + normalizeTimestamp(start) + ' --> ' + normalizeTimestamp(end) + '] ' + text);
  }
  return cues.join('\n');
}

async function transcribeMedia(file) {
  const python = process.env.KHABAR_WHISPER_PYTHON || 'python';
  console.log('Transcribing with local Whisper.');
  try {
    const { stdout } = await runFile(python, [whisperScript, '--cache-dir', whisperCache, '--', file], {
      maxBuffer: 8 * 1024 * 1024,
    });
    return stdout.trim();
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('Python is unavailable. Set KHABAR_WHISPER_PYTHON to the Whisper environment.');
    throw new Error(error.stderr?.trim() || 'Whisper failed: ' + error.message);
  }
}

export async function prepareTranscript(transcriptFile, mediaFile, previous) {
  if (transcriptFile === undefined && mediaFile === undefined) return null;
  if (transcriptFile !== undefined && mediaFile !== undefined) throw new Error('Supply one transcript file or one media file.');
  const input = transcriptFile ?? mediaFile;
  if (typeof input !== 'string' || !input.trim()) throw new Error('Supply a local file path for the transcript or media.');
  const file = resolve(input);
  const info = await stat(file);
  if (!info.isFile()) throw new Error('Supply a local file for the transcript or media.');
  const hash = createHash('sha256');
  if (mediaFile !== undefined) {
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    const fingerprint = hash.digest('hex');
    if (previous?.source === 'whisper' && previous.fingerprint === fingerprint) return null;
    const text = await transcribeMedia(file);
    if (!text) throw new Error('Whisper did not detect any speech in the media file.');
    return { text, source: 'whisper', fingerprint };
  }

  if (info.size > 8 * 1024 * 1024) throw new Error('Transcript files must be 8 MB or smaller.');
  const extension = extname(file).toLowerCase();
  const raw = (await readFile(file, 'utf8')).replace(/\r\n?/g, '\n').trim();
  const text = ['.srt', '.vtt'].includes(extension) ? captionText(raw) : raw;
  if (!text) throw new Error('The transcript file contains no usable text.');
  const fingerprint = hash.update(text).digest('hex');
  if (previous?.source === 'supplied' && previous.fingerprint === fingerprint) return null;
  return { text, source: 'supplied', fingerprint };
}
