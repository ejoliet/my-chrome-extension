'use strict';

const SENSITIVE_HEADER_NAMES = new Set([
  'authorization', 'proxy-authorization', 'cookie', 'set-cookie', 'x-api-key', 'x-auth-token',
  'x-csrf-token', 'x-xsrf-token', 'csrf-token', 'x-session-token',
]);
const OMIT_HEADER_NAMES = new Set(['content-length', 'host', 'connection', 'accept-encoding', 'origin', 'referer']);
const RESERVED_WORDS = new Set(['break','case','catch','class','const','continue','debugger','default','delete','do','else','enum','export','extends','false','finally','for','function','if','implements','import','in','instanceof','interface','let','new','null','package','private','protected','public','return','static','super','switch','this','throw','true','try','typeof','var','void','while','with','yield']);

function stableValue(value, depth = 0) {
  if (depth > 50) throw new Error('JSON nesting exceeds 50 levels.');
  if (Array.isArray(value)) return value.map((item) => stableValue(item, depth + 1));
  if (value && typeof value === 'object') {
    const output = {};
    for (const key of Object.keys(value).sort()) output[key] = stableValue(value[key], depth + 1);
    return output;
  }
  return value;
}

export function stableStringify(value, spacing = 2) {
  return JSON.stringify(stableValue(value), null, spacing);
}

export function parseBody(text, mimeType = '') {
  const value = String(text ?? '');
  if (!value.trim()) return { kind: 'empty', value: '', extension: 'txt' };
  if (/json/i.test(mimeType) || /^[\s]*[\[{]/.test(value)) {
    try {
      return { kind: 'json', value: JSON.parse(value), extension: 'json' };
    } catch {
      if (/json/i.test(mimeType)) return { kind: 'invalid-json', value, extension: 'txt' };
    }
  }
  return { kind: 'text', value, extension: 'txt' };
}

function bodyText(bodyInfo) {
  return bodyInfo.kind === 'json' ? stableStringify(bodyInfo.value) : String(bodyInfo.value || '');
}

function safeHeaders(headers) {
  const result = {};
  for (const header of headers || []) {
    const name = String(header.name || '');
    const lower = name.toLowerCase();
    if (SENSITIVE_HEADER_NAMES.has(lower) || OMIT_HEADER_NAMES.has(lower)) continue;
    const value = String(header.value ?? '');
    if (/\{\{REDACTED_(?:AUTHORIZATION|COOKIE|API_KEY|SECRET|BEARER)/.test(value)) continue;
    result[name] = value;
  }
  return result;
}

function parseUrl(model) {
  try {
    const url = new URL(model.sanitizedUrl || model.originalUrl);
    return { origin: url.origin, path: `${url.pathname}${url.search}` };
  } catch {
    return { origin: model.origin || '', path: model.path || '/' };
  }
}

function shellDoubleQuote(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/`/g, '\\`');
}

function tsLiteral(value) {
  return JSON.stringify(value, null, 2);
}

export function generateCurl(model) {
  const { path } = parseUrl(model);
  const lines = ['curl \\', `  --request ${model.method} \\`, `  --url "\${BASE_URL}${shellDoubleQuote(path)}"`];
  const headers = safeHeaders(model.requestHeaders);
  for (const [name, value] of Object.entries(headers).sort(([a], [b]) => a.localeCompare(b))) {
    lines[lines.length - 1] += ' \\';
    lines.push(`  --header "${shellDoubleQuote(name)}: ${shellDoubleQuote(value)}"`);
  }
  const requestBody = parseBody(model.requestBody, model.requestMimeType);
  if (requestBody.kind !== 'empty' && !/multipart/i.test(model.requestMimeType || '')) {
    lines[lines.length - 1] += ' \\';
    lines.push(`  --data-binary @fixtures/request.${requestBody.extension}`);
  }
  return `${lines.join('\n')}\n`;
}

export function generateFetch(model) {
  const { path } = parseUrl(model);
  const headers = safeHeaders(model.requestHeaders);
  const requestBody = parseBody(model.requestBody, model.requestMimeType);
  const responseBody = parseBody(model.responseBody, model.responseMimeType);
  const options = [`method: ${JSON.stringify(model.method)}`];
  if (Object.keys(headers).length) options.push(`headers: ${tsLiteral(headers)}`);
  if (requestBody.kind === 'json') options.push(`body: JSON.stringify(${tsLiteral(requestBody.value)})`);
  else if (requestBody.kind === 'text' || requestBody.kind === 'invalid-json') options.push(`body: ${JSON.stringify(requestBody.value)}`);
  const parseLine = responseBody.kind === 'json'
    ? 'const body: ResponseBody = await response.json();'
    : 'const body = await response.text();';
  return `export type ResponseBody = ${responseBody.kind === 'json' ? typeExpression(responseBody.value, 0) : 'string'};\n\n` +
`const baseUrl = process.env.BASE_URL ?? ${JSON.stringify(model.origin || parseUrl(model).origin)};\n` +
`const response = await fetch(\`${'${baseUrl}'}${escapeTemplate(path)}\`, {\n  ${options.join(',\n  ')},\n});\n\n` +
`if (!response.ok) {\n  throw new Error(\`Request failed: ${'${response.status}'} ${'${response.statusText}'}\`);\n}\n\n` +
`${parseLine}\nconsole.log(body);\n`;
}

function escapeTemplate(value) {
  return String(value).replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

function markdownFence(value, language = '') {
  const text = String(value || '');
  const fence = text.includes('```') ? '````' : '```';
  return `${fence}${language}\n${text}\n${fence}`;
}

function summaryLines(redactionSummary) {
  const mandatory = Object.entries(redactionSummary?.mandatory || {}).filter(([, count]) => count > 0);
  const suggested = Object.entries(redactionSummary?.suggested || {}).filter(([, count]) => count > 0);
  const lines = [];
  for (const [name, count] of mandatory) lines.push(`- Mandatory: ${name} (${count})`);
  for (const [name, count] of suggested) lines.push(`- Optional: ${name} (${count})`);
  return lines.length ? lines.join('\n') : '- No known sensitive patterns were detected.';
}

export function generateMarkdown(model, redactionSummary = {}) {
  const requestBody = parseBody(model.requestBody, model.requestMimeType);
  const responseBody = parseBody(model.responseBody, model.responseMimeType);
  const { path } = parseUrl(model);
  return `# RequestCapsule reproduction\n\n` +
`Generated: ${new Date().toISOString()}\n\n` +
`## Request\n\n- Method: \`${model.method}\`\n- Base URL: \`BASE_URL\`\n- Path: \`${path}\`\n- Observed response: \`${model.status} ${model.statusText || ''}\`\n\n` +
`### Request body\n\n${requestBody.kind === 'empty' ? '_No request body._' : markdownFence(bodyText(requestBody), requestBody.kind === 'json' ? 'json' : 'text')}\n\n` +
`### Response body\n\n${responseBody.kind === 'empty' ? '_No response body._' : markdownFence(bodyText(responseBody), responseBody.kind === 'json' ? 'json' : 'text')}\n\n` +
`## Redaction summary\n\n${summaryLines(redactionSummary)}\n\n` +
`> RequestCapsule removes common authentication values and flags likely sensitive data. Review this artifact before sharing.\n`;
}

function schemaKey(schema) {
  return stableStringify(schema, 0);
}

function mergeSchemas(schemas) {
  const unique = new Map(schemas.map((schema) => [schemaKey(schema), schema]));
  const values = [...unique.values()];
  return values.length === 1 ? values[0] : { anyOf: values };
}

export function inferSchema(value, depth = 0) {
  if (depth > 50) throw new Error('JSON nesting exceeds 50 levels.');
  if (value === null) return { type: 'null' };
  if (Array.isArray(value)) {
    const sampled = value.slice(0, 25);
    return { type: 'array', items: sampled.length ? mergeSchemas(sampled.map((item) => inferSchema(item, depth + 1))) : {} };
  }
  if (typeof value === 'object') {
    const properties = {};
    const required = [];
    for (const key of Object.keys(value).sort()) {
      properties[key] = inferSchema(value[key], depth + 1);
      required.push(key);
    }
    return { type: 'object', properties, additionalProperties: true, required };
  }
  if (typeof value === 'string') return { type: 'string' };
  if (typeof value === 'boolean') return { type: 'boolean' };
  if (typeof value === 'number') return { type: Number.isInteger(value) ? 'integer' : 'number' };
  return {};
}

export function generateJsonSchema(responseValue) {
  return stableStringify({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $comment: 'Inferred from one observed response. Review before production use.',
    title: 'ResponseBody',
    ...inferSchema(responseValue),
  });
}

function propertyName(key) {
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) && !RESERVED_WORDS.has(key)) return key;
  return JSON.stringify(key);
}

function typeExpression(value, depth = 0) {
  if (depth > 50) return 'unknown';
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    if (!value.length) return 'unknown[]';
    const types = [...new Set(value.slice(0, 25).map((item) => typeExpression(item, depth + 1)))];
    return types.length === 1 ? `Array<${types[0]}>` : `Array<${types.map((type) => `(${type})`).join(' | ')}>`;
  }
  if (typeof value === 'object') {
    const entries = Object.keys(value).sort().map((key) => `${'  '.repeat(depth + 1)}${propertyName(key)}: ${typeExpression(value[key], depth + 1)};`);
    return `{\n${entries.join('\n')}\n${'  '.repeat(depth)}}`;
  }
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'unknown';
}

export function generateTypes(responseValue) {
  return `/** Inferred from one observed response. Review before production use. */\nexport type ResponseBody = ${typeExpression(responseValue, 0)};\n`;
}

function inferredAssertions(responseValue) {
  if (Array.isArray(responseValue)) return ['  expect(Array.isArray(body)).toBe(true);'];
  if (responseValue && typeof responseValue === 'object') {
    const keys = Object.keys(responseValue).sort().slice(0, 4);
    return [`  expect(body).not.toBeNull();`, `  expect(typeof body).toBe('object');`, ...keys.map((key) => `  expect(body).toHaveProperty(${JSON.stringify(key)});`)];
  }
  return [`  expect(typeof body).toBe(${JSON.stringify(typeof responseValue)});`];
}

export function generatePlaywright(model) {
  const { path } = parseUrl(model);
  const requestBody = parseBody(model.requestBody, model.requestMimeType);
  const responseBody = parseBody(model.responseBody, model.responseMimeType);
  const headers = safeHeaders(model.requestHeaders);
  const methodName = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(model.method) ? model.method.toLowerCase() : 'fetch';
  const options = [];
  if (methodName === 'fetch') options.push(`method: ${JSON.stringify(model.method)}`);
  if (Object.keys(headers).length) options.push(`headers: ${tsLiteral(headers)}`);
  if (requestBody.kind === 'json') options.push(`data: ${tsLiteral(requestBody.value)}`);
  else if (requestBody.kind === 'text' || requestBody.kind === 'invalid-json') options.push(`data: ${JSON.stringify(requestBody.value)}`);
  const optionsText = options.length ? `, {\n    ${options.join(',\n    ')},\n  }` : '';
  const responseHandling = responseBody.kind === 'json'
    ? `  const body: ResponseBody = await response.json();\n\n  // Inferred shape assertions; replace with domain-specific assertions.\n${inferredAssertions(responseBody.value).join('\n')}\n`
    : `  const body = await response.text();\n  expect(typeof body).toBe('string');\n`;
  return `import { test, expect } from '@playwright/test';\nimport type { ResponseBody } from '../types/response';\n\n` +
`test(${JSON.stringify(`${model.method} ${path}`)}, async ({ request }) => {\n` +
`  const baseUrl = process.env.BASE_URL;\n  if (!baseUrl) throw new Error('BASE_URL is required');\n\n` +
`  const response = await request.${methodName}(\`${'${baseUrl}'}${escapeTemplate(path)}\`${optionsText});\n` +
`  expect(response.status()).toBe(${model.status});\n` +
(responseBody.kind === 'json' ? responseHandling : responseHandling) +
`});\n`;
}

function handlerName(model) {
  const { path } = parseUrl(model);
  const words = `${model.method.toLowerCase()} ${path}`.replace(/[^A-Za-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const camel = words.map((word, index) => index === 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join('');
  return `${camel || 'request'}Handler`;
}

export function generateMsw(model) {
  const { path } = parseUrl(model);
  const responseBody = parseBody(model.responseBody, model.responseMimeType);
  const method = model.method.toLowerCase();
  const supported = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(method) ? method : 'all';
  const response = responseBody.kind === 'json'
    ? `HttpResponse.json(responseFixture, { status: ${model.status} })`
    : `HttpResponse.text(responseFixture, { status: ${model.status} })`;
  const fixture = responseBody.kind === 'json' ? tsLiteral(responseBody.value) : JSON.stringify(String(responseBody.value || ''));
  return `import { http, HttpResponse } from 'msw';\n\n` +
`const responseFixture = ${fixture};\n\n` +
`export const ${handlerName(model)} = http.${supported}(${JSON.stringify(`*${path}`)}, () => {\n  return ${response};\n});\n`;
}

export function generateEnv(model) {
  return `# RequestCapsule generated placeholders only.\nBASE_URL=${model.origin || parseUrl(model).origin || 'https://api.example.invalid'}\n`;
}

function fileTree(requestExt, responseExt) {
  return `requestcapsule/\n├── README.md\n├── request.curl.sh\n├── request.fetch.ts\n├── .env.example\n├── manifest.json\n├── fixtures/\n│   ├── request.${requestExt}\n│   └── response.${responseExt}\n├── schema/\n│   └── response.schema.json\n├── types/\n│   └── response.ts\n├── playwright/\n│   └── request.spec.ts\n└── mocks/\n    └── msw-handler.ts`;
}

export function generateReadme(model, redactionSummary, requestExt, responseExt) {
  const { path } = parseUrl(model);
  return `# RequestCapsule test pack\n\n` +
`Captured endpoint: \`${model.method} ${path}\`\n\nObserved status: \`${model.status}\`\n\n` +
`## Files\n\n\`\`\`text\n${fileTree(requestExt, responseExt)}\n\`\`\`\n\n` +
`## Run the Playwright test\n\n\`\`\`bash\nnpm install --save-dev @playwright/test\nBASE_URL=https://your-api.example npx playwright test playwright/request.spec.ts\n\`\`\`\n\n` +
`## Use the MSW handler\n\nImport \`mocks/msw-handler.ts\` into your MSW handler list. The file uses the MSW v2 \`http\` and \`HttpResponse\` APIs.\n\n` +
`## Redactions\n\n${summaryLines(redactionSummary)}\n\n` +
`## Limitations\n\n- Schema and type definitions are inferred from one response.\n- Generated assertions verify observed shape, not business meaning.\n- Review all generated content before committing or sharing.\n\n` +
`---\nGenerated locally with RequestCapsule.\n`;
}

export function generateFreeFiles(model, redactionSummary = {}) {
  const requestBody = parseBody(model.requestBody, model.requestMimeType);
  const responseBody = parseBody(model.responseBody, model.responseMimeType);
  return {
    'request.curl.sh': generateCurl(model),
    'request.fetch.ts': generateFetch(model),
    [`fixtures/request.${requestBody.extension}`]: bodyText(requestBody),
    [`fixtures/response.${responseBody.extension}`]: bodyText(responseBody),
    'reproduction.md': generateMarkdown(model, redactionSummary),
  };
}

export function generateProFiles(model, redactionSummary = {}) {
  const requestBody = parseBody(model.requestBody, model.requestMimeType);
  const responseBody = parseBody(model.responseBody, model.responseMimeType);
  const responseValue = responseBody.kind === 'json' ? responseBody.value : String(responseBody.value || '');
  const files = {
    'README.md': generateReadme(model, redactionSummary, requestBody.extension, responseBody.extension),
    'request.curl.sh': generateCurl(model),
    'request.fetch.ts': generateFetch(model),
    '.env.example': generateEnv(model),
    [`fixtures/request.${requestBody.extension}`]: bodyText(requestBody),
    [`fixtures/response.${responseBody.extension}`]: bodyText(responseBody),
    'schema/response.schema.json': responseBody.kind === 'json' ? generateJsonSchema(responseValue) : stableStringify({ $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'string' }),
    'types/response.ts': responseBody.kind === 'json' ? generateTypes(responseValue) : 'export type ResponseBody = string;\n',
    'playwright/request.spec.ts': generatePlaywright(model),
    'mocks/msw-handler.ts': generateMsw(model),
  };
  if (requestBody.kind === 'empty') delete files[`fixtures/request.${requestBody.extension}`];
  return files;
}
