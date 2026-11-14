// nova-db.ts — data access for the Nova submissions/vods tables (NOVA_DB, a
// separate D1 database from the main admin catalog). Mirrors db.ts's style:
// plain functions taking a D1Database, unit-tested through a hand-rolled
// FakeD1 in nova-db.test.ts. Extracted from index.ts (audit 4.3 / W6) so this
// SQL has a test seam instead of living inline inside route handlers.

import {
  NOVA_STATUSES,
  NOVA_SUBMISSION_EDITABLE_FIELDS,
  NOVA_VOD_EDITABLE_FIELDS,
} from '../shared/types';
import type { NovaStatus, NovaSubmission, NovaVodSubmission, NovaVodSong } from '../shared/types';
import type { NovaEditableField, NovaVodEditableField } from '../shared/types';
import type { CorrectionBaseRow } from '../shared/vod-correction';
import type { SubscriberRefreshRow } from './subscriber-refresh';

// The PUT /:id allow-lists live in shared/types.ts, next to the row types, so
// the Admin UI can type its request bodies against the same list this file's
// UPDATE walks. Re-exported here because the write path is what callers reach for.
export { NOVA_SUBMISSION_EDITABLE_FIELDS, NOVA_VOD_EDITABLE_FIELDS };
export type { NovaEditableField, NovaVodEditableField };

import { buildStatusFilterQuery } from './query-filters';

function assertValidNovaStatus(status: NovaStatus): void {
  if (!(NOVA_STATUSES as readonly string[]).includes(status)) {
    throw new Error(`Invalid Nova status: ${status}`);
  }
}

// --- Submissions ---

export async function listSubmissions(
  db: D1Database,
  filter: { status?: string; search?: string },
): Promise<NovaSubmission[]> {
  const pattern = filter.search ? `%${filter.search}%` : '';
  const { sql, binds } = buildStatusFilterQuery('SELECT * FROM submissions', 'submitted_at DESC', [
    filter.status ? { column: 'status = ?', binds: [filter.status] } : null,
    filter.search
      ? {
        column: '(id LIKE ? OR slug LIKE ? OR display_name LIKE ? OR youtube_channel_id LIKE ?)',
        binds: [pattern, pattern, pattern, pattern],
      }
      : null,
  ]);
  const result = await db.prepare(sql).bind(...binds).all<NovaSubmission>();
  return result.results;
}

export async function getSubmissionById(db: D1Database, id: string): Promise<NovaSubmission | null> {
  return db.prepare('SELECT * FROM submissions WHERE id = ?').bind(id).first<NovaSubmission>();
}

export interface NovaSubmissionForUpdate {
  id: string;
  youtube_channel_id: string;
  youtube_channel_verified_id: string | null;
  youtube_channel_verified_at: string | null;
}

// Narrow projection used by PUT /:id to decide whether a re-submitted
// youtube_channel_id still carries a current verification.
export async function getSubmissionForUpdate(db: D1Database, id: string): Promise<NovaSubmissionForUpdate | null> {
  return db
    .prepare(`
      SELECT id, youtube_channel_id, youtube_channel_verified_id,
             youtube_channel_verified_at
      FROM submissions
      WHERE id = ?
    `)
    .bind(id)
    .first<NovaSubmissionForUpdate>();
}

export interface NovaSubmissionChannelId {
  id: string;
  youtube_channel_id: string;
}

// Narrow projection shared by verify-youtube-channel and fetch-subscribers —
// both only need to know the currently-stored channel id before calling out
// to YouTube.
export async function getSubmissionChannelId(db: D1Database, id: string): Promise<NovaSubmissionChannelId | null> {
  return db
    .prepare('SELECT id, youtube_channel_id FROM submissions WHERE id = ?')
    .bind(id)
    .first<NovaSubmissionChannelId>();
}

export interface NovaSubmissionStatusRow {
  id: string;
  status: string;
}

export async function getSubmissionStatus(db: D1Database, id: string): Promise<NovaSubmissionStatusRow | null> {
  return db
    .prepare('SELECT id, status FROM submissions WHERE id = ?')
    .bind(id)
    .first<NovaSubmissionStatusRow>();
}

export async function submissionExists(db: D1Database, id: string): Promise<boolean> {
  const row = await db.prepare('SELECT id FROM submissions WHERE id = ?').bind(id).first();
  return row !== null;
}

export async function deleteSubmission(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM submissions WHERE id = ?').bind(id).run();
}

export interface NovaSubmissionVerificationUpdate {
  channelId: string | null;
  verifiedAt: string | null;
}

/**
 * Dynamic UPDATE for the allow-listed submission fields, plus the two
 * derived writes the route needs alongside them: the lower-cased
 * youtube_channel_url_normalized index column (whenever youtube_channel_url
 * itself is present), and the verification pair (only supplied by the
 * caller once a channel id has actually been re-verified or cleared).
 * Unknown keys on `fields` are inert — only NOVA_SUBMISSION_EDITABLE_FIELDS
 * is ever consulted, so nothing outside that allow-list can reach SQL text.
 * Returns false (no-op, no statement run) when there is nothing to set —
 * callers use that to reproduce the original "No fields to update" 400.
 */
export async function updateSubmissionFields(
  db: D1Database,
  id: string,
  fields: Partial<Record<NovaEditableField, string | number>>,
  verification?: NovaSubmissionVerificationUpdate,
): Promise<boolean> {
  const sets: string[] = [];
  const values: Array<string | number | null> = [];

  for (const key of NOVA_SUBMISSION_EDITABLE_FIELDS) {
    const value = fields[key];
    if (value !== undefined) {
      // Quote column name to handle SQL reserved words like "group"
      sets.push(`"${key}" = ?`);
      values.push(value);
    }
  }

  if (fields.youtube_channel_url !== undefined) {
    sets.push('"youtube_channel_url_normalized" = ?');
    values.push(String(fields.youtube_channel_url).trim().toLowerCase());
  }

  if (verification !== undefined) {
    sets.push('"youtube_channel_verified_id" = ?', '"youtube_channel_verified_at" = ?');
    values.push(verification.channelId, verification.verifiedAt);
  }

  if (sets.length === 0) return false;

  values.push(id);
  await db.prepare(`UPDATE submissions SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
  return true;
}

/**
 * PATCH /:id/status write. reviewed_at/reviewer_note follow the existing
 * pending-clears-review-metadata rule: both null when the new status is
 * 'pending', otherwise reviewed_at = now and reviewer_note defaults to ''.
 */
export async function updateSubmissionStatus(
  db: D1Database,
  id: string,
  status: NovaStatus,
  reviewerNote: string | undefined,
): Promise<void> {
  assertValidNovaStatus(status);
  const reviewedAt = status === 'pending' ? null : new Date().toISOString();
  const note = status === 'pending' ? null : (reviewerNote ?? '');
  await db
    .prepare('UPDATE submissions SET status = ?, reviewed_at = ?, reviewer_note = ? WHERE id = ?')
    .bind(status, reviewedAt, note, id)
    .run();
}

/**
 * verify-youtube-channel's write: only applies when youtube_channel_id still
 * matches `expectedChannelId` (optimistic concurrency — the field could have
 * changed since the caller read it). Returns whether the write landed.
 */
export async function updateSubmissionVerification(
  db: D1Database,
  id: string,
  expectedChannelId: string,
  verifiedId: string,
  verifiedAt: string,
): Promise<boolean> {
  const result = await db
    .prepare(`
      UPDATE submissions
      SET youtube_channel_verified_id = ?, youtube_channel_verified_at = ?
      WHERE id = ? AND youtube_channel_id = ?
      RETURNING id
    `)
    .bind(verifiedId, verifiedAt, id, expectedChannelId)
    .run<{ id: string }>();
  return result.results[0]?.id === id;
}

export interface NovaSubmissionSubscriberInfo {
  subscriberCount: string;
  avatarUrl: string;
  verifiedChannelId: string;
  verifiedAt: string;
}

/** fetch-subscribers' write — same optimistic-concurrency shape as above. */
export async function updateSubmissionSubscriberInfo(
  db: D1Database,
  id: string,
  expectedChannelId: string,
  info: NovaSubmissionSubscriberInfo,
): Promise<boolean> {
  const result = await db
    .prepare(`
      UPDATE submissions
      SET subscriber_count = ?, avatar_url = ?,
          youtube_channel_verified_id = ?, youtube_channel_verified_at = ?
      WHERE id = ? AND youtube_channel_id = ?
      RETURNING id
    `)
    .bind(info.subscriberCount, info.avatarUrl, info.verifiedChannelId, info.verifiedAt, id, expectedChannelId)
    .run<{ id: string }>();
  return result.results[0]?.id === id;
}

/** fetch-all-subscribers' preflight read: every approved submission with a channel id set. */
export async function listApprovedSubmissionsWithChannel(db: D1Database): Promise<SubscriberRefreshRow[]> {
  const result = await db
    .prepare("SELECT id, display_name, youtube_channel_id FROM submissions WHERE status = 'approved' AND youtube_channel_id != ''")
    .all<SubscriberRefreshRow>();
  return result.results;
}

// --- VOD submissions ---

/**
 * A VOD submission as Nova stores it, with its base (migration 0015): the public list it was compared against, as
 * JSON, '[]' when the stream showed nothing, NULL when there was none; and whether a base_revision confirmed that
 * list (base_verified, 1 or 0). Only the correction review reads them.
 */
export interface StoredVodSubmission extends NovaVodSubmission {
  base_songs: string | null;
  base_verified: number;
}

// Every column of a VOD submission but base_songs and base_verified: NULL against '[]' tells a stream in the pipeline
// from none, and so does the confirmation of a base, so no list query selects either. A column missing here is
// missing from each listed row's type, which the list route refuses.
const VOD_LIST_COLUMNS = [
  'id', 'streamer_slug', 'video_id', 'video_url', 'stream_title', 'stream_date', 'thumbnail_url', 'submitter_note',
  'status', 'submitted_at', 'reviewed_at', 'reviewer_note', 'kind',
] as const satisfies readonly (keyof NovaVodSubmission)[];

type ListedVod = Pick<NovaVodSubmission, (typeof VOD_LIST_COLUMNS)[number]>;

export async function listVods(
  db: D1Database,
  filter: { status?: string; streamer?: string },
): Promise<ListedVod[]> {
  const { sql, binds } = buildStatusFilterQuery(`SELECT ${VOD_LIST_COLUMNS.join(', ')} FROM vod_submissions`, 'submitted_at DESC', [
    filter.status ? { column: 'status = ?', binds: [filter.status] } : null,
    filter.streamer ? { column: 'streamer_slug = ?', binds: [filter.streamer] } : null,
  ]);
  const result = await db.prepare(sql).bind(...binds).all<ListedVod>();
  return result.results;
}

/** One submission, its base and the confirmation of it included (StoredVodSubmission): the correction review is what reads those. */
export async function getVodById(db: D1Database, id: string): Promise<StoredVodSubmission | null> {
  return db.prepare('SELECT * FROM vod_submissions WHERE id = ?').bind(id).first<StoredVodSubmission>();
}

const isText = (value: unknown): value is string => typeof value === 'string';
const isSeconds = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/**
 * A submission's base_songs as the correction review reads it: each row Nova recorded, in its order, by the review's
 * names. Null when Nova recorded none, and for a value that does not read as such a list: JSON that is not a list,
 * a row missing a field or holding one of the wrong type, or a performance listed twice.
 */
export function parseVodBase(json: string | null): CorrectionBaseRow[] | null {
  if (json === null) return null;
  let stored: unknown;
  try {
    stored = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(stored)) return null;
  const rows: CorrectionBaseRow[] = [];
  for (const item of stored as unknown[]) {
    if (typeof item !== 'object' || item === null) return null;
    const row = item as Record<string, unknown>;
    const { performance_id: performanceId, song_title: title, original_artist: originalArtist } = row;
    const { start_timestamp: timestamp, end_timestamp: endTimestamp } = row;
    if (!isText(performanceId) || !isText(title) || !isText(originalArtist) || !isSeconds(timestamp)) return null;
    if (endTimestamp !== null && !isSeconds(endTimestamp)) return null;
    rows.push({ performanceId, title, originalArtist, timestamp, endTimestamp });
  }
  if (new Set(rows.map((row) => row.performanceId)).size !== rows.length) return null;
  return rows;
}

/** How many other submissions for this (streamer, video) still wait for review: the correction review's 「這場還有 N 份待審修正」. */
export async function countOtherPendingVods(
  db: D1Database,
  streamerSlug: string,
  videoId: string,
  excludeId: string,
): Promise<number> {
  const row = await db
    .prepare(`
      SELECT COUNT(*) AS n FROM vod_submissions
      WHERE streamer_slug = ? AND video_id = ? AND status = 'pending' AND id != ?
    `)
    .bind(streamerSlug, videoId, excludeId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function vodExists(db: D1Database, id: string): Promise<boolean> {
  const row = await db.prepare('SELECT id FROM vod_submissions WHERE id = ?').bind(id).first();
  return row !== null;
}

export async function deleteVod(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM vod_submissions WHERE id = ?').bind(id).run();
}

// GET /:id's own read and the approved-import read both want every song in
// display order — unified on the explicit ASC (the import path's original
// "ORDER BY sort_order" bare form is the same default order, just spelled
// out here so one function serves both call sites).
export async function listVodSongs(db: D1Database, vodSubmissionId: string): Promise<NovaVodSong[]> {
  const result = await db
    .prepare('SELECT * FROM vod_songs WHERE vod_submission_id = ? ORDER BY sort_order ASC')
    .bind(vodSubmissionId)
    .all<NovaVodSong>();
  return result.results;
}

/**
 * The status write; resolves whether it wrote the row. With `expectedStatus` it is a compare-and-set: it writes only
 * a row that still has that status, so a write decided on an older read cannot overwrite a review made since.
 */
export async function updateVodStatus(
  db: D1Database,
  id: string,
  status: NovaStatus,
  reviewerNote: string | undefined,
  expectedStatus?: NovaStatus,
): Promise<boolean> {
  assertValidNovaStatus(status);
  const reviewedAt = status === 'pending' ? null : new Date().toISOString();
  const note = status === 'pending' ? null : (reviewerNote ?? '');
  const sql = 'UPDATE vod_submissions SET status = ?, reviewed_at = ?, reviewer_note = ? WHERE id = ?';
  const statement = expectedStatus === undefined
    ? db.prepare(sql).bind(status, reviewedAt, note, id)
    : db.prepare(`${sql} AND status = ?`).bind(status, reviewedAt, note, id, expectedStatus);
  const result = await statement.run();
  return result.meta.changes > 0;
}

/** PUT /:id's dynamic UPDATE. Same "false means nothing to set" contract as updateSubmissionFields. */
export async function updateVodFields(
  db: D1Database,
  id: string,
  fields: Partial<Record<NovaVodEditableField, string>>,
): Promise<boolean> {
  const sets: string[] = [];
  const values: string[] = [];

  for (const key of NOVA_VOD_EDITABLE_FIELDS) {
    const value = fields[key];
    if (value !== undefined) {
      sets.push(`${key} = ?`);
      values.push(value);
    }
  }

  if (sets.length === 0) return false;

  values.push(id);
  await db.prepare(`UPDATE vod_submissions SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
  return true;
}
