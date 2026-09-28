import { useCallback, useEffect, useId, useReducer, useRef, useState, type Dispatch, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type {
  CandidateComment,
  DiscoveredStream,
  PasteImportParsedSong,
  StreamCredit,
} from '../../../shared/types';
import { parseTextToSongs } from '../../../shared/parse';
import { api, ApiError, getCurrentStreamer } from '../api/client';
import { useCurrentStreamerName } from '../components/shell/Streamers';
import { BulkBar } from '../components/ui/BulkBar';
import { Button } from '../components/ui/Button';
import { EmptyState, GlassCard } from '../components/ui/Display';
import { Checkbox } from '../components/ui/Fields';
import { Icon } from '../components/ui/Icon';
import { PageHeader } from '../components/ui/PageHeader';
import { Pill } from '../components/ui/Pill';
import { HeadCell, Table, TableEmptyRow, THead } from '../components/ui/Table';
import { CELL_X, FIRST_CELL_X, LAST_CELL_X } from '../components/ui/table-cells';
import { Chip, Segmented } from '../components/ui/Toggles';
import { useToast } from '../components/ui/toast';
import { useNow } from '../hooks/useNow';
import { errorMessage } from '../lib/apiResource';
import { formatRelative } from '../lib/dates';
import { formatTimestamp } from '../lib/format-timestamp';
import {
  inPrismLabel,
  newStreamIds,
  summarizeDiscovered,
  visibleDiscovered,
  type DiscoverFilter,
} from './pipeline-discover';
import {
  extractReducer,
  initialExtractState,
  type EditableParsedSong,
  type ExtractAction,
  type ExtractState,
} from './pipeline-extract-state';

// --- Discover ---

const NO_SELECTION: ReadonlySet<string> = new Set();
/** Select, thumbnail, video, date, status. */
const DISCOVER_COLUMNS = 5;

/** A failed scan, inline above the results. */
function DangerNote({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-radius-lg border border-tone-danger-line bg-tone-danger-bg px-3 py-2 text-token-sm text-tone-danger-fg"
    >
      {children}
    </p>
  );
}

/**
 * The Discover step's state and handlers. The page holds them rather than the step, so a trip to
 * Extract keeps the scan, the filter and the selection. `onImported` runs after a successful import.
 */
function useDiscover(onImported: () => void) {
  const toast = useToast();
  const streamerName = useCurrentStreamerName();
  const [streams, setStreams] = useState<DiscoveredStream[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(NO_SELECTION);
  const [filter, setFilter] = useState<DiscoverFilter>('new');
  /** When the last scan succeeded; `null` until one has. */
  const [lastRunAt, setLastRunAt] = useState<number | null>(null);
  // Whether the page is still up: a streamer switch remounts it, and the curator can leave while an
  // import is in flight. The import still reports; only a page still here reloads and scans after it.
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Every scan — the first, Discover again, and the one after an import — starts from the same
  // place: the New filter when it found anything new (All otherwise), and every new video selected.
  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.discoverStreams();
      setStreams(res.streams);
      setSelected(newStreamIds(res.streams));
      setFilter(summarizeDiscovered(res.streams).fresh > 0 ? 'new' : 'all');
      setLastRunAt(Date.now());
    } catch (err) {
      setError(errorMessage(err, 'Failed to discover streams'));
    } finally {
      setLoading(false);
    }
  };

  // Retry sends the same videos again: the import skips any that are in Prism by then.
  const importStreams = async (videoIds: string[]) => {
    if (videoIds.length === 0) return;
    // The streamer these videos belong to: the one the client names as this request goes out. The
    // failure toast lives above the streamer-keyed pages and outlasts a switch, and the client
    // names whoever is current when a request is sent, so a Retry checks it is still this one.
    const streamer = getCurrentStreamer();
    setImporting(true);
    try {
      const res = await api.importStreams({ videoIds });
      toast.success(`Imported ${res.created} stream(s)`);
      setSelected(NO_SELECTION);
    } catch (err) {
      const retry = () => {
        if (getCurrentStreamer() === streamer) {
          void importStreams(videoIds);
          return;
        }
        // Refused, not dropped: back on the import's streamer, this Retry sends it.
        toast.error(`Switch back to ${streamerName} to retry this import`, {
          action: { label: 'Retry', onClick: retry },
        });
      };
      toast.error('Couldn’t import streams', {
        detail: errorMessage(err, 'Failed to import'),
        action: { label: 'Retry', onClick: retry },
      });
      return;
    } finally {
      setImporting(false);
    }
    // A scan spends YouTube quota: none for a page that has gone.
    if (!mounted.current) return;
    // The imported streams are pending ones: the Extract step's list. Then scan again, so the
    // imported videos show as In Prism.
    onImported();
    await run();
  };

  const setStreamSelected = (videoId: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(videoId);
      else next.delete(videoId);
      return next;
    });
  };

  return {
    streams,
    loading,
    importing,
    error,
    selected,
    filter,
    lastRunAt,
    run,
    setFilter,
    setStreamSelected,
    /** Every new video, whether the filter shows it or not — or none. */
    setAllNewSelected: (all: boolean) => setSelected(all ? newStreamIds(streams) : NO_SELECTION),
    clearSelection: () => setSelected(NO_SELECTION),
    importSelected: () => importStreams([...selected]),
  };
}

type DiscoverController = ReturnType<typeof useDiscover>;

/** `Scanned …`: its own component, so the 30 s tick re-renders this text and nothing else. */
function ScannedAgo({ at }: { at: number }) {
  const now = useNow(30_000);
  return <>Scanned {formatRelative(at, now)}</>;
}

function ScanStat({ value, label }: { value: number; label: string }) {
  return (
    <span className="whitespace-nowrap text-[12px] text-fg-muted">
      <b className="font-[750] text-fg">{value}</b> {label}
    </span>
  );
}

interface ScanSummaryProps {
  lastRunAt: number;
  counts: { total: number; fresh: number; existing: number };
  filter: DiscoverFilter;
  onFilterChange: (filter: DiscoverFilter) => void;
}

/** The strip above the table: when the channel was scanned, what the scan found, and the filter chips. */
function ScanSummary({ lastRunAt, counts, filter, onFilterChange }: ScanSummaryProps) {
  return (
    <GlassCard padding="none" className="flex flex-wrap items-center gap-x-2.5 gap-y-2 px-3.5 py-2.5">
      <span className="flex items-center gap-1.5 whitespace-nowrap text-[12px] text-fg-muted">
        <Icon name="check" size={14} className="text-tone-ok-fg" />
        <ScannedAgo at={lastRunAt} />
      </span>
      <span aria-hidden="true" className="h-4 w-px bg-field-line" />
      <ScanStat value={counts.total} label="videos found" />
      <ScanStat value={counts.fresh} label="new" />
      <ScanStat value={counts.existing} label="already in Prism" />
      <div role="group" aria-label="Filter videos" className="flex flex-wrap items-center gap-2 sm:ml-auto">
        <Chip active={filter === 'new'} count={counts.fresh} onClick={() => onFilterChange('new')}>
          New
        </Chip>
        <Chip active={filter === 'existing'} count={counts.existing} onClick={() => onFilterChange('existing')}>
          Already in Prism
        </Chip>
        <Chip active={filter === 'all'} count={counts.total} onClick={() => onFilterChange('all')}>
          All
        </Chip>
      </div>
    </GlassCard>
  );
}

interface DiscoverRowProps {
  stream: DiscoveredStream;
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
}

/** One video: a checkbox when it is new, thumbnail, title and video ID, date, and where it stands. */
function DiscoverRow({ stream, selected, onSelectedChange }: DiscoverRowProps) {
  const name = stream.title || stream.videoId;
  return (
    <tr className={`h-[50px] border-b border-line-soft transition-colors ${selected ? 'bg-selected' : 'hover:bg-field'}`}>
      <td className={`${FIRST_CELL_X} py-1.5`}>
        {stream.isNew ? (
          // A flex box, so the inline label does not sit on the text baseline above the row's middle.
          <div className="flex">
            <Checkbox label={`Select stream ${name}`} checked={selected} onChange={onSelectedChange} />
          </div>
        ) : null}
      </td>
      <td className={`${CELL_X} py-1.5`}>
        {/* Decorative: the title and the video ID beside it carry the meaning. */}
        <img
          src={`https://i.ytimg.com/vi/${stream.videoId}/mqdefault.jpg`}
          alt=""
          width={64}
          height={36}
          loading="lazy"
          className="block h-9 w-16 rounded-radius-sm bg-track object-cover"
        />
      </td>
      <td className={`${CELL_X} py-1.5`}>
        <div title={stream.title} className="truncate font-semibold text-fg">
          {stream.title}
        </div>
        <a
          href={`https://www.youtube.com/watch?v=${stream.videoId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-radius-xs font-mono text-meta text-fg-subtle hover:text-accent-fg hover:underline focus-visible:outline-none focus-visible:shadow-focus"
        >
          {stream.videoId}
        </a>
      </td>
      <td className={`${CELL_X} whitespace-nowrap py-1.5 text-fg-muted`}>{stream.date}</td>
      <td className={`${LAST_CELL_X} py-1.5`}>
        {stream.isNew ? (
          <Pill tone="info">New</Pill>
        ) : (
          <div className="flex items-center gap-2">
            <Pill tone="neutral">{inPrismLabel(stream)}</Pill>
            {stream.existingStreamId ? (
              <Link
                to={`/streams/${stream.existingStreamId}`}
                className="inline-flex items-center gap-0.5 rounded-radius-xs text-[11px] font-[650] text-accent-fg hover:underline focus-visible:outline-none focus-visible:shadow-focus"
              >
                Open
                <span className="sr-only"> {name}</span>
                <Icon name="chevronRight" size={12} />
              </Link>
            ) : null}
          </div>
        )}
      </td>
    </tr>
  );
}

interface DiscoverTableProps {
  streams: DiscoveredStream[];
  selected: ReadonlySet<string>;
  /** False when the scan found nothing new: Select all has nothing to select. */
  hasNew: boolean;
  allNewSelected: boolean;
  /** Checked: select every new video, the ones the filter hides too. Unchecked: select none. */
  onAllNewSelectedChange: (all: boolean) => void;
  onSelectedChange: (videoId: string, selected: boolean) => void;
}

/**
 * The scanned videos under the current filter, in a glass card. Fixed layout: from 1280 px it fits
 * the card and a long title is cut short (full text in `title`); below that it keeps a minimum
 * width and scrolls inside the card. The card clips with `overflow-clip`, which unlike hidden/auto
 * is no scroll container, so the sticky head keeps tracking `<main>`.
 */
function DiscoverTable({
  streams,
  selected,
  hasNew,
  allNewSelected,
  onAllNewSelectedChange,
  onSelectedChange,
}: DiscoverTableProps) {
  return (
    <GlassCard padding="none" className="overflow-clip">
      <Table className="table-fixed text-[12px] max-xl:min-w-[640px]">
        {/* The status column holds the longest pill, `In Prism · Extracted`, and Open on one line. */}
        <colgroup>
          <col className="w-[38px]" />
          <col className="w-[76px]" />
          <col />
          <col className="w-[92px]" />
          <col className="w-[190px]" />
        </colgroup>
        <THead>
          <tr>
            <HeadCell className={FIRST_CELL_X}>
              <div className="flex">
                <Checkbox
                  label="Select all new streams"
                  checked={allNewSelected}
                  disabled={!hasNew}
                  onChange={onAllNewSelectedChange}
                />
              </div>
            </HeadCell>
            <HeadCell className={CELL_X}>
              <span className="sr-only">Thumbnail</span>
            </HeadCell>
            <HeadCell className={CELL_X}>Video</HeadCell>
            <HeadCell className={CELL_X}>Date</HeadCell>
            <HeadCell className={LAST_CELL_X}>Status</HeadCell>
          </tr>
        </THead>
        <tbody>
          {streams.map((stream) => (
            <DiscoverRow
              key={stream.videoId}
              stream={stream}
              selected={selected.has(stream.videoId)}
              onSelectedChange={(checked) => onSelectedChange(stream.videoId, checked)}
            />
          ))}
          {streams.length === 0 ? (
            <TableEmptyRow colSpan={DISCOVER_COLUMNS}>No videos under this filter.</TableEmptyRow>
          ) : null}
        </tbody>
      </Table>
    </GlassCard>
  );
}

/**
 * Step 1: scan the streamer's channel, then import the new videos as pending streams. `hidden`
 * hides the step without unmounting it. Its bulk bar is `fixed`, so it leaves with the step
 * instead: mounted, it would keep marking `<html>` (the toast lift, the page padding) under Extract.
 */
function DiscoverStep({ hidden, discover }: { hidden: boolean; discover: DiscoverController }) {
  const streamerName = useCurrentStreamerName();
  const { streams, loading, importing, error, selected, filter, lastRunAt } = discover;
  const counts = summarizeDiscovered(streams);
  const allNewSelected = counts.fresh > 0 && streams.every((stream) => !stream.isNew || selected.has(stream.videoId));

  return (
    <section aria-label="Discover" hidden={hidden}>
      {/* While the bulk bar is up, the end of the step scrolls clear of it (BulkBar publishes its height). */}
      <div className="flex flex-col gap-3 p-4 lg:px-5 lg:pb-[18px] [html[data-bulk-bar]_&]:pb-[calc(var(--bulk-bar-h)_+_22px_+_16px)]">
        {error ? <DangerNote>{error}</DangerNote> : null}

        {lastRunAt === null ? (
          <GlassCard>
            <EmptyState
              icon="workflow"
              title="Find new karaoke streams"
              body={`Scans ${streamerName}'s YouTube channel for karaoke streams.`}
              action={
                <Button variant="primary" busy={loading} onClick={() => void discover.run()}>
                  Discover streams
                </Button>
              }
            />
          </GlassCard>
        ) : streams.length === 0 ? (
          <GlassCard>
            <EmptyState
              icon="workflow"
              title="No videos found"
              body="Nothing on the channel looks like a karaoke stream yet."
            />
          </GlassCard>
        ) : (
          <>
            <ScanSummary lastRunAt={lastRunAt} counts={counts} filter={filter} onFilterChange={discover.setFilter} />
            <DiscoverTable
              streams={visibleDiscovered(streams, filter)}
              selected={selected}
              hasNew={counts.fresh > 0}
              allNewSelected={allNewSelected}
              onAllNewSelectedChange={discover.setAllNewSelected}
              onSelectedChange={discover.setStreamSelected}
            />
          </>
        )}
      </div>

      {!hidden && selected.size > 0 ? (
        <BulkBar countLabel={`已選 ${selected.size} 部新影片`}>
          <Button
            variant="primary"
            size="sm"
            icon="download"
            busy={importing}
            onClick={() => void discover.importSelected()}
          >
            Import as pending streams
          </Button>
          <Button variant="ghost" size="sm" onClick={discover.clearSelection}>
            Clear
          </Button>
        </BulkBar>
      ) : null}
    </section>
  );
}

// --- Candidate Card ---

function CandidateCard({
  candidate: c,
  isActive,
  onUse,
}: {
  candidate: CandidateComment;
  isActive: boolean;
  onUse: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const lineCount = c.text.split('\n').length;
  const isLong = lineCount > 6 || c.text.length > 300;

  return (
    <div
      className={`rounded-lg border p-3 ${
        isActive ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="text-sm font-medium text-slate-700">{c.author}</span>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
            <span>{c.likes} likes</span>
            <span>{c.timestampCount} ts</span>
            {c.isPinned && (
              <span className="inline-flex rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                PIN
              </span>
            )}
          </div>
        </div>
        {isActive ? (
          <span className="shrink-0 rounded bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700">
            Active
          </span>
        ) : (
          <button
            onClick={onUse}
            className="shrink-0 rounded bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-200"
          >
            Use This
          </button>
        )}
      </div>
      <div className="relative">
        <pre
          className={`mt-2 whitespace-pre-wrap text-xs text-slate-500 ${
            expanded ? 'max-h-[60vh] overflow-y-auto' : 'max-h-28 overflow-hidden'
          }`}
        >
          {c.text}
        </pre>
        {!expanded && isLong && (
          <div
            className={`pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t to-transparent ${
              isActive ? 'from-blue-50' : 'from-white'
            }`}
          />
        )}
      </div>
      {isLong && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-xs font-medium text-blue-600 hover:underline"
        >
          {expanded ? '▲ Collapse' : `▼ Show all ${lineCount} lines`}
        </button>
      )}
    </div>
  );
}

// --- Extract ---

/** The Extract step's state. The page holds it, so a trip to Discover keeps the extract and its edits. */
interface ExtractController {
  state: ExtractState;
  dispatch: Dispatch<ExtractAction>;
  /** Loads the ready-to-extract list again after a failed load. */
  retryStreams: () => void;
}

/** Loads the streams waiting for extraction. A retired request (`isCurrent()` false) dispatches nothing. */
function loadReadyStreams(dispatch: Dispatch<ExtractAction>, isCurrent: () => boolean): void {
  api.listStreams({ status: 'pending' }).then(
    (res) => {
      if (!isCurrent()) return;
      dispatch({ type: 'streamsLoaded', streams: res.data });
      dispatch({ type: 'streamsLoadingFinished' });
    },
    (err: unknown) => {
      if (isCurrent()) dispatch({ type: 'streamsFailed', error: errorMessage(err, 'Failed to load streams') });
    },
  );
}

/**
 * The Extract step's state, which the page holds like Discover's. The ready-to-extract list loads
 * on mount and again after Discover imports streams (they arrive pending: what the list holds).
 */
function useExtract(): ExtractController & { reloadStreams: () => void } {
  const [state, dispatch] = useReducer(extractReducer, initialExtractState);
  // Numbers the list requests: a response applies only while its number is still the latest.
  // Unmounting bumps it too (StrictMode's rehearsal included), retiring whatever is in flight.
  const latestRequest = useRef(0);

  const reloadStreams = useCallback(() => {
    latestRequest.current += 1;
    const request = latestRequest.current;
    loadReadyStreams(dispatch, () => latestRequest.current === request);
  }, []);

  useEffect(() => {
    reloadStreams();
    return () => {
      latestRequest.current += 1;
    };
  }, [reloadStreams]);

  return {
    state,
    dispatch,
    retryStreams: () => {
      dispatch({ type: 'streamsRequested' });
      reloadStreams();
    },
    reloadStreams,
  };
}

function useIdentifySongs() {
  const songIdPrefix = useId();
  const nextSongId = useRef(0);

  return (songs: PasteImportParsedSong[]): EditableParsedSong[] =>
    songs.map((song) => ({
      ...song,
      clientId: `${songIdPrefix}-${nextSongId.current++}`,
    }));
}

/** Step 2: find a stream's timestamp list, edit the parsed songs and import them. `hidden` hides it without unmounting it. */
function ExtractStep({ hidden, extract }: { hidden: boolean; extract: ExtractController }) {
  const { state, dispatch } = extract;
  const {
    streams,
    selectedStreamId,
    loading,
    loadingStreams,
    error,
    extractResult,
    editedSongs,
    importStatus,
    importing,
  } = state;
  const creditRef = useRef<StreamCredit | null>(null);
  const identifySongs = useIdentifySongs();

  const handleExtract = async (streamId?: string) => {
    const id = streamId ?? selectedStreamId;
    if (!id) return;
    dispatch({ type: 'extractStarted', streamId: id });
    try {
      const res = await api.extractTimestamps(id);
      const identifiedSongs = identifySongs(res.parsedSongs);
      creditRef.current = res.credit;
      dispatch({ type: 'extractSucceeded', result: res, editedSongs: identifiedSongs });
    } catch (err) {
      dispatch({
        type: 'extractFailed',
        error: err instanceof Error ? err.message : 'Failed to extract',
      });
    }
  };

  const handleUseCandidate = (candidateText: string, candidateAuthor: string, candidateId: string) => {
    const parsed = parseTextToSongs(candidateText);
    const identifiedSongs = identifySongs(parsed);
    const selectedStream = streams.find((s) => s.id === selectedStreamId);
    creditRef.current = {
      author: candidateAuthor,
      commentUrl: `https://www.youtube.com/watch?v=${selectedStream?.videoId}&lc=${candidateId}`,
    };
    dispatch({
      type: 'candidateSelected',
      candidateId,
      parsedSongs: parsed,
      editedSongs: identifiedSongs,
    });
  };

  const updateSong = (index: number, field: keyof PasteImportParsedSong, value: string | number) => {
    dispatch({ type: 'songUpdated', index, field, value });
  };

  const removeSong = (index: number) => {
    dispatch({ type: 'songRemoved', index });
  };

  const handleImport = async (replace = false, creditSnapshot = creditRef.current) => {
    if (!selectedStreamId || editedSongs.length === 0) return;
    dispatch({ type: 'importStarted' });
    try {
      const res = await api.extractImport({
        streamId: selectedStreamId,
        songs: editedSongs.map((s) => ({
          songName: s.songName,
          artist: s.artist,
          startSeconds: s.startSeconds,
          endSeconds: s.endSeconds,
        })),
        credit: creditSnapshot ?? undefined,
        replace,
      });
      dispatch({ type: 'importSucceeded', status: `Imported ${res.created} song(s)` });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const ok = window.confirm(`${err.message}\n\nDo you want to replace the existing songs?`);
        if (ok) {
          dispatch({ type: 'importFinished' });
          return handleImport(true, creditSnapshot);
        }
      } else {
        dispatch({
          type: 'importFailed',
          error: err instanceof Error ? err.message : 'Failed to import',
        });
      }
    } finally {
      dispatch({ type: 'importFinished' });
    }
  };

  return (
    // Padding only, no display utility: one would outrank the `hidden` attribute's display: none.
    // The studio frame gives the page no gutter, so the step brings its own.
    <section aria-label="Extract" hidden={hidden} className="p-4 lg:px-5">
      {/* Two-column layout: stream table (left) + candidates panel (right) */}
      <div className="flex gap-4">
        {/* Left column: Stream selector table */}
        <div className="flex-1 min-w-0">
          {loadingStreams ? (
            <span className="text-sm text-slate-500">Loading streams...</span>
          ) : streams.length === 0 ? (
            <p className="text-sm text-slate-500">No streams ready</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3 w-8">#</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Title</th>
                    <th className="px-4 py-3 w-28">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {streams.map((s, i) => (
                    <tr
                      key={s.id}
                      className={selectedStreamId === s.id && (loading || extractResult) ? 'bg-blue-50' : 'hover:bg-slate-50'}
                    >
                      <td className="px-4 py-3 text-slate-400">{i + 1}</td>
                      <td className="px-4 py-3 text-slate-600">{s.date}</td>
                      <td className="px-4 py-3 font-medium">
                        <a
                          href={`https://www.youtube.com/watch?v=${s.videoId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline"
                        >
                          {s.title}
                        </a>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleExtract(s.id)}
                          disabled={loading}
                          className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          {loading && selectedStreamId === s.id ? 'Extracting...' : 'Extract'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right column: Candidates panel — sticky so it follows scroll; self-start
            un-stretches the flex item, otherwise sticky has no room to slide */}
        <div className="sticky top-4 max-h-[calc(100vh-2rem)] w-96 shrink-0 self-start overflow-y-auto">
          {!extractResult && !loading ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-400">
              Select a stream and click Extract
            </div>
          ) : loading ? (
            <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
              Extracting...
            </div>
          ) : extractResult && (
            <div className="space-y-3">
              {/* Source indicator */}
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <h4 className="text-xs font-medium uppercase text-slate-500">Source</h4>
                {extractResult.source === 'comment' && extractResult.candidateComment && (
                  <p className="mt-1 text-sm text-slate-600">
                    <span className="font-medium">Comment</span> by{' '}
                    <span className="font-medium">{extractResult.candidateComment.author}</span>
                  </p>
                )}
                {extractResult.source === 'description' && (
                  <p className="mt-1 text-sm text-slate-600">Video description</p>
                )}
                {extractResult.source === null && (
                  <p className="mt-1 text-sm text-amber-600">No timestamps found</p>
                )}
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}
              {importStatus && <p className="text-sm text-green-600">{importStatus}</p>}

              {/* All candidates */}
              {extractResult.allCandidates.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-medium uppercase text-slate-500">
                    Candidates ({extractResult.allCandidates.length})
                  </h4>
                  {extractResult.allCandidates.map((c) => (
                    <CandidateCard
                      key={c.commentId}
                      candidate={c}
                      isActive={c.commentId === extractResult.candidateComment?.commentId}
                      onUse={() => handleUseCandidate(c.text, c.author, c.commentId)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Error/status outside two-column when no extractResult (e.g. extraction error) */}
      {!extractResult && error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {!extractResult && importStatus && <p className="mt-3 text-sm text-green-600">{importStatus}</p>}

      {/* Parsed songs table — full width below */}
      {editedSongs.length > 0 && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h4 className="text-sm font-medium text-slate-700">
              Parsed Songs ({editedSongs.length})
            </h4>
            <button
              onClick={() => handleImport()}
              disabled={importing || editedSongs.length === 0}
              className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              {importing ? 'Importing...' : `Import ${editedSongs.length} Songs`}
            </button>
          </div>
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2 w-8">#</th>
                <th className="px-4 py-2">Start</th>
                <th className="px-4 py-2">End</th>
                <th className="px-4 py-2">Title</th>
                <th className="px-4 py-2">Artist</th>
                <th className="px-4 py-2 w-8"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {editedSongs.map((song, i) => (
                <tr key={song.clientId} className="hover:bg-slate-50">
                  <td className="px-4 py-2 text-slate-400">{i + 1}</td>
                  <td className="px-4 py-2 text-slate-600 font-mono text-xs">
                    {formatTimestamp(song.startSeconds)}
                  </td>
                  <td className="px-4 py-2 text-slate-600 font-mono text-xs">
                    {song.endSeconds !== null
                      ? formatTimestamp(song.endSeconds)
                      : '—'}
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="text" aria-label={`Song ${i + 1} title`}
                      value={song.songName}
                      onChange={(e) => updateSong(i, 'songName', e.target.value)}
                      className="w-full rounded border border-slate-200 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="text" aria-label={`Song ${i + 1} artist`}
                      value={song.artist}
                      onChange={(e) => updateSong(i, 'artist', e.target.value)}
                      className="w-full rounded border border-slate-200 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <button
                      onClick={() => removeSong(i)}
                      className="text-red-400 hover:text-red-600"
                      title="Remove"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// --- Pipeline Page ---

/**
 * Discover, then Extract: two steps in the header, both mounted at all times — the inactive one is
 * only `hidden` — and the page holds both steps' state, so switching never loses a scan, a
 * selection or an extract in progress. The streams ready for extraction load on mount, so the
 * Extract step counts them in the header before it is ever opened, and again after each import.
 */
export default function Pipeline() {
  const [step, setStep] = useState<'discover' | 'extract'>('discover');
  const extract = useExtract();
  const discover = useDiscover(extract.reloadStreams);
  const { loadingStreams, streamsError, streams: readyStreams } = extract.state;
  const readyCount = !loadingStreams && streamsError === null ? readyStreams.length : undefined;

  return (
    // No blur, transform or filter on this root (the bulk bar is `fixed` to the viewport), and no
    // overflow either: the sticky header and table head track <main>.
    <div className="flex flex-col">
      <PageHeader
        crumb="TIMESTAMPS"
        title="Pipeline"
        actions={
          step === 'discover' ? (
            <Button variant="primary" icon="refresh" busy={discover.loading} onClick={() => void discover.run()}>
              {discover.lastRunAt === null ? 'Discover streams' : 'Discover again'}
            </Button>
          ) : (
            <span className="text-token-sm text-fg-muted">Finds timestamp lists in comments and descriptions</span>
          )
        }
      >
        <Segmented
          label="Pipeline steps"
          value={step}
          onChange={setStep}
          options={[
            { value: 'discover', label: 'Discover', step: 1 },
            { value: 'extract', label: 'Extract', step: 2, count: readyCount },
          ]}
        />
      </PageHeader>

      <DiscoverStep hidden={step !== 'discover'} discover={discover} />
      <ExtractStep hidden={step !== 'extract'} extract={extract} />
    </div>
  );
}
