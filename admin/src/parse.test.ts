import {
  parseCreatePerformanceBody,
  parseCreateSongBody,
  parseCreateStreamBody,
  parseCrystalReplyBody,
  parseImportStreamsBody,
  parseNoteBody,
  parseNovaSubmissionUpdateBody,
  parseNovaVodUpdateBody,
  parseUpdateSongBody,
  parseUpdateSongDetailsBody,
  parseUpdateStreamBody,
  parseUpdateTimestampsBody,
  parseCreateStampPerformanceBody,
  parseStatusUpdateBody,
  parseExtractImportBody,
  parsePasteImportBody,
  parseHarmonizeApplyBody,
  parsePipelineExtractBody,
} from './parse';

declare const process: { exitCode?: number };

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertOk<T>(result: T | { error: string }, message: string): T {
  if (result !== null && typeof result === 'object' && 'error' in (result as object)) {
    throw new Error(`${message}: expected success, got error "${(result as { error: string }).error}"`);
  }
  return result as T;
}

function assertError(result: unknown, fieldHint: string, message: string): void {
  if (result === null || typeof result !== 'object' || !('error' in result)) {
    throw new Error(`${message}: expected an { error } result, got ${JSON.stringify(result)}`);
  }
  const { error } = result as { error: string };
  assert(
    error.toLowerCase().includes(fieldHint.toLowerCase()),
    `${message}: error "${error}" should name the field "${fieldHint}"`,
  );
}

// --- parseCreateSongBody — mirrors ui/src/pages/SubmitSong.tsx's handleSubmit ---

function testParseCreateSongBodyAcceptsWhatSubmitSongSends(): void {
  // SubmitSong.tsx always sends tags: string[] (possibly empty) and, when a
  // performance row is filled in, extra fields (songId, date, streamTitle,
  // videoId) that POST /api/songs itself ignores — the parser must too.
  const parsed = assertOk(parseCreateSongBody({
    title: 'My Song',
    originalArtist: 'Some Artist',
    tags: ['cover', 'utaite'],
    performances: [
      {
        songId: '',
        streamId: 'stream-1',
        date: '2026-01-01',
        streamTitle: 'ignored',
        videoId: 'ignored',
        timestamp: 42,
        endTimestamp: null,
        note: '',
      },
    ],
  }), 'happy path matching SubmitSong.tsx');
  assertEqual(parsed.title, 'My Song', 'title carried through');
  assertEqual(parsed.tags?.join(','), 'cover,utaite', 'tags carried through');
  assertEqual(parsed.performances?.length, 1, 'one inline performance');
  assertEqual(parsed.performances?.[0]?.streamId, 'stream-1', 'streamId kept');
  assertEqual(Object.keys(parsed.performances?.[0] ?? {}).includes('date'), false, 'unrecognized fields (date/streamTitle/videoId/songId) are dropped, not merely ignored');

  const minimal = assertOk(parseCreateSongBody({ title: 'T', originalArtist: 'A', tags: [] }), 'minimal body with no performances');
  assertEqual(minimal.performances, undefined, 'performances stays absent when the body omits it');
}

function testParseCreateSongBodyRejectsMalformedShapes(): void {
  assertError(parseCreateSongBody(null), 'object', 'null body');
  assertError(parseCreateSongBody({ originalArtist: 'A' }), 'title', 'missing title');
  assertError(parseCreateSongBody({ title: '   ', originalArtist: 'A' }), 'title', 'whitespace-only title');
  assertError(parseCreateSongBody({ title: 'T' }), 'originalArtist', 'missing originalArtist');
  assertError(parseCreateSongBody({ title: 'T', originalArtist: 'A', tags: 'pop' }), 'tags', 'tags as a bare string instead of string[] (the W7 tags gap)');
  assertError(parseCreateSongBody({ title: 'T', originalArtist: 'A', tags: ['ok', 5] }), 'tags', 'a non-string tag member');
  assertError(parseCreateSongBody({ title: 'T', originalArtist: 'A', performances: 'nope' }), 'performances', 'performances not an array');
  assertError(parseCreateSongBody({ title: 'T', originalArtist: 'A', performances: [{ timestamp: 1 }] }), 'streamId', 'a performance missing streamId');
  assertError(parseCreateSongBody({ title: 'T', originalArtist: 'A', performances: [{ streamId: 's', timestamp: '5' }] }), 'timestamp', 'a string timestamp (the W7 timestamp gap)');
  assertError(parseCreateSongBody({ title: 'T', originalArtist: 'A', performances: [{ streamId: 's', timestamp: -1 }] }), 'timestamp', 'a negative timestamp');
  assertError(parseCreateSongBody({ title: 'T', originalArtist: 'A', performances: [{ streamId: 's', timestamp: 1, endTimestamp: 'no' }] }), 'endTimestamp', 'a non-number, non-null endTimestamp');
  assertError(parseCreateSongBody({ title: 'T', originalArtist: 'A', performances: [{ streamId: 's', timestamp: 10, endTimestamp: 10 }] }), 'endTimestamp', 'an inline end equal to its start (zero-duration — same invariant as parseCreatePerformanceBody)');
  assertError(parseCreateSongBody({ title: 'T', originalArtist: 'A', performances: [{ streamId: 's', timestamp: 10, endTimestamp: 3 }] }), 'endTimestamp', 'an inline end before its start');
  assertError(parseCreateSongBody({ title: 'T', originalArtist: 'A', performances: [{ streamId: 's', timestamp: 1, note: 5 }] }), 'note', 'a non-string note');
}

// --- parseUpdateSongBody — mirrors ui/src/pages/SongDetail.tsx's editForm ---

function testParseUpdateSongBodyAcceptsWhatSongDetailSends(): void {
  const parsed = assertOk(parseUpdateSongBody({ title: 'New', originalArtist: 'Artist', tags: ['a', 'b'] }), 'SongDetail always sends all three fields');
  assertEqual(parsed.title, 'New', 'title carried through');
  assertEqual(parsed.tags?.join(','), 'a,b', 'tags carried through');

  const partial = assertOk(parseUpdateSongBody({ title: 'Only title' }), 'a partial body is still valid');
  assertEqual(partial.originalArtist, undefined, 'absent fields stay absent');
}

function testParseUpdateSongBodyRejectsMalformedShapes(): void {
  assertError(parseUpdateSongBody([]), 'object', 'an array body');
  assertError(parseUpdateSongBody({ title: 5 }), 'title', 'a numeric title');
  assertError(parseUpdateSongBody({ originalArtist: '' }), 'originalArtist', 'an empty originalArtist');
  assertError(parseUpdateSongBody({ tags: [1, 2] }), 'tags', 'tags with numeric members');
}

// --- parseCreatePerformanceBody — POST /api/performances (no current UI caller; validated per audit W7 spec) ---

function testParseCreatePerformanceBodyHappyPath(): void {
  const parsed = assertOk(parseCreatePerformanceBody({
    songId: 'song-1',
    streamId: 'stream-1',
    timestamp: 10,
    endTimestamp: 20,
    note: 'hi',
  }), 'all fields present and well-typed');
  assertEqual(parsed.endTimestamp, 20, 'endTimestamp carried through');

  const minimal = assertOk(parseCreatePerformanceBody({ songId: 's', streamId: 't', timestamp: 0 }), 'timestamp may be exactly 0');
  assertEqual(minimal.timestamp, 0, 'zero timestamp accepted');

  const nullEnd = assertOk(parseCreatePerformanceBody({ songId: 's', streamId: 't', timestamp: 5, endTimestamp: null }), 'endTimestamp may be null');
  assertEqual(nullEnd.endTimestamp, null, 'null endTimestamp carried through');
}

function testParseCreatePerformanceBodyRejectsMalformedShapes(): void {
  assertError(parseCreatePerformanceBody({ streamId: 's', timestamp: 1 }), 'songId', 'missing songId');
  assertError(parseCreatePerformanceBody({ songId: 's', timestamp: 1 }), 'streamId', 'missing streamId');
  assertError(parseCreatePerformanceBody({ songId: 's', streamId: 't', timestamp: '5' }), 'timestamp', 'a string timestamp');
  assertError(parseCreatePerformanceBody({ songId: 's', streamId: 't', timestamp: -1 }), 'timestamp', 'a negative timestamp');
  assertError(parseCreatePerformanceBody({ songId: 's', streamId: 't', timestamp: Number.NaN }), 'timestamp', 'NaN timestamp');
  assertError(parseCreatePerformanceBody({ songId: 's', streamId: 't', timestamp: 10, endTimestamp: 10 }), 'endTimestamp', 'endTimestamp equal to timestamp is not greater than it');
  assertError(parseCreatePerformanceBody({ songId: 's', streamId: 't', timestamp: 10, endTimestamp: 5 }), 'endTimestamp', 'endTimestamp before timestamp');
  assertError(parseCreatePerformanceBody({ songId: 's', streamId: 't', timestamp: 1, note: 5 }), 'note', 'a non-string note');
}

// --- parseUpdateTimestampsBody — mirrors StampEditor.tsx's updatePerformanceTimestamps calls ---

function testParseUpdateTimestampsBodyAcceptsWhatStampEditorSends(): void {
  assertEqual(assertOk(parseUpdateTimestampsBody({ endTimestamp: 42 }), 'endTimestamp-only').endTimestamp, 42, 'endTimestamp-only body accepted');
  assertEqual(assertOk(parseUpdateTimestampsBody({ timestamp: 10 }), 'timestamp-only').timestamp, 10, 'timestamp-only body accepted');
  assertEqual(assertOk(parseUpdateTimestampsBody({ endTimestamp: null }), 'clearing endTimestamp').endTimestamp, null, 'null endTimestamp (clearing) accepted');
}

function testParseUpdateTimestampsBodyRejectsMalformedShapes(): void {
  assertError(parseUpdateTimestampsBody({}), 'at least one', 'an empty body (no timestamp or endTimestamp)');
  assertError(parseUpdateTimestampsBody({ timestamp: -1 }), 'timestamp', 'a negative timestamp');
  assertError(parseUpdateTimestampsBody({ timestamp: '5' }), 'timestamp', 'a string timestamp');
  assertError(parseUpdateTimestampsBody({ endTimestamp: 'soon' }), 'endTimestamp', 'a non-number, non-null endTimestamp');
  assertError(parseUpdateTimestampsBody({ timestamp: 20, endTimestamp: 10 }), 'endTimestamp', 'an inverted pair (end before start) supplied together');
  assertError(parseUpdateTimestampsBody({ timestamp: 20, endTimestamp: 20 }), 'endTimestamp', 'a zero-duration pair supplied together');
  assertOk(parseUpdateTimestampsBody({ timestamp: 20, endTimestamp: null }), 'clearing endTimestamp while moving timestamp stays valid');
}

// --- parseCreateStampPerformanceBody — mirrors the stamp editor's AddSongModal submit ---

function testParseCreateStampPerformanceBodyAcceptsWhatStampEditorSends(): void {
  const parsed = assertOk(
    parseCreateStampPerformanceBody({ title: 'Song', originalArtist: 'Artist', timestamp: 120 }),
    'the add-song modal sends title/artist/timestamp',
  );
  assertEqual(parsed.endTimestamp, null, 'absent endTimestamp defaults to null (old ?? null behavior)');
  assertEqual(parsed.note, '', 'absent note defaults to the empty string (old ?? "" behavior)');
  assertEqual(
    assertOk(parseCreateStampPerformanceBody({ title: 'S', originalArtist: 'A', timestamp: 10, endTimestamp: 99, note: 'n' }), 'full body').endTimestamp,
    99,
    'explicit endTimestamp carried through',
  );
}

function testParseCreateStampPerformanceBodyRejectsMalformedShapes(): void {
  assertError(parseCreateStampPerformanceBody({ originalArtist: 'A', timestamp: 1 }), 'title', 'missing title');
  assertError(parseCreateStampPerformanceBody({ title: 'T', timestamp: 1 }), 'originalArtist', 'missing originalArtist');
  assertError(parseCreateStampPerformanceBody({ title: 'T', originalArtist: 'A' }), 'timestamp', 'missing timestamp');
  assertError(parseCreateStampPerformanceBody({ title: 'T', originalArtist: 'A', timestamp: 'not-a-number' }), 'timestamp', 'a truthy string timestamp (previously reached SQLite as text)');
  assertError(parseCreateStampPerformanceBody({ title: 'T', originalArtist: 'A', timestamp: 10, endTimestamp: 5 }), 'endTimestamp', 'an end at or before the start');
  assertError(parseCreateStampPerformanceBody({ title: 'T', originalArtist: 'A', timestamp: 10, note: 7 }), 'note', 'a non-string note');
}

// --- parseUpdateSongDetailsBody — mirrors StampEditor.tsx's handleInlineEditSave ---

function testParseUpdateSongDetailsBodyAcceptsWhatStampEditorSends(): void {
  assertEqual(assertOk(parseUpdateSongDetailsBody({ title: 'New Title' }), 'title-only').title, 'New Title', 'title-only body accepted');
  assertEqual(assertOk(parseUpdateSongDetailsBody({ originalArtist: 'New Artist' }), 'originalArtist-only').originalArtist, 'New Artist', 'originalArtist-only body accepted');
  assertOk(parseUpdateSongDetailsBody({}), 'an empty body is a valid no-op (matches updatePerformanceSongDetails, which still finds the row)');
}

function testParseUpdateSongDetailsBodyRejectsMalformedShapes(): void {
  assertError(parseUpdateSongDetailsBody({ title: 5 }), 'title', 'a numeric title');
  assertError(parseUpdateSongDetailsBody({ originalArtist: '' }), 'originalArtist', 'an empty originalArtist');
}

// --- parseNoteBody — mirrors updatePerformanceNote(id, note) ---

function testParseNoteBodyAcceptsWhatTheUiSends(): void {
  assertEqual(assertOk(parseNoteBody({ note: 'hello' }), 'a normal note').note, 'hello', 'note carried through');
  assertEqual(assertOk(parseNoteBody({ note: '' }), 'an empty string clears the note, and must stay legal').note, '', 'empty-string note accepted (clearing is a valid, common action)');
}

function testParseNoteBodyRejectsMalformedShapes(): void {
  assertError(parseNoteBody({}), 'note', 'a missing note');
  assertError(parseNoteBody({ note: 5 }), 'note', 'a numeric note');
  assertError(parseNoteBody({ note: null }), 'note', 'a null note');
}

// --- parseCreateStreamBody — mirrors ui/src/pages/SubmitStream.tsx ---

function testParseCreateStreamBodyAcceptsWhatSubmitStreamSends(): void {
  const parsed = assertOk(parseCreateStreamBody({
    title: 'Karaoke Night',
    date: '2026-01-01',
    videoId: 'abc123',
    youtubeUrl: 'https://www.youtube.com/watch?v=abc123',
  }), 'SubmitStream.tsx never sends credit');
  assertEqual(parsed.credit, undefined, 'credit stays absent when omitted');
}

function testParseCreateStreamBodyRejectsMalformedShapes(): void {
  assertError(parseCreateStreamBody({ date: 'd', videoId: 'v', youtubeUrl: 'u' }), 'required', 'missing title');
  assertError(parseCreateStreamBody({ title: 't', videoId: 'v', youtubeUrl: 'u' }), 'required', 'missing date');
  assertError(parseCreateStreamBody({ title: 't', date: 'd', youtubeUrl: 'u' }), 'required', 'missing videoId');
  assertError(parseCreateStreamBody({ title: 't', date: 'd', videoId: 'v' }), 'required', 'missing youtubeUrl');
  assertError(parseCreateStreamBody({ title: 123, date: 'd', videoId: 'v', youtubeUrl: 'u' }), 'required', 'a numeric title (previously passed the truthy check)');
}

function testParseCreateStreamBodyValidatesCredit(): void {
  const base = { title: 't', date: '2026-01-01', videoId: 'v', youtubeUrl: 'u' };
  // Stored via JSON.stringify and decoded downstream as an object with optional
  // string fields — a non-object or wrongly-typed field must never reach the row.
  assertError(parseCreateStreamBody({ ...base, credit: 'invalid' }), 'credit', 'a string credit');
  assertError(parseCreateStreamBody({ ...base, credit: [1] }), 'credit', 'an array credit');
  assertError(parseCreateStreamBody({ ...base, credit: { author: 5 } }), 'credit.author', 'a numeric credit.author');
  const parsed = assertOk(
    parseCreateStreamBody({ ...base, credit: { author: 'A', authorUrl: 'https://a', junk: 'dropped' } }),
    'a well-formed credit',
  );
  assertEqual(JSON.stringify(parsed.credit), '{"author":"A","authorUrl":"https://a"}', 'credit is rebuilt with known keys only');
}

// --- parseUpdateStreamBody — mirrors StreamDetail.tsx's handleStreamSave ---

function testParseUpdateStreamBodyAcceptsWhatStreamDetailSends(): void {
  assertEqual(assertOk(parseUpdateStreamBody({ title: 'New Title' }), 'title-only').title, 'New Title', 'title-only accepted');
  assertEqual(assertOk(parseUpdateStreamBody({ date: '2026-01-01' }), 'date-only, well-formed').date, '2026-01-01', 'date-only accepted');
}

function testParseUpdateStreamBodyRejectsMalformedShapes(): void {
  assertError(parseUpdateStreamBody({}), 'at least one', 'an empty body');
  assertError(parseUpdateStreamBody({ date: '01-01-2026' }), 'date', 'a non-YYYY-MM-DD date');
  assertError(parseUpdateStreamBody({ videoId: '' }), 'videoId', 'an empty videoId');
  assertError(parseUpdateStreamBody({ youtubeUrl: 5 }), 'youtubeUrl', 'a numeric youtubeUrl');
}

// --- parseImportStreamsBody — mirrors ui/src/pages/Pipeline.tsx's importStreams({ videoIds: [...selected] }) ---

function testParseImportStreamsBodyAcceptsWhatPipelineSends(): void {
  const parsed = assertOk(parseImportStreamsBody({ videoIds: ['a', 'b'] }), 'a Set-derived array (Pipeline.tsx) is already unique');
  assertEqual(parsed.videoIds.join(','), 'a,b', 'both ids kept, in order');
}

function testParseImportStreamsBodyDedupesAndValidates(): void {
  const deduped = assertOk(parseImportStreamsBody({ videoIds: ['a', 'b', 'a'] }), 'a hand-crafted body with an in-request duplicate');
  assertEqual(deduped.videoIds.length, 2, 'duplicates are removed so the batch insert never hits the UNIQUE constraint');

  assertError(parseImportStreamsBody({ videoIds: [] }), 'videoIds', 'an empty array');
  assertError(parseImportStreamsBody({}), 'videoIds', 'a missing videoIds');
  assertError(parseImportStreamsBody({ videoIds: ['a', 5] }), 'videoIds', 'a non-string member');
  assertError(parseImportStreamsBody({ videoIds: ['a', ''] }), 'videoIds', 'an empty-string member');
}

// --- parseNovaSubmissionUpdateBody — mirrors NovaSubmissions.tsx's handleSave "changes" object ---

function testParseNovaSubmissionUpdateBodyAcceptsWhatNovaSubmissionsSends(): void {
  // handleSave only ever includes keys that changed: any of the 15
  // EDITABLE_FIELDS text inputs (all strings), plus theme_json (a
  // JSON.stringify'd ThemeColors object), enabled (0 or 1), and display_order
  // (a finite number) when those changed.
  const parsed = assertOk(parseNovaSubmissionUpdateBody({
    display_name: 'Alice',
    slug: 'alice',
    theme_json: JSON.stringify({ accentPrimary: '#fff' }),
    enabled: 1,
    display_order: 3,
  }), 'a realistic partial "changes" object');
  assertEqual(parsed.display_name, 'Alice', 'string field carried through');
  assertEqual(parsed.enabled, 1, 'enabled carried through');
  assertEqual(parsed.display_order, 3, 'display_order carried through');
  assertEqual(parsed.theme_json, JSON.stringify({ accentPrimary: '#fff' }), 'theme_json carried through as its original string, not re-serialized');

  // '' is the schema's own theme_json default and the UI's "no theme" sentinel
  // (parseThemeJson treats an empty value as theme-less) — clearing the theme
  // must keep working.
  const cleared = assertOk(parseNovaSubmissionUpdateBody({ theme_json: '' }), 'clearing the theme with an empty string');
  assertEqual(cleared.theme_json, '', 'the empty sentinel is preserved verbatim');

  const empty = assertOk(parseNovaSubmissionUpdateBody({}), 'handleSave skips the request entirely when nothing changed, but the parser itself must not treat {} as malformed');
  assertEqual(Object.keys(empty).length, 0, 'an empty object parses to an empty result (the "no fields to update" 400 is nova-db.ts\'s job, not the parser\'s)');

  const ignoresUnknown = assertOk(parseNovaSubmissionUpdateBody({ display_name: 'A', notAColumn: 'x' }), 'a key outside the 19-key allow-list');
  assert(!('notAColumn' in ignoresUnknown), 'unknown keys are silently dropped, not merged into the result');
}

function testParseNovaSubmissionUpdateBodyRejectsMalformedShapes(): void {
  assertError(parseNovaSubmissionUpdateBody(null), 'object', 'a null body');
  assertError(parseNovaSubmissionUpdateBody({ enabled: 2 }), 'enabled', 'enabled outside {0, 1}');
  assertError(parseNovaSubmissionUpdateBody({ enabled: true }), 'enabled', 'a boolean enabled (JSON true is not the number 1)');
  assertError(parseNovaSubmissionUpdateBody({ display_order: 'first' }), 'display_order', 'a string display_order');
  assertError(parseNovaSubmissionUpdateBody({ display_order: Number.NaN }), 'display_order', 'a NaN display_order');
  assertError(parseNovaSubmissionUpdateBody({ theme_json: 'not json' }), 'theme_json', 'invalid JSON in theme_json');
  assertError(parseNovaSubmissionUpdateBody({ theme_json: '[1,2,3]' }), 'theme_json', 'a JSON array (not an object) in theme_json');
  assertError(parseNovaSubmissionUpdateBody({ theme_json: 5 }), 'theme_json', 'a numeric theme_json');
  assertError(parseNovaSubmissionUpdateBody({ slug: 5 }), 'slug', 'a numeric string field');
  assertError(parseNovaSubmissionUpdateBody({ slug: 'Bad Slug' }), 'slug', 'a slug that fails isValidStreamerSlug (http.ts and sync-registry would reject it)');
  assertError(parseNovaSubmissionUpdateBody({ slug: '' }), 'slug', 'an empty slug');
  assertEqual(assertOk(parseNovaSubmissionUpdateBody({ slug: 'good-slug-2' }), 'a well-formed slug').slug, 'good-slug-2', 'a valid slug carries through');
  assertError(parseNovaSubmissionUpdateBody({ display_name: null }), 'display_name', 'a null string field');
}

// --- parseNovaVodUpdateBody — mirrors updateNovaVod(id, body: Record<string, string>) ---

function testParseNovaVodUpdateBodyAcceptsWhatTheUiSends(): void {
  const parsed = assertOk(parseNovaVodUpdateBody({ stream_title: 'New Title', reviewer_note: 'looks good' }), 'a partial update');
  assertEqual(parsed.stream_title, 'New Title', 'stream_title carried through');
  assertOk(parseNovaVodUpdateBody({}), 'an empty object is valid (nova-db.ts owns the "no fields" 400)');
  assertEqual(assertOk(parseNovaVodUpdateBody({ stream_date: '2026-01-02' }), 'a date-only stream_date').stream_date, '2026-01-02', 'a well-formed date carries through');
  assertEqual(assertOk(parseNovaVodUpdateBody({ stream_date: '' }), 'the schema\'s empty-date sentinel').stream_date, '', 'and the empty sentinel is still accepted');
}

function testParseNovaVodUpdateBodyRejectsMalformedShapes(): void {
  assertError(parseNovaVodUpdateBody({ stream_title: 5 }), 'stream_title', 'a numeric stream_title');
  assertError(parseNovaVodUpdateBody({ stream_date: null }), 'stream_date', 'a null stream_date');
  assertError(parseNovaVodUpdateBody({ stream_date: 'not-a-date' }), 'stream_date', 'a malformed non-empty stream_date (it would become the imported stream ID on approval)');
  assertError(parseNovaVodUpdateBody({ stream_date: '2026/01/02' }), 'stream_date', 'a slash-separated date');
}

// --- parsePipelineExtractBody — mirrors the /api/pipeline/extract call ({ streamId }) ---

function testParsePipelineExtractBodyRequiresAStreamId(): void {
  assertEqual(assertOk(parsePipelineExtractBody({ streamId: 'stream-1' }), 'the extract payload').streamId, 'stream-1', 'streamId carries through');
  assertError(parsePipelineExtractBody(null), 'object', 'a null body (previously a 500 on destructuring)');
  assertError(parsePipelineExtractBody({}), 'streamId', 'a missing streamId');
  assertError(parsePipelineExtractBody({ streamId: 7 }), 'streamId', 'a truthy non-string streamId (would reach the D1 binding)');
  assertError(parsePipelineExtractBody({ streamId: '  ' }), 'streamId', 'a whitespace-only streamId');
}

// --- parseCrystalReplyBody — mirrors replyCrystalTicket(id, admin_reply) ---

function testParseCrystalReplyBodyAcceptsWhatTheUiSends(): void {
  assertEqual(assertOk(parseCrystalReplyBody({ admin_reply: '  thanks!  ' }), 'a reply with incidental whitespace').admin_reply, 'thanks!', 'the reply is trimmed, matching the original route\'s .trim()');
}

function testParseCrystalReplyBodyRejectsMalformedShapes(): void {
  assertError(parseCrystalReplyBody({}), 'admin_reply', 'a missing admin_reply');
  assertError(parseCrystalReplyBody({ admin_reply: '   ' }), 'admin_reply', 'a whitespace-only admin_reply');
  assertError(parseCrystalReplyBody({ admin_reply: 5 }), 'admin_reply', 'a numeric admin_reply');
}

function main(): void {
  testParseCreateSongBodyAcceptsWhatSubmitSongSends();
  testParseCreateSongBodyRejectsMalformedShapes();
  testParseUpdateSongBodyAcceptsWhatSongDetailSends();
  testParseUpdateSongBodyRejectsMalformedShapes();
  testParseCreatePerformanceBodyHappyPath();
  testParseCreatePerformanceBodyRejectsMalformedShapes();
  testParseUpdateTimestampsBodyAcceptsWhatStampEditorSends();
  testParseUpdateTimestampsBodyRejectsMalformedShapes();
  testParseCreateStampPerformanceBodyAcceptsWhatStampEditorSends();
  testParseCreateStampPerformanceBodyRejectsMalformedShapes();
  testParseUpdateSongDetailsBodyAcceptsWhatStampEditorSends();
  testParseUpdateSongDetailsBodyRejectsMalformedShapes();
  testParseNoteBodyAcceptsWhatTheUiSends();
  testParseNoteBodyRejectsMalformedShapes();
  testParseCreateStreamBodyAcceptsWhatSubmitStreamSends();
  testParseCreateStreamBodyRejectsMalformedShapes();
  testParseCreateStreamBodyValidatesCredit();
  testParseUpdateStreamBodyAcceptsWhatStreamDetailSends();
  testParseUpdateStreamBodyRejectsMalformedShapes();
  testParseImportStreamsBodyAcceptsWhatPipelineSends();
  testParseImportStreamsBodyDedupesAndValidates();
  testParseNovaSubmissionUpdateBodyAcceptsWhatNovaSubmissionsSends();
  testParseNovaSubmissionUpdateBodyRejectsMalformedShapes();
  testParseNovaVodUpdateBodyAcceptsWhatTheUiSends();
  testParseNovaVodUpdateBodyRejectsMalformedShapes();
  testParsePipelineExtractBodyRequiresAStreamId();
  testParseCrystalReplyBodyAcceptsWhatTheUiSends();
  testParseCrystalReplyBodyRejectsMalformedShapes();
  testParseStatusUpdateBodyCoversEveryStatusRoute();
  testParseExtractImportBodyGuardsTheReplacePath();
  testParseCreateStreamBodyEnforcesDateFormat();
  testParsePasteImportBodyGuardsTheReplaceFlag();
  testParseHarmonizeApplyBodyValidatesEveryUpdate();

  console.log('✓ parse.ts: every legacy route body is validated against what the UI sends and rejects malformed shapes by name');
}

function testParseStatusUpdateBodyCoversEveryStatusRoute(): void {
  const NOVA = ['pending', 'approved', 'rejected'] as const;
  const ok = assertOk(parseStatusUpdateBody({ status: 'approved', reviewer_note: 'n' }, NOVA), 'status + note');
  assertEqual(ok.status, 'approved', 'status carried through');
  assertEqual(ok.reviewerNote, 'n', 'reviewer_note carried through as reviewerNote');
  assertEqual(assertOk(parseStatusUpdateBody({ status: 'pending' }, NOVA), 'status only').reviewerNote, undefined, 'note optional');
  // null IS valid JSON — previously blew up on property access as a 500.
  assertError(parseStatusUpdateBody(null, NOVA), 'object', 'a null body');
  assertError(parseStatusUpdateBody({ status: 'nope' }, NOVA), 'status', 'a status outside the allow-list');
  assertError(parseStatusUpdateBody({ status: 42 }, NOVA), 'status', 'a numeric status');
  assertError(parseStatusUpdateBody({ status: 'approved', reviewer_note: 42 }, NOVA), 'reviewer_note', 'a numeric reviewer_note (previously coercible into the TEXT column)');
  // A ReadonlySet allow-list (the catalog routes' VALID_STATUSES) works too.
  assertOk(parseStatusUpdateBody({ status: 'approved' }, new Set(['approved'] as const)), 'Set-shaped allow-list');
}

function testParseExtractImportBodyGuardsTheReplacePath(): void {
  const base = { streamId: 'stream-1', songs: [{ songName: 'S', artist: 'A', startSeconds: 10, endSeconds: 20 }] };
  const ok = assertOk(parseExtractImportBody(base), 'the pipeline extract payload');
  assertEqual(ok.replace, false, 'replace defaults to false (old body.replace ?? false)');
  assertEqual(ok.songs[0].endSeconds, 20, 'endSeconds carried through');
  assertEqual(
    assertOk(parseExtractImportBody({ ...base, songs: [{ songName: 'S', artist: '', startSeconds: 0 }] }), 'empty artist + absent endSeconds stay legal (extraction data)').songs[0].endSeconds,
    null,
    'absent endSeconds defaults to null',
  );
  assertError(parseExtractImportBody({ ...base, songs: [] }), 'songs', 'an empty songs array');
  assertError(parseExtractImportBody({ ...base, songs: [{ songName: 'S', artist: 'A', startSeconds: '10' }] }), 'startSeconds', 'a string startSeconds (previously reached SQLite as text under replace: true)');
  assertError(parseExtractImportBody({ ...base, songs: [{ songName: 'S', artist: 'A', startSeconds: 10, endSeconds: -5 }] }), 'endSeconds', 'a negative endSeconds');
  assertError(parseExtractImportBody({ ...base, songs: [{ songName: 'S', artist: 'A', startSeconds: 10, endSeconds: 10 }] }), 'endSeconds', 'a zero-duration entry');
  assertError(parseExtractImportBody({ ...base, replace: 'yes' }), 'replace', 'a non-boolean replace');
  assertError(parseExtractImportBody({ ...base, credit: 'invalid' }), 'credit', 'a junk credit (same validation as stream creation)');
}

function testParsePasteImportBodyGuardsTheReplaceFlag(): void {
  const ok = assertOk(parsePasteImportBody({ text: '0:00 Song / Artist' }), 'text-only paste');
  assertEqual(ok.replace, false, 'replace defaults to false');
  assertEqual(assertOk(parsePasteImportBody({ text: 't', replace: true }), 'replace: true').replace, true, 'boolean replace carried through');
  assertError(parsePasteImportBody({ replace: true }), 'text', 'missing text');
  assertError(parsePasteImportBody({ text: '   ' }), 'text', 'whitespace-only text');
  // "false" is truthy — it used to select the DESTRUCTIVE replace path.
  assertError(parsePasteImportBody({ text: 't', replace: 'false' }), 'replace', 'a string replace flag');
}

function testParseHarmonizeApplyBodyValidatesEveryUpdate(): void {
  const ok = assertOk(
    parseHarmonizeApplyBody({ updates: [{ songId: 'song-1', title: 'Canonical', originalArtist: 'Artist' }] }),
    'the harmonizer apply payload',
  );
  assertEqual(ok.updates[0].title, 'Canonical', 'title carried through');
  assertOk(parseHarmonizeApplyBody({ updates: [{ songId: 'song-1' }] }), 'an update with no identity fields is a no-op entry but not malformed');
  assertError(parseHarmonizeApplyBody({}), 'updates', 'missing updates');
  assertError(parseHarmonizeApplyBody({ updates: [] }), 'updates', 'an empty updates array');
  assertError(parseHarmonizeApplyBody({ updates: [null] }), 'updates[0]', 'a null entry (previously a 500 on property access)');
  assertError(parseHarmonizeApplyBody({ updates: [{ title: 'T' }] }), 'songId', 'a missing songId');
  assertError(parseHarmonizeApplyBody({ updates: [{ songId: 'song-1', title: 42 }] }), 'title', 'a numeric title (previously bound into songs AND works identity)');
  assertError(parseHarmonizeApplyBody({ updates: [{ songId: 'song-1', originalArtist: '' }] }), 'originalArtist', 'an empty originalArtist');
}

function testParseCreateStreamBodyEnforcesDateFormat(): void {
  // The id derives from this date (stream-YYYY-MM-DD) and it feeds sorting +
  // exports — 'not-a-date' would mint id 'stream-not-a-date'.
  assertError(
    parseCreateStreamBody({ title: 't', date: 'not-a-date', videoId: 'v', youtubeUrl: 'u' }),
    'date',
    'a non-YYYY-MM-DD creation date',
  );
  assertOk(parseCreateStreamBody({ title: 't', date: '2026-01-01', videoId: 'v', youtubeUrl: 'u' }), 'a well-formed date still passes');
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
