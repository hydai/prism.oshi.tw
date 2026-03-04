import { useEffect, useState } from 'react';
import type { AuthUser, NovaVodSubmission, NovaVodSong, NovaStatus } from '../../../shared/types';
import { api } from '../api/client';
import StatusBadge from '../components/StatusBadge';

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

export default function NovaVodSubmissions({ user }: { user: AuthUser }) {
  const [vods, setVods] = useState<NovaVodSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'' | NovaStatus>('pending');
  const [streamerFilter, setStreamerFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedSongs, setExpandedSongs] = useState<NovaVodSong[]>([]);
  const [rejectNote, setRejectNote] = useState<Record<string, string>>({});
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchVods = () => {
    setLoading(true);
    api
      .listNovaVods({
        status: statusFilter || undefined,
        streamer: streamerFilter || undefined,
      })
      .then((res) => setVods(res.data))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchVods();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, streamerFilter]);

  const handleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedSongs([]);
      return;
    }
    setExpandedId(id);
    try {
      const detail = await api.getNovaVod(id);
      setExpandedSongs(detail.songs);
    } catch {
      setExpandedSongs([]);
    }
  };

  const handleAction = async (id: string, status: NovaStatus) => {
    setActionLoading(id);
    try {
      const updated = await api.updateNovaVodStatus(id, {
        status,
        reviewer_note: status === 'rejected' ? rejectNote[id] : undefined,
      });
      setVods((prev) => prev.map((v) => (v.id === id ? updated : v)));
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

  // Collect unique streamers for filter dropdown
  const uniqueStreamers = [...new Set(vods.map((v) => v.streamer_slug))].sort();

  return (
    <div>
      <h2 className="text-xl font-semibold text-slate-800">Nova VOD Submissions</h2>
      <p className="mt-1 text-sm text-slate-500">Review VOD submissions from fans.</p>

      {/* Filters */}
      <div className="mt-4 flex gap-3">
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
        <select
          value={streamerFilter}
          onChange={(e) => setStreamerFilter(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        >
          <option value="">All streamers</option>
          {uniqueStreamers.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
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
                <th className="px-4 py-3">Streamer</th>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Video ID</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Submitted</th>
                {isCurator && <th className="px-4 py-3">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {vods.map((vod) => (
                <VodRow
                  key={vod.id}
                  vod={vod}
                  isCurator={isCurator}
                  expanded={expandedId === vod.id}
                  songs={expandedId === vod.id ? expandedSongs : []}
                  onToggle={() => handleExpand(vod.id)}
                  rejectNote={rejectNote[vod.id] ?? ''}
                  onRejectNoteChange={(val) => setRejectNote((prev) => ({ ...prev, [vod.id]: val }))}
                  onAction={handleAction}
                  actionLoading={actionLoading === vod.id}
                />
              ))}
              {vods.length === 0 && (
                <tr>
                  <td colSpan={isCurator ? 7 : 6} className="px-4 py-8 text-center text-slate-400">
                    No VOD submissions found.
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

function VodRow({
  vod,
  isCurator,
  expanded,
  songs,
  onToggle,
  rejectNote,
  onRejectNoteChange,
  onAction,
  actionLoading,
}: {
  vod: NovaVodSubmission;
  isCurator: boolean;
  expanded: boolean;
  songs: NovaVodSong[];
  onToggle: () => void;
  rejectNote: string;
  onRejectNoteChange: (val: string) => void;
  onAction: (id: string, status: NovaStatus) => void;
  actionLoading: boolean;
}) {
  return (
    <>
      <tr className="cursor-pointer hover:bg-slate-50" onClick={onToggle}>
        <td className="px-4 py-3 font-medium text-slate-800">
          <span className="mr-1 text-xs text-slate-400">{expanded ? '\u25BC' : '\u25B6'}</span>
          {vod.streamer_slug}
        </td>
        <td className="px-4 py-3 text-slate-700">{vod.stream_title || '\u2014'}</td>
        <td className="px-4 py-3">
          <a
            href={vod.video_url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-xs text-blue-600 hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {vod.video_id}
          </a>
        </td>
        <td className="px-4 py-3 text-slate-500">{vod.stream_date || '\u2014'}</td>
        <td className="px-4 py-3">
          <StatusBadge status={vod.status} />
        </td>
        <td className="px-4 py-3 text-slate-500">{vod.submitted_at}</td>
        {isCurator && (
          <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
            {vod.status === 'pending' && (
              <div className="flex gap-1">
                <button
                  disabled={actionLoading}
                  onClick={() => onAction(vod.id, 'approved')}
                  className="rounded bg-green-600 px-2 py-1 text-xs text-white hover:bg-green-700 disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  disabled={actionLoading}
                  onClick={() => onAction(vod.id, 'rejected')}
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
              {/* Left: details */}
              <div className="space-y-3">
                {vod.thumbnail_url && (
                  <div>
                    <img
                      src={vod.thumbnail_url}
                      alt={vod.stream_title}
                      className="h-28 rounded-md border border-slate-200"
                    />
                  </div>
                )}
                <DetailField label="Video URL">
                  <a
                    href={vod.video_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-600 hover:underline break-all"
                  >
                    {vod.video_url}
                  </a>
                </DetailField>
                <DetailField label="Stream Title" value={vod.stream_title} />
                <DetailField label="Stream Date" value={vod.stream_date} />
                <DetailField label="Submitter Note" value={vod.submitter_note} />
                <DetailField label="Reviewer Note" value={vod.reviewer_note} />
                <DetailField label="Reviewed At" value={vod.reviewed_at ?? ''} />

                {/* Song timestamps */}
                {songs.length > 0 && (
                  <div>
                    <p className="text-xs font-medium uppercase text-slate-400">
                      Songs ({songs.length})
                    </p>
                    <div className="mt-2 overflow-x-auto rounded-md border border-slate-200 bg-white">
                      <table className="w-full text-left text-xs">
                        <thead className="border-b border-slate-100 bg-slate-50">
                          <tr>
                            <th className="px-3 py-2">#</th>
                            <th className="px-3 py-2">Title</th>
                            <th className="px-3 py-2">Artist</th>
                            <th className="px-3 py-2">Start</th>
                            <th className="px-3 py-2">End</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {songs.map((song, i) => (
                            <tr key={song.id}>
                              <td className="px-3 py-1.5 text-slate-400">{i + 1}</td>
                              <td className="px-3 py-1.5 font-medium text-slate-700">{song.song_title}</td>
                              <td className="px-3 py-1.5 text-slate-500">{song.original_artist || '\u2014'}</td>
                              <td className="px-3 py-1.5 font-mono text-green-700">{formatTimestamp(song.start_timestamp)}</td>
                              <td className="px-3 py-1.5 font-mono text-orange-600">
                                {song.end_timestamp !== null ? formatTimestamp(song.end_timestamp) : '\u2014'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                {songs.length === 0 && (
                  <p className="text-xs text-slate-400">No song timestamps submitted.</p>
                )}
              </div>

              {/* Right: reject note */}
              {isCurator && vod.status === 'pending' && (
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

function DetailField({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase text-slate-400">{label}</p>
      {children ?? (
        <p className={`mt-0.5 text-sm whitespace-pre-line ${value ? 'text-slate-700' : 'text-slate-400'}`}>
          {value || '\u2014'}
        </p>
      )}
    </div>
  );
}
