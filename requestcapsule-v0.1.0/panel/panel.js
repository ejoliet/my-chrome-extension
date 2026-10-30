'use strict';

import {
  MAX_REQUESTS,
  REQUEST_BODY_LIMIT,
  RESPONSE_BODY_LIMIT,
  SESSION_BODY_LIMIT,
  formatBytes,
  isApiLike,
  matchesFilters,
  normalizeHarEntry,
} from './network-model.js';
import {
  SUGGESTED_CATEGORIES,
  analyzeSuggested,
  applySuggestedRedactions,
  combinedRedactionSummary,
  sanitizeMandatoryModel,
} from './sanitizer.js';
import { deleteAllCaptures, deleteAllLocalData, deleteCapture, getValue, listCaptures, saveCapture, setValue } from './idb.js';
import { parseLicenseInput, verifyLicenseDocument } from './license.js';

const elements = Object.fromEntries([
  'resume-button','pause-button','clear-button','demo-button','capture-status','disclosure','dismiss-disclosure',
  'filter-text','filter-method','filter-status','filter-json','filter-failed','request-empty','request-list',
  'inspect-empty','inspect-loading','inspect-content','request-summary','request-headers','query-parameters','request-body',
  'response-headers','response-body','save-capture','output-empty','output-content','mandatory-summary','suggested-redactions',
  'generate-free','generate-pro','cancel-generation','progress-status','free-results','result-code','copy-result',
  'download-markdown','pro-gate','open-license','license-import','license-token','license-file','verify-license',
  'license-status','license-badge','feedback-card','would-commit','would-pay','rewrite-notes','copy-feedback',
  'saved-capture-count','saved-capture-list','refresh-saved','delete-saved','delete-all-data',
].map((id) => [id, document.getElementById(id)]));

const state = {
  capturing: true,
  requests: [],
  runtimeEntries: new Map(),
  mandatorySummaries: new Map(),
  requestKeys: new Set(),
  selectedId: null,
  selectedCategories: new Set(),
  currentResult: 'curl',
  freeFiles: null,
  entitlement: null,
  worker: null,
  workerTimeout: null,
  bodyBytes: 0,
};

function setStatus(message, isError = false) {
  elements['progress-status'].textContent = message;
  elements['progress-status'].style.color = isError ? 'var(--danger)' : '';
}

function setCaptureState(capturing) {
  state.capturing = capturing;
  elements['capture-status'].textContent = capturing ? 'Capturing' : 'Paused';
  elements['resume-button'].disabled = capturing;
  elements['pause-button'].disabled = !capturing;
}

function filters() {
  return {
    text: elements['filter-text'].value,
    method: elements['filter-method'].value,
    status: elements['filter-status'].value,
    jsonOnly: elements['filter-json'].checked,
    failed: elements['filter-failed'].checked,
  };
}

function requestKey(entry) {
  return `${entry.startedDateTime || ''}|${entry.request?.method || ''}|${entry.request?.url || ''}|${entry.response?.status || ''}`;
}

function addRequest(entry, { ignorePause = false } = {}) {
  if (!ignorePause && !state.capturing) return;
  if (!entry?.request || !entry?.response || !isApiLike(entry)) return;
  const key = requestKey(entry);
  if (state.requestKeys.has(key)) return;
  state.requestKeys.add(key);

  const id = crypto.randomUUID();
  const normalized = normalizeHarEntry(entry, id);
  if (new TextEncoder().encode(normalized.requestBody).byteLength > REQUEST_BODY_LIMIT) {
    normalized.requestBody = '';
    normalized.bodyError = 'Request body exceeds the 1 MB limit.';
  }
  const sanitized = sanitizeMandatoryModel(normalized);
  state.requests.push(sanitized.model);
  state.runtimeEntries.set(id, entry);
  state.mandatorySummaries.set(id, sanitized.summary);

  while (state.requests.length > MAX_REQUESTS) {
    const removableIndex = state.requests.findIndex((request) => request.id !== state.selectedId);
    if (removableIndex < 0) break;
    const [removed] = state.requests.splice(removableIndex, 1);
    state.runtimeEntries.delete(removed.id);
    state.mandatorySummaries.delete(removed.id);
    state.requestKeys.delete(key);
    if (removed.bodyLoaded) state.bodyBytes = Math.max(0, state.bodyBytes - new TextEncoder().encode(removed.responseBody).byteLength);
  }
  renderRequestList();
}

function createRequestRow(model) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'request-row';
  button.setAttribute('role', 'option');
  button.setAttribute('aria-selected', String(model.id === state.selectedId));
  button.dataset.id = model.id;

  const method = document.createElement('span');
  method.className = 'method';
  method.textContent = model.method;
  const status = document.createElement('span');
  status.className = `status-code ${model.status >= 400 ? 'failed' : 'ok'}`;
  status.textContent = model.status ? String(model.status) : '—';
  const path = document.createElement('span');
  path.className = 'request-path';
  const strong = document.createElement('strong');
  strong.textContent = model.path || model.originalUrl;
  const small = document.createElement('small');
  small.textContent = `${model.hostname || 'unknown host'} · ${model.responseMimeType || 'unknown type'}`;
  path.append(strong, small);
  const meta = document.createElement('span');
  meta.className = 'request-meta';
  meta.textContent = `${formatBytes(model.responseSize)} · ${Math.round(model.duration)} ms`;
  button.append(method, status, path, meta);
  button.addEventListener('click', () => selectRequest(model.id));
  return button;
}

function renderRequestList() {
  const visible = state.requests.filter((request) => matchesFilters(request, filters()));
  elements['request-list'].replaceChildren(...visible.map(createRequestRow));
  elements['request-empty'].hidden = visible.length > 0;
  elements['request-list'].hidden = visible.length === 0;
}

function setText(id, value) {
  elements[id].textContent = value || '—';
}

function renderSummary(model) {
  const rows = [
    ['Method', model.method], ['URL', model.sanitizedUrl], ['Status', `${model.status} ${model.statusText}`.trim()],
    ['Type', model.responseMimeType || model.requestMimeType], ['Duration', `${Math.round(model.duration)} ms`],
    ['Size', formatBytes(model.responseSize)], ['HTTP', model.httpVersion],
  ];
  const fragment = document.createDocumentFragment();
  for (const [term, description] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = description || '—';
    fragment.append(dt, dd);
  }
  elements['request-summary'].replaceChildren(fragment);
}

function formatHeaders(headers) {
  return (headers || []).map(({ name, value }) => `${name}: ${value}`).join('\n') || '—';
}

function formatQuery(parameters) {
  return (parameters || []).map(({ name, value }) => `${name}=${value}`).join('\n') || '—';
}

function renderInspect(model) {
  elements['inspect-empty'].hidden = true;
  elements['inspect-loading'].hidden = true;
  elements['inspect-content'].hidden = false;
  renderSummary(model);
  setText('request-headers', formatHeaders(model.requestHeaders));
  setText('query-parameters', formatQuery(model.queryParameters));
  setText('request-body', model.requestBody || model.bodyError || '—');
  setText('response-headers', formatHeaders(model.responseHeaders));
  setText('response-body', model.responseBody || model.bodyError || '—');
  elements['save-capture'].disabled = false;
}

function selectedModel() {
  return state.requests.find((request) => request.id === state.selectedId) || null;
}

function decodeContent(content, encoding) {
  if (encoding !== 'base64') return String(content || '');
  try {
    const binary = atob(String(content || ''));
    return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
  } catch {
    throw new Error('Base64 response content could not be decoded as text.');
  }
}

function getContentWithTimeout(entry) {
  return new Promise((resolve, reject) => {
    if (!entry || typeof entry.getContent !== 'function') {
      reject(new Error('Response content is unavailable for this request.'));
      return;
    }
    const timeout = setTimeout(() => reject(new Error('Response body retrieval exceeded five seconds.')), 5000);
    try {
      entry.getContent((content, encoding) => {
        clearTimeout(timeout);
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve({ content: content ?? '', encoding: encoding || '' });
      });
    } catch (error) {
      clearTimeout(timeout);
      reject(error);
    }
  });
}

function evictBodies() {
  if (state.bodyBytes <= SESSION_BODY_LIMIT) return;
  const candidates = state.requests
    .filter((request) => request.id !== state.selectedId && request.bodyLoaded && request.responseBody)
    .sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
  for (const request of candidates) {
    const bytes = new TextEncoder().encode(request.responseBody).byteLength;
    request.responseBody = '';
    request.bodyLoaded = false;
    request.bodyError = 'Response body was evicted from memory. Select the request to load it again.';
    state.bodyBytes = Math.max(0, state.bodyBytes - bytes);
    if (state.bodyBytes <= SESSION_BODY_LIMIT) break;
  }
}

async function loadResponseBody(model) {
  if (model.bodyLoaded) return model;
  elements['inspect-empty'].hidden = true;
  elements['inspect-content'].hidden = true;
  elements['inspect-loading'].hidden = false;
  const runtime = state.runtimeEntries.get(model.id);
  const { content, encoding } = await getContentWithTimeout(runtime);
  const decoded = decodeContent(content, encoding);
  const byteLength = new TextEncoder().encode(decoded).byteLength;
  if (byteLength > RESPONSE_BODY_LIMIT) throw new Error(`Response body is ${formatBytes(byteLength)}; the limit is 2 MB.`);

  const previousBytes = model.responseBody ? new TextEncoder().encode(model.responseBody).byteLength : 0;
  const result = sanitizeMandatoryModel({ ...model, responseBody: decoded, responseBodyEncoding: encoding, bodyLoaded: true, bodyError: '', lastAccessedAt: Date.now() });
  const index = state.requests.findIndex((request) => request.id === model.id);
  state.requests[index] = result.model;
  state.mandatorySummaries.set(model.id, result.summary);
  state.bodyBytes = state.bodyBytes - previousBytes + new TextEncoder().encode(result.model.responseBody).byteLength;
  evictBodies();
  return result.model;
}

function renderRedactionReview(model) {
  const mandatory = state.mandatorySummaries.get(model.id) || {};
  const mandatoryCount = Object.values(mandatory).reduce((sum, count) => sum + Number(count || 0), 0);
  elements['mandatory-summary'].textContent = mandatoryCount
    ? `${mandatoryCount} mandatory credential value${mandatoryCount === 1 ? '' : 's'} removed before generation.`
    : 'No known mandatory credential pattern was detected.';

  const counts = analyzeSuggested(model);
  state.selectedCategories = new Set(Object.keys(counts).filter((category) => counts[category] > 0));
  const controls = [];
  for (const [category, label] of Object.entries(SUGGESTED_CATEGORIES)) {
    const count = counts[category] || 0;
    if (!count) continue;
    const wrapper = document.createElement('label');
    wrapper.className = 'redaction-option';
    const left = document.createElement('span');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = true;
    input.dataset.category = category;
    input.addEventListener('change', () => {
      if (input.checked) state.selectedCategories.add(category);
      else state.selectedCategories.delete(category);
    });
    left.append(input, ` ${label}`);
    const badge = document.createElement('span');
    badge.textContent = String(count);
    wrapper.append(left, badge);
    controls.push(wrapper);
  }
  if (!controls.length) {
    const message = document.createElement('p');
    message.textContent = 'No optional sensitive values were detected.';
    controls.push(message);
  }
  elements['suggested-redactions'].replaceChildren(...controls);
}

function renderOutput(model) {
  elements['output-empty'].hidden = true;
  elements['output-content'].hidden = false;
  elements['free-results'].hidden = true;
  state.freeFiles = null;
  renderRedactionReview(model);
  setStatus('Ready to generate local artifacts.');
}

async function selectRequest(id) {
  state.selectedId = id;
  renderRequestList();
  let model = selectedModel();
  if (!model) return;
  try {
    model = await loadResponseBody(model);
    renderInspect(model);
    renderOutput(model);
    activateMobilePane('inspect');
  } catch (error) {
    model.bodyError = error.message;
    model.bodyLoaded = false;
    renderInspect(model);
    elements['output-empty'].hidden = false;
    elements['output-content'].hidden = true;
    setStatus(error.message, true);
  }
}

function currentSanitizedSelection() {
  const model = selectedModel();
  if (!model) throw new Error('Select a request first.');
  const suggested = applySuggestedRedactions(model, state.selectedCategories);
  const summary = combinedRedactionSummary(state.mandatorySummaries.get(model.id), suggested.summary);
  return { model: suggested.model, redactionSummary: summary };
}

function terminateWorker() {
  if (state.worker) state.worker.terminate();
  state.worker = null;
  clearTimeout(state.workerTimeout);
  state.workerTimeout = null;
  elements['cancel-generation'].hidden = true;
}

function runWorker(mode) {
  const payload = currentSanitizedSelection();
  terminateWorker();
  return new Promise((resolve, reject) => {
    const worker = new Worker(chrome.runtime.getURL('workers/generator.worker.js'), { type: 'module' });
    state.worker = worker;
    elements['cancel-generation'].hidden = false;
    const id = crypto.randomUUID();
    state.workerTimeout = setTimeout(() => {
      terminateWorker();
      reject(new Error('Artifact generation exceeded the 15-second limit.'));
    }, 15000);
    worker.addEventListener('message', (event) => {
      const message = event.data || {};
      if (message.type === 'progress') {
        setStatus(message.message || message.stage);
        return;
      }
      if (message.id !== id) return;
      if (message.type === 'error') {
        terminateWorker();
        reject(new Error(message.error?.message || 'Artifact generation failed.'));
      } else if (message.type === 'complete') {
        terminateWorker();
        resolve(message);
      }
    });
    worker.addEventListener('error', (event) => {
      terminateWorker();
      reject(new Error(event.message || 'Generator worker crashed.'));
    });
    worker.postMessage({ id, mode, ...payload });
  });
}

function resultContent(type) {
  if (!state.freeFiles) return '';
  if (type === 'curl') return state.freeFiles['request.curl.sh'] || '';
  if (type === 'fetch') return state.freeFiles['request.fetch.ts'] || '';
  return state.freeFiles['reproduction.md'] || '';
}

function renderResult(type) {
  state.currentResult = type;
  document.querySelectorAll('[data-result]').forEach((button) => button.setAttribute('aria-selected', String(button.dataset.result === type)));
  elements['result-code'].textContent = resultContent(type);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function zipFilename(model) {
  const pathPart = (model.path || 'request').split('?')[0].replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'request';
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `requestcapsule-${model.method}-${pathPart}-${timestamp}.zip`.toLowerCase();
}

async function generateFree() {
  try {
    setStatus('Generating free artifacts…');
    const result = await runWorker('free');
    state.freeFiles = result.files;
    elements['free-results'].hidden = false;
    renderResult('curl');
    elements['feedback-card'].hidden = false;
    setStatus('Free artifacts generated locally.');
    activateMobilePane('output');
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function generatePro() {
  if (!state.entitlement) {
    elements['license-import'].hidden = false;
    elements['license-token'].focus();
    setStatus('Import a valid signed development license to generate the Pro Test Pack.', true);
    return;
  }
  try {
    setStatus('Generating Pro Test Pack…');
    const result = await runWorker('pro');
    const model = selectedModel();
    downloadBlob(new Blob([result.zipBuffer], { type: 'application/zip' }), zipFilename(model));
    elements['feedback-card'].hidden = false;
    setStatus('Pro Test Pack downloaded.');
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function verifyAndStoreLicense(input) {
  const entitlement = await verifyLicenseDocument(input);
  await setValue('entitlement', entitlement);
  state.entitlement = entitlement;
  renderEntitlement();
  return entitlement;
}

function renderEntitlement() {
  const unlocked = Boolean(state.entitlement);
  elements['license-badge'].textContent = unlocked ? 'Pro unlocked' : 'Free';
  elements['generate-pro'].classList.toggle('secondary', !unlocked);
  elements['pro-gate'].hidden = unlocked;
}

async function importLicenseFromPanel() {
  try {
    let input = elements['license-token'].value.trim();
    const file = elements['license-file'].files?.[0];
    if (file) input = await file.text();
    await verifyAndStoreLicense(parseLicenseInput(input));
    elements['license-status'].textContent = 'RequestCapsule Pro unlocked locally.';
    setStatus('Signed license verified.');
  } catch (error) {
    elements['license-status'].textContent = error.message;
  }
}

async function saveSelectedCapture() {
  try {
    const { model, redactionSummary } = currentSanitizedSelection();
    await saveCapture({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      label: `${model.method} ${model.path}`,
      origin: model.origin,
      method: model.method,
      sanitizedUrl: model.sanitizedUrl,
      sanitizedRequest: { headers: model.requestHeaders, body: model.requestBody },
      sanitizedResponse: { headers: model.responseHeaders, body: model.responseBody, status: model.status },
      redactionSummary,
    });
    await renderSavedCaptures();
    setStatus('Sanitized capture saved in this browser profile.');
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function copyText(text, success) {
  if (new TextEncoder().encode(text).byteLength > 1024 * 1024) throw new Error('Clipboard output exceeds the 1 MB limit.');
  await navigator.clipboard.writeText(text);
  setStatus(success);
}

async function copyFeedback() {
  const model = selectedModel();
  const reuse = document.querySelector('input[name="reuse"]:checked')?.value || 'not answered';
  const lines = [
    'RequestCapsule validation feedback',
    'Version: 0.1.0',
    `Browser: ${navigator.userAgent.replace(/\([^)]*\)/g, '(redacted)')}`,
    `Method: ${model?.method || 'unknown'}`,
    `Response MIME: ${model?.responseMimeType || 'unknown'}`,
    `Artifacts: ${state.freeFiles ? Object.keys(state.freeFiles).join(', ') : 'none'}`,
    `Would use again: ${reuse}`,
    `Would commit with minor edits: ${elements['would-commit'].checked ? 'yes' : 'no'}`,
    `Would pay $29 once: ${elements['would-pay'].checked ? 'yes' : 'no'}`,
    `Most rewriting: ${elements['rewrite-notes'].value.trim() || 'not answered'}`,
  ];
  await setValue('validationFeedback', { reuse, wouldCommit: elements['would-commit'].checked, wouldPay: elements['would-pay'].checked, rewrite: elements['rewrite-notes'].value.trim() });
  await copyText(lines.join('\n'), 'Validation feedback copied without URL or request content.');
}

function activateMobilePane(name) {
  document.querySelectorAll('[data-pane]').forEach((pane) => pane.classList.toggle('active', pane.dataset.pane === name));
  document.querySelectorAll('[data-tab]').forEach((button) => button.setAttribute('aria-selected', String(button.dataset.tab === name)));
}

function clearSession() {
  terminateWorker();
  state.requests = [];
  state.runtimeEntries.clear();
  state.mandatorySummaries.clear();
  state.requestKeys.clear();
  state.selectedId = null;
  state.bodyBytes = 0;
  state.freeFiles = null;
  elements['inspect-content'].hidden = true;
  elements['inspect-loading'].hidden = true;
  elements['inspect-empty'].hidden = false;
  elements['output-content'].hidden = true;
  elements['output-empty'].hidden = false;
  elements['save-capture'].disabled = true;
  renderRequestList();
  setStatus('Session cleared.');
}

async function renderSavedCaptures() {
  try {
    const captures = (await listCaptures()).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    elements['saved-capture-count'].textContent = captures.length
      ? `${captures.length} sanitized capture${captures.length === 1 ? '' : 's'} saved locally.`
      : 'No saved captures.';
    const rows = captures.map((capture) => {
      const row = document.createElement('div');
      row.className = 'redaction-option';
      const label = document.createElement('span');
      label.textContent = capture.label || `${capture.method} ${capture.sanitizedUrl}`;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary';
      button.textContent = 'Delete';
      button.addEventListener('click', async () => {
        await deleteCapture(capture.id);
        await renderSavedCaptures();
      });
      row.append(label, button);
      return row;
    });
    elements['saved-capture-list'].replaceChildren(...rows);
  } catch (error) {
    elements['saved-capture-count'].textContent = `Local data unavailable: ${error.message}`;
  }
}

function bindEvents() {
  elements['resume-button'].addEventListener('click', () => setCaptureState(true));
  elements['pause-button'].addEventListener('click', () => setCaptureState(false));
  elements['clear-button'].addEventListener('click', clearSession);
  elements['demo-button'].addEventListener('click', () => location.assign('../demo/demo.html'));
  elements['dismiss-disclosure'].addEventListener('click', async () => {
    elements.disclosure.hidden = true;
    try { await setValue('onboardingCompleted', true); } catch { /* Non-fatal. */ }
  });
  for (const id of ['filter-text','filter-method','filter-status','filter-json','filter-failed']) {
    elements[id].addEventListener(id === 'filter-text' ? 'input' : 'change', renderRequestList);
  }
  elements['generate-free'].addEventListener('click', generateFree);
  elements['generate-pro'].addEventListener('click', generatePro);
  elements['cancel-generation'].addEventListener('click', () => {
    terminateWorker();
    setStatus('Generation cancelled.');
  });
  elements['save-capture'].addEventListener('click', saveSelectedCapture);
  elements['open-license'].addEventListener('click', () => { elements['license-import'].hidden = false; });
  elements['verify-license'].addEventListener('click', importLicenseFromPanel);
  document.querySelectorAll('[data-result]').forEach((button) => button.addEventListener('click', () => renderResult(button.dataset.result)));
  elements['copy-result'].addEventListener('click', async () => {
    try { await copyText(resultContent(state.currentResult), `${state.currentResult} copied.`); }
    catch (error) { setStatus(error.message, true); }
  });
  elements['download-markdown'].addEventListener('click', () => {
    if (!state.freeFiles) return;
    downloadBlob(new Blob([state.freeFiles['reproduction.md']], { type: 'text/markdown' }), 'requestcapsule-reproduction.md');
  });
  elements['copy-feedback'].addEventListener('click', async () => {
    try { await copyFeedback(); } catch (error) { setStatus(error.message, true); }
  });
  elements['refresh-saved'].addEventListener('click', renderSavedCaptures);
  elements['delete-saved'].addEventListener('click', async () => {
    try { await deleteAllCaptures(); await renderSavedCaptures(); setStatus('Saved captures deleted.'); }
    catch (error) { setStatus(error.message, true); }
  });
  elements['delete-all-data'].addEventListener('click', async () => {
    try { await deleteAllLocalData(); state.entitlement = null; renderEntitlement(); await renderSavedCaptures(); setStatus('All RequestCapsule local data deleted.'); }
    catch (error) { setStatus(error.message, true); }
  });
  document.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => activateMobilePane(button.dataset.tab)));
  elements['request-list'].addEventListener('keydown', (event) => {
    if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
    const rows = [...elements['request-list'].querySelectorAll('.request-row')];
    if (!rows.length) return;
    const current = rows.findIndex((row) => row.dataset.id === state.selectedId);
    if (event.key === 'Enter' && current >= 0) rows[current].click();
    else {
      const next = event.key === 'ArrowDown' ? Math.min(rows.length - 1, current + 1) : Math.max(0, current < 0 ? 0 : current - 1);
      rows[next].focus();
      rows[next].click();
    }
    event.preventDefault();
  });
}

function loadInitialHar() {
  try {
    chrome.devtools.network.getHAR((harLog) => {
      if (chrome.runtime.lastError) {
        setStatus(chrome.runtime.lastError.message, true);
        return;
      }
      for (const entry of harLog?.entries || []) addRequest(entry, { ignorePause: true });
    });
  } catch (error) {
    setStatus(`Could not read the current HAR: ${error.message}`, true);
  }
}

async function initialize() {
  bindEvents();
  setCaptureState(true);
  try {
    const [onboardingCompleted, entitlement] = await Promise.all([
      getValue('onboardingCompleted', false),
      getValue('entitlement', null),
    ]);
    elements.disclosure.hidden = Boolean(onboardingCompleted);
    state.entitlement = entitlement;
  } catch (error) {
    setStatus(`Local storage is unavailable: ${error.message}`, true);
  }
  renderEntitlement();
  await renderSavedCaptures();
  chrome.devtools.network.onRequestFinished.addListener((entry) => addRequest(entry));
  loadInitialHar();
  renderRequestList();
}

initialize();
