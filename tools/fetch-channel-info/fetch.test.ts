import * as assert from 'node:assert/strict';

import {
  APPROVED_WITH_CHANNEL_SQL,
  buildUpdateSql,
  formatSummary,
  parseDevVarYoutubeKey,
  parseWranglerResults,
  toSqlStringLiteral,
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

// --- parseWranglerResults ---

test('parseWranglerResults returns the first result set rows', () => {
  const raw = JSON.stringify([{ results: [{ id: 'a' }, { id: 'b' }], success: true }]);
  assert.deepEqual(parseWranglerResults<{ id: string }>(raw), [{ id: 'a' }, { id: 'b' }]);
});

test('parseWranglerResults returns an empty array when there are no results', () => {
  assert.deepEqual(parseWranglerResults('[]'), []);
});

// --- parseDevVarYoutubeKey ---

test('parseDevVarYoutubeKey extracts the key value', () => {
  assert.equal(parseDevVarYoutubeKey('YOUTUBE_API_KEY=abc123\n'), 'abc123');
});

test('parseDevVarYoutubeKey returns null when the key is absent', () => {
  assert.equal(parseDevVarYoutubeKey('DEV_AUTH_EMAIL=me@example.com\n'), null);
});

test('parseDevVarYoutubeKey ignores commented lines', () => {
  assert.equal(parseDevVarYoutubeKey('# YOUTUBE_API_KEY=commented\nYOUTUBE_API_KEY=real\n'), 'real');
});

test('parseDevVarYoutubeKey trims whitespace around key and value', () => {
  assert.equal(parseDevVarYoutubeKey('YOUTUBE_API_KEY =  spaced  \n'), 'spaced');
});

test('parseDevVarYoutubeKey strips surrounding quotes', () => {
  assert.equal(parseDevVarYoutubeKey('YOUTUBE_API_KEY="quoted"\n'), 'quoted');
});

test('parseDevVarYoutubeKey treats an empty value as null', () => {
  assert.equal(parseDevVarYoutubeKey('YOUTUBE_API_KEY=\n'), null);
});

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

console.log('✓ fetch-channel-info helpers');
