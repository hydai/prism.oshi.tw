/**
 * The default-tick guard (vod-correction-guard.ts): which of the ticks `initialDraft` opens a review with the guard
 * holds back, and the reason it records for each. Each test builds a small review with the fixture helpers. Unless it
 * says otherwise the contributor loaded the list before editing it, so the base is the live list and a revision
 * confirmed it (`loadedView`).
 *
 * A reason is keyed by pair (`${currentIndex}:${proposedIndex}`) or by add (its proposed index), and only a row the
 * guard unticked has one: a row today's rules open unticked has none. The reason maps are compared as Maps, so a key
 * of the wrong type fails.
 */
import { deepStrictEqual, notStrictEqual, strictEqual } from 'node:assert/strict';
import type { CorrectionCurrentRow, NovaVodCorrectionView } from '../../shared/vod-correction';
import { initialDraft, pairWith } from '../src/lib/vod-correction-draft';
import type { CorrectionDraft, PairDraft } from '../src/lib/vod-correction-draft';
import { GUARD_LIMITS, guardDraft, guardedInitialDraft } from '../src/lib/vod-correction-guard';
import type { GuardReason } from '../src/lib/vod-correction-guard';
import { baseRow, correctionView, ichiiCorrectionView, liveRow, row, type RowFields } from './fixtures/vod-correction';

// --- Helpers ---

/** The value, or a failure naming what the test expected to find: `noUncheckedIndexedAccess` is on. */
function need<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`the test needs ${what}`);
  return value;
}

/** The live rows `p1`, `p2`, … of `fields`, as given (give them in time order). */
const liveRows = (fields: readonly RowFields[]): CorrectionCurrentRow[] =>
  fields.map((song, index) => liveRow(`p${index + 1}`, song));

/**
 * The review of `proposed` (in the order submitted) against live rows `current` (in time order), for a contributor who
 * loaded the list before editing it: the base is the live list, and a revision confirmed it.
 */
function loadedView(current: readonly RowFields[], proposed: readonly RowFields[]): NovaVodCorrectionView {
  const view = correctionView({
    base: current.map((song, index) => baseRow(`p${index + 1}`, song)),
    current: liveRows(current),
    proposed,
  });
  view.baseVerified = true;
  return view;
}

/**
 * The review of `proposed` on a pipeline stream: the stream and its rows `current` are pending, so the site shows none
 * of them, and the list the contributor loaded was empty (a base of no rows, which its revision confirmed).
 */
function pipelineView(current: readonly RowFields[], proposed: readonly RowFields[]): NovaVodCorrectionView {
  const view = correctionView({
    base: [],
    current: current.map((song, index) => liveRow(`p${index + 1}`, song, 'pending', 'pending')),
    proposed,
  });
  view.baseVerified = true;
  view.stream = { ...view.stream, status: 'pending' };
  return view;
}

/** `count` songs, `Song 1` by `Artist 1` and so on, each `seconds` long, one every `stride` s from `first`. */
function songList(count: number, { first = 100, stride = 300, seconds = 240 } = {}): RowFields[] {
  return Array.from({ length: count }, (_, index) => {
    const start = first + index * stride;
    return row(`Song ${index + 1}`, `Artist ${index + 1}`, start, start + seconds);
  });
}

/** `song` moved by `seconds`, its start and its end. */
const moved = (song: RowFields, seconds: number): RowFields =>
  row(song.title, song.originalArtist, song.timestamp + seconds, song.endTimestamp === null ? null : song.endTimestamp + seconds);

const keyOf = (pair: PairDraft): string => `${pair.currentIndex}:${pair.proposedIndex}`;

/** Each pair's time tick by its key, and each add's tick by its proposed index: the ticks the guard may take back. */
function ticks(draft: CorrectionDraft): { pairs: Record<string, boolean>; adds: Record<string, boolean> } {
  return {
    pairs: Object.fromEntries(draft.pairs.map((pair) => [keyOf(pair), pair.applyTimes])),
    adds: Object.fromEntries(draft.adds.map((add) => [add.proposedIndex, add.apply])),
  };
}

const UNVERIFIED: GuardReason = { kind: 'unverifiedBase' };
const PASTED: GuardReason = { kind: 'pastedList' };
const PARTIAL: GuardReason = { kind: 'partialList' };
const REPEAT: GuardReason = { kind: 'repeatAdd' };
const overlapWith = (withTitle: string): GuardReason => ({ kind: 'overlap', withTitle });
const farMove = (seconds: number): GuardReason => ({ kind: 'farMove', seconds });
const otherSong = (seconds: number): GuardReason => ({ kind: 'otherSong', seconds });

const ALPHA = row('Alpha', 'Artist A', 100, 340);
const BRAVO = row('Bravo', 'Artist B', 400, 640);

/**
 * Against Alpha and Bravo: Alpha 30 s later, Bravo as it is, Bravo again inside it (an add that repeats the row, so
 * today's rules open it unticked), and November, a new song (an add they open ticked).
 */
const ALPHA_MOVED_AND_TWO_ADDS = [moved(ALPHA, 30), BRAVO, row('Bravo', 'Artist B', 420, 600), row('November', 'Artist N', 700, 900)];

// --- Rule 1: a base no revision confirmed ---

function testNoBaseTicksNothing(): void {
  // The ichii correction: Nova recorded no base for it, so no revision confirmed one either. Today its six time edits
  // open ticked; with no base, none does.
  const ichii = ichiiCorrectionView();
  strictEqual(initialDraft(ichii).pairs.filter((pair) => pair.applyTimes).length, 6, 'today the six time edits open ticked');
  const held = guardedInitialDraft(ichii);
  strictEqual(held.guard.banner, 'baseMissing');
  deepStrictEqual(ticks(held.draft), {
    pairs: { '0:0': false, '1:1': false, '3:2': false, '4:3': false, '5:4': false, '6:5': false },
    adds: {},
  });
  deepStrictEqual(held.guard.pairs, new Map(['0:0', '1:1', '3:2', '4:3', '5:4', '6:5'].map((key) => [key, UNVERIFIED])));
  deepStrictEqual(held.guard.adds, new Map());
  deepStrictEqual(held.draft.deletes, initialDraft(ichii).deletes, 'the delete is left as it was');

  // No base is no base, whatever the flag says. November's add is held too. What today's rules open unticked gets no
  // reason: Bravo's pair, which the contributor did not change, and the second Bravo's add, which repeats the row.
  const view = correctionView({ base: null, current: liveRows([ALPHA, BRAVO]), proposed: ALPHA_MOVED_AND_TWO_ADDS });
  view.baseVerified = true;
  deepStrictEqual(ticks(initialDraft(view)), { pairs: { '0:0': true, '1:1': false }, adds: { 2: false, 3: true } }, 'today');
  const { draft, guard } = guardedInitialDraft(view);
  strictEqual(guard.banner, 'baseMissing');
  deepStrictEqual(ticks(draft), { pairs: { '0:0': false, '1:1': false }, adds: { 2: false, 3: false } });
  deepStrictEqual(guard.pairs, new Map([['0:0', UNVERIFIED]]));
  deepStrictEqual(guard.adds, new Map([[3, UNVERIFIED]]));
}

function testAnUnverifiedBaseTicksNothing(): void {
  // A base, but no revision confirmed it is what the contributor saw: nothing opens ticked either.
  const view = loadedView([ALPHA, BRAVO], ALPHA_MOVED_AND_TWO_ADDS);
  view.baseVerified = false;
  const { draft, guard } = guardedInitialDraft(view);
  strictEqual(guard.banner, 'baseUnverified');
  deepStrictEqual(ticks(draft), { pairs: { '0:0': false, '1:1': false }, adds: { 2: false, 3: false } });
  deepStrictEqual(guard.pairs, new Map([['0:0', UNVERIFIED]]));
  deepStrictEqual(guard.adds, new Map([[3, UNVERIFIED]]));

  // Confirmed, the same review opens with Alpha's move and November's add ticked.
  const confirmed = guardedInitialDraft({ ...view, baseVerified: true });
  strictEqual(confirmed.guard.banner, null);
  deepStrictEqual(ticks(confirmed.draft), { pairs: { '0:0': true, '1:1': false }, adds: { 2: false, 3: true } });
}

/** A stream of four songs with Lemon second, 600–840 (r3 #3's). */
const LEMON_STREAM = [row('Alpha', 'X', 100, 340), row('Lemon', '米津玄師', 600, 840), row('Bravo', 'Y', 1200, 1440), row('Charlie', 'Z', 1800, 2040)];

function testAnUnverifiedReviewStillMarksAFarMove(): void {
  // r3 #3 from a contributor who did not load the list where they sent it from: one line, Lemon an hour and twenty
  // minutes later. Nothing opens ticked, as with any base no revision confirmed, but the other checks still run over the
  // ticks the review would open with, so the row says why it would be held, its far move, not only that the base is
  // unconfirmed. The list leaves out three of the four rows, a partial list too, but the base's banner is the one shown.
  const view = loadedView(LEMON_STREAM, [row('Lemon', '米津玄師', 5400, 5640)]);
  view.baseVerified = false;
  deepStrictEqual(ticks(initialDraft(view)).pairs, { '1:0': true }, 'today the far move opens ticked');
  const { draft, guard } = guardedInitialDraft(view);
  strictEqual(guard.banner, 'baseUnverified');
  deepStrictEqual(ticks(draft).pairs, { '1:0': false });
  deepStrictEqual(guard.pairs, new Map([['1:0', farMove(4800)]]));

  // With no base at all, the same.
  const noBase = guardedInitialDraft(correctionView({ base: null, current: liveRows(LEMON_STREAM), proposed: [row('Lemon', '米津玄師', 5400, 5640)] }));
  strictEqual(noBase.guard.banner, 'baseMissing');
  deepStrictEqual(ticks(noBase.draft).pairs, { '1:0': false });
  deepStrictEqual(noBase.guard.pairs, new Map([['1:0', farMove(4800)]]));

  // A row no check holds keeps the base's reason: of ten rows moved 30 s, the one typed an hour later is the far move.
  const live = songList(10);
  const shifted = loadedView(live, live.map((song, index) => moved(song, index === 4 ? 3600 : 30)));
  shifted.baseVerified = false;
  const mixed = guardedInitialDraft(shifted);
  deepStrictEqual(mixed.draft.pairs.filter((pair) => pair.applyTimes).map(keyOf), [], 'nothing opens ticked');
  deepStrictEqual(mixed.guard.pairs, new Map([
    ...['0:0', '1:1', '2:2', '3:3', '5:4', '6:5', '7:6', '8:7', '9:8'].map((key): [string, GuardReason] => [key, UNVERIFIED]),
    ['4:9', farMove(3570)],
  ]));
}

function testAnUnverifiedReviewStillMarksAPastedList(): void {
  // The loaded list pasted again under itself (`testAPastedListIsHeld`), from a contributor who did not load it where
  // they sent it from: nothing opens ticked, and every copy says it looks pasted twice, not that the base is unconfirmed.
  const live = songList(4);
  const view = loadedView(live, [
    ...live,
    row('Song 1 (copy)', 'Artist 1', 60, 360),
    row('Song 2 (copy)', 'Artist 2', 360, 660),
    row('Song 3 (copy)', 'Artist 3', 660, 960),
    row('Song 4 (copy)', 'Artist 4', 960, null),
  ]);
  view.baseVerified = false;
  const { draft, guard } = guardedInitialDraft(view);
  deepStrictEqual(ticks(draft).adds, { 0: false, 2: false, 4: false, 6: false });
  deepStrictEqual(guard.adds, new Map([[0, PASTED], [2, PASTED], [4, PASTED], [6, PASTED]]));
  deepStrictEqual(guard.pairs, new Map());
}

function testAnUnverifiedPastedListKeepsTheRuleOneBanner(): void {
  // Three adds, each 120 s before one of three live rows: a second list. Confirmed, the banner says so. With no
  // revision, or no base, the base's banner is the one shown: it says more, as nothing at all opens ticked.
  const live = songList(3, { first: 1000, stride: 1000 });
  const proposed = [...live, ...live.map((song, index) => row(`Extra ${index + 1}`, 'Artist E', song.timestamp - 120, song.timestamp - 60))];
  const view = loadedView(live, proposed);
  strictEqual(guardedInitialDraft(view).guard.banner, 'pastedList', 'confirmed, it looks pasted twice');
  view.baseVerified = false;
  const unconfirmed = guardedInitialDraft(view);
  strictEqual(unconfirmed.guard.banner, 'baseUnverified');
  deepStrictEqual(unconfirmed.guard.adds, new Map([[0, PASTED], [2, PASTED], [4, PASTED]]), 'each add still says why');
  strictEqual(guardedInitialDraft(correctionView({ base: null, current: liveRows(live), proposed })).guard.banner, 'baseMissing');
}

function testAnUnverifiedPartialListStillMarksItsMoves(): void {
  // The lone encore (`testALoneEncoreAfterLoadingIsHeld`) from a contributor who did not load the list there: the list
  // leaves out three of the four base rows, so the move says it comes from a partial list. With no base there is no
  // list to have left rows out of, and the move keeps the base's reason.
  const view = loadedView(LEMON_STREAM, [row('Lemon', '米津玄師', 840, 1080)]);
  view.baseVerified = false;
  const { draft, guard } = guardedInitialDraft(view);
  strictEqual(guard.banner, 'baseUnverified');
  deepStrictEqual(ticks(draft).pairs, { '1:0': false });
  deepStrictEqual(guard.pairs, new Map([['1:0', PARTIAL]]));
  const noBase = guardedInitialDraft(correctionView({ base: null, current: liveRows(LEMON_STREAM), proposed: [row('Lemon', '米津玄師', 840, 1080)] }));
  strictEqual(noBase.guard.banner, 'baseMissing');
  deepStrictEqual(noBase.guard.pairs, new Map([['1:0', UNVERIFIED]]));
}

// --- Rule 2: a time change that moves a row far, or changes its length a lot ---

function testAUniformShiftStaysTicked(): void {
  // Ten rows, every one 30 s later with its end typed: a list shifted as one. The typical shift is 30, so none moved far.
  const live = songList(10);
  const { draft, guard } = guardedInitialDraft(loadedView(live, live.map((song) => moved(song, 30))));
  strictEqual(guard.banner, null);
  strictEqual(draft.pairs.length, 10);
  deepStrictEqual(draft.pairs.filter((pair) => !pair.applyTimes).map(keyOf), [], 'every pair stays ticked');
  deepStrictEqual(guard.pairs, new Map());
  deepStrictEqual(guard.adds, new Map());

  // Three rows are the fewest with a typical shift (R4-1): shifted 300 s as one, past each row's 240 s, all stay ticked.
  const three = songList(3);
  const shifted = guardedInitialDraft(loadedView(three, three.map((song) => moved(song, 300))));
  deepStrictEqual(ticks(shifted.draft).pairs, { '0:0': true, '1:1': true, '2:2': true });
  deepStrictEqual(shifted.guard.pairs, new Map());
}

function testOneFarRowUnticksOnlyItself(): void {
  // Review Focus 1: the same shift, but row 5 (1300–1540) typed an hour later. The rows round it moved 30 s, so its
  // typical shift is 30 and it is 3,570 s off, past its 240 s. Held, it stays at 1300–1540, which no moved row
  // overlaps, so the other nine stay ticked. Submitted at 4900, it sorts last among the submitted rows.
  const live = songList(10);
  const view = loadedView(live, live.map((song, index) => moved(song, index === 4 ? 3600 : 30)));
  deepStrictEqual(initialDraft(view).pairs.filter((pair) => !pair.applyTimes).map(keyOf), [], 'today all ten open ticked');
  const { draft, guard } = guardedInitialDraft(view);
  strictEqual(guard.banner, null);
  deepStrictEqual(guard.pairs, new Map([['4:9', { kind: 'farMove', seconds: 3570 }]]));
  deepStrictEqual(draft.pairs.filter((pair) => !pair.applyTimes).map(keyOf), ['4:9']);
}

function testATailShiftFollowsTheLocalMedian(): void {
  // r2 F2: rows 1–6 as they are, rows 7–10 300 s later with their ends typed. Over all ten rows the typical shift
  // would be 0, putting each of the four 300 s off, past its 240 s; but most rows within three of each of them moved
  // 300 too, so their typical shift is 300 and none moved far. Rows 1–6 repeat the base, so they open unticked.
  const live = songList(10);
  const { draft, guard } = guardedInitialDraft(loadedView(live, live.map((song, index) => (index < 6 ? song : moved(song, 300)))));
  deepStrictEqual(ticks(draft).pairs, {
    '0:0': false, '1:1': false, '2:2': false, '3:3': false, '4:4': false, '5:5': false,
    '6:6': true, '7:7': true, '8:8': true, '9:9': true,
  });
  deepStrictEqual(guard.pairs, new Map());
}

function testASinglePairCannotHideAFarMove(): void {
  // r3 #3 E: the contributor's list is one line, Lemon an hour and twenty minutes later. The review pairs it with the
  // stream's Lemon by title and offers the other rows as deletes. A median over the pairs alone is this pair's own
  // shift, so it would never be far; over the live rows near it, which no pair holds and so did not move, the typical
  // shift is 0, and 4,800 s is far past the row's 240 s.
  const live = [row('Alpha', 'X', 100, 340), row('Lemon', '米津玄師', 600, 840), row('Bravo', 'Y', 1200, 1440), row('Charlie', 'Z', 1800, 2040)];
  const view = loadedView(live, [row('Lemon', '米津玄師', 5400, 5640)]);
  deepStrictEqual(ticks(initialDraft(view)).pairs, { '1:0': true }, 'today the far move opens ticked');
  const { draft, guard } = guardedInitialDraft(view);
  deepStrictEqual(ticks(draft).pairs, { '1:0': false });
  deepStrictEqual(guard.pairs, new Map([['1:0', { kind: 'farMove', seconds: 4800 }]]));

  // Far is past the live row's own length, a row with no end taken to last 240 s: Echo moved 241 s is far, 240 s is not.
  const echo = (start: number) => guardedInitialDraft(loadedView(
    [row('Alpha', 'X', 100, 340), row('Echo', 'E', 1000, null), row('Bravo', 'Y', 2000, 2240)],
    [row('Alpha', 'X', 100, 340), row('Echo', 'E', start, 1500), row('Bravo', 'Y', 2000, 2240)],
  ));
  deepStrictEqual(echo(1241).guard.pairs, new Map([['1:1', { kind: 'farMove', seconds: 241 }]]));
  deepStrictEqual(ticks(echo(1240).draft).pairs, { '0:0': false, '1:1': true, '2:2': false });
}

function testAOneRowStreamStillDetectsAFarMove(): void {
  // R4-1: on a stream of one live row, the rows within three of it are the row alone, so their median would be its own
  // shift. With fewer than three live rows the typical shift is 0, and Lemon's 4,800 s is far past its 240 s.
  const view = loadedView([row('Lemon', '米津玄師', 600, 840)], [row('Lemon', '米津玄師', 5400, 5640)]);
  deepStrictEqual(ticks(initialDraft(view)).pairs, { '0:0': true }, 'today the far move opens ticked');
  const { draft, guard } = guardedInitialDraft(view);
  deepStrictEqual(ticks(draft).pairs, { '0:0': false });
  deepStrictEqual(guard.pairs, new Map([['0:0', { kind: 'farMove', seconds: 4800 }]]));
}

function testATwoRowStreamComparesWithTheRowsOwnLength(): void {
  // R4-1: on a stream of two live rows, the median of the two shifts is their mean, so a move would be far only past
  // twice the row's length, and it would read as half its size. The typical shift is 0 there too, so Lemon moved
  // 4,800 s is 4,800 s off; moved 300 s, past its 240 s but under twice it, it is held as well.
  const lemonAt = (start: number) => guardedInitialDraft(loadedView(
    [row('Alpha', 'X', 100, 340), row('Lemon', '米津玄師', 600, 840)],
    [row('Alpha', 'X', 100, 340), row('Lemon', '米津玄師', start, start + 240)],
  ));
  const far = lemonAt(5400);
  deepStrictEqual(ticks(far.draft).pairs, { '0:0': false, '1:1': false });
  deepStrictEqual(far.guard.pairs, new Map([['1:1', { kind: 'farMove', seconds: 4800 }]]));
  deepStrictEqual(lemonAt(900).guard.pairs, new Map([['1:1', { kind: 'farMove', seconds: 300 }]]));
}

function testALengthChangeIsHeld(): void {
  // Every start as it is; the typed ends change the lengths, each row 240 s long now. ×2.5 and ×0.42 are held, the
  // ratio as it is (the page rounds it); exactly ×2 and exactly ×0.5 are not.
  const proposed = [
    row('Song 1', 'Artist 1', 100, 700),
    row('Song 2', 'Artist 2', 1100, 1200),
    row('Song 3', 'Artist 3', 2100, 2580),
    row('Song 4', 'Artist 4', 3100, 3220),
  ];
  const { draft, guard } = guardedInitialDraft(loadedView(songList(4, { stride: 1000 }), proposed));
  deepStrictEqual(ticks(draft).pairs, { '0:0': false, '1:1': false, '2:2': true, '3:3': true });
  deepStrictEqual(guard.pairs, new Map([
    ['0:0', { kind: 'lengthChange', ratio: 2.5 }],
    ['1:1', { kind: 'lengthChange', ratio: 100 / 240 }],
  ]));
}

function testAZeroLengthLiveRowGetsNoLengthChange(): void {
  // F4-2: Zero is live 300–300, so no ratio can be formed against it, and a typed end of 400 on its unchanged start is
  // no length change. The matcher pairs no empty interval, so the review opens Zero as an add and a delete; the
  // curator pairs the two by hand (`pairWith`), and the guard runs on that draft.
  const view = loadedView(
    [row('Alpha', 'X', 100, 250), row('Zero', 'Y', 300, 300), row('Charlie', 'Z', 600, 840)],
    [row('Alpha', 'X', 100, 250), row('Zero', 'Y', 300, 400), row('Charlie', 'Z', 600, 840)],
  );
  const opened = initialDraft(view);
  deepStrictEqual(
    [opened.adds.map((add) => add.proposedIndex), opened.deletes.map((entry) => entry.currentIndex)],
    [[1], [1]],
    'Zero opens as an add and a delete',
  );
  const paired = pairWith(opened, view, 0, 0);
  deepStrictEqual(ticks(paired).pairs, { '0:0': false, '1:1': true, '2:2': false }, 'paired by hand, its time change opens ticked');
  const { draft, guard } = guardDraft(paired, view);
  deepStrictEqual(ticks(draft).pairs, { '0:0': false, '1:1': true, '2:2': false });
  deepStrictEqual(guard.pairs, new Map());
}

// --- Rule 2, then: a row that is likely another song, and a list that is only part of the base ---

/** r3's partial-list archive: six songs of 240 s, with a gap before Charlie and another before Echo. */
const SIX_SONGS = [
  row('Alpha', 'Artist A', 100, 340),
  row('Bravo', 'Artist B', 400, 640),
  row('Charlie', 'Artist C', 1000, 1240),
  row('Delta', 'Artist D', 1300, 1540),
  row('Echo', 'Artist E', 1900, 2140),
  row('Foxtrot', 'Artist F', 2200, 2440),
];

function testARetitledRowMovedFarIsAnotherSong(): void {
  // The contributor loaded the list and replaced Charlie's line with a song the archive misses, start only: Missed One
  // at 12:50, 230 s before Charlie (Nova's parser ends it where Delta starts). The review pairs it with Charlie by
  // time: 230 s off the typical shift of 0 is short of Charlie's 240 s, and its end stays 1240, under twice the length,
  // so it opens ticked, and the apply would move Charlie and never add Missed One. A row whose titles differ and that
  // moves more than 30 s off the typical shift is likely another song: held.
  const view = loadedView(SIX_SONGS, SIX_SONGS.map((song) => (song.title === 'Charlie' ? row('Missed One', 'm1', 770, 1300) : song)));
  strictEqual(ticks(initialDraft(view)).pairs['2:2'], true, "today Charlie's move opens ticked");
  const { draft, guard } = guardedInitialDraft(view);
  strictEqual(guard.banner, null);
  strictEqual(ticks(draft).pairs['2:2'], false);
  deepStrictEqual(guard.pairs, new Map([['2:2', otherSong(230)]]));

  // More than 30 s: Song 3 retitled and moved 31 s is held, moved 30 s is not, and a move that far with the title as
  // it is stays a fix.
  const live = songList(6);
  const retitled = (title: string, seconds: number) => guardedInitialDraft(loadedView(live, live.map((song) =>
    (song.title === 'Song 3' ? moved(row(title, song.originalArtist, song.timestamp, song.endTimestamp), seconds) : song))));
  deepStrictEqual(retitled('Other Song', 31).guard.pairs, new Map([['2:2', otherSong(31)]]));
  strictEqual(ticks(retitled('Other Song', 30).draft).pairs['2:2'], true, '30 s is not more than 30 s');
  strictEqual(ticks(retitled('Song 3', 31).draft).pairs['2:2'], true, 'the same title is no other song');
}

function testARetitledRowInAUniformShiftIsNotAnotherSong(): void {
  // The whole list typed 60 s later with its ends, and Song 3 spelled another way (Sogn 3). Its titles differ, but it
  // moves as every row round it does, 0 s off the typical shift: a fix like the rest, which stays ticked.
  const live = songList(6);
  const view = loadedView(live, live.map((song) => moved(song.title === 'Song 3' ? row('Sogn 3', song.originalArtist, song.timestamp, song.endTimestamp) : song, 60)));
  const { draft, guard } = guardedInitialDraft(view);
  strictEqual(guard.banner, null);
  strictEqual(draft.pairs.length, 6);
  deepStrictEqual(draft.pairs.filter((pair) => !pair.applyTimes).map(keyOf), [], 'every pair stays ticked');
  deepStrictEqual(guard.pairs, new Map());
}

function testAPartialListAfterLoadingHoldsTheMove(): void {
  // r3 #2: the contributor loaded the list, then replaced it with the two songs the archive misses: Missed One at
  // 12:50, start only (Nova's parser ends it where the next line starts), and Missed Two 26:40–30:40. The review pairs
  // Missed One with Charlie by time and would move Charlie to 770 by default, never adding Missed One. It is another
  // song first (rule 2: its titles differ and it moves 230 s), and the list leaves out five of the six base rows, so
  // the page says it lists only part of the list. Missed Two is an add, which the partial list does not hold.
  const view = loadedView(SIX_SONGS, [row('Missed One', 'm1', 770, 1600), row('Missed Two', 'm2', 1600, 1840)]);
  deepStrictEqual(ticks(initialDraft(view)), { pairs: { '2:0': true }, adds: { 1: true } }, "today Charlie's move opens ticked");
  const { draft, guard } = guardedInitialDraft(view);
  strictEqual(guard.banner, 'partialList');
  deepStrictEqual(ticks(draft), { pairs: { '2:0': false }, adds: { 1: true } });
  deepStrictEqual(guard.pairs, new Map([['2:0', otherSong(230)]]));
  deepStrictEqual(guard.adds, new Map());
}

function testALoneEncoreAfterLoadingIsHeld(): void {
  // r3 #3, the same-title form: the contributor loaded the list and replaced it with one line, Lemon right after the
  // first take (14:00–18:00), a second take of it. The review pairs it with the stream's Lemon by title: moved by its
  // own 240 s length, it is not past it, and its length is as it was, so nothing in the row tells it from a fix, and the
  // apply would move the first take and never add the second. The list leaves out three of the four base rows: a
  // partial list, so the move is held.
  const view = loadedView(LEMON_STREAM, [row('Lemon', '米津玄師', 840, 1080)]);
  deepStrictEqual(ticks(initialDraft(view)).pairs, { '1:0': true }, 'today the move opens ticked');
  const { draft, guard } = guardedInitialDraft(view);
  strictEqual(guard.banner, 'partialList');
  deepStrictEqual(ticks(draft).pairs, { '1:0': false });
  deepStrictEqual(guard.pairs, new Map([['1:0', PARTIAL]]));
}

function testAShortListOfFixesIsHeldWithTheBanner(): void {
  // What the rule costs: a contributor who loaded the list and kept only the two lines they fixed, each 10 s later.
  // Neither row is wrong, but four of the six base rows are left out, and a list that short reads as a partial one:
  // both fixes are held, for the curator to tick.
  const live = songList(6);
  const view = loadedView(live, [moved(need(live[1], 'Song 2'), 10), moved(need(live[4], 'Song 5'), 10)]);
  deepStrictEqual(ticks(initialDraft(view)).pairs, { '1:0': true, '4:1': true }, 'today both fixes open ticked');
  const { draft, guard } = guardedInitialDraft(view);
  strictEqual(guard.banner, 'partialList');
  deepStrictEqual(ticks(draft).pairs, { '1:0': false, '4:1': false });
  deepStrictEqual(guard.pairs, new Map([['1:0', PARTIAL], ['4:1', PARTIAL]]));
}

function testOneDeletedRowIsNotAPartialList(): void {
  // Five of the six base rows, Song 1 fixed 10 s later: Song 4 is left out, as a contributor deletes a row. One row
  // left out is under the two a partial list needs, so the fix stays ticked, and no banner shows.
  const live = songList(6);
  const listing = (kept: readonly number[]) =>
    loadedView(live, kept.map((index) => (index === 0 ? moved(need(live[0], 'Song 1'), 10) : need(live[index], `Song ${index + 1}`))));
  const one = guardedInitialDraft(listing([0, 1, 2, 4, 5]));
  strictEqual(one.guard.banner, null);
  deepStrictEqual(ticks(one.draft).pairs, { '0:0': true, '1:1': false, '2:2': false, '4:3': false, '5:4': false });
  deepStrictEqual(one.guard.pairs, new Map());

  // Two left out of six are under half the base: no partial list either. Three are half, and are one.
  const two = guardedInitialDraft(listing([0, 1, 2, 4]));
  strictEqual(two.guard.banner, null);
  strictEqual(ticks(two.draft).pairs['0:0'], true);
  const three = guardedInitialDraft(listing([0, 1, 2]));
  strictEqual(three.guard.banner, 'partialList');
  deepStrictEqual(three.guard.pairs, new Map([['0:0', PARTIAL]]));

  // One left out of two is half the base, but under two rows: no partial list.
  const pair = songList(2);
  const fixOne = guardedInitialDraft(loadedView(pair, [moved(need(pair[0], 'Song 1'), 10)]));
  strictEqual(fixOne.guard.banner, null);
  deepStrictEqual(ticks(fixOne.draft).pairs, { '0:0': true });
}

function testARowDeletedAfterTheSubmissionIsNotLeftOut(): void {
  // The contributor loaded four rows and sent all four, Song 1 fixed 10 s later. Since then a curator deleted Song 3's
  // performance: its line has no live row to pair with and opens as an add, yet it stands for its base row
  // (`baseCounterparts`), so the contributor left nothing out. No partial list, and the fix stays ticked.
  const base = songList(4);
  const deletedSince = (gone: readonly string[]) => {
    const view = correctionView({
      base: base.map((song, index) => baseRow(`p${index + 1}`, song)),
      current: base.flatMap((song, index) => (gone.includes(song.title) ? [] : [liveRow(`p${index + 1}`, song)])),
      proposed: base.map((song) => (song.title === 'Song 1' ? moved(song, 10) : song)),
    });
    view.baseVerified = true;
    return guardedInitialDraft(view);
  };
  const one = deletedSince(['Song 3']);
  strictEqual(one.guard.banner, null);
  deepStrictEqual(ticks(one.draft), { pairs: { '0:0': true, '1:1': false, '2:3': false }, adds: { 2: false } });
  deepStrictEqual(one.guard.pairs, new Map());

  // Two deleted since: counted by the live rows a pair holds, two of the four would be left out, a partial list. Both
  // still stand for their base rows, so none is.
  const two = deletedSince(['Song 3', 'Song 4']);
  strictEqual(two.guard.banner, null);
  deepStrictEqual(ticks(two.draft), { pairs: { '0:0': true, '1:1': false }, adds: { 2: false, 3: false } });
  deepStrictEqual(two.guard.pairs, new Map());
}

// --- Rule 6: a default that makes two rows newly overlap ---

function testANewOverlapIsHeldAndNamesTheRow(): void {
  // B's typed end runs 60 s into C, which the contributor left as it is: B is held, naming C. C opens unticked anyway,
  // as a row that repeats the base, so it has no tick to lose and no reason.
  const runInto = (liveEnd: number, newEnd: number) => guardedInitialDraft(loadedView(
    [row('A', 'X', 100, 340), row('B', 'Y', 400, liveEnd), row('C', 'Z', 700, 940)],
    [row('A', 'X', 100, 340), row('B', 'Y', 400, newEnd), row('C', 'Z', 700, 940)],
  ));
  const into = runInto(640, 760);
  deepStrictEqual(ticks(into.draft).pairs, { '0:0': false, '1:1': false, '2:2': false });
  deepStrictEqual(into.guard.pairs, new Map([['1:1', overlapWith('C')]]));

  // A second is within the tolerance, and an overlap the stream already has is no new one.
  strictEqual(ticks(runInto(640, 701).draft).pairs['1:1'], true, '1 s into C');
  strictEqual(ticks(runInto(760, 761).draft).pairs['1:1'], true, 'B already runs 60 s into C: 61 s is 1 s more');
  deepStrictEqual(runInto(760, 790).guard.pairs, new Map([['1:1', overlapWith('C')]]), 'B already runs 60 s into C: 90 s is 30 s more');
}

function testTheOverlapPassCascades(): void {
  // r3 #13 SW1: the contributor loaded the list and swapped the first two lines' titles, times untouched, so Nova read
  // both of their ends as filled. Paired by title, Alpha (100–400) moves to 400–650 and Bravo (400–650) to 100–350,
  // and both open ticked. Their typical shift is 0, the median of +300, −300 and Charlie's 0: Alpha's 300 is not past
  // its 300 s, but Bravo's is past its 250 s. Held, Bravo stays at 400–650, where Alpha would go, so the next pass
  // holds Alpha too, naming Bravo.
  const live = [row('Alpha', 'X', 100, 400), row('Bravo', 'Y', 400, 650), row('Charlie', 'Z', 650, 900)];
  const view = loadedView(live, [row('Bravo', 'Y', 100, 400), row('Alpha', 'X', 400, 650), row('Charlie', 'Z', 650, 900)]);
  deepStrictEqual(
    initialDraft(view).pairs.map((pair) => [keyOf(pair), pair.applyTimes, pair.timestamp, pair.endTimestamp]),
    [['0:1', true, 400, 650], ['1:0', true, 100, 350], ['2:2', false, 650, 900]],
    'today both halves of the swap open ticked',
  );
  const { draft, guard } = guardedInitialDraft(view);
  deepStrictEqual(ticks(draft).pairs, { '0:1': false, '1:0': false, '2:2': false });
  deepStrictEqual(guard.pairs, new Map<string, GuardReason>([
    ['1:0', { kind: 'farMove', seconds: 300 }],
    ['0:1', overlapWith('Bravo')],
  ]));

  // A hold of the overlap pass puts its row back too. Q and R both move 100 s earlier, their typical shift: Q now runs
  // 40 s into P, and is held. Back at 400–640, Q is where R would run 40 s into, so the pass runs again and holds R.
  const again = guardedInitialDraft(loadedView(
    [row('P', 'X', 100, 340), row('Q', 'Y', 400, 640), row('R', 'Z', 700, 940)],
    [row('P', 'X', 100, 340), row('Q', 'Y', 300, 540), row('R', 'Z', 600, 840)],
  ));
  deepStrictEqual(ticks(again.draft).pairs, { '0:0': false, '1:1': false, '2:2': false });
  deepStrictEqual(again.guard.pairs, new Map([['1:1', overlapWith('P')], ['2:2', overlapWith('Q')]]));
}

function testAnAddThatRunsIntoARowIsHeld(): void {
  // November runs 90 s into Alpha and 20 s into Bravo: held, naming the first row the scan meets, Alpha.
  const twoRows = guardedInitialDraft(loadedView([ALPHA, BRAVO], [ALPHA, row('November', 'Artist N', 250, 420), BRAVO]));
  deepStrictEqual(ticks(twoRows.draft).adds, { 1: false });
  deepStrictEqual(twoRows.guard.adds, new Map([[1, overlapWith('Alpha')]]));

  // Two ticked adds that overlap each other are both held, each naming the other.
  const eachOther = guardedInitialDraft(loadedView([ALPHA, BRAVO], [ALPHA, BRAVO, row('Oscar', 'Artist O', 1000, 1200), row('Papa', 'Artist P', 1150, 1300)]));
  deepStrictEqual(ticks(eachOther.draft).adds, { 2: false, 3: false });
  deepStrictEqual(eachOther.guard.adds, new Map([[2, overlapWith('Papa')], [3, overlapWith('Oscar')]]));

  // Papa runs 40 s into Delta, which the submission leaves out: held, while the delete is unticked. With Delta deleted
  // (the curator ticked it, and the guard runs on that draft), Delta is gone, and Papa runs into nothing.
  const view = loadedView([ALPHA, row('Delta', 'Artist D', 1000, 1240)], [ALPHA, row('Papa', 'Artist P', 1200, 1400)]);
  const opened = guardedInitialDraft(view);
  deepStrictEqual(ticks(opened.draft).adds, { 1: false });
  deepStrictEqual(opened.guard.adds, new Map([[1, overlapWith('Delta')]]));
  const draft = initialDraft(view);
  const deleting = guardDraft({ ...draft, deletes: draft.deletes.map((entry) => ({ ...entry, apply: true })) }, view);
  deepStrictEqual(ticks(deleting.draft).adds, { 1: true });
  deepStrictEqual(deleting.guard.adds, new Map());
  deepStrictEqual(deleting.draft.deletes.map((entry) => entry.apply), [true], 'the delete stays as the curator ticked it');

  // A start-only last line has no end, and an entry with no end overlaps nothing; with an end, Quebec runs into Bravo.
  const quebec = (endTimestamp: number | null) =>
    guardedInitialDraft(loadedView([ALPHA, BRAVO], [ALPHA, BRAVO, row('Quebec', 'Artist Q', 500, endTimestamp)]));
  deepStrictEqual(ticks(quebec(null).draft).adds, { 2: true });
  deepStrictEqual(quebec(700).guard.adds, new Map([[2, overlapWith('Bravo')]]));
}

// --- Rule 3: an add with no identity, or too short ---

function testABlankArtistAddWithNoSongIsHeld(): void {
  // November names no artist (only spaces), and no song is found for it: applied, it would make a new song
  // 'November / Unknown'. Oscar names none either, but the song resolution found for it is where it lands. Papa names
  // its artist.
  const view = loadedView([ALPHA], [
    ALPHA,
    row('November', ' ', 500, 700),
    row('Oscar', '', 800, 1000),
    row('Papa', 'Artist P', 1100, 1300),
  ]);
  need(view.proposed.find((proposed) => proposed.title === 'Oscar'), 'Oscar').existingSong = { id: 's-oscar', status: 'approved' };
  const { draft, guard } = guardedInitialDraft(view);
  deepStrictEqual(ticks(draft).adds, { 1: false, 2: true, 3: true });
  deepStrictEqual(guard.adds, new Map([[1, { kind: 'noIdentity' }]]));
}

function testANoArtistAddOnAPipelineStreamWithAnUnknownSongStaysTicked(): void {
  // F4-1: a pipeline stream promotes no song, but its add still lands on the song its title resolves to. November,
  // typed with no artist, resolves to 'November / Unknown', which the catalog has: the add names that song, so it
  // stays ticked, with no reason.
  const view = pipelineView([ALPHA], [ALPHA, row('November', '', 700, 900)]);
  need(view.proposed.find((proposed) => proposed.title === 'November'), 'November').existingSong = { id: 's-november-unknown', status: 'pending' };
  deepStrictEqual(ticks(initialDraft(view)).adds, { 1: true }, 'today the add opens ticked');
  const { draft, guard } = guardedInitialDraft(view);
  strictEqual(guard.banner, null);
  deepStrictEqual(ticks(draft).adds, { 1: true });
  deepStrictEqual(guard.adds, new Map());
}

function testANoArtistAddOnAPipelineStreamWithNoSongIsHeld(): void {
  // The same with no 'November / Unknown' in the catalog: applied, the add would make that song new.
  const { draft, guard } = guardedInitialDraft(pipelineView([ALPHA], [ALPHA, row('November', '', 700, 900)]));
  deepStrictEqual(ticks(draft).adds, { 1: false });
  deepStrictEqual(guard.adds, new Map([[1, { kind: 'noIdentity' }]]));
}

function testAShortAddIsHeld(): void {
  // 197–200 is 3 s, and 400–412.6 rounds to 13; 30 s is not under 30.
  const view = loadedView([row('Alpha', 'X', 1000, 1240)], [
    row('Alpha', 'X', 1000, 1240),
    row('November', 'Artist N', 197, 200),
    row('Oscar', 'Artist O', 400, 412.6),
    row('Papa', 'Artist P', 600, 630),
  ]);
  const { draft, guard } = guardedInitialDraft(view);
  deepStrictEqual(ticks(draft).adds, { 0: false, 1: false, 2: true });
  deepStrictEqual(guard.adds, new Map([[0, { kind: 'short', seconds: 3 }], [1, { kind: 'short', seconds: 13 }]]));
}

// --- Rule 5: adds of one title that touch ---

function testTwoTouchingSameTitleAddsAreHeld(): void {
  // November 200–230 ends where November 230–300 starts: both are held, for the curator to pick. Kilo 700–800 ends 1 s
  // before Kilo 801–900 starts, within the tolerance: held too. Mike 400–500 ends 2 s before Mike 502–600 starts: both
  // stay ticked.
  const view = loadedView([row('Alpha', 'X', 1000, 1240)], [
    row('Alpha', 'X', 1000, 1240),
    row('November', 'Artist N', 200, 230),
    row('November', 'Artist N', 230, 300),
    row('Mike', 'Artist M', 400, 500),
    row('Mike', 'Artist M', 502, 600),
    row('Kilo', 'Artist K', 700, 800),
    row('Kilo', 'Artist K', 801, 900),
  ]);
  deepStrictEqual(ticks(initialDraft(view)).adds, { 0: true, 1: true, 2: true, 3: true, 4: true, 5: true }, 'today all six open ticked');
  const { draft, guard } = guardedInitialDraft(view);
  deepStrictEqual(ticks(draft).adds, { 0: false, 1: false, 2: true, 3: true, 4: false, 5: false });
  deepStrictEqual(guard.adds, new Map([[0, REPEAT], [1, REPEAT], [4, REPEAT], [5, REPEAT]]));
}

function testAShortPhantomBeforeASameTitleAddIsHeldAsShort(): void {
  // r3 #9: a 10 s phantom November right before the real one, which starts where it ends. Rule 3 holds the phantom as
  // short; rule 5, after it, then finds one ticked November, not two that touch, so the real one stays ticked and the
  // apply adds November once. Run before rule 3, rule 5 would hold both as a repeat, and the default would add neither.
  const view = loadedView([row('Alpha', 'X', 1000, 1240)], [
    row('Alpha', 'X', 1000, 1240),
    row('November', 'Artist N', 200, 210),
    row('November', 'Artist N', 210, 300),
  ]);
  deepStrictEqual(ticks(initialDraft(view)).adds, { 0: true, 1: true }, 'today both open ticked');
  const { draft, guard } = guardedInitialDraft(view);
  deepStrictEqual(ticks(draft).adds, { 0: false, 1: true });
  deepStrictEqual(guard.adds, new Map([[0, { kind: 'short', seconds: 10 }]]));
}

// --- Rule 4: a second list pasted under the first ---

function testAPastedListIsHeld(): void {
  // The loaded list, and under it the contributor's own copy, start times only, each line 40 s early and spelled
  // another way. Four adds, each starting within 120 s of a live row's start: a second list, so every add is held.
  const live = songList(4);
  const copies = [
    row('Song 1 (copy)', 'Artist 1', 60, 360),
    row('Song 2 (copy)', 'Artist 2', 360, 660),
    row('Song 3 (copy)', 'Artist 3', 660, 960),
    row('Song 4 (copy)', 'Artist 4', 960, null),
  ];
  const view = loadedView(live, [...live, ...copies]);
  deepStrictEqual(ticks(initialDraft(view)).adds, { 0: true, 2: true, 4: true, 6: true }, 'today the four copies open ticked');
  const { draft, guard } = guardedInitialDraft(view);
  strictEqual(guard.banner, 'pastedList');
  deepStrictEqual(ticks(draft).adds, { 0: false, 2: false, 4: false, 6: false });
  deepStrictEqual(guard.adds, new Map([[0, PASTED], [2, PASTED], [4, PASTED], [6, PASTED]]));

  // The same, with one fix in the loaded list (Song 4 10 s later) and Song 2 typed twice. The second Song 2 repeats the
  // row, so it opens unticked already and gets no reason. Song 4's move is no add, and stays ticked.
  const fixed = loadedView(live, [
    row('Song 1', 'Artist 1', 100, 340),
    row('Song 2', 'Artist 2', 400, 640),
    row('Song 2', 'Artist 2', 400, 640),
    row('Song 3', 'Artist 3', 700, 940),
    row('Song 4', 'Artist 4', 1010, 1250),
    ...copies,
  ]);
  deepStrictEqual(ticks(initialDraft(fixed)).adds, { 0: true, 2: true, 4: false, 5: true, 7: true }, 'today the second Song 2 opens unticked');
  const withFix = guardedInitialDraft(fixed);
  strictEqual(withFix.guard.banner, 'pastedList');
  deepStrictEqual(ticks(withFix.draft), {
    pairs: { '0:1': false, '1:3': false, '2:6': false, '3:8': true },
    adds: { 0: false, 2: false, 4: false, 5: false, 7: false },
  });
  deepStrictEqual(withFix.guard.adds, new Map([[0, PASTED], [2, PASTED], [5, PASTED], [7, PASTED]]));
  deepStrictEqual(withFix.guard.pairs, new Map());
}

function testAPastedListCountsAnAddAlreadyHeld(): void {
  // Three adds, each 40 s before a live row. The first is 10 s long, so it is held as short before the count; the count
  // takes every add, held or not, so the three are a pasted list. The short one keeps the first reason it got.
  const view = loadedView(songList(3), [
    ...songList(3),
    row('Song 1 (copy)', 'Artist 1', 60, 70),
    row('Song 2 (copy)', 'Artist 2', 360, 560),
    row('Song 3 (copy)', 'Artist 3', 660, 860),
  ]);
  const { draft, guard } = guardedInitialDraft(view);
  strictEqual(guard.banner, 'pastedList');
  deepStrictEqual(ticks(draft).adds, { 0: false, 2: false, 4: false });
  deepStrictEqual(guard.adds, new Map<number, GuardReason>([[0, { kind: 'short', seconds: 10 }], [2, PASTED], [4, PASTED]]));
}

function testAPastedListStartsWithin120SecondsOfARow(): void {
  // Three 60 s adds, each the same time before one of three live rows 1000 s apart, overlapping none of them: 120 s
  // before is near, 121 s is not.
  const early = (seconds: number) => {
    const live = songList(3, { first: 1000, stride: 1000 });
    const extras = live.map((song, index) => row(`Extra ${index + 1}`, 'Artist E', song.timestamp - seconds, song.timestamp - seconds + 60));
    return guardedInitialDraft(loadedView(live, [...live, ...extras]));
  };
  strictEqual(early(120).guard.banner, 'pastedList');
  deepStrictEqual(early(120).guard.adds, new Map([[0, PASTED], [2, PASTED], [4, PASTED]]));
  strictEqual(early(121).guard.banner, null);
  deepStrictEqual(ticks(early(121).draft).adds, { 0: true, 2: true, 4: true });

  // Half the adds near a live start is enough: two of four.
  const live = songList(4, { first: 1000, stride: 1000 });
  const half = guardedInitialDraft(loadedView(live, [
    ...live,
    row('Extra 1', 'Artist E', 900, 960),
    row('Extra 2', 'Artist E', 1500, 1560),
    row('Extra 3', 'Artist E', 1900, 1960),
    row('Extra 4', 'Artist E', 2500, 2560),
  ]));
  strictEqual(half.guard.banner, 'pastedList');
}

function testTwoMissedSongsAreNotAPastedList(): void {
  // Two songs the archive missed, each typed in the 240 s gap it left: two adds are no second list.
  const live = [row('Song 1', 'Artist 1', 100, 340), row('Song 3', 'Artist 3', 580, 820), row('Song 5', 'Artist 5', 1060, 1300)];
  const view = loadedView(live, [...live, row('Song 2', 'Artist 2', 340, 580), row('Song 4', 'Artist 4', 820, 1060)]);
  const { draft, guard } = guardedInitialDraft(view);
  strictEqual(guard.banner, null);
  deepStrictEqual(ticks(draft).adds, { 1: true, 3: true });
  deepStrictEqual(guard.adds, new Map());
}

function testMissingEveryOtherSongIsNotAPastedList(): void {
  // Fifteen songs back to back, 240 s each; the archive has every other one (eight), and the contributor typed the
  // seven it misses back at their true times. Seven adds, but each starts 240 s from the nearest live start.
  const songs = songList(15, { stride: 240 });
  const view = loadedView(songs.filter((_, index) => index % 2 === 0), songs);
  const { draft, guard } = guardedInitialDraft(view);
  strictEqual(guard.banner, null);
  strictEqual(draft.adds.length, 7);
  deepStrictEqual(draft.adds.filter((add) => !add.apply).map((add) => add.title), [], 'every add stays ticked');
  deepStrictEqual(guard.adds, new Map());
}

// --- The thresholds ---

function testTheGuardLimitsAreTheMeasuredOnes(): void {
  // Every threshold the guard reads, each as the replays over the archive measured it: changing one changes what reviews
  // open with, so it is changed here, on purpose. The boundaries are pinned by the tests of each rule.
  deepStrictEqual(GUARD_LIMITS, {
    minLengthRatio: 0.5,
    maxLengthRatio: 2,
    minAddSeconds: 30,
    overlapToleranceSeconds: 1,
    localWindowRows: 3,
    minRowsForATypicalShift: 3,
    otherSongShiftSeconds: 30,
    pastedList: { minAdds: 3, nearSeconds: 120, minNearShare: 0.5 },
    partialList: { minLeftOut: 2, minLeftOutShare: 0.5 },
  });
}

// --- Purity ---

function testGuardDraftLeavesItsInputAlone(): void {
  // Reviews where every rule unticks something: no base, a cascade of a far move and an overlap, and a pasted list.
  const views = [
    ichiiCorrectionView(),
    loadedView(
      [row('Alpha', 'X', 100, 400), row('Bravo', 'Y', 400, 650), row('Charlie', 'Z', 650, 900)],
      [row('Bravo', 'Y', 100, 400), row('Alpha', 'X', 400, 650), row('Charlie', 'Z', 650, 900)],
    ),
    loadedView(songList(3), [...songList(3), row('Copy 1', 'Artist 1', 60, 360), row('Copy 2', 'Artist 2', 360, 660), row('Copy 3', 'Artist 3', 660, null)]),
  ];
  for (const [index, view] of views.entries()) {
    const draft = initialDraft(view);
    const draftBefore = structuredClone(draft);
    const viewBefore = structuredClone(view);
    const guarded = guardDraft(draft, view);
    deepStrictEqual(draft, draftBefore, `review ${index}: the draft given is as it was`);
    deepStrictEqual(view, viewBefore, `review ${index}: the view is as it was`);
    notStrictEqual(guarded.draft, draft, `review ${index}: a new draft`);
    notStrictEqual(guarded.guard.pairs.size + guarded.guard.adds.size, 0, `review ${index}: the guard unticked something`);
    deepStrictEqual(guardedInitialDraft(view), guarded, `review ${index}: guardedInitialDraft guards initialDraft`);
  }
}

function main(): void {
  testNoBaseTicksNothing();
  testAnUnverifiedBaseTicksNothing();
  testAnUnverifiedReviewStillMarksAFarMove();
  testAnUnverifiedReviewStillMarksAPastedList();
  testAnUnverifiedPastedListKeepsTheRuleOneBanner();
  testAnUnverifiedPartialListStillMarksItsMoves();
  testAUniformShiftStaysTicked();
  testOneFarRowUnticksOnlyItself();
  testATailShiftFollowsTheLocalMedian();
  testASinglePairCannotHideAFarMove();
  testAOneRowStreamStillDetectsAFarMove();
  testATwoRowStreamComparesWithTheRowsOwnLength();
  testALengthChangeIsHeld();
  testAZeroLengthLiveRowGetsNoLengthChange();
  testARetitledRowMovedFarIsAnotherSong();
  testARetitledRowInAUniformShiftIsNotAnotherSong();
  testAPartialListAfterLoadingHoldsTheMove();
  testALoneEncoreAfterLoadingIsHeld();
  testAShortListOfFixesIsHeldWithTheBanner();
  testOneDeletedRowIsNotAPartialList();
  testARowDeletedAfterTheSubmissionIsNotLeftOut();
  testANewOverlapIsHeldAndNamesTheRow();
  testTheOverlapPassCascades();
  testAnAddThatRunsIntoARowIsHeld();
  testABlankArtistAddWithNoSongIsHeld();
  testANoArtistAddOnAPipelineStreamWithAnUnknownSongStaysTicked();
  testANoArtistAddOnAPipelineStreamWithNoSongIsHeld();
  testAShortAddIsHeld();
  testTwoTouchingSameTitleAddsAreHeld();
  testAShortPhantomBeforeASameTitleAddIsHeldAsShort();
  testAPastedListIsHeld();
  testAPastedListCountsAnAddAlreadyHeld();
  testAPastedListStartsWithin120SecondsOfARow();
  testTwoMissedSongsAreNotAPastedList();
  testMissingEveryOtherSongIsNotAPastedList();
  testTheGuardLimitsAreTheMeasuredOnes();
  testGuardDraftLeavesItsInputAlone();
  console.log('✓ the guard holds back every default a review with no confirmed base, a far move, a row that looks like another song, a length change, a partial list, a new overlap, an add with no identity or too short, a touching same-title add or a pasted list would apply, and says why, with no confirmed base too');
}

main();
