import { GLOBAL_WORK_MERGE_SOURCE_LIMIT } from '../shared/types';
import type {
  WorkMatchCandidate,
  WorkMatchCandidateWork,
  WorkMatchDecision,
  WorkMatchFilter,
  WorkMatchMergeBody,
  WorkMatchMergeResponse,
  WorkMatchReason,
  WorkMatchReviewBody,
  WorkMatchStats,
} from '../shared/types';
import { normalizeForMatching } from '../shared/normalize';

const WORK_MATCH_ALGORITHM = 'tier-a-v1';
const WORK_MATCH_GUARD_ACTOR = 'system:global-work-review-guard';
const HEX_64 = /^[0-9a-f]{64}$/;
const LETTER_OR_NUMBER = /[\p{L}\p{N}]/u;
const LATIN_CHARACTER = /\p{Script=Latin}/u;
const COMBINING_MARK = /\p{M}/u;
const PUNCTUATION_OR_SEPARATOR = /[\p{P}\p{Z}]/u;

export interface WorkMatchSourceRow {
  work_id: string;
  title: string;
  original_artist: string;
  work_tags: string;
  work_created_at: string;
  work_updated_at: string;
  song_id: string;
  streamer_id: string;
  song_status: string;
  performance_count: number;
}

interface WorkMatchReviewRow {
  candidate_key: string;
  fingerprint: string;
  decision: WorkMatchDecision;
  note: string;
  review_version: number;
  reviewed_by: string;
  reviewed_at: string;
}

interface WorkSnapshot extends WorkMatchCandidateWork {
  rawTags: string;
  songIds: string[];
  songCountsByStreamer: Map<string, number>;
}

interface InternalCandidate {
  candidate: WorkMatchCandidate;
  snapshots: WorkSnapshot[];
}

interface WorkMatchScan {
  revision: number;
  candidates: InternalCandidate[];
}

export type WorkMatchErrorCode = 'invalid_request' | 'work_match_stale';

export class WorkMatchError extends Error {
  constructor(
    readonly code: WorkMatchErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'WorkMatchError';
  }
}

function parseTags(rawTags: string): string[] {
  try {
    const value: unknown = JSON.parse(rawTags);
    return Array.isArray(value)
      ? value.filter((tag): tag is string => typeof tag === 'string')
      : [];
  } catch {
    return [];
  }
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** Remove only punctuation and spacing, retaining semantic marks and symbols. */
export function compactWorkText(text: string): string {
  return Array.from(normalizeForMatching(text))
    .filter((character) => !PUNCTUATION_OR_SEPARATOR.test(character))
    .join('');
}

/** Fold accents for Latin text without stripping Japanese dakuten/handakuten. */
export function accentCompactWorkText(text: string): string {
  const characters: string[] = [];
  let lastBaseWasLatin = false;
  for (const character of normalizeForMatching(text)) {
    if (LATIN_CHARACTER.test(character)) {
      lastBaseWasLatin = true;
      for (const part of character.normalize('NFKD')) {
        if (!COMBINING_MARK.test(part) && LETTER_OR_NUMBER.test(part)) {
          characters.push(part);
        }
      }
    } else if (COMBINING_MARK.test(character)) {
      if (!lastBaseWasLatin) characters.push(character);
    } else if (!PUNCTUATION_OR_SEPARATOR.test(character)) {
      characters.push(character);
      lastBaseWasLatin = false;
    } else {
      lastBaseWasLatin = false;
    }
  }
  return characters.join('');
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function snapshotsFromRows(rows: WorkMatchSourceRow[]): WorkSnapshot[] {
  const snapshots = new Map<string, WorkSnapshot>();

  for (const row of rows) {
    let snapshot = snapshots.get(row.work_id);
    if (!snapshot) {
      snapshot = {
        id: row.work_id,
        title: row.title,
        originalArtist: row.original_artist,
        tags: parseTags(row.work_tags),
        rawTags: row.work_tags,
        streamerCount: 0,
        songCount: 0,
        performanceCount: 0,
        approvedSongCount: 0,
        pendingSongCount: 0,
        streamerIds: [],
        createdAt: row.work_created_at,
        updatedAt: row.work_updated_at,
        songIds: [],
        songCountsByStreamer: new Map(),
      };
      snapshots.set(row.work_id, snapshot);
    }

    snapshot.songIds.push(row.song_id);
    snapshot.songCount += 1;
    snapshot.performanceCount += Number(row.performance_count) || 0;
    if (row.song_status === 'approved') snapshot.approvedSongCount += 1;
    if (row.song_status === 'pending') snapshot.pendingSongCount += 1;
    snapshot.songCountsByStreamer.set(
      row.streamer_id,
      (snapshot.songCountsByStreamer.get(row.streamer_id) ?? 0) + 1,
    );
  }

  for (const snapshot of snapshots.values()) {
    snapshot.songIds.sort(compareText);
    snapshot.streamerIds = [...snapshot.songCountsByStreamer.keys()].sort(compareText);
    snapshot.streamerCount = snapshot.streamerIds.length;
  }

  return [...snapshots.values()].sort((left, right) => compareText(left.id, right.id));
}

function canonicalOrder(left: WorkSnapshot, right: WorkSnapshot): number {
  return (
    right.performanceCount - left.performanceCount
    || right.songCount - left.songCount
    || right.approvedSongCount - left.approvedSongCount
    || compareText(left.title.toLowerCase(), right.title.toLowerCase())
    || compareText(left.id, right.id)
  );
}

function publicWork(snapshot: WorkSnapshot): WorkMatchCandidateWork {
  return {
    id: snapshot.id,
    title: snapshot.title,
    originalArtist: snapshot.originalArtist,
    tags: snapshot.tags,
    streamerCount: snapshot.streamerCount,
    songCount: snapshot.songCount,
    performanceCount: snapshot.performanceCount,
    approvedSongCount: snapshot.approvedSongCount,
    pendingSongCount: snapshot.pendingSongCount,
    streamerIds: snapshot.streamerIds,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
  };
}

async function buildInternalCandidates(
  rows: WorkMatchSourceRow[],
  catalogRevision = 0,
): Promise<InternalCandidate[]> {
  const works = snapshotsFromRows(rows);
  const parent = works.map((_, index) => index);

  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root]!;
    while (parent[index] !== index) {
      const next = parent[index]!;
      parent[index] = root;
      index = next;
    }
    return root;
  };

  const union = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };

  const edges: Array<{ left: number; right: number; reason: WorkMatchReason }> = [];
  const addEdges = (
    keyFor: (work: WorkSnapshot) => readonly [string, string],
    reason: WorkMatchReason,
    skipPair?: (left: WorkSnapshot, right: WorkSnapshot) => boolean,
  ): void => {
    const groups = new Map<string, number[]>();
    works.forEach((work, index) => {
      const key = keyFor(work);
      if (!key[0] || !key[1]) return;
      const encoded = JSON.stringify(key);
      const group = groups.get(encoded);
      if (group) group.push(index);
      else groups.set(encoded, [index]);
    });

    for (const indexes of groups.values()) {
      for (let leftOffset = 0; leftOffset < indexes.length; leftOffset += 1) {
        for (let rightOffset = leftOffset + 1; rightOffset < indexes.length; rightOffset += 1) {
          const leftIndex = indexes[leftOffset]!;
          const rightIndex = indexes[rightOffset]!;
          const left = works[leftIndex]!;
          const right = works[rightIndex]!;
          if (
            (left.title === right.title && left.originalArtist === right.originalArtist)
            || skipPair?.(left, right)
          ) continue;
          edges.push({ left: leftIndex, right: rightIndex, reason });
          union(leftIndex, rightIndex);
        }
      }
    }
  };

  addEdges(
    (work) => [
      normalizeForMatching(work.title),
      normalizeForMatching(work.originalArtist),
    ],
    'case_width_whitespace',
  );
  addEdges(
    (work) => [compactWorkText(work.title), compactWorkText(work.originalArtist)],
    'punctuation_spacing',
    (left, right) => (
      normalizeForMatching(left.title) === normalizeForMatching(right.title)
      && normalizeForMatching(left.originalArtist) === normalizeForMatching(right.originalArtist)
    ),
  );
  addEdges(
    (work) => [
      accentCompactWorkText(work.title),
      accentCompactWorkText(work.originalArtist),
    ],
    'diacritic_variant',
    (left, right) => (
      compactWorkText(left.title) === compactWorkText(right.title)
      && compactWorkText(left.originalArtist) === compactWorkText(right.originalArtist)
    ),
  );

  const components = new Map<number, number[]>();
  works.forEach((_, index) => {
    const root = find(index);
    const component = components.get(root);
    if (component) component.push(index);
    else components.set(root, [index]);
  });

  const candidates = await Promise.all(
    [...components.values()]
      .filter((indexes) => indexes.length >= 2)
      .map(async (indexes): Promise<InternalCandidate> => {
        const snapshots = indexes.map((index) => works[index]!).sort(canonicalOrder);
        const workIds = snapshots.map((work) => work.id).sort(compareText);
        const indexSet = new Set(indexes);
        const reasons = [...new Set(
          edges
            .filter((edge) => indexSet.has(edge.left) && indexSet.has(edge.right))
            .map((edge) => edge.reason),
        )].sort(compareText);
        const candidateKey = await sha256Hex(JSON.stringify([WORK_MATCH_ALGORITHM, workIds]));
        const identityState = [...snapshots]
          .sort((left, right) => compareText(left.id, right.id))
          .map((work) => [work.id, work.title, work.originalArtist]);
        const fingerprint = await sha256Hex(JSON.stringify([WORK_MATCH_ALGORITHM, identityState]));
        const streamerIds = new Set<string>();
        const songsByStreamer = new Map<string, number>();
        for (const work of snapshots) {
          work.streamerIds.forEach((streamerId) => streamerIds.add(streamerId));
          for (const [streamerId, count] of work.songCountsByStreamer) {
            songsByStreamer.set(streamerId, (songsByStreamer.get(streamerId) ?? 0) + count);
          }
        }

        return {
          snapshots,
          candidate: {
            candidateKey,
            fingerprint,
            catalogRevision,
            confidence: 'high',
            reasons,
            works: snapshots.map(publicWork),
            suggestedCanonicalWorkId: snapshots[0]!.id,
            streamerCount: streamerIds.size,
            songCount: snapshots.reduce((sum, work) => sum + work.songCount, 0),
            performanceCount: snapshots.reduce((sum, work) => sum + work.performanceCount, 0),
            localDuplicates: [...songsByStreamer]
              .filter(([, count]) => count > 1)
              .map(([streamerId, songCount]) => ({ streamerId, songCount }))
              .sort((left, right) => compareText(left.streamerId, right.streamerId)),
            decision: null,
            reviewNote: '',
            reviewVersion: null,
            reviewedBy: null,
            reviewedAt: null,
          },
        };
      }),
  );

  return candidates.sort((left, right) => (
    right.candidate.performanceCount - left.candidate.performanceCount
    || right.candidate.works.length - left.candidate.works.length
    || compareText(left.candidate.works[0]?.title ?? '', right.candidate.works[0]?.title ?? '')
    || compareText(left.candidate.candidateKey, right.candidate.candidateKey)
  ));
}

export async function buildHighConfidenceWorkCandidates(
  rows: WorkMatchSourceRow[],
): Promise<WorkMatchCandidate[]> {
  return (await buildInternalCandidates(rows)).map(({ candidate }) => candidate);
}

function reviewMapKey(candidateKey: string, fingerprint: string): string {
  return `${candidateKey}:${fingerprint}`;
}

async function scanWorkMatches(db: D1Database): Promise<WorkMatchScan> {
  const [stateResult, sourceResult, reviewResult] = await db.batch([
    db.prepare('SELECT revision FROM work_match_state WHERE id = 1'),
    db.prepare(`WITH performance_counts AS (
      SELECT song_id, COUNT(*) AS performance_count
      FROM performances
      GROUP BY song_id
    )
    SELECT work.id AS work_id,
           work.title,
           work.original_artist,
           work.tags AS work_tags,
           work.created_at AS work_created_at,
           work.updated_at AS work_updated_at,
           song.id AS song_id,
           song.streamer_id,
           song.status AS song_status,
           COALESCE(performance_counts.performance_count, 0) AS performance_count
    FROM works AS work
    JOIN song_work_links AS link ON link.work_id = work.id
    JOIN songs AS song ON song.id = link.song_id
    LEFT JOIN performance_counts ON performance_counts.song_id = song.id
    ORDER BY work.id, song.id`),
    db.prepare(`SELECT candidate_key, fingerprint, decision, note, review_version,
                       reviewed_by, reviewed_at
                FROM work_match_reviews`),
  ]);

  const state = stateResult.results[0] as { revision?: number | string } | undefined;
  const revision = Number(state?.revision);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error('Global work review state is missing or invalid; apply migration 0006');
  }

  const candidates = await buildInternalCandidates(
    sourceResult.results as unknown as WorkMatchSourceRow[],
    revision,
  );
  const reviews = new Map(
    (reviewResult.results as unknown as WorkMatchReviewRow[]).map((review) => [
      reviewMapKey(review.candidate_key, review.fingerprint),
      review,
    ]),
  );

  for (const internal of candidates) {
    const review = reviews.get(reviewMapKey(
      internal.candidate.candidateKey,
      internal.candidate.fingerprint,
    ));
    if (!review) continue;
    internal.candidate = {
      ...internal.candidate,
      decision: review.decision,
      reviewNote: review.note,
      reviewVersion: Number(review.review_version),
      reviewedBy: review.reviewed_by,
      reviewedAt: review.reviewed_at,
    };
  }

  return { revision, candidates };
}

export async function listWorkMatchCandidates(
  db: D1Database,
  options: {
    filter?: WorkMatchFilter;
    page?: number;
    pageSize?: number;
  } = {},
): Promise<{
  data: WorkMatchCandidate[];
  total: number;
  page: number;
  pageSize: number;
  stats: WorkMatchStats;
}> {
  const scan = await scanWorkMatches(db);
  const all = scan.candidates.map(({ candidate }) => candidate);
  const stats: WorkMatchStats = {
    candidateCount: all.length,
    pendingCount: all.filter((candidate) => candidate.decision === null).length,
    notDuplicateCount: all.filter((candidate) => candidate.decision === 'not_duplicate').length,
    needsResearchCount: all.filter((candidate) => candidate.decision === 'needs_research').length,
    affectedWorks: all.reduce((sum, candidate) => sum + candidate.works.length, 0),
  };
  const filter = options.filter ?? 'pending';
  const filtered = filter === 'all'
    ? all
    : all.filter((candidate) => (
      filter === 'pending' ? candidate.decision === null : candidate.decision === filter
    ));
  const requestedPage = Number.isFinite(options.page) ? Math.trunc(options.page!) : 1;
  const requestedPageSize = Number.isFinite(options.pageSize) ? Math.trunc(options.pageSize!) : 25;
  const page = Math.max(1, requestedPage);
  const pageSize = Math.min(50, Math.max(1, requestedPageSize));
  const offset = (page - 1) * pageSize;

  return {
    data: filtered.slice(offset, offset + pageSize),
    total: filtered.length,
    page,
    pageSize,
    stats,
  };
}

function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const orderedLeft = [...left].sort(compareText);
  const orderedRight = [...right].sort(compareText);
  return orderedLeft.every((value, index) => value === orderedRight[index]);
}

function validateHash(value: string): boolean {
  return HEX_64.test(value);
}

async function resolveCurrentCandidate(
  db: D1Database,
  candidateKey: string,
  fingerprint: string,
): Promise<{ scan: WorkMatchScan; candidate: InternalCandidate }> {
  if (!validateHash(candidateKey) || !validateHash(fingerprint)) {
    throw new WorkMatchError('invalid_request', 'Invalid candidate identity');
  }
  const scan = await scanWorkMatches(db);
  const candidate = scan.candidates.find((item) => item.candidate.candidateKey === candidateKey);
  if (!candidate || candidate.candidate.fingerprint !== fingerprint) {
    throw new WorkMatchError(
      'work_match_stale',
      'This candidate changed after review; refresh the scan before continuing',
    );
  }
  return { scan, candidate };
}

export async function reviewWorkMatchCandidate(
  db: D1Database,
  body: WorkMatchReviewBody,
  reviewedBy: string,
): Promise<void> {
  const note = body.note?.trim() ?? '';
  if (
    !reviewedBy
    || !Array.isArray(body.workIds)
    || body.workIds.length < 2
    || new Set(body.workIds).size !== body.workIds.length
    || (body.decision !== 'not_duplicate' && body.decision !== 'needs_research')
    || (body.expectedReviewVersion !== null && (
      !Number.isSafeInteger(body.expectedReviewVersion)
      || body.expectedReviewVersion < 1
    ))
    || note.length > 2000
  ) {
    throw new WorkMatchError('invalid_request', 'Invalid global work review decision');
  }

  const { scan, candidate } = await resolveCurrentCandidate(
    db,
    body.candidateKey,
    body.fingerprint,
  );
  const currentWorkIds = candidate.snapshots.map((work) => work.id);
  if (!sameStringSet(body.workIds, currentWorkIds)) {
    throw new WorkMatchError('work_match_stale', 'The reviewed work set has changed');
  }
  if (body.expectedReviewVersion !== candidate.candidate.reviewVersion) {
    throw new WorkMatchError(
      'work_match_stale',
      'This review decision changed after it was displayed; refresh before overwriting it',
    );
  }

  const expectedIdentity = JSON.stringify(Object.fromEntries(
    candidate.snapshots.map((work) => [work.id, {
      title: work.title,
      originalArtist: work.originalArtist,
    }]),
  ));
  const workIdsJson = JSON.stringify([...currentWorkIds].sort(compareText));
  const result = await db.prepare(
    `WITH expected_work_state(work_id, title, original_artist) AS (
       SELECT key,
              json_extract(value, '$.title'),
              json_extract(value, '$.originalArtist')
       FROM json_each(?)
     ),
     review_guard(valid) AS (
       SELECT
         (SELECT revision FROM work_match_state WHERE id = 1) = ?
         AND (
           SELECT COUNT(*)
           FROM expected_work_state AS expected
           JOIN works AS current
             ON current.id = expected.work_id
            AND current.title = expected.title
            AND current.original_artist = expected.original_artist
         ) = (SELECT COUNT(*) FROM expected_work_state)
         AND (
           (? IS NULL AND NOT EXISTS (
             SELECT 1 FROM work_match_reviews
             WHERE candidate_key = ? AND fingerprint = ?
           ))
           OR (? IS NOT NULL AND EXISTS (
             SELECT 1 FROM work_match_reviews
             WHERE candidate_key = ? AND fingerprint = ?
               AND review_version = ?
           ))
         )
     )
     INSERT INTO work_match_reviews (
       candidate_key, fingerprint, work_ids, decision,
       note, review_version, reviewed_by, reviewed_at
     )
     SELECT ?, ?, ?, ?, ?, 1, ?, datetime('now')
     FROM review_guard
     WHERE valid
     ON CONFLICT(candidate_key, fingerprint) DO UPDATE SET
       work_ids = excluded.work_ids,
       decision = excluded.decision,
       note = excluded.note,
       review_version = work_match_reviews.review_version + 1,
       reviewed_by = excluded.reviewed_by,
       reviewed_at = excluded.reviewed_at
     RETURNING candidate_key`,
  ).bind(
    expectedIdentity,
    scan.revision,
    body.expectedReviewVersion,
    body.candidateKey,
    body.fingerprint,
    body.expectedReviewVersion,
    body.candidateKey,
    body.fingerprint,
    body.expectedReviewVersion,
    body.candidateKey,
    body.fingerprint,
    workIdsJson,
    body.decision,
    note,
    reviewedBy,
  ).all<{ candidate_key: string }>();

  if (result.results.length !== 1) {
    throw new WorkMatchError(
      'work_match_stale',
      'The global work catalog changed while saving this decision; refresh and retry',
    );
  }
}

function guardedWorkMergeStatement(
  db: D1Database,
  guardToken: string,
  canonicalWorkId: string,
  sql: string,
  bindings: unknown[] = [],
): D1PreparedStatement {
  return db.prepare(
    `WITH work_merge_guard(valid) AS (
       SELECT EXISTS (
         SELECT 1
         FROM work_aliases
         WHERE source_work_id = ?
           AND canonical_work_id = ?
           AND merged_by = '${WORK_MATCH_GUARD_ACTOR}'
       )
     )
     ${sql}`,
  ).bind(guardToken, canonicalWorkId, ...bindings);
}

export async function mergeWorkMatchCandidate(
  db: D1Database,
  body: WorkMatchMergeBody,
  mergedBy: string,
): Promise<WorkMatchMergeResponse> {
  const note = body.note?.trim() ?? '';
  if (
    !mergedBy
    || !Number.isSafeInteger(body.catalogRevision)
    || body.catalogRevision < 0
    || (body.expectedReviewVersion !== null && (
      !Number.isSafeInteger(body.expectedReviewVersion)
      || body.expectedReviewVersion < 1
    ))
    || !body.canonicalWorkId
    || !Array.isArray(body.sourceWorkIds)
    || body.sourceWorkIds.length === 0
    || body.sourceWorkIds.length > GLOBAL_WORK_MERGE_SOURCE_LIMIT
    || new Set(body.sourceWorkIds).size !== body.sourceWorkIds.length
    || body.sourceWorkIds.includes(body.canonicalWorkId)
    || note.length > 2000
  ) {
    throw new WorkMatchError('invalid_request', 'Invalid global work merge request');
  }

  const { scan, candidate } = await resolveCurrentCandidate(
    db,
    body.candidateKey,
    body.fingerprint,
  );
  const workById = new Map(candidate.snapshots.map((work) => [work.id, work]));
  const canonical = workById.get(body.canonicalWorkId);
  if (body.catalogRevision !== scan.revision) {
    throw new WorkMatchError(
      'work_match_stale',
      'The displayed catalog changed before confirmation; refresh and review the impact again',
    );
  }
  if (body.expectedReviewVersion !== candidate.candidate.reviewVersion) {
    throw new WorkMatchError(
      'work_match_stale',
      'This candidate review changed before confirmation; refresh and review the impact again',
    );
  }
  if (!canonical || body.sourceWorkIds.some((workId) => !workById.has(workId))) {
    throw new WorkMatchError(
      'work_match_stale',
      'The confirmed canonical/source work IDs no longer belong to this candidate',
    );
  }

  const sourceWorkIds = [...body.sourceWorkIds].sort(compareText);
  const mergeSnapshots = [
    canonical,
    ...sourceWorkIds.map((workId) => workById.get(workId)!),
  ];
  const sourcePlaceholders = sourceWorkIds.map(() => '?').join(', ');
  const expectedWorkState = JSON.stringify(Object.fromEntries(
    mergeSnapshots.map((work) => [work.id, {
      title: work.title,
      originalArtist: work.originalArtist,
      tags: work.rawTags,
      updatedAt: work.updatedAt,
    }]),
  ));
  const expectedLinks = JSON.stringify(Object.fromEntries(
    mergeSnapshots.flatMap((work) => work.songIds.map((songId) => [songId, work.id])),
  ));
  const mergedTags = [...new Set(mergeSnapshots.flatMap((work) => work.tags))];
  const guardToken = `work-match-guard-${crypto.randomUUID()}`;
  const guarded = (sql: string, bindings: unknown[] = []): D1PreparedStatement => (
    guardedWorkMergeStatement(db, guardToken, canonical.id, sql, bindings)
  );

  const statements: D1PreparedStatement[] = [
    db.prepare(
      `WITH expected_work_state(
         work_id, title, original_artist, tags, updated_at
       ) AS (
         SELECT key,
                json_extract(value, '$.title'),
                json_extract(value, '$.originalArtist'),
                json_extract(value, '$.tags'),
                json_extract(value, '$.updatedAt')
         FROM json_each(?)
       ),
       expected_links(song_id, work_id) AS (
         SELECT key, value FROM json_each(?)
       ),
       merge_guard(valid) AS (
         SELECT
           (SELECT revision FROM work_match_state WHERE id = 1) = ?
           AND (
             SELECT COUNT(*)
             FROM expected_work_state AS expected
             JOIN works AS current
               ON current.id = expected.work_id
              AND current.title = expected.title
              AND current.original_artist = expected.original_artist
              AND current.tags = expected.tags
              AND current.updated_at = expected.updated_at
           ) = (SELECT COUNT(*) FROM expected_work_state)
           AND (
             SELECT COUNT(*)
             FROM song_work_links AS current_link
             WHERE current_link.work_id IN (
               SELECT work_id FROM expected_work_state
             )
           ) = (SELECT COUNT(*) FROM expected_links)
           AND (
             SELECT COUNT(*)
             FROM expected_links AS expected_link
             JOIN song_work_links AS current_link
               ON current_link.song_id = expected_link.song_id
              AND current_link.work_id = expected_link.work_id
           ) = (SELECT COUNT(*) FROM expected_links)
           AND (
             (? IS NULL AND NOT EXISTS (
               SELECT 1 FROM work_match_reviews
               WHERE candidate_key = ? AND fingerprint = ?
             ))
             OR (? IS NOT NULL AND EXISTS (
               SELECT 1 FROM work_match_reviews
               WHERE candidate_key = ? AND fingerprint = ?
                 AND review_version = ?
             ))
           )
       )
       INSERT INTO work_aliases (
         source_work_id, canonical_work_id, source_title,
         source_original_artist, source_tags, merged_by
       )
       SELECT ?, ?, '__work_match_guard__', '__work_match_guard__', '[]', ?
       FROM merge_guard
       WHERE valid
       RETURNING 1 AS valid`,
    ).bind(
      expectedWorkState,
      expectedLinks,
      scan.revision,
      body.expectedReviewVersion,
      body.candidateKey,
      body.fingerprint,
      body.expectedReviewVersion,
      body.candidateKey,
      body.fingerprint,
      body.expectedReviewVersion,
      guardToken,
      canonical.id,
      WORK_MATCH_GUARD_ACTOR,
    ),
    guarded(
      `UPDATE work_aliases
       SET canonical_work_id = ?
       WHERE canonical_work_id IN (${sourcePlaceholders})
         AND (SELECT valid FROM work_merge_guard)`,
      [canonical.id, ...sourceWorkIds],
    ),
    guarded(
      `INSERT INTO work_aliases (
         source_work_id, canonical_work_id, source_title,
         source_original_artist, source_tags, merged_by
       )
       SELECT source.id, ?, source.title,
              source.original_artist, source.tags, ?
       FROM works AS source
       WHERE source.id IN (${sourcePlaceholders})
         AND (SELECT valid FROM work_merge_guard)`,
      [canonical.id, mergedBy, ...sourceWorkIds],
    ),
    guarded(
      `INSERT INTO work_match_merge_audits (
         id, candidate_key, fingerprint, catalog_revision, review_version,
         canonical_work_id, source_work_ids, note, merged_by, merged_at
       )
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now')
       FROM work_merge_guard
       WHERE valid`,
      [
        guardToken,
        body.candidateKey,
        body.fingerprint,
        scan.revision,
        body.expectedReviewVersion,
        canonical.id,
        JSON.stringify(sourceWorkIds),
        note,
        mergedBy,
      ],
    ),
  ];

  const relinkIndex = statements.length;
  statements.push(
    guarded(
      `UPDATE song_work_links
       SET work_id = ?, link_method = 'manual', linked_by = ?,
           updated_at = datetime('now')
       WHERE work_id IN (${sourcePlaceholders})
         AND (SELECT valid FROM work_merge_guard)`,
      [canonical.id, mergedBy, ...sourceWorkIds],
    ),
    guarded(
      `UPDATE works
       SET tags = ?, updated_at = datetime('now')
       WHERE id = ?
         AND (SELECT valid FROM work_merge_guard)`,
      [JSON.stringify(mergedTags), canonical.id],
    ),
  );

  const deleteIndex = statements.length;
  statements.push(
    guarded(
      `DELETE FROM works
       WHERE id IN (${sourcePlaceholders})
         AND (SELECT valid FROM work_merge_guard)`,
      sourceWorkIds,
    ),
    db.prepare(
      `DELETE FROM work_aliases
       WHERE source_work_id = ?
         AND canonical_work_id = ?
         AND merged_by = ?`,
    ).bind(guardToken, canonical.id, WORK_MATCH_GUARD_ACTOR),
  );

  const results = await db.batch(statements);
  const guard = results[0]?.results[0] as { valid?: number | boolean } | undefined;
  if (guard?.valid !== 1 && guard?.valid !== true) {
    throw new WorkMatchError(
      'work_match_stale',
      'The global work catalog changed during confirmation; refresh and retry',
    );
  }

  return {
    ok: true,
    canonicalWorkId: canonical.id,
    mergedWorks: results[deleteIndex]?.meta.changes ?? 0,
    relinkedSongs: results[relinkIndex]?.meta.changes ?? 0,
    preservedSongs: mergeSnapshots.reduce((sum, work) => sum + work.songCount, 0),
    preservedPerformances: mergeSnapshots.reduce(
      (sum, work) => sum + work.performanceCount,
      0,
    ),
  };
}
