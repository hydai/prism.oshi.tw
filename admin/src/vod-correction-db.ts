/**
 * The admin catalog side of a VOD correction. A Nova submission for a video that
 * already has a stream is reviewed against that stream's current rows; the
 * curator's choices arrive here as explicit operations, are checked against the
 * stream as it was loaded, and are written in ONE D1 batch, so every ticked
 * change lands or none does. Rows that keep existing keep their performance ids.
 */
import type { Status } from '../shared/types';
import type { CorrectionCurrentRow, CorrectionOperation } from '../shared/vod-correction';
import {
  generateSongId,
  generateWorkId,
  prepareCatalogWrites,
  prepareEnsureExactWork,
  prepareLinkSongToExactWork,
  prepareSongInsert,
  prepareSongRename,
  prepareTimestampUpdate,
} from './db';
import type { CatalogReview, CatalogSongInput } from './db';
import { sha256Hex } from './vod-export/canonical-json';

export interface CorrectionTarget {
  stream: { id: string; streamerId: string; title: string; date: string; videoId: string; status: Status };
  current: CorrectionCurrentRow[];
}

/**
 * What an apply records in its own catalog batch (vod_correction_applies), so the record exists exactly when the batch
 * committed. It keeps what the route goes on to write and announce, for the approval that recovers an apply whose
 * submission could not be marked reviewed.
 */
export interface CorrectionApplyRecord {
  /** Fresh for every apply: the apply reads its own record back by it. */
  token: string;
  /** The Nova VOD submission the correction came from. */
  submissionId: string;
  /** The reviewer note the route writes to the submission: the curator's note, then the summary. */
  reviewerNote: string;
  /** The summary of what was applied, which the announcement posts. */
  summary: string;
}

export type ApplyCorrectionResult =
  | { ok: true }
  | { ok: false; status: 400; error: 'invalid_operations'; details: string[] }
  | { ok: false; status: 409; error: 'would_publish_hidden'; performances: Array<{ performanceId: string; streamId: string; songId: string }> }
  | { ok: false; status: 409; error: 'would_unpublish'; performanceIds: string[] }
  | { ok: false; status: 409; error: 'would_publish_endless'; performances: Array<{ performanceId: string; streamId: string; songId: string }> }
  | { ok: false; status: 409; error: 'stale' };

interface SongIdentity {
  title: string;
  originalArtist: string;
}

interface ExistingSong {
  id: string;
  status: Status;
}

/** What an import stores for an empty artist; resolving a song and creating one must agree on it. */
const UNKNOWN_ARTIST = 'Unknown';

const artistOrUnknown = (originalArtist: string): string => originalArtist || UNKNOWN_ARTIST;
const isBlank = (text: string): boolean => text.trim() === '';
const endsAfterStart = (start: number, end: number | null): boolean => end === null || end > start;

/** The performance statuses a review diffs against; loadCorrectionTarget and the apply guard read the same rows. */
const CURRENT_ROW_STATUSES = "('approved', 'pending', 'extracted')";

/** The key `findTargetStreams` files each (streamer, video) pair under. */
export function streamKey(streamerId: string, videoId: string): string {
  return `${streamerId}\u0000${videoId}`;
}

/** The stream each (streamer, video) pair already has, if any, keyed by `streamKey`. One query. */
export async function findTargetStreams(
  db: D1Database,
  keys: ReadonlyArray<{ streamerId: string; videoId: string }>,
): Promise<Map<string, { id: string; status: Status }>> {
  const targets = new Map<string, { id: string; status: Status }>();
  if (keys.length === 0) return targets;
  const payload = JSON.stringify(keys.map(({ streamerId, videoId }) => ({ streamerId, videoId })));
  const { results } = await db
    .prepare(
      `SELECT stream.id, stream.streamer_id, stream.video_id, stream.status
       FROM json_each(?) AS wanted
       JOIN streams AS stream
         ON stream.streamer_id = wanted.value ->> '$.streamerId'
        AND stream.video_id = wanted.value ->> '$.videoId'`,
    )
    .bind(payload)
    .all<{ id: string; streamer_id: string; video_id: string; status: Status }>();
  for (const row of results) {
    targets.set(streamKey(row.streamer_id, row.video_id), { id: row.id, status: row.status });
  }
  return targets;
}

interface TargetStreamRow {
  id: string;
  streamer_id: string;
  title: string;
  date: string;
  video_id: string;
  status: Status;
}

interface CurrentRowRow {
  performance_id: string;
  song_id: string;
  title: string;
  original_artist: string;
  timestamp: number;
  end_timestamp: number | null;
  status: Status;
  song_status: Status;
  song_performance_count: number;
}

/**
 * The stream a correction for (streamer, video) applies to, with the rows a review
 * diffs against: its performances that are approved, pending or extracted, by time
 * (rejected and excluded rows stay out of the diff). A row is `onSite` when it and
 * its song are approved, the rows the fan export ships whatever the stream's status.
 * `songPerformanceCount` counts every performance of the song, in any stream and of
 * any status: a rename reaches all of them.
 */
export async function loadCorrectionTarget(
  db: D1Database,
  streamerId: string,
  videoId: string,
): Promise<CorrectionTarget | null> {
  const stream = await db
    .prepare('SELECT id, streamer_id, title, date, video_id, status FROM streams WHERE streamer_id = ? AND video_id = ?')
    .bind(streamerId, videoId)
    .first<TargetStreamRow>();
  if (!stream) return null;
  const { results } = await db
    .prepare(
      `SELECT performance.id AS performance_id, performance.song_id, song.title, song.original_artist,
              performance.timestamp, performance.end_timestamp, performance.status, song.status AS song_status,
              (SELECT COUNT(*) FROM performances AS sung WHERE sung.song_id = performance.song_id) AS song_performance_count
       FROM performances AS performance
       JOIN songs AS song ON song.id = performance.song_id
       WHERE performance.stream_id = ?
         AND performance.status IN ${CURRENT_ROW_STATUSES}
       ORDER BY performance.timestamp, performance.id`,
    )
    .bind(stream.id)
    .all<CurrentRowRow>();
  return {
    stream: {
      id: stream.id,
      streamerId: stream.streamer_id,
      title: stream.title,
      date: stream.date,
      videoId: stream.video_id,
      status: stream.status,
    },
    current: results.map((row) => ({
      performanceId: row.performance_id,
      songId: row.song_id,
      title: row.title,
      originalArtist: row.original_artist,
      timestamp: row.timestamp,
      endTimestamp: row.end_timestamp,
      status: row.status,
      songStatus: row.song_status,
      onSite: row.status === 'approved' && row.song_status === 'approved',
      songPerformanceCount: row.song_performance_count,
    })),
  };
}

/**
 * What an apply relies on about the stream itself: its status, and the video, title and date
 * an added row copies from it.
 */
const streamFacts = ({ stream }: CorrectionTarget) => [stream.status, stream.videoId, stream.title, stream.date];

/**
 * SHA-256 (hex) of what a review was computed from: the stream's facts (streamFacts) and
 * every current row, in performance-id order. Any change to those rows or to the stream
 * changes it, so an apply reviewed against an older load can be refused.
 */
export async function correctionFingerprint(target: CorrectionTarget): Promise<string> {
  const rows = [...target.current]
    .sort((left, right) => (left.performanceId < right.performanceId ? -1 : left.performanceId > right.performanceId ? 1 : 0))
    .map((row) => [
      row.performanceId, row.songId, row.title, row.originalArtist,
      row.timestamp, row.endTimestamp, row.status, row.songStatus,
    ]);
  return sha256Hex(new TextEncoder().encode(JSON.stringify([streamFacts(target), rows])));
}

/** An identity to resolve, with the songs a batch renames into it, which rank among its holders. */
interface SongLookup extends SongIdentity {
  renamedInto?: readonly string[];
}

async function resolveSongs(
  db: D1Database,
  streamerId: string,
  identities: ReadonlyArray<SongLookup>,
  excludedSongIds: readonly string[],
): Promise<Array<ExistingSong | null>> {
  const resolved: Array<ExistingSong | null> = identities.map(() => null);
  if (identities.length === 0) return resolved;
  const payload = JSON.stringify(identities.map(({ title, originalArtist, renamedInto = [] }) => ({
    title, originalArtist: artistOrUnknown(originalArtist), renamedInto,
  })));
  // A song this batch renames into an identity is found by its id. With none, the branch that finds it is dropped:
  // it matches nothing then, and as an OR it would turn each identity's search of idx_songs_streamer_title_artist into
  // a scan of every song the streamer has (the review resolves thousands of identities for a long title-only paste).
  const holdsIdentity = `candidate.title = wanted.title AND candidate.original_artist = wanted.original_artist
                AND candidate.id NOT IN (SELECT value FROM json_each(?))`;
  const matches = identities.some(({ renamedInto = [] }) => renamedInto.length > 0)
    ? `(${holdsIdentity})
               OR candidate.id IN (SELECT value FROM json_each(wanted.renamed_into))`
    : holdsIdentity;
  const { results } = await db
    .prepare(
      `WITH wanted AS (
         SELECT key AS position, value ->> '$.title' AS title, value ->> '$.originalArtist' AS original_artist,
                value -> '$.renamedInto' AS renamed_into
         FROM json_each(?)
       ), matched AS (
         SELECT wanted.position, (
           SELECT candidate.id FROM songs AS candidate
           WHERE candidate.streamer_id = ?
             AND candidate.status IN ('approved', 'pending')
             AND (
               ${matches}
             )
           ORDER BY CASE candidate.status WHEN 'approved' THEN 0 ELSE 1 END, candidate.created_at ASC, candidate.id ASC
           LIMIT 1
         ) AS song_id
         FROM wanted
       )
       SELECT matched.position, song.id, song.status
       FROM matched JOIN songs AS song ON song.id = matched.song_id`,
    )
    .bind(payload, streamerId, JSON.stringify(excludedSongIds))
    .all<{ position: number; id: string; status: Status }>();
  for (const row of results) resolved[row.position] = { id: row.id, status: row.status };
  return resolved;
}

/**
 * The song catalog resolution would pick for each title and artist, in input order,
 * or null: the streamer's own song with exactly that title and artist (an empty
 * artist reads as 'Unknown') whose status is approved or pending, approved first,
 * then the oldest, then the lowest id. That is the rule prepareCatalogWrites applies
 * inside its batch. One query for the whole list.
 */
export async function resolveExistingSongs(
  db: D1Database,
  streamerId: string,
  identities: ReadonlyArray<SongIdentity>,
): Promise<Array<ExistingSong | null>> {
  return resolveSongs(db, streamerId, identities, []);
}

/** The streamer's approved or pending songs among the `relinkToSong` targets, with their status. */
async function findRelinkTargets(
  db: D1Database,
  streamerId: string,
  operations: readonly CorrectionOperation[],
): Promise<Map<string, Status>> {
  const songIds = [...new Set(operations.flatMap((operation) => (operation.op === 'relinkToSong' ? [operation.songId] : [])))];
  const targets = new Map<string, Status>();
  if (songIds.length === 0) return targets;
  const { results } = await db
    .prepare(
      `SELECT id, status FROM songs
       WHERE streamer_id = ? AND status IN ('approved', 'pending') AND id IN (SELECT value FROM json_each(?))`,
    )
    .bind(streamerId, JSON.stringify(songIds))
    .all<{ id: string; status: Status }>();
  for (const row of results) targets.set(row.id, row.status);
  return targets;
}

/** The operations that passed every check, grouped by the batch step that writes them. */
interface CorrectionPlan {
  /** One entry per renamed song (identical duplicates collapse), an empty artist read as 'Unknown'. */
  renames: Map<string, { index: number; title?: string; originalArtist?: string }>;
  /** `songStatus` is the status the plan read for the song; `expectedSongStatus` the one the review showed, if it did. */
  relinksToSong: Array<{ performanceId: string; songId: string; songStatus: Status; expectedSongStatus?: Status }>;
  /** `expectedSongStatus`: the status of the song the identity resolved to when the review was made, null for none. */
  relinksToNewSong: Array<{ performanceId: string; expectedSongStatus?: Status | null } & SongIdentity>;
  adds: CatalogSongInput[];
  times: Array<Extract<CorrectionOperation, { op: 'setTimes' }>>;
  deletes: string[];
}

/** Which operation holds each kind of change to one performance. */
interface PerformanceClaims {
  setTimes?: number;
  relink?: number;
  delete?: number;
}

/**
 * Check every operation against the stream as loaded, and group the ones that pass.
 * Each problem is reported as `operation {index}: {reason}`, in operation order; the plan
 * is only usable when there are none.
 */
function planOperations(
  target: CorrectionTarget,
  operations: readonly CorrectionOperation[],
  relinkTargets: ReadonlyMap<string, Status>,
): { plan: CorrectionPlan; details: string[] } {
  const rows = new Map(target.current.map((row) => [row.performanceId, row]));
  const reviewedSongs = new Set(target.current.map((row) => row.songId));
  const claims = new Map<string, PerformanceClaims>();
  const plan: CorrectionPlan = { renames: new Map(), relinksToSong: [], relinksToNewSong: [], adds: [], times: [], deletes: [] };
  const problems: Array<{ index: number; reason: string }> = [];
  // Each planned relink with the operation it came from, for the end check once every operation is planned.
  const relinked: Array<{ index: number; row: CorrectionCurrentRow }> = [];

  operations.forEach((operation, index) => {
    const fail = (reason: string) => { problems.push({ index, reason }); };
    // A performance takes at most one time edit and one relink, and a delete excludes every
    // other operation on it. Returns the current row, or null once the claim is refused.
    const claim = (performanceId: string, kind: keyof PerformanceClaims): CorrectionCurrentRow | null => {
      const row = rows.get(performanceId);
      if (!row) {
        fail(`performance ${performanceId} is not one of this stream's current rows`);
        return null;
      }
      const held = claims.get(performanceId) ?? {};
      claims.set(performanceId, held);
      const conflict = held.delete ?? (kind === 'delete' ? held.setTimes ?? held.relink : held[kind]);
      if (conflict !== undefined) {
        fail(`performance ${performanceId} is already changed by operation ${conflict}`);
        return null;
      }
      held[kind] = index;
      return row;
    };

    switch (operation.op) {
      case 'setTimes': {
        const row = claim(operation.performanceId, 'setTimes');
        if (!row) return;
        // An end may move but never be emptied. A pipeline row has no end until it is stamped, so an empty one may stay empty.
        if (operation.endTimestamp === null && row.endTimestamp !== null) {
          fail('the end must not be cleared');
          return;
        }
        const start = operation.timestamp ?? row.timestamp;
        const end = operation.endTimestamp === undefined ? row.endTimestamp : operation.endTimestamp;
        if (!endsAfterStart(start, end)) {
          fail(`end must be greater than start (start ${start}, end ${end})`);
          return;
        }
        plan.times.push(operation);
        return;
      }
      case 'renameSong': {
        // Server-side guard: the page offers a rename only on a reviewed row's song. The rename
        // itself still reaches every performance of that song, in every stream.
        if (!reviewedSongs.has(operation.songId)) {
          fail(`song ${operation.songId} is not the song of any current row`);
          return;
        }
        if (operation.title !== undefined && isBlank(operation.title)) {
          fail('title must not be empty');
          return;
        }
        const fields = {
          title: operation.title,
          originalArtist: operation.originalArtist === undefined ? undefined : artistOrUnknown(operation.originalArtist),
        };
        const earlier = plan.renames.get(operation.songId);
        if (!earlier) {
          plan.renames.set(operation.songId, { index, ...fields });
        } else if (earlier.title !== fields.title || earlier.originalArtist !== fields.originalArtist) {
          fail(`song ${operation.songId} is already renamed differently by operation ${earlier.index}`);
        }
        return;
      }
      case 'relinkToSong': {
        const row = claim(operation.performanceId, 'relink');
        const songStatus = relinkTargets.get(operation.songId);
        if (songStatus === undefined) {
          fail(`song ${operation.songId} is not an approved or pending song of this streamer`);
          return;
        }
        if (row) {
          plan.relinksToSong.push({
            performanceId: row.performanceId,
            songId: operation.songId,
            songStatus,
            expectedSongStatus: operation.expectedSongStatus,
          });
          relinked.push({ index, row });
        }
        return;
      }
      case 'relinkToNewSong': {
        const row = claim(operation.performanceId, 'relink');
        if (isBlank(operation.title)) {
          fail('title must not be empty');
          return;
        }
        if (row) {
          plan.relinksToNewSong.push({
            performanceId: row.performanceId,
            title: operation.title,
            originalArtist: artistOrUnknown(operation.originalArtist),
            expectedSongStatus: operation.expectedSongStatus,
          });
          relinked.push({ index, row });
        }
        return;
      }
      case 'addPerformance': {
        const blank = isBlank(operation.title);
        if (blank) fail('title must not be empty');
        // On an approved stream the add is born approved (prepareCorrectionBatch), and an approved row without an end
        // stops the VOD export for every streamer (MISSING_END_SECONDS), so it needs one there, as a row a relink
        // publishes does (below). On any other stream it is created pending, like an imported row, and gets its end
        // when it is stamped, so it may have none.
        const endless = operation.endTimestamp === null && target.stream.status === 'approved';
        if (endless) fail('an added performance needs an end');
        const inverted = !endsAfterStart(operation.timestamp, operation.endTimestamp);
        if (inverted) fail(`end must be greater than start (start ${operation.timestamp}, end ${operation.endTimestamp})`);
        if (blank || endless || inverted) return;
        plan.adds.push({
          title: operation.title,
          originalArtist: artistOrUnknown(operation.originalArtist),
          timestamp: operation.timestamp,
          endTimestamp: operation.endTimestamp,
          note: '',
        });
        return;
      }
      case 'deletePerformance': {
        const row = claim(operation.performanceId, 'delete');
        if (row) plan.deletes.push(row.performanceId);
        return;
      }
      default: {
        const unknown: never = operation;
        fail(`unknown operation ${JSON.stringify((unknown as { op?: unknown }).op)}`);
      }
    }
  });

  // On an approved stream a relink publishes an approved row whose song is not approved: whatever it lands on is
  // approved, created approved, or promoted along with the apply (prepareCorrectionBatch). Like an add, the row then
  // needs an end, or the VOD export stops for every streamer. What counts is the end it has once the apply is done: the
  // one a time edit of this apply sets, sent before the relink or after it, else the one it has now. A row already on
  // the site is in the export already, and the relink keeps it there; refusing it would block every correction of the
  // row that is not about its end. On any other stream nothing is promoted and the export leaves the stream's rows out.
  // The batch does not check this again: its target guard fails once a row's end, status or song status moved.
  if (target.stream.status === 'approved') {
    for (const { index, row } of relinked) {
      if (row.status !== 'approved' || row.songStatus === 'approved') continue;
      const timesAt = claims.get(row.performanceId)?.setTimes;
      const times = timesAt === undefined ? undefined : operations[timesAt];
      const end = times?.op === 'setTimes' && times.endTimestamp !== undefined ? times.endTimestamp : row.endTimestamp;
      if (end === null) problems.push({ index, reason: 'a performance the relink publishes needs an end' });
    }
  }
  // The sort is stable, so the problems of one operation keep the order they were found in.
  const details = problems
    .sort((left, right) => left.index - right.index)
    .map(({ index, reason }) => `operation ${index}: ${reason}`);
  return { plan, details };
}

interface NewSong extends SongIdentity {
  id: string;
  workId: string;
}

/**
 * An existing song a relink lands on that the target guard does not read: a `relinkToSong`
 * target, or the catalog song a `relinkToNewSong` was matched to, which must also keep the
 * identity it was matched by. Either must keep the status the plan read: a song demoted after
 * it would be approved again by the promotion, and one approved after it is not the song the
 * plan weighed.
 */
interface RelinkDestination {
  songId: string;
  identity: SongIdentity | null;
  status: Status;
}

/**
 * Where every relink points, the songs to create for them, and the pending songs the apply promotes: the ones added
 * rows or relinked approved rows (promotingRows) may land on.
 */
interface ResolvedPlan {
  relinks: Array<{ performanceId: string; songId: string }>;
  newSongs: NewSong[];
  pendingTargets: string[];
  /** Relink destinations read before the batch; a song renamed into a relink's identity is a target row instead. */
  destinations: RelinkDestination[];
  /**
   * Whether a relink carries a status (`expectedSongStatus`) other than the one the plan read for the song it lands on:
   * the review showed a song that has changed since, so the apply must not go on.
   */
  statusMoved: boolean;
  /** The songs this batch renames, which no longer hold their old identity. */
  renamedAway: string[];
  /** Every relink by title and artist that landed on an existing song, which must still rank first. */
  ranked: RankedRelink[];
}

/** A relink by title and artist, the song the plan ranked first for it, and the songs this batch renames into it. */
interface RankedRelink extends SongIdentity {
  songId: string;
  renamedInto: string[];
}

const identityKey = ({ title, originalArtist }: SongIdentity): string => JSON.stringify([title, originalArtist]);

/**
 * The target's rows whose relink promotes the pending song it lands on, on an approved stream: its approved rows. A
 * relink keeps its row's status, so a row that is not approved stays off the site whatever its song, and the apply
 * approves no song for it: the promotion is there so that a relinked row does not vanish from the site.
 */
function promotingRows(target: CorrectionTarget): Set<string> {
  return new Set(target.current.flatMap((row) => (row.status === 'approved' ? [row.performanceId] : [])));
}

/**
 * Resolve the new-song relinks and the adds. Renames run first inside the batch, where
 * prepareCatalogWrites resolves each add, so every identity is read as the catalog will
 * stand after them: a song renamed away no longer answers to its old title and artist,
 * and a song renamed into an identity does. Resolving against the catalog as it stands
 * now would link a row to a song that is about to change name, mint a twin of a song
 * that is about to take the name, and hide from the hidden-row guard the pending song
 * an add will land on. The catalog's holders of an identity and the songs renamed into
 * it rank together, approved first, then the oldest, then the lowest id, as the batch
 * ranks them.
 */
async function resolvePlan(
  db: D1Database,
  target: CorrectionTarget,
  plan: CorrectionPlan,
  relinkTargets: ReadonlyMap<string, Status>,
): Promise<ResolvedPlan> {
  const songRows = new Map(target.current.map((row) => [row.songId, row]));
  const renamedAway: string[] = [];
  const renamedInto = new Map<string, string[]>();
  for (const [songId, rename] of plan.renames) {
    const row = songRows.get(songId)!;
    const after = identityKey({ title: rename.title ?? row.title, originalArtist: rename.originalArtist ?? row.originalArtist });
    if (after === identityKey(row)) continue;
    renamedAway.push(songId);
    renamedInto.set(after, [...(renamedInto.get(after) ?? []), songId]);
  }

  const lookups = [...plan.relinksToNewSong, ...plan.adds].map((identity): SongLookup => ({
    title: identity.title,
    originalArtist: identity.originalArtist,
    renamedInto: renamedInto.get(identityKey(identity)) ?? [],
  }));
  const found = await resolveSongs(db, target.stream.streamerId, lookups, renamedAway);
  // A song this batch renames is only ever found through its new identity, and it is a target row.
  const renamed = new Set(renamedAway);
  const promoting = promotingRows(target);
  const pendingTargets = new Set<string>();
  const relinks = plan.relinksToSong.map(({ performanceId, songId }) => ({ performanceId, songId }));
  const destinations: RelinkDestination[] = plan.relinksToSong.map((relink) => ({
    songId: relink.songId,
    identity: null,
    status: relink.songStatus,
  }));
  const ranked: RankedRelink[] = [];
  let statusMoved = false;
  for (const relink of plan.relinksToSong) {
    if (promoting.has(relink.performanceId) && relinkTargets.get(relink.songId) === 'pending') pendingTargets.add(relink.songId);
    if (relink.expectedSongStatus !== undefined && relink.expectedSongStatus !== relink.songStatus) statusMoved = true;
  }
  const newSongs = new Map<string, NewSong>();
  plan.relinksToNewSong.forEach((relink, index) => {
    const key = identityKey(relink);
    const existing = found[index];
    // The song the identity resolves to now, or none, which the apply creates.
    if (relink.expectedSongStatus !== undefined && relink.expectedSongStatus !== (existing?.status ?? null)) statusMoved = true;
    if (existing) {
      if (promoting.has(relink.performanceId) && existing.status === 'pending') pendingTargets.add(existing.id);
      // A song renamed into the identity is a target row, which the target guard reads.
      if (!renamed.has(existing.id)) {
        destinations.push({
          songId: existing.id,
          identity: { title: relink.title, originalArtist: relink.originalArtist },
          status: existing.status,
        });
      }
      ranked.push({
        songId: existing.id, title: relink.title, originalArtist: relink.originalArtist, renamedInto: renamedInto.get(key) ?? [],
      });
      relinks.push({ performanceId: relink.performanceId, songId: existing.id });
      return;
    }
    let song = newSongs.get(key);
    if (!song) {
      song = { id: generateSongId(), workId: generateWorkId(), title: relink.title, originalArtist: relink.originalArtist };
      newSongs.set(key, song);
    }
    relinks.push({ performanceId: relink.performanceId, songId: song.id });
  });
  // The batch lands each add on the song ranked first here, so the hidden-row check must see it
  // when it is pending; the promotion guard reads what the batch actually landed on.
  plan.adds.forEach((_, index) => {
    const song = found[plan.relinksToNewSong.length + index];
    if (song?.status === 'pending') pendingTargets.add(song.id);
  });
  return { relinks, newSongs: [...newSongs.values()], pendingTargets: [...pendingTargets], destinations, statusMoved, renamedAway, ranked };
}

/**
 * Approved performances of these songs on a stream that is not approved. The fan-site
 * export ignores stream status, so promoting one of these songs would publish them.
 */
async function findHiddenPerformances(
  db: D1Database,
  songIds: readonly string[],
): Promise<Array<{ performanceId: string; streamId: string; songId: string }>> {
  if (songIds.length === 0) return [];
  const { results } = await db
    .prepare(
      `SELECT performance.id AS performance_id, performance.stream_id, performance.song_id
       FROM performances AS performance
       LEFT JOIN streams AS stream ON stream.id = performance.stream_id
       WHERE performance.song_id IN (SELECT value FROM json_each(?))
         AND performance.status = 'approved'
         AND stream.status IS NOT 'approved'
       ORDER BY performance.song_id, performance.stream_id, performance.id`,
    )
    .bind(JSON.stringify(songIds))
    .all<{ performance_id: string; stream_id: string; song_id: string }>();
  return results.map((row) => ({ performanceId: row.performance_id, streamId: row.stream_id, songId: row.song_id }));
}

/**
 * Approved performances of these songs on an approved stream that have no end, but for the `spared` ones, in
 * findHiddenPerformances' order. Promoting one of these songs puts them in the VOD export, which stops for every
 * streamer on a row with no end (MISSING_END_SECONDS).
 */
async function findEndlessPerformances(
  db: D1Database,
  songIds: readonly string[],
  spared: readonly string[],
): Promise<Array<{ performanceId: string; streamId: string; songId: string }>> {
  if (songIds.length === 0) return [];
  const { results } = await db
    .prepare(
      `SELECT performance.id AS performance_id, performance.stream_id, performance.song_id
       FROM performances AS performance
       JOIN streams AS stream ON stream.id = performance.stream_id
       WHERE performance.song_id IN (SELECT value FROM json_each(?))
         AND performance.status = 'approved'
         AND stream.status = 'approved'
         AND performance.end_timestamp IS NULL
         AND performance.id NOT IN (SELECT value FROM json_each(?))
       ORDER BY performance.song_id, performance.stream_id, performance.id`,
    )
    .bind(JSON.stringify(songIds), JSON.stringify(spared))
    .all<{ performance_id: string; stream_id: string; song_id: string }>();
  return results.map((row) => ({ performanceId: row.performance_id, streamId: row.stream_id, songId: row.song_id }));
}

/**
 * The whole apply as one ordered batch. Order matters: renames → new songs → relinks →
 * adds → time edits → deletes → promotion → orphan cleanup, so each step sees the rows
 * the earlier ones wrote, and the orphan check runs after every change that can orphan.
 */
function prepareCorrectionBatch(
  db: D1Database,
  target: CorrectionTarget,
  plan: CorrectionPlan,
  resolved: ResolvedPlan,
  curator: string,
): D1PreparedStatement[] {
  const { stream } = target;
  const rows = new Map(target.current.map((row) => [row.performanceId, row]));
  // Applying a correction to a public stream is the approval: rows it creates there are born
  // approved, or they would vanish from the site. Elsewhere they wait in pending like imports.
  const review: CatalogReview | undefined = stream.status === 'approved'
    ? { status: 'approved', reviewedBy: curator }
    : undefined;
  const statements: D1PreparedStatement[] = [];

  for (const [songId, rename] of plan.renames) {
    statements.push(...prepareSongRename(db, songId, { title: rename.title, originalArtist: rename.originalArtist }, curator));
  }
  for (const song of resolved.newSongs) {
    statements.push(
      prepareEnsureExactWork(db, song.workId, song.title, song.originalArtist),
      prepareSongInsert(db, stream.streamerId, song.id, song.title, song.originalArtist, curator, review),
      prepareLinkSongToExactWork(db, song.id, song.title, song.originalArtist, 'import_exact', curator),
    );
  }
  for (const relink of resolved.relinks) {
    statements.push(db
      .prepare("UPDATE performances SET song_id = ?, updated_at = datetime('now') WHERE id = ? AND stream_id = ?")
      .bind(relink.songId, relink.performanceId, stream.id));
  }
  // Off an approved stream a relink must not change what the site shows, and a destination whose status changed
  // after the check would: approved, it publishes a hidden row; no longer approved, it takes an on-site row off.
  if (!review) {
    const relinked = approvedRowRelinks(target, resolved.relinks);
    if (relinked.hidden.length > 0 || relinked.onSite.length > 0) {
      statements.push(prepareRelinkPublicationGuard(db, stream.id, relinked));
    }
  }
  const added = prepareCatalogWrites(db, {
    streamerId: stream.streamerId,
    streamId: stream.id,
    date: stream.date,
    streamTitle: stream.title,
    videoId: stream.videoId,
    songs: plan.adds,
    submittedBy: curator,
    review,
  });
  statements.push(...added.statements);
  for (const times of plan.times) {
    const statement = prepareTimestampUpdate(db, times.performanceId, times);
    if (statement) statements.push(statement);
  }
  for (const performanceId of plan.deletes) {
    statements.push(db.prepare('DELETE FROM performances WHERE id = ? AND stream_id = ?').bind(performanceId, stream.id));
  }

  // A pending song an applied row now points at would keep that row off the site: the rows this
  // batch adds, born approved, and the approved rows it relinks (promotingRows; a row that is not
  // approved stays off the site whatever its song). Its guard reads the songs this batch actually
  // lands on, which the check before the batch could only predict.
  const promoting = promotingRows(target);
  const landed = [
    ...resolved.relinks.filter((relink) => promoting.has(relink.performanceId)).map((relink) => relink.performanceId),
    ...added.performanceIds,
  ];
  if (review && landed.length > 0) {
    const keptOnSite = approvedRowRelinks(target, resolved.relinks).onSite.map((relink) => relink.performanceId);
    statements.push(
      preparePromotionGuard(db, stream.id, landed, keptOnSite),
      db
        .prepare(
          `UPDATE songs SET status = 'approved', reviewed_by = ?, updated_at = datetime('now')
           WHERE status = 'pending' AND id IN (
             SELECT song_id FROM performances WHERE id IN (SELECT value FROM json_each(?))
           )`,
        )
        .bind(curator, JSON.stringify(landed)),
    );
  }
  const formerSongs = new Set([
    ...resolved.relinks.map((relink) => rows.get(relink.performanceId)!.songId),
    ...plan.deletes.map((performanceId) => rows.get(performanceId)!.songId),
  ]);
  if (formerSongs.size > 0) {
    statements.push(db
      .prepare(
        `DELETE FROM songs WHERE id IN (SELECT value FROM json_each(?))
         AND NOT EXISTS (SELECT 1 FROM performances WHERE song_id = songs.id)`,
      )
      .bind(JSON.stringify([...formerSongs])));
  }
  return statements;
}

/**
 * A statement of an apply batch that writes nothing while its `merge_guard(valid)` holds and
 * fails otherwise, which rolls the whole batch back. A merge batch has each of its statements
 * consult a guard row instead (see guard.ts), but this batch is composed from shared statement
 * builders that cannot, so when `valid` is false this inserts a guard row without a canonical
 * id, which merge_guards' NOT NULL rejects. `validity` is a WITH clause ending in the
 * `merge_guard(valid) AS (...)` definition; `bindings` fill its placeholders in order.
 */
function prepareAbortUnlessValid(db: D1Database, validity: string, bindings: unknown[], token: string): D1PreparedStatement {
  return db
    .prepare(
      `${validity}
       INSERT INTO merge_guards (guard_token, canonical_id, actor)
       SELECT ?, NULL, ? FROM merge_guard WHERE NOT valid`,
    )
    .bind(...bindings, token, 'system:vod-correction-guard');
}

/**
 * The first statement of an apply batch: it fails unless the stream still holds exactly what
 * `target` was loaded with (the fingerprint's inputs: streamFacts and every current row).
 */
function prepareTargetGuard(db: D1Database, target: CorrectionTarget): D1PreparedStatement {
  const expected = target.current.map((row) => [
    row.performanceId, row.songId, row.title, row.originalArtist,
    row.timestamp, row.endTimestamp, row.status, row.songStatus,
  ]);
  const [status, videoId, title, date] = streamFacts(target);
  return prepareAbortUnlessValid(
    db,
    `WITH expected AS (
       SELECT value ->> '$[0]', value ->> '$[1]', value ->> '$[2]', value ->> '$[3]',
              value ->> '$[4]', value ->> '$[5]', value ->> '$[6]', value ->> '$[7]'
       FROM json_each(?)
     ), actual AS (
       SELECT performance.id, performance.song_id, song.title, song.original_artist,
              performance.timestamp, performance.end_timestamp, performance.status, song.status
       FROM performances AS performance
       JOIN songs AS song ON song.id = performance.song_id
       WHERE performance.stream_id = ?
         AND performance.status IN ${CURRENT_ROW_STATUSES}
     ), merge_guard(valid) AS (
       SELECT EXISTS (
            SELECT 1 FROM streams
            WHERE id = ? AND status IS ? AND video_id IS ? AND title IS ? AND date IS ?
          )
          AND (SELECT COUNT(*) FROM actual) = (SELECT COUNT(*) FROM expected)
          AND NOT EXISTS (SELECT * FROM actual EXCEPT SELECT * FROM expected)
     )`,
    [JSON.stringify(expected), target.stream.id, target.stream.id, status, videoId, title, date],
    `vod-correction:${target.stream.id}`,
  );
}

/** A WITH clause ending in `merge_guard(valid) AS (...)`, its bindings, and the token its guard row would carry. */
interface Validity {
  sql: string;
  bindings: unknown[];
  token: string;
}

/**
 * Holds while every relink destination is still one of the streamer's songs, with the status the
 * plan read (so it is neither rejected nor deleted; one the promotion would approve is still
 * pending, and one it leaves alone still approved) and, for one matched by identity, the title
 * and artist it was matched by. Read at the start of the batch: no earlier statement changes
 * these songs, since a song this batch renames is never matched by identity and a rename keeps
 * a song's status.
 */
function destinationValidity(target: CorrectionTarget, resolved: ResolvedPlan): Validity {
  return {
    sql: `WITH destination AS (
       SELECT value ->> '$.songId' AS song_id, value ->> '$.status' AS status,
              value ->> '$.title' AS title, value ->> '$.originalArtist' AS original_artist
       FROM json_each(?)
     ), merge_guard(valid) AS (
       SELECT NOT EXISTS (
         SELECT 1
         FROM destination
         LEFT JOIN songs AS song ON song.id = destination.song_id AND song.streamer_id = ?
         WHERE song.id IS NULL
            OR song.status IS NOT destination.status
            OR (destination.title IS NOT NULL
                AND (song.title IS NOT destination.title OR song.original_artist IS NOT destination.original_artist))
       )
     )`,
    bindings: [
      JSON.stringify(resolved.destinations.map(({ songId, identity, status }) => ({ songId, status, ...identity }))),
      target.stream.streamerId,
    ],
    token: `vod-correction-destinations:${target.stream.id}`,
  };
}

/**
 * Holds while each relink by title and artist still lands on the first-ranked holder of that
 * identity: no approved or pending song of the streamer holding it (a song this batch renames
 * away does not; one it renames into it does) outranks the song the plan picked, approved first,
 * then the oldest, then the lowest id. A rival approved or renamed into the identity after the
 * plan would otherwise take the identity's adds while the relink kept the old pick.
 */
function rankValidity(target: CorrectionTarget, resolved: ResolvedPlan): Validity {
  return {
    sql: `WITH ranked AS (
       SELECT value ->> '$.songId' AS song_id, value ->> '$.title' AS title,
              value ->> '$.originalArtist' AS original_artist, value -> '$.renamedInto' AS renamed_into
       FROM json_each(?)
     ), merge_guard(valid) AS (
       SELECT NOT EXISTS (
         SELECT 1
         FROM ranked
         JOIN songs AS chosen ON chosen.id = ranked.song_id
         JOIN songs AS rival ON rival.streamer_id = ? AND rival.id <> chosen.id
         WHERE rival.status IN ('approved', 'pending')
           AND (
             (rival.title = ranked.title AND rival.original_artist = ranked.original_artist
              AND rival.id NOT IN (SELECT value FROM json_each(?)))
             OR rival.id IN (SELECT value FROM json_each(ranked.renamed_into))
           )
           AND (CASE rival.status WHEN 'approved' THEN 0 ELSE 1 END, rival.created_at, rival.id)
             < (CASE chosen.status WHEN 'approved' THEN 0 ELSE 1 END, chosen.created_at, chosen.id)
       )
     )`,
    bindings: [JSON.stringify(resolved.ranked), target.stream.streamerId, JSON.stringify(resolved.renamedAway)],
    token: `vod-correction-ranks:${target.stream.id}`,
  };
}

/**
 * Holds while no approved or pending song of the streamer, other than one this batch renames
 * away, holds the identity of a song the batch creates for a relink. The plan creates a song only
 * where it found none; another apply can create one first, and a second would be a twin.
 */
function newSongValidity(target: CorrectionTarget, resolved: ResolvedPlan): Validity {
  return {
    sql: `WITH created AS (
       SELECT value ->> '$.title' AS title, value ->> '$.originalArtist' AS original_artist
       FROM json_each(?)
     ), merge_guard(valid) AS (
       SELECT NOT EXISTS (
         SELECT 1
         FROM created
         JOIN songs AS song
           ON song.streamer_id = ? AND song.title = created.title AND song.original_artist = created.original_artist
         WHERE song.status IN ('approved', 'pending')
           AND song.id NOT IN (SELECT value FROM json_each(?))
       )
     )`,
    bindings: [
      JSON.stringify(resolved.newSongs.map(({ title, originalArtist }) => ({ title, originalArtist }))),
      target.stream.streamerId,
      JSON.stringify(resolved.renamedAway),
    ],
    token: `vod-correction-new-songs:${target.stream.id}`,
  };
}

/** What the opening guards check after the target guard: each plan read that has something to check. */
function openingValidities(target: CorrectionTarget, resolved: ResolvedPlan): Validity[] {
  return [
    ...(resolved.destinations.length > 0 ? [destinationValidity(target, resolved)] : []),
    ...(resolved.ranked.length > 0 ? [rankValidity(target, resolved)] : []),
    ...(resolved.newSongs.length > 0 ? [newSongValidity(target, resolved)] : []),
  ];
}

/**
 * The guards that open an apply batch, each failing (and rolling the batch back) once what the
 * plan read moved: the target's rows and stream, then openingValidities.
 */
function prepareOpeningGuards(db: D1Database, target: CorrectionTarget, resolved: ResolvedPlan): D1PreparedStatement[] {
  return [
    prepareTargetGuard(db, target),
    ...openingValidities(target, resolved).map(({ sql, bindings, token }) => prepareAbortUnlessValid(db, sql, bindings, token)),
  ];
}

/** Whether a validity holds now, read outside a batch. */
async function holdsNow(db: D1Database, { sql, bindings }: Validity): Promise<boolean> {
  const row = await db.prepare(`${sql} SELECT valid FROM merge_guard`).bind(...bindings).first<{ valid: number }>();
  return row?.valid === 1;
}

/** Whether anything the opening guards read has moved since the plan read it. */
async function openingGuardsMoved(db: D1Database, target: CorrectionTarget, resolved: ResolvedPlan): Promise<boolean> {
  const now = await loadCorrectionTarget(db, target.stream.streamerId, target.stream.videoId);
  if (!now || await correctionFingerprint(now) !== await correctionFingerprint(target)) return true;
  const held = await Promise.all(openingValidities(target, resolved).map((validity) => holdsNow(db, validity)));
  return held.some((holds) => !holds);
}

/**
 * The statement right before the promotion: it fails if a pending song the landed rows now
 * point at has an approved performance on a stream that is not approved (findHiddenPerformances'
 * rule), or one with no end on an approved stream (findEndlessPerformances' rule), as the catalog
 * stands inside the transaction. It runs after the relinks, time edits and deletes, so it reads
 * what they did: an end the batch sets, a row it deletes or relinks away. The end rule leaves out
 * the on-site rows this batch relinks (`keptOnSite`), which are in the VOD export already. Every
 * other approved row a relink would land here with no end was refused by planOperations, against
 * the rows as loaded, which the target guard holds.
 */
function preparePromotionGuard(
  db: D1Database,
  streamId: string,
  landed: readonly string[],
  keptOnSite: readonly string[],
): D1PreparedStatement {
  return prepareAbortUnlessValid(
    db,
    `WITH promoted AS (
       SELECT performance.song_id
       FROM performances AS performance
       JOIN songs AS song ON song.id = performance.song_id
       WHERE performance.id IN (SELECT value FROM json_each(?))
         AND song.status = 'pending'
     ), merge_guard(valid) AS (
       SELECT NOT EXISTS (
         SELECT 1
         FROM performances AS performance
         LEFT JOIN streams AS stream ON stream.id = performance.stream_id
         WHERE performance.song_id IN (SELECT song_id FROM promoted)
           AND performance.status = 'approved'
           AND (
             stream.status IS NOT 'approved'
             OR (performance.end_timestamp IS NULL AND performance.id NOT IN (SELECT value FROM json_each(?)))
           )
       )
     )`,
    [JSON.stringify(landed), JSON.stringify(keptOnSite)],
    `vod-correction-promotion:${streamId}`,
  );
}

/** The relinks of the target's approved rows, split by whether the export, which ignores stream status, shows the row. */
interface ApprovedRowRelinks {
  /** Rows whose current song is not approved, which the export leaves out. */
  hidden: ResolvedPlan['relinks'];
  /** Rows whose current song is approved, which are on the site. */
  onSite: ResolvedPlan['relinks'];
}

function approvedRowRelinks(target: CorrectionTarget, relinks: ResolvedPlan['relinks']): ApprovedRowRelinks {
  const rows = new Map(target.current.map((row) => [row.performanceId, row]));
  const split: ApprovedRowRelinks = { hidden: [], onSite: [] };
  for (const relink of relinks) {
    const row = rows.get(relink.performanceId)!;
    if (row.status === 'approved') split[row.songStatus === 'approved' ? 'onSite' : 'hidden'].push(relink);
  }
  return split;
}

/** Which of these songs are approved, as the catalog stands now. */
async function findApprovedSongs(db: D1Database, songIds: readonly string[]): Promise<Set<string>> {
  const { results } = await db
    .prepare("SELECT id FROM songs WHERE status = 'approved' AND id IN (SELECT value FROM json_each(?))")
    .bind(JSON.stringify(songIds))
    .all<{ id: string }>();
  return new Set(results.map((row) => row.id));
}

/** The hidden relinks that land on an approved song, as the catalog stands now: each would publish its row. */
async function findPublishingRelinks(
  db: D1Database,
  target: CorrectionTarget,
  relinks: ResolvedPlan['relinks'],
): Promise<Array<{ performanceId: string; streamId: string; songId: string }>> {
  const { hidden } = approvedRowRelinks(target, relinks);
  if (hidden.length === 0) return [];
  const approved = await findApprovedSongs(db, hidden.map((relink) => relink.songId));
  return hidden
    .filter((relink) => approved.has(relink.songId))
    .map((relink) => ({ performanceId: relink.performanceId, streamId: target.stream.id, songId: relink.songId }));
}

/**
 * The performance ids of the on-site relinks that land on a song that is not approved, as the catalog
 * stands now, a song the batch creates included: each would take its row off the site.
 */
async function findUnpublishingRelinks(
  db: D1Database,
  target: CorrectionTarget,
  relinks: ResolvedPlan['relinks'],
): Promise<string[]> {
  const { onSite } = approvedRowRelinks(target, relinks);
  if (onSite.length === 0) return [];
  const approved = await findApprovedSongs(db, onSite.map((relink) => relink.songId));
  return onSite.filter((relink) => !approved.has(relink.songId)).map((relink) => relink.performanceId);
}

/**
 * On a stream that is not approved, the statement right after the relinks: it fails if a relinked row
 * changed whether the site shows it, as the catalog stands inside the transaction: a `hidden` row now
 * points at an approved song, or an `onSite` row at a song that is not approved.
 */
function prepareRelinkPublicationGuard(db: D1Database, streamId: string, relinked: ApprovedRowRelinks): D1PreparedStatement {
  const ids = (relinks: ResolvedPlan['relinks']) => JSON.stringify(relinks.map((relink) => relink.performanceId));
  return prepareAbortUnlessValid(
    db,
    `WITH merge_guard(valid) AS (
       SELECT NOT EXISTS (
         SELECT 1
         FROM performances AS performance
         JOIN songs AS song ON song.id = performance.song_id
         WHERE performance.id IN (SELECT value FROM json_each(?))
           AND performance.status = 'approved'
           AND song.status = 'approved'
       ) AND NOT EXISTS (
         SELECT 1
         FROM performances AS performance
         LEFT JOIN songs AS song ON song.id = performance.song_id
         WHERE performance.id IN (SELECT value FROM json_each(?))
           AND performance.status = 'approved'
           AND song.status IS NOT 'approved'
       )
     )`,
    [ids(relinked.hidden), ids(relinked.onSite)],
    `vod-correction-relinks:${streamId}`,
  );
}

/**
 * The refusal of an apply that would publish rows of a stream that is not approved (the export
 * ignores stream status); otherwise null. On an approved stream that is a promotion of a pending
 * song with approved rows on such a stream; on a stream that is not approved, a relink that moves
 * one of its approved rows from a song that is not approved onto an approved one.
 */
async function refuseHiddenPublication(
  db: D1Database,
  target: CorrectionTarget,
  resolved: ResolvedPlan,
): Promise<ApplyCorrectionResult | null> {
  const performances = target.stream.status === 'approved'
    ? await findHiddenPerformances(db, resolved.pendingTargets)
    : await findPublishingRelinks(db, target, resolved.relinks);
  return performances.length > 0 ? { ok: false, status: 409, error: 'would_publish_hidden', performances } : null;
}

/**
 * The refusal of an apply that would take rows of a stream that is not approved off the site (the
 * export ignores stream status); otherwise null. That is a relink that moves one of its on-site rows
 * onto a song that is not approved, a song the batch creates included: nothing promotes a song there,
 * so a created one stays pending. On an approved stream the promotion keeps such rows public.
 */
async function refuseUnpublishing(
  db: D1Database,
  target: CorrectionTarget,
  resolved: ResolvedPlan,
): Promise<ApplyCorrectionResult | null> {
  if (target.stream.status === 'approved') return null;
  const performanceIds = await findUnpublishingRelinks(db, target, resolved.relinks);
  return performanceIds.length > 0 ? { ok: false, status: 409, error: 'would_unpublish', performanceIds } : null;
}

/**
 * The refusal of an apply on an approved stream that would publish approved rows with no end, which stop the VOD export
 * for every streamer (MISSING_END_SECONDS); otherwise null. That is a promotion: the batch approves the pending songs
 * its added rows and its relinked approved rows land on (resolved.pendingTargets), which puts each of their approved
 * rows on an approved stream in the export. The target's rows the plan deletes, relinks to another song, or gives an
 * end are spared: the check inside the batch (preparePromotionGuard), which runs after those changes, finds them gone,
 * moved or ended. A row a relink publishes itself is planOperations' to refuse. On any other stream nothing is
 * promoted, and the export leaves the stream's rows out.
 */
async function refuseEndlessPublication(
  db: D1Database,
  target: CorrectionTarget,
  plan: CorrectionPlan,
  resolved: ResolvedPlan,
): Promise<ApplyCorrectionResult | null> {
  if (target.stream.status !== 'approved') return null;
  const songs = new Map(target.current.map((row) => [row.performanceId, row.songId]));
  const spared = [
    ...plan.deletes,
    ...resolved.relinks.filter((relink) => relink.songId !== songs.get(relink.performanceId)).map((relink) => relink.performanceId),
    ...plan.times.filter((times) => typeof times.endTimestamp === 'number').map((times) => times.performanceId),
  ];
  const performances = await findEndlessPerformances(db, resolved.pendingTargets, spared);
  return performances.length > 0 ? { ok: false, status: 409, error: 'would_publish_endless', performances } : null;
}

/** The last statement of an apply batch: the apply's record, by `curator`, which lands only if every change does. */
function prepareApplyRecord(db: D1Database, record: CorrectionApplyRecord, curator: string): D1PreparedStatement {
  return db
    .prepare('INSERT INTO vod_correction_applies (token, submission_id, reviewer_note, summary, actor) VALUES (?, ?, ?, ?, ?)')
    .bind(record.token, record.submissionId, record.reviewerNote, record.summary, curator);
}

/** Whether the apply record with this token exists, i.e. whether that apply's batch committed. */
async function applyRecorded(db: D1Database, token: string): Promise<boolean> {
  return await db.prepare('SELECT 1 FROM vod_correction_applies WHERE token = ?').bind(token).first() !== null;
}

/**
 * The newest record of the submission that was never announced, or null. An apply whose batch committed but whose
 * submission could not be marked reviewed (502 appliedToCatalog) leaves one; the approval that recovers it writes its
 * note and announces its summary. Records of one second keep the order they were written in. Every feedback embed for
 * the submission claims all of its open records first (claimOpenApplies), so one is never read after a later outcome.
 */
export async function findUnannouncedApply(
  db: D1Database,
  submissionId: string,
): Promise<Pick<CorrectionApplyRecord, 'token' | 'reviewerNote' | 'summary'> | null> {
  const row = await db
    .prepare(
      `SELECT token, reviewer_note, summary FROM vod_correction_applies
       WHERE submission_id = ? AND announced_at IS NULL
       ORDER BY applied_at DESC, rowid DESC
       LIMIT 1`,
    )
    .bind(submissionId)
    .first<{ token: string; reviewer_note: string; summary: string }>();
  return row ? { token: row.token, reviewerNote: row.reviewer_note, summary: row.summary } : null;
}

/**
 * Which of the submissions `ids` have a record of an apply that was never announced, in one query: what
 * findUnannouncedApply asks of one submission, asked of a whole list. Such a submission's changes are in the catalog but
 * it was never marked reviewed (502 appliedToCatalog), and only the approval that recovers that apply may follow.
 */
export async function findOpenApplies(db: D1Database, ids: string[]): Promise<Set<string>> {
  const open = new Set<string>();
  if (ids.length === 0) return open;
  const { results } = await db
    .prepare(
      `SELECT DISTINCT applied.submission_id
       FROM json_each(?) AS wanted
       JOIN vod_correction_applies AS applied ON applied.submission_id = wanted.value
       WHERE applied.announced_at IS NULL`,
    )
    .bind(JSON.stringify(ids))
    .all<{ submission_id: string }>();
  for (const row of results) open.add(row.submission_id);
  return open;
}

/**
 * Close every open record of the submission (announced_at NULL) and return the tokens this call closed. A feedback
 * embed for the submission claims before it is posted: once the contributor is told an outcome, no record of it may
 * announce or write its note back. One statement, so two claims never close the same record: an announcement of an
 * apply posts only when its own token is among the ones returned (or when the claim itself failed). Records already
 * closed keep their time. An apply that met another review posts nothing and closes only its own record (claimApply).
 */
export async function claimOpenApplies(db: D1Database, submissionId: string): Promise<string[]> {
  const { results } = await db
    .prepare(
      `UPDATE vod_correction_applies SET announced_at = datetime('now')
       WHERE submission_id = ? AND announced_at IS NULL
       RETURNING token`,
    )
    .bind(submissionId)
    .all<{ token: string }>();
  return results.map((row) => row.token);
}

/**
 * Close the one record `token` if it is still open, and resolve whether this call closed it: an apply whose mark found
 * another review there (409 status_changed) closes its own record and posts nothing. Only its own: every older open
 * record of the submission is claimed by that review's embed or recovered by its own approval, and closing those too
 * could take the one a recovery racing the apply is about to announce. A closed record keeps its time.
 */
export async function claimApply(db: D1Database, token: string): Promise<boolean> {
  const result = await db
    .prepare(`UPDATE vod_correction_applies SET announced_at = datetime('now') WHERE token = ? AND announced_at IS NULL`)
    .bind(token)
    .run();
  return result.meta.changes > 0;
}

/**
 * Apply a curator's reviewed operations to the target stream in one D1 batch, which also writes `record`.
 *
 * Nothing is written when any operation fails its checks (400, every problem listed: an
 * added row or a relinked one the apply would publish with no end among them, see
 * planOperations), when the batch would publish rows of a stream that is not approved (409
 * `would_publish_hidden`, those rows listed: see refuseHiddenPublication), when it would take
 * on-site rows of such a stream off the site (409 `would_unpublish`, their ids listed: see
 * refuseUnpublishing), when its promotion would publish approved rows with no end (409
 * `would_publish_endless`, those rows listed: see refuseEndlessPublication), when a relink
 * carries a status for its song that the plan does not read (409 `stale`, before any of the
 * 409s above: `expectedSongStatus`), or when, by the time the batch runs, the stream no longer
 * holds what `target` was loaded with, a relink destination changed status or stopped
 * qualifying, or a song the batch would create already exists (409 `stale`). The operations
 * are checked before the batch, and another apply or an edit can commit between those reads
 * and the batch, so the batch reads again what it relies on (its
 * opening guards everything the plan read, the one after the relinks the rows they must
 * neither publish nor take off the site, the one before the promotion the songs it promotes
 * and their rows' streams and ends) and rolls everything back when any of it moved. The
 * caller still compares `correctionFingerprint` first, which refuses a review of an older
 * load before any of this work. A batch call that rejects after its batch committed is
 * still a success: the record it wrote says so.
 */
export async function applyCorrection(
  db: D1Database,
  target: CorrectionTarget,
  operations: readonly CorrectionOperation[],
  curator: string,
  record: CorrectionApplyRecord,
): Promise<ApplyCorrectionResult> {
  const relinkTargets = await findRelinkTargets(db, target.stream.streamerId, operations);
  const { plan, details } = planOperations(target, operations, relinkTargets);
  if (details.length > 0) return { ok: false, status: 400, error: 'invalid_operations', details };

  const resolved = await resolvePlan(db, target, plan, relinkTargets);
  // The review showed another status for a song a relink lands on: the catalog moved after the page loaded, and the
  // refusals below would speak of changes the curator has not seen.
  if (resolved.statusMoved) return { ok: false, status: 409, error: 'stale' };
  const hidden = await refuseHiddenPublication(db, target, resolved);
  if (hidden) return hidden;
  const unpublishing = await refuseUnpublishing(db, target, resolved);
  if (unpublishing) return unpublishing;
  const endless = await refuseEndlessPublication(db, target, plan, resolved);
  if (endless) return endless;

  const statements = prepareCorrectionBatch(db, target, plan, resolved, curator);
  // An apply of operations that change nothing (a setTimes or renameSong with no field) builds no statement, and so
  // sends no batch and writes no record.
  if (statements.length === 0) return { ok: true };
  try {
    await db.batch([...prepareOpeningGuards(db, target, resolved), ...statements, prepareApplyRecord(db, record, curator)]);
  } catch (error) {
    // D1 can commit a batch and still reject the call. Against the stream as loaded, this apply's own writes would
    // read as rows that moved, so its record decides: when the record is there, every change landed. A record that
    // cannot be read leaves the outcome unknown, and the batch's own error stands. The read's error is logged first:
    // it alone tells an unknown outcome from a batch that failed.
    const recorded = await applyRecorded(db, record.token).catch((readError: unknown) => {
      console.error(
        `VOD correction batch's D1 call failed, and the apply record of submission ${record.submissionId} (token ${record.token}) could not be read back: whether the batch committed is unknown`,
        readError,
      );
      throw error;
    });
    if (recorded) {
      console.warn('VOD correction batch committed, but its D1 call failed', error);
      return { ok: true };
    }
    // A guard failed, and the batch with it, because the catalog moved after the checks above:
    // what an opening guard reads (stale), the rows a relink or a promotion would publish
    // (would_publish_hidden), the rows a relink would take off the site (would_unpublish), or
    // the rows with no end a promotion would publish (would_publish_endless). Read them again
    // to say which. A batch that failed while none of them moved failed for another reason.
    // A read that fails here does not say which: the batch's own error stands, as it does for the
    // record above, never the read's. The caller sees only the batch's, so the read's is logged
    // beside it, the one sign that the re-check could not run.
    try {
      if (await openingGuardsMoved(db, target, resolved)) return { ok: false, status: 409, error: 'stale' };
      const again = await resolvePlan(db, target, plan, await findRelinkTargets(db, target.stream.streamerId, operations));
      const hiddenNow = await refuseHiddenPublication(db, target, again);
      if (hiddenNow) return hiddenNow;
      const unpublishingNow = await refuseUnpublishing(db, target, again);
      if (unpublishingNow) return unpublishingNow;
      const endlessNow = await refuseEndlessPublication(db, target, plan, again);
      if (endlessNow) return endlessNow;
    } catch (readError) {
      console.error(
        `VOD correction batch's D1 call failed, and the re-check of the catalog after it (submission ${record.submissionId}, token ${record.token}) could not be read: the batch's own error is rethrown, and logged here with the read's`,
        error,
        readError,
      );
    }
    throw error;
  }
  return { ok: true };
}
