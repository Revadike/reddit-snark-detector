# Reddit User Vibe

A browser extension for Chrome and Firefox that gives you an instant vibe of who's commenting. It displays coloured split-pill badges next to Reddit usernames showing their most active subreddits — visible at a glance without leaving the page.

Works on both **www.reddit.com** and **old.reddit.com**.

---

## How it works

When an author link scrolls into view the extension queries the [Arctic Shift API](https://github.com/ArthurHeitmann/arctic_shift) to retrieve that user's top subreddits by activity. A huge thank-you to **Arthur Heitmann** and the Arctic Shift project for making this data openly accessible — this extension would not be possible without it.

> **Note on activity counts:** the count shown on each pill represents **combined posts and comments** the user has made in that subreddit during the configured time period, not posts-only.

---

## Features

- **Split-pill badges** — each badge shows `[subreddit | count]` with distinct background colours for the subreddit name and the activity count.
- **All subreddits** — not limited to any specific community; shows whichever subreddits a user is most active in.
- **Sorted by activity** — pills are ordered highest-count first.
- **Click to search** — clicking a pill opens an author-scoped subreddit search (`/r/SUBREDDIT/search?q=author:USER`) in a new tab.
- **Visibility detection** — only processes links currently in the viewport; new content loaded by infinite scroll is picked up automatically.
- **De-duplication** — already-labelled links are skipped; concurrent requests for the same username are coalesced into one.
- **Rate-limit handling** — respects `x-ratelimit-*` headers; shows a clickable retry badge when paused.
- **1-week cache** (configurable) — user data is cached in `chrome.storage.local` and only re-fetched after expiry.
- **Options page** — configure API parameters, pill colours, cache duration, and pause/resume the extension without reloading the page.

---

## Options

Open the extension's options page (via the browser toolbar or `chrome://extensions` → Details → Extension options) to customise:

| Setting | Default | Description |
|---|---|---|
| Number of subreddits | 10 | How many top subreddits to show per user (1–100). |
| Time period | Last 6 months | Lookback window for the API query (1 week → all time). |
| Remember data for | 1 week | How long user data is cached before a fresh fetch. |
| Subreddit background | `#6a5cff` | Background colour of the subreddit half of each pill. |
| Subreddit text | `#ffffff` | Text colour of the subreddit half. |
| Count background | `#d93900` | Background colour of the count half of each pill. |
| Count text | `#ffffff` | Text colour of the count half. |
| Pause / Resume | Running | Temporarily stop annotating links without uninstalling. |

A live preview pill updates as you change colours. Click **Save** to persist, or **Reset to defaults** to restore all values.

---

## Installation

### Chrome (or Chromium-based: Edge, Brave, etc.)

1. Rename `manifest_chrome.json` → `manifest.json`  
   *(or copy it as `manifest.json`)*
2. Open `chrome://extensions/`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select this folder

### Firefox

1. Rename `manifest_firefox.json` → `manifest.json`  
   *(or copy it as `manifest.json`)*
2. Open `about:debugging#/runtime/this-firefox`
3. Click **Load Temporary Add-on…** and select the `manifest.json` file  
   *(for a permanent install, package as `.zip` and submit to AMO)*

> **Tip:** Keep both manifest files in the folder and swap which one is named `manifest.json` depending on your browser.

---

## File structure

```
config.js              Shared namespace (RUV) and default settings
storage.js             chrome.storage.local wrappers, cache helpers
api.js                 Arctic Shift API fetch + rate-limit handling
ui.js                  Style injection, split-pill creation, DOM helpers
content.js             Main orchestration: scan, observe, processLink
options.html           Options page markup
options.js             Options page logic
manifest_chrome.json   Manifest V3 for Chrome/Edge/Brave
manifest_firefox.json  Manifest V2 for Firefox
```

---

## Data & privacy

The extension only sends Reddit usernames to the Arctic Shift API (`arctic-shift.photon-reddit.com`). No personal data is collected or transmitted elsewhere. All cached data is stored locally in your browser via `chrome.storage.local`.
