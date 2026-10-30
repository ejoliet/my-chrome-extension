/* Runs on demand in Chrome's isolated world. No page data leaves this frame
 * except via the synchronous executeScript result to the extension popup. */
(() => {
  'use strict';
  const MAX_ELEMENTS = 22000;
  const MAX_MARKDOWN = 240000;
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'CANVAS', 'BUTTON',
    'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'NAV', 'FOOTER', 'TEMPLATE']);
  const BLOCKS = new Set(['DIV', 'P', 'PRE', 'UL', 'OL', 'TABLE', 'H1', 'H2', 'H3',
    'H4', 'H5', 'H6', 'BLOCKQUOTE', 'SECTION', 'ARTICLE', 'MAIN', 'HEADER', 'ASIDE',
    'FIGURE', 'HR', 'DL', 'DETAILS']);
  const normalize = value => String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const escaped = text => text.replace(/\\/g, '\\\\').replace(/([*_\[\]`])/g, '\\$1');

  function children(node) {
    if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'SLOT' && node.assignedNodes) {
      const assigned = node.assignedNodes({flatten: true});
      if (assigned.length) return assigned;
    }
    if (node.nodeType === Node.ELEMENT_NODE && node.shadowRoot) {
      return Array.from(node.shadowRoot.childNodes);
    }
    return Array.from(node.childNodes || []);
  }

  function isHidden(element) {
    if (element.getAttribute('hidden') !== null || element.getAttribute('aria-hidden') === 'true') return true;
    const style = getComputedStyle(element);
    return style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse';
  }

  function elements(root) {
    const out = [];
    const stack = [root];
    while (stack.length && out.length < MAX_ELEMENTS) {
      const el = stack.pop();
      if (el.nodeType !== Node.ELEMENT_NODE || isHidden(el)) continue;
      out.push(el);
      const kids = children(el).filter(n => n.nodeType === Node.ELEMENT_NODE);
      for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
    }
    return out;
  }

  // Do not accidentally embed javascript:, data:, extension:, or private protocols.
  function linkHref(el) {
    const original = el.getAttribute('href') || '';
    try {
      const url = new URL(original, location.href);
      if (['http:', 'https:', 'mailto:'].includes(url.protocol)) return url.href.replace(/\)/g, '%29');
    } catch (_) { /* invalid URL */ }
    return '';
  }

  function plain(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
    if (node.nodeType !== Node.ELEMENT_NODE || isHidden(node)) return '';
    if (SKIP.has(node.tagName) || node.getAttribute('contenteditable') === 'true') return '';
    if (node.tagName === 'BR') return '\n';
    return children(node).map(plain).join('');
  }

  function inline(node) {
    if (node.nodeType === Node.TEXT_NODE) return escaped((node.nodeValue || '').replace(/\s+/g, ' '));
    if (node.nodeType !== Node.ELEMENT_NODE || isHidden(node)) return '';
    const tag = node.tagName;
    if (SKIP.has(tag) || node.getAttribute('contenteditable') === 'true') return '';
    if (tag === 'BR') return '\n';
    if (tag === 'IMG') {
      const alt = normalize(node.getAttribute('alt'));
      return alt ? escaped(alt) : '';
    }
    let text = children(node).map(inline).join('');
    if (!text.trim()) return '';
    if (tag === 'CODE' && node.parentElement?.tagName !== 'PRE') {
      const ticks = '`'.repeat(Math.max(1, ...Array.from(text.matchAll(/`+/g), m => m[0].length + 1)));
      return ticks + text.trim() + ticks;
    }
    if (tag === 'STRONG' || tag === 'B') return `**${text.trim()}**`;
    if (tag === 'EM' || tag === 'I') return `*${text.trim()}*`;
    if (tag === 'DEL' || tag === 'S') return `~~${text.trim()}~~`;
    if (tag === 'A') {
      const url = linkHref(node);
      if (url) return `[${text.trim()}](${url})`;
    }
    return text;
  }

  function codeBlock(node) {
    const code = node.querySelector('code') || node;
    const raw = plain(code).replace(/\r\n?/g, '\n').replace(/^\n+|\n+$/g, '');
    if (!raw) return '';
    const cls = `${code.className || ''} ${node.className || ''}`;
    const lang = cls.match(/(?:language-|lang-)([a-z0-9_+.-]+)/i)?.[1] || '';
    const runs = Array.from(raw.matchAll(/`+/g), m => m[0].length);
    const fence = '`'.repeat(Math.max(3, ...runs.map(n => n + 1)));
    return `${fence}${lang}\n${raw}\n${fence}`;
  }

  function tableBlock(table) {
    const rows = [];
    for (const tr of table.querySelectorAll('tr')) {
      if (isHidden(tr)) continue;
      const cells = Array.from(tr.children).filter(c => c.matches('th,td'));
      if (!cells.length) continue;
      rows.push(cells.map(c => normalize(children(c).map(inline).join('')).replace(/\|/g, '\\|')));
    }
    if (!rows.length) return '';
    const width = Math.max(...rows.map(r => r.length));
    const make = cells => '| ' + Array.from({length: width}, (_, i) => cells[i] || '').join(' | ') + ' |';
    return [make(rows[0]), make(Array(width).fill('---')), ...rows.slice(1).map(make)].join('\n');
  }

  function listBlock(list, depth = 0) {
    if (depth > 7) return '';
    const ordered = list.tagName === 'OL';
    let count = Number(list.getAttribute('start') || 1);
    const lines = [];
    for (const li of Array.from(list.children).filter(e => e.tagName === 'LI' && !isHidden(e))) {
      const nested = [];
      const body = [];
      for (const child of children(li)) {
        if (child.nodeType === Node.ELEMENT_NODE && (child.tagName === 'UL' || child.tagName === 'OL')) nested.push(child);
        else body.push(child);
      }
      const prefix = ordered ? `${count++}. ` : '- ';
      const contents = normalize(body.map(n => {
        if (n.nodeType === Node.ELEMENT_NODE && BLOCKS.has(n.tagName) && n.tagName !== 'BR') return render(n);
        return inline(n);
      }).join(' '));
      const parts = (contents || '').split('\n');
      lines.push('  '.repeat(depth) + prefix + (parts.shift() || ''));
      for (const part of parts) if (part.trim()) lines.push('  '.repeat(depth + 1) + part.trim());
      for (const child of nested) lines.push(listBlock(child, depth + 1));
    }
    return lines.filter(Boolean).join('\n');
  }

  function render(node) {
    if (node.nodeType === Node.TEXT_NODE) return inline(node).trim();
    if (node.nodeType !== Node.ELEMENT_NODE || isHidden(node)) return '';
    const tag = node.tagName;
    if (SKIP.has(tag) || node.getAttribute('contenteditable') === 'true') return '';
    if (tag === 'PRE') return codeBlock(node);
    if (tag === 'TABLE') return tableBlock(node);
    if (tag === 'UL' || tag === 'OL') return listBlock(node);
    if (/^H[1-6]$/.test(tag)) return '#'.repeat(Number(tag[1])) + ' ' + normalize(children(node).map(inline).join(''));
    if (tag === 'HR') return '---';
    if (tag === 'P') return children(node).map(inline).join('').trim();
    if (tag === 'BLOCKQUOTE') {
      return renderChildren(node).split('\n').map(l => l ? '> ' + l : '>').join('\n');
    }
    if (tag === 'BR') return '';
    if (!BLOCKS.has(tag) && tag !== 'BODY') return children(node).map(inline).join('').trim();
    return renderChildren(node);
  }

  function renderChildren(node) {
    const chunks = [];
    let run = [];
    const flush = () => {
      const text = run.join('').trim();
      if (text) chunks.push(text);
      run = [];
    };
    for (const child of children(node)) {
      if (child.nodeType === Node.ELEMENT_NODE && (BLOCKS.has(child.tagName) || child.tagName === 'BR')) {
        flush();
        if (child.tagName === 'BR') continue;
        const text = render(child).trim();
        if (text) chunks.push(text);
      } else {
        run.push(inline(child));
      }
    }
    flush();
    return chunks.join('\n\n');
  }

  function finalize(raw) {
    const normalized = String(raw || '')
      .replace(/\u200b/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{4,}/g, '\n\n\n')
      .trim();
    if (normalized.length <= MAX_MARKDOWN) return {markdown: normalized, truncated: false};
    return {markdown: normalized.slice(0, MAX_MARKDOWN) + '\n\n[Export truncated at 240,000 characters]', truncated: true};
  }

  // Traverse through open Shadow DOM hosts as well as normal DOM ancestors.
  function parentOf(el) {
    return el.parentElement || el.getRootNode()?.host || null;
  }

  function widthSuitable(el) {
    const rect = el.getBoundingClientRect();
    const maxWidth = Math.max(560, window.innerWidth * 0.58);
    return rect.width >= 220 && rect.width <= maxWidth && rect.height >= 110;
  }

  function findChat(all) {
    const candidates = new Map();
    const add = (el, score) => {
      if (!el || el === document.body || el === document.documentElement || !widthSuitable(el)) return;
      const str = normalize(plain(el));
      if (str.length < 20 || str.length > 350000) return;
      const rect = el.getBoundingClientRect();
      const measured = score + Math.min(str.length / 90, 100) + Math.min(rect.height / 20, 60);
      if (!candidates.has(el) || candidates.get(el).score < measured) candidates.set(el, {score: measured, chars: str.length});
    };
    for (const el of all) {
      if (SKIP.has(el.tagName)) continue;
      const label = [el.getAttribute('aria-label'), el.id, el.getAttribute('data-testid'),
        typeof el.className === 'string' ? el.className : ''].filter(Boolean).join(' ');
      if (/(amazon[-_ ]?q|q[-_ ]?chat|conversation|chat[-_ ]?(?:panel|history|messages)|message[-_ ]?list)/i.test(label)) {
        add(el, /amazon[-_ ]?q|q[-_ ]?chat/i.test(label) ? 130 : 55);
      }
      if (el.matches('[role="log"], [role="feed"]')) add(el, 50);
      // A visible 'Amazon Q' heading is the strongest general-purpose marker.
      if (el.children.length <= 2 && (el.textContent || '').length <= 80 && normalize(plain(el)) === 'Amazon Q') {
        let up = el;
        for (let j = 0; j < 13 && up; j++, up = parentOf(up)) {
          // Width constraint prevents returning the AWS console main page.
          add(up, 120 + j * 4);
        }
      }
    }
    const ranked = Array.from(candidates, ([el, value]) => ({el, ...value}))
      .sort((a,b) => b.score - a.score);
    if (!ranked.length) return null;
    const best = ranked[0];
    // An arbitrary generic log needs an additional signal to avoid false positives.
    if (best.score < 90) return null;
    return {element: best.el, score: best.score};
  }

  function selected() {
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return {markdown: '', truncated: false};
    const range = selection.getRangeAt(0);
    const temp = document.createElement('div');
    temp.append(range.cloneContents());
    return finalize(renderChildren(temp));
  }

  const all = elements(document.documentElement);
  const chat = findChat(all);
  const frames = all.filter(el => el.tagName === 'IFRAME').map(el => {
    const src = el.getAttribute('src') || '';
    try {
      const url = new URL(src, location.href);
      return {origin: url.origin, sameOrigin: url.origin === location.origin};
    } catch (_) { return null; }
  }).filter(Boolean);
  const main = all.find(el => el.tagName === 'MAIN' && (el.getBoundingClientRect().width > 200));
  const pageRoot = main || document.body || document.documentElement;
  globalThis.__q2mdConvert = element => finalize(render(element));
  const chatResult = chat ? finalize(render(chat.element)) : {markdown: '', truncated: false};
  const pageResult = finalize(render(pageRoot));
  const selectionResult = selected();
  return {
    ok: true,
    url: location.href,
    title: document.title,
    isTop: window === window.top,
    chat: {...chatResult, score: chat?.score || 0},
    selection: selectionResult,
    page: pageResult,
    frames,
    stats: {elements: all.length}
  };
})()
