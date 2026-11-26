const draft = { url: '', language: 'en', text: '' };
let busy = false;
let result = null;
let notice = '';
let failed = false;
let activePanel;

async function request(path, options) {
  const response = await fetch(path, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'The request could not be completed.');
  return body;
}

function showState() {
  if (!activePanel?.isConnected) return;
  const panel = activePanel;
  const status = panel.querySelector('[role="status"]');
  status.textContent = notice;
  status.classList.toggle('error', failed);
  panel.querySelector('fieldset').disabled = busy;
  panel.querySelector('button').textContent = busy ? 'Reading source…' : 'Extract claims';
  const output = panel.querySelector('.analysis-output');
  output.replaceChildren();
  output.hidden = !result;
  if (!result) return;
  function add(tag, value) {
    const element = document.createElement(tag);
    element.textContent = value;
    output.append(element);
  }
  add('h2', 'Source summary');
  add('p', result.summary);
  add('h3', 'Claims to check');
  for (const { quote } of result.claims) add('blockquote', quote);
  if (!result.claims.length) add('p', 'The model found no checkable claims in this passage.');
  add('small', 'Extracted by ' + result.model);
}

export function mountAnalysis(container) {
  container.innerHTML = `<section class="source-analysis" aria-labelledby="analysis-title">
    <header><h1 id="analysis-title">Analyze a source<span>.</span></h1>
    <p>Paste an article or transcript to extract a summary and the exact passages worth checking against independent evidence.</p></header>
    <form><fieldset>
      <div class="analysis-fields"><label>Source URL<input name="url" type="url" required placeholder="https://" autocomplete="url"></label>
      <label>Language<select name="language"><option value="en">English</option><option value="hi">Hindi</option></select></label></div>
      <label>Article text or transcript<textarea name="text" rows="9" required placeholder="Paste the passage you want to examine…"></textarea></label>
      <p class="analysis-hint">The passage is saved to this Khabar instance and sent to its configured analysis model.</p>
      <button type="submit">Extract claims</button>
    </fieldset></form>
    <p class="analysis-status" role="status"></p><div class="analysis-output" hidden></div>
  </section>`;
  activePanel = container.querySelector('.source-analysis');
  const form = activePanel.querySelector('form');
  for (const [key, value] of Object.entries(draft)) form.elements[key].value = value;
  form.addEventListener('input', () => {
    for (const key of Object.keys(draft)) draft[key] = form.elements[key].value;
    if (result || notice) {
      result = null;
      notice = '';
      failed = false;
      showState();
    }
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    const input = Object.fromEntries(new FormData(form));
    Object.assign(draft, input);
    busy = true;
    result = null;
    failed = false;
    notice = 'Extracting a summary and candidate claims…';
    showState();
    try {
      const { id } = await request('/posts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input)
      });
      result = await request('/posts/' + encodeURIComponent(id) + '/analyze', { method: 'POST' });
      notice = 'Analysis complete.';
    } catch (error) {
      failed = true;
      notice = error.message;
    } finally {
      busy = false;
      showState();
    }
  });
  showState();
}
