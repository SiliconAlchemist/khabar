const maxBodyBytes = 32 * 1024;
export const maxDraftLength = 6000;
export const biasAnalysisVersion = 2;
const modelUrl = 'http://127.0.0.1:8080/v1/systemone';
const segmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' });
const wordSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
const decisions = {
  allegation: {
    instructions: 'Does the headline state an allegation as an established fact while the article or transcript attributes it to a source? Select inconclusive if there is no headline or too little context.',
    criteria: { yes: 'An attributed allegation appears as established fact', no: 'No such mismatch', inconclusive: 'Insufficient information' },
  },
  language: {
    instructions: "Decide if the headline or the narrator's own statements use emotionally charged, derogatory, or moralizing words to cast a person, group or policy in a positive or negative light. The headline is the publisher’s own wording unless clearly identified as a quotation. Wording explicitly attributed to a named or unnamed third party is that person’s wording. Factual descriptions and empirical findings alone are not emotionally loaded.",
    criteria: {
      author: 'The author uses charged or judgmental wording in their own narration or headline, even if some other charged wording is quoted',
      quoted: 'Only a quoted or explicitly attributed source uses charged wording',
      none: 'No clearly loaded wording appears',
      inconclusive: 'Too little evidence to tell who used the loaded wording',
    },
  },
  advocacy: {
    instructions: 'Is the publisher or narrator using its own wording to express a definite opinion or push for a position on a contested political topic, beyond describing the event or attributing the views of others?',
    criteria: {
      advocates: 'The writer is arguing for or against a political policy or value in their own voice',
      descriptive: 'The writer is describing events or reporting what another person says',
      uncertain: 'Insufficient context or unclear attribution',
    },
  },
  direction: {
    instructions: "Which substantive political view does the narrator argue FOR? Evaluate what the narrator argues to be desirable, independently of the viewpoint being criticized or attributed to someone else. Use only stated framing, including support or opposition clearly implied by the narrator's wording. Choose neither when the local political context prevents a clear left-right interpretation.",
    criteria: {
      reallocates_wealth: 'The narrator advocates reducing economic inequality, strengthening workers’ power, increasing public welfare, or expanding civil or migrant rights',
      emphasizes_order: 'The narrator advocates limiting redistribution, lower regulation, traditional social order, more restrictive immigration, or stronger border enforcement or deportation',
      both: 'The narrator makes clear arguments in both of these directions',
      neither: 'The narrator does not adopt either recognizable political position, or the context is insufficient',
    },
  },
};

const directions = { reallocates_wealth: 'left', emphasizes_order: 'right', both: 'mixed' };

function sourcePassages(draft) {
  const passages = {};
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

function hasConfidence(answer, minimum, margin) {
  const confidence = answer.probabilities?.[answer.choice];
  const alternatives = Object.entries(answer.probabilities ?? {})
    .filter(([choice]) => choice !== answer.choice)
    .map(([, probability]) => probability);
  return Number.isFinite(confidence) && confidence >= minimum && confidence - Math.max(0, ...alternatives) >= margin;
}

function evidenceExcerpt(passage) {
  if (!passage) return null;
  let remaining = 12;
  for (const { index, isWordLike } of wordSegmenter.segment(passage)) {
    if (isWordLike && remaining-- === 0) return passage.slice(0, index).trimEnd() + '…';
  }
  return passage;
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

export async function analyseDraft(headline, draft, { fetchImpl = fetch } = {}) {
  const model = 'd1-2B';
  const bodyPassages = sourcePassages(draft);
  const passages = headline ? { headline, ...bodyPassages } : bodyPassages;
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
    const result = await fetchImpl(modelUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: { headline, passages: bodyPassages }, questions }),
      redirect: 'error',
      signal: AbortSignal.timeout(60_000),
    });
    if (!result.ok) return { status: 502, body: { error: `The ${model} analyser returned HTTP ${result.status}.` } };
    const { answers } = await result.json();
    if (Object.entries(questions).some(([id, question]) => !Object.hasOwn(question.criteria, answers?.[id]?.choice))) {
      return { status: 502, body: { error: `The ${model} analyser returned an unexpected decision.` } };
    }
    const advocacy = hasConfidence(answers.advocacy, 0.6, 0.15) ? answers.advocacy.choice : 'uncertain';
    const direction = directions[answers.direction.choice];
    const directional = direction && hasConfidence(answers.direction, 0.55, 0.15);
    const framingEvidence = advocacy === 'advocates' && directional
      ? evidenceExcerpt(passages[answers.framingEvidence.choice]) : null;
    const language = hasConfidence(answers.language, 0.5, 0.12) ? answers.language.choice : 'inconclusive';
    const evidence = language === 'author' ? evidenceExcerpt(passages[answers.evidence.choice]) : null;
    return { status: 200, body: {
      label: framingEvidence ? direction : advocacy === 'descriptive' && !directional ? 'none' : 'inconclusive',
      model,
      biasVersion: biasAnalysisVersion,
      advocacy,
      framingEvidence,
      allegation: headline && hasConfidence(answers.allegation, 0.55, 0.12) ? answers.allegation.choice : 'inconclusive',
      language: language === 'author' && !evidence ? 'inconclusive' : language,
      evidence,
    } };
  } catch (error) {
    if (error.name === 'TimeoutError') return { status: 504, body: { error: `${model} analysis timed out.` } };
    return { status: 503, body: { error: 'Start the local d1-2B server on port 8080 and try again.' } };
  }
}
