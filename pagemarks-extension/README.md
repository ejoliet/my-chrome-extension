# PageMarks — Notes on the Web

PageMarks is a local-first Chrome extension for attaching memory to webpages. Highlight text, annotate links, place draggable sticky notes anywhere on a page, add reactions and tags, and search everything later.

No account, backend, analytics, or remote code is used. Annotation data is stored in `chrome.storage.local` inside the current Chrome profile.

## Features

- Highlight selected text in five colors.
- Add comments, reactions, and tags to highlights.
- Right-click any link to attach a note.
- Place draggable sticky-note bubbles at a page position.
- Restore highlights using quote/context anchors rather than brittle CSS selectors.
- Page drawer for reviewing and editing annotations while reading.
- Cross-site library with search, filters, and inline editing.
- Export all notes as JSON, Markdown, CSV, or readable HTML.
- Merge a previous JSON backup back into the library.
- Context-menu actions and keyboard shortcuts.
- URL normalization removes fragments and common tracking parameters.

## Install locally

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose this `pagemarks-extension` directory.
5. Pin PageMarks from the extensions menu.

PageMarks operates on normal `http://` and `https://` pages. Chrome system pages such as `chrome://extensions` do not permit content-script injection.

## Usage

- Select text. Use the small floating palette to highlight it or add a comment.
- Right-click a link and choose **Add a note to this link**.
- Right-click blank page space and choose **Place a sticky note here**.
- Select the toolbar icon to open the current page drawer or library.

Keyboard shortcuts:

- `Alt+Shift+A`: open/close the current page drawer.
- `Alt+Shift+N`: add a sticky note near the center of the page.
- `Alt+Shift+H`: save the current text selection as a highlight.

Chrome lets users change shortcuts at `chrome://extensions/shortcuts`.

## Data model

The state is a versioned object keyed by normalized page URL. Text highlights store:

- selected quote,
- nearby prefix and suffix context,
- document text offsets,
- comment, color, reaction, tags, and timestamps.

The resolver first tests the previous offset, then scores matching quotations using surrounding context. If a page changes too substantially, the note remains available in the drawer and library even when the visual highlight cannot be restored.

## Permissions

- `storage`: persist local annotations and settings.
- `contextMenus`: add selection, link, page-note, and drawer actions.
- Page access is declared only for `http://*/*` and `https://*/*` so saved annotations can automatically reappear when a page is revisited.

## Project structure

- `manifest.json` — Manifest V3 definition.
- `background.js` — context menus, commands, and library opening.
- `content.js` / `content.css` — annotation engine and page UI.
- `popup.*` — toolbar popup.
- `manager.*` — searchable cross-site annotation library.
- `shared.js` — storage, URL normalization, import/export utilities.
- `icons/` — extension icons.

## Current limitations

- Chrome internal pages and the Chrome Web Store cannot be annotated.
- Highly dynamic pages may move or invalidate text anchors after major content changes.
- Notes are local to one Chrome profile. JSON export/import is the deliberate backup and transfer mechanism.
- Cross-device sync is intentionally not enabled because the product is local-first and `storage.sync` has tighter quotas.

## Packaging

From the parent directory:

```bash
zip -r pagemarks-extension.zip pagemarks-extension -x '*.DS_Store'
```
