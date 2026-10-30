'use strict';

import { generateFreeFiles, generateProFiles, stableStringify } from '../panel/generators.js';
import { buildIntegrityManifest, validateFileMap } from './packager.js';
import { strToU8, zip } from '../vendor/fflate.module.js';

const ZIP_LIMIT = 25 * 1024 * 1024;

function postProgress(stage, message) {
  postMessage({ type: 'progress', stage, message });
}

function zipFiles(files) {
  const zippable = {};
  for (const [path, content] of Object.entries(files)) {
    zippable[`requestcapsule/${path}`] = [strToU8(content), { level: /\.(?:json|md|ts|sh|txt|example)$/i.test(path) ? 6 : 0 }];
  }
  return new Promise((resolve, reject) => {
    zip(zippable, { level: 6 }, (error, data) => {
      if (error) reject(error);
      else resolve(data);
    });
  });
}

self.addEventListener('message', async (event) => {
  const { id, mode, model, redactionSummary } = event.data || {};
  try {
    if (!id || !model) throw new Error('Generator input is incomplete.');
    postProgress('generating', 'Generating files…');
    const generated = mode === 'pro'
      ? generateProFiles(model, redactionSummary)
      : generateFreeFiles(model, redactionSummary);
    const files = validateFileMap(generated);

    if (mode !== 'pro') {
      postMessage({ type: 'complete', id, mode, files });
      return;
    }

    postProgress('hashing', 'Hashing generated files…');
    const integrityManifest = await buildIntegrityManifest(files, model, redactionSummary);
    files['manifest.json'] = `${stableStringify(integrityManifest)}\n`;

    postProgress('compressing', 'Compressing Test Pack…');
    const zipped = await zipFiles(files);
    if (zipped.byteLength > ZIP_LIMIT) {
      throw Object.assign(new Error('Generated ZIP exceeds the 25 MB limit.'), { code: 'ZIP_TOO_LARGE', stage: 'compressing' });
    }
    const buffer = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength);
    postMessage({ type: 'complete', id, mode, files, zipBuffer: buffer }, [buffer]);
  } catch (error) {
    postMessage({
      type: 'error',
      id,
      error: {
        code: error.code || 'GENERATION_FAILED',
        stage: error.stage || 'generating',
        message: error.message || 'Artifact generation failed.',
        recoverable: true,
      },
    });
  }
});
