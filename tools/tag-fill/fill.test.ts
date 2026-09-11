import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';

import {
  buildUpdateSql,
  executeD1FileArgs,
  formatReport,
  runFill,
  WORKS_SQL,
  writeSqlToPrivateTempFile,
  type FillIo,
} from './fill.ts';

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

const rows = [
  { id: 'w-open', title: '夜に駆ける', original_artist: 'YOASOBI', tags: '[]' },
  { id: 'w-done', title: '晴天', original_artist: '周杰倫', tags: '["language:zh"]' },
  { id: 'w-bad', title: 'x', original_artist: 'y', tags: 'not json' },
];

/**
 * `reads` are served in order by successive readWorks() calls (the last one repeats), so a
 * test can hand the apply step a "database state after the write" that differs from the
 * plan — the way a guard that skipped a row would leave it.
 */
function fakeIo(works = rows, ...laterReads: Array<typeof rows>): FillIo & { executed: string[]; logged: string[] } {
  const reads = [works, ...laterReads];
  const io = {
    executed: [] as string[],
    logged: [] as string[],
    readWorks: () => (reads.length > 1 ? reads.shift()! : reads[0]),
    readStreamers: () => [{ slug: 'mizuki', displayName: '浠Mizuki' }],
    execute: (sql: string) => { io.executed.push(sql); },
    log: (line: string) => { io.logged.push(line); },
  };
  return io;
}

test('WORKS_SQL reads exactly the columns the rules need', () => {
  assert.equal(WORKS_SQL, 'SELECT id, title, original_artist, tags FROM works');
});

test('preview plans but never writes', () => {
  const io = fakeIo();
  const plan = runFill({ apply: false, io });
  assert.deepEqual(plan.updates.map((u) => u.id), ['w-open']);
  assert.deepEqual(io.executed, []);
  assert.match(io.logged.join('\n'), /3 works read, 1 work\(s\) to update \(preview/);
  assert.match(io.logged.join('\n'), /L1 title script:\s+1/);
  assert.match(io.logged.join('\n'), /--apply/);
});

test('malformed stored JSON is treated as no tags, not a crash', () => {
  const plan = runFill({ apply: false, io: fakeIo([{ id: 'w-bad', title: '夜に駆ける', original_artist: 'x', tags: 'not json' }]) });
  assert.deepEqual(plan.updates.map((u) => u.tags), [['language:ja']]);
});

const appliedRows = rows.map((row) => (row.id === 'w-open' ? { ...row, tags: '["language:ja"]' } : row));

test('apply writes one UPDATE per changed work through the executor and verifies it landed', () => {
  const io = fakeIo(rows, appliedRows);
  runFill({ apply: true, io });
  assert.equal(io.executed.length, 1);
  assert.equal(
    io.executed[0],
    `UPDATE works SET tags = '["language:ja"]', updated_at = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE id = 'w-open' AND tags = '[]';`,
    'the write is guarded by the exact tags text that was read',
  );
  assert.match(io.logged.join('\n'), /^tag-fill: wrote 1 work\(s\)$/m);
});

test('apply reports rows the guard skipped instead of claiming they were written', () => {
  // The read-back still shows the pre-write value for w-open: its guard did not match.
  const io = fakeIo(rows, rows);
  runFill({ apply: true, io });
  assert.match(io.logged.join('\n'), /wrote 0 work\(s\); 1 skipped because they changed between the read and the write .*: w-open/);
  assert.doesNotMatch(io.logged.join('\n'), /^tag-fill: wrote 1 work\(s\)$/m);
});

test('the guard carries the stored text verbatim, malformed JSON included', () => {
  const io = fakeIo([{ id: 'w-bad', title: '夜に駆ける', original_artist: 'x', tags: 'not json' }]);
  runFill({ apply: true, io });
  assert.equal(
    io.executed[0],
    `UPDATE works SET tags = '["language:ja"]', updated_at = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE id = 'w-bad' AND tags = 'not json';`,
  );
});

test('--details lists every planned work with its identity, stored tags and additions', () => {
  const io = fakeIo();
  runFill({ apply: false, details: true, io });
  assert.match(io.logged.join('\n'), /^w-open\t夜に駆ける — YOASOBI\t\[\] \+ 日文歌 \(L1\)$/m);
  const plain = fakeIo();
  runFill({ apply: false, io: plain });
  assert.doesNotMatch(plain.logged.join('\n'), /w-open\t/, 'details stay out of the default report');
});

test('a second run over the applied rows writes nothing', () => {
  const io = fakeIo(appliedRows);
  runFill({ apply: true, io });
  assert.deepEqual(io.executed, []);
  assert.match(io.logged.join('\n'), /0 work\(s\) to update/);
});

test('buildUpdateSql escapes single quotes', () => {
  const sql = buildUpdateSql({
    updates: [{ id: "it's", tags: ['language:en'], added: [] }],
    counts: { L1: 0, L2: 0, L3: 0, S1: 0, S2: 0 },
    propagated: [],
  }, new Map([["it's", "['x']"]]));
  assert.equal(sql, `UPDATE works SET tags = '["language:en"]', updated_at = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE id = 'it''s' AND tags = '[''x'']';`);
});

test('formatReport lists propagation by artist with labels', () => {
  const report = formatReport({
    updates: [],
    counts: { L1: 0, L2: 0, L3: 2, S1: 0, S2: 0 },
    propagated: [{ artist: 'YOASOBI', tag: 'language:ja', works: 2 }],
  }, 10, true);
  assert.match(report, /YOASOBI → 日文歌 ×2/);
});

test('executeD1FileArgs targets the admin database remotely by default', () => {
  withEnv('PRISM_D1_LOCAL', undefined, () => {
    assert.deepEqual(executeD1FileArgs('/tmp/x.sql'), ['wrangler@latest', 'd1', 'execute', 'oshi-prism-db', '--remote', '--file=/tmp/x.sql']);
  });
});

test('writeSqlToPrivateTempFile creates an owner-only file that ends with a newline', () => {
  const { dir, file } = writeSqlToPrivateTempFile('SELECT 1;');
  try {
    assert.equal(fs.readFileSync(file, 'utf-8'), 'SELECT 1;\n');
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
