/**
 * The VOD correction contract: the wire shapes the admin worker and the review
 * page share, plus the pure helpers both of them need. `matchCorrection`
 * suggests which proposed row corrects which current row, by title first and
 * then by time overlap, and `matchCorrectionWithBase` does so for a review that
 * knows its base, the list the contributor compared against: `untouchedBaseRows`
 * says which proposed rows repeat it, and `baseCounterparts` which base row each
 * one stands for. `repeatedRows` says which add lists a song a second time: a
 * row the stream keeps, or an earlier add. `yieldedEnd` reads an end the parsers
 * filled in as the Shared definitions do, against the starts `referenceStarts`
 * works out once for a list (for a row at its archived start, Nova's
 * restoreArchivedEnds applies the same rule), `correctionChanges` says which
 * fields of one pair differ, and `summarizeCorrection` writes the one-line
 * account of an apply that goes into the reviewer note and the Discord embed.
 * Nothing here touches D1 or the DOM.
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
  /** Whether the site shows it: the performance and its song are approved. The fan export ignores stream status. */
  onSite: boolean;
  /** The song's performances across all streams: a rename reaches every one of them. */
  songPerformanceCount: number;
}

/** A row of the submission. */
export interface CorrectionProposedRow extends MatchableRow {
  id: string;
  /**
   * Whether its end is the start of the next submitted row (`nextSubmittedId`), which is how the parsers fill an end
   * nobody gave: such an end is derived, like a missing one. The last row's never is.
   */
  endFilled: boolean;
  /** The row submitted after this one (Nova's next stored row, in sort order, whatever its start), or null for the last. */
  nextSubmittedId: string | null;
  /** The song catalog resolution would pick for this title and artist, if there is one. */
  existingSong: { id: string; status: Status } | null;
  /**
   * For a row submitted with no artist (a blank one), the song resolution would pick for its title with each artist
   * the stream's rows have: one entry per artist, as the review sends one (trimmed, a blank one 'Unknown'). A choice
   * that takes a live row's artist in place of the blank one (改連到新的歌 offers the paired row's) lands on its
   * entry's song. Absent for a row that names an artist, and when the stream has no rows.
   */
  existingSongsByLiveArtist?: Array<{ originalArtist: string; existingSong: { id: string; status: Status } | null }>;
}

/** A row of the public list a submission was compared against, as Nova recorded it at submit time. */
export interface CorrectionBaseRow extends MatchableRow {
  performanceId: string;
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
  /**
   * The public list the contributor compared against, its base, as Nova recorded it: [] when the stream showed
   * nothing, null when Nova recorded none (there was no stream, or the submission predates the base).
   */
  base: CorrectionBaseRow[] | null;
  /**
   * The contributor's list was confirmed by a revision at submit time: the submission came with the base_revision of
   * the list the form loaded, and Nova found it still matched the public list, so `base` is what the contributor saw.
   * False for a base recorded without one (it is only the list as it stood at submit time), for a submission with no
   * base, and for one stored before Nova kept this fact.
   */
  baseVerified: boolean;
  current: CorrectionCurrentRow[];   // sorted by timestamp
  proposed: CorrectionProposedRow[]; // sorted by timestamp
  /** `matchCorrectionWithBase` of the three. */
  match: CorrectionMatch;
  fingerprint: string;
  otherPendingCount: number;
  /**
   * An apply of this submission whose changes reached the catalog while the submission could not be marked reviewed
   * (it answered 502 appliedToCatalog), by the summary of what it applied: only the approval that recovers it
   * (直接通過（不套用）) may follow, and it announces that apply. Null when there is none, and whenever the submission is
   * not pending.
   */
  openApply: { summary: string } | null;
}

/**
 * One reviewed change. Ids are kept unless the operation creates a row.
 *
 * A relink may carry the status the review showed for the song it lands on (`expectedSongStatus`). The apply refuses
 * with `stale` when the plan reads another, so a song demoted after the page loaded is not approved again by the
 * apply's promotion, with every other row of it. For `relinkToNewSong` it is the status of the song its title and
 * artist resolve to, and null when the review read that none does, so that the apply creates one. Absent, nothing is
 * checked: a page from before the field sends none.
 */
export type CorrectionOperation =
  | { op: 'setTimes'; performanceId: string; timestamp?: number; endTimestamp?: number | null }
  | { op: 'renameSong'; songId: string; title?: string; originalArtist?: string }
  | { op: 'relinkToSong'; performanceId: string; songId: string; expectedSongStatus?: Status }
  | { op: 'relinkToNewSong'; performanceId: string; title: string; originalArtist: string; expectedSongStatus?: Status | null }
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

/** A row with what matching needs worked out once: where it ends, its title and artist as compared, and whether it is shown. */
interface PreparedRow extends MatchableRow {
  /** The end for scoring: its own, else the next row's start, else `OPEN_END_SECONDS` after its start. */
  end: number;
  titleKey: string;
  artistKey: string;
  /** Whether the site shows it: a live row says (`CorrectionCurrentRow.onSite`), and any other row counts as shown. */
  onSite: boolean;
}

function prepare(rows: readonly MatchableRow[]): PreparedRow[] {
  return rows.map((row, index) => ({
    ...row,
    end: row.endTimestamp ?? rows[index + 1]?.timestamp ?? row.timestamp + OPEN_END_SECONDS,
    titleKey: normalizeForMatching(row.title),
    artistKey: artistKey(row.originalArtist),
    onSite: !('onSite' in row) || row.onSite !== false,
  }));
}

/** Whether a row's interval is neither empty nor inverted: the rule `overlapScore` reads, so only such a row pairs. */
const hasLength = (row: PreparedRow): boolean => row.end - row.timestamp > 0;

/** Overlap as a share of the shorter interval; 0 when either interval is empty or inverted. */
function overlapScore(a: PreparedRow, b: PreparedRow): number {
  if (!hasLength(a) || !hasLength(b)) return 0;
  const shorter = Math.min(a.end - a.timestamp, b.end - b.timestamp);
  const overlap = Math.min(a.end, b.end) - Math.max(a.timestamp, b.timestamp);
  return overlap > 0 ? overlap / shorter : 0;
}

/** The artist as compared: an empty one is 'Unknown', which is what the importer stores for it. */
function artistKey(originalArtist: string): string {
  return normalizeForMatching(originalArtist === '' ? UNKNOWN_ARTIST : originalArtist);
}

/**
 * Which fields of a current row and a proposed row differ: the raw start and end (null is a value),
 * and the `normalizeForMatching` forms of the title and the artist, an empty current artist reading
 * as 'Unknown'. A blank proposed artist is the contributor not naming one, so it never differs: the
 * row keeps the artist it has. `matchCorrection` flags every pair it finds with it, and the review
 * page asks again for the pairs a curator makes by hand, so both read one rule.
 */
export function correctionChanges(current: MatchableRow, proposed: MatchableRow): CorrectionPair['changes'] {
  return {
    start: current.timestamp !== proposed.timestamp,
    end: current.endTimestamp !== proposed.endTimestamp,
    title: normalizeForMatching(current.title) !== normalizeForMatching(proposed.title),
    artist: proposed.originalArtist.trim() !== '' && artistKey(current.originalArtist) !== artistKey(proposed.originalArtist),
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
 * Suggest which proposed row corrects which current row: by title first, then
 * by time overlap.
 *
 * Both inputs must be sorted by `timestamp` (`NovaVodCorrectionView` guarantees
 * it): a row with no end lasts until the next element's start, or for
 * `OPEN_END_SECONDS` when it is the last. Returned indices are positions in the
 * arrays as given; neither input is modified.
 *
 * Rows with the same `normalizeForMatching` title pair first, however far apart:
 * the same artist first (a blank one reading as 'Unknown'), so two songs that
 * share a title but name different artists keep apart; then the nearest starts;
 * then a current row the site shows (a row that does not say counts as shown);
 * then the lower current index, then the lower proposed index. So a list shifted
 * by a constant pairs each row with its own when the rows name their artists and
 * the rows of one song lie more than twice the shift apart; a row moved far pairs
 * with its own; and a song sung twice pairs each time with the nearer one.
 *
 * Time overlap then pairs the rows left. A pair's score is the overlap divided by
 * the shorter of the two intervals, and an overlap pair needs `MATCH_MIN_SCORE`;
 * a same-title pair keeps its score, whatever it is. Overlap pairs are taken
 * greedily, highest score first, one row per side. Ties go to the closer
 * normalized titles, then a current row the site shows, then the lower current
 * index, then the lower proposed index. A row whose interval is empty or
 * inverted pairs in neither pass.
 *
 * Each pair's `changes` is `correctionChanges` of its two rows.
 */
export function matchCorrection(
  current: readonly MatchableRow[],
  proposed: readonly MatchableRow[],
): CorrectionMatch {
  return matchPrepared(prepare(current), prepare(proposed), [], new Set());
}

/** Pairs made before the title and time match, by position in the two lists. */
type FixedPair = { currentIndex: number; proposedIndex: number };

/** How far apart a candidate's two rows start. */
const startDistance = (candidate: Candidate): number => Math.abs(candidate.proposed.timestamp - candidate.current.timestamp);

/** 1 for a candidate whose two rows name one artist (`artistKey`), else 0. */
const sameArtist = (candidate: Candidate): number => Number(candidate.current.artistKey === candidate.proposed.artistKey);

/** The order `matchCorrection` takes same-title candidates in: same artist, nearest start, shown, then the indices. */
function bySameTitleRank(left: Candidate, right: Candidate): number {
  return sameArtist(right) - sameArtist(left)
    || startDistance(left) - startDistance(right)
    || Number(right.current.onSite) - Number(left.current.onSite)
    || left.currentIndex - right.currentIndex
    || left.proposedIndex - right.proposedIndex;
}

/** The order `matchCorrection` takes overlap candidates in: score, closer titles, shown, then the indices. */
function byOverlapRank(left: Candidate, right: Candidate): number {
  return right.score - left.score
    || right.titleSimilarity - left.titleSimilarity
    || Number(right.current.onSite) - Number(left.current.onSite)
    || left.currentIndex - right.currentIndex
    || left.proposedIndex - right.proposedIndex;
}

/**
 * `matchCorrection`'s title and time match, after `fixed`: those pairs are taken first, whatever their titles and
 * overlap, and the title match, then the time match, pair the rows they leave, never a proposed row in `settled`.
 * Every pair is scored and flagged alike.
 */
function matchPrepared(
  currentRows: readonly PreparedRow[],
  proposedRows: readonly PreparedRow[],
  fixed: readonly FixedPair[],
  settled: ReadonlySet<number>,
): CorrectionMatch {
  const first = fixed.flatMap(({ currentIndex, proposedIndex }): Candidate[] => {
    const currentRow = currentRows[currentIndex];
    const proposedRow = proposedRows[proposedIndex];
    if (!currentRow || !proposedRow) return [];
    return [{
      currentIndex,
      proposedIndex,
      current: currentRow,
      proposed: proposedRow,
      score: overlapScore(currentRow, proposedRow),
      titleSimilarity: similarityScore(currentRow.titleKey, proposedRow.titleKey),
    }];
  });
  const fixedCurrent = new Set(first.map((candidate) => candidate.currentIndex));
  const fixedProposed = new Set(first.map((candidate) => candidate.proposedIndex));

  // A pair of one title is a same-title candidate, however far apart its rows are; any other pair is an overlap
  // candidate once it overlaps enough. Taken in that order, the overlap pass pairs only the rows the titles leave.
  const sameTitle: Candidate[] = [];
  const candidates: Candidate[] = [];
  for (const [currentIndex, currentRow] of currentRows.entries()) {
    if (fixedCurrent.has(currentIndex)) continue;
    for (const [proposedIndex, proposedRow] of proposedRows.entries()) {
      if (fixedProposed.has(proposedIndex) || settled.has(proposedIndex)) continue;
      const score = overlapScore(currentRow, proposedRow);
      const titled = currentRow.titleKey === proposedRow.titleKey && hasLength(currentRow) && hasLength(proposedRow);
      if (!titled && score < MATCH_MIN_SCORE) continue;
      (titled ? sameTitle : candidates).push({
        currentIndex,
        proposedIndex,
        current: currentRow,
        proposed: proposedRow,
        score,
        titleSimilarity: titled ? 1 : similarityScore(currentRow.titleKey, proposedRow.titleKey),
      });
    }
  }
  sameTitle.sort(bySameTitleRank);
  candidates.sort(byOverlapRank);

  const takenCurrent = new Set<number>();
  const takenProposed = new Set<number>();
  const pairs: CorrectionPair[] = [];
  for (const candidate of [...first, ...sameTitle, ...candidates]) {
    if (takenCurrent.has(candidate.currentIndex) || takenProposed.has(candidate.proposedIndex)) continue;
    takenCurrent.add(candidate.currentIndex);
    takenProposed.add(candidate.proposedIndex);
    pairs.push({
      currentIndex: candidate.currentIndex,
      proposedIndex: candidate.proposedIndex,
      score: candidate.score,
      changes: correctionChanges(candidate.current, candidate.proposed),
    });
  }
  pairs.sort((left, right) => left.currentIndex - right.currentIndex);

  return {
    pairs,
    unpairedCurrent: indicesNotIn(currentRows.length, takenCurrent),
    unpairedProposed: indicesNotIn(proposedRows.length, takenProposed),
  };
}

/** The row a proposed row repeats: a position in the current list, or an earlier one in the proposed list. */
export interface RepeatedRow {
  side: 'current' | 'proposed';
  index: number;
}

/**
 * The position in `rows` of the row `row` overlaps best with the same title, among those `eligible` says may be
 * repeated: the highest `overlapScore` of at least `MATCH_MIN_SCORE`, the lower index on a tie. Null when none does.
 * A `row` with a length that ends exactly where a row of its title starts is scored against that row with that row's
 * length instead of its own.
 */
function bestRepeat(row: PreparedRow, rows: readonly PreparedRow[], eligible: (index: number) => boolean): number | null {
  let best: { index: number; score: number } | null = null;
  for (const [index, other] of rows.entries()) {
    if (!eligible(index) || other.titleKey !== row.titleKey) continue;
    let score = overlapScore(row, other);
    // An add that ends exactly where a row of its title starts got that end from the parsers' fill: read it with that
    // row's length.
    if (score < MATCH_MIN_SCORE && hasLength(row) && row.end === other.timestamp && hasLength(other)) {
      score = overlapScore({ ...row, end: row.timestamp + (other.end - other.timestamp) }, other);
    }
    if (score >= MATCH_MIN_SCORE && (best === null || score > best.score)) best = { index, score };
  }
  return best === null ? null : best.index;
}

/**
 * For each proposed row, the row it repeats, or null: what a review reads to leave a duplicate unticked. A proposed
 * row that `pairs` leave unpaired (an add) is a repeat when it has the same `normalizeForMatching` title as a row it
 * overlaps by at least `MATCH_MIN_SCORE`, which is one of
 *
 * - a current row that `pairs` pair with another proposed row: the stream keeps it, so the row would list its song a
 *   second time;
 * - an earlier unpaired proposed row (a lower position), which the submission lists a second time.
 *
 * Only the title is read, not the artist. Intervals and scores are the matcher's (`matchCorrection`: a row with no end
 * lasts until the next row of its own list starts, the last one `OPEN_END_SECONDS`; the overlap is a share of the
 * shorter interval, and an empty or inverted one scores 0), so a song sung again later, with no overlap, is no repeat,
 * and a row with an empty interval repeats nothing and is repeated by nothing. One reading differs: an add that ends
 * exactly where a row of its title starts got that end from the parsers' fill (the row is its next line, as when the
 * contributor's own start-only list comes a few seconds before the loaded one), so against that row it is read with
 * that row's length: 95–100 before 100–200 reads as 95–195, a repeat. A current row nothing is paired with
 * is a delete candidate, not a row the stream keeps, and a paired proposed row is no earlier add. When rows of both
 * kinds qualify the current row is named, else the earlier add, and among rows of one kind the highest score, then the
 * lower index. A pair whose rows are not both in the lists is ignored. Both lists as for `matchCorrection`.
 *
 * The review page reads it for its 重複 mark and for the default tick of an add, over the pairs its draft has, so a
 * curator's re-pairing is read as the matcher's pairing is. This one rule is the only place the overlap is decided.
 */
export function repeatedRows(
  current: readonly MatchableRow[],
  proposed: readonly MatchableRow[],
  pairs: ReadonlyArray<{ currentIndex: number; proposedIndex: number }>,
): Array<RepeatedRow | null> {
  const currentRows = prepare(current);
  const proposedRows = prepare(proposed);
  const real = pairs.filter(({ currentIndex, proposedIndex }) => currentRows[currentIndex] !== undefined && proposedRows[proposedIndex] !== undefined);
  const pairedCurrent = new Set(real.map((pair) => pair.currentIndex));
  const pairedProposed = new Set(real.map((pair) => pair.proposedIndex));
  return proposedRows.map((row, proposedIndex): RepeatedRow | null => {
    if (pairedProposed.has(proposedIndex)) return null;
    const kept = bestRepeat(row, currentRows, (index) => pairedCurrent.has(index));
    if (kept !== null) return { side: 'current', index: kept };
    const earlier = bestRepeat(row, proposedRows, (index) => index < proposedIndex && !pairedProposed.has(index));
    return earlier === null ? null : { side: 'proposed', index: earlier };
  });
}

/** A row as the Shared definitions match rows: its trimmed title, its artist (a blank one is 'Unknown'), and its start. */
function matchKey(row: MatchableRow): string {
  return JSON.stringify([row.title.trim(), row.originalArtist.trim() || UNKNOWN_ARTIST, row.timestamp]);
}

/**
 * The starts of `rows`, which `yieldedEnd` looks a submitted row's next row up in (rows that start together share
 * one): a next row that starts where one of `rows` starts was not moved, whatever its title and artist, since a title
 * or artist edit is no move. Work them out once for a list, whatever the number of submitted rows that are asked
 * about it.
 */
export function referenceStarts(rows: readonly MatchableRow[]): ReadonlySet<number> {
  return new Set(rows.map((row) => row.timestamp));
}

/** The row submitted after `row` (Nova's next stored row, whatever its start), or undefined for the last one. */
function nextSubmitted(proposed: readonly CorrectionProposedRow[], row: CorrectionProposedRow): CorrectionProposedRow | undefined {
  return row.nextSubmittedId === null ? undefined : proposed.find((candidate) => candidate.id === row.nextSubmittedId);
}

/** The end rule (see `yieldedEnd`) for `row` against `reference`, with `next`, the row submitted after it, already found. */
function endAfterYield(
  row: CorrectionProposedRow,
  reference: { timestamp: number; endTimestamp: number | null },
  next: CorrectionProposedRow | undefined,
  starts: ReadonlySet<number>,
): number | null {
  if (row.endTimestamp !== null && !row.endFilled) return row.endTimestamp;
  const referenceEnd = reference.endTimestamp;
  if (referenceEnd !== null && referenceEnd <= row.timestamp) {
    // Moved past its own end: given back, the reference end would come at or before the start.
    const keptLength = referenceEnd + (row.timestamp - reference.timestamp);
    return next !== undefined && next.timestamp > row.timestamp ? Math.min(keptLength, next.timestamp) : keptLength;
  }
  // Moved back to before an unmoved row it used to follow: given back, the reference end would run across that row.
  if (referenceEnd !== null && next !== undefined && starts.has(next.timestamp)
    && next.timestamp > row.timestamp && reference.timestamp >= next.timestamp && referenceEnd > reference.timestamp) {
    return Math.min(row.timestamp + (referenceEnd - reference.timestamp), next.timestamp);
  }
  const overlapsAMovedRow = referenceEnd !== null && next !== undefined && !starts.has(next.timestamp) && referenceEnd > next.timestamp;
  if (overlapsAMovedRow) return row.endTimestamp;
  // Moved later by more than half the reference's length: given back, the reference end would leave the row under half
  // that length. It keeps the length from its new start instead, cut at the start of the next submitted row when that
  // row starts after it. A nudge of a few seconds leaves most of the length, so the reference end stays.
  if (referenceEnd !== null && row.timestamp > reference.timestamp
    && referenceEnd - row.timestamp < (referenceEnd - reference.timestamp) / 2) {
    const keptLength = row.timestamp + (referenceEnd - reference.timestamp);
    return next !== undefined && next.timestamp > row.timestamp ? Math.min(keptLength, next.timestamp) : keptLength;
  }
  return referenceEnd;
}

/**
 * The end proposed row `proposedIndex` keeps against `reference`, the row it is compared with: the live row it is
 * paired with, or the base row it repeats or stands for. These are the Shared definitions' end rules. An end the
 * contributor gave stays. A derived one (none, or `endFilled`) reads as follows.
 *
 * While the reference end comes after the row's start, or the reference has none, the yield rule decides (save for a
 * row moved back and a row moved far later, below), which Nova's restoreArchivedEnds applies against the archive to a
 * row at its archived start. The derived end gives way to the reference end, unless the next submitted row starts at
 * none of `starts` (it moved, or is new) and the reference end passes that row's start: put back, it would overlap a
 * row the contributor moved there, so the submitted end stands. A title or artist edit is no move, so before a next
 * row that starts at one of `starts`, the reference end comes back even where it overlaps, since that overlap was
 * there already, and a reference with no end always does.
 *
 * A row moved past its own end, the reference end at or before its start, keeps the reference's length from its new
 * start instead, cut at the start of the next submitted row when that row starts after it: given back, the reference
 * end would leave the row ending before it starts. So does a row moved back to before a row it used to follow, the
 * next submitted row, when that row did not move (its start is in `starts`) and starts after it: given back, the
 * reference end would run across that row, which the reference did not. Its length is kept, cut at that row's start.
 * A next row that moved too, to where no reference row starts (two rows swapped off each other's starts, say), leaves
 * the yield rule to decide.
 *
 * Where the yield rule would give the reference end back, a row moved later by more than half the reference's length,
 * short of its end, keeps that length from its new start instead, cut at the start of the next submitted row when that
 * row starts after it: given back, the reference end would leave the row under half its length. A start nudged by a few
 * seconds leaves most of the length, and the reference end stays. Nova's restoreArchivedEnds reaches only rows at their
 * archived start, which are not moved later, so it needs no such rule.
 *
 * The starts (`referenceStarts`) serve the next row's match alone: those of the base, or of the live rows, with the
 * base rows' too when a review against the stream has a base, since a row at a base position was not moved by the
 * contributor, whatever changed since. The caller works them out once, not once for each row it asks about. A row the
 * list lacks keeps the reference end.
 */
export function yieldedEnd(
  proposed: readonly CorrectionProposedRow[],
  proposedIndex: number,
  reference: { timestamp: number; endTimestamp: number | null },
  starts: ReadonlySet<number>,
): number | null {
  const row = proposed[proposedIndex];
  if (!row) return reference.endTimestamp;
  return endAfterYield(row, reference, nextSubmitted(proposed, row), starts);
}

/**
 * For each proposed row, the base row it leaves untouched, or null: one that matches it (the same trimmed title,
 * artist with a blank one read as 'Unknown', and start) and ends where it ends, once a derived end has given way to
 * the base end (`yieldedEnd` against the base). Each base row is repeated by one row at most: first by the rows that
 * end exactly where it does, then by the derived ones, each in list order. With no base, no row is untouched.
 */
export function untouchedBaseRows(
  proposed: readonly CorrectionProposedRow[],
  base: readonly CorrectionBaseRow[] | null,
): Array<CorrectionBaseRow | null> {
  const found: Array<CorrectionBaseRow | null> = proposed.map(() => null);
  if (base === null) return found;
  const baseKeys = base.map(matchKey);
  const starts = referenceStarts(base);
  const claimed = new Set<number>();
  const claim = (endsAlike: (row: CorrectionProposedRow, baseRow: CorrectionBaseRow) => boolean) => {
    proposed.forEach((row, index) => {
      if (found[index] !== null) return;
      const key = matchKey(row);
      const at = base.findIndex((candidate, baseIndex) =>
        !claimed.has(baseIndex) && baseKeys[baseIndex] === key && endsAlike(row, candidate));
      const candidate = base[at];
      if (!candidate) return;
      claimed.add(at);
      found[index] = candidate;
    });
  };
  claim((row, baseRow) => row.endTimestamp === baseRow.endTimestamp);
  claim((row, baseRow) => endAfterYield(row, baseRow, nextSubmitted(proposed, row), starts) === baseRow.endTimestamp);
  return found;
}

/**
 * Suggest which proposed row corrects which current row, for a review with a base (`NovaVodCorrectionView.base`).
 * Each proposed row that stands for a base row (`baseCounterparts`: the one it repeats, or the one it changed) pairs
 * first with that row's live performance, by its id, wherever that performance is now and whatever it holds; one whose
 * performance is gone stays unpaired. So a changed row pairs with the performance the contributor changed, never with
 * a row they could not see. `matchCorrection`'s title and time match then pairs the rest. With no base, this is
 * `matchCorrection`. Inputs and indices as for it.
 */
export function matchCorrectionWithBase(
  current: readonly CorrectionCurrentRow[],
  proposed: readonly CorrectionProposedRow[],
  base: readonly CorrectionBaseRow[] | null,
): CorrectionMatch {
  const live = new Map(current.map((row, index) => [row.performanceId, index]));
  const fixed: FixedPair[] = [];
  const settled = new Set<number>();
  baseCounterparts(proposed, base).forEach((counterpart, proposedIndex) => {
    if (counterpart === null) return;
    settled.add(proposedIndex);
    const currentIndex = live.get(counterpart.performanceId);
    if (currentIndex !== undefined) fixed.push({ currentIndex, proposedIndex });
  });
  return matchPrepared(prepare(current), prepare(proposed), fixed, settled);
}

/** Base rows by start, then performance id: an order of their own, whatever order they come in. */
function byStart(base: readonly CorrectionBaseRow[]): CorrectionBaseRow[] {
  return [...base].sort((left, right) =>
    left.timestamp - right.timestamp
    || (left.performanceId < right.performanceId ? -1 : left.performanceId > right.performanceId ? 1 : 0));
}

/**
 * For each proposed row, the base row it stands for, or null: the one it repeats (`untouchedBaseRows`), else the one
 * `matchCorrection`'s title and time match pairs it with over the base, the repeats paired first. The match reads the
 * base by start (then performance id), never in the order given. A row the match leaves unpaired stands for none, and
 * with no base no row stands for one. It says which row the contributor changed, whatever the stream holds now; the
 * review's pairing (`matchCorrectionWithBase`) pins each row to that row's live performance. `proposed` as for
 * `matchCorrection`.
 */
export function baseCounterparts(
  proposed: readonly CorrectionProposedRow[],
  base: readonly CorrectionBaseRow[] | null,
): Array<CorrectionBaseRow | null> {
  const counterparts: Array<CorrectionBaseRow | null> = proposed.map(() => null);
  if (base === null) return counterparts;
  const sorted = byStart(base);
  const position = new Map(sorted.map((row, index) => [row, index]));
  const fixed: FixedPair[] = [];
  const settled = new Set<number>();
  untouchedBaseRows(proposed, base).forEach((repeated, proposedIndex) => {
    const currentIndex = repeated === null ? undefined : position.get(repeated);
    if (currentIndex === undefined) return;
    settled.add(proposedIndex);
    fixed.push({ currentIndex, proposedIndex });
  });
  for (const pair of matchPrepared(prepare(sorted), prepare(proposed), fixed, settled).pairs) {
    counterparts[pair.proposedIndex] = sorted[pair.currentIndex] ?? null;
  }
  return counterparts;
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
