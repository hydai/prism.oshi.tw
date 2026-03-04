// Timestamp parser — ported from admin/shared/parse.ts
// Originally ported from tools/mizukilens/src/mizukilens/extraction.py
// Parses pasted song lists like "5:30 Song - Artist" into structured data.

export interface ParsedSong {
  orderIndex: number;
  songName: string;
  artist: string;
  startSeconds: number;
  endSeconds: number | null;
  startTimestamp: string;
  endTimestamp: string | null;
}

// --- Regex patterns (mirroring Python originals) ---

const TIMESTAMP_RE = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/;
const LINE_TS_RE = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})/;
const RANGE_END_RE = /^(?:~|-|–|—)\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})/;

// --- Core functions ---

export function parseTimestamp(ts: string): number | null {
  const m = ts.trim().match(TIMESTAMP_RE);
  if (!m) return null;
  const hours = m[1] ? parseInt(m[1], 10) : 0;
  const minutes = parseInt(m[2]!, 10);
  const seconds = parseInt(m[3]!, 10);
  return hours * 3600 + minutes * 60 + seconds;
}

export function secondsToTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const rem = seconds % 3600;
  const m = Math.floor(rem / 60);
  const s = rem % 60;
  if (h) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function splitArtist(songInfo: string): [string, string] {
  // Try " / " variants
  const slashMatch = songInfo.match(/\s*\/\s+|\s+\/\s*/);
  if (slashMatch) {
    const name = songInfo.slice(0, slashMatch.index!).trim();
    const artist = songInfo.slice(slashMatch.index! + slashMatch[0].length).trim();
    return [name, artist];
  }

  // Try " - " (em-dash and en-dash too)
  const dashMatch = songInfo.match(/\s+-\s+/);
  if (dashMatch) {
    const name = songInfo.slice(0, dashMatch.index!).trim();
    const artist = songInfo.slice(dashMatch.index! + dashMatch[0].length).trim();
    return [name, artist];
  }

  // Try bare "/" (no spaces required) — common in JP/CN listings
  const bareSlash = songInfo.indexOf('/');
  if (bareSlash !== -1) {
    const name = songInfo.slice(0, bareSlash).trim();
    const artist = songInfo.slice(bareSlash + 1).trim();
    if (name && artist) return [name, artist];
  }

  return [songInfo.trim(), ''];
}

interface RawSong {
  startSeconds: number;
  endSeconds?: number;
  songName: string;
  artist: string;
}

export function parseSongLine(line: string): RawSong | null {
  line = line.trim();
  if (!line) return null;

  // Strip leading box-drawing characters
  line = line.replace(/^[\u2500-\u257F\s]+/, '');
  if (!line) return null;

  // Strip common numbering prefixes: "01. ", "1) ", "#3 "
  line = line.replace(/^(?:\d+\.\s*|\d+\)\s+|#\d+\s+)/, '');

  // Strip bullet prefixes: "- ", "* ", "+ "
  line = line.replace(/^[-*+]\s+/, '');

  // Find leading timestamp
  const tsMatch = line.match(LINE_TS_RE);
  if (!tsMatch) return null;

  const hours = tsMatch[1] ? parseInt(tsMatch[1], 10) : 0;
  const minutes = parseInt(tsMatch[2]!, 10);
  const seconds = parseInt(tsMatch[3]!, 10);
  const startSeconds = hours * 3600 + minutes * 60 + seconds;

  // Rest of the line after the timestamp
  let remainder = line.slice(tsMatch[0].length).trim();

  // Check for range end-timestamp (e.g. "~ 00:08:26" or "- 1:23:45")
  let endSeconds: number | undefined;
  const rangeMatch = remainder.match(RANGE_END_RE);
  if (rangeMatch) {
    const rh = rangeMatch[1] ? parseInt(rangeMatch[1], 10) : 0;
    const rm = parseInt(rangeMatch[2]!, 10);
    const rs = parseInt(rangeMatch[3]!, 10);
    endSeconds = rh * 3600 + rm * 60 + rs;
    remainder = remainder.slice(rangeMatch[0].length).trim();
  }

  // Strip leading separator characters
  const sepMatch = remainder.match(/^(?:-\s+|–\s+|—\s+)/);
  if (sepMatch) {
    remainder = remainder.slice(sepMatch[0].length).trim();
  }

  if (!remainder) return null;

  const [songName, artist] = splitArtist(remainder);

  const result: RawSong = { startSeconds, songName, artist };
  if (endSeconds !== undefined) result.endSeconds = endSeconds;
  return result;
}

function toHMS(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatSongList(
  performances: { title: string; originalArtist: string; timestamp: number; endTimestamp: number | null }[],
): string {
  return performances
    .map((p, i) => {
      const num = String(i + 1).padStart(2, '0');
      const start = toHMS(p.timestamp);
      const end = p.endTimestamp !== null ? toHMS(p.endTimestamp) : '--:--:--';
      const artist = p.originalArtist ? ` / ${p.originalArtist}` : '';
      return `${num}. ${start} ~ ${end} ${p.title}${artist}`;
    })
    .join('\n');
}

export function parseTextToSongs(text: string): ParsedSong[] {
  const rawSongs: RawSong[] = [];
  for (const line of text.split('\n')) {
    const parsed = parseSongLine(line);
    if (parsed) rawSongs.push(parsed);
  }

  if (rawSongs.length === 0) return [];

  const result: ParsedSong[] = [];
  for (let i = 0; i < rawSongs.length; i++) {
    const song = rawSongs[i]!;
    const startSec = song.startSeconds;

    let endSec: number | null;
    if (song.endSeconds !== undefined) {
      endSec = song.endSeconds;
    } else if (i + 1 < rawSongs.length) {
      endSec = rawSongs[i + 1]!.startSeconds;
    } else {
      endSec = null;
    }

    result.push({
      orderIndex: i,
      songName: song.songName,
      artist: song.artist,
      startSeconds: startSec,
      endSeconds: endSec,
      startTimestamp: secondsToTimestamp(startSec),
      endTimestamp: endSec !== null ? secondsToTimestamp(endSec) : null,
    });
  }

  return result;
}
