import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { repoRoot } from './cli.ts';

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    console.error(`✗ ${name}`);
    throw err;
  }
}

// "npm run test:cli" is a root package.json script, so npm always runs it with
// cwd = the repo root — the same invariant tools/inbox-status/status.ts relies
// on (`const ROOT = process.cwd();`). That makes process.cwd() an independent
// oracle for "the repo directory name" here, without hard-coding a literal
// checkout name that would break in a differently-named clone or worktree
// (this file itself runs from a worktree named "phase0-tools", not the
// project's usual "prism.oshi.tw" clone directory).
test('repoRoot() ends with this checkout\'s directory name', () => {
  const root = repoRoot();
  const expectedName = path.basename(process.cwd());
  assert.ok(
    root.endsWith(expectedName),
    `expected repoRoot() (${root}) to end with ${JSON.stringify(expectedName)}`,
  );
});

test('repoRoot() contains package.json', () => {
  const root = repoRoot();
  const pkgPath = path.join(root, 'package.json');
  assert.ok(fs.existsSync(pkgPath), `expected ${pkgPath} to exist`);
});

test('repoRoot() is stable across calls', () => {
  assert.equal(repoRoot(), repoRoot());
});

console.log('cli.test: all passed');
