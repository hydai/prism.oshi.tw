import { useEffect, useState, type FormEvent } from 'react';
import type { GlobalWorkStats, GlobalWorkSummary } from '../../../shared/types';
import { api } from '../api/client';

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

export default function GlobalWorks() {
  const [works, setWorks] = useState<GlobalWorkSummary[]>([]);
  const [stats, setStats] = useState<GlobalWorkStats>(EMPTY_STATS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [sharedOnly, setSharedOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('performanceCount');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    api.listGlobalWorks({
      search: submittedSearch || undefined,
      sharedOnly,
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
  }, [submittedSearch, sharedOnly, page, sortKey, sortDir]);

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
        <h2 className="text-xl font-semibold text-slate-800">Global Song Library</h2>
        <p className="mt-1 text-sm text-slate-500">
          One composition identity shared by streamer-local songs and their performances.
        </p>
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
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="mt-6 text-slate-500">Loading...</p>
      ) : (
        <>
          <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
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
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {works.map((work) => (
                  <tr key={work.id} className="align-top hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">{work.title}</div>
                      {work.tags.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {work.tags.map((tag) => (
                            <span key={tag} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                              {tag}
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
                  </tr>
                ))}
                {works.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
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
