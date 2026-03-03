import { useEffect, useState } from 'react';
import type { AuthUser, NovaSubmission, NovaStatus } from '../../../shared/types';
import { api } from '../api/client';
import StatusBadge from '../components/StatusBadge';

export default function NovaSubmissions({ user }: { user: AuthUser }) {
  const [submissions, setSubmissions] = useState<NovaSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'' | NovaStatus>('pending');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState<Record<string, string>>({});
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchSubmissions = () => {
    setLoading(true);
    api
      .listNovaSubmissions({ status: statusFilter || undefined })
      .then((res) => setSubmissions(res.data))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchSubmissions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const handleAction = async (id: string, status: NovaStatus) => {
    setActionLoading(id);
    try {
      const updated = await api.updateNovaStatus(id, {
        status,
        reviewer_note: status === 'rejected' ? rejectNote[id] : undefined,
      });
      setSubmissions((prev) => prev.map((s) => (s.id === id ? updated : s)));
      setRejectNote((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActionLoading(null);
    }
  };

  const isCurator = user.role === 'curator';

  return (
    <div>
      <h2 className="text-xl font-semibold text-slate-800">Nova Submissions</h2>
      <p className="mt-1 text-sm text-slate-500">Review VTuber submissions from the public Nova form.</p>

      {/* Status filter */}
      <div className="mt-4">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as '' | NovaStatus)}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
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
                <th className="px-4 py-3">Display Name</th>
                <th className="px-4 py-3">Slug</th>
                <th className="px-4 py-3">YouTube Channel</th>
                <th className="px-4 py-3">Subscribers</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Submitted</th>
                {isCurator && <th className="px-4 py-3">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {submissions.map((sub) => (
                <SubmissionRow
                  key={sub.id}
                  sub={sub}
                  isCurator={isCurator}
                  expanded={expandedId === sub.id}
                  onToggle={() => setExpandedId(expandedId === sub.id ? null : sub.id)}
                  rejectNote={rejectNote[sub.id] ?? ''}
                  onRejectNoteChange={(val) => setRejectNote((prev) => ({ ...prev, [sub.id]: val }))}
                  onAction={handleAction}
                  actionLoading={actionLoading === sub.id}
                />
              ))}
              {submissions.length === 0 && (
                <tr>
                  <td colSpan={isCurator ? 7 : 6} className="px-4 py-8 text-center text-slate-400">
                    No submissions found.
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

function SubmissionRow({
  sub,
  isCurator,
  expanded,
  onToggle,
  rejectNote,
  onRejectNoteChange,
  onAction,
  actionLoading,
}: {
  sub: NovaSubmission;
  isCurator: boolean;
  expanded: boolean;
  onToggle: () => void;
  rejectNote: string;
  onRejectNoteChange: (val: string) => void;
  onAction: (id: string, status: NovaStatus) => void;
  actionLoading: boolean;
}) {
  const socialLinks = [
    { label: 'YouTube', url: sub.link_youtube },
    { label: 'Twitter', url: sub.link_twitter },
    { label: 'Facebook', url: sub.link_facebook },
    { label: 'Instagram', url: sub.link_instagram },
    { label: 'Twitch', url: sub.link_twitch },
  ].filter((l) => l.url);

  return (
    <>
      <tr className="cursor-pointer hover:bg-slate-50" onClick={onToggle}>
        <td className="px-4 py-3 font-medium text-slate-800">
          <span className="mr-1 text-xs text-slate-400">{expanded ? '▼' : '▶'}</span>
          {sub.display_name}
        </td>
        <td className="px-4 py-3 font-mono text-xs text-slate-600">{sub.slug}</td>
        <td className="px-4 py-3">
          <a
            href={sub.youtube_channel_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {sub.brand_name}
          </a>
        </td>
        <td className="px-4 py-3 text-slate-600">{sub.subscriber_count}</td>
        <td className="px-4 py-3">
          <StatusBadge status={sub.status} />
        </td>
        <td className="px-4 py-3 text-slate-500">{sub.submitted_at}</td>
        {isCurator && (
          <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
            {sub.status === 'pending' && (
              <div className="flex gap-1">
                <button
                  disabled={actionLoading}
                  onClick={() => onAction(sub.id, 'approved')}
                  className="rounded bg-green-600 px-2 py-1 text-xs text-white hover:bg-green-700 disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  disabled={actionLoading}
                  onClick={() => onAction(sub.id, 'rejected')}
                  className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700 disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            )}
          </td>
        )}
      </tr>
      {expanded && (
        <tr className="bg-slate-50">
          <td colSpan={isCurator ? 7 : 6} className="px-6 py-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {/* Left: info */}
              <div className="space-y-3">
                {sub.avatar_url && (
                  <div>
                    <img
                      src={sub.avatar_url}
                      alt={sub.display_name}
                      className="h-16 w-16 rounded-full border border-slate-200"
                    />
                  </div>
                )}
                {sub.description && (
                  <div>
                    <p className="text-xs font-medium uppercase text-slate-400">Description</p>
                    <p className="mt-0.5 text-sm text-slate-700 whitespace-pre-line">{sub.description}</p>
                  </div>
                )}
                {socialLinks.length > 0 && (
                  <div>
                    <p className="text-xs font-medium uppercase text-slate-400">Social Links</p>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {socialLinks.map((l) => (
                        <a
                          key={l.label}
                          href={l.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-md bg-slate-200 px-2 py-1 text-xs text-slate-700 hover:bg-slate-300"
                        >
                          {l.label}
                        </a>
                      ))}
                    </div>
                  </div>
                )}
                {sub.reviewed_at && (
                  <div>
                    <p className="text-xs font-medium uppercase text-slate-400">Reviewed At</p>
                    <p className="mt-0.5 text-sm text-slate-600">{sub.reviewed_at}</p>
                  </div>
                )}
                {sub.reviewer_note && (
                  <div>
                    <p className="text-xs font-medium uppercase text-slate-400">Reviewer Note</p>
                    <p className="mt-0.5 text-sm text-slate-600">{sub.reviewer_note}</p>
                  </div>
                )}
              </div>
              {/* Right: reject note input (curators only, pending only) */}
              {isCurator && sub.status === 'pending' && (
                <div>
                  <label className="text-xs font-medium uppercase text-slate-400">
                    Reviewer Note (optional, shown on reject)
                  </label>
                  <textarea
                    value={rejectNote}
                    onChange={(e) => onRejectNoteChange(e.target.value)}
                    placeholder="Reason for rejection..."
                    rows={3}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
