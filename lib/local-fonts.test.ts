import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(root, path));

// Keep the production layout independent of the Google Fonts response format.
test('DM Sans is local, retains its CSS variable, and covers all existing weights', () => {
  const layout = read('app/layout.tsx').toString('utf8');
  assert.match(layout, /import localFont from ["']next\/font\/local["']/);
  assert.doesNotMatch(layout, /next\/font\/google/);
  assert.match(layout, /variable:\s*["']--font-dm-sans["']/);
  assert.match(layout, /display:\s*["']swap["']/);
  for (const [name, weight] of [
    ['Regular', '400'], ['Medium', '500'], ['SemiBold', '600'],
    ['Bold', '700'], ['Black', '900'],
  ]) {
    assert.match(layout, new RegExp(`path: ["']\\./fonts/dm-sans/DMSans-${name}\\.woff2["'], weight: ["']${weight}["'], style: ["']normal["']`));
  }
});

test('vendored WOFF2 files and deployed OFL retain their recorded upstream bytes', () => {
  const manifest = JSON.parse(read('app/fonts/dm-sans/provenance.json').toString('utf8')) as {
    upstreamCommit: string;
    files: Array<{ path: string; source: string; sha256: string }>;
  };
  assert.match(manifest.upstreamCommit, /^[a-f0-9]{40}$/);
  assert.equal(manifest.files.filter((file) => file.path.endsWith('.woff2')).length, 5);
  assert.equal(new Set(manifest.files.map((file) => file.path)).size, manifest.files.length);
  for (const file of manifest.files) {
    assert.ok(file.source.startsWith(`https://raw.githubusercontent.com/googlefonts/dm-fonts/${manifest.upstreamCommit}/Sans/`));
    const bytes = read(file.path);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, file.path);
    if (file.path.endsWith('.woff2')) assert.equal(bytes.subarray(0, 4).toString(), 'wOF2');
  }
  const licensePath = 'public/licenses/dm-sans/OFL.txt';
  assert.ok(manifest.files.some((file) => file.path === licensePath));
  const license = read(licensePath).toString('utf8');
  assert.match(license, /Copyright 2014 The DM Sans Project Authors/);
  assert.match(license, /SIL OPEN FONT LICENSE Version 1\.1/);
  assert.match(read('public/licenses/dm-sans/README.txt').toString('utf8'), /OFL\.txt/);
});
