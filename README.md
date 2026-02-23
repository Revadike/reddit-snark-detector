# Reddit Snark Detector

A browser extension for Chrome and Firefox that identifies Reddit users who post in snark/commentary subreddits and labels them on their profile links.

## Features

- **Snarker** label (red/orange) — shown on users with posts in `/r/LeftoversH3` or `/r/h3snark`
- **Hasanabi Head** label (blue) — shown on users with posts in `/r/Hasan_Piker`
- Hover over any label to see exact post counts per subreddit (e.g. *"100+ posts on /r/LeftoversH3 and 3 posts on /r/h3snark"*)
- Fetches data using your Reddit session cookies (accurate, no rate-limiting for logged-in users)
- **1-week cache** per user stored in `chrome.storage.local` — expired entries are refreshed on next encounter

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
   *(for permanent install, package as `.zip` and submit to AMO)*

> **Tip:** You can keep both manifest files in the folder and just swap which one is named `manifest.json` depending on your browser.

