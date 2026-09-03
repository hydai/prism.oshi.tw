import * as assert from 'node:assert/strict';
import * as path from 'node:path';

import { repoRoot } from './cli.ts';
import { __setRunnerForTests, d1ModeFlag, parseWranglerResults, queryD1 } from './d1.ts';

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

type Call = { args: string[]; cwd: string };

/** Stub the wrangler spawn for the duration of `fn`, recording every call and
 * answering each with a one-statement success response carrying `resultRows`.
 * Restores the real runner afterwards even if `fn` throws. No test in this
 * file spawns wrangler — every queryD1 case below runs through this stub. */
function withStubbedRunner(resultRows: unknown[], fn: (calls: Call[]) => void): void {
  const calls: Call[] = [];
  __setRunnerForTests((args, cwd) => {
    calls.push({ args, cwd });
    return JSON.stringify([{ results: resultRows, success: true, meta: { duration: 0 } }]);
  });
  try {
    fn(calls);
  } finally {
    __setRunnerForTests();
  }
}

// --- parseWranglerResults fixtures ---
//
// Captured 2026-09-03 with wrangler 4.128.0 against a LOCAL D1 database
// (never --remote), from the tools/nova directory:
//   npx --prefix tools/nova wrangler d1 execute oshi-prism-nova --local --json \
//     --command "SELECT 1 AS x" --config tools/nova/wrangler.toml
const SUCCESS_SINGLE_STATEMENT = `[
  {
    "results": [
      {
        "x": 1
      }
    ],
    "success": true,
    "meta": {
      "duration": 1
    }
  }
]`;

// Same invocation with --command "SELECT * FROM no_such_table". wrangler
// exits 1 and prints this plain object instead of a results array.
const ERROR_OBJECT = `{
  "error": {
    "text": "no such table: no_such_table: SQLITE_ERROR"
  }
}`;

// Same invocation with a two-statement --command:
//   "CREATE TABLE IF NOT EXISTS fixture_empty (id INTEGER); SELECT * FROM fixture_empty"
// Both statements succeed with no rows.
const SUCCESS_EMPTY_RESULTS = `[
  {
    "results": [],
    "success": true,
    "meta": {
      "duration": 0
    }
  },
  {
    "results": [],
    "success": true,
    "meta": {
      "duration": 0
    }
  }
]`;

// Same invocation with a two-statement --command whose statements return
// different rows, to prove the parser reads only the first statement:
//   --command "SELECT 1 AS x; SELECT 2 AS y"
const SUCCESS_TWO_STATEMENTS = `[
  {
    "results": [
      {
        "x": 1
      }
    ],
    "success": true,
    "meta": {
      "duration": 0
    }
  },
  {
    "results": [
      {
        "y": 2
      }
    ],
    "success": true,
    "meta": {
      "duration": 0
    }
  }
]`;

test('parseWranglerResults returns the first statement\'s rows from a real success array', () => {
  assert.deepEqual(parseWranglerResults<{ x: number }>(SUCCESS_SINGLE_STATEMENT), [{ x: 1 }]);
});

test('parseWranglerResults throws with error.text from a real wrangler failure object', () => {
  assert.throws(
    () => parseWranglerResults(ERROR_OBJECT),
    (err: Error) => err.message === 'no such table: no_such_table: SQLITE_ERROR',
  );
});

test('parseWranglerResults returns [] for a successful statement with an empty results array', () => {
  assert.deepEqual(parseWranglerResults(SUCCESS_EMPTY_RESULTS), []);
});

test('parseWranglerResults reads only the first statement when --command ran more than one', () => {
  const rows = parseWranglerResults<{ x?: number; y?: number }>(SUCCESS_TWO_STATEMENTS);
  assert.deepEqual(rows, [{ x: 1 }]);
});

test('parseWranglerResults throws (never []) when the first statement reports success: false', () => {
  const raw = JSON.stringify([{ results: [], success: false, error: 'D1_ERROR: disk I/O error' }]);
  assert.throws(
    () => parseWranglerResults(raw),
    (err: Error) => err.message === 'D1_ERROR: disk I/O error',
  );
});

test('parseWranglerResults throws with the generic message when success: false and error is not a string', () => {
  const raw = JSON.stringify([{ results: [], success: false, error: { text: 'nested, not top-level' } }]);
  assert.throws(
    () => parseWranglerResults(raw),
    (err: Error) => err.message === 'wrangler d1 execute failed',
  );
});

test('parseWranglerResults throws with the generic message when success: false and error is an empty string', () => {
  // Without the `|| fallback`, `typeof '' === 'string'` is true and this would
  // throw `new Error('')` instead of a useful message.
  const raw = JSON.stringify([{ results: [], success: false, error: '' }]);
  assert.throws(
    () => parseWranglerResults(raw),
    (err: Error) => err.message === 'wrangler d1 execute failed',
  );
});

test('parseWranglerResults throws (never []) when a successful statement has no results array', () => {
  // wrangler always emits a `results` array (even `[]`) on success, so a
  // `success: true` statement with no array `results` is unexpected output,
  // not "zero rows" — the silent-empty shape the audit set out to remove.
  const raw = JSON.stringify([{ success: true, meta: { duration: 0 } }]);
  assert.throws(() => parseWranglerResults(raw), /unexpected wrangler output/);
});

test('parseWranglerResults throws on malformed JSON', () => {
  assert.throws(() => parseWranglerResults('not json at all'));
});

test('parseWranglerResults throws on valid JSON matching neither recognised shape', () => {
  assert.throws(() => parseWranglerResults(JSON.stringify({ unexpected: 'shape' })), /unexpected wrangler output/);
  assert.throws(() => parseWranglerResults(JSON.stringify(42)), /unexpected wrangler output/);
  assert.throws(() => parseWranglerResults(JSON.stringify(null)), /unexpected wrangler output/);
});

test('parseWranglerResults throws (never []) on an empty top-level array', () => {
  assert.throws(() => parseWranglerResults('[]'), /unexpected wrangler output/);
});

// --- queryD1: argument vector per target ---

test('queryD1 builds the nova argument vector, cwd under repoRoot()/tools/nova', () => {
  withStubbedRunner([{ id: 1 }], (calls) => {
    const rows = queryD1<{ id: number }>('nova', 'SELECT 1', { remote: true });
    assert.deepEqual(rows, [{ id: 1 }]);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args, [
      'wrangler@latest', 'd1', 'execute', 'oshi-prism-nova', '--json', '--remote', '--command', 'SELECT 1',
    ]);
    assert.equal(calls[0].cwd, path.resolve(repoRoot(), 'tools/nova'));
  });
});

test('queryD1 builds the admin argument vector, cwd under repoRoot()/admin', () => {
  withStubbedRunner([], (calls) => {
    queryD1('admin', 'SELECT 2', { remote: true });
    assert.deepEqual(calls[0].args, [
      'wrangler@latest', 'd1', 'execute', 'oshi-prism-db', '--json', '--remote', '--command', 'SELECT 2',
    ]);
    assert.equal(calls[0].cwd, path.resolve(repoRoot(), 'admin'));
  });
});

test('queryD1 builds the crystal argument vector, cwd under repoRoot()/tools/crystal', () => {
  withStubbedRunner([], (calls) => {
    queryD1('crystal', 'SELECT 3', { remote: true });
    assert.deepEqual(calls[0].args, [
      'wrangler@latest', 'd1', 'execute', 'oshi-crystal', '--json', '--remote', '--command', 'SELECT 3',
    ]);
    assert.equal(calls[0].cwd, path.resolve(repoRoot(), 'tools/crystal'));
  });
});

// --- queryD1: --remote vs --local, option and PRISM_D1_LOCAL env ---

test('queryD1 passes --local when { remote: false } is given explicitly', () => {
  withStubbedRunner([], (calls) => {
    queryD1('nova', 'SELECT 1', { remote: false });
    assert.ok(calls[0].args.includes('--local'));
    assert.ok(!calls[0].args.includes('--remote'));
  });
});

test('queryD1 passes --remote when { remote: true } is given explicitly', () => {
  withStubbedRunner([], (calls) => {
    queryD1('nova', 'SELECT 1', { remote: true });
    assert.ok(calls[0].args.includes('--remote'));
    assert.ok(!calls[0].args.includes('--local'));
  });
});

test('queryD1 defaults to --remote when PRISM_D1_LOCAL is unset and no option given', () => {
  withEnv('PRISM_D1_LOCAL', undefined, () => {
    withStubbedRunner([], (calls) => {
      queryD1('nova', 'SELECT 1');
      assert.ok(calls[0].args.includes('--remote'));
      assert.ok(!calls[0].args.includes('--local'));
    });
  });
});

test('queryD1 defaults to --local when PRISM_D1_LOCAL=1 and no option given', () => {
  withEnv('PRISM_D1_LOCAL', '1', () => {
    withStubbedRunner([], (calls) => {
      queryD1('nova', 'SELECT 1');
      assert.ok(calls[0].args.includes('--local'));
      assert.ok(!calls[0].args.includes('--remote'));
    });
  });
});

test('queryD1 lets an explicit { remote: true } override PRISM_D1_LOCAL=1', () => {
  withEnv('PRISM_D1_LOCAL', '1', () => {
    withStubbedRunner([], (calls) => {
      queryD1('nova', 'SELECT 1', { remote: true });
      assert.ok(calls[0].args.includes('--remote'));
    });
  });
});

// --- queryD1: stderr notice when PRISM_D1_LOCAL=1 is honoured ---

/** Stub console.error for the duration of `fn`, recording every call's
 *  arguments. Restores the real console.error afterwards even if `fn` throws. */
function withStubbedConsoleError(fn: (calls: unknown[][]) => void): void {
  const calls: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    calls.push(args);
  };
  try {
    fn(calls);
  } finally {
    console.error = original;
  }
}

test('queryD1 warns on stderr when PRISM_D1_LOCAL=1 actually decides the target', () => {
  withEnv('PRISM_D1_LOCAL', '1', () => {
    withStubbedRunner([], () => {
      withStubbedConsoleError((calls) => {
        queryD1('nova', 'SELECT 1');
        assert.deepEqual(calls, [['d1: PRISM_D1_LOCAL=1 — targeting the LOCAL database']]);
      });
    });
  });
});

test('queryD1 does not warn when { remote: true } is passed explicitly, even with PRISM_D1_LOCAL=1 set', () => {
  withEnv('PRISM_D1_LOCAL', '1', () => {
    withStubbedRunner([], () => {
      withStubbedConsoleError((calls) => {
        queryD1('nova', 'SELECT 1', { remote: true });
        assert.deepEqual(calls, []);
      });
    });
  });
});

test('queryD1 does not warn when PRISM_D1_LOCAL is unset', () => {
  withEnv('PRISM_D1_LOCAL', undefined, () => {
    withStubbedRunner([], () => {
      withStubbedConsoleError((calls) => {
        queryD1('nova', 'SELECT 1');
        assert.deepEqual(calls, []);
      });
    });
  });
});

test('queryD1 propagates a parseWranglerResults failure instead of swallowing it', () => {
  __setRunnerForTests(() => ERROR_OBJECT);
  try {
    assert.throws(() => queryD1('nova', 'SELECT 1'), /no such table: no_such_table: SQLITE_ERROR/);
  } finally {
    __setRunnerForTests();
  }
});

// --- d1ModeFlag: the single place --remote/--local is decided, shared by
// queryD1 (reads) and any write-path spawn (e.g. fetch-channel-info's
// `wrangler d1 execute --file=`) that must follow the same target. ---

test('d1ModeFlag returns --remote when PRISM_D1_LOCAL is unset and no option given', () => {
  withEnv('PRISM_D1_LOCAL', undefined, () => {
    withStubbedConsoleError((calls) => {
      assert.equal(d1ModeFlag(), '--remote');
      assert.deepEqual(calls, []);
    });
  });
});

test('d1ModeFlag returns --local with the stderr notice when PRISM_D1_LOCAL=1 and no option given', () => {
  withEnv('PRISM_D1_LOCAL', '1', () => {
    withStubbedConsoleError((calls) => {
      assert.equal(d1ModeFlag(), '--local');
      assert.deepEqual(calls, [['d1: PRISM_D1_LOCAL=1 — targeting the LOCAL database']]);
    });
  });
});

test('d1ModeFlag(true) returns --remote with no notice even when PRISM_D1_LOCAL=1', () => {
  withEnv('PRISM_D1_LOCAL', '1', () => {
    withStubbedConsoleError((calls) => {
      assert.equal(d1ModeFlag(true), '--remote');
      assert.deepEqual(calls, []);
    });
  });
});

test('d1ModeFlag(false) returns --local with no notice when PRISM_D1_LOCAL is unset', () => {
  withEnv('PRISM_D1_LOCAL', undefined, () => {
    withStubbedConsoleError((calls) => {
      assert.equal(d1ModeFlag(false), '--local');
      assert.deepEqual(calls, []);
    });
  });
});

console.log('d1.test: all passed');
