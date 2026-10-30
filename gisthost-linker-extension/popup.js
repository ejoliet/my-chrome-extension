const GISTHOST_BASE = 'https://gisthost.github.io/';

const gistInput = document.getElementById('gistInput');
const buildBtn = document.getElementById('buildBtn');
const useTabBtn = document.getElementById('useTabBtn');
const result = document.getElementById('result');
const files = document.getElementById('files');
const statusEl = document.getElementById('status');

function setStatus(message, type = '') {
  statusEl.textContent = message || '';
  statusEl.className = `status ${type}`.trim();
}

function extractGistId(value) {
  const raw = (value || '').trim();
  if (!raw) return '';

  try {
    const url = new URL(raw);
    if (url.hostname === 'gist.github.com') {
      const parts = url.pathname.split('/').filter(Boolean);
      return parts.at(-1) || '';
    }
    if (url.hostname === 'api.github.com' && url.pathname.includes('/gists/')) {
      return url.pathname.split('/').filter(Boolean).at(-1) || '';
    }
  } catch (_) {
    // Not a URL; treat it as a raw gist id below.
  }

  return raw.replace(/^gist:/i, '').replace(/[^a-f0-9]/gi, '');
}

function buildGistHostUrl(gistId) {
  return `${GISTHOST_BASE}?${encodeURIComponent(gistId)}`;
}

async function getToken() {
  const data = await chrome.storage.local.get({ githubToken: '' });
  return data.githubToken || '';
}

async function fetchGist(gistId) {
  const token = await getToken();
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };

  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`https://api.github.com/gists/${gistId}`, { headers });
  if (!response.ok) {
    const hint = response.status === 404
      ? 'Gist not found, or the token cannot read it.'
      : `GitHub API returned ${response.status}.`;
    throw new Error(hint);
  }
  return response.json();
}

function renderLink(gistId) {
  const url = buildGistHostUrl(gistId);
  result.classList.remove('hidden');
  result.innerHTML = `
    <div class="result-row">
      <a href="${url}" target="_blank" rel="noreferrer">${url}</a>
      <button class="copy" id="copyBtn" type="button">Copy</button>
    </div>
  `;
  document.getElementById('copyBtn').addEventListener('click', async () => {
    await navigator.clipboard.writeText(url);
    setStatus('Copied.', 'ok');
  });
}

function renderFiles(gist) {
  const entries = Object.values(gist.files || {});
  if (!entries.length) {
    files.classList.add('hidden');
    files.innerHTML = '';
    return;
  }

  const indexFile = entries.find(file => file.filename.toLowerCase() === 'index.html');
  const sorted = [...entries].sort((a, b) => {
    if (a === indexFile) return -1;
    if (b === indexFile) return 1;
    return a.filename.localeCompare(b.filename);
  });

  files.classList.remove('hidden');
  files.innerHTML = `
    <h2>${gist.description ? escapeHtml(gist.description) : 'Gist files'}</h2>
    <ul class="file-list">
      ${sorted.map(file => `
        <li>
          <span class="file-name">${escapeHtml(file.filename)}</span>
          <span class="file-meta">${escapeHtml(file.type || 'file')} · ${formatBytes(file.size || 0)}${file === indexFile ? ' · likely demo entry' : ''}</span>
        </li>
      `).join('')}
    </ul>
  `;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#039;',
    '"': '&quot;'
  }[char]));
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB'];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

async function build() {
  const gistId = extractGistId(gistInput.value);
  result.classList.add('hidden');
  files.classList.add('hidden');

  if (!gistId || gistId.length < 8) {
    setStatus('Paste a valid Gist URL or ID.', 'error');
    return;
  }

  gistInput.value = gistId;
  renderLink(gistId);
  setStatus('Checking gist metadata...');

  try {
    const gist = await fetchGist(gistId);
    renderFiles(gist);
    const hasIndex = Object.keys(gist.files || {}).some(name => name.toLowerCase() === 'index.html');
    setStatus(hasIndex ? 'Ready. index.html found.' : 'Ready. No index.html detected in this gist.', hasIndex ? 'ok' : '');
  } catch (error) {
    setStatus(`${error.message} The link was still generated from the ID.`, 'error');
  }
}

async function useCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url) {
    gistInput.value = tab.url;
    await build();
  } else {
    setStatus('Could not read current tab URL.', 'error');
  }
}

buildBtn.addEventListener('click', build);
useTabBtn.addEventListener('click', useCurrentTab);
gistInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') build();
});

useCurrentTab().catch(() => setStatus('Paste a Gist URL or ID to start.'));
