'use strict';

import { SUGGESTED_CATEGORIES, analyzeSuggested, applySuggestedRedactions, combinedRedactionSummary, sanitizeMandatoryModel } from '../panel/sanitizer.js';
import { getValue, setValue } from '../panel/idb.js';
import { parseLicenseInput, verifyLicenseDocument } from '../panel/license.js';

const elements = Object.fromEntries(['samples','mandatory','suggested','generate-free','generate-pro','license-token','license-file','verify-license','license-status','status','output'].map((id) => [id, document.getElementById(id)]));
const state = { samples: [], selected: null, selectedCategories: new Set(), entitlement: null, files: null, result: 'curl', worker: null };

function status(message, error = false) {
  elements.status.textContent = message;
  elements.status.style.color = error ? '#c92a2a' : '';
}

function renderSamples() {
  const nodes = state.samples.map((sample) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sample';
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', String(state.selected?.model.id === sample.model.id));
    button.textContent = `${sample.model.method} ${sample.model.status} — ${sample.label}`;
    button.addEventListener('click', () => selectSample(sample.model.id));
    return button;
  });
  elements.samples.replaceChildren(...nodes);
}

function selectSample(id) {
  state.selected = state.samples.find((sample) => sample.model.id === id) || null;
  state.files = null;
  elements.output.textContent = 'Choose a generator.';
  renderSamples();
  if (!state.selected) return;
  const mandatoryCount = Object.values(state.selected.mandatorySummary).reduce((sum, count) => sum + Number(count || 0), 0);
  elements.mandatory.textContent = `${mandatoryCount} mandatory value${mandatoryCount === 1 ? '' : 's'} removed before generation.`;
  const counts = analyzeSuggested(state.selected.model);
  state.selectedCategories = new Set(Object.keys(counts).filter((key) => counts[key] > 0));
  const controls = [];
  for (const [category, label] of Object.entries(SUGGESTED_CATEGORIES)) {
    if (!counts[category]) continue;
    const wrapper = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = true;
    input.addEventListener('change', () => input.checked ? state.selectedCategories.add(category) : state.selectedCategories.delete(category));
    wrapper.append(input, ` ${label} (${counts[category]})`);
    controls.push(wrapper);
  }
  if (!controls.length) {
    const p = document.createElement('p');
    p.textContent = 'No optional sensitive values detected.';
    controls.push(p);
  }
  elements.suggested.replaceChildren(...controls);
  status('Sample ready.');
}

function workerPayload() {
  if (!state.selected) throw new Error('Select a sample first.');
  const suggested = applySuggestedRedactions(state.selected.model, state.selectedCategories);
  return {
    model: suggested.model,
    redactionSummary: combinedRedactionSummary(state.selected.mandatorySummary, suggested.summary),
  };
}

function runWorker(mode) {
  if (state.worker) state.worker.terminate();
  return new Promise((resolve, reject) => {
    const worker = new Worker(chrome.runtime.getURL('workers/generator.worker.js'), { type: 'module' });
    state.worker = worker;
    const id = crypto.randomUUID();
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('Generation timed out.')); }, 15000);
    worker.addEventListener('message', (event) => {
      const message = event.data || {};
      if (message.type === 'progress') status(message.message || message.stage);
      if (message.id !== id) return;
      if (message.type === 'error') {
        clearTimeout(timer); worker.terminate(); reject(new Error(message.error?.message || 'Generation failed.'));
      } else if (message.type === 'complete') {
        clearTimeout(timer); worker.terminate(); resolve(message);
      }
    });
    worker.addEventListener('error', (event) => { clearTimeout(timer); worker.terminate(); reject(new Error(event.message)); });
    worker.postMessage({ id, mode, ...workerPayload() });
  });
}

function preview(type) {
  state.result = type;
  if (!state.files) return;
  const path = type === 'curl' ? 'request.curl.sh' : type === 'fetch' ? 'request.fetch.ts' : 'reproduction.md';
  elements.output.textContent = state.files[path] || 'This preview is available after free generation.';
  document.querySelectorAll('[data-result]').forEach((button) => {
    const active = button.dataset.result === type;
    button.classList.toggle('secondary', !active);
  });
}

function downloadZip(buffer) {
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/zip' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'requestcapsule-demo-test-pack.zip';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

elements['generate-free'].addEventListener('click', async () => {
  try {
    const result = await runWorker('free');
    state.files = result.files;
    preview('curl');
    status('Free artifacts generated with the production generator.');
  } catch (error) { status(error.message, true); }
});

elements['generate-pro'].addEventListener('click', async () => {
  if (!state.entitlement) { status('Import a valid development license first.', true); return; }
  try {
    const result = await runWorker('pro');
    downloadZip(result.zipBuffer);
    status('Pro demo ZIP downloaded.');
  } catch (error) { status(error.message, true); }
});

document.querySelectorAll('[data-result]').forEach((button) => button.addEventListener('click', () => preview(button.dataset.result)));

elements['verify-license'].addEventListener('click', async () => {
  try {
    let input = elements['license-token'].value.trim();
    const file = elements['license-file'].files?.[0];
    if (file) input = await file.text();
    state.entitlement = await verifyLicenseDocument(parseLicenseInput(input));
    await setValue('entitlement', state.entitlement);
    elements['license-status'].textContent = 'Development license verified.';
  } catch (error) { elements['license-status'].textContent = error.message; }
});

async function initialize() {
  const raw = await fetch('./sample-captures.json').then((response) => response.json());
  state.samples = raw.map((sample) => {
    const { label, ...model } = sample;
    const mandatory = sanitizeMandatoryModel({ ...model, sanitizedUrl: model.originalUrl });
    return { label, model: mandatory.model, mandatorySummary: mandatory.summary };
  });
  try { state.entitlement = await getValue('entitlement', null); } catch { state.entitlement = null; }
  renderSamples();
  selectSample(state.samples[0].model.id);
}

initialize().catch((error) => status(error.message, true));
