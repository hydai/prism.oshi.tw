import { memo, useState, useEffect, useRef, useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { AuthUser, StreamWithPending, StampPerformance, StampStats } from '../../../shared/types';
import { api } from '../api/client';
import type { YouTubePlayerHandle } from '../components/YouTubePlayer';
import { FloatingPlaybackPill } from '../components/FloatingPlaybackPill';
import { InlineEdit } from '../components/stamp/InlineEdit';
import { AddSongModal } from '../components/stamp/AddSongModal';
import { PasteImportModal } from '../components/stamp/PasteImportModal';
import { StreamPicker } from '../components/stamp/StreamPicker';
import { Button, IconButton } from '../components/ui/Button';
import { useConfirm } from '../components/ui/confirm';
import { EmptyState, GlassCard, ProgressBar, Skeleton } from '../components/ui/Display';
import { Icon } from '../components/ui/Icon';
import { PageHeader } from '../components/ui/PageHeader';
import { Pill } from '../components/ui/Pill';
import { Menu, Popover, type MenuItem } from '../components/ui/Popover';
import { useShowToast } from '../components/ui/toast';
import { ShortcutSheet } from '../components/workbench/ShortcutHints';
import { WorkbenchCard } from '../components/workbench/WorkbenchCard';
import { useFetchLog } from '../hooks/useFetchLog';
import { useEditorShortcuts } from '../hooks/useEditorShortcuts';
import { useFetchAllDurations } from '../hooks/useFetchAllDurations';
import { usePerformances } from '../hooks/usePerformances';
import { usePlayerClock } from '../hooks/usePlayerClock';
import { useStreamPicker } from '../hooks/useStreamPicker';
import { useSearchParamState } from '../hooks/useSearchParamState';
import { useAsyncScope } from '../hooks/useAsyncScope';
import { createRequestSequencer } from '../lib/apiResource';
import { formatTimestamp } from '../lib/format-timestamp';

// --- Main component ---

interface EditingField {
  index: number;
  field: 'title' | 'artist';
}

/** The icon buttons that sit on glass: the mockup's round, outlined `.ib`. */
const OUTLINED_ICON_BUTTON = 'border border-field-line bg-field';

/**
 * At lg the actions of a row that is not selected float over the end of its title until the row
 * is hovered or holds focus. They turn transparent, never `display: none`, so Tab still reaches
 * them and a closing confirm dialog can hand focus back to the button that opened it. The
 * selected row, the row being edited, and every row below lg keep them visible in the row itself.
 */
const ROW_ACTIONS_ON_DEMAND =
  'lg:pointer-events-none lg:absolute lg:inset-y-0 lg:right-0 lg:my-auto lg:h-fit lg:rounded-radius-pill lg:border lg:border-glass-edge lg:bg-glass-pop lg:p-0.5 lg:opacity-0 lg:shadow-pop lg:group-focus-within:pointer-events-auto lg:group-focus-within:opacity-100 lg:group-hover:pointer-events-auto lg:group-hover:opacity-100';

function useStampEditorController(user: AuthUser) {
  const scope = useAsyncScope();
  const [loads] = useState(createRequestSequencer);
  const [statLoads] = useState(createRequestSequencer);
  const selectedStreamRef = useRef<string | null>(null);
  // Deep-link targets: the editor opens on them and never writes them back.
  const [requestedStreamId] = useSearchParamState('stream', '');
  const [requestedPerformanceId] = useSearchParamState('performance', '');

  // Performance state
  const [performances, setPerformances] = useState<StampPerformance[]>([]);
  const [selectedRowIndex, setSelectedIndex] = useState(-1);
  const selectedIndex = performances.length === 0 ? -1 : Math.min(selectedRowIndex, performances.length - 1);

  // UI state
  const [showAddModal, setShowAddModal] = useState(false);
  const [showPasteImport, setShowPasteImport] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [editingField, setEditingField] = useState<EditingField | null>(null);
  const [loading, setLoading] = useState(false);

  // Stamp stats
  const [stampStats, setStampStats] = useState<StampStats | null>(null);
  const [statsUnavailable, setStatsUnavailable] = useState(false);

  const playerRef = useRef<YouTubePlayerHandle>(null);
  // The playback clock lives in an external store: only the pill and the readout hear its ticks.
  usePlayerClock(playerRef);

  const showToast = useShowToast();
  const confirm = useConfirm();
  const { fetchLog, appendFetchLog, clearFetchLog } = useFetchLog();

  // --- Load performances when stream changes ---
  // Consumed the first time the requested stream's performances load, so a later reload of that
  // stream (a paste import, approve-all, or just re-picking it) never snaps the selection back to
  // the deep-linked performance and overrides whatever the user has since selected.
  const requestedPerformanceAppliedRef = useRef(false);

  const loadPerformances = useCallback(
    async (streamId: string) => {
      if (streamId !== selectedStreamRef.current) return;
      const isCurrent = scope.capture();
      const requestId = loads.next();
      setLoading(true);
      try {
        const { data } = await api.listStreamPerformances(streamId);
        if (!isCurrent() || !loads.isCurrent(requestId)) return;
        setPerformances(data);
        let nextIndex = data.length > 0 ? 0 : -1;
        if (
          !requestedPerformanceAppliedRef.current
          && requestedPerformanceId
          && streamId === requestedStreamId
        ) {
          requestedPerformanceAppliedRef.current = true;
          const requestedIndex = data.findIndex((performance) => performance.id === requestedPerformanceId);
          if (requestedIndex >= 0) nextIndex = requestedIndex;
        }
        setSelectedIndex(nextIndex);
      } catch (err: unknown) {
        if (!isCurrent() || !loads.isCurrent(requestId)) return;
        showToast(err instanceof Error ? err.message : 'Failed to load performances', true);
      } finally {
        loads.settle(requestId);
        // An obsolete finally must not reset a newer request's loading flag.
        // react-doctor-disable-next-line react-doctor/no-loading-flag-reset-outside-finally
        if (isCurrent() && loads.isCurrent(requestId)) setLoading(false);
      }
    },
    [showToast, requestedPerformanceId, requestedStreamId, scope, loads],
  );

  const {
    reloadStreams,
    streamSearch,
    setStreamSearch,
    streamYearFilter,
    setStreamYearFilter,
    selectedStreamId,
    selectStreamId,
    selectedStream,
    streamYears,
    filteredStreams,
  } = useStreamPicker();

  // --- Load stats ---
  // A failed load shows "Stats unavailable" in the picker instead of vanishing; only the newest
  // request may set either state, so a slow older answer cannot overwrite a newer one.
  const loadStats = useCallback(() => {
    const requestId = statLoads.next();
    api
      .stampStats()
      .then(
        (stats) => {
          if (!statLoads.isCurrent(requestId)) return;
          setStampStats(stats);
          setStatsUnavailable(false);
        },
        () => {
          if (statLoads.isCurrent(requestId)) setStatsUnavailable(true);
        },
      )
      .finally(() => statLoads.settle(requestId));
  }, [statLoads]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  /** Stamped counts moved: refresh the picker's stats and its per-stream badges. */
  const refreshStampCounts = useCallback(() => {
    loadStats();
    reloadStreams();
  }, [loadStats, reloadStreams]);

  const selectStream = useCallback(
    (stream: StreamWithPending) => {
      scope.invalidate();
      selectedStreamRef.current = stream.id;
      selectStreamId(stream.id);
      setPerformances([]);
      setSelectedIndex(-1);
      setEditingField(null);
      setShowAddModal(false);
      setShowPasteImport(false);
      loadPerformances(stream.id);
    },
    [selectStreamId, loadPerformances, scope],
  );

  /** The previous (`newer`) or next (`older`) entry of the filtered list, which is newest first. */
  const selectAdjacentStream = useCallback(
    (direction: 'newer' | 'older') => {
      const position = filteredStreams.findIndex((stream) => stream.id === selectedStreamId);
      if (position < 0) return;
      const adjacent = filteredStreams[direction === 'newer' ? position - 1 : position + 1];
      if (adjacent) selectStream(adjacent);
    },
    [filteredStreams, selectedStreamId, selectStream],
  );

  // --- Load the stream list, then — once, if the URL asked for a stream — select it and load
  // its performances. Chaining onto this same fetch (rather than a second effect reacting to
  // `streams`) means there is no extra render, and nothing here hands a setter to another hook to
  // call from inside its own effect: it is this controller's own load, run in the order it
  // actually happens. `active` guards the chain against StrictMode's dev-only double effect: both
  // invocations call `reloadStreams()`, but the first invocation's cleanup flips its own `active`
  // to false before either promise settles, so only the second (live) chain ever reaches
  // `requestedPerformanceAppliedRef` — without the guard both chains raced to consume it, and
  // whichever resolved second always reset the deep-linked pick back to row 0.
  useEffect(() => {
    let active = true;
    const isCurrent = scope.capture();
    reloadStreams()
      .then((loaded) => {
        if (!active || !isCurrent() || !requestedStreamId) return;
        const requested = loaded.find((stream) => stream.id === requestedStreamId);
        if (requested) {
          selectStream(requested);
        }
      })
      .catch((err: unknown) => {
        if (!active) return;
        showToast(err instanceof Error ? err.message : 'Failed to load streams', true);
      });
    return () => {
      active = false;
    };
  }, [reloadStreams, requestedStreamId, selectStream, showToast, scope]);

  // --- Actions ---

  const patchRow = useCallback((id: string, updates: Partial<StampPerformance>) => {
    setPerformances((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
  }, []);

  const patchAllRows = useCallback((updates: Partial<StampPerformance>) => {
    setPerformances((prev) => prev.map((p) => ({ ...p, ...updates })));
  }, []);

  const reload = useCallback(async () => {
    if (selectedStreamId) await loadPerformances(selectedStreamId);
  }, [selectedStreamId, loadPerformances]);

  const closeAddModal = useCallback(() => setShowAddModal(false), []);

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
    streamId: selectedStreamId,
    performances,
    selectedIndex,
    setSelectedIndex,
    playerRef,
    showToast,
    patchRow,
    patchAllRows,
    reload,
    onCountsChanged: refreshStampCounts,
    onSongCreated: closeAddModal,
    captureScope: scope.capture,
    confirm,
  });

  const deletePerformance = useCallback(
    async (perfId: string, idx: number) => {
      const perf = performances[idx];
      if (!perf) return;
      // Captured before asking: a stream switched while the dialog was up must not lose a row.
      const isCurrent = scope.capture();
      const confirmed = await confirm({
        title: `Delete #${idx + 1} ${perf.title}?`,
        body: 'The performance is removed from this stream. This can’t be undone.',
        confirmLabel: 'Delete',
        tone: 'danger',
      });
      if (!confirmed || !isCurrent()) return;
      try {
        await api.deletePerformance(perfId);
        if (!isCurrent()) return;
        setPerformances((prev) => prev.filter((p) => p.id !== perfId));
        setSelectedIndex((prev) => prev > idx ? prev - 1 : prev);
        showToast(`Deleted ${perf.title}`);
        refreshStampCounts();
      } catch (err: unknown) {
        if (!isCurrent()) return;
        showToast(err instanceof Error ? err.message : 'Failed to delete', true);
      }
    },
    [performances, showToast, refreshStampCounts, scope, confirm],
  );

  const handlePasteImportDone = useCallback(
    async (result: { created: number; replaced: boolean }) => {
      if (selectedStreamId !== selectedStreamRef.current) return;
      const isCurrent = scope.capture();
      setShowPasteImport(false);
      await reload();
      if (!isCurrent()) return;
      showToast(
        `Imported ${result.created} songs${result.replaced ? ' (replaced existing)' : ''}`,
      );
      refreshStampCounts();
    },
    [reload, showToast, refreshStampCounts, selectedStreamId, scope],
  );

  const handleInlineEditSave = useCallback(
    async (index: number, field: 'title' | 'artist', value: string) => {
      const perf = performances[index];
      if (!perf) return;
      setEditingField(null);
      const isCurrent = scope.capture();
      try {
        const body =
          field === 'title' ? { title: value } : { originalArtist: value };
        await api.updatePerformanceDetails(perf.id, body);
        if (!isCurrent()) return;
        patchRow(perf.id, body);
        showToast(`Updated ${field}`);
      } catch (err: unknown) {
        if (!isCurrent()) return;
        showToast(err instanceof Error ? err.message : 'Failed to update', true);
      }
    },
    [performances, showToast, patchRow, scope],
  );

  // --- Copy full VOD URL ---
  const copyVideoUrl = useCallback(() => {
    if (!selectedStream) return;
    const url = `https://www.youtube.com/watch?v=${selectedStream.videoId}`;
    navigator.clipboard.writeText(url).then(
      () => showToast(`Copied ${url}`),
      () => showToast('Failed to copy', true),
    );
  }, [selectedStream, showToast]);

  // --- Bulk approve all pending for this stream ---
  const approveAllAction = useCallback(async () => {
    if (!selectedStreamId) return;
    const pendingCount = performances.filter((p) => p.status === 'pending').length;
    if (pendingCount === 0) {
      showToast('No pending performances to approve');
      return;
    }
    const isCurrent = scope.capture();
    const confirmed = await confirm({
      title: `Approve all ${pendingCount} pending songs & performances for this stream?`,
      confirmLabel: 'Approve all',
    });
    if (!confirmed || !isCurrent()) return;
    try {
      const { songs, performances: perfs } = await api.approveAllForStream(selectedStreamId);
      if (!isCurrent()) return;
      showToast(`Approved ${songs} songs, ${perfs} performances`);
      loadPerformances(selectedStreamId);
      refreshStampCounts();
    } catch (err: unknown) {
      if (!isCurrent()) return;
      showToast(err instanceof Error ? err.message : 'Failed to approve', true);
    }
  }, [selectedStreamId, performances, showToast, loadPerformances, refreshStampCounts, scope, confirm]);

  // --- Fetch durations from iTunes (Steps 5 & 6) ---
  const { fetchDuration, fetchAllDurations } = useFetchAllDurations({
    performances,
    selectedIndex,
    showToast,
    appendFetchLog,
    saveEndTimestamp,
    onRefresh: refreshStampCounts,
    captureScope: scope.capture,
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
      copyVideoUrl,
      fetchDuration,
      fetchAllDurations,
      exportSongList,
      openPasteImport: () => {
        if (selectedStreamId) setShowPasteImport(true);
      },
      openShortcuts: () => setShortcutsOpen(true),
    },
    { playerRef, disabled: showAddModal || showPasteImport || shortcutsOpen },
  );

  return {
    user,
    streamSearch,
    setStreamSearch,
    streamYearFilter,
    setStreamYearFilter,
    selectedStreamId,
    performances,
    selectedIndex,
    setSelectedIndex,
    showAddModal,
    setShowAddModal,
    showPasteImport,
    setShowPasteImport,
    editingField,
    setEditingField,
    loading,
    stampStats,
    statsUnavailable,
    pickerOpen,
    setPickerOpen,
    shortcutsOpen,
    setShortcutsOpen,
    fetchLog,
    clearFetchLog,
    playerRef,
    selectedStream,
    streamYears,
    filteredStreams,
    selectStream,
    selectAdjacentStream,
    markStartTimestamp,
    markEndTimestamp,
    seekToStart,
    seekToEnd,
    seekTo,
    clearEndTimestamp,
    deletePerformance,
    handleAddSong: addSong,
    handlePasteImportDone,
    handleInlineEditSave,
    exportSongList,
    clearAllEndTimestampsAction: clearAllEndTimestamps,
    approveAllAction,
  };
}

export type StampEditorController = ReturnType<typeof useStampEditorController>;

export function StampEditorView({ controller }: { controller: StampEditorController }) {
  const {
    user,
    streamSearch,
    setStreamSearch,
    streamYearFilter,
    setStreamYearFilter,
    selectedStreamId,
    performances,
    selectedIndex,
    setSelectedIndex,
    editingField,
    setEditingField,
    loading,
    showAddModal,
    setShowAddModal,
    showPasteImport,
    setShowPasteImport,
    stampStats,
    statsUnavailable,
    pickerOpen,
    setPickerOpen,
    shortcutsOpen,
    setShortcutsOpen,
    fetchLog,
    clearFetchLog,
    playerRef,
    selectedStream,
    streamYears,
    filteredStreams,
    selectStream,
    selectAdjacentStream,
    markStartTimestamp,
    markEndTimestamp,
    seekToStart,
    seekToEnd,
    seekTo,
    clearEndTimestamp,
    deletePerformance,
    handleAddSong,
    handlePasteImportDone,
    handleInlineEditSave,
    exportSongList,
    clearAllEndTimestampsAction,
    approveAllAction,
  } = controller;

  const stampedCount = performances.filter((p) => p.endTimestamp !== null).length;
  const unstampedCount = performances.length - stampedCount;
  const stampedPercent = performances.length > 0 ? Math.round((stampedCount / performances.length) * 100) : 0;
  const selectedPerformance = selectedIndex >= 0 ? performances[selectedIndex] ?? null : null;
  const streamPosition = filteredStreams.findIndex((stream) => stream.id === selectedStreamId);
  const canApproveAll = user.role === 'curator' && performances.some((p) => p.status === 'pending');
  const songMenuItems: MenuItem[] = [
    // Nothing to clear until a row has an end timestamp: no confirm, no request for nothing.
    { label: 'Clear All', tone: 'danger', disabled: stampedCount === 0, onSelect: clearAllEndTimestampsAction },
    { label: 'Export', disabled: performances.length === 0, onSelect: exportSongList },
  ];

  return (
    // At lg the page is exactly `<main>`'s height and only the song list scrolls. `overflow-x-clip`:
    // the centred tooltip of a right-most icon button reaches past `<main>`'s edge and would
    // otherwise scroll the page sideways; clip, unlike hidden, leaves the sticky header working.
    <div className="flex flex-col overflow-x-clip lg:h-full">
      <PageHeader
        crumb="TIMESTAMPS"
        title="Stamp Editor"
        actions={
          <>
            {/* Keyboard shortcuts describe keys a touch phone has none of; hidden below 640px,
                same as the ShortcutHints row further down. */}
            <IconButton
              label="Keyboard shortcuts"
              icon="keyboard"
              tooltipSide="bottom"
              className="max-sm:hidden"
              onClick={() => setShortcutsOpen(true)}
            />
            {canApproveAll ? (
              <Button variant="primary" icon="check" onClick={approveAllAction}>
                Approve All
              </Button>
            ) : null}
          </>
        }
      >
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <StreamPicker
            streams={filteredStreams}
            selectedStream={selectedStream}
            onSelect={selectStream}
            search={streamSearch}
            onSearchChange={setStreamSearch}
            yearFilter={streamYearFilter}
            onYearFilterChange={setStreamYearFilter}
            years={streamYears}
            stats={stampStats}
            statsUnavailable={statsUnavailable}
            open={pickerOpen}
            onOpenChange={setPickerOpen}
          />
          <IconButton
            label="Newer stream"
            icon="chevronLeft"
            tooltipSide="bottom"
            className={OUTLINED_ICON_BUTTON}
            disabled={streamPosition <= 0}
            onClick={() => selectAdjacentStream('newer')}
          />
          <IconButton
            label="Older stream"
            icon="chevronRight"
            tooltipSide="bottom"
            className={OUTLINED_ICON_BUTTON}
            disabled={streamPosition < 0 || streamPosition >= filteredStreams.length - 1}
            onClick={() => selectAdjacentStream('older')}
          />
          {selectedStreamId ? (
            <div className="flex w-[150px] flex-col gap-[5px] max-sm:w-full lg:w-[110px] xl:w-[150px]">
              <div className="flex justify-between text-[11px] text-fg-muted">
                <span>
                  <b className="font-bold text-fg">{stampedCount}</b> / {performances.length} stamped
                </span>
                <span>{stampedPercent}%</span>
              </div>
              <ProgressBar value={stampedCount} max={performances.length} label="Stamped in this stream" />
            </div>
          ) : null}
        </div>
      </PageHeader>

      {!selectedStreamId ? (
        <div className="p-4 lg:px-5">
          <GlassCard>
            <EmptyState
              icon="timer"
              title="Select a stream to start stamping"
              body="Pick a stream from the list above."
              action={
                <Button variant="primary" onClick={() => setPickerOpen(true)}>
                  Choose a stream
                </Button>
              }
            />
          </GlassCard>
        </div>
      ) : (
        <>
          {/* Below lg the extra bottom padding lets the last rows scroll clear of the fixed pill. */}
          <div className="grid grid-cols-1 gap-4 p-4 max-lg:pb-32 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] lg:px-5 lg:pb-[18px]">
            {/* The workbench. Clips the player's corners to the card; at lg it scrolls itself if the
                viewport is too short, so the page never does. */}
            <WorkbenchCard
              playerRef={playerRef}
              videoId={selectedStream?.videoId}
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

            {/* The song list. No overflow of its own: the More menu opens over the rows. */}
            <GlassCard padding="none" className="flex flex-col lg:min-h-0">
              <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line-soft pl-3.5 pr-3">
                <h2 className="text-[14px] font-bold text-fg">Songs</h2>
                <span className="text-[11px] font-semibold text-fg-subtle">{performances.length}</span>
                {unstampedCount > 0 ? <Pill tone="warn">{unstampedCount} unstamped</Pill> : null}
                <div className="ml-auto flex items-center gap-1">
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
                    label="More song actions"
                    align="end"
                    trigger={({ triggerProps }) => (
                      <IconButton
                        {...triggerProps}
                        label="More song actions"
                        icon="more"
                        size="sm"
                        className={OUTLINED_ICON_BUTTON}
                      />
                    )}
                  >
                    {(close) => <Menu items={songMenuItems} onDone={close} />}
                  </Popover>
                </div>
              </div>
              <SongList
                performances={performances}
                loading={loading}
                selectedIndex={selectedIndex}
                setSelectedIndex={setSelectedIndex}
                editingField={editingField}
                setEditingField={setEditingField}
                onInlineEditSave={handleInlineEditSave}
                onClearEndTimestamp={clearEndTimestamp}
                onDelete={deletePerformance}
              />
            </GlassCard>
          </div>

          {/* The player scrolls away below lg; at lg the workbench never leaves the viewport. */}
          <FloatingPlaybackPill className="lg:hidden" perf={selectedPerformance} />
        </>
      )}

      {/* Add Song Modal */}
      {showAddModal && (
        <AddSongModal
          onSubmit={handleAddSong}
          onCancel={() => setShowAddModal(false)}
        />
      )}

      {/* Paste Import Modal */}
      {showPasteImport && selectedStreamId && (
        <PasteImportModal
          streamId={selectedStreamId}
          hasExisting={performances.length > 0}
          onDone={handlePasteImportDone}
          onCancel={() => setShowPasteImport(false)}
        />
      )}

      <ShortcutSheet open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}

interface SongListProps {
  performances: StampPerformance[];
  loading: boolean;
  selectedIndex: number;
  setSelectedIndex: Dispatch<SetStateAction<number>>;
  editingField: EditingField | null;
  setEditingField: Dispatch<SetStateAction<EditingField | null>>;
  onInlineEditSave: (index: number, field: 'title' | 'artist', value: string) => void;
  onClearEndTimestamp: (perfId: string, index: number) => void;
  onDelete: (perfId: string, index: number) => void;
}

/**
 * The rows, memoized. The page state around this list — the stream search, the year filter, the
 * modals, the toast, the fetch log — changes far more often than the rows themselves, and taking
 * the whole controller as one prop re-rendered every row on each of those. These props are the
 * list's own data plus callbacks the controller keeps referentially stable, so an unrelated page
 * change now stops at this boundary (`tests/song-table-memo.test.tsx` counts it).
 *
 * At lg the list scrolls inside its card; below it the page scrolls. Row actions show on hover,
 * on keyboard focus inside the row and on the selected row, and always below lg (no hover there).
 * Their tooltips open downwards, so the top row's are not cut off by the scrolling list.
 */
const SongList = memo(function SongList({
  performances,
  loading,
  selectedIndex,
  setSelectedIndex,
  editingField,
  setEditingField,
  onInlineEditSave,
  onClearEndTimestamp,
  onDelete,
}: SongListProps) {
  return (
    <div className="min-h-0 flex-1 rounded-b-[18px] lg:overflow-y-auto">
      {loading ? (
        <div className="p-4">
          <Skeleton rows={6} />
        </div>
      ) : performances.length === 0 ? (
        <p className="px-4 py-10 text-center text-token-sm text-fg-muted">
          No songs in this stream
        </p>
      ) : (
        <ul aria-label="Songs in selected stream">
          {performances.map((perf, i) => {
            const selected = i === selectedIndex;
            const stamped = perf.endTimestamp !== null;
            // The row being edited keeps its actions in the row, like the selected one: the
            // overlay its focus would reveal must not cover the inline editor.
            const actionsInRow = selected || editingField?.index === i;
            return (
              <li
                key={perf.id}
                className={`group grid min-h-[34px] grid-cols-[20px_minmax(0,1fr)_54px_54px] items-center gap-2 border-b border-line-soft px-3.5 text-[12px] transition-colors last:rounded-b-[18px] last:border-b-0 lg:grid-cols-[24px_minmax(0,1fr)_58px_58px_16px] ${
                  selected ? 'bg-selected shadow-[inset_3px_0_0_var(--nav-active-icon)]' : 'hover:bg-field'
                }`}
              >
                <button
                  type="button"
                  className="flex h-7 w-full items-center font-mono text-meta text-fg-subtle hover:text-fg"
                  onClick={() => {
                    setSelectedIndex(i);
                    setEditingField(null);
                  }}
                  aria-pressed={selected}
                  title={`Select song ${i + 1}`}
                >
                  {i + 1}
                </button>

                <div className="relative flex min-w-0 items-center gap-1">
                  {/* Where the list column is narrow (a phone; lg–xl beside the sidebar and the
                      workbench) the artist goes under the title, so the title keeps the width. */}
                  <div className="flex min-w-0 flex-1 items-baseline gap-1.5 max-sm:flex-col max-sm:items-start max-sm:gap-0 lg:max-xl:flex-col lg:max-xl:items-start lg:max-xl:gap-0">
                    {editingField?.index === i && editingField.field === 'title' ? (
                      <InlineEdit
                        value={perf.title}
                        onSave={(val) => onInlineEditSave(i, 'title', val)}
                        onCancel={() => setEditingField(null)}
                      />
                    ) : (
                      <button
                        type="button"
                        className="min-w-0 max-w-full cursor-text truncate text-left font-semibold text-fg"
                        onClick={() => setSelectedIndex(i)}
                        onDoubleClick={() => {
                          setEditingField({ index: i, field: 'title' });
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'F2') {
                            event.preventDefault();
                            setEditingField({ index: i, field: 'title' });
                          }
                        }}
                        title="Double-click or press F2 to edit title"
                      >
                        {perf.title}
                      </button>
                    )}
                    {editingField?.index === i && editingField.field === 'artist' ? (
                      <InlineEdit
                        value={perf.originalArtist}
                        placeholder="add artist"
                        onSave={(val) => onInlineEditSave(i, 'artist', val)}
                        onCancel={() => setEditingField(null)}
                      />
                    ) : (
                      <button
                        type="button"
                        className={`min-w-0 max-w-full shrink-[4] cursor-text truncate text-left text-[11px] ${
                          perf.originalArtist ? 'text-fg-muted' : 'italic text-fg-subtle'
                        }`}
                        onClick={() => setSelectedIndex(i)}
                        onDoubleClick={() => {
                          setEditingField({ index: i, field: 'artist' });
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'F2') {
                            event.preventDefault();
                            setEditingField({ index: i, field: 'artist' });
                          }
                        }}
                        title="Double-click or press F2 to edit artist"
                      >
                        {perf.originalArtist || 'add artist'}
                      </button>
                    )}
                  </div>

                  <div
                    className={
                      actionsInRow
                        ? 'flex shrink-0 items-center gap-0.5'
                        : `flex shrink-0 items-center gap-0.5 ${ROW_ACTIONS_ON_DEMAND}`
                    }
                  >
                    {perf.endTimestamp !== null && (
                      <IconButton
                        label="Clear end timestamp"
                        icon="x"
                        size="sm"
                        tooltipSide="bottom"
                        onClick={(e) => {
                          e.stopPropagation();
                          onClearEndTimestamp(perf.id, i);
                        }}
                      />
                    )}
                    <IconButton
                      label="Delete song"
                      icon="trash"
                      tone="danger"
                      size="sm"
                      tooltipSide="bottom"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(perf.id, i);
                      }}
                    />
                  </div>
                </div>

                <span className="text-right font-mono text-[11px] text-fg-muted">
                  {formatTimestamp(perf.timestamp)}
                </span>
                <span
                  className={`text-right font-mono text-[11px] ${
                    perf.endTimestamp !== null ? 'text-fg-muted' : 'text-tone-warn-fg'
                  }`}
                >
                  {perf.endTimestamp !== null
                    ? formatTimestamp(perf.endTimestamp)
                    : '—'}
                </span>

                {/* Done, recording (selected and still open) or unstamped; the phone layout drops it. */}
                <span aria-hidden="true" className="hidden items-center justify-center lg:flex">
                  {stamped ? (
                    <Icon name="check" size={14} className="text-tone-ok-fg" />
                  ) : selected ? (
                    <span className="h-2 w-2 rounded-full bg-nav-active-icon" />
                  ) : (
                    <span className="h-[7px] w-[7px] rounded-full bg-tone-warn-fg" />
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
});

export default function StampEditor({ user }: { user: AuthUser }) {
  const controller = useStampEditorController(user);
  return <StampEditorView controller={controller} />;
}
