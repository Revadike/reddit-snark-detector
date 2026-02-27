/**
 * Reddit User Vibe — UI & DOM Helpers
 * Style injection, split-pill badge creation, and badge insertion logic for
 * both new Reddit (www.reddit.com) and old Reddit (old.reddit.com).
 * Depends on: config.js, api.js (RUV.rateLimitTip)
 */

/**
 * Builds the CSS text for the extension, using the provided settings for
 * colour values so that user-configured colours are always applied.
 *
 * @param {RUVSettings} settings
 * @returns {string}
 */
RUV._buildStyles = (settings) => {
    return `
    .ruv-badge-row {
      display: inline-flex;
      align-items: center;
      max-width: 400px;
      min-width: 0;
      margin-left: 5px;
      vertical-align: middle;
      line-height: 1;
    }
    .ruv-pills-scroll {
      display: flex;
      flex-wrap: nowrap;
      align-items: center;
      gap: 4px;
      flex: 1;
      min-width: 0;
      overflow-x: scroll;
      scrollbar-width: none;
      -ms-overflow-style: none;
    }
    .ruv-pills-scroll::-webkit-scrollbar { display: none; }
    .ruv-arrow {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: rgba(120,120,120,0.35);
      border: none;
      color: #eee;
      cursor: pointer;
      width: 14px;
      height: 16px;
      font-size: 13px;
      line-height: 1;
      border-radius: 3px;
      flex-shrink: 0;
      user-select: none;
      opacity: 0.75;
      padding: 0;
    }
    .ruv-arrow:hover { opacity: 1; background: rgba(120,120,120,0.6); }
    .ruv-arrow-left { margin-right: 2px; }
    .ruv-arrow-right { margin-left: 2px; }
    .ruv-arrow[hidden] { display: none !important; }
    .ruv-pill {
      display: inline-flex;
      align-items: stretch;
      border-radius: 20px;
      cursor: pointer;
      text-decoration: none !important;
      font-size: 10px;
      font-weight: 700;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      letter-spacing: 0.03em;
      white-space: nowrap;
      line-height: 1;
      transition: opacity 0.15s, transform 0.1s;
      user-select: none;
    }
    .ruv-pill:hover { opacity: 0.85; transform: scale(1.03); }
    .ruv-pill-sub {
      background: ${settings.subColor};
      color: ${settings.subTextColor};
      padding: 2px 6px 2px 7px;
      border-radius: 20px 0 0 20px;
    }
    .ruv-pill-count {
      background: ${settings.countColor};
      color: ${settings.countTextColor};
      padding: 2px 7px 2px 5px;
      border-radius: 0 20px 20px 0;
      font-weight: 900;
    }
    .ruv-pill-loading {
      background: #555;
      color: #ccc;
      padding: 2px 8px;
      border-radius: 20px;
      cursor: pointer;
    }
    #ruv-floating-tip {
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
};

/**
 * Injects or updates the extension's <style> element.
 * Safe to call multiple times — subsequent calls replace the existing styles.
 *
 * @param {RUVSettings} settings
 * @returns {void}
 */
RUV.injectStyles = (settings) => {
    let el = document.getElementById('ruv-styles');
    if (!el) {
        el = document.createElement('style');
        el.id = 'ruv-styles';
        (document.head || document.documentElement).appendChild(el);
    }
    el.textContent = RUV._buildStyles(settings);
};

/** @type {HTMLDivElement|null} Lazily created floating tooltip element. */
RUV._floatingTip = null;

/**
 * Ensures the shared floating tooltip element exists in the DOM.
 * Called once during initialisation.
 *
 * @returns {void}
 */
RUV.initTooltip = () => {
    if (RUV._floatingTip) { return; }
    const tip = document.createElement('div');
    tip.id = 'ruv-floating-tip';
    (document.body || document.documentElement).appendChild(tip);
    RUV._floatingTip = tip;

    document.addEventListener('mouseover', (e) => {
        const pill = e.target.closest?.('.ruv-pill');
        if (!pill || !pill.dataset.tip) { return; }
        tip.textContent = pill.dataset.tip;
        tip.style.display = 'block';
    });
    document.addEventListener('mouseout', (e) => {
        if (!e.target.closest?.('.ruv-pill')) { tip.style.display = 'none'; }
    });
    document.addEventListener('mousemove', (e) => {
        if (tip.style.display === 'none') { return; }
        tip.style.left = `${e.clientX + 12}px`;
        tip.style.top = `${e.clientY - 32}px`;
    });

    // Always hijack wheel events over any badge row to scroll the pills.
    document.addEventListener('wheel', (e) => {
        const row = e.target.closest?.('.ruv-badge-row');
        if (!row) { return; }
        const scroll = row.querySelector('.ruv-pills-scroll');
        if (!scroll) { return; }
        e.preventDefault();
        const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
        scroll.scrollLeft += delta;
        RUV.updateArrows(row);
    }, { passive: false });
};

/**
 * Shows or hides the scroll arrows on a badge row based on current scroll position.
 *
 * @param {HTMLSpanElement} row  The .ruv-badge-row element.
 * @returns {void}
 */
RUV.updateArrows = (row) => {
    const scroll = row.querySelector('.ruv-pills-scroll');
    const left = row.querySelector('.ruv-arrow-left');
    const right = row.querySelector('.ruv-arrow-right');
    if (!scroll || !left || !right) { return; }
    const atStart = scroll.scrollLeft <= 0;
    const atEnd = scroll.scrollLeft + scroll.clientWidth >= scroll.scrollWidth - 1;
    if (atStart) { left.setAttribute('hidden', ''); } else { left.removeAttribute('hidden'); }
    if (atEnd) { right.setAttribute('hidden', ''); } else { right.removeAttribute('hidden'); }
};

/**
 * Creates the structural shell of a badge row: a scrollable pill container
 * flanked by left/right arrow buttons.
 * Returns both the outer row element and the inner scroll container so
 * callers can append pills directly into the scroll container.
 *
 * @returns {{ row: HTMLSpanElement, scrollEl: HTMLSpanElement }}
 */
RUV._buildBadgeRow = () => {
    const row = document.createElement('span');
    row.className = 'ruv-badge-row';

    const leftArrow = document.createElement('button');
    leftArrow.type = 'button';
    leftArrow.className = 'ruv-arrow ruv-arrow-left';
    leftArrow.setAttribute('hidden', '');
    leftArrow.setAttribute('aria-label', 'Scroll pills left');
    leftArrow.textContent = '\u2039'; // ‹

    const scrollEl = document.createElement('span');
    scrollEl.className = 'ruv-pills-scroll';

    const rightArrow = document.createElement('button');
    rightArrow.type = 'button';
    rightArrow.className = 'ruv-arrow ruv-arrow-right';
    rightArrow.setAttribute('hidden', '');
    rightArrow.setAttribute('aria-label', 'Scroll pills right');
    rightArrow.textContent = '\u203a'; // ›

    leftArrow.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const pills = Array.from(scrollEl.querySelectorAll('.ruv-pill'));
        const cur = scrollEl.scrollLeft;
        // Scroll to the pill whose left edge is just before the current scroll position
        let target = null;
        for (let i = pills.length - 1; i >= 0; i--) {
            if (pills[i].offsetLeft < cur - 1) { target = pills[i]; break; }
        }
        scrollEl.scrollTo({ left: target ? target.offsetLeft : 0, behavior: 'smooth' });
    });

    rightArrow.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const pills = Array.from(scrollEl.querySelectorAll('.ruv-pill'));
        const rightEdge = scrollEl.scrollLeft + scrollEl.clientWidth;
        const target = pills.find((p) => p.offsetLeft + p.offsetWidth > rightEdge + 1);
        if (target) { scrollEl.scrollTo({ left: target.offsetLeft, behavior: 'smooth' }); }
    });

    scrollEl.addEventListener('scroll', () => RUV.updateArrows(row), { passive: true });

    row.appendChild(leftArrow);
    row.appendChild(scrollEl);
    row.appendChild(rightArrow);

    return { row, scrollEl };
};

/**
 * Builds the URL that a pill should open when clicked.
 * Uses old.reddit URLs when the current page is old.reddit.com,
 * www.reddit.com otherwise.
 *
 * @param {string} subreddit  Subreddit name.
 * @param {string} username   Reddit username.
 * @returns {string}
 */
RUV._pillClickUrl = (subreddit, username) => {
    const isOld = location.hostname === 'old.reddit.com';
    return isOld
        ? `https://old.reddit.com/r/${subreddit}/search?q=author:${username}`
        : `https://www.reddit.com/r/${subreddit}/search/?q=author:${encodeURIComponent(username)}`;
};

/**
 * Creates a split-pill badge element for a single subreddit entry.
 * The left half shows the subreddit name, the right half shows the post/comment count.
 * Clicking opens an author-scoped search in a new tab.
 *
 * @param {string} subreddit  Subreddit name (e.g. "DestinyTheGame").
 * @param {number} count      Activity count (posts + comments).
 * @param {string} username   Reddit username, used for the click-through URL.
 * @returns {HTMLSpanElement}
 */
RUV.createPill = (subreddit, count, username) => {
    const pill = document.createElement('span');
    pill.className = 'ruv-pill';
    pill.dataset.tip = `${count} post${count === 1 ? '' : 's'}/comments in r/${subreddit}`;

    const subPart = document.createElement('span');
    subPart.className = 'ruv-pill-sub';
    subPart.textContent = subreddit;

    const countPart = document.createElement('span');
    countPart.className = 'ruv-pill-count';
    countPart.textContent = String(count);

    pill.appendChild(subPart);
    pill.appendChild(countPart);

    pill.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.open(RUV._pillClickUrl(subreddit, username), '_blank');
    });

    return pill;
};

/**
 * Creates a grey "loading" placeholder pill that doubles as a rate-limit retry
 * button when the fetch is paused.
 *
 * @returns {HTMLSpanElement}
 */
RUV._createLoadingPill = () => {
    const pill = document.createElement('span');
    pill.className = 'ruv-pill';
    const inner = document.createElement('span');
    inner.className = 'ruv-pill-loading';
    inner.textContent = '…';
    pill.appendChild(inner);
    pill.dataset.tip = RUV.rateLimitTip();
    return pill;
};

/**
 * Finds the best DOM target to append a badge row into, accounting for the
 * different layouts of new Reddit and old Reddit.
 *
 * For new Reddit the inner flex div (avatar + username) is preferred so the
 * badges appear on the same line as the username regardless of outer wrapping.
 * For old Reddit (and any link without that inner flex div) the badge row is
 * inserted as a sibling element immediately after the link node.
 *
 * @param {HTMLAnchorElement} linkNode
 * @returns {{ mode: 'append', target: Element }|{ mode: 'after', target: Element }}
 */
RUV._getBadgeInsertPoint = (linkNode) => {
    const flexDiv = linkNode.querySelector('div.flex.items-center, div[class*="flex"][class*="items-center"]');
    if (flexDiv) { return { mode: 'append', target: flexDiv }; }

    return { mode: 'after', target: linkNode };
};

/**
 * Retrieves the badge row element associated with a given link node, or null
 * if one has not been inserted yet.
 *
 * @param {HTMLAnchorElement} linkNode
 * @returns {HTMLSpanElement|null}
 */
RUV._getBadgeRow = (linkNode) => {
    /** @type {string|undefined} */
    const rowId = linkNode.dataset.ruvRowId;
    if (!rowId) { return null; }
    return document.getElementById(rowId);
};

/**
 * Inserts a badge row into the page relative to the given link node.
 * Records the row's ID on the link's dataset so it can be retrieved later.
 * No-op if a badge row is already registered.
 *
 * @param {HTMLAnchorElement} linkNode
 * @param {HTMLSpanElement}   row
 * @returns {void}
 */
RUV._insertBadgeRow = (linkNode, row) => {
    if (linkNode.dataset.ruvRowId) { return; }

    // Assign a stable ID so we can find the row later even if it moved in the DOM
    const id = `ruv-row-${Math.random().toString(36).slice(2)}`;
    row.id = id;
    linkNode.dataset.ruvRowId = id;

    const { mode, target } = RUV._getBadgeInsertPoint(linkNode);
    if (mode === 'append') {
        target.appendChild(row);
    } else {
        target.insertAdjacentElement('afterend', row);
    }
};

/**
 * Inserts a loading placeholder badge next to the link node.
 * No-op if a badge row is already present for this link.
 *
 * @param {HTMLAnchorElement} linkNode
 * @returns {void}
 */
RUV.showLoadingLabel = (linkNode) => {
    if (RUV._getBadgeRow(linkNode)) { return; }
    const { row, scrollEl } = RUV._buildBadgeRow();
    scrollEl.appendChild(RUV._createLoadingPill());
    RUV._insertBadgeRow(linkNode, row);
};

/**
 * Updates the tooltip on an existing loading placeholder.
 * Gracefully does nothing if there is no loading pill for this link.
 *
 * @param {HTMLAnchorElement} linkNode
 * @returns {void}
 */
RUV.refreshLoadingTip = (linkNode) => {
    const row = RUV._getBadgeRow(linkNode);
    if (!row) { return; }
    const pill = row.querySelector('.ruv-pill');
    if (pill) { pill.dataset.tip = RUV.rateLimitTip(); }
};

/**
 * Replaces the loading placeholder with real split-pill badges, one per
 * subreddit entry sorted by count (highest first, as returned by the API).
 * Silently removes all badges if the data array is empty.
 *
 * @param {HTMLAnchorElement}                   linkNode
 * @param {Array<{subreddit:string,count:number}>} data  API response data.
 * @param {string}                              username
 * @returns {void}
 */
RUV.appendLabels = (linkNode, data, username) => {
    const existingRow = RUV._getBadgeRow(linkNode);
    if (existingRow) {
        existingRow.remove();
        delete linkNode.dataset.ruvRowId;
    }

    if (!data || data.length === 0) { return; }

    const { row, scrollEl } = RUV._buildBadgeRow();

    // API returns data sorted by count descending; preserve that order.
    for (const { subreddit, count } of data) {
        scrollEl.appendChild(RUV.createPill(subreddit, count, username));
    }

    RUV._insertBadgeRow(linkNode, row);

    // Measure overflow after the browser has laid out the row
    requestAnimationFrame(() => RUV.updateArrows(row));
};

/**
 * Returns true if el's bounding rect intersects the current viewport.
 *
 * @param {Element} el
 * @returns {boolean}
 */
RUV.isVisible = (el) => {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < window.innerHeight
        && r.right > 0 && r.left < window.innerWidth;
};
