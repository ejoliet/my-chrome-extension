# GistHost Linker

A small Chrome Manifest V3 extension that turns a GitHub Gist URL or raw Gist ID into a clickable GistHost demo URL.

Example:

```text
https://gist.github.com/ejoliet/f41dc311f2350309fe4f85652d8ede3a
```

becomes:

```text
https://gisthost.github.io/?f41dc311f2350309fe4f85652d8ede3a
```

## Features

- Accepts a full `gist.github.com` URL or raw Gist ID.
- Auto-loads the active tab when the popup opens on a Gist page.
- Generates and copies the `gisthost.github.io/?<gist_id>` URL.
- Fetches Gist metadata from the GitHub API.
- Lists Gist files and flags `index.html` as the likely demo entry.
- Optional GitHub token stored locally for private gist read access.

## Install locally

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder.
5. Pin **GistHost Linker** to the toolbar.

## Private gists

Open extension options and paste a GitHub token with the smallest possible scope for reading private gists.

The token is stored in `chrome.storage.local` and is used only for requests to `https://api.github.com/gists/<gist_id>`.

## Files

- `manifest.json` — MV3 extension manifest.
- `popup.html`, `popup.js` — main popup UI and gist link logic.
- `options.html`, `options.js` — token settings UI.
- `styles.css` — shared extension styling.
