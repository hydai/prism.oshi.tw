/**
 * d1.ts — one shared D1 query helper for the tools/ sync and ops scripts.
 *
 * Every tools/ script that talks to Cloudflare D1 (sync-registry, sync-data,
 * sync-status, fetch-channel-info, inbox-status) shells out to
 * `wrangler d1 execute ... --json` and parses the JSON itself. This module is
 * the one place that shape lives.
 *
 * Empirical facts about wrangler 4.128.0's `d1 execute --json` output —
 * captured 2026-09-03 against a LOCAL D1 database (never --remote) from the
 * tools/nova directory; see d1.test.ts for the exact commands and raw
 * fixture strings:
 *
 *  - On success, wrangler prints a JSON ARRAY with one entry per SQL
 *    statement in --command, e.g.
 *    `[{ "results": [...], "success": true, "meta": {...} }]`. Every caller
 *    in this repo sends a single statement and reads only `[0]`;
 *    parseWranglerResults keeps that contract — a two-statement --command
 *    still returns only the first statement's results.
 *  - On a SQL error, wrangler exits 1 and prints a plain JSON OBJECT instead
 *    of an array: `{ "error": { "text": "…SQLITE_ERROR" } }`. In real use,
 *    execFileSync throwing on that non-zero exit is the primary failure
 *    net — this string is never handed to JSON.parse. parseWranglerResults
 *    still recognises the object shape and throws with `error.text`, as
 *    defense in depth for anything (tests included) that parses captured
 *    stdout directly.
 *  - Anything else — a JSON value that is neither the success array nor the
 *    error object, a success array whose first statement reports
 *    `success: false`, or a success array whose first statement is missing
 *    an array `results` entirely — throws rather than silently returning
 *    `[]`. wrangler always includes a `results` array (even `[]`) on a
 *    successful statement, so a missing/non-array `results` signals
 *    unexpected output, not "no rows"; an empty `results` array on an
 *    actually-successful statement is a legitimate `[]`, not an error.
 *
 * Local dev / test affordance: run the sync scripts against a local D1 with
 * PRISM_D1_LOCAL=1 (e.g. `PRISM_D1_LOCAL=1 npx tsx tools/sync-status/sync.ts`),
 * or pass `{ remote: false }` per call. An explicit `remote` option always
 * wins over the environment variable. Whenever PRISM_D1_LOCAL=1 is what
 * actually decides the target (no explicit `remote` option), d1ModeFlag
 * prints a `console.error` notice to stderr — so an accidentally-exported
 * PRISM_D1_LOCAL=1 doesn't silently point a script (sync-stale included,
 * which commits and pushes on its own) at an empty local database.
 */

import { execFileSync } from 'node:child_process';
import * as path from 'node:path';

import { repoRoot } from './cli.ts';

export type D1Target = 'nova' | 'admin' | 'crystal';

const TARGETS: Record<D1Target, { name: string; cwd: string }> = {
  nova: { name: 'oshi-prism-nova', cwd: path.resolve(repoRoot(), 'tools/nova') },
  admin: { name: 'oshi-prism-db', cwd: path.resolve(repoRoot(), 'admin') },
  crystal: { name: 'oshi-crystal', cwd: path.resolve(repoRoot(), 'tools/crystal') },
};

// Every existing wrapper raises execFileSync's 1 MiB default maxBuffer;
// sync-data's largest export exceeds it.
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;

type WranglerRunner = (args: string[], cwd: string) => string;

function defaultRunner(args: string[], cwd: string): string {
  return execFileSync('npx', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: MAX_BUFFER_BYTES,
  });
}

let runWrangler: WranglerRunner = defaultRunner;

/**
 * Test-only seam: replace the wrangler spawn with a stub so tests can assert
 * on the argument vector/cwd without ever running wrangler. Call with no
 * argument to restore the real runner.
 */
export function __setRunnerForTests(runner: WranglerRunner = defaultRunner): void {
  runWrangler = runner;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWranglerErrorObject(value: unknown): value is { error: { text: string } } {
  return isPlainObject(value) && isPlainObject(value.error) && typeof value.error.text === 'string';
}

/**
 * Parse the raw stdout of `wrangler d1 execute --json`. See the module
 * comment above for the shapes this recognises and why.
 */
export function parseWranglerResults<T>(raw: string): T[] {
  const parsed: unknown = JSON.parse(raw);

  if (Array.isArray(parsed)) {
    const first: unknown = parsed[0];
    if (!isPlainObject(first)) {
      throw new Error('unexpected wrangler output');
    }
    if (first.success === false) {
      const fallback = 'wrangler d1 execute failed';
      throw new Error(typeof first.error === 'string' ? first.error || fallback : fallback);
    }
    if (!Array.isArray(first.results)) {
      throw new Error('unexpected wrangler output');
    }
    return first.results as T[];
  }

  if (isWranglerErrorObject(parsed)) {
    throw new Error(parsed.error.text);
  }

  throw new Error('unexpected wrangler output');
}

/**
 * Decide whether a D1 call should target `--remote` or `--local`. An explicit
 * `remote` argument always wins; otherwise PRISM_D1_LOCAL=1 selects `--local`.
 * This is the single place that decision is made, for both queries (queryD1)
 * and writes (e.g. fetch-channel-info's `wrangler d1 execute --file=` spawn) —
 * so a local-mode run never reads ids from the local database and then writes
 * to the remote one with them. Prints a `console.error` notice to stderr when
 * PRISM_D1_LOCAL=1 is what actually decided the target (no explicit `remote`
 * argument) — so an accidentally-exported PRISM_D1_LOCAL=1 doesn't silently
 * point a script at the wrong database.
 */
export function d1ModeFlag(remote?: boolean): '--remote' | '--local' {
  if (remote === undefined && process.env.PRISM_D1_LOCAL === '1') {
    console.error('d1: PRISM_D1_LOCAL=1 — targeting the LOCAL database');
  }
  const useRemote = remote ?? process.env.PRISM_D1_LOCAL !== '1';
  return useRemote ? '--remote' : '--local';
}

/**
 * Run one SQL statement against a D1 target via `wrangler d1 execute`.
 * Defaults to --remote (the deployed database); pass `{ remote: false }` to
 * query the target's local (miniflare) D1 instead, or set PRISM_D1_LOCAL=1
 * to make that the default for every call that doesn't pass `remote`
 * explicitly — see the module comment.
 */
export function queryD1<T>(target: D1Target, sql: string, { remote }: { remote?: boolean } = {}): T[] {
  const { name, cwd } = TARGETS[target];
  const raw = runWrangler(
    ['wrangler@latest', 'd1', 'execute', name, '--json', d1ModeFlag(remote), '--command', sql],
    cwd,
  );
  return parseWranglerResults<T>(raw);
}
