import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), 'utf8');

/**
 * Guard: every `var(--name)` referenced anywhere under app/** or in
 * tailwind.config.ts must resolve to a CSS custom property that is actually
 * defined somewhere. A name counts as defined if:
 *
 *   1. app/globals.css declares it — `--name: value;`, in the light (:root)
 *      or dark (html.dark) block.
 *   2. StreamerShell.tsx injects it onto document.body at runtime from the
 *      per-streamer registry theme — light via its own themeToCSS(), dark
 *      via lib/theme-utils.ts's deriveDarkTheme(). Both are parsed straight
 *      out of source (their `'--name': value` object-literal keys) so this
 *      list can never drift out of sync with what the app actually injects.
 *   3. next/font hands the browser a custom property via its `variable`
 *      option (app/layout.tsx: `variable: "--font-dm-sans"`) — also parsed
 *      from source.
 *
 * A referenced name matching none of the three is a real defect: it was
 * either mistyped, or the definition it depended on was removed/renamed.
 * This is what pins F1 forever — `var(--border-accent)` in app/page.tsx and
 * app/components/HomeSidebar.tsx matched none of the three, so those eight
 * borders never rendered. F1's fix moved that reference into
 * tailwind.config.ts's `border-border-token` utility (`var(--border-default)`),
 * which is why that file is scanned too — a guard that stopped at app/**
 * would have gone blind to the exact class of bug it was written to pin.
 */

function namesFrom(relativePath: string, pattern: RegExp): Set<string> {
  const names = new Set<string>();
  for (const match of read(relativePath).matchAll(pattern)) {
    names.add(match[1]);
  }
  return names;
}

const CSS_VAR_DECLARATION = /(--[a-zA-Z0-9-]+)\s*:/g;
const OBJECT_KEY_VAR = /["'](--[a-zA-Z0-9-]+)["']\s*:/g;
const NEXT_FONT_VARIABLE = /variable:\s*["'](--[a-zA-Z0-9-]+)["']/g;

const definedNames = new Set<string>([
  ...namesFrom('app/globals.css', CSS_VAR_DECLARATION),
  ...namesFrom('app/[streamer]/StreamerShell.tsx', OBJECT_KEY_VAR),
  ...namesFrom('lib/theme-utils.ts', OBJECT_KEY_VAR),
  ...namesFrom('app/layout.tsx', NEXT_FONT_VARIABLE),
]);

assert.ok(definedNames.size > 10, `expected many defined CSS var names, found ${definedNames.size}`);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (/\.(tsx|ts|css)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const appDir = resolve(repoRoot, 'app');
const appFiles = walk(appDir);
assert.ok(appFiles.length > 50, `expected many files under app/, found ${appFiles.length}`);

// tailwind.config.ts is scanned alongside app/**: it is where a Tailwind
// utility (e.g. border-border-token) resolves to a var(--name) reference of
// its own, outside app/** entirely — see the guard comment above.
const scannedFiles = [...appFiles, resolve(repoRoot, 'tailwind.config.ts')];

const VAR_REFERENCE = /var\((--[a-zA-Z0-9-]+)/g;
const missing: Array<{ file: string; name: string }> = [];

for (const file of scannedFiles) {
  const src = readFileSync(file, 'utf8');
  for (const match of src.matchAll(VAR_REFERENCE)) {
    const name = match[1];
    if (!definedNames.has(name)) {
      missing.push({ file: relative(repoRoot, file), name });
    }
  }
}

assert.deepEqual(
  missing,
  [],
  `var(--name) reference(s) under app/** and tailwind.config.ts with no matching definition:\n${missing
    .map((m) => `  ${m.name}  (${m.file})`)
    .join('\n')}`,
);

console.log(
  `css-vars guard: ${scannedFiles.length} files scanned under app/ + tailwind.config.ts, ${definedNames.size} defined var names, 0 unresolved references`,
);
