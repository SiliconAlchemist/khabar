import { stories } from './stories.js';
import { videos as seedVideos, youtubeIdFromUrl, youtubeUrl } from './videos.js';
import { createPlaybackController } from './playback.js';
import { mountBiasReview, readBiasLabel } from './bias.js';

const videos = await loadVideos();
const main = document.querySelector('main');
const playback = createPlaybackController(main);
const topicNames = ['All', ...new Set(stories.map(story => story.topic))];
const videoDate = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' });
const paths = {
  play: '<path d="M8 5v14l11-7z"/>',
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

function escapeHtml(value) {
  const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(value).replace(/[&<>"']/g, character => entities[character]);
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
const submissions = readStorage(submissionKey);
let activeTopic = 'All';

function storyUrl(story) {
  return `#story/${story.id}`;
}

function videoUrl(video) {
  return `#watch/${video.id}`;
}

function videoCard(video) {
  const story = stories.find(item => item.id === video.storyId);
  const portrait = video.format === 'shorts';
  const biasLabel = readBiasLabel(video.id);
  const title = escapeHtml(video.title);
  const sourceDate = Date.parse(video.sourcePublishedAt);
  const date = Number.isFinite(sourceDate) ? videoDate.format(sourceDate) : '';
  const byline = [video.publisher, date].filter(Boolean).map(escapeHtml).join(' · ');
  return `<article class="video-card${portrait ? ' video-card-portrait' : ''}" id="video-${video.id}" tabindex="-1">
    <div class="video-frame">
      <button class="video-preview" type="button" data-play="${video.id}" data-autoplay aria-label="Play ${title}">
        <img class="video-thumb" src="https://i.ytimg.com/vi/${video.id}/hqdefault.jpg" alt="" loading="lazy">
        <span class="video-play">${icon('play')} Play</span>
      </button>
    </div>
    <div class="video-caption">
      ${byline ? `<p class="topic">${byline}</p>` : ''}
      <h2>${title}</h2>
      ${video.summary ? `<p class="video-summary">${escapeHtml(video.summary)}</p>` : ''}
      <div class="video-links">
        ${story ? `<a class="story-link" href="${storyUrl(story)}">Read &amp; sources ${icon('arrow')}</a>` : ''}
        <a class="story-link" href="#bias/${video.id}">${icon('scale')} ${biasLabel ? `Bias review: ${biasLabel}` : 'Review bias'}</a>
        <a class="story-link" href="${youtubeUrl(video)}" target="_blank" rel="noopener noreferrer">Open on YouTube ${icon('external')}</a>
      </div>
    </div>
  </article>`;
}

function watchPage(format) {
  const list = videos.filter(video => video.format === format);
  main.innerHTML = `<div class="watch-page">
    <div class="page-intro">
      <h1>Watch</h1>
    </div>
    <nav class="watch-formats" aria-label="Video format">
      <a href="#watch"${format === 'shorts' ? ' aria-current="page"' : ''}>Shorts</a>
      <a href="#watch/full"${format === 'full' ? ' aria-current="page"' : ''}>Full videos</a>
    </nav>
    <section class="video-list" aria-label="${format === 'shorts' ? 'YouTube Shorts' : 'Full videos'}">
      ${list.map(videoCard).join('')}
    </section>
    <p class="caught-up">${icon('check')} You’re caught up.</p>
  </div>`;
}

function bookmark(story) {
  const pressed = saved.has(story.id);
  return `<button class="icon-button bookmark" type="button" data-save="${story.id}" aria-label="Save ${story.title}" aria-pressed="${pressed}">${icon('bookmark')}</button>`;
}

function card(story, lead = false) {
  return `<article class="story-card${lead ? ' lead-card' : ''}">
    ${lead ? `<div class="lead-art">
      <img src="${story.image.url}" alt="${story.image.alt}" width="910" height="509">
    </div>` : ''}
    <div class="card-body">
      <div class="card-top"><span class="topic">${story.topic}</span>${bookmark(story)}</div>
      <h2><a href="${storyUrl(story)}">${story.title}</a></h2>
      <p>${story.summary}</p>
      <a class="story-link" href="${storyUrl(story)}" aria-label="Open ${story.title}, ${story.sources.length} sources">${story.sources.length} sources ${icon('arrow')}</a>
    </div>
  </article>`;
}

function feed() {
  main.innerHTML = `<div class="page-intro">
    <p class="eyebrow">Delhi NCR <span>·</span> Demo edition</p>
    <h1>Delhi, in context.</h1>
    <p>Local stories with the sources behind them.</p>
  </div>
  <div class="topic-bar" role="group" aria-label="Filter by topic">
    ${topicNames.map(topic => `<button type="button" data-topic="${topic}" aria-pressed="${topic === activeTopic}">${topic}</button>`).join('')}
  </div>
  <section class="story-list" aria-label="Stories"></section>
  <p class="caught-up">${icon('check')} You’re caught up.</p>`;
  updateFeed();
}

function updateFeed() {
  const list = activeTopic === 'All' ? stories : stories.filter(story => story.topic === activeTopic);
  const storyList = main.querySelector('.story-list');
  storyList.innerHTML = list.map((story, index) => card(story, index === 0 && Boolean(story.image))).join('');
  const leadImage = storyList.querySelector('img');
  if (leadImage) {
    const useFallback = () => {
      leadImage.parentElement.hidden = true;
    };
    leadImage.addEventListener('error', useFallback, { once: true });
    if (leadImage.complete && !leadImage.naturalWidth) useFallback();
  }
}

function storyPage(story) {
  const relatedVideos = videos.filter(video => video.storyId === story.id);
  main.innerHTML = `<article class="story-page">
    <a class="back-link" href="#feed">${icon('back')} Back to stories</a>
    <div class="page-intro">
      <p class="eyebrow">Delhi NCR <span>·</span> ${story.topic}</p>
      <h1>${story.title}</h1>
      <p>${story.summary}</p>
    </div>
    <div class="story-actions">
      ${bookmark(story)}
      <button class="outline-button" type="button" data-share="${story.id}">${icon('share')} Share story</button>
    </div>
    <p id="story-status" class="status" role="status"></p>
    ${relatedVideos.map(video => `<a class="story-link related-video" href="${videoUrl(video)}">${icon('play')} Watch ${escapeHtml(video.publisher ?? 'related video')}</a>`).join('')}
    <div class="context">
      <h2>What to know</h2>
      <p>${story.context}</p>
      <h2>What to look into</h2>
      <p>${story.question}</p>
    </div>
    <section class="sources" aria-labelledby="source-heading">
      <h2 id="source-heading">Sources</h2>
      <ul>${story.sources.map(source => `<li>
        <a href="${source.url}" target="_blank" rel="noopener noreferrer">
          <span class="source-icon">${icon('file')}</span>
          <span><small>${source.type} · ${source.publisher}</small><strong>${source.title}</strong></span>
          ${icon('external')}
        </a>
      </li>`).join('')}</ul>
    </section>
    ${story.image ? `<p class="credit">Archive photo by <a href="${story.image.page}">${story.image.credit}</a> (<a href="${story.image.license}">CC BY-SA 4.0</a>), cropped in the feed.</p>` : ''}
  </article>`;
}

function savedPage() {
  const list = stories.filter(story => saved.has(story.id));
  main.innerHTML = `<div class="page-intro"><h1>Saved stories</h1></div>
    ${list.length ? `<section class="story-list" aria-label="Saved stories">${list.map(story => card(story)).join('')}</section>` :
    '<div class="empty"><p>Your bookmarks will appear here.</p><a href="#feed">Browse the feed</a></div>'}`;
}

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
  const { topic, save, share, play } = button.dataset;
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
      savedPage();
      (main.querySelector('button, .empty a') ?? main).focus();
    }
  }
  if (share) void shareStory(stories.find(story => story.id === share));
});

main.addEventListener('error', event => {
  if (event.target.matches?.('.video-thumb')) event.target.hidden = true;
}, true);

function render({ moveFocus = false } = {}) {
  playback.disconnect();
  const route = location.hash.slice(1);
  const story = stories.find(item => route === `story/${item.id}`);
  const video = videos.find(item => route === `watch/${item.id}`);
  const biasVideo = videos.find(item => route === `bias/${item.id}`);
  const isWatch = !route || route === 'watch' || route === 'watch/full' || Boolean(video);
  let activePage = 'feed';
  if (isWatch) activePage = 'watch';
  else if (route === 'bias' || biasVideo) activePage = 'bias';
  else if (['saved', 'submit'].includes(route)) activePage = route;
  for (const link of document.querySelectorAll('[data-nav]')) {
    if (link.dataset.nav === activePage) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  if (story) storyPage(story);
  else if (isWatch) watchPage(video?.format ?? (route === 'watch/full' ? 'full' : 'shorts'));
  else if (activePage === 'bias') mountBiasReview(main, { videos, videoId: biasVideo?.id });
  else if (activePage === 'saved') savedPage();
  else if (activePage === 'submit') submitPage();
  else feed();
  const pageTitles = { watch: 'Watch', bias: 'Bias review', saved: 'Saved', submit: 'Submit a link', feed: 'Delhi NCR' };
  const title = story?.title ?? video?.title ?? pageTitles[activePage];
  document.title = `${title} · Khabar`;
  if (moveFocus) {
    window.scrollTo(0, 0);
    main.focus({ preventScroll: true });
  }
  if (video) {
    const card = document.getElementById(`video-${video.id}`);
    card.scrollIntoView({ block: 'start' });
    if (moveFocus) card.focus({ preventScroll: true });
  }
  if (isWatch) playback.connect();
}

document.querySelector('.skip-link').addEventListener('click', event => {
  event.preventDefault();
  main.focus();
});
window.addEventListener('hashchange', () => render({ moveFocus: true }));
render();
