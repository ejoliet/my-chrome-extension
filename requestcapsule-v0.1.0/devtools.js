'use strict';

chrome.devtools.panels.create(
  'RequestCapsule',
  'icons/icon-32.png',
  'panel/panel.html',
  () => {
    if (chrome.runtime.lastError) {
      console.error('RequestCapsule panel creation failed:', chrome.runtime.lastError.message);
    }
  },
);
