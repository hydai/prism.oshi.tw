// parse.ts — defensive body parsers for every "legacy" route: one
// parseXBody(value: unknown): T | { error: string } per route, in the house
// style already established by index.ts's parseWorkMatchReviewBody family
// (index.ts:249+). Threading a route through one of these turns
// c.req.json<SomeBody>() (a compile-time-only cast that trusts the wire) into
// c.req.json<unknown>() + a runtime check, so a malformed body 400s instead
// of corrupting a row or crashing downstream (audit 4.4a / W7).
//
// Each parser accepts exactly what admin/ui/src/api/client.ts sends today —
// see the report for the corresponding client.ts call site checked for each
// parser — and rejects everything else with a message naming the field that
// failed. None of them throw; a bad shape is always a returned { error }.

import type { NovaSubmission, NovaVodSubmission, StreamCredit } from '../shared/types';
import { NOVA_SUBMISSION_EDITABLE_FIELDS, NOVA_VOD_EDITABLE_FIELDS } from './nova-db';
import type { NovaEditableField, NovaVodEditableField } from './nova-db';

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

// --- Songs ---

export interface CreateSongPerformanceParsed {
  streamId: string;
  timestamp: number;
  endTimestamp?: number | null;
  note?: string;
}

export interface CreateSongBodyParsed {
  title: string;
  originalArtist: string;
  tags?: string[];
  performances?: CreateSongPerformanceParsed[];
}

// Shared by parseCreateSongBody's inline performances: same field set as a
// stream's performances, minus songId (filled server-side, never from the
// body) — see the comment on POST /api/songs in index.ts.
function parseInlinePerformances(value: unknown): CreateSongPerformanceParsed[] | { error: string } {
  if (!Array.isArray(value)) return { error: 'Invalid performances: expected an array' };

  const result: CreateSongPerformanceParsed[] = [];
  for (let i = 0; i < value.length; i++) {
    const item = value[i];
    if (!isUnknownRecord(item)) return { error: `Invalid performances[${i}]: expected an object` };
    if (typeof item.streamId !== 'string' || item.streamId.trim().length === 0) {
      return { error: `Invalid performances[${i}].streamId: expected a non-empty string` };
    }
    if (!isFiniteNonNegativeNumber(item.timestamp)) {
      return { error: `Invalid performances[${i}].timestamp: expected a finite number >= 0` };
    }
    if (
      item.endTimestamp !== undefined
      && item.endTimestamp !== null
      && (!isFiniteNonNegativeNumber(item.endTimestamp) || item.endTimestamp <= item.timestamp)
    ) {
      // Same invariant as the standalone parseCreatePerformanceBody: an end at
      // or before the start would persist a zero/negative-duration performance.
      return { error: `Invalid performances[${i}].endTimestamp: expected null or a finite number greater than timestamp` };
    }
    if (item.note !== undefined && typeof item.note !== 'string') {
      return { error: `Invalid performances[${i}].note: expected a string` };
    }
    result.push({
      streamId: item.streamId,
      timestamp: item.timestamp,
      ...(item.endTimestamp === undefined ? {} : { endTimestamp: item.endTimestamp as number | null }),
      ...(item.note === undefined ? {} : { note: item.note }),
    });
  }
  return result;
}

export function parseCreateSongBody(value: unknown): CreateSongBodyParsed | { error: string } {
  if (!isUnknownRecord(value)) return { error: 'Request body must be an object' };
  if (typeof value.title !== 'string' || value.title.trim().length === 0) {
    return { error: 'Invalid title: expected a non-empty string' };
  }
  if (typeof value.originalArtist !== 'string' || value.originalArtist.trim().length === 0) {
    return { error: 'Invalid originalArtist: expected a non-empty string' };
  }
  if (value.tags !== undefined && !isStringArray(value.tags)) {
    return { error: 'Invalid tags: expected an array of strings' };
  }

  let performances: CreateSongPerformanceParsed[] | undefined;
  if (value.performances !== undefined) {
    const parsed = parseInlinePerformances(value.performances);
    if ('error' in parsed) return parsed;
    performances = parsed;
  }

  return {
    title: value.title,
    originalArtist: value.originalArtist,
    ...(value.tags === undefined ? {} : { tags: value.tags as string[] }),
    ...(performances === undefined ? {} : { performances }),
  };
}

export interface UpdateSongBodyParsed {
  title?: string;
  originalArtist?: string;
  tags?: string[];
}

export function parseUpdateSongBody(value: unknown): UpdateSongBodyParsed | { error: string } {
  if (!isUnknownRecord(value)) return { error: 'Request body must be an object' };
  if (value.title !== undefined && (typeof value.title !== 'string' || value.title.trim().length === 0)) {
    return { error: 'Invalid title: expected a non-empty string' };
  }
  if (
    value.originalArtist !== undefined
    && (typeof value.originalArtist !== 'string' || value.originalArtist.trim().length === 0)
  ) {
    return { error: 'Invalid originalArtist: expected a non-empty string' };
  }
  if (value.tags !== undefined && !isStringArray(value.tags)) {
    return { error: 'Invalid tags: expected an array of strings' };
  }

  return {
    ...(value.title === undefined ? {} : { title: value.title as string }),
    ...(value.originalArtist === undefined ? {} : { originalArtist: value.originalArtist as string }),
    ...(value.tags === undefined ? {} : { tags: value.tags as string[] }),
  };
}

// --- Performances ---

export interface CreatePerformanceBodyParsed {
  songId: string;
  streamId: string;
  timestamp: number;
  endTimestamp?: number | null;
  note?: string;
}

export function parseCreatePerformanceBody(value: unknown): CreatePerformanceBodyParsed | { error: string } {
  if (!isUnknownRecord(value)) return { error: 'Request body must be an object' };
  if (typeof value.songId !== 'string' || value.songId.trim().length === 0) {
    return { error: 'Invalid songId: expected a non-empty string' };
  }
  if (typeof value.streamId !== 'string' || value.streamId.trim().length === 0) {
    return { error: 'Invalid streamId: expected a non-empty string' };
  }
  if (!isFiniteNonNegativeNumber(value.timestamp)) {
    return { error: 'Invalid timestamp: expected a finite number >= 0' };
  }
  if (
    value.endTimestamp !== undefined
    && value.endTimestamp !== null
    && (typeof value.endTimestamp !== 'number' || !Number.isFinite(value.endTimestamp) || value.endTimestamp <= value.timestamp)
  ) {
    return { error: 'Invalid endTimestamp: expected null or a finite number greater than timestamp' };
  }
  if (value.note !== undefined && typeof value.note !== 'string') {
    return { error: 'Invalid note: expected a string' };
  }

  return {
    songId: value.songId,
    streamId: value.streamId,
    timestamp: value.timestamp,
    ...(value.endTimestamp === undefined ? {} : { endTimestamp: value.endTimestamp as number | null }),
    ...(value.note === undefined ? {} : { note: value.note }),
  };
}

export interface UpdateTimestampsBodyParsed {
  timestamp?: number;
  endTimestamp?: number | null;
}

export function parseUpdateTimestampsBody(value: unknown): UpdateTimestampsBodyParsed | { error: string } {
  if (!isUnknownRecord(value)) return { error: 'Request body must be an object' };
  if (value.timestamp !== undefined && !isFiniteNonNegativeNumber(value.timestamp)) {
    return { error: 'Invalid timestamp: expected a finite number >= 0' };
  }
  if (
    value.endTimestamp !== undefined
    && value.endTimestamp !== null
    && !isFiniteNonNegativeNumber(value.endTimestamp)
  ) {
    return { error: 'Invalid endTimestamp: expected null or a finite number >= 0' };
  }
  if (value.timestamp === undefined && value.endTimestamp === undefined) {
    return { error: 'At least one of timestamp or endTimestamp is required' };
  }
  // Both supplied in one body: enforce the same end-after-start invariant the
  // create parsers carry. (A lone endTimestamp can't be compared here — the
  // stored start isn't in the request.)
  if (
    isFiniteNonNegativeNumber(value.timestamp)
    && typeof value.endTimestamp === 'number'
    && value.endTimestamp <= value.timestamp
  ) {
    return { error: 'Invalid endTimestamp: must be greater than timestamp when both are supplied' };
  }

  return {
    ...(value.timestamp === undefined ? {} : { timestamp: value.timestamp as number }),
    ...(value.endTimestamp === undefined ? {} : { endTimestamp: value.endTimestamp as number | null }),
  };
}

export interface CreateStampPerformanceBodyParsed {
  title: string;
  originalArtist: string;
  timestamp: number;
  endTimestamp: number | null;
  note: string;
}

// POST /api/streams/:streamId/performances — the stamp editor's add-song body.
export function parseCreateStampPerformanceBody(value: unknown): CreateStampPerformanceBodyParsed | { error: string } {
  if (!isUnknownRecord(value)) return { error: 'Request body must be an object' };
  if (typeof value.title !== 'string' || value.title.trim().length === 0) {
    return { error: 'Invalid title: expected a non-empty string' };
  }
  if (typeof value.originalArtist !== 'string' || value.originalArtist.trim().length === 0) {
    return { error: 'Invalid originalArtist: expected a non-empty string' };
  }
  if (!isFiniteNonNegativeNumber(value.timestamp)) {
    return { error: 'Invalid timestamp: expected a finite number >= 0' };
  }
  if (
    value.endTimestamp !== undefined
    && value.endTimestamp !== null
    && (!isFiniteNonNegativeNumber(value.endTimestamp) || value.endTimestamp <= value.timestamp)
  ) {
    return { error: 'Invalid endTimestamp: expected null or a finite number greater than timestamp' };
  }
  if (value.note !== undefined && typeof value.note !== 'string') {
    return { error: 'Invalid note: expected a string' };
  }
  return {
    title: value.title,
    originalArtist: value.originalArtist,
    timestamp: value.timestamp,
    endTimestamp: value.endTimestamp === undefined ? null : (value.endTimestamp as number | null),
    note: value.note === undefined ? '' : value.note,
  };
}

export interface UpdateSongDetailsBodyParsed {
  title?: string;
  originalArtist?: string;
}

export function parseUpdateSongDetailsBody(value: unknown): UpdateSongDetailsBodyParsed | { error: string } {
  if (!isUnknownRecord(value)) return { error: 'Request body must be an object' };
  if (value.title !== undefined && (typeof value.title !== 'string' || value.title.trim().length === 0)) {
    return { error: 'Invalid title: expected a non-empty string' };
  }
  if (
    value.originalArtist !== undefined
    && (typeof value.originalArtist !== 'string' || value.originalArtist.trim().length === 0)
  ) {
    return { error: 'Invalid originalArtist: expected a non-empty string' };
  }

  return {
    ...(value.title === undefined ? {} : { title: value.title as string }),
    ...(value.originalArtist === undefined ? {} : { originalArtist: value.originalArtist as string }),
  };
}

export function parseNoteBody(value: unknown): { note: string } | { error: string } {
  if (!isUnknownRecord(value) || typeof value.note !== 'string') {
    return { error: 'note is required' };
  }
  return { note: value.note };
}

// --- Streams ---

export interface CreateStreamBodyParsed {
  title: string;
  date: string;
  videoId: string;
  youtubeUrl: string;
  credit?: StreamCredit;
}

const REQUIRED_STREAM_FIELDS_ERROR = 'title, date, videoId, and youtubeUrl are required';

export function parseCreateStreamBody(value: unknown): CreateStreamBodyParsed | { error: string } {
  if (!isUnknownRecord(value)) return { error: REQUIRED_STREAM_FIELDS_ERROR };
  if (typeof value.title !== 'string' || value.title.trim().length === 0) {
    return { error: REQUIRED_STREAM_FIELDS_ERROR };
  }
  if (typeof value.date !== 'string' || value.date.trim().length === 0) {
    return { error: REQUIRED_STREAM_FIELDS_ERROR };
  }
  if (typeof value.videoId !== 'string' || value.videoId.trim().length === 0) {
    return { error: REQUIRED_STREAM_FIELDS_ERROR };
  }
  if (typeof value.youtubeUrl !== 'string' || value.youtubeUrl.trim().length === 0) {
    return { error: REQUIRED_STREAM_FIELDS_ERROR };
  }

  let credit: StreamCredit | undefined;
  if (value.credit !== undefined) {
    // The stored value is JSON.stringify'd whole and decoded by streamFromRow/
    // exportStreams/the UI as an object with optional string fields — validate
    // and rebuild it so junk shapes (and unknown keys) never reach the row.
    if (!isUnknownRecord(value.credit)) {
      return { error: 'Invalid credit: expected an object' };
    }
    const raw = value.credit;
    for (const key of ['author', 'authorUrl', 'commentUrl'] as const) {
      if (raw[key] !== undefined && typeof raw[key] !== 'string') {
        return { error: `Invalid credit.${key}: expected a string` };
      }
    }
    credit = {
      ...(raw.author === undefined ? {} : { author: raw.author as string }),
      ...(raw.authorUrl === undefined ? {} : { authorUrl: raw.authorUrl as string }),
      ...(raw.commentUrl === undefined ? {} : { commentUrl: raw.commentUrl as string }),
    };
  }

  return {
    title: value.title,
    date: value.date,
    videoId: value.videoId,
    youtubeUrl: value.youtubeUrl,
    ...(credit === undefined ? {} : { credit }),
  };
}

export interface UpdateStreamBodyParsed {
  title?: string;
  date?: string;
  videoId?: string;
  youtubeUrl?: string;
}

const STREAM_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseUpdateStreamBody(value: unknown): UpdateStreamBodyParsed | { error: string } {
  if (!isUnknownRecord(value)) return { error: 'Request body must be an object' };
  if (value.title !== undefined && (typeof value.title !== 'string' || value.title.trim().length === 0)) {
    return { error: 'Invalid title: expected a non-empty string' };
  }
  if (value.videoId !== undefined && (typeof value.videoId !== 'string' || value.videoId.trim().length === 0)) {
    return { error: 'Invalid videoId: expected a non-empty string' };
  }
  if (
    value.youtubeUrl !== undefined
    && (typeof value.youtubeUrl !== 'string' || value.youtubeUrl.trim().length === 0)
  ) {
    return { error: 'Invalid youtubeUrl: expected a non-empty string' };
  }
  // Date gets a format check (not just typeof) so the pre-existing,
  // regex-specific error message survives the parser migration.
  if (value.date !== undefined && (typeof value.date !== 'string' || !STREAM_DATE_RE.test(value.date))) {
    return { error: 'Invalid date format, expected YYYY-MM-DD' };
  }
  if (
    value.title === undefined
    && value.date === undefined
    && value.videoId === undefined
    && value.youtubeUrl === undefined
  ) {
    return { error: 'At least one field (title, date, videoId, youtubeUrl) is required' };
  }

  return {
    ...(value.title === undefined ? {} : { title: value.title as string }),
    ...(value.date === undefined ? {} : { date: value.date as string }),
    ...(value.videoId === undefined ? {} : { videoId: value.videoId as string }),
    ...(value.youtubeUrl === undefined ? {} : { youtubeUrl: value.youtubeUrl as string }),
  };
}

// --- Pipeline: import streams ---

export interface ImportStreamsBodyParsed {
  videoIds: string[];
}

export function parseImportStreamsBody(value: unknown): ImportStreamsBodyParsed | { error: string } {
  if (!isUnknownRecord(value)) return { error: 'videoIds is required' };
  if (!Array.isArray(value.videoIds) || value.videoIds.length === 0) {
    return { error: 'videoIds is required' };
  }
  if (!value.videoIds.every((id): id is string => typeof id === 'string' && id.trim().length > 0)) {
    return { error: 'Invalid videoIds: expected an array of non-empty strings' };
  }
  // De-duped here so this is the tested, primary source of uniqueness; the
  // route keeps its own [...new Set()] too as a defense-in-depth belt.
  return { videoIds: [...new Set(value.videoIds)] };
}

// --- Nova submissions ---

export type NovaSubmissionUpdateFields = Partial<Pick<NovaSubmission, NovaEditableField>>;

export function parseNovaSubmissionUpdateBody(value: unknown): NovaSubmissionUpdateFields | { error: string } {
  if (!isUnknownRecord(value)) return { error: 'Request body must be an object' };

  const result: NovaSubmissionUpdateFields = {};
  for (const key of NOVA_SUBMISSION_EDITABLE_FIELDS) {
    const raw = value[key];
    if (raw === undefined) continue;

    if (key === 'enabled') {
      if (raw !== 0 && raw !== 1) return { error: 'Invalid enabled: expected 0 or 1' };
      result.enabled = raw;
    } else if (key === 'display_order') {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        return { error: 'Invalid display_order: expected a finite number' };
      }
      result.display_order = raw;
    } else if (key === 'theme_json') {
      if (typeof raw !== 'string') return { error: 'Invalid theme_json: expected a JSON string' };
      // '' is the schema's own default and the UI's "no theme" sentinel
      // (parseThemeJson treats an empty value as theme-less) — keep accepting it.
      if (raw !== '') {
        let parsedTheme: unknown;
        try {
          parsedTheme = JSON.parse(raw);
        } catch {
          return { error: 'Invalid theme_json: must be valid JSON' };
        }
        if (!isUnknownRecord(parsedTheme)) {
          return { error: 'Invalid theme_json: must encode a JSON object' };
        }
      }
      result.theme_json = raw;
    } else {
      if (typeof raw !== 'string') return { error: `Invalid ${key}: expected a string` };
      // NovaSubmission's per-field type is heterogeneous (mostly string, two
      // numbers handled above), so a key narrowed to "one of the 16 string
      // fields" still can't write through the union type without this cast —
      // safe here because the typeof check just above proved it.
      (result as Record<NovaEditableField, string | number>)[key] = raw;
    }
  }

  return result;
}

// --- Nova VOD submissions ---

export type NovaVodUpdateFields = Partial<Pick<NovaVodSubmission, NovaVodEditableField>>;

export function parseNovaVodUpdateBody(value: unknown): NovaVodUpdateFields | { error: string } {
  if (!isUnknownRecord(value)) return { error: 'Request body must be an object' };

  const result: NovaVodUpdateFields = {};
  for (const key of NOVA_VOD_EDITABLE_FIELDS) {
    const raw = value[key];
    if (raw === undefined) continue;
    if (typeof raw !== 'string') return { error: `Invalid ${key}: expected a string` };
    result[key] = raw;
  }

  return result;
}

// --- Crystal tickets ---

export function parseCrystalReplyBody(value: unknown): { admin_reply: string } | { error: string } {
  if (!isUnknownRecord(value) || typeof value.admin_reply !== 'string' || value.admin_reply.trim().length === 0) {
    return { error: 'admin_reply is required' };
  }
  return { admin_reply: value.admin_reply.trim() };
}
