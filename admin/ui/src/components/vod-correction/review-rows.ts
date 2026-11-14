/**
 * What the correction review lays out, worked out from a correction and its draft: one row per pair, add and
 * delete, in time order, with the pairs the submission left exactly as they are set apart; the chips that say what
 * each row suggests, and the marks that say what else the curator must know of it; and the edits a row makes to the
 * draft. Plain data, free of React: `CorrectionRows` draws it, and the draft (`lib/vod-correction-draft`) holds every
 * decision.
 *
 * What a row suggests is asked of its two rows with the draft's `draftSuggestions` (`suggestedChanges` of every pair,
 * the matcher's own rule with an end the contributor did not give read as none, the view read once for all of them),
 * never from the draft's values: a row the curator is editing keeps its chips and its place. Whether a pair is set
 * apart as unchanged is asked of its two rows as they stand, unless it needs an end or applies something, which keeps
 * it listed (`foldsAway`). Its marks are its `draftFlags`, worked out once for the whole draft, whether the site shows
 * its live row, whether the contributor saw any row at all, and why the page's guard held its default back
 * (`heldReason`). An add that repeats a row carries that row (`draftRepeats`), which its panel names.
 */
import { correctionChanges } from '../../../../shared/vod-correction';
import type {
  CorrectionCurrentRow,
  CorrectionPair,
  CorrectionProposedRow,
  MatchableRow,
  NovaVodCorrectionView,
} from '../../../../shared/vod-correction';
import {
  addLandingSong,
  choiceLandingSong,
  draftRepeats,
  draftSuggestions,
  relinkPublishes,
  sameSongText,
  type AddDraft,
  type CorrectionDraft,
  type DeleteDraft,
  type PairDraft,
  type RowFlags,
  type TitleChoice,
} from '../../lib/vod-correction-draft';
import type { DraftGuard, GuardReason } from '../../lib/vod-correction-guard';

interface RowBase {
  /** Stable across re-renders and re-pairing: the ids of the rows it is made of. */
  key: string;
  /** Its position in `draft.pairs`, `draft.adds` or `draft.deletes`, which the draft functions take. */
  index: number;
  /** What the draft marks on it (`draftFlags`). */
  flags: RowFlags;
}

export type ReviewRow =
  | (RowBase & {
      kind: 'pair';
      pair: PairDraft;
      current: CorrectionCurrentRow;
      proposed: CorrectionProposedRow;
      /** What the submission suggests for the pair (`draftSuggestions`): its chips and its tick. */
      changes: CorrectionPair['changes'];
    })
  | (RowBase & {
      kind: 'add';
      add: AddDraft;
      proposed: CorrectionProposedRow;
      /** The row the add repeats (`draftRepeats`: a row of the stream or an earlier add), which its panel names; null if none. */
      repeated: MatchableRow | null;
    })
  | (RowBase & { kind: 'delete'; entry: DeleteDraft; current: CorrectionCurrentRow });

export type PairRow = Extract<ReviewRow, { kind: 'pair' }>;
export type AddRow = Extract<ReviewRow, { kind: 'add' }>;

/** What a row's chips say, in the order they show. */
export type RowChip = '時間' | '歌名' | '新增' | '刪除';

/**
 * What a row's marks say, in the order they show: what holds the apply, what an add repeats, why the review's guard
 * held the row's default back, then what is not as the contributor saw it.
 */
export type RowMark =
  | '需要結束時間'
  | '重複'
  | '移動太遠'
  | '歌名不同'
  | '長度改變'
  | '只列部分'
  | '會重疊'
  | '沒有原唱'
  | '太短'
  | '可能重複貼上'
  | '投稿後已變更'
  | '投稿時未顯示'
  | '未公開';

/**
 * The mark of a row the guard held back, by why (`GuardReason`). Two adds of one title that touch wear 重複, as an add
 * that repeats a row does; a base no revision confirmed marks no row, as the page says it once for every row.
 */
const HELD_MARKS: Record<GuardReason['kind'], RowMark | null> = {
  unverifiedBase: null,
  farMove: '移動太遠',
  otherSong: '歌名不同',
  lengthChange: '長度改變',
  partialList: '只列部分',
  overlap: '會重疊',
  noIdentity: '沒有原唱',
  short: '太短',
  repeatAdd: '重複',
  pastedList: '可能重複貼上',
};

/** What the draft marks on each of its rows, list by list in the draft's own order: what `draftFlags` returns. */
export interface DraftFlags {
  pairs: readonly RowFlags[];
  adds: readonly RowFlags[];
  deletes: readonly RowFlags[];
}

const NO_FLAGS: RowFlags = { untouched: false, changedSince: false, notSeen: false, needsEnd: false, repeats: false };

/** The look of a value the correction brings, and of the one it replaces. */
export const NEW_VALUE = 'font-bold text-accent-fg';
export const OLD_VALUE = 'text-fg-subtle line-through';

export function pairKey(current: CorrectionCurrentRow, proposed: CorrectionProposedRow): string {
  return `pair-${current.performanceId}-${proposed.id}`;
}

export function addKey(proposed: CorrectionProposedRow): string {
  return `add-${proposed.id}`;
}

/** When a row sits in the stream: a pair and a delete where the stream has it now, an add where it is submitted. */
function startOf(row: ReviewRow): number {
  return row.kind === 'add' ? row.proposed.timestamp : row.current.timestamp;
}

/**
 * Whether a pair's two rows agree as they stand: the times exactly, and the title and artist as typed (`sameSongText`).
 * A derived end suggests nothing (no chip, no tick), and neither does a fix of only the case or the character width,
 * which matching folds away; yet both differ, so their rows stay listed, where the curator can still open them and
 * type an end or take the fix.
 */
function isUnchanged(row: ReviewRow): boolean {
  if (row.kind !== 'pair') return false;
  const { start, end, title, artist } = correctionChanges(row.current, row.proposed);
  return !start && !end && !title && !artist && sameSongText(row.current, row.proposed);
}

/**
 * Whether a row folds into 未變更: a pair whose two rows agree (`isUnchanged`) that needs no end the apply waits for
 * (`RowFlags.needsEnd`) and applies nothing (`rowApplies`). A folded row has no panel, and only its panel can give it
 * an end, so a pair that needs one stays listed, as the apply's promotion can make a row of agreeing rows need one. So
 * does a pair the curator gave a change, such as that end: 未變更 could neither show it ticked nor untick it.
 */
function foldsAway(row: ReviewRow): boolean {
  return isUnchanged(row) && !row.flags.needsEnd && !rowApplies(row);
}

/**
 * The draft's rows in time order, each with its `flags` (the draft's `draftFlags`): `rows` to review, and `unchanged`,
 * the pairs whose two rows agree in every field and that hold and apply nothing (`foldsAway`). An entry whose row the
 * view lacks is left out, as `draftOperations` leaves it out. The view is read once for all the rows
 * (`draftSuggestions`, `draftRepeats`), not once for each: the page asks again on every render.
 */
export function reviewRows(
  view: NovaVodCorrectionView,
  draft: CorrectionDraft,
  flags: DraftFlags,
): { rows: ReviewRow[]; unchanged: ReviewRow[] } {
  const all: ReviewRow[] = [];
  const suggestions = draftSuggestions(draft, view);
  const repeats = draftRepeats(draft, view);
  draft.pairs.forEach((pair, index) => {
    const current = view.current[pair.currentIndex];
    const proposed = view.proposed[pair.proposedIndex];
    const changes = suggestions[index];
    if (!current || !proposed || !changes) return;
    all.push({ kind: 'pair', key: pairKey(current, proposed), index, flags: flags.pairs[index] ?? NO_FLAGS, pair, current, proposed, changes });
  });
  draft.deletes.forEach((entry, index) => {
    const current = view.current[entry.currentIndex];
    if (current) all.push({ kind: 'delete', key: `delete-${current.performanceId}`, index, flags: flags.deletes[index] ?? NO_FLAGS, entry, current });
  });
  draft.adds.forEach((add, index) => {
    const proposed = view.proposed[add.proposedIndex];
    if (proposed) {
      all.push({ kind: 'add', key: addKey(proposed), index, flags: flags.adds[index] ?? NO_FLAGS, add, proposed, repeated: repeats[index] ?? null });
    }
  });
  // A stable sort: rows that start together keep the order above.
  all.sort((left, right) => startOf(left) - startOf(right));
  return { rows: all.filter((row) => !foldsAway(row)), unchanged: all.filter(foldsAway) };
}

export function rowChips(row: ReviewRow): RowChip[] {
  if (row.kind === 'add') return ['新增'];
  if (row.kind === 'delete') return ['刪除'];
  const chips: RowChip[] = [];
  if (row.changes.start || row.changes.end) chips.push('時間');
  if (row.changes.title || row.changes.artist) chips.push('歌名');
  return chips;
}

/**
 * Whether the list the contributor compared against was empty (a base of []): the stream had no song on the site
 * then, so every live row went unseen. The page says so once rather than on every row (`rowMarks`).
 */
export function sawNoRow(view: NovaVodCorrectionView): boolean {
  return view.base !== null && view.base.length === 0;
}

/**
 * Why the review's guard took back the tick a row opened with (`DraftGuard`), or null: looked up by the row's pair, its
 * live row and its submitted row together, or by its add's submitted row, as the guard keys its reasons. They are the
 * rows the review opened with: a pair or an add the curator made by re-pairing is a new one, which has none, whatever
 * the row it was made of had. A delete never has one. An add held for naming no song (`noIdentity`) has none once the
 * curator gives it an artist: what its mark and hint say is no longer so.
 */
export function heldReason(row: ReviewRow, guard: DraftGuard): GuardReason | null {
  if (row.kind === 'pair') return guard.pairs.get(`${row.pair.currentIndex}:${row.pair.proposedIndex}`) ?? null;
  if (row.kind !== 'add') return null;
  const reason = guard.adds.get(row.add.proposedIndex) ?? null;
  return reason?.kind === 'noIdentity' && row.add.originalArtist.trim() !== '' ? null : reason;
}

/**
 * A row's marks: an end the apply needs and does not have (`needsEnd`); an add that repeats a row the stream keeps or an
 * earlier add (`repeats`), which therefore starts unticked; why the guard held the row's default back (`held`, its
 * `heldReason`: the same 重複 for two adds of one title that touch); a live row, or the base row an add stands for,
 * that is not as it was when the submission was made (`changedSince`); a live row the contributor never saw
 * (`notSeen`), unless they saw no row at all (`sawNoRow`, said once for every row); and a live row the site does not
 * show (`onSite`), which no apply publishes.
 */
export function rowMarks(row: ReviewRow, sawNone: boolean, held: GuardReason | null): RowMark[] {
  const marks: RowMark[] = [];
  const heldMark = held === null ? null : HELD_MARKS[held.kind];
  if (row.flags.needsEnd) marks.push('需要結束時間');
  if (row.flags.repeats) marks.push('重複');
  if (heldMark !== null && !marks.includes(heldMark)) marks.push(heldMark);
  if (row.flags.changedSince) marks.push('投稿後已變更');
  if (row.flags.notSeen && !sawNone) marks.push('投稿時未顯示');
  if (row.kind !== 'add' && !row.current.onSite) marks.push('未公開');
  return marks;
}

/**
 * Whether a pair's live row is off the site and the apply leaves it there: every such row but one the apply publishes.
 * An apply never changes a performance's status, so a row that is not approved itself stays off; on a stream that is
 * not public, an apply that would put a row on the site is refused; and a title choice that keeps the row's song
 * (ignore, rename) keeps that song's status. On a public stream an approved row goes on the site in two ways, which the
 * draft's end rule reads too: its own title choice relinks it (`relinkPublishes`), giving it a song that is approved, or
 * approved along with the apply; or its song is one of the pending songs the apply approves (`promoted`, the draft's
 * `promotedSongs`), because a ticked add or a title choice of another row lands on it, whatever this row's own choice.
 */
export function staysOffSite(view: NovaVodCorrectionView, row: PairRow, promoted: ReadonlySet<string>): boolean {
  const publishedWithItsSong = promoted.has(row.current.songId) && row.current.status === 'approved' && view.stream.status === 'approved';
  return !row.current.onSite && !publishedWithItsSong && !relinkPublishes(view, row.current, row.pair.title);
}

/** A row's number: its place in the stream's current list, or + for a row the submission adds. */
export function rowNumber(row: ReviewRow): string {
  if (row.kind === 'add') return '+';
  return String((row.kind === 'pair' ? row.pair.currentIndex : row.entry.currentIndex) + 1);
}

/** Whether the row as decided applies anything: a row that applies nothing is shaded. */
export function rowApplies(row: ReviewRow): boolean {
  if (row.kind === 'add') return row.add.apply;
  if (row.kind === 'delete') return row.entry.apply;
  return row.pair.applyTimes || row.pair.title.kind !== 'ignore';
}

type PairEdit = Partial<Pick<PairDraft, 'applyTimes' | 'timestamp' | 'endTimestamp' | 'title'>>;
type AddEdit = Partial<Pick<AddDraft, 'apply' | 'title' | 'originalArtist' | 'timestamp' | 'endTimestamp'>>;

function replaced<T>(items: readonly T[], index: number, next: (item: T) => T): T[] {
  return items.map((item, position) => (position === index ? next(item) : item));
}

export function withPair(draft: CorrectionDraft, index: number, edit: PairEdit): CorrectionDraft {
  return { ...draft, pairs: replaced(draft.pairs, index, (pair) => ({ ...pair, ...edit })) };
}

export function withAdd(draft: CorrectionDraft, index: number, edit: AddEdit): CorrectionDraft {
  return { ...draft, adds: replaced(draft.adds, index, (add) => ({ ...add, ...edit })) };
}

export function withDelete(draft: CorrectionDraft, index: number, apply: boolean): CorrectionDraft {
  return { ...draft, deletes: replaced(draft.deletes, index, (entry) => ({ ...entry, apply })) };
}

/**
 * Whether an add of `title` and `originalArtist` would approve a pending song along with the apply: the worker promotes
 * a pending song a row lands on, on a public stream only. The song is the draft's `addLandingSong`: the one resolution
 * found for the submitted title with the artist the add is sent with, the submitted one (a blank artist read as Unknown,
 * as resolution reads it) or, for a row submitted with no artist, an artist of the stream (`existingSongsByLiveArtist`),
 * so it says nothing once the title, or the artist to one resolution did not try, is typed over.
 */
export function landsOnPendingSong(
  view: NovaVodCorrectionView,
  proposed: CorrectionProposedRow,
  title: string,
  originalArtist: string,
): boolean {
  return addLandingSong(view, proposed, title, originalArtist)?.status === 'pending';
}

/**
 * Whether a pair's title choice would approve a pending song along with the apply: the one it picks, or the one it
 * resolves to (the draft's `choiceLandingSong`), on a public stream, for a relink of an approved row. A row that is not
 * approved stays off the site whatever its song, so its relink approves nothing. A row submitted with no artist offers
 * 「改連到新的歌」 under the artist of the stream's row: with the submitted title and an artist the stream has, it
 * resolves to the song that artist's entry names (`existingSongsByLiveArtist`). Anything else is read as
 * `landsOnPendingSong` reads it.
 */
export function choiceLandsOnPendingSong(
  view: NovaVodCorrectionView,
  proposed: CorrectionProposedRow,
  current: CorrectionCurrentRow,
  choice: TitleChoice,
): boolean {
  return choiceLandingSong(view, proposed, current, choice)?.status === 'pending';
}
