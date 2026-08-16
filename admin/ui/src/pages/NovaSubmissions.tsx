import { useEffect, useReducer, useState } from 'react';
import type { Dispatch } from 'react';
import type { AuthUser, NovaSubmission, NovaStatus, BulkFetchSubscribersResponse } from '../../../shared/types';
import { sanitizeNovaUrl } from '../../../shared/nova-url-safety';
import { api } from '../api/client';
import StatusBadge from '../components/StatusBadge';
import { useSearchParams } from 'react-router-dom';
import { finiteInputNumber } from '../lib/numeric-input';
import {
  createSubmissionRowState,
  EDITABLE_FIELDS,
  parseThemeJson,
  submissionRowReducer,
  THEME_KEYS,
} from './nova-submission-row-state';
import type {
  SubmissionRowAction,
  SubmissionRowState,
} from './nova-submission-row-state';

function isCanonicalUtcTimestamp(value: string | null): value is string {
  if (value === null || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

export default function NovaSubmissions({ user }: { user: AuthUser }) {
  const [initialParams] = useSearchParams();
  const [submissions, setSubmissions] = useState<NovaSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'' | NovaStatus>(() => {
    const requested = initialParams.get('status');
    return requested === 'approved' || requested === 'rejected' || requested === 'pending'
      ? requested
      : 'pending';
  });
  const [search, setSearch] = useState(() => initialParams.get('search') ?? '');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState<Record<string, string>>({});
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [fetchingAll, setFetchingAll] = useState(false);
  const [fetchAllResult, setFetchAllResult] = useState<BulkFetchSubscribersResponse | null>(null);

  const fetchSubmissions = () => {
    setLoading(true);
    api
      .listNovaSubmissions({ status: statusFilter || undefined, search: search || undefined })
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

  const handleDelete = async (sub: NovaSubmission) => {
    if (!window.confirm(`Permanently delete submission "${sub.id}" (${sub.display_name})? This cannot be undone.`)) return;
    setActionLoading(sub.id);
    try {
      await api.deleteNovaSubmission(sub.id);
      setSubmissions((prev) => prev.filter((s) => s.id !== sub.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setActionLoading(null);
    }
  };

  const handleSave = (updated: NovaSubmission) => {
    setSubmissions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  };

  const handleFetchAll = async () => {
    setFetchingAll(true);
    setFetchAllResult(null);
    try {
      const result = await api.fetchAllNovaSubscribers();
      setFetchAllResult(result);
      fetchSubmissions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk fetch failed');
    } finally {
      setFetchingAll(false);
    }
  };

  const isCurator = user.role === 'curator';

  return (
    <div>
      <h2 className="text-xl font-semibold text-slate-800">Nova Submissions</h2>
      <p className="mt-1 text-sm text-slate-500">Review VTuber submissions from the public Nova form.</p>

      {/* Status filter + bulk actions */}
      <div className="mt-4 flex items-center gap-3">
        <select
          aria-label="Filter submissions by status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as '' | NovaStatus)}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            fetchSubmissions();
          }}
        >
          <input
            type="search"
            aria-label="Search submissions"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search ID, slug, channel..."
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          />
          <button type="submit" className="rounded bg-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">
            Search
          </button>
        </form>
        {isCurator && (
          <button
            disabled={fetchingAll || loading}
            onClick={handleFetchAll}
            className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {fetchingAll ? 'Fetching...' : 'Fetch All Channel Info'}
          </button>
        )}
      </div>

      {/* Bulk fetch result summary */}
      {fetchAllResult && (
        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
          <p className="font-medium text-slate-700">
            Updated {fetchAllResult.updated}, Failed {fetchAllResult.failed}
          </p>
          {fetchAllResult.results.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-700">
                Show details ({fetchAllResult.results.length} streamers)
              </summary>
              <ul className="mt-1 space-y-1 text-xs">
                {fetchAllResult.results.map((r) => (
                  <li key={r.id} className={r.error ? 'text-red-600' : 'text-slate-600'}>
                    {r.display_name}: {r.error ? r.error : `${r.subscriber_count}${r.avatar_url ? ' (avatar updated)' : ''}`}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

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
                  onDelete={handleDelete}
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

export function SubmissionRow({
  sub,
  isCurator,
  expanded,
  onToggle,
  rejectNote,
  onRejectNoteChange,
  onAction,
  onDelete,
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
  onDelete: (sub: NovaSubmission) => void;
  onSave: (updated: NovaSubmission) => void;
  actionLoading: boolean;
}) {
  const [{
    editing,
    draft,
    themeDraft,
    enabledDraft,
    orderDraft,
    saving,
    saveError,
    fetchingSubscribers: fetchingSubs,
    fetchSubscribersError: fetchSubsError,
    verifyingChannel,
    verificationError,
  }, dispatch] = useReducer(submissionRowReducer, sub, createSubmissionRowState);

  // Reset draft when submission changes (e.g. after save or status change)
  useEffect(() => {
    dispatch({ type: 'submissionChanged', submission: sub });
  }, [sub]);

  const handleSave = async () => {
    if (orderDraft === undefined) {
      dispatch({ type: 'saveValidationFailed', error: 'Display order must be a number.' });
      return;
    }

    dispatch({ type: 'saveStarted' });
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
      // Display order
      if (orderDraft !== (sub.display_order ?? 0)) {
        changes.display_order = orderDraft;
      }
      if (Object.keys(changes).length === 0) {
        dispatch({ type: 'saveSucceeded' });
        return;
      }
      const updated = await api.updateNovaSubmission(sub.id, changes);
      onSave(updated);
      dispatch({ type: 'saveSucceeded' });
    } catch (err) {
      dispatch({
        type: 'saveFailed',
        error: err instanceof Error ? err.message : 'Save failed',
      });
    } finally {
      dispatch({ type: 'saveFinished' });
    }
  };

  const handleCancel = () => {
    dispatch({ type: 'editCancelled', submission: sub });
  };

  const handleFetchSubscribers = async () => {
    dispatch({ type: 'subscribersFetchStarted' });
    try {
      const updated = await api.fetchNovaSubscribers(sub.id);
      onSave(updated);
      dispatch({
        type: 'subscribersFetchSucceeded',
        submission: updated,
        updateDraft: editing,
      });
    } catch (err) {
      dispatch({
        type: 'subscribersFetchFailed',
        error: err instanceof Error ? err.message : 'Failed to fetch subscribers',
      });
    } finally {
      dispatch({ type: 'subscribersFetchFinished' });
    }
  };

  const handleVerifyChannel = async () => {
    dispatch({ type: 'verificationStarted' });
    try {
      onSave(await api.verifyNovaYoutubeChannel(sub.id));
    } catch (err) {
      dispatch({
        type: 'verificationFailed',
        error: err instanceof Error ? err.message : 'Channel verification failed',
      });
    } finally {
      dispatch({ type: 'verificationFinished' });
    }
  };

  const channelVerified = Boolean(
    sub.youtube_channel_id
    && sub.youtube_channel_verified_id === sub.youtube_channel_id
    && isCanonicalUtcTimestamp(sub.youtube_channel_verified_at),
  );

  const youtubeChannelUrl = sanitizeNovaUrl(sub.youtube_channel_url, 'youtube');
  const avatarUrl = expanded && !editing ? sanitizeNovaUrl(sub.avatar_url, 'image') : null;
  const socialLinks = expanded && !editing
    ? [
        { label: 'YouTube', url: sub.link_youtube, safeUrl: sanitizeNovaUrl(sub.link_youtube, 'youtube') },
        { label: 'Twitter', url: sub.link_twitter, safeUrl: sanitizeNovaUrl(sub.link_twitter, 'twitter') },
        { label: 'Facebook', url: sub.link_facebook, safeUrl: sanitizeNovaUrl(sub.link_facebook, 'facebook') },
        { label: 'Instagram', url: sub.link_instagram, safeUrl: sanitizeNovaUrl(sub.link_instagram, 'instagram') },
        { label: 'Twitch', url: sub.link_twitch, safeUrl: sanitizeNovaUrl(sub.link_twitch, 'twitch') },
      ]
    : [];

  return (
    <>
      <SubmissionSummaryRow
        sub={sub}
        isCurator={isCurator}
        expanded={expanded}
        onToggle={onToggle}
        onAction={onAction}
        onDelete={onDelete}
        actionLoading={actionLoading}
      />
      {expanded && (
        <tr id={`nova-submission-details-${sub.id}`} className="bg-slate-50">
          <td colSpan={isCurator ? 7 : 6} className="px-6 py-4">
            {isCurator && (
              <SubmissionToolbar
                sub={sub}
                state={{
                  editing,
                  saving,
                  saveError,
                  orderDraft,
                  verifyingChannel,
                  verificationError,
                }}
                channelVerified={channelVerified}
                onEdit={() => dispatch({ type: 'editStarted' })}
                onSave={handleSave}
                onCancel={handleCancel}
                onVerifyChannel={handleVerifyChannel}
              />
            )}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {/* Left column: submission fields */}
              <div className="space-y-3">
                {!editing && <SubmissionAvatar sub={sub} safeUrl={avatarUrl} />}

                {editing ? (
                  <SubmissionEditor
                    sub={sub}
                    state={{
                      draft,
                      themeDraft,
                      enabledDraft,
                      orderDraft,
                      fetchingSubscribers: fetchingSubs,
                      fetchSubscribersError: fetchSubsError,
                    }}
                    dispatch={dispatch}
                    onFetchSubscribers={handleFetchSubscribers}
                  />
                ) : (
                  <SubmissionView
                    sub={sub}
                    youtubeChannelUrl={youtubeChannelUrl}
                    channelVerified={channelVerified}
                    socialLinks={socialLinks}
                  />
                )}
              </div>

              {isCurator && sub.status === 'pending' && !editing && (
                <RejectNoteEditor
                  submissionId={sub.id}
                  value={rejectNote}
                  onChange={onRejectNoteChange}
                />
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function SubmissionSummaryRow({
  sub,
  isCurator,
  expanded,
  onToggle,
  onAction,
  onDelete,
  actionLoading,
}: {
  sub: NovaSubmission;
  isCurator: boolean;
  expanded: boolean;
  onToggle: () => void;
  onAction: (id: string, status: NovaStatus) => void;
  onDelete: (sub: NovaSubmission) => void;
  actionLoading: boolean;
}) {
  const youtubeChannelUrl = sanitizeNovaUrl(sub.youtube_channel_url, 'youtube');

  return (
    <tr
      className="cursor-pointer hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-500"
      onClick={onToggle}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onToggle();
      }}
      tabIndex={0}
      aria-expanded={expanded}
      aria-controls={`nova-submission-details-${sub.id}`}
      aria-label={`${expanded ? '收合' : '展開'} ${sub.display_name}`}
    >
      <td className="px-4 py-3 font-medium text-slate-800">
        <span className="mr-1 text-xs text-slate-400">{expanded ? '▼' : '▶'}</span>
        {sub.display_name}
      </td>
      <td className="px-4 py-3 font-mono text-xs text-slate-600">{sub.slug}</td>
      <td className="px-4 py-3">
        {youtubeChannelUrl ? (
          <a
            href={youtubeChannelUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline"
            onClick={(event) => event.stopPropagation()}
          >
            {sub.brand_name || sub.youtube_channel_url}
          </a>
        ) : (
          <span className="text-slate-600">{sub.brand_name || sub.youtube_channel_url || '—'}</span>
        )}
      </td>
      <td className="px-4 py-3 text-slate-600">{sub.subscriber_count || '—'}</td>
      <td className="px-4 py-3">
        <StatusBadge status={sub.status} />
      </td>
      <td className="px-4 py-3 text-slate-500">{sub.submitted_at}</td>
      {isCurator && (
        <td className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
          <div className="flex gap-1">
            {sub.status === 'pending' ? (
              <>
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
              </>
            ) : (
              <button
                disabled={actionLoading}
                onClick={() => onAction(sub.id, 'pending')}
                className="rounded bg-amber-500 px-2 py-1 text-xs text-white hover:bg-amber-600 disabled:opacity-50"
              >
                Revert to Pending
              </button>
            )}
            <button
              disabled={actionLoading}
              onClick={() => onDelete(sub)}
              className="ml-2 rounded bg-red-800 px-2 py-1 text-xs text-white hover:bg-red-900 disabled:opacity-50"
            >
              Delete
            </button>
          </div>
        </td>
      )}
    </tr>
  );
}

type SubmissionToolbarState = Pick<
  SubmissionRowState,
  | 'editing'
  | 'saving'
  | 'saveError'
  | 'orderDraft'
  | 'verifyingChannel'
  | 'verificationError'
>;

function SubmissionToolbar({
  sub,
  state,
  channelVerified,
  onEdit,
  onSave,
  onCancel,
  onVerifyChannel,
}: {
  sub: NovaSubmission;
  state: SubmissionToolbarState;
  channelVerified: boolean;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onVerifyChannel: () => void;
}) {
  const {
    editing,
    saving,
    saveError,
    orderDraft,
    verifyingChannel,
    verificationError,
  } = state;

  return (
    <div className="mb-3 flex items-center gap-2">
      {!editing ? (
        <>
          <button
            onClick={onEdit}
            className="rounded bg-slate-700 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800"
          >
            Edit
          </button>
          <button
            type="button"
            disabled={verifyingChannel || !sub.youtube_channel_id || channelVerified}
            onClick={onVerifyChannel}
            className="rounded bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {verifyingChannel ? 'Verifying...' : channelVerified ? 'Channel verified' : 'Verify channel'}
          </button>
        </>
      ) : (
        <>
          <button
            disabled={saving || orderDraft === undefined}
            onClick={onSave}
            className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button
            disabled={saving}
            onClick={onCancel}
            className="rounded bg-slate-200 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-300 disabled:opacity-50"
          >
            Cancel
          </button>
        </>
      )}
      {saveError && <span className="text-xs text-red-600">{saveError}</span>}
      {verificationError && <span className="text-xs text-red-600">{verificationError}</span>}
    </div>
  );
}

function SubmissionAvatar({
  sub,
  safeUrl,
}: {
  sub: NovaSubmission;
  safeUrl: string | null;
}) {
  if (!sub.avatar_url) return null;

  return (
    <div>
      {safeUrl ? (
        <img
          src={safeUrl}
          alt={sub.display_name}
          className="h-16 w-16 rounded-full border border-slate-200"
        />
      ) : (
        <p className="text-xs text-slate-400 break-all">Invalid avatar URL: {sub.avatar_url}</p>
      )}
    </div>
  );
}

type SubmissionEditorState = Pick<
  SubmissionRowState,
  | 'draft'
  | 'themeDraft'
  | 'enabledDraft'
  | 'orderDraft'
  | 'fetchingSubscribers'
  | 'fetchSubscribersError'
>;

function SubmissionEditor({
  sub,
  state,
  dispatch,
  onFetchSubscribers,
}: {
  sub: NovaSubmission;
  state: SubmissionEditorState;
  dispatch: Dispatch<SubmissionRowAction>;
  onFetchSubscribers: () => void;
}) {
  const {
    draft,
    themeDraft,
    enabledDraft,
    orderDraft,
    fetchingSubscribers,
    fetchSubscribersError,
  } = state;

  return (
    <>
      {EDITABLE_FIELDS.map(({ key, label, multiline }) => (
        <div key={key}>
          <label
            htmlFor={`nova-${sub.id}-${key}`}
            className="text-xs font-medium uppercase text-slate-400"
          >
            {label}
          </label>
          {multiline ? (
            <textarea
              id={`nova-${sub.id}-${key}`}
              value={draft[key]}
              onChange={(event) => dispatch({
                type: 'draftFieldChanged',
                key,
                value: event.target.value,
              })}
              rows={3}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          ) : (
            <div className={key === 'subscriber_count' ? 'mt-1 flex gap-2' : 'mt-1'}>
              <input
                id={`nova-${sub.id}-${key}`}
                type="text"
                value={draft[key]}
                onChange={(event) => dispatch({
                  type: 'draftFieldChanged',
                  key,
                  value: event.target.value,
                })}
                className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              {key === 'subscriber_count' && (
                <button
                  type="button"
                  disabled={fetchingSubscribers || !sub.youtube_channel_id}
                  onClick={onFetchSubscribers}
                  title={!sub.youtube_channel_id ? 'Set YouTube Channel ID first' : 'Fetch subscriber count & avatar from YouTube'}
                  className="shrink-0 rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {fetchingSubscribers ? 'Fetching...' : 'Fetch'}
                </button>
              )}
            </div>
          )}
          {key === 'subscriber_count' && fetchSubscribersError && (
            <p className="mt-1 text-xs text-red-600">{fetchSubscribersError}</p>
          )}
        </div>
      ))}

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <label
            htmlFor={`nova-enabled-${sub.id}`}
            className="text-xs font-medium uppercase text-slate-400"
          >
            Enabled
          </label>
          <input
            id={`nova-enabled-${sub.id}`}
            type="checkbox"
            checked={enabledDraft}
            onChange={(event) => dispatch({
              type: 'enabledChanged',
              enabled: event.target.checked,
            })}
            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-xs text-slate-500">
            {enabledDraft ? 'Visible on site' : 'Hidden from site'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor={`nova-display-order-${sub.id}`} className="text-xs font-medium uppercase text-slate-400">Order</label>
          <input
            id={`nova-display-order-${sub.id}`}
            type="number"
            value={orderDraft ?? ''}
            onChange={(event) => dispatch({
              type: 'orderChanged',
              order: finiteInputNumber(event.currentTarget.valueAsNumber),
            })}
            aria-invalid={orderDraft === undefined}
            aria-describedby={orderDraft === undefined ? `nova-display-order-error-${sub.id}` : undefined}
            required
            className="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          {orderDraft === undefined ? (
            <span id={`nova-display-order-error-${sub.id}`} className="text-xs text-red-600">
              Enter a number
            </span>
          ) : (
            <span className="text-xs text-slate-500">Lower = first</span>
          )}
        </div>
      </div>

      <div>
        <p className="text-xs font-medium uppercase text-slate-400">Theme Colors</p>
        <div className="mt-1 grid grid-cols-2 gap-2">
          {THEME_KEYS.map((key) => (
            <div key={key} className="flex items-center gap-2">
              <input
                type="color"
                aria-label={`${key} theme color`}
                value={themeDraft[key]}
                onChange={(event) => dispatch({
                  type: 'themeColorChanged',
                  key,
                  value: event.target.value.toUpperCase(),
                })}
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
  );
}

interface SubmissionSocialLink {
  label: string;
  url: string;
  safeUrl: string | null;
}

function SubmissionView({
  sub,
  youtubeChannelUrl,
  channelVerified,
  socialLinks,
}: {
  sub: NovaSubmission;
  youtubeChannelUrl: string | null;
  channelVerified: boolean;
  socialLinks: SubmissionSocialLink[];
}) {
  return (
    <>
      <DetailField label="Brand Name" value={sub.brand_name} />
      <DetailField label="Group" value={sub.group} />
      <DetailField label="Enabled" value={sub.enabled === 1 ? 'Yes' : 'No'} />
      <DetailField label="Display Order" value={String(sub.display_order ?? 0)} />
      <DetailField label="YouTube Channel URL">
        {youtubeChannelUrl ? (
          <a
            href={youtubeChannelUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-blue-600 hover:underline break-all"
          >
            {sub.youtube_channel_url}
          </a>
        ) : (
          <span className="text-sm text-slate-600 break-all">{sub.youtube_channel_url || '—'}</span>
        )}
      </DetailField>
      <DetailField label="YouTube Channel ID" value={sub.youtube_channel_id} />
      <DetailField
        label="Channel verification"
        value={channelVerified ? `Verified ${sub.youtube_channel_verified_at}` : 'Not verified'}
      />
      <DetailField label="Description" value={sub.description} />
      <DetailField label="Subscriber Count" value={sub.subscriber_count} />

      <div>
        <p className="text-xs font-medium uppercase text-slate-400">Social Links</p>
        <div className="mt-1 flex flex-wrap gap-2">
          {socialLinks.map((link) => (
            <span key={link.label}>
              {link.safeUrl ? (
                <a
                  href={link.safeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-md bg-slate-200 px-2 py-1 text-xs text-slate-700 hover:bg-slate-300"
                >
                  {link.label}
                </a>
              ) : link.url ? (
                <span
                  title={link.url}
                  className="rounded-md bg-amber-100 px-2 py-1 text-xs text-amber-700"
                >
                  Invalid {link.label}
                </span>
              ) : (
                <span className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-400 line-through">
                  {link.label}
                </span>
              )}
            </span>
          ))}
        </div>
      </div>

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
  );
}

function RejectNoteEditor({
  submissionId,
  value,
  onChange,
}: {
  submissionId: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label
        htmlFor={`nova-reject-note-${submissionId}`}
        className="text-xs font-medium uppercase text-slate-400"
      >
        Reviewer Note (optional, shown on reject)
      </label>
      <textarea
        id={`nova-reject-note-${submissionId}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Reason for rejection..."
        rows={3}
        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
    </div>
  );
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
