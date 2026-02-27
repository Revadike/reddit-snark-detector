/**
 * Reddit User Vibe — Content Script (main entry point)
 * Orchestrates user-link scanning, label insertion, and settings reactivity.
 * Must be loaded last; depends on: config.js, storage.js, api.js, ui.js.
 *
 * Works on both www.reddit.com and old.reddit.com.
 */

/**
 * Live settings object kept up-to-date via chrome.storage.onChanged.
 * Initialised to defaults; replaced with real stored values during init().
 * @type {RUVSettings}
 */
let settings = Object.assign({}, RUV.DEFAULTS);

/**
 * WeakSet of link nodes currently being processed (fetch in flight).
 * Prevents the same link from spawning duplicate concurrent fetches.
 * @type {WeakSet<HTMLAnchorElement>}
 */
const inProgress = new WeakSet();

/**
 * Regex that matches a user-profile URL on www.reddit.com or old.reddit.com
 * with no extra path segments or query/hash parameters after the username.
 * Capture group 1: "www" or "old".
 * Capture group 2: the Reddit username.
 *
 * Valid:   https://www.reddit.com/user/alice/
 * Valid:   https://old.reddit.com/user/bob
 * Invalid: https://www.reddit.com/user/alice/posts
 * Invalid: https://www.reddit.com/user/alice?sort=new
 */
const USER_HREF_RE = /^https?:\/\/(www|old)\.reddit\.com\/user\/([^/?#]+)\/?$/;

/**
 * Extracts the Reddit username from an anchor node.
 * Two conditions must both hold:
 *   1. `node.href` must match a bare /user/<name> URL (no extra segments or params).
 *   2. The node's visible text must contain the extracted username.
 *
 * @param {HTMLAnchorElement} node
 * @returns {string|null}  Username, or null if the node doesn't qualify.
 */
const extractUsername = (node) => {
  const m = (node.href || '').match(USER_HREF_RE);
  if (!m) { return null; }
  const username = m[2];
  const text = (node.innerText || node.textContent || '').trim();
  if (!text.toLowerCase().includes(username.toLowerCase())) { return null; }
  return username;
};

/**
 * Shows a loading label, fetches user data, then renders final labels.
 * On a null result (network/rate-limit failure) the loading label is kept
 * and a retry is scheduled with exponential backoff (up to MAX_RETRIES).
 *
 * @param {HTMLAnchorElement} linkNode
 * @param {number} [attempt=0]  Current retry attempt count.
 * @returns {Promise<void>}
 */
const processLink = async (linkNode, attempt = 0) => {
  if (inProgress.has(linkNode)) { return; }
  // Skip links that already have final labels
  if (linkNode.dataset.ruvDone === 'true') { return; }

  const username = extractUsername(linkNode);
  if (!username) { return; }

  inProgress.add(linkNode);
  RUV.showLoadingLabel(linkNode);

  const data = await RUV.getUserData(username, settings);

  inProgress.delete(linkNode);

  if (data === null) {
    // Fetch failed — keep loading indicator, schedule retry with backoff
    if (attempt >= RUV.MAX_RETRIES) {
      const row = RUV._getBadgeRow(linkNode);
      if (row) { row.remove(); delete linkNode.dataset.ruvRowId; }
      console.warn(`[RUV] Giving up on "${username}" after ${RUV.MAX_RETRIES} retries`);
      return;
    }

    RUV.refreshLoadingTip(linkNode);

    const backoff = Math.min(2 ** (attempt + 1) * 1000, 60_000);
    const retryAfter = Math.max(RUV._rateLimitPauseUntil - Date.now(), backoff);
    console.debug(`[RUV] Retry ${attempt + 1}/${RUV.MAX_RETRIES} for "${username}" in ${Math.ceil(retryAfter / 1000)}s`);
    setTimeout(() => processLink(linkNode, attempt + 1), retryAfter);
    return;
  }

  RUV.appendLabels(linkNode, data, username);
  linkNode.dataset.ruvDone = 'true';
};

document.addEventListener('click', (e) => {
  const pill = e.target.closest?.('.ruv-pill');
  if (!pill) { return; }

  const row = pill.closest('.ruv-badge-row');
  if (!row || !row.querySelector('.ruv-pill-loading')) { return; }

  e.preventDefault();
  e.stopPropagation();
  RUV.clearRateLimit();

  // Walk up from the row to find its associated link node
  const linkNode = (() => {
    // After-sibling insertion: the link is the previous sibling
    if (row.previousElementSibling && row.previousElementSibling.tagName === 'A') {
      return row.previousElementSibling;
    }
    // Appended-inside insertion: the link is a parent/ancestor
    const anchor = row.closest('a[href*="/user/"]');
    return anchor || null;
  })();

  if (!linkNode) { return; }

  // Remove the badge row so processLink can reinsert a fresh loading label
  row.remove();
  delete linkNode.dataset.ruvRowId;
  delete linkNode.dataset.ruvDone;

  processLink(linkNode, 0);
});

/**
 * Broad CSS selector used as a fast pre-filter before extractUsername runs
 * the full href-regex + innerText check.
 * @type {string}
 */
const SEL = 'a[href*="/user/"]';

/**
 * Queries matching author links within root and processes the visible ones.
 *
 * @param {Document|Element} root
 * @param {boolean} [verbose=false]  Whether to log node counts to the console.
 * @returns {void}
 */
const scan = (root, verbose = false) => {
  if (settings.paused) { return; }
  const links = root.querySelectorAll(SEL);
  const visible = Array.from(links).filter(RUV.isVisible);
  if (verbose) { console.log(`[RUV] scan: ${links.length} candidate(s), ${visible.length} visible`); }
  visible.forEach((link) => processLink(link));
};

/**
 * Returns a debounced version of fn that fires after ms of inactivity.
 *
 * @param {Function} fn
 * @param {number}   ms
 * @returns {Function}
 */
const debounce = (fn, ms) => {
  let timer;
  return () => { clearTimeout(timer); timer = setTimeout(fn, ms); };
};

const observer = new MutationObserver((mutations) => {
  if (settings.paused) { return; }
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) { continue; }
      if (node.matches?.(SEL) && RUV.isVisible(node)) {
        processLink(/** @type {HTMLAnchorElement} */(node));
      } else if (node.querySelectorAll) {
        scan(node, false);
      }
    }
  }
});

window.addEventListener('scroll', debounce(() => scan(document, false), 50), { passive: true });
window.addEventListener('resize', debounce(() => scan(document, false), 50), { passive: true });

/**
 * Handles chrome.storage changes so the content script stays in sync with
 * the options page without requiring a page reload.
 * Colour changes are applied immediately by re-injecting the stylesheet.
 * Resuming from pause triggers a fresh scan for any links visible right now.
 */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') { return; }
  if (!changes[RUV.SETTINGS_KEY]) { return; }

  const newSettings = changes[RUV.SETTINGS_KEY].newValue;
  if (!newSettings) { return; }

  const merged = Object.assign({}, RUV.DEFAULTS, newSettings);

  const colorsChanged =
    merged.subColor !== settings.subColor ||
    merged.countColor !== settings.countColor ||
    merged.subTextColor !== settings.subTextColor ||
    merged.countTextColor !== settings.countTextColor;

  const wereJustUnpaused = settings.paused && !merged.paused;

  settings = merged;

  if (colorsChanged) { RUV.injectStyles(settings); }
  if (wereJustUnpaused) { scan(document, false); }
});

/**
 * Entry point: loads settings, injects styles, sets up the tooltip overlay,
 * runs the first scan, and starts the mutation observer.
 *
 * @returns {Promise<void>}
 */
const init = async () => {
  settings = await RUV.getSettings();
  RUV.injectStyles(settings);
  RUV.initTooltip();

  if (!settings.paused) {
    scan(document, true);
  }

  observer.observe(document.body, { childList: true, subtree: true });
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}