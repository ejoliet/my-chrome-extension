# Still Companion

A self-contained Manifest V3 Chrome extension that adds RSS/Atom feeds from the page you are visiting to the bundled Still reader.

## Install (local)

1. Extract the ZIP.
2. Visit `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**.
3. Select the `still-companion` directory containing `manifest.json`.
4. Open a site offering RSS or Atom, click the Still toolbar icon, and press **Add** next to a feed.
5. Approve the per-feed website access prompt. The Still reader opens in a tab with the feed subscribed.
6. Use **Open reader** from the popup thereafter.

The reader has a built-in **Add a feed** dialog, read/unread controls, saved stories, search, local persistence, encrypted feed export/import, and a reset control. After importing, grant host permission for each domain by removing/re-adding from the reader or by subscribing through the popup. Existing subscriptions in the original standalone HTML do *not* migrate automatically because website and extension storage are isolated; export there and import in the extension.

## Security and permissions

- `activeTab`: access the current site only when the icon is clicked.
- `scripting`: inspect the page's declared RSS/Atom alternate links using a user-triggered script.
- `storage`: pass newly subscribed feed URLs from the popup to the reader using a small queue.
- `optional_host_permissions`: requested individually for each feed URL's host, enabling cross-origin RSS reads directly from extension pages.
- `cookies` permission is **not** requested and credentials are never copied or exported. Some authenticated feeds may work when the reader's 'send browser cookies' option is enabled and Chrome permits the credentials. Many will not.

The article library is held in IndexedDB inside the extension origin. No analytics, servers, or third-party proxy are used. Visiting feed URLs inherently reveals requests to those websites. Unencrypted export is available: do not share an unencrypted export if your feed URLs contain secrets. Encryption exports subscription details only, not articles or cookies.

## Limits

- RSS 2.0 and Atom supported. JSON Feed and heavily nonstandard feeds are not supported.
- Discovery inspects the current page's `<link rel="alternate">` declarations, not arbitrary domain crawling.
- There is no background refresh. Refresh from the reader. Browser cookies depend on Chrome's SameSite / third-party cookie rules.
- Host permission must be granted to refresh each domain. Feed URLs should not include embedded credentials or tokens.
- Only use the extension with trusted feed sources. Reader renders article titles and summaries as escaped text.
- The standalone local HTML has a different IndexedDB origin; use exports to migrate.

## Test checklist

1. Open a website declaring `application/rss+xml` and click the extension icon. Verify feed discovery.
2. Subscribe and grant access. Verify reader tab opens and feed appears.
3. Click Refresh; verify items display, read and save persist after closing and reopening.
4. Revoke site permission from `chrome://extensions` → Still → Site access; refresh should show an error.
5. Try a website with no declared feed; verify manual URL input.
6. Export and import feed collections, including encrypted export.
7. Clear data using reader's Share/backup dialog and reload.

## Development / packaging

No build dependencies. Use `bash scripts/package.sh` from this directory. JS syntax and manifest checks can be run with `bash tests/check.sh` (Node.js + Python 3).

## v1.0.2 storage fix

Subscriptions now use `chrome.storage.local.stillFeeds` as the shared index between the popup and reader. Article content and read/saved history remain in IndexedDB. The reader migrates legacy `pendingFeeds` on its next launch, and preserves existing reader subscriptions. Popup additions are reflected live in an already-open reader tab. The reader also writes updates on manual add/remove/import/reset.

For a site returning HTTP 401/403 or an HTML sign-in page instead of XML, cookies can be blocked by SameSite rules or the feed may require separate authentication; host access does not bypass login. The extension does not extract or store session cookies.
