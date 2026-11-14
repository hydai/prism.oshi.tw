import { useId, useState } from 'react';
import type { NovaVodCorrectionView } from '../../../../shared/vod-correction';
import { pairWith, unpair, type CorrectionDraft } from '../../lib/vod-correction-draft';
import { IconButton } from '../ui/Button';
import { Checkbox } from '../ui/Fields';
import { Icon } from '../ui/Icon';
import { Pill, type Tone } from '../ui/Pill';
import { CorrectionPanel } from './CorrectionPanel';
import { SeekButton } from './SeekButton';
import {
  addKey,
  NEW_VALUE,
  OLD_VALUE,
  pairKey,
  reviewRows,
  rowApplies,
  rowChips,
  rowNumber,
  withAdd,
  withDelete,
  withPair,
  type AddRow,
  type PairRow,
  type ReviewRow,
  type RowChip,
} from './review-rows';

const CHIP_TONES: Record<RowChip, Tone> = { 時間: 'info', 歌名: 'violet', 新增: 'ok', 刪除: 'danger' };

/**
 * One line of a row. Below 1280 px the times take a second line under the title, where the row list is narrow (one
 * column of a two-column page, or a phone); from there the times and the chips sit in columns of their own, which
 * line up from row to row. Its cells: the tick, the number, the title and artist, the start and the end (each old →
 * new), the chips and the expand control.
 */
const ROW_GRID =
  'grid grid-cols-[16px_20px_minmax(0,1fr)_auto_28px] items-center gap-x-2 gap-y-1 rounded-radius-md px-1.5 py-1.5 xl:grid-cols-[16px_20px_minmax(0,1fr)_7.5rem_7.5rem_4.5rem_28px]';
const TIMES_CELL = 'col-span-3 col-start-3 row-start-2 flex flex-wrap items-center gap-x-4 xl:contents';

type Seek = (seconds: number) => void;

/** A time as the row changes it: the one it has, struck, and the one it gets; just one when they agree; — for none. */
function TimeChange({ from, to, onSeek }: { from?: number | null; to?: number | null; onSeek: Seek }) {
  const show = (seconds: number | null | undefined, className: string) =>
    seconds === null || seconds === undefined ? <span className="font-mono text-[11.5px] text-fg-subtle">—</span> : <SeekButton seconds={seconds} onSeek={onSeek} className={className} />;
  if (from === undefined) return <span className="whitespace-nowrap">{show(to, NEW_VALUE)}</span>;
  if (to === undefined || to === from) return <span className="whitespace-nowrap">{show(from, 'text-fg-muted')}</span>;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      {show(from, OLD_VALUE)}
      <span aria-hidden="true" className="text-fg-subtle">
        →
      </span>
      {show(to, NEW_VALUE)}
    </span>
  );
}

/** A row's title and artist as it shows: the stream's for a pair and a delete, the submitted (and edited) for an add. */
function rowSong(row: ReviewRow): { title: string; originalArtist: string } {
  return row.kind === 'add' ? row.add : row.current;
}

function RowTick({ row, draft, onDraft }: { row: ReviewRow; draft: CorrectionDraft; onDraft: (next: CorrectionDraft) => void }) {
  const { title } = rowSong(row);
  if (row.kind === 'add') {
    return <Checkbox checked={row.add.apply} onChange={(apply) => onDraft(withAdd(draft, row.index, { apply }))} label={`新增 ${title}`} />;
  }
  if (row.kind === 'delete') {
    return <Checkbox checked={row.entry.apply} onChange={(apply) => onDraft(withDelete(draft, row.index, apply))} label={`刪除 #${rowNumber(row)} ${title}`} />;
  }
  // A pair's tick is its time change; one with none to suggest has no tick (its title is chosen in the panel).
  if (!row.changes.start && !row.changes.end) return <span />;
  return (
    <Checkbox
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
  view: NovaVodCorrectionView;
  draft: CorrectionDraft;
  onDraft: (next: CorrectionDraft) => void;
  onSeek: Seek;
  expanded: boolean;
  onToggle: () => void;
  onUnpair: (row: PairRow) => void;
  onPair: (row: AddRow, deleteIndex: number) => void;
}

/**
 * One row to review: its compact line, and while expanded its decision panel. The open row's line wears the selected
 * tint and its panel sits on the card below it, as the mockup draws them. A row that applies nothing is dimmed.
 */
function CorrectionRow({ row, view, draft, onDraft, onSeek, expanded, onToggle, onUnpair, onPair }: RowProps) {
  const panelId = useId();
  const { title } = rowSong(row);
  return (
    <li>
      <div className={`${ROW_GRID}${expanded ? ' bg-selected' : ''}${rowApplies(row) ? '' : ' opacity-60'}`}>
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
      </div>
      {expanded ? (
        <CorrectionPanel id={panelId} view={view} draft={draft} onDraft={onDraft} row={row} onUnpair={onUnpair} onPair={onPair} onSeek={onSeek} />
      ) : null}
    </li>
  );
}

/** The pairs the submission left exactly as they are: one line that opens onto them, to read and to seek. */
function UnchangedRows({ rows, onSeek }: { rows: ReviewRow[]; onSeek: Seek }) {
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
 * player), its chips and an expand control that opens its decision panel. Pairs the submission left as they are
 * collapse into 「未變更 n 首」. Every decision is written to the draft through `onDraft`; re-pairing opens the row it
 * makes. The open rows belong to the view they were opened on: a reloaded review opens with every row closed.
 */
export function CorrectionRows({
  view,
  draft,
  onDraft,
  onSeek,
}: {
  view: NovaVodCorrectionView;
  draft: CorrectionDraft;
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
  const { rows, unchanged } = reviewRows(view, draft);

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
      <ol aria-label="逐首對照" className="flex flex-col gap-0.5">
        {rows.map((row) => (
          <CorrectionRow
            key={row.key}
            row={row}
            view={view}
            draft={draft}
            onDraft={onDraft}
            onSeek={onSeek}
            expanded={open.has(row.key)}
            onToggle={() => setOpen(row.key, !open.has(row.key))}
            onUnpair={handleUnpair}
            onPair={handlePair}
          />
        ))}
      </ol>
      {unchanged.length > 0 ? <UnchangedRows rows={unchanged} onSeek={onSeek} /> : null}
    </div>
  );
}
