(() => {
  'use strict';

  const STATE_KEY = 'pageMarksState';
  const SETTINGS_KEY = 'pageMarksSettings';
  const STATE_VERSION = 1;
  const COLORS = ['yellow', 'mint', 'blue', 'pink', 'violet'];
  const REACTIONS = ['', '💡', '✅', '❓', '❤️', '⚠️'];
  const TRACKING_PARAMS = new Set([
    'fbclid', 'gclid', 'dclid', 'msclkid', 'mc_cid', 'mc_eid', 'ref', 'ref_src'
  ]);

  function canonicalizeUrl(rawUrl) {
    try {
      const url = new URL(rawUrl);
      url.hash = '';
      for (const key of [...url.searchParams.keys()]) {
        if (key.toLowerCase().startsWith('utm_') || TRACKING_PARAMS.has(key.toLowerCase())) {
          url.searchParams.delete(key);
        }
      }
      if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/$/, '');
      return url.toString();
    } catch {
      return String(rawUrl || '').split('#')[0];
    }
  }

  function createId(prefix = 'note') {
    if (globalThis.crypto?.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function emptyState() {
    return { version: STATE_VERSION, pages: {} };
  }

  async function getState() {
    const result = await chrome.storage.local.get(STATE_KEY);
    const state = result[STATE_KEY];
    if (!state || typeof state !== 'object' || !state.pages) return emptyState();
    return state;
  }

  async function setState(state) {
    state.version = STATE_VERSION;
    await chrome.storage.local.set({ [STATE_KEY]: state });
    return state;
  }

  async function getPage(url) {
    const key = canonicalizeUrl(url);
    const state = await getState();
    return state.pages[key] || { url: key, title: '', notes: [], updatedAt: null };
  }

  async function savePage(page) {
    const key = canonicalizeUrl(page.url);
    const state = await getState();
    const next = {
      url: key,
      title: page.title || state.pages[key]?.title || '',
      notes: Array.isArray(page.notes) ? page.notes : [],
      updatedAt: new Date().toISOString()
    };
    state.pages[key] = next;
    await setState(state);
    return next;
  }

  async function upsertNote(url, note, pageTitle = '') {
    const page = await getPage(url);
    const now = new Date().toISOString();
    const normalized = {
      id: note.id || createId(note.type || 'note'),
      type: note.type || 'sticky',
      color: COLORS.includes(note.color) ? note.color : 'yellow',
      reaction: REACTIONS.includes(note.reaction) ? note.reaction : '',
      text: note.text || '',
      tags: Array.isArray(note.tags) ? note.tags : [],
      createdAt: note.createdAt || now,
      updatedAt: now,
      ...note
    };
    const index = page.notes.findIndex((item) => item.id === normalized.id);
    if (index >= 0) page.notes[index] = { ...page.notes[index], ...normalized, updatedAt: now };
    else page.notes.push(normalized);
    page.title = pageTitle || page.title;
    await savePage(page);
    return normalized;
  }

  async function deleteNote(url, noteId) {
    const key = canonicalizeUrl(url);
    const state = await getState();
    const page = state.pages[key];
    if (!page) return false;
    page.notes = page.notes.filter((note) => note.id !== noteId);
    page.updatedAt = new Date().toISOString();
    if (!page.notes.length) delete state.pages[key];
    await setState(state);
    return true;
  }

  async function clearAll() {
    await setState(emptyState());
  }

  async function getSettings() {
    const result = await chrome.storage.local.get(SETTINGS_KEY);
    return {
      defaultColor: 'yellow',
      showBadges: true,
      ...result[SETTINGS_KEY]
    };
  }

  async function setSettings(settings) {
    const current = await getSettings();
    const next = { ...current, ...settings };
    await chrome.storage.local.set({ [SETTINGS_KEY]: next });
    return next;
  }

  function flattenState(state) {
    return Object.values(state.pages || {}).flatMap((page) =>
      (page.notes || []).map((note) => ({
        pageUrl: page.url,
        pageTitle: page.title,
        ...note
      }))
    );
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function csvCell(value) {
    const text = Array.isArray(value) ? value.join(', ') : String(value ?? '');
    return `"${text.replaceAll('"', '""')}"`;
  }

  function formatDate(value) {
    if (!value) return '';
    try {
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium', timeStyle: 'short'
      }).format(new Date(value));
    } catch {
      return value;
    }
  }

  function noteLabel(note) {
    if (note.type === 'highlight') return 'Highlight';
    if (note.type === 'link') return 'Link note';
    return 'Sticky note';
  }

  function toMarkdown(state) {
    const pages = Object.values(state.pages || {}).sort((a, b) =>
      (b.updatedAt || '').localeCompare(a.updatedAt || '')
    );
    const out = ['# PageMarks annotations', '', `Exported: ${new Date().toISOString()}`, ''];
    for (const page of pages) {
      out.push(`## ${page.title || page.url}`, '', page.url, '');
      for (const note of page.notes || []) {
        out.push(`### ${note.reaction ? `${note.reaction} ` : ''}${noteLabel(note)}`);
        if (note.quote) out.push('', `> ${String(note.quote).replaceAll('\n', '\n> ')}`);
        if (note.linkUrl) out.push('', `Link: ${note.linkUrl}`);
        if (note.text) out.push('', note.text);
        if (note.tags?.length) out.push('', `Tags: ${note.tags.map((tag) => `\`${tag}\``).join(' ')}`);
        out.push('', `Updated: ${note.updatedAt || note.createdAt || ''}`, '');
      }
    }
    return out.join('\n');
  }

  function toCsv(state) {
    const rows = [[
      'page_title', 'page_url', 'type', 'reaction', 'color', 'quote', 'note',
      'link_url', 'tags', 'created_at', 'updated_at'
    ]];
    for (const note of flattenState(state)) {
      rows.push([
        note.pageTitle, note.pageUrl, note.type, note.reaction, note.color,
        note.quote, note.text, note.linkUrl, note.tags, note.createdAt, note.updatedAt
      ]);
    }
    return rows.map((row) => row.map(csvCell).join(',')).join('\n');
  }

  function toHtml(state) {
    const pages = Object.values(state.pages || {});
    const sections = pages.map((page) => `
      <section>
        <h2>${escapeHtml(page.title || page.url)}</h2>
        <p><a href="${escapeHtml(page.url)}">${escapeHtml(page.url)}</a></p>
        ${(page.notes || []).map((note) => `
          <article class="${escapeHtml(note.color)}">
            <h3>${escapeHtml(note.reaction || '')} ${escapeHtml(noteLabel(note))}</h3>
            ${note.quote ? `<blockquote>${escapeHtml(note.quote)}</blockquote>` : ''}
            ${note.linkUrl ? `<p><strong>Link:</strong> <a href="${escapeHtml(note.linkUrl)}">${escapeHtml(note.linkUrl)}</a></p>` : ''}
            ${note.text ? `<p>${escapeHtml(note.text).replaceAll('\n', '<br>')}</p>` : ''}
            ${note.tags?.length ? `<p class="tags">${note.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</p>` : ''}
            <small>${escapeHtml(formatDate(note.updatedAt || note.createdAt))}</small>
          </article>`).join('')}
      </section>`).join('');

    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>PageMarks annotations</title><style>
      body{font:16px/1.55 system-ui,sans-serif;max-width:900px;margin:40px auto;padding:0 20px;color:#17202a;background:#f7f8fb}h1{font-size:2rem}section{margin:32px 0}article{background:#fff;border:1px solid #dfe3ea;border-left:6px solid #ffd85a;border-radius:12px;padding:18px;margin:14px 0;box-shadow:0 8px 28px #17202a12}article.mint{border-left-color:#70dfb0}article.blue{border-left-color:#79b8ff}article.pink{border-left-color:#ff91bb}article.violet{border-left-color:#b59cff}blockquote{margin:12px 0;padding:10px 14px;background:#f3f5f8;border-radius:8px}.tags span{display:inline-block;padding:3px 8px;margin:2px;border-radius:999px;background:#edf0f5;font-size:.8rem}a{color:#315efb}small{color:#687386}
    </style></head><body><h1>PageMarks annotations</h1><p>Exported ${escapeHtml(formatDate(new Date().toISOString()))}</p>${sections}</body></html>`;
  }

  function downloadText(filename, text, mime = 'text/plain;charset=utf-8') {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  globalThis.PageMarks = {
    STATE_KEY,
    SETTINGS_KEY,
    STATE_VERSION,
    COLORS,
    REACTIONS,
    canonicalizeUrl,
    createId,
    emptyState,
    getState,
    setState,
    getPage,
    savePage,
    upsertNote,
    deleteNote,
    clearAll,
    getSettings,
    setSettings,
    flattenState,
    escapeHtml,
    formatDate,
    noteLabel,
    toMarkdown,
    toCsv,
    toHtml,
    downloadText
  };
})();
