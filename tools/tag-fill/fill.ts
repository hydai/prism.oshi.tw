#!/usr/bin/env npx tsx
/**
 * tag-fill — fill empty language/source tags on works (spec §6).
 *
 *   npm run tags:fill              # preview: read D1, print the plan, write nothing
 *   npm run tags:fill -- --details # preview plus one line per work (id, title, stored tags, additions)
 *   npm run tags:fill -- --apply   # write the plan through wrangler d1 execute --file
 *
 * Rules live in rules.ts and only ever add tags to fields that are empty, so
 * the command can be re-run at any time; a run over already-filled data is a
 * no-op. Writes use the same private temp-file discipline as fetch-channel-info.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { getTagLabel } from '../../lib/tags.ts';
import { isMain, readJsonOr, repoRoot } from '../shared/cli.ts';
import { d1ModeFlag, queryD1 } from '../shared/d1.ts';
import { planTagFill, type FillPlan, type StreamerName, type WorkInput } from './rules.ts';

const ADMIN_DB = 'oshi-prism-db';
const ADMIN_DIR = path.resolve(repoRoot(), 'admin');
const REGISTRY_PATH = path.resolve(repoRoot(), 'data/registry.json');

export const WORKS_SQL = 'SELECT id, title, original_artist, tags FROM works';

interface WorkRow {
  id: string;
  title: string;
  original_artist: string;
  tags: string;
}

interface Registry {
  streamers: Array<{ slug: string; displayName: string }>;
}

export interface FillIo {
  readWorks: () => WorkRow[];
  readStreamers: () => StreamerName[];
  execute: (sql: string) => void;
  log: (line: string) => void;
}

function parseTags(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === 'string') : [];
  } catch {
    return [];
  }
}

function sqlStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * One UPDATE per planned work, each guarded by the exact `tags` text that was read: a row a
 * curator edited between the read and the write no longer matches, is skipped, and simply
 * shows up again in the next preview. That is what keeps "never overwrites a curated value"
 * true even though the read and the write are separate wrangler calls.
 */
export function buildUpdateSql(plan: FillPlan, storedTagsById: ReadonlyMap<string, string>): string {
  return plan.updates
    .map((update) => {
      const stored = storedTagsById.get(update.id);
      if (stored === undefined) throw new Error(`no stored tags for planned work ${update.id}`);
      // Millisecond stamp, like the admin's tag writes: updated_at doubles as the Global
      // Library's optimistic-lock token, so a fill must not leave a second-precision value.
      return `UPDATE works SET tags = ${sqlStringLiteral(JSON.stringify(update.tags))}, ` +
        `updated_at = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE id = ${sqlStringLiteral(update.id)} ` +
        `AND tags = ${sqlStringLiteral(stored)};`;
    })
    .join('\n');
}

/** One line per planned work for `--details`: id, identity, stored tags, then what each rule adds. */
export function formatDetails(plan: FillPlan, works: readonly WorkInput[]): string {
  const byId = new Map(works.map((work) => [work.id, work]));
  return plan.updates
    .map((update) => {
      const work = byId.get(update.id);
      const before = (work?.tags ?? []).map(getTagLabel).join(', ');
      const added = update.added.map((entry) => `${getTagLabel(entry.tag)} (${entry.rule})`).join(', ');
      return `${update.id}\t${work?.title ?? ''} — ${work?.originalArtist ?? ''}\t[${before}] + ${added}`;
    })
    .join('\n');
}

export function formatReport(plan: FillPlan, totalWorks: number, apply: boolean): string {
  const lines = [
    `tag-fill: ${totalWorks} works read, ${plan.updates.length} work(s) to update${apply ? '' : ' (preview — nothing written)'}`,
    `  L1 title script:        ${plan.counts.L1}`,
    `  L2 artist script:       ${plan.counts.L2}`,
    `  L3 artist propagation:  ${plan.counts.L3}`,
    `  S1 vocaloid:            ${plan.counts.S1}`,
    `  S2 original:            ${plan.counts.S2}`,
  ];
  if (plan.propagated.length > 0) {
    lines.push('  propagation by artist:');
    for (const entry of plan.propagated) {
      lines.push(`    ${entry.artist} → ${getTagLabel(entry.tag)} ×${entry.works}`);
    }
  }
  if (!apply && plan.updates.length > 0) lines.push('Run again with --apply to write.');
  return lines.join('\n');
}

export function executeD1FileArgs(filePath: string): string[] {
  return ['wrangler@latest', 'd1', 'execute', ADMIN_DB, d1ModeFlag(), `--file=${filePath}`];
}

/** Owner-only temp dir + wx file, exactly like tools/fetch-channel-info (CWE-377/379). */
export function writeSqlToPrivateTempFile(sql: string): { dir: string; file: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tag-fill-'));
  const file = path.join(dir, 'updates.sql');
  fs.writeFileSync(file, `${sql}\n`, { encoding: 'utf-8', mode: 0o600, flag: 'wx' });
  return { dir, file };
}

function executeSqlFile(sql: string): void {
  const { dir, file } = writeSqlToPrivateTempFile(sql);
  try {
    execFileSync('npx', executeD1FileArgs(file), {
      cwd: ADMIN_DIR,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export const defaultIo: FillIo = {
  readWorks: () => queryD1<WorkRow>('admin', WORKS_SQL),
  readStreamers: () => readJsonOr<Registry>(REGISTRY_PATH, { streamers: [] }).streamers
    .map((streamer) => ({ slug: streamer.slug, displayName: streamer.displayName })),
  execute: executeSqlFile,
  log: (line) => console.log(line),
};

export function runFill({
  apply,
  details = false,
  io = defaultIo,
}: { apply: boolean; details?: boolean; io?: FillIo }): FillPlan {
  const rows = io.readWorks();
  const storedTagsById = new Map(rows.map((row) => [row.id, row.tags]));
  const works: WorkInput[] = rows.map((row) => ({
    id: row.id,
    title: row.title,
    originalArtist: row.original_artist,
    tags: parseTags(row.tags),
  }));
  const plan = planTagFill(works, io.readStreamers());
  if (details && plan.updates.length > 0) io.log(formatDetails(plan, works));
  io.log(formatReport(plan, works.length, apply));
  if (apply && plan.updates.length > 0) {
    io.execute(buildUpdateSql(plan, storedTagsById));
    // wrangler's --file output carries no reliable per-statement change count, so the
    // outcome is verified by reading the works back: a planned row whose stored tags are
    // not the planned tags was skipped by its guard (someone changed it in between).
    const storedAfter = new Map(io.readWorks().map((row) => [row.id, row.tags]));
    const skipped = plan.updates
      .filter((update) => storedAfter.get(update.id) !== JSON.stringify(update.tags))
      .map((update) => update.id);
    const written = plan.updates.length - skipped.length;
    io.log(skipped.length === 0
      ? `tag-fill: wrote ${written} work(s)`
      : `tag-fill: wrote ${written} work(s); ${skipped.length} skipped because they changed between the read and the write ` +
        `(run again to re-plan them): ${skipped.join(', ')}`);
  }
  return plan;
}

if (isMain(import.meta.url)) {
  const args = new Set(process.argv.slice(2));
  const apply = args.delete('--apply');
  const details = args.delete('--details');
  if (args.size > 0) {
    console.error(`usage: npm run tags:fill [-- --details] [-- --apply]  (unknown: ${[...args].join(' ')})`);
    process.exit(1);
  }
  try {
    runFill({ apply, details });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
