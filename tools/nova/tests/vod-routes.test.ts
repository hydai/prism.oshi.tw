// Corrections through Nova, end to end over real SQL: POST /vod/api/submit, GET /vod/api/current,
// GET /vod/api/check, and GET /status for the leak check. Nova's schema.sql and seed.sql share one
// in-memory database (DB), the admin worker's schema.sql another (ADMIN_DB), both through the
// node:sqlite D1 shim the admin tests use.
// Every test builds its own pair, so no answer depends on the order the tests run in.
// Run with: npm run test:vod-routes
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
// The shim takes node's URL; the global one here is workers-types', which does not match it.
import { URL } from 'node:url';
import app from '../src/index';
import { formatSongsForPaste } from '../src/song-text';
import { VOD_FILTERS } from '../src/status-page';
import { listAllVodSubmissions, publicListRevision } from '../src/vod-db';
import type { Bindings, PublicStreamSong } from '../src/types';
import { parseTextToSongs } from '../../../lib/parse';
import { SQLiteD1 } from '../../../admin/tests/sqlite-d1';

const TURNSTILE = 'challenges.cloudflare.com/turnstile/v0/siteverify';
const OEMBED = 'youtube.com/oembed';
const DATA_API = 'googleapis.com/youtube/v3/videos';

// mizuki's streams in the admin DB. Only s-pub is public, and its one row is Song A at 100–200.
// Every other status holds an approved row on purpose: what hides a non-public stream is the
// stream's own status, never the state of its rows.
const ADMIN_SEED = `
  INSERT INTO streams (id,streamer_id,title,date,video_id,youtube_url,status) VALUES
    ('s-pub','mizuki','Public','2026-09-01','vidPUB00001','https://example.com','approved'),
    ('s-pipe','mizuki','Pipeline','2026-09-02','vidPIPE0001','https://example.com','pending'),
    ('s-excl','mizuki','Excluded','2026-09-03','vidEXCL0001','https://example.com','excluded'),
    ('s-extr','mizuki','Extracted','2026-09-04','vidEXTR0001','https://example.com','extracted'),
    ('s-rej','mizuki','Rejected','2026-09-05','vidREJE0001','https://example.com','rejected');
  INSERT INTO songs (id,streamer_id,title,original_artist,status) VALUES
    ('song-a','mizuki','Song A','Artist','approved');
  INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status) VALUES
    ('p-pub','mizuki','song-a','s-pub','2026-09-01','Public','vidPUB00001',100,200,'approved'),
    ('p-pipe','mizuki','song-a','s-pipe','2026-09-02','Pipeline','vidPIPE0001',10,20,'approved'),
    ('p-excl','mizuki','song-a','s-excl','2026-09-03','Excluded','vidEXCL0001',10,20,'approved'),
    ('p-extr','mizuki','song-a','s-extr','2026-09-04','Extracted','vidEXTR0001',10,20,'approved'),
    ('p-rej','mizuki','song-a','s-rej','2026-09-05','Rejected','vidREJE0001',10,20,'approved');
`;

const NOT_PUBLIC = [
  ['pending', 'vidPIPE0001'],
  ['excluded', 'vidEXCL0001'],
  ['extracted', 'vidEXTR0001'],
  ['rejected', 'vidREJE0001'],
] as const;

interface SongInput {
  song_title: string;
  original_artist: string;
  // The Nova form sends H:MM:SS text, Aurora seconds.
  start_timestamp: string | number;
  end_timestamp?: string | number | null;
}

/** Exactly what s-pub publishes. */
const SONG_A: SongInput = { song_title: 'Song A', original_artist: 'Artist', start_timestamp: '0:01:40', end_timestamp: '0:03:20' };
/** The same, as the public list reads it: the row a submission's base records. */
const SONG_A_ROW: PublicStreamSong = { performance_id: 'p-pub', song_title: 'Song A', original_artist: 'Artist', start_timestamp: 100, end_timestamp: 200 };
/** What the pipeline streams hold as approved rows. */
const SONG_A_EARLY: SongInput = { song_title: 'Song A', original_artist: 'Artist', start_timestamp: '0:00:10', end_timestamp: '0:00:20' };
const SONG_A_LINE = '01. 0:01:40 ~ 0:03:20 Song A / Artist';

function hms(seconds: number): string {
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${Math.floor(seconds / 3600)}:${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

/** The songs the form sends for a pasted text: the shared parser's reading (the form's mirrors it), as H:MM:SS. */
function fromPaste(text: string): SongInput[] {
  return parseTextToSongs(text).map((row) => ({
    song_title: row.songName,
    original_artist: row.artist,
    start_timestamp: hms(row.startSeconds),
    end_timestamp: row.endSeconds === null ? null : hms(row.endSeconds),
  }));
}

interface Fixture {
  db: SQLiteD1;
  adminDb: SQLiteD1;
  env: Bindings;
}

function fixture(): Fixture {
  const db = new SQLiteD1(new URL('../schema.sql', import.meta.url), new URL('../seed.sql', import.meta.url));
  const adminDb = new SQLiteD1(new URL('../../../admin/schema.sql', import.meta.url));
  adminDb.sqlite.exec(ADMIN_SEED);
  return {
    db,
    adminDb,
    env: {
      DB: db.binding,
      ADMIN_DB: adminDb.binding,
      TURNSTILE_SITE_KEY: 'test-site-key',
      TURNSTILE_SECRET_KEY: 'test-secret',
      YOUTUBE_API_KEY: 'test-youtube-key',
    },
  };
}

function close(f: Fixture): void {
  f.db.sqlite.close();
  f.adminDb.sqlite.close();
}

// --- outbound fetch: Turnstile passes, YouTube answers with a title, anything else is a 404 ---
const realFetch = globalThis.fetch;
let outbound: string[] = [];

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

function installFetch(): void {
  outbound = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    outbound.push(url);
    if (url.includes(TURNSTILE)) return jsonResponse({ success: true });
    if (url.includes(OEMBED)) return jsonResponse({ title: 'Mock Stream', thumbnail_url: 'https://i.ytimg.com/vi/x/hqdefault.jpg' });
    if (url.includes(DATA_API)) return jsonResponse({ items: [{ snippet: { title: 'API Title' }, liveStreamingDetails: { actualStartTime: '2026-09-01T12:00:00Z' } }] });
    return new Response('unexpected outbound request', { status: 404 });
  }) as typeof fetch;
}

// --- requests: a status and the parsed body, or the raw text when the body is not JSON ---
interface Answer {
  status: number;
  body: unknown;
}

const SAME_ORIGIN = { 'Sec-Fetch-Site': 'same-origin' };

async function answer(response: Response): Promise<Answer> {
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Not JSON (a 404 page, say): keep the text, and the assertion on the status says what happened.
  }
  return { status: response.status, body };
}

function query(slug: string, videoId: string): string {
  return `streamer_slug=${slug}&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`;
}

async function current(f: Fixture, slug: string, videoId: string, headers: Record<string, string> = SAME_ORIGIN): Promise<Answer> {
  return answer(await app.request(`/vod/api/current?${query(slug, videoId)}`, { headers }, f.env));
}

async function check(f: Fixture, slug: string, videoId: string): Promise<Answer> {
  return answer(await app.request(`/vod/api/check?${query(slug, videoId)}`, { headers: SAME_ORIGIN }, f.env));
}

/** `extra` goes into the body as it is, so a test can send a base_revision of any shape. */
async function submit(f: Fixture, videoId: string, songs: SongInput[], slug = 'mizuki', extra: Record<string, unknown> = {}): Promise<Answer> {
  return answer(await app.request('/vod/api/submit', {
    method: 'POST',
    headers: { ...SAME_ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      streamer_slug: slug,
      video_url: `https://www.youtube.com/watch?v=${videoId}`,
      songs,
      turnstile_token: 'ok',
      ...extra,
    }),
  }, f.env));
}

/** The revision /vod/api/current gives with an archived VOD's list: 64 lowercase hex characters. */
async function revisionOf(f: Fixture, slug: string, videoId: string): Promise<string> {
  const a = await current(f, slug, videoId);
  const body = a.body as { archived?: unknown; revision?: unknown };
  assert.equal(a.status, 200, `current answered ${a.status}: ${JSON.stringify(a.body)}`);
  assert.equal(body.archived, true, `${slug}'s ${videoId} is archived`);
  assert.equal(typeof body.revision, 'string', `the answer carries a revision: ${JSON.stringify(a.body)}`);
  assert.match(body.revision as string, /^[0-9a-f]{64}$/);
  return body.revision as string;
}

/** A 201 carries exactly { id, kind }; returns the new submission's id. */
function created(a: Answer, kind: 'new' | 'correction'): string {
  assert.equal(a.status, 201, `expected 201, got ${a.status}: ${JSON.stringify(a.body)}`);
  const body = a.body as { id: string; kind: string };
  assert.deepEqual(Object.keys(body).sort(), ['id', 'kind']);
  assert.equal(body.kind, kind);
  assert.match(body.id, /^vod-[0-9a-f]{8}$/);
  return body.id;
}

// node:sqlite rows have a null prototype, so read single columns instead of comparing whole rows.
const count = (db: SQLiteD1, table: string) => Number(db.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n);
const storedKind = (f: Fixture, id: string) => f.db.sqlite.prepare('SELECT kind FROM vod_submissions WHERE id = ?').get(id)?.kind;
const storedBase = (f: Fixture, id: string) => f.db.sqlite.prepare('SELECT base_songs FROM vod_submissions WHERE id = ?').get(id)?.base_songs;
const storedVerified = (f: Fixture, id: string) => f.db.sqlite.prepare('SELECT base_verified FROM vod_submissions WHERE id = ?').get(id)?.base_verified;
const storedTimes = (f: Fixture, id: string) => f.db.sqlite.prepare(
  'SELECT start_timestamp, end_timestamp FROM vod_songs WHERE vod_submission_id = ? ORDER BY sort_order',
).all(id).map((row) => [row.start_timestamp, row.end_timestamp]);

function addNovaVod(f: Fixture, id: string, slug: string, videoId: string, status: string): void {
  f.db.sqlite.prepare(
    'INSERT INTO vod_submissions (id,streamer_slug,video_id,video_url,status) VALUES (?,?,?,?,?)',
  ).run(id, slug, videoId, `https://www.youtube.com/watch?v=${videoId}`, status);
}

// --- POST /vod/api/submit ---

async function testNewVideoIsNew() {
  const f = fixture();
  const id = created(await submit(f, 'vidNEW00001', [SONG_A]), 'new');
  assert.equal(storedKind(f, id), 'new');
  assert.equal(count(f.db, 'vod_songs'), 1, 'the song rows are stored');
  assert.equal(f.db.sqlite.prepare('SELECT stream_title FROM vod_submissions WHERE id = ?').get(id)?.stream_title, 'Mock Stream', 'an accepted submission still fills its title from YouTube');
  close(f);
}

async function testArchivedDifferentIsCorrection() {
  const f = fixture();
  const id = created(await submit(f, 'vidPUB00001', [{ ...SONG_A, start_timestamp: '0:01:41' }]), 'correction');
  assert.equal(storedKind(f, id), 'correction', 'the stored row is a correction');
  assert.equal(count(f.db, 'vod_songs'), 1, 'its songs are stored like any submission');
  const row = (await listAllVodSubmissions(f.db.binding)).find((candidate) => candidate.id === id);
  assert.equal(row?.kind, 'correction', 'the status page reads it as a correction');
  close(f);
}

async function testArchivedIdenticalIsNoChanges() {
  const f = fixture();
  const before = [count(f.db, 'vod_submissions'), count(f.db, 'vod_songs')];
  assert.deepEqual(await submit(f, 'vidPUB00001', [SONG_A]), { status: 422, body: { error: 'no_changes' } });
  assert.deepEqual([count(f.db, 'vod_submissions'), count(f.db, 'vod_songs')], before, 'nothing is inserted');
  assert.deepEqual(outbound.filter((url) => !url.includes(TURNSTILE)), [], 'a refused list spends no YouTube lookup');
  close(f);
}

async function testSpacedSlashTitleSurvivesTheForm() {
  // The paste text cannot carry `Song B / Live`: the form parsers read its line back as `Song B` by `Live / Artist`.
  const f = fixture();
  f.adminDb.sqlite.exec(`
    INSERT INTO songs (id,streamer_id,title,original_artist,status) VALUES ('song-b','mizuki','Song B / Live','Artist','approved');
    INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status) VALUES
      ('p-pub-b','mizuki','song-b','s-pub','2026-09-01','Public','vidPUB00001',300,400,'approved');
  `);
  const misread: SongInput = { song_title: 'Song B', original_artist: 'Live / Artist', start_timestamp: '0:05:00', end_timestamp: '0:06:40' };
  assert.deepEqual(await submit(f, 'vidPUB00001', [SONG_A, misread]), { status: 422, body: { error: 'no_changes' } }, 'the loaded list, unchanged, changes nothing');

  const id = created(await submit(f, 'vidPUB00001', [SONG_A, { ...misread, start_timestamp: '0:05:01' }]), 'correction');
  const stored = f.db.sqlite.prepare(
    'SELECT song_title, original_artist FROM vod_songs WHERE vod_submission_id = ? AND start_timestamp = 301',
  ).get(id);
  assert.equal(stored?.song_title, 'Song B / Live', 'a time fix keeps the archived title');
  assert.equal(stored?.original_artist, 'Artist', 'and the archived artist');
  close(f);
}

async function testBlankArtistIsNoChange() {
  // A list sent without artists names none: otherwise as archived, it changes nothing.
  const f = fixture();
  assert.deepEqual(await submit(f, 'vidPUB00001', [{ ...SONG_A, original_artist: '' }]), { status: 422, body: { error: 'no_changes' } });

  // With its end fixed, the row keeps the archived artist.
  const id = created(await submit(f, 'vidPUB00001', [{ ...SONG_A, original_artist: '', end_timestamp: '0:03:21' }]), 'correction');
  const stored = f.db.sqlite.prepare('SELECT original_artist FROM vod_songs WHERE vod_submission_id = ?').get(id);
  assert.equal(stored?.original_artist, 'Artist', 'the blank artist is stored as the archived one');
  close(f);
}

async function testMissingEndSurvivesTheForm() {
  // Song C is archived at 0:00:30 without an end; the form parsers give it the next row's start.
  const f = fixture();
  f.adminDb.sqlite.exec(`
    INSERT INTO songs (id,streamer_id,title,original_artist,status) VALUES ('song-c','mizuki','Song C','Artist','approved');
    INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status) VALUES
      ('p-pub-c','mizuki','song-c','s-pub','2026-09-01','Public','vidPUB00001',30,NULL,'approved');
  `);
  const filled: SongInput = { song_title: 'Song C', original_artist: 'Artist', start_timestamp: '0:00:30', end_timestamp: '0:01:40' };
  assert.deepEqual(await submit(f, 'vidPUB00001', [filled, SONG_A]), { status: 422, body: { error: 'no_changes' } }, 'the loaded list, unchanged, changes nothing');

  // Song A's start moves, and the parsers fill Song C's end with the new start.
  const id = created(await submit(f, 'vidPUB00001', [{ ...filled, end_timestamp: '0:01:41' }, { ...SONG_A, start_timestamp: '0:01:41' }]), 'correction');
  const stored = f.db.sqlite.prepare('SELECT end_timestamp FROM vod_songs WHERE vod_submission_id = ? AND start_timestamp = 30').get(id);
  assert.equal(stored?.end_timestamp, null, 'the filled-in end is stored as none');
  close(f);
}

async function testStartOnlyPasteIsNoChange() {
  // An archived list whose every end differs from the next row's start, pasted YouTube-comment style
  // with starts only: the parsers fill each middle end with the next start and leave the last empty.
  const f = fixture();
  f.adminDb.sqlite.exec(`
    INSERT INTO songs (id,streamer_id,title,original_artist,status) VALUES
      ('song-b','mizuki','Song B','Band B','approved'),
      ('song-c','mizuki','Song C','Band C','approved');
    INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status) VALUES
      ('p-pub-b','mizuki','song-b','s-pub','2026-09-01','Public','vidPUB00001',300,420,'approved'),
      ('p-pub-c','mizuki','song-c','s-pub','2026-09-01','Public','vidPUB00001',500,650,'approved');
  `);
  const pasted = fromPaste('0:01:40 Song A / Artist\n0:05:00 Song B / Band B\n0:08:20 Song C / Band C');
  assert.deepEqual(pasted.map((song) => song.end_timestamp), ['0:05:00', '0:08:20', null], 'the parsers fill the ends');
  const noChanges = { status: 422, body: { error: 'no_changes' } };
  assert.deepEqual(await submit(f, 'vidPUB00001', pasted), noChanges, 'the start-only paste repeats the archived list');
  assert.deepEqual(await submit(f, 'vidPUB00001', pasted.map((song) => ({ ...song, end_timestamp: null }))), noChanges, 'so do rows sent without ends');

  // Song B's start moves: it matches no archived row and keeps the parser's end; the others take back their own.
  const id = created(await submit(f, 'vidPUB00001', fromPaste('0:01:40 Song A / Artist\n0:05:05 Song B / Band B\n0:08:20 Song C / Band C')), 'correction');
  assert.deepEqual(storedTimes(f, id), [[100, 200], [305, 500], [500, 650]]);
  close(f);
}

async function testStartOnlyPasteOverAnOverlappingArchiveIsNoChange() {
  // An archive may overlap already: Song A ends at 300, past Song B's start at 200. Pasted start-only
  // and otherwise unchanged, Song B still matches its archived row, so the overlap is the archive's
  // own and Song A's archived end comes back.
  const f = fixture();
  f.adminDb.sqlite.exec(`
    UPDATE performances SET end_timestamp = 300 WHERE id = 'p-pub';
    INSERT INTO songs (id,streamer_id,title,original_artist,status) VALUES ('song-b','mizuki','Song B','Band B','approved');
    INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status) VALUES
      ('p-pub-b','mizuki','song-b','s-pub','2026-09-01','Public','vidPUB00001',200,400,'approved');
  `);
  const noChanges = { status: 422, body: { error: 'no_changes' } };
  assert.deepEqual(await submit(f, 'vidPUB00001', fromPaste('0:01:40 Song A / Artist\n0:03:20 Song B / Band B')), noChanges, 'the start-only paste repeats the archived list');
  // Without artists too: Song B's artist comes back before its match is read.
  assert.deepEqual(await submit(f, 'vidPUB00001', fromPaste('0:01:40 Song A\n0:03:20 Song B')), noChanges, 'so does one of titles and starts alone');
  close(f);
}

async function testARenamedNextRowKeepsTheEndBeforeIt() {
  // Copilot r16: First 100–300 overlaps Snog B 200–400 in the archive, and a start-only paste fixes only Snog B's
  // title. The parsers end First where Song B starts. Song B starts where an archived row starts, so it did not move
  // (a title or artist edit is no move): First's archived end comes back, its overlap the archive's own.
  const f = fixture();
  f.adminDb.sqlite.exec(`
    DELETE FROM performances WHERE id = 'p-pub';
    INSERT INTO songs (id,streamer_id,title,original_artist,status) VALUES
      ('song-first','mizuki','First','A','approved'),
      ('song-snog','mizuki','Snog B','B','approved');
    INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status) VALUES
      ('p-first','mizuki','song-first','s-pub','2026-09-01','Public','vidPUB00001',100,300,'approved'),
      ('p-snog','mizuki','song-snog','s-pub','2026-09-01','Public','vidPUB00001',200,400,'approved');
  `);
  const pasted = fromPaste('0:01:40 First / A\n0:03:20 Song B / B');
  assert.deepEqual(pasted.map((song) => song.end_timestamp), ['0:03:20', null], 'the parsers end First where Song B starts');
  const id = created(await submit(f, 'vidPUB00001', pasted), 'correction');
  assert.deepEqual(storedTimes(f, id), [[100, 300], [200, null]], 'First keeps its archived end');
  const titles = f.db.sqlite.prepare('SELECT song_title FROM vod_songs WHERE vod_submission_id = ? ORDER BY sort_order').all(id).map((row) => row.song_title);
  assert.deepEqual(titles, ['First', 'Song B'], 'the title fix is what is stored');
  close(f);
}

async function testMovedBoundaryNeverStoresAnOverlap() {
  // Song A 100–200 and Song B 200–300. Song A's archived end yields when it passes the start of a
  // next row that moved or is new: put back, it would overlap that row, so the contributor's end is stored.
  const f = fixture();
  f.adminDb.sqlite.exec(`
    INSERT INTO songs (id,streamer_id,title,original_artist,status) VALUES ('song-b','mizuki','Song B','Artist','approved');
    INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status) VALUES
      ('p-pub-b','mizuki','song-b','s-pub','2026-09-01','Public','vidPUB00001',200,300,'approved');
  `);
  const boundaryAt = (at: string): SongInput[] => [
    { ...SONG_A, end_timestamp: at },
    { song_title: 'Song B', original_artist: 'Artist', start_timestamp: at, end_timestamp: '0:05:00' },
  ];
  const earlier = created(await submit(f, 'vidPUB00001', boundaryAt('0:02:50')), 'correction');
  assert.deepEqual(storedTimes(f, earlier), [[100, 170], [170, 300]], 'a boundary moved earlier keeps the end it was given');
  const later = created(await submit(f, 'vidPUB00001', boundaryAt('0:03:50')), 'correction');
  assert.deepEqual(storedTimes(f, later), [[100, 200], [230, 300]], 'a boundary moved later gets the archived end back, leaving a gap');

  // An end typed equal to the next start reads as the fill, so a contiguous end alone changes nothing.
  f.adminDb.sqlite.exec("UPDATE performances SET end_timestamp = 150 WHERE id = 'p-pub'");
  assert.deepEqual(await submit(f, 'vidPUB00001', boundaryAt('0:03:20')), { status: 422, body: { error: 'no_changes' } });
  close(f);
}

async function testStartOnlyPasteKeepsTheFillBeforeAMovedOrNewRow() {
  // Song A 100–200 and Song B 300–400. Before a row that moved or is new, Song A's archived end would
  // overlap it, so the parser's end is stored.
  const f = fixture();
  f.adminDb.sqlite.exec(`
    INSERT INTO songs (id,streamer_id,title,original_artist,status) VALUES ('song-b','mizuki','Song B','Artist','approved');
    INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status) VALUES
      ('p-pub-b','mizuki','song-b','s-pub','2026-09-01','Public','vidPUB00001',300,400,'approved');
  `);
  const moved = created(await submit(f, 'vidPUB00001', fromPaste('0:01:40 Song A / Artist\n0:02:30 Song B / Artist')), 'correction');
  assert.deepEqual(storedTimes(f, moved), [[100, 150], [150, null]], 'Song B moved to 0:02:30: Song A keeps the parser\'s end');
  const inserted = created(await submit(f, 'vidPUB00001', fromPaste('0:01:40 Song A / Artist\n0:03:00 New Song / Band\n0:05:00 Song B / Artist')), 'correction');
  assert.deepEqual(storedTimes(f, inserted), [[100, 180], [180, 300], [300, 400]], 'a new row at 0:03:00: Song A keeps the parser\'s end, Song B takes back its own');
  close(f);
}

async function testBlankTitleRowIsNotTheNextRow() {
  // A start-only correction with a blank-title row in the middle, each end filled from the next titled
  // row. The route drops the blank row, so the next submitted row is the next stored one: Song B. The blank
  // row starts at 0:02:30, not where Song A ends (0:05:00), so no end is taken from it: the route re-fills
  // only an end that is the dropped row's start (testAnEndFilledFromABlankLineIsDerived).
  const f = fixture();
  f.adminDb.sqlite.exec(`
    INSERT INTO songs (id,streamer_id,title,original_artist,status) VALUES
      ('song-b','mizuki','Song B','Band B','approved'),
      ('song-c','mizuki','Song C','Band C','approved');
    INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status) VALUES
      ('p-pub-b','mizuki','song-b','s-pub','2026-09-01','Public','vidPUB00001',300,420,'approved'),
      ('p-pub-c','mizuki','song-c','s-pub','2026-09-01','Public','vidPUB00001',500,650,'approved');
  `);
  const id = created(await submit(f, 'vidPUB00001', [
    { song_title: 'Song A', original_artist: 'Artist', start_timestamp: '0:01:40', end_timestamp: '0:05:00' },
    { song_title: '   ', original_artist: '', start_timestamp: '0:02:30', end_timestamp: '0:02:40' },
    { song_title: 'Song B', original_artist: 'Band B', start_timestamp: '0:05:00', end_timestamp: '0:08:25' },
    { song_title: 'Song C', original_artist: 'Band C', start_timestamp: '0:08:25', end_timestamp: null },
  ]), 'correction');
  const sortOrders = f.db.sqlite.prepare('SELECT sort_order FROM vod_songs WHERE vod_submission_id = ? ORDER BY sort_order').all(id).map((row) => row.sort_order);
  assert.deepEqual(sortOrders, [0, 2, 3], 'the blank row is dropped and the others keep their index');
  assert.deepEqual(storedTimes(f, id), [[100, 200], [300, 420], [505, null]], 'Song A and Song B take back their archived ends; the moved Song C keeps its own');
  close(f);
}

async function testBareSlashTitleOnlyPasteIsNoChange() {
  // Finding #13: a title-only paste of `POP/STARS` by `K/DA` reads as `POP` by `STARS`.
  const f = fixture();
  f.adminDb.sqlite.exec(`
    INSERT INTO songs (id,streamer_id,title,original_artist,status) VALUES ('song-k','mizuki','POP/STARS','K/DA','approved');
    INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status) VALUES
      ('p-pub-k','mizuki','song-k','s-pub','2026-09-01','Public','vidPUB00001',900,1140,'approved');
  `);
  const pasted = fromPaste('0:01:40 ~ 0:03:20 Song A\n0:15:00 ~ 0:19:00 POP/STARS');
  assert.deepEqual([pasted[1].song_title, pasted[1].original_artist], ['POP', 'STARS'], 'the parsers split the title');
  assert.deepEqual(await submit(f, 'vidPUB00001', pasted), { status: 422, body: { error: 'no_changes' } }, 'the title-only paste repeats the archived list');
  // YouTube-comment style, with neither artists nor ends: an end goes back only once the row's title
  // and artist have, so the restores must run in that order.
  assert.deepEqual(await submit(f, 'vidPUB00001', fromPaste('0:01:40 Song A\n0:15:00 POP/STARS')), { status: 422, body: { error: 'no_changes' } },
    'a paste of titles and starts alone repeats the archived list');

  // With its end fixed, the row keeps the archived title and artist.
  const id = created(await submit(f, 'vidPUB00001', fromPaste('0:01:40 ~ 0:03:20 Song A\n0:15:00 ~ 0:19:05 POP/STARS')), 'correction');
  const stored = f.db.sqlite.prepare(
    'SELECT song_title, original_artist, end_timestamp FROM vod_songs WHERE vod_submission_id = ? AND start_timestamp = 900',
  ).get(id);
  assert.deepEqual([stored?.song_title, stored?.original_artist, stored?.end_timestamp], ['POP/STARS', 'K/DA', 1145]);
  close(f);
}

async function testDashTitleOnlyPasteIsNoChange() {
  const f = fixture();
  f.adminDb.sqlite.exec(`
    INSERT INTO songs (id,streamer_id,title,original_artist,status) VALUES ('song-d','mizuki','Title - Part','Band','approved');
    INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status) VALUES
      ('p-pub-d','mizuki','song-d','s-pub','2026-09-01','Public','vidPUB00001',900,1140,'approved');
  `);
  const pasted = fromPaste('0:01:40 ~ 0:03:20 Song A\n0:15:00 ~ 0:19:00 Title - Part');
  assert.deepEqual([pasted[1].song_title, pasted[1].original_artist], ['Title', 'Part'], 'the parsers split the title at its dash');
  assert.deepEqual(await submit(f, 'vidPUB00001', pasted), { status: 422, body: { error: 'no_changes' } }, 'the title-only paste repeats the archived list');
  close(f);
}

const endNotAfterStart = (title: string) => ({ status: 400, body: { error: `歌曲 "${title}" 的結束時間必須晚於開始時間` } });
const startsBeforeThePreviousRow = (title: string) => ({ status: 400, body: { error: `歌曲 "${title}" 的開始時間早於前一首，請依時間順序排列` } });

/** Every video a submission can name: none, each stream that is not public, and the archived one. */
const EVERY_VIDEO = ['vidNEW00001', ...NOT_PUBLIC.map(([, videoId]) => videoId), 'vidPUB00001'];

async function testInvertedRowIsRefused() {
  // An end must come after its start, for a new video and a correction alike. The check reads the rows
  // Nova would store: an archived VOD's once the paste text's losses are restored, any other video's as
  // they came. A stream that is not public restores nothing, so it answers as no stream does.
  const f = fixture();
  const before = [count(f.db, 'vod_submissions'), count(f.db, 'vod_songs')];
  const early: SongInput = { song_title: '  Late Song  ', original_artist: 'Band', start_timestamp: '0:05:00', end_timestamp: '0:04:59' };
  for (const videoId of EVERY_VIDEO) {
    assert.deepEqual(await submit(f, videoId, [SONG_A, early]), endNotAfterStart('Late Song'), `an end before its start, ${videoId}`);
    assert.deepEqual(await submit(f, videoId, [{ ...SONG_A, end_timestamp: SONG_A.start_timestamp }]), endNotAfterStart('Song A'), `an end at its start, ${videoId}`);
  }
  // Of several, the first in the order submitted is named.
  assert.deepEqual(await submit(f, 'vidNEW00001', [{ ...SONG_A, end_timestamp: SONG_A.start_timestamp }, early]), endNotAfterStart('Song A'), 'the first of two');

  // Finding #7: start-only lines with one appended out of order. The parsers end Gamma where Delta
  // starts, and Gamma is no archived row, so nothing gives it another end. The forms sort their lines
  // now (#9), so a list that still arrives like this is refused for its order before any end is read,
  // naming Delta, the first row to start before the row above it.
  const appended = fromPaste('0:10:00 Alpha / A\n0:20:00 Beta / B\n0:30:00 Gamma / C\n0:15:00 Delta / D');
  assert.equal(appended[2].end_timestamp, '0:15:00');
  assert.deepEqual(await submit(f, 'vidPUB00001', appended), startsBeforeThePreviousRow('Delta'));

  assert.deepEqual([count(f.db, 'vod_submissions'), count(f.db, 'vod_songs')], before, 'nothing is stored');
  assert.deepEqual(outbound.filter((url) => !url.includes(TURNSTILE)), [], 'nor is YouTube asked');

  // A blank-title row is dropped before its times are read, so they refuse nothing.
  created(await submit(f, 'vidNEW00001', [SONG_A, { ...early, song_title: '   ' }]), 'new');
  close(f);
}

async function testAListOutOfTimeOrderIsRefused() {
  // A row that starts before the row above it is refused, naming it, for a new video and a correction alike. The
  // forms sort their lines before the parsers fill the ends; a client that does not would store a song typed out of
  // its place with an end that spans the rows after it (#2). The rows are read as they would be stored, and a stream
  // that is not public restores nothing, so it answers as no stream does.
  const f = fixture();
  const before = [count(f.db, 'vod_submissions'), count(f.db, 'vod_songs')];
  const songB: SongInput = { song_title: 'Song B', original_artist: 'Artist', start_timestamp: '0:05:00', end_timestamp: '0:06:40' };
  // Every end comes after its start: only the order is wrong.
  const missed: SongInput = { song_title: 'Missed', original_artist: 'Artist', start_timestamp: '0:04:00', end_timestamp: '0:05:00' };
  for (const videoId of EVERY_VIDEO) {
    assert.deepEqual(await submit(f, videoId, [SONG_A, songB, missed]), startsBeforeThePreviousRow('Missed'), `a missed song typed below the next row, ${videoId}`);
  }

  // Of several rows that start before the row above them, the first in the order submitted is named.
  const lateStart: SongInput = { song_title: 'Late', original_artist: 'Artist', start_timestamp: '0:03:20', end_timestamp: '0:04:00' };
  assert.deepEqual(await submit(f, 'vidNEW00001', [SONG_A, songB, missed, lateStart]), startsBeforeThePreviousRow('Missed'), 'the first of two');

  // The order is told before any end is: Late Song's end is inverted too.
  const inverted: SongInput = { song_title: 'Late Song', original_artist: 'Band', start_timestamp: '0:05:00', end_timestamp: '0:04:59' };
  assert.deepEqual(await submit(f, 'vidNEW00001', [SONG_A, inverted, missed]), startsBeforeThePreviousRow('Missed'), 'the order before the end');

  assert.deepEqual([count(f.db, 'vod_submissions'), count(f.db, 'vod_songs')], before, 'nothing is stored');
  assert.deepEqual(outbound.filter((url) => !url.includes(TURNSTILE)), [], 'nor is YouTube asked');

  // A blank-title row is dropped before its time is read, so it never counts as out of order.
  created(await submit(f, 'vidNEW00001', [SONG_A, { ...missed, song_title: '   ', start_timestamp: '0:00:10', end_timestamp: '0:00:20' }, songB]), 'new');
  close(f);
}

async function testEqualStartsAreInOrder() {
  // Rows that start together are in order: the forms' stable sort keeps them as typed. Their ends are given: a
  // start-only line above an equal start is filled with that start, which is its own, and an end at its start is
  // refused, unless the line repeats an archived row at its start, whose end the restore gives back
  // (testANewSongAtAnArchivedStartIsAccepted).
  const f = fixture();
  const first: SongInput = { song_title: 'First', original_artist: 'Artist', start_timestamp: '0:01:40', end_timestamp: '0:02:00' };
  const second: SongInput = { song_title: 'Second', original_artist: 'Artist', start_timestamp: '0:01:40', end_timestamp: null };
  assert.deepEqual(storedTimes(f, created(await submit(f, 'vidNEW00001', [first, second]), 'new')), [[100, 120], [100, null]], 'a new video');
  assert.deepEqual(storedTimes(f, created(await submit(f, 'vidPUB00001', [first, second]), 'correction')), [[100, 120], [100, null]], 'a correction');
  close(f);
}

async function testANewSongAtAnArchivedStartIsAccepted() {
  // A start-only paste with a new song typed at an archived row's start, below that row. The parsers end Song A at
  // its own start, but New Song starts where an archived row starts, so it reads as no move: Song A's archived end
  // comes back, nothing is inverted, and the list is stored. (Before r16 New Song counted as moved, Song A kept the
  // end at its start, and the list was refused.)
  const f = fixture();
  const pasted = fromPaste('0:01:40 Song A / Artist\n0:01:40 New Song / Band');
  assert.equal(pasted[0].end_timestamp, '0:01:40', 'the parsers end Song A at its own start');
  const alone = created(await submit(f, 'vidPUB00001', pasted), 'correction');
  assert.deepEqual(storedTimes(f, alone), [[100, 200], [100, null]], 'Song A keeps its archived end, and New Song has none');

  f.adminDb.sqlite.exec(`
    INSERT INTO songs (id,streamer_id,title,original_artist,status) VALUES ('song-b','mizuki','Song B','Artist','approved');
    INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status) VALUES
      ('p-pub-b','mizuki','song-b','s-pub','2026-09-01','Public','vidPUB00001',300,400,'approved');
  `);
  const between = created(await submit(f, 'vidPUB00001', fromPaste('0:01:40 Song A / Artist\n0:01:40 New Song / Band\n0:05:00 Song B / Artist')), 'correction');
  assert.deepEqual(storedTimes(f, between), [[100, 200], [100, 300], [300, 400]], 'New Song ends where Song B starts, and Song B keeps its own end');
  close(f);
}

async function testTheAppendedSongRestoresTheUntouchedRow() {
  // Finding #9: Alpha, Beta and Gamma are archived, and Delta, which they all missed, is typed at the bottom of a
  // start-only paste. Typed there, the parsers end Gamma where Delta starts, and Gamma's archived end gave way to
  // that end (Delta is new): an untouched row was refused. The forms sort the lines first, so the paste reads in time
  // order, with Delta between Alpha and Beta, and each untouched row gets its archived end back.
  const f = fixture();
  f.adminDb.sqlite.exec(`
    DELETE FROM performances WHERE id = 'p-pub';
    INSERT INTO songs (id,streamer_id,title,original_artist,status) VALUES
      ('song-alpha','mizuki','Alpha','A','approved'),
      ('song-beta','mizuki','Beta','B','approved'),
      ('song-gamma','mizuki','Gamma','C','approved');
    INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status) VALUES
      ('p-alpha','mizuki','song-alpha','s-pub','2026-09-01','Public','vidPUB00001',600,840,'approved'),
      ('p-beta','mizuki','song-beta','s-pub','2026-09-01','Public','vidPUB00001',1200,1440,'approved'),
      ('p-gamma','mizuki','song-gamma','s-pub','2026-09-01','Public','vidPUB00001',1800,2040,'approved');
  `);
  // As the form submits it: the lines in time order, the ends filled from the next row in time.
  const sorted = fromPaste('0:10:00 Alpha / A\n0:15:00 Delta / D\n0:20:00 Beta / B\n0:30:00 Gamma / C');
  assert.deepEqual(sorted.map((song) => song.end_timestamp), ['0:15:00', '0:20:00', '0:30:00', null], 'the parsers fill each end from the next row in time');
  const id = created(await submit(f, 'vidPUB00001', sorted), 'correction');
  assert.deepEqual(storedTimes(f, id), [[600, 840], [900, 1200], [1200, 1440], [1800, 2040]], 'Gamma gets its archived end back, and Delta keeps the parser\'s');

  // Typed at the bottom, as a client that does not sort would send it: refused for its order, naming Delta.
  const unsorted = fromPaste('0:10:00 Alpha / A\n0:20:00 Beta / B\n0:30:00 Gamma / C\n0:15:00 Delta / D');
  assert.deepEqual(await submit(f, 'vidPUB00001', unsorted), startsBeforeThePreviousRow('Delta'));
  close(f);
}

async function testAnEndTheRestoreGivesBackIsNeverRefused() {
  // Copilot r13: the end the order check reads is the one Nova would store. Song Z is archived at 0:01:40
  // with no end, ahead of Song A at the same start (by performance id). The paste text gives Song Z no
  // end, and the parsers end it where Song A starts: at its own start. The restore gives it back none.
  const f = fixture();
  f.adminDb.sqlite.exec(`
    INSERT INTO songs (id,streamer_id,title,original_artist,status) VALUES ('song-z','mizuki','Song Z','Artist','approved');
    INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status) VALUES
      ('p-early','mizuki','song-z','s-pub','2026-09-01','Public','vidPUB00001',100,NULL,'approved');
  `);
  const loaded = fromPaste(((await current(f, 'mizuki', 'vidPUB00001')).body as { text: string }).text);
  assert.deepEqual(loaded.map((row) => [row.song_title, row.start_timestamp, row.end_timestamp]), [
    ['Song Z', '0:01:40', '0:01:40'],
    ['Song A', '0:01:40', '0:03:20'],
  ], 'the parsers end Song Z at its own start');
  const revision = await revisionOf(f, 'mizuki', 'vidPUB00001');
  const noChanges = { status: 422, body: { error: 'no_changes' } };
  assert.deepEqual(await submit(f, 'vidPUB00001', loaded), noChanges, 'the loaded list, unchanged, changes nothing');
  assert.deepEqual(await submit(f, 'vidPUB00001', loaded, 'mizuki', { base_revision: revision }), noChanges, 'with its revision too');

  // A change elsewhere is stored, and Song Z keeps no end.
  const id = created(await submit(f, 'vidPUB00001', [loaded[0], { ...loaded[1], end_timestamp: '0:03:30' }]), 'correction');
  assert.deepEqual(storedTimes(f, id), [[100, null], [100, 210]]);

  // Lines pasted out of order: the parsers end Song B where Song A starts, before Song B's own start.
  // Both are archived rows and neither moved, so each gets its archived end back: the published list.
  f.adminDb.sqlite.exec(`
    INSERT INTO songs (id,streamer_id,title,original_artist,status) VALUES ('song-b','mizuki','Song B','Band B','approved');
    INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status) VALUES
      ('p-pub-b','mizuki','song-b','s-pub','2026-09-01','Public','vidPUB00001',300,420,'approved');
    DELETE FROM performances WHERE id = 'p-early';
  `);
  const reversed = fromPaste('0:05:00 Song B / Band B\n0:01:40 Song A / Artist');
  assert.equal(reversed[0].end_timestamp, '0:01:40');
  assert.deepEqual(await submit(f, 'vidPUB00001', reversed), noChanges, 'the published list, pasted out of order');

  // An archived row that is inverted itself reads back as it is. The list unchanged stores nothing, so it
  // is no_changes; changed elsewhere, it would store that row too, so it is refused until the row is fixed.
  f.adminDb.sqlite.exec("UPDATE performances SET end_timestamp = 250 WHERE id = 'p-pub-b'");
  const asPublished = fromPaste(((await current(f, 'mizuki', 'vidPUB00001')).body as { text: string }).text);
  assert.deepEqual(asPublished.map((row) => [row.song_title, row.end_timestamp]), [['Song A', '0:03:20'], ['Song B', '0:04:10']]);
  assert.deepEqual(await submit(f, 'vidPUB00001', asPublished), noChanges, 'an archive with an inverted row, unchanged');
  assert.deepEqual(await submit(f, 'vidPUB00001', [{ ...asPublished[0], end_timestamp: '0:03:30' }, asPublished[1]]), endNotAfterStart('Song B'), 'changed elsewhere');
  close(f);
}

// --- A line with no title (r3 #8): the route drops it, and an end the parsers filled from its start goes with it ---

/** Song A 100–200 (the seed's), Song B 300–400 and Song C 500–600: no end is the next row's start. */
function addSongsBAndC(f: Fixture): void {
  f.adminDb.sqlite.exec(`
    INSERT INTO songs (id,streamer_id,title,original_artist,status) VALUES
      ('song-b','mizuki','Song B','Band B','approved'),
      ('song-c','mizuki','Song C','Band C','approved');
    INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status) VALUES
      ('p-pub-b','mizuki','song-b','s-pub','2026-09-01','Public','vidPUB00001',300,400,'approved'),
      ('p-pub-c','mizuki','song-c','s-pub','2026-09-01','Public','vidPUB00001',500,600,'approved');
  `);
}

/** A start-only paste of those three, with a line below Song A that has no title: the spaced slash of `/ D / W` leaves it empty. */
const pasteWithABlankLine = (songCStart: string): string =>
  `0:01:40 Song A / Artist\n0:04:10 / D / W\n0:05:00 Song B / Band B\n${songCStart} Song C / Band C`;

async function testAnEndFilledFromABlankLineIsDerived() {
  // The parsers end Song A where the next line starts, and that line, `/ D / W`, has no title, so the route drops it.
  // Song A's end, 0:04:10, was then no stored row's start: it read as typed, and Song A was stored 100–250 (D lost).
  // An end that is the dropped row's start now takes the next kept row's start, Song B's, so it reads as derived and
  // the archive's end comes back. Nothing is left to change.
  const f = fixture();
  addSongsBAndC(f);
  const pasted = fromPaste(pasteWithABlankLine('0:08:20'));
  assert.deepEqual(pasted.map((song) => [song.song_title, song.start_timestamp, song.end_timestamp]), [
    ['Song A', '0:01:40', '0:04:10'],
    ['', '0:04:10', '0:05:00'],
    ['Song B', '0:05:00', '0:08:20'],
    ['Song C', '0:08:20', null],
  ], 'the parsers end Song A where the untitled line starts');
  const before = [count(f.db, 'vod_submissions'), count(f.db, 'vod_songs')];
  assert.deepEqual(await submit(f, 'vidPUB00001', pasted), { status: 422, body: { error: 'no_changes' } }, 'the archive again, and a line nobody stores');
  assert.deepEqual([count(f.db, 'vod_submissions'), count(f.db, 'vod_songs')], before, 'no submission is stored');
  close(f);
}

async function testAnEndFilledFromABlankLineIsRestoredBesideARealChange() {
  // The same paste with Song C moved to 0:08:40: that change is stored, and Song A still takes back the end it has
  // in the archive, not 0:04:10.
  const f = fixture();
  addSongsBAndC(f);
  const id = created(await submit(f, 'vidPUB00001', fromPaste(pasteWithABlankLine('0:08:40'))), 'correction');
  assert.deepEqual(storedTimes(f, id), [[100, 200], [300, 400], [520, null]], 'Song A and Song B take back their ends; Song C is the change');
  const sortOrders = f.db.sqlite.prepare('SELECT sort_order FROM vod_songs WHERE vod_submission_id = ? ORDER BY sort_order').all(id).map((row) => row.sort_order);
  assert.deepEqual(sortOrders, [0, 2, 3], 'the untitled line is dropped and the others keep their index');
  close(f);
}

async function testTheLoadedListPlusABlankLineIsUnchanged() {
  // The list the form loads carries every end, Song A's among them (0:03:20), so a line typed in below Song A fills
  // nothing: Song A's end is not that line's start. A pin: the re-fill leaves an end that is not the dropped row's start.
  const f = fixture();
  addSongsBAndC(f);
  const loaded = ((await current(f, 'mizuki', 'vidPUB00001')).body as { text: string }).text.split('\n');
  assert.equal(loaded.length, 3, 'the loaded list has the three rows');
  const withBlank = [loaded[0], '0:04:10 / D / W', ...loaded.slice(1)].join('\n');
  assert.equal(fromPaste(withBlank)[0].end_timestamp, '0:03:20', 'Song A keeps the end the list gave it');
  assert.deepEqual(await submit(f, 'vidPUB00001', fromPaste(withBlank)), { status: 422, body: { error: 'no_changes' } });
  close(f);
}

async function testABlankRowRefillsOnlyTheEndRightAboveIt() {
  // The edges of the rule, on a video with no stream, where nothing is restored: what is stored is what the route read.
  const f = fixture();
  const row = (title: string, start: number, end: number | null): SongInput => ({ song_title: title, original_artist: 'X', start_timestamp: start, end_timestamp: end });
  const blank = (start: number | string, end: number | null): SongInput => ({ ...row('   ', 0, end), start_timestamp: start });
  const stored = async (songs: SongInput[]) => storedTimes(f, created(await submit(f, 'vidNEW00001', songs), 'new'));

  assert.deepEqual(await stored([row('A', 100, 250), blank(250, 300), row('B', 300, null)]), [[100, 300], [300, null]],
    'an end that is the dropped row\'s start takes the next kept row\'s start');
  assert.deepEqual(await stored([row('A', 100, 250), blank(250, null)]), [[100, null]], 'and none when no kept row follows');
  assert.deepEqual(await stored([row('A', 100, 250), blank(250, 270), blank(270, 300), row('B', 300, null)]), [[100, 300], [300, null]],
    'across two dropped rows, the next kept row is the one that counts');
  assert.deepEqual(await stored([row('A', 100, 230), blank(250, 300), row('B', 300, null)]), [[100, 230], [300, null]],
    'an end that is not the dropped row\'s start is the contributor\'s');
  assert.deepEqual(await stored([row('A', 100, 270), blank(250, 270), blank(270, 300), row('B', 300, null)]), [[100, 270], [300, null]],
    'only the dropped row right below the kept row counts, not the second one');
  assert.deepEqual(await stored([row('A', 100, null), blank('garbage', null), row('B', 300, null)]), [[100, null], [300, null]],
    'a missing end is no end to match, and a dropped row\'s unreadable start is no start');
  close(f);
}

async function testAnEndOfZeroIsAnEnd() {
  // Copilot r13: Aurora sends seconds, so an end stamped or typed as 0:00 arrives as the number 0. It is
  // an end, like the form's 0:00:00, and it comes at or before any start, so it is refused. Only a missing,
  // null or empty end is none.
  const f = fixture();
  const zero: SongInput = { song_title: 'Zero', original_artist: 'X', start_timestamp: 300, end_timestamp: 0 };
  for (const videoId of EVERY_VIDEO) {
    assert.deepEqual(await submit(f, videoId, [SONG_A, zero]), endNotAfterStart('Zero'), `an end of 0, ${videoId}`);
    // First, in time order: a row that starts at 0 below Song A would be refused for its order before its end is read.
    assert.deepEqual(await submit(f, videoId, [{ ...zero, start_timestamp: 0 }, SONG_A]), endNotAfterStart('Zero'), `0 to 0, ${videoId}`);
    assert.deepEqual(await submit(f, videoId, [SONG_A, { ...zero, end_timestamp: '0:00:00' }]), endNotAfterStart('Zero'), `the form's 0:00:00, ${videoId}`);
  }

  // Otherwise seconds read as they always did: a start of 0 is a start, and an end after it is kept.
  const id = created(await submit(f, 'vidNEW00001', [
    { song_title: 'Opening', original_artist: 'X', start_timestamp: 0, end_timestamp: 90 },
    { song_title: 'No End', original_artist: 'X', start_timestamp: 120, end_timestamp: null },
    { song_title: 'Empty End', original_artist: 'X', start_timestamp: 240, end_timestamp: '' },
    { song_title: 'Left Out', original_artist: 'X', start_timestamp: 360 },
  ]), 'new');
  assert.deepEqual(storedTimes(f, id), [[0, 90], [120, null], [240, null], [360, null]]);
  close(f);
}

async function testATimeThatIsNeitherTextNorANumberIsMalformed() {
  // The body is JSON, so a time can arrive as any value. One that is neither text nor a number is the
  // 400 for a malformed time, the same for every video, and never a crash.
  const f = fixture();
  const before = count(f.db, 'vod_submissions');
  for (const value of [false, true, {}, [], ['0:01:40']]) {
    for (const videoId of EVERY_VIDEO) {
      const start = { ...SONG_A, song_title: 'Odd', start_timestamp: value } as unknown as SongInput;
      const end = { ...SONG_A, song_title: 'Odd', end_timestamp: value } as unknown as SongInput;
      assert.deepEqual(await submit(f, videoId, [start]), { status: 400, body: { error: '歌曲 "Odd" 的開始時間格式無效' } }, `a start of ${JSON.stringify(value)}, ${videoId}`);
      assert.deepEqual(await submit(f, videoId, [end]), { status: 400, body: { error: '歌曲 "Odd" 的結束時間格式無效' } }, `an end of ${JSON.stringify(value)}, ${videoId}`);
    }
  }
  // A start is required, so a missing or null one is malformed too, where such an end is none.
  for (const videoId of EVERY_VIDEO) {
    const missing = { song_title: 'Odd', original_artist: 'Artist', end_timestamp: '0:03:20' } as unknown as SongInput;
    for (const row of [missing, { ...missing, start_timestamp: null } as unknown as SongInput]) {
      assert.deepEqual(await submit(f, videoId, [row]), { status: 400, body: { error: '歌曲 "Odd" 的開始時間格式無效' } }, `a start of ${String(row.start_timestamp)}, ${videoId}`);
    }
  }
  assert.equal(count(f.db, 'vod_submissions'), before, 'nothing is stored');
  close(f);
}

async function testPipelineAndExcludedAreAccepted() {
  const f = fixture();
  // The list a non-public stream's approved rows hold is accepted, with the same answer as for an
  // unknown video: a no_changes, or a kind 'correction', would tell the contributor the stream exists.
  // It is stored as a correction all the same, since admin reviews it as one of that stream (#8).
  for (const [status, videoId] of NOT_PUBLIC) {
    const id = created(await submit(f, videoId, [SONG_A_EARLY]), 'new');
    assert.equal(storedKind(f, id), 'correction', `a ${status} stream's submission is stored as a correction`);
  }
  // An archived VOD's correction is one both ways; a video with no stream is new both ways.
  assert.equal(storedKind(f, created(await submit(f, 'vidPUB00001', [{ ...SONG_A, start_timestamp: '0:01:41' }]), 'correction')), 'correction');
  assert.equal(storedKind(f, created(await submit(f, 'vidNEW00001', [SONG_A]), 'new')), 'new');
  close(f);
}

async function testApprovedNovaRowNoLongerBlocks() {
  const f = fixture();
  addNovaVod(f, 'vod-approved', 'mizuki', 'vidNOVA00001', 'approved');
  created(await submit(f, 'vidNOVA00001', [SONG_A]), 'new');
  assert.equal(count(f.db, 'vod_submissions'), 2);

  // The usual archived VOD got there through an approved submission of its own, which used to block twice over.
  addNovaVod(f, 'vod-archived', 'mizuki', 'vidPUB00001', 'approved');
  created(await submit(f, 'vidPUB00001', [{ ...SONG_A, start_timestamp: '0:01:41' }]), 'correction');
  assert.equal(count(f.db, 'vod_submissions'), 4);
  close(f);
}

async function testArchivedStreamWithoutPublicRows() {
  const f = fixture();
  // Approved stream, but its only performance is pending: its public list is empty, and it is still archived.
  f.adminDb.sqlite.exec(`
    INSERT INTO streams (id,streamer_id,title,date,video_id,youtube_url,status) VALUES
      ('s-empty','mizuki','Empty','2026-09-06','vidEMPT0001','https://example.com','approved');
    INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status) VALUES
      ('p-empty','mizuki','song-a','s-empty','2026-09-06','Empty','vidEMPT0001',50,60,'pending');
  `);
  assert.deepEqual(await current(f, 'mizuki', 'vidEMPT0001'), {
    status: 200,
    body: { archived: true, text: '', revision: await publicListRevision('mizuki', 'vidEMPT0001', []) },
  }, 'an empty list has a revision too');
  assert.deepEqual((await check(f, 'mizuki', 'vidEMPT0001')).body, {
    exists: true, archived: true, count: 0, hasApproved: false, pendingCount: 0, rejectedCount: 0, latestStatus: null,
  });
  created(await submit(f, 'vidEMPT0001', [SONG_A]), 'correction');
  close(f);
}

async function testCorrectionStoresItsBase() {
  const f = fixture();
  // Beside Song A: an earlier row, a row at Song A's start whose id sorts first, a row without an
  // end, and two rows the site does not show (a pending performance, the performance of a pending song).
  f.adminDb.sqlite.exec(`
    INSERT INTO streams (id,streamer_id,title,date,video_id,youtube_url,status) VALUES
      ('s-empty','mizuki','Empty','2026-09-06','vidEMPT0001','https://example.com','approved');
    INSERT INTO songs (id,streamer_id,title,original_artist,status) VALUES
      ('song-z','mizuki','Song Z','Band Z','approved'),
      ('song-pending','mizuki','Song P','Artist','pending');
    INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status) VALUES
      ('p-pub-early','mizuki','song-z','s-pub','2026-09-01','Public','vidPUB00001',40,90,'approved'),
      ('p-aaa','mizuki','song-z','s-pub','2026-09-01','Public','vidPUB00001',100,150,'approved'),
      ('p-pub-open','mizuki','song-z','s-pub','2026-09-01','Public','vidPUB00001',1000,NULL,'approved'),
      ('p-pub-pending','mizuki','song-a','s-pub','2026-09-01','Public','vidPUB00001',700,800,'pending'),
      ('p-pub-pending-song','mizuki','song-pending','s-pub','2026-09-01','Public','vidPUB00001',900,950,'approved'),
      ('p-empty','mizuki','song-a','s-empty','2026-09-06','Empty','vidEMPT0001',50,60,'pending');
  `);

  // An archived VOD: the public list it was compared against, by start, then performance id, exactly these keys.
  const id = created(await submit(f, 'vidPUB00001', [{ ...SONG_A, start_timestamp: '0:01:41' }]), 'correction');
  assert.equal(storedBase(f, id), JSON.stringify([
    { performance_id: 'p-pub-early', song_title: 'Song Z', original_artist: 'Band Z', start_timestamp: 40, end_timestamp: 90 },
    { performance_id: 'p-aaa', song_title: 'Song Z', original_artist: 'Band Z', start_timestamp: 100, end_timestamp: 150 },
    { performance_id: 'p-pub', song_title: 'Song A', original_artist: 'Artist', start_timestamp: 100, end_timestamp: 200 },
    { performance_id: 'p-pub-open', song_title: 'Song Z', original_artist: 'Band Z', start_timestamp: 1000, end_timestamp: null },
  ]));

  // An archived VOD with nothing public, and every stream the public cannot see: nothing to compare against.
  assert.equal(storedBase(f, created(await submit(f, 'vidEMPT0001', [SONG_A]), 'correction')), '[]');
  for (const [status, videoId] of NOT_PUBLIC) {
    assert.equal(storedBase(f, created(await submit(f, videoId, [SONG_A_EARLY]), 'new')), '[]', `a ${status} stream`);
  }
  // A video with no stream at all.
  assert.equal(storedBase(f, created(await submit(f, 'vidNEW00001', [SONG_A]), 'new')), null);
  close(f);
}

async function testALoadedSubmissionRecordsAVerifiedBase() {
  // The revision /vod/api/current gave with the list says the form loaded the very list the submission is compared
  // against, so that list is where the contributor started: the submission records its base as verified.
  const f = fixture();
  const loaded = await revisionOf(f, 'mizuki', 'vidPUB00001');
  const id = created(await submit(f, 'vidPUB00001', [{ ...SONG_A, start_timestamp: '0:01:41' }], 'mizuki', { base_revision: loaded }), 'correction');
  assert.equal(storedVerified(f, id), 1, 'the revision confirms the base');
  assert.equal(storedBase(f, id), JSON.stringify([SONG_A_ROW]), 'the base it confirms is the loaded list');

  // What counts is that a base is recorded, which any admin stream gives, not that the stream is approved: a stream
  // in the pipeline has the empty list as its base, and the empty list's revision confirms it.
  for (const [status, videoId] of NOT_PUBLIC) {
    const emptyList = await publicListRevision('mizuki', videoId, []);
    const piped = created(await submit(f, videoId, [SONG_A_EARLY], 'mizuki', { base_revision: emptyList }), 'new');
    assert.equal(storedBase(f, piped), '[]', `a ${status} stream's base`);
    assert.equal(storedVerified(f, piped), 1, `a ${status} stream's empty list, confirmed`);
  }
  close(f);
}

async function testAnUnloadedSubmissionRecordsAnUnverifiedBase() {
  // The same corrections without a base_revision: the form loaded no list (the contributor pasted one, or another
  // client sent it), so nothing says where they started. The base is still the public list as it stood at submit
  // time, and it is not confirmed.
  const f = fixture();
  const id = created(await submit(f, 'vidPUB00001', [{ ...SONG_A, start_timestamp: '0:01:41' }]), 'correction');
  assert.equal(storedVerified(f, id), 0, 'no revision, no confirmation');
  assert.equal(storedBase(f, id), JSON.stringify([SONG_A_ROW]), 'the base is recorded all the same');
  for (const [status, videoId] of NOT_PUBLIC) {
    const piped = created(await submit(f, videoId, [SONG_A_EARLY]), 'new');
    assert.equal(storedBase(f, piped), '[]', `a ${status} stream's base`);
    assert.equal(storedVerified(f, piped), 0, `a ${status} stream, unconfirmed`);
  }
  close(f);
}

async function testANewVodRecordsAnUnverifiedBase() {
  // A video with no admin stream has no base, so there is nothing for a revision to confirm: not even the empty
  // list's, which the route accepts for it as it does for a stream in the pipeline.
  const f = fixture();
  const plain = created(await submit(f, 'vidNEW00001', [SONG_A]), 'new');
  assert.equal(storedBase(f, plain), null);
  assert.equal(storedVerified(f, plain), 0);
  const emptyList = await publicListRevision('mizuki', 'vidNEW00001', []);
  const sent = created(await submit(f, 'vidNEW00001', [SONG_A], 'mizuki', { base_revision: emptyList }), 'new');
  assert.equal(storedBase(f, sent), null);
  assert.equal(storedVerified(f, sent), 0, 'the empty list\'s revision confirms no base, since none is recorded');
  close(f);
}

async function testBaseNeverInListQueries() {
  // NULL against '[]' tells a stream the public cannot see from no stream at all, and so does base_verified, which a
  // pipeline stream's empty-list revision sets and no stream never does: only the admin's read of one submission may
  // select base_songs or base_verified, and no Nova query reads either.
  const f = fixture();
  created(await submit(f, 'vidPUB00001', [{ ...SONG_A, start_timestamp: '0:01:41' }]), 'correction');
  created(await submit(f, 'vidPIPE0001', [SONG_A_EARLY]), 'new');
  created(await submit(f, 'vidNEW00001', [SONG_A]), 'new');
  const rows = await listAllVodSubmissions(f.db.binding);
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), [
      'id', 'kind', 'reviewed_at', 'reviewer_note', 'song_count', 'status', 'stream_date', 'stream_title', 'streamer_slug', 'submitted_at', 'video_id',
    ], 'the status page reads the summary columns only');
  }
  close(f);

  // Every statement in the worker's source that reads vod_submissions names its columns, and none names base_songs or base_verified.
  const src = new URL('../src/', import.meta.url);
  const reads = readdirSync(src)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .flatMap((file) => [...readFileSync(new URL(file, src), 'utf8').matchAll(/\.prepare\(\s*(`[^`]*`|'[^']*'|"[^"]*")/g)].map((match) => match[1]))
    .filter((sql) => /\bSELECT\b/i.test(sql) && /\bvod_submissions\b/.test(sql));
  assert.ok(reads.length >= 2, 'the scan finds the status page and check queries');
  for (const sql of reads) {
    assert.ok(!/\bbase_songs\b/.test(sql), `no read selects base_songs: ${sql}`);
    assert.ok(!/\bbase_verified\b/.test(sql), `no read selects base_verified: ${sql}`);
    assert.ok(!/SELECT\s+\*|\w\.\*/i.test(sql), `no read selects every column: ${sql}`);
  }
}

// --- GET /vod/api/current ---

async function testCurrentApproved() {
  const f = fixture();
  const a = await current(f, 'mizuki', 'vidPUB00001');
  assert.deepEqual(a, {
    status: 200,
    body: { archived: true, text: SONG_A_LINE, revision: await publicListRevision('mizuki', 'vidPUB00001', [SONG_A_ROW]) },
  }, 'the list comes with the revision of exactly its public rows');
  assert.match((a.body as { revision: string }).revision, /^[0-9a-f]{64}$/, 'a SHA-256 digest in lowercase hex');
  close(f);
}

async function testCurrentHidesPipeline() {
  const f = fixture();
  const unknown = await current(f, 'mizuki', 'vidNEW00001');
  assert.deepEqual(unknown, { status: 200, body: { archived: false, text: '' } });
  for (const [status, videoId] of NOT_PUBLIC) {
    assert.deepEqual(await current(f, 'mizuki', videoId), unknown, `a ${status} stream answers as an unknown video`);
  }
  // Byte for byte, and with no revision on either side: a revision would describe a list the public cannot see.
  const raw = async (videoId: string) => (await app.request(`/vod/api/current?${query('mizuki', videoId)}`, { headers: SAME_ORIGIN }, f.env)).text();
  const unknownText = await raw('vidNEW00001');
  assert.equal(unknownText, '{"archived":false,"text":""}');
  for (const [status, videoId] of NOT_PUBLIC) {
    assert.equal(await raw(videoId), unknownText, `a ${status} stream's body is the unknown video's, byte for byte`);
  }
  close(f);
}

async function testCurrentSkipsPendingRows() {
  const f = fixture();
  f.adminDb.sqlite.exec(`
    INSERT INTO songs (id,streamer_id,title,original_artist,status) VALUES ('song-pending','mizuki','Song P','Artist','pending');
    INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status) VALUES
      ('p-pending','mizuki','song-a','s-pub','2026-09-01','Public','vidPUB00001',300,400,'pending'),
      ('p-pending-song','mizuki','song-pending','s-pub','2026-09-01','Public','vidPUB00001',500,600,'approved');
  `);
  assert.deepEqual(await current(f, 'mizuki', 'vidPUB00001'), {
    status: 200,
    body: { archived: true, text: SONG_A_LINE, revision: await publicListRevision('mizuki', 'vidPUB00001', [SONG_A_ROW]) },
  }, 'neither the pending performance nor the approved performance of a pending song is listed, nor in the revision');
  close(f);
}

async function testCurrentUntrusted() {
  const f = fixture();
  const forbidden = { status: 403, body: { error: 'Forbidden' } };
  assert.deepEqual(await current(f, 'mizuki', 'vidPUB00001', {}), forbidden, 'no same-origin signal');
  assert.deepEqual(
    await current(f, 'mizuki', 'vidPUB00001', { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' }),
    forbidden,
    'a foreign page',
  );
  const missing = await answer(await app.request('/vod/api/current', {}, f.env));
  assert.deepEqual(missing, forbidden, 'the gate runs before the parameter checks');
  close(f);
}

async function testCurrentAllowsAurora() {
  const f = fixture();
  // What a browser sends from Aurora: cross-site, with Aurora's origin.
  const headers = { Origin: 'https://aurora.oshi.tw', 'Sec-Fetch-Site': 'cross-site' };
  const response = await app.request(`/vod/api/current?${query('mizuki', 'vidPUB00001')}`, { headers }, f.env);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://aurora.oshi.tw');
  assert.deepEqual(await answer(response), {
    status: 200,
    body: { archived: true, text: SONG_A_LINE, revision: await publicListRevision('mizuki', 'vidPUB00001', [SONG_A_ROW]) },
  });
  close(f);
}

async function testCurrentRejectsBadInput() {
  const f = fixture();
  const get = async (path: string) => (await answer(await app.request(path, { headers: SAME_ORIGIN }, f.env))).status;
  const url = encodeURIComponent('https://www.youtube.com/watch?v=vidPUB00001');
  assert.equal(await get('/vod/api/current'), 400, 'no parameters');
  assert.equal(await get(`/vod/api/current?url=${url}`), 400, 'no streamer_slug');
  assert.equal(await get('/vod/api/current?streamer_slug=mizuki'), 400, 'no url');
  assert.equal(await get(`/vod/api/current?streamer_slug=mizuki&url=${encodeURIComponent('https://example.com/watch')}`), 400, 'not a YouTube video URL');
  close(f);
}

// --- GET /vod/api/check ---

async function testCheckArchived() {
  const f = fixture();
  assert.deepEqual(await check(f, 'mizuki', 'vidPUB00001'), {
    status: 200,
    body: { exists: true, archived: true, count: 0, hasApproved: false, pendingCount: 0, rejectedCount: 0, latestStatus: null },
  });
  addNovaVod(f, 'vod-pending', 'mizuki', 'vidPUB00001', 'pending');
  assert.deepEqual((await check(f, 'mizuki', 'vidPUB00001')).body, {
    exists: true, archived: true, count: 1, hasApproved: false, pendingCount: 1, rejectedCount: 0, latestStatus: 'pending',
  }, 'the Nova submission counts still arrive beside archived');
  close(f);
}

async function testCheckNoLeak() {
  const f = fixture();
  const unknown = await check(f, 'mizuki', 'vidNEW00001');
  assert.deepEqual(unknown, {
    status: 200,
    body: { exists: false, archived: false, count: 0, hasApproved: false, pendingCount: 0, rejectedCount: 0, latestStatus: null },
  });
  for (const [status, videoId] of NOT_PUBLIC) {
    const a = await check(f, 'mizuki', videoId);
    const body = a.body as Record<string, unknown>;
    assert.ok(!('inAdmin' in body) && !('adminStatus' in body), `a ${status} stream's answer names no admin state`);
    assert.equal(body.archived, false);
    assert.equal(body.exists, false);
    assert.deepEqual(a, unknown, `a ${status} stream answers as an unknown video`);
  }

  // With Nova submissions on file the counts are all that is reported, with or without the pipeline stream.
  addNovaVod(f, 'vod-pipe', 'mizuki', 'vidPIPE0001', 'pending');
  addNovaVod(f, 'vod-plain', 'mizuki', 'vidNEW00001', 'pending');
  const withStream = await check(f, 'mizuki', 'vidPIPE0001');
  assert.deepEqual(withStream, await check(f, 'mizuki', 'vidNEW00001'));
  assert.deepEqual(withStream.body, {
    exists: true, archived: false, count: 1, hasApproved: false, pendingCount: 1, rejectedCount: 0, latestStatus: 'pending',
  });

  const junk = (await answer(await app.request('/vod/api/check?streamer_slug=mizuki&url=not-a-video', {}, f.env))).body as Record<string, unknown>;
  assert.ok(!('inAdmin' in junk) && !('adminStatus' in junk));
  close(f);
}

// --- one video, two streamers ---

async function testCollabIsKeyedPerStreamer() {
  const f = fixture();
  // vidCOLL0001 is public under both streamers with different lists; under vidCOLL0002 gabu's copy is still in the pipeline.
  f.adminDb.sqlite.exec(`
    INSERT INTO streams (id,streamer_id,title,date,video_id,youtube_url,status) VALUES
      ('s-coll-m','mizuki','Collab','2026-09-07','vidCOLL0001','https://example.com','approved'),
      ('s-coll-g','gabu','Collab','2026-09-07','vidCOLL0001','https://example.com','approved'),
      ('s-coll2-m','mizuki','Collab 2','2026-09-08','vidCOLL0002','https://example.com','approved'),
      ('s-coll2-g','gabu','Collab 2','2026-09-08','vidCOLL0002','https://example.com','pending');
    INSERT INTO songs (id,streamer_id,title,original_artist,status) VALUES ('song-g','gabu','Song G','Artist G','approved');
    INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status) VALUES
      ('p-coll-m','mizuki','song-a','s-coll-m','2026-09-07','Collab','vidCOLL0001',100,200,'approved'),
      ('p-coll-g','gabu','song-g','s-coll-g','2026-09-07','Collab','vidCOLL0001',30,90,'approved'),
      ('p-coll2-m','mizuki','song-a','s-coll2-m','2026-09-08','Collab 2','vidCOLL0002',100,200,'approved'),
      ('p-coll2-g','gabu','song-g','s-coll2-g','2026-09-08','Collab 2','vidCOLL0002',30,90,'approved');
  `);

  const archivedOf = async (slug: string, videoId: string) => ((await check(f, slug, videoId)).body as { archived: boolean }).archived;
  const mizukiRow = (performanceId: string): PublicStreamSong => ({ ...SONG_A_ROW, performance_id: performanceId });

  assert.deepEqual((await current(f, 'mizuki', 'vidCOLL0001')).body, {
    archived: true, text: SONG_A_LINE, revision: await publicListRevision('mizuki', 'vidCOLL0001', [mizukiRow('p-coll-m')]),
  });
  assert.deepEqual((await current(f, 'gabu', 'vidCOLL0001')).body, {
    archived: true,
    text: '01. 0:00:30 ~ 0:01:30 Song G / Artist G',
    revision: await publicListRevision('gabu', 'vidCOLL0001', [
      { performance_id: 'p-coll-g', song_title: 'Song G', original_artist: 'Artist G', start_timestamp: 30, end_timestamp: 90 },
    ]),
  });
  assert.equal(await archivedOf('gabu', 'vidCOLL0001'), true);

  // Mizuki's own list is nothing new to mizuki, and a correction of gabu's.
  assert.deepEqual(await submit(f, 'vidCOLL0001', [SONG_A], 'mizuki'), { status: 422, body: { error: 'no_changes' } });
  created(await submit(f, 'vidCOLL0001', [SONG_A], 'gabu'), 'correction');

  // Public for mizuki, in the pipeline for gabu: gabu's answers must not see mizuki's stream.
  assert.deepEqual((await current(f, 'mizuki', 'vidCOLL0002')).body, {
    archived: true, text: SONG_A_LINE, revision: await publicListRevision('mizuki', 'vidCOLL0002', [mizukiRow('p-coll2-m')]),
  });
  assert.deepEqual(await current(f, 'gabu', 'vidCOLL0002'), { status: 200, body: { archived: false, text: '' } });
  assert.equal(await archivedOf('gabu', 'vidCOLL0002'), false);
  created(await submit(f, 'vidCOLL0002', [SONG_A], 'gabu'), 'new');
  assert.deepEqual(await submit(f, 'vidCOLL0002', [SONG_A], 'mizuki'), { status: 422, body: { error: 'no_changes' } });
  close(f);
}

// --- the leak check: a stream the public cannot see reads exactly as no stream at all ---

const DIFF_VIDEO = 'vidDIFF0001';

/** GET /status?vod=<vod> as the public gets it, with the edge cache missing. Each response has its own nonce. */
async function statusPage(f: Fixture, vod: string): Promise<string> {
  const globals = globalThis as unknown as { caches?: unknown };
  const saved = globals.caches;
  globals.caches = { default: { match: async () => undefined, put: async () => {} } };
  const scheduled: Array<Promise<unknown>> = [];
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => { scheduled.push(promise); },
    passThroughOnException: () => {},
    props: {},
  } as unknown as ExecutionContext;
  try {
    const response = await app.request(`/status?vod=${vod}`, {}, f.env, ctx);
    assert.equal(response.status, 200);
    const html = await response.text();
    await Promise.all(scheduled);
    const nonce = /nonce="([^"]+)"/.exec(html)?.[1];
    assert.ok(nonce, 'the page carries a nonce');
    return html.replaceAll(nonce, 'NONCE');
  } finally {
    globals.caches = saved;
  }
}

/** Two pages are the same; on a difference, say where, since a whole page is too long to diff. */
function assertSamePage(actual: string, expected: string, message: string): void {
  if (actual === expected) return;
  let at = 0;
  while (at < actual.length && actual[at] === expected[at]) at++;
  const around = (page: string) => page.slice(Math.max(0, at - 80), at + 80);
  assert.fail(`${message}: the pages differ at ${at}: expected …${around(expected)}…, got …${around(actual)}…`);
}

async function testPipelineCorrectionReadsLikeAnUnknownVideo() {
  // Finding #8's leak check. Two databases differ in one fact only: whether the admin DB has a stream
  // for the video, in a status the public cannot see. Nova then stores different facts (the kind, and
  // the base '[]' against NULL), but everything a contributor can reach reads the same: the submit
  // answer, check, current, and /status under every filter, with the submission pending, approved or
  // rejected. The stream holds an approved row and a title of its own, so a page that read it would show.
  for (const [streamStatus] of NOT_PUBLIC) {
    for (const ownStatus of ['pending', 'approved', 'rejected'] as const) {
      const label = `a ${streamStatus} stream, the submission ${ownStatus}`;
      const unknown = fixture();
      const piped = fixture();
      piped.adminDb.sqlite.exec(`
        INSERT INTO streams (id,streamer_id,title,date,video_id,youtube_url,status) VALUES
          ('s-diff','mizuki','Pipeline Title','2026-09-09','${DIFF_VIDEO}','https://example.com','${streamStatus}');
        INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status) VALUES
          ('p-diff','mizuki','song-a','s-diff','2026-09-09','Pipeline Title','${DIFF_VIDEO}',10,20,'approved');
      `);
      const answers: Answer[] = [];
      const ids: string[] = [];
      for (const f of [unknown, piped]) {
        const a = await submit(f, DIFF_VIDEO, [SONG_A_EARLY]);
        const id = created(a, 'new');
        // What admin's review leaves, and one submission time for both.
        f.db.sqlite.prepare('UPDATE vod_submissions SET status = ?, reviewer_note = ?, reviewed_at = ?, submitted_at = ? WHERE id = ?').run(
          ownStatus,
          ownStatus === 'rejected' ? '時間軸錯誤' : '',
          ownStatus === 'pending' ? null : '2026-09-10 12:00:00',
          '2026-09-09 12:00:00',
          id,
        );
        answers.push({ status: a.status, body: { ...(a.body as object), id: 'vod-ID' } });
        ids.push(id);
      }
      assert.deepEqual([storedKind(unknown, ids[0]), storedKind(piped, ids[1])], ['new', 'correction'], `${label}: the stored kinds differ`);
      assert.deepEqual([storedBase(unknown, ids[0]), storedBase(piped, ids[1])], [null, '[]'], `${label}: so do the bases`);

      assert.deepEqual(answers[1], answers[0], `${label}: the submit answer`);
      assert.deepEqual(await check(piped, 'mizuki', DIFF_VIDEO), await check(unknown, 'mizuki', DIFF_VIDEO), `${label}: check`);
      assert.deepEqual(await current(piped, 'mizuki', DIFF_VIDEO), await current(unknown, 'mizuki', DIFF_VIDEO), `${label}: current`);
      for (const vod of VOD_FILTERS) {
        assertSamePage(await statusPage(piped, vod), await statusPage(unknown, vod), `${label}: /status?vod=${vod}`);
      }
      close(unknown);
      close(piped);
    }
  }
}

// --- the list revision: /vod/api/current gives it, and a correction sends it back as base_revision ---

const LIST_CHANGED = { status: 409, body: { error: 'list_changed' } };
const NO_CHANGES = { status: 422, body: { error: 'no_changes' } };

async function testRevisionIsTheDigestOfTheList() {
  // SHA-256 in lowercase hex of the JSON [slug, video id, rows], each row an array in the order
  // performance_id, song_title, original_artist, start_timestamp, end_timestamp.
  const rows: PublicStreamSong[] = [
    SONG_A_ROW,
    { performance_id: 'p-open', song_title: 'Song "Z" / Live', original_artist: '', start_timestamp: 300, end_timestamp: null },
  ];
  const expected = createHash('sha256')
    .update(JSON.stringify(['mizuki', 'vidPUB00001', [['p-pub', 'Song A', 'Artist', 100, 200], ['p-open', 'Song "Z" / Live', '', 300, null]]]))
    .digest('hex');
  assert.equal(await publicListRevision('mizuki', 'vidPUB00001', rows), expected);
  // The streamer and the video are part of it: the same rows, or none, elsewhere have another revision.
  const empty = await publicListRevision('mizuki', 'vidPUB00001', []);
  assert.notEqual(await publicListRevision('gabu', 'vidPUB00001', rows), expected, 'another streamer');
  assert.notEqual(await publicListRevision('mizuki', 'vidPUB00002', rows), expected, 'another video');
  assert.notEqual(await publicListRevision('gabu', 'vidPUB00001', []), empty, 'another streamer, empty');
  assert.notEqual(await publicListRevision('mizuki', 'vidPUB00002', []), empty, 'another video, empty');
  assert.notEqual(await publicListRevision('mizuki', 'vidPUB00001', [...rows].reverse()), expected, 'the order counts');
}

async function testRevisionFollowsThePublicList() {
  // Beside Song A, two rows the site does not show: a pending performance, and the approved performance of a pending song.
  const hidden = `
    INSERT INTO songs (id,streamer_id,title,original_artist,status) VALUES ('song-pending','mizuki','Song P','Artist','pending');
    INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status) VALUES
      ('p-hidden','mizuki','song-a','s-pub','2026-09-01','Public','vidPUB00001',300,400,'pending'),
      ('p-hidden-song','mizuki','song-pending','s-pub','2026-09-01','Public','vidPUB00001',500,600,'approved');
  `;
  const insertPublic = (id: string, start: number, end: number, status = 'approved') =>
    `INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status) VALUES
      ('${id}','mizuki','song-a','s-pub','2026-09-01','Public','vidPUB00001',${start},${end},'${status}')`;
  const cases: Array<[string, string, boolean]> = [
    ['a public row\'s start', "UPDATE performances SET timestamp = 101 WHERE id = 'p-pub'", true],
    ['a public row\'s end', "UPDATE performances SET end_timestamp = 201 WHERE id = 'p-pub'", true],
    ['a public row\'s end, cleared', "UPDATE performances SET end_timestamp = NULL WHERE id = 'p-pub'", true],
    ['a public row\'s title', "UPDATE songs SET title = 'Song A (Live)' WHERE id = 'song-a'", true],
    ['a public row\'s artist', "UPDATE songs SET original_artist = 'Another Artist' WHERE id = 'song-a'", true],
    ['a public row\'s performance', `DELETE FROM performances WHERE id = 'p-pub'; ${insertPublic('p-pub-2', 100, 200)}`, true],
    ['a public row added', insertPublic('p-pub-new', 700, 800), true],
    ['a hidden row published', "UPDATE performances SET status = 'approved' WHERE id = 'p-hidden'", true],
    ['the public row removed', "UPDATE performances SET status = 'pending' WHERE id = 'p-pub'", true],
    ['a pending performance\'s time', "UPDATE performances SET timestamp = 350 WHERE id = 'p-hidden'", false],
    ['a pending song\'s title', "UPDATE songs SET title = 'Song P2' WHERE id = 'song-pending'", false],
    ['a pending performance added', insertPublic('p-hidden-2', 900, 950, 'pending'), false],
    ['a row of a stream in the pipeline', "UPDATE performances SET timestamp = 15 WHERE id = 'p-pipe'", false],
    ['the stream\'s own title', "UPDATE streams SET title = 'Renamed' WHERE id = 's-pub'", false],
  ];
  for (const [label, sql, changes] of cases) {
    const f = fixture();
    f.adminDb.sqlite.exec(hidden);
    const before = await revisionOf(f, 'mizuki', 'vidPUB00001');
    assert.equal(await revisionOf(f, 'mizuki', 'vidPUB00001'), before, 'the same list reads back the same revision');
    const textBefore = (await current(f, 'mizuki', 'vidPUB00001')).body;
    f.adminDb.sqlite.exec(sql);
    const after = await revisionOf(f, 'mizuki', 'vidPUB00001');
    if (changes) {
      assert.notEqual(after, before, `${label} changes the revision`);
    } else {
      assert.equal(after, before, `${label} leaves the revision alone`);
      assert.deepEqual((await current(f, 'mizuki', 'vidPUB00001')).body, textBefore, `${label} leaves the whole answer alone`);
    }
    if (label === 'a public row\'s performance') {
      assert.equal(((await current(f, 'mizuki', 'vidPUB00001')).body as { text: string }).text, SONG_A_LINE, 'the text cannot tell the two performances apart');
    }
    close(f);
  }
}

async function testTheLoadedRevisionIsAccepted() {
  // Sent back unchanged, the revision says the public list is still the one that was loaded: the
  // submission is stored with that list as its base.
  const f = fixture();
  const loaded = (await current(f, 'mizuki', 'vidPUB00001')).body as { text: string; revision: string };
  const id = created(await submit(f, 'vidPUB00001', [{ ...SONG_A, start_timestamp: '0:01:41' }], 'mizuki', { base_revision: loaded.revision }), 'correction');
  const base = storedBase(f, id);
  assert.equal(base, JSON.stringify([SONG_A_ROW]), 'the stored base is the loaded list');
  assert.equal(formatSongsForPaste(JSON.parse(String(base)) as PublicStreamSong[]), loaded.text, 'the list whose text the form loaded');
  assert.equal(await publicListRevision('mizuki', 'vidPUB00001', JSON.parse(String(base)) as PublicStreamSong[]), loaded.revision, 'and whose revision it sent');
  // A match decides nothing else: a list that repeats the public one still changes nothing.
  assert.deepEqual(await submit(f, 'vidPUB00001', [SONG_A], 'mizuki', { base_revision: loaded.revision }), NO_CHANGES);

  // An archived VOD with nothing public: the revision of its empty list is accepted, with an empty base.
  f.adminDb.sqlite.exec(`
    INSERT INTO streams (id,streamer_id,title,date,video_id,youtube_url,status) VALUES
      ('s-empty','mizuki','Empty','2026-09-06','vidEMPT0001','https://example.com','approved');
  `);
  const empty = await revisionOf(f, 'mizuki', 'vidEMPT0001');
  assert.equal(storedBase(f, created(await submit(f, 'vidEMPT0001', [SONG_A], 'mizuki', { base_revision: empty }), 'correction')), '[]');
  close(f);
}

async function testAListThatChangedSinceItWasLoadedIsRefused() {
  // The contributor loads the list; then a curator moves Song A from 0:01:40 to 0:01:50.
  const f = fixture();
  const loaded = await revisionOf(f, 'mizuki', 'vidPUB00001');
  f.adminDb.sqlite.exec("UPDATE performances SET timestamp = 110 WHERE id = 'p-pub'");
  const before = [count(f.db, 'vod_submissions'), count(f.db, 'vod_songs')];

  // A list equal to the new public list shows the order: without a revision it is no_changes, but it was
  // corrected against the list as it was, so with the old revision it is list_changed first.
  const asPublishedNow: SongInput = { ...SONG_A, start_timestamp: '0:01:50' };
  assert.deepEqual(await submit(f, 'vidPUB00001', [asPublishedNow]), NO_CHANGES);
  assert.deepEqual(await submit(f, 'vidPUB00001', [asPublishedNow], 'mizuki', { base_revision: loaded }), LIST_CHANGED);
  // The contributor's untouched row still says 0:01:40: never read as their change against the curator's 0:01:50.
  assert.deepEqual(await submit(f, 'vidPUB00001', [SONG_A], 'mizuki', { base_revision: loaded }), LIST_CHANGED);
  assert.deepEqual(await submit(f, 'vidPUB00001', [{ ...SONG_A, end_timestamp: '0:03:30' }], 'mizuki', { base_revision: loaded }), LIST_CHANGED);
  assert.deepEqual([count(f.db, 'vod_submissions'), count(f.db, 'vod_songs')], before, 'nothing is stored');
  assert.deepEqual(outbound.filter((url) => !url.includes(TURNSTILE)), [], 'a refused list spends no YouTube lookup');

  // Reloaded, the list has a new revision, and a correction made against it is accepted.
  const reloaded = await revisionOf(f, 'mizuki', 'vidPUB00001');
  assert.notEqual(reloaded, loaded);
  const id = created(await submit(f, 'vidPUB00001', [{ ...asPublishedNow, end_timestamp: '0:03:30' }], 'mizuki', { base_revision: reloaded }), 'correction');
  assert.equal(storedBase(f, id), JSON.stringify([{ ...SONG_A_ROW, start_timestamp: 110 }]));
  close(f);
}

async function testAMalformedRevisionIsRefusedBeforeTurnstile() {
  // Only the key's absence means no revision. Anything else that is not 64 lowercase hex characters is refused
  // with the other field checks, before Turnstile is asked, so the contributor's token is not spent.
  const f = fixture();
  const revision = await revisionOf(f, 'mizuki', 'vidPUB00001');
  const before = [count(f.db, 'vod_submissions'), count(f.db, 'vod_songs')];
  for (const value of ['A'.repeat(64), revision.toUpperCase(), 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64), ` ${revision}`, `${revision}\n`, '', null, 42, [revision], { revision }]) {
    assert.deepEqual(
      await submit(f, 'vidPUB00001', [{ ...SONG_A, start_timestamp: '0:01:41' }], 'mizuki', { base_revision: value }),
      { status: 400, body: { error: '無效的歌單版本' } },
      `base_revision ${JSON.stringify(value)}`,
    );
  }
  assert.deepEqual(outbound, [], 'Turnstile is never asked');
  assert.deepEqual([count(f.db, 'vod_submissions'), count(f.db, 'vod_songs')], before, 'nothing is stored');
  close(f);
}

async function testARevisionReadsAlikeForAPipelineStreamAndNone() {
  // The public list of a stream that is not approved is empty, as for a video with no stream at all, so each
  // submission gets the same status, body and public kind for both: with no revision, with a stale one, with
  // the revision of the empty list, and with a malformed one. The stale one is the revision the pipeline
  // stream's approved row would have if it were public: a check that read that row would accept it for one side
  // only. The malformed one is refused before anything reads the admin DB, so both sides get the same 400.
  const emptyList = await publicListRevision('mizuki', DIFF_VIDEO, []);
  const stale = await publicListRevision('mizuki', DIFF_VIDEO, [{ ...SONG_A_ROW, performance_id: 'p-diff', start_timestamp: 10, end_timestamp: 20 }]);
  const cases: Array<[string, Record<string, unknown>, Answer]> = [
    ['no revision', {}, { status: 201, body: { id: 'vod-ID', kind: 'new' } }],
    ['a stale revision', { base_revision: stale }, LIST_CHANGED],
    ['the revision of the empty list', { base_revision: emptyList }, { status: 201, body: { id: 'vod-ID', kind: 'new' } }],
    ['a malformed revision', { base_revision: emptyList.toUpperCase() }, { status: 400, body: { error: '無效的歌單版本' } }],
  ];
  for (const [streamStatus] of NOT_PUBLIC) {
    const unknown = fixture();
    const piped = fixture();
    piped.adminDb.sqlite.exec(`
      INSERT INTO streams (id,streamer_id,title,date,video_id,youtube_url,status) VALUES
        ('s-diff','mizuki','Pipeline Title','2026-09-09','${DIFF_VIDEO}','https://example.com','${streamStatus}');
      INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status) VALUES
        ('p-diff','mizuki','song-a','s-diff','2026-09-09','Pipeline Title','${DIFF_VIDEO}',10,20,'approved');
    `);
    for (const [label, extra, expected] of cases) {
      const answers: Answer[] = [];
      for (const f of [unknown, piped]) {
        const a = await submit(f, DIFF_VIDEO, [SONG_A_EARLY], 'mizuki', extra);
        if (a.status === 201) created(a, 'new');
        answers.push(a.status === 201 ? { status: a.status, body: { ...(a.body as object), id: 'vod-ID' } } : a);
      }
      assert.deepEqual(answers[0], expected, `no stream, ${label}`);
      assert.deepEqual(answers[1], answers[0], `a ${streamStatus} stream, ${label}: the same answer as no stream`);
    }
    close(unknown);
    close(piped);
  }
}

const tests = [
  testNewVideoIsNew,
  testArchivedDifferentIsCorrection,
  testArchivedIdenticalIsNoChanges,
  testSpacedSlashTitleSurvivesTheForm,
  testMissingEndSurvivesTheForm,
  testStartOnlyPasteIsNoChange,
  testStartOnlyPasteOverAnOverlappingArchiveIsNoChange,
  testARenamedNextRowKeepsTheEndBeforeIt,
  testMovedBoundaryNeverStoresAnOverlap,
  testStartOnlyPasteKeepsTheFillBeforeAMovedOrNewRow,
  testBlankTitleRowIsNotTheNextRow,
  testBareSlashTitleOnlyPasteIsNoChange,
  testDashTitleOnlyPasteIsNoChange,
  testBlankArtistIsNoChange,
  testInvertedRowIsRefused,
  testAListOutOfTimeOrderIsRefused,
  testEqualStartsAreInOrder,
  testANewSongAtAnArchivedStartIsAccepted,
  testTheAppendedSongRestoresTheUntouchedRow,
  testAnEndTheRestoreGivesBackIsNeverRefused,
  testAnEndFilledFromABlankLineIsDerived,
  testAnEndFilledFromABlankLineIsRestoredBesideARealChange,
  testTheLoadedListPlusABlankLineIsUnchanged,
  testABlankRowRefillsOnlyTheEndRightAboveIt,
  testAnEndOfZeroIsAnEnd,
  testATimeThatIsNeitherTextNorANumberIsMalformed,
  testPipelineAndExcludedAreAccepted,
  testApprovedNovaRowNoLongerBlocks,
  testArchivedStreamWithoutPublicRows,
  testCorrectionStoresItsBase,
  testALoadedSubmissionRecordsAVerifiedBase,
  testAnUnloadedSubmissionRecordsAnUnverifiedBase,
  testANewVodRecordsAnUnverifiedBase,
  testBaseNeverInListQueries,
  testCurrentApproved,
  testCurrentHidesPipeline,
  testCurrentSkipsPendingRows,
  testCurrentUntrusted,
  testCurrentAllowsAurora,
  testCurrentRejectsBadInput,
  testCheckArchived,
  testCheckNoLeak,
  testCollabIsKeyedPerStreamer,
  testPipelineCorrectionReadsLikeAnUnknownVideo,
  testRevisionIsTheDigestOfTheList,
  testRevisionFollowsThePublicList,
  testTheLoadedRevisionIsAccepted,
  testAListThatChangedSinceItWasLoadedIsRefused,
  testAMalformedRevisionIsRefusedBeforeTurnstile,
  testARevisionReadsAlikeForAPipelineStreamAndNone,
];

async function main() {
  let failed = 0;
  try {
    for (const test of tests) {
      installFetch();
      try {
        await test();
      } catch (error) {
        failed += 1;
        console.error(`✗ ${test.name}`);
        console.error(error);
      }
    }
  } finally {
    globalThis.fetch = realFetch;
  }
  if (failed > 0) {
    console.error(`${failed} of ${tests.length} Nova VOD route tests failed`);
    process.exitCode = 1;
    return;
  }
  console.log(`✓ Nova VOD routes: submit tags corrections and refuses a list that changed since it was loaded, current serves the public list with its revision, no answer or page leaks pipeline state (${tests.length} tests)`);
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
