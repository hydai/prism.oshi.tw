/**
 * cli.ts — small shared helpers for the tools/ CLI scripts.
 *
 * repoRoot() replaces each script's own hand-rolled
 * `path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', ...)`
 * (see e.g. tools/announce-flush/flush.ts) with one implementation, computed
 * once from this module's own location: tools/shared/cli.ts is two
 * directories below the repository root.
 *
 * isMain() replaces each script's own `entry.endsWith('tools/x/y.ts') ||
 * entry.endsWith('tools/x/y.js')` guard. readJsonOr() replaces the
 * hand-rolled ENOENT-tolerant JSON read repeated across the sync scripts.
 * parseDevVar()/loadSecret() replace the two near-identical `.dev.vars`
 * line parsers that used to live in tools/shared/announce.ts and
 * tools/fetch-channel-info/fetch.ts.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Absolute path to the repository root (the directory containing package.json). */
export function repoRoot(): string {
  return REPO_ROOT;
}

/**
 * True when this module was invoked directly (`npx tsx foo.ts`) rather than
 * merely imported — i.e. it is the process's entry point. Compares the
 * resolved `process.argv[1]` against `importMetaUrl` (pass the caller's own
 * `import.meta.url`), so it works whether the script runs as `.ts` (via tsx)
 * or a built `.js`, with no per-file suffix literal to keep in sync. Both
 * sides are additionally resolved with `fs.realpathSync` before comparing:
 * Node resolves `import.meta.url` to the module's real, symlink-free path,
 * but `process.argv[1]` is left exactly as invoked, so a script run through
 * a symlinked path (e.g. macOS's `/tmp` → `/private/tmp`) would otherwise
 * compare a symlink path against a realpath and always report false — every
 * sync/ops script run from such a checkout would exit 0 having done
 * nothing. Falls back to the plain resolved-path comparison if either
 * realpath call throws (e.g. the path doesn't exist).
 */
export function isMain(importMetaUrl: string): boolean {
  const argvPath = path.resolve(process.argv[1] ?? '');
  const modulePath = fileURLToPath(importMetaUrl);
  try {
    return fs.realpathSync(argvPath) === fs.realpathSync(modulePath);
  } catch {
    return argvPath === modulePath;
  }
}

/**
 * Read and JSON.parse `filePath`, returning `fallback` when the file doesn't
 * exist (ENOENT — the expected "nothing written yet" case). Any other
 * failure — a directory instead of a file, corrupt JSON, a permissions
 * error — rethrows: those signal an operator problem the caller should fail
 * loud on, not silently paper over with the fallback.
 */
export function readJsonOr<T>(filePath: string, fallback: T): T {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw err;
  }
  return JSON.parse(raw) as T;
}

/**
 * Extract a `KEY=value` entry from `.dev.vars`-style content; null when the
 * key is absent or its value is empty. Skips blank lines and `#` comments;
 * matches the first line whose trimmed key equals `key`; strips one layer of
 * surrounding quotes (guarded by `value.length >= 2` — without it a lone `"`
 * or `'` character trivially satisfies both startsWith and endsWith itself
 * and would wrongly collapse to an empty value instead of staying literal).
 */
export function parseDevVar(content: string, key: string): string | null {
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    if (trimmed.slice(0, eq).trim() !== key) continue;
    let value = trimmed.slice(eq + 1).trim();
    const quoted =
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")));
    if (quoted) value = value.slice(1, -1);
    return value === '' ? null : value;
  }
  return null;
}

/**
 * Resolve a secret: `process.env[name]` (trimmed, non-empty) first, else the
 * `NAME=value` line in the `.dev.vars` file at `devVarsPath`, else
 * `undefined`. ANY failure to read or parse that file (missing, EACCES,
 * EISDIR, a race after the existence check, ...) is treated as "no secret
 * here" rather than thrown — callers own the loudness of an `undefined`
 * result (tools/shared/announce.ts skips quietly; tools/fetch-channel-info/fetch.ts
 * prints its "not found" message and exits 1).
 */
export function loadSecret(name: string, { devVarsPath }: { devVarsPath: string }): string | undefined {
  const fromEnv = process.env[name]?.trim();
  if (fromEnv) return fromEnv;
  if (!fs.existsSync(devVarsPath)) return undefined;
  try {
    const content = fs.readFileSync(devVarsPath, 'utf-8');
    return parseDevVar(content, name) ?? undefined;
  } catch {
    return undefined;
  }
}
