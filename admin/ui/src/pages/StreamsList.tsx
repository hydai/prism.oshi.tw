import { useEffect, useState, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Stream, AuthUser, Status } from '../../../shared/types';
import { api, getCurrentStreamer, setCurrentStreamer } from '../api/client';
import StatusBadge from '../components/StatusBadge';
import { loadStreamsFilter, saveStreamsFilter, resolveYear } from '../lib/streamsFilter';

type SortKey = 'title' | 'date' | 'status' | 'createdAt';
type SortDir = 'asc' | 'desc';

/** Status filter pills — the active pill is filled in that status's own color. */
const STATUS_FILTERS: { value: '' | Status; label: string; activeClass: string }[] = [
  { value: '', label: 'All', activeClass: 'border-blue-600 bg-blue-600 text-white' },
  { value: 'pending', label: 'Pending', activeClass: 'border-yellow-500 bg-yellow-500 text-white' },
  { value: 'approved', label: 'Approved', activeClass: 'border-green-600 bg-green-600 text-white' },
  { value: 'rejected', label: 'Rejected', activeClass: 'border-red-600 bg-red-600 text-white' },
  { value: 'excluded', label: 'Excluded', activeClass: 'border-slate-500 bg-slate-500 text-white' },
  { value: 'extracted', label: 'Extracted', activeClass: 'border-teal-600 bg-teal-600 text-white' },
];

const YEAR_ACTIVE_CLASS = 'border-blue-600 bg-blue-600 text-white';

function FilterPill({
  active,
  activeClass,
  onClick,
  children,
}: {
  active: boolean;
  activeClass: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        active ? activeClass : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
      }`}
    >
      {children}
    </button>
  );
}

export default function StreamsList({ user }: { user: AuthUser }) {
  const [initialParams] = useSearchParams();
  const requestedStreamer = initialParams.get('streamer');
  const [streams, setStreams] = useState<Stream[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(() => initialParams.get('search') ?? '');
  const [statusFilter, setStatusFilter] = useState<'' | Status>(() => {
    const requested = initialParams.get('status');
    return STATUS_FILTERS.some((item) => item.value === requested)
      ? requested as '' | Status
      : loadStreamsFilter().status;
  });
  const [yearFilter, setYearFilter] = useState<string>(() => loadStreamsFilter().year);
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const fetchStreams = () => {
    setLoading(true);
    api
      .listStreams({
        status: statusFilter || undefined,
        search: search || undefined,
      })
      .then((res) => setStreams(res.data))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (requestedStreamer && requestedStreamer !== getCurrentStreamer()) {
      setCurrentStreamer(requestedStreamer);
    }
  }, [requestedStreamer]);

  useEffect(() => {
    fetchStreams();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  // Remember the filter choice across visits (single global key).
  useEffect(() => {
    saveStreamsFilter({ status: statusFilter, year: yearFilter });
  }, [statusFilter, yearFilter]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchStreams();
  };

  // Extract unique years from stream dates for filter
  const years = useMemo(() => {
    const ySet = new Set<string>();
    for (const s of streams) {
      const y = s.date?.slice(0, 4);
      if (y) ySet.add(y);
    }
    return [...ySet].sort().reverse();
  }, [streams]);

  // The saved year may not exist in the current data (e.g. after switching
  // streamer); fall back to "All" for display/filtering while keeping the saved value.
  const effectiveYear = resolveYear(yearFilter, years);

  const sorted = useMemo(() => {
    let filtered = streams;
    if (effectiveYear) {
      filtered = filtered.filter((s) => s.date?.startsWith(effectiveYear));
    }
    const copy = [...filtered];
    copy.sort((a, b) => {
      const av = a[sortKey] ?? '';
      const bv = b[sortKey] ?? '';
      const cmp = String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [streams, effectiveYear, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const handleStatus = async (id: string, status: Status) => {
    try {
      const updated = await api.updateStreamStatus(id, { status });
      setStreams((prev) => prev.map((s) => (s.id === id ? updated : s)));
    } catch {
      // unchanged state is visible
    }
  };

  const handleApprove = async (id: string) => {
    try {
      const updated = await api.updateStreamStatus(id, { status: 'approved' });
      setStreams((prev) => prev.map((s) => (s.id === id ? updated : s)));
      const { songs, performances } = await api.approveAllForStream(id);
      if (songs > 0 || performances > 0) {
        window.alert(`Approved stream + ${songs} song(s) and ${performances} performance(s)`);
      }
    } catch {
      // unchanged state is visible
    }
  };

  const isCurator = user.role === 'curator';

  const SortHeader = ({ label, field }: { label: string; field: SortKey }) => (
    <th
      className="cursor-pointer select-none px-4 py-3 hover:text-slate-700"
      onClick={() => toggleSort(field)}
    >
      {label} {sortKey === field ? (sortDir === 'asc' ? '↑' : '↓') : ''}
    </th>
  );

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-slate-800">
          Streams
          <span className="ml-2 text-base font-normal text-slate-500">
            ({sorted.length === streams.length ? sorted.length : `${sorted.length} / ${streams.length}`})
          </span>
        </h2>
        <Link
          to="/submit/stream"
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          + Submit Stream
        </Link>
      </div>

      {/* Filters */}
      <div className="mt-4 space-y-3">
        <form onSubmit={handleSearch} className="flex gap-2">
          <input
            type="text"
            placeholder="Search by title..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            type="submit"
            className="rounded-md bg-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-300"
          >
            Search
          </button>
        </form>

        {/* Status filter pills */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-12 shrink-0 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Status
          </span>
          {STATUS_FILTERS.map((f) => (
            <FilterPill
              key={f.value || 'all'}
              active={statusFilter === f.value}
              activeClass={f.activeClass}
              onClick={() => setStatusFilter(f.value)}
            >
              {f.label}
            </FilterPill>
          ))}
        </div>

        {/* Year filter pills */}
        {years.length > 1 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-12 shrink-0 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Year
            </span>
            <FilterPill
              active={effectiveYear === ''}
              activeClass={YEAR_ACTIVE_CLASS}
              onClick={() => setYearFilter('')}
            >
              All
            </FilterPill>
            {years.map((y) => (
              <FilterPill
                key={y}
                active={effectiveYear === y}
                activeClass={YEAR_ACTIVE_CLASS}
                onClick={() => setYearFilter(y)}
              >
                {y}
              </FilterPill>
            ))}
          </div>
        )}
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="mt-6 text-slate-500">Loading...</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <SortHeader label="Title" field="title" />
                <SortHeader label="Date" field="date" />
                <th className="px-4 py-3">Video ID</th>
                <SortHeader label="Status" field="status" />
                <th className="px-4 py-3">Submitted By</th>
                <SortHeader label="Created" field="createdAt" />
                {isCurator && <th className="px-4 py-3">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.map((stream) => (
                <tr key={stream.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">
                    <Link to={`/streams/${stream.id}`} className="text-blue-600 hover:underline">
                      {stream.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{stream.date}</td>
                  <td className="px-4 py-3">
                    <a
                      href={stream.youtubeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline"
                    >
                      {stream.videoId}
                    </a>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={stream.status} />
                  </td>
                  <td className="px-4 py-3 text-slate-500">{stream.submittedBy ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-500">{stream.createdAt}</td>
                  {isCurator && (
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(stream.status === 'pending' || stream.status === 'extracted') && (
                          <>
                            <button
                              onClick={() => handleApprove(stream.id)}
                              className="rounded bg-green-600 px-2 py-1 text-xs text-white hover:bg-green-700"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => handleStatus(stream.id, 'rejected')}
                              className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700"
                            >
                              Reject
                            </button>
                          </>
                        )}
                        {stream.status === 'approved' && (
                          <button
                            onClick={() => handleStatus(stream.id, 'pending')}
                            className="rounded bg-yellow-500 px-2 py-1 text-xs text-white hover:bg-yellow-600"
                          >
                            Unapprove
                          </button>
                        )}
                        {stream.status !== 'excluded' && (
                          <button
                            onClick={() => handleStatus(stream.id, 'excluded')}
                            className="rounded bg-slate-500 px-2 py-1 text-xs text-white hover:bg-slate-600"
                          >
                            Exclude
                          </button>
                        )}
                        {stream.status === 'excluded' && (
                          <button
                            onClick={() => handleStatus(stream.id, 'pending')}
                            className="rounded bg-blue-500 px-2 py-1 text-xs text-white hover:bg-blue-600"
                          >
                            Restore
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={isCurator ? 7 : 6} className="px-4 py-8 text-center text-slate-400">
                    No streams found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
