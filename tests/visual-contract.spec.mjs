import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = process.cwd();
const ledger = JSON.parse(await readFile(path.join(root, 'docs/image-licenses.json'), 'utf8'));
assert(Array.isArray(ledger.images) && ledger.images.length >= 6, 'Use multiple independently licensed real photographs');
const ids = new Set();
for (const image of ledger.images) {
  assert(image.id && !ids.has(image.id), 'Unique photo ID'); ids.add(image.id);
  for (const key of ['source_url', 'license_url', 'author', 'license', 'attribution', 'caption']) assert(typeof image[key] === 'string' && image[key].length > 0, `Missing ${key} for ${image.id}`);
  assert.equal(image.commercial_allowed, true, image.id);
  assert.equal(image.modification_allowed, true, image.id);
  assert(image.local_path.startsWith('static/images/photos/') && !image.local_path.includes('..'));
  const bytes = await readFile(path.join(root, image.local_path));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), image.sha256, `Photo fingerprint: ${image.id}`);
  assert.equal(bytes.length, image.bytes);
  assert(image.width >= 720 && image.height >= 400, `Insufficient native export size: ${image.id}`);
  assert((await stat(path.join(root, image.local_path))).size < 350000, `Optimize photo: ${image.id}`);
}
console.log(JSON.stringify({ status: 'PASS', licensedPhotos: ids.size }));
