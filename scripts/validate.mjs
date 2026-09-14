import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const root = path.resolve('extension');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.name, 'THRASH-PASS');
assert.equal(manifest.version, JSON.parse(fs.readFileSync('package.json')).version);
const refs = [manifest.background.service_worker, manifest.action.default_popup,
  ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon),
  ...manifest.content_scripts.flatMap(s => s.js)];
for (const ref of refs) assert.ok(fs.existsSync(path.join(root, ref)), `Missing ${ref}`);
for (const file of fs.readdirSync(root).filter(f => f.endsWith('.js'))) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], {encoding:'utf8'});
  assert.equal(result.status, 0, result.stderr);
}
const originalIcons = JSON.parse(fs.readFileSync('scripts/original-icon-hashes.json'));
for (const [ref, hash] of Object.entries(originalIcons)) {
  const data = fs.readFileSync(path.join(root, ref));
  assert.equal(createHash('sha256').update(data).digest('hex'), hash, `${ref} must match the original artwork exactly`);
}
const html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
for (const match of html.matchAll(/(?:src|href)="([^"#:]+)"/g)) {
  if (!/^https?:/.test(match[1])) assert.ok(fs.existsSync(path.join(root, match[1])), `Missing ${match[1]}`);
}
for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
  assert.equal(match[1].trim(), '', 'Inline executable script');
}
console.log('Package valid: manifest references, JS syntax, popup assets, version, and original icon integrity.');
