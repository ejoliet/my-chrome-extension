# Linkscape — Page Link Collector

A local-only Chrome Manifest V3 extension that collects all standard links from the current tab and presents them in a searchable, filterable interface.

## Features

- Extracts HTTP, HTTPS, email, and telephone links from the active tab
- Deduplicates identical URLs
- Distinguishes internal, external, file, email, and phone links
- Shows link text, URL, nearby context, and favicon
- Search and category filters
- Per-link and bulk selection
- Copy one URL or all selected URLs
- Export selected links as TXT, CSV, JSON, or Markdown
- Light and dark mode support
- No account, backend, analytics, or broad host permissions

## Install locally

1. Unzip this directory.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the `linkscape-extension` directory.
6. Open a normal website and click the Linkscape toolbar icon.

Chrome blocks extensions from inspecting protected pages such as `chrome://extensions`, the Chrome Web Store, and some browser-owned pages.

## Architecture

The popup queries the active tab, then uses `chrome.scripting.executeScript()` under the temporary `activeTab` grant. No content script remains installed, and no background service worker is needed.


## Site-aware filtering

The **Off-site** filter hides links belonging to the current website, including subdomains. It also recognizes common first-party aliases used by Reddit, GitHub, GitLab, Stack Exchange, YouTube, X/Twitter, Facebook, and LinkedIn. For example, a GitHub PR page treats `github.com` and `githubusercontent.com` as same-site while preserving links to external documentation and issue references.
