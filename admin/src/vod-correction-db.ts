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

export type ApplyCorrectionResult =
  | { ok: true }
  | { ok: false; status: 400; error: 'invalid_operations'; details: string[] }
  | { ok: false; status: 409; error: 'would_publish_hidden'; performances: Array<{ performanceId: string; streamId: string; songId: string }> }
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
 * (rejected and excluded rows stay out of the diff). `songPerformanceCount` counts
 * every performance of the song, in any stream and of any status: a rename reaches
 * all of them.
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
               (candidate.title = wanted.title AND candidate.original_artist = wanted.original_artist
                AND candidate.id NOT IN (SELECT value FROM json_each(?)))
               OR candidate.id IN (SELECT value FROM json_each(wanted.renamed_into))
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
  relinksToSong: Array<{ performanceId: string; songId: string }>;
  relinksToNewSong: Array<{ performanceId: string } & SongIdentity>;
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
 * Each problem is reported as `operation {index}: {reason}`; the plan is only usable
 * when there are none.
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
  const details: string[] = [];

  operations.forEach((operation, index) => {
    const fail = (reason: string) => { details.push(`operation ${index}: ${reason}`); };
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
        if (!relinkTargets.has(operation.songId)) {
          fail(`song ${operation.songId} is not an approved or pending song of this streamer`);
          return;
        }
        if (row) plan.relinksToSong.push({ performanceId: row.performanceId, songId: operation.songId });
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
          });
        }
        return;
      }
      case 'addPerformance': {
        const blank = isBlank(operation.title);
        if (blank) fail('title must not be empty');
        const inverted = !endsAfterStart(operation.timestamp, operation.endTimestamp);
        if (inverted) fail(`end must be greater than start (start ${operation.timestamp}, end ${operation.endTimestamp})`);
        if (blank || inverted) return;
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
  return { plan, details };
}

interface NewSong extends SongIdentity {
  id: string;
  workId: string;
}

/**
 * An existing song a relink lands on that the target guard does not read: a `relinkToSong`
 * target, which must stay one of the streamer's approved or pending songs, or the catalog song
 * a `relinkToNewSong` was matched to, which must also keep the identity it was matched by.
 */
interface RelinkDestination {
  songId: string;
  identity: SongIdentity | null;
}

/** Where every relink points, the songs to create for them, and the pending songs relinked or added rows may land on. */
interface ResolvedPlan {
  relinks: Array<{ performanceId: string; songId: string }>;
  newSongs: NewSong[];
  pendingTargets: string[];
  /** Relink destinations read before the batch; a song renamed into a relink's identity is a target row instead. */
  destinations: RelinkDestination[];
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
  const pendingTargets = new Set<string>();
  const relinks = [...plan.relinksToSong];
  const destinations: RelinkDestination[] = plan.relinksToSong.map((relink) => ({ songId: relink.songId, identity: null }));
  const ranked: RankedRelink[] = [];
  for (const relink of plan.relinksToSong) {
    if (relinkTargets.get(relink.songId) === 'pending') pendingTargets.add(relink.songId);
  }
  const newSongs = new Map<string, NewSong>();
  plan.relinksToNewSong.forEach((relink, index) => {
    const key = identityKey(relink);
    const existing = found[index];
    if (existing) {
      if (existing.status === 'pending') pendingTargets.add(existing.id);
      // A song renamed into the identity is a target row, which the target guard reads.
      if (!renamed.has(existing.id)) {
        destinations.push({ songId: existing.id, identity: { title: relink.title, originalArtist: relink.originalArtist } });
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
  return { relinks, newSongs: [...newSongs.values()], pendingTargets: [...pendingTargets], destinations, renamedAway, ranked };
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
  // Off an approved stream nothing is published, and a relink onto a song approved after the check would.
  const hidden = review ? [] : hiddenRelinks(target, resolved.relinks).map((relink) => relink.performanceId);
  if (hidden.length > 0) statements.push(prepareRelinkPublicationGuard(db, stream.id, hidden));
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

  // A pending song an applied row now points at would keep that row off the site. Its guard
  // reads the songs this batch actually lands on, which the check before the batch could only
  // predict.
  const landed = [...resolved.relinks.map((relink) => relink.performanceId), ...added.performanceIds];
  if (review && landed.length > 0) {
    statements.push(
      preparePromotionGuard(db, stream.id, landed),
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
 * Holds while every relink destination is still one of the streamer's approved or pending songs
 * and, for one matched by identity, still has the title and artist it was matched by. Read at the
 * start of the batch: no earlier statement changes these songs, since a song this batch renames
 * is never matched by identity and a rename keeps a song's status.
 */
function destinationValidity(target: CorrectionTarget, resolved: ResolvedPlan): Validity {
  return {
    sql: `WITH destination AS (
       SELECT value ->> '$.songId' AS song_id, value ->> '$.title' AS title, value ->> '$.originalArtist' AS original_artist
       FROM json_each(?)
     ), merge_guard(valid) AS (
       SELECT NOT EXISTS (
         SELECT 1
         FROM destination
         LEFT JOIN songs AS song ON song.id = destination.song_id AND song.streamer_id = ?
         WHERE song.id IS NULL
            OR COALESCE(song.status, '') NOT IN ('approved', 'pending')
            OR (destination.title IS NOT NULL
                AND (song.title IS NOT destination.title OR song.original_artist IS NOT destination.original_artist))
       )
     )`,
    bindings: [
      JSON.stringify(resolved.destinations.map(({ songId, identity }) => ({ songId, ...identity }))),
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
 * rule), as the catalog stands inside the transaction.
 */
function preparePromotionGuard(db: D1Database, streamId: string, landed: readonly string[]): D1PreparedStatement {
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
           AND stream.status IS NOT 'approved'
       )
     )`,
    [JSON.stringify(landed)],
    `vod-correction-promotion:${streamId}`,
  );
}

/**
 * On a stream that is not approved, the relinks of rows the export leaves out because their song
 * is not approved: an approved row whose current song is not approved.
 */
function hiddenRelinks(target: CorrectionTarget, relinks: ResolvedPlan['relinks']): ResolvedPlan['relinks'] {
  const rows = new Map(target.current.map((row) => [row.performanceId, row]));
  return relinks.filter((relink) => {
    const row = rows.get(relink.performanceId)!;
    return row.status === 'approved' && row.songStatus !== 'approved';
  });
}

/** The hiddenRelinks that land on an approved song, as the catalog stands now: each would publish its row. */
async function findPublishingRelinks(
  db: D1Database,
  target: CorrectionTarget,
  relinks: ResolvedPlan['relinks'],
): Promise<Array<{ performanceId: string; streamId: string; songId: string }>> {
  const hidden = hiddenRelinks(target, relinks);
  if (hidden.length === 0) return [];
  const { results } = await db
    .prepare("SELECT id FROM songs WHERE status = 'approved' AND id IN (SELECT value FROM json_each(?))")
    .bind(JSON.stringify(hidden.map((relink) => relink.songId)))
    .all<{ id: string }>();
  const approved = new Set(results.map((row) => row.id));
  return hidden
    .filter((relink) => approved.has(relink.songId))
    .map((relink) => ({ performanceId: relink.performanceId, streamId: target.stream.id, songId: relink.songId }));
}

/**
 * On a stream that is not approved, the statement right after the relinks: it fails if a row
 * hiddenRelinks named now points at an approved song.
 */
function prepareRelinkPublicationGuard(db: D1Database, streamId: string, performanceIds: readonly string[]): D1PreparedStatement {
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
       )
     )`,
    [JSON.stringify(performanceIds)],
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
 * Apply a curator's reviewed operations to the target stream in one D1 batch.
 *
 * Nothing is written when any operation fails its checks (400, every problem listed),
 * when the batch would publish rows of a stream that is not approved (409
 * `would_publish_hidden`, those rows listed: see refuseHiddenPublication), or when, by the
 * time the batch runs, the stream no longer holds what `target` was loaded with, a relink
 * destination stopped qualifying, or a song the batch would create already exists (409
 * `stale`). The operations are checked before the batch, and another apply or an edit can
 * commit between those reads and the batch, so the batch reads again what it relies on
 * (its opening guards everything the plan read, the one after the relinks the rows they
 * must not publish, the one before the promotion the songs it promotes) and rolls
 * everything back when any of it moved. The caller still compares `correctionFingerprint`
 * first, which refuses a review of an older load before any of this work.
 */
export async function applyCorrection(
  db: D1Database,
  target: CorrectionTarget,
  operations: readonly CorrectionOperation[],
  curator: string,
): Promise<ApplyCorrectionResult> {
  const relinkTargets = await findRelinkTargets(db, target.stream.streamerId, operations);
  const { plan, details } = planOperations(target, operations, relinkTargets);
  if (details.length > 0) return { ok: false, status: 400, error: 'invalid_operations', details };

  const resolved = await resolvePlan(db, target, plan, relinkTargets);
  const hidden = await refuseHiddenPublication(db, target, resolved);
  if (hidden) return hidden;

  const statements = prepareCorrectionBatch(db, target, plan, resolved, curator);
  // An apply of operations that change nothing (a setTimes or renameSong with no field) builds no statement.
  if (statements.length === 0) return { ok: true };
  try {
    await db.batch([...prepareOpeningGuards(db, target, resolved), ...statements]);
  } catch (error) {
    // A guard failed, and the batch with it, because the catalog moved after the checks above:
    // what an opening guard reads (stale), or the rows a relink or a promotion would publish
    // (would_publish_hidden). Read them again to say which. A batch that failed while none of
    // them moved failed for another reason.
    if (await openingGuardsMoved(db, target, resolved)) return { ok: false, status: 409, error: 'stale' };
    const again = await resolvePlan(db, target, plan, await findRelinkTargets(db, target.stream.streamerId, operations));
    const hiddenNow = await refuseHiddenPublication(db, target, again);
    if (hiddenNow) return hiddenNow;
    throw error;
  }
  return { ok: true };
}
