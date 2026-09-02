import {
  guardedStatement,
  prepareMergeGuardCleanup,
  prepareMergeGuardInsert,
} from './guard';

declare const process: { exitCode?: number };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

type CapturedStatement = { sql: string; params: unknown[] };

class FakeStatement {
  params: unknown[] = [];

  constructor(readonly sql: string) {}

  bind(...params: unknown[]): FakeStatement {
    this.params = params;
    return this;
  }
}

/** Records the exact SQL text and bind order every guard helper composes. */
class FakeD1 {
  readonly prepared: CapturedStatement[] = [];

  prepare(sql: string): FakeStatement {
    const statement = new FakeStatement(sql);
    this.prepared.push(statement);
    return statement;
  }
}

const GUARD = {
  guardToken: 'guard-token-1',
  canonicalId: 'song-canonical',
  actor: 'system:harmonizer-merge-guard',
};

function testGuardInsertComposesTheCallerCteAndBindsAfterIt(): void {
  const db = new FakeD1();
  const statement = prepareMergeGuardInsert(db as unknown as D1Database, {
    ...GUARD,
    validityCte: {
      sql: `WITH expected_links(song_id, work_id) AS (
              SELECT key, value FROM json_each(?)
            ),
            merge_guard(valid) AS (
              SELECT (SELECT revision FROM work_match_state WHERE id = 1) = ?
              FROM expected_links
            )`,
      bindings: ['{"song-canonical":"work-one"}', 41],
    },
  }) as unknown as FakeStatement;

  assert(
    statement.sql.includes('WITH expected_links(song_id, work_id) AS ('),
    'the composed statement keeps the caller-supplied expected-state CTEs',
  );
  assert(
    /merge_guard\(valid\)\s+AS\s+\(/.test(statement.sql),
    'the composed statement keeps the caller-supplied merge_guard validity CTE',
  );
  assert(
    /INSERT\s+INTO\s+merge_guards\s*\(\s*guard_token,\s*canonical_id,\s*actor\s*\)/i
      .test(statement.sql),
    'the guard row is written to the dedicated merge_guards table',
  );
  assert(
    !/work_aliases/i.test(statement.sql),
    'no guard sentinel is written into the work_aliases domain table',
  );
  assert(
    /FROM\s+merge_guard\s+WHERE\s+valid/i.test(statement.sql),
    'the guard row only lands when the caller validity CTE holds',
  );
  assert(
    /RETURNING\s+1\s+AS\s+valid/i.test(statement.sql),
    'the batch can read guard validity off the first statement',
  );
  equal(
    JSON.stringify(statement.params),
    JSON.stringify([
      '{"song-canonical":"work-one"}',
      41,
      'guard-token-1',
      'song-canonical',
      'system:harmonizer-merge-guard',
    ]),
    'validity bindings bind first, then guard token, canonical id, and actor',
  );
}

function testGuardedStatementPrefixesTheTokenLookupAndBindsFirst(): void {
  const db = new FakeD1();
  const statement = guardedStatement(
    db as unknown as D1Database,
    GUARD,
    `UPDATE songs
     SET tags = ?
     WHERE id = ?
       AND (SELECT valid FROM merge_guard)`,
    ['["merged"]', 'song-canonical'],
  ) as unknown as FakeStatement;

  assert(
    /WITH\s+merge_guard\(valid\)\s+AS\s+\(\s*SELECT\s+EXISTS\s*\(/i.test(statement.sql),
    'a guarded mutation opens with the merge_guard validity CTE',
  );
  assert(
    /FROM\s+merge_guards\s+WHERE\s+guard_token\s*=\s*\?\s*AND\s+canonical_id\s*=\s*\?\s*AND\s+actor\s*=\s*\?/i
      .test(statement.sql.replace(/\s+/g, ' ')),
    'the guard lookup matches the token, canonical id, and actor of merge_guards',
  );
  assert(
    !/work_aliases/i.test(statement.sql),
    'a guarded mutation never consults work_aliases for guard state',
  );
  assert(
    statement.sql.includes('UPDATE songs'),
    'the caller statement is appended verbatim after the CTE',
  );
  equal(
    JSON.stringify(statement.params),
    JSON.stringify([
      'guard-token-1',
      'song-canonical',
      'system:harmonizer-merge-guard',
      '["merged"]',
      'song-canonical',
    ]),
    'guard identity binds first, then the caller bindings in order',
  );
}

function testGuardedStatementDefaultsToNoCallerBindings(): void {
  const db = new FakeD1();
  const statement = guardedStatement(
    db as unknown as D1Database,
    GUARD,
    'DELETE FROM songs WHERE (SELECT valid FROM merge_guard)',
  ) as unknown as FakeStatement;

  equal(statement.params.length, 3, 'an unbound caller statement binds guard identity only');
}

function testCleanupDeletesExactlyOneGuardToken(): void {
  const db = new FakeD1();
  const statement = prepareMergeGuardCleanup(
    db as unknown as D1Database,
    'guard-token-1',
  ) as unknown as FakeStatement;

  equal(
    statement.sql.replace(/\s+/g, ' ').trim(),
    'DELETE FROM merge_guards WHERE guard_token = ?',
    'cleanup removes the guard row by its primary key alone',
  );
  equal(
    JSON.stringify(statement.params),
    JSON.stringify(['guard-token-1']),
    'cleanup binds only the guard token',
  );
}

function main(): void {
  testGuardInsertComposesTheCallerCteAndBindsAfterIt();
  testGuardedStatementPrefixesTheTokenLookupAndBindsFirst();
  testGuardedStatementDefaultsToNoCallerBindings();
  testCleanupDeletesExactlyOneGuardToken();
  console.log('✓ merge guards are composed from caller validity CTEs and bound in one shape');
}

try {
  main();
} catch (error: unknown) {
  console.error(error);
  process.exitCode = 1;
}
