/* Tabscope dashboard — data source: chrome.history (live, no export needed).
 *
 * AIDEV-NOTE: data strategy
 *   1. chrome.history.search({text:'', startTime, maxResults: 100000})
 *      → one HistoryItem per URL (url, title, visitCount, lastVisitTime).
 *   2. chrome.history.getVisits({url}) per URL for exact per-visit timestamps
 *      (heatmap / hourly / daily need these). getVisits hits local SQLite —
 *      fast, but we cap at MAX_VISIT_URLS URLs (by visitCount desc) and run
 *      in chunks to keep the tab responsive.
 *   3. "all" range uses startTime: 0. Chrome only keeps ~90 days of history
 *      by default, so "1y"/"all" mostly matter for synced/long-retention setups.
 */

const MAX_ITEMS = 100000;
const MAX_VISIT_URLS = 4000;
const CHUNK = 200;

const $ = id => document.getElementById(id);
const fmt = n => Math.round(n).toLocaleString();
const state = { pages: [], domains: [], domainFilter: null, rangeDays: 90 };

/* ---------- data ---------- */

async function loadRange(days) {
  const status = $('status');
  status.textContent = 'reading history…';
  const startTime = days > 0 ? Date.now() - days * 864e5 : 0;

  const items = await chrome.history.search({ text: '', startTime, maxResults: MAX_ITEMS });

  state.pages = items.map(it => ({
    url: it.url,
    title: it.title || '',
    count: it.visitCount || 0,
    lastMs: it.lastVisitTime || null,
    domain: domainOf(it.url)
  })).sort((a, b) => b.count - a.count);

  // Per-visit timestamps for the top URLs
  const targets = state.pages.slice(0, MAX_VISIT_URLS);
  const times = [];
  const domainVisits = new Map();
  for (let i = 0; i < targets.length; i += CHUNK) {
    status.textContent = `reading visits… ${Math.min(i + CHUNK, targets.length)}/${targets.length} urls`;
    const chunk = targets.slice(i, i + CHUNK);
    const results = await Promise.all(chunk.map(p =>
      chrome.history.getVisits({ url: p.url }).catch(() => [])));
    results.forEach((visits, j) => {
      const dom = chunk[j].domain;
      for (const v of visits) {
        if (v.visitTime >= startTime) {
          times.push(v.visitTime);
          domainVisits.set(dom, (domainVisits.get(dom) || 0) + 1);
        }
      }
    });
    await new Promise(r => setTimeout(r)); // yield to UI
  }

  state.domains = [...domainVisits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  status.textContent = `${fmt(times.length)} visits · ${fmt(items.length)} pages`;
  render(times, startTime);
}

function domainOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, '') || '(local)'; }
  catch { return '(other)'; }
}

/* ---------- aggregation + KPIs ---------- */

function render(times, startTime) {
  const heat = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const hours = new Array(24).fill(0);
  const dayTotals = new Map();
  for (const t of times) {
    const d = new Date(t);
    heat[d.getDay()][d.getHours()]++;
    hours[d.getHours()]++;
    const key = localDayKey(d);
    dayTotals.set(key, (dayTotals.get(key) || 0) + 1);
  }

  $('kVisits').textContent = fmt(times.length);
  $('kUrls').textContent = fmt(state.pages.length);
  $('kDomains').textContent = fmt(new Set(state.pages.map(p => p.domain)).size);

  const spanDays = Math.max(1, (Date.now() - Math.max(startTime, minOf(times))) / 864e5);
  $('kPerDay').textContent = fmt(times.length / spanDays);

  let peak = ['–', 0];
  for (const [k, v] of dayTotals) if (v > peak[1]) peak = [k, v];
  $('kPeak').textContent = peak[0] === '–' ? '–' : `${peak[0]} (${fmt(peak[1])})`;

  const tlDays = Math.min(state.rangeDays > 0 ? state.rangeDays : 180, 180);
  $('tlTitle').textContent = `Daily activity · last ${tlDays} days`;

  drawHeatmap(heat);
  drawHours(hours);
  drawTimeline(dayTotals, tlDays);
  renderDomains();
  renderTable();
}

function localDayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function minOf(a) { let m = Infinity; for (const v of a) if (v < m) m = v; return m === Infinity ? Date.now() : m; }

/* ---------- canvas ---------- */

function ctx2d(id) {
  const c = $(id), dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth, h = parseInt(c.getAttribute('height'));
  c.width = w * dpr; c.height = h * dpr; c.style.height = h + 'px';
  const g = c.getContext('2d'); g.scale(dpr, dpr);
  return [g, w, h];
}

const HEAT_RAMP = ['#22272a', '#0d3f3e', '#0a706c', '#08bdba', '#3ddbd9'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONO = 'ui-monospace, Menlo, Consolas, monospace';

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function drawHeatmap(grid) {
  const [g, w, h] = ctx2d('heatmap');
  const left = 42, top = 20, gw = w - left - 8, gh = h - top - 8;
  const cw = gw / 24, ch = gh / 7;
  const max = Math.max(1, ...grid.flat());
  g.font = '10px ' + MONO;
  g.fillStyle = '#8b969c';
  for (let hr = 0; hr < 24; hr += 3) g.fillText(String(hr).padStart(2, '0'), left + hr * cw, 12);
  for (let d = 0; d < 7; d++) {
    g.fillStyle = '#8b969c';
    g.fillText(DAYS[d], 4, top + d * ch + ch / 2 + 3);
    for (let hr = 0; hr < 24; hr++) {
      const v = grid[d][hr];
      const idx = v === 0 ? 0 : Math.min(4, 1 + Math.floor((v / max) * 3.999));
      g.fillStyle = HEAT_RAMP[idx];
      roundRect(g, left + hr * cw + 1, top + d * ch + 1, cw - 2, ch - 2, 2);
      g.fill();
    }
  }
}

function drawHours(hours) {
  const [g, w, h] = ctx2d('hours');
  const left = 8, gw = w - left - 8, gh = h - 22 - 12;
  const bw = gw / 24, max = Math.max(1, ...hours);
  g.font = '10px ' + MONO;
  for (let i = 0; i < 24; i++) {
    const bh = (hours[i] / max) * gh;
    g.fillStyle = '#33b1ff';
    roundRect(g, left + i * bw + 2, 12 + gh - bh, bw - 4, Math.max(bh, 1), 2);
    g.fill();
    if (i % 3 === 0) { g.fillStyle = '#8b969c'; g.fillText(String(i).padStart(2, '0'), left + i * bw + 2, h - 8); }
  }
}

function drawTimeline(dayTotals, nDays) {
  const [g, w, h] = ctx2d('timeline');
  const left = 8, gw = w - left - 8, gh = h - 20 - 10;
  const days = [];
  for (let i = nDays - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5);
    const key = localDayKey(d);
    days.push([key, dayTotals.get(key) || 0]);
  }
  const max = Math.max(1, ...days.map(d => d[1]));
  const bw = gw / nDays;
  g.font = '10px ' + MONO;
  const labelEvery = Math.ceil(nDays / 6);
  days.forEach(([d, v], i) => {
    const bh = (v / max) * gh;
    g.fillStyle = v ? '#08bdba' : '#22272a';
    g.fillRect(left + i * bw + .5, 10 + gh - Math.max(bh, 2), Math.max(bw - 1, 1), Math.max(bh, 2));
    if (i % labelEvery === 0) { g.fillStyle = '#8b969c'; g.fillText(d.slice(5), left + i * bw, h - 6); }
  });
}

/* ---------- DOM lists ---------- */

function renderDomains() {
  const el = $('domains');
  const max = Math.max(1, ...state.domains.map(d => d[1]));
  el.textContent = '';
  for (const [name, n] of state.domains) {
    const row = document.createElement('div');
    row.className = 'dom-row' + (state.domainFilter === name ? ' active' : '');
    const nm = document.createElement('span'); nm.className = 'name'; nm.textContent = name; nm.title = name;
    const bar = document.createElement('span'); bar.className = 'bar';
    const fill = document.createElement('i'); fill.style.width = (n / max * 100).toFixed(1) + '%';
    bar.appendChild(fill);
    const cnt = document.createElement('span'); cnt.className = 'n'; cnt.textContent = fmt(n);
    row.append(nm, bar, cnt);
    row.addEventListener('click', () => {
      state.domainFilter = state.domainFilter === name ? null : name;
      $('clearFilter').style.display = state.domainFilter ? 'inline-block' : 'none';
      renderDomains(); renderTable();
    });
    el.appendChild(row);
  }
}

function faviconUrl(pageUrl) {
  const u = new URL(chrome.runtime.getURL('/_favicon/'));
  u.searchParams.set('pageUrl', pageUrl);
  u.searchParams.set('size', '16');
  return u.toString();
}

function filteredRows() {
  const qstr = $('search').value.trim().toLowerCase();
  let rows = state.pages;
  if (state.domainFilter) rows = rows.filter(p => p.domain === state.domainFilter);
  if (qstr) rows = rows.filter(p =>
    p.title.toLowerCase().includes(qstr) || p.url.toLowerCase().includes(qstr) || p.domain.includes(qstr));
  return rows;
}

function renderTable() {
  const rows = filteredRows();

  const body = $('pagesBody');
  body.textContent = '';
  for (const p of rows.slice(0, 100)) {
    const tr = document.createElement('tr');

    const tdPage = document.createElement('td');
    const img = document.createElement('img');
    img.className = 'fav'; img.src = faviconUrl(p.url); img.alt = '';
    const a = document.createElement('a');
    a.href = p.url; a.target = '_blank'; a.rel = 'noopener';
    a.textContent = p.title || p.domain;
    const u = document.createElement('span'); u.className = 'u'; u.textContent = p.url;
    tdPage.append(img, a, u);

    const tdN = document.createElement('td'); tdN.className = 'n'; tdN.textContent = fmt(p.count);
    const tdLast = document.createElement('td'); tdLast.className = 'n';
    tdLast.textContent = p.lastMs ? localDayKey(new Date(p.lastMs)) : '–';

    tr.append(tdPage, tdN, tdLast);
    body.appendChild(tr);
  }
  if (!rows.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 3; td.style.color = 'var(--dim)'; td.textContent = 'No matching pages.';
    tr.appendChild(td); body.appendChild(tr);
  }
}

/* ---------- export ---------- */
/* AIDEV-NOTE: exports apply the same filters as the table (range + domain +
   search) but without the 100-row display cap. Rows sorted by lastMs desc. */

function exportData(fmt) {
  const rows = [...filteredRows()].sort((a, b) => (b.lastMs || 0) - (a.lastMs || 0));
  const rangeLabel = state.rangeDays > 0 ? state.rangeDays + 'd' : 'all';
  const today = localDayKey(new Date());
  let text, ext, mime = 'text/plain';

  if (fmt === 'md') {
    const byDay = new Map();
    for (const p of rows) {
      const key = p.lastMs ? localDayKey(new Date(p.lastMs)) : 'undated';
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(p);
    }
    const parts = [
      `# Browsing history — ${rangeLabel}`,
      ``,
      `Exported ${today} · ${rows.length} pages` +
        (state.domainFilter ? ` · domain: ${state.domainFilter}` : '') +
        ($('search').value.trim() ? ` · search: "${$('search').value.trim()}"` : ''),
      ``
    ];
    for (const [day, pages] of byDay) {
      parts.push(`## ${day}`, ``);
      for (const p of pages.sort((a, b) => b.count - a.count)) {
        const title = (p.title || p.domain).replace(/([\[\]])/g, '\\$1');
        parts.push(`- [${title}](${p.url}) — ${p.count} visit${p.count === 1 ? '' : 's'}`);
      }
      parts.push(``);
    }
    text = parts.join('\n'); ext = 'md'; mime = 'text/markdown';
  } else if (fmt === 'csv') {
    const esc = s => `"${String(s ?? '').replace(/"/g, '""')}"`;
    text = ['url,title,domain,visits,last_visit',
      ...rows.map(p => [esc(p.url), esc(p.title), esc(p.domain), p.count,
        p.lastMs ? new Date(p.lastMs).toISOString() : ''].join(','))
    ].join('\n'); ext = 'csv'; mime = 'text/csv';
  } else if (fmt === 'json') {
    text = JSON.stringify(rows.map(p => ({
      url: p.url, title: p.title, domain: p.domain, visits: p.count,
      last_visit: p.lastMs ? new Date(p.lastMs).toISOString() : null
    })), null, 2); ext = 'json'; mime = 'application/json';
  } else { // txt — one URL per line
    text = rows.map(p => p.url).join('\n'); ext = 'txt';
  }

  const name = ['tabscope', rangeLabel, state.domainFilter, today]
    .filter(Boolean).join('-').replace(/[^\w.-]+/g, '_') + '.' + ext;
  const blob = new Blob([text], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

document.querySelectorAll('.exp').forEach(b =>
  b.addEventListener('click', () => exportData(b.dataset.fmt)));

/* ---------- events ---------- */

$('search').addEventListener('input', renderTable);
$('clearFilter').addEventListener('click', () => {
  state.domainFilter = null;
  $('clearFilter').style.display = 'none';
  renderDomains(); renderTable();
});
$('ranges').addEventListener('click', e => {
  const btn = e.target.closest('button[data-days]');
  if (!btn) return;
  document.querySelectorAll('#ranges button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  state.rangeDays = parseInt(btn.dataset.days, 10);
  state.domainFilter = null;
  $('clearFilter').style.display = 'none';
  loadRange(state.rangeDays);
});

loadRange(state.rangeDays);
