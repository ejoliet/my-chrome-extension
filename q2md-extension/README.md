# Page to Markdown — Amazon Q

Copy the current Amazon Q conversation, selected text, or the readable page as Markdown. The extension runs only after clicking its icon. Nothing is transmitted, logged, or stored by the extension.

## Install locally

1. Unzip `q2md-extension.zip` (or use this repository directly).
2. Open **`chrome://extensions`**, enable **Developer mode**.
3. Click **Load unpacked** and select the `q2md-extension/` directory (containing `manifest.json`).
4. Pin **Page to Markdown — Amazon Q** to the toolbar.

## Use

1. Open the AWS console and start an Amazon Q conversation (or open another webpage).
2. Click the extension icon. Its default source is **Amazon Q conversation** when detected, otherwise **Selected text** or **Page content**.
3. Inspect or edit the Markdown preview; click **Copy Markdown** or **Save .md**.
4. If chat detection fails, click **Pick a region on the page**, hover over the conversation panel, click to lock the selection, use **↑ Parent** to expand it, and click **Copy region**. Press Esc to exit.
5. If a conversation is embedded in a cross-origin AWS iframe, click **Allow embedded AWS frame** when offered. Chrome requests access to the listed AWS iframe origin(s). Then retry.

The export handles headings, text, links, emphasis, lists, code blocks, tables, and open Shadow DOM. It filters buttons, forms, scripts, hidden content, and navigation inside the chosen export region. Each iframe is inspected separately when browser permissions allow it.

## Permissions and privacy

- `activeTab`: temporary permission to read the tab you explicitly invoke the extension on.
- `scripting`: run the DOM reader on demand. No background, history, or network interception.
- `optional_host_permissions`: AWS subdomains, **not granted during install**. Only requested if a non-accessible embedded AWS iframe is detected and you click the grant button. Such grants are persistent until revoked in Chrome extension settings.
- No `tabs`, `storage`, `clipboardRead`, `downloads`, or broad host permission is requested.
- Data is held in popup memory until the popup closes. Copy writes to the local clipboard; Save creates a local `.md` file. No HTTP requests, accounts, analytics, external scripts, or data exfiltration.

**Sensitive data:** AWS console output can contain credentials, endpoints, account details, or private logs. Review the preview before saving or sharing it. Clipboard contents may be readable by other applications.

## Known limits

- Actual AWS console Amazon Q markup has **not been live-tested** against your logged-in AWS session. Target detection uses headings, accessibility labels, and container dimensions, not a private AWS API.
- Closed Shadow DOM, canvas-only renderers, protected Chrome pages, and inaccessible cross-origin frames cannot be read. Permissions do not override closed Shadow DOM or sandbox restrictions.
- Virtualized or unloaded chat history is not in the DOM: scroll/load older messages before exporting.
- A generic site can have noisy output: choose **Page content** or use **Pick a region on the page**. The region picker works only in the top document, not inside inaccessible cross-origin iframes.
- The automatic chat finder may miss a redesigned Q interface. Use **Page content** as fallback and report the markup for improved detection.
- Export cap: 240,000 Markdown characters per frame; long pages report truncation.
- The extension does not read chat data from AWS APIs or bypass the console's access controls.

## Test

Run `bash scripts/test.sh` from the repository root. This checks the manifest, JavaScript syntax, and runs the extractor against a dependency-free mock Document Object Model (DOM), covering a representative Amazon Q sidebar, open Shadow DOM, Markdown formatting, and unsafe URLs. The HTML fixture in `tests/fixture.html` is also available for manual browser inspection. Real AWS console testing remains necessary.

Then test in your own browser:

1. Open `tests/fixture.html` in Chrome. For a local `file://` fixture, enable **Allow access to file URLs** under the extension details. Click the extension and verify the conversation export excludes the EKS right panel.
2. In AWS console with Amazon Q open, export and check code blocks and hyperlinks.
3. Switch to Page content and Selected text, copy, and save.
4. Test **Pick a region on the page** by selecting the sidebar, moving up a parent if necessary, and copying.
5. Test an iframe permission flow, if the session embeds Q cross-origin.
6. Confirm Chrome internal pages return an understandable error.

## Architecture

`popup/popup.js` triggers `chrome.scripting.executeScript({allFrames: true})` to run `content/extract.js` in permitted frames. The returned result is kept only by the popup. The optional `content/picker.js` adds a short-lived on-page selection overlay and copies selected Markdown locally. No service worker is required.

## Package

Run `bash scripts/package.sh`. This produces `q2md-extension.zip` next to the project directory.

## License

MIT. Free; no monetization or unlock code.
