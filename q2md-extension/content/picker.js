/* Interactive manual fallback. Only activated by explicit user click in popup. */
(() => {
  'use strict';
  if (globalThis.__q2mdPickerCancel) globalThis.__q2mdPickerCancel();
  if (typeof globalThis.__q2mdConvert !== 'function') return;

  const host = document.createElement('div');
  host.setAttribute('data-q2md-picker', '');
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none';
  const root = host.attachShadow({mode:'closed'});
  const stylesheet = new CSSStyleSheet();
  stylesheet.replaceSync(`
    * { box-sizing:border-box; }
    .border { position:fixed;pointer-events:none;border:3px solid #1b64cd;background:#1b64cd12;
      border-radius:4px;box-shadow:0 0 0 9999px #0000000c;display:none; }
    .dock { font:13px/1.45 system-ui,sans-serif; pointer-events:auto; position:fixed;bottom:22px;
      left:50%;transform:translateX(-50%);background:#17283f;color:#fff;width:510px;max-width:96vw;
      border-radius:10px;padding:13px 15px;box-shadow:0 8px 28px #0006; }
    .top { display:flex;align-items:center;justify-content:space-between;gap:12px;font-weight:650; }
    .detail { color:#c7d6ec;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:3px; }
    .actions { display:flex; gap:7px; margin-top:11px;flex-wrap:wrap; }
    button { font:inherit; cursor:pointer;border-radius:6px;border:1px solid #7f9cbe;
      padding:7px 9px;background:#2b4161;color:#fff; }
    button.primary { background:#e5f0ff;border-color:#e5f0ff;color:#102d55;font-weight:700; }
    button:focus-visible { outline:2px solid white;outline-offset:2px; }
    .tip {font-size:11px;color:#a8bfdc;margin-top:8px}
  `);
  root.adoptedStyleSheets = [stylesheet];
  const border = document.createElement('div'); border.className = 'border';
  const dock = document.createElement('div'); dock.className = 'dock';
  dock.setAttribute('role', 'dialog'); dock.setAttribute('aria-label', 'Copy page region as Markdown');
  const top = document.createElement('div'); top.className = 'top';
  const heading = document.createElement('span'); heading.textContent = 'Choose region to copy';
  top.append(heading);
  const detail = document.createElement('div'); detail.className = 'detail';
  const actions = document.createElement('div'); actions.className = 'actions';
  const tip = document.createElement('div'); tip.className = 'tip';
  tip.textContent = 'Hover to highlight · Click to lock · ↑ parent · ↓ child · Esc to exit';
  function button(text, handler, klass = '') {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = text; b.className = klass;
    b.addEventListener('click', handler); actions.append(b); return b;
  }
  dock.append(top, detail, actions, tip);
  root.append(border, dock);
  document.documentElement.append(host);

  let candidate = null;
  let locked = false;
  const backStack = [];
  let lastChild = null;
  function parentOf(el) { return el.parentElement || el.getRootNode()?.host || null; }
  function regionInfo(el) {
    if (!el) return 'Move over the content you want.';
    const raw = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    return `${el.tagName.toLowerCase()} · ${raw.length.toLocaleString()} text characters · ${raw.slice(0,65)}`;
  }
  function update(el) {
    if (!el || el === host || el === document.body || el === document.documentElement) return;
    candidate = el;
    const rect = el.getBoundingClientRect();
    border.style.display = 'block';
    border.style.left = `${Math.max(0,rect.left)}px`;
    border.style.top = `${Math.max(0,rect.top)}px`;
    border.style.width = `${Math.max(0,rect.width)}px`;
    border.style.height = `${Math.max(0,rect.height)}px`;
    detail.textContent = regionInfo(el);
  }
  const hover = ev => {
    if (locked || ev.target === host || host.contains(ev.target)) return;
    const el = ev.target instanceof Element ? ev.target : null;
    if (el) update(el);
  };
  const select = ev => {
    if (host.contains(ev.target) || ev.target === host) return;
    ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();
    if (!candidate) update(ev.target);
    locked = true;
    heading.textContent = 'Selected region';
  };
  const key = ev => {
    if (ev.key === 'Escape') { ev.stopPropagation(); cancel(); return; }
    if (!candidate) return;
    if (ev.key === 'ArrowUp') {
      const parent = parentOf(candidate);
      if (parent && parent !== document.body && parent !== document.documentElement) {
        ev.preventDefault(); backStack.push(candidate); update(parent); locked = true;
      }
    }
    if (ev.key === 'ArrowDown' && backStack.length) {
      ev.preventDefault(); update(backStack.pop()); locked = true;
    }
  };
  function cancel() {
    document.removeEventListener('mousemove', hover, true);
    document.removeEventListener('click', select, true);
    document.removeEventListener('keydown', key, true);
    host.remove();
    delete globalThis.__q2mdPickerCancel;
  }
  globalThis.__q2mdPickerCancel = cancel;
  button('↑ Parent', () => {
    if (!candidate) return;
    const parent = parentOf(candidate);
    if (parent && parent !== document.body && parent !== document.documentElement) {
      backStack.push(candidate); update(parent); locked = true;
    }
  });
  button('↓ Child', () => { if (backStack.length) update(backStack.pop()); });
  button('Copy region', async () => {
    if (!candidate) { detail.textContent = 'Click a region on the page first.'; return; }
    if (candidate.tagName === 'IFRAME') {
      detail.textContent = 'This iframe is isolated. Use the popup to grant AWS frame permission.'; return;
    }
    const {markdown, truncated} = globalThis.__q2mdConvert(candidate);
    if (!markdown) { detail.textContent = 'No readable text in the selected element. Choose its parent.'; return; }
    try {
      await navigator.clipboard.writeText(markdown);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = markdown;
      textarea.style.cssText = 'position:fixed;left:-9999px;opacity:0';
      document.body.append(textarea);
      textarea.focus(); textarea.select();
      const success = document.execCommand('copy');
      textarea.remove();
      if (!success) { detail.textContent = 'Copy blocked. Try the extension popup instead.'; return; }
    }
    heading.textContent = 'Markdown copied';
    detail.textContent = `${markdown.length.toLocaleString()} characters copied${truncated ? ' (truncated)' : ''}.`;
  }, 'primary');
  button('Close', cancel);
  document.addEventListener('mousemove', hover, true);
  document.addEventListener('click', select, true);
  document.addEventListener('keydown', key, true);
})();
