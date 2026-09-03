/**
 * cli.ts — small shared helpers for the tools/ CLI scripts.
 *
 * repoRoot() replaces each script's own hand-rolled
 * `path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', ...)`
 * (see e.g. tools/announce-flush/flush.ts) with one implementation, computed
 * once from this module's own location: tools/shared/cli.ts is two
 * directories below the repository root.
 */

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Absolute path to the repository root (the directory containing package.json). */
export function repoRoot(): string {
  return REPO_ROOT;
}
