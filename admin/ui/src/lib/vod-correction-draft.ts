/**
 * The review draft of a VOD correction, as plain data: for every pair the time edit and the title choice the
 * curator wants, for every add and delete whether it is ticked. `initialDraft` starts from the suggested pairing,
 * `unpair` and `pairWith` re-pair by hand, and `draftOperations` converts a draft into what
 * `POST /api/nova/vods/:id/apply` takes.
 *
 * Two comparisons are kept apart. What the submission *suggests* (the pair's change flags, `suggestedChanges`: the
 * matcher's `correctionChanges`, with an end the contributor did not give read as none) sets the defaults and decides
 * what counts as skipped. What a draft would *send* (its values against the current row, as typed) decides which
 * operations exist and which keys each carries: the apply parser refuses an operation with a key its variant does not
 * have, and one that sets nothing.
 *
 * Pure and total, and free of React: no input is modified, and an index that points at no row leaves a draft as
 * it was (or leaves that entry out of the operations). Whether a value is sound (an end after its start, a title
 * that is not blank) is not checked here; the server refuses what it must and says which operation.
 */
import type { Status } from '../../../shared/types';
import { correctionChanges } from '../../../shared/vod-correction';
import type {
  CorrectionCurrentRow,
  CorrectionOperation,
  CorrectionPair,
  CorrectionSkipped,
  NovaVodCorrectionView,
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

const UNKNOWN_ARTIST = 'Unknown';

/** A title as it is compared and sent: without the whitespace round it. */
const titleText = (title: string): string => title.trim();

/** An artist as it is compared and sent: trimmed, and 'Unknown' when nothing is left, as the catalog stores a blank one. */
const artistText = (originalArtist: string): string => originalArtist.trim() || UNKNOWN_ARTIST;

type SongText = { title: string; originalArtist: string };

/**
 * Whether two rows name the same song as typed (`titleText`, `artistText`), which a rename compares: unlike the
 * matcher's `normalizeForMatching`, a difference of only the case or the character width counts.
 */
export function sameSongText(left: SongText, right: SongText): boolean {
  return titleText(left.title) === titleText(right.title) && artistText(left.originalArtist) === artistText(right.originalArtist);
}

const present = <T>(value: T | null): T[] => (value === null ? [] : [value]);

/**
 * The end a proposed row proposes for the current row it is paired with. Nova's parser fills a missing end with the
 * next row's start and leaves the last one empty, so an end equal to the next proposed row's start, or no end against
 * a current one, is *derived*: the parser's, not the contributor's. A derived end proposes none, and the current end
 * stays.
 */
function proposedEnd(view: NovaVodCorrectionView, current: CorrectionCurrentRow, proposedIndex: number): number | null {
  const proposed = view.proposed[proposedIndex];
  if (!proposed) return current.endTimestamp;
  const derived =
    proposed.endTimestamp === null
      ? current.endTimestamp !== null
      : proposed.endTimestamp === view.proposed[proposedIndex + 1]?.timestamp;
  return derived ? current.endTimestamp : proposed.endTimestamp;
}

/**
 * Which fields of a pair the submission suggests changing: the matcher's flags (`correctionChanges`) of its two rows,
 * read with the end the proposed row proposes (`proposedEnd`), so a derived end suggests nothing. The defaults, the
 * skipped counts and the page's chips all read it. Null when either index points at no row.
 */
export function suggestedChanges(
  view: NovaVodCorrectionView,
  currentIndex: number,
  proposedIndex: number,
): CorrectionPair['changes'] | null {
  const current = view.current[currentIndex];
  const proposed = view.proposed[proposedIndex];
  if (!current || !proposed) return null;
  return correctionChanges(current, { ...proposed, endTimestamp: proposedEnd(view, current, proposedIndex) });
}

/**
 * A pair as it starts, whether the matcher suggested it or the curator made it by hand: the flags are asked of the
 * two rows (`view.match` holds the suggested pairs only, and goes stale once the draft re-pairs), so both start alike.
 */
function pairOf(view: NovaVodCorrectionView, currentIndex: number, proposedIndex: number): PairDraft | null {
  const current = view.current[currentIndex];
  const proposed = view.proposed[proposedIndex];
  const changes = suggestedChanges(view, currentIndex, proposedIndex);
  if (!current || !proposed || !changes) return null;
  return {
    currentIndex,
    proposedIndex,
    applyTimes: changes.start || changes.end,
    timestamp: proposed.timestamp,
    endTimestamp: proposedEnd(view, current, proposedIndex),
    title: { kind: 'ignore' },
  };
}

function addOf(view: NovaVodCorrectionView, proposedIndex: number): AddDraft | null {
  const proposed = view.proposed[proposedIndex];
  if (!proposed) return null;
  return {
    proposedIndex,
    apply: true,
    title: proposed.title,
    originalArtist: proposed.originalArtist,
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
 * start, or gave another end that is not derived) and no title change, every unpaired proposed row as a ticked add,
 * and every unpaired current row as an unticked delete.
 */
export function initialDraft(view: NovaVodCorrectionView): CorrectionDraft {
  return ordered({
    pairs: view.match.pairs.flatMap(({ currentIndex, proposedIndex }) => present(pairOf(view, currentIndex, proposedIndex))),
    adds: view.match.unpairedProposed.flatMap((proposedIndex) => present(addOf(view, proposedIndex))),
    deletes: view.match.unpairedCurrent.flatMap((currentIndex) => present(deleteOf(view, currentIndex))),
  });
}

/**
 * Split the pair at `pairIndex` (a position in `draft.pairs`) into a ticked add of its proposed row and an unticked
 * delete of its current row. The add starts from the proposed row again, so the pair's edits are dropped.
 */
export function unpair(draft: CorrectionDraft, view: NovaVodCorrectionView, pairIndex: number): CorrectionDraft {
  const pair = draft.pairs[pairIndex];
  if (!pair) return draft;
  const add = addOf(view, pair.proposedIndex);
  const removal = deleteOf(view, pair.currentIndex);
  if (!add || !removal) return draft;
  return ordered({
    pairs: without(draft.pairs, pairIndex),
    adds: [...draft.adds, add],
    deletes: [...draft.deletes, removal],
  });
}

/**
 * Pair the add at `addIndex` with the delete at `deleteIndex` (positions in `draft.adds` and `draft.deletes`): the
 * reverse of `unpair`. The pair starts as a suggested one does, from the proposed row's times, ticked when they
 * suggest a change to the current row's, with no title change, whatever the add and the delete were edited to.
 */
export function pairWith(draft: CorrectionDraft, view: NovaVodCorrectionView, addIndex: number, deleteIndex: number): CorrectionDraft {
  const add = draft.adds[addIndex];
  const removal = draft.deletes[deleteIndex];
  if (!add || !removal) return draft;
  const pair = pairOf(view, removal.currentIndex, add.proposedIndex);
  if (!pair) return draft;
  return ordered({
    pairs: [...draft.pairs, pair],
    adds: without(draft.adds, addIndex),
    deletes: without(draft.deletes, deleteIndex),
  });
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
 */
function titleOperation(choice: TitleChoice, current: CorrectionCurrentRow): CorrectionOperation | null {
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
      return { op: 'relinkToSong', performanceId: current.performanceId, songId: choice.songId };
    case 'relinkNew':
      return {
        op: 'relinkToNewSong',
        performanceId: current.performanceId,
        title: titleText(choice.title),
        originalArtist: artistText(choice.originalArtist),
      };
  }
}

/**
 * What to send for `draft`, and what the curator left out.
 *
 * `operations` come in row order: each pair's time edit and then its title edit, the adds, the deletes. A pair
 * with no change to send gives no operation for it. `skipped` counts, per kind, the suggested changes that did not
 * become an operation (the time moves, the title or artist differences, the adds and the deletes left unticked), so
 * a suggestion is always counted as one or the other, however the draft was edited. `appliedCount` is the number of
 * operations and `skippedCount` the sum of `skipped`.
 */
export function draftOperations(
  draft: CorrectionDraft,
  view: NovaVodCorrectionView,
): { operations: CorrectionOperation[]; skipped: CorrectionSkipped; appliedCount: number; skippedCount: number } {
  const operations: CorrectionOperation[] = [];
  const skipped: CorrectionSkipped = { time: 0, title: 0, add: 0, delete: 0 };

  for (const pair of draft.pairs) {
    const current = view.current[pair.currentIndex];
    const suggested = suggestedChanges(view, pair.currentIndex, pair.proposedIndex);
    if (!current || !suggested) continue;

    const times = pair.applyTimes ? timeOperation(pair, current) : null;
    if (times) operations.push(times);
    else if (suggested.start || suggested.end) skipped.time += 1;

    const title = titleOperation(pair.title, current);
    if (title) operations.push(title);
    else if (suggested.title || suggested.artist) skipped.title += 1;
  }

  for (const add of draft.adds) {
    if (!add.apply) {
      skipped.add += 1;
      continue;
    }
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
    if (entry.apply) operations.push({ op: 'deletePerformance', performanceId: current.performanceId });
    else skipped.delete += 1;
  }

  return {
    operations,
    skipped,
    appliedCount: operations.length,
    skippedCount: skipped.time + skipped.title + skipped.add + skipped.delete,
  };
}
