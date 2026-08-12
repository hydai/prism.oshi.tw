import { Fragment, useEffect, useState, type FormEvent } from 'react';
import type { GlobalWorkStats, GlobalWorkSummary } from '../../../shared/types';
import { api } from '../api/client';
import TagPicker from '../components/TagPicker';
import { TAG_CATEGORIES, TAG_DEFINITIONS, getTagLabel } from '../../../../lib/tags';

type SortKey =
  | 'title'
  | 'originalArtist'
  | 'streamerCount'
  | 'songCount'
  | 'performanceCount'
  | 'updatedAt';
type SortDir = 'asc' | 'desc';

const PAGE_SIZE = 50;
const EMPTY_STATS: GlobalWorkStats = {
  totalWorks: 0,
  sharedWorks: 0,
  linkedSongs: 0,
  linkedPerformances: 0,
  unlinkedSongs: 0,
};

export function SortHeader({
  label,
  field,
  activeField,
  sortDir,
  onSort,
}: {
  label: string;
  field: SortKey;
  activeField: SortKey;
  sortDir: SortDir;
  onSort: (field: SortKey) => void;
}) {
  const isActive = activeField === field;
  return (
    <th
      className="px-4 py-3"
      aria-sort={isActive ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
    >
      <button
        type="button"
        className="flex w-full cursor-pointer select-none items-center gap-1 text-left hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        onClick={() => onSort(field)}
      >
        <span>{label}</span>
        {isActive && <span aria-hidden="true">{sortDir === 'asc' ? '↑' : '↓'}</span>}
      </button>
    </th>
  );
}

export function pageAfterReload(currentPage: number, totalPages: number): number {
  return Math.min(currentPage, Math.max(1, totalPages));
}

export default function GlobalWorks() {
  const [works, setWorks] = useState<GlobalWorkSummary[]>([]);
  const [stats, setStats] = useState<GlobalWorkStats>(EMPTY_STATS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [sharedOnly, setSharedOnly] = useState(false);
  const [tagFilter, setTagFilter] = useState('');
  const [untaggedOnly, setUntaggedOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('performanceCount');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [selectedWorkIds, setSelectedWorkIds] = useState<Set<string>>(new Set());
  const [editingWorkId, setEditingWorkId] = useState<string | null>(null);
  const [editTags, setEditTags] = useState<string[]>([]);
  const [batchTags, setBatchTags] = useState<string[]>([]);
  const [savingTags, setSavingTags] = useState(false);
  const [reloadRevision, setReloadRevision] = useState(0);

  const refetchWorks = () => {
    setLoading(true);
    setReloadRevision((current) => current + 1);
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    api.listGlobalWorks({
      search: submittedSearch || undefined,
      sharedOnly,
      tag: tagFilter || undefined,
      untaggedOnly,
      page,
      pageSize: PAGE_SIZE,
      sortBy: sortKey,
      sortDir,
    })
      .then((response) => {
        if (!active) return;
        setWorks(response.data);
        setStats(response.stats);
        setTotal(response.total);
        setTotalPages(response.totalPages);
        setSelectedWorkIds(new Set());
        setEditingWorkId(null);
        const nextPage = pageAfterReload(page, response.totalPages);
        if (nextPage !== page) setPage(nextPage);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load global library');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [submittedSearch, sharedOnly, tagFilter, untaggedOnly, page, sortKey, sortDir, reloadRevision]);

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

  const toggleWorkSelection = (id: string) => {
    setSelectedWorkIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const togglePageSelection = () => {
    setSelectedWorkIds((current) =>
      current.size === works.length
        ? new Set()
        : new Set(works.map((work) => work.id)),
    );
  };

  const saveWorkTags = async () => {
    if (!editingWorkId) return;
    setSavingTags(true);
    setError(null);
    try {
      await api.updateWorkTags(editingWorkId, { tags: editTags });
      setEditingWorkId(null);
      refetchWorks();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update work tags');
    } finally {
      setSavingTags(false);
    }
  };

  const applyBulkTags = async (mode: 'add' | 'remove') => {
    if (selectedWorkIds.size === 0 || batchTags.length === 0) return;
    setSavingTags(true);
    setError(null);
    try {
      await api.bulkUpdateWorkTags({
        workIds: [...selectedWorkIds],
        addTags: mode === 'add' ? batchTags : [],
        removeTags: mode === 'remove' ? batchTags : [],
      });
      setBatchTags([]);
      setSelectedWorkIds(new Set());
      refetchWorks();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update work tags');
    } finally {
      setSavingTags(false);
    }
  };

  const startItem = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const endItem = Math.min(page * PAGE_SIZE, total);
  const cards = [
    { label: 'Global works', value: stats.totalWorks },
    { label: 'Shared by VTubers', value: stats.sharedWorks },
    { label: 'Linked local songs', value: stats.linkedSongs },
    { label: 'Linked performances', value: stats.linkedPerformances },
    { label: 'Unlinked songs', value: stats.unlinkedSongs, warning: stats.unlinkedSongs > 0 },
  ];

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

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <form onSubmit={submitSearch} className="flex gap-2">
          <input
            type="search"
            placeholder="Search title or original artist..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
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
            onChange={(event) => {
              setPage(1);
              setSharedOnly(event.target.checked);
            }}
            className="h-4 w-4 rounded border-slate-300 text-blue-600"
          />
          Shared by multiple VTubers only
        </label>
        <select
          value={tagFilter}
          onChange={(event) => {
            setPage(1);
            setTagFilter(event.target.value);
            if (event.target.value) setUntaggedOnly(false);
          }}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          aria-label="Filter global works by tag"
        >
          <option value="">All tags</option>
          {TAG_CATEGORIES.filter((category) => TAG_DEFINITIONS.some((tag) => (
            tag.active && tag.scope === 'work' && tag.category === category.id
          ))).map((category) => (
            <optgroup key={category.id} label={category.label}>
              {TAG_DEFINITIONS.filter((tag) => (
                tag.active && tag.scope === 'work' && tag.category === category.id
              )).map((tag) => (
                <option key={tag.id} value={tag.id}>{tag.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={untaggedOnly}
            onChange={(event) => {
              setPage(1);
              setUntaggedOnly(event.target.checked);
              if (event.target.checked) setTagFilter('');
            }}
            className="h-4 w-4 rounded border-slate-300 text-blue-600"
          />
          Untagged only
        </label>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {selectedWorkIds.size > 0 && (
        <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4" data-testid="bulk-tag-editor">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">批次編輯共用標籤</h3>
              <p className="text-xs text-slate-500">已選擇 {selectedWorkIds.size} 個作品</p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedWorkIds(new Set())}
              className="text-xs text-slate-600 hover:underline"
            >
              取消選取
            </button>
          </div>
          <TagPicker value={batchTags} onChange={setBatchTags} scope="work" compact />
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={savingTags || batchTags.length === 0}
              onClick={() => applyBulkTags('add')}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              加入所選標籤
            </button>
            <button
              type="button"
              disabled={savingTags || batchTags.length === 0}
              onClick={() => applyBulkTags('remove')}
              className="rounded border border-red-300 bg-white px-3 py-1.5 text-sm text-red-700 disabled:opacity-50"
            >
              移除所選標籤
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="mt-6 text-slate-500">Loading...</p>
      ) : (
        <>
          <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label="Select all works on this page"
                      checked={works.length > 0 && selectedWorkIds.size === works.length}
                      onChange={togglePageSelection}
                    />
                  </th>
                  <SortHeader
                    label="Title"
                    field="title"
                    activeField={sortKey}
                    sortDir={sortDir}
                    onSort={toggleSort}
                  />
                  <SortHeader
                    label="Original artist"
                    field="originalArtist"
                    activeField={sortKey}
                    sortDir={sortDir}
                    onSort={toggleSort}
                  />
                  <SortHeader
                    label="VTubers"
                    field="streamerCount"
                    activeField={sortKey}
                    sortDir={sortDir}
                    onSort={toggleSort}
                  />
                  <SortHeader
                    label="Local songs"
                    field="songCount"
                    activeField={sortKey}
                    sortDir={sortDir}
                    onSort={toggleSort}
                  />
                  <SortHeader
                    label="Performances"
                    field="performanceCount"
                    activeField={sortKey}
                    sortDir={sortDir}
                    onSort={toggleSort}
                  />
                  <th className="px-4 py-3">Work ID</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {works.map((work) => (
                  <Fragment key={work.id}>
                  <tr className="align-top hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        aria-label={`Select ${work.title}`}
                        checked={selectedWorkIds.has(work.id)}
                        onChange={() => toggleWorkSelection(work.id)}
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
                        onClick={() => {
                          setEditingWorkId(work.id);
                          setEditTags(work.tags);
                        }}
                        className="whitespace-nowrap rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                      >
                        Edit tags
                      </button>
                    </td>
                  </tr>
                  {editingWorkId === work.id && (
                    <tr>
                      <td colSpan={8} className="bg-slate-50 px-6 py-4">
                        <div className="mb-3">
                          <h3 className="text-sm font-semibold text-slate-800">{work.title} — 共用作品標籤</h3>
                          <p className="text-xs text-slate-500">會套用到所有連結此 Work ID 的 VTuber 歌曲。</p>
                        </div>
                        <TagPicker value={editTags} onChange={setEditTags} scope="work" compact />
                        <div className="mt-3 flex gap-2">
                          <button
                            type="button"
                            disabled={savingTags}
                            onClick={saveWorkTags}
                            className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                          >
                            {savingTags ? 'Saving...' : 'Save tags'}
                          </button>
                          <button
                            type="button"
                            disabled={savingTags}
                            onClick={() => setEditingWorkId(null)}
                            className="rounded bg-slate-200 px-3 py-1.5 text-sm text-slate-700"
                          >
                            Cancel
                          </button>
                        </div>
                      </td>
                    </tr>
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

          {totalPages > 0 && (
            <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
              <span>Showing {startItem}–{endItem} of {total}</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={page <= 1}
                  className="rounded-md border border-slate-300 px-3 py-1.5 font-medium hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Previous
                </button>
                <span>Page {page} of {totalPages}</span>
                <button
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                  disabled={page >= totalPages}
                  className="rounded-md border border-slate-300 px-3 py-1.5 font-medium hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
