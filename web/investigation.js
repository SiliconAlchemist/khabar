const views = {
  timeline: ['Timeline', 'clock'],
  perspectives: ['Perspectives', 'branches'],
  sources: ['Source material', 'folder']
};

const paths = {
  back: '<path d="m14 6-6 6 6 6"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 6.5v5.7l3.5 2"/>',
  branches: '<circle cx="5.5" cy="12" r="2.5"/><circle cx="18" cy="5.5" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="m8 11 7.7-4.3M8 13l7.7 4.3"/>',
  folder: '<path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>',
  document: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h4M9 12h6M9 16h6"/>',
  video: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/>',
  link: '<path d="M13.5 4H20v6.5M20 4l-9 9M10 5H5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-5"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  chevron: '<path d="m8 10 4 4 4-4"/>'
};

const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => entities[char]);
const icon = name => `<svg class="ix-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
const storyLink = (story, view) => `#story/${encodeURIComponent(story.id)}/${view}`;

function sourceLink(value, label) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return `<a class="ix-original" href="${escape(url.href)}" target="_blank" rel="noopener noreferrer">${escape(label)} ${icon('link')}</a>`;
  } catch {
    return '';
  }
}

const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
function displayDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) return escape(value);
  return `<time datetime="${escape(date.toISOString().slice(0, 10))}">${escape(dateFormat.format(date))}</time>`;
}

function picker(attribute, label, options) {
  return `<label class="ix-picker"><span class="ix-sr">${escape(label)}</span><select ${attribute}>${options.map(([value, text]) =>
    `<option value="${escape(value)}">${escape(text)}</option>`).join('')}</select>${icon('chevron')}</label>`;
}

function timeline(story) {
  const events = [...(story.timeline || [])].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  if (!events.length) return '<p class="ix-empty">Dated reporting will appear here as this story develops.</p>';
  return `<div class="ix-tools"><span class="ix-count">${events.length} ${events.length === 1 ? 'event' : 'events'}</span>
    ${picker('data-ix-order', 'Timeline order', [['asc', 'Oldest first'], ['desc', 'Newest first']])}</div>
    <ol class="ix-timeline" aria-label="Story events">${events.map((event, i) => `
      <li class="ix-event" data-ix-index="${i}">
        <div class="ix-date">${displayDate(event.date)}</div>
        <details class="ix-event-card"${i === 0 ? ' open' : ''}>
          <summary>${event.image ? `<img class="ix-event-preview" src="${escape(event.image)}" alt="" loading="lazy">` : ''}<span>${escape(event.title)}</span>${icon('chevron')}</summary>
          <div class="ix-card-body"><p>${escape(event.detail)}</p>${sourceLink(event.url, 'Event source')}</div>
        </details>
      </li>`).join('')}</ol>`;
}

const colors = ['#83B8E0', '#F58177', '#D9B76B', '#8BC7A4', '#BEA6DF'];
function groupColor(value, index) {
  if (typeof value === 'string' && /^#(?:[a-f\d]{3}|[a-f\d]{6})$/i.test(value)) return value;
  return colors[index % colors.length];
}

function perspectives(story) {
  const groups = new Map();
  for (const view of story.perspectives || []) {
    const label = view.label || 'Reporting';
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(view);
  }
  if (!groups.size) return '<p class="ix-empty">Additional reporting angles will appear here as coverage grows.</p>';
  const count = groups.size === 1 ? '1 reporting angle' : `${groups.size} reporting angles`;
  return `<div class="ix-tools"><span class="ix-count">${count}</span><span class="ix-hint">Select a report to explore</span></div>
    <div class="ix-map" role="group" aria-label="Map of reporting angles">
      <div class="ix-root"><span>${escape(story.shortTitle || story.title)}</span></div>
      <ul class="ix-clusters">${[...groups.entries()].map(([label, entries], i) => `
        <li class="ix-cluster" style="--ix-theme:${groupColor(entries[0].color, i)}">
          <h2 class="ix-label"><i aria-hidden="true"></i>${escape(label)}</h2>
          <div class="ix-reports">${entries.map(entry => `<details class="ix-report">
            <summary><span class="ix-report-publisher">${escape(entry.publisher)}</span>
              <span class="ix-report-title">${escape(entry.headline)}</span>${icon('plus')}</summary>
            <div class="ix-card-body"><p>${escape(entry.detail)}</p>${sourceLink(entry.url, 'Read the source')}</div>
          </details>`).join('')}</div>
        </li>`).join('')}</ul>
    </div>`;
}

function sources(story) {
  const items = story.sources || [];
  if (!items.length) return '<p class="ix-empty">Original materials will appear here when they are available.</p>';
  const kinds = [...new Set(items.map(item => item.kind || 'Document'))];
  const select = kinds.length > 1 ? picker('data-ix-kind', 'Filter source material by type', [['', 'All types'], ...kinds.map(k => [k, k])]) : '';
  return `<div class="ix-tools"><span class="ix-count" aria-live="polite" data-ix-count>${items.length} ${items.length === 1 ? 'source' : 'sources'}</span>${select}</div>
    <ul class="ix-library">${items.map(item => {
      const kind = item.kind || 'Document';
      return `<li class="ix-source" data-ix-source-kind="${escape(kind)}"><span class="ix-source-icon">${icon(/video|footage|film/i.test(kind) ? 'video' : 'document')}</span>
        <div><span class="ix-kind">${escape(kind)}</span><h2>${escape(item.title)}</h2>
          <div class="ix-source-publisher">${escape(item.publisher)}</div><p>${escape(item.detail)}</p>
          ${sourceLink(item.url, 'Open original')}</div></li>`;
    }).join('')}</ul>`;
}

export function renderInvestigation(story, view) {
  if (!Object.hasOwn(views, view)) return '';
  const body = { timeline, perspectives, sources }[view];
  return `<section class="ix" aria-labelledby="ix-title">
    <div class="ix-heading"><a href="${storyLink(story, 'post')}" class="ix-back">${icon('back')} Back to story</a>
      <h1 id="ix-title">${views[view][0]}</h1><p class="ix-subtitle">${escape(story.title)}</p></div>
    <nav class="ix-tabs" aria-label="Story investigation">${Object.entries(views).map(([key, [label, glyph]]) =>
      `<a href="${storyLink(story, key)}"${key === view ? ' aria-current="page"' : ''}>${icon(glyph)}${label}</a>`).join('')}</nav>
    ${body(story)}</section>`;
}

if (typeof document !== 'undefined') document.addEventListener('change', event => {
  const control = event.target;
  const section = control.closest?.('.ix');
  if (!section) return;
  if (control.matches('[data-ix-order]')) {
    const list = section.querySelector('.ix-timeline');
    const direction = control.value === 'desc' ? -1 : 1;
    const events = [...list.children].sort((a, b) => direction * (Number(a.dataset.ixIndex) - Number(b.dataset.ixIndex)));
    list.append(...events);
  } else if (control.matches('[data-ix-kind]')) {
    let count = 0;
    for (const item of section.querySelectorAll('[data-ix-source-kind]')) {
      item.hidden = Boolean(control.value) && control.value !== item.dataset.ixSourceKind;
      if (!item.hidden) count++;
    }
    section.querySelector('[data-ix-count]').textContent = `${count} ${count === 1 ? 'source' : 'sources'}`;
  }
});
