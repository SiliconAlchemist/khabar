const storageKey = 'khabar:bias-reviews';
const standaloneId = 'standalone';

const labels = {
  left: 'Left-leaning',
  right: 'Right-leaning',
  mixed: 'Mixed framing',
  none: 'No clear leaning',
  insufficient: 'Insufficient evidence',
};

const localAnalysisMessages = {
  allegation: {
    yes: 'The headline may present an attributed allegation as fact.',
    no: 'The model found no clear allegation presented as fact in the headline.',
    inconclusive: 'The model could not assess whether the headline presents an allegation as fact.',
  },
  language: {
    author: 'The model flagged wording in the journalist’s own voice.',
    quoted: 'The model attributed the strongest wording to a quoted speaker.',
    none: 'The model found no clear example of loaded wording.',
    inconclusive: 'The model could not determine who used the wording.',
  },
};

const rubric = [
  {
    id: 'framing',
    title: 'Framing',
    prompt: 'How does the segment define the problem, assign responsibility, or present possible solutions?',
  },
  {
    id: 'voices',
    title: 'Voices and evidence',
    prompt: 'Whose claims does the segment foreground, challenge, or leave without a response?',
  },
  {
    id: 'language',
    title: 'Language and context',
    prompt: 'Which words, comparisons, or historical context shape how the viewer reads the issue?',
  },
];

function normalizeExcerpt(text) {
  return text.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function evaluateBias({ transcript, politicalContext, signals }) {
  const normalized = normalizeExcerpt(transcript);
  const insufficient = reason => ({ code: 'insufficient', reason });
  if (!normalized) return insufficient('Add a transcript or excerpt to assess.');

  const matched = [];
  for (const signal of signals) {
    if (!['left', 'right', 'none'].includes(signal.direction)) continue;
    const quote = normalizeExcerpt(signal.excerpt);
    if (!quote || !normalized.includes(quote)) {
      return insufficient('Each rated observation needs an excerpt that appears in the transcript.');
    }
    matched.push({ quote, direction: signal.direction });
  }

  const independent = new Set(matched.map(item => item.quote));
  if (independent.size < 2) return insufficient('Add two distinct excerpts across the rubric.');
  const left = new Set(matched.filter(item => item.direction === 'left').map(item => item.quote));
  const right = new Set(matched.filter(item => item.direction === 'right').map(item => item.quote));
  if ((left.size || right.size) && !politicalContext.trim()) {
    return insufficient('Add the political context before suggesting a directional label.');
  }
  if (left.size && right.size) {
    if (new Set([...left, ...right]).size < 2) {
      return insufficient('Cite a different excerpt for each direction to suggest mixed framing.');
    }
    return { code: 'mixed', reason: 'The cited observations identify framing in both directions.' };
  }
  if (left.size >= 2) return { code: 'left', reason: 'Two or more distinct excerpts were rated as left-leaning.' };
  if (right.size >= 2) return { code: 'right', reason: 'Two or more distinct excerpts were rated as right-leaning.' };
  if (left.size || right.size) return insufficient('Only one distinct excerpt supports a directional finding.');
  return { code: 'none', reason: 'Two or more excerpts were assessed without a clear direction.' };
}

function readReviews() {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey));
    if (!Array.isArray(value)) return [];
    return value.filter(review => review && typeof review.videoId === 'string' && Object.hasOwn(labels, review.label));
  } catch {
    return [];
  }
}

function writeReviews(reviews) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(reviews));
    return true;
  } catch {
    return false;
  }
}

export function readBiasLabel(videoId) {
  const review = readReviews().find(item => item.videoId === videoId);
  return review ? labels[review.label] : null;
}

function observationFields() {
  return rubric.map(({ id, title, prompt }) => `
    <fieldset class="bias-observation">
      <legend>${title}</legend>
      <p>${prompt}</p>
      <div class="bias-observation-fields">
        <label for="bias-direction-${id}">Framing direction
          <select id="bias-direction-${id}" name="${id}-direction">
            <option value="">Not assessed</option>
            <option value="left">Left-leaning</option>
            <option value="right">Right-leaning</option>
            <option value="none">No clear direction</option>
          </select>
        </label>
        <label for="bias-excerpt-${id}">Exact excerpt
          <textarea id="bias-excerpt-${id}" name="${id}-excerpt" rows="2" maxlength="700"></textarea>
        </label>
      </div>
    </fieldset>`).join('');
}

export function mountBiasReview(container, { videos = [], videoId } = {}) {
  container.innerHTML = `
    <div class="bias-review">
      <div class="page-intro">
        <h1>Bias review</h1>
        <p>Review how a segment frames an issue and record the evidence for your label.</p>
      </div>
      <div class="bias-review-picker">
        <label for="bias-video">Segment</label>
        <select id="bias-video"></select>
        <a class="story-link" data-bias-video-link hidden>Open video</a>
      </div>
      <form class="bias-form">
        <label for="bias-headline">Headline (optional)</label>
        <input id="bias-headline" name="headline" type="text" maxlength="300">
        <label for="bias-transcript">Article text or transcript</label>
        <textarea id="bias-transcript" name="transcript" rows="7" maxlength="50000" placeholder="Paste the part you want to review"></textarea>
        <div class="bias-actions">
          <button type="button" class="outline-button" data-bias-analyse>Analyse with d1-2B</button>
        </div>
        <div class="bias-result" data-bias-analysis role="status" hidden></div>
        <label for="bias-context">Political context</label>
        <input id="bias-context" name="politicalContext" type="text" maxlength="300" placeholder="For example, Delhi politics and air-quality regulation">
        <p class="bias-guidance">Assess the segment’s own narration, selection, and treatment. Attribute quoted views to the speaker. Cite two distinct excerpts for a suggested label.</p>
        <div class="bias-observations">${observationFields()}</div>
        <button type="button" class="outline-button" data-bias-check>Suggest label</button>
        <p class="bias-result" data-bias-result role="status" hidden></p>
        <div class="bias-decision">
          <label for="bias-label">Editorial label</label>
          <select id="bias-label" name="label">
            <option value="">Choose a label</option>
            ${Object.entries(labels).map(([code, label]) => `<option value="${code}">${label}</option>`).join('')}
          </select>
          <label for="bias-rationale">Why this label?</label>
          <textarea id="bias-rationale" name="rationale" rows="3" maxlength="1800" placeholder="Explain the framing you observed and what evidence might change your view"></textarea>
          <div class="bias-actions">
            <button class="primary-button" type="submit">Save review</button>
            <button class="outline-button" type="button" data-bias-remove hidden>Remove saved review</button>
          </div>
          <p class="bias-guidance">Reviews are stored in this browser. The rubric uses your evidence ratings and leaves the final decision to you.</p>
          <p class="status" data-bias-status role="status"></p>
        </div>
      </form>
    </div>`;

  const picker = container.querySelector('#bias-video');
  const videoLink = container.querySelector('[data-bias-video-link]');
  const form = container.querySelector('.bias-form');
  const result = form.querySelector('[data-bias-result]');
  const analyse = form.querySelector('[data-bias-analyse]');
  const analysis = form.querySelector('[data-bias-analysis]');
  const status = form.querySelector('[data-bias-status]');
  const remove = form.querySelector('[data-bias-remove]');
  const fields = form.elements;
  const drafts = new Map();
  let pendingAnalysis;

  for (const video of [...videos, { id: standaloneId, title: 'Standalone segment' }]) {
    const option = document.createElement('option');
    option.value = video.id;
    option.textContent = video.publisher ? `${video.title} · ${video.publisher}` : video.title;
    picker.append(option);
  }

  function getDraft() {
    return {
      headline: fields.headline.value.trim(),
      transcript: fields.transcript.value.trim(),
      politicalContext: fields.politicalContext.value.trim(),
      signals: rubric.map(({ id }) => ({
        id,
        direction: fields.namedItem(`${id}-direction`).value,
        excerpt: fields.namedItem(`${id}-excerpt`).value.trim(),
      })),
      label: fields.label.value,
      rationale: fields.rationale.value.trim(),
    };
  }

  function showReview(id) {
    const review = readReviews().find(item => item.videoId === id);
    const draft = drafts.get(id) ?? review;
    form.reset();
    fields.headline.value = draft?.headline ?? videos.find(video => video.id === id)?.title ?? '';
    fields.transcript.value = draft?.transcript ?? '';
    fields.politicalContext.value = draft?.politicalContext ?? '';
    fields.label.value = draft?.label ?? '';
    fields.rationale.value = draft?.rationale ?? '';
    const signals = Array.isArray(draft?.signals) ? draft.signals : [];
    for (const { id } of rubric) {
      const signal = signals.find(item => item?.id === id);
      fields.namedItem(`${id}-direction`).value = signal?.direction ?? '';
      fields.namedItem(`${id}-excerpt`).value = signal?.excerpt ?? '';
    }
    result.hidden = true;
    resetAnalysis();
    status.textContent = review ? `Saved label · ${labels[review.label]}` : '';
    remove.hidden = !review;
    videoLink.hidden = id === standaloneId;
    if (!videoLink.hidden) videoLink.href = `#watch/${encodeURIComponent(id)}`;
  }

  let selectedId = videos.some(video => video.id === videoId) ? videoId : videos[0]?.id ?? standaloneId;
  picker.value = selectedId;
  showReview(selectedId);

  picker.addEventListener('change', () => {
    drafts.set(selectedId, getDraft());
    selectedId = picker.value;
    showReview(selectedId);
  });

  function resetAnalysis() {
    pendingAnalysis?.abort();
    pendingAnalysis = undefined;
    analyse.disabled = false;
    analysis.hidden = true;
  }

  form.addEventListener('input', event => {
    result.hidden = true;
    if (event.target === fields.headline || event.target === fields.transcript) resetAnalysis();
  });

  analyse.addEventListener('click', async () => {
    const { headline, transcript } = getDraft();
    analysis.hidden = false;
    if (!transcript || transcript.length > 6000) {
      analysis.textContent = 'Enter up to 6,000 characters of article text or transcript for this trial.';
      return;
    }

    const controller = new AbortController();
    pendingAnalysis = controller;
    analyse.disabled = true;
    analysis.textContent = 'Analysing this draft on your computer…';
    try {
      const response = await fetch('/api/bias-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headline, draft: transcript }),
        signal: controller.signal,
      });
      const contentType = response.headers.get('content-type');
      if (!contentType?.startsWith('application/json')) throw new Error('Open the local Khabar server to use d1-2B.');
      const findings = await response.json();
      if (!response.ok) throw new Error(findings.error);
      if (controller.signal.aborted) return;
      analysis.textContent = `${localAnalysisMessages.allegation[findings.allegation]} ${localAnalysisMessages.language[findings.language]}`;
      if (findings.evidence) {
        const quote = document.createElement('blockquote');
        quote.textContent = findings.evidence;
        analysis.append(quote);
      }
    } catch (error) {
      if (!controller.signal.aborted) analysis.textContent = error.message;
    } finally {
      if (pendingAnalysis === controller) {
        pendingAnalysis = undefined;
        analyse.disabled = false;
      }
    }
  });
  form.querySelector('[data-bias-check]').addEventListener('click', () => {
    const assessment = evaluateBias(getDraft());
    result.textContent = `Suggested label · ${labels[assessment.code]}. ${assessment.reason}`;
    result.hidden = false;
    if (!fields.label.value) fields.label.value = assessment.code;
  });

  form.addEventListener('submit', event => {
    event.preventDefault();
    const draft = getDraft();
    if (!Object.hasOwn(labels, draft.label)) {
      status.textContent = 'Choose an editorial label.';
      fields.label.focus();
      return;
    }
    if (!draft.rationale) {
      status.textContent = 'Explain why you chose this label.';
      fields.rationale.focus();
      return;
    }
    const assessment = evaluateBias(draft);
    if (draft.label !== 'insufficient' && assessment.code === 'insufficient') {
      status.textContent = assessment.reason;
      return;
    }
    const reviews = readReviews().filter(item => item.videoId !== selectedId);
    reviews.push({ ...draft, videoId: selectedId });
    if (!writeReviews(reviews)) {
      status.textContent = 'This browser could not save the review.';
      return;
    }
    drafts.delete(selectedId);
    remove.hidden = false;
    status.textContent = `Saved label · ${labels[draft.label]}`;
  });

  remove.addEventListener('click', () => {
    const reviews = readReviews().filter(item => item.videoId !== selectedId);
    if (!writeReviews(reviews)) {
      status.textContent = 'This browser could not remove the review.';
      return;
    }
    remove.hidden = true;
    status.textContent = 'Saved review removed. You can edit or save this draft again.';
    fields.label.focus();
  });
}
