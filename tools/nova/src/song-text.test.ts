// The paste text must read back exactly through lib/parse.ts (Aurora's parser, which Nova's
// inline form parser mirrors), except a title with a spaced slash and a middle row's missing end,
// which restoreArchivedIdentities and restoreArchivedEnds put back. They also put back what a
// title-only or start-only paste of the list drops: a title the parsers split, and the ends they
// fill (derivedEnds, whose cases admin's review runs too). The identical check must ignore row
// order, surrounding whitespace and an empty artist (= Unknown), and nothing else.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTextToSongs } from '../../../lib/parse';
import { derivedEnds, formatSongsForPaste, isSameAsPublicList, restoreArchivedEnds, restoreArchivedIdentities, restoreBlankArtists } from './song-text';
import type { PublicStreamSong } from './types';

declare const process: { exitCode?: number };

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

/** A public row as the paste text and the restores read it: they never look at its performance id. */
type Row = Omit<PublicStreamSong, 'performance_id'>;

function song(title: string, artist: string, start: number, end: number | null): Row {
  return { song_title: title, original_artist: artist, start_timestamp: start, end_timestamp: end };
}

/** Rows as a contributor submits a pasted text: the parsers' reading, in the order of its lines. */
function submittedFrom(text: string) {
  return parseTextToSongs(text).map((row) => ({
    song_title: row.songName, original_artist: row.artist, start_timestamp: row.startSeconds, end_timestamp: row.endSeconds,
  }));
}

function testLineFormat(): void {
  assertEqual(
    formatSongsForPaste([song('Late Night Drive', 'Unknown', 882, 1026)]),
    '01. 0:14:42 ~ 0:17:06 Late Night Drive / Unknown',
    'a row reads NN. H:MM:SS ~ H:MM:SS title / artist',
  );
  assertEqual(formatSongsForPaste([]), '', 'no rows, no text');
  assertEqual(
    formatSongsForPaste([song('Solo', 'Band', 3600, null)]),
    '01. 1:00:00 Solo / Band',
    'a row without an end leaves out the ~ end part',
  );
  assertEqual(
    formatSongsForPaste([song('Solo', '', 10, null)]),
    '01. 0:00:10 Solo / ',
    'an empty artist keeps the separator',
  );
  assertEqual(
    formatSongsForPaste([song('First', 'A', 0, 59), song('Second', 'B', 3599, 36000)]),
    '01. 0:00:00 ~ 0:00:59 First / A\n02. 0:59:59 ~ 10:00:00 Second / B',
    'rows are numbered from 01 and joined by newlines; the hour is unpadded, minutes and seconds are padded',
  );
}

function testRoundTrip(): void {
  // Every awkward title, with and without an artist: a line that dropped the " / " for an
  // empty artist would be split on the title's own "-" or "/" instead.
  const rows: Row[] = [];
  for (const title of ['lull~そして僕らは~', 'Title - Part', 'A/B']) {
    for (const artist of ['Some Artist', '']) {
      const start = rows.length * 100;
      rows.push(song(title, artist, start, start + 60));
    }
  }
  rows.push(song('Late Start', 'Band', 5377, 5500));

  const parsed = parseTextToSongs(formatSongsForPaste(rows));
  assertEqual(parsed.length, rows.length, 'every row comes back');
  rows.forEach((row, i) => {
    const label = `row ${i + 1} (${row.song_title} / ${row.original_artist || 'no artist'})`;
    const back = parsed[i];
    assertEqual(back.songName, row.song_title, `${label} keeps its title`);
    assertEqual(back.artist, row.original_artist, `${label} keeps its artist`);
    assertEqual(back.startSeconds, row.start_timestamp, `${label} keeps its start`);
    assertEqual(back.endSeconds, row.end_timestamp, `${label} keeps its end`);
  });
}

function testNullEnds(): void {
  const parsed = parseTextToSongs(
    formatSongsForPaste([
      song('First', 'A', 100, 200),
      song('Title - Part', '', 300, null),
      song('A/B', '', 500, null),
    ]),
  );
  assertEqual(parsed.length, 3, 'every row comes back');

  assertEqual(parsed[2].endSeconds, null, 'a last row without an end comes back without one');
  assertEqual(parsed[2].songName, 'A/B', 'the last row keeps its title');
  assertEqual(parsed[2].artist, '', 'the last row keeps its empty artist');

  // The shared parser gives a middle row without an end the next row's start; restoreArchivedEnds
  // puts the missing end back when the list is submitted (testMissingEndComesBack).
  assertEqual(parsed[1].endSeconds, 500, 'a middle row without an end comes back ending where the next row starts');
  assertEqual(parsed[1].songName, 'Title - Part', 'the middle row keeps its title');
  assertEqual(parsed[1].artist, '', 'the middle row keeps its empty artist');
}

function testBlankArtistKeepsTheArchivedOne(): void {
  // A list pasted without artists, otherwise as archived, repeats the archived list.
  const current = [song('First', 'Artist A', 100, 200), song('Second', 'Artist B', 200, 300)];
  const submitted = [song('First', '', 100, 200), song('Second', '  ', 200, 300)];
  const restored = restoreBlankArtists(submitted, current);
  assertEqual(restored[0].original_artist, 'Artist A', 'a blank artist takes the archived one');
  assertEqual(restored[1].original_artist, 'Artist B', 'so does a whitespace-only one');
  assertEqual(isSameAsPublicList(restored, current), true, 'the list sent without artists changes nothing');

  const named = restoreBlankArtists([song('First', 'Someone', 100, 200)], current);
  assertEqual(named[0].original_artist, 'Someone', 'a named artist is the contributor\'s');

  const moved = restoreBlankArtists([song('First', '', 101, 200), song('Firstt', '', 100, 200)], current);
  assertEqual(moved[0].original_artist, '', 'a row whose start moved is not the archived row');
  assertEqual(moved[1].original_artist, '', 'nor is a row whose title changed');

  const twins = [song('Same', 'X', 100, 200), song('Same', 'Y', 100, 150)];
  assertEqual(restoreBlankArtists([song('Same', '', 100, 200)], twins)[0].original_artist, '', 'two archived artists for one title and start: no guess');
}

function testMissingEndComesBack(): void {
  // Submitting the loaded rows unchanged must repeat the archived list, missing middle end included.
  const current = [song('First', 'A', 100, null), song('Second', 'B', 200, 300), song('Last', 'C', 400, null)];
  const parsed = parseTextToSongs(formatSongsForPaste(current));
  assertEqual(parsed[0].endSeconds, 200, 'the parser fills the missing end with the next start');
  const submitted = parsed.map((row) => ({
    song_title: row.songName, original_artist: row.artist, start_timestamp: row.startSeconds, end_timestamp: row.endSeconds,
  }));
  const restored = restoreArchivedEnds(submitted, current);
  assertEqual(restored[0].end_timestamp, null, 'the filled-in end goes back to none');
  assertEqual(restored[1].end_timestamp, 300, 'a given end stays');
  assertEqual(restored[2].end_timestamp, null, 'the last row had none to begin with');
  assertEqual(isSameAsPublicList(restored, current), true, 'the loaded list, submitted unchanged, repeats the public list');
}

function testRestoreKeepsEditedEnds(): void {
  const current = [song('First', 'A', 100, null), song('Second', 'B', 200, 300)];
  const typed = restoreArchivedEnds([
    { song_title: 'First', original_artist: 'A', start_timestamp: 100, end_timestamp: 150 },
    { song_title: 'Second', original_artist: 'B', start_timestamp: 200, end_timestamp: 300 },
  ], current);
  assertEqual(typed[0].end_timestamp, 150, 'an end short of the next start was typed, so it stays');

  const moved = restoreArchivedEnds([
    { song_title: 'First', original_artist: 'A', start_timestamp: 101, end_timestamp: 200 },
    { song_title: 'Second', original_artist: 'B', start_timestamp: 200, end_timestamp: 300 },
  ], current);
  assertEqual(moved[0].end_timestamp, 200, 'a row whose start moved is no longer the archived row');

  // Second is archived ending at 300. An end equal to the next row's start reads as the parsers'
  // fill, whether typed or filled, so the archived end comes back; an end short of it was typed.
  const filled = restoreArchivedEnds([
    { song_title: 'Second', original_artist: 'B', start_timestamp: 200, end_timestamp: 400 },
    { song_title: 'Third', original_artist: 'C', start_timestamp: 400, end_timestamp: null },
  ], current);
  assertEqual(filled[0].end_timestamp, 300, 'a derived end of a row archived with an end takes the archived end');
  assertEqual(filled[1].end_timestamp, null, 'a row that matches no archived row keeps the parser\'s end');
  const shortened = restoreArchivedEnds([
    { song_title: 'Second', original_artist: 'B', start_timestamp: 200, end_timestamp: 350 },
    { song_title: 'Third', original_artist: 'C', start_timestamp: 400, end_timestamp: null },
  ], current);
  assertEqual(shortened[0].end_timestamp, 350, 'an end the contributor typed stays, even on a row archived with another');
}

interface VectorRow {
  title: string;
  artist: string;
  start: number;
  end: number | null;
}

/** A fixture both workers' tests read, from admin/tests/fixtures. */
function sharedFixture<T>(file: string): T {
  return JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../admin/tests/fixtures', file), 'utf8')) as T;
}

interface StoredVectorRow {
  song_title: string;
  original_artist: string;
  start_timestamp: number;
  end_timestamp: number | null;
  sort_order: number;
}

/**
 * A vector's rows as the submit route stores them (tools/nova/src/index.ts, its parse loop). A row with a blank title
 * is dropped and every other one keeps its index as sort_order. A kept row whose end is the start of the dropped row
 * right below it (the end the parsers filled from that row) takes the next kept row's start instead, or none when no
 * kept row follows.
 */
function storedAsNovaStoresThem(rows: VectorRow[]): StoredVectorRow[] {
  const stored: StoredVectorRow[] = [];
  let refilled: StoredVectorRow | null = null;
  for (const [index, row] of rows.entries()) {
    if (row.title.trim() === '') {
      const above = stored[stored.length - 1];
      if (above !== undefined && above.sort_order === index - 1 && above.end_timestamp === row.start) {
        above.end_timestamp = null;
        refilled = above;
      }
      continue;
    }
    if (refilled !== null) {
      refilled.end_timestamp = row.start;
      refilled = null;
    }
    stored.push({ song_title: row.title.trim(), original_artist: row.artist, start_timestamp: row.start, end_timestamp: row.end, sort_order: index });
  }
  return stored;
}

function testDerivedEndVectors(): void {
  // The cases admin's review runs too. Each row is stored as the submit route stores it
  // (storedAsNovaStoresThem), so `derived` lists the stored rows.
  const vectors = sharedFixture<Array<{ name: string; rows: VectorRow[]; derived: boolean[] }>>('derived-end-vectors.json');
  assertEqual(vectors.length >= 6, true, 'the shared vectors hold at least the six cases the plan names');
  for (const vector of vectors) {
    assertEqual(JSON.stringify(derivedEnds(storedAsNovaStoresThem(vector.rows))), JSON.stringify(vector.derived), vector.name);
  }
}

function testYieldVectors(): void {
  // The cases admin's review runs too: `submitted` is what the route stores before the restore,
  // `ends` what the whole chain leaves. Admin reads the stored rows as `submitted` with those ends,
  // so the chain must leave every title and artist as it is.
  const vectors = sharedFixture<Array<{ name: string; archived: VectorRow[]; submitted: VectorRow[]; ends: Array<number | null> }>>('yield-vectors.json');
  assertEqual(vectors.length >= 8, true, 'the shared yield vectors hold at least the six outcomes, the conflicting-ends key and the nested case');
  const toRows = (rows: VectorRow[]) => rows.map((row) => ({
    song_title: row.title, original_artist: row.artist, start_timestamp: row.start, end_timestamp: row.end,
  }));
  for (const vector of vectors) {
    const archived = toRows(vector.archived);
    const submitted = toRows(vector.submitted);
    const restored = restoreArchivedEnds(restoreBlankArtists(restoreArchivedIdentities(submitted, archived), archived), archived);
    const identities = (rows: typeof submitted) => JSON.stringify(rows.map((row) => [row.song_title, row.original_artist]));
    assertEqual(identities(restored), identities(submitted), `${vector.name}: titles and artists are final already`);
    assertEqual(JSON.stringify(restored.map((row) => row.end_timestamp)), JSON.stringify(vector.ends), vector.name);
  }
}

function testStartOnlyPasteTakesTheArchivedEnds(): void {
  // Every archived end differs from the next row's start, so each filled end differs from it too.
  const current = [song('First', 'A', 100, 150), song('Second', 'B', 200, 260), song('Third', 'C', 300, 420)];
  const pasted = submittedFrom('0:01:40 First / A\n0:03:20 Second / B\n0:05:00 Third / C');
  assertEqual(JSON.stringify(pasted.map((row) => row.end_timestamp)), '[200,300,null]', 'the parsers fill each middle end and leave the last one empty');
  const restored = restoreArchivedEnds(pasted, current);
  assertEqual(JSON.stringify(restored.map((row) => row.end_timestamp)), '[150,260,420]', 'each derived end of a matching row takes the archived end');
  assertEqual(isSameAsPublicList(restored, current), true, 'a start-only paste of the archived list repeats it');

  const endless = pasted.map((row) => ({ ...row, end_timestamp: null }));
  assertEqual(isSameAsPublicList(restoreArchivedEnds(endless, current), current), true, 'so do rows sent with no end at all');

  // Second's start moves: Second matches no archived row and keeps the parser's end, the others take theirs.
  const moved = restoreArchivedEnds(submittedFrom('0:01:40 First / A\n0:03:25 Second / B\n0:05:00 Third / C'), current);
  assertEqual(JSON.stringify(moved.map((row) => row.end_timestamp)), '[150,300,420]', 'only the rows that match an archived row take its end');
}

function testArchivedEndsGiveNoGuess(): void {
  // Two archived rows match alike (same title, artist and start) but end apart: neither end is the row's.
  const twins = [song('Same', 'X', 100, 150), song('Same', 'X', 100, 180)];
  assertEqual(restoreArchivedEnds([song('Same', 'X', 100, null)], twins)[0].end_timestamp, null, 'two archived ends for one match: no guess');
  const agreeing = [song('Same', 'X', 100, 150), song('Same', 'X', 100, 150)];
  assertEqual(restoreArchivedEnds([song('Same', 'X', 100, null)], agreeing)[0].end_timestamp, 150, 'two archived rows that agree give their end');
}

function testArchivedEndYieldsOnlyToAMovedOrNewRow(): void {
  // Before a next submitted row that starts where no archived row starts (it moved, or is new), an
  // archived end past that row's start would overlap it, so the submitted end stands; one at or
  // before it comes back, a gap at worst. Before a row that starts where an archived row does, the
  // archived end always comes back: a title or artist edit is no move.
  const touching = [song('First', 'A', 100, 200), song('Second', 'B', 200, 300)];
  const boundary = (at: number) => restoreArchivedEnds([
    { song_title: 'First', original_artist: 'A', start_timestamp: 100, end_timestamp: at },
    { song_title: 'Second', original_artist: 'B', start_timestamp: at, end_timestamp: 300 },
  ], touching)[0].end_timestamp;
  assertEqual(boundary(170), 170, 'a boundary moved earlier keeps the end it was given');
  assertEqual(boundary(230), 200, 'a boundary moved later gives the archived end back');

  const apart = [song('First', 'A', 100, 200), song('Second', 'B', 300, 400)];
  const pasted = restoreArchivedEnds(submittedFrom('0:01:40 First / A\n0:02:30 Second / B'), apart);
  assertEqual(JSON.stringify(pasted.map((row) => row.end_timestamp)), '[150,null]', 'a start-only paste moving Second before First\'s end keeps the parser\'s end');
  const inserted = restoreArchivedEnds(submittedFrom('0:01:40 First / A\n0:03:00 New / N\n0:05:00 Second / B'), apart);
  assertEqual(JSON.stringify(inserted.map((row) => row.end_timestamp)), '[180,300,400]', 'a new row inside the gap keeps First\'s fill, and Second takes back its end');

  // The archive's own overlap: First ends past Second's start, and Second has not moved.
  const overlapping = [song('First', 'A', 100, 300), song('Second', 'B', 200, 400)];
  const unchanged = restoreArchivedEnds(submittedFrom('0:01:40 First / A\n0:03:20 Second / B'), overlapping);
  assertEqual(JSON.stringify(unchanged.map((row) => row.end_timestamp)), '[300,400]', 'before a row that still matches, the archived end comes back even where it overlaps');
  assertEqual(isSameAsPublicList(unchanged, overlapping), true, 'an unchanged start-only paste of an overlapping archive changes nothing');

  const endless = [song('First', 'A', 100, null), song('Second', 'B', 300, 400)];
  assertEqual(restoreArchivedEnds(submittedFrom('0:01:40 First / A\n0:02:30 Second / B'), endless)[0].end_timestamp, null, 'no archived end overlaps anything, so it comes back');
  assertEqual(restoreArchivedEnds([
    { song_title: 'First', original_artist: 'A', start_timestamp: 100, end_timestamp: null },
    { song_title: 'Second', original_artist: 'B', start_timestamp: 200, end_timestamp: null },
  ], apart)[0].end_timestamp, 200, 'an archived end at the next start comes back');

  // An end typed equal to the next start reads as the fill: the archived end comes back (the accepted ambiguity).
  const short = [song('First', 'A', 100, 150), song('Second', 'B', 200, 300)];
  const typed = restoreArchivedEnds([
    { song_title: 'First', original_artist: 'A', start_timestamp: 100, end_timestamp: 200 },
    { song_title: 'Second', original_artist: 'B', start_timestamp: 200, end_timestamp: 300 },
  ], short);
  assertEqual(isSameAsPublicList(typed, short), true, 'a contiguous end alone changes nothing');

  // Two archived Second rows share a key but end apart. Second still matches, so First's
  // overlapping archived end comes back; the Second rows themselves get no guess. Both shapes can
  // be stored: all rows sent without ends, and a start-only paste listing Second once. (Listed
  // twice, the paste would end the first Second at its own start, which the route refuses.)
  const conflicting = [song('First', 'A', 100, 300), song('Second', 'B', 200, 400), song('Second', 'B', 200, 450)];
  const sentWithoutEnds = restoreArchivedEnds(conflicting.map((row): Row => ({ ...row, end_timestamp: null })), conflicting);
  assertEqual(JSON.stringify(sentWithoutEnds.map((row) => row.end_timestamp)), '[300,null,null]', 'a next key with conflicting archived ends still matches');
  const once = restoreArchivedEnds(submittedFrom('0:01:40 First / A\n0:03:20 Second / B'), conflicting);
  assertEqual(JSON.stringify(once.map((row) => row.end_timestamp)), '[300,null]', 'so it does in a start-only paste');
}

function testSpacedSlashTitleComesBack(): void {
  // The form parsers split a line at its first spaced slash, so these titles cannot survive the
  // paste text; submitting the loaded rows unchanged must still repeat the archived list.
  const current = [song('A / B', 'Artist', 100, 200), song('C /D', 'Band', 200, 300), song('Plain', 'Solo', 300, 400)];
  const parsed = parseTextToSongs(formatSongsForPaste(current));
  assertEqual(parsed[0].songName, 'A', 'the parser cuts the title at its own slash');
  assertEqual(parsed[0].artist, 'B / Artist', 'and reads the rest as the artist');
  const submitted = parsed.map((row) => ({
    song_title: row.songName, original_artist: row.artist, start_timestamp: row.startSeconds, end_timestamp: row.endSeconds,
  }));
  const restored = restoreArchivedIdentities(submitted, current);
  current.forEach((row, i) => {
    assertEqual(restored[i].song_title, row.song_title, `row ${i + 1} gets its archived title back`);
    assertEqual(restored[i].original_artist, row.original_artist, `row ${i + 1} gets its archived artist back`);
    assertEqual(restored[i].start_timestamp, row.start_timestamp, `row ${i + 1} keeps its start`);
  });
  assertEqual(isSameAsPublicList(restored, current), true, 'the loaded list, submitted unchanged, repeats the public list');
}

function testRestoreLeavesEditedAndAmbiguousRows(): void {
  const current = [song('A / B', 'Artist', 100, 200)];
  const edited = restoreArchivedIdentities(
    [{ song_title: 'A2', original_artist: 'B / Artist', start_timestamp: 100 }, { song_title: 'A', original_artist: 'B / Artist2', start_timestamp: 100 }],
    current,
  );
  assertEqual(edited[0].song_title, 'A2', "an edited title stays the contributor's");
  assertEqual(edited[1].original_artist, 'B / Artist2', "so does an edited artist");

  const twice = [song('A / B', 'Artist', 100, 200), song('A / B', 'Artist', 300, 400)];
  assertEqual(
    restoreArchivedIdentities([{ song_title: 'A', original_artist: 'B / Artist', start_timestamp: 500 }], twice)[0].song_title,
    'A / B',
    'one song sung twice is not ambiguous',
  );

  // `A / B` by `C` reads back as `A` by `B / C`, which is an archived song of its own here.
  const shadowed = [song('A / B', 'C', 100, 200), song('A', 'B / C', 300, 400)];
  assertEqual(
    restoreArchivedIdentities([{ song_title: 'A', original_artist: 'B / C', start_timestamp: 100 }], shadowed)[0].song_title,
    'A',
    'a reading that is itself an archived song stays as submitted',
  );

  // Both lines read `A / B / C / D`, so both songs read back as `A` by `B / C / D`.
  const twins = [song('A / B', 'C / D', 100, 200), song('A / B / C', 'D', 300, 400)];
  assertEqual(
    restoreArchivedIdentities([{ song_title: 'A', original_artist: 'B / C / D', start_timestamp: 100 }], twins)[0].song_title,
    'A',
    'a reading two archived songs share stays as submitted',
  );
}

function testTitleOnlyPasteComesBack(): void {
  // A title-only paste goes through the same split as a whole line, bare `/` and ` - ` included,
  // so each of these titles reads back as a title and an artist that were never archived.
  const current = [
    song('POP/STARS', 'K/DA', 900, 1140),
    song('Title - Part', 'Band', 1200, 1300),
    song('A / B', 'Artist', 1400, 1500),
    song('Plain', 'Solo', 1600, 1700),
  ];
  const pasted = submittedFrom('0:15:00 ~ 0:19:00 POP/STARS\n0:20:00 ~ 0:21:40 Title - Part\n0:23:20 ~ 0:25:00 A / B\n0:26:40 ~ 0:28:20 Plain');
  assertEqual(JSON.stringify(pasted.map((row) => [row.song_title, row.original_artist])), '[["POP","STARS"],["Title","Part"],["A","B"],["Plain",""]]', 'the parsers split each title');
  const restored = restoreArchivedIdentities(pasted, current);
  current.slice(0, 3).forEach((row, i) => {
    assertEqual(restored[i].song_title, row.song_title, `${row.song_title} gets its archived title back`);
    assertEqual(restored[i].original_artist, row.original_artist, `${row.song_title} gets its archived artist back`);
  });
  assertEqual(restored[3].original_artist, '', 'a title the parsers leave whole keeps its blank artist for restoreBlankArtists');
  assertEqual(isSameAsPublicList(restoreBlankArtists(restored, current), current), true, 'the title-only paste repeats the public list');
}

function testTitleOnlyRestoreNeedsItsStartAndGivesNoGuess(): void {
  const current = [song('POP/STARS', 'K/DA', 900, 1140)];
  const read = { song_title: 'POP', original_artist: 'STARS' };
  assertEqual(restoreArchivedIdentities([{ ...read, start_timestamp: 901 }], current)[0].song_title, 'POP', 'at another start the row is not the archived one');

  const shadowed = [...current, song('POP', 'STARS', 2000, 2100)];
  assertEqual(restoreArchivedIdentities([{ ...read, start_timestamp: 900 }], shadowed)[0].song_title, 'POP', 'a reading that is itself an archived song stays as submitted');

  // Two archived songs at one start read alike: no guess. One song listed twice there is no ambiguity.
  const twins = [song('POP/STARS', 'K/DA', 900, 1140), song('POP / STARS', 'K/DA', 900, 1140)];
  assertEqual(restoreArchivedIdentities([{ ...read, start_timestamp: 900 }], twins)[0].song_title, 'POP', 'two archived songs at one start that read alike: no guess');
  const doubled = [song('POP/STARS', 'K/DA', 900, 1140), song('POP/STARS', 'K/DA', 900, 1000)];
  assertEqual(restoreArchivedIdentities([{ ...read, start_timestamp: 900 }], doubled)[0].song_title, 'POP/STARS', 'one song listed twice at a start is not ambiguous');
}

function publicList(): Row[] {
  return [song('First', 'Artist A', 100, 200), song('Second', 'Unknown', 200, 300), song('Third', 'Artist C', 300, null)];
}

function testIdenticalLists(): void {
  assertEqual(isSameAsPublicList(publicList(), publicList()), true, 'identical lists are the same');
  const withParserFields = publicList().map((row, i) => ({ ...row, id: `vsong-${i}`, sort_order: i }));
  assertEqual(isSameAsPublicList(withParserFields, publicList()), true, 'fields beyond the four compared are ignored');
}

function testStartOneSecondOff(): void {
  const submitted = publicList();
  submitted[1] = song('Second', 'Unknown', 201, 300);
  assertEqual(isSameAsPublicList(submitted, publicList()), false, 'a start one second off is a change');
}

function testEndDiffers(): void {
  const gainsAnEnd = publicList();
  gainsAnEnd[2] = song('Third', 'Artist C', 300, 350);
  assertEqual(isSameAsPublicList(gainsAnEnd, publicList()), false, 'an end where there was none is a change');

  const losesItsEnd = publicList();
  losesItsEnd[0] = song('First', 'Artist A', 100, null);
  assertEqual(isSameAsPublicList(losesItsEnd, publicList()), false, 'no end where there was one is a change');

  const movedEnd = publicList();
  movedEnd[0] = song('First', 'Artist A', 100, 201);
  assertEqual(isSameAsPublicList(movedEnd, publicList()), false, 'an end one second off is a change');
}

function testEmptyArtistMatchesUnknown(): void {
  const submitted = publicList();
  submitted[1] = song('Second', '', 200, 300);
  assertEqual(isSameAsPublicList(submitted, publicList()), true, 'a submitted artist of "" is the current "Unknown"');

  const blank = publicList();
  blank[1] = song('Second', '   ', 200, 300);
  assertEqual(isSameAsPublicList(blank, publicList()), true, 'a blank submitted artist is the current "Unknown"');

  const current = publicList();
  current[1] = song('Second', '', 200, 300);
  assertEqual(isSameAsPublicList(publicList(), current), true, 'an empty current artist counts as "Unknown" too');
}

function testTextIsTrimmedAndOtherwiseExact(): void {
  const padded = publicList();
  padded[0] = song('  First  ', '  Artist A ', 100, 200);
  assertEqual(isSameAsPublicList(padded, publicList()), true, 'surrounding whitespace is not a change');

  const retitled = publicList();
  retitled[0] = song('first', 'Artist A', 100, 200);
  assertEqual(isSameAsPublicList(retitled, publicList()), false, 'a different title is a change');

  const reartisted = publicList();
  reartisted[0] = song('First', 'Artist B', 100, 200);
  assertEqual(isSameAsPublicList(reartisted, publicList()), false, 'a different artist is a change');
}

function testShuffledOrder(): void {
  const list = publicList();
  const submitted = [list[2], list[0], list[1]];
  assertEqual(isSameAsPublicList(submitted, publicList()), true, 'order alone is not a change');
  assertEqual(submitted[0].song_title, 'Third', 'the inputs are not reordered');
}

function testEqualStartsInAnyOrder(): void {
  const current = [song('B', 'X', 100, 200), song('A', 'Y', 100, 200), song('C', 'Z', 100, null)];
  assertEqual(isSameAsPublicList([...current].reverse(), current), true, 'rows sharing a start may arrive in any order');

  const swappedArtists = [song('B', 'Y', 100, 200), song('A', 'X', 100, 200), song('C', 'Z', 100, null)];
  assertEqual(isSameAsPublicList(swappedArtists, current), false, 'rows sharing a start still differ when their text does');
}

function testExtraOrMissingRow(): void {
  assertEqual(isSameAsPublicList([...publicList(), song('Fourth', 'D', 400, null)], publicList()), false, 'an extra row is a change');
  assertEqual(isSameAsPublicList(publicList().slice(0, 2), publicList()), false, 'a missing row is a change');
  assertEqual(
    isSameAsPublicList([song('A', 'X', 100, 200), song('A', 'X', 100, 200)], [song('A', 'X', 100, 200), song('B', 'X', 100, 200)]),
    false,
    'a repeated row is not another row',
  );
}

const tests = [
  testLineFormat,
  testRoundTrip,
  testNullEnds,
  testMissingEndComesBack,
  testRestoreKeepsEditedEnds,
  testDerivedEndVectors,
  testYieldVectors,
  testStartOnlyPasteTakesTheArchivedEnds,
  testArchivedEndsGiveNoGuess,
  testArchivedEndYieldsOnlyToAMovedOrNewRow,
  testBlankArtistKeepsTheArchivedOne,
  testSpacedSlashTitleComesBack,
  testRestoreLeavesEditedAndAmbiguousRows,
  testTitleOnlyPasteComesBack,
  testTitleOnlyRestoreNeedsItsStartAndGivesNoGuess,
  testIdenticalLists,
  testStartOneSecondOff,
  testEndDiffers,
  testEmptyArtistMatchesUnknown,
  testTextIsTrimmedAndOtherwiseExact,
  testShuffledOrder,
  testEqualStartsInAnyOrder,
  testExtraOrMissingRow,
];

let failed = 0;
for (const test of tests) {
  try {
    test();
  } catch (error) {
    failed += 1;
    console.error(`✗ ${test.name}`);
    console.error(error);
  }
}
if (failed > 0) {
  console.error(`${failed} of ${tests.length} song-text tests failed`);
  process.exitCode = 1;
} else {
  console.log(`song-text.test: all passed (${tests.length} tests)`);
}
