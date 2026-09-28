import { useCallback, useEffect, useReducer, useRef, useState, type Dispatch } from 'react';
import type { DiscoveredStream } from '../../../shared/types';
import { api, getCurrentStreamer } from '../api/client';
import { useCurrentStreamerName } from '../components/shell/Streamers';
import { Button } from '../components/ui/Button';
import { PageHeader } from '../components/ui/PageHeader';
import { Segmented } from '../components/ui/Toggles';
import { useToast } from '../components/ui/toast';
import { errorMessage } from '../lib/apiResource';
import { newStreamIds, summarizeDiscovered, type DiscoverFilter } from './pipeline-discover';
import { DiscoverStep, type DiscoverController } from './pipeline-discover-step';
import { extractReducer, initialExtractState, type ExtractAction } from './pipeline-extract-state';
import { ExtractStep, type ExtractController } from './pipeline-extract-step';

// --- Discover ---

const NO_SELECTION: ReadonlySet<string> = new Set();

/**
 * The Discover step's state and handlers. The page holds them rather than the step, so a trip to
 * Extract keeps the scan, the filter and the selection. `onImported` runs after a successful import.
 */
function useDiscover(onImported: () => void): DiscoverController {
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

// --- Extract ---

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
