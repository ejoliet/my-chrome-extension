import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const nacl = require('../lib/tweetnacl/nacl-fast.js');
const out = process.argv[2] || '../private/promptclip-ed25519-keypair.json';
const outPath = resolve(new URL('.', import.meta.url).pathname, out);

if (existsSync(outPath)) {
  throw new Error(`Refusing to overwrite existing key: ${outPath}`);
}

const pair = nacl.sign.keyPair();
const payload = {
  alg: 'Ed25519',
  publicKey: Buffer.from(pair.publicKey).toString('base64'),
  secretKey: Buffer.from(pair.secretKey).toString('base64'),
  createdAt: new Date().toISOString()
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(payload, null, 2));
console.log(`Wrote keypair outside extension tree: ${outPath}`);
console.log(`Public key for popup.js LICENSE_PUBLIC_KEY_B64:\n${payload.publicKey}`);
