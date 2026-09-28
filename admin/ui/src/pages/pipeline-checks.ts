/** What the Extract step's checks read off a parsed song. */
interface CheckedRow {
  startSeconds: number;
  endSeconds: number | null;
  songName: string;
  artist: string;
}

/**
 * A row's first issue: what its Check cell says, which of its fields the issue is about, and whether
 * it blocks the import (the worker would refuse the row) or only asks for a look.
 */
export interface RowIssue {
  text: string;
  field: 'start' | 'title' | 'artist';
  blocking: boolean;
}

/** Trimmed, lower-cased, runs of whitespace collapsed: two spellings of one song compare equal. */
function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * The Extract step's Check column: for each parsed song, the first thing to fix or to look at before
 * the import, or `null` when the row looks right. First what blocks the import, since the worker
 * refuses the whole import over such a row (`parseExtractImportBody` in admin/src/parse.ts): `No
 * title` (blank once trimmed), then `Ends before it starts` when the row has an end that is not after
 * its start. Then what only asks for a look: `No artist` (blank once trimmed); `Earlier than #n` or
 * `Same start as #n` when it does not start after the row before it; `Same as #m` when an earlier row
 * has the same title and artist, whatever their case and spacing (`m` is the first such row). Row
 * numbers are 1-based, as the table shows them. Each issue names the field to fix: the title for No
 * title and Same as, the artist for No artist, the start for the rest (the End column is read-only).
 */
export function checkParsedRows(rows: readonly CheckedRow[]): (RowIssue | null)[] {
  const issues: (RowIssue | null)[] = [];
  // Each title + artist, by the number of the first row that has it.
  const firstRowOf = new Map<string, number>();
  let previous: CheckedRow | undefined;
  for (const [index, row] of rows.entries()) {
    const key = `${normalize(row.songName)}\u0000${normalize(row.artist)}`;
    const repeats = firstRowOf.get(key);
    if (repeats === undefined) firstRowOf.set(key, index + 1);

    // `index` is the previous row's 1-based number.
    if (row.songName.trim() === '') issues.push({ text: 'No title', field: 'title', blocking: true });
    else if (row.endSeconds !== null && row.endSeconds <= row.startSeconds) {
      issues.push({ text: 'Ends before it starts', field: 'start', blocking: true });
    } else if (row.artist.trim() === '') issues.push({ text: 'No artist', field: 'artist', blocking: false });
    else if (previous !== undefined && row.startSeconds < previous.startSeconds) {
      issues.push({ text: `Earlier than #${index}`, field: 'start', blocking: false });
    } else if (previous !== undefined && row.startSeconds === previous.startSeconds) {
      issues.push({ text: `Same start as #${index}`, field: 'start', blocking: false });
    } else if (repeats !== undefined) issues.push({ text: `Same as #${repeats}`, field: 'title', blocking: false });
    else issues.push(null);
    previous = row;
  }
  return issues;
}
