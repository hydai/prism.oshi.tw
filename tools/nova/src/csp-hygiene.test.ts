// Static guard for the Content-Security-Policy the two workers send. The policy
// allows inline script/style only by nonce, and nothing allows an inline event
// handler: `script-src` (with no `script-src-attr` beside it) governs attributes
// too, so a single `onerror="…"` is a control that silently stops working in the
// browser. No render test catches one that is added tomorrow — they assert on the
// markup a page produces today — so the rule is enforced against the source.
//
// Scanned: every non-test `.ts` under tools/nova/src, tools/crystal/src and
// tools/shared/web (Crystal's pages are covered here rather than duplicating the
// walker in its own suite). Forbidden anywhere:
//   * an inline event-handler attribute (` onclick="`, ` onerror="`, …)
//   * a `<script>`/`<style>` opening tag outside the two shared modules that own
//     inline tags and stamp the nonce on them (page-shell.ts, theme.ts)
//   * `eval(` / `new Function(`, which no nonce can ever allow
//
// Comment lines are skipped: prose *about* an inline handler or a `<script>` tag
// reaches no browser, and both workers' middleware comments discuss exactly that.
// The trade-off is a forbidden pattern on a line that opens with `//`, `*` or
// `/*` inside a template literal — no such line exists, and one would be a very
// strange way to emit markup. Run with: npm run test:csp-hygiene
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const toolsRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Directories whose sources must satisfy the policy, relative to tools/. */
const SCANNED_DIRS = ['nova/src', 'crystal/src', 'shared/web'];

/** The only two modules allowed to emit an inline tag; both stamp the nonce on it. */
const INLINE_TAG_OWNERS = new Set(['shared/web/page-shell.ts', 'shared/web/theme.ts']);

const INLINE_HANDLER = / on[a-z]+="/;
const INLINE_TAG = /<\s*(script|style)\b/i;
const DYNAMIC_EVAL = /\beval\s*\(|\bnew\s+Function\s*\(/;

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function tsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') tsFiles(full, out);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** True for a line that opens a comment or continues a block/JSDoc one. */
function isCommentLine(line: string): boolean {
  const trimmed = line.trimStart();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

let scanned = 0;
for (const dir of SCANNED_DIRS) {
  const files = tsFiles(resolve(toolsRoot, dir));
  assert(files.length > 0, `${dir} has no scannable .ts files — the guard is looking in the wrong place`);
  scanned += files.length;

  for (const file of files) {
    const rel = relative(toolsRoot, file).split('\\').join('/');
    const lines = readFileSync(file, 'utf8').split('\n');

    lines.forEach((line, index) => {
      if (isCommentLine(line)) return;
      const where = `${rel}:${index + 1}`;

      assert(
        !INLINE_HANDLER.test(line),
        `${where}: inline event-handler attribute — the CSP blocks it; use addEventListener in the page script\n    ${line.trim()}`,
      );
      assert(
        INLINE_TAG_OWNERS.has(rel) || !INLINE_TAG.test(line),
        `${where}: inline <script>/<style> tag outside the shared page shell — only page-shell.ts and theme.ts emit them, because only they stamp the nonce\n    ${line.trim()}`,
      );
      assert(
        !DYNAMIC_EVAL.test(line),
        `${where}: eval()/new Function() cannot be allowed by any nonce\n    ${line.trim()}`,
      );
    });
  }
}

assert(scanned > 20, `expected the whole page surface to be scanned, found ${scanned} files`);

console.log(`✓ CSP hygiene: ${scanned} worker sources carry no inline handlers, no un-nonced inline tags, no eval`);
