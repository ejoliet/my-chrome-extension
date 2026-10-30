'use strict';

export function sanitizeArchivePath(input) {
  const raw = String(input || '');
  if (/^(?:[\\/]|[A-Za-z]:[\\/])/.test(raw)) throw new Error(`Absolute archive path is not allowed: ${input}`);
  const normalized = raw.normalize('NFC').replace(/\\/g, '/');
  if (!normalized || normalized.includes('\0')) throw new Error('Archive path is empty or invalid.');
  const segments = normalized.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) throw new Error(`Unsafe archive path: ${input}`);
  const windowsReserved = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
  for (const segment of segments) {
    if (/[<>:"|?*]/.test(segment) || /[. ]$/.test(segment) || windowsReserved.test(segment)) {
      throw new Error(`Archive path is not portable: ${input}`);
    }
  }
  return segments.join('/');
}

export function validateFileMap(files) {
  const output = {};
  const seenInsensitive = new Set();
  for (const [rawPath, content] of Object.entries(files || {})) {
    const path = sanitizeArchivePath(rawPath);
    const collisionKey = path.normalize('NFC').toLocaleLowerCase('en-US');
    if (seenInsensitive.has(collisionKey)) throw new Error(`Duplicate or normalization-colliding path: ${path}`);
    seenInsensitive.add(collisionKey);
    output[path] = String(content ?? '');
  }
  return output;
}

function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function sha256Text(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return bytesToHex(new Uint8Array(digest));
}

export async function buildIntegrityManifest(files, model, redactionSummary, version = '0.1.0') {
  const validated = validateFileMap(files);
  const entries = [];
  for (const path of Object.keys(validated).sort()) {
    const encoded = new TextEncoder().encode(validated[path]);
    entries.push({ path, bytes: encoded.byteLength, sha256: await sha256Text(validated[path]) });
  }
  return {
    generator: 'RequestCapsule',
    generatorVersion: version,
    generatedAt: new Date().toISOString(),
    request: {
      origin: model.origin || '',
      method: model.method,
      path: model.path || '',
      status: model.status,
    },
    redactions: redactionSummary || { mandatory: {}, suggested: {} },
    files: entries,
  };
}
