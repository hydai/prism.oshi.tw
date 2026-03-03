import { useEffect, useState } from 'react';
import type { DashboardStats } from '../../../shared/types';
import { api } from '../api/client';
import StatusBadge from '../components/StatusBadge';

function StatCard({ label, pending, approved, rejected, excluded, extracted }: {
  label: string;
  pending: number;
  approved: number;
  rejected: number;
  excluded: number;
  extracted: number;
}) {
  const total = pending + approved + rejected + excluded + extracted;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-sm font-medium text-slate-500">{label}</h3>
      <div className="mt-3 flex items-end gap-4">
        <div>
          <span className="text-2xl font-bold text-slate-900">{total}</span>
          <span className="ml-1 text-sm text-slate-400">total</span>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-yellow-800">{pending} pending</span>
          <span className="rounded bg-green-100 px-1.5 py-0.5 text-green-800">{approved} approved</span>
          <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-800">{rejected} rejected</span>
          {extracted > 0 && (
            <span className="rounded bg-teal-100 px-1.5 py-0.5 text-teal-800">{extracted} extracted</span>
          )}
          {excluded > 0 && (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">{excluded} excluded</span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .stats()
      .then(setStats)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load stats'));
  }, []);

  if (error) {
    return <div className="text-red-600">{error}</div>;
  }

  if (!stats) {
    return <div className="text-slate-500">Loading dashboard...</div>;
  }

  return (
    <div>
      <h2 className="text-xl font-semibold text-slate-800">Dashboard</h2>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <StatCard label="Songs" {...stats.songs} />
        <StatCard label="Streams" {...stats.streams} />
        <StatCard label="Performances" {...stats.performances} />
      </div>

      <div className="mt-8">
        <h3 className="text-lg font-semibold text-slate-800">Recent Submissions</h3>
        {stats.recentSubmissions.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No recent submissions.</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Title</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Submitted By</th>
                  <th className="px-4 py-3">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {stats.recentSubmissions.map((item) => {
                  const isSong = 'originalArtist' in item;
                  return (
                    <tr key={item.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-800">{item.title}</td>
                      <td className="px-4 py-3 text-slate-500">{isSong ? 'Song' : 'Stream'}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={item.status} />
                      </td>
                      <td className="px-4 py-3 text-slate-500">{item.submittedBy ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-500">{item.createdAt}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
