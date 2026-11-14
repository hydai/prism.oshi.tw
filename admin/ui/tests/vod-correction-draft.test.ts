/**
 * The review draft (spec §6.6): what a curator's ticks and edits on the correction review page come to as the
 * operations `POST /api/nova/vods/:id/apply` takes. The page renders from this model; these tests pin the model
 * alone, on the ichii correction (fixtures/vod-correction.ts): six pairs, one current row left over (a delete
 * candidate), and a typo in the first title.
 *
 * The apply parser refuses an operation that carries a key its variant does not have, so every operation is
 * compared with `deepStrictEqual` against a literal: it tells a missing key from one that is there as `undefined`.
 */
import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Status } from '../../shared/types';
import { matchCorrection, referenceStarts, summarizeCorrection, yieldedEnd } from '../../shared/vod-correction';
import type { CorrectionCurrentRow, CorrectionOperation, CorrectionProposedRow, NovaVodCorrectionView } from '../../shared/vod-correction';
import {
  addLandingSong,
  choiceLandingSong,
  draftFlags,
  draftOperations,
  draftRepeats,
  draftSuggestions,
  initialDraft,
  pairWith,
  promotedSongs,
  relinkPublishes,
  suggestedChanges,
  tickAllAdds,
  tickAllTimes,
  unpair,
} from '../src/lib/vod-correction-draft';
import type { AddDraft, CorrectionDraft, DeleteDraft, PairDraft, RowFlags, TitleChoice } from '../src/lib/vod-correction-draft';
import {
  baseRow,
  correctionView,
  countedReadsView,
  ichiiCorrectionView,
  liveRow,
  row,
  startOnlyCorrectionView,
  submittedRows,
  type ReadCounts,
  type RowFields,
} from './fixtures/vod-correction';

// --- Helpers ---

/** The value, or a failure naming what the test expected to find: `noUncheckedIndexedAccess` is on. */
function need<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`the test needs ${what}`);
  return value;
}

/** `items` with the one at `index` changed: a draft or a view is edited by copy, never in place. */
function edited<T>(items: readonly T[], index: number, change: Partial<T>): T[] {
  return items.map((item, position) => (position === index ? { ...item, ...change } : item));
}

/** The view after `edit` (the ichii one unless given), its suggested pairing worked out again from the rows the edit left. */
function viewAfter(edit: (view: NovaVodCorrectionView) => void, view = ichiiCorrectionView()): NovaVodCorrectionView {
  edit(view);
  view.match = matchCorrection(view.current, view.proposed);
  return view;
}

const rename = (title: string, originalArtist: string): TitleChoice => ({ kind: 'rename', title, originalArtist });

/** The draft with pair `index` (a position in `draft.pairs`) changed. */
function withPair(draft: CorrectionDraft, index: number, change: Partial<PairDraft>): CorrectionDraft {
  return { ...draft, pairs: edited(draft.pairs, index, change) };
}

const NOTHING_SKIPPED = { time: 0, title: 0, add: 0, delete: 0 };

// --- The brief's tests ---

function testInitialDraftAppliesSixTimeEdits(): void {
  const view = ichiiCorrectionView();
  const result = draftOperations(initialDraft(view), view);
  strictEqual(result.operations.length, 6);
  strictEqual(result.operations.every((operation) => operation.op === 'setTimes'), true, 'all six are setTimes');
  deepStrictEqual(result.skipped, { time: 0, title: 1, add: 0, delete: 1 });
  strictEqual(result.appliedCount, 6);
  strictEqual(result.skippedCount, 2);
}

function testPairOneChangesOnlyItsEnd(): void {
  const view = ichiiCorrectionView();
  const { operations } = draftOperations(initialDraft(view), view);
  deepStrictEqual(operations[1], { op: 'setTimes', performanceId: 'p2', endTimestamp: 1617 });
}

function testTickingTheDeleteAddsIt(): void {
  const view = ichiiCorrectionView();
  const draft = initialDraft(view);
  const ticked = { ...draft, deletes: edited(draft.deletes, 0, { apply: true }) };
  const result = draftOperations(ticked, view);
  deepStrictEqual(result.operations.at(-1), { op: 'deletePerformance', performanceId: 'p3' });
  strictEqual(result.appliedCount, 7);
  deepStrictEqual(result.skipped, { time: 0, title: 1, add: 0, delete: 0 });
  strictEqual(result.skippedCount, 1);
}

function testRenamingThePairsSong(): void {
  const view = ichiiCorrectionView();
  const renamed = withPair(initialDraft(view), 0, { title: rename('Late Niqht Drive', 'Unknown') });
  const result = draftOperations(renamed, view);
  deepStrictEqual(result.operations.filter((operation) => operation.op === 'renameSong'), [
    { op: 'renameSong', songId: 's1', title: 'Late Niqht Drive' },
  ]);
  strictEqual(result.appliedCount, 7);
  deepStrictEqual(result.skipped, { time: 0, title: 0, add: 0, delete: 1 });
}

function testUnpairingMakesAnAddAndADelete(): void {
  const view = ichiiCorrectionView();
  const split = unpair(initialDraft(view), view, 0);
  strictEqual(split.pairs.length, 5);
  strictEqual(split.adds.length, 1);
  strictEqual(need(split.adds[0], 'an add').apply, true, 'the add is applied');
  strictEqual(split.deletes.length, 2);
  deepStrictEqual(split.deletes.map((entry) => entry.apply), [false, false]);
  const { operations } = draftOperations(split, view);
  deepStrictEqual(operations.filter((operation) => operation.op === 'addPerformance'), [
    { op: 'addPerformance', title: 'Late Niqht Drive', originalArtist: 'Unknown', timestamp: 881, endTimestamp: 1024 },
  ]);
}

function testPairingWithRestoresThePair(): void {
  const view = ichiiCorrectionView();
  const draft = initialDraft(view);
  const restored = pairWith(unpair(draft, view, 0), view, 0, 0);
  strictEqual(restored.pairs.length, 6);
  deepStrictEqual(restored, draft, 'pairing the two back gives the draft the page started from');
}

// --- The starting point ---

function testInitialDraftDefaults(): void {
  const view = ichiiCorrectionView();
  const draft = initialDraft(view);
  deepStrictEqual(draft.pairs.map((pair) => [pair.currentIndex, pair.proposedIndex]), [[0, 0], [1, 1], [3, 2], [4, 3], [5, 4], [6, 5]]);
  deepStrictEqual(need(draft.pairs[0], 'pair 0'), {
    currentIndex: 0,
    proposedIndex: 0,
    applyTimes: true,
    timestamp: 881,
    endTimestamp: 1024,
    title: { kind: 'ignore' },
  }, 'the draft values start as the proposed ones');
  strictEqual(draft.pairs.every((pair) => pair.applyTimes && pair.title.kind === 'ignore'), true);
  const leftOver: DeleteDraft = { currentIndex: 2, apply: false }; // A Tender Moon Tempo: nothing proposed corrects it
  deepStrictEqual(draft.adds, []);
  deepStrictEqual(draft.deletes, [leftOver]);
}

function testInitialDraftSendsOnlyWhatDiffers(): void {
  const view = ichiiCorrectionView();
  deepStrictEqual(draftOperations(initialDraft(view), view).operations, [
    { op: 'setTimes', performanceId: 'p1', timestamp: 881, endTimestamp: 1024 },
    { op: 'setTimes', performanceId: 'p2', endTimestamp: 1617 },
    { op: 'setTimes', performanceId: 'p4', timestamp: 2247, endTimestamp: 2445 },
    { op: 'setTimes', performanceId: 'p5', endTimestamp: 2945 },
    { op: 'setTimes', performanceId: 'p6', timestamp: 3512, endTimestamp: 3658 },
    { op: 'setTimes', performanceId: 'p7', timestamp: 5368, endTimestamp: 5472 },
  ]);
}

/** A song the ichii submission adds after Moon River, with no end: the last line of a paste. */
const MOON_DANCE: CorrectionProposedRow = {
  id: 'v7', title: 'Moon Dance', originalArtist: '', timestamp: 6000, endTimestamp: null, endFilled: false, nextSubmittedId: null, existingSong: null,
};

function testSuggestedAddsStartApplied(): void {
  // A proposed row the matcher left unpaired is an add, ticked; a current one is a delete, unticked.
  const view = viewAfter((v) => {
    v.proposed.push(MOON_DANCE);
  });
  const draft = initialDraft(view);
  const moonDance: AddDraft = { proposedIndex: 6, apply: true, title: 'Moon Dance', originalArtist: '', timestamp: 6000, endTimestamp: null };
  deepStrictEqual(draft.adds, [moonDance]);
  const result = draftOperations(draft, view);
  deepStrictEqual(result.operations.at(-1), { op: 'addPerformance', title: 'Moon Dance', originalArtist: 'Unknown', timestamp: 6000, endTimestamp: null });
  const unticked = draftOperations({ ...draft, adds: edited(draft.adds, 0, { apply: false }) }, view);
  strictEqual(unticked.operations.some((operation) => operation.op === 'addPerformance'), false);
  deepStrictEqual(unticked.skipped, { time: 0, title: 1, add: 1, delete: 1 });
}

function testAPairWhoseTimesAgreeStartsUnticked(): void {
  const view = viewAfter((v) => {
    v.proposed[1] = { ...need(v.proposed[1], 'proposed 1'), endTimestamp: 1621 };
  });
  const draft = initialDraft(view);
  strictEqual(need(draft.pairs[1], 'pair 1').applyTimes, false);
  const result = draftOperations(draft, view);
  strictEqual(result.appliedCount, 5, 'no time edit for p2');
  strictEqual(result.skipped.time, 0, 'nothing was suggested, so nothing is skipped');
  // Ticked anyway, with the values untouched, it still sends nothing.
  const ticked = draftOperations(withPair(draft, 1, { applyTimes: true }), view);
  strictEqual(ticked.appliedCount, 5);
  strictEqual(ticked.skipped.time, 0);
}

// --- Time edits ---

function testTimesCarryOnlyWhatDiffers(): void {
  const view = ichiiCorrectionView();
  const draft = initialDraft(view);
  const times = (change: { timestamp?: number; endTimestamp?: number | null }) =>
    draftOperations(withPair(draft, 1, change), view).operations[1];
  deepStrictEqual(times({ timestamp: 1390, endTimestamp: 1621 }), { op: 'setTimes', performanceId: 'p2', timestamp: 1390 }, 'the start alone');
  deepStrictEqual(times({ timestamp: 1390 }), { op: 'setTimes', performanceId: 'p2', timestamp: 1390, endTimestamp: 1617 }, 'both');
  deepStrictEqual(times({ endTimestamp: null }), { op: 'setTimes', performanceId: 'p2', endTimestamp: null }, 'an end may be cleared');
}

function testNullIsAValueForTheEnd(): void {
  const view = viewAfter((v) => {
    v.current[1] = { ...need(v.current[1], 'current 1'), endTimestamp: null };
  });
  const draft = initialDraft(view);
  deepStrictEqual(draftOperations(draft, view).operations[1], { op: 'setTimes', performanceId: 'p2', endTimestamp: 1617 }, 'an open end given one');
  // Open against open is no change at all.
  const open = draftOperations(withPair(draft, 1, { endTimestamp: null }), view);
  strictEqual(open.operations.some((operation) => operation.op === 'setTimes' && operation.performanceId === 'p2'), false);
}

function testUntickedTimesAreSkipped(): void {
  const view = ichiiCorrectionView();
  const draft = initialDraft(view);
  const one = draftOperations(withPair(draft, 1, { applyTimes: false }), view);
  strictEqual(one.operations.some((operation) => operation.op === 'setTimes' && operation.performanceId === 'p2'), false);
  deepStrictEqual(one.skipped, { time: 1, title: 1, add: 0, delete: 1 });
  strictEqual(one.appliedCount, 5);
  strictEqual(one.skippedCount, 3);

  const none = draftOperations({ ...draft, pairs: draft.pairs.map((pair) => ({ ...pair, applyTimes: false })) }, view);
  strictEqual(none.appliedCount, 0);
  deepStrictEqual(none.skipped, { time: 6, title: 1, add: 0, delete: 1 });
}

function testEditingTimesBackToTheCurrentOnesSendsNothing(): void {
  // A time choice whose fields all equal the current row's is no operation. The suggestion it was
  // made from still went unapplied, so it counts as skipped and ticked plus unticked stays six.
  const view = ichiiCorrectionView();
  const reverted = withPair(initialDraft(view), 1, { timestamp: 1394, endTimestamp: 1621 });
  const result = draftOperations(reverted, view);
  strictEqual(result.operations.some((operation) => operation.op === 'setTimes' && operation.performanceId === 'p2'), false);
  strictEqual(result.skipped.time, 1);
  strictEqual(result.appliedCount + result.skipped.time, 6);
}

function testAnUntickedEditNobodySuggestedIsNotSkipped(): void {
  // `skipped` counts what the submission suggested. A time the curator typed in on a pair the submission left as it
  // was is their own: leaving it unticked drops it without counting a suggestion that was never made.
  const view = viewAfter((v) => {
    v.proposed[1] = { ...need(v.proposed[1], 'proposed 1'), endTimestamp: 1621 };
  });
  const typed = withPair(initialDraft(view), 1, { endTimestamp: 1700 });
  strictEqual(need(typed.pairs[1], 'pair 1').applyTimes, false, 'nothing was suggested, so the times start unticked');
  const result = draftOperations(typed, view);
  strictEqual(result.operations.some((operation) => operation.op === 'setTimes' && operation.performanceId === 'p2'), false);
  strictEqual(result.skipped.time, 0);
}

function testInvertedTimesAreStillSent(): void {
  // Refusing an end that is not after its start is the server's job (it names the operation).
  const view = ichiiCorrectionView();
  const inverted = withPair(initialDraft(view), 1, { endTimestamp: 1300 });
  deepStrictEqual(draftOperations(inverted, view).operations[1], { op: 'setTimes', performanceId: 'p2', endTimestamp: 1300 });
}

// --- Ends the contributor did not give ---

function testStartOnlyRowsProposeNoEnds(): void {
  // Pasted as start times only, to fix one title: every submitted end is the parser's (the next row's start, or none
  // for the last row), so no pair suggests an end. Nothing is ticked, each end stays the stream's, the title is left.
  const view = startOnlyCorrectionView();
  const none = { start: false, end: false, title: false, artist: false };
  strictEqual(view.match.pairs.every((pair) => pair.changes.end), true, "the matcher's own flags still see every end differ");
  deepStrictEqual(
    view.match.pairs.map((pair) => suggestedChanges(view, pair.currentIndex, pair.proposedIndex)),
    [none, none, { ...none, title: true }, none, none],
    'no derived end is suggested: neither one equal to the next start nor the last one left empty',
  );
  const draft = initialDraft(view);
  deepStrictEqual(draft.pairs.map((pair) => [pair.currentIndex, pair.proposedIndex]), [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4]]);
  strictEqual(draft.pairs.some((pair) => pair.applyTimes), false, 'no time change is ticked');
  deepStrictEqual(draft.pairs.map((pair) => pair.endTimestamp), [340, 640, 940, 1240, 1540], 'each end starts as the stream has it');
  deepStrictEqual(draftOperations(draft, view), {
    operations: [],
    skipped: { time: 0, title: 1, add: 0, delete: 0 },
    appliedCount: 0,
    skippedCount: 1,
    needsEndCount: 0,
    canApply: false,
  });
  // The curator may still give an end, the parser's own value included: it is sent like any edit, and skips nothing.
  const typed = draftOperations(withPair(draft, 0, { endTimestamp: 400, applyTimes: true }), view);
  deepStrictEqual(typed.operations, [{ op: 'setTimes', performanceId: 'p1', endTimestamp: 400 }]);
  strictEqual(typed.skipped.time, 0);
  // A pair made by hand reads its ends the same way.
  deepStrictEqual(pairWith(unpair(draft, view, 0), view, 0, 0), draft);
}

function testADerivedEndLeavesTheEndAsItIs(): void {
  // The contributor moved Song B's start and Song E's: the parser gave the rows before them the new starts as their
  // ends, and Song E still has none. Only the starts are sent: no end changes, the derived null one included.
  const view = viewAfter((v) => {
    const moved: Record<number, { timestamp?: number; endTimestamp?: number }> = {
      0: { endTimestamp: 405 },
      1: { timestamp: 405 },
      3: { endTimestamp: 1310 },
      4: { timestamp: 1310 },
    };
    v.proposed = v.proposed.map((row, index) => ({ ...row, ...moved[index] }));
  }, startOnlyCorrectionView());
  const result = draftOperations(initialDraft(view), view);
  deepStrictEqual(result.operations, [
    { op: 'setTimes', performanceId: 'p2', timestamp: 405 },
    { op: 'setTimes', performanceId: 'p5', timestamp: 1310 },
  ]);
  deepStrictEqual(result.skipped, { time: 0, title: 1, add: 0, delete: 0 });
}

/** Songs A, B and C of a stream, 100 s each, as both the stream and the base have them. */
const ABC = [row('A', 'X', 100, 200), row('B', 'X', 300, 400), row('C', 'X', 500, 600)];
const ABC_LIVE = ABC.map((fields, index) => liveRow(`p${index + 1}`, fields));
const ABC_BASE = ABC.map((fields, index) => baseRow(`p${index + 1}`, fields));

function testAShiftedStartOnlyListKeepsLengthsUnderHalf(): void {
  // Finding #1, start times only: every row 60 s later, so the parsers end each where the next starts. By time, A's
  // 160–360 overlaps B's row more than its own; by title each row pairs with its own, its start ticked. The stream's
  // end would leave each row 40 s of its 100, under half, so each derived end keeps the row's 100 s from the new
  // start instead (cut at the next submitted row's start, which comes later).
  for (const base of [null, ABC_BASE]) {
    const view = correctionView({ base, current: ABC_LIVE, proposed: [row('A', 'X', 160, 360), row('B', 'X', 360, 560), row('C', 'X', 560, null)] });
    const draft = initialDraft(view);
    deepStrictEqual(
      draft.pairs.map((pair) => [pair.currentIndex, pair.proposedIndex, pair.applyTimes, pair.timestamp, pair.endTimestamp]),
      [[0, 0, true, 160, 260], [1, 1, true, 360, 460], [2, 2, true, 560, 660]],
      `${base ? 'with' : 'with no'} base: each row its own, the start ticked, the length kept`,
    );
    deepStrictEqual(draftOperations(draft, view).operations, [
      { op: 'setTimes', performanceId: 'p1', timestamp: 160, endTimestamp: 260 },
      { op: 'setTimes', performanceId: 'p2', timestamp: 360, endTimestamp: 460 },
      { op: 'setTimes', performanceId: 'p3', timestamp: 560, endTimestamp: 660 },
    ]);
  }
}

function testARowMovedPastItsOwnEndKeepsItsLength(): void {
  // A, 100–200, moved start-only to 250, past its own end; B left at 300. Given back, the stream's end would come
  // before the new start. A keeps its 100 s instead, up to B's start: 250–300, ticked.
  for (const base of [null, ABC_BASE.slice(0, 2)]) {
    const view = correctionView({ base, current: ABC_LIVE.slice(0, 2), proposed: [row('A', 'X', 250, 300), row('B', 'X', 300, null)] });
    const draft = initialDraft(view);
    deepStrictEqual(need(draft.pairs[0], 'the A pair'), {
      currentIndex: 0, proposedIndex: 0, applyTimes: true, timestamp: 250, endTimestamp: 300, title: { kind: 'ignore' },
    }, `${base ? 'with' : 'with no'} base`);
    deepStrictEqual(draftOperations(draft, view).operations, [{ op: 'setTimes', performanceId: 'p1', timestamp: 250, endTimestamp: 300 }]);
  }
}

function testARowMovedBackAcrossAnUnmovedRowKeepsItsLength(): void {
  // C, 500–600, moved start-only to 250, back before B (300), which stays: Nova stores the rows in time order, C ending
  // where B starts. Given back, the stream's end would run across B. C keeps its 100 s instead, up to B's start:
  // 250–300, ticked.
  const live = [...ABC_LIVE, liveRow('p4', row('D', 'X', 700, 800))];
  for (const base of [null, [...ABC_BASE, baseRow('p4', row('D', 'X', 700, 800))]]) {
    const view = correctionView({
      base,
      current: live,
      proposed: [row('A', 'X', 100, 200), row('C', 'X', 250, 300), row('B', 'X', 300, 400), row('D', 'X', 700, 800)],
    });
    const draft = initialDraft(view);
    deepStrictEqual(need(draft.pairs[2], 'the C pair'), {
      currentIndex: 2, proposedIndex: 1, applyTimes: true, timestamp: 250, endTimestamp: 300, title: { kind: 'ignore' },
    }, `${base ? 'with' : 'with no'} base`);
    deepStrictEqual(draftOperations(draft, view).operations, [{ op: 'setTimes', performanceId: 'p3', timestamp: 250, endTimestamp: 300 }]);
  }
}

function testAHandPairAcrossALongMoveNeverInverts(): void {
  // Finding #14. Song C, 500–600, retitled and moved to 1000 in a start-only paste, pairs by neither title nor time:
  // an add and a delete. Paired by hand, its derived end (D's start, 1300) does not give way to C's 600, which comes
  // before its new start: it keeps C's 100 s, 1000–1100, ticked, and the apply may go.
  const view = correctionView({
    base: null,
    current: [liveRow('p1', row('Song C', 'X', 500, 600)), liveRow('p2', row('Song D', 'X', 1300, 1500))],
    proposed: [row('Song C (Live)', 'X', 1000, 1300), row('Song D', 'X', 1300, null)],
  });
  const draft = initialDraft(view);
  deepStrictEqual([draft.adds.map((add) => add.proposedIndex), draft.deletes.map((entry) => entry.currentIndex)], [[0], [0]], 'the fixture: an add and a delete');
  const paired = pairWith(draft, view, 0, 0);
  const pair = need(paired.pairs.find((entry) => entry.currentIndex === 0), 'the hand pair');
  deepStrictEqual([pair.applyTimes, pair.timestamp, pair.endTimestamp], [true, 1000, 1100]);
  const result = draftOperations(paired, view);
  deepStrictEqual(result.operations, [{ op: 'setTimes', performanceId: 'p1', timestamp: 1000, endTimestamp: 1100 }]);
  strictEqual(result.canApply, true);
}

// --- Title choices ---

function testAnArtistDifferenceIsASkippedTitleToo(): void {
  const view = viewAfter((v) => {
    v.proposed[1] = { ...need(v.proposed[1], 'proposed 1'), originalArtist: 'Mayday' };
  });
  const result = draftOperations(initialDraft(view), view);
  deepStrictEqual(result.skipped, { time: 0, title: 2, add: 0, delete: 1 });
}

function testRenameCarriesOnlyTheFieldsThatDiffer(): void {
  const view = ichiiCorrectionView();
  const draft = initialDraft(view);
  const renameOp = (choice: TitleChoice, pair = 0) => {
    const { operations } = draftOperations(withPair(draft, pair, { title: choice }), view);
    return operations.find((operation) => operation.op === 'renameSong');
  };
  deepStrictEqual(renameOp(rename('Late Night Drive', 'Frank')), { op: 'renameSong', songId: 's1', originalArtist: 'Frank' }, 'the artist alone');
  deepStrictEqual(renameOp(rename('Late Niqht Drive', 'Frank')), { op: 'renameSong', songId: 's1', title: 'Late Niqht Drive', originalArtist: 'Frank' }, 'both');
  deepStrictEqual(renameOp(rename('Fly Me To The Moon', ''), 4), { op: 'renameSong', songId: 's6', originalArtist: 'Unknown' }, 'a blank artist is Unknown');
  deepStrictEqual(renameOp(rename('Late Niqht Drive', '')), { op: 'renameSong', songId: 's1', title: 'Late Niqht Drive' }, 'and Unknown is what row 0 already has');
}

function testRenameMayFixOnlyCaseOrSpacing(): void {
  // The flag on the page is normalized; what a rename sends is not: it differs when the text does.
  const view = ichiiCorrectionView();
  const draft = initialDraft(view);
  const sent = (title: string) => draftOperations(withPair(draft, 0, { title: rename(title, 'Unknown') }), view).operations.find((operation) => operation.op === 'renameSong');
  deepStrictEqual(sent('late night drive'), { op: 'renameSong', songId: 's1', title: 'late night drive' });
  deepStrictEqual(sent('Late  Night Drive'), { op: 'renameSong', songId: 's1', title: 'Late  Night Drive' });
}

function testRenameReadsTheTextTrimmed(): void {
  const view = ichiiCorrectionView();
  const draft = initialDraft(view);
  // Whitespace round the text is no change, and is not sent along with one.
  const same = draftOperations(withPair(draft, 0, { title: rename('  Late Night Drive ', ' Unknown ') }), view);
  strictEqual(same.operations.some((operation) => operation.op === 'renameSong'), false);
  strictEqual(same.skipped.title, 1, 'the typo the page suggested went unfixed');
  const changed = draftOperations(withPair(draft, 0, { title: rename(' Late Niqht Drive ', ' Frank ') }), view);
  deepStrictEqual(changed.operations.find((operation) => operation.op === 'renameSong'), {
    op: 'renameSong', songId: 's1', title: 'Late Niqht Drive', originalArtist: 'Frank',
  });
}

function testARenameThatChangesNothingIsNoOperation(): void {
  const view = ichiiCorrectionView();
  const draft = initialDraft(view);
  // Pair 1 has no title suggestion: a rename to what it already is sends nothing and skips nothing.
  const result = draftOperations(withPair(draft, 1, { title: rename('私奔到月球', '五月天') }), view);
  strictEqual(result.appliedCount, 6);
  deepStrictEqual(result.skipped, { time: 0, title: 1, add: 0, delete: 1 });
  // Pair 0 has one, so the same no-op leaves it unapplied, which counts as skipped.
  const typo = draftOperations(withPair(draft, 0, { title: rename('Late Night Drive', 'Unknown') }), view);
  strictEqual(typo.appliedCount, 6);
  deepStrictEqual(typo.skipped, { time: 0, title: 1, add: 0, delete: 1 });
}

function testRelinkChoices(): void {
  const view = ichiiCorrectionView();
  const draft = initialDraft(view);
  const existing: TitleChoice = { kind: 'relinkExisting', songId: 's9', songLabel: 'Late Night Drive / Unknown', songStatus: 'pending' };
  const toExisting = draftOperations(withPair(draft, 0, { title: existing }), view);
  deepStrictEqual(toExisting.operations.find((operation) => operation.op === 'relinkToSong'), {
    op: 'relinkToSong', performanceId: 'p1', songId: 's9', expectedSongStatus: 'pending',
  });
  strictEqual(toExisting.skipped.title, 0, 'a relink settles the suggested title change');

  const toNew = draftOperations(withPair(draft, 0, { title: { kind: 'relinkNew', title: ' Late Night Drive ', originalArtist: '' } }), view);
  deepStrictEqual(toNew.operations.find((operation) => operation.op === 'relinkToNewSong'), {
    op: 'relinkToNewSong', performanceId: 'p1', title: 'Late Night Drive', originalArtist: 'Unknown',
  });
  strictEqual(toNew.skipped.title, 0);
}

/**
 * An approved stream of two rows, Song A (p1) and Song B (p2), both of which the submission keeps; its line for Song B
 * resolves to `resolved` as the route resolves it (`existingSong`), a song or none.
 */
function aStreamWhereSongBResolvesTo(resolved: { id: string; status: Status } | null): NovaVodCorrectionView {
  const view = correctionView({
    base: null,
    current: [liveRow('p1', row('Song A', 'Artist', 100, 200)), liveRow('p2', row('Song B', 'Artist', 300, 400))],
    proposed: [row('Song A', 'Artist', 100, 200), row('Song B', 'Artist', 300, 400)],
  });
  need(view.proposed[1], 'the line for Song B').existingSong = resolved;
  return view;
}

/** The relink the draft sends for Song B's pair once its title choice is `title`, after `edit` has changed the draft. */
function relinkSentForSongB(
  view: NovaVodCorrectionView,
  title: TitleChoice,
  edit: (draft: CorrectionDraft) => CorrectionDraft = (draft) => draft,
): CorrectionOperation | undefined {
  const draft = edit(withPair(initialDraft(view), 1, { title }));
  return draftOperations(draft, view).operations.find((operation) => operation.op === 'relinkToSong' || operation.op === 'relinkToNewSong');
}

/** A song of the streamer with the id s9, of this status: what a line resolves to, or the song 改連到既有的歌 picked. */
const songS9 = (status: Status): { id: string; status: Status } => ({ id: 's9', status });
const pickedS9 = (songStatus: Status): TitleChoice => ({ kind: 'relinkExisting', songId: 's9', songLabel: 'Song D · Artist', songStatus });
const newSong = (title: string, originalArtist: string): TitleChoice => ({ kind: 'relinkNew', title, originalArtist });
/** The 改連到新的歌 the draft sends for Song B as submitted, with the status it expects of the song (null: none) when it expects one. */
const newSongBOperation = (expectedSongStatus?: Status | null) => ({
  op: 'relinkToNewSong', performanceId: 'p2', title: 'Song B', originalArtist: 'Artist',
  ...(expectedSongStatus === undefined ? {} : { expectedSongStatus }),
});

function testRelinkOperationsCarryTheStatusShown(): void {
  // The review's #15. A relink sends the status the review showed for the song it lands on (`expectedSongStatus`), so
  // that the apply refuses it as stale once the song has another: one demoted after the page loaded would be approved
  // again with every other row of it. 改連到既有的歌 sends the status of the song picked, as the page shows it.
  // 改連到新的歌 sends that of the song its title and artist resolve to, as the view read it, and null when the view read
  // that there is none, so the apply creates one.
  for (const songStatus of ['approved', 'pending'] as const) {
    deepStrictEqual(
      relinkSentForSongB(aStreamWhereSongBResolvesTo(null), pickedS9(songStatus)),
      { op: 'relinkToSong', performanceId: 'p2', songId: 's9', expectedSongStatus: songStatus },
      `改連到既有的歌, shown ${songStatus}`,
    );
  }

  deepStrictEqual(relinkSentForSongB(aStreamWhereSongBResolvesTo(songS9('approved')), newSong('Song B', 'Artist')), newSongBOperation('approved'), 'resolves to an approved song');
  deepStrictEqual(relinkSentForSongB(aStreamWhereSongBResolvesTo(songS9('pending')), newSong('Song B', 'Artist')), newSongBOperation('pending'), 'resolves to a pending one');
  deepStrictEqual(relinkSentForSongB(aStreamWhereSongBResolvesTo(null), newSong('Song B', 'Artist')), newSongBOperation(null), 'resolves to none: the apply creates one');
  deepStrictEqual(
    relinkSentForSongB(aStreamWhereSongBResolvesTo(songS9('pending')), newSong(' Song B ', ' Artist ')),
    newSongBOperation('pending'),
    'as the apply reads the text, trimmed',
  );

  // A line submitted with no artist resolves with each artist the stream has (`existingSongsByLiveArtist`), and with none.
  const blank = aStreamWhereSongBResolvesTo(songS9('approved'));
  const line = need(blank.proposed[1], 'the line for Song B');
  line.originalArtist = '';
  line.existingSongsByLiveArtist = [
    { originalArtist: 'Artist', existingSong: songS9('pending') },
    { originalArtist: 'Other', existingSong: null },
  ];
  deepStrictEqual(relinkSentForSongB(blank, newSong('Song B', 'Artist')), newSongBOperation('pending'), "the stream's artist, whose Song B is pending");
  deepStrictEqual(
    relinkSentForSongB(blank, newSong('Song B', 'Other')),
    { ...newSongBOperation(null), originalArtist: 'Other' },
    'an artist whose Song B is no song: the apply creates one',
  );
  deepStrictEqual(
    relinkSentForSongB(blank, newSong('Song B', '')),
    { ...newSongBOperation('approved'), originalArtist: 'Unknown' },
    'left blank, it is Unknown, which resolves to the approved song',
  );
}

function testATypedOverRelinkSendsNoExpectedStatus(): void {
  // The view read what Song B resolves to, as submitted. A title or an artist the curator typed over it names a song
  // the view never resolved, and sending null there ("the apply creates one") would have the apply refuse the review as
  // stale for good wherever it resolves to a song after all. So nothing is sent: the apply checks nothing.
  const approved = aStreamWhereSongBResolvesTo(songS9('approved'));
  deepStrictEqual(
    relinkSentForSongB(approved, newSong('Song B (Live)', 'Artist')),
    { ...newSongBOperation(), title: 'Song B (Live)' },
    'another title',
  );
  deepStrictEqual(
    relinkSentForSongB(approved, newSong('Song B', 'Someone Else')),
    { ...newSongBOperation(), originalArtist: 'Someone Else' },
    'another artist',
  );
  const none = aStreamWhereSongBResolvesTo(null);
  deepStrictEqual(
    relinkSentForSongB(none, newSong('Song B (Live)', 'Artist')),
    { ...newSongBOperation(), title: 'Song B (Live)' },
    'another title, where the submitted one resolves to no song: not null either',
  );
  // Typed back to what it was submitted as, it is read again.
  deepStrictEqual(relinkSentForSongB(approved, newSong('Song B', 'Artist')), newSongBOperation('approved'), 'typed back');

  // A line with no artist resolves with the artists the stream has: any other artist is a song the view never resolved.
  const blank = aStreamWhereSongBResolvesTo(songS9('approved'));
  const line = need(blank.proposed[1], 'the line for Song B');
  line.originalArtist = '';
  line.existingSongsByLiveArtist = [{ originalArtist: 'Artist', existingSong: null }];
  deepStrictEqual(
    relinkSentForSongB(blank, newSong('Song B', 'Third')),
    { ...newSongBOperation(), originalArtist: 'Third' },
    'an artist the stream does not have',
  );

  // The apply resolves 改連到新的歌 after the renames of the same apply, which the view has not read: a draft that renames
  // a song sends none, or a song renamed into the title would be refused as stale. 改連到既有的歌 names its song.
  const renaming = (draft: CorrectionDraft) => withPair(draft, 0, { title: rename('Song AA', 'Artist') });
  deepStrictEqual(relinkSentForSongB(none, newSong('Song B', 'Artist'), renaming), newSongBOperation(), 'a draft that renames a song');
  deepStrictEqual(
    relinkSentForSongB(none, pickedS9('pending'), renaming),
    { op: 'relinkToSong', performanceId: 'p2', songId: 's9', expectedSongStatus: 'pending' },
    'the song picked keeps its status',
  );
}

function testAPendingIdentityOnAStreamThatIsNotApprovedSendsItsRealStatus(): void {
  // What the view read of an identity is read on any stream, and for any row: a relink there promotes nothing, yet the
  // apply resolves the same song, and refuses the review as stale once it has another status. null is for an identity
  // the view read as no song, never for one it did not promote.
  for (const status of NOT_APPROVED) {
    for (const [resolved, expected] of [[songS9('pending'), 'pending'], [songS9('approved'), 'approved'], [null, null]] as const) {
      const view = aStreamWhereSongBResolvesTo(resolved);
      view.stream.status = status;
      deepStrictEqual(relinkSentForSongB(view, newSong('Song B', 'Artist')), newSongBOperation(expected), `a ${status} stream, ${resolved?.status ?? 'no song'}`);
    }
  }
  // The same on an approved stream, for a row that is not approved: it stays off the site whatever its song.
  const offSite = aStreamWhereSongBResolvesTo(songS9('pending'));
  offSite.current = [need(offSite.current[0], 'Song A'), liveRow('p2', row('Song B', 'Artist', 300, 400), 'pending')];
  deepStrictEqual(relinkSentForSongB(offSite, newSong('Song B', 'Artist')), newSongBOperation('pending'), 'a row that is not approved');
}

// --- Adds and deletes ---

function testAddsAreTrimmedAndAnEmptyArtistIsUnknown(): void {
  const view = ichiiCorrectionView();
  const split = unpair(initialDraft(view), view, 0);
  const typed = { ...split, adds: edited(split.adds, 0, { title: ' Late Night Drive ', originalArtist: '  ', timestamp: 880, endTimestamp: null }) };
  deepStrictEqual(draftOperations(typed, view).operations.find((operation) => operation.op === 'addPerformance'), {
    op: 'addPerformance', title: 'Late Night Drive', originalArtist: 'Unknown', timestamp: 880, endTimestamp: null,
  });
  const unticked = draftOperations({ ...typed, adds: edited(typed.adds, 0, { apply: false }) }, view);
  strictEqual(unticked.operations.some((operation) => operation.op === 'addPerformance'), false);
  deepStrictEqual(unticked.skipped, { time: 0, title: 0, add: 1, delete: 2 });
}

// --- A line with no artist borrows the stream's (the third review's #4) ---

type LiveArtistSongs = NonNullable<CorrectionProposedRow['existingSongsByLiveArtist']>;

const LEMON_ROW = row('Lemon', 'Kenshi Yonezu', 100, 200);
const GURENGE_ROW = row('Gurenge', 'LiSA', 300, 400);
/** Lemon by Kenshi Yonezu: p1's song (`liveRow` names it s1). */
const LEMON: { id: string; status: Status } = { id: 's1', status: 'approved' };
/** The stream's Lemon, then Gurenge, and Lemon added after them with no artist. */
const LEMON_ADDED_WITH_NO_ARTIST = [LEMON_ROW, GURENGE_ROW, row('Lemon', '', 500, 600)];

/**
 * The stream has Lemon by Kenshi Yonezu (p1) and Gurenge by LiSA (p2); `proposed` is the submission. A line of it with
 * no artist is resolved as the route resolves one: its title by Unknown is no song here, and with each artist the stream
 * has, which `candidates` gives, one entry per artist (`existingSongsByLiveArtist`); with `undefined` the route sent none.
 */
function lemonStream(
  proposed: RowFields[],
  candidates: LiveArtistSongs | undefined,
  current: CorrectionCurrentRow[] = [liveRow('p1', LEMON_ROW), liveRow('p2', GURENGE_ROW)],
): NovaVodCorrectionView {
  const view = correctionView({ base: null, current, proposed });
  for (const line of view.proposed) {
    if (line.originalArtist === '' && candidates !== undefined) line.existingSongsByLiveArtist = candidates;
  }
  return view;
}

function testABlankArtistAddBorrowsTheOnlyLiveArtistWithASong(): void {
  // r3 #4. Sent with no artist, the add is Lemon by Unknown, and the apply makes that song beside the stream's Lemon: an
  // approved twin. Of the stream's artists only Kenshi Yonezu has a Lemon, so the add starts with that artist, as
  // 改連到新的歌 offers the paired row's: an add has no paired row to take one from.
  const candidates: LiveArtistSongs = [
    { originalArtist: 'Kenshi Yonezu', existingSong: LEMON },
    { originalArtist: 'LiSA', existingSong: null },
  ];
  const view = lemonStream(LEMON_ADDED_WITH_NO_ARTIST, candidates);
  deepStrictEqual(view.match.unpairedProposed, [2], 'the fixture: the Lemon with no artist pairs with nothing, so it is an add');
  const draft = initialDraft(view);
  deepStrictEqual(draft.adds, [{ proposedIndex: 2, apply: true, title: 'Lemon', originalArtist: 'Kenshi Yonezu', timestamp: 500, endTimestamp: 600 }]);
  const added: CorrectionOperation = { op: 'addPerformance', title: 'Lemon', originalArtist: 'Kenshi Yonezu', timestamp: 500, endTimestamp: 600 };
  deepStrictEqual(draftOperations(draft, view).operations, [added], "the operation lands on Kenshi Yonezu's Lemon, not on a new Lemon by Unknown");

  // A default, not a lock: with the artist cleared the add is sent as Unknown, like any add with no artist.
  const cleared = { ...draft, adds: edited(draft.adds, 0, { originalArtist: '' }) };
  deepStrictEqual(draftOperations(cleared, view).operations, [{ ...added, originalArtist: 'Unknown' }]);

  // A pair split by hand is an add of the same line, and starts the same way.
  const paired = lemonStream([row('Lemon', '', 100, 200), GURENGE_ROW], candidates);
  deepStrictEqual(initialDraft(paired).adds, [], 'the fixture: the line pairs with p1');
  deepStrictEqual(unpair(initialDraft(paired), paired, 0).adds.map((add) => add.originalArtist), ['Kenshi Yonezu']);
}

function testTwoCandidateArtistsLeaveTheArtistBlank(): void {
  // With two artists that have a Lemon there is no telling which was meant, and with none there is nothing to borrow:
  // the add stays as submitted, with no artist, and is sent as Unknown.
  const another: { id: string; status: Status } = { id: 's2', status: 'approved' };
  const cases: Array<[string, LiveArtistSongs | undefined]> = [
    ['two artists have a Lemon', [{ originalArtist: 'Kenshi Yonezu', existingSong: LEMON }, { originalArtist: 'LiSA', existingSong: another }]],
    ['no artist has one', [{ originalArtist: 'Kenshi Yonezu', existingSong: null }, { originalArtist: 'LiSA', existingSong: null }]],
    ['the route sent no artist', undefined],
  ];
  for (const [what, candidates] of cases) {
    const view = lemonStream(LEMON_ADDED_WITH_NO_ARTIST, candidates);
    const draft = initialDraft(view);
    deepStrictEqual(draft.adds, [{ proposedIndex: 2, apply: true, title: 'Lemon', originalArtist: '', timestamp: 500, endTimestamp: 600 }], `${what}: the artist stays blank`);
    deepStrictEqual(
      draftOperations(draft, view).operations,
      [{ op: 'addPerformance', title: 'Lemon', originalArtist: 'Unknown', timestamp: 500, endTimestamp: 600 }],
      `${what}: it is sent as Unknown`,
    );
  }
}

function testABorrowedArtistLandsOnTheSongItNames(): void {
  // The song an add lands on follows from the artist it is sent with, borrowed or typed: Lemon by Kenshi Yonezu is that
  // artist's entry (`existingSongsByLiveArtist`), as 改連到新的歌 reads one. The apply approves it with the add if it is
  // pending, so the draft must know it: the page's hint says so, and a row of the song with no end holds the apply. Here
  // p1 is such a row: Lemon by Kenshi Yonezu, approved, of a pending song, with no end, which the submission keeps.
  const pending: { id: string; status: Status } = { id: 's1', status: 'pending' };
  const p1 = row('Lemon', 'Kenshi Yonezu', 100, null);
  const view = lemonStream(
    [p1, GURENGE_ROW, row('Lemon', '', 500, 600)],
    [{ originalArtist: 'Kenshi Yonezu', existingSong: pending }, { originalArtist: 'LiSA', existingSong: null }],
    [liveRow('p1', p1, 'approved', 'pending'), liveRow('p2', GURENGE_ROW)],
  );
  const draft = initialDraft(view);
  const blank = need(view.proposed[2], 'the Lemon with no artist');
  deepStrictEqual(need(draft.adds[0], 'the add').originalArtist, 'Kenshi Yonezu', 'the fixture: the add borrows Kenshi Yonezu');
  deepStrictEqual(addLandingSong(view, blank, 'Lemon', 'Kenshi Yonezu'), pending, 'it lands on his Lemon');
  deepStrictEqual(addLandingSong(view, blank, ' Lemon ', ' Kenshi Yonezu '), pending, 'as the apply reads the title and the artist, trimmed');
  deepStrictEqual(
    [addLandingSong(view, blank, 'Lemon', 'LiSA'), addLandingSong(view, blank, 'Lemon', ''), addLandingSong(view, blank, 'Lemon (Live)', 'Kenshi Yonezu')],
    [null, null, null],
    "another artist's Lemon (LiSA has none), the title by Unknown (none) and another title name no song the draft knows",
  );

  const held = draftOperations(draft, view);
  deepStrictEqual([held.needsEndCount, held.canApply], [1, false], 'the apply approves his Lemon, which puts p1 on the site with no end: it waits');
  deepStrictEqual(draftFlags(draft, view).pairs[0], { ...NO_FLAGS, needsEnd: true }, 'and p1 is marked');
  const typedOver = draftOperations({ ...draft, adds: edited(draft.adds, 0, { originalArtist: 'LiSA' }) }, view);
  deepStrictEqual([typedOver.needsEndCount, typedOver.canApply], [0, true], "typed over with LiSA's, the add lands on no song of p1's: nothing waits");
}

// --- Every operation the apply API takes ---

function testEverySuggestionBecomesItsOwnVariant(): void {
  // All six variants in one draft: the list is the whole of what the parser would see, key for key,
  // and each pair gives its time edit before its title edit, then the adds, then the deletes.
  const view = ichiiCorrectionView();
  const toExisting: TitleChoice = { kind: 'relinkExisting', songId: 's9', songLabel: 'Moon Song', songStatus: 'approved' };
  const toNew: TitleChoice = { kind: 'relinkNew', title: 'Moon Halo (Live)', originalArtist: '' };
  const renamed = withPair(initialDraft(view), 0, { title: rename('Late Niqht Drive', 'Unknown') });
  const titled = withPair(withPair(renamed, 1, { title: toExisting }), 2, { title: toNew });
  const split = unpair(titled, view, 5); // pair 6/5: the add of Moon River and the delete of its current row
  const draft = { ...split, deletes: edited(split.deletes, 0, { apply: true }) };
  const result = draftOperations(draft, view);
  deepStrictEqual(result.operations, [
    { op: 'setTimes', performanceId: 'p1', timestamp: 881, endTimestamp: 1024 },
    { op: 'renameSong', songId: 's1', title: 'Late Niqht Drive' },
    { op: 'setTimes', performanceId: 'p2', endTimestamp: 1617 },
    { op: 'relinkToSong', performanceId: 'p2', songId: 's9', expectedSongStatus: 'approved' },
    { op: 'setTimes', performanceId: 'p4', timestamp: 2247, endTimestamp: 2445 },
    { op: 'relinkToNewSong', performanceId: 'p4', title: 'Moon Halo (Live)', originalArtist: 'Unknown' },
    { op: 'setTimes', performanceId: 'p5', endTimestamp: 2945 },
    { op: 'setTimes', performanceId: 'p6', timestamp: 3512, endTimestamp: 3658 },
    { op: 'addPerformance', title: 'Moon River', originalArtist: 'Unknown', timestamp: 5368, endTimestamp: 5472 },
    { op: 'deletePerformance', performanceId: 'p3' },
  ]);
  deepStrictEqual(result.skipped, { time: 0, title: 0, add: 0, delete: 1 });
  strictEqual(result.appliedCount, 10);
  strictEqual(result.skippedCount, 1);
}

// --- Re-pairing ---

function testRePairingKeepsTheListsSorted(): void {
  const view = ichiiCorrectionView();
  const once = unpair(initialDraft(view), view, 2); // pair 3/2 splits
  const twice = unpair(once, view, 0); // and pair 0/0
  deepStrictEqual(twice.pairs.map((pair) => pair.currentIndex), [1, 4, 5, 6]);
  deepStrictEqual(twice.adds.map((add) => add.proposedIndex), [0, 2]);
  deepStrictEqual(twice.deletes.map((entry) => entry.currentIndex), [0, 2, 3]);

  // The first add (proposed 0) with the last delete (current 3): the arguments are positions in the draft's lists.
  const crossed = pairWith(twice, view, 0, 2);
  deepStrictEqual(crossed.pairs.map((pair) => pair.currentIndex), [1, 3, 4, 5, 6]);
  deepStrictEqual(need(crossed.pairs[1], 'the new pair'), {
    currentIndex: 3,
    proposedIndex: 0,
    applyTimes: true,
    timestamp: 881,
    endTimestamp: 1024,
    title: { kind: 'ignore' },
  });
  deepStrictEqual(crossed.adds.map((add) => add.proposedIndex), [2]);
  deepStrictEqual(crossed.deletes.map((entry) => entry.currentIndex), [0, 2]);

  // The new pair is read like any other: its times move p4 to where Late Niqht Drive was, and its titles differ.
  const result = draftOperations(crossed, view);
  deepStrictEqual(result.operations.find((operation) => operation.op === 'setTimes' && operation.performanceId === 'p4'), {
    op: 'setTimes', performanceId: 'p4', timestamp: 881, endTimestamp: 1024,
  });
  deepStrictEqual(result.skipped, { time: 0, title: 1, add: 0, delete: 2 });
}

function testRePairingResetsToTheProposedRow(): void {
  const view = ichiiCorrectionView();
  const draft = initialDraft(view);
  const edits = withPair(draft, 0, { applyTimes: false, timestamp: 900, endTimestamp: null, title: rename('Late Night Drive!', 'Someone') });
  const split = unpair(edits, view, 0);
  deepStrictEqual(split.adds, [{ proposedIndex: 0, apply: true, title: 'Late Niqht Drive', originalArtist: 'Unknown', timestamp: 881, endTimestamp: 1024 }]);
  deepStrictEqual(pairWith(split, view, 0, 0), draft, 'the edits do not outlive the pairing');
}

function testRePairingRecomputesTheTimeDefault(): void {
  // Proposed 1 and current 1 agree on their times, so a pair made of them starts unticked.
  const view = viewAfter((v) => {
    v.proposed[1] = { ...need(v.proposed[1], 'proposed 1'), endTimestamp: 1621 };
  });
  const draft = initialDraft(view);
  strictEqual(need(draft.pairs[1], 'pair 1').applyTimes, false);
  const back = pairWith(unpair(draft, view, 1), view, 0, 0);
  deepStrictEqual(back, draft);
  strictEqual(need(back.pairs[1], 'pair 1').applyTimes, false);
}

// --- Three ways: the list the contributor compared against (the base), the stream now, and the submission ---

const NONE = { start: false, end: false, title: false, artist: false };
const NO_FLAGS: RowFlags = { untouched: false, changedSince: false, notSeen: false, needsEnd: false, repeats: false };

/** Song A and Song B of a stream, as two contributors X and Y loaded it. */
const SONG_A = row('Song A', 'Artist', 100, 200);
const SONG_B = row('Song B', 'Artist', 300, 400);
const LOADED = [baseRow('p1', SONG_A), baseRow('p2', SONG_B)];

function testAFixAppliedSinceIsNotTickedBack(): void {
  // Finding #2. The curator applied X's fix, Song A at 130, after Y loaded the list. Y's submission moves only Song B,
  // to 310, and keeps Song A as Y loaded it: that row repeats the base, so it suggests nothing, whatever the stream
  // says now. The defaults keep X's fix.
  const view = correctionView({
    base: LOADED,
    current: [liveRow('p1', row('Song A', 'Artist', 130, 200)), liveRow('p2', SONG_B)],
    proposed: [SONG_A, row('Song B', 'Artist', 310, 400)],
  });
  const draft = initialDraft(view);
  const result = draftOperations(draft, view);
  deepStrictEqual(result.operations, [{ op: 'setTimes', performanceId: 'p2', timestamp: 310 }], "Y's own change, and nothing that undoes X's");
  deepStrictEqual(result.skipped, NOTHING_SKIPPED, 'nothing was suggested for Song A, so nothing is skipped');
  deepStrictEqual(need(draft.pairs[0], 'the Song A pair'), {
    currentIndex: 0, proposedIndex: 0, applyTimes: false, timestamp: 130, endTimestamp: 200, title: { kind: 'ignore' },
  }, 'unticked, at the times the stream has now');
  deepStrictEqual(suggestedChanges(view, 0, 0), NONE, 'no chip');
  deepStrictEqual(draftFlags(draft, view).pairs, [{ ...NO_FLAGS, untouched: true, changedSince: true }, NO_FLAGS]);
  strictEqual(draftOperations(withPair(draft, 0, { applyTimes: true }), view).appliedCount, 1, 'ticked anyway, it sends nothing');
}

function testAFixThatMovedTheRowFarIsNotTickedBack(): void {
  // Finding #2, the large move: X's fix took Song A to 1000–1100, where Y's Song A overlaps nothing. It is still the
  // performance Y saw, paired by its id: no add of a second Song A, no delete, no revert.
  const view = correctionView({
    base: LOADED,
    current: [liveRow('p2', SONG_B), liveRow('p1', row('Song A', 'Artist', 1000, 1100))],
    proposed: [SONG_A, row('Song B', 'Artist', 310, 400)],
  });
  const draft = initialDraft(view);
  deepStrictEqual([draft.adds, draft.deletes], [[], []]);
  deepStrictEqual(draftOperations(draft, view).operations, [{ op: 'setTimes', performanceId: 'p2', timestamp: 310 }]);
  deepStrictEqual(need(draft.pairs[1], 'the Song A pair'), {
    currentIndex: 1, proposedIndex: 0, applyTimes: false, timestamp: 1000, endTimestamp: 1100, title: { kind: 'ignore' },
  });
  deepStrictEqual(draftFlags(draft, view).pairs[1], { ...NO_FLAGS, untouched: true, changedSince: true });
}

function testAHiddenRowIsNeverASuggestedDelete(): void {
  // Finding #5. Song B was stamped after Song A, and its row is still pending: Nova shows public rows only, so the
  // contributor who fixed Song A never saw Song B. Not suggested, so not skipped, though the curator may delete it.
  const hidden = liveRow('pB', row('Song B', 'Artist', 302, 398), 'pending');
  const view = correctionView({ base: [baseRow('pA', SONG_A)], current: [liveRow('pA', SONG_A), hidden], proposed: [row('Song A', 'Artist', 105, 200)] });
  const draft = initialDraft(view);
  deepStrictEqual(draft.deletes, [{ currentIndex: 1, apply: false }]);
  const result = draftOperations(draft, view);
  deepStrictEqual(result.skipped, NOTHING_SKIPPED);
  strictEqual(summarizeCorrection(result.operations, result.skipped), '套用 1 項（時間 1）', 'the note counts no skipped delete');
  deepStrictEqual(draftFlags(draft, view).deletes, [{ ...NO_FLAGS, notSeen: true }]);
  const ticked = draftOperations({ ...draft, deletes: edited(draft.deletes, 0, { apply: true }) }, view);
  deepStrictEqual(ticked.operations.at(-1), { op: 'deletePerformance', performanceId: 'pB' }, 'still deletable');
  deepStrictEqual(ticked.skipped, NOTHING_SKIPPED);

  // A correction with no base (stored before Nova kept one) can only tell that the row is not on the site, which the
  // contributor could not have seen either.
  const unbased = { ...view, base: null, match: matchCorrection(view.current, view.proposed) };
  const plain = initialDraft(unbased);
  deepStrictEqual(draftOperations(plain, unbased).skipped, NOTHING_SKIPPED, 'off the site: not a suggested delete');
  deepStrictEqual(draftFlags(plain, unbased).deletes, [NO_FLAGS], 'nothing is "not seen" with no base');
  deepStrictEqual(draftOperations({ ...plain, deletes: edited(plain.deletes, 0, { apply: true }) }, unbased).operations.at(-1), {
    op: 'deletePerformance', performanceId: 'pB',
  });
}

function testAnOutOfOrderLineLeavesAlphasEndAlone(): void {
  // Finding #7. The stream has Alpha 0:10:00~0:14:00, Beta 0:20 and Gamma 0:30. The contributor pasted their starts
  // and appended Delta at 0:15:00 as the last line: the parsers ended each line where the next line starts, so Alpha
  // ends at Beta's start (1200) and Gamma at Delta's (900). By time, the row after Alpha is Delta; the next submitted
  // row is Beta, so Alpha's end is the parsers' and proposes none.
  const view = correctionView({
    base: null,
    current: [
      liveRow('p1', row('Alpha', 'A', 600, 840)), liveRow('p2', row('Beta', 'B', 1200, 1500)), liveRow('p3', row('Gamma', 'C', 1800, 2100)),
    ],
    proposed: [row('Alpha', 'A', 600, 1200), row('Beta', 'B', 1200, 1800), row('Gamma', 'C', 1800, 900), row('Delta', 'D', 900, null)],
  });
  deepStrictEqual(view.proposed.map((proposed) => proposed.title), ['Alpha', 'Delta', 'Beta', 'Gamma'], 'the fixture: by time, Delta follows Alpha');
  const draft = initialDraft(view);
  const alpha = need(draft.pairs.find((pair) => pair.currentIndex === 0), 'the Alpha pair');
  deepStrictEqual([alpha.applyTimes, alpha.endTimestamp], [false, 840], "Alpha's end stays the stream's, unticked");
  deepStrictEqual(suggestedChanges(view, 0, alpha.proposedIndex), NONE);
  const operations = draftOperations(draft, view).operations;
  strictEqual(operations.some((operation) => operation.op === 'setTimes' && operation.performanceId === 'p1'), false, 'no end change on Alpha');
}

function testATickedRowWithNoEndHoldsTheApply(): void {
  // Finding #1, the draft's half: the apply refuses an add with no end on an approved stream (the ichii stream is one)
  // and a time change that clears one on any stream, so a ticked row of either kind holds 套用 until it has an end.
  const view = viewAfter((v) => {
    v.proposed.push(MOON_DANCE);
  });
  const draft = initialDraft(view);
  const result = draftOperations(draft, view);
  deepStrictEqual([result.appliedCount, result.needsEndCount, result.canApply], [7, 1, false], 'the add of Moon Dance has no end');
  deepStrictEqual(draftFlags(draft, view).adds, [{ ...NO_FLAGS, needsEnd: true }]);
  const ended = { ...draft, adds: edited(draft.adds, 0, { endTimestamp: 6240 }) };
  deepStrictEqual([draftOperations(ended, view).needsEndCount, draftOperations(ended, view).canApply], [0, true], 'given one, it may go');
  const unticked = { ...draft, adds: edited(draft.adds, 0, { apply: false }) };
  strictEqual(draftOperations(unticked, view).canApply, true, 'unticked, it is no hold');

  // Pair 1 (p2, 私奔到月球) is ticked: clearing its end holds the apply, and an unticked clear does not.
  const cleared = withPair(unticked, 1, { endTimestamp: null });
  deepStrictEqual([draftOperations(cleared, view).needsEndCount, draftOperations(cleared, view).canApply], [1, false]);
  deepStrictEqual(draftFlags(cleared, view).pairs[1], { ...NO_FLAGS, needsEnd: true });
  strictEqual(draftOperations(withPair(cleared, 1, { applyTimes: false }), view).canApply, true);

  // A row with no end may keep none (a pipeline row before it is stamped).
  const open = viewAfter((v) => {
    v.current[1] = { ...need(v.current[1], 'current 1'), endTimestamp: null };
  });
  const keptOpen = withPair(initialDraft(open), 1, { endTimestamp: null, applyTimes: true });
  deepStrictEqual(draftFlags(keptOpen, open).pairs[1], NO_FLAGS);
  // Nothing to apply is no apply either.
  const none = { ...unticked, pairs: unticked.pairs.map((pair) => ({ ...pair, applyTimes: false })) };
  deepStrictEqual([draftOperations(none, view).appliedCount, draftOperations(none, view).canApply], [0, false]);
}

// Every status a stream can have but approved: an add there is created pending, like an imported row.
const NOT_APPROVED = ['pending', 'rejected', 'excluded', 'extracted'] as const;

/** A stream with no row and a submission that adds one song with no end (the last line of a paste): the only operation. */
function aStreamWithOnlyAnEndlessAdd(status: NovaVodCorrectionView['stream']['status']): NovaVodCorrectionView {
  const view = correctionView({ base: [], current: [], proposed: [row('Moon Dance', 'Unknown', 6000, null)] });
  view.stream.status = status;
  return view;
}

function testAnAddWithNoEndNeedsOneOnlyOnAnApprovedStream(): void {
  // Finding #1, as hydai narrowed it (3B). On an approved stream an add is born approved, and a row with no end stops
  // the export, so the apply refuses it: it holds 套用. On any other stream the add is created pending, like an
  // imported row, and stamped later, so it needs no end. Either way it is sent as it is, with no end.
  const add = { op: 'addPerformance', title: 'Moon Dance', originalArtist: 'Unknown', timestamp: 6000, endTimestamp: null };
  const approved = aStreamWithOnlyAnEndlessAdd('approved');
  const held = draftOperations(initialDraft(approved), approved);
  deepStrictEqual(held.operations, [add]);
  deepStrictEqual([held.needsEndCount, held.canApply], [1, false], 'approved: the add needs an end');
  deepStrictEqual(draftFlags(initialDraft(approved), approved).adds, [{ ...NO_FLAGS, needsEnd: true }]);

  for (const status of NOT_APPROVED) {
    const view = aStreamWithOnlyAnEndlessAdd(status);
    const draft = initialDraft(view);
    deepStrictEqual(draft.adds.map((entry) => [entry.apply, entry.endTimestamp]), [[true, null]], `${status}: ticked, with no end`);
    const result = draftOperations(draft, view);
    deepStrictEqual(result.operations, [add], `${status}: sent with no end`);
    deepStrictEqual([result.needsEndCount, result.canApply], [0, true], `${status}: nothing waits for an end, and the add is the only operation`);
    deepStrictEqual(draftFlags(draft, view).adds, [NO_FLAGS], `${status}: no mark`);
  }
}

function testAClearedEndNeedsOneOnEveryStream(): void {
  // The other half is the row's, not the stream's: a ticked time change that takes the end off a row that has one is
  // refused by the apply wherever the row is, so it holds 套用 on a stream that is not approved too.
  for (const status of ['approved', ...NOT_APPROVED] as const) {
    const view = viewAfter((v) => {
      v.stream.status = status;
    });
    // Pair 1 (p2, 私奔到月球) is ticked.
    const cleared = withPair(initialDraft(view), 1, { endTimestamp: null });
    const result = draftOperations(cleared, view);
    deepStrictEqual([result.needsEndCount, result.canApply], [1, false], `${status}: a cleared end holds the apply`);
    deepStrictEqual(draftFlags(cleared, view).pairs[1], { ...NO_FLAGS, needsEnd: true }, `${status}: and marks the row`);
  }
}

/**
 * A stream whose one row is Song B with no end, a performance of status `status` whose song has `songStatus`, and a
 * submission that retitles it (Song B!) and gives no end either: its pair opens with nothing ticked.
 */
function anEndlessRow(status: Status = 'approved', songStatus: Status = 'pending'): NovaVodCorrectionView {
  return correctionView({
    base: null,
    current: [liveRow('p1', row('Song B', 'Artist', 300, null), status, songStatus)],
    proposed: [row('Song B!', 'Artist', 300, null)],
  });
}
const RELINK_EXISTING: TitleChoice = { kind: 'relinkExisting', songId: 's9', songLabel: 'Song B! · Artist', songStatus: 'approved' };
const RELINK_NEW: TitleChoice = { kind: 'relinkNew', title: 'Song B!', originalArtist: 'Artist' };

function testARelinkThatPublishesARowNeedsItsEnd(): void {
  // Codex P1 on PR #236, the draft's half. On an approved stream a relink of an approved row the site does not show
  // publishes it (`relinkPublishes`): the song it gets is approved, or approved along with the apply. A row with no end
  // there stops the export, so the apply refuses the relink, and the pair holds 套用 until the row has an end.
  const view = anEndlessRow();
  const current = need(view.current[0], 'Song B');
  const draft = initialDraft(view);
  deepStrictEqual(draft.pairs, [{ currentIndex: 0, proposedIndex: 0, applyTimes: false, timestamp: 300, endTimestamp: null, title: { kind: 'ignore' } }],
    'the fixture: nothing is ticked');
  for (const choice of [RELINK_EXISTING, RELINK_NEW]) {
    strictEqual(relinkPublishes(view, current, choice), true, `${choice.kind} publishes the row`);
    const relinked = withPair(draft, 0, { title: choice });
    const held = draftOperations(relinked, view);
    deepStrictEqual([held.appliedCount, held.needsEndCount, held.canApply], [1, 1, false], `${choice.kind}: the relink holds the apply`);
    deepStrictEqual(draftFlags(relinked, view).pairs, [{ ...NO_FLAGS, needsEnd: true }], `${choice.kind}: and marks the row`);
    strictEqual(draftOperations(withPair(relinked, 0, { applyTimes: true }), view).needsEndCount, 1, `${choice.kind}: ticked times with no end give none`);

    // A ticked end lets it go. Left unticked, that end is not sent, and the row keeps the end it has: none.
    const ended = withPair(relinked, 0, { applyTimes: true, endTimestamp: 420 });
    const released = draftOperations(ended, view);
    deepStrictEqual([released.needsEndCount, released.canApply], [0, true], `${choice.kind}: a ticked end releases it`);
    deepStrictEqual(released.operations[0], { op: 'setTimes', performanceId: 'p1', endTimestamp: 420 }, `${choice.kind}: and is sent`);
    deepStrictEqual(draftFlags(ended, view).pairs, [NO_FLAGS], `${choice.kind}: unmarked`);
    const unticked = withPair(ended, 0, { applyTimes: false });
    deepStrictEqual([draftOperations(unticked, view).needsEndCount, draftFlags(unticked, view).pairs], [1, [{ ...NO_FLAGS, needsEnd: true }]],
      `${choice.kind}: an unticked end does not count`);
  }
}

function testOnlyARelinkThatPublishesNeedsAnEnd(): void {
  // A choice that keeps the song (ignore, rename) keeps its status, so the row stays off the site. A row on the site is
  // in the export already, and a relink keeps it there. A row that is not approved stays out whatever its song. On a
  // stream that is not approved nothing is promoted and the export leaves the stream out. None of them needs an end.
  const keeps = anEndlessRow();
  const current = need(keeps.current[0], 'Song B');
  for (const choice of [{ kind: 'ignore' }, rename('Song B!', 'Artist')] satisfies TitleChoice[]) {
    strictEqual(relinkPublishes(keeps, current, choice), false, choice.kind);
    const draft = withPair(initialDraft(keeps), 0, { title: choice });
    deepStrictEqual([draftOperations(draft, keeps).needsEndCount, draftFlags(draft, keeps).pairs], [0, [NO_FLAGS]], `${choice.kind} needs no end`);
  }
  const offStream = (status: (typeof NOT_APPROVED)[number]) => {
    const view = anEndlessRow();
    view.stream.status = status;
    return view;
  };
  const cases: Array<[string, NovaVodCorrectionView]> = [
    ['a row on the site', anEndlessRow('approved', 'approved')],
    ['a pending row', anEndlessRow('pending', 'pending')],
    ['a pending row of an approved song', anEndlessRow('pending', 'approved')],
    ...NOT_APPROVED.map((status): [string, NovaVodCorrectionView] => [`a stream that is ${status}`, offStream(status)]),
  ];
  for (const [what, view] of cases) {
    for (const choice of [RELINK_EXISTING, RELINK_NEW]) {
      strictEqual(relinkPublishes(view, need(view.current[0], 'Song B'), choice), false, `${what}: ${choice.kind}`);
      const draft = withPair(initialDraft(view), 0, { title: choice });
      const result = draftOperations(draft, view);
      deepStrictEqual([result.needsEndCount, result.canApply], [0, true], `${what}: ${choice.kind} needs no end`);
      strictEqual(draftFlags(draft, view).pairs[0]?.needsEnd, false, `${what}: ${choice.kind} is not marked`);
    }
  }
}

function testANullEndBeforeAMovedRowNeedsAnEnd(): void {
  // A row sent with no end (an Aurora row left unstamped) is derived, so it normally keeps the stream's end. Its next
  // submitted row, Second, moved to 180, before First's end at 200: put back, that end would overlap Second, so the
  // yield proposes the submitted end, none. The apply refuses to clear an end, so the draft opens held until one is
  // typed. Which row is next is the submission's order (`nextSubmittedId`); a NULL end names no next start.
  const live = [liveRow('p1', row('First', 'A', 100, 200)), liveRow('p2', row('Second', 'B', 300, 400))];
  const moved = correctionView({ base: null, current: live, proposed: [row('First', 'A', 100, null), row('Second', 'B', 180, 380)] });
  const draft = initialDraft(moved);
  deepStrictEqual(need(draft.pairs[0], 'the First pair'), {
    currentIndex: 0, proposedIndex: 0, applyTimes: true, timestamp: 100, endTimestamp: null, title: { kind: 'ignore' },
  }, "First's end would overlap the moved Second: the submitted one, none, is proposed");
  deepStrictEqual(draftFlags(draft, moved).pairs[0], { ...NO_FLAGS, needsEnd: true });
  deepStrictEqual([draftOperations(draft, moved).needsEndCount, draftOperations(draft, moved).canApply], [1, false], 'held until an end is typed');
  strictEqual(draftOperations(withPair(draft, 0, { endTimestamp: 180 }), moved).canApply, true);

  // Submitted after First: Second as it is, then a new row appended last that starts, by time, right after First.
  // First's next submitted row still matches the stream, so its end stays the stream's.
  const appended = correctionView({
    base: null,
    current: live,
    proposed: [row('First', 'A', 100, null), row('Second', 'B', 300, 400), row('Extra', 'E', 150, 250)],
  });
  deepStrictEqual(appended.proposed.map((proposed) => proposed.title), ['First', 'Extra', 'Second'], 'the fixture: by time, Extra follows First');
  const kept = need(initialDraft(appended).pairs.find((pair) => pair.currentIndex === 0), 'the First pair');
  deepStrictEqual([kept.applyTimes, kept.endTimestamp], [false, 200]);
  deepStrictEqual(suggestedChanges(appended, 0, kept.proposedIndex), NONE);
}

// --- The songs an apply approves along with it (the 2026-11-16 review's #7, #12 and #13) ---

/** Q, a pending song of the streamer: p9's song (`liveRow` names it s9), and what Song Q / Artist resolves to. */
const SONG_Q: { id: string; status: Status } = { id: 's9', status: 'pending' };
/** 改連到既有的歌 with Q picked. */
const PICK_Q: TitleChoice = { kind: 'relinkExisting', songId: 's9', songLabel: 'Song Q · Artist', songStatus: 'pending' };
/** 改連到新的歌 as Song Q / Artist, which resolves to Q. */
const NEW_Q: TitleChoice = { kind: 'relinkNew', title: 'Song Q', originalArtist: 'Artist' };
const ADD_Q: CorrectionOperation = { op: 'addPerformance', title: 'Song Q', originalArtist: 'Artist', timestamp: 700, endTimestamp: 800 };

/** p9: an approved row of pending Q at 900 with no end, so off the site, and on the stream the review lists. */
const endlessP9 = (): CorrectionCurrentRow => liveRow('p9', row('Song Q', 'Artist', 900, null), 'approved', 'pending');

/** `view` with each submitted Song Q / Artist row resolving to Q, as the route resolves a row's title and artist. */
function resolvingToQ(view: NovaVodCorrectionView): NovaVodCorrectionView {
  for (const proposed of view.proposed) {
    if (proposed.title === 'Song Q' && proposed.originalArtist === 'Artist') proposed.existingSong = { ...SONG_Q };
  }
  return view;
}

/**
 * The ichii stream (approved) with Song A, on the site, and p9 (or the row of Q given in its place). The submission
 * keeps Song A, adds another performance of Q at 700–800, and moves p9's start to 905 on its last line, with no end: p9
 * pairs with that line (the same title, the nearer start), its start ticked and no end proposed, and the add of Q is
 * ticked.
 */
function anEndlessRowOfAPendingSong(p9 = endlessP9()): NovaVodCorrectionView {
  return resolvingToQ(correctionView({
    base: null,
    current: [liveRow('p1', SONG_A), p9],
    proposed: [SONG_A, row('Song Q', 'Artist', 700, 800), row('Song Q', 'Artist', 905, null)],
  }));
}

/**
 * #12 as it was found: the submission's one Song Q line is the add. Paired by title, it is a time change of p9 that
 * gives p9 an end and lands on no song; split (拆開配對), it is an add again, and p9 an unticked delete.
 */
function theAddIsTheOnlyLineOfQ(): NovaVodCorrectionView {
  return resolvingToQ(correctionView({
    base: null,
    current: [liveRow('p1', SONG_A), endlessP9()],
    proposed: [SONG_A, row('Song Q', 'Artist', 700, 800)],
  }));
}

function testAnAddOntoAPendingSongWithAnEndlessRowHereHoldsTheApply(): void {
  // #12. On an approved stream the apply approves the pending song an add lands on, which puts each approved row of
  // that song in the VOD export, where a row with no end stops it: the worker refuses (409 would_publish_endless). p9 is
  // such a row, on this stream, so the review can see it: the draft holds 套用 and marks p9.
  const view = anEndlessRowOfAPendingSong();
  const draft = initialDraft(view);
  deepStrictEqual(
    [draft.pairs.map((pair) => [pair.currentIndex, pair.proposedIndex, pair.applyTimes, pair.endTimestamp]), draft.adds.map((add) => [add.proposedIndex, add.apply])],
    [[[0, 0, false, 200], [1, 2, true, null]], [[1, true]]],
    'the fixture: p9 pairs with the line moved to 905, its start ticked and no end proposed; the add of Q is ticked',
  );
  const held = draftOperations(draft, view);
  deepStrictEqual(held.operations, [{ op: 'setTimes', performanceId: 'p9', timestamp: 905 }, ADD_Q]);
  deepStrictEqual([held.needsEndCount, held.canApply], [1, false], 'p9 holds the apply');
  deepStrictEqual(draftFlags(draft, view), { pairs: [NO_FLAGS, { ...NO_FLAGS, needsEnd: true }], adds: [NO_FLAGS], deletes: [] }, 'and p9 alone is marked');
  // The add as the curator edited it is what lands: retyped as another title, or another artist, it names a song only
  // the apply resolves, which is not Q, so nothing waits for p9's end.
  for (const [what, change] of [['its title retyped', { title: 'Song R' }], ['its artist retyped', { originalArtist: 'Someone' }]] as const) {
    const retyped = draftOperations({ ...draft, adds: edited(draft.adds, 0, change) }, view);
    deepStrictEqual([retyped.needsEndCount, retyped.canApply], [0, true], `${what}: no hold`);
  }
  // Only an approved row is in the export, and only one with no end stops it: p9 pending, or with an end, holds nothing,
  // its times unticked so that nothing the draft sends spares it.
  for (const [what, p9] of [
    ['a pending p9', liveRow('p9', row('Song Q', 'Artist', 900, null), 'pending', 'pending')],
    ['p9 with an end', liveRow('p9', row('Song Q', 'Artist', 900, 1000), 'approved', 'pending')],
  ] as const) {
    const other = anEndlessRowOfAPendingSong(p9);
    const otherDraft = withPair(initialDraft(other), 1, { applyTimes: false });
    deepStrictEqual([draftOperations(otherDraft, other).needsEndCount, draftOperations(otherDraft, other).canApply], [0, true], `${what} holds nothing`);
  }

  // #12 as it was found, split by hand: p9 an unticked delete beside the add, and the same hold.
  const own = theAddIsTheOnlyLineOfQ();
  const paired = initialDraft(own);
  deepStrictEqual(
    [paired.adds.length, draftOperations(paired, own).needsEndCount, draftOperations(paired, own).canApply],
    [0, 0, true],
    'paired by title, the add is a time change that gives p9 an end, and lands on no song',
  );
  const split = unpair(paired, own, 1);
  deepStrictEqual(
    [split.adds.map((add) => add.apply), split.deletes.map((entry) => [entry.currentIndex, entry.apply])],
    [[true], [[1, false]]],
    'split: the add ticked, p9 an unticked delete',
  );
  const splitResult = draftOperations(split, own);
  deepStrictEqual([splitResult.operations, splitResult.needsEndCount, splitResult.canApply], [[ADD_Q], 1, false], 'the delete left unticked holds the apply');
  deepStrictEqual(draftFlags(split, own).deletes, [{ ...NO_FLAGS, needsEnd: true }], 'and is marked');

  // A relink onto Q promotes it too: Song A's row relinked to Q, with the add unticked.
  const relinked = withPair({ ...draft, adds: edited(draft.adds, 0, { apply: false }) }, 0, { title: PICK_Q });
  deepStrictEqual([draftOperations(relinked, view).needsEndCount, draftOperations(relinked, view).canApply], [1, false], 'a relink onto Q holds the apply');
  deepStrictEqual(draftFlags(relinked, view).pairs, [NO_FLAGS, { ...NO_FLAGS, needsEnd: true }], 'and marks p9, not the row on the site it relinks');

  // On a stream that is not approved nothing is promoted, so nothing waits for p9's end, whether an add or a relink lands
  // on Q.
  for (const status of NOT_APPROVED) {
    const off = anEndlessRowOfAPendingSong();
    off.stream.status = status;
    const offDraft = initialDraft(off);
    const offRelinked = withPair({ ...offDraft, adds: edited(offDraft.adds, 0, { apply: false }) }, 0, { title: PICK_Q });
    for (const [what, entry] of [['the add', offDraft], ['the relink', offRelinked]] as const) {
      deepStrictEqual([draftOperations(entry, off).needsEndCount, draftOperations(entry, off).canApply], [0, true], `${status}, ${what}: no hold`);
      deepStrictEqual(draftFlags(entry, off).pairs, [NO_FLAGS, NO_FLAGS], `${status}, ${what}: no mark`);
    }
  }
}

function testSparingThatRowReleasesTheHold(): void {
  // The rows the worker spares (findEndlessPerformances): one the apply deletes, relinks to another song, or gives an
  // end. Each releases p9, and the add of Q still goes.
  const view = anEndlessRowOfAPendingSong();
  const draft = initialDraft(view);

  // Given an end by its ticked time change, p9 goes on the site with it.
  const ended = withPair(draft, 1, { endTimestamp: 1100 });
  const released = draftOperations(ended, view);
  deepStrictEqual(released.operations, [{ op: 'setTimes', performanceId: 'p9', timestamp: 905, endTimestamp: 1100 }, ADD_Q]);
  deepStrictEqual([released.needsEndCount, released.canApply], [0, true], 'an end releases it');
  deepStrictEqual(draftFlags(ended, view).pairs, [NO_FLAGS, NO_FLAGS], 'and p9 is no longer marked');
  // Neither the new start alone (the draft as it opens) nor an end left unticked, which is not sent, gives it one.
  deepStrictEqual(
    [draftOperations(draft, view).needsEndCount, draftOperations(withPair(ended, 1, { applyTimes: false }), view).needsEndCount],
    [1, 1],
    'a time change with no end spares nothing',
  );

  // Deleted: #12 as it was found, split, with p9's delete ticked.
  const own = theAddIsTheOnlyLineOfQ();
  const split = unpair(initialDraft(own), own, 1);
  const deleted = { ...split, deletes: edited(split.deletes, 0, { apply: true }) };
  const gone = draftOperations(deleted, own);
  deepStrictEqual(gone.operations, [ADD_Q, { op: 'deletePerformance', performanceId: 'p9' }]);
  deepStrictEqual([gone.needsEndCount, gone.canApply], [0, true], 'a delete releases it');
  deepStrictEqual(draftFlags(deleted, own).deletes, [NO_FLAGS], 'and p9 is no longer marked');

  // Relinked to another song, p9 leaves Q, but the relink puts it on the site (`relinkPublishes`), so it needs an end of
  // its own; relinked to Q itself (改連到新的歌 as offered), it stays Q's. Either way it is one row that needs an end,
  // counted once, until it has one.
  const toA: TitleChoice = { kind: 'relinkExisting', songId: 's1', songLabel: 'Song A · Artist', songStatus: 'approved' };
  for (const choice of [toA, NEW_Q]) {
    const relinked = withPair(draft, 1, { title: choice });
    deepStrictEqual(
      [draftOperations(relinked, view).needsEndCount, draftFlags(relinked, view).pairs[1]],
      [1, { ...NO_FLAGS, needsEnd: true }],
      `${choice.kind}: one row needs an end`,
    );
    strictEqual(draftOperations(withPair(relinked, 1, { endTimestamp: 1100 }), view).canApply, true, `${choice.kind}: given one, it goes`);
  }

  // With the add unticked nothing lands on Q: nothing is promoted, and nothing is held.
  const unticked = { ...draft, adds: edited(draft.adds, 0, { apply: false }) };
  deepStrictEqual([draftOperations(unticked, view).needsEndCount, draftOperations(unticked, view).canApply], [0, true], 'nothing lands on Q');
}

/**
 * `anEndlessRowOfAPendingSong` with Song B at 300–400 as well: a performance of status `status` whose song is pending,
 * so off the site. The submission retitles it Song Q, which resolves to Q: Song B pairs with that line by time, and p9
 * with the line moved to 905 by title.
 */
function aRowRetitledToQ(status: Status): NovaVodCorrectionView {
  return resolvingToQ(correctionView({
    base: null,
    current: [liveRow('p1', SONG_A), liveRow('p2', row('Song B', 'Artist', 300, 400), status, 'pending'), endlessP9()],
    proposed: [SONG_A, row('Song Q', 'Artist', 300, 400), row('Song Q', 'Artist', 905, null)],
  }));
}

function testARelinkOfAHiddenRowHoldsNothingAndShowsNoHint(): void {
  // #13, as ruled: a relink keeps its row's status, so a row that is not approved stays off the site whatever its song,
  // and the apply approves no song for it (spec §6.4 promotes so that a relinked row does not vanish from the site,
  // which a hidden row cannot). Relinked to Q, Song B's row lands on no song the apply approves: there is nothing for
  // the hint to disclose, nothing is promoted, and p9 holds nothing.
  for (const status of ['pending', 'extracted'] as const) {
    const view = aRowRetitledToQ(status);
    const draft = initialDraft(view);
    deepStrictEqual(draft.pairs.map((pair) => [pair.currentIndex, pair.proposedIndex]), [[0, 0], [1, 1], [2, 2]], `${status}: the fixture's pairs`);
    const songB = need(view.current[1], 'Song B');
    const retitled = need(view.proposed[1], 'the line retitled Song Q');
    for (const choice of [PICK_Q, NEW_Q]) {
      strictEqual(choiceLandingSong(view, retitled, songB, choice), null, `${status}: ${choice.kind} lands on no song the apply approves`);
      const relinked = withPair(draft, 1, { title: choice });
      deepStrictEqual([draftOperations(relinked, view).needsEndCount, draftOperations(relinked, view).canApply], [0, true], `${status}: ${choice.kind} holds nothing`);
      deepStrictEqual(draftFlags(relinked, view).pairs, [NO_FLAGS, NO_FLAGS, NO_FLAGS], `${status}: ${choice.kind} marks nothing`);
    }
  }

  // The same relinks of an approved row (its song pending, so off the site) land on Q, which the apply approves: the
  // hint discloses it, and p9 holds the apply.
  const view = aRowRetitledToQ('approved');
  const draft = initialDraft(view);
  const songB = need(view.current[1], 'Song B');
  const retitled = need(view.proposed[1], 'the line retitled Song Q');
  for (const choice of [PICK_Q, NEW_Q]) {
    deepStrictEqual(choiceLandingSong(view, retitled, songB, choice), SONG_Q, `approved: ${choice.kind} lands on Q`);
    const relinked = withPair(draft, 1, { title: choice });
    deepStrictEqual([draftOperations(relinked, view).needsEndCount, draftOperations(relinked, view).canApply], [1, false], `approved: ${choice.kind} holds the apply for p9`);
    deepStrictEqual(draftFlags(relinked, view).pairs, [NO_FLAGS, NO_FLAGS, { ...NO_FLAGS, needsEnd: true }], `approved: ${choice.kind} marks p9`);
  }
}

function testPromotedSongsAreThePendingSongsATickedAddOrAChoiceLandsOn(): void {
  // The third review's #12. The pending songs the apply approves along with its operations, by id: those a ticked add or
  // a pair's title choice lands on, on an approved stream. A row of such a song goes on the site, which the draft weighs
  // for an end (`heldByPromotion`) and the page weighs for its hint that a row stays off the site, from this one set.
  const view = anEndlessRowOfAPendingSong();
  const draft = initialDraft(view);
  const promoted = (of: CorrectionDraft, on = view): string[] => [...promotedSongs(of, on)];
  deepStrictEqual(promoted(draft), ['s9'], 'the ticked add of Q lands on Q');
  const unticked = { ...draft, adds: edited(draft.adds, 0, { apply: false }) };
  deepStrictEqual(promoted(unticked), [], 'unticked, it lands nowhere');

  // A title choice is the apply's whether its pair's times are ticked or not; ignore and rename keep the row's song.
  deepStrictEqual(promoted(withPair(unticked, 0, { title: PICK_Q, applyTimes: false })), ['s9'], 'a relink of Song A onto Q');
  deepStrictEqual(promoted(withPair(unticked, 1, { title: NEW_Q })), ['s9'], "p9's own 改連到新的歌 as Song Q / Artist resolves to Q");
  deepStrictEqual(promoted(withPair(unticked, 0, { title: rename('Song AA', 'Artist') })), [], 'a rename lands on no song');
  deepStrictEqual(promoted(withPair(draft, 0, { title: PICK_Q })), ['s9'], 'the add and a relink on Q: Q once');
  const toA: TitleChoice = { kind: 'relinkExisting', songId: 's1', songLabel: 'Song A · Artist', songStatus: 'approved' };
  deepStrictEqual(promoted(withPair(unticked, 1, { title: toA })), [], 'an approved song needs no approval');

  // Nothing is promoted on a stream that is not approved, nor for a row that is not approved itself (#13, as ruled): a
  // relink keeps its row's status, so such a row stays off the site whatever its song.
  for (const status of NOT_APPROVED) {
    const off = anEndlessRowOfAPendingSong();
    off.stream.status = status;
    const offDraft = initialDraft(off);
    deepStrictEqual(promoted(offDraft, off), [], `${status} stream: the add`);
    deepStrictEqual(promoted(withPair({ ...offDraft, adds: edited(offDraft.adds, 0, { apply: false }) }, 0, { title: PICK_Q }), off), [], `${status} stream: the relink`);
  }
  const hidden = aRowRetitledToQ('pending');
  deepStrictEqual(promoted(withPair(initialDraft(hidden), 1, { title: PICK_Q }), hidden), [], 'a relink of a row that is not approved');

  // Total, as the draft's other functions: an entry whose row the view lacks lands nowhere.
  const pair = need(draft.pairs[1], 'the pair of p9');
  const add = need(draft.adds[0], 'the add');
  const dangling: CorrectionDraft = {
    pairs: [{ ...pair, currentIndex: 99, title: PICK_Q }, { ...pair, proposedIndex: 99, title: PICK_Q }],
    adds: [{ ...add, proposedIndex: 99 }],
    deletes: [],
  };
  deepStrictEqual(promoted(dangling), [], 'a row the view lacks');
}

/** X, a pending song: what Song X resolves to by Unknown (a blank artist reads as Unknown). */
const SONG_X: { id: string; status: Status } = { id: 'sX', status: 'pending' };

/**
 * Song Y by Artist Q is the stream's one row. The submission retitles it Song X with no artist, and adds Song X twice,
 * once with no artist and once as Unknown. Each resolves to X; a row with no artist also resolves with the stream's
 * artist, Artist Q, whose Song X is no song.
 */
function songXWithAndWithoutAnArtist(): NovaVodCorrectionView {
  const view = correctionView({
    base: null,
    current: [liveRow('p1', row('Song Y', 'Artist Q', 100, 200))],
    proposed: [row('Song X', '', 100, 200), row('Song X', '', 500, 600), row('Song X', 'Unknown', 800, 900)],
  });
  for (const proposed of view.proposed) {
    proposed.existingSong = { ...SONG_X };
    if (proposed.originalArtist === '') proposed.existingSongsByLiveArtist = [{ originalArtist: 'Artist Q', existingSong: null }];
  }
  return view;
}

function testAPendingHintShowsWhateverTheBlankArtistIsSpelled(): void {
  // #7. Resolution reads a blank artist as Unknown, and the draft sends one so (`artistText`): '' and 'Unknown' name one
  // song. The song an add or 改連到新的歌 lands on, which the page's hint says is pending, reads them alike.
  const view = songXWithAndWithoutAnArtist();
  deepStrictEqual([view.match.pairs.map((pair) => [pair.currentIndex, pair.proposedIndex]), view.match.unpairedProposed], [[[0, 0]], [1, 2]], 'the fixture');
  const retitled = need(view.proposed[0], 'the retitled line');
  const blank = need(view.proposed[1], 'the add with no artist');
  const unknown = need(view.proposed[2], 'the add as Unknown');
  // An add submitted with no artist lands on X left blank or typed as Unknown; one submitted as Unknown, kept or cleared.
  const spellings: Array<[CorrectionProposedRow, string[]]> = [[blank, ['', ' ', 'Unknown', ' Unknown ']], [unknown, ['Unknown', '', ' ']]];
  for (const [proposed, artists] of spellings) {
    for (const artist of artists) {
      deepStrictEqual(addLandingSong(view, proposed, 'Song X', artist), SONG_X, `submitted "${proposed.originalArtist}", sent as "${artist}"`);
    }
  }
  // Another artist or another title is another song, which only the apply resolves.
  deepStrictEqual([addLandingSong(view, blank, 'Song X', 'Artist Q'), addLandingSong(view, unknown, 'Song X (Live)', 'Unknown')], [null, null]);

  // 改連到新的歌 on the line submitted with no artist is offered under the stream's artist, Artist Q, and Song X by Artist Q
  // is no song: it lands on none. Changed to Unknown, or left blank, it names the submitted song, X.
  const songY = need(view.current[0], 'Song Y');
  const relinkNew = (originalArtist: string): TitleChoice => ({ kind: 'relinkNew', title: 'Song X', originalArtist });
  strictEqual(choiceLandingSong(view, retitled, songY, relinkNew('Artist Q')), null, 'as offered: no song');
  for (const artist of ['Unknown', '', ' Unknown ']) {
    deepStrictEqual(choiceLandingSong(view, retitled, songY, relinkNew(artist)), SONG_X, `改連到新的歌 typed "${artist}"`);
  }

  // On a stream that is not approved the apply approves nothing, so it lands on no song it approves, whatever the artist.
  view.stream.status = 'pending';
  deepStrictEqual([addLandingSong(view, blank, 'Song X', 'Unknown'), choiceLandingSong(view, retitled, songY, relinkNew('Unknown'))], [null, null]);
}

// Y loaded First 100–250 and Second 200–300 (an overlap the archive already had), retitled First (a start-only paste,
// so First's end is the parsers', Second's start) and left Second where it was. Then X moved Second to 260. Second
// still starts at its base position in Y's submission, so Y did not move it: First's derived end gives way to the
// stream's, because a base row's key counts as a match as well as a live row's. X's edit makes no end change on First.
const YIELD_BASE = [baseRow('p1', row('First', 'A', 100, 250)), baseRow('p2', row('Second', 'B', 200, 300))];
const YIELD_UNCHANGED = [liveRow('p1', row('First', 'A', 100, 250)), liveRow('p2', row('Second', 'B', 200, 300))];
const YIELD_MOVED_BY_X = [liveRow('p1', row('First', 'A', 100, 250)), liveRow('p2', row('Second', 'B', 260, 300))];

/** The review of Y's rows against the stream `current`, with First's pair as it starts. */
function firstOfYield(proposed: RowFields[], current: CorrectionCurrentRow[]) {
  const view = correctionView({ base: YIELD_BASE, current, proposed });
  const draft = initialDraft(view);
  const pair = need(draft.pairs.find((entry) => entry.currentIndex === 0), 'the First pair');
  return { view, pair, result: draftOperations(draft, view) };
}

function testAMoveByAnotherCorrectionMakesNoEndChange(): void {
  const filled = [row('First!', 'A', 100, 200), row('Second', 'B', 200, null)];
  const control = firstOfYield(filled, YIELD_UNCHANGED);
  deepStrictEqual([control.pair.applyTimes, control.pair.endTimestamp, control.result.operations], [false, 250, []], 'the control: nothing to send');
  const moved = firstOfYield(filled, YIELD_MOVED_BY_X);
  deepStrictEqual([moved.pair.applyTimes, moved.pair.endTimestamp], [false, 250], "X's move makes no end change on First!");
  deepStrictEqual(suggestedChanges(moved.view, 0, moved.pair.proposedIndex), { ...NONE, title: true });
  deepStrictEqual(moved.result.operations, control.result.operations, 'nothing beyond what the control sends');
}

function testAMoveByAnotherCorrectionNeedsNoEnd(): void {
  // First sent without an end (an Aurora row left unstamped): no end to type, and the draft opens as the control does.
  const open = [row('First!', 'A', 100, null), row('Second', 'B', 200, null)];
  const control = firstOfYield(open, YIELD_UNCHANGED);
  const moved = firstOfYield(open, YIELD_MOVED_BY_X);
  deepStrictEqual([moved.pair.applyTimes, moved.pair.endTimestamp], [false, 250], 'the stream end stays');
  deepStrictEqual([moved.result.needsEndCount, moved.result.canApply], [0, control.result.canApply], 'no end needed');
}

function testANextRowAtItsBasePositionIsNotMovedEvenWhenChanged(): void {
  // Y gave Second an end of its own, so Second is not untouched, but it still starts at its base position.
  const ended = firstOfYield([row('First!', 'A', 100, 200), row('Second', 'B', 200, 350)], YIELD_MOVED_BY_X);
  deepStrictEqual([ended.pair.applyTimes, ended.pair.endTimestamp], [false, 250], 'no end change on First!');
  strictEqual(ended.result.operations.some((operation) => operation.op === 'setTimes' && operation.performanceId === 'p1'), false);
}

function testARenamedNextRowLeavesTheEndBeforeItAlone(): void {
  // Copilot r16: First 100–300 overlaps Snog B 200–400, and a start-only paste fixes only Snog B's title to Song B, so
  // First's end is the parsers' (Song B's start). Song B starts where a live and a base row start, so it did not move:
  // a title or artist edit is no move. First's derived end gives way to the stream's, and First opens with no end
  // change, with the base (where it repeats its base row) and without.
  const archived = [row('First', 'A', 100, 300), row('Snog B', 'B', 200, 400)];
  const current = archived.map((fields, index) => liveRow(`p${index + 1}`, fields));
  for (const base of [null, archived.map((fields, index) => baseRow(`p${index + 1}`, fields))]) {
    const label = base ? 'with the base' : 'with no base';
    const view = correctionView({ base, current, proposed: [row('First', 'A', 100, 200), row('Song B', 'B', 200, null)] });
    const draft = initialDraft(view);
    const first = need(draft.pairs.find((pair) => pair.currentIndex === 0), 'the First pair');
    deepStrictEqual([first.applyTimes, first.endTimestamp], [false, 300], `${label}: First keeps its end`);
    deepStrictEqual(suggestedChanges(view, 0, first.proposedIndex), NONE, `${label}: First suggests nothing`);
    const sent = draftOperations(draft, view).operations;
    strictEqual(sent.some((operation) => operation.op === 'setTimes' && operation.performanceId === 'p1'), false, `${label}: nothing is sent for First`);
  }
}

function testAnUntouchedRowWhosePerformanceIsGoneIsNoAdd(): void {
  // Song A was deleted after Y loaded the list, and Y's submission keeps it as it was: the row was there for Y, not
  // added by Y. It is listed, unticked, and leaving it so skips nothing; the curator may still add it back.
  const view = correctionView({ base: LOADED, current: [liveRow('p2', SONG_B)], proposed: [SONG_A, row('Song B', 'Artist', 310, 400)] });
  const draft = initialDraft(view);
  const songA: AddDraft = { proposedIndex: 0, apply: false, title: 'Song A', originalArtist: 'Artist', timestamp: 100, endTimestamp: 200 };
  deepStrictEqual(draft.adds, [songA]);
  const result = draftOperations(draft, view);
  deepStrictEqual([result.operations, result.skipped], [[{ op: 'setTimes', performanceId: 'p2', timestamp: 310 }], NOTHING_SKIPPED]);
  deepStrictEqual(draftFlags(draft, view).adds, [{ ...NO_FLAGS, untouched: true, changedSince: true }]);
  const added = draftOperations({ ...draft, adds: edited(draft.adds, 0, { apply: true }) }, view);
  deepStrictEqual(added.operations.at(-1), { op: 'addPerformance', title: 'Song A', originalArtist: 'Artist', timestamp: 100, endTimestamp: 200 });
  // Split by hand, an untouched pair is no suggested add or delete either.
  const unchanged = correctionView({ base: LOADED, current: [liveRow('p1', SONG_A), liveRow('p2', SONG_B)], proposed: [SONG_A, SONG_B] });
  const split = unpair(initialDraft(unchanged), unchanged, 0);
  deepStrictEqual([split.adds.map((add) => add.apply), draftOperations(split, unchanged).skipped], [[false], NOTHING_SKIPPED]);
}

function testARowChangedSinceIsNeverTicked(): void {
  // X stamped Song A's end at 250 after Y loaded it, and Y moved Song A's start to 110 with the end Y saw. Y's change
  // meets X's: both show, nothing is ticked, and the curator decides. Left so, the suggestion counts as skipped.
  const view = correctionView({ base: [baseRow('p1', SONG_A)], current: [liveRow('p1', row('Song A', 'Artist', 100, 250))], proposed: [row('Song A', 'Artist', 110, 200)] });
  const draft = initialDraft(view);
  deepStrictEqual(suggestedChanges(view, 0, 0), { ...NONE, start: true, end: true });
  strictEqual(need(draft.pairs[0], 'the pair').applyTimes, false);
  deepStrictEqual(draftFlags(draft, view).pairs, [{ ...NO_FLAGS, changedSince: true }]);
  const result = draftOperations(draft, view);
  deepStrictEqual([result.operations, result.skipped.time], [[], 1]);
  deepStrictEqual(draftOperations(withPair(draft, 0, { applyTimes: true }), view).operations, [
    { op: 'setTimes', performanceId: 'p1', timestamp: 110, endTimestamp: 200 },
  ], 'ticked, it sends what Y submitted');
}

function testARowTheContributorNeverSawIsMarked(): void {
  // Song B's row is still pending, so Nova never showed it, and the contributor added Song B at 302–398: the add pairs
  // with that row, marked as one the contributor never saw. It is not on the site: applying will not publish it.
  const hidden = liveRow('pB', SONG_B, 'pending');
  const view = correctionView({ base: [baseRow('pA', SONG_A)], current: [liveRow('pA', SONG_A), hidden], proposed: [SONG_A, row('Song B', 'Artist', 302, 398)] });
  const draft = initialDraft(view);
  deepStrictEqual(draftFlags(draft, view).pairs, [{ ...NO_FLAGS, untouched: true }, { ...NO_FLAGS, notSeen: true }]);
  strictEqual(need(view.current[1], 'pB').onSite, false);
  deepStrictEqual(draftOperations(draft, view).operations, [{ op: 'setTimes', performanceId: 'pB', timestamp: 302, endTimestamp: 398 }]);
}

function testAPipelineCorrectionSawNothing(): void {
  // A stream still in the pipeline shows nothing, so Nova recorded an empty base: every live row is one the
  // contributor never saw. None is a suggested delete, and every one is still deletable.
  const view = correctionView({
    base: [],
    current: [liveRow('p1', SONG_A, 'pending'), liveRow('p2', SONG_B, 'pending')],
    proposed: [row('Song A', 'Artist', 105, 200)],
  });
  const draft = initialDraft(view);
  // Not seen is no reason to untick a row the site hides: with an empty base, every pair of such a correction is not
  // seen. (One on the site is: testAnOnSiteRowTheContributorNeverSawStartsUnticked.)
  strictEqual(need(draft.pairs[0], 'the Song A pair').applyTimes, true, 'a pair whose times differ starts ticked');
  const flags = draftFlags(draft, view);
  deepStrictEqual([flags.pairs, flags.deletes], [[{ ...NO_FLAGS, notSeen: true }], [{ ...NO_FLAGS, notSeen: true }]]);
  const result = draftOperations(draft, view);
  deepStrictEqual([result.operations, result.skipped], [[{ op: 'setTimes', performanceId: 'p1', timestamp: 105 }], NOTHING_SKIPPED]);
  deepStrictEqual(draftOperations({ ...draft, deletes: edited(draft.deletes, 0, { apply: true }) }, view).operations.at(-1), {
    op: 'deletePerformance', performanceId: 'p2',
  });
}

function testAnOnSiteRowTheContributorNeverSawStartsUnticked(): void {
  // Ruling C2, refined. A live row the base lacks is one the contributor never saw. A row the site hides was never
  // shown, so a pair with it keeps its default (testAPipelineCorrectionSawNothing). A row on the site was added or
  // published after the submission, so the times the contributor sent were not set against it: its pair starts
  // unticked, for the curator to decide, and left so, its suggestion counts as skipped, as one changed since does.
  const cases: ReadonlyArray<{ what: string; view: NovaVodCorrectionView; unseen: string[]; sent: CorrectionOperation[] }> = [
    {
      what: 'another correction added Song N since, and this one adds it too',
      view: correctionView({
        base: LOADED,
        current: [liveRow('p1', SONG_A), liveRow('p2', SONG_B), liveRow('pX', row('Song N', 'Artist', 500, 600))],
        proposed: [SONG_A, SONG_B, row('Song N', 'Artist', 505, 590)],
      }),
      unseen: ['pX'],
      sent: [{ op: 'setTimes', performanceId: 'pX', timestamp: 505, endTimestamp: 590 }],
    },
    {
      what: 'the stream was stamped and approved after a submission that saw no row',
      view: correctionView({
        base: [],
        current: [
          liveRow('p1', row('Song A', 'Artist', 102, 195)), liveRow('p2', row('Song B', 'Artist', 203, 290)), liveRow('p3', row('Song C', 'Artist', 301, 420)),
        ],
        proposed: [row('Song A', '', 100, 200), row('Song B', '', 200, 300), row('Song C', '', 300, null)],
      }),
      unseen: ['p1', 'p2', 'p3'],
      sent: [
        { op: 'setTimes', performanceId: 'p1', timestamp: 100 },
        { op: 'setTimes', performanceId: 'p2', timestamp: 200 },
        { op: 'setTimes', performanceId: 'p3', timestamp: 300 },
      ],
    },
  ];
  for (const { what, view, unseen, sent } of cases) {
    const draft = initialDraft(view);
    const onUnseen = draft.pairs.flatMap((pair, index) =>
      unseen.includes(need(view.current[pair.currentIndex], 'the paired row').performanceId) ? [index] : []);
    strictEqual(onUnseen.length, unseen.length, `${what}: each unseen row is paired`);
    for (const index of onUnseen) {
      const pair = need(draft.pairs[index], 'the pair');
      const changes = need(suggestedChanges(view, pair.currentIndex, pair.proposedIndex) ?? undefined, 'its suggestion');
      strictEqual(changes.start || changes.end, true, `${what}: pair ${index} suggests a time change`);
      strictEqual(pair.applyTimes, false, `${what}: pair ${index} starts unticked`);
      deepStrictEqual(draftFlags(draft, view).pairs[index], { ...NO_FLAGS, notSeen: true }, `${what}: pair ${index} is marked not seen`);
    }
    const result = draftOperations(draft, view);
    deepStrictEqual(result.operations, [], `${what}: nothing is sent`);
    deepStrictEqual(result.skipped, { ...NOTHING_SKIPPED, time: unseen.length }, `${what}: each suggested time counts as skipped`);
    const ticked = { ...draft, pairs: draft.pairs.map((pair, index) => (onUnseen.includes(index) ? { ...pair, applyTimes: true } : pair)) };
    deepStrictEqual(draftOperations(ticked, view).operations, sent, `${what}: ticked, it sends what the contributor submitted`);
    deepStrictEqual(draftOperations(ticked, view).skipped, NOTHING_SKIPPED);
  }

  // Another correction replaced p1 by pX, a new performance of Song A at 110, and this one moved Song A to 105. The
  // moved row stands for p1, which is gone: like an untouched row whose performance is gone, it pairs with nothing, and
  // never with pX. It is an unticked add marked changed since, and pX, which the contributor never saw, is an unticked
  // delete that is no skipped one. Left so, the contributor's time change counts as skipped.
  const replaced = correctionView({
    base: LOADED,
    current: [liveRow('pX', row('Song A', 'Artist', 110, 200)), liveRow('p2', SONG_B)],
    proposed: [row('Song A', 'Artist', 105, 200), SONG_B],
  });
  deepStrictEqual([pairedIds(replaced), replaced.match.unpairedProposed, replaced.match.unpairedCurrent], [[['p2', 'v2']], [0], [0]],
    'replaced since: Song A is an add, pX a delete');
  const replacedDraft = initialDraft(replaced);
  deepStrictEqual([replacedDraft.adds.map((add) => add.apply), replacedDraft.deletes], [[false], [{ currentIndex: 0, apply: false }]]);
  const replacedFlags = draftFlags(replacedDraft, replaced);
  deepStrictEqual([replacedFlags.adds, replacedFlags.deletes], [[{ ...NO_FLAGS, changedSince: true }], [{ ...NO_FLAGS, notSeen: true }]]);
  const left = draftOperations(replacedDraft, replaced);
  deepStrictEqual([left.operations, left.skipped], [[], { ...NOTHING_SKIPPED, time: 1 }], 'replaced since: nothing sent, the time change skipped');
  strictEqual(left.skipped.delete, 0, 'replaced since: pX is no skipped delete');

  // The same add, landing on a row the site hides (its performance still pending): never shown, so it keeps its tick.
  const hidden = correctionView({
    base: LOADED,
    current: [liveRow('p1', SONG_A), liveRow('p2', SONG_B), liveRow('pX', row('Song N', 'Artist', 500, 600), 'pending')],
    proposed: [SONG_A, SONG_B, row('Song N', 'Artist', 505, 590)],
  });
  deepStrictEqual(draftOperations(initialDraft(hidden), hidden).operations, [
    { op: 'setTimes', performanceId: 'pX', timestamp: 505, endTimestamp: 590 },
  ], 'a hidden row keeps its tick');
  // With no base, nothing is "not seen", and every pair starts as before.
  const stamped = need(cases[1], 'the stamped stream');
  const unbased = correctionView({ base: null, current: stamped.view.current, proposed: [row('Song A', '', 100, 200), row('Song B', '', 200, 300), row('Song C', '', 300, null)] });
  deepStrictEqual(draftOperations(initialDraft(unbased), unbased).operations, stamped.sent, 'a review with no base is unchanged');
}

/** Each pair as [performance id, proposed row id], in the match's order. */
function pairedIds(view: NovaVodCorrectionView): string[][] {
  return view.match.pairs.map((pair) => [
    need(view.current[pair.currentIndex], 'the paired row').performanceId,
    need(view.proposed[pair.proposedIndex], 'the paired submitted row').id,
  ]);
}

function testAFixOfARowChangedSinceIsNoAdd(): void {
  // Y fixed Song A's title to "Song A!" and moved Song B to 310. Before the review, Song A's performance changed: it
  // was deleted, or another correction moved it far. Y's fix was made to a row that is not there as Y saw it, so it is
  // no add to tick. Deleted, the fix is left an add, unticked: it counts as the title fix skipped, never as an add.
  const proposed = [row('Song A!', 'Artist', 100, 200), row('Song B', 'Artist', 310, 400)];
  const deleted = correctionView({ base: LOADED, current: [liveRow('p2', SONG_B)], proposed });
  deepStrictEqual(pairedIds(deleted), [['p2', 'v2']], 'deleted since: Song B pairs, Song A! does not');
  deepStrictEqual(deleted.match.unpairedProposed, [0], 'deleted since: Song A! is an add');
  deepStrictEqual(deleted.match.unpairedCurrent, [], 'deleted since: no row is left to delete');
  const deletedDraft = initialDraft(deleted);
  deepStrictEqual(deletedDraft.adds.map((add) => add.apply), [false], 'deleted since: no ticked add');
  deepStrictEqual(draftFlags(deletedDraft, deleted).adds, [{ ...NO_FLAGS, changedSince: true }], 'deleted since: the add is marked changed since');
  deepStrictEqual(draftFlags(deletedDraft, deleted).deletes, []);
  const deletedResult = draftOperations(deletedDraft, deleted);
  deepStrictEqual(deletedResult.skipped, { time: 0, title: 1, add: 0, delete: 0 }, 'deleted since: the title fix skipped, no add and no delete');
  strictEqual(summarizeCorrection(deletedResult.operations, deletedResult.skipped), '套用 1 項（時間 1）；略過 1 項（歌名 1）', 'deleted since: the note');
  const ticked = draftOperations({ ...deletedDraft, adds: edited(deletedDraft.adds, 0, { apply: true }) }, deleted);
  deepStrictEqual(ticked.operations.at(-1), { op: 'addPerformance', title: 'Song A!', originalArtist: 'Artist', timestamp: 100, endTimestamp: 200 },
    'deleted since: ticked, it is an ordinary add');
  deepStrictEqual(ticked.skipped, NOTHING_SKIPPED);

  // Moved far since, it is still the performance Y fixed: Song A! stands for p1 (baseCounterparts) and pairs with it by
  // id, wherever p1 is now. The pair is marked changed since and starts with nothing ticked, so X's move is never
  // undone by default. Left so, it skips Y's time change and title fix; nothing is added or deleted.
  const movedFar = correctionView({ base: LOADED, current: [liveRow('p2', SONG_B), liveRow('p1', row('Song A', 'Artist', 1000, 1100))], proposed });
  deepStrictEqual(pairedIds(movedFar), [['p2', 'v2'], ['p1', 'v1']], 'moved far since: Song A! pairs with p1 by id');
  deepStrictEqual([movedFar.match.unpairedProposed, movedFar.match.unpairedCurrent], [[], []], 'moved far since: no add and no delete');
  const draft = initialDraft(movedFar);
  deepStrictEqual(need(draft.pairs[1], 'the Song A! pair'), {
    currentIndex: 1, proposedIndex: 0, applyTimes: false, timestamp: 100, endTimestamp: 200, title: { kind: 'ignore' },
  }, 'moved far since: nothing ticked');
  deepStrictEqual(draftFlags(draft, movedFar).pairs[1], { ...NO_FLAGS, changedSince: true }, 'moved far since: marked changed since');
  const result = draftOperations(draft, movedFar);
  deepStrictEqual(result.operations, [{ op: 'setTimes', performanceId: 'p2', timestamp: 310 }], "moved far since: only Y's move of Song B");
  deepStrictEqual(result.skipped, { time: 1, title: 1, add: 0, delete: 0 }, 'moved far since: the time change and the title fix skipped');
  strictEqual(summarizeCorrection(result.operations, result.skipped), '套用 1 項（時間 1）；略過 2 項（時間 1、歌名 1）', 'moved far since: the note');
}

function testALeftOutAddCountsWhatTheContributorChanged(): void {
  // Song A was deleted since. Y's row that stands for it, left unticked, counts what Y changed against it: a time
  // change once as 時間 and a title change once as 歌名. An end the parsers filled that gives way to the base end (Song
  // B, the next submitted row, still matches the base) is no time change. A fix of only the case is no change at all.
  const skippedFor = (songA: RowFields) => {
    const view = correctionView({ base: LOADED, current: [liveRow('p2', SONG_B)], proposed: [songA, SONG_B] });
    const draft = initialDraft(view);
    deepStrictEqual(draft.adds.map((add) => add.apply), [false], `${songA.title}: no ticked add`);
    return draftOperations(draft, view).skipped;
  };
  deepStrictEqual(skippedFor(row('Song A!', 'Artist', 120, 200)), { time: 1, title: 1, add: 0, delete: 0 }, 'moved and retitled');
  deepStrictEqual(skippedFor(row('Song A!', 'Artist', 100, 300)), { time: 0, title: 1, add: 0, delete: 0 }, 'a filled end');
  deepStrictEqual(skippedFor(row('song a', 'Artist', 100, 200)), NOTHING_SKIPPED, 'only the case');
}

function testPairingFollowsTheBaseWhereAHiddenRowCutsAnOpenEnd(): void {
  // Song A has no end, so the time match reads it on to the next row's start: over the base that is Song B's, and
  // Y's "Song A!", moved to 300–400, stands for Song A; on the stream a hidden row starts first and cuts Song A short,
  // so by the stream's overlap alone Y's row would be an add. The pairing follows the base instead: Y's row pairs with
  // Song A by its id. Song A is as Y saw it, so the pair is an ordinary one, ticked and unmarked, and the hidden row,
  // which Y never saw, is no delete Y suggested.
  const songA = row('Song A', 'Artist', 100, null);
  const songB = row('Song B', 'Artist', 500, 600);
  const view = correctionView({
    base: [baseRow('p1', songA), baseRow('p2', songB)],
    current: [liveRow('p1', songA), liveRow('ph', row('Hidden', 'Artist', 200, 300), 'pending'), liveRow('p2', songB)],
    proposed: [row('Song A!', 'Artist', 300, 400), songB],
  });
  deepStrictEqual(pairedIds(view), [['p1', 'v1'], ['p2', 'v2']], 'the fixture: Song A! pairs with Song A, Song B with its own');
  deepStrictEqual([view.match.unpairedProposed, view.match.unpairedCurrent], [[], [1]], 'no add, and the hidden row left over');
  const draft = initialDraft(view);
  deepStrictEqual(need(draft.pairs[0], 'the Song A! pair'), {
    currentIndex: 0, proposedIndex: 0, applyTimes: true, timestamp: 300, endTimestamp: 400, title: { kind: 'ignore' },
  });
  const flags = draftFlags(draft, view);
  deepStrictEqual([flags.pairs[0], flags.deletes], [NO_FLAGS, [{ ...NO_FLAGS, notSeen: true }]]);
  const result = draftOperations(draft, view);
  deepStrictEqual(result.operations, [{ op: 'setTimes', performanceId: 'p1', timestamp: 300, endTimestamp: 400 }]);
  deepStrictEqual(result.skipped, { time: 0, title: 1, add: 0, delete: 0 }, 'the title fix left out; the hidden row is no skipped delete');
}

function testWithNothingChangedSinceTheBaseChangesNoDefault(): void {
  // Differential: while the stream is still the list the contributor loaded (but for a row hidden from them), reading
  // the base three ways changes no default. Each submission pairs, ticks and counts exactly as the plain review of the
  // same rows does, and nothing is marked as changed since.
  const songC = row('Song C', 'Artist', 500, 600);
  const base = [...LOADED, baseRow('p3', songC)];
  const hidden = row('Hidden', 'Artist', 420, 480);
  const current = [liveRow('p1', SONG_A), liveRow('p2', SONG_B), liveRow('ph', hidden, 'pending'), liveRow('p3', songC)];
  const songAFixed = row('Song A!', 'Artist', 100, 200);
  const songBMoved = row('Song B', 'Artist', 310, 400);
  const hiddenAdded = row('Hidden', 'Artist', 422, 478);
  const songD = row('Song D', 'Artist', 700, 800);
  const submissions: ReadonlyArray<readonly [string, RowFields[]]> = [
    ['a title fix', [songAFixed, SONG_B, songC]],
    ['a moved start', [SONG_A, songBMoved, songC]],
    ['a row left out', [SONG_A, songC]],
    ['a new row in a gap', [SONG_A, SONG_B, songC, songD]],
    ['the hidden song added', [SONG_A, SONG_B, hiddenAdded, songC]],
    ['all at once', [songAFixed, songBMoved, hiddenAdded, songD]],
  ];
  for (const [what, proposed] of submissions) {
    const based = correctionView({ base, current, proposed });
    const plain = correctionView({ base: null, current, proposed });
    deepStrictEqual(based.match, plain.match, `${what}: the same pairing`);
    const draft = initialDraft(based);
    deepStrictEqual(draft, initialDraft(plain), `${what}: the same ticks and values`);
    deepStrictEqual(draftOperations(draft, based), draftOperations(draft, plain), `${what}: the same operations and counts`);
    const flags = draftFlags(draft, based);
    strictEqual([...flags.pairs, ...flags.adds, ...flags.deletes].some((flag) => flag.changedSince), false, `${what}: nothing changed since`);
  }
}

function testARowTheContributorDroppedIsStillOffered(): void {
  // Y saw Song B and left it out: a suggested delete, unticked as ever, so a skipped one.
  const view = correctionView({ base: LOADED, current: [liveRow('p1', SONG_A), liveRow('p2', SONG_B)], proposed: [SONG_A, row('Song C', 'Artist', 500, 600)] });
  const draft = initialDraft(view);
  deepStrictEqual(draft.deletes, [{ currentIndex: 1, apply: false }]);
  deepStrictEqual(draftOperations(draft, view).skipped, { time: 0, title: 0, add: 0, delete: 1 });
  deepStrictEqual(draftFlags(draft, view).deletes, [NO_FLAGS]);
}

function testWithNoBaseAnOffSiteRowIsNoSuggestedDelete(): void {
  // The ichii correction has no base. Its left-over row, A Tender Moon Tempo, is a suggested delete while it is on the
  // site; once it is not (its song still pending), nobody could have seen it, so it is not.
  const view = viewAfter((v) => {
    v.current[2] = { ...need(v.current[2], 'current 2'), songStatus: 'pending', onSite: false };
  });
  const draft = initialDraft(view);
  deepStrictEqual(draft.deletes, [{ currentIndex: 2, apply: false }], 'still listed');
  deepStrictEqual(draftOperations(draft, view).skipped, { time: 0, title: 1, add: 0, delete: 0 });
  deepStrictEqual(draftOperations({ ...draft, deletes: edited(draft.deletes, 0, { apply: true }) }, view).operations.at(-1), {
    op: 'deletePerformance', performanceId: 'p3',
  }, 'and deletable');
}

// --- A repeat: an add that duplicates a row the stream keeps, or an earlier add ---

/** Song B as an own line, 10 s later than the stream has it. */
const SONG_B_MOVED = row('Song B', 'Artist', 310, 400);

/** For each add of the draft, [whether it starts ticked, whether it is marked 重複], in the draft's order. */
function tickAndMark(draft: CorrectionDraft, view: NovaVodCorrectionView): Array<[boolean, boolean]> {
  return draftFlags(draft, view).adds.map((flags, index) => [need(draft.adds[index], `add ${index}`).apply, flags.repeats]);
}

/** The row each add repeats, as [title, start], in the draft's order. */
function repeatedBy(draft: CorrectionDraft, view: NovaVodCorrectionView): Array<[string, number] | null> {
  return draftRepeats(draft, view).map((repeated) => (repeated === null ? null : [repeated.title, repeated.timestamp]));
}

/** The ids of the two rows of a pair, as the view holds them: a live performance and a submitted row (v1, v2, …). */
const idsOf = (view: NovaVodCorrectionView, pair: { currentIndex: number; proposedIndex: number }): [string | undefined, string | undefined] =>
  [view.current[pair.currentIndex]?.performanceId, view.proposed[pair.proposedIndex]?.id];

function testALoadedListPastedTwiceAddsNothingByDefault(): void {
  // Finding #3. The contributor loaded Song A and Song B and pasted their own list under it, Song B 10 s late. The
  // loaded copies pair with the live rows, untouched; the own copies are adds, and each repeats a row the stream keeps.
  const view = correctionView({
    base: LOADED,
    current: [liveRow('p1', SONG_A), liveRow('p2', SONG_B)],
    proposed: [SONG_A, SONG_A, SONG_B, SONG_B_MOVED],
  });
  const draft = initialDraft(view);
  deepStrictEqual(draft.pairs.map((pair) => idsOf(view, pair)), [['p1', 'v1'], ['p2', 'v3']], 'the loaded copies pair with the live rows');
  deepStrictEqual(draft.adds.map((add) => view.proposed[add.proposedIndex]?.id), ['v2', 'v4'], 'the own copies are the adds');
  deepStrictEqual(tickAndMark(draft, view), [[false, true], [false, true]], 'both start unticked and are marked');
  deepStrictEqual(draftFlags(draft, view).adds, [{ ...NO_FLAGS, repeats: true }, { ...NO_FLAGS, repeats: true }]);
  deepStrictEqual(repeatedBy(draft, view), [['Song A', 100], ['Song B', 300]], 'each names the row it repeats');

  const result = draftOperations(draft, view);
  deepStrictEqual(result.operations, [], 'so the default apply adds nothing');
  deepStrictEqual(result.skipped, { time: 0, title: 0, add: 2, delete: 0 }, 'and counts both as skipped adds');
  strictEqual(result.canApply, false);

  // A default only: ticked, an own copy is added like any other add.
  const ticked = draftOperations({ ...draft, adds: edited(draft.adds, 1, { apply: true }) }, view);
  deepStrictEqual(ticked.operations, [{ op: 'addPerformance', title: 'Song B', originalArtist: 'Artist', timestamp: 310, endTimestamp: 400 }]);
  deepStrictEqual(ticked.skipped, { time: 0, title: 0, add: 1, delete: 0 });
  strictEqual(ticked.canApply, true);
}

function testADuplicatedLineIsARepeat(): void {
  // One line of the list twice, its end given: the second copy duplicates the row the stream keeps, with a base (the
  // loaded copy is untouched) and without one (the matcher pairs the first copy by its title).
  for (const base of [LOADED, null]) {
    const what = base === null ? 'no base' : 'a base';
    const view = correctionView({ base, current: [liveRow('p1', SONG_A), liveRow('p2', SONG_B)], proposed: [SONG_A, SONG_A, SONG_B] });
    const draft = initialDraft(view);
    deepStrictEqual(draft.adds.map((add) => view.proposed[add.proposedIndex]?.id), ['v2'], `${what}: the second copy is the add`);
    deepStrictEqual(tickAndMark(draft, view), [[false, true]], `${what}: unticked and marked`);
    const result = draftOperations(draft, view);
    deepStrictEqual([result.operations, result.skipped, result.canApply], [[], { time: 0, title: 0, add: 1, delete: 0 }, false], `${what}: nothing to apply`);
  }
}

function testAnOwnCopyWithATypedEndThatSortsFirstRepeatsTheKeptRow(): void {
  // The own copy, its end typed, starts 2 s before the loaded one, so it sorts first and no add comes before it: it
  // repeats the live row, which the loaded copy is paired with.
  const view = correctionView({
    base: LOADED,
    current: [liveRow('p1', SONG_A), liveRow('p2', SONG_B)],
    proposed: [row('Song A', 'Artist', 98, 200), SONG_A, SONG_B],
  });
  const draft = initialDraft(view);
  deepStrictEqual(draft.pairs.map((pair) => idsOf(view, pair)), [['p1', 'v2'], ['p2', 'v3']], 'the loaded copies pair with the live rows');
  deepStrictEqual(draft.adds.map((add) => view.proposed[add.proposedIndex]?.id), ['v1'], 'the own copy is the add');
  deepStrictEqual(tickAndMark(draft, view), [[false, true]]);
  deepStrictEqual(repeatedBy(draft, view), [['Song A', 100]], 'and names the live row');
}

function testAStartOnlyOwnCopyThatSortsFirstRepeatsTheKeptRow(): void {
  // The loaded list with the contributor's own list pasted under it as start times only, each line 5 s early. The form
  // sorts the lines, so each own line comes just before its loaded twin and the parser ends it where the twin starts:
  // 95–100 overlaps nothing. Read with its twin's length, as an end the parser filled, it is a repeat of the live row.
  for (const base of [null, ABC_BASE]) {
    const what = base === null ? 'no base' : 'a base';
    const view = correctionView({
      base,
      current: ABC_LIVE,
      proposed: [row('A', 'X', 95, 100), ABC[0]!, row('B', 'X', 295, 300), ABC[1]!, row('C', 'X', 495, 500), ABC[2]!],
    });
    const draft = initialDraft(view);
    deepStrictEqual(draft.pairs.map((pair) => idsOf(view, pair)), [['p1', 'v2'], ['p2', 'v4'], ['p3', 'v6']], `${what}: the loaded lines pair`);
    deepStrictEqual(draft.adds.map((add) => view.proposed[add.proposedIndex]?.id), ['v1', 'v3', 'v5'], `${what}: the own lines are the adds`);
    deepStrictEqual(tickAndMark(draft, view), [[false, true], [false, true], [false, true]], `${what}: unticked and marked 重複`);
    deepStrictEqual(repeatedBy(draft, view), [['A', 100], ['B', 300], ['C', 500]], `${what}: each names its twin`);
    const result = draftOperations(draft, view);
    deepStrictEqual([result.operations, result.skipped, result.canApply], [[], { time: 0, title: 0, add: 3, delete: 0 }, false], `${what}: nothing to apply`);
  }
  // Read with the twin's length, a line 60 s early overlaps it by 40 s of 100: under half, so it is an add, ticked. An
  // encore later ends nowhere near its twin's start: an add, ticked.
  for (const [what, own] of [['60 s early', row('A', 'X', 40, 100)], ['an encore', row('A', 'X', 900, 1000)]] as const) {
    const view = correctionView({ base: ABC_BASE, current: ABC_LIVE, proposed: [...ABC, own] });
    deepStrictEqual(tickAndMark(initialDraft(view), view), [[true, false]], `${what}: ticked, unmarked`);
  }
}

function testAnEncoreIsNoRepeat(): void {
  // The same song sung again later, which nothing overlaps: an add like any other, ticked and unmarked.
  const encore = row('Song A', 'Artist', 5000, 5100);
  const view = correctionView({ base: LOADED, current: [liveRow('p1', SONG_A), liveRow('p2', SONG_B)], proposed: [SONG_A, SONG_B, encore] });
  const draft = initialDraft(view);
  deepStrictEqual(draft.adds, [{ proposedIndex: 2, apply: true, title: 'Song A', originalArtist: 'Artist', timestamp: 5000, endTimestamp: 5100 }]);
  deepStrictEqual(draftFlags(draft, view).adds, [NO_FLAGS]);
  deepStrictEqual(repeatedBy(draft, view), [null]);
  deepStrictEqual(draftOperations(draft, view).operations, [
    { op: 'addPerformance', title: 'Song A', originalArtist: 'Artist', timestamp: 5000, endTimestamp: 5100 },
  ]);
}

function testANewSongTypedTwiceIsAddedOnce(): void {
  // A song the stream lacks, in the list twice: the first copy is the add, the second repeats it, an earlier add.
  const songC = row('Song C', 'Artist', 500, 600);
  const view = correctionView({ base: LOADED, current: [liveRow('p1', SONG_A), liveRow('p2', SONG_B)], proposed: [SONG_A, SONG_B, songC, songC] });
  const draft = initialDraft(view);
  deepStrictEqual(draft.adds.map((add) => view.proposed[add.proposedIndex]?.id), ['v3', 'v4']);
  deepStrictEqual(tickAndMark(draft, view), [[true, false], [false, true]], 'the first starts ticked, the second unticked and marked');
  deepStrictEqual(repeatedBy(draft, view), [null, ['Song C', 500]]);
  const result = draftOperations(draft, view);
  deepStrictEqual(result.operations, [{ op: 'addPerformance', title: 'Song C', originalArtist: 'Artist', timestamp: 500, endTimestamp: 600 }]);
  deepStrictEqual(result.skipped, { time: 0, title: 0, add: 1, delete: 0 });
}

function testTheRepeatMarkFollowsThePairing(): void {
  // The mark is read from the pairs the draft has, so a curator's re-pairing moves it; the tick was decided when the
  // add was built, so it stays as it was. Song A is on the stream and submitted at the same time, and Song Z is new.
  const songA = row('Song A', 'Artist', 100, 200);
  const view = correctionView({ base: null, current: [liveRow('pA', songA)], proposed: [songA, row('Song Z', 'Artist', 400, 500)] });
  const draft = initialDraft(view);
  deepStrictEqual(draft.pairs.map((pair) => idsOf(view, pair)), [['pA', 'v1']], 'the fixture: Song A pairs with its row');
  deepStrictEqual(tickAndMark(draft, view), [[true, false]], 'Song Z is a plain add');

  // Split, Song A's live row is a delete candidate, not a row the stream keeps: its own row is no repeat.
  const split = unpair(draft, view, 0);
  deepStrictEqual(tickAndMark(split, view), [[true, false], [true, false]], 'split: both adds are ticked and unmarked');

  // Song Z's row paired by hand with Song A's live row: the stream keeps that row now, so the submitted Song A, still
  // ticked as it was built, is marked as the repeat it has become.
  const crossed = pairWith(split, view, 1, 0);
  deepStrictEqual(tickAndMark(crossed, view), [[true, true]], 'crossed: marked, and still ticked');
  deepStrictEqual(repeatedBy(crossed, view), [['Song A', 100]]);
  deepStrictEqual(draftOperations(crossed, view).operations.map((operation) => operation.op), ['setTimes', 'addPerformance'], 'the ticked add is still applied');

  // Split again: Song A's live row is a delete candidate once more, and the mark goes.
  deepStrictEqual(tickAndMark(unpair(crossed, view, 0), view), [[true, false], [true, false]], 'split again: the mark goes');

  // The loaded copy and the own copy of Song A. The own copy repeats the live row the loaded copy is paired with. Split
  // that pair and the loaded copy is an add too, which the own copy, a later row, repeats; pair the own copy with the
  // live row instead and it is the loaded copy that repeats the live row.
  const copies = correctionView({ base: [baseRow('p1', SONG_A)], current: [liveRow('p1', SONG_A)], proposed: [SONG_A, SONG_A] });
  const asOpened = initialDraft(copies);
  deepStrictEqual(tickAndMark(asOpened, copies), [[false, true]], 'the own copy repeats the live row');
  const loadedSplit = unpair(asOpened, copies, 0);
  deepStrictEqual(tickAndMark(loadedSplit, copies), [[false, false], [false, true]], 'split: the loaded copy repeats nothing, the own copy repeats it');
  deepStrictEqual(repeatedBy(loadedSplit, copies), [null, ['Song A', 100]]);
  deepStrictEqual(tickAndMark(pairWith(loadedSplit, copies, 1, 0), copies), [[false, true]], 'the own copy paired: the loaded copy repeats the live row');
}

function testASplitOffRowStartsAgainstThePairingThatRemains(): void {
  // Split, a pair's own live row is a delete candidate, so a row that overlaps only it is no repeat: it starts ticked,
  // though the pair was of one title.
  const nudged = correctionView({ base: null, current: [liveRow('pA', row('Song A', 'Artist', 100, 200))], proposed: [row('Song A', 'Artist', 105, 205)] });
  const nudgedDraft = initialDraft(nudged);
  deepStrictEqual(nudgedDraft.pairs.map((pair) => idsOf(nudged, pair)), [['pA', 'v1']], 'the fixture: one pair');
  deepStrictEqual(tickAndMark(unpair(nudgedDraft, nudged, 0), nudged), [[true, false]], 'its row starts ticked and unmarked');

  // A stream that lists a song twice, overlapping, and a submission that does too: split one pair, and its row
  // overlaps the other live row, which is kept: a repeat of it, so it starts unticked.
  const twice = correctionView({
    base: null,
    current: [liveRow('p1', row('Song A', 'Artist', 100, 200)), liveRow('p2', row('Song A', 'Artist', 150, 250))],
    proposed: [row('Song A', 'Artist', 100, 200), row('Song A', 'Artist', 150, 250)],
  });
  const twiceDraft = initialDraft(twice);
  deepStrictEqual(twiceDraft.pairs.map((pair) => idsOf(twice, pair)), [['p1', 'v1'], ['p2', 'v2']], 'the fixture: each row with its own');
  const split = unpair(twiceDraft, twice, 0);
  deepStrictEqual(tickAndMark(split, twice), [[false, true]], 'the split-off row repeats the live row that stays paired');
  deepStrictEqual(repeatedBy(split, twice), [['Song A', 150]]);
  deepStrictEqual(split.deletes, [{ currentIndex: 0, apply: false }], 'and its own live row is the delete candidate');
}

// --- 全選: every row of a kind that opens ticked before the guard ticked again; every other tick kept ---

/** The draft with every pair's times and every add unticked, as the guard leaves a review whose base nothing confirmed. */
function untickedAll(draft: CorrectionDraft): CorrectionDraft {
  return {
    ...draft,
    pairs: draft.pairs.map((pair) => ({ ...pair, applyTimes: false })),
    adds: draft.adds.map((add) => ({ ...add, apply: false })),
  };
}

function testTickAllTimesRestoresTodaysDefaults(): void {
  // 全選時間 ticks the times of every pair `initialDraft` ticks (`pairOf`): the ichii correction's six time edits,
  // whatever the draft had.
  const view = ichiiCorrectionView();
  const opened = initialDraft(view);
  deepStrictEqual(tickAllTimes(untickedAll(opened), view), opened, 'every time edit ticked again');
  strictEqual(tickAllTimes(opened, view), opened, 'with every tick as it opens, it changes nothing: the same draft');

  // It ticks and changes nothing else: a title choice, a time typed and a ticked delete stay as the curator left them.
  const worked = withPair({ ...untickedAll(opened), deletes: edited(opened.deletes, 0, { apply: true }) }, 0, {
    title: rename('Late Niqht Drive', 'Unknown'),
    timestamp: 870,
  });
  const ticked = tickAllTimes(worked, view);
  deepStrictEqual(ticked.pairs.map((pair) => pair.applyTimes), [true, true, true, true, true, true]);
  deepStrictEqual(untickedAll(ticked), worked, 'only the time ticks changed');

  // A pair whose times agree opens unticked (testAPairWhoseTimesAgreeStartsUnticked), and 全選時間 leaves it so.
  const agreeing = viewAfter((v) => {
    v.proposed[1] = { ...need(v.proposed[1], 'proposed 1'), endTimestamp: 1621 };
  });
  deepStrictEqual(tickAllTimes(untickedAll(initialDraft(agreeing)), agreeing).pairs.map((pair) => pair.applyTimes), [true, false, true, true, true, true]);
}

function testTickAllAddsRestoresTodaysDefaults(): void {
  // 全選新增 ticks every add `initialDraft` ticks (`addOf`): Song C and Song D, two songs the stream lacks, are added.
  // It ticks and changes nothing else: Song D's title as the curator typed it, the pairs and the deletes stay.
  const view = correctionView({
    base: LOADED,
    current: [liveRow('p1', SONG_A), liveRow('p2', SONG_B)],
    proposed: [SONG_A, row('Song B', 'Artist', 310, 400), row('Song C', 'Artist', 500, 600), row('Song D', 'Artist', 700, 800)],
  });
  const opened = initialDraft(view);
  deepStrictEqual(tickAndMark(opened, view), [[true, false], [true, false]], 'the fixture: both adds open ticked');
  const unticked = untickedAll(opened);
  const worked: CorrectionDraft = { ...unticked, adds: edited(unticked.adds, 1, { title: 'Song D!' }) };
  const ticked = tickAllAdds(worked, view);
  deepStrictEqual(ticked.adds.map((add) => [add.title, add.apply]), [['Song C', true], ['Song D!', true]], 'both added again, the typed title kept');
  deepStrictEqual(ticked.pairs, worked.pairs, 'the time ticks are not its own');
  deepStrictEqual(ticked.deletes, worked.deletes);
  strictEqual(tickAllAdds(opened, view), opened, 'with every add as it opens, it changes nothing: the same draft');

  // Whether an add opens ticked is read from the draft as it is (`unpair` builds it so), not from the suggested pairing
  // (testASplitOffRowStartsAgainstThePairingThatRemains): split off its pair, a row whose live row is a delete candidate
  // now is no repeat, and is ticked; one that overlaps the other live row, which stays paired, is a repeat of it, and is
  // not, so it stays unticked.
  const nudged = correctionView({ base: null, current: [liveRow('pA', row('Song A', 'Artist', 100, 200))], proposed: [row('Song A', 'Artist', 105, 205)] });
  const split = unpair(initialDraft(nudged), nudged, 0);
  deepStrictEqual(tickAllAdds(untickedAll(split), nudged).adds.map((add) => add.apply), [true], 'split from its own row: ticked');
  const twice = correctionView({
    base: null,
    current: [liveRow('p1', row('Song A', 'Artist', 100, 200)), liveRow('p2', row('Song A', 'Artist', 150, 250))],
    proposed: [row('Song A', 'Artist', 100, 200), row('Song A', 'Artist', 150, 250)],
  });
  const splitTwice = unpair(initialDraft(twice), twice, 0);
  deepStrictEqual(splitTwice.adds.map((add) => add.apply), [false], 'the fixture: the split-off row opens unticked');
  strictEqual(tickAllAdds(splitTwice, twice), splitTwice, 'a repeat of the row that stays paired: nothing to tick');
}

/** Song A, moved by the contributor to 110, with an end stamped at 250 since: a pair that opens unticked. */
const changedSinceView = (): NovaVodCorrectionView =>
  correctionView({ base: [baseRow('p1', SONG_A)], current: [liveRow('p1', row('Song A', 'Artist', 100, 250))], proposed: [row('Song A', 'Artist', 110, 200)] });

/** The loaded Song A and Song B with the contributor's own copy pasted under them: two adds that open unticked. */
const loadedListPastedTwice = (): NovaVodCorrectionView =>
  correctionView({ base: LOADED, current: [liveRow('p1', SONG_A), liveRow('p2', SONG_B)], proposed: [SONG_A, SONG_A, SONG_B, SONG_B_MOVED] });

function testTickAllLeavesHeldByTodaysRulesUnticked(): void {
  // 全選 ticks what opens ticked before the guard, not every row: a time change that meets a change made since the
  // submission (testARowChangedSinceIsNeverTicked) and an add that repeats a row the stream keeps
  // (testALoadedListPastedTwiceAddsNothingByDefault) open unticked, and stay so.
  const changed = changedSinceView();
  const changedDraft = initialDraft(changed);
  strictEqual(tickAllTimes(changedDraft, changed), changedDraft, 'changed since: nothing for 全選時間 to tick');
  const repeats = loadedListPastedTwice();
  const repeatsDraft = initialDraft(repeats);
  strictEqual(tickAllAdds(repeatsDraft, repeats), repeatsDraft, 'the repeats: nothing for 全選新增 to tick');
}

function testSelectAllNeverUnticksACuratorsTick(): void {
  // 全選 only ticks. A row that opens unticked keeps the tick the curator gave it, and while only such rows are
  // ticked by hand there is nothing for 全選 to do: the same draft.
  const changed = changedSinceView();
  const timesTicked = withPair(initialDraft(changed), 0, { applyTimes: true });
  strictEqual(tickAllTimes(timesTicked, changed), timesTicked, 'changed since, ticked by hand: kept, and nothing to tick');
  const repeats = loadedListPastedTwice();
  const repeatsDraft = initialDraft(repeats);
  const addsTicked = { ...repeatsDraft, adds: repeatsDraft.adds.map((add) => ({ ...add, apply: true })) };
  strictEqual(tickAllAdds(addsTicked, repeats), addsTicked, 'the repeats, ticked by hand: kept, and nothing to tick');

  // Beside the rows it ticks again: of the ichii correction with nothing ticked, the pair whose times agree, which opens
  // unticked, ticked by hand with an end typed, keeps its tick and its end, while 全選時間 ticks the other five.
  const agreeing = viewAfter((v) => {
    v.proposed[1] = { ...need(v.proposed[1], 'proposed 1'), endTimestamp: 1621 };
  });
  const worked = withPair(untickedAll(initialDraft(agreeing)), 1, { applyTimes: true, endTimestamp: 1700 });
  const ticked = tickAllTimes(worked, agreeing);
  deepStrictEqual(ticked.pairs.map((pair) => pair.applyTimes), [true, true, true, true, true, true], 'every pair ticked');
  deepStrictEqual(ticked.pairs[1], worked.pairs[1], 'the one ticked by hand as the curator left it');
  deepStrictEqual(draftOperations(ticked, agreeing).operations[1], { op: 'setTimes', performanceId: 'p2', endTimestamp: 1700 }, 'its typed end is sent');
}

function testTheTickAllHelpersReadTheViewOnce(): void {
  // The page asks both on every render, to know whether its buttons would change anything: each reads the view's base
  // once per call, and as much of it for 40 rows as for 10.
  const readsOf = (shape: { pairs: number; gone: number }): Record<'tickAllTimes' | 'tickAllAdds', ReadCounts> => {
    const { view, reads, reset } = countedReadsView(shape);
    const draft = untickedAll(initialDraft(view));
    const measured = (run: () => unknown): ReadCounts => {
      reset();
      run();
      return reads();
    };
    return { tickAllTimes: measured(() => tickAllTimes(draft, view)), tickAllAdds: measured(() => tickAllAdds(draft, view)) };
  };
  for (const [what, small, large] of [
    ['moved pairs', { pairs: 10, gone: 0 }, { pairs: 40, gone: 0 }],
    ['rows gone since', { pairs: 0, gone: 10 }, { pairs: 0, gone: 40 }],
  ] as const) {
    const counts = readsOf(small);
    for (const [name, read] of Object.entries(counts)) {
      strictEqual(read.base, 1, `${what}: ${name} reads the view's base once per call`);
      strictEqual(read.baseTitle > 0, true, `${what}: ${name} reads the base titles, or the count below proves nothing`);
    }
    deepStrictEqual(readsOf(large), counts, `${what}: the same reads for 40 as for 10`);
  }
}

// --- The shared vectors (admin/tests/fixtures, which Nova's tests run too) ---

interface VectorRow { title: string; artist: string; start: number; end: number | null }

const sharedVectors = <T>(file: string): T =>
  JSON.parse(readFileSync(new URL(`../../tests/fixtures/${file}`, import.meta.url), 'utf8')) as T;

const fieldsOf = (vectorRow: VectorRow, end = vectorRow.end): RowFields => row(vectorRow.title, vectorRow.artist, vectorRow.start, end);

/** The row as the Shared definitions match it: trimmed title, artist (blank = Unknown), start. */
const vectorKey = (vectorRow: VectorRow): string => JSON.stringify([vectorRow.title.trim(), vectorRow.artist.trim() || 'Unknown', vectorRow.start]);

/** The position in `view.proposed` of the row submitted at `index` (submittedRows names it `v{index + 1}`). */
function submittedAt(proposed: readonly CorrectionProposedRow[], proposedIndex: number): number {
  return Number(need(proposed[proposedIndex], 'the proposed row').id.slice(1)) - 1;
}

function testTheYieldVectors(): void {
  // `ends` is what Nova stores once its restore ran: the review reads those rows against a stream that is still the
  // archive, with no base and with the archive as its base. Nova's restore reaches a row that matches archived rows
  // agreeing on one end; for each such row, paired with that archived row, the end the review proposes is the stored
  // one. A row Nova left alone (moved, new, or matching archived rows that end apart) keeps its own end there, which
  // the review reads by its own rule.
  const vectors = sharedVectors<Array<{ name: string; archived: VectorRow[]; submitted: VectorRow[]; ends: Array<number | null> }>>('yield-vectors.json');
  strictEqual(vectors.length >= 8, true, 'the six outcomes, the conflicting-ends key and the nested case, at least');
  for (const vector of vectors) {
    const current = vector.archived.map((archived, index) => liveRow(`p${index + 1}`, fieldsOf(archived)));
    const stored = vector.submitted.map((submitted, index) => fieldsOf(submitted, vector.ends[index] ?? null));
    const restored = (submitted: VectorRow): boolean => {
      const ends = new Set(vector.archived.filter((archived) => vectorKey(archived) === vectorKey(submitted)).map((archived) => archived.end));
      return ends.size === 1;
    };
    const expected = vector.submitted.flatMap((submitted, index) => (restored(submitted) ? [index] : []));
    strictEqual(expected.length > 0, true, `${vector.name}: the restore reaches a row`);
    for (const base of [null, vector.archived.map((archived, index) => baseRow(`p${index + 1}`, fieldsOf(archived)))]) {
      const view = correctionView({ base, current, proposed: stored });
      const reached = initialDraft(view).pairs.flatMap((pair) => {
        const index = submittedAt(view.proposed, pair.proposedIndex);
        const submitted = need(vector.submitted[index], 'the submitted row');
        if (!restored(submitted)) return [];
        const live = need(view.current[pair.currentIndex], 'the paired row');
        const archived = need(vector.archived[pair.currentIndex], 'the archived row');
        strictEqual(vectorKey(archived), vectorKey(submitted), `${vector.name}: row ${index} pairs with the archived row it matches`);
        strictEqual(pair.endTimestamp, vector.ends[index], `${vector.name}, ${base ? 'the archive as base' : 'no base'}: row ${index} (${live.title})`);
        return [index];
      });
      deepStrictEqual(reached.sort((left, right) => left - right), expected, `${vector.name}: every row the restore reaches pairs`);
    }
  }
}

/**
 * A vector's rows as Nova's submit route stores them (tools/nova/src/index.ts, its parse loop). A row with a blank title
 * is dropped. A kept row whose end is the start of the dropped row right below it (the end the parsers filled from that
 * row) takes the next kept row's start instead, or none when no kept row follows.
 */
function storedAsNovaStoresThem(rows: VectorRow[]): VectorRow[] {
  const stored: VectorRow[] = [];
  let keptAt = -1;
  let refilled: VectorRow | null = null;
  for (const [index, row] of rows.entries()) {
    if (row.title.trim() === '') {
      const above = stored[stored.length - 1];
      if (above !== undefined && keptAt === index - 1 && above.end === row.start) {
        above.end = null;
        refilled = above;
      }
      continue;
    }
    if (refilled !== null) {
      refilled.end = row.start;
      refilled = null;
    }
    stored.push({ ...row });
    keptAt = index;
  }
  return stored;
}

function testTheDerivedEndVectors(): void {
  // The cases the route marks (endFilled) and Nova restores: against a stream whose rows end elsewhere (30 s in), a
  // derived end proposes the stream's, and any other the submitted one. The next rows all match the stream, so no
  // derived end yields. The rows are the ones Nova stores (storedAsNovaStoresThem).
  const vectors = sharedVectors<Array<{ name: string; rows: VectorRow[]; derived: boolean[] }>>('derived-end-vectors.json');
  for (const vector of vectors) {
    const stored = storedAsNovaStoresThem(vector.rows);
    const current = [...stored].sort((left, right) => left.start - right.start)
      .map((submitted, index) => liveRow(`p${index + 1}`, fieldsOf(submitted, submitted.start + 30)));
    const view = correctionView({ base: null, current, proposed: stored.map((submitted) => fieldsOf(submitted)) });
    let reached = 0;
    for (const pair of initialDraft(view).pairs) {
      const index = submittedAt(view.proposed, pair.proposedIndex);
      const submitted = need(stored[index], 'the stored row');
      const live = need(view.current[pair.currentIndex], 'the paired row');
      if (live.title !== submitted.title || live.timestamp !== submitted.start) continue;
      reached += 1;
      strictEqual(pair.endTimestamp, vector.derived[index] ? live.endTimestamp : submitted.end, `${vector.name}: row ${index}`);
    }
    strictEqual(reached > 0, true, `${vector.name}: some row pairs with its own`);
  }
}

// --- Total and pure ---

function testOutOfRangeIndicesChangeNothing(): void {
  const view = ichiiCorrectionView();
  const draft = initialDraft(view);
  strictEqual(unpair(draft, view, -1), draft);
  strictEqual(unpair(draft, view, 6), draft);
  strictEqual(pairWith(draft, view, 0, 0), draft, 'the draft has no add to pair');
  const split = unpair(draft, view, 0);
  strictEqual(pairWith(split, view, 1, 0), split, 'one add');
  strictEqual(pairWith(split, view, 0, 2), split, 'two deletes');
  strictEqual(pairWith(split, view, -1, 0), split);
}

function testRowsTheViewLacksAreLeftOut(): void {
  const view = ichiiCorrectionView();
  const pair = need(initialDraft(view).pairs[0], 'pair 0');
  const dangling: CorrectionDraft = {
    pairs: [{ ...pair, currentIndex: 99 }, { ...pair, proposedIndex: 99 }],
    adds: [],
    deletes: [{ currentIndex: 99, apply: true }],
  };
  deepStrictEqual(draftOperations(dangling, view), {
    operations: [], skipped: NOTHING_SKIPPED, appliedCount: 0, skippedCount: 0, needsEndCount: 0, canApply: false,
  });
  deepStrictEqual(draftFlags(dangling, view), { pairs: [NO_FLAGS, NO_FLAGS], adds: [], deletes: [NO_FLAGS] }, 'and flag nothing');
  strictEqual(unpair(dangling, view, 1), dangling, 'a pair whose proposed row is gone cannot become an add');
}

function testNothingIsMutated(): void {
  const view = ichiiCorrectionView();
  const draft = initialDraft(view);
  const viewBefore = structuredClone(view);
  const draftBefore = structuredClone(draft);
  const split = unpair(draft, view, 0);
  const splitBefore = structuredClone(split);
  pairWith(split, view, 0, 0);
  draftOperations(split, view);
  deepStrictEqual(view, viewBefore);
  deepStrictEqual(draft, draftBefore);
  deepStrictEqual(split, splitBefore);
}

// --- The shared yield rule, given the starts of the rows the next row is matched with ---

function testYieldedEndWeighsTheNextRowAgainstTheStartsItIsGiven(): void {
  // First's end is the parser's fill (it is Second's start), so it is derived. Whether it gives way to the reference end
  // depends on whether Second starts at one of the starts. Each reference row starts where the submitted row does, so
  // none of them was moved past its end.
  const proposed = submittedRows([row('First', 'A', 100, 300), row('Second', 'B', 300, 400)]);
  const stillThere = referenceStarts([row('Second', 'B', 300, 999)]);
  const moved = referenceStarts([row('Second', 'B', 310, 400)]);
  const endingAt = (timestamp: number, endTimestamp: number | null) => ({ timestamp, endTimestamp });
  strictEqual(yieldedEnd(proposed, 0, endingAt(100, 350), stillThere), 350, 'a next row at a reference start: the reference end comes back, though it overlaps');
  strictEqual(yieldedEnd(proposed, 0, endingAt(100, 350), moved), 300, 'a next row that moved, and a reference end past its start: the submitted end stands');
  strictEqual(yieldedEnd(proposed, 0, endingAt(100, 250), moved), 250, 'a moved next row the reference end stops short of: the reference end');
  strictEqual(yieldedEnd(proposed, 0, endingAt(100, null), moved), null, 'a reference with no end always comes back');
  strictEqual(yieldedEnd(proposed, 1, endingAt(300, 500), moved), 400, 'an end the contributor gave stays');
  strictEqual(yieldedEnd(proposed, 7, endingAt(100, 123), moved), 123, 'a row the list lacks keeps the reference end');

  // Only a row's start counts: a title or artist edit is no move, and the end is no part of it.
  const blank = submittedRows([row('First', 'A', 100, 300), row('Second', '', 300, 400)]);
  strictEqual(yieldedEnd(blank, 0, endingAt(100, 350), referenceStarts([row(' Second ', 'Unknown', 300, 5)])), 350, 'the start matches, whatever the title, artist and end');
  strictEqual(referenceStarts([row('A', 'X', 1, 2), row(' A ', '', 1, 9), row('A', 'Unknown', 1, 3)]).size, 1, 'one start for rows that start together');
}

function testDraftSuggestionsAreSuggestedChangesOfEachPair(): void {
  // What each pair of a draft suggests is the same asked for all of them (the view read once) as asked for one at a
  // time: with no base, with one, with a row the submission leaves untouched, and with rows gone since.
  const untouchedAndMoved = correctionView({
    base: LOADED,
    current: [liveRow('p1', SONG_A), liveRow('p2', row('Song B', 'Artist', 310, 400))],
    proposed: [SONG_A, row('Song B', 'Artist', 305, 400)],
  });
  for (const view of [ichiiCorrectionView(), startOnlyCorrectionView(), untouchedAndMoved, countedReadsView({ pairs: 6, gone: 2 }).view]) {
    const draft = initialDraft(view);
    strictEqual(draft.pairs.length > 0, true, 'the view has pairs');
    deepStrictEqual(
      draftSuggestions(draft, view),
      draft.pairs.map((pair) => suggestedChanges(view, pair.currentIndex, pair.proposedIndex)),
    );
  }
  deepStrictEqual(draftSuggestions(initialDraft(untouchedAndMoved), untouchedAndMoved), [
    { start: false, end: false, title: false, artist: false },
    { start: true, end: false, title: false, artist: false },
  ], 'the untouched row suggests nothing, the moved one a start change');

  // A pair whose row the view lacks has no suggestion, as for suggestedChanges.
  const view = ichiiCorrectionView();
  const pair = need(initialDraft(view).pairs[0], 'pair 0');
  const dangling: CorrectionDraft = { pairs: [{ ...pair, currentIndex: 99 }, pair, { ...pair, proposedIndex: 99 }], adds: [], deletes: [] };
  deepStrictEqual(draftSuggestions(dangling, view), [null, suggestedChanges(view, pair.currentIndex, pair.proposedIndex), null]);
  deepStrictEqual(draftSuggestions({ pairs: [], adds: [], deletes: [] }, view), []);
}

// --- A view is read once per call, not once per row ---

/** What each draft function that works over a draft's rows read of a review of `pairs` pairs and `gone` rows gone since. */
function readsPerFunction(
  shape: { pairs: number; gone: number },
): Record<'initialDraft' | 'draftOperations' | 'draftFlags' | 'draftSuggestions', ReadCounts> {
  const { view, reads, reset } = countedReadsView(shape);
  const draft = initialDraft(view);
  strictEqual(draft.pairs.length, shape.pairs, 'a pair for each live row');
  strictEqual(draft.adds.length, shape.gone, 'an add for each row gone since');
  strictEqual(draft.adds.some((add) => add.apply), false, 'every one of them starts unticked, so the apply reads it against the base');
  const measured = (run: () => unknown): ReadCounts => {
    reset();
    run();
    return reads();
  };
  return {
    initialDraft: measured(() => initialDraft(view)),
    draftOperations: measured(() => draftOperations(draft, view)),
    draftFlags: measured(() => draftFlags(draft, view)),
    draftSuggestions: measured(() => draftSuggestions(draft, view)),
  };
}

function testAViewIsReadOncePerCallNotOncePerRow(): void {
  // The shapes do what they are built for: a moved pair works out its end, and each unticked add that stands for a row
  // gone since reads its end against the base (and skips a time change).
  const moved = countedReadsView({ pairs: 10, gone: 0 }).view;
  strictEqual(draftOperations(initialDraft(moved), moved).appliedCount, 10, 'ten pairs with a time change each');
  const goneSince = countedReadsView({ pairs: 0, gone: 10 }).view;
  deepStrictEqual(draftOperations(initialDraft(goneSince), goneSince).skipped, { time: 10, title: 0, add: 0, delete: 0 });

  // Each pair's end is read against the starts of the rows its next row is matched with, and each add's against the
  // base's. Neither may be worked out again for every row: the page asks on every render. Each function reads the
  // view's base once per call, and the counters must see what they count, or the equalities could hold over counts of
  // nothing: the moved pairs read the titles of the base and the live rows, the rows gone since those of the base.
  const small = readsPerFunction({ pairs: 10, gone: 0 });
  for (const [name, counts] of Object.entries(small)) {
    strictEqual(counts.base, 1, `${name} reads the view's base once per call`);
    strictEqual(counts.baseTitle > 0 && counts.liveTitle > 0, true, `${name} reads the base and live titles, or the counts below prove nothing`);
  }
  deepStrictEqual(readsPerFunction({ pairs: 40, gone: 0 }), small, 'moved pairs: the same reads for 40 pairs as for 10');
  const goneSmall = readsPerFunction({ pairs: 0, gone: 10 });
  for (const [name, counts] of Object.entries(goneSmall)) {
    strictEqual(counts.base, 1, `rows gone since: ${name} reads the view's base once per call`);
    strictEqual(counts.baseTitle > 0, true, `rows gone since: ${name} reads the base titles, or the count below proves nothing`);
  }
  deepStrictEqual(readsPerFunction({ pairs: 0, gone: 40 }), goneSmall, 'rows gone since: the same reads for 40 as for 10');
}

function main(): void {
  testInitialDraftAppliesSixTimeEdits();
  testPairOneChangesOnlyItsEnd();
  testTickingTheDeleteAddsIt();
  testRenamingThePairsSong();
  testUnpairingMakesAnAddAndADelete();
  testPairingWithRestoresThePair();
  testInitialDraftDefaults();
  testInitialDraftSendsOnlyWhatDiffers();
  testSuggestedAddsStartApplied();
  testAPairWhoseTimesAgreeStartsUnticked();
  testTimesCarryOnlyWhatDiffers();
  testNullIsAValueForTheEnd();
  testUntickedTimesAreSkipped();
  testEditingTimesBackToTheCurrentOnesSendsNothing();
  testAnUntickedEditNobodySuggestedIsNotSkipped();
  testInvertedTimesAreStillSent();
  testStartOnlyRowsProposeNoEnds();
  testADerivedEndLeavesTheEndAsItIs();
  testAShiftedStartOnlyListKeepsLengthsUnderHalf();
  testARowMovedPastItsOwnEndKeepsItsLength();
  testARowMovedBackAcrossAnUnmovedRowKeepsItsLength();
  testAHandPairAcrossALongMoveNeverInverts();
  testAnArtistDifferenceIsASkippedTitleToo();
  testRenameCarriesOnlyTheFieldsThatDiffer();
  testRenameMayFixOnlyCaseOrSpacing();
  testRenameReadsTheTextTrimmed();
  testARenameThatChangesNothingIsNoOperation();
  testRelinkChoices();
  testRelinkOperationsCarryTheStatusShown();
  testATypedOverRelinkSendsNoExpectedStatus();
  testAPendingIdentityOnAStreamThatIsNotApprovedSendsItsRealStatus();
  testAddsAreTrimmedAndAnEmptyArtistIsUnknown();
  testABlankArtistAddBorrowsTheOnlyLiveArtistWithASong();
  testTwoCandidateArtistsLeaveTheArtistBlank();
  testABorrowedArtistLandsOnTheSongItNames();
  testEverySuggestionBecomesItsOwnVariant();
  testRePairingKeepsTheListsSorted();
  testRePairingResetsToTheProposedRow();
  testRePairingRecomputesTheTimeDefault();
  testAFixAppliedSinceIsNotTickedBack();
  testAFixThatMovedTheRowFarIsNotTickedBack();
  testAHiddenRowIsNeverASuggestedDelete();
  testAnOutOfOrderLineLeavesAlphasEndAlone();
  testATickedRowWithNoEndHoldsTheApply();
  testAnAddWithNoEndNeedsOneOnlyOnAnApprovedStream();
  testAClearedEndNeedsOneOnEveryStream();
  testARelinkThatPublishesARowNeedsItsEnd();
  testOnlyARelinkThatPublishesNeedsAnEnd();
  testANullEndBeforeAMovedRowNeedsAnEnd();
  testAnAddOntoAPendingSongWithAnEndlessRowHereHoldsTheApply();
  testSparingThatRowReleasesTheHold();
  testARelinkOfAHiddenRowHoldsNothingAndShowsNoHint();
  testPromotedSongsAreThePendingSongsATickedAddOrAChoiceLandsOn();
  testAPendingHintShowsWhateverTheBlankArtistIsSpelled();
  testAMoveByAnotherCorrectionMakesNoEndChange();
  testAMoveByAnotherCorrectionNeedsNoEnd();
  testANextRowAtItsBasePositionIsNotMovedEvenWhenChanged();
  testARenamedNextRowLeavesTheEndBeforeItAlone();
  testAnUntouchedRowWhosePerformanceIsGoneIsNoAdd();
  testARowChangedSinceIsNeverTicked();
  testARowTheContributorNeverSawIsMarked();
  testAPipelineCorrectionSawNothing();
  testAnOnSiteRowTheContributorNeverSawStartsUnticked();
  testAFixOfARowChangedSinceIsNoAdd();
  testALeftOutAddCountsWhatTheContributorChanged();
  testPairingFollowsTheBaseWhereAHiddenRowCutsAnOpenEnd();
  testWithNothingChangedSinceTheBaseChangesNoDefault();
  testARowTheContributorDroppedIsStillOffered();
  testWithNoBaseAnOffSiteRowIsNoSuggestedDelete();
  testALoadedListPastedTwiceAddsNothingByDefault();
  testADuplicatedLineIsARepeat();
  testAnOwnCopyWithATypedEndThatSortsFirstRepeatsTheKeptRow();
  testAStartOnlyOwnCopyThatSortsFirstRepeatsTheKeptRow();
  testAnEncoreIsNoRepeat();
  testANewSongTypedTwiceIsAddedOnce();
  testTheRepeatMarkFollowsThePairing();
  testASplitOffRowStartsAgainstThePairingThatRemains();
  testTickAllTimesRestoresTodaysDefaults();
  testTickAllAddsRestoresTodaysDefaults();
  testTickAllLeavesHeldByTodaysRulesUnticked();
  testSelectAllNeverUnticksACuratorsTick();
  testTheTickAllHelpersReadTheViewOnce();
  testTheYieldVectors();
  testTheDerivedEndVectors();
  testOutOfRangeIndicesChangeNothing();
  testRowsTheViewLacksAreLeftOut();
  testNothingIsMutated();
  testYieldedEndWeighsTheNextRowAgainstTheStartsItIsGiven();
  testDraftSuggestionsAreSuggestedChangesOfEachPair();
  testAViewIsReadOncePerCallNotOncePerRow();
  console.log('✓ the review draft starts from the suggested pairing, reads the base three ways, re-pairs, and converts to exactly the operations the apply API takes');
}

main();
