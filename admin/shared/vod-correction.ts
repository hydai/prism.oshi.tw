/**
 * The VOD correction contract: the wire shapes the admin worker and the review
 * page share, plus the two pure helpers both of them need. `matchCorrection`
 * suggests which proposed row corrects which current row, and
 * `summarizeCorrection` writes the one-line account of an apply that goes into
 * the reviewer note and the Discord embed. Nothing here touches D1 or the DOM.
 */
import { normalizeForMatching, similarityScore } from './normalize';
import type { NovaVodSubmission, Status } from './types';

/** A candidate pair needs at least this much overlap, as a share of the shorter interval. */
export const MATCH_MIN_SCORE = 0.5;
/** How long a row with no end, and no row after it, is taken to last. */
export const OPEN_END_SECONDS = 240;

/** What the matcher reads from a row on either side. */
export interface MatchableRow {
  title: string;
  originalArtist: string;
  timestamp: number;
  endTimestamp: number | null;
}

/** A performance of the target stream as it stands now. */
export interface CorrectionCurrentRow extends MatchableRow {
  performanceId: string;
  songId: string;
  status: Status;
  songStatus: Status;
  /** The song's performances across all streams: a rename reaches every one of them. */
  songPerformanceCount: number;
}

/** A row of the submission. */
export interface CorrectionProposedRow extends MatchableRow {
  id: string;
  /** The song catalog resolution would pick for this title and artist, if there is one. */
  existingSong: { id: string; status: Status } | null;
}

/** One proposed row matched to one current row; `changes` says which of their fields differ. */
export interface CorrectionPair {
  currentIndex: number;
  proposedIndex: number;
  score: number;
  changes: { start: boolean; end: boolean; title: boolean; artist: boolean };
}

/** Indices refer to positions in the arrays given to `matchCorrection`. */
export interface CorrectionMatch {
  pairs: CorrectionPair[];
  unpairedCurrent: number[];
  unpairedProposed: number[];
}

/** The body of `GET /api/nova/vods/:id/correction`. */
export interface NovaVodCorrectionView {
  submission: NovaVodSubmission;
  stream: { id: string; title: string; date: string; videoId: string; status: Status };
  current: CorrectionCurrentRow[];   // sorted by timestamp
  proposed: CorrectionProposedRow[]; // sorted by timestamp
  match: CorrectionMatch;
  fingerprint: string;
  otherPendingCount: number;
}

/** One reviewed change. Ids are kept unless the operation creates a row. */
export type CorrectionOperation =
  | { op: 'setTimes'; performanceId: string; timestamp?: number; endTimestamp?: number | null }
  | { op: 'renameSong'; songId: string; title?: string; originalArtist?: string }
  | { op: 'relinkToSong'; performanceId: string; songId: string }
  | { op: 'relinkToNewSong'; performanceId: string; title: string; originalArtist: string }
  | { op: 'addPerformance'; title: string; originalArtist: string; timestamp: number; endTimestamp: number | null }
  | { op: 'deletePerformance'; performanceId: string };

/** How many suggested changes the curator left unticked, per kind. */
export interface CorrectionSkipped { time: number; title: number; add: number; delete: number }

/** The body of `POST /api/nova/vods/:id/apply`. */
export interface CorrectionApplyBody {
  fingerprint: string;
  reviewerNote?: string;
  operations: CorrectionOperation[];
  skipped: CorrectionSkipped;
}

/** What a successful apply returns: the approved submission and the summary written into its reviewer note. */
export interface CorrectionApplyResult { submission: NovaVodSubmission; summary: string }

const UNKNOWN_ARTIST = 'Unknown';

/** A row with what matching needs worked out once: where it ends, and its title as compared. */
interface PreparedRow extends MatchableRow {
  /** The end for scoring: its own, else the next row's start, else `OPEN_END_SECONDS` after its start. */
  end: number;
  titleKey: string;
}

function prepare(rows: readonly MatchableRow[]): PreparedRow[] {
  return rows.map((row, index) => ({
    ...row,
    end: row.endTimestamp ?? rows[index + 1]?.timestamp ?? row.timestamp + OPEN_END_SECONDS,
    titleKey: normalizeForMatching(row.title),
  }));
}

/** Overlap as a share of the shorter interval; 0 when either interval is empty or inverted. */
function overlapScore(a: PreparedRow, b: PreparedRow): number {
  const shorter = Math.min(a.end - a.timestamp, b.end - b.timestamp);
  if (shorter <= 0) return 0;
  const overlap = Math.min(a.end, b.end) - Math.max(a.timestamp, b.timestamp);
  return overlap > 0 ? overlap / shorter : 0;
}

/** The artist as compared: an empty one is 'Unknown', which is what the importer stores for it. */
function artistKey(originalArtist: string): string {
  return normalizeForMatching(originalArtist === '' ? UNKNOWN_ARTIST : originalArtist);
}

function changesBetween(current: PreparedRow, proposed: PreparedRow): CorrectionPair['changes'] {
  return {
    start: current.timestamp !== proposed.timestamp,
    end: current.endTimestamp !== proposed.endTimestamp,
    title: current.titleKey !== proposed.titleKey,
    artist: artistKey(current.originalArtist) !== artistKey(proposed.originalArtist),
  };
}

interface Candidate {
  currentIndex: number;
  proposedIndex: number;
  current: PreparedRow;
  proposed: PreparedRow;
  score: number;
  titleSimilarity: number;
}

function indicesNotIn(count: number, taken: ReadonlySet<number>): number[] {
  const indices: number[] = [];
  for (let index = 0; index < count; index += 1) {
    if (!taken.has(index)) indices.push(index);
  }
  return indices;
}

/**
 * Suggest which proposed row corrects which current row, by time overlap.
 *
 * Both inputs must be sorted by `timestamp` (`NovaVodCorrectionView` guarantees
 * it): a row with no end lasts until the next element's start, or for
 * `OPEN_END_SECONDS` when it is the last. Returned indices are positions in the
 * arrays as given; neither input is modified.
 *
 * A pair's score is the overlap divided by the shorter of the two intervals,
 * and it needs `MATCH_MIN_SCORE`. Pairs are taken greedily, highest score
 * first, one row per side. Ties go to the closer normalized titles, then the
 * lower current index, then the lower proposed index. A row whose interval is
 * empty or inverted scores 0, so it never pairs.
 *
 * `changes` compares what is stored: the raw start and end (null is a value),
 * and the `normalizeForMatching` forms of the title and the artist, an empty
 * artist reading as 'Unknown'.
 */
export function matchCorrection(
  current: readonly MatchableRow[],
  proposed: readonly MatchableRow[],
): CorrectionMatch {
  const currentRows = prepare(current);
  const proposedRows = prepare(proposed);

  const candidates: Candidate[] = [];
  for (const [currentIndex, currentRow] of currentRows.entries()) {
    for (const [proposedIndex, proposedRow] of proposedRows.entries()) {
      const score = overlapScore(currentRow, proposedRow);
      if (score >= MATCH_MIN_SCORE) {
        candidates.push({
          currentIndex,
          proposedIndex,
          current: currentRow,
          proposed: proposedRow,
          score,
          titleSimilarity: similarityScore(currentRow.titleKey, proposedRow.titleKey),
        });
      }
    }
  }
  candidates.sort((left, right) =>
    right.score - left.score
    || right.titleSimilarity - left.titleSimilarity
    || left.currentIndex - right.currentIndex
    || left.proposedIndex - right.proposedIndex);

  const takenCurrent = new Set<number>();
  const takenProposed = new Set<number>();
  const pairs: CorrectionPair[] = [];
  for (const candidate of candidates) {
    if (takenCurrent.has(candidate.currentIndex) || takenProposed.has(candidate.proposedIndex)) continue;
    takenCurrent.add(candidate.currentIndex);
    takenProposed.add(candidate.proposedIndex);
    pairs.push({
      currentIndex: candidate.currentIndex,
      proposedIndex: candidate.proposedIndex,
      score: candidate.score,
      changes: changesBetween(candidate.current, candidate.proposed),
    });
  }
  pairs.sort((left, right) => left.currentIndex - right.currentIndex);

  return {
    pairs,
    unpairedCurrent: indicesNotIn(currentRows.length, takenCurrent),
    unpairedProposed: indicesNotIn(proposedRows.length, takenProposed),
  };
}

type AppliedKind = 'time' | 'rename' | 'relink' | 'add' | 'delete';

/** Which count of the summary an operation belongs to. Exhaustive: a new operation must pick one. */
function appliedKind(operation: CorrectionOperation): AppliedKind {
  switch (operation.op) {
    case 'setTimes':
      return 'time';
    case 'renameSong':
      return 'rename';
    case 'relinkToSong':
    case 'relinkToNewSong':
      return 'relink';
    case 'addPerformance':
      return 'add';
    case 'deletePerformance':
      return 'delete';
  }
}

/** 「（時間 2、新增 1）」 with the zero counts left out, or nothing when none remain. */
function listCounts(counts: ReadonlyArray<readonly [label: string, count: number]>): string {
  const listed = counts.filter(([, count]) => count > 0).map(([label, count]) => `${label} ${count}`);
  return listed.length > 0 ? `（${listed.join('、')}）` : '';
}

/**
 * The one-line account of an apply, e.g. 「套用 6 項（時間 6）；略過 2 項（歌名 1、刪除 1）」.
 * The 「；略過…」 tail is left out when nothing was skipped.
 */
export function summarizeCorrection(
  operations: readonly CorrectionOperation[],
  skipped: CorrectionSkipped,
): string {
  const applied: Record<AppliedKind, number> = { time: 0, rename: 0, relink: 0, add: 0, delete: 0 };
  for (const operation of operations) applied[appliedKind(operation)] += 1;

  const appliedPart = `套用 ${operations.length} 項${listCounts([
    ['時間', applied.time],
    ['改名', applied.rename],
    ['改連結', applied.relink],
    ['新增', applied.add],
    ['刪除', applied.delete],
  ])}`;

  const skippedCount = skipped.time + skipped.title + skipped.add + skipped.delete;
  if (skippedCount <= 0) return appliedPart;
  return `${appliedPart}；略過 ${skippedCount} 項${listCounts([
    ['時間', skipped.time],
    ['歌名', skipped.title],
    ['新增', skipped.add],
    ['刪除', skipped.delete],
  ])}`;
}
