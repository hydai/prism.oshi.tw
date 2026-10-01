import { memo, useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import type { AuthUser, StampPerformance, Status, Stream } from '../../../shared/types';
import { api } from '../api/client';
import type { YouTubePlayerHandle } from '../components/YouTubePlayer';
import type { FetchLogEntry } from '../components/FetchLogPanel';
import { FloatingPlaybackPill } from '../components/FloatingPlaybackPill';
import { InlineEdit } from '../components/stamp/InlineEdit';
import { AddSongModal } from '../components/stamp/AddSongModal';
import { PasteImportModal } from '../components/stamp/PasteImportModal';
import { Button, IconButton } from '../components/ui/Button';
import { buttonClasses } from '../components/ui/button-classes';
import { useConfirm } from '../components/ui/confirm';
import { EmptyState, GlassCard, Skeleton } from '../components/ui/Display';
import { TextInput } from '../components/ui/Fields';
import { Icon } from '../components/ui/Icon';
import { isImeKeyDown } from '../components/ui/keyboard';
import { PageHeader } from '../components/ui/PageHeader';
import { Pill, StatusPill } from '../components/ui/Pill';
import { Menu, Popover, type MenuItem } from '../components/ui/Popover';
import { useShowToast } from '../components/ui/toast';
import { Tooltip } from '../components/ui/Tooltip';
import { ShortcutSheet } from '../components/workbench/ShortcutHints';
import { WorkbenchCard } from '../components/workbench/WorkbenchCard';
import type { ShowToast } from '../hooks/useToast';
import { useFetchLog } from '../hooks/useFetchLog';
import type { AppendFetchLog } from '../hooks/useFetchLog';
import { END_PREVIEW_SECONDS, useEditorShortcuts } from '../hooks/useEditorShortcuts';
import { useFetchAllDurations } from '../hooks/useFetchAllDurations';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { usePerformances } from '../hooks/usePerformances';
import { usePlayerClock } from '../hooks/usePlayerClock';
import { useSearchParamState } from '../hooks/useSearchParamState';
import { useApiResource } from '../lib/apiResource';
import { formatTimestamp } from '../lib/format-timestamp';
import { performanceReviewMark, performanceStatusAction, streamStatusActions } from './stream-detail-actions';

// --- Inline Date Edit ---

/**
 * The stream date's editor, in the header's meta row: the kit's text field as a native date input.
 * Enter or blur saves a changed date (an unchanged or cleared one cancels), Escape cancels — and
 * neither key counts while an IME is composing. The field spans its container, so a span gives it
 * a date's width: a percentage-wide input adds nothing to the meta row's own width, which would
 * then wrap around it.
 */
function InlineDateEdit({ value, label, onSave, onCancel }: {
  value: string; label: string;
  onSave: (val: string) => void; onCancel: () => void;
}) {
  const [date, setDate] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const commit = () => {
    if (date && date !== value) onSave(date);
    else onCancel();
  };

  return (
    <span className="inline-flex w-[10rem] shrink-0">
      <TextInput
        ref={inputRef} type="date" aria-label={label} value={date}
        onChange={(e) => setDate(e.target.value)}
        onKeyDown={(e) => {
          if (isImeKeyDown(e)) return;
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        }}
        onBlur={commit}
      />
    </span>
  );
}

// --- Main component ---

type EditingField =
  | { type: 'perf'; perfId: string; field: 'title' | 'artist' | 'note' }
  | { type: 'stream'; field: 'title' | 'date' };

/** The one variant PerformanceTable's rows ever read — see the memo boundary below. */
type PerfEditingField = Extract<EditingField, { type: 'perf' }>;

/**
 * What the shell at the bottom of this file owns and hands to the per-stream component below it:
 * everything that has to outlive a move from one stream to the next. Everything else — the row
 * selection, the modals, the field being edited, the stream's own detail — belongs to one stream
 * and is born and buried with the keyed component that holds it.
 */
interface StreamPageProps {
  user: AuthUser;
  streamId: string;
  prevStream: Stream | null;
  nextStream: Stream | null;
  showToast: ShowToast;
  fetchLog: FetchLogEntry[];
  appendFetchLog: AppendFetchLog;
  clearFetchLog: () => void;
}

function useStreamDetailController({
  user,
  streamId,
  prevStream,
  nextStream,
  showToast,
  fetchLog,
  appendFetchLog,
  clearFetchLog,
}: StreamPageProps) {
  // Deep-link target: the page opens on it and never writes it back.
  const [requestedPerformanceId] = useSearchParamState('performance', '');
  const navigate = useNavigate();
  const [editingField, setEditingField] = useState<EditingField | null>(null);
  const [showPasteImport, setShowPasteImport] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // The row the curator picked, once they have picked one; `null` until then. See `selectedIndex`.
  const [userSelectedIndex, setUserSelectedIndex] = useState<number | null>(null);
  const playerRef = useRef<YouTubePlayerHandle>(null);
  const playerBoxRef = useRef<HTMLDivElement>(null);
  // The playback clock lives in an external store: only the pill and the readout hear its ticks.
  usePlayerClock(playerRef);
  const confirm = useConfirm();
  // Below 640px the header's actions fold into its ⋯ menu (spec §9).
  const isNarrow = useMediaQuery('(max-width: 639px)');
  const pageRef = useRef<HTMLDivElement>(null);

  const isCurator = user.role === 'curator';

  // This stream's detail: fetched on mount, re-fetched by `reloadDetail()`, patched in place by
  // `mutateDetail`. The component is keyed by the stream id, so `[streamId]` never moves under it.
  const {
    data: detail,
    loading,
    error,
    reload: reloadDetail,
    mutate: mutateDetail,
  } = useApiResource(() => api.getStreamDetail(streamId), [streamId]);

  // --- The sticky header's height, for the sticky workbench column below it ---
  //
  // No fixed offset would do: a long title or a narrow window wraps the header onto two or three
  // rows. So the page root keeps `--stream-header-h` at the header's height — measured once the root
  // is on screen (it renders once the detail has loaded), then on every resize of the header.
  // Without ResizeObserver the column falls back to the header's 76px minimum.
  const pageShown = detail !== null;
  useLayoutEffect(() => {
    const page = pageRef.current;
    const header = page?.firstElementChild;
    if (!page || !header || typeof ResizeObserver === 'undefined') return undefined;
    const publish = () => {
      page.style.setProperty('--stream-header-h', `${Math.ceil(header.getBoundingClientRect().height)}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(header);
    return () => observer.disconnect();
  }, [pageShown]);

  // --- The selected row, derived ---
  //
  // A freshly opened stream starts on the deep-linked row, or on its first row; from the moment the
  // curator picks a row, their pick is the answer. Nothing writes the selection after a fetch: the
  // rows and the pick together already say which row is selected, so a reload can no longer snap
  // the selection back to the deep-linked row over a later choice.
  const selectedIndex = useMemo(() => {
    const performances = detail?.performances;
    if (!performances || performances.length === 0) return -1;
    // A pick that outlived the row it named (a delete, a re-import) is clamped, not lost.
    if (userSelectedIndex !== null) return Math.max(0, Math.min(userSelectedIndex, performances.length - 1));
    if (requestedPerformanceId) {
      const requestedIndex = performances.findIndex((performance) => performance.id === requestedPerformanceId);
      if (requestedIndex >= 0) return requestedIndex;
    }
    return 0;
  }, [detail, requestedPerformanceId, userSelectedIndex]);

  // The table and `usePerformances` drive the selection through a plain setState signature, but the
  // state behind it holds only an explicit pick — so an updater is resolved against the index on
  // screen right now (`selectNext`/`selectPrev` step from what the curator can see).
  const setSelectedIndex = useCallback<Dispatch<SetStateAction<number>>>((action) => {
    setUserSelectedIndex(typeof action === 'function' ? action(selectedIndex) : action);
  }, [selectedIndex]);

  useEffect(() => {
    if (!detail || !requestedPerformanceId) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`performance-row-${requestedPerformanceId}`)?.scrollIntoView({
        block: 'center',
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [detail, requestedPerformanceId]);

  // --- Optimistic update helpers ---
  const patchRow = useCallback((id: string, updates: Partial<StampPerformance>) => {
    mutateDetail(prev => ({
      ...prev,
      performances: prev.performances.map((p) => p.id === id ? { ...p, ...updates } : p),
    }));
  }, [mutateDetail]);

  const patchAllRows = useCallback((updates: Partial<StampPerformance>) => {
    mutateDetail(prev => ({
      ...prev,
      performances: prev.performances.map(p => ({ ...p, ...updates })),
    }));
  }, [mutateDetail]);

  const closeAddModal = useCallback(() => setShowAddModal(false), []);

  // `usePerformances` awaits the reload it is handed — both editors report only once their rows are
  // back. A `useApiResource` reload is a request, not a round trip: the fetch it schedules runs in
  // an effect, so there is nothing left here to await.
  const reload = useCallback(async () => { reloadDetail(); }, [reloadDetail]);

  /** Timeline clicks: the player as it is when the click lands, not as it was at render. */
  const seekTo = useCallback((seconds: number) => {
    playerRef.current?.seekTo(seconds);
  }, []);

  const {
    markEndTimestamp,
    markStartTimestamp,
    seekToStart,
    seekToEnd,
    selectNext,
    selectPrev,
    clearEndTimestamp,
    clearAllEndTimestamps,
    addSong,
    saveEndTimestamp,
    exportSongList,
  } = usePerformances({
    streamId,
    performances: detail ? detail.performances : null,
    selectedIndex,
    setSelectedIndex,
    playerRef,
    showToast,
    patchRow,
    patchAllRows,
    reload,
    onSongCreated: closeAddModal,
    confirm,
  });

  // --- Status action ---
  const handleStreamStatus = useCallback(async (status: Status) => {
    if (!detail) return;
    try {
      await api.updateStreamStatus(streamId, { status });
      // Approving a stream cascades to its songs/performances, matching the Streams
      // list page's Approve button so "approve a stream" never silently leaves its
      // songs pending. The standalone "Approve All" button stays for re-approving
      // songs added after the stream was already approved.
      if (status === 'approved') {
        const result = await api.approveAllForStream(streamId);
        reloadDetail();
        showToast(`Stream approved · ${result.songs} song(s), ${result.performances} performance(s)`);
      } else {
        mutateDetail((prev) => ({ ...prev, status }));
        showToast(`Stream ${status}`);
      }
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to update status', true);
    }
  }, [streamId, detail, reloadDetail, mutateDetail, showToast]);

  // --- Stream metadata inline edit save ---
  const handleStreamSave = useCallback(async (field: 'title' | 'date', value: string) => {
    setEditingField(null);
    try {
      await api.updateStream(streamId, { [field]: value });
      reloadDetail();
      showToast(`Updated stream ${field}`);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to update', true);
    }
  }, [streamId, reloadDetail, showToast]);

  // --- Inline edit save ---
  const handleSave = useCallback(async (perfId: string, field: 'title' | 'artist' | 'note', value: string) => {
    setEditingField(null);
    try {
      if (field === 'note') {
        await api.updatePerformanceNote(perfId, value);
      } else {
        const body = field === 'title' ? { title: value } : { originalArtist: value };
        await api.updatePerformanceDetails(perfId, body);
      }
      reloadDetail();
      showToast(`Updated ${field}`);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to update', true);
    }
  }, [reloadDetail, showToast]);

  // --- Delete performance ---
  const handleDelete = useCallback(async (perf: StampPerformance) => {
    const index = detail ? detail.performances.findIndex((p) => p.id === perf.id) : -1;
    const confirmed = await confirm({
      title: `Delete #${index + 1} ${perf.title}?`,
      body: 'The performance is removed from this stream. This can’t be undone.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!confirmed) return;
    try {
      await api.deletePerformance(perf.id);
      reloadDetail();
      showToast(`Deleted ${perf.title}`);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to delete', true);
    }
  }, [detail, confirm, reloadDetail, showToast]);

  // --- Performance status ---
  const handlePerformanceStatus = useCallback(async (perfId: string, status: Status) => {
    try {
      await api.updatePerformanceStatus(perfId, status);
      reloadDetail();
      showToast(`Performance ${status}`);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to update status', true);
    }
  }, [reloadDetail, showToast]);

  // --- Bulk approve all ---
  const handleApproveAll = useCallback(async () => {
    if (!detail) return;
    // Only pending performances: bulkApproveStream (admin/src/db.ts) never touches extracted,
    // rejected or excluded rows, so the confirm must name the narrower count it actually acts on.
    const pendingCount = detail.performances.filter((p) => p.status === 'pending').length;
    const confirmed = await confirm({
      title: `Approve all ${pendingCount} pending performances?`,
      confirmLabel: 'Approve all',
    });
    if (!confirmed) return;
    try {
      const result = await api.approveAllForStream(streamId);
      reloadDetail();
      showToast(`Approved ${result.songs} songs, ${result.performances} performances`);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to approve all', true);
    }
  }, [streamId, detail, confirm, reloadDetail, showToast]);

  // --- Bulk unapprove all ---
  const handleUnapproveAll = useCallback(async () => {
    if (!detail) return;
    const approvedCount = detail.performances.filter((p) => p.status === 'approved').length;
    const confirmed = await confirm({
      title: `Unapprove all ${approvedCount} approved performances?`,
      confirmLabel: 'Unapprove all',
    });
    if (!confirmed) return;
    try {
      const result = await api.unapproveAllForStream(streamId);
      reloadDetail();
      showToast(`Unapproved ${result.songs} songs, ${result.performances} performances`);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to unapprove all', true);
    }
  }, [streamId, detail, confirm, reloadDetail, showToast]);

  // --- Hard-delete stream (blocked server-side for approved streams) ---
  const handleDeleteStream = useCallback(async () => {
    if (!detail) return;
    const perfCount = detail.performances.length;
    const confirmed = await confirm({
      title: `Delete stream "${detail.title}"?`,
      body: `Its ${perfCount} performances and their orphaned songs are deleted too. This cannot be undone.`,
      confirmLabel: 'Delete stream',
      tone: 'danger',
    });
    if (!confirmed) return;
    try {
      const result = await api.deleteStream(streamId);
      showToast(`Deleted stream (${result.songs} songs, ${result.performances} performances)`);
      navigate('/streams');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to delete stream', true);
    }
  }, [streamId, detail, confirm, navigate, showToast]);

  // --- Paste import done ---
  const handlePasteImportDone = useCallback(async (result: { created: number; replaced: boolean }) => {
    setShowPasteImport(false);
    reloadDetail();
    showToast(`Imported ${result.created} songs${result.replaced ? ' (replaced)' : ''}`);
  }, [reloadDetail, showToast]);

  // --- Copy full VOD URL ---
  const copyVodUrl = useCallback(() => {
    if (!detail) return;
    const url = `https://www.youtube.com/watch?v=${detail.videoId}`;
    navigator.clipboard.writeText(url).then(
      () => showToast(`Copied ${url}`),
      () => showToast('Failed to copy', true),
    );
  }, [detail, showToast]);

  // --- iTunes duration lookup ---
  const { fetchDuration, fetchAllDurations } = useFetchAllDurations({
    performances: detail ? detail.performances : null,
    selectedIndex,
    showToast,
    appendFetchLog,
    saveEndTimestamp,
  });

  // --- Keyboard shortcuts ---
  useEditorShortcuts(
    {
      markEndTimestamp,
      markStartTimestamp,
      seekToStart,
      seekToEnd,
      selectNext,
      selectPrev,
      copyVideoUrl: copyVodUrl,
      fetchDuration,
      fetchAllDurations,
      exportSongList,
      openPasteImport: () => setShowPasteImport(true),
      openShortcuts: () => setShortcutsOpen(true),
    },
    { playerRef, disabled: showAddModal || showPasteImport || shortcutsOpen },
  );

  // --- Derived values ---
  const unstampedCount = detail ? detail.performances.filter(p => p.endTimestamp === null).length : 0;

  return {
    streamId,
    detail,
    loading,
    error,
    editingField,
    setEditingField,
    showPasteImport,
    setShowPasteImport,
    playerRef,
    playerBoxRef,
    selectedIndex,
    setSelectedIndex,
    showAddModal,
    setShowAddModal,
    shortcutsOpen,
    setShortcutsOpen,
    fetchLog,
    clearFetchLog,
    isCurator,
    prevStream,
    nextStream,
    unstampedCount,
    handleStreamStatus,
    handleStreamSave,
    handleDeleteStream,
    handlePasteImportDone,
    copyVodUrl,
    exportSongList,
    handleSave,
    handleDelete,
    handlePerformanceStatus,
    handleApproveAll,
    handleUnapproveAll,
    clearEndTimestamp,
    clearAllEndTimestamps,
    handleAddSong: addSong,
    markStartTimestamp,
    markEndTimestamp,
    seekToStart,
    seekToEnd,
    seekTo,
    isNarrow,
    navigate,
    pageRef,
  };
}

export type StreamDetailController = ReturnType<typeof useStreamDetailController>;

/** The icon buttons that sit on glass: the mockup's round, outlined `.ib` (as in the Stamp Editor). */
const OUTLINED_ICON_BUTTON = 'border border-field-line bg-field';

/**
 * A link styled as an icon-only button: the kit's small secondary button in a fixed 32px circle, the
 * size of the Stamp Editor's Newer / Older buttons. The small size's side padding stays (a smaller
 * padding class would lose to it in the stylesheet); in a box this narrow, flex centring shares the
 * icon's overflow evenly, so the icon still sits in the middle.
 */
const ICON_LINK = `${buttonClasses({ variant: 'secondary', size: 'sm' })} h-8 w-8`;

/**
 * One of the header's prev / next links to a neighbouring stream: its label and tooltip carry the
 * stream's date. The stream list is newest first, so the previous stream is the newer one.
 */
function NeighbourLink({ stream, direction }: { stream: Stream; direction: 'Newer' | 'Older' }) {
  const label = `${direction} stream · ${stream.date}`;
  return (
    <Tooltip label={label} side="bottom">
      <Link to={`/streams/${stream.id}`} aria-label={label} className={ICON_LINK}>
        <Icon name={direction === 'Newer' ? 'chevronLeft' : 'chevronRight'} size={16} />
      </Link>
    </Tooltip>
  );
}

/**
 * The page header (spec §8.3). The crumb leads back to Streams; the title, which a curator renames
 * by double-clicking it or with Edit, is cut to one line with its full text in `title`; prev / next
 * sit beside it; the meta row carries the date (double-click to edit), status, video ID, Copy URL,
 * credit and Edit. The actions: Open in Stamp Editor, the status-driven primary action and a ⋯ menu
 * with the rest, Delete stream last; below 640px the first two fold into that menu, and the ⋯ moves
 * to the end of the prev / next row. A contributor gets the Open link alone, which below 640px moves
 * there too, as an icon link. Hook-free, like the view it is part of.
 */
function StreamHeader({
  controller,
  detail,
}: {
  controller: StreamDetailController;
  detail: NonNullable<StreamDetailController['detail']>;
}) {
  const {
    streamId,
    editingField,
    setEditingField,
    isCurator,
    isNarrow,
    navigate,
    prevStream,
    nextStream,
    handleStreamStatus,
    handleStreamSave,
    handleDeleteStream,
    copyVodUrl,
  } = controller;

  const editingStream = editingField?.type === 'stream' ? editingField.field : null;
  const stampEditorPath = `/stamp?stream=${encodeURIComponent(streamId)}`;
  const { primary, menu: statusMenu, canDelete } = streamStatusActions(detail.status);
  // A curator's ⋯ menu. Below 640px it takes in the header's own two actions first, in the order
  // they stood; then the status changes the primary action leaves; Delete stream always last.
  const streamMenuItems: MenuItem[] = [
    ...(isNarrow ? [{ label: 'Open in Stamp Editor', onSelect: () => navigate(stampEditorPath) }] : []),
    ...(isNarrow && primary ? [{ label: primary.label, onSelect: () => handleStreamStatus(primary.status) }] : []),
    ...statusMenu.map((action) => ({ label: action.label, onSelect: () => handleStreamStatus(action.status) })),
    ...(canDelete ? [{ label: 'Delete stream', tone: 'danger' as const, onSelect: handleDeleteStream }] : []),
  ];
  const openInStampEditor = (
    <Link to={stampEditorPath} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
      <Icon name="timer" size={14} />
      Open in Stamp Editor
    </Link>
  );
  // Below 640px the header's one action joins the prev / next links' row, at its far end, rather
  // than taking a row of its own: a curator's ⋯ (its menu opens towards the free space), or a
  // contributor's Open in Stamp Editor as an icon link like those. With nothing to hold (an
  // approved stream from 640px), there is no ⋯: never an empty menu.
  const streamMenu =
    isCurator && streamMenuItems.length > 0 ? (
      <Popover
        kind="menu"
        label="More stream actions"
        align="end"
        className={isNarrow ? 'ml-auto' : undefined}
        trigger={({ triggerProps }) => (
          <IconButton
            {...triggerProps}
            label="More stream actions"
            icon="more"
            tooltipSide="bottom"
            className={OUTLINED_ICON_BUTTON}
          />
        )}
      >
        {(close) => <Menu items={streamMenuItems} onDone={close} />}
      </Popover>
    ) : null;
  const neighbours =
    prevStream || nextStream ? (
      <>
        {prevStream ? <NeighbourLink stream={prevStream} direction="Newer" /> : null}
        {nextStream ? <NeighbourLink stream={nextStream} direction="Older" /> : null}
      </>
    ) : null;
  // A contributor's Open in Stamp Editor below 640px. The row's own child takes `ml-auto`: the
  // tooltip wraps the link.
  const stampEditorIconLink = (
    <span className="ml-auto flex">
      <Tooltip label="Open in Stamp Editor" side="bottom">
        <Link to={stampEditorPath} aria-label="Open in Stamp Editor" className={ICON_LINK}>
          <Icon name="timer" size={16} />
        </Link>
      </Tooltip>
    </span>
  );
  const narrowAction = isNarrow ? (isCurator ? streamMenu : stampEditorIconLink) : null;

  return (
    <PageHeader
      tall
      recordTitle
      crumb={
        <Link to="/streams" className="rounded-radius-xs transition-colors hover:text-accent-fg">
          Catalog / Streams
        </Link>
      }
      title={
        editingStream === 'title' ? (
          <InlineEdit value={detail.title} onSave={(v) => handleStreamSave('title', v)} onCancel={() => setEditingField(null)} />
        ) : (
          <span
            title={detail.title}
            className={isCurator ? 'cursor-text' : undefined}
            onDoubleClick={isCurator ? () => setEditingField({ type: 'stream', field: 'title' }) : undefined}
          >
            {detail.title || detail.videoId}
          </span>
        )
      }
      meta={
        <>
          {editingStream === 'date' ? (
            <InlineDateEdit value={detail.date} label="Stream date" onSave={(v) => handleStreamSave('date', v)} onCancel={() => setEditingField(null)} />
          ) : (
            <span
              className={`inline-flex shrink-0${isCurator ? ' cursor-text' : ''}`}
              onDoubleClick={isCurator ? () => setEditingField({ type: 'stream', field: 'date' }) : undefined}
              title={isCurator ? 'Double-click to edit' : undefined}
            >
              <Pill tone="neutral" className="shrink-0">
                {detail.date}
              </Pill>
            </span>
          )}
          <StatusPill status={detail.status} />
          <a
            href={`https://www.youtube.com/watch?v=${detail.videoId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-radius-xs font-mono transition-colors hover:text-accent-fg"
          >
            {detail.videoId}
            <Icon name="arrowUpRight" size={12} />
          </a>
          <Button variant="ghost" size="sm" icon="copy" onClick={copyVodUrl}>
            Copy URL
          </Button>
          <span>{detail.credit.author ? `Credit — ${detail.credit.author}` : 'Credit —'}</span>
          {isCurator ? (
            <Button variant="ghost" size="sm" icon="pencil" onClick={() => setEditingField({ type: 'stream', field: 'title' })}>
              Edit
            </Button>
          ) : null}
        </>
      }
      actions={
        isNarrow ? null : isCurator ? (
          <>
            {openInStampEditor}
            {primary ? (
              <Button
                variant="primary"
                size="sm"
                icon={primary.status === 'approved' ? 'check' : 'undo'}
                onClick={() => handleStreamStatus(primary.status)}
              >
                {primary.label}
              </Button>
            ) : null}
            {streamMenu}
          </>
        ) : (
          openInStampEditor
        )
      }
    >
      {neighbours || narrowAction ? (
        <>
          {neighbours}
          {narrowAction}
        </>
      ) : null}
    </PageHeader>
  );
}

export function StreamDetailView({ controller }: { controller: StreamDetailController }) {
  const {
    streamId,
    detail,
    loading,
    error,
    editingField,
    setEditingField,
    showPasteImport,
    setShowPasteImport,
    playerRef,
    playerBoxRef,
    selectedIndex,
    setSelectedIndex,
    showAddModal,
    setShowAddModal,
    shortcutsOpen,
    setShortcutsOpen,
    fetchLog,
    clearFetchLog,
    isCurator,
    unstampedCount,
    handlePasteImportDone,
    exportSongList,
    handleSave,
    handleDelete,
    handlePerformanceStatus,
    handleApproveAll,
    handleUnapproveAll,
    clearEndTimestamp,
    clearAllEndTimestamps,
    handleAddSong,
    markStartTimestamp,
    markEndTimestamp,
    seekToStart,
    seekToEnd,
    seekTo,
    pageRef,
  } = controller;

  // Only a stream with nothing on screen yet shows the skeleton or the error card. A reload keeps
  // the last rows up, and with them the workbench and its player, so a row approve or a save never
  // restarts the video; a reload that fails says so in a note above the body instead. <main> gives
  // the page no gutter, so both bring it themselves.
  if (!detail) {
    return (
      <div className="p-4 lg:px-5">
        {loading ? (
          <Skeleton rows={6} />
        ) : (
          <GlassCard>
            <EmptyState icon="alert" title={error ?? 'Stream not found'} />
          </GlassCard>
        )}
      </div>
    );
  }

  const performances = detail.performances;
  // What a curator can still act on: the pill counts every row performanceStatusAction would
  // approve (pending and extracted — one source of truth with the row's own button, below).
  // Approve All acts on pending rows alone, all bulkApproveStream (admin/src/db.ts) ever touches.
  const toReviewCount = performances.filter((p) => performanceStatusAction(p.status)?.status === 'approved').length;
  const pendingCount = performances.filter((p) => p.status === 'pending').length;
  const performanceMenuItems: MenuItem[] = [
    ...(isCurator && performances.some((p) => p.status === 'approved')
      ? [{ label: 'Unapprove All', onSelect: handleUnapproveAll }]
      : []),
    { label: 'Clear All', tone: 'danger', onSelect: clearAllEndTimestamps },
    { label: 'Export', disabled: performances.length === 0, onSelect: exportSongList },
  ];

  return (
    // The page fills <main> itself. `overflow-x-clip`: the centred tooltip of a
    // header button at the far end reaches past <main>'s edge and would otherwise scroll the page
    // sideways; clip, unlike hidden, leaves the sticky header and the sticky column working. The
    // header is the root's first child: the controller measures it there (`--stream-header-h`).
    <div ref={pageRef} className="flex flex-col overflow-x-clip">
      <StreamHeader controller={controller} detail={detail} />

      {/* A reload that failed: the rows below are the last ones that loaded. */}
      {error ? (
        <p
          role="alert"
          className="mx-4 mt-4 rounded-radius-lg border border-tone-danger-line bg-tone-danger-bg px-3 py-2 text-token-sm text-tone-danger-fg lg:mx-5"
        >
          {error}
        </p>
      ) : null}

      {/* The Stamp Editor's workbench beside the performances, in the page gutter, split 1.2 : 1 as in
          the mockup: from about 1440 px the performances' head then fits one row. Below lg the two
          stack, and the extra bottom padding lets the last rows scroll clear of the fixed pill. */}
      <div className="grid grid-cols-1 gap-4 p-4 max-lg:pb-32 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:px-5 lg:pb-[18px]">
        {/* The desktop player column is sticky, so the workbench stays on screen however long the
            table runs. It stops 16px below the sticky header, whose height the page root publishes
            (it grows when the header wraps), and a viewport too short for the whole card scrolls
            the card, not the page. */}
        <div
          ref={playerBoxRef}
          tabIndex={-1}
          aria-label="Player"
          className="min-w-0 rounded-[18px] focus-visible:outline-none focus-visible:shadow-focus lg:sticky lg:top-[calc(var(--stream-header-h,76px)_+_1rem)] lg:flex lg:max-h-[calc(100vh_-_var(--stream-header-h,76px)_-_2rem)] lg:flex-col lg:self-start"
        >
          <WorkbenchCard
            playerRef={playerRef}
            videoId={detail.videoId}
            rows={performances}
            selectedIndex={selectedIndex}
            onSeek={seekTo}
            onSetStart={markStartTimestamp}
            onMarkEnd={markEndTimestamp}
            onSeekStart={seekToStart}
            seekToEnd={seekToEnd}
            onOpenShortcuts={() => setShortcutsOpen(true)}
            fetchLog={fetchLog}
            onClearFetchLog={clearFetchLog}
          />
        </div>

        {/* The performances. It hugs its rows (the last one rounds the card's bottom corners), and has
            no overflow of its own: the More menu opens over the rows, or past a short card. */}
        <GlassCard padding="none" className="min-w-0 lg:self-start">
          {/* The title with its count and the actions share the first line; the pills join them where
              the card has room (the mockup's one 48 px row, 1440 px wide) and wrap under the title where
              it has not. From xl the title's block grows beside the actions and wraps the pills inside
              itself; below xl the card is too narrow for one row anyway, so the block steps aside
              (`contents`) and the pills take a full line of their own under the first. Approve All is
              secondary, as in the mockup: the header's Approve stream is the page's one gradient
              action. Below xl it drops its icon: at 1024 px the card is 338 px, and the title, its
              count and the four actions need 326 px with the icon, 306 without. */}
          <div className="flex min-h-12 flex-wrap items-start gap-x-2 gap-y-1 border-b border-line-soft py-2 pl-3.5 pr-3">
            <div className="contents xl:flex xl:min-w-0 xl:flex-1 xl:basis-[7.5rem] xl:flex-wrap xl:items-center xl:gap-x-2 xl:gap-y-1">
              <div className="flex min-h-[30px] items-center gap-2">
                <h2 className="text-[14px] font-bold text-fg">Performances</h2>
                <span className="text-[11px] font-semibold text-fg-subtle">{performances.length}</span>
              </div>
              {unstampedCount > 0 || toReviewCount > 0 ? (
                <div className="order-last flex basis-full flex-wrap items-center gap-2 xl:order-none xl:basis-auto">
                  {unstampedCount > 0 ? <Pill tone="warn">{unstampedCount} unstamped</Pill> : null}
                  {toReviewCount > 0 ? <Pill tone="neutral">{toReviewCount} to review</Pill> : null}
                </div>
              ) : null}
            </div>
            <div className="ml-auto flex min-h-[30px] items-center gap-1">
              {isCurator && pendingCount > 0 ? (
                <Button size="sm" onClick={handleApproveAll}>
                  <Icon name="check" size={14} className="max-xl:hidden" />
                  Approve All
                </Button>
              ) : null}
              <IconButton
                label="Paste Import"
                icon="clipboardPaste"
                size="sm"
                className={OUTLINED_ICON_BUTTON}
                onClick={() => setShowPasteImport(true)}
              />
              <IconButton
                label="Add Song"
                icon="plus"
                size="sm"
                className={OUTLINED_ICON_BUTTON}
                onClick={() => setShowAddModal(true)}
              />
              <Popover
                kind="menu"
                label="More performance actions"
                align="end"
                trigger={({ triggerProps }) => (
                  <IconButton
                    {...triggerProps}
                    label="More performance actions"
                    icon="more"
                    size="sm"
                    className={OUTLINED_ICON_BUTTON}
                  />
                )}
              >
                {(close) => <Menu items={performanceMenuItems} onDone={close} />}
              </Popover>
            </div>
          </div>
          <PerformanceTable
            performances={performances}
            editingField={editingField?.type === 'perf' ? editingField : null}
            setEditingField={setEditingField}
            playerRef={playerRef}
            selectedIndex={selectedIndex}
            setSelectedIndex={setSelectedIndex}
            isCurator={isCurator}
            onSave={handleSave}
            onDelete={handleDelete}
            onPerformanceStatus={handlePerformanceStatus}
            onClearEndTimestamp={clearEndTimestamp}
          />
        </GlassCard>
      </div>

      {/* The player scrolls away below lg, and the pill shows once its column has; at lg the column is
          sticky. A click scrolls back to it. */}
      <FloatingPlaybackPill
        className="lg:hidden"
        perf={selectedIndex >= 0 ? performances[selectedIndex] ?? null : null}
        playerBox={playerBoxRef}
        onClick={() => playerBoxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
      />

      {/* Add Song Modal */}
      {showAddModal && (
        <AddSongModal onSubmit={handleAddSong} onCancel={() => setShowAddModal(false)} />
      )}

      {/* Paste Import Modal */}
      {showPasteImport && (
        <PasteImportModal
          streamId={streamId}
          hasExisting={performances.length > 0}
          example={'0:00 Song Title / Artist Name\n3:45 Another Song - Another Artist'}
          replaceLabel="Replace existing performances"
          onDone={handlePasteImportDone}
          onCancel={() => setShowPasteImport(false)}
        />
      )}

      <ShortcutSheet open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}

interface PerformanceTableProps {
  performances: StampPerformance[];
  editingField: PerfEditingField | null;
  setEditingField: Dispatch<SetStateAction<EditingField | null>>;
  playerRef: RefObject<YouTubePlayerHandle | null>;
  selectedIndex: number;
  setSelectedIndex: Dispatch<SetStateAction<number>>;
  isCurator: boolean;
  onSave: (perfId: string, field: 'title' | 'artist' | 'note', value: string) => void;
  onDelete: (perf: StampPerformance) => void;
  onPerformanceStatus: (perfId: string, status: Status) => void;
  onClearEndTimestamp: (perfId: string, index: number) => void;
}

/**
 * At lg the Actions column takes no width: every row's actions float, anchored on that zero-width
 * last cell and set 144 px to its left — the Start, End and Review columns of the `colgroup` below
 * (58 + 58 + 28 px) — so they end where the Song cell ends: over or under the song, never over the
 * seek buttons.
 */
const ROW_ACTIONS_AT_LG = 'lg:absolute lg:right-[144px] lg:h-fit';

/**
 * At lg the actions of a row that is neither selected nor being edited show on demand: centred on
 * the row, on a pill over the end of its song, while the row is hovered or holds focus. They turn
 * transparent, never `display: none`, so Tab still reaches them and a closing confirm dialog can
 * hand focus back to the button that opened it — as in the Stamp Editor's song list.
 */
const ROW_ACTIONS_ON_DEMAND =
  'lg:inset-y-0 lg:my-auto lg:pointer-events-none lg:rounded-radius-pill lg:border lg:border-glass-edge lg:bg-glass-pop lg:p-0.5 lg:opacity-0 lg:shadow-pop lg:group-focus-within:pointer-events-auto lg:group-focus-within:opacity-100 lg:group-hover:pointer-events-auto lg:group-hover:opacity-100';

/**
 * The selected row and the row being edited keep their actions on screen, and never at the song's
 * expense. Below xl, where the Song column is narrow, they sit on a line of their own under the
 * song, at the foot of the row, which grows by that line (`ROW_ACTIONS_LINE`). From xl they sit
 * centred at the end of the song, which stops short of them (`ROW_ACTIONS_ROOM`).
 */
const ROW_ACTIONS_SHOWN = 'lg:bottom-1.5 xl:inset-y-0 xl:my-auto';

/** Below xl, the Song cell's room for that line: 28 px buttons, 6 px off the row's foot, 4 px under the song. */
const ROW_ACTIONS_LINE = 'lg:max-xl:pb-[38px]';

/**
 * From xl, the room at the end of the Song cell, by how many actions the row shows: two to four
 * 28 px buttons 2 px apart, and a 6 px margin.
 */
const ROW_ACTIONS_ROOM: Record<number, string> = {
  2: 'xl:pr-[64px]',
  3: 'xl:pr-[94px]',
  4: 'xl:pr-[124px]',
};

/**
 * The rows, memoized. The page state around this table — the modals, the toast, the fetch log, the
 * stream's own header edits — changes far more often than the rows themselves, and taking the whole
 * controller as one prop re-rendered every row on each of those. These props are the table's own
 * data plus callbacks the controller keeps referentially stable; editingField in particular is
 * narrowed to the table's own 'perf' variant (or the referentially stable `null` literal), so
 * double-clicking the stream's own title or date no longer changes this prop at all. An unrelated
 * page change now stops at this boundary (`tests/song-table-memo.test.tsx` counts it).
 *
 * One `<table>`, one `<tbody>`; the column heads are for assistive technology only. Row actions show
 * on hover, on keyboard focus inside the row and on the selected row at lg, and always below it (no
 * hover there), where the table keeps a minimum width and scrolls sideways inside its card. Their
 * tooltips open downwards, clear of the card's header. The cells beside the song sit at the top of
 * the row, where a 44 px row would centre them, so a row grown by an actions line or an editor
 * keeps its number, timestamps and review mark level with the song.
 */
const PerformanceTable = memo(function PerformanceTable({
  performances,
  editingField,
  setEditingField,
  playerRef,
  selectedIndex,
  setSelectedIndex,
  isCurator,
  onSave,
  onDelete,
  onPerformanceStatus,
  onClearEndTimestamp,
}: PerformanceTableProps) {
  if (performances.length === 0) {
    return <p className="px-4 py-10 text-center text-token-sm text-fg-muted">No performances in this stream.</p>;
  }

  const lastIndex = performances.length - 1;

  return (
    // Below lg the overflow clips the rows to the card's corners; at lg there is none, so nothing
    // clips the actions' tooltips, and the last row's outer cells round its background instead.
    <div className="rounded-b-[18px] max-lg:overflow-x-auto max-lg:overflow-y-hidden">
      <table aria-label="Performances" className="w-full table-fixed text-[12px] max-lg:min-w-[34rem]">
        <colgroup>
          <col className="w-10" />
          <col />
          <col className="w-[58px]" />
          <col className="w-[58px]" />
          <col className="w-7" />
          <col className="w-[136px] lg:w-0" />
        </colgroup>
        <thead className="sr-only">
          <tr>
            <th scope="col">#</th>
            <th scope="col">Song</th>
            <th scope="col">Start</th>
            <th scope="col">End</th>
            <th scope="col">Review</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {performances.map((perf, i) => {
            const selected = i === selectedIndex;
            const editing = editingField?.perfId === perf.id ? editingField.field : null;
            const actionsShown = selected || editing !== null;
            const reviewMark = performanceReviewMark(perf.status);
            const statusAction = isCurator ? performanceStatusAction(perf.status) : null;
            const end = perf.endTimestamp;
            const last = i === lastIndex;
            // Edit note and Delete for everyone; the row's one status action for a curator; Clear end once stamped.
            const actionCount = 2 + (statusAction ? 1 : 0) + (end !== null ? 1 : 0);
            const startEditing = (field: PerfEditingField['field']) => {
              setEditingField({ type: 'perf', perfId: perf.id, field });
            };
            return (
              <tr
                key={perf.id}
                id={`performance-row-${perf.id}`}
                onClick={(event) => {
                  // A click inside an open inline editor places the caret: it belongs to the editor,
                  // and must not select the row or close the edit (the row's controls stop theirs).
                  if ((event.target as HTMLElement).tagName === 'INPUT') return;
                  setSelectedIndex(i);
                  setEditingField(null);
                }}
                className={`group h-11 cursor-pointer border-b border-line-soft transition-colors last:border-b-0 ${
                  selected ? 'bg-selected shadow-[inset_3px_0_0_var(--nav-active-icon)]' : 'hover:bg-row-hover'
                }`}
              >
                <td className={`pl-3.5 pr-1.5 pt-3.5 align-top font-mono text-meta text-fg-subtle${last ? ' rounded-bl-[18px]' : ''}`}>
                  {i + 1}
                </td>

                <td
                  className={`px-1.5 py-1 align-top${
                    actionsShown ? ` ${ROW_ACTIONS_LINE} ${ROW_ACTIONS_ROOM[actionCount] ?? ''}` : ''
                  }`}
                >
                  {editing === 'title' ? (
                    <InlineEdit
                      value={perf.title}
                      onSave={(value) => onSave(perf.id, 'title', value)}
                      onCancel={() => setEditingField(null)}
                    />
                  ) : (
                    <span
                      className="block cursor-text truncate font-[650] leading-4 text-fg"
                      onDoubleClick={(event) => {
                        event.stopPropagation();
                        startEditing('title');
                      }}
                      title={`${perf.title}\nDouble-click to edit`}
                    >
                      {perf.title}
                    </span>
                  )}
                  {/* The second line: the artist, then the note when there is one. Each cut text keeps its
                      full words in its tooltip. Alone, the artist has the line; with a note after it, it
                      shrinks, to 70 % at most, so a long artist never hides the note entirely. */}
                  <div className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] leading-4">
                    {editing === 'artist' ? (
                      <span className="min-w-0 flex-1">
                        <InlineEdit
                          allowEmpty
                          value={perf.originalArtist}
                          placeholder="add artist"
                          onSave={(value) => onSave(perf.id, 'artist', value)}
                          onCancel={() => setEditingField(null)}
                        />
                      </span>
                    ) : (
                      <span
                        className={`cursor-text truncate ${
                          editing === 'note' || perf.note ? 'min-w-0 max-w-[70%] shrink' : 'max-w-full shrink-0'
                        } ${perf.originalArtist ? 'text-fg-muted' : 'italic text-fg-subtle'}`}
                        onDoubleClick={(event) => {
                          event.stopPropagation();
                          startEditing('artist');
                        }}
                        title={`${perf.originalArtist || 'add artist'}\nDouble-click to edit`}
                      >
                        {perf.originalArtist || 'add artist'}
                      </span>
                    )}
                    {editing === 'note' ? (
                      <span className="min-w-0 flex-1">
                        <InlineEdit
                          allowEmpty
                          value={perf.note}
                          placeholder="add note"
                          onSave={(value) => onSave(perf.id, 'note', value)}
                          onCancel={() => setEditingField(null)}
                        />
                      </span>
                    ) : perf.note ? (
                      <span
                        className="min-w-0 cursor-text truncate text-fg-muted"
                        onDoubleClick={(event) => {
                          event.stopPropagation();
                          startEditing('note');
                        }}
                        title={`${perf.note}\nDouble-click to edit note`}
                      >
                        {` · ${perf.note}`}
                      </span>
                    ) : null}
                  </div>
                </td>

                <td className="px-1.5 pt-3.5 text-right align-top">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      playerRef.current?.seekTo(perf.timestamp);
                    }}
                    className="rounded-radius-xs font-mono text-[11px] text-fg-muted transition-colors hover:text-accent-fg"
                    title="Seek to start"
                  >
                    {formatTimestamp(perf.timestamp)}
                  </button>
                </td>

                <td className="px-1.5 pt-3.5 text-right align-top">
                  {end !== null ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        playerRef.current?.seekTo(Math.max(0, end - (event.shiftKey ? 0 : END_PREVIEW_SECONDS)));
                      }}
                      className="rounded-radius-xs font-mono text-[11px] text-fg-muted transition-colors hover:text-accent-fg"
                      title={`Seek end -${END_PREVIEW_SECONDS}s (Shift+click: exact end)`}
                    >
                      {formatTimestamp(end)}
                    </button>
                  ) : (
                    <span className="font-mono text-[11px] text-tone-warn-fg">—</span>
                  )}
                </td>

                {/* Review state: a check once approved, a hollow ring while pending, a small toned
                    icon otherwise (extracted, rejected, excluded) — the same tone as StatusPill's. */}
                <td className={`px-1.5 pt-3.5 align-top${last ? ' lg:rounded-br-[18px]' : ''}`}>
                  <div className="flex h-4 items-center justify-center" title={reviewMark.word}>
                    {reviewMark.kind === 'approved' ? (
                      <Icon name="check" size={14} className="text-tone-ok-fg" />
                    ) : reviewMark.kind === 'pending' ? (
                      <span aria-hidden="true" className="h-3 w-3 rounded-full border-2 border-tone-warn-fg" />
                    ) : (
                      <Icon name={reviewMark.icon} size={14} className={reviewMark.className} />
                    )}
                    <span className="sr-only">{reviewMark.word}</span>
                  </div>
                </td>

                <td className="pl-1.5 pr-3 pt-2 align-top lg:relative lg:p-0">
                  <div
                    className={`flex items-center justify-end gap-0.5 ${ROW_ACTIONS_AT_LG} ${
                      actionsShown ? ROW_ACTIONS_SHOWN : ROW_ACTIONS_ON_DEMAND
                    }`}
                  >
                    {statusAction ? (
                      <IconButton
                        label={statusAction.label}
                        icon={statusAction.icon}
                        tone={statusAction.status === 'approved' ? 'ok' : 'default'}
                        size="sm"
                        tooltipSide="bottom"
                        onClick={(event) => {
                          event.stopPropagation();
                          onPerformanceStatus(perf.id, statusAction.status);
                        }}
                      />
                    ) : null}
                    {end !== null ? (
                      <IconButton
                        label="Clear end timestamp"
                        icon="x"
                        size="sm"
                        tooltipSide="bottom"
                        onClick={(event) => {
                          event.stopPropagation();
                          onClearEndTimestamp(perf.id, i);
                        }}
                      />
                    ) : null}
                    <IconButton
                      label="Edit note"
                      icon="fileText"
                      size="sm"
                      tooltipSide="bottom"
                      onClick={(event) => {
                        event.stopPropagation();
                        startEditing('note');
                      }}
                    />
                    <IconButton
                      label="Delete performance"
                      icon="trash"
                      tone="danger"
                      size="sm"
                      tooltipSide="bottom"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDelete(perf);
                      }}
                    />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
});

/**
 * One stream's page. Keyed by the stream id below, so moving to the next stream unmounts this and
 * mounts a fresh one: the selection, the modals, the field being edited and the stream's own
 * detail all start over because they never existed for the new stream, with no effect reaching
 * back to reset them one by one.
 */
function StreamDetailForStream(props: StreamPageProps) {
  const controller = useStreamDetailController(props);
  return <StreamDetailView controller={controller} />;
}

export default function StreamDetail({ user }: { user: AuthUser }) {
  const { id: streamId } = useParams<{ id: string }>();
  // Everything below is what outlives a move between streams: the stream list the prev/next links
  // read, the toast, and the iTunes fetch log.
  const [allStreams, setAllStreams] = useState<Stream[]>([]);
  const showToast = useShowToast();
  const { fetchLog, appendFetchLog, clearFetchLog } = useFetchLog();

  // --- Fetch all streams for prev/next navigation ---
  useEffect(() => {
    api.listStreams().then(({ data }) => {
      const sorted = [...data].sort((a, b) => b.date.localeCompare(a.date));
      setAllStreams(sorted);
    }).catch(() => {
      // Left silent on purpose: this list only feeds the prev/next links below, so a failed load
      // simply leaves both hidden rather than raising a toast for a page still usable without them
      // (spec §7).
    });
  }, []);

  // --- Derive prev/next streams ---
  const { prevStream, nextStream } = useMemo(() => {
    if (!streamId || allStreams.length === 0) return { prevStream: null, nextStream: null };
    const idx = allStreams.findIndex(s => s.id === streamId);
    if (idx < 0) return { prevStream: null, nextStream: null };
    return {
      prevStream: allStreams[idx - 1] ?? null,
      nextStream: allStreams[idx + 1] ?? null,
    };
  }, [streamId, allStreams]);

  return (
    <>
      {/* `/streams/:id` always carries an id; this is what narrows it for the page below. */}
      {streamId === undefined ? (
        <div className="p-4 lg:px-5">
          <GlassCard>
            <EmptyState icon="alert" title="Stream not found" />
          </GlassCard>
        </div>
      ) : (
        <StreamDetailForStream
          key={streamId}
          user={user}
          streamId={streamId}
          prevStream={prevStream}
          nextStream={nextStream}
          showToast={showToast}
          fetchLog={fetchLog}
          appendFetchLog={appendFetchLog}
          clearFetchLog={clearFetchLog}
        />
      )}
    </>
  );
}
