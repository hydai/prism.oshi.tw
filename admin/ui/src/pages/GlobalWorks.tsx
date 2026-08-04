import { Fragment, useEffect, useReducer, useState, type FormEvent } from 'react';
import type { GlobalWorkStats, GlobalWorkSummary } from '../../../shared/types';
import { api } from '../api/client';
import TagPicker from '../components/TagPicker';
import { activeTagsByCategory, getTagLabel } from '../../../../lib/tags';
import {
  globalWorksReducer,
  initialGlobalWorksState,
  type GlobalWorksSortDir,
  type GlobalWorksSortKey,
} from './global-works-state';

const PAGE_SIZE = 50;

export function SortHeader({
  label,
  field,
  activeField,
  sortDir,
  onSort,
}: {
  label: string;
  field: GlobalWorksSortKey;
  activeField: GlobalWorksSortKey;
  sortDir: GlobalWorksSortDir;
  onSort: (field: GlobalWorksSortKey) => void;
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

function useGlobalWorksController() {
  const [state, dispatch] = useReducer(globalWorksReducer, initialGlobalWorksState);
  const [search, setSearch] = useState('');
  const {
    submittedSearch,
    sharedOnly,
    tagFilter,
    untaggedOnly,
    page,
    sortKey,
    sortDir,
    editingWorkId,
    editTags,
    selectedWorkIds,
    batchTags,
  } = state;

  useEffect(() => {
    let active = true;
    dispatch({ type: 'loadStarted' });
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
        if (active) dispatch({ type: 'loadSucceeded', response });
      })
      .catch((err: unknown) => {
        if (active) {
          dispatch({
            type: 'loadFailed',
            error: err instanceof Error ? err.message : 'Failed to load global library',
          });
        }
      })
      .finally(() => {
        if (active) dispatch({ type: 'loadFinished' });
      });

    return () => {
      active = false;
    };
  }, [submittedSearch, sharedOnly, tagFilter, untaggedOnly, page, sortKey, sortDir]);

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    dispatch({ type: 'searchSubmitted', search: search.trim() });
  };

  const saveWorkTags = async () => {
    if (!editingWorkId) return;
    dispatch({ type: 'saveStarted' });
    try {
      const updated = await api.updateWorkTags(editingWorkId, { tags: editTags });
      dispatch({ type: 'workTagsSaved', work: updated });
    } catch (err: unknown) {
      dispatch({
        type: 'saveFailed',
        error: err instanceof Error ? err.message : 'Failed to update work tags',
      });
    } finally {
      dispatch({ type: 'saveFinished' });
    }
  };

  const applyBulkTags = async (mode: 'add' | 'remove') => {
    if (selectedWorkIds.size === 0 || batchTags.length === 0) return;
    dispatch({ type: 'saveStarted' });
    try {
      const response = await api.bulkUpdateWorkTags({
        workIds: [...selectedWorkIds],
        addTags: mode === 'add' ? batchTags : [],
        removeTags: mode === 'remove' ? batchTags : [],
      });
      dispatch({ type: 'bulkTagsApplied', updated: response.updated });
    } catch (err: unknown) {
      dispatch({
        type: 'saveFailed',
        error: err instanceof Error ? err.message : 'Failed to update work tags',
      });
    } finally {
      dispatch({ type: 'saveFinished' });
    }
  };

  return {
    ...state,
    search,
    setSearch,
    dispatch,
    submitSearch,
    saveWorkTags,
    applyBulkTags,
  };
}

export type GlobalWorksController = ReturnType<typeof useGlobalWorksController>;

function StatsCards({ stats }: { stats: GlobalWorkStats }) {
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

function FilterBar({ controller }: { controller: GlobalWorksController }) {
  const { search, setSearch, submitSearch, sharedOnly, tagFilter, untaggedOnly, dispatch } = controller;

  return (
    <div className="mt-5 flex flex-wrap items-center gap-3">
      <form onSubmit={submitSearch} className="flex gap-2">
        <input
          type="search"
          aria-label="Search title or original artist"
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
          onChange={(event) => dispatch({ type: 'sharedOnlyChanged', sharedOnly: event.target.checked })}
          className="h-4 w-4 rounded border-slate-300 text-blue-600"
        />
        Shared by multiple VTubers only
      </label>
      <select
        value={tagFilter}
        onChange={(event) => dispatch({ type: 'tagFilterChanged', tagFilter: event.target.value })}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        aria-label="Filter global works by tag"
      >
        <option value="">All tags</option>
        {activeTagsByCategory('work').map(({ category, tags }) => (
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
          onChange={(event) => dispatch({ type: 'untaggedOnlyChanged', untaggedOnly: event.target.checked })}
          className="h-4 w-4 rounded border-slate-300 text-blue-600"
        />
        Untagged only
      </label>
    </div>
  );
}

function BulkTagEditor({ controller }: { controller: GlobalWorksController }) {
  const { selectedWorkIds, batchTags, savingTags, dispatch, applyBulkTags } = controller;
  if (selectedWorkIds.size === 0) return null;

  return (
    <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4" data-testid="bulk-tag-editor">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">批次編輯共用標籤</h3>
          <p className="text-xs text-slate-500">已選擇 {selectedWorkIds.size} 個作品</p>
        </div>
        <button
          type="button"
          onClick={() => dispatch({ type: 'selectionCleared' })}
          className="text-xs text-slate-600 hover:underline"
        >
          取消選取
        </button>
      </div>
      <TagPicker
        value={batchTags}
        onChange={(tags) => dispatch({ type: 'batchTagsChanged', tags })}
        scope="work"
        compact
      />
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
  );
}

function WorkTagEditorRow({ work, controller }: { work: GlobalWorkSummary; controller: GlobalWorksController }) {
  const { editTags, savingTags, dispatch, saveWorkTags } = controller;

  return (
    <tr>
      <td colSpan={8} className="bg-slate-50 px-6 py-4">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-slate-800">{work.title} — 共用作品標籤</h3>
          <p className="text-xs text-slate-500">會套用到所有連結此 Work ID 的 VTuber 歌曲。</p>
        </div>
        <TagPicker
          value={editTags}
          onChange={(tags) => dispatch({ type: 'editTagsChanged', tags })}
          scope="work"
          compact
        />
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
            onClick={() => dispatch({ type: 'tagEditCancelled' })}
            className="rounded bg-slate-200 px-3 py-1.5 text-sm text-slate-700"
          >
            Cancel
          </button>
        </div>
      </td>
    </tr>
  );
}

function WorkRow({ work, controller }: { work: GlobalWorkSummary; controller: GlobalWorksController }) {
  const { selectedWorkIds, dispatch } = controller;

  return (
    <tr className="align-top hover:bg-slate-50">
      <td className="px-4 py-3">
        <input
          type="checkbox"
          aria-label={`Select ${work.title}`}
          checked={selectedWorkIds.has(work.id)}
          onChange={() => dispatch({ type: 'workSelectionToggled', workId: work.id })}
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
          onClick={() => dispatch({ type: 'tagEditStarted', work })}
          className="whitespace-nowrap rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
        >
          Edit tags
        </button>
      </td>
    </tr>
  );
}

function WorksTable({ controller }: { controller: GlobalWorksController }) {
  const { works, selectedWorkIds, editingWorkId, sortKey, sortDir, dispatch } = controller;
  const toggleSort = (key: GlobalWorksSortKey) => dispatch({ type: 'sortToggled', sortKey: key });

  return (
    <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="w-10 px-4 py-3">
              <input
                type="checkbox"
                aria-label="Select all works on this page"
                checked={works.length > 0 && selectedWorkIds.size === works.length}
                onChange={() => dispatch({ type: 'pageSelectionToggled' })}
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
              <WorkRow work={work} controller={controller} />
              {editingWorkId === work.id && <WorkTagEditorRow work={work} controller={controller} />}
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

function Pagination({ controller }: { controller: GlobalWorksController }) {
  const { page, total, totalPages, dispatch } = controller;
  if (totalPages <= 0) return null;
  const startItem = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const endItem = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
      <span>Showing {startItem}–{endItem} of {total}</span>
      <div className="flex items-center gap-2">
        <button
          onClick={() => dispatch({ type: 'previousPageRequested' })}
          disabled={page <= 1}
          className="rounded-md border border-slate-300 px-3 py-1.5 font-medium hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Previous
        </button>
        <span>Page {page} of {totalPages}</span>
        <button
          onClick={() => dispatch({ type: 'nextPageRequested' })}
          disabled={page >= totalPages}
          className="rounded-md border border-slate-300 px-3 py-1.5 font-medium hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}

export function GlobalWorksView({ controller }: { controller: GlobalWorksController }) {
  const { stats, error, loading } = controller;

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
      <FilterBar controller={controller} />

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <BulkTagEditor controller={controller} />

      {loading ? (
        <p className="mt-6 text-slate-500">Loading...</p>
      ) : (
        <>
          <WorksTable controller={controller} />
          <Pagination controller={controller} />
        </>
      )}
    </div>
  );
}

export default function GlobalWorks() {
  const controller = useGlobalWorksController();
  return <GlobalWorksView controller={controller} />;
}
