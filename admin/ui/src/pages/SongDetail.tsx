import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import type { Song, AuthUser, UpdateSongBody } from '../../../shared/types';
import { api } from '../api/client';
import StatusBadge from '../components/StatusBadge';

export default function SongDetail({ user }: { user: AuthUser }) {
  const { id } = useParams<{ id: string }>();
  const [song, setSong] = useState<Song | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<UpdateSongBody>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    api
      .getSong(id)
      .then((s) => {
        setSong(s);
        setEditForm({ title: s.title, originalArtist: s.originalArtist, tags: s.tags });
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load song'))
      .finally(() => setLoading(false));
  }, [id]);

  const handleSave = async () => {
    if (!id) return;
    setSaving(true);
    try {
      const updated = await api.updateSong(id, editForm);
      setSong(updated);
      setEditing(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleStatus = async (status: 'approved' | 'rejected') => {
    if (!id) return;
    try {
      const updated = await api.updateSongStatus(id, { status });
      setSong(updated);
    } catch {
      // unchanged state is visible
    }
  };

  if (loading) return <div className="text-slate-500">Loading...</div>;
  if (error) return <div className="text-red-600">{error}</div>;
  if (!song) return <div className="text-slate-500">Song not found.</div>;

  const isCurator = user.role === 'curator';

  return (
    <div>
      <Link to="/songs" className="text-sm text-blue-600 hover:underline">
        ← Back to Songs
      </Link>

      <div className="mt-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            {editing ? (
              <div className="space-y-3">
                <input
                  type="text"
                  value={editForm.title ?? ''}
                  onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                  className="w-full rounded border border-slate-300 px-3 py-1.5 text-lg font-semibold focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <input
                  type="text"
                  value={editForm.originalArtist ?? ''}
                  onChange={(e) => setEditForm((f) => ({ ...f, originalArtist: e.target.value }))}
                  placeholder="Original artist"
                  className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <input
                  type="text"
                  value={editForm.tags?.join(', ') ?? ''}
                  onChange={(e) =>
                    setEditForm((f) => ({
                      ...f,
                      tags: e.target.value
                        .split(',')
                        .map((t) => t.trim())
                        .filter(Boolean),
                    }))
                  }
                  placeholder="Tags (comma-separated)"
                  className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    onClick={() => setEditing(false)}
                    className="rounded bg-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-300"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <h2 className="text-xl font-semibold text-slate-800">{song.title}</h2>
                <p className="mt-1 text-slate-600">{song.originalArtist}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {song.tags.map((t) => (
                    <span key={t} className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                      {t}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={song.status} />
            {isCurator && !editing && (
              <button
                onClick={() => setEditing(true)}
                className="rounded bg-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-300"
              >
                Edit
              </button>
            )}
          </div>
        </div>

        {/* Metadata */}
        <div className="mt-4 grid grid-cols-2 gap-4 border-t border-slate-100 pt-4 text-sm">
          <div>
            <span className="text-slate-500">Submitted by:</span>{' '}
            <span className="text-slate-700">{song.submittedBy ?? '—'}</span>
          </div>
          <div>
            <span className="text-slate-500">Reviewed by:</span>{' '}
            <span className="text-slate-700">{song.reviewedBy ?? '—'}</span>
          </div>
          <div>
            <span className="text-slate-500">Created:</span>{' '}
            <span className="text-slate-700">{song.createdAt}</span>
          </div>
          <div>
            <span className="text-slate-500">Updated:</span>{' '}
            <span className="text-slate-700">{song.updatedAt}</span>
          </div>
        </div>

        {/* Curator actions */}
        {isCurator && song.status === 'pending' && (
          <div className="mt-4 flex gap-2 border-t border-slate-100 pt-4">
            <button
              onClick={() => handleStatus('approved')}
              className="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
            >
              Approve
            </button>
            <button
              onClick={() => handleStatus('rejected')}
              className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
            >
              Reject
            </button>
          </div>
        )}
      </div>

      {/* Performances */}
      <div className="mt-6">
        <h3 className="text-lg font-semibold text-slate-800">Performances</h3>
        {!song.performances || song.performances.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No performances recorded.</p>
        ) : (
          <div className="mt-3 space-y-4">
            {song.performances.map((perf) => (
              <div key={perf.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium text-slate-800">{perf.streamTitle}</p>
                    <p className="mt-0.5 text-sm text-slate-500">
                      {perf.date} · {formatTimestamp(perf.timestamp)}
                      {perf.endTimestamp != null && ` – ${formatTimestamp(perf.endTimestamp)}`}
                    </p>
                    {perf.note && <p className="mt-1 text-sm text-slate-600">{perf.note}</p>}
                  </div>
                  <StatusBadge status={perf.status} />
                </div>

                {/* YouTube embed */}
                <div className="mt-3 aspect-video w-full max-w-lg overflow-hidden rounded-md">
                  <iframe
                    src={`https://www.youtube.com/embed/${perf.videoId}?start=${perf.timestamp}`}
                    title={perf.streamTitle}
                    allowFullScreen
                    className="h-full w-full"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
