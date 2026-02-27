/**
 * Reddit User Vibe — Shared Configuration & Defaults
 * Loaded first; creates the global RUV namespace used by all following scripts.
 */

/**
 * Global namespace for all Reddit User Vibe modules.
 * Declared on window so it is accessible to all subsequent content scripts.
 * @type {object}
 */
window.RUV = {};

/** @type {string} Prefix for per-user cache entries in chrome.storage.local. */
RUV.STORAGE_KEY_PREFIX = 'ruv_user_';

/** @type {string} Key under which extension settings are stored. */
RUV.SETTINGS_KEY = 'ruv_settings';

/** @type {string} Base URL for the Arctic Shift subreddit-interactions endpoint. */
RUV.API_BASE = 'https://arctic-shift.photon-reddit.com/api/users/interactions/subreddits';

/** @type {number} Maximum consecutive all-null fetch retries before giving up. */
RUV.MAX_RETRIES = 5;

/**
 * Default settings shown in the options page and used when no saved settings exist.
 *
 * @typedef {object} RUVSettings
 * @property {number}  limit          - Max number of subreddits returned by the API.
 * @property {string}  after          - Relative time window for the API query (e.g. "3month").
 *                                      Empty string means "all time" (parameter not sent).
 * @property {string}  subColor       - Background color of the subreddit section of a pill.
 * @property {string}  countColor     - Background color of the count section of a pill.
 * @property {string}  subTextColor   - Text color of the subreddit section of a pill.
 * @property {string}  countTextColor - Text color of the count section of a pill.
 * @property {number}  cacheDays      - Number of days before cached data expires.
 * @property {boolean} paused         - When true the extension does not annotate any links.
 */

/** @type {RUVSettings} */
RUV.DEFAULTS = {
    limit: 10,
    after: '6month',
    subColor: '#6a5cff',
    countColor: '#d93900',
    subTextColor: '#ffffff',
    countTextColor: '#ffffff',
    cacheDays: 7,
    paused: false,
};
