'use strict';

import { setValue } from '../panel/idb.js';
import { parseLicenseInput, verifyLicenseDocument } from '../panel/license.js';

const demoButton = document.getElementById('try-demo');
const showLicenseButton = document.getElementById('show-license');
const licenseSection = document.getElementById('license-section');
const licenseToken = document.getElementById('license-token');
const licenseFile = document.getElementById('license-file');
const importButton = document.getElementById('import-license');
const licenseStatus = document.getElementById('license-status');

demoButton.addEventListener('click', () => {
  window.open(chrome.runtime.getURL('demo/demo.html'), '_blank', 'noopener,noreferrer');
});

showLicenseButton.addEventListener('click', () => {
  licenseSection.hidden = false;
  licenseToken.focus();
});

importButton.addEventListener('click', async () => {
  try {
    let input = licenseToken.value.trim();
    const file = licenseFile.files?.[0];
    if (file) input = await file.text();
    const entitlement = await verifyLicenseDocument(parseLicenseInput(input));
    await setValue('entitlement', entitlement);
    licenseStatus.textContent = 'RequestCapsule Pro unlocked locally.';
  } catch (error) {
    licenseStatus.textContent = error.message;
  }
});
