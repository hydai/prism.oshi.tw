// nova-db.ts — data access for the Nova submissions/vods tables (NOVA_DB, a
// separate D1 database from the main admin catalog). Mirrors db.ts's style:
// plain functions taking a D1Database, unit-tested through a hand-rolled
// FakeD1 in nova-db.test.ts. Extracted from index.ts (audit 4.3 / W6) so this
// SQL has a test seam instead of living inline inside route handlers.

import { NOVA_STATUSES } from '../shared/types';
import type { NovaStatus, NovaSubmission, NovaVodSubmission, NovaVodSong } from '../shared/types';
import type { SubscriberRefreshRow } from './subscriber-refresh';

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

// The PUT /:id allow-list: every submissions column a curator can set through
// a request body. `NovaEditableField` is derived from it with `as const` so
// the type and the runtime list can never drift apart.
export const NOVA_SUBMISSION_EDITABLE_FIELDS = [
  'youtube_channel_url', 'youtube_channel_id', 'slug', 'brand_name', 'display_name', 'description',
  'avatar_url', 'subscriber_count', 'link_youtube', 'link_twitter',
  'link_facebook', 'link_instagram', 'link_twitch', 'reviewer_note',
  'group', 'theme_json', 'enabled', 'display_order', 'external_url',
] as const;

export type NovaEditableField = typeof NOVA_SUBMISSION_EDITABLE_FIELDS[number];

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

export async function listVods(
  db: D1Database,
  filter: { status?: string; streamer?: string },
): Promise<NovaVodSubmission[]> {
  const { sql, binds } = buildStatusFilterQuery('SELECT * FROM vod_submissions', 'submitted_at DESC', [
    filter.status ? { column: 'status = ?', binds: [filter.status] } : null,
    filter.streamer ? { column: 'streamer_slug = ?', binds: [filter.streamer] } : null,
  ]);
  const result = await db.prepare(sql).bind(...binds).all<NovaVodSubmission>();
  return result.results;
}

export async function getVodById(db: D1Database, id: string): Promise<NovaVodSubmission | null> {
  return db.prepare('SELECT * FROM vod_submissions WHERE id = ?').bind(id).first<NovaVodSubmission>();
}

export interface NovaVodStatusRow {
  id: string;
  status: string;
}

export async function getVodStatus(db: D1Database, id: string): Promise<NovaVodStatusRow | null> {
  return db.prepare('SELECT id, status FROM vod_submissions WHERE id = ?').bind(id).first<NovaVodStatusRow>();
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

export async function updateVodStatus(
  db: D1Database,
  id: string,
  status: NovaStatus,
  reviewerNote: string | undefined,
): Promise<void> {
  assertValidNovaStatus(status);
  const reviewedAt = status === 'pending' ? null : new Date().toISOString();
  const note = status === 'pending' ? null : (reviewerNote ?? '');
  await db
    .prepare('UPDATE vod_submissions SET status = ?, reviewed_at = ?, reviewer_note = ? WHERE id = ?')
    .bind(status, reviewedAt, note, id)
    .run();
}

export const NOVA_VOD_EDITABLE_FIELDS = ['stream_title', 'stream_date', 'submitter_note', 'reviewer_note'] as const;

export type NovaVodEditableField = typeof NOVA_VOD_EDITABLE_FIELDS[number];

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
