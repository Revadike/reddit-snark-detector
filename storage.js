/**
 * Reddit User Vibe — Storage Helpers
 * Thin wrappers around chrome.storage.local plus settings and cache accessors.
 * Depends on: config.js (RUV namespace)
 */

/**
 * Reads a single keyed value from chrome.storage.local.
 * Returns null if the key is absent or on any error.
 *
 * @param {string} key  Full storage key.
 * @returns {Promise<any|null>}
 */
RUV.storageGet = (key) => {
    return new Promise((resolve) => {
        try {
            chrome.storage.local.get(key, (result) => {
                resolve(result[key] ?? null);
            });
        } catch {
            resolve(null);
        }
    });
};

/**
 * Writes a value to chrome.storage.local. Silently swallows errors.
 *
 * @param {string} key    Full storage key.
 * @param {any}    value  Serialisable value to persist.
 * @returns {Promise<void>}
 */
RUV.storageSet = (key, value) => {
    return new Promise((resolve) => {
        try {
            chrome.storage.local.set({ [key]: value }, resolve);
        } catch {
            resolve();
        }
    });
};

/**
 * Loads the current settings from storage, merging any missing keys with
 * RUV.DEFAULTS so callers always receive a complete settings object.
 *
 * @returns {Promise<RUVSettings>}
 */
RUV.getSettings = async () => {
    const saved = await RUV.storageGet(RUV.SETTINGS_KEY);
    return Object.assign({}, RUV.DEFAULTS, saved || {});
};

/**
 * Persists settings to storage. Callers are responsible for passing a
 * complete settings object (use getSettings + spread to apply partial changes).
 *
 * @param {RUVSettings} settings
 * @returns {Promise<void>}
 */
RUV.saveSettings = async (settings) => {
    await RUV.storageSet(RUV.SETTINGS_KEY, settings);
};

/**
 * Returns cached per-user subreddit data if it exists and has not expired.
 * A cache hit is a stored entry whose `fetchedAt` timestamp is younger than
 * cacheDurationMs milliseconds.
 *
 * @param {string} username       Reddit username (case preserved as returned by API).
 * @param {number} cacheDurationMs  Maximum age in milliseconds.
 * @returns {Promise<Array<{subreddit:string,count:number}>|null>}
 *   Cached data array, or null if absent / expired.
 */
RUV.getCachedUser = async (username, cacheDurationMs) => {
    const entry = await RUV.storageGet(RUV.STORAGE_KEY_PREFIX + username);
    if (!entry) { return null; }
    if ((Date.now() - entry.fetchedAt) >= cacheDurationMs) { return null; }
    return entry.data;
};

/**
 * Removes all per-user cache entries from chrome.storage.local.
 * Called when API settings change so stale data is not served.
 *
 * @returns {Promise<void>}
 */
RUV.clearAllUserCache = async () => {
    const all = await new Promise((resolve) => chrome.storage.local.get(null, resolve));
    const keys = Object.keys(all).filter((k) => k.startsWith(RUV.STORAGE_KEY_PREFIX));
    if (keys.length === 0) { return; }
    await new Promise((resolve) => chrome.storage.local.remove(keys, resolve));
    console.log(`[RUV] Cleared ${keys.length} user cache entries`);
};

/**
 * Writes per-user subreddit data to the cache, stamping the current time.
 *
 * @param {string} username Reddit username.
 * @param {Array<{subreddit:string,count:number}>} data
 * @returns {Promise<void>}
 */
RUV.setCachedUser = async (username, data) => {
    await RUV.storageSet(RUV.STORAGE_KEY_PREFIX + username, {
        fetchedAt: Date.now(),
        data,
    });
};
