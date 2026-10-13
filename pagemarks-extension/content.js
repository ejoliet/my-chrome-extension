(() => {
  'use strict';

  if (globalThis.__pageMarksLoaded) return;
  globalThis.__pageMarksLoaded = true;

  const PM = globalThis.PageMarks;
  const BLOCKED_TEXT_PARENTS = 'script,style,noscript,textarea,input,select,option,svg,canvas,[contenteditable="true"],[data-pagemarks-ignore]';
  const host = document.createElement('div');
  host.id = 'pagemarks-extension-root';
  host.setAttribute('data-pagemarks-ignore', 'true');
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });

  let pageUrl = PM.canonicalizeUrl(location.href);
  let pageData = { url: pageUrl, title: document.title, notes: [] };
  let settings = { defaultColor: 'yellow', showBadges: true };
  let pendingRange = null;
  let pendingRangeRect = null;
  let lastContextPoint = { x: innerWidth / 2, y: innerHeight / 2 };
  let panelOpen = false;
  let expandedStickyId = null;
  let activeComposerId = null;
  let resolvedRanges = new Map();
  let renderQueued = false;
  let mutationTimer = null;
  let saveTimers = new Map();
  let previousLocation = location.href;
  let ignoreStorageUntil = 0;

  shadow.innerHTML = `
    <style>
      :host{all:initial}
      *{box-sizing:border-box}
      .pm-layer{position:fixed;inset:0;z-index:2147483646;pointer-events:none;font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17202a;font-size:14px;line-height:1.35}
      button,input,textarea,select{font:inherit}
      button{border:0}
      .hidden{display:none!important}
      .pm-toolbar{position:fixed;display:flex;align-items:center;gap:5px;padding:7px;border:1px solid rgba(22,31,47,.12);border-radius:14px;background:rgba(255,255,255,.96);box-shadow:0 15px 45px rgba(17,27,52,.22);backdrop-filter:blur(16px);pointer-events:auto;transform:translate(-50%,-100%)}
      .pm-tool{width:28px;height:28px;border-radius:9px;background:#f3f5f8;display:grid;place-items:center;cursor:pointer;color:#273149;transition:.15s ease}
      .pm-tool:hover{transform:translateY(-1px);background:#e9edf4}
      .pm-swatch{width:18px;height:18px;border-radius:6px;border:2px solid rgba(23,32,42,.12);cursor:pointer;padding:0}
      .yellow{--pm-color:#ffd85a;--pm-soft:#fff7d3}.mint{--pm-color:#70dfb0;--pm-soft:#ddf8ec}.blue{--pm-color:#79b8ff;--pm-soft:#e1efff}.pink{--pm-color:#ff91bb;--pm-soft:#ffe3ee}.violet{--pm-color:#b59cff;--pm-soft:#eee9ff}
      .pm-swatch{background:var(--pm-color)}
      .pm-badge{position:fixed;min-width:25px;height:25px;padding:0 6px;border-radius:999px;background:var(--pm-color);border:2px solid white;box-shadow:0 5px 18px rgba(20,30,50,.25);display:grid;place-items:center;cursor:pointer;pointer-events:auto;font-size:12px;font-weight:800;color:#273149;transition:.15s ease}
      .pm-badge:hover{transform:scale(1.12)}
      .pm-sticky-dot{position:fixed;width:46px;height:46px;border-radius:50% 50% 50% 15%;background:var(--pm-color);border:2px solid rgba(255,255,255,.9);box-shadow:0 12px 30px rgba(21,31,53,.25);display:grid;place-items:center;cursor:grab;pointer-events:auto;font-size:20px;user-select:none}
      .pm-sticky-dot:active{cursor:grabbing}
      .pm-sticky-card{position:fixed;width:280px;min-height:175px;border-radius:18px;background:var(--pm-soft);border:1px solid color-mix(in srgb,var(--pm-color) 60%,#7d8491);box-shadow:0 22px 70px rgba(25,36,60,.28);overflow:hidden;pointer-events:auto}
      .pm-sticky-head{height:38px;padding:0 9px 0 12px;background:color-mix(in srgb,var(--pm-color) 72%,white);display:flex;align-items:center;gap:8px;cursor:grab;user-select:none}
      .pm-sticky-head:active{cursor:grabbing}
      .pm-sticky-title{font-size:12px;font-weight:800;letter-spacing:.02em;flex:1}
      .pm-icon-btn{width:27px;height:27px;border-radius:8px;background:rgba(255,255,255,.55);cursor:pointer;color:#273149}
      .pm-sticky-text{display:block;width:100%;min-height:104px;padding:14px;border:0;resize:vertical;background:transparent;outline:0;color:#182134;line-height:1.45}
      .pm-sticky-foot{display:flex;align-items:center;gap:6px;padding:8px 10px 10px}
      .pm-mini-select{height:30px;border:1px solid rgba(25,36,60,.13);border-radius:9px;background:rgba(255,255,255,.75);padding:0 7px;outline:0}
      .pm-saved{margin-left:auto;font-size:11px;color:#617087}
      .pm-composer{position:fixed;width:min(360px,calc(100vw - 28px));border:1px solid rgba(20,30,50,.14);border-radius:18px;background:rgba(255,255,255,.98);box-shadow:0 25px 80px rgba(18,29,54,.3);overflow:hidden;pointer-events:auto}
      .pm-composer-head{display:flex;align-items:center;gap:8px;padding:12px 13px;border-bottom:1px solid #e9edf3}
      .pm-composer-label{font-weight:850;flex:1}
      .pm-quote{margin:10px 12px 0;padding:10px 11px;border-radius:10px;background:#f3f5f8;color:#536078;font-size:12px;max-height:82px;overflow:auto}
      .pm-composer textarea{display:block;width:calc(100% - 24px);min-height:96px;margin:12px;padding:11px;border:1px solid #dce2eb;border-radius:12px;resize:vertical;outline:0;color:#17202a;background:#fff}
      .pm-composer textarea:focus,.pm-tags:focus{border-color:#315efb;box-shadow:0 0 0 3px rgba(49,94,251,.12)}
      .pm-composer-row{display:flex;align-items:center;gap:8px;padding:0 12px 10px}
      .pm-reactions{display:flex;gap:3px;flex-wrap:wrap}
      .pm-reaction{width:31px;height:31px;border-radius:9px;background:#f2f4f8;cursor:pointer}
      .pm-reaction.active{background:#e5eaff;box-shadow:inset 0 0 0 2px #315efb}
      .pm-colors{display:flex;gap:5px;margin-left:auto}
      .pm-tags{width:calc(100% - 24px);height:36px;margin:0 12px 11px;border:1px solid #dce2eb;border-radius:10px;padding:0 10px;outline:0}
      .pm-actions{display:flex;justify-content:flex-end;gap:8px;padding:11px 12px;background:#f7f8fb;border-top:1px solid #e9edf3}
      .pm-btn{height:36px;padding:0 14px;border-radius:10px;background:#edf0f5;color:#273149;font-weight:750;cursor:pointer}
      .pm-btn.primary{background:#315efb;color:white}.pm-btn.danger{color:#b52b3b;background:#ffe9ec}
      .pm-panel{position:fixed;top:12px;right:12px;bottom:12px;width:min(390px,calc(100vw - 24px));border:1px solid rgba(20,30,50,.13);border-radius:22px;background:rgba(250,251,253,.98);box-shadow:0 30px 100px rgba(15,26,50,.32);overflow:hidden;pointer-events:auto;display:flex;flex-direction:column;transform:translateX(calc(100% + 35px));transition:transform .23s ease;backdrop-filter:blur(18px)}
      .pm-panel.open{transform:translateX(0)}
      .pm-panel-head{padding:15px 15px 12px;background:white;border-bottom:1px solid #e8ecf2}
      .pm-brand-row{display:flex;align-items:center;gap:10px}
      .pm-logo{width:34px;height:34px;border-radius:11px;background:linear-gradient(145deg,#315efb,#7b5cff);color:white;display:grid;place-items:center;font-weight:900;box-shadow:0 8px 20px rgba(49,94,251,.3)}
      .pm-brand{font-size:17px;font-weight:900;letter-spacing:-.02em;flex:1}
      .pm-page-title{font-size:12px;color:#6a7587;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:8px}
      .pm-stats{display:flex;gap:7px;margin-top:11px}
      .pm-stat{padding:5px 8px;border-radius:999px;background:#f0f3f7;color:#586479;font-size:11px;font-weight:750}
      .pm-panel-tools{display:flex;gap:7px;padding:10px 12px;border-bottom:1px solid #e9edf3;background:#fbfcfd}
      .pm-search{height:37px;min-width:0;flex:1;border:1px solid #dce2eb;border-radius:11px;padding:0 11px;outline:0;background:white}
      .pm-list{flex:1;overflow:auto;padding:11px}
      .pm-empty{margin:35px 12px;padding:25px 16px;border:1px dashed #cfd6e2;border-radius:16px;text-align:center;color:#647086;background:white}
      .pm-note-card{border:1px solid #dfe4ec;border-left:5px solid var(--pm-color);border-radius:14px;background:white;padding:11px;margin-bottom:9px;box-shadow:0 5px 18px rgba(25,36,60,.05)}
      .pm-card-top{display:flex;align-items:center;gap:7px}
      .pm-kind{font-size:11px;font-weight:850;text-transform:uppercase;letter-spacing:.06em;color:#667188;flex:1}
      .pm-card-quote{margin:8px 0;padding:8px 9px;border-radius:9px;background:#f4f6f9;color:#586479;font-size:12px;max-height:75px;overflow:hidden}
      .pm-card-link{display:block;margin:8px 0;color:#315efb;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-decoration:none}
      .pm-card-text{width:100%;min-height:64px;padding:9px;border:1px solid #e0e5ed;border-radius:10px;resize:vertical;outline:0;background:#fff;color:#17202a}
      .pm-card-meta{display:flex;align-items:center;gap:6px;margin-top:8px}
      .pm-card-tags{height:30px;min-width:0;flex:1;border:1px solid #e0e5ed;border-radius:9px;padding:0 8px;outline:0}
      .pm-card-btn{width:30px;height:30px;border-radius:9px;background:#f1f3f7;cursor:pointer;color:#4c586e}
      .pm-panel-foot{display:flex;gap:7px;padding:10px 12px;border-top:1px solid #e8ecf2;background:white}
      .pm-toast{position:fixed;left:50%;bottom:25px;transform:translate(-50%,20px);opacity:0;padding:10px 14px;border-radius:12px;background:#17202a;color:white;box-shadow:0 12px 35px rgba(12,20,38,.25);pointer-events:none;transition:.2s ease;font-weight:700}
      .pm-toast.show{opacity:1;transform:translate(-50%,0)}
      @media (max-width:600px){.pm-panel{top:6px;right:6px;bottom:6px;width:calc(100vw - 12px);border-radius:18px}.pm-sticky-card{width:min(280px,calc(100vw - 20px))}}
      @media (prefers-reduced-motion:reduce){*{transition:none!important}}
    </style>
    <div class="pm-layer" data-pagemarks-ignore>
      <div id="pm-overlay"></div>
      <div id="pm-toolbar" class="pm-toolbar hidden" role="toolbar" aria-label="PageMarks selection tools">
        ${PM.COLORS.map((color) => `<button class="pm-swatch ${color}" data-highlight-color="${color}" title="Highlight ${color}"></button>`).join('')}
        <button class="pm-tool" data-highlight-note title="Highlight and add note">✎</button>
      </div>
      <div id="pm-composer" class="pm-composer hidden" role="dialog" aria-label="Edit annotation"></div>
      <aside id="pm-panel" class="pm-panel" aria-label="PageMarks annotations">
        <div class="pm-panel-head">
          <div class="pm-brand-row"><div class="pm-logo">P</div><div class="pm-brand">PageMarks</div><button class="pm-icon-btn" data-close-panel title="Close">×</button></div>
          <div id="pm-page-title" class="pm-page-title"></div>
          <div id="pm-stats" class="pm-stats"></div>
        </div>
        <div class="pm-panel-tools">
          <input id="pm-search" class="pm-search" type="search" placeholder="Search notes, quotes, tags…">
          <button class="pm-btn primary" data-add-sticky title="Add sticky note">+ Note</button>
        </div>
        <div id="pm-list" class="pm-list"></div>
        <div class="pm-panel-foot">
          <button class="pm-btn" data-export-page>Export page</button>
          <button class="pm-btn" data-open-manager>All notes</button>
          <button class="pm-btn" data-help title="Keyboard shortcuts">?</button>
        </div>
      </aside>
      <div id="pm-toast" class="pm-toast" role="status"></div>
    </div>`;

  const $ = (selector) => shadow.querySelector(selector);
  const overlay = $('#pm-overlay');
  const toolbar = $('#pm-toolbar');
  const composer = $('#pm-composer');
  const panel = $('#pm-panel');
  const list = $('#pm-list');
  const searchInput = $('#pm-search');
  const toast = $('#pm-toast');

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 1700);
  }

  function colorClass(color) {
    return PM.COLORS.includes(color) ? color : 'yellow';
  }

  function escape(value) {
    return PM.escapeHtml(value);
  }

  function noteIcon(note) {
    if (note.reaction) return note.reaction;
    if (note.type === 'highlight') return '✎';
    if (note.type === 'link') return '↗';
    return '●';
  }

  function collectTextNodes() {
    if (!document.body) return [];
    const nodes = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent || parent.closest(BLOCKED_TEXT_PARENTS)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let node;
    while ((node = walker.nextNode())) nodes.push(node);
    return nodes;
  }

  function buildTextIndex() {
    const nodes = collectTextNodes();
    const starts = [];
    let text = '';
    for (const node of nodes) {
      starts.push(text.length);
      text += node.nodeValue;
    }
    return { nodes, starts, text };
  }

  function globalOffset(index, targetNode, localOffset) {
    const position = index.nodes.indexOf(targetNode);
    if (position < 0) return null;
    return index.starts[position] + localOffset;
  }

  function createAnchor(range) {
    const index = buildTextIndex();
    const start = globalOffset(index, range.startContainer, range.startOffset);
    const end = globalOffset(index, range.endContainer, range.endOffset);
    if (start == null || end == null || end <= start) return null;
    return {
      exact: index.text.slice(start, end),
      prefix: index.text.slice(Math.max(0, start - 48), start),
      suffix: index.text.slice(end, end + 48),
      start,
      end
    };
  }

  function boundaryFromOffset(index, offset, preferEnd = false) {
    if (!index.nodes.length) return null;
    const safe = Math.max(0, Math.min(offset, index.text.length));
    for (let i = 0; i < index.nodes.length; i += 1) {
      const start = index.starts[i];
      const end = start + index.nodes[i].nodeValue.length;
      if (safe < end || (safe === end && (preferEnd || i === index.nodes.length - 1))) {
        return { node: index.nodes[i], offset: Math.max(0, Math.min(safe - start, index.nodes[i].nodeValue.length)) };
      }
    }
    const last = index.nodes.at(-1);
    return { node: last, offset: last.nodeValue.length };
  }

  function scoreCandidate(indexText, position, anchor) {
    let score = 0;
    const before = indexText.slice(Math.max(0, position - anchor.prefix.length), position);
    const afterStart = position + anchor.exact.length;
    const after = indexText.slice(afterStart, afterStart + anchor.suffix.length);
    if (anchor.prefix && before === anchor.prefix) score += 5;
    else if (anchor.prefix && before.endsWith(anchor.prefix.slice(-18))) score += 2;
    if (anchor.suffix && after === anchor.suffix) score += 5;
    else if (anchor.suffix && after.startsWith(anchor.suffix.slice(0, 18))) score += 2;
    if (typeof anchor.start === 'number') score -= Math.min(4, Math.abs(position - anchor.start) / 5000);
    return score;
  }

  function resolveAnchor(anchor, index = buildTextIndex()) {
    if (!anchor?.exact || !index.text) return null;
    let chosen = -1;
    if (typeof anchor.start === 'number' && index.text.slice(anchor.start, anchor.start + anchor.exact.length) === anchor.exact) {
      chosen = anchor.start;
    } else {
      let cursor = 0;
      let bestScore = -Infinity;
      let tries = 0;
      while (tries < 150) {
        const found = index.text.indexOf(anchor.exact, cursor);
        if (found < 0) break;
        const score = scoreCandidate(index.text, found, anchor);
        if (score > bestScore) {
          bestScore = score;
          chosen = found;
        }
        cursor = found + Math.max(1, anchor.exact.length);
        tries += 1;
      }
    }
    if (chosen < 0) return null;
    const start = boundaryFromOffset(index, chosen, false);
    const end = boundaryFromOffset(index, chosen + anchor.exact.length, true);
    if (!start || !end) return null;
    try {
      const range = document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      return range;
    } catch {
      return null;
    }
  }

  function selectionRange() {
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0);
    if (!document.body?.contains(range.commonAncestorContainer)) return null;
    const text = range.toString().trim();
    if (!text || text.length > 8000) return null;
    return range.cloneRange();
  }

  function hideToolbar() {
    toolbar.classList.add('hidden');
  }

  function showSelectionToolbar() {
    const range = selectionRange();
    if (!range) {
      hideToolbar();
      return;
    }
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    pendingRange = range;
    pendingRangeRect = rect;
    toolbar.style.left = `${Math.max(115, Math.min(innerWidth - 115, rect.left + rect.width / 2))}px`;
    toolbar.style.top = `${Math.max(54, rect.top - 8)}px`;
    toolbar.classList.remove('hidden');
  }

  async function saveNote(note, patch = {}, options = {}) {
    const { panel: shouldRenderPanel = true, overlay: shouldRenderOverlay = true } = options;
    ignoreStorageUntil = Date.now() + 1200;
    const updated = await PM.upsertNote(pageUrl, { ...note, ...patch }, document.title);
    const index = pageData.notes.findIndex((item) => item.id === updated.id);
    if (index >= 0) pageData.notes[index] = updated;
    else pageData.notes.push(updated);
    if (shouldRenderOverlay) queueRender();
    if (shouldRenderPanel) renderPanel();
    return updated;
  }

  function debounceSave(noteId, patch) {
    clearTimeout(saveTimers.get(noteId));
    const timer = setTimeout(async () => {
      const note = pageData.notes.find((item) => item.id === noteId);
      if (!note) return;
      await saveNote(note, patch, { panel: false, overlay: false });
      saveTimers.delete(noteId);
    }, 450);
    saveTimers.set(noteId, timer);
  }

  async function addHighlight(range, openEditor = false, color = settings.defaultColor) {
    const anchor = createAnchor(range);
    if (!anchor?.exact.trim()) {
      showToast('This selection cannot be anchored');
      return null;
    }
    ignoreStorageUntil = Date.now() + 1200;
    let note = await PM.upsertNote(pageUrl, {
      type: 'highlight',
      color,
      quote: range.toString().trim(),
      anchor,
      text: '',
      reaction: '',
      tags: []
    }, document.title);
    pageData.notes.push(note);
    document.getSelection()?.removeAllRanges();
    hideToolbar();
    await rebuildAnchors();
    renderPanel();
    showToast('Highlight saved locally');
    if (openEditor) {
      const rect = pendingRangeRect || range.getBoundingClientRect();
      openComposer(note, { x: rect.left + rect.width / 2, y: rect.bottom + 8 });
    }
    return note;
  }

  async function addSticky(point = { x: innerWidth / 2, y: innerHeight / 2 }) {
    ignoreStorageUntil = Date.now() + 1200;
    const note = await PM.upsertNote(pageUrl, {
      type: 'sticky',
      color: settings.defaultColor,
      text: '',
      reaction: '',
      tags: [],
      position: {
        xRatio: Math.max(0.02, Math.min(0.95, point.x / innerWidth)),
        yDoc: Math.max(0, point.y + scrollY)
      }
    }, document.title);
    pageData.notes.push(note);
    expandedStickyId = note.id;
    queueRender();
    renderPanel();
    requestAnimationFrame(() => shadow.querySelector(`[data-sticky-text="${CSS.escape(note.id)}"]`)?.focus());
    showToast('Sticky note added');
    return note;
  }

  async function addLinkNote(linkUrl, point = lastContextPoint) {
    ignoreStorageUntil = Date.now() + 1200;
    const note = await PM.upsertNote(pageUrl, {
      type: 'link',
      color: settings.defaultColor,
      linkUrl,
      text: '',
      reaction: '',
      tags: []
    }, document.title);
    pageData.notes.push(note);
    await rebuildAnchors();
    renderPanel();
    openComposer(note, point);
    return note;
  }

  function composerPosition(point) {
    const width = Math.min(360, innerWidth - 28);
    const estimatedHeight = 330;
    const left = Math.max(14, Math.min(innerWidth - width - 14, point.x - width / 2));
    const top = point.y + estimatedHeight > innerHeight - 14
      ? Math.max(14, point.y - estimatedHeight - 12)
      : Math.max(14, point.y + 10);
    return { left, top };
  }

  function openComposer(note, point = { x: innerWidth / 2, y: innerHeight / 2 }) {
    activeComposerId = note.id;
    const position = composerPosition(point);
    composer.style.left = `${position.left}px`;
    composer.style.top = `${position.top}px`;
    composer.innerHTML = `
      <div class="pm-composer-head">
        <span>${noteIcon(note)}</span><div class="pm-composer-label">${escape(PM.noteLabel(note))}</div>
        <button class="pm-icon-btn" data-composer-close title="Close">×</button>
      </div>
      ${note.quote ? `<div class="pm-quote">“${escape(note.quote)}”</div>` : ''}
      ${note.linkUrl ? `<div class="pm-quote">${escape(note.linkUrl)}</div>` : ''}
      <textarea id="pm-compose-text" placeholder="What do you want to remember?">${escape(note.text || '')}</textarea>
      <div class="pm-composer-row">
        <div class="pm-reactions">${PM.REACTIONS.map((reaction) => `<button class="pm-reaction ${reaction === note.reaction ? 'active' : ''}" data-composer-reaction="${escape(reaction)}" title="${reaction || 'No reaction'}">${reaction || '—'}</button>`).join('')}</div>
        <div class="pm-colors">${PM.COLORS.map((color) => `<button class="pm-swatch ${color}" data-composer-color="${color}" title="${color}" ${color === note.color ? 'style="outline:2px solid #315efb;outline-offset:2px"' : ''}></button>`).join('')}</div>
      </div>
      <input id="pm-compose-tags" class="pm-tags" value="${escape((note.tags || []).join(', '))}" placeholder="Tags, separated by commas">
      <div class="pm-actions"><button class="pm-btn danger" data-composer-delete>Delete</button><button class="pm-btn" data-composer-close>Cancel</button><button class="pm-btn primary" data-composer-save>Save</button></div>`;
    composer.classList.remove('hidden');
    requestAnimationFrame(() => $('#pm-compose-text')?.focus());
  }

  function closeComposer() {
    activeComposerId = null;
    composer.classList.add('hidden');
    composer.innerHTML = '';
  }

  async function commitComposer() {
    const note = pageData.notes.find((item) => item.id === activeComposerId);
    if (!note) return closeComposer();
    const reaction = composer.querySelector('.pm-reaction.active')?.dataset.composerReaction ?? note.reaction;
    const color = composer.querySelector('[data-composer-color][style]')?.dataset.composerColor || note.color;
    const text = $('#pm-compose-text')?.value.trim() || '';
    const tags = ($('#pm-compose-tags')?.value || '').split(',').map((tag) => tag.trim()).filter(Boolean);
    await saveNote(note, { text, tags, reaction, color });
    closeComposer();
    showToast('Note saved');
  }

  async function removeNote(noteId) {
    ignoreStorageUntil = Date.now() + 1200;
    await PM.deleteNote(pageUrl, noteId);
    pageData.notes = pageData.notes.filter((note) => note.id !== noteId);
    if (expandedStickyId === noteId) expandedStickyId = null;
    if (activeComposerId === noteId) closeComposer();
    await rebuildAnchors();
    renderPanel();
    showToast('Annotation deleted');
  }

  function clearCssHighlights() {
    if (!globalThis.CSS?.highlights) return;
    for (const color of PM.COLORS) CSS.highlights.delete(`pm-${color}`);
  }

  async function rebuildAnchors() {
    resolvedRanges = new Map();
    clearCssHighlights();
    const index = buildTextIndex();
    const buckets = Object.fromEntries(PM.COLORS.map((color) => [color, []]));
    for (const note of pageData.notes) {
      if (note.type !== 'highlight') continue;
      const range = resolveAnchor(note.anchor, index);
      if (!range) continue;
      resolvedRanges.set(note.id, range);
      buckets[colorClass(note.color)].push(range);
    }
    if (globalThis.CSS?.highlights && globalThis.Highlight) {
      for (const color of PM.COLORS) {
        if (buckets[color].length) CSS.highlights.set(`pm-${color}`, new Highlight(...buckets[color]));
      }
    }
    renderAnchoredElements();
  }

  function notePoint(note) {
    if (note.type === 'highlight') {
      const range = resolvedRanges.get(note.id);
      if (!range) return null;
      const rects = [...range.getClientRects()].filter((rect) => rect.width || rect.height);
      const rect = rects.at(-1) || range.getBoundingClientRect();
      return { x: rect.right + 3, y: rect.top - 8 };
    }
    if (note.type === 'link') {
      const target = [...document.querySelectorAll('a[href]')].find((anchor) => {
        try { return new URL(anchor.href, location.href).href === new URL(note.linkUrl, location.href).href; }
        catch { return anchor.href === note.linkUrl; }
      });
      if (!target) return null;
      const rect = target.getBoundingClientRect();
      if (!rect.width && !rect.height) return null;
      return { x: rect.right + 3, y: rect.top - 8, target };
    }
    return null;
  }

  function renderAnchoredElements() {
    overlay.innerHTML = '';
    for (const note of pageData.notes) {
      if (note.type === 'sticky') renderSticky(note);
      else if (settings.showBadges) renderBadge(note);
    }
  }

  function renderBadge(note) {
    const point = notePoint(note);
    if (!point) return;
    if (point.y < -40 || point.y > innerHeight + 40 || point.x < -40 || point.x > innerWidth + 40) return;
    const button = document.createElement('button');
    button.className = `pm-badge ${colorClass(note.color)}`;
    button.dataset.noteId = note.id;
    button.style.left = `${Math.min(innerWidth - 34, Math.max(4, point.x))}px`;
    button.style.top = `${Math.min(innerHeight - 30, Math.max(4, point.y))}px`;
    button.title = `${PM.noteLabel(note)}${note.text ? `: ${note.text.slice(0, 80)}` : ''}`;
    button.textContent = noteIcon(note);
    button.addEventListener('click', () => {
      openComposer(note, { x: point.x, y: point.y + 28 });
    });
    overlay.appendChild(button);
  }

  function stickyViewportPosition(note) {
    const x = Math.max(8, Math.min(innerWidth - 54, (note.position?.xRatio ?? 0.5) * innerWidth));
    const y = (note.position?.yDoc ?? scrollY + innerHeight / 2) - scrollY;
    return { x, y };
  }

  function renderSticky(note) {
    const { x, y } = stickyViewportPosition(note);
    if (y < -320 || y > innerHeight + 120) return;
    const expanded = expandedStickyId === note.id;
    const element = document.createElement('div');
    element.className = expanded ? `pm-sticky-card ${colorClass(note.color)}` : `pm-sticky-dot ${colorClass(note.color)}`;
    element.dataset.stickyId = note.id;
    element.style.left = `${x}px`;
    element.style.top = `${Math.max(7, Math.min(innerHeight - (expanded ? 190 : 52), y))}px`;
    if (!expanded) {
      element.textContent = note.reaction || '✎';
      element.title = note.text || 'Sticky note';
      element.addEventListener('click', () => {
        expandedStickyId = note.id;
        queueRender();
      });
      attachDrag(element, note);
    } else {
      element.innerHTML = `
        <div class="pm-sticky-head" data-drag-handle>
          <span>${note.reaction || '✎'}</span><div class="pm-sticky-title">Sticky note</div>
          <button class="pm-icon-btn" data-sticky-collapse title="Collapse">−</button>
          <button class="pm-icon-btn" data-sticky-delete title="Delete">×</button>
        </div>
        <textarea class="pm-sticky-text" data-sticky-text="${escape(note.id)}" placeholder="Write a note…">${escape(note.text || '')}</textarea>
        <div class="pm-sticky-foot">
          <select class="pm-mini-select" data-sticky-reaction>${PM.REACTIONS.map((reaction) => `<option value="${escape(reaction)}" ${reaction === note.reaction ? 'selected' : ''}>${reaction || 'No reaction'}</option>`).join('')}</select>
          <select class="pm-mini-select" data-sticky-color>${PM.COLORS.map((color) => `<option value="${color}" ${color === note.color ? 'selected' : ''}>${color}</option>`).join('')}</select>
          <span class="pm-saved">Saved locally</span>
        </div>`;
      element.querySelector('[data-sticky-collapse]').addEventListener('click', () => {
        expandedStickyId = null;
        queueRender();
      });
      element.querySelector('[data-sticky-delete]').addEventListener('click', () => removeNote(note.id));
      element.querySelector('[data-sticky-text]').addEventListener('input', (event) => debounceSave(note.id, { text: event.target.value }));
      element.querySelector('[data-sticky-reaction]').addEventListener('change', (event) => saveNote(note, { reaction: event.target.value }));
      element.querySelector('[data-sticky-color]').addEventListener('change', (event) => saveNote(note, { color: event.target.value }));
      attachDrag(element, note, element.querySelector('[data-drag-handle]'));
    }
    overlay.appendChild(element);
  }

  function attachDrag(element, note, handle = element) {
    let drag = null;
    handle.addEventListener('pointerdown', (event) => {
      if (event.target.closest('button,textarea,select,input')) return;
      drag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        left: parseFloat(element.style.left),
        top: parseFloat(element.style.top)
      };
      handle.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    handle.addEventListener('pointermove', (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const left = Math.max(5, Math.min(innerWidth - element.offsetWidth - 5, drag.left + event.clientX - drag.startX));
      const top = Math.max(5, Math.min(innerHeight - element.offsetHeight - 5, drag.top + event.clientY - drag.startY));
      element.style.left = `${left}px`;
      element.style.top = `${top}px`;
    });
    handle.addEventListener('pointerup', async (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      handle.releasePointerCapture(event.pointerId);
      const left = parseFloat(element.style.left);
      const top = parseFloat(element.style.top);
      drag = null;
      await saveNote(note, {
        position: {
          xRatio: Math.max(0.01, Math.min(0.99, left / innerWidth)),
          yDoc: Math.max(0, top + scrollY)
        }
      });
    });
  }

  function queueRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      renderAnchoredElements();
    });
  }

  function focusNote(note) {
    if (note.type === 'highlight') {
      const range = resolvedRanges.get(note.id);
      if (range) {
        const rect = range.getBoundingClientRect();
        scrollBy({ top: rect.top - innerHeight * 0.35, behavior: 'smooth' });
        setTimeout(() => openComposer(note, { x: Math.min(innerWidth - 30, rect.right), y: Math.max(20, rect.bottom) }), 320);
      } else showToast('Highlight could not be located on this version of the page');
    } else if (note.type === 'sticky') {
      expandedStickyId = note.id;
      scrollTo({ top: Math.max(0, (note.position?.yDoc || 0) - innerHeight / 3), behavior: 'smooth' });
      setTimeout(queueRender, 250);
    } else {
      const point = notePoint(note);
      point?.target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => openComposer(note, point || { x: innerWidth / 2, y: innerHeight / 2 }), 250);
    }
  }

  function renderPanel() {
    $('#pm-page-title').textContent = document.title || pageUrl;
    const counts = {
      total: pageData.notes.length,
      highlight: pageData.notes.filter((note) => note.type === 'highlight').length,
      sticky: pageData.notes.filter((note) => note.type === 'sticky').length,
      link: pageData.notes.filter((note) => note.type === 'link').length
    };
    $('#pm-stats').innerHTML = `<span class="pm-stat">${counts.total} total</span><span class="pm-stat">${counts.highlight} highlights</span><span class="pm-stat">${counts.sticky} stickies</span><span class="pm-stat">${counts.link} links</span>`;
    const query = searchInput.value.trim().toLowerCase();
    const notes = [...pageData.notes]
      .filter((note) => !query || [note.text, note.quote, note.linkUrl, ...(note.tags || [])].join(' ').toLowerCase().includes(query))
      .sort((a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || ''));
    if (!notes.length) {
      list.innerHTML = `<div class="pm-empty">${query ? 'No annotations match this search.' : 'Select text to highlight it, right-click a link to annotate it, or place a sticky note anywhere on the page.'}</div>`;
      return;
    }
    list.innerHTML = notes.map((note) => `
      <article class="pm-note-card ${colorClass(note.color)}" data-card-id="${escape(note.id)}">
        <div class="pm-card-top">
          <span>${noteIcon(note)}</span><div class="pm-kind">${escape(PM.noteLabel(note))}</div>
          <button class="pm-card-btn" data-focus-note="${escape(note.id)}" title="Show on page">⌖</button>
          <button class="pm-card-btn" data-copy-note="${escape(note.id)}" title="Copy">⧉</button>
          <button class="pm-card-btn" data-delete-note="${escape(note.id)}" title="Delete">×</button>
        </div>
        ${note.quote ? `<div class="pm-card-quote">“${escape(note.quote)}”</div>` : ''}
        ${note.linkUrl ? `<a class="pm-card-link" href="${escape(note.linkUrl)}" target="_blank" rel="noreferrer">${escape(note.linkUrl)}</a>` : ''}
        <textarea class="pm-card-text" data-card-text="${escape(note.id)}" placeholder="Add a comment…">${escape(note.text || '')}</textarea>
        <div class="pm-card-meta">
          <select class="pm-mini-select" data-card-reaction="${escape(note.id)}">${PM.REACTIONS.map((reaction) => `<option value="${escape(reaction)}" ${reaction === note.reaction ? 'selected' : ''}>${reaction || '—'}</option>`).join('')}</select>
          <select class="pm-mini-select" data-card-color="${escape(note.id)}">${PM.COLORS.map((color) => `<option value="${color}" ${color === note.color ? 'selected' : ''}>${color}</option>`).join('')}</select>
          <input class="pm-card-tags" data-card-tags="${escape(note.id)}" value="${escape((note.tags || []).join(', '))}" placeholder="tags">
        </div>
      </article>`).join('');
  }

  function setPanel(open) {
    panelOpen = open;
    panel.classList.toggle('open', open);
    if (open) {
      renderPanel();
      setTimeout(() => searchInput.focus(), 220);
    }
  }

  async function exportCurrentPage() {
    const state = PM.emptyState();
    state.pages[pageUrl] = pageData;
    const filename = `pagemarks-${new URL(pageUrl).hostname}-${new Date().toISOString().slice(0, 10)}.md`;
    PM.downloadText(filename, PM.toMarkdown(state), 'text/markdown;charset=utf-8');
    showToast('Markdown export created');
  }

  async function loadPage() {
    pageUrl = PM.canonicalizeUrl(location.href);
    pageData = await PM.getPage(pageUrl);
    pageData.url = pageUrl;
    pageData.title = document.title || pageData.title;
    settings = await PM.getSettings();
    await rebuildAnchors();
    renderPanel();
  }

  toolbar.addEventListener('pointerdown', (event) => event.preventDefault());
  toolbar.addEventListener('click', async (event) => {
    const colorButton = event.target.closest('[data-highlight-color]');
    const noteButton = event.target.closest('[data-highlight-note]');
    if (!pendingRange) return;
    if (colorButton) await addHighlight(pendingRange.cloneRange(), false, colorButton.dataset.highlightColor);
    else if (noteButton) await addHighlight(pendingRange.cloneRange(), true, settings.defaultColor);
  });

  composer.addEventListener('click', async (event) => {
    if (event.target.closest('[data-composer-close]')) return closeComposer();
    if (event.target.closest('[data-composer-save]')) return commitComposer();
    if (event.target.closest('[data-composer-delete]')) return removeNote(activeComposerId);
    const reaction = event.target.closest('[data-composer-reaction]');
    if (reaction) {
      composer.querySelectorAll('[data-composer-reaction]').forEach((button) => button.classList.toggle('active', button === reaction));
    }
    const color = event.target.closest('[data-composer-color]');
    if (color) {
      composer.querySelectorAll('[data-composer-color]').forEach((button) => button.removeAttribute('style'));
      color.setAttribute('style', 'outline:2px solid #315efb;outline-offset:2px');
    }
  });

  panel.addEventListener('click', async (event) => {
    if (event.target.closest('[data-close-panel]')) setPanel(false);
    if (event.target.closest('[data-add-sticky]')) {
      setPanel(false);
      await addSticky({ x: innerWidth * 0.62, y: innerHeight * 0.38 });
    }
    if (event.target.closest('[data-export-page]')) await exportCurrentPage();
    if (event.target.closest('[data-open-manager]')) chrome.runtime.sendMessage({ type: 'OPEN_MANAGER' });
    if (event.target.closest('[data-help]')) showToast('Shortcuts: Alt+Shift+A panel · N sticky · H highlight');
    const focus = event.target.closest('[data-focus-note]');
    if (focus) focusNote(pageData.notes.find((note) => note.id === focus.dataset.focusNote));
    const copy = event.target.closest('[data-copy-note]');
    if (copy) {
      const note = pageData.notes.find((item) => item.id === copy.dataset.copyNote);
      const value = [note.quote, note.text, note.linkUrl].filter(Boolean).join('\n\n');
      await navigator.clipboard.writeText(value);
      showToast('Copied');
    }
    const remove = event.target.closest('[data-delete-note]');
    if (remove) await removeNote(remove.dataset.deleteNote);
  });

  panel.addEventListener('input', (event) => {
    if (event.target === searchInput) return renderPanel();
    const textId = event.target.dataset.cardText;
    const tagsId = event.target.dataset.cardTags;
    if (textId) debounceSave(textId, { text: event.target.value });
    if (tagsId) debounceSave(tagsId, { tags: event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean) });
  });

  panel.addEventListener('change', (event) => {
    const reactionId = event.target.dataset.cardReaction;
    const colorId = event.target.dataset.cardColor;
    if (reactionId) {
      const note = pageData.notes.find((item) => item.id === reactionId);
      if (note) saveNote(note, { reaction: event.target.value });
    }
    if (colorId) {
      const note = pageData.notes.find((item) => item.id === colorId);
      if (note) saveNote(note, { color: event.target.value });
    }
  });

  document.addEventListener('mouseup', (event) => {
    if (event.composedPath().includes(host)) return;
    setTimeout(showSelectionToolbar, 20);
  }, true);

  document.addEventListener('selectionchange', () => {
    if (!document.getSelection()?.isCollapsed) return;
    setTimeout(() => {
      if (document.getSelection()?.isCollapsed) hideToolbar();
    }, 80);
  });

  document.addEventListener('contextmenu', (event) => {
    lastContextPoint = { x: event.clientX, y: event.clientY };
  }, true);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      hideToolbar();
      closeComposer();
      if (panelOpen) setPanel(false);
    }
  }, true);

  addEventListener('scroll', queueRender, { passive: true });
  addEventListener('resize', queueRender, { passive: true });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    (async () => {
      if (message.type === 'TOGGLE_PANEL') setPanel(message.forceOpen ? true : !panelOpen);
      if (message.type === 'CREATE_STICKY_CENTER') await addSticky({ x: innerWidth / 2, y: innerHeight / 2 });
      if (message.type === 'CREATE_STICKY_AT_CONTEXT') await addSticky(lastContextPoint);
      if (message.type === 'CREATE_HIGHLIGHT') {
        const range = selectionRange() || pendingRange;
        if (range) await addHighlight(range.cloneRange(), Boolean(message.openEditor));
        else showToast('Select text first');
      }
      if (message.type === 'CREATE_LINK_NOTE') await addLinkNote(message.linkUrl, lastContextPoint);
      if (message.type === 'GET_PAGE_SUMMARY') {
        sendResponse({
          url: pageUrl,
          title: document.title,
          count: pageData.notes.length,
          highlights: pageData.notes.filter((n) => n.type === 'highlight').length,
          stickies: pageData.notes.filter((n) => n.type === 'sticky').length,
          links: pageData.notes.filter((n) => n.type === 'link').length
        });
      }
    })();
    return true;
  });


  chrome.storage.onChanged.addListener((changes, area) => {
    if (Date.now() < ignoreStorageUntil) return;
    if (area === 'local' && (changes[PM.STATE_KEY] || changes[PM.SETTINGS_KEY])) loadPage();
  });

  const observer = new MutationObserver(() => {
    clearTimeout(mutationTimer);
    mutationTimer = setTimeout(rebuildAnchors, 650);
  });
  if (document.body) observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  setInterval(() => {
    if (location.href !== previousLocation) {
      previousLocation = location.href;
      const next = PM.canonicalizeUrl(location.href);
      if (next !== pageUrl) loadPage();
    }
  }, 800);

  loadPage();
})();
