'use strict';

export const MAX_REQUESTS = 250;
export const REQUEST_BODY_LIMIT = 1024 * 1024;
export const RESPONSE_BODY_LIMIT = 2 * 1024 * 1024;
export const SESSION_BODY_LIMIT = 20 * 1024 * 1024;

const TEXT_MIME_RE = /(?:json|text|xml|javascript|graphql|x-www-form-urlencoded)/i;
const BINARY_MIME_RE = /^(?:image|audio|video|font)\//i;

function headerValue(headers, name) {
  const match = (headers || []).find((header) => String(header.name).toLowerCase() === name.toLowerCase());
  return match ? String(match.value ?? '') : '';
}

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function isTextualMime(mimeType = '') {
  if (!mimeType) return true;
  return !BINARY_MIME_RE.test(mimeType) && TEXT_MIME_RE.test(mimeType);
}

export function isApiLike(entry) {
  const mime = String(entry?.response?.content?.mimeType || headerValue(entry?.response?.headers, 'content-type'));
  const url = String(entry?.request?.url || '');
  const resourceType = String(entry?._resourceType || '').toLowerCase();
  if (['image', 'media', 'font', 'stylesheet', 'script', 'websocket'].includes(resourceType)) return false;
  if (BINARY_MIME_RE.test(mime)) return false;
  if (TEXT_MIME_RE.test(mime)) return true;
  if (/graphql/i.test(url)) return true;
  return ['xhr', 'fetch', 'document', 'other'].includes(resourceType) && !mime;
}

export function normalizeHarEntry(entry, id) {
  const request = entry.request || {};
  const response = entry.response || {};
  const parsed = parseUrl(request.url || '');
  const requestHeaders = (request.headers || []).map(({ name, value }) => ({ name: String(name), value: String(value ?? '') }));
  const responseHeaders = (response.headers || []).map(({ name, value }) => ({ name: String(name), value: String(value ?? '') }));
  const requestMimeType = String(request.postData?.mimeType || headerValue(requestHeaders, 'content-type'));
  const responseMimeType = String(response.content?.mimeType || headerValue(responseHeaders, 'content-type'));
  const requestBody = request.postData?.text == null ? '' : String(request.postData.text);

  return {
    id,
    timestamp: entry.startedDateTime || new Date().toISOString(),
    method: String(request.method || 'GET').toUpperCase(),
    originalUrl: String(request.url || ''),
    sanitizedUrl: String(request.url || ''),
    origin: parsed?.origin || '',
    hostname: parsed?.hostname || '',
    path: parsed ? `${parsed.pathname}${parsed.search}` : String(request.url || ''),
    httpVersion: String(request.httpVersion || response.httpVersion || ''),
    status: Number(response.status || 0),
    statusText: String(response.statusText || ''),
    requestHeaders,
    responseHeaders,
    queryParameters: (request.queryString || []).map(({ name, value }) => ({ name: String(name), value: String(value ?? '') })),
    requestBody,
    responseBody: '',
    responseBodyEncoding: '',
    requestMimeType,
    responseMimeType,
    duration: Number(entry.time || 0),
    requestSize: Math.max(0, Number(request.bodySize || request.headersSize || 0)),
    responseSize: Math.max(0, Number(response.content?.size || response.bodySize || 0)),
    resourceType: String(entry._resourceType || ''),
    bodyLoaded: false,
    bodyError: '',
    lastAccessedAt: Date.now(),
  };
}

export function matchesFilters(model, filters) {
  const text = String(filters.text || '').trim().toLowerCase();
  if (text && !`${model.method} ${model.originalUrl} ${model.hostname} ${model.path}`.toLowerCase().includes(text)) return false;
  if (filters.method && model.method !== filters.method) return false;
  if (filters.status && String(model.status).charAt(0) !== String(filters.status)) return false;
  if (filters.failed && model.status < 400) return false;
  if (filters.jsonOnly && !isTextualMime(model.responseMimeType || model.requestMimeType)) return false;
  return true;
}

export function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
