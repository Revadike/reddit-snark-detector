/**
 * Reddit Snark Detector — Content Script
 * Detects users who post in H3/Hasan snark subreddits and labels them inline.
 */
(function () {
  'use strict';

  const CACHE_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
  const STORAGE_KEY_PREFIX = 'rsd_user_';

  /**
   * Maps subreddit name → badge label text.
   * Subreddits sharing the same label are merged into one badge with a combined tooltip.
   * Add or remove entries here to change which subreddits are tracked.
   * @type {Record<string, string>}
   */
  const SUBREDDIT_LABELS = {
    LeftoversH3: 'Snarker',
    h3snark: 'Snarker',
    Hasan_Piker: 'Hasanabi Head',
  };

  /**
   * Maps badge label text → CSS class (slugified from label text).
   * Derived automatically from SUBREDDIT_LABELS — no manual sync needed.
   * e.g. 'Snarker' → 'rsd-snarker', 'Hasanabi Head' → 'rsd-hasanabi-head'
   * @type {Record<string, string>}
   */
  const LABEL_CSS = Object.fromEntries(
    [...new Set(Object.values(SUBREDDIT_LABELS))].map(label => [
      label,
      'rsd-' + label.toLowerCase().replace(/\s+/g, '-'),
    ])
  );

  // .rsd-badge-row is appended inside the <a>'s inner flex div (avatar + username),
  // so it stays on the same line regardless of outer flex-wrap.
  const STYLES = `
    .rsd-badge-row {
      display: inline-flex;
      flex-wrap: nowrap;
      align-items: center;
      gap: 3px;
      margin-left: 4px;
      vertical-align: middle;
      line-height: 1;
      flex-shrink: 0;
    }
    .rsd-label {
      display: inline-flex;
      align-items: center;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.04em;
      padding: 2px 6px;
      border-radius: 3px;
      cursor: default;
      white-space: nowrap;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      line-height: 1.4;
      text-decoration: none !important;
      transition: opacity 0.15s;
    }
    .rsd-label:hover { opacity: 0.85; }
    .rsd-snarker {
      background: linear-gradient(135deg, #ff4500, #ff6534);
      color: #fff;
      border: 1px solid rgba(255,69,0,0.4);
      box-shadow: 0 1px 3px rgba(255,69,0,0.25);
    }
    .rsd-hasanabi-head {
      background: linear-gradient(135deg, #1a73e8, #0d5dbf);
      color: #fff;
      border: 1px solid rgba(26,115,232,0.4);
      box-shadow: 0 1px 3px rgba(26,115,232,0.25);
    }
    .rsd-loading {
      background: #555;
      color: #ccc;
      border: 1px solid rgba(255,255,255,0.1);
      cursor: pointer;
    }
    #rsd-floating-tip {
      display: none;
      position: fixed;
      background: #1a1a1b;
      color: #d7dadc;
      font-size: 11px;
      font-weight: 400;
      padding: 5px 9px;
      border-radius: 4px;
      white-space: nowrap;
      pointer-events: none;
      box-shadow: 0 2px 10px rgba(0,0,0,0.4);
      border: 1px solid #343536;
      z-index: 99999;
    }
  `;

  if (!document.getElementById('rsd-styles')) {
    const el = document.createElement('style');
    el.id = 'rsd-styles';
    el.textContent = STYLES;
    (document.head || document.documentElement).appendChild(el);
  }

  // Single fixed-position tooltip shared by all labels — immune to overflow:hidden.
  const floatingTip = document.createElement('div');
  floatingTip.id = 'rsd-floating-tip';
  (document.body || document.documentElement).appendChild(floatingTip);

  document.addEventListener('mouseover', (e) => {
    const label = e.target.closest?.('.rsd-label');
    if (!label) return;
    floatingTip.textContent = label.dataset.tip || '';
    floatingTip.style.display = 'block';
  });
  document.addEventListener('mouseout', (e) => {
    if (!e.target.closest?.('.rsd-label')) floatingTip.style.display = 'none';
  });
  document.addEventListener('mousemove', (e) => {
    if (floatingTip.style.display === 'none') return;
    floatingTip.style.left = `${e.clientX + 12}px`;
    floatingTip.style.top = `${e.clientY - 32}px`;
  });

  /**
   * Reads a value from chrome.storage.local. Returns null on error or missing key.
   * @param {string} key  Username (without prefix)
   * @returns {Promise<object|null>}
   */
  function storageGet(key) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(STORAGE_KEY_PREFIX + key, (result) => {
          resolve(result[STORAGE_KEY_PREFIX + key] ?? null);
        });
      } catch { resolve(null); }
    });
  }

  /**
   * Writes a value to chrome.storage.local. Silently swallows errors.
   * @param {string} key    Username (without prefix)
   * @param {object} value  Data to persist
   * @returns {Promise<void>}
   */
  function storageSet(key, value) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.set({ [STORAGE_KEY_PREFIX + key]: value }, resolve);
      } catch { resolve(); }
    });
  }

  // Epoch ms until which fetches should be paused.
  let rateLimitPauseUntil = 0;

  /**
   * A promise that resolves when the rate-limit is manually cleared (click-to-retry).
   * Replacing this with a fresh Promise lets all current sleepers wake immediately.
   * @type {{ promise: Promise<void>, resolve: () => void }}
   */
  let rateLimitClearSignal = makeSignal();

  /**
   * Creates a one-shot signal: a Promise that can be resolved externally.
   * Used to let waitIfRateLimited() be woken early by clearRateLimit().
   * @returns {{ promise: Promise<void>, resolve: () => void }}
   */
  function makeSignal() {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    return { promise, resolve };
  }

  /**
   * Parses x-ratelimit-* headers from a Reddit API response.
   * @param {Headers} headers
   * @returns {{ remaining: number, reset: number }}  reset is seconds from now
   */
  function parseRateLimit(headers) {
    return {
      remaining: parseFloat(headers.get('x-ratelimit-remaining') ?? '99'),
      reset: parseInt(headers.get('x-ratelimit-reset') ?? '0', 10),
    };
  }

  /**
   * Sleeps until the rate-limit pause window has elapsed.
   * Re-checks after waking in case rateLimitPauseUntil was extended while sleeping.
   * Also wakes immediately if rateLimitClearSignal fires (user clicked retry).
   * @returns {Promise<void>}  Resolves once rateLimitPauseUntil is in the past.
   */
  async function waitIfRateLimited() {
    while (Date.now() < rateLimitPauseUntil) {
      const remaining = rateLimitPauseUntil - Date.now();
      console.debug(`[RSD] Pausing ${Math.ceil(remaining / 1000)}s for rate limit`);
      // Race: either the timer expires, or the user clicks retry and fires the signal
      await Promise.race([
        new Promise(r => setTimeout(r, remaining)),
        rateLimitClearSignal.promise,
      ]);
    }
  }

  /**
   * Clears the rate-limit pause immediately and wakes all sleeping waitIfRateLimited()
   * calls by resolving the shared signal promise, then replacing it for future sleeps.
   * @returns {void}
   */
  function clearRateLimit() {
    rateLimitPauseUntil = 0;
    rateLimitClearSignal.resolve();        // wake all current sleepers
    rateLimitClearSignal = makeSignal();   // fresh signal for future sleeps
  }

  /**
   * Fetches how many posts a user has in a given subreddit.
   * Returns null on network error or non-OK status so callers skip caching.
   * Fetches are serialised per-subreddit via waitIfRateLimited, but all three
   * subreddit fetches for one user still run concurrently (Promise.all). If the
   * first one sets rateLimitPauseUntil, the others will honour it on their next
   * waitIfRateLimited call — they can't be stopped mid-flight, but the next batch
   * of users will pause correctly.
   *
   * @param {string} username
   * @param {string} subreddit
   * @returns {Promise<{count: number, hasMore: boolean}|null>}
   */
  async function fetchSubredditCount(username, subreddit) {
    await waitIfRateLimited();

    const url = `https://www.reddit.com/search.json?q=author:${encodeURIComponent(username)}%20subreddit:${encodeURIComponent(subreddit)}&limit=100`;

    let res;
    try {
      res = await fetch(url, { credentials: 'include' });
    } catch (err) {
      console.warn(`[RSD] Network error fetching ${url}:`, err);
      return null;
    }

    console.log(`[RSD] GET ${url} → ${res.status}`);

    const { remaining, reset } = parseRateLimit(res.headers);

    if (remaining < 2) {
      rateLimitPauseUntil = Date.now() + reset * 1000;
      console.debug(`[RSD] Rate limit low (${remaining} remaining) — pausing ${reset}s`);
    }

    if (res.status === 429) {
      rateLimitPauseUntil = Date.now() + reset * 1000;
      console.debug(`[RSD] 429 received — pausing ${reset}s`);
      return null;
    }

    if (!res.ok) return null;

    let data;
    try { data = await res.json(); }
    catch { return null; }

    return {
      count: data?.data?.dist ?? 0,
      hasMore: !!(data?.data?.after),
    };
  }

  // In-flight map: username → Promise<userData>. Set before the async work begins
  // so concurrent calls join the same promise rather than racing to start a second fetch.
  const inFlight = new Map();

  /**
   * Returns cached or freshly-fetched subreddit data for a user.
   * Skips cache entries where all values are null (a previous all-fail).
   * Skips caching results that are all null (fetch failed completely).
   * Concurrent calls for the same username share one in-flight promise.
   *
   * @param {string} username
   * @returns {Promise<Record<string, {count:number,hasMore:boolean}|null>>}
   */
  async function getUserData(username) {
    const cached = await storageGet(username);
    if (
      cached &&
      (Date.now() - cached.fetchedAt) < CACHE_DURATION_MS &&
      Object.values(cached.data).some(v => v !== null)
    ) {
      return cached.data;
    }

    // Re-use an existing in-flight promise — checked after the async cache read
    // so it's possible (in theory) to miss it. Setting inFlight before the IIFE
    // resolves this: the promise is registered synchronously before any await.
    if (inFlight.has(username)) {
      return inFlight.get(username);
    }

    // Register synchronously so any concurrent getUserData call for the same
    // username that reaches this point before the first await will find it.
    const promise = (async () => {
      const subreddits = Object.keys(SUBREDDIT_LABELS);
      const counts = await Promise.all(subreddits.map(sub => fetchSubredditCount(username, sub)));
      const data = Object.fromEntries(subreddits.map((sub, i) => [sub, counts[i]]));

      if (Object.values(data).some(v => v !== null)) {
        await storageSet(username, { fetchedAt: Date.now(), data });
      }

      return data;
    })();

    // Set before any await so concurrent callers see it immediately
    inFlight.set(username, promise);
    try {
      return await promise;
    } finally {
      inFlight.delete(username);
    }
  }

  /**
   * Formats a subreddit post count for display. Returns null for zero or missing data.
   * @param {{ count: number, hasMore: boolean }|null} r
   * @returns {string|null}  e.g. "42" or "100+", null if zero or missing
   */
  function formatCount(r) {
    if (!r || r.count === 0) return null;
    return r.hasMore ? '100+' : String(r.count);
  }

  /**
   * Builds a human-readable tooltip string from a list of subreddit activity parts.
   * @param {{ displayCount: string, subreddit: string }[]} parts
   * @returns {string}  e.g. "12 posts on /r/LeftoversH3 and 3 posts on /r/h3snark"
   */
  function buildTooltip(parts) {
    return parts
      .map(({ displayCount: dc, subreddit: sub }) =>
        `${dc} ${dc === '1' ? 'post' : 'posts'} on /r/${sub}`)
      .join(' and ');
  }

  /**
   * Creates a styled badge <span> element with text and a tooltip data attribute.
   * @param {string} text      Visible label text
   * @param {string} cssClass  Full CSS class string
   * @param {string} tip       Tooltip content stored in data-tip
   * @returns {HTMLSpanElement}
   */
  function createLabel(text, cssClass, tip) {
    const span = document.createElement('span');
    span.className = `rsd-label ${cssClass}`;
    span.textContent = text;
    span.dataset.tip = tip;
    return span;
  }

  /**
   * Returns the inner flex div inside the <a> (avatar + username row) to append
   * badges into. Falls back to the link itself for comment author links.
   * @param {HTMLAnchorElement} linkNode
   * @returns {Element}
   */
  function getBadgeTarget(linkNode) {
    return linkNode.querySelector('div.flex.items-center') || linkNode;
  }

  /**
   * Returns a tooltip string describing the current rate-limit state.
   * @returns {string}  Human-readable message with reset time, or "Loading…" if not rate-limited.
   */
  function rateLimitTip() {
    const pauseMs = rateLimitPauseUntil - Date.now();
    return pauseMs > 0
      ? `Rate limited — data available at ${new Date(rateLimitPauseUntil).toLocaleTimeString()} (click to retry now)`
      : 'Loading…';
  }

  /**
   * Inserts a grey "…" loading badge into the link's badge target.
   * Shows a rate-limit message in the tooltip if currently paused.
   * No-op if a badge row already exists (avoids clobbering real labels during retry).
   * @param {HTMLAnchorElement} linkNode
   * @returns {void}
   */
  function showLoadingLabel(linkNode) {
    const target = getBadgeTarget(linkNode);
    if (target.querySelector('.rsd-badge-row')) return;
    const row = document.createElement('span');
    row.className = 'rsd-badge-row';
    row.appendChild(createLabel('…', 'rsd-loading', rateLimitTip()));
    target.appendChild(row);
  }

  /**
   * Updates the tooltip on an existing loading label in-place.
   * Gracefully does nothing if no loading label is present.
   * @param {HTMLAnchorElement} linkNode
   * @returns {void}
   */
  function refreshLoadingTip(linkNode) {
    const label = getBadgeTarget(linkNode).querySelector('.rsd-loading');
    if (label) label.dataset.tip = rateLimitTip();
  }

  /**
   * Replaces the loading placeholder with real labels grouped by label name.
   * Subreddits sharing a label are merged into one badge with a combined tooltip.
   * Removes all badges silently if the user has zero activity in all subreddits.
   *
   * @param {HTMLAnchorElement} linkNode
   * @param {Record<string, {count:number,hasMore:boolean}|null>} userData
   * @returns {void}
   */
  function appendLabels(linkNode, userData) {
    const target = getBadgeTarget(linkNode);

    /** @type {Map<string, {displayCount:string, subreddit:string}[]>} */
    const byLabel = new Map();
    for (const [sub, result] of Object.entries(userData)) {
      const dc = formatCount(result);
      if (!dc) continue;
      const label = SUBREDDIT_LABELS[sub];
      if (!label) continue;
      if (!byLabel.has(label)) byLabel.set(label, []);
      byLabel.get(label).push({ displayCount: dc, subreddit: sub });
    }

    // Remove loading placeholder only once we know what to replace it with,
    // minimising the window where no badge is visible.
    target.querySelector('.rsd-badge-row')?.remove();

    if (byLabel.size === 0) return;

    const row = document.createElement('span');
    row.className = 'rsd-badge-row';
    for (const [label, parts] of byLabel) {
      row.appendChild(createLabel(label, LABEL_CSS[label], buildTooltip(parts)));
    }
    target.appendChild(row);
  }

  /**
   * Extracts the Reddit username from a /user/<name> href.
   * @param {HTMLAnchorElement} node
   * @returns {string|null}
   */
  function extractUsername(node) {
    const m = (node.getAttribute('href') || '').match(/\/user\/([^/?#]+)/);
    return m ? m[1] : null;
  }

  // Tracks dispatched link nodes to avoid double-fetching within a session.
  const processed = new WeakSet();

  // Maximum consecutive all-null retries before giving up, to avoid hammering
  // the API indefinitely on a persistent error or IP ban.
  const MAX_RETRIES = 5;

  /**
   * Shows a loading badge, fetches data, then replaces it with real labels.
   * On all-null results (rate limit hit again after waiting), keeps the loading
   * label visible with an updated tooltip and schedules a retry with exponential
   * backoff. Gives up after MAX_RETRIES consecutive failures.
   *
   * @param {HTMLAnchorElement} linkNode
   * @param {number} [attempt=0]  Current retry attempt count
   * @returns {Promise<void>}
   */
  async function processLink(linkNode, attempt = 0) {
    if (processed.has(linkNode)) return;
    processed.add(linkNode);

    const username = extractUsername(linkNode);
    if (!username) return;

    showLoadingLabel(linkNode);
    const userData = await getUserData(username);

    if (!userData || Object.values(userData).every(v => v === null)) {
      if (attempt >= MAX_RETRIES) {
        // Give up — remove the loading label so it doesn't linger forever
        getBadgeTarget(linkNode).querySelector('.rsd-badge-row')?.remove();
        console.warn(`[RSD] Giving up on ${username} after ${MAX_RETRIES} retries`);
        return;
      }

      refreshLoadingTip(linkNode);

      // Exponential backoff: 2s, 4s, 8s, 16s, 32s — capped at the actual
      // rate-limit reset window if that's longer.
      const backoff = Math.min(2 ** (attempt + 1) * 1000, 60_000);
      const retryAfter = Math.max(rateLimitPauseUntil - Date.now(), backoff);
      console.debug(`[RSD] Retry ${attempt + 1}/${MAX_RETRIES} for ${username} in ${Math.ceil(retryAfter / 1000)}s`);

      processed.delete(linkNode);
      setTimeout(() => processLink(linkNode, attempt + 1), retryAfter);
      return;
    }

    appendLabels(linkNode, userData);
  }

  /**
   * Click handler for rate-limited loading labels.
   * Prevents the default link navigation and stops propagation, then immediately
   * clears the rate-limit pause and wakes all sleeping waitIfRateLimited() calls
   * via the shared signal, then retries the clicked link from attempt 0.
   * @returns {void}
   */
  document.addEventListener('click', (e) => {
    const label = e.target.closest?.('.rsd-loading');
    if (!label) return;

    e.preventDefault();
    e.stopPropagation();
    clearRateLimit();

    const linkNode = label.closest('.rsd-badge-row')
      ?.parentElement
      ?.closest('a[href*="/user/"]');
    if (!linkNode) return;

    processed.delete(linkNode);
    processLink(linkNode, 0);
  });

  /**
   * Returns true if the element's bounding rect intersects the viewport.
   * @param {Element} el
   * @returns {boolean}
   */
  function isVisible(el) {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < window.innerHeight &&
      r.right > 0 && r.left < window.innerWidth;
  }

  // comment authors: <a href="/user/X/" aria-label="X's profile">  (ends with "profile")
  // post authors:    <a href="/user/X/" aria-label="Author: X">
  const SEL = 'a[href*="/user/"][aria-label$="profile"], a[href*="/user/"][aria-label^="Author:"]';

  /**
   * Queries matching author links within root and processes visible ones.
   * @param {Document|Element} root
   * @param {boolean} [verbose=false]  Whether to log the node counts
   * @returns {void}
   */
  function scan(root, verbose = false) {
    const links = root.querySelectorAll(SEL);
    const visible = Array.from(links).filter(isVisible);
    if (verbose) console.log(`[RSD] scan found ${links.length} nodes, ${visible.length} visible`);
    visible.forEach(link => processLink(link));
  }

  /**
   * Returns a debounced version of fn that fires after ms of inactivity.
   * @param {Function} fn
   * @param {number} ms
   * @returns {Function}
   */
  function debounce(fn, ms) {
    let t;
    return () => { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  // Mutation observer: scan added subtrees quietly (no console spam per mutation)
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.matches?.(SEL) && isVisible(node)) {
          processLink(node);
        } else if (node.querySelectorAll) {
          scan(node, false);
        }
      }
    }
  });

  // Scroll/resize: pick up newly visible links, log only on initial scan
  window.addEventListener('scroll', debounce(() => scan(document, false), 150), { passive: true });
  window.addEventListener('resize', debounce(() => scan(document, false), 150), { passive: true });

  /**
   * Entry point: runs the initial verbose scan and starts the mutation observer.
   * @returns {void}
   */
  function init() {
    scan(document, true);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();