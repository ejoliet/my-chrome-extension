const tokenInput = document.getElementById('tokenInput');
const saveBtn = document.getElementById('saveBtn');
const clearBtn = document.getElementById('clearBtn');
const statusEl = document.getElementById('status');

function setStatus(message, type = '') {
  statusEl.textContent = message || '';
  statusEl.className = `status ${type}`.trim();
}

async function load() {
  const data = await chrome.storage.local.get({ githubToken: '' });
  tokenInput.value = data.githubToken || '';
  setStatus(data.githubToken ? 'Token is saved locally.' : 'No token saved. Public gists work without one.');
}

saveBtn.addEventListener('click', async () => {
  const token = tokenInput.value.trim();
  await chrome.storage.local.set({ githubToken: token });
  setStatus(token ? 'Token saved.' : 'Empty token saved; private gist access disabled.', token ? 'ok' : '');
});

clearBtn.addEventListener('click', async () => {
  tokenInput.value = '';
  await chrome.storage.local.remove('githubToken');
  setStatus('Token cleared.', 'ok');
});

load();
