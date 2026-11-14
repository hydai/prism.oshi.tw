import { parseSongLine, splitArtist } from '../../../lib/parse';
import type { PublicStreamSong } from './types';

// A public row as the paste text and the restores read it: its performance id plays no part.
type ArchivedSong = Omit<PublicStreamSong, 'performance_id'>;

function toHMS(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** One row as the paste text writes it: `NN. H:MM:SS[ ~ H:MM:SS] title / artist`. */
function pasteLine(song: ArchivedSong, index: number): string {
  const number = String(index + 1).padStart(2, '0');
  const end = song.end_timestamp === null ? '' : ` ~ ${toHMS(song.end_timestamp)}`;
  return `${number}. ${toHMS(song.start_timestamp)}${end} ${song.song_title} / ${song.original_artist}`;
}

// Reads back through the form parsers, unlike lib/parse.ts's formatSongList (`--:--:--` for a null
// end, no separator for an empty artist). What it cannot carry, the submission puts back: a title
// with a spaced slash (restoreArchivedIdentities), and a middle row's missing end, which the
// parsers fill with the next row's start (restoreArchivedEnds). The same two restores put back
// what a title-only or start-only paste of the list drops.
export function formatSongsForPaste(songs: readonly ArchivedSong[]): string {
  return songs.map(pasteLine).join('\n');
}

interface SongIdentity {
  song_title: string;
  original_artist: string;
}

const identityKey = (title: string, artist: string): string => JSON.stringify([title, artist]);

// A reading → the one archived identity it stands for, or null once two different ones read that way.
function remember(readings: Map<string, SongIdentity | null>, reading: string, song: SongIdentity): void {
  const prior = readings.get(reading);
  const agrees = prior === undefined
    || (prior !== null && prior.song_title === song.song_title && prior.original_artist === song.original_artist);
  readings.set(reading, agrees ? { song_title: song.song_title, original_artist: song.original_artist } : null);
}

/**
 * The submitted rows, with each one that reads as an archived row put back to that row's title and
 * artist. Two readings count, the first before the second:
 * - The row's paste line. The form parsers split a line at its first spaced slash, so an archived
 *   `A / B` by `Artist` loads as `A / B / Artist` and reads back as `A` by `B / Artist`: without
 *   this, a contributor who loads the list and leaves that row alone submits a different song.
 * - Its title alone, at the same start. A title-only paste goes through the same split (the form's
 *   splitArtist), bare `/` and ` - ` included, so `POP/STARS` by `K/DA` reads back as `POP` by
 *   `STARS`. A title the split leaves whole reads back with a blank artist, which
 *   restoreBlankArtists fills.
 * A reading that is itself an archived song, or that two archived songs share (for a title, two at
 * one start), cannot tell them apart, so a row that reads that way stays as submitted.
 */
export function restoreArchivedIdentities<T extends SongIdentity & { start_timestamp: number }>(
  submitted: readonly T[],
  current: readonly ArchivedSong[],
): T[] {
  const archived = new Set(current.map((song) => identityKey(song.song_title, song.original_artist)));
  const lines = new Map<string, SongIdentity | null>();
  const titles = new Map<string, SongIdentity | null>();
  current.forEach((song, index) => {
    const read = parseSongLine(pasteLine(song, index));
    if (read && identityKey(read.songName, read.artist) !== identityKey(song.song_title, song.original_artist)) {
      remember(lines, identityKey(read.songName, read.artist), song);
    }
    const [title, artist] = splitArtist(song.song_title);
    if (artist !== '') remember(titles, JSON.stringify([title, artist, song.start_timestamp]), song);
  });
  return submitted.map((row) => {
    const key = identityKey(row.song_title, row.original_artist);
    if (archived.has(key)) return row;
    const identity = lines.has(key) ? lines.get(key) : titles.get(JSON.stringify([row.song_title, row.original_artist, row.start_timestamp]));
    return identity ? { ...row, ...identity } : row;
  });
}

interface SubmittedTimes extends SongIdentity {
  start_timestamp: number;
  end_timestamp: number | null;
}

/**
 * Which submitted rows' ends are derived: the parsers', not the contributor's. The parsers fill a
 * missing end with the next row's start and leave the last row's empty, so an end is derived when
 * it is NULL, or when it equals the start of the next submitted row; the last row's only when NULL.
 * An end typed equal to that start reads the same, as on the review page. The rows are in submitted
 * order, the order the route stores them: the next submitted row is the next one here, whatever
 * its start, and a blank-title row the route dropped is not one. Admin's review computes the same
 * flags; admin/tests/fixtures/derived-end-vectors.json holds the cases both run.
 */
export function derivedEnds(rows: ReadonlyArray<{ start_timestamp: number; end_timestamp: number | null }>): boolean[] {
  return rows.map((row, index) => row.end_timestamp === null || row.end_timestamp === rows[index + 1]?.start_timestamp);
}

// A row as isSameAsPublicList compares it: trimmed title, an empty artist read as 'Unknown', and its start.
const rowKey = (title: string, artist: string, start: number): string =>
  JSON.stringify([title.trim(), artist.trim() || 'Unknown', start]);

/**
 * The submitted rows, with each derived end (derivedEnds) of a row that matches an archived row put
 * back to that row's end, NULL included. The paste text leaves out an end the archive lacks and a
 * start-only paste gives none, and the parsers fill those with the next row's start, so a
 * contributor who leaves a row's end alone would otherwise submit an end nobody gave. A row matches
 * when its trimmed title, its artist (blank = 'Unknown') and its start equal an archived row's;
 * archived rows that match alike but end apart give no guess. The archived end yields only to a
 * next submitted row that starts where no archived row starts (it moved, or is new) and before
 * that end: put back, it would overlap that row, so the submitted end stands. A title or artist
 * edit is no move: before a row that starts where an archived row does, the archived end comes
 * back even where it overlaps, as that overlap is the archive's own. NULL overlaps nothing. A row
 * that matches none keeps the parser's end: the site needs an end to move on to the next song and
 * to show a length. The other restores run first, so each row's title and artist are final here.
 */
export function restoreArchivedEnds<T extends SubmittedTimes>(
  submitted: readonly T[],
  current: readonly ArchivedSong[],
): T[] {
  // Every archived key, an ambiguous one (null) included: a row whose key is here matches an archived row.
  const ends = new Map<string, { end: number | null } | null>();
  for (const song of current) {
    const key = rowKey(song.song_title, song.original_artist, song.start_timestamp);
    const seen = ends.get(key);
    ends.set(key, seen === undefined || (seen !== null && seen.end === song.end_timestamp) ? { end: song.end_timestamp } : null);
  }
  // Where the archived rows start: a next row that starts at one of them did not move, whatever its title and artist.
  const starts = new Set(current.map((song) => song.start_timestamp));
  const derived = derivedEnds(submitted);
  return submitted.map((row, index) => {
    const archived = derived[index] ? ends.get(rowKey(row.song_title, row.original_artist, row.start_timestamp)) : undefined;
    if (!archived) return row;
    const next = submitted[index + 1];
    const yields = next !== undefined
      && !starts.has(next.start_timestamp)
      && archived.end !== null && archived.end > next.start_timestamp;
    return yields ? row : { ...row, end_timestamp: archived.end };
  });
}

/**
 * The submitted rows, with each blank artist filled from the archived row that has the same title
 * and start. A blank artist is the contributor not naming one, which keeps the artist the row has
 * (the review page reads it the same way), so a list sent without artists but otherwise unchanged
 * repeats the archived one. A row whose title or start differs, or whose title and start two
 * archived rows with different artists share, stays as submitted.
 */
export function restoreBlankArtists<T extends SubmittedTimes>(
  submitted: readonly T[],
  current: readonly ArchivedSong[],
): T[] {
  const artists = new Map<string, string | null>();
  for (const song of current) {
    const key = JSON.stringify([song.song_title.trim(), song.start_timestamp]);
    const seen = artists.get(key);
    artists.set(key, seen === undefined || seen === song.original_artist ? song.original_artist : null);
  }
  return submitted.map((row) => {
    if (row.original_artist.trim() !== '') return row;
    const artist = artists.get(JSON.stringify([row.song_title.trim(), row.start_timestamp]));
    return artist ? { ...row, original_artist: artist } : row;
  });
}

interface ComparableRow {
  title: string;
  artist: string;
  start: number;
  end: number | null;
}

// Trimmed title; an empty artist counts as 'Unknown', which is what the import defaults it to.
function toComparable(song: ArchivedSong): ComparableRow {
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
  current: readonly ArchivedSong[],
): boolean {
  if (submitted.length !== current.length) return false;
  const submittedRows = submitted.map(toComparable).sort(compareRows);
  const currentRows = current.map(toComparable).sort(compareRows);
  return submittedRows.every((row, i) => {
    const other = currentRows[i];
    return row.title === other.title && row.artist === other.artist && row.start === other.start && row.end === other.end;
  });
}
