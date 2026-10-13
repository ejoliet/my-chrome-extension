'use strict';

const PM = globalThis.PageMarks;
let state = PM.emptyState();
let activeFilter = 'all';
let saveTimers = new Map();
let ignoreStorageUntil = 0;

const library = document.querySelector('#library');
const search = document.querySelector('#search');
const sort = document.querySelector('#sort');
const toast = document.querySelector('#toast');

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 1800);
}

function escape(value) { return PM.escapeHtml(value); }
function safeColor(value) { return PM.COLORS.includes(value) ? value : 'yellow'; }

function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url; }
}

function updateOverview() {
  const notes = PM.flattenState(state);
  const pages = Object.values(state.pages || {}).filter((page) => page.notes?.length);
  const tags = new Set(notes.flatMap((note) => note.tags || []).map((tag) => tag.toLowerCase()));
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = notes.filter((note) => new Date(note.createdAt || 0).getTime() >= weekAgo).length;

  document.querySelector('#totalNotes').textContent = notes.length;
  document.querySelector('#totalPages').textContent = pages.length;
  document.querySelector('#totalTags').textContent = tags.size;
  document.querySelector('#recentCount').textContent = recent;
  document.querySelector('#navAll').textContent = notes.length;
  document.querySelector('#navHighlights').textContent = notes.filter((n) => n.type === 'highlight').length;
  document.querySelector('#navStickies').textContent = notes.filter((n) => n.type === 'sticky').length;
  document.querySelector('#navLinks').textContent = notes.filter((n) => n.type === 'link').length;
}

function filteredPages() {
  const query = search.value.trim().toLowerCase();
  let pages = Object.values(state.pages || {}).map((page) => ({
    ...page,
    notes: (page.notes || []).filter((note) => {
      const matchesType = activeFilter === 'all' || note.type === activeFilter;
      const haystack = [page.title, page.url, note.text, note.quote, note.linkUrl, ...(note.tags || [])].join(' ').toLowerCase();
      return matchesType && (!query || haystack.includes(query));
    })
  })).filter((page) => page.notes.length);

  if (sort.value === 'site') pages.sort((a, b) => domainOf(a.url).localeCompare(domainOf(b.url)));
  else {
    const field = sort.value === 'created' ? 'createdAt' : 'updatedAt';
    for (const page of pages) page.notes.sort((a, b) => (b[field] || '').localeCompare(a[field] || ''));
    pages.sort((a, b) => (b.notes[0]?.[field] || '').localeCompare(a.notes[0]?.[field] || ''));
  }
  return pages;
}

function noteCard(note) {
  return `<article class="note-card ${safeColor(note.color)}" data-note-id="${escape(note.id)}">
    <div class="note-top">
      <span>${note.reaction || (note.type === 'highlight' ? '▰' : note.type === 'link' ? '↗' : '✎')}</span>
      <span class="note-kind">${escape(PM.noteLabel(note))}</span>
      <span class="note-date">${escape(PM.formatDate(note.updatedAt || note.createdAt))}</span>
      <button class="icon-button" data-copy="${escape(note.id)}" title="Copy">⧉</button>
      <button class="icon-button" data-delete="${escape(note.id)}" title="Delete">×</button>
    </div>
    ${note.quote ? `<div class="quote">“${escape(note.quote)}”</div>` : ''}
    ${note.linkUrl ? `<a class="link-note" href="${escape(note.linkUrl)}" target="_blank" rel="noreferrer">${escape(note.linkUrl)}</a>` : ''}
    <textarea class="note-text" data-text="${escape(note.id)}" placeholder="Add a comment…">${escape(note.text || '')}</textarea>
    <div class="note-controls">
      <select data-reaction="${escape(note.id)}">${PM.REACTIONS.map((reaction) => `<option value="${escape(reaction)}" ${reaction === note.reaction ? 'selected' : ''}>${reaction || 'No reaction'}</option>`).join('')}</select>
      <select data-color="${escape(note.id)}">${PM.COLORS.map((color) => `<option value="${color}" ${color === note.color ? 'selected' : ''}>${color}</option>`).join('')}</select>
      <input class="tags-input" data-tags="${escape(note.id)}" value="${escape((note.tags || []).join(', '))}" placeholder="tags">
    </div>
  </article>`;
}

function render() {
  updateOverview();
  const pages = filteredPages();
  const count = pages.reduce((sum, page) => sum + page.notes.length, 0);
  document.querySelector('#resultMeta').textContent = `${count} annotation${count === 1 ? '' : 's'} across ${pages.length} page${pages.length === 1 ? '' : 's'}`;

  if (!pages.length) {
    library.innerHTML = `<div class="empty"><strong>No matching annotations</strong><span>Try another search or save notes from a webpage using PageMarks.</span></div>`;
    return;
  }

  library.innerHTML = pages.map((page) => {
    const domain = domainOf(page.url);
    return `<section class="site-group" data-page-url="${escape(page.url)}">
      <header class="site-head">
        <div class="favicon">${escape(domain.slice(0, 2))}</div>
        <div class="site-info"><strong>${escape(page.title || domain)}</strong><a href="${escape(page.url)}" target="_blank" rel="noreferrer">${escape(page.url)}</a></div>
        <span class="site-count">${page.notes.length} saved</span>
        <button class="open-site" data-open-page="${escape(page.url)}">Open page</button>
      </header>
      <div class="note-grid">${page.notes.map(noteCard).join('')}</div>
    </section>`;
  }).join('');
}

function findNote(noteId) {
  for (const page of Object.values(state.pages || {})) {
    const note = page.notes?.find((item) => item.id === noteId);
    if (note) return { page, note };
  }
  return null;
}

function debounceUpdate(noteId, patch) {
  clearTimeout(saveTimers.get(noteId));
  saveTimers.set(noteId, setTimeout(async () => {
    const found = findNote(noteId);
    if (!found) return;
    ignoreStorageUntil = Date.now() + 1200;
    const updated = await PM.upsertNote(found.page.url, { ...found.note, ...patch }, found.page.title);
    Object.assign(found.note, updated);
    saveTimers.delete(noteId);
    updateOverview();
  }, 450));
}

async function removeNote(noteId) {
  const found = findNote(noteId);
  if (!found) return;
  ignoreStorageUntil = Date.now() + 1200;
  await PM.deleteNote(found.page.url, noteId);
  found.page.notes = found.page.notes.filter((note) => note.id !== noteId);
  if (!found.page.notes.length) delete state.pages[found.page.url];
  render();
  showToast('Annotation deleted');
}

function exportData(type) {
  const stamp = new Date().toISOString().slice(0, 10);
  if (type === 'json') PM.downloadText(`pagemarks-backup-${stamp}.json`, JSON.stringify(state, null, 2), 'application/json');
  if (type === 'markdown') PM.downloadText(`pagemarks-${stamp}.md`, PM.toMarkdown(state), 'text/markdown;charset=utf-8');
  if (type === 'csv') PM.downloadText(`pagemarks-${stamp}.csv`, PM.toCsv(state), 'text/csv;charset=utf-8');
  if (type === 'html') PM.downloadText(`pagemarks-${stamp}.html`, PM.toHtml(state), 'text/html;charset=utf-8');
  showToast(`${type.toUpperCase()} export created`);
}

async function importJson(file) {
  try {
    const parsed = JSON.parse(await file.text());
    if (!parsed || typeof parsed !== 'object' || !parsed.pages || typeof parsed.pages !== 'object') throw new Error('Invalid PageMarks backup');
    const current = await PM.getState();
    for (const [url, incomingPage] of Object.entries(parsed.pages)) {
      const key = PM.canonicalizeUrl(url);
      const existing = current.pages[key] || { url: key, title: incomingPage.title || '', notes: [] };
      const byId = new Map(existing.notes.map((note) => [note.id, note]));
      for (const note of incomingPage.notes || []) {
        if (!note.id || !note.type) continue;
        byId.set(note.id, { ...byId.get(note.id), ...note });
      }
      current.pages[key] = { ...existing, ...incomingPage, url: key, notes: [...byId.values()] };
    }
    ignoreStorageUntil = Date.now() + 1200;
    await PM.setState(current);
    state = current;
    render();
    showToast('Backup imported and merged');
  } catch (error) {
    showToast(error.message || 'Could not import this file');
  }
}

document.querySelectorAll('.nav-item').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    activeFilter = button.dataset.filter;
    render();
  });
});

document.querySelectorAll('[data-export]').forEach((button) => button.addEventListener('click', () => exportData(button.dataset.export)));
document.querySelector('#importButton').addEventListener('click', () => document.querySelector('#importFile').click());
document.querySelector('#importFile').addEventListener('change', (event) => {
  const [file] = event.target.files;
  if (file) importJson(file);
  event.target.value = '';
});

document.querySelector('#deleteAll').addEventListener('click', async () => {
  if (!confirm('Delete every PageMarks annotation from this Chrome profile? This cannot be undone unless you exported a backup.')) return;
  ignoreStorageUntil = Date.now() + 1200;
  await PM.clearAll();
  state = PM.emptyState();
  render();
  showToast('All PageMarks data deleted');
});

search.addEventListener('input', render);
sort.addEventListener('change', render);

library.addEventListener('input', (event) => {
  if (event.target.dataset.text) debounceUpdate(event.target.dataset.text, { text: event.target.value });
  if (event.target.dataset.tags) debounceUpdate(event.target.dataset.tags, { tags: event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean) });
});

library.addEventListener('change', (event) => {
  if (event.target.dataset.reaction) debounceUpdate(event.target.dataset.reaction, { reaction: event.target.value });
  if (event.target.dataset.color) debounceUpdate(event.target.dataset.color, { color: event.target.value });
});

library.addEventListener('click', async (event) => {
  const open = event.target.closest('[data-open-page]');
  if (open) chrome.tabs.create({ url: open.dataset.openPage });
  const remove = event.target.closest('[data-delete]');
  if (remove) await removeNote(remove.dataset.delete);
  const copy = event.target.closest('[data-copy]');
  if (copy) {
    const found = findNote(copy.dataset.copy);
    if (!found) return;
    await navigator.clipboard.writeText([found.note.quote, found.note.text, found.note.linkUrl].filter(Boolean).join('\n\n'));
    showToast('Copied');
  }
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (Date.now() < ignoreStorageUntil) return;
  if (area === 'local' && changes[PM.STATE_KEY]) {
    state = await PM.getState();
    render();
  }
});

(async () => {
  state = await PM.getState();
  render();
})();
