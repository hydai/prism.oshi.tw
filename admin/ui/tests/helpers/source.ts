import { readdirSync, readFileSync } from 'node:fs';
import { sep } from 'node:path';

/** One file of the app's source: its path from `src/`, and its text. */
interface SourceFile {
  /** The path from `src/`, written with `/` whatever separator the platform uses. */
  path: string;
  text: string;
}

/**
 * Every file under `admin/ui/src/` that ends in one of `extensions`, read, in code-point order of its path. The pins that
 * scan the source (who spells a class, who takes a constant, who uses a token) share this walker, so none keeps a loop of
 * its own or compares paths written with another separator than the lists it checks them against.
 */
export function sourceFiles(extensions: readonly string[] = ['.ts', '.tsx']): SourceFile[] {
  const src = new URL('../../src/', import.meta.url);
  return readdirSync(src, { recursive: true, encoding: 'utf8' })
    .map((entry) => entry.split(sep).join('/'))
    .filter((path) => extensions.some((extension) => path.endsWith(extension)))
    .sort()
    .map((path) => ({ path, text: readFileSync(new URL(path, src), 'utf8') }));
}
