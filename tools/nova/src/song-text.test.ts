// The paste text must read back exactly through lib/parse.ts (Aurora's parser, which Nova's
// inline form parser mirrors), except a title with a spaced slash and a middle row's missing end,
// which restoreArchivedIdentities and restoreArchivedEnds put back. The identical check must
// ignore row order, surrounding whitespace and an empty artist (= Unknown), and nothing else.
import { parseTextToSongs } from '../../../lib/parse';
import { formatSongsForPaste, isSameAsPublicList, restoreArchivedEnds, restoreArchivedIdentities } from './song-text';
import type { PublicStreamSong } from './types';

declare const process: { exitCode?: number };

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function song(title: string, artist: string, start: number, end: number | null): PublicStreamSong {
  return { song_title: title, original_artist: artist, start_timestamp: start, end_timestamp: end };
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
  const rows: PublicStreamSong[] = [];
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

  const ended = restoreArchivedEnds([
    { song_title: 'Second', original_artist: 'B', start_timestamp: 200, end_timestamp: 400 },
    { song_title: 'Third', original_artist: 'C', start_timestamp: 400, end_timestamp: null },
  ], current);
  assertEqual(ended[0].end_timestamp, 400, 'a row archived with an end keeps whatever end it is given');
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
    [{ song_title: 'A2', original_artist: 'B / Artist' }, { song_title: 'A', original_artist: 'B / Artist2' }],
    current,
  );
  assertEqual(edited[0].song_title, 'A2', "an edited title stays the contributor's");
  assertEqual(edited[1].original_artist, 'B / Artist2', "so does an edited artist");

  const twice = [song('A / B', 'Artist', 100, 200), song('A / B', 'Artist', 300, 400)];
  assertEqual(
    restoreArchivedIdentities([{ song_title: 'A', original_artist: 'B / Artist' }], twice)[0].song_title,
    'A / B',
    'one song sung twice is not ambiguous',
  );

  // `A / B` by `C` reads back as `A` by `B / C`, which is an archived song of its own here.
  const shadowed = [song('A / B', 'C', 100, 200), song('A', 'B / C', 300, 400)];
  assertEqual(
    restoreArchivedIdentities([{ song_title: 'A', original_artist: 'B / C' }], shadowed)[0].song_title,
    'A',
    'a reading that is itself an archived song stays as submitted',
  );

  // Both lines read `A / B / C / D`, so both songs read back as `A` by `B / C / D`.
  const twins = [song('A / B', 'C / D', 100, 200), song('A / B / C', 'D', 300, 400)];
  assertEqual(
    restoreArchivedIdentities([{ song_title: 'A', original_artist: 'B / C / D' }], twins)[0].song_title,
    'A',
    'a reading two archived songs share stays as submitted',
  );
}

function publicList(): PublicStreamSong[] {
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

try {
  testLineFormat();
  testRoundTrip();
  testNullEnds();
  testMissingEndComesBack();
  testRestoreKeepsEditedEnds();
  testSpacedSlashTitleComesBack();
  testRestoreLeavesEditedAndAmbiguousRows();
  testIdenticalLists();
  testStartOneSecondOff();
  testEndDiffers();
  testEmptyArtistMatchesUnknown();
  testTextIsTrimmedAndOtherwiseExact();
  testShuffledOrder();
  testEqualStartsInAnyOrder();
  testExtraOrMissingRow();
  console.log('song-text.test: all passed');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
