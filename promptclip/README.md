# PromptClip

PromptClip is a Chrome Manifest V3 extension that converts the current page into clean Markdown for pasting into LLMs.

It is plain HTML/CSS/JS. No React, no build step, no backend, no CDN, no remote code, and no network calls. Readability.js, Turndown, and tweetnacl are vendored under `lib/`.

## Privacy statement

No data leaves the browser. PromptClip reads the active tab only after the user clicks the toolbar button or uses the keyboard command. The extracted Markdown is displayed locally in the popup and can be copied or downloaded locally.

## Core flow

1. User clicks the toolbar button.
2. The popup opens and uses `chrome.scripting.executeScript` to inject local extension files into the active tab.
3. `content/extract.js` runs Mozilla Readability on a cloned DOM so the live page is not mutated.
4. If Readability fails or produces too little content, PromptClip enters fallback mode and strips common page chrome such as nav, footer, aside, script, and style nodes.
5. Turndown converts the resulting HTML into Markdown.
6. The popup displays a preview, estimated token count using `chars / 4`, raw character comparison, Copy, and Download `.md` buttons.

The preview is truncated after 50,000 characters. Copy and Download always use the full Markdown.

## Permissions

PromptClip requests only these permissions:

- `activeTab`: temporary access to the current tab after user action. This avoids broad host permissions.
- `scripting`: injects local extractor and bundled libraries into the active tab at click time.
- `storage`: stores `pc_settings`, `pc_license`, and `pc_onboarded` locally.
- `clipboardWrite`: copies generated Markdown to the clipboard.
- `tabs`: reads the active tab URL/title and supports the keyboard shortcut flow.

Host permissions: none.

## Storage keys

- `pc_settings`: local settings such as YAML template metadata placeholder.
- `pc_license`: locally stored offline license JSON.
- `pc_onboarded`: first-run onboarding flag.

PromptClip does not use IndexedDB.

## Local install

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select the `PromptClip/` folder.
5. Open a normal article page and click the PromptClip toolbar icon.

Chrome blocks extensions from reading `chrome://`, Web Store, extension, browser-internal, and some special pages. PromptClip shows an error instead of a blank popup.

## Keyboard shortcut

Default command:

- macOS: `Command+Shift+P`
- Windows/Linux/ChromeOS: `Alt+Shift+P`

You can change it at `chrome://extensions/shortcuts`.

## Pro placeholders

The UI includes gated placeholders for:

- Batch export of all open tabs into one Markdown bundle with a table of contents.
- Custom YAML front-matter template.
- Upsell modal showing first tab unlocked, rest locked, and “Unlock lifetime $19”.

The license system is offline-only and stores the license under `pc_license`.

## Offline license signing

PromptClip uses Ed25519 signatures through vendored tweetnacl.

Generate a keypair outside version control:

```sh
node scripts/generate-key.mjs ../private/promptclip-ed25519-keypair.json
```

The script prints the base64 public key. Paste that value into `LICENSE_PUBLIC_KEY_B64` in `popup/popup.js` before production packaging.

Sign a license:

```sh
node scripts/sign-license.mjs ../private/promptclip-ed25519-keypair.json user@example.com lifetime
```

Never commit the private key. The repository intentionally does not include one.

License JSON shape:

```json
{
  "email": "user@example.com",
  "product": "PromptClip",
  "expires": "lifetime",
  "signature": "base64-ed25519-signature"
}
```

## Package for Chrome Web Store

Run:

```sh
make package
```

This creates `promptclip.zip` from the extension folder.

Manual equivalent:

```sh
zip -r promptclip.zip . -x "*.DS_Store" -x "private/*" -x "*.git/*"
```

Upload `promptclip.zip` in the Chrome Web Store Developer Dashboard.

## Chrome Web Store disclosure text

Single purpose:

PromptClip converts the active browser tab into clean Markdown for local copying or downloading.

Data usage:

PromptClip reads page content only after the user clicks the extension or invokes its keyboard command. It processes the page locally in the browser. No page content, license key, settings, analytics, or personal data are transmitted to any server.

Permissions justification:

PromptClip uses `activeTab` and `scripting` to inject local extraction scripts into the current tab after explicit user action, `storage` for local settings/license/onboarding flags, `clipboardWrite` for copying Markdown, and `tabs` to identify the current tab and support keyboard shortcut behavior. It declares no host permissions.

Remote code:

PromptClip does not load remote code. All libraries are bundled locally in `lib/`.

## Test checklist

Site types:

- News/article page with clear main content: should use Readability mode.
- Documentation page with code blocks: should preserve headings, links, and fenced code.
- Marketing/SaaS landing page: may use fallback mode but should not blank.
- Long page over 50k Markdown chars: preview truncates, Copy and Download use full text.
- Page with tables: tables are preserved as HTML inside Markdown to avoid lossy conversion.

Error pages:

- `chrome://extensions`: shows blocked-page error.
- Chrome Web Store page: shows blocked-page error.
- Direct `.pdf` URL: shows PDF unsupported error.
- Empty or blocked page: shows a readable error, never a blank popup.

License:

- Fresh profile: onboarding hint appears, then dismiss persists `pc_onboarded`.
- License with matching public key: accepted and stored as `pc_license`.
- Tampered license payload: rejected.
- Invalid JSON: rejected.

Packaging:

- `make package` creates `promptclip.zip`.
- Zip contains no private key.
- Zip contains `manifest.json`, `popup/`, `content/`, `sw.js`, `lib/`, `icons/`, `scripts/`, `samples/`, and `README.md`.

## File map

```text
manifest.json
sw.js
popup/popup.html
popup/popup.css
popup/popup.js
content/extract.js
lib/readability/Readability.js
lib/turndown/turndown.js
lib/tweetnacl/nacl-fast.js
icons/icon.svg
icons/icon16.png
icons/icon32.png
icons/icon48.png
icons/icon128.png
scripts/generate-key.mjs
scripts/sign-license.mjs
samples/expected-output.md
Makefile
```

## Notes for maintainers

The source uses `AIDEV-NOTE` comments where a decision may not be obvious, such as using `activeTab` instead of host permissions and preserving tables as HTML.
