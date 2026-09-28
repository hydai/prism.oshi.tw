import { strict as assert } from 'node:assert';
import type {
  CandidateComment,
  ExtractResponse,
  PasteImportParsedSong,
  Stream,
} from '../../shared/types';
import {
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
    importStatus: 'stale import status',
  },
  { type: 'extractStarted', streamId: stream.id },
);
assert.equal(state.loading, true, 'extraction enters its loading state');
assert.equal(state.error, null, 'starting extraction clears the previous error');
assert.equal(state.extractResult, null, 'starting extraction clears the previous result');
assert.deepEqual(state.editedSongs, [], 'starting extraction clears stale song edits');
assert.equal(state.importStatus, null, 'starting extraction clears stale import status');

state = extractReducer(state, {
  type: 'extractSucceeded',
  result: extractResult,
  editedSongs: [editableSong],
});
assert.equal(state.loading, false, 'successful extraction stops loading');
assert.equal(state.extractResult, extractResult, 'successful extraction stores the response');
assert.deepEqual(state.editedSongs, [editableSong], 'successful extraction stores identified songs');

const candidateSong = { ...parsedSong, songName: 'Candidate Song' };
const identifiedCandidateSong = { ...candidateSong, clientId: 'song-2' };
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

state = extractReducer(state, { type: 'importSucceeded', status: 'Imported 1 song(s)' });
assert.equal(state.extractResult, null, 'successful import clears the extraction result');
assert.deepEqual(state.editedSongs, [], 'successful import clears imported songs');
assert.equal(state.importStatus, 'Imported 1 song(s)', 'successful import records its status');

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
reloadState = extractReducer(reloadState, { type: 'extractStarted', streamId: streamTwo.id });
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
  extractReducer(initialExtractState, { type: 'streamsLoaded', streams: [] }).selectedStreamId,
  '',
  'a first load with no streams selects none',
);

console.log('✓ Pipeline ready list: a reload keeps the selected stream, so an extract in progress imports where it came from');
