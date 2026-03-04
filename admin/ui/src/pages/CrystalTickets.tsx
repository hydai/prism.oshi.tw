import { useEffect, useState } from 'react';
import type { AuthUser, CrystalTicket, CrystalTicketStatus, CrystalTicketType } from '../../../shared/types';
import { api } from '../api/client';

const TYPE_LABELS: Record<CrystalTicketType, string> = {
  bug: 'Bug',
  feat: 'Feature',
  ui: 'UI',
  other: 'Other',
};

const TYPE_COLORS: Record<CrystalTicketType, string> = {
  bug: 'bg-red-100 text-red-700',
  feat: 'bg-purple-100 text-purple-700',
  ui: 'bg-blue-100 text-blue-700',
  other: 'bg-slate-100 text-slate-700',
};

const STATUS_LABELS: Record<CrystalTicketStatus, string> = {
  pending: 'Pending',
  replied: 'Replied',
  closed: 'Closed',
};

const STATUS_COLORS: Record<CrystalTicketStatus, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  replied: 'bg-green-100 text-green-700',
  closed: 'bg-slate-100 text-slate-500',
};

export default function CrystalTickets({ user }: { user: AuthUser }) {
  const [tickets, setTickets] = useState<CrystalTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'' | CrystalTicketStatus>('pending');
  const [typeFilter, setTypeFilter] = useState<'' | CrystalTicketType>('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState<Record<string, string>>({});
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchTickets = () => {
    setLoading(true);
    api
      .listCrystalTickets({
        status: statusFilter || undefined,
        type: typeFilter || undefined,
      })
      .then((res) => setTickets(res.data))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchTickets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, typeFilter]);

  const handleReply = async (id: string) => {
    const text = replyText[id]?.trim();
    if (!text) return;
    setActionLoading(id);
    try {
      const updated = await api.replyCrystalTicket(id, text);
      setTickets((prev) => prev.map((t) => (t.id === id ? updated : t)));
      setReplyText((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reply failed');
    } finally {
      setActionLoading(null);
    }
  };

  const handleStatusChange = async (id: string, status: CrystalTicketStatus) => {
    setActionLoading(id);
    try {
      const updated = await api.updateCrystalTicketStatus(id, status);
      setTickets((prev) => prev.map((t) => (t.id === id ? updated : t)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Status update failed');
    } finally {
      setActionLoading(null);
    }
  };

  const isCurator = user.role === 'curator';

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Crystal Tickets</h1>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="flex gap-1">
          <label className="mr-1 self-center text-xs font-medium uppercase text-slate-500">Status:</label>
          {(['', 'pending', 'replied', 'closed'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                statusFilter === s
                  ? 'bg-slate-800 text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-100'
              }`}
            >
              {s || 'All'}
            </button>
          ))}
        </div>

        <div className="flex gap-1">
          <label className="mr-1 self-center text-xs font-medium uppercase text-slate-500">Type:</label>
          {(['', 'bug', 'feat', 'ui', 'other'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                typeFilter === t
                  ? 'bg-slate-800 text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-100'
              }`}
            >
              {t ? TYPE_LABELS[t] : 'All'}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {loading ? (
        <p className="text-slate-500">Loading...</p>
      ) : tickets.length === 0 ? (
        <p className="text-slate-500">No tickets found.</p>
      ) : (
        <div className="space-y-2">
          {tickets.map((ticket) => {
            const isExpanded = expandedId === ticket.id;
            return (
              <div
                key={ticket.id}
                className="rounded-lg border border-slate-200 bg-white"
              >
                {/* Summary row */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : ticket.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
                >
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_COLORS[ticket.type]}`}>
                    {TYPE_LABELS[ticket.type]}
                  </span>
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[ticket.status]}`}>
                    {STATUS_LABELS[ticket.status]}
                  </span>
                  {ticket.is_public_reply_allowed ? (
                    <span className="inline-block rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600">Public</span>
                  ) : null}
                  <span className="flex-1 truncate text-sm font-medium text-slate-800">
                    {ticket.title}
                  </span>
                  <span className="text-xs text-slate-400">
                    {ticket.nickname || 'anon'} · {ticket.submitted_at?.slice(0, 10)}
                  </span>
                  <svg
                    className={`h-4 w-4 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t border-slate-100 px-4 py-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <p className="mb-1 text-xs font-medium uppercase text-slate-400">ID</p>
                        <p className="text-sm font-mono text-slate-600">{ticket.id}</p>
                      </div>
                      <div>
                        <p className="mb-1 text-xs font-medium uppercase text-slate-400">Contact</p>
                        <p className="text-sm text-slate-600">{ticket.contact || '—'}</p>
                      </div>
                      {ticket.context_url && (
                        <div className="sm:col-span-2">
                          <p className="mb-1 text-xs font-medium uppercase text-slate-400">Context URL</p>
                          <p className="text-sm text-blue-600 break-all">{ticket.context_url}</p>
                        </div>
                      )}
                    </div>

                    <div className="mt-4">
                      <p className="mb-1 text-xs font-medium uppercase text-slate-400">Description</p>
                      <p className="whitespace-pre-wrap text-sm text-slate-700">{ticket.body}</p>
                    </div>

                    {/* Existing reply */}
                    {ticket.admin_reply && (
                      <div className="mt-4 rounded-md border-l-4 border-purple-400 bg-purple-50 p-3">
                        <p className="mb-1 text-xs font-medium text-purple-600">
                          Reply · {ticket.replied_at?.slice(0, 10)}
                        </p>
                        <p className="whitespace-pre-wrap text-sm text-slate-700">{ticket.admin_reply}</p>
                      </div>
                    )}

                    {/* Actions */}
                    {isCurator && (
                      <div className="mt-4 space-y-3">
                        {/* Reply textarea */}
                        <div>
                          <textarea
                            className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-purple-400 focus:outline-none"
                            rows={3}
                            placeholder={ticket.admin_reply ? 'Update reply...' : 'Write a reply...'}
                            value={replyText[ticket.id] ?? ''}
                            onChange={(e) => setReplyText((prev) => ({ ...prev, [ticket.id]: e.target.value }))}
                          />
                          <button
                            onClick={() => handleReply(ticket.id)}
                            disabled={actionLoading === ticket.id || !replyText[ticket.id]?.trim()}
                            className="mt-1 rounded-md bg-purple-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-purple-700 disabled:opacity-50"
                          >
                            {actionLoading === ticket.id ? '...' : (ticket.admin_reply ? 'Update Reply' : 'Send Reply')}
                          </button>
                        </div>

                        {/* Status buttons */}
                        <div className="flex gap-2">
                          {ticket.status !== 'closed' && (
                            <button
                              onClick={() => handleStatusChange(ticket.id, 'closed')}
                              disabled={actionLoading === ticket.id}
                              className="rounded-md bg-slate-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                            >
                              Close
                            </button>
                          )}
                          {ticket.status === 'closed' && (
                            <button
                              onClick={() => handleStatusChange(ticket.id, 'pending')}
                              disabled={actionLoading === ticket.id}
                              className="rounded-md bg-yellow-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-yellow-600 disabled:opacity-50"
                            >
                              Reopen
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
