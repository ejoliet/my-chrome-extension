'use strict';
const $ = id => document.getElementById(id);
const state = {tabId: null, sources: {chat: null, selection: null, page: null},
  frameOrigins: [], busy: false, defaultScope: null};
const DOM = {
  scope: $('scope'), preview: $('markdown'), status: $('status'), copy: $('copy'),
  download: $('download'), count: $('count'), grant: $('grant')
};

function notice(message, kind = '') {
  DOM.status.textContent = message;
  DOM.status.className = 'status' + (kind ? ` ${kind}` : '');
}
function setBusy(busy) {
  state.busy = busy;
  $('refresh').disabled = busy;
  $('pick').disabled = busy;
  DOM.scope.disabled = busy;
  DOM.copy.disabled = busy || !DOM.preview.value;
  DOM.download.disabled = busy || !DOM.preview.value;
}
function showContent() {
  const scope = DOM.scope.value;
  const source = state.sources[scope];
  DOM.preview.value = source?.markdown || '';
  updateCount();
  if (!source?.markdown) {
    notice(scope === 'chat' ? 'No Amazon Q conversation found. Try Page content or grant access to an embedded AWS frame.' :
      scope === 'selection' ? 'Select text on the page before opening the extension.' : 'No readable page content found.', 'error');
  } else {
    const suffix = source.truncated ? ' (truncated at 240,000 characters)' : '';
    notice(`${scope === 'chat' ? 'Conversation' : scope === 'selection' ? 'Selection' : 'Page'} ready · ${source.markdown.length.toLocaleString()} characters${suffix}`);
  }
}
function updateCount() {
  DOM.count.textContent = `${DOM.preview.value.length.toLocaleString()} characters`;
  DOM.copy.disabled = state.busy || !DOM.preview.value;
  DOM.download.disabled = state.busy || !DOM.preview.value;
}
function isAwsOrigin(raw) {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && (
      url.hostname === 'amazon.com' || url.hostname.endsWith('.amazon.com') ||
      url.hostname === 'aws.amazon.com' || url.hostname.endsWith('.aws.amazon.com'));
  } catch { return false; }
}
function safeOrigin(raw) {
  try { return new URL(raw).origin; } catch { return null; }
}
async function refresh() {
  notice('Reading accessible frames…');
  setBusy(true);
  DOM.grant.hidden = true;
  try {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    if (!tab?.id) throw new Error('No active tab.');
    state.tabId = tab.id;
    if (!/^https?:\/\//.test(tab.url || '')) {
      throw new Error('Open a regular web page. Chrome internal pages cannot be captured.');
    }
    $('hostname').textContent = new URL(tab.url).hostname;
    // activeTab provides access to the clicked page, not unrelated domains in cross-origin frames.
    const injections = await chrome.scripting.executeScript({
      target: {tabId: tab.id, allFrames: true}, files: ['content/extract.js']
    });
    const results = injections.map(x => ({frameId: x.frameId, data: x.result}))
      .filter(x => x.data?.ok);
    if (!results.length) throw new Error('No readable document. Try reloading the page.');
    const top = results.find(x => x.frameId === 0) || results[0];
    const pick = key => results.filter(x => x.data[key]?.markdown).sort((a,b) => {
      if (key === 'chat') return b.data.chat.score - a.data.chat.score;
      if (key === 'page') return (a.frameId === 0 ? -1 : 1);
      return b.data.selection.markdown.length - a.data.selection.markdown.length;
    })[0]?.data[key] || null;
    state.sources = {chat: pick('chat'), selection: pick('selection'), page: top.data.page};
    const availableOrigins = new Set(results.map(x => safeOrigin(x.data.url)).filter(Boolean));
    state.frameOrigins = Array.from(new Set(results.flatMap(x => x.data.frames || [])
      .filter(x => !x.sameOrigin && isAwsOrigin(x.origin) && !availableOrigins.has(x.origin))
      .map(x => x.origin)));
    const scopes = [
      ['chat', 'Amazon Q conversation'], ['selection', 'Selected text'], ['page', 'Page content']
    ];
    DOM.scope.replaceChildren();
    for (const [key, title] of scopes) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = title + (!state.sources[key]?.markdown ? ' (not found)' : '');
      DOM.scope.append(opt);
    }
    const preferred = state.defaultScope && state.sources[state.defaultScope]?.markdown ? state.defaultScope :
      state.sources.chat?.markdown ? 'chat' : state.sources.selection?.markdown ? 'selection' : 'page';
    DOM.scope.value = preferred;
    state.defaultScope = null;
    showContent();
    if (state.frameOrigins.length && !state.sources.chat?.markdown) {
      DOM.grant.hidden = false;
      $('grant-info').textContent = `An embedded AWS frame (${state.frameOrigins.map(x => new URL(x).hostname).join(', ')}) might contain the conversation. Grant access only if this frame is relevant.`;
    }
  } catch (error) {
    state.sources = {chat: null, selection: null, page: null};
    DOM.preview.value = '';
    updateCount();
    notice(error?.message || String(error), 'error');
  } finally { setBusy(false); }
}

DOM.scope.addEventListener('change', () => { showContent(); });
DOM.preview.addEventListener('input', updateCount);
$('refresh').addEventListener('click', refresh);
$('pick').addEventListener('click', async () => {
  try {
    if (!state.tabId) throw new Error('No readable tab.');
    // Top document only. Cross-origin iframe contents require permission, not a parent picker.
    await chrome.scripting.executeScript({target: {tabId: state.tabId}, files: ['content/extract.js']});
    await chrome.scripting.executeScript({target: {tabId: state.tabId}, files: ['content/picker.js']});
    window.close();
  } catch (error) { notice(`Cannot start picker: ${error.message}`, 'error'); }
});
DOM.copy.addEventListener('click', async () => {
  if (!DOM.preview.value) return;
  try {
    await navigator.clipboard.writeText(DOM.preview.value);
    notice('Markdown copied to clipboard.', 'success');
    DOM.copy.textContent = 'Copied';
    DOM.copy.dataset.copied = '1';
  } catch {
    DOM.preview.focus();
    DOM.preview.select();
    if (document.execCommand('copy')) notice('Markdown copied to clipboard.', 'success');
    else notice('Clipboard was blocked. Press Ctrl+C or Cmd+C to copy the selected preview.', 'error');
  }
});
DOM.download.addEventListener('click', () => {
  if (!DOM.preview.value) return;
  const filename = `${DOM.scope.value === 'chat' ? 'amazon-q-chat' : 'page'}-${new Date().toISOString().slice(0,10)}.md`;
  const url = URL.createObjectURL(new Blob([DOM.preview.value + '\n'], {type: 'text/markdown;charset=utf-8'}));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  notice(`Saved ${filename}`, 'success');
});
$('grant-button').addEventListener('click', async () => {
  if (!state.frameOrigins.length) return;
  // Requested synchronously from click for Chrome's user-gesture requirement.
  const origins = state.frameOrigins.slice(0, 5).map(origin => origin + '/*');
  try {
    const granted = await chrome.permissions.request({origins});
    if (!granted) { notice('Frame permission not granted. Page content remains available.'); return; }
    state.defaultScope = 'chat';
    await refresh();
  } catch (error) { notice(`Cannot access embedded frame: ${error.message}`, 'error'); }
});
refresh();
