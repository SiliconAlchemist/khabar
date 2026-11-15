import { francAll } from 'franc-min';

const unknownTags = new Set(['und', 'mul', 'mis', 'unknown']);
const supportedCodes = new Map([['eng', 'en'], ['hin', 'hi']]);
const romanizedHindiWords = new Set(
  'aap agar aise apne aur baat bahut bhi chahiye ek hai hain hum iska iske jab jaise ka kaha kar kare ke ki kya lekar log mein mera nahi nahin par raha rahe rahi se tha the thi unke unko wala yah yeh'.split(' '),
);

export function languageTag(value) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const language = value.trim().toLowerCase().split(/[-_]/)[0];
  if (unknownTags.has(language)) return undefined;
  if (['en', 'hi'].includes(language)) return language;
  return supportedCodes.get(language) ?? null;
}

function cleanText(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\[\d{2,}:\d{2}:\d{2}[^\]\r\n]*\]\s*/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function classifySample(sample) {
  if (sample.length < 20) return undefined;
  const [best, next] = francAll(sample);
  if (!best || best[0] === 'und') return undefined;
  // Scores are relative, so a close runner-up leaves the language unresolved.
  return { code: best[0], confident: !next || best[1] - next[1] >= 0.035 };
}

function classifyText(value) {
  const text = cleanText(value);
  if (text.length <= 700) {
    const result = classifySample(text);
    return result?.confident ? supportedCodes.get(result.code) ?? null : undefined;
  }
  const middle = Math.floor(text.length / 2);
  const samples = [text.slice(0, 400), text.slice(middle - 200, middle + 200), text.slice(-400)];
  const results = samples.map(classifySample);
  if (results[0] && results.every(result => result?.code === results[0].code)) {
    return supportedCodes.get(results[0].code) ?? null;
  }
  const decisions = results.filter(result => result?.confident).map(result => supportedCodes.get(result.code) ?? null);
  const supported = decisions.filter(Boolean);
  if (!decisions.length) return undefined;
  if (supported.length <= decisions.length / 2) return null;
  return supported.filter(language => language === 'hi').length > supported.length / 2 ? 'hi' : 'en';
}

function classifyBilingualText(text) {
  const latin = text.match(/\p{Script=Latin}+/gu)?.join(' ') ?? '';
  const devanagari = text.match(/\p{Script=Devanagari}+/gu)?.join(' ') ?? '';
  if (latin.length >= 20 && devanagari.length >= 20
    && classifyText(latin) === 'en' && classifyText(devanagari) === 'hi') {
    return latin.length >= devanagari.length ? 'en' : 'hi';
  }
}

export function articleLanguage(article, body = '') {
  const declared = languageTag(article.language);
  if (declared === null) return null;
  const cleanedBody = cleanText(body);
  if (cleanedBody.length >= 120) {
    const identified = classifyText(cleanedBody);
    if (identified !== undefined) return identified;
  }
  return declared ?? classifyText([article.title, cleanedBody, article.summary].filter(Boolean).join(' ')) ?? null;
}

export function videoLanguage(video, transcript = '') {
  const declared = languageTag(video.language);
  if (declared === null) return null;
  const text = cleanText(transcript);
  const identified = classifyText(text);
  if (identified) return identified;
  const mixed = classifyBilingualText(text);
  if (mixed) return mixed;
  if (identified === null) {
    const words = new Set(text.toLowerCase().match(/\b[a-z]+\b/g) ?? []);
    const markers = [...words].filter(word => romanizedHindiWords.has(word)).length;
    if (declared === 'hi' && markers >= 5) return 'hi';
    return null;
  }
  return declared ?? null;
}
