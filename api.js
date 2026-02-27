/**
 * Reddit User Vibe — API & Rate-Limit Module
 * Fetches top subreddits for a user from the Arctic Shift API, with rate-limit
 * handling identical to the browser's Reddit API (same response headers).
 * Depends on: config.js, storage.js
 */

/** @type {number} Epoch ms until which all fetches should pause. */
RUV._rateLimitPauseUntil = 0;

/**
 * @typedef {{ promise: Promise<void>, resolve: function(): void }} Signal
 * One-shot promise that can be resolved externally to wake sleeping callers.
 */

/**
 * Creates a one-shot signal: a Promise that can be resolved from outside.
 * Used to let {@link RUV._waitIfRateLimited} be woken early by
 * {@link RUV.clearRateLimit} without waiting for the full timer to expire.
 *
 * @returns {Signal}
 */
RUV._makeSignal = () => {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    return { promise, resolve };
};

/** @type {Signal} Replaced each time clearRateLimit is called. */
RUV._rateLimitClearSignal = RUV._makeSignal();

/**
 * Parses the x-ratelimit-* headers from an API response.
 *
 * @param {Headers} headers
 * @returns {{ remaining: number, reset: number }}  reset is seconds from now.
 */
RUV._parseRateLimit = (headers) => {
    return {
        remaining: parseFloat(headers.get('x-ratelimit-remaining') ?? '99'),
        reset: parseInt(headers.get('x-ratelimit-reset') ?? '0', 10),
    };
};

/**
 * Suspends execution until the rate-limit pause window has elapsed.
 * Re-checks after every wake in case rateLimitPauseUntil was extended.
 * Also wakes immediately when {@link RUV.clearRateLimit} is called.
 *
 * @returns {Promise<void>}
 */
RUV._waitIfRateLimited = async () => {
    while (Date.now() < RUV._rateLimitPauseUntil) {
        const remaining = RUV._rateLimitPauseUntil - Date.now();
        console.debug(`[RUV] Pausing ${Math.ceil(remaining / 1000)}s for rate limit`);
        await Promise.race([
            new Promise((r) => setTimeout(r, remaining)),
            RUV._rateLimitClearSignal.promise,
        ]);
    }
};

/**
 * Clears the rate-limit pause immediately and wakes all sleeping
 * {@link RUV._waitIfRateLimited} calls, then resets the signal for future use.
 *
 * @returns {void}
 */
RUV.clearRateLimit = () => {
    RUV._rateLimitPauseUntil = 0;
    RUV._rateLimitClearSignal.resolve();
    RUV._rateLimitClearSignal = RUV._makeSignal();
};

/**
 * Returns a human-readable description of the current rate-limit state,
 * used as a tooltip on the loading placeholder badge.
 *
 * @returns {string}
 */
RUV.rateLimitTip = () => {
    const pauseMs = RUV._rateLimitPauseUntil - Date.now();
    return pauseMs > 0
        ? `Rate limited — data available at ${new Date(RUV._rateLimitPauseUntil).toLocaleTimeString()} (click to retry now)`
        : 'Loading…';
};

/**
 * Fetches the top subreddits for a user from the Arctic Shift API.
 * Returns null on network error or non-OK HTTP status so callers can skip
 * caching and retry.
 *
 * @param {string}      username  Reddit username.
 * @param {number}      limit     Maximum number of subreddits to return.
 * @param {string}      after     Relative time window (e.g. "3month"). Pass ""
 *                                to omit the parameter and query all time.
 * @returns {Promise<Array<{subreddit:string,count:number}>|null>}
 */
RUV.fetchUserSubreddits = async (username, limit, after) => {
    await RUV._waitIfRateLimited();

    const params = new URLSearchParams({ author: username, limit: String(limit) });
    if (after) { params.set('after', after); }
    const url = `${RUV.API_BASE}?${params}`;

    let res;
    try {
        res = await fetch(url);
    } catch (err) {
        console.warn('[RUV] Network error:', err);
        return null;
    }

    console.log(`[RUV] GET ${url} → ${res.status}`);

    const { remaining, reset } = RUV._parseRateLimit(res.headers);

    if (remaining < 2) {
        RUV._rateLimitPauseUntil = Date.now() + reset * 1000;
        console.debug(`[RUV] Rate limit low (${remaining} remaining) — pausing ${reset}s`);
    }

    if (res.status === 429) {
        RUV._rateLimitPauseUntil = Date.now() + reset * 1000;
        console.debug(`[RUV] 429 received — pausing ${reset}s`);
        return null;
    }

    if (!res.ok) { return null; }

    let json;
    try { json = await res.json(); } catch { return null; }

    // Response shape: { data: [{ subreddit: string, count: number }] }
    const data = json?.data;
    if (!Array.isArray(data)) { return null; }
    return data; // already sorted by count descending
};

/**
 * Map of username → in-flight Promise so concurrent calls for the same user
 * share one network request instead of racing.
 * @type {Map<string, Promise<Array<{subreddit:string,count:number}>|null>>}
 */
RUV._inFlight = new Map();

/**
 * Returns cached or freshly-fetched subreddit data for a user.
 *
 * Cache hits are served immediately without a network request.
 * On a miss, a single fetch is launched; concurrent callers for the same
 * username join that promise instead of starting duplicate requests.
 * Results that are null (fetch failed) are never cached so the next call
 * will attempt a fresh fetch.
 *
 * @param {string}      username  Reddit username.
 * @param {RUVSettings} settings  Current extension settings.
 * @returns {Promise<Array<{subreddit:string,count:number}>|null>}
 */
RUV.getUserData = async (username, settings) => {
    const cacheDurationMs = settings.cacheDays * 24 * 60 * 60 * 1000;
    const cached = await RUV.getCachedUser(username, cacheDurationMs);
    if (cached !== null) { return cached; }

    if (RUV._inFlight.has(username)) { return RUV._inFlight.get(username); }

    const promise = (async () => {
        const data = await RUV.fetchUserSubreddits(username, settings.limit, settings.after);
        if (data !== null) {
            await RUV.setCachedUser(username, data);
        }
        return data;
    })();

    RUV._inFlight.set(username, promise);
    try {
        return await promise;
    } finally {
        RUV._inFlight.delete(username);
    }
};
