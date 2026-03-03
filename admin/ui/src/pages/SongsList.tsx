import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { Song, AuthUser, Status } from '../../../shared/types';
import { api } from '../api/client';
import StatusBadge from '../components/StatusBadge';

type SortKey = 'title' | 'originalArtist' | 'status' | 'createdAt';
type SortDir = 'asc' | 'desc';

export default function SongsList({ user }: { user: AuthUser }) {
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | Status>('');
  const [sortKey, setSortKey] = useState<SortKey>('createdAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const fetchSongs = () => {
    setLoading(true);
    api
      .listSongs({
        status: statusFilter || undefined,
        search: search || undefined,
      })
      .then((res) => setSongs(res.data))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchSongs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchSongs();
  };

  const sorted = useMemo(() => {
    const copy = [...songs];
    copy.sort((a, b) => {
      const av = a[sortKey] ?? '';
      const bv = b[sortKey] ?? '';
      const cmp = String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [songs, sortKey, sortDir]);

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
      const updated = await api.updateSongStatus(id, { status });
      setSongs((prev) => prev.map((s) => (s.id === id ? updated : s)));
    } catch {
      // Silently fail — user will see the unchanged state
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
        <h2 className="text-xl font-semibold text-slate-800">Songs</h2>
        <Link
          to="/submit/song"
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          + Submit Song
        </Link>
      </div>

      {/* Filters */}
      <div className="mt-4 flex flex-wrap gap-3">
        <form onSubmit={handleSearch} className="flex gap-2">
          <input
            type="text"
            placeholder="Search by title or artist..."
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
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as '' | Status)}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="excluded">Excluded</option>
          <option value="extracted">Extracted</option>
        </select>
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
                <SortHeader label="Artist" field="originalArtist" />
                <SortHeader label="Status" field="status" />
                <th className="px-4 py-3">Tags</th>
                <SortHeader label="Created" field="createdAt" />
                {isCurator && <th className="px-4 py-3">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.map((song) => (
                <tr key={song.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link to={`/songs/${song.id}`} className="font-medium text-blue-600 hover:underline">
                      {song.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{song.originalArtist}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={song.status} />
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {song.tags.length > 0
                      ? song.tags.map((t) => (
                          <span key={t} className="mr-1 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-xs">
                            {t}
                          </span>
                        ))
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{song.createdAt}</td>
                  {isCurator && (
                    <td className="px-4 py-3">
                      {song.status === 'pending' && (
                        <div className="flex gap-1">
                          <button
                            onClick={() => handleStatus(song.id, 'approved')}
                            className="rounded bg-green-600 px-2 py-1 text-xs text-white hover:bg-green-700"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => handleStatus(song.id, 'rejected')}
                            className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700"
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={isCurator ? 6 : 5} className="px-4 py-8 text-center text-slate-400">
                    No songs found.
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
