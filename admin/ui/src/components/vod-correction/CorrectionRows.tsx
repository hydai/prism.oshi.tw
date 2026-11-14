import { useId, useState } from 'react';
import type { NovaVodCorrectionView } from '../../../../shared/vod-correction';
import { pairWith, tickAllAdds, tickAllTimes, unpair, type CorrectionDraft } from '../../lib/vod-correction-draft';
import type { DraftGuard } from '../../lib/vod-correction-guard';
import { Button, IconButton } from '../ui/Button';
import { Checkbox } from '../ui/Fields';
import { Icon } from '../ui/Icon';
import { Note } from '../ui/Note';
import { Pill, type Tone } from '../ui/Pill';
import { CorrectionPanel, TickBox } from './CorrectionPanel';
import { NoTime, SeekButton, type TimeCue } from './SeekButton';
import {
  addKey,
  heldReason,
  NEW_VALUE,
  OLD_VALUE,
  pairKey,
  reviewRows,
  rowApplies,
  rowChips,
  rowMarks,
  rowNumber,
  sawNoRow,
  withAdd,
  withDelete,
  withPair,
  type AddRow,
  type DraftFlags,
  type PairRow,
  type ReviewRow,
  type RowChip,
  type RowMark,
} from './review-rows';

const CHIP_TONES: Record<RowChip, Tone> = { 時間: 'info', 歌名: 'violet', 新增: 'ok', 刪除: 'danger' };

/**
 * A missing end holds the apply; a row changed since, or one whose default the guard held back, asks for a look; one
 * unseen, off the site or repeated is a fact (a repeat starts unticked, so it holds nothing back).
 */
const MARK_TONES: Record<RowMark, Tone> = {
  需要結束時間: 'danger',
  重複: 'neutral',
  移動太遠: 'warn',
  歌名不同: 'warn',
  長度改變: 'warn',
  只列部分: 'warn',
  會重疊: 'warn',
  沒有原唱: 'warn',
  太短: 'warn',
  可能重複貼上: 'warn',
  投稿後已變更: 'warn',
  投稿時未顯示: 'neutral',
  未公開: 'neutral',
};

/**
 * Said once, above the rows, in place of 投稿時未顯示 on every one, when the contributor saw no row (`sawNoRow`) and the
 * stream has rows now: with none, every row is one the contributor adds, and the line would be untrue.
 */
const SAW_NO_ROW = '投稿時這場直播還沒有公開的歌曲，以下各列投稿者都沒看過。';

/**
 * Said once, above the rows, when the guard held back the review's defaults as a whole (`DraftGuard.banner`): it cannot
 * tell what list the contributor saw, as Nova recorded none or no revision confirmed the one it recorded, so nothing
 * opens ticked; the adds look like a second copy of the list, so none does; or the list leaves out much of the current
 * one, so no time change does.
 */
const GUARD_BANNERS: Record<NonNullable<DraftGuard['banner']>, string> = {
  baseMissing: '這份投稿沒有記錄投稿者當時看到的歌單，所有變更都預設不勾，請逐項確認。',
  baseUnverified: '投稿者沒有在送出的地方載入目前歌單，無法確認他看到的是哪一版，所有變更都預設不勾，請逐項確認。',
  pastedList: '這份投稿看起來貼了兩份歌單，新增的歌都預設不勾。',
  partialList: '這份投稿只列了目前歌單的一部分，時間變更都預設不勾。',
};

/**
 * One line of a row. Below 1280 px the times take a second line under the title, where the row list is narrow (one
 * column of a two-column page, or a phone); from there the times and the chips sit in columns of their own, which
 * line up from row to row. Its cells: the tick, the number, the title and artist, the start and the end (each old →
 * new), the chips and the expand control.
 */
const ROW_GRID =
  'grid grid-cols-[16px_20px_minmax(0,1fr)_auto_28px] items-center gap-x-2 gap-y-1 rounded-radius-md px-1.5 py-1.5 xl:grid-cols-[16px_20px_minmax(0,1fr)_7.5rem_7.5rem_4.5rem_28px]';
const TIMES_CELL = 'col-span-3 col-start-3 row-start-2 flex flex-wrap items-center gap-x-4 xl:contents';
/** A row's marks: a line of their own under the title, as wide as the rest of the row, on the rows that have any. */
const MARKS_LINE = 'col-[3/-1] flex flex-wrap items-center gap-1';

type Seek = (seconds: number) => void;

/**
 * A time as the row changes it: the one it has, struck, and the one it gets, each named for which it is (`TimeCue`),
 * as the looks and the arrow are only seen; just one when they agree; — for none.
 */
function TimeChange({ from, to, onSeek }: { from?: number | null; to?: number | null; onSeek: Seek }) {
  const show = (seconds: number | null | undefined, className: string, cue?: TimeCue) =>
    seconds === null || seconds === undefined ? (
      <NoTime className="text-fg-subtle" cue={cue} />
    ) : (
      <SeekButton seconds={seconds} onSeek={onSeek} className={className} cue={cue} />
    );
  if (from === undefined) return <span className="whitespace-nowrap">{show(to, NEW_VALUE)}</span>;
  if (to === undefined || to === from) return <span className="whitespace-nowrap">{show(from, 'text-fg-muted')}</span>;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      {show(from, OLD_VALUE, '目前')}
      <span aria-hidden="true" className="text-fg-subtle">
        →
      </span>
      {show(to, NEW_VALUE, '改為')}
    </span>
  );
}

/** A row's title and artist as it shows: the stream's for a pair and a delete, the submitted (and edited) for an add. */
function rowSong(row: ReviewRow): { title: string; originalArtist: string } {
  return row.kind === 'add' ? row.add : row.current;
}

/**
 * A row's tick. A time typed in a pair's or an add's panel ticks it when committed, so a press of it acts on the box
 * as it was pressed (`TickBox`).
 */
function RowTick({ row, draft, onDraft }: { row: ReviewRow; draft: CorrectionDraft; onDraft: (next: CorrectionDraft) => void }) {
  const { title } = rowSong(row);
  if (row.kind === 'add') {
    return <TickBox checked={row.add.apply} onChange={(apply) => onDraft(withAdd(draft, row.index, { apply }))} label={`新增 ${title}`} />;
  }
  if (row.kind === 'delete') {
    return <Checkbox checked={row.entry.apply} onChange={(apply) => onDraft(withDelete(draft, row.index, apply))} label={`刪除 #${rowNumber(row)} ${title}`} />;
  }
  // A pair's tick is its time change; one with none to suggest has no tick (its title is chosen in the panel).
  if (!row.changes.start && !row.changes.end) return <span />;
  return (
    <TickBox
      checked={row.pair.applyTimes}
      onChange={(applyTimes) => onDraft(withPair(draft, row.index, { applyTimes }))}
      label={`套用 #${rowNumber(row)} ${title} 的時間`}
    />
  );
}

function RowTimes({ row, onSeek }: { row: ReviewRow; onSeek: Seek }) {
  if (row.kind === 'add') {
    return (
      <span className={TIMES_CELL}>
        <TimeChange to={row.add.timestamp} onSeek={onSeek} />
        <TimeChange to={row.add.endTimestamp} onSeek={onSeek} />
      </span>
    );
  }
  if (row.kind === 'delete') {
    return (
      <span className={TIMES_CELL}>
        <TimeChange from={row.current.timestamp} onSeek={onSeek} />
        <TimeChange from={row.current.endTimestamp} onSeek={onSeek} />
      </span>
    );
  }
  return (
    <span className={TIMES_CELL}>
      <TimeChange from={row.current.timestamp} to={row.pair.timestamp} onSeek={onSeek} />
      <TimeChange from={row.current.endTimestamp} to={row.pair.endTimestamp} onSeek={onSeek} />
    </span>
  );
}

/** What the curator must know of a row beyond what it suggests (`rowMarks`), when there is anything. */
function RowMarks({ row, sawNone, guard }: { row: ReviewRow; sawNone: boolean; guard: DraftGuard }) {
  const marks = rowMarks(row, sawNone, heldReason(row, guard));
  if (marks.length === 0) return null;
  return (
    <span className={MARKS_LINE}>
      {marks.map((mark) => (
        <Pill key={mark} tone={MARK_TONES[mark]}>
          {mark}
        </Pill>
      ))}
    </span>
  );
}

function RowTitle({ row }: { row: ReviewRow }) {
  const { title, originalArtist } = rowSong(row);
  return (
    <span className="flex min-w-0 items-baseline gap-1.5">
      <b className="min-w-0 truncate font-bold text-fg" title={title}>
        {title}
      </b>
      <span className="min-w-0 truncate text-meta text-fg-muted">{originalArtist}</span>
    </span>
  );
}

interface RowProps {
  row: ReviewRow;
  /** The contributor saw no row (`sawNoRow`): the rows are not marked 投稿時未顯示 one by one. */
  sawNone: boolean;
  view: NovaVodCorrectionView;
  draft: CorrectionDraft;
  /** What the guard held back when the review opened, and why: the row's mark, and its panel's hint. */
  guard: DraftGuard;
  onDraft: (next: CorrectionDraft) => void;
  onSeek: Seek;
  expanded: boolean;
  onToggle: () => void;
  onUnpair: (row: PairRow) => void;
  onPair: (row: AddRow, deleteIndex: number) => void;
}

/**
 * One row to review: its compact line, and while expanded its decision panel. The open row's line wears the selected
 * tint and its panel sits on the card below it, as the mockup draws them. A row that applies nothing is shaded with the
 * neutral tone rather than dimmed: its text and its seek and expand controls keep their full contrast.
 */
function CorrectionRow({ row, sawNone, view, draft, guard, onDraft, onSeek, expanded, onToggle, onUnpair, onPair }: RowProps) {
  const panelId = useId();
  const { title } = rowSong(row);
  const tint = expanded ? ' bg-selected' : rowApplies(row) ? '' : ' bg-tone-neutral-bg';
  return (
    <li>
      <div className={`${ROW_GRID}${tint}`}>
        <RowTick row={row} draft={draft} onDraft={onDraft} />
        <span className="font-mono text-meta text-fg-subtle">{rowNumber(row)}</span>
        <RowTitle row={row} />
        <RowTimes row={row} onSeek={onSeek} />
        <span className="flex flex-wrap gap-1">
          {rowChips(row).map((chip) => (
            <Pill key={chip} tone={CHIP_TONES[chip]}>
              {chip}
            </Pill>
          ))}
        </span>
        <IconButton
          label={`${expanded ? '收合' : '展開'}「${title}」`}
          icon={expanded ? 'chevronDown' : 'chevronRight'}
          size="sm"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={onToggle}
        />
        <RowMarks row={row} sawNone={sawNone} guard={guard} />
      </div>
      {expanded ? (
        <CorrectionPanel
          id={panelId}
          view={view}
          draft={draft}
          guard={guard}
          onDraft={onDraft}
          row={row}
          onUnpair={onUnpair}
          onPair={onPair}
          onSeek={onSeek}
        />
      ) : null}
    </li>
  );
}

/** The pairs the submission left exactly as they are: one line that opens onto them, to read and to seek, marks and all. */
function UnchangedRows({ rows, sawNone, guard, onSeek }: { rows: ReviewRow[]; sawNone: boolean; guard: DraftGuard; onSeek: Seek }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-line-soft pt-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 rounded-radius-sm px-1.5 py-1 text-token-sm text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:shadow-focus"
      >
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} />
        {`未變更 ${rows.length} 首`}
      </button>
      {open ? (
        <ol aria-label="未變更" className="flex flex-col">
          {rows.map((row) => (
            <li key={row.key} className={ROW_GRID}>
              <span />
              <span className="font-mono text-meta text-fg-subtle">{rowNumber(row)}</span>
              <RowTitle row={row} />
              <RowTimes row={row} onSeek={onSeek} />
              <RowMarks row={row} sawNone={sawNone} guard={guard} />
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

/**
 * The rows of a correction review, in time order (layout B, rows option 1): one compact row per pair, add and
 * delete, each with its tick, number, title and artist, its start and end old → new (every time a seek of the
 * player), its chips and an expand control that opens its decision panel, and under them its marks, if it has any.
 * When the contributor saw no row (`sawNoRow`) of a stream that has rows now, one line above the rows says so, in
 * place of that mark on each; so does one when the guard held the review's defaults back as a whole (`guard.banner`).
 * Under them, 「全選時間」 and 「全選新增」 tick every pair's times, or every add, that the review would open ticked before
 * the guard (`tickAllTimes`, `tickAllAdds`), and leave every other tick as it is; each is unavailable while it would
 * change nothing.
 * Pairs the submission left as they are collapse into 「未變更 n 首」. Every decision is written to the draft through
 * `onDraft`; re-pairing opens the row it makes. The open rows belong to the view they were opened on: a reloaded
 * review opens with every row closed. `flags` are the draft's `draftFlags`, and `guard` what the guard held back when
 * the review opened (`guardedInitialDraft`), both worked out by the page.
 */
export function CorrectionRows({
  view,
  draft,
  guard,
  flags,
  onDraft,
  onSeek,
}: {
  view: NovaVodCorrectionView;
  draft: CorrectionDraft;
  guard: DraftGuard;
  flags: DraftFlags;
  onDraft: (next: CorrectionDraft) => void;
  onSeek: (seconds: number) => void;
}) {
  const [opened, setOpened] = useState<{ view: NovaVodCorrectionView; keys: ReadonlySet<string> } | null>(null);
  const open: ReadonlySet<string> = opened !== null && opened.view === view ? opened.keys : new Set<string>();
  const setOpen = (key: string, isOpen: boolean) => {
    const keys = new Set(open);
    if (isOpen) keys.add(key);
    else keys.delete(key);
    setOpened({ view, keys });
  };
  const { rows, unchanged } = reviewRows(view, draft, flags);
  const sawNone = sawNoRow(view);
  // `draft` itself when there is nothing to tick: the button would change nothing.
  const allTimes = tickAllTimes(draft, view);
  const allAdds = tickAllAdds(draft, view);

  const handleUnpair = (row: PairRow) => {
    onDraft(unpair(draft, view, row.index));
    setOpen(addKey(row.proposed), true);
  };
  const handlePair = (row: AddRow, deleteIndex: number) => {
    const current = view.current[draft.deletes[deleteIndex]?.currentIndex ?? -1];
    onDraft(pairWith(draft, view, row.index, deleteIndex));
    if (current) setOpen(pairKey(current, row.proposed), true);
  };

  return (
    <div className="flex min-w-0 flex-col gap-1">
      {guard.banner !== null ? <Note tone="warn">{GUARD_BANNERS[guard.banner]}</Note> : null}
      {sawNone && view.current.length > 0 ? <Note tone="neutral">{SAW_NO_ROW}</Note> : null}
      {/* aria-disabled, not disabled: the press that ticks everything leaves the focus on the button it made unavailable. */}
      <div className="flex flex-wrap items-center gap-2 px-1.5 py-1">
        <Button size="sm" aria-disabled={allTimes === draft ? true : undefined} onClick={() => onDraft(allTimes)}>
          全選時間
        </Button>
        <Button size="sm" aria-disabled={allAdds === draft ? true : undefined} onClick={() => onDraft(allAdds)}>
          全選新增
        </Button>
      </div>
      <ol aria-label="逐首對照" className="flex flex-col gap-0.5">
        {rows.map((row) => (
          <CorrectionRow
            key={row.key}
            row={row}
            sawNone={sawNone}
            view={view}
            draft={draft}
            guard={guard}
            onDraft={onDraft}
            onSeek={onSeek}
            expanded={open.has(row.key)}
            onToggle={() => setOpen(row.key, !open.has(row.key))}
            onUnpair={handleUnpair}
            onPair={handlePair}
          />
        ))}
      </ol>
      {unchanged.length > 0 ? <UnchangedRows rows={unchanged} sawNone={sawNone} guard={guard} onSeek={onSeek} /> : null}
    </div>
  );
}
