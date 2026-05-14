#!/usr/bin/env npx tsx
/**
 * inbox-status: Report pending Nova Streamer, Nova VOD, and Crystal inbox items
 * without opening the deployed admin website.
 *
 * Usage: npx tsx tools/inbox-status/status.ts
 *
 * Exit code: 0 when all inboxes have no pending rows, 1 when any inbox has
 * pending rows. The command is read-only and only queries Cloudflare D1.
 */

import { execFileSync } from 'node:child_process';
import * as path from 'node:path';

const ROOT = process.cwd();
const NOVA_DIR = path.resolve(ROOT, 'tools/nova');
const CRYSTAL_DIR = path.resolve(ROOT, 'tools/crystal');

export type InboxName = 'streamer' | 'vod' | 'crystal';

export interface StatusCountRow {
  inbox: InboxName;
  status: string;
  total: number;
  latest_submitted_at: string | null;
}

export interface StreamerSubmissionRow {
  id: string;
  status?: string;
  slug: string;
  display_name: string;
  youtube_channel_url: string;
  submitted_at: string;
  reviewed_at?: string | null;
}

export interface VodSubmissionRow {
  id: string;
  status?: string;
  streamer_slug: string;
  video_id: string;
  video_url: string;
  stream_title: string;
  stream_date: string;
  thumbnail_url?: string;
  submitter_note: string;
  submitted_at: string;
  reviewed_at?: string | null;
  song_count: number;
}

export interface CrystalTicketRow {
  id: string;
  status?: string;
  type: string;
  title: string;
  body?: string;
  nickname: string;
  contact?: string;
  is_public_reply_allowed: number;
  context_url: string;
  submitted_at: string;
  replied_at?: string | null;
  closed_at?: string | null;
}

export interface InboxSummary {
  label: string;
  pending: number;
  latestSubmittedAt: string | null;
  statuses: Record<string, number>;
}

export interface InboxReport {
  inboxes: Record<InboxName, InboxSummary>;
  pendingStreamers: StreamerSubmissionRow[];
  pendingVods: VodSubmissionRow[];
  pendingCrystalTickets: CrystalTicketRow[];
  latestStreamers: StreamerSubmissionRow[];
  latestVods: VodSubmissionRow[];
  latestCrystalTickets: CrystalTicketRow[];
}

export interface BuildReportInput {
  counts: StatusCountRow[];
  pendingStreamers: StreamerSubmissionRow[];
  pendingVods: VodSubmissionRow[];
  pendingCrystalTickets: CrystalTicketRow[];
  latestStreamers: StreamerSubmissionRow[];
  latestVods: VodSubmissionRow[];
  latestCrystalTickets: CrystalTicketRow[];
}

const INBOX_ORDER: InboxName[] = ['streamer', 'vod', 'crystal'];
const INBOX_LABELS: Record<InboxName, string> = {
  streamer: 'Streamer',
  vod: 'VOD',
  crystal: 'Crystal',
};
const STATUS_ORDER = ['pending', 'approved', 'replied', 'rejected', 'closed'];

const NOVA_COUNTS_SQL = `
  SELECT 'streamer' AS inbox, status, COUNT(*) AS total, MAX(submitted_at) AS latest_submitted_at
    FROM submissions GROUP BY status
  UNION ALL
  SELECT 'vod' AS inbox, status, COUNT(*) AS total, MAX(submitted_at) AS latest_submitted_at
    FROM vod_submissions GROUP BY status
  ORDER BY inbox, status
`.trim();

const CRYSTAL_COUNTS_SQL = `
  SELECT 'crystal' AS inbox, status, COUNT(*) AS total, MAX(submitted_at) AS latest_submitted_at
    FROM tickets GROUP BY status ORDER BY status
`.trim();

export const PENDING_STREAMERS_SQL = `
  SELECT id, status, slug, display_name, youtube_channel_url, submitted_at, reviewed_at
    FROM submissions
   WHERE status = 'pending'
   ORDER BY submitted_at DESC
`.trim();

const LATEST_STREAMERS_SQL = `
  SELECT id, status, slug, display_name, youtube_channel_url, submitted_at, reviewed_at
    FROM submissions
   ORDER BY submitted_at DESC
   LIMIT 3
`.trim();

export const PENDING_VODS_SQL = `
  SELECT v.id, v.status, v.streamer_slug, v.video_id, v.video_url, v.stream_title,
         v.stream_date, v.thumbnail_url, v.submitter_note, v.submitted_at, v.reviewed_at,
         COUNT(s.id) AS song_count
    FROM vod_submissions v
    LEFT JOIN vod_songs s ON s.vod_submission_id = v.id
   WHERE v.status = 'pending'
   GROUP BY v.id
   ORDER BY v.submitted_at DESC
`.trim();

const LATEST_VODS_SQL = `
  SELECT v.id, v.status, v.streamer_slug, v.video_id, v.video_url, v.stream_title,
         v.stream_date, v.thumbnail_url, v.submitter_note, v.submitted_at, v.reviewed_at,
         COUNT(s.id) AS song_count
    FROM vod_submissions v
    LEFT JOIN vod_songs s ON s.vod_submission_id = v.id
   GROUP BY v.id
   ORDER BY v.submitted_at DESC
   LIMIT 3
`.trim();

export const PENDING_CRYSTAL_SQL = `
  SELECT id, status, type, title, nickname, is_public_reply_allowed,
         context_url, submitted_at, replied_at, closed_at
    FROM tickets
   WHERE status = 'pending'
   ORDER BY submitted_at DESC
`.trim();

const LATEST_CRYSTAL_SQL = `
  SELECT id, status, type, title, nickname, is_public_reply_allowed,
         context_url, submitted_at, replied_at, closed_at
    FROM tickets
   ORDER BY submitted_at DESC
   LIMIT 3
`.trim();

export function parseWranglerResults<T>(raw: string): T[] {
  const parsed = JSON.parse(raw) as Array<{ results?: T[]; success?: boolean; error?: string }>;
  const first = parsed[0];
  if (!first) return [];
  if (first.success === false) {
    throw new Error(first.error || 'wrangler d1 execute failed');
  }
  return first.results ?? [];
}

function queryD1<T>(cwd: string, databaseName: string, sql: string): T[] {
  const raw = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', databaseName, '--remote', '--json', `--command=${sql}`],
    { cwd, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 },
  );
  return parseWranglerResults<T>(raw);
}

function createEmptySummary(inbox: InboxName): InboxSummary {
  return {
    label: INBOX_LABELS[inbox],
    pending: 0,
    latestSubmittedAt: null,
    statuses: {},
  };
}

function latestTs(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

export function buildReport(input: BuildReportInput): InboxReport {
  const inboxes = Object.fromEntries(
    INBOX_ORDER.map((inbox) => [inbox, createEmptySummary(inbox)]),
  ) as Record<InboxName, InboxSummary>;

  for (const row of input.counts) {
    const summary = inboxes[row.inbox];
    if (!summary) continue;
    summary.statuses[row.status] = row.total;
    if (row.status === 'pending') summary.pending = row.total;
    summary.latestSubmittedAt = latestTs(summary.latestSubmittedAt, row.latest_submitted_at);
  }

  return {
    inboxes,
    pendingStreamers: input.pendingStreamers,
    pendingVods: input.pendingVods,
    pendingCrystalTickets: input.pendingCrystalTickets,
    latestStreamers: input.latestStreamers,
    latestVods: input.latestVods,
    latestCrystalTickets: input.latestCrystalTickets,
  };
}

function formatTs(ts: string | null | undefined): string {
  if (!ts) return '-';
  return ts.replace('T', ' ').slice(0, 16);
}

function formatStatuses(statuses: Record<string, number>): string {
  const ordered = [
    ...STATUS_ORDER.filter((status) => statuses[status] !== undefined),
    ...Object.keys(statuses).filter((status) => !STATUS_ORDER.includes(status)).sort(),
  ];
  if (ordered.length === 0) return '-';
  return ordered.map((status) => `${status}:${statuses[status]}`).join(', ');
}

function padRow(row: string[], widths: number[]): string {
  return row.map((cell, i) => cell.padEnd(widths[i])).join('  ');
}

function table(headers: string[], rows: string[][]): string[] {
  const widths = headers.map((header, i) => Math.max(header.length, ...rows.map((row) => row[i].length)));
  return [
    padRow(headers, widths),
    widths.map((width) => '-'.repeat(width)).join('  '),
    ...rows.map((row) => padRow(row, widths)),
  ];
}

function totalPending(report: InboxReport): number {
  return INBOX_ORDER.reduce((sum, inbox) => sum + report.inboxes[inbox].pending, 0);
}

function pushSection(lines: string[], title: string, rows: string[]): void {
  if (rows.length === 0) return;
  lines.push('', title, ...rows);
}

function streamerLine(row: StreamerSubmissionRow, fallbackStatus = 'pending'): string {
  return `- ${row.id} ${row.status ?? fallbackStatus} ${row.slug} / ${row.display_name || '-'} / ${formatTs(row.submitted_at)} / ${row.youtube_channel_url || '-'}`;
}

function vodLine(row: VodSubmissionRow, fallbackStatus = 'pending'): string {
  const title = row.stream_title || '(no title)';
  const date = row.stream_date || 'no date';
  return `- ${row.id} ${row.status ?? fallbackStatus} ${row.streamer_slug}/${row.video_id} (${row.song_count} songs) / ${date} / ${title} / ${formatTs(row.submitted_at)} / ${row.video_url || '-'}`;
}

function crystalLine(row: CrystalTicketRow, fallbackStatus = 'pending'): string {
  const visibility = row.is_public_reply_allowed ? 'public' : 'private';
  const nickname = row.nickname || 'anon';
  return `- ${row.id} ${row.status ?? fallbackStatus} ${row.type} ${visibility} / ${row.title} / ${nickname} / ${formatTs(row.submitted_at)}${row.context_url ? ` / ${row.context_url}` : ''}`;
}

export function formatReport(report: InboxReport): string {
  const summaryRows = INBOX_ORDER.map((inbox) => {
    const summary = report.inboxes[inbox];
    return [
      summary.label,
      String(summary.pending),
      formatStatuses(summary.statuses),
      formatTs(summary.latestSubmittedAt),
    ];
  });

  const lines = [
    'inbox-status: Nova + Crystal inbox report',
    '',
    ...table(['Inbox', 'Pending', 'Statuses', 'Latest submitted'], summaryRows),
  ];

  const pending = totalPending(report);
  if (pending === 0) {
    lines.push('', '✓ no pending inbox items');
  } else {
    lines.push('', `⚠ 需要處理：${pending} pending inbox item(s)`);
    pushSection(lines, 'Pending Streamer submissions:', report.pendingStreamers.map((row) => streamerLine(row)));
    pushSection(lines, 'Pending VOD submissions:', report.pendingVods.map((row) => vodLine(row)));
    pushSection(lines, 'Pending Crystal tickets:', report.pendingCrystalTickets.map((row) => crystalLine(row)));
  }

  pushSection(lines, 'Latest Streamer submissions:', report.latestStreamers.map((row) => streamerLine(row, row.status ?? '-')));
  pushSection(lines, 'Latest VOD submissions:', report.latestVods.map((row) => vodLine(row, row.status ?? '-')));
  pushSection(lines, 'Latest Crystal tickets:', report.latestCrystalTickets.map((row) => crystalLine(row, row.status ?? '-')));

  return lines.join('\n');
}

export function exitCodeForReport(report: InboxReport): 0 | 1 {
  return totalPending(report) === 0 ? 0 : 1;
}

export function fetchReport(): InboxReport {
  const novaCounts = queryD1<StatusCountRow>(NOVA_DIR, 'oshi-prism-nova', NOVA_COUNTS_SQL);
  const crystalCounts = queryD1<StatusCountRow>(CRYSTAL_DIR, 'oshi-crystal', CRYSTAL_COUNTS_SQL);

  return buildReport({
    counts: [...novaCounts, ...crystalCounts],
    pendingStreamers: queryD1<StreamerSubmissionRow>(NOVA_DIR, 'oshi-prism-nova', PENDING_STREAMERS_SQL),
    pendingVods: queryD1<VodSubmissionRow>(NOVA_DIR, 'oshi-prism-nova', PENDING_VODS_SQL),
    pendingCrystalTickets: queryD1<CrystalTicketRow>(CRYSTAL_DIR, 'oshi-crystal', PENDING_CRYSTAL_SQL),
    latestStreamers: queryD1<StreamerSubmissionRow>(NOVA_DIR, 'oshi-prism-nova', LATEST_STREAMERS_SQL),
    latestVods: queryD1<VodSubmissionRow>(NOVA_DIR, 'oshi-prism-nova', LATEST_VODS_SQL),
    latestCrystalTickets: queryD1<CrystalTicketRow>(CRYSTAL_DIR, 'oshi-crystal', LATEST_CRYSTAL_SQL),
  });
}

export function main(): void {
  console.log('inbox-status: querying Nova + Crystal D1...');
  const report = fetchReport();
  console.log(formatReport(report));
  process.exit(exitCodeForReport(report));
}

function isMainScript(): boolean {
  const entry = process.argv[1] ?? '';
  return entry.endsWith('tools/inbox-status/status.ts') || entry.endsWith('tools/inbox-status/status.js');
}

if (isMainScript()) {
  main();
}
