import type { CreatePerformanceBody, CreateSongBody } from '../../../shared/types';

/**
 * What the Submit Song form checks and sends, kept out of the page so the page is only layout and focus.
 * The rules are the worker's (`parseCreateSongBody` and `parseInlinePerformances`, admin/src/parse.ts),
 * plus whole seconds only: a title and an artist that are not empty after trim, and for each performance
 * a stream ID, a start from 0 and an end that is empty or later than the start. The worker takes any
 * finite number for those two; here they are whole seconds that a number holds exactly (`wholeSeconds`).
 */

/** One performance row as typed: each field is the text in its input. */
export interface PerformanceDraft {
  /** Fixed for the life of the row, wherever it sits: its React key and the base of its field ids. */
  clientId: string;
  streamId: string;
  timestamp: string;
  endTimestamp: string;
  note: string;
}

/** The inputs of a row, named by the draft field each one edits. */
export type PerformanceField = 'streamId' | 'timestamp' | 'endTimestamp' | 'note';

export function blankDraft(clientId: string): PerformanceDraft {
  return { clientId, streamId: '', timestamp: '', endTimestamp: '', note: '' };
}

/** The id of one input of a row: the label's `for`, and where the focus goes when the row before it leaves. */
export function rowFieldId(clientId: string, field: PerformanceField): string {
  return `${clientId}-${field}`;
}

/** What each field of a row says is wrong with it, or `null`. */
export interface RowErrors {
  streamId: string | null;
  timestamp: string | null;
  endTimestamp: string | null;
}

/**
 * What POST /api/songs reads of an inline performance. The worker takes the stream's date, title and
 * video from the stream row and fills `songId` itself, so none of those is sent.
 */
type InlinePerformance = Pick<CreatePerformanceBody, 'streamId' | 'timestamp' | 'endTimestamp' | 'note'>;

interface RowCheck {
  /** Nothing typed in any field (spaces do not count): the row is left out of the request and reports nothing. */
  blank: boolean;
  errors: RowErrors;
  /** What is sent for the row; `null` while it is blank or has an error. */
  performance: InlinePerformance | null;
}

interface SongCheck {
  titleError: string | null;
  artistError: string | null;
  /** One check per row, in the order of the rows. */
  rows: RowCheck[];
  /** Nothing to fix: the request can go. */
  valid: boolean;
}

const TITLE_ERROR = 'Enter a title.';
const ARTIST_ERROR = 'Enter the original artist.';
const STREAM_ID_ERROR = 'Enter the stream ID.';
const START_EMPTY_ERROR = 'Enter the start in seconds.';
const START_FORMAT_ERROR = 'Start must be a whole number of seconds.';
const END_FORMAT_ERROR = 'End must be a whole number of seconds, or empty.';
const END_ORDER_ERROR = 'End must be after the start.';

/**
 * A whole number of seconds: digits and nothing else (so not `1.5`, `-1` or `1e3`), and one a number holds
 * exactly. Without that last rule a few hundred digits would become `Infinity`, which JSON turns into
 * `null`. For a start the worker would then answer with a message about a field the user never saw; for an
 * end it would read the `null` as "no end" and store the performance without the end that was typed.
 */
function wholeSeconds(text: string): number | null {
  if (!/^\d+$/.test(text)) return null;
  const seconds = Number(text);
  return Number.isSafeInteger(seconds) ? seconds : null;
}

function startError(text: string, start: number | null): string | null {
  if (text === '') return START_EMPTY_ERROR;
  return start === null ? START_FORMAT_ERROR : null;
}

/** An end can only be too early for a start that is a number; until then it is checked on its own. */
function endError(text: string, end: number | null, start: number | null): string | null {
  if (text === '') return null;
  if (end === null) return END_FORMAT_ERROR;
  return start !== null && end <= start ? END_ORDER_ERROR : null;
}

function checkRow(draft: PerformanceDraft): RowCheck {
  const streamId = draft.streamId.trim();
  const startText = draft.timestamp.trim();
  const endText = draft.endTimestamp.trim();
  const note = draft.note.trim();
  if (streamId === '' && startText === '' && endText === '' && note === '') {
    return { blank: true, errors: { streamId: null, timestamp: null, endTimestamp: null }, performance: null };
  }

  const start = wholeSeconds(startText);
  const end = endText === '' ? null : wholeSeconds(endText);
  const errors: RowErrors = {
    streamId: streamId === '' ? STREAM_ID_ERROR : null,
    timestamp: startError(startText, start),
    endTimestamp: endError(endText, end, start),
  };
  const sendable = errors.streamId === null && start !== null && errors.endTimestamp === null;
  return { blank: false, errors, performance: sendable ? { streamId, timestamp: start, endTimestamp: end, note } : null };
}

/** Checks the whole form as typed. A row with every field empty is skipped; a row with any other is checked. */
export function checkSong(title: string, originalArtist: string, drafts: PerformanceDraft[]): SongCheck {
  const titleError = title.trim() === '' ? TITLE_ERROR : null;
  const artistError = originalArtist.trim() === '' ? ARTIST_ERROR : null;
  const rows = drafts.map(checkRow);
  const valid = titleError === null && artistError === null && rows.every((row) => row.blank || row.performance !== null);
  return { titleError, artistError, rows, valid };
}

/**
 * The request for a form that checked out, and how many empty rows it leaves out. Title and artist are
 * trimmed here because the worker stores them as sent; `performances` is left off when no row is left.
 */
export function songRequest(
  title: string,
  originalArtist: string,
  check: SongCheck,
): { body: CreateSongBody; skipped: number } {
  const performances = check.rows.flatMap((row) => (row.performance === null ? [] : [row.performance]));
  const body: CreateSongBody = {
    title: title.trim(),
    originalArtist: originalArtist.trim(),
    ...(performances.length > 0 ? { performances } : {}),
  };
  return { body, skipped: check.rows.filter((row) => row.blank).length };
}

/** What the success toast adds when rows were left out; nothing when none were. */
export function skippedDetail(skipped: number): string | undefined {
  if (skipped === 0) return undefined;
  return skipped === 1 ? '1 empty performance row skipped' : `${skipped} empty performance rows skipped`;
}
