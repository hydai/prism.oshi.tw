import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DARK_MODE_DETECT_SCRIPT } from './theme-detect-script';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), 'utf8');

// The detector runs inline in <head>, before hydration, so it must stay a bare
// IIFE that never throws: no <script> wrapper, no bundler-only syntax.
assert.ok(DARK_MODE_DETECT_SCRIPT.startsWith('(function(){try{'), 'the detector is a self-invoking function');
assert.ok(DARK_MODE_DETECT_SCRIPT.endsWith('})()'), 'the detector invokes itself');
assert.ok(!DARK_MODE_DETECT_SCRIPT.includes('<script'), 'the detector is script body only; callers wrap it');
assert.ok(DARK_MODE_DETECT_SCRIPT.includes("localStorage.getItem('theme')"), 'it reads the stored choice');
assert.ok(DARK_MODE_DETECT_SCRIPT.includes("matchMedia('(prefers-color-scheme:dark)')"), 'it falls back to the OS');
assert.ok(DARK_MODE_DETECT_SCRIPT.includes("classList.add('dark')"), 'it sets html.dark before first paint');
assert.ok(DARK_MODE_DETECT_SCRIPT.includes('catch(e){}'), 'a blocked localStorage never breaks the page');

/**
 * tools/aurora/index.html is hand-written static HTML with no build-time
 * templating, so it is the one file that still inlines the detector's text.
 * Keep it byte-identical to the constant every other page imports.
 */
const auroraLiteral = /<script>(\(function\(\)\{try\{var t=localStorage[^<]*)<\/script>/.exec(
  read('tools/aurora/index.html'),
)?.[1];
assert.equal(auroraLiteral, DARK_MODE_DETECT_SCRIPT, 'tools/aurora/index.html inlines the shared detect script');

/**
 * Everywhere else imports the constant. A re-inlined copy would drift silently,
 * so fail if the detector's text reappears in a module that can import it.
 */
const inlinedCopy = "localStorage.getItem('theme');var d=window.matchMedia";
for (const consumer of ['app/layout.tsx', 'tools/nova/src/theme.ts', 'tools/crystal/src/theme.ts']) {
  assert.ok(!read(consumer).includes(inlinedCopy), `${consumer} imports the detect script instead of inlining it`);
}
assert.ok(
  read('app/layout.tsx').includes('DARK_MODE_DETECT_SCRIPT'),
  'app/layout.tsx still injects the detect script it imports',
);

console.log('theme-detect-script.test: all passed');
