const autoplayThreshold = 0.6;
const visibilityThresholds = [0, 0.5, autoplayThreshold, 0.7, 0.8, 0.9, 1];
let playerApiRequest;

function loadPlayerApi(view) {
  if (view.YT?.Player) return Promise.resolve(view.YT);
  if (playerApiRequest) return playerApiRequest;

  playerApiRequest = new Promise((resolve, reject) => {
    const script = view.document.createElement('script');
    const previousCallback = view.onYouTubeIframeAPIReady;
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;

    function cleanup() {
      view.clearTimeout(timeout);
      if (view.onYouTubeIframeAPIReady === onReady) {
        view.onYouTubeIframeAPIReady = previousCallback;
      }
    }

    function onReady() {
      cleanup();
      if (view.YT?.Player) resolve(view.YT);
      else reject(new Error('The YouTube IFrame Player API is unavailable.'));
      previousCallback?.();
    }

    function onError() {
      cleanup();
      script.remove();
      reject(new Error('The YouTube IFrame Player API did not load.'));
    }

    const timeout = view.setTimeout(onError, 8000);
    view.onYouTubeIframeAPIReady = onReady;
    script.addEventListener('error', onError, { once: true });
    view.document.head.append(script);
  }).catch(error => {
    playerApiRequest = undefined;
    throw error;
  });
  return playerApiRequest;
}

export function createPlaybackController(container) {
  const document = container.ownerDocument;
  const view = document.defaultView;
  const visibility = new Map();
  let observer;
  let active;
  let pending;
  let failedPreview;
  let autoplayAllowed = false;
  let bottomInset;

  function stop() {
    if (!active) return;
    const { frame, preview, player } = active;
    const restoreFocus = document.activeElement === frame;
    active = undefined;
    player?.destroy();
    frame.remove();
    preview.hidden = false;
    if (restoreFocus) preview.focus({ preventScroll: true });
  }

  function start(preview, api) {
    stop();
    const frame = document.createElement('iframe');
    const url = new URL(`https://www.youtube-nocookie.com/embed/${preview.dataset.play}`);
    url.searchParams.set('playsinline', '1');
    if (api) {
      url.searchParams.set('enablejsapi', '1');
      url.searchParams.set('origin', view.location.origin);
    } else {
      url.searchParams.set('autoplay', '1');
    }
    frame.title = preview.getAttribute('aria-label') || 'YouTube video';
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    frame.allowFullscreen = true;
    frame.src = url.href;
    preview.hidden = true;
    preview.after(frame);

    const playback = { frame, preview, automatic: Boolean(api) };
    active = playback;
    if (!api) {
      frame.focus({ preventScroll: true });
      return;
    }
    playback.player = new api.Player(frame, {
      events: {
        onReady({ target }) {
          if (active !== playback || document.hidden || visibleRatio(preview) <= 0.5) return;
          target.mute();
          target.playVideo();
        },
      },
    });
  }

  function visibleRatio(preview) {
    return visibility.get(preview.parentElement)?.intersectionRatio ?? 0;
  }

  function reconcile() {
    if (document.hidden) return;
    if (active) {
      if (document.fullscreenElement === active.frame) return;
      const ratio = visibleRatio(active.preview);
      if (visibility.has(active.preview.parentElement) && ratio <= (active.automatic ? 0.5 : 0)) stop();
      else if (!active.automatic || document.activeElement === active.frame) return;
    }
    if (!autoplayAllowed) return;

    let bestPreview;
    let bestRatio = active ? visibleRatio(active.preview) : 0;
    for (const entry of visibility.values()) {
      if (entry.intersectionRatio < autoplayThreshold || entry.intersectionRatio <= bestRatio) continue;
      const preview = entry.target.querySelector('[data-play][data-autoplay]');
      if (!preview || preview === document.activeElement) continue;
      bestPreview = preview;
      bestRatio = entry.intersectionRatio;
    }

    if (bestPreview !== failedPreview) failedPreview = undefined;
    if (!bestPreview || bestPreview === failedPreview) {
      pending = undefined;
      return;
    }
    if (pending?.preview === bestPreview) return;
    const request = { preview: bestPreview };
    pending = request;
    void loadPlayerApi(view).then(api => {
      if (pending !== request || document.hidden) return;
      if (visibleRatio(bestPreview) < autoplayThreshold || bestPreview === document.activeElement) {
        pending = undefined;
        return;
      }
      start(bestPreview, api);
      pending = undefined;
    }).catch(() => {
      if (pending !== request) return;
      if (active?.preview === bestPreview) stop();
      pending = undefined;
      failedPreview = bestPreview;
    });
  }

  function onVisibilityChange() {
    if (document.hidden) {
      pending = undefined;
      stop();
    } else {
      reconcile();
    }
  }

  function observeFrames() {
    const navigation = document.querySelector('.navigation');
    const inset = navigation && view.getComputedStyle(navigation).position === 'fixed'
      ? Math.ceil(navigation.getBoundingClientRect().height) : 0;
    if (observer && bottomInset === inset) return;
    bottomInset = inset;
    observer?.disconnect();
    visibility.clear();
    pending = undefined;
    observer = new view.IntersectionObserver((entries, source) => {
      if (observer !== source) return;
      for (const entry of entries) visibility.set(entry.target, entry);
      reconcile();
    }, { threshold: visibilityThresholds, rootMargin: `0px 0px -${inset}px 0px` });
    for (const frame of container.querySelectorAll('.video-frame')) observer.observe(frame);
  }

  function connect() {
    document.addEventListener('visibilitychange', onVisibilityChange);
    document.addEventListener('fullscreenchange', reconcile);
    if (!view.IntersectionObserver) return;
    autoplayAllowed = !view.matchMedia('(prefers-reduced-motion: reduce)').matches
      && !view.navigator.connection?.saveData;
    view.addEventListener('resize', observeFrames);
    observeFrames();
  }

  function play(preview) {
    pending = undefined;
    start(preview);
  }

  function disconnect() {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    document.removeEventListener('fullscreenchange', reconcile);
    view.removeEventListener('resize', observeFrames);
    observer?.disconnect();
    observer = undefined;
    visibility.clear();
    pending = undefined;
    failedPreview = undefined;
    autoplayAllowed = false;
    stop();
  }

  return { connect, play, disconnect };
}
