# Tabscope

Chrome extension. Turns your browsing history into a local dashboard. Zero backend, zero network — reads `chrome.history` directly, renders in-tab with vanilla Canvas.

## Install (unpacked)

1. `chrome://extensions`
2. Enable **Developer mode** (top right)
3. **Load unpacked** → select this folder
4. Click the Tabscope toolbar icon

## What you get

| View | Data |
|------|------|
| KPI row | visits, unique pages, domains, visits/day, busiest day |
| Punchcard heatmap | weekday × hour visit density |
| Top domains | click a row to filter the pages table |
| Visits by hour | 24-bar histogram |
| Daily timeline | per-day visits, up to 180 days |
| Top pages table | favicon, title, url, count, last visit; live search |

Range switch in the header: 30d / 90d / 1y / all.

## Export

Buttons in the pages toolbar: **md / csv / json / urls**. Exports apply the
current range + domain filter + search (all matching rows, not just the 100
displayed), sorted by last visit desc.

| Format | Shape |
|--------|-------|
| md | grouped by day: `## 2026-07-06` then `- [Title](url) — N visits` |
| csv | `url,title,domain,visits,last_visit` (ISO timestamps) |
| json | array of `{url,title,domain,visits,last_visit}` |
| txt | one URL per line |

## Architecture

```
manifest.json    MV3, permissions: history + favicon
background.js    toolbar click → open/focus dashboard tab
dashboard.html   markup + styles (MV3 blocks inline scripts, not styles)
dashboard.js     chrome.history.search → getVisits per URL → aggregate → canvas
```

Data strategy: `history.search` returns one item per URL; exact timestamps come from `history.getVisits` on the top 4000 URLs (chunked, yields to UI). See `AIDEV-NOTE` in `dashboard.js`.

## Limits

- Chrome retains ~90 days of history by default. "1y" / "all" only show more if your profile keeps more.
- Heatmap/timeline built from the top 4000 URLs by visit count. Long-tail single-visit pages beyond that are excluded from time charts (still counted in the pages KPI).
- Chrome/Chromium/Brave/Edge only (MV3 + `_favicon`). Firefox needs a `browser.history` port.

## Optional: new-tab takeover

Add to `manifest.json` to make the dashboard your new-tab page:

```json
"chrome_url_overrides": { "newtab": "dashboard.html" }
```

## Privacy

No remote scripts, no fetch calls, no storage. Everything computed per page load, in memory, locally.
