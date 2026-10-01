import { useId, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import type { AuthUser, NovaStatus, NovaVodSong, NovaVodSubmission } from '../../../shared/types';
import { sanitizeNovaUrl } from '../../../shared/nova-url-safety';
import { api } from '../api/client';
import { useInboxCounts } from '../components/shell/InboxCounts';
import { StatusFilterBar } from '../components/StatusFilterBar';
import { Avatar } from '../components/ui/Avatar';
import { Button, IconButton } from '../components/ui/Button';
import { useConfirm } from '../components/ui/confirm';
import { DetailField, SectionLabel } from '../components/ui/DetailField';
import { EmptyState, GlassCard, Skeleton } from '../components/ui/Display';
import { Select, Textarea } from '../components/ui/Fields';
import { INSET_FOCUS } from '../components/ui/focus-classes';
import { Icon, type IconName } from '../components/ui/Icon';
import { MICRO_LABEL } from '../components/ui/micro-label';
import { Note } from '../components/ui/Note';
import { PageHeader } from '../components/ui/PageHeader';
import { Pill, StatusPill } from '../components/ui/Pill';
import { statusTone } from '../components/ui/pill-core';
import { StoredTime } from '../components/ui/StoredTime';
import { useToast } from '../components/ui/toast';
import { Segmented } from '../components/ui/Toggles';
import { useRowDrafts, type RowDrafts } from '../hooks/useRowDrafts';
import { errorMessage, useApiResource } from '../lib/apiResource';
import { formatTimestamp } from '../lib/format-timestamp';
import { groupVodsByStreamer, type VodGroup, type VodViewMode } from '../lib/nova-vod-groups';
import { NO_RECENT_ACTIONS, visibleVods } from '../lib/review-lists';
import { countByStatus, removeById, replaceById } from '../lib/status-totals';
import { NOVA_STATUS_FILTERS } from './nova-status-filters';

const ROW_GRID = 'grid-cols-[64px_minmax(0,1fr)_100px_110px_120px_128px_28px]';

/** The seven columns of a row. The thumbnail, the actions and the chevron have no visible head, only a name for assistive technology. */
const ROW_COLUMNS: ReadonlyArray<{ key: string; label: string; visible: boolean }> = [
  { key: 'thumbnail', label: 'Thumbnail', visible: false },
  { key: 'vod', label: 'VOD', visible: true },
  { key: 'songs', label: 'Songs', visible: true },
  { key: 'status', label: 'Status', visible: true },
  { key: 'submitted', label: 'Submitted', visible: true },
  { key: 'actions', label: 'Actions', visible: false },
  { key: 'toggle', label: 'Details', visible: false },
];

const VIEW_OPTIONS: { value: VodViewMode; label: string; icon: IconName }[] = [
  { value: 'grouped', label: 'By VTuber', icon: 'users' },
  { value: 'timeline', label: 'Timeline', icon: 'clock' },
];

const STATUS_FILTER_LABEL_ID = 'nova-vod-status-filter-label';

/**
 * An open row's detail is as wide as the scroller shows and pinned to its left edge. The table is 820 px
 * wide at the least, so where the scroller is narrower (a phone, and 1024 to 1110 px beside the sidebar) a
 * detail as wide as the table would run past the visible edge, to be read by scrolling the summary rows
 * sideways with it. Where the scroller is as wide as the table the two are the same width.
 */
const DETAILS_PINNED = 'sticky left-0 w-[100cqw]';

/** What a VOD's request is out for: the status it is heading for, or its deletion. */
type VodAction = NovaStatus | 'delete';

/** An open VOD's songs: those the worker sent (maybe none), or that the request for them is out, or that it failed. */
type VodSongList = NovaVodSong[] | 'loading' | 'failed';

/** The VODs with a request out, each with what it is out for. */
const NO_ACTIONS: ReadonlyMap<string, VodAction> = new Map();

const STATUS_TOASTS: Record<NovaStatus, string> = {
  approved: 'VOD approved',
  rejected: 'VOD rejected',
  pending: 'VOD reverted to pending',
};

/** One action a curator can take on a VOD: how both its quick icon button and its review-card button read. */
interface ActionSpec {
  action: VodAction;
  label: string;
  icon: IconName;
  tone: 'default' | 'ok' | 'danger';
}

/** The row's actions, in order. A control keeps its place across a review (Delete) or is replaced by another (Approve by Revert). */
const PENDING_ACTIONS: readonly ActionSpec[] = [
  { action: 'approved', label: 'Approve', icon: 'check', tone: 'ok' },
  { action: 'rejected', label: 'Reject', icon: 'x', tone: 'default' },
  { action: 'delete', label: 'Delete', icon: 'trash', tone: 'danger' },
];
const REVIEWED_ACTIONS: readonly ActionSpec[] = [
  { action: 'pending', label: 'Revert to Pending', icon: 'undo', tone: 'default' },
  { action: 'delete', label: 'Delete', icon: 'trash', tone: 'danger' },
];

/** The VOD as a row names it for assistive technology, a toast and a confirm: its title, or its video id when it has none. */
function vodLabel(vod: NovaVodSubmission): string {
  return vod.stream_title || vod.video_id;
}

/** The header's count: how many VODs there are and from how many streamers, whatever the filters keep. */
function countText(total: number, streamers: number): string {
  return `${total} ${total === 1 ? 'VOD' : 'VODs'} · ${streamers} ${streamers === 1 ? 'VTuber' : 'VTubers'}`;
}

/** Every row's name button on show, in the order the page shows them: the control that opens the row. */
function nameButtonsIn(root: HTMLElement | null): HTMLElement[] {
  return root ? [...root.querySelectorAll<HTMLElement>('button[aria-controls^="nova-vod-details-"]')] : [];
}

function nameButtonOf(root: HTMLElement | null, id: string): HTMLElement | null {
  return nameButtonsIn(root).find((button) => button.getAttribute('aria-controls') === `nova-vod-details-${id}`) ?? null;
}

/** The name button of the row after the one for `id`, or null when it is the last. */
function nextNameButton(root: HTMLElement | null, id: string): HTMLElement | null {
  const names = nameButtonsIn(root);
  const index = names.findIndex((button) => button.getAttribute('aria-controls') === `nova-vod-details-${id}`);
  return index === -1 ? null : (names[index + 1] ?? null);
}

/** The header of the streamer card for `slug`: a card the curator has closed takes its rows' name buttons with it. */
function groupHeaderOf(root: HTMLElement | null, slug: string): HTMLElement | null {
  const headers = root ? [...root.querySelectorAll<HTMLElement>('button[aria-controls^="nova-vod-group-"]')] : [];
  return headers.find((header) => header.getAttribute('aria-controls') === `nova-vod-group-${slug}`) ?? null;
}

/** The chip of the toolbar's status group that is in effect: where a delete that leaves no row to go to hands the focus. */
function statusChipInEffect(toolbar: HTMLElement | null): HTMLElement | null {
  return toolbar?.querySelector<HTMLElement>(`[aria-labelledby="${STATUS_FILTER_LABEL_ID}"] [aria-pressed="true"]`) ?? null;
}

/** Where the focus goes once a landed request's answer is on screen, if nothing else has it by then. */
type Handoff = { kind: 'row'; id: string; slug: string } | { kind: 'next'; next: HTMLElement | null };

/**
 * The Nova VODs inbox (spec §8.9): the VODs fans submit from the public Nova form, by streamer or as one
 * timeline, with their status as chips and, for a curator, a quick approve, reject or delete on each row
 * and a review card in its detail. One unfiltered load feeds the rows, the header's counts and the streamer
 * filter; the filters only choose which rows are shown. A VOD just reviewed stays in its list, and its
 * streamer's card stays open around it, until a filter changes, so it does not vanish from the Pending list
 * under the cursor.
 *
 * Every request says how it went in a toast, and the control that sent it is busy meanwhile (and keeps the
 * focus; the row's other actions are unavailable, and other rows are untouched, so two can be out at once).
 * What a request that has landed did to the controls decides where the focus goes. A review replaces the
 * row's action controls (Approve by Revert), a delete removes the row: where the control that held the focus
 * is gone, the focus goes to the row's name button (to its streamer card's header when the curator has closed
 * the card under the request), or after a delete to the next row's name button, or to the status chip in
 * effect when there is no next row. It moves from nowhere (<body>), never from a control the
 * user has moved on to: another row's, a chip, a control the answer leaves in place.
 */
export default function NovaVodSubmissions({ user }: { user: AuthUser }) {
  const toast = useToast();
  const confirm = useConfirm();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const handoff = useRef<Handoff | null>(null);
  const [statusFilter, setStatusFilter] = useState<'' | NovaStatus>('pending');
  const [streamerFilter, setStreamerFilter] = useState('');
  const [justActed, setJustActed] = useState<ReadonlySet<string>>(NO_RECENT_ACTIONS);
  const [viewMode, setViewMode] = useState<VodViewMode>('grouped');
  const [groupOpen, setGroupOpen] = useState<Record<string, boolean>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Keyed by VOD id so a slow detail response for A can never render under B.
  const [expandedSongs, setExpandedSongs] = useState<Record<string, VodSongList>>({});
  const [acting, setActing] = useState(NO_ACTIONS);
  const streamerFilterId = useId();
  // Rejection notes outlive their rows, which unmount on group collapse, on the
  // view-mode toggle and on a filter change.
  const rejectNotes = useRowDrafts();
  // When the page opened: the times only need it to leave out the current year.
  const [today] = useState(() => new Date());

  // One unfiltered load feeds the table, the header's counts and the streamer options;
  // the two filters narrow it here instead of costing a second request.
  const list = useApiResource(async () => (await api.listNovaVods()).data, []);
  // The sidebar's pending badge loads this list separately: every change here reloads it too.
  const { refresh: refreshInboxCounts } = useInboxCounts();
  // Stable reference while loading, so the filter memo doesn't recompute every render.
  const allVods = useMemo(() => list.data ?? [], [list.data]);
  const vods = useMemo(
    () => visibleVods(allVods, { status: statusFilter, streamer: streamerFilter, justActed }),
    [allVods, statusFilter, streamerFilter, justActed],
  );

  // Runs after every commit: a handler cannot know which commit its state change will land in, and a flag
  // nobody has set costs nothing to read. Whoever holds the focus then is the user's, unless it is nobody:
  // the control that sent the request has just left the page with its row or been replaced by another.
  useLayoutEffect(() => {
    const pending = handoff.current;
    if (pending === null) return;
    handoff.current = null;
    const held = document.activeElement;
    if (held !== null && held !== document.body) return;
    const target =
      pending.kind === 'row'
        ? (nameButtonOf(listRef.current, pending.id) ?? groupHeaderOf(listRef.current, pending.slug))
        : pending.next?.isConnected
          ? pending.next
          : statusChipInEffect(toolbarRef.current);
    target?.focus();
  });

  // A streamer's card is open as the curator left it, else while it has a VOD to review or one just acted on:
  // reviewing its last pending VOD must not close the card around the row it has kept on screen.
  const isGroupOpen = (group: VodGroup, chosen: Record<string, boolean>) =>
    chosen[group.slug] ?? (group.pendingCount > 0 || group.vods.some((row) => justActed.has(row.id)));

  // A new filter is a new question: the rows held over from the last action go.
  const changeStatusFilter = (status: '' | NovaStatus) => {
    setStatusFilter(status);
    setJustActed(NO_RECENT_ACTIONS);
  };
  const changeStreamerFilter = (streamer: string) => {
    setStreamerFilter(streamer);
    setJustActed(NO_RECENT_ACTIONS);
  };
  const keepVisible = (id: string) => setJustActed((prev) => new Set(prev).add(id));

  /** Records what a VOD's request is out for, or (null) that it is done. Kept here, not in the row, which can unmount meanwhile. */
  const markActing = (id: string, action: VodAction | null) =>
    setActing((current) => {
      const next = new Map(current);
      if (action === null) next.delete(id);
      else next.set(id, action);
      return next;
    });

  // `again`: the Retry of songs that did not load, in a row that stays open.
  const handleExpand = async ({ id, streamer_slug: slug }: NovaVodSubmission, again = false) => {
    if (!again && expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    const known = expandedSongs[id];
    if (known !== undefined && known !== 'failed') return; // loaded, or a request is out
    // The Retry leaves with the line it sits on: the focus it held goes to the row's name button.
    if (again) handoff.current = { kind: 'row', id, slug };
    setExpandedSongs((prev) => ({ ...prev, [id]: 'loading' }));
    try {
      const detail = await api.getNovaVod(id);
      setExpandedSongs((prev) => ({ ...prev, [id]: detail.songs }));
    } catch (err) {
      // The songs column says they did not load and offers a Retry; opening the row again asks again too.
      setExpandedSongs((prev) => ({ ...prev, [id]: 'failed' }));
      toast.error('無法載入歌曲清單', { detail: errorMessage(err, '') });
    }
  };

  /** Resolves true once the row may clear the note it just submitted. */
  const handleAction = async (id: string, status: NovaStatus, rejectNote: string): Promise<boolean> => {
    markActing(id, status);
    try {
      const updated = await api.updateNovaVodStatus(id, {
        status,
        reviewer_note: status === 'rejected' ? rejectNote : undefined,
      });
      // Before the state changes that will show it: the effect above reads the flag in the commit they land in.
      handoff.current = { kind: 'row', id, slug: updated.streamer_slug };
      list.mutate((rows) => replaceById(rows, updated));
      refreshInboxCounts('vods');
      keepVisible(id);
      rejectNotes.clear(id);
      toast.success(STATUS_TOASTS[status], vodLabel(updated));
      return true;
    } catch (err) {
      toast.error(errorMessage(err, 'Action failed'));
      return false;
    } finally {
      markActing(id, null);
    }
  };

  const handleDelete = async (vod: NovaVodSubmission) => {
    const confirmed = await confirm({
      title: 'Delete this VOD submission?',
      body: `Permanently delete VOD submission "${vod.id}" (${vodLabel(vod)}). This cannot be undone.`,
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!confirmed) return;
    markActing(vod.id, 'delete');
    try {
      await api.deleteNovaVod(vod.id);
      // The next row is read while this one is still on screen: its button is the same element after the commit.
      handoff.current = { kind: 'next', next: nextNameButton(listRef.current, vod.id) };
      list.mutate((rows) => removeById(rows, vod.id));
      refreshInboxCounts('vods');
      rejectNotes.clear(vod.id);
      toast.success('VOD deleted', vodLabel(vod));
    } catch (err) {
      toast.error(errorMessage(err, 'Delete failed'));
    } finally {
      markActing(vod.id, null);
    }
  };

  const handleRetry = (event: MouseEvent<HTMLButtonElement>) => {
    // The alert leaves as soon as the load restarts, and the Retry that held the focus with it: the
    // page heading takes it, rather than <body>.
    if (document.activeElement === event.currentTarget) headingRef.current?.focus();
    list.reload();
  };

  const isCurator = user.role === 'curator';

  // Collect unique streamers for filter dropdown
  const uniqueStreamers = [...new Set(allVods.map((v) => v.streamer_slug))].sort();
  const groups = groupVodsByStreamer(vods);
  const countOf = (status: NovaStatus) => countByStatus(allVods, status);

  // The skeleton is for the first load only: a later one keeps the rows, so the control that started it keeps its place.
  const showSkeleton = list.data === null && list.loading;
  const showEmpty = list.data !== null && vods.length === 0;

  const renderRow = (row: NovaVodSubmission) => (
    <VodRow
      key={row.id}
      vod={row}
      isCurator={isCurator}
      expanded={expandedId === row.id}
      showStreamer={viewMode === 'timeline'}
      songs={expandedId === row.id ? (expandedSongs[row.id] ?? 'loading') : []}
      acting={acting.get(row.id)}
      today={today}
      onToggle={() => handleExpand(row)}
      onRetrySongs={() => handleExpand(row, true)}
      drafts={rejectNotes}
      onAction={handleAction}
      onDelete={handleDelete}
    />
  );

  return (
    // No blur, transform or filter on this root or its wrappers, and no overflow either: the sticky
    // header tracks <main>.
    <div className="flex flex-col">
      <PageHeader
        crumb="INBOX"
        title="Nova VODs"
        titleRef={headingRef}
        meta={
          list.data === null ? undefined : (
            <>
              <span>{countText(allVods.length, uniqueStreamers.length)}</span>
              <Pill tone={statusTone('pending')}>{countOf('pending')} Pending</Pill>
              <Pill tone={statusTone('approved')}>{countOf('approved')} Approved</Pill>
              <Pill tone={statusTone('rejected')}>{countOf('rejected')} Rejected</Pill>
            </>
          )
        }
      />

      <div className="flex flex-col gap-3 p-4 lg:px-5 lg:pb-[18px]">
        <div ref={toolbarRef} className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <StatusFilterBar
            options={NOVA_STATUS_FILTERS}
            value={statusFilter}
            onChange={changeStatusFilter}
            labelledBy={STATUS_FILTER_LABEL_ID}
            className="flex-wrap gap-2"
            heading={
              <span id={STATUS_FILTER_LABEL_ID} className={MICRO_LABEL}>
                Status
              </span>
            }
          />
          <Segmented label="View" value={viewMode} onChange={setViewMode} options={VIEW_OPTIONS} />
          <div className="w-44">
            <label htmlFor={streamerFilterId} className="sr-only">
              Filter VOD submissions by streamer
            </label>
            <Select
              id={streamerFilterId}
              value={streamerFilter}
              onChange={(event) => changeStreamerFilter(event.target.value)}
            >
              <option value="">All streamers</option>
              {uniqueStreamers.map((slug) => (
                <option key={slug} value={slug}>
                  {slug}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {list.error !== null ? (
          <Note tone="danger" icon="alert" role="alert" title="Couldn't load VODs.">
            <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
              <span>{list.error}</span>
              <Button size="sm" icon="refresh" onClick={handleRetry}>
                Retry
              </Button>
            </span>
          </Note>
        ) : null}

        {showSkeleton ? (
          <GlassCard>
            <Skeleton rows={6} label="Loading VODs…" />
          </GlassCard>
        ) : null}

        {showEmpty ? (
          <GlassCard>
            <EmptyState icon="inbox" title="No VOD submissions found." />
          </GlassCard>
        ) : null}

        {vods.length > 0 ? (
          <div ref={listRef} className="flex flex-col gap-2.5">
            {viewMode === 'grouped' ? (
              groups.map((group) => (
                <VodGroupCard
                  key={group.slug}
                  group={group}
                  open={isGroupOpen(group, groupOpen)}
                  onToggle={() => setGroupOpen((prev) => ({ ...prev, [group.slug]: !isGroupOpen(group, prev) }))}
                >
                  {group.vods.map(renderRow)}
                </VodGroupCard>
              ))
            ) : (
              <GlassCard padding="sm" className="overflow-clip">
                <VodTable label="VOD submissions">{vods.map(renderRow)}</VodTable>
              </GlassCard>
            )}
          </div>
        ) : null}
      </div>
    </div>
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
    <GlassCard padding="none" className="overflow-clip">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={onToggle}
        className={`flex w-full items-center gap-4 px-5 py-3.5 text-left transition-colors hover:bg-row-hover ${INSET_FOCUS}`}
      >
        <Avatar src={null} alt="" size={48} />
        <span className="min-w-0 flex-1 truncate text-[15px] font-bold leading-tight text-fg">{group.slug}</span>
        <span className="flex shrink-0 items-center gap-2">
          <Pill tone="neutral">{group.vods.length === 1 ? '1 VOD' : `${group.vods.length} VODs`}</Pill>
          {group.pendingCount > 0 ? (
            <Pill tone="warn">{group.pendingCount} pending</Pill>
          ) : (
            <Pill tone="ok">All reviewed</Pill>
          )}
        </span>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={20} className="shrink-0 text-fg-subtle" />
      </button>
      {open ? (
        <div id={bodyId} className="border-t border-line-soft px-3 pb-3 pt-1">
          <VodTable label={`VOD submissions for ${group.slug}`}>{children}</VodTable>
        </div>
      ) : null}
    </GlassCard>
  );
}

/**
 * The rows' table: one `<tbody>` a row under a head row of the kit's head label. It keeps its width and
 * scrolls inside its card. The head is a grid like the rows, so its columns line up with theirs. The
 * scroller is a size container, so that an open row's detail can be as wide as what the scroller shows
 * (`cqw`) while the table is wider: see `DETAILS_PINNED`.
 */
function VodTable({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="overflow-x-auto [container-type:inline-size]">
      <table aria-label={label} className="block min-w-[820px]">
        <thead className="block">
          <tr className={`${ROW_GRID} grid items-center border-b border-line-soft px-3 py-2`}>
            {ROW_COLUMNS.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={column.visible ? `p-0 pl-3 text-left ${MICRO_LABEL}` : 'p-0 text-left'}
              >
                {column.visible ? column.label : <span className="sr-only">{column.label}</span>}
              </th>
            ))}
          </tr>
        </thead>
        {children}
      </table>
    </div>
  );
}

interface VodRowProps {
  vod: NovaVodSubmission;
  isCurator: boolean;
  expanded: boolean;
  /** Timeline mode: rows are not under a streamer card, so carry the slug inline. */
  showStreamer?: boolean;
  songs: VodSongList;
  /** What this VOD's request is out for, if one is. */
  acting: VodAction | undefined;
  /** When the page opened: the times only need it to leave out the current year. */
  today: Date;
  onToggle: () => void;
  /** Asks for songs that did not load, again. */
  onRetrySongs: () => void;
  /** The page's note store: this row seeds from it and writes back to it. */
  drafts: RowDrafts;
  /** Resolves true when the review landed, so the row may drop its note. */
  onAction: (id: string, status: NovaStatus, rejectNote: string) => Promise<boolean>;
  onDelete: (vod: NovaVodSubmission) => void;
}

/**
 * One VOD: its summary row and, while open, its detail. The reviewer note is local (typing re-renders this
 * VOD, not the inbox) and is seeded from, and written through to, the page's store, so it survives the row
 * unmounting. The request a button sends is the page's, not the row's: `acting` says what is out for this
 * VOD, and the buttons follow it however often the row opens and closes.
 */
export function VodRow({
  vod,
  isCurator,
  expanded,
  showStreamer = false,
  songs,
  acting,
  today,
  onToggle,
  onRetrySongs,
  drafts,
  onAction,
  onDelete,
}: VodRowProps) {
  const [rejectNote, setRejectNote] = useState(() => drafts.read(vod.id));
  const detailsId = `nova-vod-details-${vod.id}`;
  // Submitter-supplied: only YouTube's image CDNs may load in the curator's browser.
  const thumbnailUrl = sanitizeNovaUrl(vod.thumbnail_url, 'thumbnail');
  const label = vodLabel(vod);

  // One press: a review sends the status (and the note a rejection carries), a delete asks first.
  const press = async (action: VodAction) => {
    if (action === 'delete') onDelete(vod);
    else if (await onAction(vod.id, action, rejectNote)) setRejectNote('');
  };

  return (
    <tbody className={`mt-0.5 block rounded-radius-lg ${expanded ? 'bg-selected' : ''}`}>
      {/* The title is the accessible toggle control; the chevron is a mouse-only duplicate of it. */}
      <tr className={`${ROW_GRID} grid items-center rounded-radius-lg px-3 py-2 transition-colors hover:bg-row-hover`}>
        <td className="flex items-center p-0">
          <VodThumbnail src={thumbnailUrl} />
        </td>
        <td className="flex min-w-0 flex-col gap-0.5 p-0 pl-3">
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={detailsId}
            aria-label={`${expanded ? '收合' : '展開'} ${label}`}
            onClick={onToggle}
            className={`max-w-full truncate rounded-radius-sm text-left text-[15px] font-bold leading-tight focus-visible:outline-none focus-visible:shadow-focus ${
              expanded ? 'text-accent-fg' : 'text-fg'
            }`}
          >
            {vod.stream_title || '—'}
          </button>
          <span className="flex items-center gap-1.5 text-[11px]">
            {showStreamer && (
              <>
                <span className="font-mono font-semibold text-fg-muted">{vod.streamer_slug}</span>
                <span className="text-fg-subtle">·</span>
              </>
            )}
            <a
              href={vod.video_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-radius-xs font-mono text-fg-muted transition-colors hover:text-accent-fg focus-visible:outline-none focus-visible:shadow-focus"
            >
              {vod.video_id}
              <Icon name="external" size={11} className="text-fg-subtle" />
            </a>
            <span className="text-fg-subtle">·</span>
            <span className={vod.stream_date ? 'font-mono text-fg-muted' : 'font-medium text-tone-warn-fg'}>
              {vod.stream_date || 'No date'}
            </span>
          </span>
        </td>
        <td className="p-0 pl-3">
          {expanded && Array.isArray(songs) && songs.length > 0 ? (
            <Pill tone="neutral">{songs.length} songs</Pill>
          ) : (
            <span className="text-token-base text-fg-subtle">—</span>
          )}
        </td>
        <td className="p-0 pl-3">
          <StatusPill status={vod.status} />
        </td>
        <td className="p-0 pl-3">
          <StoredTime value={vod.submitted_at} today={today} className="font-mono text-[11px] text-fg-muted" />
        </td>
        <td className="flex items-center justify-end gap-1.5 p-0">
          {isCurator && !expanded
            ? (vod.status === 'pending' ? PENDING_ACTIONS : REVIEWED_ACTIONS).map((spec) => (
                <QuickAction key={spec.action} spec={spec} acting={acting} onPress={press} />
              ))
            : null}
        </td>
        <td className="flex justify-end p-0">
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            onClick={onToggle}
            className="flex justify-end text-fg-subtle transition-colors hover:text-accent-fg"
          >
            <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={20} />
          </button>
        </td>
      </tr>

      {/* One column below 1024 px; from there the fields and the songs, with a curator's review card across both
          below them until 1280 px, where it becomes the third column. */}
      {expanded && (
        <tr className="block">
          <td
            colSpan={ROW_COLUMNS.length}
            id={detailsId}
            className={`grid grid-cols-1 gap-6 border-t border-line-soft px-3 pb-3 pt-4 ${DETAILS_PINNED} lg:grid-cols-[240px_minmax(0,1fr)]${
              isCurator ? ' xl:grid-cols-[240px_minmax(0,1fr)_320px]' : ''
            }`}
          >
            <VodFacts vod={vod} thumbnailUrl={thumbnailUrl} today={today} />
            <VodSongs songs={songs} onRetry={onRetrySongs} />
            {isCurator && (
              <VodReviewCard
                vod={vod}
                acting={acting}
                rejectNote={rejectNote}
                onNoteChange={(value) => {
                  drafts.write(vod.id, value);
                  setRejectNote(value);
                }}
                onPress={press}
              />
            )}
          </td>
        </tr>
      )}
    </tbody>
  );
}

/**
 * A row's quick action: an icon button named for what it does. The one that sent the request is busy (and
 * keeps the focus); the row's others are `aria-disabled` while it is out, so none takes a press.
 */
function QuickAction({
  spec,
  acting,
  onPress,
}: {
  spec: ActionSpec;
  acting: VodAction | undefined;
  onPress: (action: VodAction) => void;
}) {
  return (
    <IconButton
      label={spec.label}
      icon={spec.icon}
      tone={spec.tone}
      size="sm"
      busy={acting === spec.action}
      aria-disabled={acting !== undefined && acting !== spec.action ? true : undefined}
      onClick={() => onPress(spec.action)}
    />
  );
}

/** The left column of a VOD's detail: its thumbnail and what was submitted with it. */
function VodFacts({
  vod,
  thumbnailUrl,
  today,
}: {
  vod: NovaVodSubmission;
  thumbnailUrl: string | null;
  today: Date;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3.5">
      {thumbnailUrl && (
        <img
          src={thumbnailUrl}
          alt={vod.stream_title}
          className="h-[135px] w-[240px] max-w-full rounded-radius-lg border border-field-line bg-track object-cover shadow-card"
        />
      )}
      <dl className="flex flex-col gap-3.5">
        <DetailField label="Video URL">
          <a
            href={vod.video_url}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-accent-fg hover:underline"
          >
            {vod.video_url}
          </a>
        </DetailField>
        <DetailField label="Stream Title">{vod.stream_title || '—'}</DetailField>
        <DetailField label="Stream Date">
          {vod.stream_date || <span className="font-medium text-tone-warn-fg">No date provided</span>}
        </DetailField>
        <DetailField label="Submitter Note">
          <span className="whitespace-pre-line">{vod.submitter_note || '—'}</span>
        </DetailField>
        <DetailField label="Reviewer Note">
          <span className="whitespace-pre-line">{vod.reviewer_note || '—'}</span>
        </DetailField>
        <DetailField label="Reviewed At">
          {vod.reviewed_at ? <StoredTime value={vod.reviewed_at} today={today} /> : '—'}
        </DetailField>
      </dl>
    </div>
  );
}

/**
 * The middle column of a VOD's detail: the song timestamps that came with it. Until they come it says they are
 * loading, and if their request failed it says so beside a Retry: only songs that loaded and are none read "No
 * song timestamps submitted."
 */
function VodSongs({ songs, onRetry }: { songs: VodSongList; onRetry: () => void }) {
  if (songs === 'loading' || songs === 'failed' || songs.length === 0) {
    return (
      <div className="flex min-w-0 flex-col gap-1">
        <SectionLabel>Songs</SectionLabel>
        {songs === 'failed' ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs text-tone-danger-fg">Couldn&apos;t load the songs.</p>
            <Button size="sm" icon="refresh" onClick={onRetry}>
              Retry
            </Button>
          </div>
        ) : (
          <p className="text-xs text-fg-subtle">{songs === 'loading' ? 'Loading songs…' : 'No song timestamps submitted.'}</p>
        )}
      </div>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <div className="grid grid-cols-[24px_minmax(0,1fr)_64px_64px] border-b border-line-soft px-2 pb-1.5">
        <span className={MICRO_LABEL}>#</span>
        <span className={`${MICRO_LABEL} pl-2`}>Songs · {songs.length}</span>
        <span className={`${MICRO_LABEL} text-right`}>Start</span>
        <span className={`${MICRO_LABEL} text-right`}>End</span>
      </div>
      {songs.map((song, i) => (
        <div
          key={song.id}
          className="grid grid-cols-[24px_minmax(0,1fr)_64px_64px] items-center rounded-radius-sm px-2 py-1.5 transition-colors hover:bg-row-hover"
        >
          <span className="font-mono text-[11px] text-fg-subtle">{i + 1}</span>
          <div className="min-w-0 pl-2">
            <p className="truncate text-token-base font-bold text-fg">{song.song_title}</p>
            <p className="truncate text-[11px] text-fg-muted">{song.original_artist || '—'}</p>
          </div>
          <span className="text-right font-mono text-[11px] text-fg-muted">{formatTimestamp(song.start_timestamp)}</span>
          <span className="text-right font-mono text-[11px] text-fg-subtle">
            {song.end_timestamp !== null ? formatTimestamp(song.end_timestamp) : '—'}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * The right column of a curator's detail: the reviewer note (of a VOD still pending) and the review buttons.
 * The button that sent a request is busy and keeps the focus; the others are unavailable beside it.
 */
function VodReviewCard({
  vod,
  acting,
  rejectNote,
  onNoteChange,
  onPress,
}: {
  vod: NovaVodSubmission;
  acting: VodAction | undefined;
  rejectNote: string;
  onNoteChange: (value: string) => void;
  onPress: (action: VodAction) => void;
}) {
  const rejectNoteId = useId();
  const pending = vod.status === 'pending';
  return (
    <GlassCard className="flex flex-col gap-2.5 self-start lg:col-span-2 xl:col-span-1">
      {pending ? (
        <div className="flex flex-col gap-2">
          <label htmlFor={rejectNoteId} className={MICRO_LABEL}>
            Reviewer Note (optional, shown on reject)
          </label>
          <Textarea
            id={rejectNoteId}
            value={rejectNote}
            onChange={(event) => onNoteChange(event.target.value)}
            placeholder="Reason for rejection..."
            rows={3}
            className="block resize-y"
          />
        </div>
      ) : (
        <SectionLabel>Review</SectionLabel>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {(pending ? PENDING_ACTIONS : REVIEWED_ACTIONS).map((spec) => (
          <Button
            key={spec.action}
            variant={spec.action === 'approved' ? 'primary' : spec.action === 'delete' ? 'ghost' : 'secondary'}
            size="sm"
            icon={spec.icon}
            busy={acting === spec.action}
            aria-disabled={acting !== undefined && acting !== spec.action ? true : undefined}
            className={spec.action === 'delete' ? 'ml-auto' : undefined}
            onClick={() => onPress(spec.action)}
          >
            {spec.label}
          </Button>
        ))}
      </div>
    </GlassCard>
  );
}

function VodThumbnail({ src }: { src: string | null }) {
  // The src that failed, not a flag: a new src is tried afresh.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (src && src !== failedSrc) {
    return (
      <img
        src={src}
        alt=""
        onError={() => setFailedSrc(src)}
        className="h-9 w-16 shrink-0 rounded-radius-xs border border-line-soft bg-track object-cover"
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      className="flex h-9 w-16 shrink-0 items-center justify-center rounded-radius-xs bg-accent text-white"
    >
      <Icon name="film" size={16} />
    </div>
  );
}
