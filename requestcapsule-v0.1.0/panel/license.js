'use strict';

export const DEVELOPMENT_PUBLIC_JWK = Object.freeze({
  key_ops: ['verify'],
  ext: true,
  kty: 'EC',
  x: 'XZO7tn8bVIvxjt9bUakrMyFqfHAd2m5CYOgvYIlNY8s',
  y: '2pNnyXW87kZyWi04heR6YtxLkihQx8eaPfXxvORRI6w',
  crv: 'P-256',
});

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(normalized + padding);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function canonicalEntitlement(entitlement) {
  return JSON.stringify({
    product: String(entitlement.product || ''),
    licenseId: String(entitlement.licenseId || ''),
    issuedAt: String(entitlement.issuedAt || ''),
    edition: String(entitlement.edition || ''),
  });
}

export function encodeLicenseToken(document) {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(document)));
}

export function decodeLicenseToken(token) {
  try {
    const decoded = new TextDecoder().decode(base64UrlToBytes(String(token).trim()));
    return JSON.parse(decoded);
  } catch (error) {
    throw new Error(`Invalid entitlement token: ${error.message}`);
  }
}

export function parseLicenseInput(input) {
  if (typeof input === 'object' && input) return input;
  const text = String(input || '').trim();
  if (!text) throw new Error('No license was provided.');
  if (text.startsWith('{')) {
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error(`Invalid license JSON: ${error.message}`);
    }
  }
  return decodeLicenseToken(text);
}

export async function verifyLicenseDocument(input, publicJwk = DEVELOPMENT_PUBLIC_JWK) {
  const document = parseLicenseInput(input);
  for (const field of ['product', 'licenseId', 'issuedAt', 'edition', 'signature']) {
    if (!document[field] || typeof document[field] !== 'string') throw new Error(`License field ${field} is missing.`);
  }
  if (document.product !== 'requestcapsule-pro') throw new Error('This license is not for RequestCapsule Pro.');
  const issuedAt = Date.parse(document.issuedAt);
  if (!Number.isFinite(issuedAt)) throw new Error('License issuedAt is invalid.');
  if (issuedAt > Date.now() + 5 * 60 * 1000) throw new Error('License issue date is in the future.');

  const key = await crypto.subtle.importKey(
    'jwk',
    publicJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  const valid = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    base64UrlToBytes(document.signature),
    new TextEncoder().encode(canonicalEntitlement(document)),
  );
  if (!valid) throw new Error('License signature is invalid.');
  return {
    product: document.product,
    licenseId: document.licenseId,
    issuedAt: document.issuedAt,
    edition: document.edition,
    verifiedAt: new Date().toISOString(),
  };
}

export function signatureToBase64Url(signatureBytes) {
  return bytesToBase64Url(signatureBytes);
}
