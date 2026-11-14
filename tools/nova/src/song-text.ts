import { parseSongLine } from '../../../lib/parse';
import type { PublicStreamSong } from './types';

function toHMS(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** One row as the paste text writes it: `NN. H:MM:SS[ ~ H:MM:SS] title / artist`. */
function pasteLine(song: PublicStreamSong, index: number): string {
  const number = String(index + 1).padStart(2, '0');
  const end = song.end_timestamp === null ? '' : ` ~ ${toHMS(song.end_timestamp)}`;
  return `${number}. ${toHMS(song.start_timestamp)}${end} ${song.song_title} / ${song.original_artist}`;
}

// Reads back through the form parsers, unlike lib/parse.ts's formatSongList (`--:--:--` for a null
// end, no separator for an empty artist). What it cannot carry, the submission puts back: a title
// with a spaced slash (restoreArchivedIdentities), and a middle row's missing end, which the
// parsers fill with the next row's start (restoreArchivedEnds).
export function formatSongsForPaste(songs: readonly PublicStreamSong[]): string {
  return songs.map(pasteLine).join('\n');
}

interface SongIdentity {
  song_title: string;
  original_artist: string;
}

const identityKey = (title: string, artist: string): string => JSON.stringify([title, artist]);

/**
 * The submitted rows, with each one that reads exactly as an archived row's paste line reads put
 * back to that row's title and artist. The form parsers split a line at its first spaced slash, so
 * an archived `A / B` by `Artist` loads as `A / B / Artist` and reads back as `A` by `B / Artist`:
 * without this, a contributor who loads the list and leaves that row alone submits a different
 * song. A reading that is itself an archived song, or that two archived songs share, cannot tell
 * them apart, so a row that reads that way stays as submitted.
 */
export function restoreArchivedIdentities<T extends SongIdentity>(
  submitted: readonly T[],
  current: readonly PublicStreamSong[],
): T[] {
  const archived = new Set(current.map((song) => identityKey(song.song_title, song.original_artist)));
  const restored = new Map<string, SongIdentity | null>();
  current.forEach((song, index) => {
    const read = parseSongLine(pasteLine(song, index));
    if (!read) return;
    const key = identityKey(read.songName, read.artist);
    const own = identityKey(song.song_title, song.original_artist);
    if (key === own) return;
    const prior = restored.get(key);
    const ambiguous = archived.has(key) || prior === null
      || (prior !== undefined && identityKey(prior.song_title, prior.original_artist) !== own);
    restored.set(key, ambiguous ? null : { song_title: song.song_title, original_artist: song.original_artist });
  });
  return submitted.map((row) => {
    const identity = restored.get(identityKey(row.song_title, row.original_artist));
    return identity ? { ...row, ...identity } : row;
  });
}

interface SubmittedTimes extends SongIdentity {
  start_timestamp: number;
  end_timestamp: number | null;
}

// A row as isSameAsPublicList compares it: trimmed title, an empty artist read as 'Unknown', and its start.
const rowKey = (title: string, artist: string, start: number): string =>
  JSON.stringify([title.trim(), artist.trim() || 'Unknown', start]);

/**
 * The submitted rows, with each end the form parsers filled in put back to NULL where the archived
 * row has none. The paste text leaves a missing end out, and the parsers give such a row the next
 * row's start, so a contributor who loads the list and leaves the row alone would submit an end
 * nobody gave. A row counts as untouched when its title, artist and start match an archived row
 * without an end and its end is exactly the next submitted row's start: that is what a parser
 * fills in, and an end typed equal to it reads the same, as on the review page.
 */
export function restoreArchivedEnds<T extends SubmittedTimes>(
  submitted: readonly T[],
  current: readonly PublicStreamSong[],
): T[] {
  const endless = new Set(
    current
      .filter((song) => song.end_timestamp === null)
      .map((song) => rowKey(song.song_title, song.original_artist, song.start_timestamp)),
  );
  return submitted.map((row, index) => {
    const next = submitted[index + 1];
    if (!next || row.end_timestamp === null || row.end_timestamp !== next.start_timestamp) return row;
    return endless.has(rowKey(row.song_title, row.original_artist, row.start_timestamp)) ? { ...row, end_timestamp: null } : row;
  });
}

interface ComparableRow {
  title: string;
  artist: string;
  start: number;
  end: number | null;
}

// Trimmed title; an empty artist counts as 'Unknown', which is what the import defaults it to.
function toComparable(song: PublicStreamSong): ComparableRow {
  return {
    title: song.song_title.trim(),
    artist: song.original_artist.trim() || 'Unknown',
    start: song.start_timestamp,
    end: song.end_timestamp,
  };
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareEnds(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a - b;
}

// By start; rows sharing a start are ordered by their other fields, so their input order never matters.
function compareRows(a: ComparableRow, b: ComparableRow): number {
  return a.start - b.start || compareEnds(a.end, b.end) || compareText(a.title, b.title) || compareText(a.artist, b.artist);
}

/**
 * Whether a submission repeats the public list as it is: the same rows in any order, each with an
 * equal trimmed title, artist (empty = 'Unknown'), start and end (null = null).
 */
export function isSameAsPublicList(
  submitted: ReadonlyArray<{ song_title: string; original_artist: string; start_timestamp: number; end_timestamp: number | null }>,
  current: readonly PublicStreamSong[],
): boolean {
  if (submitted.length !== current.length) return false;
  const submittedRows = submitted.map(toComparable).sort(compareRows);
  const currentRows = current.map(toComparable).sort(compareRows);
  return submittedRows.every((row, i) => {
    const other = currentRows[i];
    return row.title === other.title && row.artist === other.artist && row.start === other.start && row.end === other.end;
  });
}
