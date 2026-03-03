import { useEffect, useState } from 'react';
import type { AuthUser, NovaSubmission, NovaStatus } from '../../../shared/types';
import { api } from '../api/client';
import StatusBadge from '../components/StatusBadge';

type EditableKey =
  | 'display_name' | 'slug' | 'brand_name' | 'youtube_channel_url'
  | 'description' | 'avatar_url' | 'subscriber_count'
  | 'link_youtube' | 'link_twitter' | 'link_facebook' | 'link_instagram' | 'link_twitch'
  | 'group';

/** Fields curators can edit on a submission. */
const EDITABLE_FIELDS: ReadonlyArray<{ key: EditableKey; label: string; multiline?: boolean }> = [
  { key: 'display_name', label: 'Display Name' },
  { key: 'slug', label: 'Slug' },
  { key: 'brand_name', label: 'Brand Name' },
  { key: 'group', label: 'Group' },
  { key: 'youtube_channel_url', label: 'YouTube Channel URL' },
  { key: 'description', label: 'Description', multiline: true },
  { key: 'avatar_url', label: 'Avatar URL' },
  { key: 'subscriber_count', label: 'Subscriber Count' },
  { key: 'link_youtube', label: 'Link: YouTube' },
  { key: 'link_twitter', label: 'Link: Twitter' },
  { key: 'link_facebook', label: 'Link: Facebook' },
  { key: 'link_instagram', label: 'Link: Instagram' },
  { key: 'link_twitch', label: 'Link: Twitch' },
];

/** The 12 theme color tokens used in registry.json. */
const THEME_KEYS = [
  'accentPrimary', 'accentPrimaryDark', 'accentPrimaryLight',
  'accentSecondary', 'accentSecondaryLight',
  'bgPageStart', 'bgPageMid', 'bgPageEnd',
  'bgAccentPrimary', 'bgAccentPrimaryMuted',
  'borderAccentPrimary', 'borderAccentSecondary',
] as const;

type ThemeColors = Record<(typeof THEME_KEYS)[number], string>;

function parseThemeJson(json: string): ThemeColors {
  const empty: ThemeColors = Object.fromEntries(THEME_KEYS.map((k) => [k, '#000000'])) as ThemeColors;
  if (!json) return empty;
  try {
    const parsed = JSON.parse(json);
    return { ...empty, ...parsed };
  } catch {
    return empty;
  }
}

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

  const handleSave = (updated: NovaSubmission) => {
    setSubmissions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
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
                  onSave={handleSave}
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
  onSave,
  actionLoading,
}: {
  sub: NovaSubmission;
  isCurator: boolean;
  expanded: boolean;
  onToggle: () => void;
  rejectNote: string;
  onRejectNoteChange: (val: string) => void;
  onAction: (id: string, status: NovaStatus) => void;
  onSave: (updated: NovaSubmission) => void;
  actionLoading: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<EditableKey, string>>(() => buildDraft(sub));
  const [themeDraft, setThemeDraft] = useState<ThemeColors>(() => parseThemeJson(sub.theme_json));
  const [enabledDraft, setEnabledDraft] = useState(sub.enabled === 1);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Reset draft when submission changes (e.g. after save or status change)
  useEffect(() => {
    setDraft(buildDraft(sub));
    setThemeDraft(parseThemeJson(sub.theme_json));
    setEnabledDraft(sub.enabled === 1);
  }, [sub]);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      // Only send fields that actually changed
      const changes: Record<string, string | number> = {};
      for (const { key } of EDITABLE_FIELDS) {
        if (draft[key] !== (sub[key] ?? '')) {
          changes[key] = draft[key];
        }
      }
      // Theme JSON
      const newThemeJson = JSON.stringify(themeDraft);
      if (newThemeJson !== (sub.theme_json || '')) {
        changes.theme_json = newThemeJson;
      }
      // Enabled
      const newEnabled = enabledDraft ? 1 : 0;
      if (newEnabled !== sub.enabled) {
        changes.enabled = newEnabled;
      }
      if (Object.keys(changes).length === 0) {
        setEditing(false);
        return;
      }
      const updated = await api.updateNovaSubmission(sub.id, changes);
      onSave(updated);
      setEditing(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setDraft(buildDraft(sub));
    setThemeDraft(parseThemeJson(sub.theme_json));
    setEnabledDraft(sub.enabled === 1);
    setSaveError(null);
    setEditing(false);
  };

  const socialLinks = [
    { label: 'YouTube', url: sub.link_youtube },
    { label: 'Twitter', url: sub.link_twitter },
    { label: 'Facebook', url: sub.link_facebook },
    { label: 'Instagram', url: sub.link_instagram },
    { label: 'Twitch', url: sub.link_twitch },
  ];

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
            {sub.brand_name || sub.youtube_channel_url}
          </a>
        </td>
        <td className="px-4 py-3 text-slate-600">{sub.subscriber_count || '—'}</td>
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
            {/* Edit / View toggle button */}
            {isCurator && (
              <div className="mb-3 flex items-center gap-2">
                {!editing ? (
                  <button
                    onClick={() => setEditing(true)}
                    className="rounded bg-slate-700 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800"
                  >
                    Edit
                  </button>
                ) : (
                  <>
                    <button
                      disabled={saving}
                      onClick={handleSave}
                      className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      disabled={saving}
                      onClick={handleCancel}
                      className="rounded bg-slate-200 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-300 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </>
                )}
                {saveError && <span className="text-xs text-red-600">{saveError}</span>}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {/* Left column: submission fields */}
              <div className="space-y-3">
                {/* Avatar preview (not editable inline, but URL is) */}
                {sub.avatar_url && !editing && (
                  <div>
                    <img
                      src={sub.avatar_url}
                      alt={sub.display_name}
                      className="h-16 w-16 rounded-full border border-slate-200"
                    />
                  </div>
                )}

                {editing ? (
                  // Edit mode: render all editable fields as inputs
                  <>
                    {EDITABLE_FIELDS.map(({ key, label, multiline }) => (
                      <div key={key}>
                        <label className="text-xs font-medium uppercase text-slate-400">{label}</label>
                        {multiline ? (
                          <textarea
                            value={draft[key]}
                            onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                            rows={3}
                            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        ) : (
                          <input
                            type="text"
                            value={draft[key]}
                            onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        )}
                      </div>
                    ))}

                    {/* Enabled toggle */}
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-medium uppercase text-slate-400">Enabled</label>
                      <input
                        type="checkbox"
                        checked={enabledDraft}
                        onChange={(e) => setEnabledDraft(e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-xs text-slate-500">
                        {enabledDraft ? 'Visible on site' : 'Hidden from site'}
                      </span>
                    </div>

                    {/* Theme color editor */}
                    <div>
                      <label className="text-xs font-medium uppercase text-slate-400">Theme Colors</label>
                      <div className="mt-1 grid grid-cols-2 gap-2">
                        {THEME_KEYS.map((key) => (
                          <div key={key} className="flex items-center gap-2">
                            <input
                              type="color"
                              value={themeDraft[key]}
                              onChange={(e) =>
                                setThemeDraft((d) => ({ ...d, [key]: e.target.value.toUpperCase() }))
                              }
                              className="h-7 w-7 cursor-pointer rounded border border-slate-300 p-0"
                            />
                            <div className="min-w-0 flex-1">
                              <span className="block truncate text-xs text-slate-600">{key}</span>
                              <span className="block font-mono text-[10px] text-slate-400">{themeDraft[key]}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  // View mode: render all fields as read-only
                  <>
                    <DetailField label="Brand Name" value={sub.brand_name} />
                    <DetailField label="Group" value={sub.group} />
                    <DetailField label="Enabled" value={sub.enabled === 1 ? 'Yes' : 'No'} />
                    <DetailField label="YouTube Channel URL">
                      <a
                        href={sub.youtube_channel_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-blue-600 hover:underline break-all"
                      >
                        {sub.youtube_channel_url}
                      </a>
                    </DetailField>
                    <DetailField label="Description" value={sub.description} />
                    <DetailField label="Subscriber Count" value={sub.subscriber_count} />

                    <div>
                      <p className="text-xs font-medium uppercase text-slate-400">Social Links</p>
                      <div className="mt-1 flex flex-wrap gap-2">
                        {socialLinks.map((l) => (
                          <span key={l.label}>
                            {l.url ? (
                              <a
                                href={l.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="rounded-md bg-slate-200 px-2 py-1 text-xs text-slate-700 hover:bg-slate-300"
                              >
                                {l.label}
                              </a>
                            ) : (
                              <span className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-400 line-through">
                                {l.label}
                              </span>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Theme color preview */}
                    {sub.theme_json && (
                      <div>
                        <p className="text-xs font-medium uppercase text-slate-400">Theme Colors</p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {Object.entries(parseThemeJson(sub.theme_json)).map(([key, color]) => (
                            <div
                              key={key}
                              title={`${key}: ${color}`}
                              className="h-5 w-5 rounded border border-slate-200"
                              style={{ backgroundColor: color }}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    <DetailField label="Reviewed At" value={sub.reviewed_at ?? ''} />
                    <DetailField label="Reviewer Note" value={sub.reviewer_note} />
                  </>
                )}
              </div>

              {/* Right column: reject note (curators only, pending only, view mode only) */}
              {isCurator && sub.status === 'pending' && !editing && (
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

function buildDraft(sub: NovaSubmission): Record<EditableKey, string> {
  const draft = {} as Record<EditableKey, string>;
  for (const { key } of EDITABLE_FIELDS) {
    draft[key] = sub[key] ?? '';
  }
  return draft;
}

function DetailField({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase text-slate-400">{label}</p>
      {children ?? (
        <p className={`mt-0.5 text-sm whitespace-pre-line ${value ? 'text-slate-700' : 'text-slate-400'}`}>
          {value || '—'}
        </p>
      )}
    </div>
  );
}
