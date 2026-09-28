import { strict as assert } from 'node:assert';
import type {
  CandidateComment,
  ExtractResponse,
  PasteImportParsedSong,
  Stream,
} from '../../shared/types';
import { parseTextToSongs } from '../../shared/parse';
import { checkParsedRows } from '../src/pages/pipeline-checks';
import {
  endsFollowingNext,
  extractReducer,
  initialExtractState,
  type EditableParsedSong,
} from '../src/pages/pipeline-extract-state';

const stream: Stream = {
  id: 'stream-1',
  streamerId: 'mizuki',
  title: 'Test stream',
  date: '2026-08-16',
  videoId: 'video-1',
  youtubeUrl: 'https://www.youtube.com/watch?v=video-1',
  credit: {},
  status: 'pending',
  submittedBy: null,
  reviewedBy: null,
  createdAt: '2026-08-16T00:00:00.000Z',
};

const candidate: CandidateComment = {
  commentId: 'comment-1',
  text: '0:10 Song - Artist',
  author: 'Timestamp Author',
  likes: 3,
  timestampCount: 1,
  isPinned: false,
};

const parsedSong: PasteImportParsedSong = {
  orderIndex: 0,
  songName: 'Song',
  artist: 'Artist',
  startSeconds: 10,
  endSeconds: null,
  startTimestamp: '0:10',
  endTimestamp: null,
};

const editableSong: EditableParsedSong = {
  ...parsedSong,
  clientId: 'song-1',
  endFollowsNext: false,
};

const extractResult: ExtractResponse = {
  source: 'description',
  candidateComment: null,
  allCandidates: [candidate],
  parsedSongs: [parsedSong],
  credit: null,
};

let state = extractReducer(initialExtractState, {
  type: 'streamsLoaded',
  streams: [stream],
});
assert.equal(state.selectedStreamId, stream.id, 'the first pending stream is selected');
assert.deepEqual(state.streams, [stream], 'loaded streams are retained');

state = extractReducer(state, { type: 'streamsLoadingFinished' });
assert.equal(state.loadingStreams, false, 'the stream loading indicator stops');

state = extractReducer(
  {
    ...state,
    error: 'stale error',
    extractResult,
    editedSongs: [editableSong],
  },
  { type: 'extractStarted', stream },
);
assert.equal(state.selectedStreamId, stream.id, 'starting extraction selects its stream');
assert.equal(state.extractedStream, stream, 'and keeps the stream itself, as the list showed it');
assert.equal(state.loading, true, 'extraction enters its loading state');
assert.equal(state.error, null, 'starting extraction clears the previous error');
assert.equal(state.extractResult, null, 'starting extraction clears the previous result');
assert.deepEqual(state.editedSongs, [], 'starting extraction clears stale song edits');

state = extractReducer(state, {
  type: 'extractSucceeded',
  result: extractResult,
  editedSongs: [editableSong],
});
assert.equal(state.loading, false, 'successful extraction stops loading');
assert.equal(state.extractResult, extractResult, 'successful extraction stores the response');
assert.deepEqual(state.editedSongs, [editableSong], 'successful extraction stores identified songs');

const candidateSong = { ...parsedSong, songName: 'Candidate Song' };
const identifiedCandidateSong = { ...candidateSong, clientId: 'song-2', endFollowsNext: false };
state = extractReducer(state, {
  type: 'candidateSelected',
  candidateId: candidate.commentId,
  parsedSongs: [candidateSong],
  editedSongs: [identifiedCandidateSong],
});
assert.equal(state.extractResult?.source, 'comment', 'selecting a candidate updates the source');
assert.equal(
  state.extractResult?.candidateComment?.commentId,
  candidate.commentId,
  'selecting a candidate stores the active comment',
);
assert.deepEqual(
  state.editedSongs,
  [identifiedCandidateSong],
  'selecting a candidate replaces the editable songs atomically',
);

state = extractReducer(state, {
  type: 'songUpdated',
  index: 0,
  field: 'artist',
  value: 'Updated Artist',
});
assert.equal(state.editedSongs[0]?.artist, 'Updated Artist', 'song edits update the requested field');

state = extractReducer(state, { type: 'importStarted' });
assert.equal(state.importing, true, 'import enters its loading state');
assert.equal(state.error, null, 'starting import clears the previous error');

state = extractReducer(state, { type: 'importSucceeded' });
assert.equal(state.extractResult, null, 'successful import clears the extraction result');
assert.deepEqual(state.editedSongs, [], 'successful import clears imported songs');
assert.equal(state.importing, true, 'a successful import is still importing until it finishes');

state = extractReducer(state, { type: 'importFinished' });
assert.equal(state.importing, false, 'import completion stops loading');

state = extractReducer(
  { ...state, loading: true },
  { type: 'extractFailed', error: 'Extraction failed' },
);
assert.equal(state.loading, false, 'failed extraction stops loading');
assert.equal(state.error, 'Extraction failed', 'failed extraction records the error');

console.log('✓ Pipeline extract state transitions remain atomic');

// --- The ready-to-extract list: a failed load, and the retry that follows it ---

assert.equal(initialExtractState.streamsError, null, 'the ready list starts without a load error');
assert.equal(initialExtractState.loadingStreams, true, 'the ready list starts loading, so the page dispatches nothing before its first response');

let listState = extractReducer(
  { ...initialExtractState, error: 'Extraction failed' },
  { type: 'streamsFailed', error: 'Streams are unavailable' },
);
assert.equal(listState.loadingStreams, false, 'a failed load stops the loading indicator');
assert.equal(listState.streamsError, 'Streams are unavailable', 'a failed load records its error');
assert.deepEqual(listState.streams, [], 'a failed load lists no streams');
assert.equal(listState.error, 'Extraction failed', 'a failed list load leaves the extract error alone');

listState = extractReducer(listState, { type: 'streamsRequested' });
assert.equal(listState.loadingStreams, true, 'a retry shows the loading indicator again');
assert.equal(listState.streamsError, null, 'a retry clears the previous load error');
assert.equal(listState.error, 'Extraction failed', 'a retry leaves the extract error alone');

listState = extractReducer(listState, { type: 'streamsLoaded', streams: [stream] });
listState = extractReducer(listState, { type: 'streamsLoadingFinished' });
assert.deepEqual(listState.streams, [stream], 'a retry that succeeds lists the streams');
assert.equal(listState.loadingStreams, false, 'a retry that succeeds stops the loading indicator');
assert.equal(listState.streamsError, null, 'a retry that succeeds shows no load error');

// The reload after a Discover import dispatches no `streamsRequested`: a list that loads clears the
// failure before it all the same.
listState = extractReducer(listState, { type: 'streamsFailed', error: 'Streams are unavailable' });
listState = extractReducer(listState, { type: 'streamsLoaded', streams: [stream] });
assert.equal(listState.streamsError, null, 'a list that loads clears an earlier failure, with no retry in between');

console.log('✓ Pipeline ready list: a failed load records its error and a retry clears it');

// --- A reload keeps the stream the curator is on: an extract in progress imports to it ---

const streamTwo: Stream = { ...stream, id: 'stream-2', videoId: 'video-2', title: 'Second stream' };
const streamThree: Stream = { ...stream, id: 'stream-3', videoId: 'video-3', title: 'Third stream' };

let reloadState = extractReducer(initialExtractState, { type: 'streamsLoaded', streams: [stream, streamTwo] });
reloadState = extractReducer(reloadState, { type: 'streamsLoadingFinished' });
reloadState = extractReducer(reloadState, { type: 'extractStarted', stream: streamTwo });
reloadState = extractReducer(reloadState, {
  type: 'extractSucceeded',
  result: extractResult,
  editedSongs: [editableSong],
});

// A Discover import adds a stream to the list, which then reloads.
reloadState = extractReducer(reloadState, { type: 'streamsLoaded', streams: [streamThree, stream, streamTwo] });
assert.deepEqual(reloadState.streams, [streamThree, stream, streamTwo], 'a reload lists the new streams');
assert.equal(reloadState.selectedStreamId, streamTwo.id, 'a reload keeps the selected stream while it is still listed');
assert.equal(reloadState.extractResult, extractResult, 'a reload leaves the extract in progress alone');
assert.deepEqual(reloadState.editedSongs, [editableSong], 'a reload leaves the edited songs alone');

reloadState = extractReducer(reloadState, { type: 'streamsLoaded', streams: [streamThree] });
assert.equal(
  reloadState.selectedStreamId,
  streamTwo.id,
  'a reload keeps the selection even once its stream has left the list: the songs being edited still belong to it',
);
assert.equal(
  reloadState.extractedStream,
  streamTwo,
  'and keeps the stream itself, which the sources header and the comment credit read, not the list',
);
assert.equal(initialExtractState.extractedStream, null, 'no stream is being extracted before the first pick');

assert.equal(
  extractReducer(initialExtractState, { type: 'streamsLoaded', streams: [] }).selectedStreamId,
  '',
  'a first load with no streams selects none',
);

console.log('✓ Pipeline ready list: a reload keeps the selected stream, so an extract in progress imports where it came from');

// --- The Check column: the first issue of each parsed row, or null when it looks right ---

/** A parsed row as the checks read it: no end unless one is given. */
function checkRow(startSeconds: number, songName: string, artist: string, endSeconds: number | null = null) {
  return { startSeconds, endSeconds, songName, artist };
}

/**
 * `expected` is each row's Check text; `fields`, the field each issue is about; `blocking`, whether
 * the issue blocks the import (null where the row is OK).
 */
const checkCases: {
  name: string;
  rows: ReturnType<typeof checkRow>[];
  expected: (string | null)[];
  fields: ('start' | 'title' | 'artist' | null)[];
  blocking: (boolean | null)[];
}[] = [
  {
    name: 'rows in order, each with a title and an artist, are OK',
    rows: [checkRow(10, 'Opening', 'Alice'), checkRow(250, 'Lemon', '米津玄師'), checkRow(480, 'Idol', 'YOASOBI')],
    expected: [null, null, null],
    fields: [null, null, null],
    blocking: [null, null, null],
  },
  { name: 'no rows, no checks', rows: [], expected: [], fields: [], blocking: [] },
  {
    name: 'a title that is blank once trimmed',
    rows: [checkRow(10, '  \t ', 'Alice')],
    expected: ['No title'],
    fields: ['title'],
    blocking: [true],
  },
  // U+3000, the ideographic space a zh-TW or ja keyboard types, counts as blank too.
  {
    name: 'an artist that is blank once trimmed',
    rows: [checkRow(10, 'Lemon', '\u3000 ')],
    expected: ['No artist'],
    fields: ['artist'],
    blocking: [false],
  },
  {
    name: 'a start before the previous row’s names that row',
    rows: [checkRow(250, 'Lemon', '米津玄師'), checkRow(3, 'Opening', 'Alice')],
    expected: [null, 'Earlier than #1'],
    fields: [null, 'start'],
    blocking: [null, false],
  },
  {
    name: 'a start equal to the previous row’s names that row',
    rows: [checkRow(250, 'Lemon', '米津玄師'), checkRow(250, 'Idol', 'YOASOBI')],
    expected: [null, 'Same start as #1'],
    fields: [null, 'start'],
    blocking: [null, false],
  },
  {
    name: 'the order check compares with the previous row only, and numbers rows from 1',
    rows: [checkRow(10, 'A', 'a'), checkRow(300, 'B', 'b'), checkRow(200, 'C', 'c'), checkRow(250, 'D', 'd')],
    expected: [null, null, 'Earlier than #2', null],
    fields: [null, null, 'start', null],
    blocking: [null, null, false, null],
  },
  {
    name: 'the same title and artist as an earlier row, whatever the case and spacing',
    rows: [
      checkRow(10, 'Blue Bird', 'Ikimono Gakari'),
      checkRow(250, '  blue   BIRD ', 'ikimono  gakari'),
      checkRow(480, 'Blue Bird', 'Someone Else'),
    ],
    expected: [null, 'Same as #1', null],
    fields: [null, 'title', null],
    blocking: [null, false, null],
  },
  {
    name: 'a repeat names the first row it repeats',
    rows: [
      checkRow(10, 'Lemon', '米津玄師'),
      checkRow(100, 'Idol', 'YOASOBI'),
      checkRow(200, 'Lemon', '米津玄師'),
      checkRow(300, 'lemon', '米津玄師'),
    ],
    expected: [null, null, 'Same as #1', 'Same as #1'],
    fields: [null, null, 'title', 'title'],
    blocking: [null, null, false, false],
  },
  {
    name: 'the first issue wins: a blank title with an earlier start is No title',
    rows: [checkRow(250, 'Lemon', '米津玄師'), checkRow(10, '', 'Alice')],
    expected: [null, 'No title'],
    fields: [null, 'title'],
    blocking: [null, true],
  },
  {
    name: 'the first issue wins: a blank artist with an earlier start is No artist',
    rows: [checkRow(250, 'Lemon', '米津玄師'), checkRow(10, 'Opening', '')],
    expected: [null, 'No artist'],
    fields: [null, 'artist'],
    blocking: [null, false],
  },
  {
    name: 'the first issue wins: a repeat with an equal start is Same start',
    rows: [checkRow(10, 'Lemon', '米津玄師'), checkRow(10, 'LEMON', '米津玄師')],
    expected: [null, 'Same start as #1'],
    fields: [null, 'start'],
    blocking: [null, false],
  },
  {
    name: 'an end after the start is fine',
    rows: [checkRow(10, 'Opening', 'Alice', 250), checkRow(250, 'Lemon', '米津玄師', 480)],
    expected: [null, null],
    fields: [null, null],
    blocking: [null, null],
  },
  {
    // The End column is read-only: the start is the field to fix.
    name: 'an end before the start blocks the import',
    rows: [checkRow(250, 'Lemon', '米津玄師', 10)],
    expected: ['Ends before it starts'],
    fields: ['start'],
    blocking: [true],
  },
  {
    name: 'an end equal to the start blocks it too: the worker wants the end after the start',
    rows: [checkRow(250, 'Lemon', '米津玄師', 250)],
    expected: ['Ends before it starts'],
    fields: ['start'],
    blocking: [true],
  },
  {
    name: 'what blocks comes before what asks for a look: a blank artist on a row that ends before it starts',
    rows: [checkRow(250, 'Lemon', '', 10)],
    expected: ['Ends before it starts'],
    fields: ['start'],
    blocking: [true],
  },
  {
    name: 'No title comes first of all, even before an end before the start',
    rows: [checkRow(250, ' ', 'Alice', 10)],
    expected: ['No title'],
    fields: ['title'],
    blocking: [true],
  },
  {
    // The parse ends each row where the next one starts: a list that jumps back leaves the row
    // before the jump ending before it starts.
    name: 'a list that jumps back: the row before the jump ends before it starts, the next starts earlier',
    rows: [checkRow(250, 'Lemon', '米津玄師', 10), checkRow(10, 'Opening', 'Alice')],
    expected: ['Ends before it starts', 'Earlier than #1'],
    fields: ['start', 'start'],
    blocking: [true, false],
  },
];

for (const { name, rows, expected, fields, blocking } of checkCases) {
  const issues = checkParsedRows(rows);
  assert.deepEqual(issues.map((issue) => issue?.text ?? null), expected, name);
  assert.deepEqual(issues.map((issue) => issue?.field ?? null), fields, `${name}: the field each issue is about`);
  assert.deepEqual(issues.map((issue) => issue?.blocking ?? null), blocking, `${name}: whether each issue blocks the import`);
}

console.log('✓ checkParsedRows: no title and an end before the start block the import; no artist, an out-of-order or equal start and a repeat ask for a look — the first issue per row, and the field it is about');

// --- Which ends the parse took from the next start: read from a comment's text, guessed for the
// description ---
//
// The parse ends a row that has no end of its own where the next row starts. A comment's rows come
// with its text, whose lines say which gave an end; the description's come without it.

/** A parsed row with just its start and end set, and whether that end follows the next start. */
function timedRow(clientId: string, startSeconds: number, endSeconds: number | null, endFollowsNext = false): EditableParsedSong {
  return { ...parsedSong, clientId, songName: clientId, startSeconds, endSeconds, endFollowsNext };
}

/** Each row as `start–end`. */
function spans(rows: readonly EditableParsedSong[]): string {
  return rows.map((row) => `${row.startSeconds}–${row.endSeconds ?? '—'}`).join(' ');
}

/** The rows a comment's `text` parses into, each marked whether its end follows the next start, as the step makes them. */
function rowsOf(text: string): EditableParsedSong[] {
  const songs = parseTextToSongs(text);
  const follows = endsFollowingNext(songs, text);
  return songs.map((song, index) => ({ ...song, clientId: `row-${index}`, endFollowsNext: follows[index] === true }));
}

/** Rows with no text behind them, as the description's reach the page: marked by the guess. */
function guessedRows(rows: EditableParsedSong[]): EditableParsedSong[] {
  const follows = endsFollowingNext(rows, null);
  return rows.map((row, index) => ({ ...row, endFollowsNext: follows[index] === true }));
}

const followsOf = (text: string) => endsFollowingNext(parseTextToSongs(text), text);
// Copilot's example: the first line gives an end of its own, which happens to be the next start.
const OWN_END_TEXT = '0:00 - 3:00 Opening / Alice\n3:00 Lemon / 米津玄師';
assert.deepEqual(followsOf(OWN_END_TEXT), [false, false], 'an end a line gives is its own, even one equal to the next start');
assert.deepEqual(
  followsOf('0:00 Opening / Alice\n3:00 Lemon / 米津玄師\n6:00 Encore / Bob'),
  [true, true, false],
  'a line that gives no end ends where the next row starts; the last row has none to follow',
);
assert.deepEqual(
  followsOf('Setlist\n\n0:00 - 3:00 Opening / Alice\n3:00 Lemon / 米津玄師\n~ break ~\n6:00 ~ 9:00 Idol / YOASOBI\n9:30 Encore / Bob'),
  [false, true, false, false],
  'the rows are the lines that parse, in order: a heading, a blank line and a note between songs are no rows',
);
assert.deepEqual(
  endsFollowingNext([timedRow('a', 0, 180), timedRow('b', 180, 360), timedRow('c', 400, 500), timedRow('d', 500, null)], null),
  [true, false, true, false],
  'without a text (the description), an end equal to the next start is taken for the one the parse gave: a best guess',
);
assert.deepEqual(
  endsFollowingNext([timedRow('a', 0, 180), timedRow('b', 180, null)], '0:00 - 3:00 Opening / Alice'),
  [true, false],
  'a text that parses into other rows than these (one song for two rows) is no guide: the guess instead',
);

console.log('✓ endsFollowingNext: a comment says which ends are its own; the description is guessed by equal starts');

// --- A start edit carries the end the row before took from it, and only that end ---

const linked = extractReducer(
  {
    ...initialExtractState,
    editedSongs: [timedRow('a', 10, 250, true), timedRow('b', 250, 480, true), timedRow('c', 480, null)],
  },
  { type: 'songUpdated', index: 1, field: 'startSeconds', value: 260 },
);
assert.equal(spans(linked.editedSongs), '10–260 260–480 480–—', 'a start edit moves the end the row before took from it, and nothing else');
assert.equal(linked.editedSongs[0]?.endFollowsNext, true, 'and that end still follows the start it moved with');

const ownEnd = extractReducer(
  { ...initialExtractState, editedSongs: [timedRow('a', 10, 200), timedRow('b', 250, 480)] },
  { type: 'songUpdated', index: 1, field: 'startSeconds', value: 260 },
);
assert.equal(spans(ownEnd.editedSongs), '10–200 260–480', 'an end of its own, not the old start, stays put');

const firstRow = extractReducer(
  { ...initialExtractState, editedSongs: [timedRow('a', 10, 250, true), timedRow('b', 250, 480)] },
  { type: 'songUpdated', index: 0, field: 'startSeconds', value: 20 },
);
assert.equal(spans(firstRow.editedSongs), '20–250 250–480', 'the first row has no row before it: only its start moves');

const renamed = extractReducer(
  { ...initialExtractState, editedSongs: [timedRow('a', 10, 250, true), timedRow('b', 250, 480)] },
  { type: 'songUpdated', index: 1, field: 'songName', value: '250' },
);
assert.equal(spans(renamed.editedSongs), '10–250 250–480', 'an edit to another field moves no end');
assert.equal(renamed.editedSongs[1]?.songName, '250', 'and edits that field');

// Copilot's example: `0:00 - 3:00 Opening` then `3:00 Lemon`. Opening's end equals Lemon's start, but
// the comment gave it: moving Lemon's start leaves it at 3:00.
const commentersOwn = extractReducer(
  { ...initialExtractState, editedSongs: rowsOf(OWN_END_TEXT) },
  { type: 'songUpdated', index: 1, field: 'startSeconds', value: 190 },
);
assert.equal(spans(commentersOwn.editedSongs), '0–180 190–—', "an end of the comment's own stays put, even one equal to the old start");

// The same list without the range: the parse took Opening's end from Lemon's start, so it follows.
let parsersEnd = extractReducer(
  { ...initialExtractState, editedSongs: rowsOf('0:00 Opening / Alice\n3:00 Lemon / 米津玄師') },
  { type: 'songUpdated', index: 1, field: 'startSeconds', value: 190 },
);
assert.equal(spans(parsersEnd.editedSongs), '0–190 190–—', 'an end the parse took from the next start follows it');
parsersEnd = extractReducer(parsersEnd, { type: 'songUpdated', index: 1, field: 'startSeconds', value: 200 });
assert.equal(spans(parsersEnd.editedSongs), '0–200 200–—', 'edit after edit');

// The description's rows are marked by the guess when they come: an end that an edit later makes
// equal to the next start is still its own.
let described = extractReducer(
  { ...initialExtractState, editedSongs: guessedRows([timedRow('a', 0, 200), timedRow('b', 250, 400), timedRow('c', 400, null)]) },
  { type: 'songUpdated', index: 1, field: 'startSeconds', value: 200 },
);
assert.equal(spans(described.editedSongs), '0–200 200–400 400–—', "a description end unlike the next start is its own: it stays");
described = extractReducer(described, { type: 'songUpdated', index: 1, field: 'startSeconds', value: 210 });
assert.equal(spans(described.editedSongs), '0–200 210–400 400–—', 'and stays once the start it now equals moves again');
described = extractReducer(described, { type: 'songUpdated', index: 2, field: 'startSeconds', value: 420 });
assert.equal(spans(described.editedSongs), '0–200 210–420 420–—', 'a description end equal to the next start follows it');

// Removing a row: the row before it ended where the removed one started, so that end is its own now.
const three = '0:00 Opening / Alice\n3:00 Lemon / 米津玄師\n6:00 Encore / Bob';
let removedMiddle = extractReducer({ ...initialExtractState, editedSongs: rowsOf(three) }, { type: 'songRemoved', index: 1 });
assert.equal(spans(removedMiddle.editedSongs), '0–180 360–—', 'a removal moves no end');
assert.deepEqual(
  removedMiddle.editedSongs.map((row) => row.endFollowsNext),
  [false, false],
  'the row before the removed one no longer follows the next start',
);
removedMiddle = extractReducer(removedMiddle, { type: 'songUpdated', index: 1, field: 'startSeconds', value: 400 });
assert.equal(spans(removedMiddle.editedSongs), '0–180 400–—', 'so the start now after it moves no end');
const removedFirst = extractReducer({ ...initialExtractState, editedSongs: rowsOf(three) }, { type: 'songRemoved', index: 0 });
assert.deepEqual(
  removedFirst.editedSongs.map((row) => row.endFollowsNext),
  [true, false],
  'removing the first row leaves the others as they were',
);

// A comment with a typo in its second start (0:25 for 4:25): the parse ends row 1 there, before it
// starts, which blocks the import. End is read-only here, so fixing row 2's start has to carry it.
const typoRows = rowsOf('4:10 Lemon / 米津玄師\n0:25 Idol / YOASOBI\n8:00 Encore / Bob');
const checkTextsOf = (rows: readonly EditableParsedSong[]) => checkParsedRows(rows).map((issue) => issue?.text ?? null);
assert.deepEqual(
  checkTextsOf(typoRows),
  ['Ends before it starts', 'Earlier than #1', null],
  'the typo leaves row 1 ending before it starts, and row 2 starting before it',
);
const typoFixed = extractReducer(
  { ...initialExtractState, editedSongs: typoRows },
  { type: 'songUpdated', index: 1, field: 'startSeconds', value: 265 },
);
assert.equal(spans(typoFixed.editedSongs), '250–265 265–480 480–—', "fixing row 2's start moves row 1's end with it");
assert.deepEqual(checkTextsOf(typoFixed.editedSongs), [null, null, null], 'and nothing is blocked or flagged any more');

console.log('✓ Pipeline extract state: a start edit carries the end the row before took from it; an end of its own stays put');

// --- Whether the curator has changed the parsed rows since they were produced: another stream,
// Re-scan and another comment replace the rows, and ask first only while they are changed ---

assert.equal(initialExtractState.songsChanged, false, 'nothing is changed before the first extract');

let produced = extractReducer(initialExtractState, { type: 'streamsLoaded', streams: [stream, streamTwo] });
produced = extractReducer(produced, { type: 'extractStarted', stream });
produced = extractReducer(produced, { type: 'extractSucceeded', result: extractResult, editedSongs: [editableSong] });
assert.equal(produced.songsChanged, false, 'the rows an extract produced are not changed');

const editedField = (field: 'startSeconds' | 'songName' | 'artist', value: string | number) =>
  extractReducer(produced, { type: 'songUpdated', index: 0, field, value });
assert.equal(editedField('songName', 'Song (TV size)').songsChanged, true, 'a title edit changes the rows');
assert.equal(editedField('artist', 'Someone Else').songsChanged, true, 'so does an artist edit');
assert.equal(editedField('startSeconds', 20).songsChanged, true, 'and a committed start');
assert.equal(
  extractReducer(produced, { type: 'songRemoved', index: 0 }).songsChanged,
  true,
  'and a removed row',
);

const changed = editedField('songName', 'Song (TV size)');
assert.equal(
  extractReducer(changed, { type: 'streamsLoaded', streams: [streamTwo] }).songsChanged,
  true,
  'a reload of the ready list leaves the changes alone',
);
let importFailed = extractReducer(changed, { type: 'importStarted' });
importFailed = extractReducer(importFailed, { type: 'importFinished' });
assert.equal(importFailed.songsChanged, true, 'an import that fails keeps the rows, changes and all');

assert.equal(
  extractReducer({ ...changed, loading: true }, { type: 'extractSucceeded', result: extractResult, editedSongs: [editableSong] })
    .songsChanged,
  false,
  'a new result replaces the rows: nothing is changed',
);
assert.equal(
  extractReducer(changed, {
    type: 'candidateSelected',
    candidateId: candidate.commentId,
    parsedSongs: [parsedSong],
    editedSongs: [editableSong],
  }).songsChanged,
  false,
  'so does a newly chosen comment',
);
let importLanded = extractReducer(changed, { type: 'importStarted' });
importLanded = extractReducer(importLanded, { type: 'importSucceeded' });
assert.equal(importLanded.songsChanged, false, 'a successful import clears the rows, and the changes with them');

// The question comes before an extract starts. Once one has, the rows are gone: an extract that
// then fails leaves nothing changed to ask about.
let replaced = extractReducer(changed, { type: 'extractStarted', stream: streamTwo });
assert.equal(replaced.songsChanged, false, 'an extract that starts drops the rows, and the changes with them');
replaced = extractReducer(replaced, { type: 'extractFailed', error: 'Extraction failed' });
assert.equal(replaced.songsChanged, false, 'and one that fails leaves nothing changed');

console.log('✓ Pipeline extract state: an edit or a removal marks the rows changed; a new result, a new comment, a new extract and a successful import clear it');

// --- How many Start drafts are pending — typed but not yet committed or cancelled. The card counts
// them itself and reports the count; the reducer only keeps it, and resets it wherever songsChanged
// is reset, since a pending draft belongs to the rows on screen just as an edit does ---

assert.equal(initialExtractState.pendingStartDrafts, 0, 'nothing is pending before the first extract');

const withDraft = extractReducer(produced, { type: 'startDraftsChanged', count: 1 });
assert.equal(withDraft.pendingStartDrafts, 1, 'the card reports a pending draft');
assert.equal(
  extractReducer(withDraft, { type: 'startDraftsChanged', count: 0 }).pendingStartDrafts,
  0,
  'and reports it committed or cancelled',
);

assert.equal(
  extractReducer(withDraft, { type: 'extractSucceeded', result: extractResult, editedSongs: [editableSong] })
    .pendingStartDrafts,
  0,
  'a new result clears a pending draft along with the rows it was on',
);
assert.equal(
  extractReducer(withDraft, {
    type: 'candidateSelected',
    candidateId: candidate.commentId,
    parsedSongs: [parsedSong],
    editedSongs: [editableSong],
  }).pendingStartDrafts,
  0,
  'so does a newly chosen comment',
);
let draftedImport = extractReducer(withDraft, { type: 'importStarted' });
draftedImport = extractReducer(draftedImport, { type: 'importSucceeded' });
assert.equal(draftedImport.pendingStartDrafts, 0, 'and a successful import');
assert.equal(
  extractReducer(withDraft, { type: 'extractStarted', stream: streamTwo }).pendingStartDrafts,
  0,
  'and an extract that starts, which drops the rows a draft was on',
);

console.log('✓ Pipeline extract state: a pending Start draft is reset wherever songsChanged is');
