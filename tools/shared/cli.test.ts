import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isMain, loadSecret, parseDevVar, readJsonOr, repoRoot } from './cli.ts';

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    console.error(`✗ ${name}`);
    throw err;
  }
}

// --- repoRoot ---

// tools/shared/cli.ts sits two directories below the repo root (see the
// REPO_ROOT computation in cli.ts), so repoRoot() should always resolve to a
// directory that contains that same file — an oracle that holds regardless
// of the process's cwd. (An earlier version of this test used
// path.basename(process.cwd()) as the oracle instead, which fails when the
// file is run via `npx tsx` from a subdirectory rather than the repo root.)
test('repoRoot() contains tools/shared/cli.ts', () => {
  const root = repoRoot();
  const selfPath = path.join(root, 'tools/shared/cli.ts');
  assert.ok(fs.existsSync(selfPath), `expected ${selfPath} to exist`);
});

test('repoRoot() contains package.json', () => {
  const root = repoRoot();
  const pkgPath = path.join(root, 'package.json');
  assert.ok(fs.existsSync(pkgPath), `expected ${pkgPath} to exist`);
});

test('repoRoot() is stable across calls', () => {
  assert.equal(repoRoot(), repoRoot());
});

test('repoRoot() is unaffected by the current working directory', () => {
  // Locks in the fix for tools/inbox-status/status.ts's `const ROOT = process.cwd();`,
  // which broke when the script was run from outside the repo root (R8).
  const before = repoRoot();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-cwd-'));
  const originalCwd = process.cwd();
  process.chdir(tmpDir);
  try {
    assert.equal(repoRoot(), before);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// --- isMain ---

test('isMain(import.meta.url) is true for the running test file\'s own URL', () => {
  assert.equal(isMain(import.meta.url), true);
});

test('isMain(import.meta.url) is false for another module\'s URL', () => {
  assert.equal(isMain(new URL('./d1.ts', import.meta.url).href), false);
});

test('isMain(import.meta.url) is true when process.argv[1] is a symlink to this file (e.g. macOS /tmp -> /private/tmp)', () => {
  // Node/tsx resolve import.meta.url to this file's real, symlink-free path,
  // but process.argv[1] is left exactly as invoked — so a script run through
  // a symlinked path used to compare a symlink path against a realpath and
  // always report false. Regression test for that bug.
  const realFile = fileURLToPath(import.meta.url);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-ismain-symlink-'));
  const link = path.join(dir, 'cli.test.ts');
  const originalArgv1 = process.argv[1];
  try {
    fs.symlinkSync(realFile, link);
    process.argv[1] = link;
    assert.equal(isMain(import.meta.url), true);
  } finally {
    process.argv[1] = originalArgv1;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- readJsonOr ---

test('readJsonOr parses and returns the file\'s JSON when it exists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-readjsonor-'));
  const file = path.join(dir, 'data.json');
  fs.writeFileSync(file, JSON.stringify({ a: 1 }), 'utf-8');
  try {
    assert.deepEqual(readJsonOr(file, {}), { a: 1 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readJsonOr returns the fallback when the file does not exist (ENOENT)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-readjsonor-'));
  const missing = path.join(dir, 'missing.json');
  try {
    assert.deepEqual(readJsonOr(missing, [] as string[]), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readJsonOr rethrows on a non-ENOENT fs error (EISDIR)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-readjsonor-'));
  try {
    assert.throws(() => readJsonOr(dir, []), (err: NodeJS.ErrnoException) => err.code === 'EISDIR');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readJsonOr rethrows on corrupt JSON', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-readjsonor-'));
  const file = path.join(dir, 'corrupt.json');
  fs.writeFileSync(file, '{not valid json', 'utf-8');
  try {
    assert.throws(() => readJsonOr(file, {}), SyntaxError);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- parseDevVar ---
//
// The one .dev.vars line parser shared by loadSecret; ports the test cases
// previously split between tools/shared/announce.ts's parseDevVar and
// tools/fetch-channel-info/fetch.ts's parseDevVarYoutubeKey (both deleted).

test('parseDevVar extracts the value for the given key', () => {
  assert.equal(parseDevVar('YOUTUBE_API_KEY=abc123\n', 'YOUTUBE_API_KEY'), 'abc123');
});

test('parseDevVar returns null when the key is absent', () => {
  assert.equal(parseDevVar('OTHER=1\n', 'YOUTUBE_API_KEY'), null);
});

test('parseDevVar ignores commented lines', () => {
  assert.equal(parseDevVar('# YOUTUBE_API_KEY=commented\nYOUTUBE_API_KEY=real\n', 'YOUTUBE_API_KEY'), 'real');
});

test('parseDevVar trims whitespace around key and value', () => {
  assert.equal(parseDevVar('YOUTUBE_API_KEY =  spaced  \n', 'YOUTUBE_API_KEY'), 'spaced');
});

test('parseDevVar strips surrounding quotes', () => {
  assert.equal(parseDevVar('DISCORD_WEBHOOK_ANNOUNCE="https://x/y"\n', 'DISCORD_WEBHOOK_ANNOUNCE'), 'https://x/y');
});

test('parseDevVar treats an empty value as null', () => {
  assert.equal(parseDevVar('YOUTUBE_API_KEY=\n', 'YOUTUBE_API_KEY'), null);
});

test('parseDevVar keeps a lone one-character quote value literal instead of collapsing it to null', () => {
  // A 1-char value trivially satisfies both startsWith AND endsWith the same quote
  // character; without the `value.length >= 2` guard this would wrongly slice(1, -1)
  // to '' and read as null. Only fetch.ts's parseDevVarYoutubeKey guarded this before.
  assert.equal(parseDevVar('YOUTUBE_API_KEY="\n', 'YOUTUBE_API_KEY'), '"');
});

// --- loadSecret ---

function withEnv(key: string, value: string | undefined, fn: () => void): void {
  const original = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    fn();
  } finally {
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
}

/** Run `fn` with a devVarsPath inside a fresh temp dir — content written first unless
 *  omitted (⇒ the file doesn't exist). Never touches the real admin/.dev.vars. */
function withTempDevVars(content: string | undefined, fn: (devVarsPath: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-loadsecret-'));
  const devVarsPath = path.join(dir, '.dev.vars');
  try {
    if (content !== undefined) fs.writeFileSync(devVarsPath, content, 'utf-8');
    fn(devVarsPath);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const ENV_KEY = 'PRISM_CLI_TEST_SECRET';

test('loadSecret prefers process.env over the file when both are set', () => {
  withTempDevVars(`${ENV_KEY}=from-file\n`, (devVarsPath) => {
    withEnv(ENV_KEY, 'from-env', () => {
      assert.equal(loadSecret(ENV_KEY, { devVarsPath }), 'from-env');
    });
  });
});

test('loadSecret trims process.env and treats a whitespace-only value as unset, falling back to the file', () => {
  withTempDevVars(`${ENV_KEY}=from-file\n`, (devVarsPath) => {
    withEnv(ENV_KEY, '   ', () => {
      assert.equal(loadSecret(ENV_KEY, { devVarsPath }), 'from-file');
    });
  });
});

test('loadSecret falls back to the .dev.vars file when the env var is unset', () => {
  withTempDevVars(`${ENV_KEY}=from-file\n`, (devVarsPath) => {
    withEnv(ENV_KEY, undefined, () => {
      assert.equal(loadSecret(ENV_KEY, { devVarsPath }), 'from-file');
    });
  });
});

test('loadSecret strips quotes from the file value, including the 1-char quote edge', () => {
  withTempDevVars(`${ENV_KEY}="quoted-value"\n`, (devVarsPath) => {
    withEnv(ENV_KEY, undefined, () => {
      assert.equal(loadSecret(ENV_KEY, { devVarsPath }), 'quoted-value');
    });
  });
  withTempDevVars(`${ENV_KEY}="\n`, (devVarsPath) => {
    withEnv(ENV_KEY, undefined, () => {
      assert.equal(loadSecret(ENV_KEY, { devVarsPath }), '"');
    });
  });
});

test('loadSecret returns undefined when neither the env var nor the file has the key', () => {
  withTempDevVars('OTHER=1\n', (devVarsPath) => {
    withEnv(ENV_KEY, undefined, () => {
      assert.equal(loadSecret(ENV_KEY, { devVarsPath }), undefined);
    });
  });
});

test('loadSecret returns undefined when the .dev.vars file does not exist', () => {
  withTempDevVars(undefined, (devVarsPath) => {
    withEnv(ENV_KEY, undefined, () => {
      assert.equal(loadSecret(ENV_KEY, { devVarsPath }), undefined);
    });
  });
});

test('loadSecret returns undefined (never throws) when devVarsPath is a directory, not a file (EISDIR)', () => {
  // A deterministic non-ENOENT read failure: existsSync is true (it's a real directory), so the
  // fast-path check passes, but fs.readFileSync itself throws EISDIR — R9 requires this caught too.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-loadsecret-eisdir-'));
  const devVarsPath = path.join(dir, '.dev.vars');
  fs.mkdirSync(devVarsPath);
  try {
    withEnv(ENV_KEY, undefined, () => {
      assert.equal(loadSecret(ENV_KEY, { devVarsPath }), undefined);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log('cli.test: all passed');
