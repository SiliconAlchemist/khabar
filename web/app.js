import { renderInvestigation } from './investigation.js';
import { mountAnalysis } from './source-analysis.js';
import { icon } from './icons.js';

const main = document.getElementById('main');
const dialog = document.getElementById('reader-dialog');
let stories = [];
const byId = new Map();
let navigation = 0;
let searchRequest = 0;
const storageKey = 'khabar.reader.v1';
const freshState = () => ({ saved: [], liked: [], comments: {}, history: [] });
function readState() {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey));
    return {
      saved: Array.isArray(stored?.saved) ? stored.saved : [],
      liked: Array.isArray(stored?.liked) ? stored.liked : [],
      comments: stored?.comments && typeof stored.comments === 'object' ? stored.comments : {},
      history: Array.isArray(stored?.history) ? stored.history : []
    };
  } catch { return freshState(); }
}
let state = readState();
let activeDesk = '';
let noticeTimer;
let currentRoute = '';
const failedPhotos = new Set();
function persist() {
  try { localStorage.setItem(storageKey, JSON.stringify(state)); }
  catch { announce('Browser storage is unavailable. Changes will last for this visit.'); return false; }
  return true;
}
function announce(message) {
  const notice = document.getElementById('notice');
  notice.textContent = message;
  notice.classList.add('visible');
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => notice.classList.remove('visible'), 2400);
}
function esc(value = '') {
  return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
}
function storyLink(story, view = 'post') {
  return '#story/' + encodeURIComponent(story.id) + '/' + view;
}
function external(url) {
  try { const parsed = new URL(url); return ['http:', 'https:'].includes(parsed.protocol) ? esc(parsed.href) : ''; }
  catch { return ''; }
}
function formattedDate(value, options = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!value) return '';
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleDateString('en-GB', { ...options, timeZone: 'UTC' }) : '';
}
function sectionLabel(story) {
  return esc(story.section || 'News');
}
function sectionLine(story) {
  return `<div class="story-meta"><span class="desk-name">${sectionLabel(story)}</span>${story.location ? `<span class="meta-sep"></span><span>${esc(story.location)}</span>` : ''}</div>`;
}
function selectedPhoto(story) {
  return story.photo?.url && !failedPhotos.has(story.id) ? story.photo : null;
}
function img(story, lazy = true) {
  const photo = selectedPhoto(story);
  return `<img src="${esc(photo?.url || story.image)}" alt="${esc(photo?.caption || story.caption || story.shortTitle || story.title)}" ${photo ? `data-photo-id="${esc(story.id)}"` : ''} ${lazy ? 'loading="lazy"' : 'fetchpriority="high"'} decoding="async">`;
}
function caption(story) {
  const photo = selectedPhoto(story);
  const source = external(photo?.sourceUrl), license = external(photo?.licenseUrl);
  const credit = esc(photo?.credit || story.credit);
  return [esc(photo?.caption || story.caption), source ? `<a href="${source}" target="_blank" rel="noopener noreferrer">${credit || 'Photo credit'}</a>` : credit,
    license ? `<a href="${license}" target="_blank" rel="noopener noreferrer">License</a>` : ''].filter(Boolean).join(' · ');
}
function navLink(href, label, selected, glyph = '') {
  return `<a href="#${href}" ${selected ? 'aria-current="page"' : ''}>${glyph ? icon(glyph) : ''}<span>${esc(label)}</span></a>`;
}
function renderHeader(route) {
  const home = ['front', 'watch', 'story'].includes(route);
  document.getElementById('masthead').innerHTML = `<div class="header-inner">
    <a href="#front" class="wordmark" aria-label="Khabar front page">khabar<span>.</span></a>
    <nav class="desktop-nav" aria-label="Main navigation">
      ${navLink('front', 'Front page', home)}${navLink('saved', 'Saved', route === 'saved')}${navLink('activity', 'Activity', route === 'activity')}
    </nav>
    <div class="header-tools"><a class="head-search" href="#search" aria-label="Search stories">${icon('search')}<span>Search</span><kbd>/</kbd></a>
    <button class="profile" type="button" data-act="profile" aria-label="Open reader menu">${icon('user')}</button></div></div>`;
  document.getElementById('mobile-nav').innerHTML = [
    navLink('front','Home',home,'home'), navLink('search','Search',route === 'search','search'),
    navLink('saved','Saved',route === 'saved','bookmark'), navLink('activity','Activity',route === 'activity','activity')
  ].join('');
}
function actionButton(action, glyph, label, id, pressed = null) {
  return `<button type="button" class="icon-btn" data-act="${action}" data-id="${esc(id)}" aria-label="${esc(label)}" title="${esc(label)}" ${pressed === null ? '' : `aria-pressed="${pressed}"`}>${icon(glyph)}</button>`;
}
function storyActions(story) {
  const saved = state.saved.includes(story.id), liked = state.liked.includes(story.id);
  return `<div class="story-actions" aria-label="Reader actions">
    ${actionButton('like','heart',liked ? 'Remove like' : 'Like story',story.id,liked)}
    ${actionButton('comment','comment','Open your notes',story.id)}
    ${actionButton('save','bookmark',saved ? 'Remove saved story' : 'Save story',story.id,saved)}
    ${actionButton('share','share','Share story link',story.id)}
  </div>`;
}
function investigationLinks(story) {
  return `<nav class="explore-links" aria-label="Explore this story">${[['timeline','Timeline'],['perspectives','Perspectives'],['sources','Sources']].map(([view,label]) => `<a href="${storyLink(story,view)}">${icon(view)}<span>${label}</span></a>`).join('')}</nav>`;
}
function byline(story) {
  return `<div class="byline"><span>Source · ${esc(story.publisher)}</span><i></i><time datetime="${esc(story.date)}">${formattedDate(story.date)}</time></div>`;
}
function videoPlayer(story) {
  if (!external(story.video?.url)) return null;
  const input = new URL(story.video.url);
  if (/\.(mp4|webm|ogv)$/i.test(input.pathname)) return { type: 'native', url: input.href };
  const host = input.hostname.replace(/^www\./,'');
  let id;
  if (host === 'youtu.be') id = input.pathname.slice(1);
  if (['youtube.com','m.youtube.com','youtube-nocookie.com'].includes(host)) {
    id = input.searchParams.get('v') || input.pathname.match(/^\/(?:embed|live|shorts)\/([^/]+)/)?.[1];
  }
  if (/^[\w-]{11}$/.test(id || '')) return {type:'youtube',url:'https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1'};
  return null;
}
function watchLink(story) {
  const url = external(story.video?.url);
  if (!url) return '';
  const label = esc(story.video.label || 'Watch the report');
  return videoPlayer(story)
    ? `<button type="button" class="watch-link" data-act="video" data-id="${esc(story.id)}">${icon('play')}${label}</button>`
    : `<a class="watch-link" href="${url}" target="_blank" rel="noopener noreferrer">${icon('play')}${label}${icon('external')}</a>`;
}
function openVideo(story) {
  const player = videoPlayer(story);
  if (!player) return;
  const embed = player.type === 'youtube'
    ? `<iframe class="video-player" title="${esc(story.video.label || story.title)}" src="${esc(player.url)}" allow="autoplay; encrypted-media; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`
    : `<video class="video-player" src="${esc(player.url)}" controls autoplay playsinline></video>`;
  openDialog(story.video.label || 'Watch the report',embed + `<a class="text-link" href="${external(story.video.url)}" target="_blank" rel="noopener noreferrer">Open original video ${icon('external')}</a>`);
}
function leadStory(story, mode) {
  return `<article class="lead-story">
    <div class="lead-image"><a href="${storyLink(story)}" aria-label="Read ${esc(story.title)}">${img(story,false)}</a>
      <span class="photo-label"><i></i>Lead story</span></div>
    <div class="lead-text">${sectionLine(story)}
      <h2><a href="${storyLink(story)}">${esc(story.title)}</a></h2>
      <p class="lead-summary">${esc(story.summary)}</p>
      ${byline(story)}
    </div>
    <div class="lead-tools">${mode === 'watch' ? watchLink(story) : investigationLinks(story)}${storyActions(story)}</div>
  </article>`;
}
function railStory(story, mode) {
  return `<article class="rail-story">
    <div>${sectionLine(story)}<h3><a href="${storyLink(story)}">${esc(story.shortTitle || story.title)}</a></h3>
    <div class="rail-byline">${esc(story.publisher)}</div>${mode === 'watch' ? watchLink(story) : ''}</div>
    <a class="rail-photo" href="${storyLink(story)}" tabindex="-1" aria-hidden="true">${img(story)}</a></article>`;
}
function leadPerspectives(story) {
  const themes = new Map();
  for (const entry of story.themes || []) {
    if (entry.label && !themes.has(entry.label)) themes.set(entry.label,entry.color);
  }
  if (themes.size < 2) return '';
  return `<a class="perspective-preview" href="${storyLink(story,'perspectives')}">
    <span class="preview-label">${icon('perspectives')} Perspectives on the lead</span>
    <span class="preview-branches">${[...themes].slice(0,3).map(([label,color],i) => `<span class="preview-branch variant-${i}" ${/^#(?:[a-f\d]{3}|[a-f\d]{6})$/i.test(color || '') ? `style="--branch:${color}"` : ''}>${esc(label)}</span>`).join('')}</span>
    </a>`;
}
function storyCard(story, mode) {
  return `<article class="story-card">
    <a class="card-photo" href="${storyLink(story)}" tabindex="-1" aria-hidden="true">${img(story)}</a>
    <div class="card-copy">${sectionLine(story)}<h3><a href="${storyLink(story)}">${esc(story.title)}</a></h3>
    <p>${esc(story.summary)}</p>${byline(story)}
    ${mode === 'watch' ? watchLink(story) : ''}${storyActions(story)}</div></article>`;
}
function modeTabs(watch) {
  return `<nav class="mode-tabs" aria-label="Story format">${navLink('front','Read',!watch,'read')}${navLink('watch','Watch',watch,'play')}</nav>`;
}
function emptyMessage(title, description, action = true) {
  return `<div class="empty-state"><h2>${esc(title)}</h2><p>${esc(description)}</p>${action ? '<a class="text-link" href="#front">Browse the front page</a>' : ''}</div>`;
}
function renderFeed(watch) {
  const eligible = watch ? stories.filter(story => external(story.video?.url)) : stories;
  const desks = [...new Set(eligible.map(story => story.section).filter(Boolean))];
  if (!desks.includes(activeDesk)) activeDesk = '';
  const filtered = activeDesk ? eligible.filter(story => story.section === activeDesk) : eligible;
  const [lead, ...rest] = filtered;
  const newest = eligible.map(story => story.date).filter(Boolean).sort().at(-1);
  const edition = newest ? formattedDate(newest, {weekday:'long',day:'numeric',month:'long',year:'numeric'}) : '';
  const asideStories = rest.slice(0,3);
  const more = rest.slice(3);
  main.innerHTML = `<section class="edition-head" aria-labelledby="edition-heading">
    <div><div class="edition-date"><span class="edition-rule"></span>${esc(edition)}</div>
      <h1 id="edition-heading">The <em>Front Page</em><span class="title-period">.</span></h1></div>
    ${modeTabs(watch)}</section>
    ${desks.length > 1 ? `<div class="desk-filter" role="group" aria-label="Filter by desk"><button type="button" data-desk="" aria-pressed="${!activeDesk}">All stories</button>${desks.map(desk => `<button type="button" data-desk="${esc(desk)}" aria-pressed="${activeDesk === desk}">${esc(desk)}</button>`).join('')}</div>` : ''}
    ${lead ? `<div class="front-grid ${!asideStories.length ? 'single-story' : ''}">
      ${leadStory(lead,watch ? 'watch':'read')}
      ${asideStories.length ? `<aside class="briefing"><div class="section-title"><h2>The Briefing</h2><span class="desk-rule"></span></div>${asideStories.map(story => railStory(story,watch ? 'watch':'read')).join('')}${leadPerspectives(lead)}</aside>` : ''}
    </div>` : emptyMessage('No video reports yet','The reading edition has the available briefings.')}
    ${more.length ? `<section class="more-section" aria-label="More coverage"><div class="section-title"><h2>More coverage</h2><span class="desk-rule"></span></div><div class="card-grid">${more.map(story => storyCard(story,watch ? 'watch':'read')).join('')}</div></section>` : ''}`;
}
function storyPage(story) {
  return `<article class="story-page">
    <a class="back-link" href="#front">${icon('back')}Front page</a>
    <header>${sectionLine(story)}<h1>${esc(story.title)}</h1><p class="story-summary">${esc(story.summary)}</p>${byline(story)}</header>
    <figure>${img(story,false)}<figcaption>${caption(story)}</figcaption></figure>
    <div class="story-tools">${investigationLinks(story)}${storyActions(story)}</div>
    <div class="article-body">${(story.body || []).map(line => `<p>${esc(line)}</p>`).join('')}
    <div class="reading-links">${watchLink(story)}${external(story.url) ? `<a class="text-link" href="${external(story.url)}" rel="noopener noreferrer" target="_blank">Open original reporting ${icon('external')}</a>` : ''}</div></div>
    </article>`;
}
function renderCollection(title, items, description, emptyTitle, emptyDescription) {
  main.innerHTML = `<section class="collection"><header class="collection-head"><h1>${title}<span class="title-period">.</span></h1><p>${esc(description)}</p></header>${items.length ? `<div class="card-grid">${items.map(story => storyCard(story,'read')).join('')}</div>` : emptyMessage(emptyTitle,emptyDescription)}</section>`;
}
function renderActivity() {
  const latest = state.history.map(item => ({ ...item, story: byId.get(item.id) })).filter(item => item.story);
  main.innerHTML = `<section class="collection"><header class="collection-head"><h1>Activity<span class="title-period">.</span></h1><p>Your reading history on this device.</p></header>${latest.length ? `<div class="activity-list">${latest.map(({story,at}) => `<article><span class="activity-icon">${icon('clock')}</span><div>${sectionLine(story)}<h2><a href="${storyLink(story)}">${esc(story.title)}</a></h2><small>Opened ${esc(formattedDate(at))}</small></div><a href="${storyLink(story)}" tabindex="-1" aria-hidden="true">${img(story)}</a></article>`).join('')}</div>` : emptyMessage('Your reading history starts here','Open a report to find it here again.')}</section>`;
}
function renderSearch(query) {
  main.innerHTML = `<section class="collection"><header class="collection-head"><h1>Search<span class="title-period">.</span></h1></header><div class="search-field">${icon('search')}<input id="story-search" type="search" aria-label="Search the newsroom" placeholder="Search stories, sources or topics" value="${esc(query)}"></div><div id="search-results"></div></section>`;
  showResults(query);
}
async function showResults(query) {
  const target = document.getElementById('search-results');
  const ticket = ++searchRequest;
  try {
    const matching = query.trim() ? (await fetchEdition('/api/feed?q=' + encodeURIComponent(query))).stories : stories;
    if (ticket !== searchRequest || !target.isConnected) return;
    for (const card of matching) byId.set(card.id, card);
    target.innerHTML = `<p class="search-count" role="status">${matching.length} ${matching.length === 1 ? 'story' : 'stories'}</p>${matching.length ? `<div class="card-grid">${matching.map(story => storyCard(story,'read')).join('')}</div>` : emptyMessage('No matching stories','Try another topic, place or publisher.',false)}`;
  } catch {
    if (ticket === searchRequest && target.isConnected) target.innerHTML = retryMessage();
  }
}
function recordOpen(story) {
  if (state.history[0]?.id === story.id) return;
  state.history = [{id: story.id,at: new Date().toISOString()}, ...state.history.filter(item => item.id !== story.id)].slice(0,100);
  persist();
}
function footer() {
  return '<footer class="edition-footer"><a class="footer-brand" href="#front">khabar<span>.</span></a><a href="#analyze">Analyze a source</a></footer>';
}
async function fetchEdition(path) {
  const response = await fetch(path);
  if (!response.ok) throw Object.assign(new Error('Edition request failed'), { status: response.status });
  return response.json();
}
function retryMessage() {
  return '<div class="empty-state" role="status"><h2>Couldn’t load the edition</h2><button type="button" class="text-link" data-act="retry">Try again</button></div>';
}
async function navigate(moveFocus = false) {
  const ticket = ++navigation;
  const [route, slug] = location.hash.slice(1).split('?')[0].split('/');
  if (dialog.open) dialog.close();
  renderHeader(route || 'front');
  main.setAttribute('aria-busy', 'true');
  main.innerHTML = '<p role="status">Loading…</p>';
  try {
    if (route === 'story' && slug) {
      const story = await fetchEdition('/api/stories/' + slug);
      if (ticket !== navigation) return;
      byId.set(story.id, story);
    } else if (['', 'front', 'watch', 'search', 'saved', 'activity'].includes(route)) {
      const edition = await fetchEdition('/api/feed');
      if (ticket !== navigation) return;
      stories = edition.stories;
      byId.clear();
      for (const card of stories) byId.set(card.id, card);
    }
    if (ticket === navigation) render(moveFocus);
  } catch (error) {
    if (ticket !== navigation) return;
    main.innerHTML = error.status === 404 && route === 'story'
      ? emptyMessage('Story unavailable','Browse the current edition to find a report.') : retryMessage();
    document.title = 'Khabar';
  } finally {
    if (ticket === navigation) main.removeAttribute('aria-busy');
  }
}
function render(moveFocus = false) {
  if (dialog.open) dialog.close();
  const hash = location.hash.slice(1);
  const [path, search = ''] = hash.split('?');
  const [route = 'front', id, view = 'post'] = (path || 'front').split('/');
  currentRoute = route;
  renderHeader(route);
  let title;
  switch (route) {
    case 'front': case 'watch':
      renderFeed(route === 'watch'); title = route === 'watch' ? 'Watch' : 'The Front Page'; break;
    case 'saved':
      renderCollection('Saved', state.saved.map(id => byId.get(id)).filter(Boolean),'Your reading list on this device.','Your reading list is empty','Use the bookmark on a story to save it here.'); title = 'Saved'; break;
    case 'activity': renderActivity(); title = 'Activity'; break;
    case 'search': renderSearch(new URLSearchParams(search).get('q') || ''); title = 'Search'; break;
    case 'analyze': main.innerHTML = ''; mountAnalysis(main); title = 'Analyze a source'; break;
    case 'story': {
      let story;
      try { story = byId.get(decodeURIComponent(id)); } catch { /* malformed link */ }
      if (!story || !['post','timeline','perspectives','sources'].includes(view)) {
        main.innerHTML = emptyMessage('Story unavailable','Browse the current edition to find a report.'); title = 'Story unavailable'; break;
      }
      recordOpen(story);
      main.innerHTML = view === 'post' ? storyPage(story) : renderInvestigation(story,view);
      title = story.shortTitle || story.title; break;
    }
    default: main.innerHTML = emptyMessage('Page unavailable','Browse the current edition to continue.'); title = 'Page unavailable';
  }
  main.insertAdjacentHTML('beforeend', footer());
  document.title = title + ' · Khabar';
  if (moveFocus) {
    window.scrollTo(0,0);
    if (route === 'search') document.getElementById('story-search')?.focus({preventScroll:true});
    else main.focus({preventScroll:true});
  }
}
function openDialog(title, contents) {
  dialog.innerHTML = `<div class="dialog-head"><h2 id="dialog-title">${esc(title)}</h2><button class="icon-btn" type="button" data-act="close" aria-label="Close dialog">${icon('close')}</button></div>${contents}`;
  if (!dialog.open) dialog.showModal();
}
function openNotes(story) {
  const notes = Array.isArray(state.comments[story.id]) ? state.comments[story.id] : [];
  openDialog('Your notes', `<p class="dialog-story">${esc(story.shortTitle || story.title)}</p><div class="notes-list">${notes.map(note => `<article><p>${esc(note.text)}</p><small>${esc(formattedDate(note.at))}</small></article>`).join('')}</div><form id="note-form" data-id="${esc(story.id)}"><label for="new-note">Add a private note</label><textarea id="new-note" name="note" rows="3" maxlength="2000" required></textarea><p class="storage-hint">Saved on this device.</p><button class="primary-btn">Save note</button></form>`);
}
function toggleStory(action, story) {
  const key = action === 'save' ? 'saved' : 'liked';
  const adding = !state[key].includes(story.id);
  state[key] = adding ? [story.id, ...state[key]] : state[key].filter(id => id !== story.id);
  const stored = persist();
  if (currentRoute === 'saved' && action === 'save') render();
  else {
    for (const button of document.querySelectorAll(`button[data-act="${action}"]`)) {
      if (button.dataset.id !== story.id) continue;
      const label = action === 'save' ? (adding ? 'Remove saved story' : 'Save story') : (adding ? 'Remove like' : 'Like story');
      button.setAttribute('aria-pressed', String(adding)); button.setAttribute('aria-label',label); button.title = label;
    }
  }
  if (stored) announce(action === 'save' ? (adding ? 'Story saved' : 'Story removed from saved') : (adding ? 'Story liked' : 'Like removed'));
}
async function shareStory(story) {
  const url = new URL(storyLink(story), location.href).href;
  try {
    if (navigator.share) { await navigator.share({title: story.title,url}); return; }
    await navigator.clipboard.writeText(url);
    announce('Story link copied');
  } catch (error) {
    if (error.name === 'AbortError') return;
    openDialog('Share story', `<label for="share-url">Story link</label><input id="share-url" readonly value="${esc(url)}">`);
    dialog.querySelector('input')?.select();
  }
}
document.addEventListener('click', event => {
  const skip = event.target.closest('.skip-link');
  if (skip) { event.preventDefault(); main.focus(); return; }
  const deskButton = event.target.closest('[data-desk]');
  if (deskButton) {
    activeDesk = deskButton.dataset.desk;
    render();
    [...main.querySelectorAll('[data-desk]')].find(item => item.dataset.desk === activeDesk)?.focus({preventScroll:true}); return;
  }
  const button = event.target.closest('button[data-act]');
  if (!button) { if (event.target === dialog) dialog.close(); return; }
  const story = byId.get(button.dataset.id);
  switch (button.dataset.act) {
    case 'retry': navigate(true); break;
    case 'profile': openDialog('Reader menu', `<div class="reader-menu">${navLink('saved','Saved stories',false,'bookmark')}${navLink('activity','Reading history',false,'activity')}${navLink('analyze','Analyze a source',false,'sources')}</div>`); break;
    case 'close': dialog.close(); break;
    case 'comment': if (story) openNotes(story); break;
    case 'video': if (story) openVideo(story); break;
    case 'like': case 'save': if (story) toggleStory(button.dataset.act,story); break;
    case 'share': if (story) shareStory(story); break;
  }
});
document.addEventListener('error', event => {
  const image = event.target;
  const story = byId.get(image.dataset?.photoId);
  if (!story) return;
  failedPhotos.add(story.id);
  for (const instance of document.querySelectorAll('img[data-photo-id]')) {
    if (instance.dataset.photoId !== story.id) continue;
    delete instance.dataset.photoId;
    instance.src = story.image;
    instance.alt = story.caption || story.title;
    const credit = instance.closest('figure')?.querySelector('figcaption');
    if (credit) credit.innerHTML = caption(story);
  }
},true);
dialog.addEventListener('close', () => {
  if (!dialog.open) dialog.replaceChildren();
});
dialog.addEventListener('click', event => { if (event.target.closest('a[href^="#"]')) dialog.close(); });
document.addEventListener('submit', event => {
  if (event.target.id !== 'note-form') return;
  event.preventDefault();
  const story = byId.get(event.target.dataset.id);
  const input = event.target.elements.note;
  const text = input.value.trim();
  if (!story || !text) { input.focus(); return; }
  state.comments[story.id] = [...(state.comments[story.id] || []), {text,at:new Date().toISOString()}];
  const stored = persist(); openNotes(story);
  if (stored) announce('Note saved');
  dialog.querySelector('textarea')?.focus();
});
document.addEventListener('input', event => {
  if (event.target.id !== 'story-search') return;
  const query = event.target.value;
  history.replaceState(null,'','#search' + (query ? '?q=' + encodeURIComponent(query) : ''));
  showResults(query);
});
document.addEventListener('keydown', event => {
  if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || event.target.closest('input, textarea, [contenteditable="true"]') || dialog.open) return;
  event.preventDefault();
  if (currentRoute === 'search') document.getElementById('story-search')?.focus();
  else location.hash = 'search';
});
window.addEventListener('hashchange', () => navigate(true));
window.addEventListener('storage', event => { if (event.key === storageKey) { state = readState(); if (!dialog.open) navigate(); } });
navigate();
