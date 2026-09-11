import { Fragment, useRef, useState, type FormEvent } from 'react';
import type { GlobalWorkStats, GlobalWorkSummary } from '../../../shared/types';
import { api, ApiError } from '../api/client';
import { Pagination } from '../components/Pagination';
import { SortHeader, type SortDirection } from '../components/SortHeader';
import TagPicker from '../components/TagPicker';
import { getTagLabel, tagsByCategory } from '../../../../lib/tags';
import { useApiResource } from '../lib/apiResource';

type SortKey =
  | 'title'
  | 'originalArtist'
  | 'streamerCount'
  | 'songCount'
  | 'performanceCount'
  | 'updatedAt';

const PAGE_SIZE = 50;
const EMPTY_SELECTION: ReadonlySet<string> = new Set();
const EMPTY_STATS: GlobalWorkStats = {
  totalWorks: 0,
  sharedWorks: 0,
  linkedSongs: 0,
  linkedPerformances: 0,
  unlinkedSongs: 0,
};

interface StatsCardsProps {
  stats: GlobalWorkStats;
}

/** The five summary cards above the filters: totals, sharing, linkage, and the unlinked-songs warning. */
function StatsCards({ stats }: StatsCardsProps) {
  const cards = [
    { label: 'Global works', value: stats.totalWorks },
    { label: 'Shared by VTubers', value: stats.sharedWorks },
    { label: 'Linked local songs', value: stats.linkedSongs },
    { label: 'Linked performances', value: stats.linkedPerformances },
    { label: 'Unlinked songs', value: stats.unlinkedSongs, warning: stats.unlinkedSongs > 0 },
  ];

  return (
    <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {cards.map((card) => (
        <div
          key={card.label}
          className={`rounded-lg border bg-white px-4 py-3 ${
            card.warning ? 'border-amber-300' : 'border-slate-200'
          }`}
        >
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{card.label}</p>
          <p className={`mt-1 text-2xl font-semibold ${card.warning ? 'text-amber-700' : 'text-slate-800'}`}>
            {card.value.toLocaleString()}
          </p>
        </div>
      ))}
    </div>
  );
}

interface FilterBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  onSubmitSearch: (event: FormEvent) => void;
  sharedOnly: boolean;
  onSharedOnlyChange: (value: boolean) => void;
  tagFilter: string;
  onTagFilterChange: (value: string) => void;
  untaggedOnly: boolean;
  onUntaggedOnlyChange: (value: boolean) => void;
}

/** Search box, the two boolean checkboxes, and the tag-dictionary `<select>`. */
function FilterBar({
  search,
  onSearchChange,
  onSubmitSearch,
  sharedOnly,
  onSharedOnlyChange,
  tagFilter,
  onTagFilterChange,
  untaggedOnly,
  onUntaggedOnlyChange,
}: FilterBarProps) {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-3">
      <form onSubmit={onSubmitSearch} className="flex gap-2">
        <input
          type="search"
          aria-label="Search title or original artist"
          placeholder="Search title or original artist..."
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          className="w-72 rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <button
          type="submit"
          className="rounded-md bg-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-300"
        >
          Search
        </button>
      </form>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={sharedOnly}
          onChange={(event) => onSharedOnlyChange(event.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-blue-600"
        />
        Shared by multiple VTubers only
      </label>
      <select
        aria-label="Filter global works by tag"
        value={tagFilter}
        onChange={(event) => onTagFilterChange(event.target.value)}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
      >
        <option value="">All tags</option>
        {tagsByCategory().map(({ category, tags }) => (
          <optgroup key={category.id} label={category.label}>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>{tag.label}</option>
            ))}
          </optgroup>
        ))}
      </select>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={untaggedOnly}
          onChange={(event) => onUntaggedOnlyChange(event.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-blue-600"
        />
        未標語言
      </label>
    </div>
  );
}

interface BulkTagEditorProps {
  selectedCount: number;
  batchTags: string[];
  saving: boolean;
  onBatchTagsChange: (tags: string[]) => void;
  onClear: () => void;
  onApply: (mode: 'add' | 'remove') => void;
}

/** The bar that appears once at least one row on the page is selected: pick tags, add or remove them across the selection. */
function BulkTagEditor({
  selectedCount,
  batchTags,
  saving,
  onBatchTagsChange,
  onClear,
  onApply,
}: BulkTagEditorProps) {
  return (
    <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4" data-testid="bulk-tag-editor">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">批次編輯共用標籤</h3>
          <p className="text-xs text-slate-500">已選擇 {selectedCount} 個作品</p>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="text-xs text-slate-600 hover:underline"
        >
          取消選取
        </button>
      </div>
      <TagPicker value={batchTags} onChange={onBatchTagsChange} disabled={saving} />
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={saving || batchTags.length === 0}
          onClick={() => onApply('add')}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          加入所選標籤
        </button>
        <button
          type="button"
          disabled={saving || batchTags.length === 0}
          onClick={() => onApply('remove')}
          className="rounded border border-red-300 bg-white px-3 py-1.5 text-sm text-red-700 disabled:opacity-50"
        >
          移除所選標籤
        </button>
      </div>
    </div>
  );
}

interface WorkRowProps {
  work: GlobalWorkSummary;
  selected: boolean;
  onToggleSelected: () => void;
  onEdit: () => void;
}

/** One work's row: selection checkbox, title + tag chips, artist, streamer pills, counts, id, and the Edit tags action. */
function WorkRow({ work, selected, onToggleSelected, onEdit }: WorkRowProps) {
  return (
    <tr className="align-top hover:bg-slate-50">
      <td className="px-4 py-3">
        <input
          type="checkbox"
          aria-label={`Select ${work.title}`}
          checked={selected}
          onChange={onToggleSelected}
        />
      </td>
      <td className="px-4 py-3">
        <div className="font-medium text-slate-800">{work.title}</div>
        {work.tags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {work.tags.map((tag) => (
              <span key={tag} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                {getTagLabel(tag)}
              </span>
            ))}
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-slate-600">{work.originalArtist}</td>
      <td className="px-4 py-3">
        <div className="flex max-w-xs flex-wrap gap-1">
          {work.streamerIds.map((streamerId) => (
            <span key={streamerId} className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
              {streamerId}
            </span>
          ))}
        </div>
      </td>
      <td className="px-4 py-3 tabular-nums text-slate-600">{work.songCount}</td>
      <td className="px-4 py-3 tabular-nums text-slate-600">{work.performanceCount}</td>
      <td className="px-4 py-3 font-mono text-xs text-slate-400">{work.id}</td>
      <td className="px-4 py-3">
        <button
          type="button"
          onClick={onEdit}
          className="whitespace-nowrap rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
        >
          Edit tags
        </button>
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

/** The inline editor row a work's "Edit tags" button opens: full-width TagPicker plus Save/Cancel. */
function WorkEditorRow({ work, editTags, saving, onEditTagsChange, onSave, onCancel }: WorkEditorRowProps) {
  return (
    <tr>
      <td colSpan={8} className="bg-slate-50 px-6 py-4">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-slate-800">{work.title} — 共用作品標籤</h3>
          <p className="text-xs text-slate-500">會套用到所有連結此 Work ID 的 VTuber 歌曲。</p>
        </div>
        <TagPicker value={editTags} onChange={onEditTagsChange} disabled={saving} />
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={onSave}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save tags'}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={onCancel}
            className="rounded bg-slate-200 px-3 py-1.5 text-sm text-slate-700"
          >
            Cancel
          </button>
        </div>
      </td>
    </tr>
  );
}

interface WorksTableProps {
  works: GlobalWorkSummary[];
  selectedIds: ReadonlySet<string>;
  editingId: string | null;
  editTags: string[];
  saving: boolean;
  sortKey: SortKey;
  sortDir: SortDirection;
  onSort: (field: SortKey) => void;
  onToggleSelected: (id: string) => void;
  onTogglePageSelection: () => void;
  onEdit: (work: GlobalWorkSummary) => void;
  onEditTagsChange: (tags: string[]) => void;
  onSave: () => void;
  onCancel: () => void;
}

/** The sortable results table: header row, one `WorkRow` (+ `WorkEditorRow` while editing) per work, and the empty state. */
function WorksTable({
  works,
  selectedIds,
  editingId,
  editTags,
  saving,
  sortKey,
  sortDir,
  onSort,
  onToggleSelected,
  onTogglePageSelection,
  onEdit,
  onEditTagsChange,
  onSave,
  onCancel,
}: WorksTableProps) {
  // Selection is per page: IDs that are not on the current page are ignored everywhere.
  const selectedOnPage = works.filter((work) => selectedIds.has(work.id));

  return (
    <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="w-10 px-4 py-3">
              <input
                type="checkbox"
                aria-label="Select all works on this page"
                checked={works.length > 0 && selectedOnPage.length === works.length}
                onChange={onTogglePageSelection}
              />
            </th>
            <SortHeader
              label="Title"
              field="title"
              activeField={sortKey}
              direction={sortDir}
              onSort={onSort}
            />
            <SortHeader
              label="Original artist"
              field="originalArtist"
              activeField={sortKey}
              direction={sortDir}
              onSort={onSort}
            />
            <SortHeader
              label="VTubers"
              field="streamerCount"
              activeField={sortKey}
              direction={sortDir}
              onSort={onSort}
            />
            <SortHeader
              label="Local songs"
              field="songCount"
              activeField={sortKey}
              direction={sortDir}
              onSort={onSort}
            />
            <SortHeader
              label="Performances"
              field="performanceCount"
              activeField={sortKey}
              direction={sortDir}
              onSort={onSort}
            />
            <th className="px-4 py-3">Work ID</th>
            <th className="px-4 py-3">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {works.map((work) => (
            <Fragment key={work.id}>
              <WorkRow
                work={work}
                selected={selectedIds.has(work.id)}
                onToggleSelected={() => onToggleSelected(work.id)}
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
          {works.length === 0 && (
            <tr>
              <td colSpan={8} className="px-4 py-10 text-center text-slate-400">
                No global works found.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function GlobalWorks() {
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
  // already navigated away from — useApiResource keeps the old rows on screen while the
  // replacement load is in flight, and those rows must not stay actionable.
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

  const toggleSelected = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const togglePageSelection = () => {
    setSelectedIds(selectedOnPage.length === works.length ? new Set() : new Set(works.map((work) => work.id)));
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
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Failed to update work tags');
    } finally {
      setSaving(false);
    }
  };

  const startItem = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const endItem = Math.min(page * PAGE_SIZE, total);

  return (
    <div>
      <div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-slate-800">Global Song Library</h2>
            <p className="mt-1 text-sm text-slate-500">
              One composition identity shared by streamer-local songs and their performances.
            </p>
          </div>
          <a
            href="/works/review"
            className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-900"
          >
            Review possible duplicates
          </a>
        </div>
      </div>

      <StatsCards stats={stats} />

      <FilterBar
        search={search}
        onSearchChange={setSearch}
        onSubmitSearch={submitSearch}
        sharedOnly={sharedOnly}
        onSharedOnlyChange={(value) => {
          setPage(1);
          setSharedOnly(value);
        }}
        tagFilter={tagFilter}
        onTagFilterChange={(value) => {
          setPage(1);
          setTagFilter(value);
        }}
        untaggedOnly={untaggedOnly}
        onUntaggedOnlyChange={(value) => {
          setPage(1);
          setUntaggedOnly(value);
        }}
      />

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      {saveError && <p className="mt-4 text-sm text-red-600">{saveError}</p>}

      {selectedOnPage.length > 0 && (
        <BulkTagEditor
          selectedCount={selectedOnPage.length}
          batchTags={batchTags}
          saving={saving}
          onBatchTagsChange={setBatchTags}
          onClear={() => setSelectedIds(new Set())}
          onApply={applyBatch}
        />
      )}

      {loading ? (
        <p className="mt-6 text-slate-500">Loading...</p>
      ) : (
        <>
          <WorksTable
            works={works}
            selectedIds={selectedIds}
            editingId={editingId}
            editTags={editTags}
            saving={saving}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={toggleSort}
            onToggleSelected={toggleSelected}
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
        </>
      )}
    </div>
  );
}
