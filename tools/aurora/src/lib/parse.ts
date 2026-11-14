import { parseSongLine, parseTextToSongs, secondsToTimestamp, type ParsedSong } from '../../../../lib/parse';

export * from '../../../../lib/parse';

/**
 * parseTextToSongs over the text's lines in time order. The parser ends a line where the next line starts, so a song
 * missed and typed out of its place would end across the rows after it, and one appended below a start-only paste
 * would end before its own start. Sorted first, each end is filled from the next row in time. A line sorts by the
 * start parseSongLine reads and is read as typed; a line the parser cannot read is dropped, as parseTextToSongs drops
 * it. The sort lives here: lib/parse.ts, which admin and Nova import, stays as it is.
 * Nova's form sorts its lines the same way (sortSongLines in tools/nova/src/vod-page.ts): the two must behave alike.
 *
 * Given `existing`, the rows the editor holds that these lines are appended below (附加), a line that gives no end
 * ends where the next row starts in the list the two make together, in time order: one of the editor's rows or a
 * pasted one, and none for the last. That is the order the submission sends them in, the editor's rows first among
 * rows that start together. The editor's rows are only read, and are not in the result.
 * A pasted line with no name is nobody's next row. The submission leaves it out, as it leaves out an editor row with
 * no name, which the caller does not pass. It refills an end from the row right below only, so a line ended at a
 * nameless one with a blank editor row between them would keep that end. The nameless line is still in the result,
 * for the preview's warning, and its own missing end is filled the same way.
 */
export function parseTextToSongsByStart(text: string, existing?: ReadonlyArray<{ startSeconds: number }>): ParsedSong[] {
  const readable: Array<{ line: string; start: number; endGiven: boolean }> = [];
  for (const line of text.split('\n')) {
    const song = parseSongLine(line);
    if (song) readable.push({ line, start: song.startSeconds, endGiven: song.endSeconds !== undefined });
  }
  // Array.prototype.sort is stable: lines that start together keep the order they were typed in.
  readable.sort((a, b) => a.start - b.start);
  const songs = parseTextToSongs(readable.map(({ line }) => line).join('\n'));
  if (existing === undefined) return songs;

  // The merged list in time order, stable again: the editor's rows come first among rows that start together.
  const merged = [
    ...existing.map((row) => ({ start: row.startSeconds, pasted: -1, named: true })),
    ...songs.map((song, index) => ({ start: song.startSeconds, pasted: index, named: song.songName.trim() !== '' })),
  ].sort((a, b) => a.start - b.start);
  // Each pasted row's next row is the first named one after it, read from the end of the list.
  const nextStart = new Map<number, number | null>();
  let next: number | null = null;
  for (let position = merged.length - 1; position >= 0; position--) {
    const entry = merged[position]!;
    if (entry.pasted >= 0) nextStart.set(entry.pasted, next);
    if (entry.named) next = entry.start;
  }
  return songs.map((song, index) => {
    if (readable[index]!.endGiven) return song;
    const end = nextStart.get(index) ?? null;
    return { ...song, endSeconds: end, endTimestamp: end === null ? null : secondsToTimestamp(end) };
  });
}
