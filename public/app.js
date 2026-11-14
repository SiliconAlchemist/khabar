import { stories } from './stories.js';
import { videos as seedVideos, youtubeIdFromUrl, youtubeUrl } from './videos.js';
import { createPlaybackController } from './playback.js';
import { mountBiasReview, readBiasLabel } from './bias.js';

const [videos, postAnalyses] = await Promise.all([loadVideos(), loadPostAnalyses()]);
const main = document.querySelector('main');
const playback = createPlaybackController(main);
const topicNames = ['All', ...new Set(stories.map(story => story.topic))];
const videoDate = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' });
const paths = {
  play: '<path d="m9 6 10 6-10 6z" fill="currentColor" stroke="none"/>',
  watch: '<circle cx="12" cy="12" r="9"/><path d="m10 8 6 4-6 4z" fill="currentColor" stroke="none"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-2 7-2 9h16c0-2-2-2-2-9M10 21h4"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  fact: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h3m-3 6h3m3-4 2 2 3-4"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  feed: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10"/>',
  bookmark: '<path d="M6 5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16l-6-4-6 4z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  back: '<path d="M20 12H5m6 6-6-6 6-6"/>',
  external: '<path d="M13 5h6v6m0-6-9 9m7-1v6H5V7h6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  share: '<path d="M12 15V3m-4 4 4-4 4 4M5 12v8h14v-8"/>',
  file: '<path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6m-6 4h6"/>',
  scale: '<path d="M12 3v18M7 21h10M3 7h18M3 7l-2 6h4L3 7m18 0-2 6h4l-2-6"/>',
};

function icon(name) {
  return `<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}

async function loadVideos() {
  try {
    const endpoint = new URL('./api/videos', import.meta.url);
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(2500) });
    if (!response.ok) return seedVideos;
    const published = await response.json();
    if (!Array.isArray(published)) return seedVideos;

    const seeds = new Map(seedVideos.map(video => [video.id, video]));
    const catalog = [];
    for (const video of published) {
      if (!video || !/^[A-Za-z0-9_-]{11}$/.test(video.id) || typeof video.title !== 'string'
        || !['shorts', 'full'].includes(video.format)) continue;
      const seed = seeds.get(video.id);
      seeds.delete(video.id);
      catalog.push({ ...seed, ...video, storyId: video.storyId ?? seed?.storyId });
    }
    return [...catalog, ...seeds.values()];
  } catch {
    return seedVideos;
  }
}

async function loadPostAnalyses() {
  try {
    const response = await fetch(new URL('./api/post-analyses', import.meta.url), { signal: AbortSignal.timeout(2500) });
    if (response.ok) return await response.json();
  } catch {
    // Static builds can still show the existing editorial review.
  }
  return {};
}

function escapeHtml(value) {
  const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(value).replace(/[&<>"']/g, character => entities[character]);
}

const analysisLabels = {
  left: 'Leans left', right: 'Leans right', mixed: 'Mixed framing',
  none: 'No clear lean detected', inconclusive: 'Inconclusive',
};

function analysisLabel(result) {
  if (result.status === 'needs-transcript') return 'Transcript needed';
  if (result.status === 'pending') return 'Analysis pending';
  return analysisLabels[result.label] ?? 'Inconclusive';
}

function analysisNotes(result) {
  if (result.status === 'needs-transcript') return '<p>Analysis will start when a transcript is available.</p>';
  if (result.status === 'pending') return '<p>Khabar will analyse the source text in the background.</p>';
  return `<p>Automated assessment by d1-2B${result.truncated ? ' · First 6,000 characters' : ''}</p>
    ${result.framingEvidence ? `<blockquote>${escapeHtml(result.framingEvidence)}</blockquote>` : ''}
    ${result.allegation === 'yes' ? '<p>The headline may present an attributed allegation as fact.</p>' : ''}
    ${result.language === 'author' ? '<p>The model flagged loaded wording in the author’s voice.</p>' : ''}
    ${result.evidence && result.evidence !== result.framingEvidence ? `<blockquote>${escapeHtml(result.evidence)}</blockquote>` : ''}`;
}

function postAnalysis(key) {
  const result = postAnalyses[key];
  if (!result) return '';
  return `<details class="post-analysis" data-post-analysis="${escapeHtml(key)}">
    <summary>${analysisLabel(result)}</summary>
    <div data-analysis-notes>${analysisNotes(result)}</div>
    ${result.status === 'needs-transcript' ? '' : '<button class="outline-button" type="button" data-refresh-analysis>Refresh analysis</button>'}
    <p class="status" role="status"></p>
  </details>`;
}

function updatePostAnalysis(panel, result) {
  panel.querySelector('summary').textContent = analysisLabel(result);
  panel.querySelector('[data-analysis-notes]').innerHTML = analysisNotes(result);
}

async function pollPendingAnalyses() {
  if (!Object.values(postAnalyses).some(result => result.status === 'pending')) return;
  const latest = await loadPostAnalyses();
  for (const [key, previous] of Object.entries(postAnalyses)) {
    const result = latest[key];
    if (previous.status !== 'pending' || result?.status !== 'complete') continue;
    postAnalyses[key] = { ...postAnalyses[key], ...result };
    updateAnalysisDisplays(key, result);
  }
  setTimeout(pollPendingAnalyses, 5000);
}

for (const placeholder of document.querySelectorAll('[data-icon]')) {
  placeholder.innerHTML = icon(placeholder.dataset.icon);
}

function readStorage(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function writeStorage(key, values) {
  try {
    localStorage.setItem(key, JSON.stringify(values));
    return true;
  } catch {
    return false;
  }
}

const savedKey = 'khabar:saved';
const submissionKey = 'khabar:submissions';
const saved = new Set(readStorage(savedKey));
const followingKey = 'khabar:following';
const following = new Set(readStorage(followingKey));
const sheetTitles = { fact: 'Fact-Check', sources: 'Sources', label: 'Why this label?' };
const factVerdicts = { supported: 'Supported', contradicted: 'Contradicted', 'needs-context': 'Needs context', unverified: 'Unverified' };
const submissions = readStorage(submissionKey);
let activeTopic = 'All';

function storyUrl(story, video) {
  return `#story/${story.id}${video ? `?from=${video.id}` : ''}`;
}

function videoUrl(video) {
  return `#watch/${video.id}`;
}

function contextVideo(hash) {
  const [storyRoute, query] = hash.slice(1).split('?');
  if (!storyRoute.startsWith('story/')) return undefined;
  const from = new URLSearchParams(query).get('from');
  return videos.find(video => video.id === from && storyRoute === `story/${video.storyId}`);
}

function videoKey(video) {
  return 'video/' + video.id;
}

function storyKey(story) {
  return 'story/' + story.id;
}

function publisherLine(publisher, metadata, key) {
  return `<header class="post-header">
    <div><strong>${escapeHtml(publisher)}</strong>${metadata ? `<span>${metadata}</span>` : ''}</div>
    <button class="icon-button post-menu" type="button" data-sheet="menu" data-key="${key}" aria-label="Post options">${icon('more')}</button>
  </header>`;
}

function biasStrip(key) {
  const result = postAnalyses[key];
  return `<div class="bias-strip">
    <span class="bias-badge" data-bias-key="${key}" data-lean="${result?.status === 'complete' ? escapeHtml(result.label) : ''}">${result ? analysisLabel(result) : 'Unrated'}</span>
    <span>AI-estimated bias</span>
    <button type="button" data-sheet="label" data-key="${key}">Why this label?</button>
  </div>`;
}

function updateAnalysisDisplays(key, result) {
  for (const panel of main.querySelectorAll(`[data-post-analysis="${CSS.escape(key)}"]`)) updatePostAnalysis(panel, result);
  for (const badge of main.querySelectorAll(`[data-bias-key="${CSS.escape(key)}"]`)) {
    badge.textContent = analysisLabel(result);
    badge.dataset.lean = result.status === 'complete' ? result.label : '';
  }
}

function followButton(key) {
  return `<button class="post-action" type="button" data-follow="${key}" aria-pressed="${following.has(key)}">${following.has(key) ? icon('check') + ' Following' : icon('plus') + ' Follow'}</button>`;
}

function cardActions(key) {
  return `<div class="post-actions">
    <button class="post-action fact-action" type="button" data-sheet="fact" data-key="${key}">${icon('fact')} Fact-Check</button>
    <button class="post-action" type="button" data-sheet="sources" data-key="${key}">${icon('external')} View Source</button>
    ${followButton(key)}
  </div>`;
}

function durationLabel(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const minutes = Math.floor(seconds / 60);
  const remainder = String(seconds % 60).padStart(2, '0');
  return minutes >= 60
    ? Math.floor(minutes / 60) + ':' + String(minutes % 60).padStart(2, '0') + ':' + remainder
    : minutes + ':' + remainder;
}

function videoCard(video, autoplay = false) {
  const story = stories.find(item => item.id === video.storyId);
  const key = videoKey(video);
  const title = escapeHtml(video.title);
  const sourceDate = Date.parse(video.sourcePublishedAt);
  const date = Number.isFinite(sourceDate) ? videoDate.format(sourceDate) : '';
  const duration = durationLabel(video.durationSeconds);
  return `<article class="video-card${video.format === 'shorts' ? ' video-card-portrait' : ''}" id="video-${video.id}" tabindex="-1">
    ${publisherLine(video.publisher || 'YouTube', [story?.topic, date].filter(Boolean).map(escapeHtml).join(' · '), key)}
    <div class="video-frame">
      <button class="video-preview" type="button" data-play="${video.id}"${autoplay ? ' data-autoplay' : ''} aria-label="Play ${title}">
        <img class="video-thumb" src="https://i.ytimg.com/vi/${video.id}/hqdefault.jpg" alt="" loading="lazy">
        <span class="video-play">${icon('play')}</span>
        ${duration ? `<span class="video-duration">${duration}</span>` : ''}
      </button>
    </div>
    ${biasStrip(key)}
    <h2>${title}</h2>
    ${video.summary ? `<p class="post-summary">${escapeHtml(video.summary)}</p>` : ''}
    ${cardActions(key)}
    ${story ? `<a class="story-link compare-link" href="${storyUrl(story, video)}">${icon('feed')} Read this story <span>Compare coverage ${icon('arrow')}</span></a>` : ''}
  </article>`;
}

function watchPage(format) {
  const list = videos.filter(video => video.format === format);
  main.innerHTML = `<div class="watch-heading">
      <h1>Watch</h1>
      <nav class="watch-formats" aria-label="Video format">
        <a href="#watch"${format === 'shorts' ? ' aria-current="page"' : ''}>Shorts</a>
        <a href="#watch/full"${format === 'full' ? ' aria-current="page"' : ''}>Full videos</a>
      </nav>
    </div>
    <section class="video-list" aria-label="${format === 'shorts' ? 'YouTube Shorts' : 'Full videos'}">
      ${list.map(video => videoCard(video, true)).join('')}
    </section>
    <p class="caught-up">${icon('check')} You're caught up.</p>`;
}

function bookmark(story) {
  const pressed = saved.has(story.id);
  return `<button class="icon-button bookmark" type="button" data-save="${story.id}" aria-label="Save ${escapeHtml(story.title)}" aria-pressed="${pressed}">${icon('bookmark')}</button>`;
}

function card(story, lead = false) {
  const key = storyKey(story);
  return `<article class="story-card${lead ? ' lead-card' : ''}">
    ${publisherLine('Khabar', escapeHtml(story.topic), key)}
    ${lead ? `<div class="lead-art">
      <img src="${escapeHtml(story.image.url)}" alt="${escapeHtml(story.image.alt)}" width="910" height="509">
    </div>` : ''}
    ${lead ? biasStrip(key) : ''}
    <h2><a href="${storyUrl(story)}">${escapeHtml(story.title)}</a></h2>
    ${lead ? '' : biasStrip(key)}
    <p class="post-summary">${escapeHtml(story.summary)}</p>
    ${cardActions(key)}
  </article>`;
}

function renderStoryList(container, list) {
  container.innerHTML = list.map((story, index) => card(story, index === 0 && Boolean(story.image))).join('');
  const leadImage = container.querySelector('.lead-art img');
  if (leadImage?.complete && !leadImage.naturalWidth) leadImage.parentElement.hidden = true;
}

function feed(onlyFollowing = false) {
  main.innerHTML = `<nav class="feed-tabs" aria-label="Read feed">
    <a href="#feed"${onlyFollowing ? '' : ' aria-current="page"'}>For you</a>
    <a href="#feed/following"${onlyFollowing ? ' aria-current="page"' : ''}>Following</a>
  </nav>
  ${onlyFollowing ? '' : `<div class="topic-bar" role="group" aria-label="Filter by topic">
    ${topicNames.map(topic => `<button type="button" data-topic="${escapeHtml(topic)}" aria-pressed="${topic === activeTopic}">${topic === 'All' ? 'All stories' : escapeHtml(topic)}</button>`).join('')}
  </div>`}
  <section class="story-list" aria-label="Stories"></section>
  <p class="note feed-note">AI estimates can be wrong. Always review the sources.</p>`;
  if (!onlyFollowing) updateFeed();
  else {
    const list = stories.filter(story => following.has(storyKey(story)));
    if (list.length) renderStoryList(main.querySelector('.story-list'), list);
    else main.querySelector('.story-list').innerHTML = '<p class="empty">Stories you follow will appear here.</p>';
  }
}

function updateFeed() {
  const list = activeTopic === 'All' ? stories : stories.filter(story => story.topic === activeTopic);
  renderStoryList(main.querySelector('.story-list'), list);
}

function storyPage(story, fromVideo) {
  const relatedVideos = videos.filter(video => video.storyId === story.id);
  main.innerHTML = `<article class="story-page">
    <a class="back-link" href="${fromVideo ? videoUrl(fromVideo) : '#feed'}">${icon('back')} ${fromVideo ? 'Back to video' : 'Back to stories'}</a>
    <div class="page-intro">
      <p class="eyebrow">Delhi NCR <span>·</span> ${story.topic}</p>
      <h1>${story.title}</h1>
      <p>${story.summary}</p>
    </div>
    <div class="story-actions">
      ${bookmark(story)}
      <button class="outline-button" type="button" data-sheet="fact" data-key="${storyKey(story)}">${icon('fact')} Fact-Check</button>
      <button class="outline-button" type="button" data-share="${story.id}">${icon('share')} Share story</button>
    </div>
    <p id="story-status" class="status" role="status"></p>
    ${postAnalysis(`story/${story.id}`)}
    ${relatedVideos.map(video => `<a class="story-link related-video" href="${videoUrl(video)}">${icon('play')} Watch ${escapeHtml(video.publisher ?? 'related video')}</a>`).join('')}
    <div class="context">
      <h2>What to know</h2>
      <p>${story.context}</p>
      <h2>What to look into</h2>
      <p>${story.question}</p>
    </div>
    <section class="sources" aria-labelledby="source-heading">
      <h2 id="source-heading">Sources</h2>
      ${sourceList(story.sources)}
    </section>
    ${story.image ? `<p class="credit">Archive photo by <a href="${story.image.page}">${story.image.credit}</a> (<a href="${story.image.license}">CC BY-SA 4.0</a>), cropped in the feed.</p>` : ''}
  </article>`;
}

function collectionPage(title, store, emptyMessage) {
  const storyList = stories.filter(story => store.has(story.id) || store.has(storyKey(story)));
  const videoList = videos.filter(video => store.has(videoKey(video)));
  main.innerHTML = `<div class="page-intro"><h1>${title}</h1></div>
    ${storyList.length ? `<section class="story-list" aria-label="${title} stories">${storyList.map(story => card(story)).join('')}</section>` : ''}
    ${videoList.length ? `<section class="video-list" aria-label="${title} videos">${videoList.map(video => videoCard(video)).join('')}</section>` : ''}
    ${storyList.length || videoList.length ? '' : `<div class="empty"><p>${emptyMessage}</p><a href="#feed">Browse stories</a></div>`}`;
}

function discoverPage() {
  main.innerHTML = `<div class="page-intro"><h1>Discover</h1></div>
    <label class="discover-label" for="discover-query">Search stories and videos</label>
    <input type="search" id="discover-query" class="discover-input" autocomplete="off">
    <div class="discover-results"></div>`;
  updateDiscovery('');
}

function updateDiscovery(query) {
  const matches = (...fields) => query.toLowerCase().trim().split(/\s+/)
    .every(word => fields.filter(Boolean).join(' ').toLowerCase().includes(word));
  const storyMatches = stories.filter(story => matches(story.title, story.topic, story.summary));
  const videoMatches = videos.filter(video => matches(video.title, video.publisher, video.summary));
  const results = main.querySelector('.discover-results');
  results.innerHTML = `${storyMatches.length ? `<section class="story-list" aria-label="Matching stories">${storyMatches.map(story => card(story)).join('')}</section>` : ''}
    ${videoMatches.length ? `<section class="discover-videos" aria-label="Matching videos">
      ${videoMatches.map(video => `<a class="story-link compare-link" href="${videoUrl(video)}">${icon('watch')} ${escapeHtml(video.title)}</a>`).join('')}
    </section>` : ''}
    ${storyMatches.length || videoMatches.length ? '' : '<p class="empty">No matching stories or videos.</p>'}`;
}

function openStorySheet(key, sheet, trigger) {
  const [kind, id] = key.split('/');
  const video = kind === 'video' ? videos.find(item => item.id === id) : undefined;
  const story = stories.find(item => item.id === (video ? video.storyId : id));
  if (!video && !story) return;

  const dialog = document.createElement('dialog');
  dialog.className = 'story-sheet';
  dialog.setAttribute('aria-labelledby', 'sheet-heading');
  let body;
  if (sheet === 'sources') {
    const videoSource = video ? [{ type: 'Original video', publisher: video.publisher ?? 'YouTube', title: video.title, url: youtubeUrl(video) }] : [];
    body = sourceList([...videoSource, ...(story?.sources ?? [])]);
  } else if (sheet === 'fact') {
    const checks = video ? postAnalyses[key]?.factChecks ?? [] : story.factChecks ?? [];
    const factChecks = checks.map(check => `<section class="video-fact-check">
      <p class="topic">${factVerdicts[check.verdict]}</p>
      <h3>${escapeHtml(check.claim)}</h3>
      ${video && check.timestamp !== undefined ? `<a class="story-link" href="https://www.youtube.com/watch?v=${video.id}&amp;t=${check.timestamp}s" target="_blank" rel="noopener noreferrer">Watch from ${durationLabel(check.timestamp) || '0:00'} ${icon('external')}</a>` : ''}
      <p>${escapeHtml(check.explanation)}</p>
      ${check.sources.length ? sourceList(check.sources.map(source => ({ ...source, type: 'Evidence' }))) : ''}
    </section>`).join('');
    body = `${factChecks || (video ? '<p>No claim-level fact check is available for this video yet.</p>' : '')}
    ${story ? `<div class="context">
      ${video ? '<h3>Related story context</h3>' : ''}
      <h3>What to know</h3><p>${escapeHtml(story.context)}</p>
      <h3>What to look into</h3><p>${escapeHtml(story.question)}</p>
    </div>` : ''}
    ${story ? sourceList(story.sources) : ''}`;
  } else if (sheet === 'menu') {
    const pressed = saved.has(video ? key : id);
    body = `<button class="outline-button" type="button" data-save="${video ? key : id}" aria-pressed="${pressed}">${pressed ? 'Remove from Saved' : 'Save for later'}</button>
      ${video ? `<a class="story-link" href="#bias/${video.id}">${icon('scale')} Review bias</a>` : `<a class="story-link" href="${storyUrl(story)}">${icon('feed')} Read this story</a>`}`;
  } else {
    const review = video && readBiasLabel(video.id);
    body = `<p class="note">AI estimates describe framing. Always review the sources.</p>
      ${postAnalysis(key) || '<p>No automated analysis is available yet.</p>'}
      ${review ? `<p>Editorial review: ${escapeHtml(review)}</p>` : ''}`;
  }

  dialog.innerHTML = `<div class="sheet-content">
    <header><h2 id="sheet-heading">${sheetTitles[sheet] ?? 'Post options'}</h2>
      <button class="icon-button" type="button" data-close-sheet aria-label="Close" autofocus>${icon('close')}</button>
    </header>
    <p class="sheet-title">${escapeHtml(video?.title ?? story.title)}</p>
    <div class="sheet-body${sheet === 'sources' || sheet === 'fact' ? ' sources' : ''}">${body}</div>
  </div>`;
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (trigger.isConnected) trigger.focus({ preventScroll: true });
  }, { once: true });
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });
  main.append(dialog);
  dialog.showModal();
}

function sourceList(sources) {
  return `<ul>${sources.map(source => `<li>
    <a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">
      <span class="source-icon">${icon('file')}</span>
      <span><small>${escapeHtml(source.type)} · ${escapeHtml(source.publisher)}</small><strong>${escapeHtml(source.title)}</strong></span>
      ${icon('external')}
    </a>
  </li>`).join('')}</ul>`;
}

main.addEventListener('input', event => {
  if (event.target.id === 'discover-query') updateDiscovery(event.target.value);
});

function submitPage() {
  main.innerHTML = `<div class="page-intro">
    <p class="eyebrow">Delhi NCR <span>·</span> Demo edition</p>
    <h1>Submit a link</h1>
    <p>Add an article, reel, or video you want to see covered.</p>
  </div>
  <form class="submit-form">
    <label for="link-input">Story link</label>
    <input id="link-input" name="link" type="url" required placeholder="https://…" autocapitalize="none" spellcheck="false" aria-describedby="submit-note submit-status">
    <p id="submit-note" class="note">In this demo, new links are saved to this browser only.</p>
    <button type="submit" class="primary-button">Add link ${icon('arrow')}</button>
    <p id="submit-status" class="status" role="status"></p>
  </form>
  <section class="submitted" aria-labelledby="submitted-heading">
    <h2 id="submitted-heading">Links you’ve added</h2>
    <ul></ul>
  </section>`;
  updateSubmissions();
}

function normalizedUrl(value) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

function updateSubmissions() {
  const section = main.querySelector('.submitted');
  section.hidden = submissions.length === 0;
  const items = submissions.map(url => {
    const item = document.createElement('li');
    item.textContent = url;
    return item;
  });
  section.querySelector('ul').replaceChildren(...items);
}

function showSubmissionResult(message, destination, linkText) {
  const status = main.querySelector('#submit-status');
  status.textContent = message;
  if (destination) {
    const link = document.createElement('a');
    link.href = destination;
    link.textContent = linkText;
    status.append(' ', link);
  }
}

main.addEventListener('submit', event => {
  if (!event.target.matches('.submit-form')) return;
  event.preventDefault();
  const input = event.target.elements.link;
  const url = normalizedUrl(input.value);
  if (!url) {
    showSubmissionResult('Enter an HTTP or HTTPS link.');
    input.focus();
    return;
  }
  const match = stories.find(story => story.sources.some(source => normalizedUrl(source.url) === url));
  if (match) {
    showSubmissionResult('This link is already attached to a story.', storyUrl(match), 'Open story');
    return;
  }
  const videoId = youtubeIdFromUrl(url);
  const video = videos.find(item => item.id === videoId);
  if (video) {
    showSubmissionResult('This video is already in Watch.', videoUrl(video), 'Open video');
    return;
  }
  if (submissions.includes(url)) {
    showSubmissionResult('You’ve already added this link.');
    return;
  }
  const updated = [url, ...submissions];
  if (!writeStorage(submissionKey, updated)) {
    showSubmissionResult('Your browser couldn’t save this link.');
    return;
  }
  submissions.unshift(url);
  event.target.reset();
  updateSubmissions();
  showSubmissionResult('Link saved to this browser.');
});

async function shareStory(story) {
  const url = new URL(storyUrl(story), location.href).href;
  const status = main.querySelector('#story-status');
  if (navigator.share) {
    try {
      await navigator.share({ title: story.title, url });
      return;
    } catch (error) {
      if (error.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    status.textContent = 'Story link copied.';
  } catch {
    const input = document.createElement('input');
    input.type = 'url';
    input.readOnly = true;
    input.value = url;
    input.setAttribute('aria-label', 'Story link');
    status.replaceChildren(input);
    input.select();
  }
}

main.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  const { topic, save, share, play, follow, sheet, key, closeSheet } = button.dataset;
  if (sheet) openStorySheet(key, sheet, button);
  if (closeSheet !== undefined) button.closest('dialog').close();
  if (follow) {
    const pressed = !following.has(follow);
    if (pressed) following.add(follow);
    else following.delete(follow);
    writeStorage(followingKey, [...following]);
    if (location.hash === '#following' || location.hash === '#feed/following') {
      render({ moveFocus: true });
    } else {
      button.setAttribute('aria-pressed', String(pressed));
      button.innerHTML = pressed ? icon('check') + ' Following' : icon('plus') + ' Follow';
    }
  }
  if (play) playback.play(button);
  if (topic) {
    activeTopic = topic;
    for (const filter of main.querySelectorAll('[data-topic]')) {
      filter.setAttribute('aria-pressed', String(filter === button));
    }
    updateFeed();
  }
  if (save) {
    if (saved.has(save)) saved.delete(save);
    else saved.add(save);
    writeStorage(savedKey, [...saved]);
    button.setAttribute('aria-pressed', String(saved.has(save)));
    if (location.hash === '#saved') {
      render({ moveFocus: true });
    } else if (button.closest('dialog')) {
      button.textContent = saved.has(save) ? 'Remove from Saved' : 'Save for later';
    }
  }
  if (share) void shareStory(stories.find(story => story.id === share));
});

main.addEventListener('error', event => {
  if (event.target.matches?.('.video-thumb')) event.target.hidden = true;
  if (event.target.matches?.('.lead-art img')) event.target.parentElement.hidden = true;
}, true);

main.addEventListener('click', async event => {
  const button = event.target.closest('[data-refresh-analysis]');
  if (!button) return;
  const panel = button.closest('[data-post-analysis]');
  const key = panel.dataset.postAnalysis;
  const status = panel.querySelector('[role="status"]');
  button.disabled = true;
  status.textContent = 'Refreshing analysis…';
  try {
    const response = await fetch(new URL(`./api/post-analyses/${key}`, import.meta.url), { method: 'POST' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    postAnalyses[key] = { ...postAnalyses[key], ...result };
    updateAnalysisDisplays(key, result);
    status.textContent = 'Analysis updated.';
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

function render({ moveFocus = false, previousHash = '' } = {}) {
  playback.disconnect();
  const [route] = location.hash.slice(1).split('?');
  const story = stories.find(item => route === `story/${item.id}`);
  const fromVideo = story && contextVideo(location.hash);
  const video = videos.find(item => route === `watch/${item.id}`);
  const biasVideo = videos.find(item => route === `bias/${item.id}`);
  const isWatch = !route || route === 'watch' || route === 'watch/full' || Boolean(video);
  const watchFormat = video?.format ?? (route === 'watch/full' ? 'full' : 'shorts');
  let activePage = 'feed';
  if (isWatch || fromVideo) activePage = 'watch';
  else if (route === 'bias' || biasVideo) activePage = 'bias';
  else if (['saved', 'submit', 'discover', 'following'].includes(route)) activePage = route;
  for (const link of document.querySelectorAll('[data-nav]')) {
    if (link.dataset.nav === activePage) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  if (story) storyPage(story, fromVideo);
  else if (isWatch) watchPage(watchFormat);
  else if (activePage === 'bias') mountBiasReview(main, { videos, videoId: biasVideo?.id });
  else if (activePage === 'saved') collectionPage('Saved', saved, 'Your bookmarks will appear here.');
  else if (activePage === 'following') collectionPage('Following', following, 'Stories and videos you follow will appear here.');
  else if (activePage === 'discover') discoverPage();
  else if (activePage === 'submit') submitPage();
  else feed(route === 'feed/following');
  const pageTitles = { watch: 'Watch', bias: 'Bias review', saved: 'Saved', submit: 'Submit a link', feed: 'Read', following: 'Following', discover: 'Discover' };
  const title = story?.title ?? video?.title ?? pageTitles[activePage];
  document.title = `${title} · Khabar`;
  if (moveFocus) {
    window.scrollTo(0, 0);
    main.focus({ preventScroll: true });
  }
  const returningTo = isWatch && contextVideo(previousHash);
  const targetVideo = video ?? (returningTo?.format === watchFormat ? returningTo : undefined);
  if (targetVideo) {
    const card = document.getElementById(`video-${targetVideo.id}`);
    card.scrollIntoView({ block: 'start' });
    if (moveFocus) card.focus({ preventScroll: true });
  }
  if (main.querySelector('.video-frame')) playback.connect();
}

document.querySelector('.skip-link').addEventListener('click', event => {
  event.preventDefault();
  main.focus();
});
window.addEventListener('hashchange', event => render({ moveFocus: true, previousHash: new URL(event.oldURL).hash }));
render();
setTimeout(pollPendingAnalyses, 5000);
