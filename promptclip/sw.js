chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') {
    await chrome.storage.local.set({
      pc_settings: { yamlTemplate: 'title,url,captured_at,source,mode', previewLimit: 50000 }
    });
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'clip-current-page') return;
  // AIDEV-NOTE: MV3 allows action.openPopup from extension command handlers in recent Chrome.
  try {
    await chrome.action.openPopup();
  } catch (_err) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) chrome.action.setBadgeText({ tabId: tab.id, text: 'PC' });
  }
});
