const PREVIEW_LIMIT = 50000;
const LICENSE_PUBLIC_KEY_B64 = 'REPLACE_WITH_BASE64_TWEETNACL_PUBLIC_KEY';

const $ = (id) => document.getElementById(id);
const state = { fullMarkdown: '', tab: null, result: null };

function setVisible(id, visible) { $(id).classList.toggle('hidden', !visible); }
function setStatus(text, loading = false) {
  $('statusText').textContent = text;
  $('status').querySelector('.spinner').classList.toggle('hidden', !loading);
  setVisible('status', true);
}
function showToast(text) {
  $('toast').textContent = text;
  setVisible('toast', true);
  setTimeout(() => setVisible('toast', false), 1800);
}
function safeFileName(title) {
  return (title || 'promptclip').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'promptclip';
}
function fmt(n) { return Number(n || 0).toLocaleString(); }
function isBlockedUrl(url = '') {
  return /^(chrome|edge|brave|vivaldi|opera|about|devtools):/i.test(url) || url.startsWith('chrome-extension://');
}
function isPdfUrl(url = '') { return /\.pdf($|[?#])/i.test(url); }
function b64ToU8(b64) {
  const bin = atob(b64.replace(/\s+/g, ''));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
function u8FromString(s) { return new TextEncoder().encode(s); }

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function ensureOnboarding() {
  const { pc_onboarded } = await chrome.storage.local.get('pc_onboarded');
  setVisible('onboarding', !pc_onboarded);
}

async function runExtraction(tab) {
  if (!tab?.id) throw new Error('No active tab found.');
  if (isBlockedUrl(tab.url)) throw new Error('Chrome blocks extensions from reading browser, extension, Web Store, and internal pages. Open a normal web page and try again.');
  if (isPdfUrl(tab.url)) throw new Error('PDF pages are not supported in this MVP. Download the PDF and convert it separately.');

  // AIDEV-NOTE: activeTab grants temporary host access only after the user opens/clicks the extension.
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['lib/readability/Readability.js'] });
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['lib/turndown/turndown.js'] });
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/extract.js'] });
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => window.PromptClipExtract()
  });
  return injection?.result;
}

function renderResult(result) {
  state.result = result;
  state.fullMarkdown = result.markdown;
  setVisible('status', false);
  setVisible('errorBox', false);
  setVisible('fallbackBanner', result.mode === 'fallback');
  setVisible('result', true);
  $('tokenCount').textContent = fmt(result.tokenEstimate);
  $('mdChars').textContent = fmt(result.markdownChars);
  const pct = result.originalChars ? Math.round((result.markdownChars / result.originalChars) * 100) : 0;
  $('rawCompare').textContent = `${pct}%`;
  const truncated = result.markdown.length > PREVIEW_LIMIT;
  $('preview').value = truncated ? `${result.markdown.slice(0, PREVIEW_LIMIT)}\n\n<!-- Preview truncated. Copy/Download include full Markdown. -->` : result.markdown;
  setVisible('truncateNote', truncated);
  showToast(`Ready: ${fmt(result.tokenEstimate)} tokens est.`);
}

function renderError(message) {
  setVisible('status', false);
  setVisible('result', false);
  setVisible('fallbackBanner', false);
  $('errorBox').textContent = message || 'PromptClip could not extract this page.';
  setVisible('errorBox', true);
}

async function copyMarkdown() {
  await navigator.clipboard.writeText(state.fullMarkdown);
  showToast(`Copied ${fmt(state.result?.tokenEstimate)} tokens est.`);
}

function downloadMarkdown() {
  const blob = new Blob([state.fullMarkdown], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${safeFileName(state.result?.title)}.md`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  showToast('Downloaded Markdown file.');
}

async function saveSettings() {
  const pc_settings = { yamlTemplate: $('yamlTemplate').value.trim(), previewLimit: PREVIEW_LIMIT };
  await chrome.storage.local.set({ pc_settings });
  showToast('Settings saved.');
}

function canonicalLicensePayload(license) {
  return JSON.stringify({
    email: license.email || '',
    product: license.product || 'PromptClip',
    expires: license.expires || 'lifetime'
  });
}

async function verifyLicenseString(raw) {
  const license = JSON.parse(raw);
  if (!license.signature) throw new Error('Missing signature.');
  if (LICENSE_PUBLIC_KEY_B64.startsWith('REPLACE_')) {
    throw new Error('Set LICENSE_PUBLIC_KEY_B64 in popup.js before production license checks.');
  }
  const message = u8FromString(canonicalLicensePayload(license));
  const signature = b64ToU8(license.signature);
  const publicKey = b64ToU8(LICENSE_PUBLIC_KEY_B64);
  const ok = nacl.sign.detached.verify(message, signature, publicKey);
  if (!ok) throw new Error('Signature rejected.');
  await chrome.storage.local.set({ pc_license: license });
  return license;
}

async function verifyLicense() {
  try {
    const license = await verifyLicenseString($('licenseInput').value.trim());
    $('licenseStatus').textContent = `Accepted: ${license.email || 'licensed user'} (${license.expires || 'lifetime'})`;
  } catch (err) {
    $('licenseStatus').textContent = `Rejected: ${err.message}`;
  }
}

async function init() {
  $('dismissOnboarding').addEventListener('click', async () => {
    await chrome.storage.local.set({ pc_onboarded: true });
    setVisible('onboarding', false);
  });
  $('copyBtn').addEventListener('click', copyMarkdown);
  $('downloadBtn').addEventListener('click', downloadMarkdown);
  $('settingsBtn').addEventListener('click', () => setVisible('settingsPanel', $('settingsPanel').classList.contains('hidden')));
  $('saveSettings').addEventListener('click', saveSettings);
  $('verifyLicense').addEventListener('click', verifyLicense);
  $('proBtn').addEventListener('click', () => $('upsellModal').showModal());

  const { pc_settings, pc_license } = await chrome.storage.local.get(['pc_settings', 'pc_license']);
  if (pc_settings?.yamlTemplate) $('yamlTemplate').value = pc_settings.yamlTemplate;
  if (pc_license) $('licenseInput').value = JSON.stringify(pc_license, null, 2);

  await ensureOnboarding();
  setStatus('Extracting current page…', true);
  try {
    state.tab = await getActiveTab();
    const result = await runExtraction(state.tab);
    if (!result?.ok || !result.markdown) throw new Error('Extractor returned no Markdown.');
    renderResult(result);
  } catch (err) {
    const msg = chrome.runtime.lastError?.message || err.message || String(err);
    renderError(msg.includes('Cannot access') ? 'This page is blocked by Chrome or the site. Try a normal web page.' : msg);
  }
}

document.addEventListener('DOMContentLoaded', init);
