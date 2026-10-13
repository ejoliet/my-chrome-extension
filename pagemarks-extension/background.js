'use strict';

const MENU = {
  selection: 'pagemarks-selection',
  link: 'pagemarks-link',
  sticky: 'pagemarks-sticky',
  panel: 'pagemarks-panel'
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU.selection,
      title: 'Save selection to PageMarks',
      contexts: ['selection']
    });
    chrome.contextMenus.create({
      id: MENU.link,
      title: 'Add a note to this link',
      contexts: ['link']
    });
    chrome.contextMenus.create({
      id: MENU.sticky,
      title: 'Place a sticky note here',
      contexts: ['page']
    });
    chrome.contextMenus.create({
      id: MENU.panel,
      title: 'Open PageMarks for this page',
      contexts: ['page', 'selection', 'link']
    });
  });
});

async function sendToTab(tabId, message) {
  if (!tabId) return;
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch {
    // Restricted pages such as chrome:// cannot host content scripts.
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === MENU.selection) {
    sendToTab(tab.id, { type: 'CREATE_HIGHLIGHT', openEditor: true });
  } else if (info.menuItemId === MENU.link) {
    sendToTab(tab.id, {
      type: 'CREATE_LINK_NOTE',
      linkUrl: info.linkUrl || '',
      openEditor: true
    });
  } else if (info.menuItemId === MENU.sticky) {
    sendToTab(tab.id, { type: 'CREATE_STICKY_AT_CONTEXT' });
  } else if (info.menuItemId === MENU.panel) {
    sendToTab(tab.id, { type: 'TOGGLE_PANEL', forceOpen: true });
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  if (command === 'toggle-panel') {
    sendToTab(tab.id, { type: 'TOGGLE_PANEL' });
  } else if (command === 'new-sticky') {
    sendToTab(tab.id, { type: 'CREATE_STICKY_CENTER' });
  } else if (command === 'highlight-selection') {
    sendToTab(tab.id, { type: 'CREATE_HIGHLIGHT', openEditor: false });
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'OPEN_MANAGER') {
    chrome.tabs.create({ url: chrome.runtime.getURL('manager.html') });
  }
});
