import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const nacl = require('../lib/tweetnacl/nacl-fast.js');

const [,, keyPath, email, expires = 'lifetime'] = process.argv;
if (!keyPath || !email) {
  console.error('Usage: node scripts/sign-license.mjs ../private/promptclip-ed25519-keypair.json user@example.com [lifetime|YYYY-MM-DD]');
  process.exit(1);
}

const key = JSON.parse(readFileSync(keyPath, 'utf8'));
const license = { email, product: 'PromptClip', expires };
const message = JSON.stringify(license);
const signature = nacl.sign.detached(new TextEncoder().encode(message), Buffer.from(key.secretKey, 'base64'));
console.log(JSON.stringify({ ...license, signature: Buffer.from(signature).toString('base64') }, null, 2));
