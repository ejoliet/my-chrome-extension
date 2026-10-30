'use strict';

const MANDATORY_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-csrf-token',
  'x-xsrf-token',
  'csrf-token',
  'x-session-token',
]);

const CREDENTIAL_KEY_RE = /^(?:token|secret|password|passwd|credential|session|jwt|signature|api[_-]?key|access[_-]?key|refresh[_-]?token|client[_-]?secret|code)$/i;
const ACCOUNT_ID_KEY_RE = /^(?:account|user|customer|member|tenant|organization|org)[_-]?id$/i;

const PATTERNS = [
  { category: 'jwt', placeholder: '{{REDACTED_JWT}}', regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { category: 'private_key', placeholder: '{{REDACTED_PRIVATE_KEY}}', regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { category: 'aws_key', placeholder: '{{REDACTED_AWS_KEY}}', regex: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { category: 'github_token', placeholder: '{{REDACTED_GITHUB_TOKEN}}', regex: /\bgh[pousr]_[A-Za-z0-9]{20,255}\b/g },
  { category: 'stripe_key', placeholder: '{{REDACTED_STRIPE_KEY}}', regex: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,255}\b/g },
  { category: 'google_key', placeholder: '{{REDACTED_GOOGLE_KEY}}', regex: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { category: 'bearer', placeholder: 'Bearer {{REDACTED_BEARER_TOKEN}}', regex: /\bBearer\s+[A-Za-z0-9._~+\/-]{12,}=*/gi },
];

export const SUGGESTED_CATEGORIES = Object.freeze({
  credential_key: 'Credential-like fields',
  email: 'Email addresses',
  phone: 'Phone numbers',
  ip: 'IP addresses',
  payment_card: 'Payment-card-like values',
  uuid: 'UUIDs',
  account_id: 'Account-like identifiers',
});

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function increment(summary, category, amount = 1) {
  summary[category] = (summary[category] || 0) + amount;
}

export function detectJwt(value) {
  return /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/.test(String(value));
}

export function passesLuhn(value) {
  const digits = String(value).replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

export function redactHeaders(headers, summary = {}) {
  return (headers || []).map((header) => {
    const name = String(header.name || '');
    if (MANDATORY_HEADER_NAMES.has(name.toLowerCase())) {
      increment(summary, `header:${name.toLowerCase()}`);
      return { name, value: `{{REDACTED_${name.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}}}` };
    }
    return { name, value: sanitizeMandatoryText(String(header.value ?? ''), summary) };
  });
}

export function sanitizeMandatoryText(input, summary = {}) {
  let output = String(input ?? '');
  for (const pattern of PATTERNS) {
    pattern.regex.lastIndex = 0;
    const matches = output.match(pattern.regex);
    if (matches?.length) increment(summary, pattern.category, matches.length);
    pattern.regex.lastIndex = 0;
    output = output.replace(pattern.regex, pattern.placeholder);
  }
  return output;
}

function sanitizeMandatoryValue(value, key, summary, depth = 0) {
  if (depth > 50) throw new Error('JSON nesting exceeds 50 levels.');
  if (CREDENTIAL_KEY_RE.test(key || '')) {
    increment(summary, 'credential_key');
    return '{{REDACTED_SECRET}}';
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeMandatoryValue(item, '', summary, depth + 1));
  if (value && typeof value === 'object') {
    const result = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      result[childKey] = sanitizeMandatoryValue(childValue, childKey, summary, depth + 1);
    }
    return result;
  }
  if (typeof value === 'string') return sanitizeMandatoryText(value, summary);
  return value;
}

function parseBody(body) {
  const text = String(body ?? '');
  const trimmed = text.trim();
  if (!trimmed) return { kind: 'empty', value: '' };
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return { kind: 'json', value: JSON.parse(trimmed) };
    } catch {
      return { kind: 'text', value: text };
    }
  }
  return { kind: 'text', value: text };
}

function serializeBody(parsed) {
  if (parsed.kind === 'json') return JSON.stringify(parsed.value, null, 2);
  return parsed.value;
}

export function sanitizeUrlMandatory(urlValue, summary = {}) {
  try {
    const url = new URL(String(urlValue));
    for (const [key, value] of [...url.searchParams.entries()]) {
      if (CREDENTIAL_KEY_RE.test(key)) {
        url.searchParams.set(key, '{{REDACTED_SECRET}}');
        increment(summary, 'query_credential');
      } else {
        url.searchParams.set(key, sanitizeMandatoryText(value, summary));
      }
    }
    return url.toString();
  } catch {
    return sanitizeMandatoryText(String(urlValue), summary);
  }
}

export function sanitizeMandatoryModel(rawModel) {
  const model = clone(rawModel);
  const summary = {};
  model.originalUrl = sanitizeUrlMandatory(model.originalUrl, summary);
  model.sanitizedUrl = model.originalUrl;
  try {
    const parsed = new URL(model.originalUrl);
    model.origin = parsed.origin;
    model.hostname = parsed.hostname;
    model.path = `${parsed.pathname}${parsed.search}`;
    model.queryParameters = [...parsed.searchParams.entries()].map(([name, value]) => ({ name, value }));
  } catch {
    model.queryParameters = (model.queryParameters || []).map(({ name, value }) => ({ name, value: sanitizeMandatoryText(value, summary) }));
  }
  model.requestHeaders = redactHeaders(model.requestHeaders, summary);
  model.responseHeaders = redactHeaders(model.responseHeaders, summary);

  for (const field of ['requestBody', 'responseBody']) {
    const parsed = parseBody(model[field]);
    if (parsed.kind === 'json') parsed.value = sanitizeMandatoryValue(parsed.value, '', summary);
    else parsed.value = sanitizeMandatoryText(parsed.value, summary);
    model[field] = serializeBody(parsed);
  }
  return { model, summary };
}

function categoriesInScalar(value, key, counts) {
  const text = String(value ?? '');
  if (CREDENTIAL_KEY_RE.test(key || '')) increment(counts, 'credential_key');
  if (ACCOUNT_ID_KEY_RE.test(key || '')) increment(counts, 'account_id');
  const emails = text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi);
  if (emails) increment(counts, 'email', emails.length);
  const ips = text.match(/\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g);
  if (ips) increment(counts, 'ip', ips.length);
  const uuids = text.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi);
  if (uuids) increment(counts, 'uuid', uuids.length);
  const phones = text.match(/(?<!\w)(?:\+?\d[\d ().-]{7,}\d)(?!\w)/g);
  if (phones) increment(counts, 'phone', phones.length);
  const cardCandidates = text.match(/\b(?:\d[ -]*?){13,19}\b/g) || [];
  const validCards = cardCandidates.filter(passesLuhn);
  if (validCards.length) increment(counts, 'payment_card', validCards.length);
}

function analyzeValue(value, key, counts, depth = 0) {
  if (depth > 50) return;
  if (Array.isArray(value)) {
    value.forEach((item) => analyzeValue(item, '', counts, depth + 1));
  } else if (value && typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(value)) analyzeValue(childValue, childKey, counts, depth + 1);
  } else {
    categoriesInScalar(value, key, counts);
  }
}

export function analyzeSuggested(model) {
  const counts = {};
  try {
    const url = new URL(model.originalUrl);
    for (const [key, value] of url.searchParams.entries()) categoriesInScalar(value, key, counts);
  } catch {
    // Ignore malformed URLs.
  }
  for (const field of ['requestBody', 'responseBody']) {
    const parsed = parseBody(model[field]);
    if (parsed.kind === 'json') analyzeValue(parsed.value, '', counts);
    else categoriesInScalar(parsed.value, '', counts);
  }
  return counts;
}

function redactScalar(value, key, enabled, summary) {
  if (enabled.has('credential_key') && CREDENTIAL_KEY_RE.test(key || '')) {
    increment(summary, 'credential_key');
    return '{{REDACTED_SENSITIVE_FIELD}}';
  }
  if (enabled.has('account_id') && ACCOUNT_ID_KEY_RE.test(key || '')) {
    increment(summary, 'account_id');
    return '{{REDACTED_ACCOUNT_ID}}';
  }
  if (typeof value !== 'string') return value;
  let text = value;
  if (enabled.has('payment_card')) {
    text = text.replace(/\b(?:\d[ -]*?){13,19}\b/g, (candidate) => {
      if (!passesLuhn(candidate)) return candidate;
      increment(summary, 'payment_card');
      return '{{REDACTED_PAYMENT_CARD}}';
    });
  }
  const rules = [
    ['email', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '{{REDACTED_EMAIL}}'],
    ['ip', /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g, '{{REDACTED_IP}}'],
    ['uuid', /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '{{REDACTED_UUID}}'],
    ['phone', /(?<!\w)(?:\+?\d[\d ().-]{7,}\d)(?!\w)/g, '{{REDACTED_PHONE}}'],
  ];
  for (const [category, regex, placeholder] of rules) {
    if (!enabled.has(category)) continue;
    regex.lastIndex = 0;
    const matches = text.match(regex);
    if (matches?.length) increment(summary, category, matches.length);
    regex.lastIndex = 0;
    text = text.replace(regex, placeholder);
  }
  return text;
}

function redactValue(value, key, enabled, summary, depth = 0) {
  if (depth > 50) throw new Error('JSON nesting exceeds 50 levels.');
  if (Array.isArray(value)) return value.map((item) => redactValue(item, '', enabled, summary, depth + 1));
  if (value && typeof value === 'object') {
    const result = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      result[childKey] = redactValue(childValue, childKey, enabled, summary, depth + 1);
    }
    return result;
  }
  return redactScalar(value, key, enabled, summary);
}

export function applySuggestedRedactions(mandatoryModel, enabledCategories = Object.keys(SUGGESTED_CATEGORIES)) {
  const enabled = enabledCategories instanceof Set ? enabledCategories : new Set(enabledCategories);
  const model = clone(mandatoryModel);
  const summary = {};
  try {
    const url = new URL(model.originalUrl);
    for (const [key, value] of [...url.searchParams.entries()]) {
      url.searchParams.set(key, String(redactScalar(value, key, enabled, summary)));
    }
    model.originalUrl = url.toString();
    model.sanitizedUrl = model.originalUrl;
    model.origin = url.origin;
    model.hostname = url.hostname;
    model.path = `${url.pathname}${url.search}`;
    model.queryParameters = [...url.searchParams.entries()].map(([name, value]) => ({ name, value }));
  } catch {
    // Preserve malformed sanitized URL.
  }
  for (const field of ['requestBody', 'responseBody']) {
    const parsed = parseBody(model[field]);
    if (parsed.kind === 'json') parsed.value = redactValue(parsed.value, '', enabled, summary);
    else parsed.value = redactScalar(parsed.value, '', enabled, summary);
    model[field] = serializeBody(parsed);
  }
  return { model, summary };
}

export function combinedRedactionSummary(mandatorySummary, suggestedSummary) {
  return { mandatory: clone(mandatorySummary || {}), suggested: clone(suggestedSummary || {}) };
}
