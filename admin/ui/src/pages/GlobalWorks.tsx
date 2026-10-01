import { Fragment, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { GlobalWorkStats, GlobalWorkSummary } from '../../../shared/types';
import { api, ApiError } from '../api/client';
import { Pagination } from '../components/Pagination';
import TagPicker from '../components/TagPicker';
import { BulkBar } from '../components/ui/BulkBar';
import { Button, IconButton } from '../components/ui/Button';
import { buttonClasses } from '../components/ui/button-classes';
import { GlassCard, Skeleton, StatTile } from '../components/ui/Display';
import { Checkbox, SearchInput, Select } from '../components/ui/Fields';
import { Icon } from '../components/ui/Icon';
import { Note } from '../components/ui/Note';
import { PageHeader } from '../components/ui/PageHeader';
import { Pill, type Tone } from '../components/ui/Pill';
import { Popover } from '../components/ui/Popover';
import { HeadCell, SortHeader, Table, TableEmptyRow, THead, type SortDirection } from '../components/ui/Table';
import { CELL_X, FIRST_CELL_X, LAST_CELL_X } from '../components/ui/table-cells';
import { Chip } from '../components/ui/Toggles';
import { useToast } from '../components/ui/toast';
import { getTagLabel, tagsByCategory } from '../../../../lib/tags';
import { useApiResource } from '../lib/apiResource';

type SortKey =
  | 'title'
  | 'originalArtist'
  | 'streamerCount'
  | 'songCount'
  | 'performanceCount'
  | 'updatedAt';

/**
 * The filter bar's sort summary names the active column by this label. `updatedAt` has no
 * `SortHeader` and cannot be reached from the UI today, but the record stays exhaustive over
 * `SortKey` rather than partial.
 */
const SORT_LABELS: Record<SortKey, string> = {
  title: 'Title',
  originalArtist: 'Original artist',
  streamerCount: 'VTubers',
  songCount: 'Local songs',
  performanceCount: 'Performances',
  updatedAt: 'Last updated',
};

const PAGE_SIZE = 50;
/** Select, title, artist, VTubers, local songs, performances, tags, work ID, actions. */
const COLUMN_COUNT = 9;
/**
 * VTuber chips a row shows before folding the rest into `+N`. Three fit the column on one line
 * from 1280 px — but only when they are short enough: real data (data/{slug}/songs.json) had rows
 * at 1280px whose first three slugs (e.g. "earendel", "hibiki", "margaretnorth") all ellipsized
 * instead. There is no way to measure rendered text width outside the browser, so this is a length
 * heuristic, not a pixel-exact one — tuned in Chromium against that data: three chips whose own
 * characters total at most WIDE_STREAMER_CHARS, otherwise two, still folding the rest into the same
 * `+N`.
 */
const WIDE_STREAMER_CHARS = 17;

function visibleStreamerCount(streamerIds: string[]): number {
  const firstThreeChars = streamerIds.slice(0, 3).reduce((total, id) => total + id.length, 0);
  return firstThreeChars <= WIDE_STREAMER_CHARS ? 3 : 2;
}
/**
 * Tag pills that fit the column: two — a language and a source, all a work carries today. With
 * more, `+N` takes the second pill's place, since two pills and a `+N` would not fit.
 */
const VISIBLE_TAGS = 2;
const EMPTY_SELECTION: ReadonlySet<string> = new Set();
const EMPTY_STATS: GlobalWorkStats = {
  totalWorks: 0,
  sharedWorks: 0,
  linkedSongs: 0,
  linkedPerformances: 0,
  unlinkedSongs: 0,
};

const VTUBER_CHIP =
  'max-w-full truncate rounded-radius-pill border border-field-line bg-field px-[7px] py-0.5 text-meta font-medium';

/**
 * A chip cell's single line (the approved 44 px rows): never wraps, and a chip that still does not
 * fit gives way — the visible ones shrink with an ellipsis, the `+N` chip never does.
 */
const CHIP_ROW = 'flex min-w-0 flex-nowrap gap-1 overflow-hidden';

/** Language tags read as info, source tags as violet; an ID outside the dictionary stays neutral. */
function tagTone(tag: string): Tone {
  if (tag.startsWith('language:')) return 'info';
  if (tag.startsWith('source:')) return 'violet';
  return 'neutral';
}

/**
 * What a chip cell leaves out: a `+N` chip (`children`) naming the items in its tooltip, and the
 * same items in an sr-only list, since a screen reader gets no tooltip.
 */
function MoreItems({ items, children }: { items: string[]; children: ReactNode }) {
  if (items.length === 0) return null;
  return (
    <>
      <span aria-hidden="true" title={items.join(', ')} className="flex shrink-0">
        {children}
      </span>
      <ul className="sr-only">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </>
  );
}

interface StatTilesProps {
  stats: GlobalWorkStats;
  /** False until the first response: the zeros shown meanwhile must not claim "all linked". */
  loaded: boolean;
}

/** The five summary tiles above the filters: totals, sharing, linkage, and the unlinked-songs warning. */
function StatTiles({ stats, loaded }: StatTilesProps) {
  const unlinked = stats.unlinkedSongs;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
      <StatTile label="Global works" value={stats.totalWorks.toLocaleString()} />
      <StatTile label="Shared by VTubers" value={stats.sharedWorks.toLocaleString()} />
      <StatTile label="Linked local songs" value={stats.linkedSongs.toLocaleString()} />
      <StatTile label="Linked performances" value={stats.linkedPerformances.toLocaleString()} />
      <StatTile
        label="Unlinked songs"
        value={unlinked.toLocaleString()}
        tone={unlinked > 0 ? 'warn' : undefined}
        hint={loaded && unlinked === 0 ? <span className="text-tone-ok-fg">all linked</span> : undefined}
      />
    </div>
  );
}

interface FilterBarProps {
  sharedOnly: boolean;
  onSharedOnlyChange: (value: boolean) => void;
  untaggedOnly: boolean;
  onUntaggedOnlyChange: (value: boolean) => void;
  tagFilter: string;
  onTagFilterChange: (value: string) => void;
  onAllWorks: () => void;
  sortLabel: string;
  sortDir: SortDirection;
  shown: { start: number; end: number };
  total: number;
}

/**
 * The `All works` chip, the two filter chips, the tag-dictionary `<select>`, and — on the right —
 * which column the table is sorted by and the range of works on screen.
 */
function FilterBar({
  sharedOnly,
  onSharedOnlyChange,
  untaggedOnly,
  onUntaggedOnlyChange,
  tagFilter,
  onTagFilterChange,
  onAllWorks,
  sortLabel,
  sortDir,
  shown,
  total,
}: FilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Chip active={!sharedOnly && !untaggedOnly} onClick={onAllWorks}>
        All works
      </Chip>
      <Chip active={sharedOnly} onClick={() => onSharedOnlyChange(!sharedOnly)}>
        Shared by multiple VTubers only
      </Chip>
      <Chip active={untaggedOnly} onClick={() => onUntaggedOnlyChange(!untaggedOnly)}>
        未標語言
      </Chip>
      <div className="w-40">
        <Select
          aria-label="Filter global works by tag"
          value={tagFilter}
          onChange={(event) => onTagFilterChange(event.target.value)}
        >
          <option value="">All tags</option>
          {tagsByCategory().map(({ category, tags }) => (
            <optgroup key={category.id} label={category.label}>
              {tags.map((tag) => (
                <option key={tag.id} value={tag.id}>{tag.label}</option>
              ))}
            </optgroup>
          ))}
        </Select>
      </div>
      <span className="ml-auto text-token-sm text-fg-muted">
        {`Sorted by ${sortLabel}, ${sortDir === 'asc' ? 'ascending' : 'descending'}`}
        {/* The dot is hidden from assistive technology; the spaces around it are not, so the range
            is read as a word of its own. */}
        {total > 0 ? (
          <>
            {' '}
            <span aria-hidden="true">·</span>
            {' '}
            {shown.start}–{shown.end} of {total}
          </>
        ) : null}
      </span>
    </div>
  );
}

interface BulkTagBarProps {
  selectedCount: number;
  batchTags: string[];
  saving: boolean;
  onBatchTagsChange: (tags: string[]) => void;
  onClear: () => void;
  onApply: (mode: 'add' | 'remove') => void;
}

/**
 * The floating bar shown while rows on the page are selected: pick tags in its popover (opening
 * upward, hung from the bar so it stays on screen at phone widths), then add or remove them
 * across the selection. The picker stays mounted inside the closed popover.
 */
function BulkTagBar({ selectedCount, batchTags, saving, onBatchTagsChange, onClear, onApply }: BulkTagBarProps) {
  return (
    <BulkBar countLabel={`已選擇 ${selectedCount} 個作品`}>
      <Popover
        kind="dialog"
        label="批次編輯共用標籤"
        side="top"
        anchor="container"
        trigger={({ triggerProps }) => (
          <Button {...triggerProps} size="sm">
            批次編輯共用標籤 ({batchTags.length})
          </Button>
        )}
      >
        <div className="p-2">
          <TagPicker value={batchTags} onChange={onBatchTagsChange} disabled={saving} />
        </div>
      </Popover>
      <Button
        variant="primary"
        size="sm"
        icon="plus"
        disabled={saving || batchTags.length === 0}
        onClick={() => onApply('add')}
      >
        加入所選標籤
      </Button>
      <Button size="sm" icon="minus" disabled={saving || batchTags.length === 0} onClick={() => onApply('remove')}>
        移除所選標籤
      </Button>
      <Button variant="ghost" size="sm" icon="x" onClick={onClear}>
        取消選取
      </Button>
    </BulkBar>
  );
}

interface WorkRowProps {
  work: GlobalWorkSummary;
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
  onEdit: () => void;
}

/** One work's row: selection, title, artist, VTuber chips, counts, tag pills, work ID and the Edit tags action. */
function WorkRow({ work, selected, onSelectedChange, onEdit }: WorkRowProps) {
  const streamerChipCount = visibleStreamerCount(work.streamerIds);
  const visibleStreamers = work.streamerIds.slice(0, streamerChipCount);
  const hiddenStreamers = work.streamerIds.slice(streamerChipCount);
  const visibleTags = work.tags.length > VISIBLE_TAGS ? work.tags.slice(0, VISIBLE_TAGS - 1) : work.tags;
  const hiddenTags = work.tags.slice(visibleTags.length);

  return (
    <tr className={`h-11 border-b border-line-soft transition-colors ${selected ? 'bg-selected' : 'hover:bg-row-hover'}`}>
      <td className={`${FIRST_CELL_X} py-2`}>
        {/* A flex box, so the inline label does not sit on the text baseline above the row's middle. */}
        <div className="flex">
          <Checkbox label={`Select ${work.title}`} checked={selected} onChange={onSelectedChange} />
        </div>
      </td>
      <td className={`${CELL_X} py-2`}>
        <div title={work.title} className="truncate font-[650] text-fg">
          {work.title}
        </div>
      </td>
      <td className={`${CELL_X} py-2`}>
        <div title={work.originalArtist} className="truncate text-fg-muted">
          {work.originalArtist}
        </div>
      </td>
      <td className={`${CELL_X} py-2`}>
        <div className={`${CHIP_ROW} justify-end`}>
          {visibleStreamers.map((streamerId) => (
            <span key={streamerId} title={streamerId} className={`${VTUBER_CHIP} text-fg-muted`}>
              {streamerId}
            </span>
          ))}
          <MoreItems items={hiddenStreamers}>
            <span className={`${VTUBER_CHIP} text-fg-subtle`}>+{hiddenStreamers.length}</span>
          </MoreItems>
        </div>
      </td>
      <td className={`${CELL_X} py-2 text-right font-[650] tabular-nums text-fg`}>{work.songCount}</td>
      <td className={`${CELL_X} py-2 text-right font-[650] tabular-nums text-fg`}>{work.performanceCount}</td>
      <td className={`${CELL_X} py-2`}>
        {work.tags.length > 0 ? (
          <div className={CHIP_ROW}>
            {visibleTags.map((tag) => (
              <Pill key={tag} tone={tagTone(tag)} className="min-w-0">
                <span title={getTagLabel(tag)} className="truncate">
                  {getTagLabel(tag)}
                </span>
              </Pill>
            ))}
            <MoreItems items={hiddenTags.map(getTagLabel)}>
              <Pill tone="neutral">+{hiddenTags.length}</Pill>
            </MoreItems>
          </div>
        ) : null}
      </td>
      <td className={`${CELL_X} py-2`}>
        <div title={work.id} className="truncate font-mono text-meta text-fg-subtle">
          {work.id}
        </div>
      </td>
      <td className={`${LAST_CELL_X} py-2 text-right`}>
        <IconButton label="Edit tags" icon="pencil" size="sm" onClick={onEdit} />
      </td>
    </tr>
  );
}

interface WorkEditorRowProps {
  work: GlobalWorkSummary;
  editTags: string[];
  saving: boolean;
  onEditTagsChange: (tags: string[]) => void;
  onSave: () => void;
  onCancel: () => void;
}

/** The inline editor row a work's Edit tags button opens: full-width TagPicker plus Save/Cancel. */
function WorkEditorRow({ work, editTags, saving, onEditTagsChange, onSave, onCancel }: WorkEditorRowProps) {
  return (
    <tr className="border-b border-line-soft bg-field">
      <td colSpan={COLUMN_COUNT} className="px-4 py-4">
        <div className="mb-3">
          <h2 className="break-words text-[13.5px] font-bold text-fg">{work.title} — 共用作品標籤</h2>
          <p className="text-meta text-fg-muted">會套用到所有連結此 Work ID 的 VTuber 歌曲。</p>
        </div>
        <TagPicker value={editTags} onChange={onEditTagsChange} disabled={saving} />
        <div className="mt-3 flex gap-2">
          <Button variant="primary" size="sm" busy={saving} onClick={onSave}>
            {saving ? 'Saving...' : 'Save tags'}
          </Button>
          <Button size="sm" disabled={saving} onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </td>
    </tr>
  );
}

interface WorksTableProps {
  works: GlobalWorkSummary[];
  selectedIds: ReadonlySet<string>;
  allSelected: boolean;
  editingId: string | null;
  editTags: string[];
  saving: boolean;
  sortKey: SortKey;
  sortDir: SortDirection;
  onSort: (field: SortKey) => void;
  onSelectedChange: (id: string, selected: boolean) => void;
  onTogglePageSelection: () => void;
  onEdit: (work: GlobalWorkSummary) => void;
  onEditTagsChange: (tags: string[]) => void;
  onSave: () => void;
  onCancel: () => void;
}

/**
 * The sortable results table in its glass card. Fixed layout: at 1280 px and up it fits the card,
 * the title, artist and work ID cut short (full text in `title`) and the chip cells on one line,
 * so every row is the approved 44 px and the sticky head keeps tracking `<main>`; below that it
 * keeps a minimum width and scrolls inside the card. The card clips with `overflow-clip`, which
 * unlike hidden/auto is no scroll container.
 */
function WorksTable({
  works,
  selectedIds,
  allSelected,
  editingId,
  editTags,
  saving,
  sortKey,
  sortDir,
  onSort,
  onSelectedChange,
  onTogglePageSelection,
  onEdit,
  onEditTagsChange,
  onSave,
  onCancel,
}: WorksTableProps) {
  const sortProps = { activeField: sortKey, direction: sortDir, onSort, className: CELL_X };

  return (
    <GlassCard padding="none" className="overflow-clip">
      <Table className="table-fixed text-[12px] max-xl:min-w-[1000px]">
        {/* Every column holds its head plus the sort chevron (whichever column is sorted). At the
            table's 1000 px minimum, VTubers still fits its chips (three short ones, or two when
            they run long) and `+N`, and tags two pills; the title takes the rest, and a long work
            ID is cut short (full text in `title`). */}
        <colgroup>
          <col className="w-[38px]" />
          <col />
          <col className="w-[12.5%]" />
          <col className="w-[20%]" />
          <col className="w-[110px]" />
          <col className="w-[122px]" />
          <col className="w-[12.5%]" />
          <col className="w-[120px]" />
          <col className="w-[52px]" />
        </colgroup>
        <THead>
          <tr>
            <HeadCell className={FIRST_CELL_X}>
              <div className="flex">
                <Checkbox
                  label="Select all works on this page"
                  checked={allSelected}
                  onChange={onTogglePageSelection}
                />
              </div>
            </HeadCell>
            <SortHeader label="Title" field="title" {...sortProps} />
            <SortHeader label="Original artist" field="originalArtist" {...sortProps} />
            <SortHeader label="VTubers" field="streamerCount" align="end" {...sortProps} />
            <SortHeader label="Local songs" field="songCount" align="end" {...sortProps} />
            <SortHeader label="Performances" field="performanceCount" align="end" {...sortProps} />
            <HeadCell className={CELL_X}>Tags</HeadCell>
            <HeadCell className={CELL_X}>Work ID</HeadCell>
            <HeadCell className={LAST_CELL_X}>
              <span className="sr-only">Actions</span>
            </HeadCell>
          </tr>
        </THead>
        <tbody>
          {works.map((work) => (
            <Fragment key={work.id}>
              <WorkRow
                work={work}
                selected={selectedIds.has(work.id)}
                onSelectedChange={(selected) => onSelectedChange(work.id, selected)}
                onEdit={() => onEdit(work)}
              />
              {editingId === work.id && (
                <WorkEditorRow
                  work={work}
                  editTags={editTags}
                  saving={saving}
                  onEditTagsChange={onEditTagsChange}
                  onSave={onSave}
                  onCancel={onCancel}
                />
              )}
            </Fragment>
          ))}
          {works.length === 0 && <TableEmptyRow colSpan={COLUMN_COUNT}>No global works found.</TableEmptyRow>}
        </tbody>
      </Table>
    </GlassCard>
  );
}

export default function GlobalWorks() {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [sharedOnly, setSharedOnly] = useState(false);
  const [tagFilter, setTagFilter] = useState('');
  const [untaggedOnly, setUntaggedOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('performanceCount');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');
  const [page, setPage] = useState(1);
  // Selection belongs to one query. Any change of page, filter, search or sort starts a
  // fresh one, so the batch bar can never act on rows of a result set the curator has
  // already navigated away from — while the replacement load is in flight, useApiResource
  // still holds the old rows (the table shows a Skeleton meanwhile), and the batch bar,
  // which reads them, must not keep acting on them.
  const queryKey = JSON.stringify([submittedSearch, sharedOnly, tagFilter, untaggedOnly, page, sortKey, sortDir]);
  const [selection, setSelection] = useState<{ queryKey: string; ids: ReadonlySet<string> }>({ queryKey, ids: EMPTY_SELECTION });
  const selectedIds = selection.queryKey === queryKey ? selection.ids : EMPTY_SELECTION;
  const setSelectedIds = (ids: ReadonlySet<string>) => setSelection({ queryKey, ids });
  const [batchTags, setBatchTags] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTags, setEditTags] = useState<string[]>([]);
  // The row's updatedAt the editor was opened with; the save is conditional on it so a
  // curator never overwrites a change someone else made since (409 → notice + reload).
  // Read only inside the save handler, so a ref rather than state that would re-render nothing.
  const editBaseline = useRef<string>('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { data, loading, error, reload } = useApiResource(
    () => api.listGlobalWorks({
      search: submittedSearch || undefined,
      sharedOnly,
      tag: tagFilter || undefined,
      untaggedOnly,
      page,
      pageSize: PAGE_SIZE,
      sortBy: sortKey,
      sortDir,
    }),
    [submittedSearch, sharedOnly, tagFilter, untaggedOnly, page, sortKey, sortDir],
  );
  const works = data?.data ?? [];
  const stats = data?.stats ?? EMPTY_STATS;
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 0;
  // Selection is per page: IDs that are not on the current page are ignored everywhere.
  const selectedOnPage = works.filter((work) => selectedIds.has(work.id));
  const allSelected = works.length > 0 && selectedOnPage.length === works.length;

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    setPage(1);
    setSubmittedSearch(search.trim());
  };

  const toggleSort = (key: SortKey) => {
    setPage(1);
    if (sortKey === key) {
      setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'title' || key === 'originalArtist' ? 'asc' : 'desc');
    }
  };

  const setWorkSelected = (id: string, selected: boolean) => {
    const next = new Set(selectedIds);
    if (selected) next.add(id);
    else next.delete(id);
    setSelectedIds(next);
  };

  const togglePageSelection = () => {
    setSelectedIds(allSelected ? new Set() : new Set(works.map((work) => work.id)));
  };

  const startEditing = (work: GlobalWorkSummary) => {
    setEditingId(work.id);
    setEditTags(work.tags);
    editBaseline.current = work.updatedAt;
    setSaveError(null);
  };

  const reloadAfterWrite = () => {
    setSelectedIds(new Set());
    setEditingId(null);
    reload();
  };

  const saveWorkTags = async () => {
    if (!editingId) return;
    setSaving(true);
    setSaveError(null);
    try {
      await api.updateWorkTags(editingId, { tags: editTags, expectedUpdatedAt: editBaseline.current });
      reloadAfterWrite();
      toast.success('Tags saved');
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 409) {
        setSaveError('這個作品的標籤剛被其他人修改，未儲存；已重新載入，請再試一次');
        reloadAfterWrite();
      } else {
        setSaveError(err instanceof Error ? err.message : 'Failed to update work tags');
      }
    } finally {
      setSaving(false);
    }
  };

  const applyBatch = async (mode: 'add' | 'remove') => {
    if (selectedOnPage.length === 0 || batchTags.length === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await api.bulkUpdateWorkTags({
        workIds: selectedOnPage.map((work) => work.id),
        add: mode === 'add' ? batchTags : [],
        remove: mode === 'remove' ? batchTags : [],
      });
      if (result.skipped.length > 0) {
        setSaveError(`${result.skipped.length} 個作品剛被其他人修改，未套用；已重新載入`);
      }
      setBatchTags([]);
      reloadAfterWrite();
      if (result.updated.length > 0) toast.success(`Tags updated on ${result.updated.length} works`);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Failed to update work tags');
    } finally {
      setSaving(false);
    }
  };

  const startItem = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const endItem = Math.min(page * PAGE_SIZE, total);

  return (
    // No blur, transform or filter on this root or its wrappers (the bulk bar below is `fixed` to the
    // viewport), and no overflow either: the sticky header and table head track <main>.
    <div className="flex flex-col">
      <PageHeader
        crumb="LIBRARY"
        title="Global Song Library"
        meta="One composition identity shared by streamer-local songs and their performances."
        actions={
          <Link to="/works/review" className={buttonClasses({ variant: 'secondary' })}>
            <Icon name="gitCompare" size={14} />
            Review duplicates
          </Link>
        }
      >
        <form role="search" onSubmit={submitSearch} className="flex min-w-0 flex-1 items-center gap-2">
          <SearchInput
            label="Search title or original artist"
            placeholder="Search title or original artist..."
            value={search}
            onChange={setSearch}
            className="min-w-0 flex-1 sm:w-[260px] sm:flex-none"
          />
          <Button type="submit">Search</Button>
        </form>
      </PageHeader>

      {/* While the bulk bar is up, the end of the page scrolls clear of it (BulkBar publishes its height). */}
      <div className="flex flex-col gap-3 p-4 lg:px-5 lg:pb-[18px] [html[data-bulk-bar]_&]:pb-[calc(var(--bulk-bar-h)_+_22px_+_16px)]">
        <StatTiles stats={stats} loaded={data !== null} />

        <FilterBar
          sharedOnly={sharedOnly}
          onSharedOnlyChange={(value) => {
            setPage(1);
            setSharedOnly(value);
          }}
          untaggedOnly={untaggedOnly}
          onUntaggedOnlyChange={(value) => {
            setPage(1);
            setUntaggedOnly(value);
          }}
          tagFilter={tagFilter}
          onTagFilterChange={(value) => {
            setPage(1);
            setTagFilter(value);
          }}
          onAllWorks={() => {
            setPage(1);
            setSharedOnly(false);
            setUntaggedOnly(false);
          }}
          sortLabel={SORT_LABELS[sortKey]}
          sortDir={sortDir}
          shown={{ start: startItem, end: endItem }}
          total={total}
        />

        {/* A failed load or save, inline above the table. */}
        {error && (
          <Note tone="danger" icon="alert" role="alert">
            {error}
          </Note>
        )}
        {saveError && (
          <Note tone="danger" icon="alert" role="alert">
            {saveError}
          </Note>
        )}

        {loading ? (
          <GlassCard>
            <Skeleton rows={8} />
          </GlassCard>
        ) : (
          <div>
            <WorksTable
              works={works}
              selectedIds={selectedIds}
              allSelected={allSelected}
              editingId={editingId}
              editTags={editTags}
              saving={saving}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={toggleSort}
              onSelectedChange={setWorkSelected}
              onTogglePageSelection={togglePageSelection}
              onEdit={startEditing}
              onEditTagsChange={setEditTags}
              onSave={saveWorkTags}
              onCancel={() => setEditingId(null)}
            />

            <Pagination
              page={page}
              totalPages={totalPages}
              total={total}
              shown={{ start: startItem, end: endItem }}
              onPrev={() => setPage((current) => Math.max(1, current - 1))}
              onNext={() => setPage((current) => Math.min(totalPages, current + 1))}
            />
          </div>
        )}
      </div>

      {selectedOnPage.length > 0 && (
        <BulkTagBar
          selectedCount={selectedOnPage.length}
          batchTags={batchTags}
          saving={saving}
          onBatchTagsChange={setBatchTags}
          onClear={() => setSelectedIds(new Set())}
          onApply={applyBatch}
        />
      )}
    </div>
  );
}
