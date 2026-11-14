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
import { matchCorrection } from '../../shared/vod-correction';
import type { NovaVodCorrectionView } from '../../shared/vod-correction';
import { draftOperations, initialDraft, pairWith, suggestedChanges, unpair } from '../src/lib/vod-correction-draft';
import type { AddDraft, CorrectionDraft, DeleteDraft, PairDraft, TitleChoice } from '../src/lib/vod-correction-draft';
import { ichiiCorrectionView, startOnlyCorrectionView } from './fixtures/vod-correction';

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

function testSuggestedAddsStartApplied(): void {
  // A proposed row the matcher left unpaired is an add, ticked; a current one is a delete, unticked.
  const view = viewAfter((v) => {
    v.proposed.push({ id: 'v7', title: 'Moon Dance', originalArtist: '', timestamp: 6000, endTimestamp: null, existingSong: null });
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
  deepStrictEqual(toExisting.operations.find((operation) => operation.op === 'relinkToSong'), { op: 'relinkToSong', performanceId: 'p1', songId: 's9' });
  strictEqual(toExisting.skipped.title, 0, 'a relink settles the suggested title change');

  const toNew = draftOperations(withPair(draft, 0, { title: { kind: 'relinkNew', title: ' Late Night Drive ', originalArtist: '' } }), view);
  deepStrictEqual(toNew.operations.find((operation) => operation.op === 'relinkToNewSong'), {
    op: 'relinkToNewSong', performanceId: 'p1', title: 'Late Night Drive', originalArtist: 'Unknown',
  });
  strictEqual(toNew.skipped.title, 0);
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
    { op: 'relinkToSong', performanceId: 'p2', songId: 's9' },
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
  deepStrictEqual(draftOperations(dangling, view), { operations: [], skipped: NOTHING_SKIPPED, appliedCount: 0, skippedCount: 0 });
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
  testAnArtistDifferenceIsASkippedTitleToo();
  testRenameCarriesOnlyTheFieldsThatDiffer();
  testRenameMayFixOnlyCaseOrSpacing();
  testRenameReadsTheTextTrimmed();
  testARenameThatChangesNothingIsNoOperation();
  testRelinkChoices();
  testAddsAreTrimmedAndAnEmptyArtistIsUnknown();
  testEverySuggestionBecomesItsOwnVariant();
  testRePairingKeepsTheListsSorted();
  testRePairingResetsToTheProposedRow();
  testRePairingRecomputesTheTimeDefault();
  testOutOfRangeIndicesChangeNothing();
  testRowsTheViewLacksAreLeftOut();
  testNothingIsMutated();
  console.log('✓ the review draft starts from the suggested pairing, re-pairs, and converts to exactly the operations the apply API takes');
}

main();
