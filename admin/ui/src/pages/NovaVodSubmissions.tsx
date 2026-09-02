import { useId, useMemo, useState, type ReactNode } from 'react';
import type { AuthUser, NovaVodSubmission, NovaVodSong, NovaStatus } from '../../../shared/types';
import { api } from '../api/client';
import { sanitizeNovaUrl } from '../../../shared/nova-url-safety';
import { useApiResource, errorMessage } from '../lib/apiResource';
import { formatTimestamp } from '../lib/format-timestamp';
import { countByStatus, matchesFilter, removeById, replaceById } from '../lib/status-totals';
import { Avatar } from '../components/prism/Avatar';
import { GradientButton, OutlineButton } from '../components/prism/Buttons';
import { CircleButton } from '../components/prism/CircleButton';
import { ColumnHeader } from '../components/prism/ColumnHeader';
import { DetailField } from '../components/prism/DetailField';
import { PrismSelect, PrismTextarea } from '../components/prism/Fields';
import { GlassCard } from '../components/prism/GlassCard';
import { Icon } from '../components/prism/Icon';
import { Pill, StatusPill } from '../components/prism/Pill';
import { PrismPage } from '../components/prism/PrismPage';
import { SectionLabel } from '../components/prism/SectionLabel';
import { Segmented } from '../components/prism/Segmented';
import { StatusFilterBar } from '../components/StatusFilterBar';
import { groupVodsByStreamer, type VodGroup, type VodViewMode } from '../lib/nova-vod-groups';
import { NOVA_STATUS_FILTERS } from './nova-status-filters';

const ROW_GRID = 'grid-cols-[64px_minmax(0,1fr)_100px_110px_120px_128px_28px]';
const ROW_COLUMNS = [
  { key: 'thumbnail', label: '' },
  { key: 'vod', label: 'VOD', className: 'pl-3' },
  { key: 'songs', label: 'Songs', className: 'pl-3' },
  { key: 'status', label: 'Status', className: 'pl-3' },
  { key: 'submitted', label: 'Submitted', className: 'pl-3' },
  { key: 'actions', label: '' },
  { key: 'toggle', label: '' },
];

export default function NovaVodSubmissions({ user }: { user: AuthUser }) {
  const [statusFilter, setStatusFilter] = useState<'' | NovaStatus>('pending');
  const [streamerFilter, setStreamerFilter] = useState('');
  const [viewMode, setViewMode] = useState<VodViewMode>('grouped');
  const [groupOpen, setGroupOpen] = useState<Record<string, boolean>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Keyed by VOD id so a slow detail response for A can never render under B.
  const [expandedSongs, setExpandedSongs] = useState<Record<string, NovaVodSong[]>>({});
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  // Load errors live in `list.error`; row actions get their own slot so one
  // failed approval doesn't masquerade as a broken list.
  const [actionError, setActionError] = useState<string | null>(null);
  const streamerFilterId = useId();

  // One unfiltered load feeds the table, the hero totals and the streamer options;
  // the two filters narrow it here instead of costing a second request.
  const list = useApiResource(async () => (await api.listNovaVods()).data, []);
  // Stable reference while loading, so the filter memo doesn't recompute every render.
  const allVods = useMemo(() => list.data ?? [], [list.data]);
  const vods = useMemo(
    () => allVods.filter(
      (vod) => matchesFilter(vod.status, statusFilter) && matchesFilter(vod.streamer_slug, streamerFilter),
    ),
    [allVods, statusFilter, streamerFilter],
  );
  const loading = list.loading;

  const handleExpand = async (id: string) => {
    setActionError(null);
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (expandedSongs[id]) return; // already loaded
    try {
      const detail = await api.getNovaVod(id);
      setExpandedSongs((prev) => ({ ...prev, [id]: detail.songs }));
    } catch (err) {
      // Leave the id absent so re-expanding retries; tell the curator why it's empty.
      setActionError(errorMessage(err, '無法載入歌曲清單'));
    }
  };

  /** Resolves true once the row may clear the note it just submitted. */
  const handleAction = async (id: string, status: NovaStatus, rejectNote: string): Promise<boolean> => {
    setActionLoading(id);
    setActionError(null);
    try {
      const updated = await api.updateNovaVodStatus(id, {
        status,
        reviewer_note: status === 'rejected' ? rejectNote : undefined,
      });
      list.mutate((vods) => replaceById(vods, updated));
      return true;
    } catch (err) {
      setActionError(errorMessage(err, 'Action failed'));
      return false;
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (vod: NovaVodSubmission) => {
    if (!window.confirm(`Permanently delete VOD submission "${vod.id}" (${vod.stream_title || vod.video_id})? This cannot be undone.`)) return;
    setActionLoading(vod.id);
    setActionError(null);
    try {
      await api.deleteNovaVod(vod.id);
      list.mutate((vods) => removeById(vods, vod.id));
    } catch (err) {
      setActionError(errorMessage(err, 'Delete failed'));
    } finally {
      setActionLoading(null);
    }
  };

  const isCurator = user.role === 'curator';

  // Collect unique streamers for filter dropdown
  const uniqueStreamers = [...new Set(allVods.map((v) => v.streamer_slug))].sort();
  const groups = groupVodsByStreamer(vods);
  const countOf = (status: NovaStatus) => countByStatus(allVods, status);

  const renderRow = (vod: NovaVodSubmission) => (
    <VodRow
      key={vod.id}
      vod={vod}
      isCurator={isCurator}
      expanded={expandedId === vod.id}
      showStreamer={viewMode === 'timeline'}
      songs={expandedId === vod.id ? (expandedSongs[vod.id] ?? []) : []}
      onToggle={() => handleExpand(vod.id)}
      onAction={handleAction}
      onDelete={handleDelete}
      actionLoading={actionLoading === vod.id}
    />
  );

  return (
    <PrismPage
      icon="nova"
      badge="VOD submissions"
      title="Nova VODs"
      description={
        viewMode === 'grouped'
          ? 'Review karaoke VOD submissions from fans, grouped by VTuber.'
          : 'Review VOD submissions from fans.'
      }
      count={`${allVods.length} VODs · ${uniqueStreamers.length} VTubers`}
      stats={[
        { value: countOf('pending'), label: 'Pending' },
        { value: countOf('approved'), label: 'Approved' },
        { value: countOf('rejected'), label: 'Rejected' },
      ]}
      toolbar={
        <>
          <StatusFilterBar
            options={NOVA_STATUS_FILTERS}
            value={statusFilter}
            onChange={setStatusFilter}
            label="Filter VOD submissions by status"
          />
          <div aria-hidden="true" className="h-5 w-px bg-border-token" />
          <Segmented
            label="View"
            value={viewMode}
            onChange={setViewMode}
            options={[
              { value: 'grouped', label: 'By VTuber', icon: 'users' },
              { value: 'timeline', label: 'Timeline', icon: 'clock' },
            ]}
          />
          <label htmlFor={streamerFilterId} className="sr-only">
            Filter VOD submissions by streamer
          </label>
          <PrismSelect
            id={streamerFilterId}
            value={streamerFilter}
            onChange={(e) => setStreamerFilter(e.target.value)}
          >
            <option value="">All streamers</option>
            {uniqueStreamers.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </PrismSelect>
        </>
      }
    >
      <div className="px-6 pb-6 pt-3">
        {list.error && <p className="mb-4 text-sm text-red-600">{list.error}</p>}
        {actionError && <p className="mb-4 text-sm text-red-600">{actionError}</p>}

        {loading ? (
          <p className="py-6 text-center text-sm text-token-secondary">Loading...</p>
        ) : vods.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-token-tertiary">No VOD submissions found.</p>
        ) : viewMode === 'grouped' ? (
          <div className="flex flex-col gap-2.5">
            {groups.map((group) => (
              <VodGroupCard
                key={group.slug}
                group={group}
                open={groupOpen[group.slug] ?? group.pendingCount > 0}
                onToggle={() =>
                  setGroupOpen((prev) => ({
                    ...prev,
                    [group.slug]: !(prev[group.slug] ?? group.pendingCount > 0),
                  }))
                }
              >
                {group.vods.map(renderRow)}
              </VodGroupCard>
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table aria-label="VOD submissions" className="block min-w-[820px]">
              <ColumnHeader gridClassName={ROW_GRID} columns={ROW_COLUMNS} sticky={false} />
              {vods.map(renderRow)}
            </table>
          </div>
        )}
      </div>
    </PrismPage>
  );
}

function VodGroupCard({
  group,
  open,
  onToggle,
  children,
}: {
  group: VodGroup;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const bodyId = `nova-vod-group-${group.slug}`;
  return (
    <GlassCard className="overflow-hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={onToggle}
        className="hover-row flex w-full items-center gap-4 px-6 py-3.5 text-left"
      >
        <Avatar src={null} alt="" size={48} radius={12} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[15px] font-bold leading-tight text-token-primary">{group.slug}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <Pill tone="pink">{group.vods.length === 1 ? '1 VOD' : `${group.vods.length} VODs`}</Pill>
          {group.pendingCount > 0 ? (
            <Pill tone="pending">{group.pendingCount} pending</Pill>
          ) : (
            <Pill tone="approved">All reviewed</Pill>
          )}
        </span>
        <span className="ml-2 text-token-tertiary">
          <Icon name={open ? 'chevronDown' : 'chevronRight'} size={20} />
        </span>
      </button>
      {open && (
        <div id={bodyId} className="overflow-x-auto border-t border-border-token-table px-3 pb-3 pt-1">
          <table aria-label={`VOD submissions for ${group.slug}`} className="block min-w-[820px]">
            <ColumnHeader gridClassName={ROW_GRID} columns={ROW_COLUMNS} sticky={false} />
            {children}
          </table>
        </div>
      )}
    </GlassCard>
  );
}

export function VodRow({
  vod,
  isCurator,
  expanded,
  showStreamer = false,
  songs,
  onToggle,
  onAction,
  onDelete,
  actionLoading,
}: {
  vod: NovaVodSubmission;
  isCurator: boolean;
  expanded: boolean;
  /** Timeline mode: rows are not under a streamer card, so carry the slug inline. */
  showStreamer?: boolean;
  songs: NovaVodSong[];
  onToggle: () => void;
  /** Resolves true when the review landed, so the row may drop its note. */
  onAction: (id: string, status: NovaStatus, rejectNote: string) => Promise<boolean>;
  onDelete: (vod: NovaVodSubmission) => void;
  actionLoading: boolean;
}) {
  // The note being written belongs to this row: typing it re-renders one VOD, not the inbox.
  const [rejectNote, setRejectNote] = useState('');
  const rejectNoteId = useId();
  const detailsId = `nova-vod-details-${vod.id}`;
  const showReviewCard = isCurator;
  const review = async (status: NovaStatus) => {
    if (await onAction(vod.id, status, rejectNote)) setRejectNote('');
  };
  // Submitter-supplied: only YouTube's image CDNs may load in the curator's browser.
  const thumbnailUrl = sanitizeNovaUrl(vod.thumbnail_url, 'thumbnail');

  return (
    <tbody className={`mt-0.5 block rounded-radius-lg ${expanded ? 'bg-[#FCE7F320]' : ''}`}>
      {/* The title is the accessible toggle control; the chevron is a mouse-only duplicate of it. */}
      <tr className={`${ROW_GRID} hover-row grid items-center rounded-radius-lg px-3 py-2`}>
        <td className="flex items-center p-0">
          <VodThumbnail src={thumbnailUrl} />
        </td>
        <td className="flex min-w-0 flex-col gap-0.5 p-0 pl-3">
          <button
            type="button"
            tabIndex={0}
            aria-expanded={expanded}
            aria-controls={detailsId}
            aria-label={`${expanded ? '收合' : '展開'} ${vod.stream_title || vod.video_id}`}
            onClick={onToggle}
            className={`max-w-full truncate rounded-radius-sm text-left text-[15px] font-bold leading-tight focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-pink ${
              expanded ? 'text-accent-pink-dark' : 'text-token-primary'
            }`}
          >
            {vod.stream_title || '—'}
          </button>
          <span className="flex items-center gap-1.5 text-[11px]">
            {showStreamer && (
              <>
                <span className="font-mono font-semibold text-token-secondary">{vod.streamer_slug}</span>
                <span className="text-token-tertiary">·</span>
              </>
            )}
            <a
              href={vod.video_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-mono text-accent-blue hover:text-accent-pink"
            >
              {vod.video_id}
              <Icon name="external" size={11} className="text-token-tertiary" />
            </a>
            <span className="text-token-tertiary">·</span>
            <span className={vod.stream_date ? 'font-mono text-token-secondary' : 'font-medium text-amber-600'}>
              {vod.stream_date || 'No date'}
            </span>
          </span>
        </td>
        <td className="p-0 pl-3">
          {expanded && songs.length > 0 ? (
            <Pill tone="pink">{songs.length} songs</Pill>
          ) : (
            <span className="text-[13px] text-token-tertiary">—</span>
          )}
        </td>
        <td className="p-0 pl-3">
          <StatusPill status={vod.status} />
        </td>
        <td className="p-0 pl-3 font-mono text-[11px] text-token-secondary">{vod.submitted_at}</td>
        <td className="flex items-center justify-end gap-1.5 p-0">
          {isCurator && !expanded && (
            vod.status === 'pending' ? (
              <>
                <CircleButton label="Approve" icon="check" gradient disabled={actionLoading} onClick={() => review('approved')} />
                <CircleButton label="Reject" icon="x" disabled={actionLoading} onClick={() => review('rejected')} />
                <CircleButton label="Delete" icon="trash" danger disabled={actionLoading} onClick={() => onDelete(vod)} />
              </>
            ) : (
              <>
                <CircleButton label="Revert to Pending" icon="undo" disabled={actionLoading} onClick={() => review('pending')} />
                <CircleButton label="Delete" icon="trash" danger disabled={actionLoading} onClick={() => onDelete(vod)} />
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

      {expanded && (
        <tr className="block">
        <td
          colSpan={ROW_COLUMNS.length}
          id={detailsId}
          className={`grid gap-6 border-t border-border-token-table px-3 pb-3 pt-4 ${
            showReviewCard ? 'grid-cols-[240px_minmax(0,1fr)_320px]' : 'grid-cols-[240px_minmax(0,1fr)]'
          }`}
        >
          {/* Left: details */}
          <div className="flex flex-col gap-3.5">
            {thumbnailUrl && (
              <img
                src={thumbnailUrl}
                alt={vod.stream_title}
                className="h-[135px] w-[240px] rounded-radius-lg border border-border-token-glass object-cover shadow-[0_8px_32px_rgba(0,0,0,0.1)]"
              />
            )}
            <DetailField label="Video URL">
              <a
                href={vod.video_url}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all text-[13px] leading-normal text-accent-blue hover:text-accent-pink"
              >
                {vod.video_url}
              </a>
            </DetailField>
            <DetailField label="Stream Title" value={vod.stream_title} />
            <DetailField label="Stream Date">
              <p className={`text-[13px] leading-normal ${vod.stream_date ? 'text-token-primary' : 'font-medium text-amber-600'}`}>
                {vod.stream_date || 'No date provided'}
              </p>
            </DetailField>
            <DetailField label="Submitter Note" value={vod.submitter_note} />
            <DetailField label="Reviewer Note" value={vod.reviewer_note} />
            <DetailField label="Reviewed At" value={vod.reviewed_at ?? ''} />
          </div>

          {/* Middle: song timestamps */}
          <div className="flex min-w-0 flex-col gap-0.5">
            {songs.length > 0 ? (
              <>
                <div className="grid grid-cols-[24px_minmax(0,1fr)_64px_64px] border-b border-border-token-table px-2 pb-1.5">
                  <SectionLabel>#</SectionLabel>
                  <SectionLabel className="pl-2">Songs · {songs.length}</SectionLabel>
                  <SectionLabel className="text-right">Start</SectionLabel>
                  <SectionLabel className="text-right">End</SectionLabel>
                </div>
                {songs.map((song, i) => (
                  <div
                    key={song.id}
                    className="hover-row grid grid-cols-[24px_minmax(0,1fr)_64px_64px] items-center rounded-radius-sm px-2 py-1.5"
                  >
                    <span className="font-mono text-[11px] text-token-tertiary">{i + 1}</span>
                    <div className="min-w-0 pl-2">
                      <p className="truncate text-[13px] font-bold text-token-primary">{song.song_title}</p>
                      <p className="truncate text-[11px] text-token-secondary">{song.original_artist || '—'}</p>
                    </div>
                    <span className="text-right font-mono text-[11px] text-token-secondary">{formatTimestamp(song.start_timestamp)}</span>
                    <span className="text-right font-mono text-[11px] text-token-tertiary">
                      {song.end_timestamp !== null ? formatTimestamp(song.end_timestamp) : '—'}
                    </span>
                  </div>
                ))}
              </>
            ) : (
              <>
                <SectionLabel>Songs</SectionLabel>
                <p className="mt-1 text-xs text-token-tertiary">No song timestamps submitted.</p>
              </>
            )}
          </div>

          {/* Right: review actions */}
          {showReviewCard && (
            <GlassCard className="flex flex-col gap-2.5 self-start p-4">
              {vod.status === 'pending' ? (
                <div>
                  <label
                    htmlFor={rejectNoteId}
                    className="block text-[10px] font-bold uppercase tracking-[0.1em] text-token-tertiary"
                  >
                    Reviewer Note (optional, shown on reject)
                  </label>
                  <PrismTextarea
                    id={rejectNoteId}
                    value={rejectNote}
                    onChange={(e) => setRejectNote(e.target.value)}
                    placeholder="Reason for rejection..."
                    rows={3}
                    className="mt-2"
                  />
                </div>
              ) : (
                <SectionLabel>Review</SectionLabel>
              )}
              <div className="flex items-center gap-2">
                {vod.status === 'pending' ? (
                  <>
                    <GradientButton icon="check" disabled={actionLoading} onClick={() => review('approved')}>
                      Approve
                    </GradientButton>
                    <OutlineButton icon="x" tone="danger" disabled={actionLoading} onClick={() => review('rejected')}>
                      Reject
                    </OutlineButton>
                  </>
                ) : (
                  <OutlineButton icon="undo" disabled={actionLoading} onClick={() => review('pending')}>
                    Revert to Pending
                  </OutlineButton>
                )}
                <div className="flex-1" />
                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={() => onDelete(vod)}
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

function VodThumbnail({ src }: { src: string | null }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        onError={() => setFailed(true)}
        className="h-9 w-16 shrink-0 rounded-[6px] bg-surface-frosted object-cover shadow-[0_1px_4px_rgba(0,0,0,0.1)]"
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      className="flex h-9 w-16 shrink-0 items-center justify-center rounded-[6px] prism-gradient text-white shadow-[0_1px_4px_rgba(0,0,0,0.1)]"
    >
      <Icon name="film" size={16} />
    </div>
  );
}
