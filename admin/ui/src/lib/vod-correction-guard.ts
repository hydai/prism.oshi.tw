/**
 * The default-tick guard of a VOD correction review. `initialDraft` ticks what the submission suggests, as far as its
 * rules can tell; the guard runs once over that draft (`guardedInitialDraft`) and takes back every tick whose outcome
 * fails a check, recording why, so the review opens with only the changes it can vouch for ticked. The curator may tick
 * any of them again. Its checks, in order, each over the ticks the ones before it left (a row keeps the first reason it
 * gets):
 *
 * 1. With no base, or a base no revision confirmed (`NovaVodCorrectionView.baseVerified`), the review cannot tell what
 *    the contributor saw: nothing opens ticked, and a banner says so, in place of any other check's. The other checks
 *    still run, over the ticks the draft opened with, to say why each row they hold would be held: such a row keeps
 *    their reason, and every other row they leave ticked takes the unconfirmed base's.
 * 2. A time change that moves its row far: past the live row's length off the typical shift, the median shift of the
 *    live rows within `localWindowRows` rows of it by live start, itself included, where a row no pair holds did not
 *    move. A list shifted as one moves every row alike, and so does a stretch of it (a tail cut, say), while a single
 *    pair cannot hide its own far move behind the median: on a stream of fewer than `minRowsForATypicalShift` live
 *    rows, where the window is mostly the row itself, the typical shift is 0. Else a time change whose submitted title
 *    is not the live row's (`normalizeForMatching`) and that moves the row more than `otherSongShiftSeconds` off the
 *    typical shift: likely another song, paired with the row by time. Else, with both ends known and a live row that
 *    has a length, a time change that makes the row under `minLengthRatio` or over `maxLengthRatio` times its live
 *    length. Then a list that is only part of the base: one that leaves out `partialList.minLeftOut` base rows or more,
 *    and at least `partialList.minLeftOutShare` of the base, where a base row is left out when no submitted row stands
 *    for it (`baseCounterparts`). Its pairs may be other songs the pairing matched by time or by title, so every time
 *    change still ticked is held, and a banner says so.
 * 3. An add that names no song: no artist, and no song the catalog resolution found for its submitted row
 *    (`CorrectionProposedRow.existingSong`, its title by 'Unknown'), on any stream. Applied, it makes a new song of its
 *    title by 'Unknown'. Else an add with an end that lasts under `minAddSeconds`.
 * 4. A second list pasted under the first: `pastedList.minAdds` adds or more, ticked or not, at least
 *    `pastedList.minNearShare` of them starting within `pastedList.nearSeconds` of a live row's start. Every add is held,
 *    and a banner says so, in place of a partial list's.
 * 5. Two adds of one title (`normalizeForMatching`) that touch or overlap, the earlier with no end or one that ends no
 *    more than `overlapToleranceSeconds` before the later starts: both are held, for the curator to pick one.
 * 6. With the defaults applied, two rows that overlap by more than `overlapToleranceSeconds` beyond what they did on the
 *    stream: each ticked one of them is held, naming the other. A row a ticked delete removes is gone, a row with no end
 *    overlaps nothing, and an add overlapped nothing before. A held row goes back to its live times, where it may
 *    overlap another ticked row in turn, so the pass runs again until it holds nothing.
 *
 * Pure: neither the draft nor the view given is modified.
 */
import { normalizeForMatching } from '../../../shared/normalize';
import { baseCounterparts, OPEN_END_SECONDS } from '../../../shared/vod-correction';
import type { CorrectionCurrentRow, NovaVodCorrectionView } from '../../../shared/vod-correction';
import { initialDraft } from './vod-correction-draft';
import type { AddDraft, CorrectionDraft, PairDraft } from './vod-correction-draft';

/** The guard's thresholds; times are in seconds. */
export const GUARD_LIMITS = {
  minLengthRatio: 0.5,
  maxLengthRatio: 2,
  minAddSeconds: 30,
  overlapToleranceSeconds: 1,
  localWindowRows: 3,
  minRowsForATypicalShift: 3,
  otherSongShiftSeconds: 30,
  pastedList: { minAdds: 3, nearSeconds: 120, minNearShare: 0.5 },
  partialList: { minLeftOut: 2, minLeftOutShare: 0.5 },
} as const;

/** Why the guard took a default tick back. */
export type GuardReason =
  | { kind: 'unverifiedBase' }
  | { kind: 'farMove'; seconds: number }   // |shift − typical shift|, rounded to a whole second
  | { kind: 'otherSong'; seconds: number } // |shift − typical shift|, rounded to a whole second
  | { kind: 'lengthChange'; ratio: number } // new length ÷ live length, unrounded: the page rounds it
  | { kind: 'partialList' }
  | { kind: 'overlap'; withTitle: string } // the row it would newly overlap: the live row's title, or the add's
  | { kind: 'noIdentity' }
  | { kind: 'short'; seconds: number }     // the add's length, rounded to a whole second
  | { kind: 'repeatAdd' }
  | { kind: 'pastedList' };

/** What the guard held back: the page's banner, and the reason for each tick it took back (a row it left has none). */
export interface DraftGuard {
  banner: 'baseMissing' | 'baseUnverified' | 'pastedList' | 'partialList' | null;
  pairs: ReadonlyMap<string, GuardReason>; // key `${currentIndex}:${proposedIndex}`
  adds: ReadonlyMap<number, GuardReason>;  // key proposedIndex
}

type HoldPair = (pair: PairDraft, reason: GuardReason) => void;
type HoldAdd = (add: AddDraft, reason: GuardReason) => void;

/** A stretch of the stream; an end of null is not known. */
interface Interval {
  start: number;
  end: number | null;
}

/** How long two stretches overlap: 0 when either end is not known. */
function overlapSeconds(left: Interval, right: Interval): number {
  if (left.end === null || right.end === null) return 0;
  return Math.max(0, Math.min(left.end, right.end) - Math.max(left.start, right.start));
}

/** How long a live row lasts, one with no end `OPEN_END_SECONDS`. */
const liveLength = (live: CorrectionCurrentRow): number => (live.endTimestamp ?? live.timestamp + OPEN_END_SECONDS) - live.timestamp;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return sorted.length === 0 ? 0 : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

const pairKey = (pair: PairDraft): string => `${pair.currentIndex}:${pair.proposedIndex}`;

/** The pair that holds each live row, by the row's place in `view.current`. */
const pairsByLiveRow = (draft: CorrectionDraft): Map<number, PairDraft> => new Map(draft.pairs.map((pair) => [pair.currentIndex, pair]));

/**
 * Check 2: a ticked time change that moves its row far, moves a row whose submitted title is another song's, or changes
 * its length a lot.
 */
function holdMovedRows(draft: CorrectionDraft, view: NovaVodCorrectionView, hold: HoldPair): void {
  const byLiveRow = pairsByLiveRow(draft);
  const shifts = view.current.map((live, index) => {
    const pair = byLiveRow.get(index);
    return pair === undefined ? 0 : pair.timestamp - live.timestamp;
  });
  const byStart = view.current
    .map((live, index) => ({ start: live.timestamp, index }))
    .sort((left, right) => left.start - right.start || left.index - right.index)
    .map(({ index }) => index);
  const rank = new Map(byStart.map((index, position) => [index, position]));
  const typicalShift = (index: number): number => {
    // On a stream of fewer live rows, the rows within the window are mostly the row itself, whose own shift would set
    // the median and hide its own far move: there the typical shift is 0, and a row is far past its own length.
    if (view.current.length < GUARD_LIMITS.minRowsForATypicalShift) return 0;
    const at = rank.get(index) ?? 0;
    const around = byStart.slice(Math.max(0, at - GUARD_LIMITS.localWindowRows), at + GUARD_LIMITS.localWindowRows + 1);
    return median(around.map((other) => shifts[other] ?? 0));
  };
  for (const pair of draft.pairs) {
    const live = view.current[pair.currentIndex];
    if (!pair.applyTimes || live === undefined) continue;
    const off = Math.abs(pair.timestamp - live.timestamp - typicalShift(pair.currentIndex));
    const submitted = view.proposed[pair.proposedIndex];
    if (off > liveLength(live)) {
      hold(pair, { kind: 'farMove', seconds: Math.round(off) });
    } else if (
      off > GUARD_LIMITS.otherSongShiftSeconds &&
      submitted !== undefined &&
      normalizeForMatching(submitted.title) !== normalizeForMatching(live.title)
    ) {
      hold(pair, { kind: 'otherSong', seconds: Math.round(off) });
    } else if (live.endTimestamp !== null && pair.endTimestamp !== null && live.endTimestamp > live.timestamp) {
      // A live row with no length (its end at or before its start) leaves no ratio to form, so it is not checked.
      const ratio = (pair.endTimestamp - pair.timestamp) / (live.endTimestamp - live.timestamp);
      if (ratio < GUARD_LIMITS.minLengthRatio || ratio > GUARD_LIMITS.maxLengthRatio) hold(pair, { kind: 'lengthChange', ratio });
    }
  }
}

/**
 * Check 2, last: whether the submission lists only part of the base, leaving out `partialList.minLeftOut` base rows or
 * more and at least `partialList.minLeftOutShare` of the base. A base row is left out when no submitted row stands for
 * it (`baseCounterparts`), whatever the stream holds now: a row the contributor listed whose performance was deleted
 * since was not left out. If so, every time change still ticked is held. With no base, nothing is left out.
 */
function holdPartialList(draft: CorrectionDraft, view: NovaVodCorrectionView, hold: HoldPair): boolean {
  const base = view.base;
  if (base === null) return false;
  const { minLeftOut, minLeftOutShare } = GUARD_LIMITS.partialList;
  const listed = new Set(baseCounterparts(view.proposed, base).flatMap((row) => row?.performanceId ?? []));
  const leftOut = base.filter((row) => !listed.has(row.performanceId)).length;
  if (leftOut < minLeftOut || leftOut < base.length * minLeftOutShare) return false;
  for (const pair of draft.pairs) hold(pair, { kind: 'partialList' });
  return true;
}

/**
 * Check 3: a ticked add that names no song, or lasts under `minAddSeconds`. An add names no song when its own artist is
 * blank and the resolution found no song for its submitted row (`existingSong`), as for a row the view lacks.
 */
function holdUnnamedAndShortAdds(draft: CorrectionDraft, view: NovaVodCorrectionView, hold: HoldAdd): void {
  for (const add of draft.adds) {
    if (!add.apply) continue;
    if (add.originalArtist.trim() === '' && (view.proposed[add.proposedIndex]?.existingSong ?? null) === null) {
      hold(add, { kind: 'noIdentity' });
    } else if (add.endTimestamp !== null && add.endTimestamp - add.timestamp < GUARD_LIMITS.minAddSeconds) {
      hold(add, { kind: 'short', seconds: Math.round(add.endTimestamp - add.timestamp) });
    }
  }
}

/** Check 4: whether the adds, ticked or not, look like a second list pasted under the first. */
function looksPasted(draft: CorrectionDraft, view: NovaVodCorrectionView): boolean {
  const { minAdds, nearSeconds, minNearShare } = GUARD_LIMITS.pastedList;
  if (draft.adds.length < minAdds) return false;
  const near = draft.adds.filter((add) => view.current.some((live) => Math.abs(add.timestamp - live.timestamp) <= nearSeconds));
  return near.length / draft.adds.length >= minNearShare;
}

/** Check 5: two ticked adds of one title that touch or overlap are both held. */
function holdTouchingRepeats(draft: CorrectionDraft, hold: HoldAdd): void {
  const titles = draft.adds.map((add) => normalizeForMatching(add.title));
  const touching = new Set<AddDraft>();
  draft.adds.forEach((left, x) => {
    draft.adds.forEach((right, y) => {
      if (y <= x || !left.apply || !right.apply || titles[x] !== titles[y]) return;
      const [first, second] = left.timestamp <= right.timestamp ? [left, right] : [right, left];
      if (first.endTimestamp === null || first.endTimestamp >= second.timestamp - GUARD_LIMITS.overlapToleranceSeconds) {
        touching.add(left);
        touching.add(right);
      }
    });
  });
  for (const add of touching) hold(add, { kind: 'repeatAdd' });
}

/** A row where the draft's defaults put it, for check 6. */
interface PlacedRow {
  /** What a row it newly overlaps names it by: the live row's title, or the add's. */
  title: string;
  /** Where it sits once the defaults are applied. */
  at: Interval;
  /** Where its live row sits now, or null for an add, which overlapped nothing before. */
  live: Interval | null;
  /** Takes back the tick that puts it at `at`: a pair's times, or an add. Null for a live row no tick moves. */
  hold: ((reason: GuardReason) => void) | null;
}

/** Every row as the defaults leave it: each live row no ticked delete removes, then each ticked add. */
function placedRows(draft: CorrectionDraft, view: NovaVodCorrectionView, holdPair: HoldPair, holdAdd: HoldAdd): PlacedRow[] {
  const byLiveRow = pairsByLiveRow(draft);
  const deleted = new Set(draft.deletes.filter((entry) => entry.apply).map((entry) => entry.currentIndex));
  const placed: PlacedRow[] = [];
  view.current.forEach((live, index) => {
    if (deleted.has(index)) return;
    const now: Interval = { start: live.timestamp, end: live.endTimestamp };
    const pair = byLiveRow.get(index);
    placed.push(
      pair?.applyTimes
        ? { title: live.title, at: { start: pair.timestamp, end: pair.endTimestamp }, live: now, hold: (reason) => holdPair(pair, reason) }
        : { title: live.title, at: now, live: now, hold: null },
    );
  });
  for (const add of draft.adds) {
    if (add.apply) placed.push({ title: add.title, at: { start: add.timestamp, end: add.endTimestamp }, live: null, hold: (reason) => holdAdd(add, reason) });
  }
  return placed;
}

/**
 * Check 6: every two rows, one of them ticked at least, that overlap by more than `overlapToleranceSeconds` beyond what
 * their live rows did. Each ticked one is held at once, after the scan, naming the first row it was found to overlap,
 * and the scan runs again over the rows the holds put back, until it holds nothing.
 */
function holdNewOverlaps(draft: CorrectionDraft, view: NovaVodCorrectionView, holdPair: HoldPair, holdAdd: HoldAdd): void {
  for (;;) {
    const placed = placedRows(draft, view, holdPair, holdAdd);
    const offenders = new Map<PlacedRow, string>();
    placed.forEach((left, x) => {
      for (const right of placed.slice(x + 1)) {
        if (left.hold === null && right.hold === null) continue;
        const before = left.live !== null && right.live !== null ? overlapSeconds(left.live, right.live) : 0;
        if (overlapSeconds(left.at, right.at) <= before + GUARD_LIMITS.overlapToleranceSeconds) continue;
        if (left.hold !== null && !offenders.has(left)) offenders.set(left, right.title);
        if (right.hold !== null && !offenders.has(right)) offenders.set(right, left.title);
      }
    });
    if (offenders.size === 0) return;
    for (const [entry, withTitle] of offenders) entry.hold?.({ kind: 'overlap', withTitle });
  }
}

/**
 * `draft` with every default tick that fails a check taken back, and why (`DraftGuard`): the checks in the header, in
 * order. A new draft: `draft` is not modified, and only the ticks of its pairs' times and of its adds change. A row
 * keeps the first reason it gets, and a row that was not ticked gets none. Check 1 takes its ticks back last, so the
 * others run over the ticks `draft` has and a row they hold keeps their reason; its banner comes first, then a pasted
 * list's, then a partial list's.
 */
export function guardDraft(draft: CorrectionDraft, view: NovaVodCorrectionView): { draft: CorrectionDraft; guard: DraftGuard } {
  const guarded: CorrectionDraft = {
    pairs: draft.pairs.map((pair) => ({ ...pair })),
    adds: draft.adds.map((add) => ({ ...add })),
    deletes: draft.deletes.map((entry) => ({ ...entry })),
  };
  const pairs = new Map<string, GuardReason>();
  const adds = new Map<number, GuardReason>();
  const holdPair: HoldPair = (pair, reason) => {
    if (!pair.applyTimes) return;
    pair.applyTimes = false;
    if (!pairs.has(pairKey(pair))) pairs.set(pairKey(pair), reason);
  };
  const holdAdd: HoldAdd = (add, reason) => {
    if (!add.apply) return;
    add.apply = false;
    if (!adds.has(add.proposedIndex)) adds.set(add.proposedIndex, reason);
  };

  holdMovedRows(guarded, view, holdPair);
  const partial = holdPartialList(guarded, view, holdPair);
  holdUnnamedAndShortAdds(guarded, view, holdAdd);
  const pasted = looksPasted(guarded, view);
  if (pasted) for (const add of guarded.adds) holdAdd(add, { kind: 'pastedList' });
  holdTouchingRepeats(guarded, holdAdd);
  holdNewOverlaps(guarded, view, holdPair, holdAdd);
  const unverified = view.base === null ? 'baseMissing' : view.baseVerified ? null : 'baseUnverified';
  if (unverified !== null) {
    for (const pair of guarded.pairs) holdPair(pair, { kind: 'unverifiedBase' });
    for (const add of guarded.adds) holdAdd(add, { kind: 'unverifiedBase' });
  }
  const banner = unverified ?? (pasted ? 'pastedList' : partial ? 'partialList' : null);
  return { draft: guarded, guard: { banner, pairs, adds } };
}

/** The draft the review page opens with: `initialDraft`, guarded (`guardDraft`). */
export function guardedInitialDraft(view: NovaVodCorrectionView): { draft: CorrectionDraft; guard: DraftGuard } {
  return guardDraft(initialDraft(view), view);
}
