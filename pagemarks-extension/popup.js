'use strict';

const summary = document.querySelector('#summary');
const pageTitle = summary.querySelector('.page-title');
const statStrong = summary.querySelectorAll('.stats strong');
let activeTabId = null;

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab?.id ?? null;
  return tab;
}

async function send(message) {
  if (!activeTabId) await getActiveTab();
  if (!activeTabId) return false;
  try {
    await chrome.tabs.sendMessage(activeTabId, message);
    window.close();
    return true;
  } catch {
    pageTitle.textContent = 'PageMarks cannot run on this browser page';
    summary.classList.remove('loading');
    return false;
  }
}

async function loadSummary() {
  const tab = await getActiveTab();
  if (!tab?.id) return;
  try {
    const data = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_SUMMARY' });
    pageTitle.textContent = data.title || 'Untitled page';
    statStrong[0].textContent = data.count;
    statStrong[1].textContent = data.highlights;
    statStrong[2].textContent = data.stickies;
  } catch {
    pageTitle.textContent = 'Unavailable on Chrome system pages';
    statStrong.forEach((item) => { item.textContent = '0'; });
  } finally {
    summary.classList.remove('loading');
  }
}

document.querySelector('#openPanel').addEventListener('click', () => send({ type: 'TOGGLE_PANEL', forceOpen: true }));
document.querySelector('#addSticky').addEventListener('click', () => send({ type: 'CREATE_STICKY_CENTER' }));
document.querySelector('#highlight').addEventListener('click', () => send({ type: 'CREATE_HIGHLIGHT', openEditor: true }));
document.querySelector('#allNotes').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'OPEN_MANAGER' });
  window.close();
});

loadSummary();
