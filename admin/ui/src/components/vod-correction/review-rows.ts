/**
 * What the correction review lays out, worked out from a correction and its draft: one row per pair, add and
 * delete, in time order, with the pairs the submission left exactly as they are set apart; the chips that say what
 * each row suggests; and the edits a row makes to the draft. Plain data, free of React: `CorrectionRows` draws it,
 * and the draft (`lib/vod-correction-draft`) holds every decision.
 *
 * What a row suggests is asked of its two rows with the draft's `suggestedChanges` (the matcher's own rule, with an
 * end the contributor did not give read as none), never from the draft's values: a row the curator is editing keeps
 * its chips and its place. Whether a pair is set apart as unchanged is asked of its two rows as they stand.
 */
import { correctionChanges } from '../../../../shared/vod-correction';
import type {
  CorrectionCurrentRow,
  CorrectionPair,
  CorrectionProposedRow,
  NovaVodCorrectionView,
} from '../../../../shared/vod-correction';
import {
  sameSongText,
  suggestedChanges,
  type AddDraft,
  type CorrectionDraft,
  type DeleteDraft,
  type PairDraft,
  type TitleChoice,
} from '../../lib/vod-correction-draft';

interface RowBase {
  /** Stable across re-renders and re-pairing: the ids of the rows it is made of. */
  key: string;
  /** Its position in `draft.pairs`, `draft.adds` or `draft.deletes`, which the draft functions take. */
  index: number;
}

export type ReviewRow =
  | (RowBase & {
      kind: 'pair';
      pair: PairDraft;
      current: CorrectionCurrentRow;
      proposed: CorrectionProposedRow;
      /** What the submission suggests for the pair (`suggestedChanges`): its chips and its tick. */
      changes: CorrectionPair['changes'];
    })
  | (RowBase & { kind: 'add'; add: AddDraft; proposed: CorrectionProposedRow })
  | (RowBase & { kind: 'delete'; entry: DeleteDraft; current: CorrectionCurrentRow });

export type PairRow = Extract<ReviewRow, { kind: 'pair' }>;
export type AddRow = Extract<ReviewRow, { kind: 'add' }>;

/** What a row's chips say, in the order they show. */
export type RowChip = '時間' | '歌名' | '新增' | '刪除';

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
 * The draft's rows in time order: `rows` to review, and `unchanged`, the pairs whose two rows agree in every field,
 * which have nothing to apply. An entry whose row the view lacks is left out, as `draftOperations` leaves it out.
 */
export function reviewRows(view: NovaVodCorrectionView, draft: CorrectionDraft): { rows: ReviewRow[]; unchanged: ReviewRow[] } {
  const all: ReviewRow[] = [];
  draft.pairs.forEach((pair, index) => {
    const current = view.current[pair.currentIndex];
    const proposed = view.proposed[pair.proposedIndex];
    const changes = suggestedChanges(view, pair.currentIndex, pair.proposedIndex);
    if (!current || !proposed || !changes) return;
    all.push({ kind: 'pair', key: pairKey(current, proposed), index, pair, current, proposed, changes });
  });
  draft.deletes.forEach((entry, index) => {
    const current = view.current[entry.currentIndex];
    if (current) all.push({ kind: 'delete', key: `delete-${current.performanceId}`, index, entry, current });
  });
  draft.adds.forEach((add, index) => {
    const proposed = view.proposed[add.proposedIndex];
    if (proposed) all.push({ kind: 'add', key: addKey(proposed), index, add, proposed });
  });
  // A stable sort: rows that start together keep the order above.
  all.sort((left, right) => startOf(left) - startOf(right));
  return { rows: all.filter((row) => !isUnchanged(row)), unchanged: all.filter(isUnchanged) };
}

export function rowChips(row: ReviewRow): RowChip[] {
  if (row.kind === 'add') return ['新增'];
  if (row.kind === 'delete') return ['刪除'];
  const chips: RowChip[] = [];
  if (row.changes.start || row.changes.end) chips.push('時間');
  if (row.changes.title || row.changes.artist) chips.push('歌名');
  return chips;
}

/** A row's number: its place in the stream's current list, or + for a row the submission adds. */
export function rowNumber(row: ReviewRow): string {
  if (row.kind === 'add') return '+';
  return String((row.kind === 'pair' ? row.pair.currentIndex : row.entry.currentIndex) + 1);
}

/** Whether the row as decided applies anything: a row that applies nothing is dimmed. */
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
 * Whether a row that lands on the song `title` and `originalArtist` resolve to would approve that song along with
 * the apply: the worker promotes a pending song a row lands on, on a public stream only. The song is the submitted
 * row's `existingSong`, which was resolved for the submitted title and artist, so it says nothing once either is
 * typed over.
 */
export function landsOnPendingSong(
  view: NovaVodCorrectionView,
  proposed: CorrectionProposedRow,
  title: string,
  originalArtist: string,
): boolean {
  return (
    view.stream.status === 'approved' &&
    proposed.existingSong?.status === 'pending' &&
    title.trim() === proposed.title.trim() &&
    originalArtist.trim() === proposed.originalArtist.trim()
  );
}

/** Whether a pair's title choice would approve a pending song along with the apply: the one it picks, or the one it resolves to. */
export function choiceLandsOnPendingSong(view: NovaVodCorrectionView, proposed: CorrectionProposedRow, choice: TitleChoice): boolean {
  if (choice.kind === 'relinkExisting') return view.stream.status === 'approved' && choice.songStatus === 'pending';
  if (choice.kind === 'relinkNew') return landsOnPendingSong(view, proposed, choice.title, choice.originalArtist);
  return false;
}
