import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  APPROVED_WITH_CHANNEL_SQL,
  buildUpdateSql,
  executeD1FileArgs,
  formatSummary,
  toSqlStringLiteral,
  writeSqlToPrivateTempFile,
} from './fetch';

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    console.error(`✗ ${name}`);
    throw err;
  }
}

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

/** Stub console.error for the duration of `fn` — executeD1FileArgs's underlying
 *  d1ModeFlag() prints a stderr notice when PRISM_D1_LOCAL=1 decides the mode. */
function withStubbedConsoleError(fn: () => void): void {
  const original = console.error;
  console.error = () => {};
  try {
    fn();
  } finally {
    console.error = original;
  }
}

// --- toSqlStringLiteral ---

test('toSqlStringLiteral wraps a plain value in single quotes', () => {
  assert.equal(toSqlStringLiteral('abc'), "'abc'");
});

test('toSqlStringLiteral doubles embedded single quotes', () => {
  assert.equal(toSqlStringLiteral("O'Brien"), "'O''Brien'");
});

test('toSqlStringLiteral handles an empty string', () => {
  assert.equal(toSqlStringLiteral(''), "''");
});

// --- buildUpdateSql ---

test('buildUpdateSql returns an empty string when there are no updates', () => {
  assert.equal(buildUpdateSql([]), '');
});

test('buildUpdateSql builds one UPDATE statement per row', () => {
  const sql = buildUpdateSql([{ id: 's1', subscriberCount: '12.3萬', avatarUrl: 'https://img/a.jpg' }]);
  assert.equal(
    sql,
    "UPDATE submissions SET subscriber_count='12.3萬', avatar_url='https://img/a.jpg' WHERE id='s1';",
  );
});

test('buildUpdateSql escapes quotes and joins rows with newlines', () => {
  const sql = buildUpdateSql([
    { id: 's1', subscriberCount: '5萬', avatarUrl: "a'b" },
    { id: 's2', subscriberCount: '1,234', avatarUrl: 'c' },
  ]);
  assert.equal(
    sql,
    "UPDATE submissions SET subscriber_count='5萬', avatar_url='a''b' WHERE id='s1';\n" +
      "UPDATE submissions SET subscriber_count='1,234', avatar_url='c' WHERE id='s2';",
  );
});

// --- formatSummary ---

test('formatSummary lists successes and failures with a header', () => {
  const out = formatSummary({
    updated: 2,
    failed: 1,
    results: [
      { id: 's1', display_name: 'Mizuki', subscriber_count: '12.3萬', avatar_url: 'https://img/a.jpg' },
      { id: 's2', display_name: 'Nagi', subscriber_count: '5萬', avatar_url: 'https://img/b.jpg' },
      { id: 's3', display_name: 'Hidden One', subscriber_count: null, avatar_url: null, error: 'Hidden or not found' },
    ],
  });
  assert.match(out, /Updated 2, Failed 1/);
  assert.ok(out.includes('✓ Mizuki — 12.3萬'), 'should list Mizuki as updated');
  assert.ok(out.includes('✓ Nagi — 5萬'), 'should list Nagi as updated');
  assert.ok(out.includes('✗ Hidden One — Hidden or not found'), 'should list the failure with its reason');
});

// --- APPROVED_WITH_CHANNEL_SQL ---

test('approved-with-channel query selects approved rows that have a channel id', () => {
  assert.match(APPROVED_WITH_CHANNEL_SQL, /FROM submissions/i);
  assert.match(APPROVED_WITH_CHANNEL_SQL, /status\s*=\s*'approved'/i);
  assert.match(APPROVED_WITH_CHANNEL_SQL, /youtube_channel_id\s*!=\s*''/i);
  assert.doesNotMatch(APPROVED_WITH_CHANNEL_SQL, /\bLIMIT\b/i);
});

// --- executeD1FileArgs (the write path must follow the shared D1 mode) ---
//
// This is the argument vector for the privileged write to Nova D1 (see
// writeSqlToPrivateTempFile below). It must track PRISM_D1_LOCAL=1 the same
// way queryD1 does — otherwise a local-mode run reads streamer/channel ids
// from a local database and then writes to production D1 with them.

test('executeD1FileArgs targets --remote by default (PRISM_D1_LOCAL unset)', () => {
  withEnv('PRISM_D1_LOCAL', undefined, () => {
    const args = executeD1FileArgs('/tmp/x.sql');
    assert.ok(args.includes('--remote'), 'should include --remote');
    assert.ok(!args.includes('--local'), 'should not include --local');
    assert.ok(args.includes('--file=/tmp/x.sql'), 'should include the file flag');
    assert.ok(args.includes('oshi-prism-nova'), 'should target the Nova D1 database');
  });
});

test('executeD1FileArgs targets --local when PRISM_D1_LOCAL=1', () => {
  withEnv('PRISM_D1_LOCAL', '1', () => {
    withStubbedConsoleError(() => {
      const args = executeD1FileArgs('/tmp/x.sql');
      assert.ok(args.includes('--local'), 'should include --local');
      assert.ok(!args.includes('--remote'), 'should not include --remote');
    });
  });
});

// --- writeSqlToPrivateTempFile (temp-file race hardening) ---
//
// The SQL written here is executed against the production Nova D1 via
// `wrangler d1 execute --file=<path>`. Writing it to a predictable name under the
// shared os.tmpdir() let a local attacker pre-plant a symlink or race-replace the
// file before wrangler read it (TOCTOU). These tests pin the hardened contract:
// the file must live inside a freshly created, owner-only private directory.

test('writeSqlToPrivateTempFile stores the SQL inside a dedicated subdirectory of os.tmpdir()', () => {
  const { dir, file } = writeSqlToPrivateTempFile('SELECT 1;');
  try {
    assert.equal(path.dirname(file), dir, 'SQL file must live inside its private directory');
    assert.equal(path.dirname(dir), os.tmpdir(), 'private directory must be a child of os.tmpdir()');
    assert.notEqual(path.resolve(dir), path.resolve(os.tmpdir()), 'must not write directly into the shared temp dir');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('writeSqlToPrivateTempFile creates an owner-only directory (no group/other access)', () => {
  const { dir } = writeSqlToPrivateTempFile('SELECT 1;');
  try {
    const mode = fs.statSync(dir).mode & 0o777;
    assert.equal(mode & 0o077, 0, `temp dir must deny group/other access; got 0${mode.toString(8)}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('writeSqlToPrivateTempFile writes the SQL with a trailing newline', () => {
  const { dir, file } = writeSqlToPrivateTempFile('UPDATE submissions SET subscriber_count=\'5萬\' WHERE id=\'s1\';');
  try {
    assert.equal(fs.readFileSync(file, 'utf-8'), "UPDATE submissions SET subscriber_count='5萬' WHERE id='s1';\n");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('writeSqlToPrivateTempFile uses an unpredictable, unique path per call', () => {
  const a = writeSqlToPrivateTempFile('SELECT 1;');
  const b = writeSqlToPrivateTempFile('SELECT 1;');
  try {
    assert.notEqual(a.dir, b.dir, 'each call must create a distinct directory');
    assert.notEqual(a.file, b.file, 'each call must produce a distinct file path');
  } finally {
    fs.rmSync(a.dir, { recursive: true, force: true });
    fs.rmSync(b.dir, { recursive: true, force: true });
  }
});

console.log('✓ fetch-channel-info helpers');
