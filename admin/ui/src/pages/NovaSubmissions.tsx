import { useEffect, useReducer, useState } from 'react';
import type { Dispatch } from 'react';
import type { AuthUser, NovaSubmission, NovaStatus, BulkFetchSubscribersResponse } from '../../../shared/types';
import { sanitizeNovaUrl } from '../../../shared/nova-url-safety';
import { api } from '../api/client';
import { useApiResource, errorMessage } from '../lib/apiResource';
import { countByStatus, removeById, replaceById } from '../lib/status-totals';
import { useSearchParams } from 'react-router-dom';
import { finiteInputNumber } from '../lib/numeric-input';
import { Avatar } from '../components/prism/Avatar';
import { GradientButton, OutlineButton } from '../components/prism/Buttons';
import { Chip } from '../components/prism/Chip';
import { CircleButton } from '../components/prism/CircleButton';
import { ColumnHeader } from '../components/prism/ColumnHeader';
import { DetailField } from '../components/prism/DetailField';
import { PrismInput, PrismTextarea } from '../components/prism/Fields';
import { GlassCard } from '../components/prism/GlassCard';
import { Icon } from '../components/prism/Icon';
import { StatusPill } from '../components/prism/Pill';
import { PrismPage } from '../components/prism/PrismPage';
import { SearchInput } from '../components/prism/SearchInput';
import { SectionLabel } from '../components/prism/SectionLabel';
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

const ROW_GRID = 'grid-cols-[40px_minmax(0,1fr)_minmax(0,1fr)_110px_120px_120px_128px_28px]';

const STATUS_FILTERS: ReadonlyArray<{ value: '' | NovaStatus; label: string }> = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

function isCanonicalUtcTimestamp(value: string | null): value is string {
  if (value === null || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

export default function NovaSubmissions({ user }: { user: AuthUser }) {
  const [initialParams] = useSearchParams();
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
  const [actionError, setActionError] = useState<string | null>(null);
  const [fetchingAll, setFetchingAll] = useState(false);
  const [fetchAllResult, setFetchAllResult] = useState<BulkFetchSubscribersResponse | null>(null);

  const list = useApiResource(
    async () => {
      const [res, all] = await Promise.all([
        api.listNovaSubmissions({ status: statusFilter || undefined, search: search || undefined }),
        api.listNovaSubmissions(),
      ]);
      return { submissions: res.data, allSubmissions: all.data };
    },
    [statusFilter],
  );
  const submissions = list.data?.submissions ?? [];
  const allSubmissions = list.data?.allSubmissions ?? [];
  const loading = list.loading;

  const handleAction = async (id: string, status: NovaStatus) => {
    setActionLoading(id);
    setActionError(null);
    try {
      const updated = await api.updateNovaStatus(id, {
        status,
        reviewer_note: status === 'rejected' ? rejectNote[id] : undefined,
      });
      list.mutate(({ submissions, allSubmissions }) => ({ submissions: replaceById(submissions, updated), allSubmissions: replaceById(allSubmissions, updated) }));
      setRejectNote((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (err) {
      setActionError(errorMessage(err, 'Action failed'));
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (sub: NovaSubmission) => {
    if (!window.confirm(`Permanently delete submission "${sub.id}" (${sub.display_name})? This cannot be undone.`)) return;
    setActionLoading(sub.id);
    setActionError(null);
    try {
      await api.deleteNovaSubmission(sub.id);
      list.mutate(({ submissions, allSubmissions }) => ({ submissions: removeById(submissions, sub.id), allSubmissions: removeById(allSubmissions, sub.id) }));
    } catch (err) {
      setActionError(errorMessage(err, 'Delete failed'));
    } finally {
      setActionLoading(null);
    }
  };

  const handleSave = (updated: NovaSubmission) => {
    list.mutate(({ submissions, allSubmissions }) => ({ submissions: replaceById(submissions, updated), allSubmissions: replaceById(allSubmissions, updated) }));
  };

  const handleFetchAll = async () => {
    setFetchingAll(true);
    setFetchAllResult(null);
    setActionError(null);
    try {
      const result = await api.fetchAllNovaSubscribers();
      setFetchAllResult(result);
      list.reload();
    } catch (err) {
      setActionError(errorMessage(err, 'Bulk fetch failed'));
    } finally {
      setFetchingAll(false);
    }
  };

  const isCurator = user.role === 'curator';
  const countOf = (status: NovaStatus) => countByStatus(allSubmissions, status);

  return (
    <PrismPage
      icon="nova"
      badge="Submissions"
      title="Nova"
      description="Review VTuber submissions from the public Nova form."
      count={`${allSubmissions.length} submissions`}
      stats={[
        { value: countOf('pending'), label: 'Pending' },
        { value: countOf('approved'), label: 'Approved' },
        { value: countOf('rejected'), label: 'Rejected' },
      ]}
      toolbar={
        <>
          <div className="flex items-center gap-1.5" role="group" aria-label="Filter submissions by status">
            {STATUS_FILTERS.map((filter) => (
              <Chip
                key={filter.value}
                active={statusFilter === filter.value}
                onClick={() => setStatusFilter(filter.value)}
              >
                {filter.label}
              </Chip>
            ))}
          </div>
          <div className="flex-1" />
          <form
            onSubmit={(event) => {
              event.preventDefault();
              list.reload();
            }}
          >
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search ID, slug, channel..."
              label="Search submissions"
            />
          </form>
          {isCurator && (
            <GradientButton
              icon="refresh"
              disabled={fetchingAll || loading}
              onClick={handleFetchAll}
            >
              {fetchingAll ? 'Fetching...' : 'Fetch All Channel Info'}
            </GradientButton>
          )}
        </>
      }
    >
      <div className="px-6 pb-6">
        {/* Bulk fetch result summary */}
        {fetchAllResult && (
          <GlassCard className="mt-3 px-4 py-3 text-sm">
            <p className="font-medium text-token-primary">
              Updated {fetchAllResult.updated}, Failed {fetchAllResult.failed}
            </p>
            {fetchAllResult.results.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-token-secondary hover:text-token-primary">
                  Show details ({fetchAllResult.results.length} streamers)
                </summary>
                <ul className="mt-1 space-y-1 text-xs">
                  {fetchAllResult.results.map((r) => (
                    <li key={r.id} className={r.error ? 'text-red-600' : 'text-token-secondary'}>
                      {r.display_name}: {r.error ? r.error : `${r.subscriber_count}${r.avatar_url ? ' (avatar updated)' : ''}`}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </GlassCard>
        )}

        {list.error && <p className="mt-4 text-sm text-red-600">{list.error}</p>}
        {actionError && <p className="mt-4 text-sm text-red-600">{actionError}</p>}

        {loading ? (
          <p className="py-6 text-center text-sm text-token-secondary">Loading...</p>
        ) : (
          <div className="overflow-x-auto">
          <table aria-label="VTuber submissions" className="block min-w-[880px]">
            <ColumnHeader
              gridClassName={ROW_GRID}
              sticky={false}
              columns={[
                { key: 'avatar', label: '' },
                { key: 'vtuber', label: 'VTuber', className: 'pl-3' },
                { key: 'channel', label: 'Channel', className: 'pl-3' },
                { key: 'subscribers', label: 'Subscribers', className: 'pl-3' },
                { key: 'status', label: 'Status', className: 'pl-3' },
                { key: 'submitted', label: 'Submitted', className: 'pl-3' },
                { key: 'actions', label: '' },
                { key: 'toggle', label: '' },
              ]}
            />
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
              <tbody className="block">
                <tr className="block">
                  <td colSpan={8} className="block px-4 py-8 text-center text-sm text-token-tertiary">No submissions found.</td>
                </tr>
              </tbody>
            )}
          </table>
          </div>
        )}
      </div>
    </PrismPage>
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
  const avatarUrl = sanitizeNovaUrl(sub.avatar_url, 'image');
  const socialLinks = expanded && !editing
    ? [
        { label: 'YouTube', url: sub.link_youtube, safeUrl: sanitizeNovaUrl(sub.link_youtube, 'youtube') },
        { label: 'Twitter', url: sub.link_twitter, safeUrl: sanitizeNovaUrl(sub.link_twitter, 'twitter') },
        { label: 'Facebook', url: sub.link_facebook, safeUrl: sanitizeNovaUrl(sub.link_facebook, 'facebook') },
        { label: 'Instagram', url: sub.link_instagram, safeUrl: sanitizeNovaUrl(sub.link_instagram, 'instagram') },
        { label: 'Twitch', url: sub.link_twitch, safeUrl: sanitizeNovaUrl(sub.link_twitch, 'twitch') },
      ]
    : [];

  const showReviewCard = isCurator && !editing;

  return (
    <tbody className={`mt-0.5 block rounded-radius-lg ${expanded ? 'bg-[#FCE7F320]' : ''}`}>
      <SubmissionSummaryRow
        sub={sub}
        avatarUrl={avatarUrl}
        youtubeChannelUrl={youtubeChannelUrl}
        isCurator={isCurator}
        expanded={expanded}
        onToggle={onToggle}
        onAction={onAction}
        onDelete={onDelete}
        actionLoading={actionLoading}
      />
      {expanded && (
        <tr className="block">
        <td
          colSpan={8}
          id={`nova-submission-details-${sub.id}`}
          className={`grid gap-6 border-t border-border-token-table px-3 pb-3 pt-4 ${
            showReviewCard ? 'grid-cols-[minmax(0,1fr)_360px]' : 'grid-cols-1'
          }`}
        >
          {/* Left column: submission fields */}
          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex items-center gap-4">
              {!editing && <SubmissionAvatar sub={sub} safeUrl={avatarUrl} />}
              <div className="min-w-0 flex-1">
                <p className="text-xl font-bold leading-tight text-token-primary">{sub.display_name}</p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-token-secondary">
                  <span>{sub.brand_name || sub.slug}</span>
                  {sub.group && (
                    <>
                      <span className="text-token-tertiary">·</span>
                      <span>{sub.group}</span>
                    </>
                  )}
                  <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-radius-pill border border-border-token px-2 py-0.5 text-[10px] font-semibold leading-4 text-token-secondary">
                    <Icon name="shield" size={11} />
                    {channelVerified ? 'Verified' : 'Not verified'}
                  </span>
                </p>
              </div>
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
            </div>

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

          {/* Right column: review actions */}
          {showReviewCard && (
            <GlassCard className="flex flex-col gap-2.5 self-start p-4">
              {sub.status === 'pending' ? (
                <RejectNoteEditor
                  submissionId={sub.id}
                  value={rejectNote}
                  onChange={onRejectNoteChange}
                />
              ) : (
                <SectionLabel>Review</SectionLabel>
              )}
              <div className="flex items-center gap-2">
                {sub.status === 'pending' ? (
                  <>
                    <GradientButton
                      icon="check"
                      disabled={actionLoading}
                      onClick={() => onAction(sub.id, 'approved')}
                    >
                      Approve
                    </GradientButton>
                    <OutlineButton
                      icon="x"
                      tone="danger"
                      disabled={actionLoading}
                      onClick={() => onAction(sub.id, 'rejected')}
                    >
                      Reject
                    </OutlineButton>
                  </>
                ) : (
                  <OutlineButton
                    icon="undo"
                    disabled={actionLoading}
                    onClick={() => onAction(sub.id, 'pending')}
                  >
                    Revert to Pending
                  </OutlineButton>
                )}
                <div className="flex-1" />
                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={() => onDelete(sub)}
                  className="text-[11px] font-medium text-token-tertiary transition-colors hover:text-red-600 disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            </GlassCard>
          )}
        </td>
        </tr>
      )}
    </tbody>
  );
}

function SubmissionSummaryRow({
  sub,
  avatarUrl,
  youtubeChannelUrl,
  isCurator,
  expanded,
  onToggle,
  onAction,
  onDelete,
  actionLoading,
}: {
  sub: NovaSubmission;
  avatarUrl: string | null;
  youtubeChannelUrl: string | null;
  isCurator: boolean;
  expanded: boolean;
  onToggle: () => void;
  onAction: (id: string, status: NovaStatus) => void;
  onDelete: (sub: NovaSubmission) => void;
  actionLoading: boolean;
}) {
  return (
    // The name cell is the accessible toggle control (keyboard focus, expanded
    // state); the chevron is a mouse-only duplicate of it.
    <tr className={`${ROW_GRID} hover-row grid items-center rounded-radius-lg px-3 py-2`}>
      <td className="flex items-center p-0">
        <Avatar src={avatarUrl} alt="" size={40} />
      </td>
      <td className="flex min-w-0 p-0">
      <button
        type="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-controls={`nova-submission-details-${sub.id}`}
        aria-label={`${expanded ? '收合' : '展開'} ${sub.display_name}`}
        onClick={onToggle}
        className="flex min-w-0 flex-col items-start gap-0.5 rounded-radius-sm pl-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-pink"
      >
        <span
          className={`max-w-full truncate text-[15px] font-bold leading-tight ${
            expanded ? 'text-accent-pink-dark' : 'text-token-primary'
          }`}
        >
          {sub.display_name}
        </span>
        <span className="font-mono text-[11px] text-token-secondary">{sub.slug}</span>
      </button>
      </td>
      <td className="flex min-w-0 items-center gap-1.5 p-0 pl-3 text-[13px] text-token-secondary">
        {youtubeChannelUrl ? (
          <a
            href={youtubeChannelUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-w-0 items-center gap-1.5 hover:text-accent-pink"
          >
            <Icon name="youtube" size={14} className="text-[#FF0000]" />
            <span className="truncate">{sub.brand_name || sub.youtube_channel_url}</span>
          </a>
        ) : (
          <span className="truncate">{sub.brand_name || sub.youtube_channel_url || '—'}</span>
        )}
      </td>
      <td className={`p-0 pl-3 text-[13px] font-semibold ${sub.subscriber_count ? 'text-token-primary' : 'text-token-tertiary'}`}>
        {sub.subscriber_count || '—'}
      </td>
      <td className="p-0 pl-3">
        <StatusPill status={sub.status} />
      </td>
      <td className="p-0 pl-3 font-mono text-[11px] text-token-secondary">{sub.submitted_at}</td>
      <td className="flex items-center justify-end gap-1.5 p-0">
        {isCurator && !expanded && (
          sub.status === 'pending' ? (
            <>
              <CircleButton label="Approve" icon="check" gradient disabled={actionLoading} onClick={() => onAction(sub.id, 'approved')} />
              <CircleButton label="Reject" icon="x" disabled={actionLoading} onClick={() => onAction(sub.id, 'rejected')} />
              <CircleButton label="Delete" icon="trash" danger disabled={actionLoading} onClick={() => onDelete(sub)} />
            </>
          ) : (
            <>
              <CircleButton label="Revert to Pending" icon="undo" disabled={actionLoading} onClick={() => onAction(sub.id, 'pending')} />
              <CircleButton label="Delete" icon="trash" danger disabled={actionLoading} onClick={() => onDelete(sub)} />
            </>
          )
        )}
      </td>
      <td className="flex justify-end p-0">
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onClick={onToggle}
          className="flex justify-end text-token-tertiary hover:text-accent-pink"
        >
          <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={20} />
        </button>
      </td>
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
    <div className="flex flex-wrap items-center justify-end gap-2">
      {!editing ? (
        <>
          <OutlineButton icon="pencil" onClick={onEdit}>
            Edit
          </OutlineButton>
          <OutlineButton
            icon="shield"
            disabled={verifyingChannel || !sub.youtube_channel_id || channelVerified}
            onClick={onVerifyChannel}
          >
            {verifyingChannel ? 'Verifying...' : channelVerified ? 'Channel verified' : 'Verify channel'}
          </OutlineButton>
        </>
      ) : (
        <>
          <GradientButton
            icon="check"
            disabled={saving || orderDraft === undefined}
            onClick={onSave}
          >
            {saving ? 'Saving...' : 'Save'}
          </GradientButton>
          <OutlineButton disabled={saving} onClick={onCancel}>
            Cancel
          </OutlineButton>
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
  if (!sub.avatar_url) return <Avatar src={null} alt="" size={64} />;

  if (safeUrl) return <Avatar src={safeUrl} alt={sub.display_name} size={64} />;

  return (
    <div className="flex items-center gap-3">
      <Avatar src={null} alt="" size={64} />
      <p className="max-w-[240px] break-all text-xs text-token-tertiary">Invalid avatar URL: {sub.avatar_url}</p>
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
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        {EDITABLE_FIELDS.map(({ key, label, multiline }) => (
          <div key={key} className={multiline ? 'col-span-2' : ''}>
            <label
              htmlFor={`nova-${sub.id}-${key}`}
              className="block text-[10px] font-bold uppercase tracking-[0.1em] text-token-tertiary"
            >
              {label}
            </label>
            {multiline ? (
              <PrismTextarea
                id={`nova-${sub.id}-${key}`}
                value={draft[key]}
                onChange={(event) => dispatch({
                  type: 'draftFieldChanged',
                  key,
                  value: event.target.value,
                })}
                rows={3}
                className="mt-1"
              />
            ) : (
              <div className={key === 'subscriber_count' ? 'mt-1 flex gap-2' : 'mt-1'}>
                <PrismInput
                  id={`nova-${sub.id}-${key}`}
                  type="text"
                  value={draft[key]}
                  onChange={(event) => dispatch({
                    type: 'draftFieldChanged',
                    key,
                    value: event.target.value,
                  })}
                />
                {key === 'subscriber_count' && (
                  <GradientButton
                    icon="refresh"
                    className="shrink-0"
                    disabled={fetchingSubscribers || !sub.youtube_channel_id}
                    onClick={onFetchSubscribers}
                    title={!sub.youtube_channel_id ? 'Set YouTube Channel ID first' : 'Fetch subscriber count & avatar from YouTube'}
                  >
                    {fetchingSubscribers ? 'Fetching...' : 'Fetch'}
                  </GradientButton>
                )}
              </div>
            )}
            {key === 'subscriber_count' && fetchSubscribersError && (
              <p className="mt-1 text-xs text-red-600">{fetchSubscribersError}</p>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <label
            htmlFor={`nova-enabled-${sub.id}`}
            className="text-[10px] font-bold uppercase tracking-[0.1em] text-token-tertiary"
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
            className="h-4 w-4 rounded border-border-token accent-accent-pink"
          />
          <span className="text-xs text-token-secondary">
            {enabledDraft ? 'Visible on site' : 'Hidden from site'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <label
            htmlFor={`nova-display-order-${sub.id}`}
            className="text-[10px] font-bold uppercase tracking-[0.1em] text-token-tertiary"
          >
            Order
          </label>
          <PrismInput
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
            className="w-24"
          />
          {orderDraft === undefined ? (
            <span id={`nova-display-order-error-${sub.id}`} className="text-xs text-red-600">
              Enter a number
            </span>
          ) : (
            <span className="text-xs text-token-secondary">Lower = first</span>
          )}
        </div>
      </div>

      <div>
        <SectionLabel>Theme Colors</SectionLabel>
        <div className="mt-2 grid grid-cols-2 gap-2">
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
                className="h-7 w-7 cursor-pointer rounded-radius-xs border border-border-token p-0"
              />
              <div className="min-w-0 flex-1">
                <span className="block truncate text-xs text-token-secondary">{key}</span>
                <span className="block font-mono text-[10px] text-token-tertiary">{themeDraft[key]}</span>
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
      <div className="grid grid-cols-3 gap-x-4 gap-y-3">
        <DetailField label="Brand Name" value={sub.brand_name} />
        <DetailField label="Group" value={sub.group} />
        <DetailField label="Enabled" value={sub.enabled === 1 ? 'Yes' : 'No'} />
        <DetailField label="Display Order" value={String(sub.display_order ?? 0)} />
        <DetailField label="YouTube Channel URL" className="col-span-2">
          {youtubeChannelUrl ? (
            <a
              href={youtubeChannelUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all text-[13px] leading-normal text-accent-blue hover:text-accent-pink"
            >
              {sub.youtube_channel_url}
            </a>
          ) : (
            <span className="break-all text-[13px] leading-normal text-token-secondary">{sub.youtube_channel_url || '—'}</span>
          )}
        </DetailField>
        <DetailField label="YouTube Channel ID" value={sub.youtube_channel_id} mono />
        <DetailField
          label="Channel verification"
          value={channelVerified ? `Verified ${sub.youtube_channel_verified_at}` : 'Not verified'}
        />
        <DetailField label="Subscriber Count" value={sub.subscriber_count} />
        <DetailField label="Description" value={sub.description} className="col-span-3" />
      </div>

      <div>
        <SectionLabel>Social Links</SectionLabel>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {socialLinks.map((link) => (
            <span key={link.label}>
              {link.safeUrl ? (
                <a
                  href={link.safeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-radius-pill border border-border-token-accent-blue bg-accent-bg-blue px-2.5 py-1 text-[11px] font-semibold leading-4 text-accent-blue hover:text-accent-pink"
                >
                  <Icon name="external" size={11} />
                  {link.label}
                </a>
              ) : link.url ? (
                <span
                  title={link.url}
                  className="inline-flex items-center rounded-radius-pill border border-[#FDE68A] bg-[#FEF3C7] px-2.5 py-1 text-[11px] font-semibold leading-4 text-[#B45309]"
                >
                  Invalid {link.label}
                </span>
              ) : (
                <span className="inline-flex items-center rounded-radius-pill border border-border-token bg-[#F1F5F9] px-2.5 py-1 text-[11px] font-medium leading-4 text-token-muted line-through">
                  {link.label}
                </span>
              )}
            </span>
          ))}
        </div>
      </div>

      {sub.theme_json && (
        <div>
          <SectionLabel>Theme Colors</SectionLabel>
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {Object.entries(parseThemeJson(sub.theme_json)).map(([key, color]) => (
              <div
                key={key}
                title={`${key}: ${color}`}
                className="h-5 w-5 rounded-radius-circle border border-black/5 shadow-sm"
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-x-4 gap-y-3">
        <DetailField label="Reviewed At" value={sub.reviewed_at ?? ''} />
        <DetailField label="Reviewer Note" value={sub.reviewer_note} className="col-span-2" />
      </div>
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
        className="block text-[10px] font-bold uppercase tracking-[0.1em] text-token-tertiary"
      >
        Reviewer Note (optional, shown on reject)
      </label>
      <PrismTextarea
        id={`nova-reject-note-${submissionId}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Reason for rejection..."
        rows={3}
        className="mt-2"
      />
    </div>
  );
}
