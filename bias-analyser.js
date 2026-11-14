const maxBodyBytes = 32 * 1024;
export const maxDraftLength = 6000;
const modelUrl = 'http://127.0.0.1:8080/v1/systemone';
const segmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' });
const decisions = {
  allegation: {
    instructions: 'Does the headline state an allegation as an established fact while the article or transcript attributes it to a source? Select inconclusive if there is no headline or too little context.',
    criteria: { yes: 'An attributed allegation appears as established fact', no: 'No such mismatch', inconclusive: 'Insufficient information' },
  },
  language: {
    instructions: "Where does the clearest loaded or judgmental wording appear? Distinguish the journalist's own voice from attributed speech. Use inconclusive if attribution is unclear.",
    criteria: { author: "Journalist's own wording", quoted: 'Attributed to another speaker', none: 'No clear example', inconclusive: 'Insufficient information' },
  },
  framing: {
    instructions: "Assess the author's own political framing in its local context. A quote, criticism of an official, or support for a party alone cannot establish a left or right lean. Select inconclusive if the context is missing or a left-right axis fits poorly. Select none when there is enough text and no clear lean.",
    criteria: { left: 'Clear left-leaning framing', right: 'Clear right-leaning framing', mixed: 'Clear framing in both directions', none: 'No clear political lean', inconclusive: 'Insufficient evidence or unsuitable axis' },
  },
};

function sourcePassages(headline, draft) {
  const passages = headline ? { headline } : {};
  let start = 0;
  let count = 0;
  for (const { index } of segmenter.segment(draft)) {
    if (index - start < 400) continue;
    passages[`passage_${++count}`] = draft.slice(start, index).trim();
    start = index;
  }
  passages[`passage_${++count}`] = draft.slice(start).trim();
  return passages;
}

export function sendJson(response, status, result) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  }).end(JSON.stringify(result));
}

export function isLocalAnalysisRequest(request, port) {
  const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
  const loopbackAddresses = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
  const { host, origin } = request.headers;
  return loopbackAddresses.includes(request.socket.remoteAddress) && allowedHosts.includes(host) && (!origin || origin === `http://${host}`);
}

export async function handleBiasAnalysis(request, response, port) {
  const send = sendJson;
  if (!isLocalAnalysisRequest(request, port)) {
    return send(response, 403, { error: 'Open Khabar on this computer to run local analysis.' });
  }
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    return send(response, 415, { error: 'Expected JSON.' });
  }

  let input;
  try {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of request.iterator({ destroyOnReturn: false })) {
      bytes += chunk.length;
      if (bytes > maxBodyBytes) {
        request.resume();
        return send(response, 413, { error: 'The draft is too large for this trial.' });
      }
      chunks.push(chunk);
    }
    input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return send(response, 400, { error: 'Could not read the draft.' });
  }
  const { headline = '', draft = '' } = input ?? {};
  if (typeof headline !== 'string' || headline.length > 300 || typeof draft !== 'string' || !draft.trim() || draft.length > maxDraftLength) {
    return send(response, 400, { error: 'Enter up to 6,000 characters of article text or transcript and an optional headline up to 300 characters.' });
  }

  const result = await analyseDraft(headline.trim(), draft.trim());
  return send(response, result.status, result.body);
}

export async function analyseDraft(headline, draft) {
  const passages = sourcePassages(headline, draft);
  const evidenceCriteria = Object.fromEntries(Object.keys(passages).map(id => [id, `The source passage numbered ${id}`]));
  evidenceCriteria.none = 'No source passage clearly supports the finding';
  const questions = {
    ...Object.fromEntries(Object.entries(decisions).map(([id, question]) => [id, { type: 'choice', ...question }])),
    evidence: {
      type: 'choice',
      instructions: "Select the source passage with the clearest example of loaded or judgmental wording in the journalist's own voice. Select none if there is no clear example.",
      criteria: evidenceCriteria,
    },
    framingEvidence: {
      type: 'choice',
      instructions: "Select the strongest passage supporting an ideological reading of the author's own framing. Select none if the passage only quotes others or does not support an ideological reading.",
      criteria: evidenceCriteria,
    },
  };

  try {
    const result = await fetch(modelUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: { passages }, questions }),
      redirect: 'error',
      signal: AbortSignal.timeout(60_000),
    });
    if (!result.ok) return { status: 502, body: { error: `The local analyser returned HTTP ${result.status}. Check the llama.cpp terminal.` } };
    const { answers } = await result.json();
    const allegation = answers?.allegation?.choice;
    const language = answers?.language?.choice;
    const evidence = answers?.evidence?.choice;
    const framing = answers?.framing?.choice;
    const framingEvidence = answers?.framingEvidence?.choice;
    if (!Object.hasOwn(decisions.allegation.criteria, allegation) || !Object.hasOwn(decisions.language.criteria, language) || !Object.hasOwn(decisions.framing.criteria, framing) || !Object.hasOwn(evidenceCriteria, evidence) || !Object.hasOwn(evidenceCriteria, framingEvidence)) {
      return { status: 502, body: { error: 'The local analyser returned an unexpected decision.' } };
    }
    const directional = ['left', 'right', 'mixed'].includes(framing);
    const quote = directional && framingEvidence !== 'none' ? passages[framingEvidence] : null;
    return { status: 200, body: {
      label: directional && !quote ? 'inconclusive' : framing,
      framingEvidence: quote,
      allegation: headline ? allegation : 'inconclusive',
      language,
      evidence: language === 'author' && evidence !== 'none' ? passages[evidence] : null,
    } };
  } catch (error) {
    if (error.name === 'TimeoutError') return { status: 504, body: { error: 'Local analysis timed out. Try a shorter excerpt.' } };
    return { status: 503, body: { error: 'Start the local d1-2B server on port 8080 and try again.' } };
  }
}
