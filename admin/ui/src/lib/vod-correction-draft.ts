/**
 * The review draft of a VOD correction, as plain data: for every pair the time edit and the title choice the
 * curator wants, for every add and delete whether it is ticked. `initialDraft` starts from the suggested pairing,
 * `unpair` and `pairWith` re-pair by hand, `tickAllTimes` and `tickAllAdds` (全選) tick every pair or every add that is
 * built ticked, `draftOperations` converts a draft into what
 * `POST /api/nova/vods/:id/apply` takes, `draftFlags` says what the page marks on each row, `draftSuggestions`
 * what the submission suggests for each pair, and `addLandingSong` and `choiceLandingSong` the song an add or a title
 * choice lands on, which the apply approves along with it should it be pending (`promotedSongs`: every such song of a
 * draft).
 *
 * Two comparisons are kept apart. What the submission *suggests* (the pair's change flags, `suggestedChanges`: the
 * matcher's `correctionChanges`, with an end the contributor did not give read as none) sets the defaults and decides
 * what counts as skipped. What a draft would *send* (its values against the current row, as typed) decides which
 * operations exist and which keys each carries: the apply parser refuses an operation with a key its variant does not
 * have, and one that sets nothing.
 *
 * A view with a base (`NovaVodCorrectionView.base`, the list the contributor compared against) is read three ways. A
 * submitted row that repeats a base row is untouched: it suggests nothing, whatever the stream says now, so a change
 * that landed since (another applied correction, a Stamp Editor edit) is never ticked back. A live row that is not
 * its base row changed since: paired with a changed row, nothing is ticked. Nor is anything paired with a live row on
 * the site that the base lacks: it was added or published since, so the contributor's times were not set against it
 * (a row the site hides was never shown, and keeps the default). A submitted row the pairing leaves an add, but that
 * stands for a base row (`baseCounterparts`) gone or changed since, was a change to that row: it is no add to tick. A
 * live row the base lacks was never seen, and one a submitted row stands for was not dropped, so leaving either out
 * suggests no delete. With no base, each pair is read against the stream alone, and only a row on the site can be a
 * suggested delete.
 *
 * An add that repeats a row (`repeatedRows`: it has the title of a row it overlaps, either a row of the stream that the
 * pairs keep or an earlier add, an add that ends where such a row starts read with that row's length) lists a song
 * twice, as when the contributor pastes the list they loaded again under it, their own start-only list just before
 * it, or types a line twice. It starts unticked, so the default apply publishes no duplicate, yet it is the
 * contributor's own add: it counts as a skipped add, as any add the curator leaves unticked does. Its mark
 * (`RowFlags.repeats`) and the row it names (`draftRepeats`) are read from the pairs the draft has, so a re-pairing
 * moves them; the tick, like every default, is decided when the add is built (全選新增 ticks it again only where it is
 * built ticked over the pairs the draft has then: `tickAllAdds`).
 *
 * An add of a row submitted with no artist starts with the one artist of the stream that has a song of its title
 * (`startingArtist`), so that the apply joins that song and makes no twin of it by Unknown; with none, or with more
 * than one, it stays with no artist, as submitted.
 *
 * Each function reads its view once per call, whatever the number of rows: what every row needs of it (the base's
 * reading, the starts an end is read against) is worked out before the rows are visited (`readBase`), and nothing is
 * kept between calls, so a view edited in place reads afresh.
 *
 * Pure and total, and free of React: no input is modified, and an index that points at no row leaves a draft as
 * it was (or leaves that entry out of the operations). Whether a value is sound (an end after its start, a title
 * that is not blank) is not checked here; the server refuses what it must and says which operation. An end the
 * apply needs is the one exception: a row the apply refuses without an end (`RowFlags.needsEnd`) holds the apply
 * (`canApply`). It needs one for an add on an approved stream, where the row is born approved and a row with no end
 * stops the export (anywhere else an add is created pending and stamped later); for a time change, which may not
 * clear the end a row has, on any stream; for a relink that publishes its row (`relinkPublishes`: on an approved
 * stream, an approved row the site does not show), which must have an end once the apply is done; and for an approved
 * row of the stream whose pending song the apply approves because an add or a relink lands on it (`heldByPromotion`),
 * which that puts in the export, unless the draft deletes the row, moves it to another song or gives it an end.
 */
import type { Status } from '../../../shared/types';
import { baseCounterparts, correctionChanges, referenceStarts, repeatedRows, untouchedBaseRows, yieldedEnd } from '../../../shared/vod-correction';
import type {
  CorrectionBaseRow,
  CorrectionCurrentRow,
  CorrectionOperation,
  CorrectionPair,
  CorrectionProposedRow,
  CorrectionSkipped,
  MatchableRow,
  NovaVodCorrectionView,
  RepeatedRow,
} from '../../../shared/vod-correction';

/** What a pair does with its song when the submission spells it differently. `ignore` keeps the current song as it is. */
export type TitleChoice =
  | { kind: 'ignore' }
  | { kind: 'rename'; title: string; originalArtist: string }
  | { kind: 'relinkExisting'; songId: string; songLabel: string; songStatus: Status }
  | { kind: 'relinkNew'; title: string; originalArtist: string };

/**
 * A current row and the proposed row that corrects it. The times start as the ones the proposed row proposes (its
 * start, and its end unless that end is derived: see `proposedEnd`) and may be edited.
 */
export interface PairDraft {
  currentIndex: number;
  proposedIndex: number;
  applyTimes: boolean;
  timestamp: number;
  endTimestamp: number | null;
  title: TitleChoice;
}

/** A proposed row that corrects no current row: a performance to add. Its values start as the proposed row's. */
export interface AddDraft {
  proposedIndex: number;
  apply: boolean;
  title: string;
  originalArtist: string;
  timestamp: number;
  endTimestamp: number | null;
}

/** A current row no proposed row corrects: a performance to delete. */
export interface DeleteDraft {
  currentIndex: number;
  apply: boolean;
}

/** `pairs` are kept ordered by `currentIndex`, `adds` by `proposedIndex` and `deletes` by `currentIndex`. */
export interface CorrectionDraft {
  pairs: PairDraft[];
  adds: AddDraft[];
  deletes: DeleteDraft[];
}

/** What the page marks on a row of the draft, beyond what the row suggests. With no base, only `needsEnd` and `repeats` are set. */
export interface RowFlags {
  /** The submitted row repeats a base row (`untouchedBaseRows`): it suggests nothing, whatever the stream says now. */
  untouched: boolean;
  /**
   * The live row is not the base row it was: it changed after the submission. On an add, the base row the submitted
   * row stands for is gone from the stream (an untouched add) or gone or changed (any other add).
   */
  changedSince: boolean;
  /** The live row is not in the base: hidden from the contributor (not on the site), or added after the submission. */
  notSeen: boolean;
  /**
   * A row the apply refuses without an end: a ticked add with none on an approved stream (`addNeedsEnd`); on any
   * stream, a ticked time change that clears one; or a relink that publishes its row (`relinkPublishes`) with no end
   * once the apply is done (`pairNeedsEnd`), whether its times are ticked or not: unticked, the row keeps its own end.
   * On a pair or a delete alike, an approved row with no end of a pending song the apply approves along with it
   * (`heldByPromotion`), which the draft does not spare. The apply waits.
   */
  needsEnd: boolean;
  /**
   * An add that repeats a row the stream keeps or an earlier add (`repeatedRows`, over the draft's own pairs): it starts
   * unticked, as the draft builds an add that is one (`addOf`). Only an add is ever one.
   */
  repeats: boolean;
}

const NO_FLAGS: RowFlags = { untouched: false, changedSince: false, notSeen: false, needsEnd: false, repeats: false };

/** What a view says about its rows, read once per call: its base's reading, and the starts an end is read against. */
interface BaseReading {
  /** For each proposed row, the base row it repeats (`untouchedBaseRows`), or null. */
  untouched: Array<CorrectionBaseRow | null>;
  /** For each proposed row, the base row it stands for (`baseCounterparts`): the one it repeats or changed, or null. */
  counterparts: Array<CorrectionBaseRow | null>;
  /** The base rows by performance id; null when the view has no base. */
  byId: Map<string, CorrectionBaseRow> | null;
  /** The performances some proposed row stands for: none of them was dropped. */
  counterparted: Set<string>;
  /** The live rows by performance id. */
  live: Map<string, CorrectionCurrentRow>;
  /**
   * The starts (`referenceStarts`) of the live rows, and of the base rows too when the view has a base: what a
   * submitted row's next row is looked up in, to tell whether the contributor moved it (`proposedEnd`).
   */
  referenceStarts: ReadonlySet<number>;
  /**
   * The starts of the base rows alone, for the end a submitted row yields against its base counterpart (`skipAdd`);
   * null when the view has no base.
   */
  baseStarts: ReadonlySet<number> | null;
}

/**
 * Everything the draft functions read of a view that is the same for every row of a draft, worked out once for a call:
 * a row asks only its own questions of it. Nothing is kept between calls (the view may be edited in place and read
 * again), and a function reads the view's base here and nowhere else.
 */
function readBase(view: NovaVodCorrectionView): BaseReading {
  const base = view.base;
  const counterparts = baseCounterparts(view.proposed, base);
  const liveStarts = referenceStarts(view.current);
  const baseStarts = base === null ? null : referenceStarts(base);
  return {
    untouched: untouchedBaseRows(view.proposed, base),
    counterparts,
    byId: base === null ? null : new Map(base.map((row) => [row.performanceId, row])),
    counterparted: new Set(counterparts.flatMap((row) => (row === null ? [] : [row.performanceId]))),
    live: new Map(view.current.map((row) => [row.performanceId, row])),
    referenceStarts: baseStarts === null ? liveStarts : new Set([...liveStarts, ...baseStarts]),
    baseStarts,
  };
}

const isUntouched = (reading: BaseReading, proposedIndex: number): boolean => (reading.untouched[proposedIndex] ?? null) !== null;

/** Whether the live row differs from the base row it was: changed after the submission. */
function changedSince(reading: BaseReading, current: CorrectionCurrentRow): boolean {
  const was = reading.byId?.get(current.performanceId);
  return (
    was !== undefined &&
    (was.title !== current.title ||
      was.originalArtist !== current.originalArtist ||
      was.timestamp !== current.timestamp ||
      was.endTimestamp !== current.endTimestamp)
  );
}

const notSeen = (reading: BaseReading, current: CorrectionCurrentRow): boolean =>
  reading.byId !== null && !reading.byId.has(current.performanceId);

/**
 * Whether leaving the live row out is the submission suggesting its delete: with a base, when the contributor saw it
 * (it is in the base) and no submitted row stands for it (`baseCounterparts`); with none, when it is on the site, the
 * only rows Nova shows.
 */
function suggestsDelete(reading: BaseReading, current: CorrectionCurrentRow): boolean {
  if (reading.byId === null) return current.onSite;
  return reading.byId.has(current.performanceId) && !reading.counterparted.has(current.performanceId);
}

/**
 * Whether a proposed row that is not untouched stands for a base row (`baseCounterparts`) that is gone from the
 * stream, or that changed since the submission: the contributor changed a row that is not there as they saw it, so
 * adding the row is no suggestion.
 */
function standsForAChangedRow(reading: BaseReading, proposedIndex: number): boolean {
  const counterpart = reading.counterparts[proposedIndex] ?? null;
  if (counterpart === null || isUntouched(reading, proposedIndex)) return false;
  const now = reading.live.get(counterpart.performanceId);
  return now === undefined || changedSince(reading, now);
}

/**
 * What leaving the add of proposed row `proposedIndex` unticked skips. An untouched row suggests nothing. A row that
 * stands for a row changed since (`standsForAChangedRow`) skips what the contributor changed against that row
 * (`correctionChanges`, its end read as against the base: `yieldedEnd`): a time change as 時間 and a title or artist
 * change as 歌名, never an add. Any other row skips its add.
 */
function skipAdd(view: NovaVodCorrectionView, reading: BaseReading, proposedIndex: number, skipped: CorrectionSkipped): void {
  if (isUntouched(reading, proposedIndex)) return;
  const counterpart = reading.counterparts[proposedIndex] ?? null;
  const proposed = view.proposed[proposedIndex];
  if (!standsForAChangedRow(reading, proposedIndex) || !counterpart || !proposed || reading.baseStarts === null) {
    skipped.add += 1;
    return;
  }
  const end = yieldedEnd(view.proposed, proposedIndex, counterpart, reading.baseStarts);
  const changes = correctionChanges(counterpart, { ...proposed, endTimestamp: end });
  if (changes.start || changes.end) skipped.time += 1;
  if (changes.title || changes.artist) skipped.title += 1;
}

/**
 * Whether a pair's title choice publishes its live row: on an approved stream, a relink of an approved row the site
 * does not show gives it a song that is approved, created approved, or approved along with the apply (the worker
 * promotes a pending song a row lands on), and so puts it on the site and in the export. A choice that keeps the song
 * (ignore, rename) keeps its status; a row that is not approved, or one on the site already, is left as it is; and on
 * any other stream nothing is promoted and the apply refuses to publish a row. The draft's end rule (`RowFlags.needsEnd`)
 * and the page's hint that a row stays off the site (`staysOffSite`) both read it, so they cannot disagree.
 */
export function relinkPublishes(view: NovaVodCorrectionView, current: CorrectionCurrentRow, choice: TitleChoice): boolean {
  return (
    view.stream.status === 'approved' &&
    current.status === 'approved' &&
    !current.onSite &&
    (choice.kind === 'relinkExisting' || choice.kind === 'relinkNew')
  );
}

/**
 * A pair the apply refuses for its end, as a row with no end stops the export: a ticked time change that clears the end
 * the row has, on any stream; a relink that publishes the row (`relinkPublishes`) while it has no end once the apply
 * is done, which is the pair's end when its times are ticked, else the row's own; or a row the promotion would publish
 * with no end (`held`, from `heldByPromotion`). A row that is more than one of them is one row that needs an end.
 */
function pairNeedsEnd(pair: PairDraft, current: CorrectionCurrentRow, view: NovaVodCorrectionView, held: ReadonlySet<number>): boolean {
  const clears = pair.applyTimes && pair.endTimestamp === null && current.endTimestamp !== null;
  const end = pair.applyTimes ? pair.endTimestamp : current.endTimestamp;
  return clears || (end === null && relinkPublishes(view, current, pair.title)) || held.has(pair.currentIndex);
}

/**
 * A ticked add with no end on an approved stream: the apply refuses it there, where the row is born approved and a row
 * with no end stops the export. On any other stream the add is created pending, like an imported row, and stamped
 * later, so it needs none.
 */
const addNeedsEnd = (add: AddDraft, view: NovaVodCorrectionView): boolean =>
  add.apply && add.endTimestamp === null && view.stream.status === 'approved';

const UNKNOWN_ARTIST = 'Unknown';

/** A title as it is compared and sent: without the whitespace round it. */
const titleText = (title: string): string => title.trim();

/** An artist as it is compared and sent: trimmed, and 'Unknown' when nothing is left, as the catalog stores a blank one. */
const artistText = (originalArtist: string): string => originalArtist.trim() || UNKNOWN_ARTIST;

const present = <T>(value: T | null): T[] => (value === null ? [] : [value]);

/**
 * The end a proposed row proposes for the current row it is paired with. The parsers fill a missing end with the
 * start of the next submitted row (`endFilled`, read in the order Nova stored the rows, whatever their starts) and
 * leave the last one empty, so such an end, or no end against a current one, is *derived*: the parsers', not the
 * contributor's. A derived end proposes none, and the current end stays, unless the contributor moved the next
 * submitted row or added it, and the current end passes its start: put back, the end would overlap that row, so the
 * submitted end is proposed (`yieldedEnd`, the yield rule Nova's restore applies too). A next row was moved or added
 * when it starts where no live row starts and, in a review with a base, no base row either: a title or artist edit is
 * no move, and a row at a base position was not moved by the contributor, whatever changed since. A current end of
 * none stays. A row moved past its own end (the current end at or before its new start) would end before it starts
 * with the current end, so it keeps the current row's length instead, up to the next submitted row's start when that
 * row starts after it (`yieldedEnd` again). So does a row moved back to before an unmoved row it used to follow, whose
 * start the current end would run across: it keeps its length, up to that row's start. And so does a row moved later
 * by more than half the current row's length, short of its end, which the current end would leave under half of it.
 */
function proposedEnd(
  view: NovaVodCorrectionView,
  reading: BaseReading,
  current: CorrectionCurrentRow,
  proposedIndex: number,
): number | null {
  return yieldedEnd(view.proposed, proposedIndex, current, reading.referenceStarts);
}

function suggestedWith(
  view: NovaVodCorrectionView,
  reading: BaseReading,
  currentIndex: number,
  proposedIndex: number,
): CorrectionPair['changes'] | null {
  const current = view.current[currentIndex];
  const proposed = view.proposed[proposedIndex];
  if (!current || !proposed) return null;
  if (isUntouched(reading, proposedIndex)) return { start: false, end: false, title: false, artist: false };
  return correctionChanges(current, { ...proposed, endTimestamp: proposedEnd(view, reading, current, proposedIndex) });
}

/**
 * Which fields of a pair the submission suggests changing: the matcher's flags (`correctionChanges`) of its two rows,
 * read with the end the proposed row proposes (`proposedEnd`), so a derived end suggests nothing; and nothing at all
 * for an untouched row, which repeats the base. The defaults, the skipped counts and the page's chips all read the
 * same rule (`suggestedWith`): this function for one pair, `draftSuggestions` for every pair of a draft. Null when
 * either index points at no row.
 */
export function suggestedChanges(
  view: NovaVodCorrectionView,
  currentIndex: number,
  proposedIndex: number,
): CorrectionPair['changes'] | null {
  return suggestedWith(view, readBase(view), currentIndex, proposedIndex);
}

/**
 * `suggestedChanges` of every pair of `draft`, in the draft's own order (`[i]` belongs to `draft.pairs[i]`), reading
 * the view once for all of them: a page that lays out every row asks here, where asking `suggestedChanges` for each
 * would read the view once per row. Null for a pair whose row the view lacks, as there.
 */
export function draftSuggestions(draft: CorrectionDraft, view: NovaVodCorrectionView): Array<CorrectionPair['changes'] | null> {
  const reading = readBase(view);
  return draft.pairs.map((pair) => suggestedWith(view, reading, pair.currentIndex, pair.proposedIndex));
}

/**
 * Whether a pair's times start ticked (`pairOf` says when), given what it suggests (`changes`, its `suggestedWith`):
 * what a pair is built with, and whether 全選時間 ticks it (`tickAllTimes`).
 */
function timesTick(reading: BaseReading, current: CorrectionCurrentRow, changes: CorrectionPair['changes']): boolean {
  return (changes.start || changes.end) && !changedSince(reading, current) && !(notSeen(reading, current) && current.onSite);
}

/**
 * Whether the add of proposed row `proposedIndex` starts ticked (`addOf` says when), given the rows repeated over the
 * pairs the draft has (`repeated`): what an add is built with, and whether 全選新增 ticks it (`tickAllAdds`).
 */
function addTick(reading: BaseReading, proposedIndex: number, repeated: ReadonlyArray<RepeatedRow | null>): boolean {
  return !isUntouched(reading, proposedIndex) && !standsForAChangedRow(reading, proposedIndex) && (repeated[proposedIndex] ?? null) === null;
}

/**
 * A pair as it starts, whether the matcher suggested it or the curator made it by hand: the flags are asked of the
 * two rows (`view.match` holds the suggested pairs only, and goes stale once the draft re-pairs), so both start alike.
 * Its times are ticked when they suggest a change, unless the live row changed since the submission, or is on the
 * site but not in the base (`notSeen`): added or published since, it is not a row the contributor saw. A row the site
 * hides keeps the tick, as it was never shown (`timesTick`). Left unticked, either suggestion counts as skipped. An
 * untouched row proposes nothing, so its times start as the stream's: ticked, they send nothing either.
 */
function pairOf(view: NovaVodCorrectionView, reading: BaseReading, currentIndex: number, proposedIndex: number): PairDraft | null {
  const current = view.current[currentIndex];
  const proposed = view.proposed[proposedIndex];
  const changes = suggestedWith(view, reading, currentIndex, proposedIndex);
  if (!current || !proposed || !changes) return null;
  const untouched = isUntouched(reading, proposedIndex);
  return {
    currentIndex,
    proposedIndex,
    applyTimes: timesTick(reading, current, changes),
    timestamp: untouched ? current.timestamp : proposed.timestamp,
    endTimestamp: untouched ? current.endTimestamp : proposedEnd(view, reading, current, proposedIndex),
    title: { kind: 'ignore' },
  };
}

/**
 * The artist an add starts with: the one its row names. A row submitted with no artist is sent as Unknown, and the
 * apply then makes a song of its title by Unknown beside the one the stream has, an approved twin of it. The route
 * resolves such a row's title with each artist the stream has (`existingSongsByLiveArtist`), so when exactly one of
 * them has a song of that title, that artist is the one meant, and the add starts with it, as 改連到新的歌 offers the
 * paired row's artist (`TitleChoices`: an add has no paired row to take one from). With none, or with two or more, there
 * is no telling which was meant, and the artist stays as submitted. Only a start: the curator may type any artist, or
 * clear it.
 */
function startingArtist(proposed: CorrectionProposedRow): string {
  if (proposed.originalArtist.trim() !== '') return proposed.originalArtist;
  const [only, ...others] = (proposed.existingSongsByLiveArtist ?? []).filter((entry) => entry.existingSong !== null);
  return only !== undefined && others.length === 0 ? only.originalArtist : proposed.originalArtist;
}

/**
 * A proposed row as an add. It starts ticked when the submission adds it. An untouched row, whose performance is gone
 * since or whose pair the curator split, was there before the submission, and a row that stands for a row changed
 * since (`standsForAChangedRow`) changed a row that is not there as the contributor saw it: neither is a suggestion,
 * so both start unticked. So does a row that repeats a row the stream keeps or an earlier add (`repeated`: what
 * `repeatedRows` finds over the pairs the draft has as the add is built), as ticked it would list a song twice
 * (`addTick`). That one is the contributor's own add, so it still counts as skipped. Its artist is the row's, or the
 * live artist a row with none borrows (`startingArtist`).
 */
function addOf(
  view: NovaVodCorrectionView,
  reading: BaseReading,
  proposedIndex: number,
  repeated: ReadonlyArray<RepeatedRow | null>,
): AddDraft | null {
  const proposed = view.proposed[proposedIndex];
  if (!proposed) return null;
  return {
    proposedIndex,
    apply: addTick(reading, proposedIndex, repeated),
    title: proposed.title,
    originalArtist: startingArtist(proposed),
    timestamp: proposed.timestamp,
    endTimestamp: proposed.endTimestamp,
  };
}

function deleteOf(view: NovaVodCorrectionView, currentIndex: number): DeleteDraft | null {
  return view.current[currentIndex] ? { currentIndex, apply: false } : null;
}

function inOrder<T>(items: readonly T[], position: (item: T) => number): T[] {
  return [...items].sort((left, right) => position(left) - position(right));
}

function ordered(draft: CorrectionDraft): CorrectionDraft {
  return {
    pairs: inOrder(draft.pairs, (pair) => pair.currentIndex),
    adds: inOrder(draft.adds, (add) => add.proposedIndex),
    deletes: inOrder(draft.deletes, (entry) => entry.currentIndex),
  };
}

const without = <T>(items: readonly T[], index: number): T[] => items.filter((_, position) => position !== index);

/**
 * The draft the page opens with: the suggested pairs with the proposed times (ticked when the submission moved the
 * start, or gave another end that is not derived, and the live row is as the contributor saw it or hidden from them,
 * not one on the site that the base lacks: `pairOf`) and no title change, every unpaired proposed row as an add
 * (ticked unless it is untouched, stands for a row changed since, or repeats a row: `addOf`), and every unpaired
 * current row as an unticked delete.
 */
export function initialDraft(view: NovaVodCorrectionView): CorrectionDraft {
  const reading = readBase(view);
  const pairs = view.match.pairs.flatMap(({ currentIndex, proposedIndex }) => present(pairOf(view, reading, currentIndex, proposedIndex)));
  const repeated = repeatedRows(view.current, view.proposed, pairs);
  return ordered({
    pairs,
    adds: view.match.unpairedProposed.flatMap((proposedIndex) => present(addOf(view, reading, proposedIndex, repeated))),
    deletes: view.match.unpairedCurrent.flatMap((currentIndex) => present(deleteOf(view, currentIndex))),
  });
}

/**
 * Split the pair at `pairIndex` (a position in `draft.pairs`) into an add of its proposed row (ticked as `addOf`
 * says, against the pairs that remain: the pair's own live row, a delete candidate now, is no row the add repeats)
 * and an unticked delete of its current row. The add starts from the proposed row again, so the pair's edits are
 * dropped.
 */
export function unpair(draft: CorrectionDraft, view: NovaVodCorrectionView, pairIndex: number): CorrectionDraft {
  const pair = draft.pairs[pairIndex];
  if (!pair) return draft;
  const pairs = without(draft.pairs, pairIndex);
  const add = addOf(view, readBase(view), pair.proposedIndex, repeatedRows(view.current, view.proposed, pairs));
  const removal = deleteOf(view, pair.currentIndex);
  if (!add || !removal) return draft;
  return ordered({
    pairs,
    adds: [...draft.adds, add],
    deletes: [...draft.deletes, removal],
  });
}

/**
 * Pair the add at `addIndex` with the delete at `deleteIndex` (positions in `draft.adds` and `draft.deletes`): the
 * reverse of `unpair`. The pair starts as a suggested one does (`pairOf`), from the proposed row's times, ticked when
 * they suggest a change to the current row's, unless that row changed since or is on the site but not in the base,
 * with no title change, whatever the add and the delete were edited to.
 */
export function pairWith(draft: CorrectionDraft, view: NovaVodCorrectionView, addIndex: number, deleteIndex: number): CorrectionDraft {
  const add = draft.adds[addIndex];
  const removal = draft.deletes[deleteIndex];
  if (!add || !removal) return draft;
  const pair = pairOf(view, readBase(view), removal.currentIndex, add.proposedIndex);
  if (!pair) return draft;
  return ordered({
    pairs: [...draft.pairs, pair],
    adds: without(draft.adds, addIndex),
    deletes: without(draft.deletes, deleteIndex),
  });
}

/**
 * 全選時間: the times of every pair that is built ticked (`pairOf`, as `initialDraft` builds it, before the review
 * page's guard) ticked, so a tick the guard or the curator took back is given back. It only ticks: a pair today's rules
 * open unticked (no change to suggest, a row changed since, one on the site the contributor never saw) keeps the tick
 * it has, the curator's own included. Nothing else changes: not the times as edited, not a title choice, and no add or
 * delete. `draft` itself when every such pair is ticked already, which is when the page's button would change nothing.
 * A pair whose row the view lacks is left.
 */
export function tickAllTimes(draft: CorrectionDraft, view: NovaVodCorrectionView): CorrectionDraft {
  const reading = readBase(view);
  const pairs = draft.pairs.map((pair) => {
    if (pair.applyTimes) return pair;
    const current = view.current[pair.currentIndex];
    const changes = suggestedWith(view, reading, pair.currentIndex, pair.proposedIndex);
    return current && changes && timesTick(reading, current, changes) ? { ...pair, applyTimes: true } : pair;
  });
  return pairs.every((pair, index) => pair === draft.pairs[index]) ? draft : { ...draft, pairs };
}

/**
 * 全選新增: every add that is built ticked (`addOf`) from the draft as it is, its repeats read over the pairs the draft
 * has (as `unpair` builds one), before the review page's guard, ticked: a tick the guard or the curator took back is
 * given back. It only ticks: an add today's rules open unticked (untouched, standing for a row changed since, or a
 * repeat) keeps the tick it has, the curator's own included. Nothing else changes: not the add's values as edited, and
 * no pair or delete. `draft` itself when every such add is ticked already, which is when the page's button would change
 * nothing. An add whose row the view lacks is left.
 */
export function tickAllAdds(draft: CorrectionDraft, view: NovaVodCorrectionView): CorrectionDraft {
  const reading = readBase(view);
  const repeated = repeatedRows(view.current, view.proposed, draft.pairs);
  const adds = draft.adds.map((add) => {
    if (add.apply || !view.proposed[add.proposedIndex]) return add;
    return addTick(reading, add.proposedIndex, repeated) ? { ...add, apply: true } : add;
  });
  return adds.every((add, index) => add === draft.adds[index]) ? draft : { ...draft, adds };
}

/** `setTimes` with only the times that differ from the current row (an end of null is a value), or null when none does. */
function timeOperation(pair: PairDraft, current: CorrectionCurrentRow): CorrectionOperation | null {
  const start = pair.timestamp !== current.timestamp;
  const end = pair.endTimestamp !== current.endTimestamp;
  if (!start && !end) return null;
  return {
    op: 'setTimes',
    performanceId: current.performanceId,
    ...(start ? { timestamp: pair.timestamp } : {}),
    ...(end ? { endTimestamp: pair.endTimestamp } : {}),
  };
}

/**
 * The operation for a pair's title choice, or null when it asks for nothing: `ignore`, and a rename whose title and
 * artist both read as the current song's. A rename may fix only the case or the spacing, so the text is compared as
 * it stands, not as `normalizeForMatching` folds it.
 *
 * A relink carries the status the review showed for the song it lands on (`expectedSongStatus`), so the apply refuses
 * it as stale once the song has another: the one 改連到既有的歌 picked has the status the page showed beside it, and
 * 改連到新的歌 expects what `expectedNewSongStatus` says, which is no key at all when it says nothing. `renames` is
 * whether the draft renames a song.
 */
function titleOperation(
  choice: TitleChoice,
  current: CorrectionCurrentRow,
  proposed: CorrectionProposedRow,
  renames: boolean,
): CorrectionOperation | null {
  switch (choice.kind) {
    case 'ignore':
      return null;
    case 'rename': {
      const title = titleText(choice.title);
      const originalArtist = artistText(choice.originalArtist);
      const retitled = title !== current.title;
      const reartisted = originalArtist !== current.originalArtist;
      if (!retitled && !reartisted) return null;
      return {
        op: 'renameSong',
        songId: current.songId,
        ...(retitled ? { title } : {}),
        ...(reartisted ? { originalArtist } : {}),
      };
    }
    case 'relinkExisting':
      return {
        op: 'relinkToSong',
        performanceId: current.performanceId,
        songId: choice.songId,
        expectedSongStatus: choice.songStatus,
      };
    case 'relinkNew': {
      const expected = expectedNewSongStatus(proposed, choice, renames);
      return {
        op: 'relinkToNewSong',
        performanceId: current.performanceId,
        title: titleText(choice.title),
        originalArtist: artistText(choice.originalArtist),
        ...(expected === undefined ? {} : { expectedSongStatus: expected }),
      };
    }
  }
}

/**
 * The song resolution picks for `title` and `originalArtist`, as far as the view read it. The view resolved the title
 * the row was submitted with: with the submitted artist (the row's `existingSong`) and, for a row submitted with no
 * artist, with each artist the stream has (`existingSongsByLiveArtist`). So the answer is the song; null when the view
 * read that there is none, so that the apply creates one; or undefined when it read nothing for this title and artist,
 * which the curator typed over what it resolved and only the apply resolves. The text is read as resolution and the
 * apply read it: the title trimmed, the artist trimmed with a blank one 'Unknown' (`titleText`, `artistText`, as the
 * entries are keyed), so '' and 'Unknown' name one song.
 */
function readSong(
  proposed: CorrectionProposedRow,
  title: string,
  originalArtist: string,
): { id: string; status: Status } | null | undefined {
  if (titleText(title) !== titleText(proposed.title)) return undefined;
  const artist = artistText(originalArtist);
  if (artist === artistText(proposed.originalArtist)) return proposed.existingSong;
  return proposed.existingSongsByLiveArtist?.find((entry) => entry.originalArtist === artist)?.existingSong;
}

/**
 * The song the apply lands an add of `title` and `originalArtist` on and approves along with it, should it be pending
 * (the worker promotes a pending song an applied row lands on, on an approved stream only), as far as the review can
 * tell: the song resolution picks for it (`readSong`), whether the add borrowed the artist it is sent with
 * (`startingArtist`) or the curator typed it. Null on a stream that is not approved, where nothing is promoted, and once
 * the curator typed another song over it, which only the apply resolves.
 */
export function addLandingSong(
  view: NovaVodCorrectionView,
  proposed: CorrectionProposedRow,
  title: string,
  originalArtist: string,
): { id: string; status: Status } | null {
  if (view.stream.status !== 'approved') return null;
  return readSong(proposed, title, originalArtist) ?? null;
}

/**
 * What a pair's 改連到新的歌 expects of the song it lands on (`expectedSongStatus`): the status of the song its title and
 * artist resolve to as the view read it (`readSong`), or null when the view read that there is none, so that the apply
 * creates one. It is read on any stream and for any row, whatever the apply promotes there: the apply resolves the
 * same song. Undefined, which sends nothing, where the view read nothing for the title and artist as they stand, and
 * when the draft renames a song (`renames`): the apply resolves the identity after the renames of the same apply, so a
 * song renamed into it, or out of it, is no song the view read. The apply would refuse such a review as stale for good.
 */
function expectedNewSongStatus(
  proposed: CorrectionProposedRow,
  choice: Extract<TitleChoice, { kind: 'relinkNew' }>,
  renames: boolean,
): Status | null | undefined {
  if (renames) return undefined;
  const song = readSong(proposed, choice.title, choice.originalArtist);
  return song === undefined ? undefined : (song?.status ?? null);
}

/**
 * The song a pair's title choice lands its live row on and the apply approves along with it, should it be pending: the
 * song 改連到既有的歌 picked, or the one 改連到新的歌 resolves to, which is read as `addLandingSong` reads an add of that
 * title and artist (a row submitted with no artist is offered the live row's artist, whose entry says what it resolves
 * to). Null for a choice that keeps the row's song (ignore, rename), on a stream that is not approved, and for a row that
 * is not approved itself: a relink keeps its row's status, so such a row stays off the site whatever its song, and the
 * apply approves no song for it.
 */
export function choiceLandingSong(
  view: NovaVodCorrectionView,
  proposed: CorrectionProposedRow,
  current: CorrectionCurrentRow,
  choice: TitleChoice,
): { id: string; status: Status } | null {
  if (view.stream.status !== 'approved' || current.status !== 'approved') return null;
  if (choice.kind === 'relinkExisting') return { id: choice.songId, status: choice.songStatus };
  if (choice.kind !== 'relinkNew') return null;
  return addLandingSong(view, proposed, choice.title, choice.originalArtist);
}

/**
 * The pending songs the apply approves along with its operations, by song id: on an approved stream the worker promotes
 * each pending song that a ticked add (`addLandingSong`) or a pair's title choice (`choiceLandingSong`, whether the
 * pair's times are ticked or not) lands on, which puts every approved row of that song on the site. A row of such a song
 * goes on the site whatever the row itself does, so what the draft holds for an end (`heldByPromotion`) and what the
 * page says of a row that stays off the site (`staysOffSite`) both read this one set, and cannot disagree. A rename in
 * the same draft is not read (see `heldByPromotion`), and neither is an entry whose row the view lacks.
 */
export function promotedSongs(draft: CorrectionDraft, view: NovaVodCorrectionView): ReadonlySet<string> {
  const promoted = new Set<string>();
  const land = (song: { id: string; status: Status } | null) => {
    if (song?.status === 'pending') promoted.add(song.id);
  };
  for (const add of draft.adds) {
    const proposed = view.proposed[add.proposedIndex];
    if (add.apply && proposed) land(addLandingSong(view, proposed, add.title, add.originalArtist));
  }
  for (const pair of draft.pairs) {
    const current = view.current[pair.currentIndex];
    const proposed = view.proposed[pair.proposedIndex];
    if (current && proposed) land(choiceLandingSong(view, proposed, current, pair.title));
  }
  return promoted;
}

/**
 * The live rows, by their place in `view.current`, that the apply's promotion would put in the VOD export with no end,
 * which the worker refuses (409 would_publish_endless). On an approved stream the apply approves each pending song that
 * a ticked add or a relink lands on (`promotedSongs`), which puts every approved row of that song in the export, where a
 * row with no end stops it for every streamer. Of those rows the view holds this stream's: each approved one with no
 * end is held, unless the draft spares it as the worker does (`findEndlessPerformances`): a ticked delete removes it, a
 * relink moves it to another song (it is then its relink's to need an end: `relinkPublishes`), or a ticked time change
 * gives it an end. The worker refuses a row of another stream too, which the view does not hold,
 * and so it does for the song an add lands on once the curator typed another song over it, which only the apply
 * resolves. A rename in the same draft is not read, though the worker resolves an add or 改連到新的歌 after the batch's
 * renames: renaming the pending song away holds an apply that would go through, a false hold that errs on the cautious
 * side.
 */
function heldByPromotion(draft: CorrectionDraft, view: NovaVodCorrectionView): ReadonlySet<number> {
  const promoted = promotedSongs(draft, view);
  const spared = new Set<number>();
  for (const pair of draft.pairs) {
    const current = view.current[pair.currentIndex];
    const proposed = view.proposed[pair.proposedIndex];
    if (!current || !proposed) continue;
    const relinked = pair.title.kind === 'relinkExisting' || pair.title.kind === 'relinkNew';
    const movedAway = relinked && choiceLandingSong(view, proposed, current, pair.title)?.id !== current.songId;
    if (movedAway || (pair.applyTimes && pair.endTimestamp !== null)) spared.add(pair.currentIndex);
  }
  for (const entry of draft.deletes) {
    if (entry.apply) spared.add(entry.currentIndex);
  }
  const held = new Set<number>();
  view.current.forEach((row, index) => {
    if (promoted.has(row.songId) && row.status === 'approved' && row.endTimestamp === null && !spared.has(index)) held.add(index);
  });
  return held;
}

/**
 * What to send for `draft`, and what the curator left out.
 *
 * `operations` come in row order: each pair's time edit and then its title edit, the adds, the deletes. A pair
 * with no change to send gives no operation for it. A relink carries the status the review showed for the song it
 * lands on (`expectedSongStatus`: see `titleOperation`). `skipped` counts, per kind, the suggested changes that did not
 * become an operation (the time moves, the title or artist differences, the adds and the deletes left unticked), so
 * a suggestion is always counted as one or the other, however the draft was edited; what the submission did not
 * suggest (an untouched row's add, the delete of a row the contributor never saw or that a submitted row stands for)
 * is never skipped, and an add that stands for a row changed since skips what was changed in it (`skipAdd`).
 * `appliedCount` is the number of operations and `skippedCount` the sum of `skipped`. `needsEndCount` counts the rows
 * the apply refuses without an end (`RowFlags.needsEnd`: a ticked add with none, on an approved stream only, a ticked
 * time change that clears one, a relink that publishes a row left with none, its times ticked or not, and a row with
 * none that the apply's promotion publishes, paired or a delete: `heldByPromotion`), each row once, and `canApply` is
 * whether the draft may be sent: it has an operation and no such row.
 */
export function draftOperations(
  draft: CorrectionDraft,
  view: NovaVodCorrectionView,
): {
  operations: CorrectionOperation[];
  skipped: CorrectionSkipped;
  appliedCount: number;
  skippedCount: number;
  needsEndCount: number;
  canApply: boolean;
} {
  const reading = readBase(view);
  const held = heldByPromotion(draft, view);
  const operations: CorrectionOperation[] = [];
  const skipped: CorrectionSkipped = { time: 0, title: 0, add: 0, delete: 0 };
  let needsEndCount = 0;
  const renames = draft.pairs.some((pair) => pair.title.kind === 'rename');

  for (const pair of draft.pairs) {
    const current = view.current[pair.currentIndex];
    const proposed = view.proposed[pair.proposedIndex];
    const suggested = suggestedWith(view, reading, pair.currentIndex, pair.proposedIndex);
    if (!current || !proposed || !suggested) continue;
    if (pairNeedsEnd(pair, current, view, held)) needsEndCount += 1;

    const times = pair.applyTimes ? timeOperation(pair, current) : null;
    if (times) operations.push(times);
    else if (suggested.start || suggested.end) skipped.time += 1;

    const title = titleOperation(pair.title, current, proposed, renames);
    if (title) operations.push(title);
    else if (suggested.title || suggested.artist) skipped.title += 1;
  }

  for (const add of draft.adds) {
    if (!add.apply) {
      skipAdd(view, reading, add.proposedIndex, skipped);
      continue;
    }
    if (addNeedsEnd(add, view)) needsEndCount += 1;
    operations.push({
      op: 'addPerformance',
      title: titleText(add.title),
      originalArtist: artistText(add.originalArtist),
      timestamp: add.timestamp,
      endTimestamp: add.endTimestamp,
    });
  }

  for (const entry of draft.deletes) {
    const current = view.current[entry.currentIndex];
    if (!current) continue;
    if (held.has(entry.currentIndex)) needsEndCount += 1;
    if (entry.apply) operations.push({ op: 'deletePerformance', performanceId: current.performanceId });
    else if (suggestsDelete(reading, current)) skipped.delete += 1;
  }

  return {
    operations,
    skipped,
    appliedCount: operations.length,
    skippedCount: skipped.time + skipped.title + skipped.add + skipped.delete,
    needsEndCount,
    canApply: operations.length > 0 && needsEndCount === 0,
  };
}

/**
 * The row each add of `draft` repeats, or null, in the draft's own order (`[i]` belongs to `draft.adds[i]`): what
 * `repeatedRows` finds over the pairs the draft has now, a row of the stream that the pairs keep or an earlier add, as
 * the submission has them, not as the curator edited the add. The page names it beside the add (「和…是同一首」), and
 * `draftFlags` marks every add that has one.
 */
export function draftRepeats(draft: CorrectionDraft, view: NovaVodCorrectionView): Array<MatchableRow | null> {
  const repeated = repeatedRows(view.current, view.proposed, draft.pairs);
  return draft.adds.map((add) => {
    const found = repeated[add.proposedIndex] ?? null;
    if (found === null) return null;
    return (found.side === 'current' ? view.current : view.proposed)[found.index] ?? null;
  });
}

/**
 * What the page marks on each row of `draft` (`RowFlags`), list by list in the draft's own order: `pairs[i]` belongs
 * to `draft.pairs[i]`, and so on. An untouched add is `changedSince` when its performance is gone from the stream,
 * and any other add when it stands for a row gone or changed since (`standsForAChangedRow`). An add `repeats` when it
 * repeats a row over the pairs the draft has now (`draftRepeats`). A pair's `needsEnd` is `pairNeedsEnd`, and a
 * delete's is whether the apply's promotion publishes its row with no end (`heldByPromotion`). A pair or a delete whose
 * row the view lacks, which `draftOperations` leaves out, is marked with nothing.
 */
export function draftFlags(
  draft: CorrectionDraft,
  view: NovaVodCorrectionView,
): { pairs: RowFlags[]; adds: RowFlags[]; deletes: RowFlags[] } {
  const reading = readBase(view);
  const repeats = draftRepeats(draft, view);
  const held = heldByPromotion(draft, view);
  return {
    pairs: draft.pairs.map((pair) => {
      const current = view.current[pair.currentIndex];
      if (!current || !view.proposed[pair.proposedIndex]) return { ...NO_FLAGS };
      return {
        untouched: isUntouched(reading, pair.proposedIndex),
        changedSince: changedSince(reading, current),
        notSeen: notSeen(reading, current),
        needsEnd: pairNeedsEnd(pair, current, view, held),
        repeats: false,
      };
    }),
    adds: draft.adds.map((add, index) => {
      const repeated = reading.untouched[add.proposedIndex] ?? null;
      return {
        untouched: repeated !== null,
        changedSince: repeated !== null ? !reading.live.has(repeated.performanceId) : standsForAChangedRow(reading, add.proposedIndex),
        notSeen: false,
        needsEnd: addNeedsEnd(add, view),
        repeats: (repeats[index] ?? null) !== null,
      };
    }),
    deletes: draft.deletes.map((entry) => {
      const current = view.current[entry.currentIndex];
      if (!current) return { ...NO_FLAGS };
      return {
        ...NO_FLAGS,
        changedSince: changedSince(reading, current),
        notSeen: notSeen(reading, current),
        needsEnd: held.has(entry.currentIndex),
      };
    }),
  };
}
