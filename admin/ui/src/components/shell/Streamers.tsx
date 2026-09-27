import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { StreamerInfo } from '../../../../shared/types';
import { api, getCurrentStreamer, setCurrentStreamer } from '../../api/client';
import { useCurrentStreamer } from '../../hooks/useCurrentStreamer';
import { listRouteFor } from '../../lib/navigation';
import { useToast } from '../ui/toast';

interface StreamersValue {
  /** The approved streamers; empty until the list loads, and after a failed load. */
  streamers: readonly StreamerInfo[];
  /** Selects `slug`, taking the page along (see StreamersProvider). */
  selectStreamer: (slug: string) => void;
}

// One stable empty list for "not loaded", and one value for every read outside a provider.
const NO_STREAMERS: readonly StreamerInfo[] = [];
const OUTSIDE_PROVIDER_VALUE: StreamersValue = { streamers: NO_STREAMERS, selectStreamer: setCurrentStreamer };

const StreamersContext = createContext<StreamersValue>(OUTSIDE_PROVIDER_VALUE);

/**
 * The shell's streamer selection. It loads the approved streamers once — the desktop sidebar stays
 * mounted (hidden) while the drawer mounts a second one, and both switchers read this one list, so
 * it is fetched, corrected and reported once. On load, a stored selection that is no longer in the
 * list (a streamer that lost approval) falls back to the first streamer and the dashboard; a failed
 * load keeps the stored selection and says so in an error toast.
 *
 * Selecting a streamer keeps the page, minus whatever names the old streamer's records
 * (`listRouteFor`). When that means a new URL, the router navigates first and the selection is
 * written only once the new location has committed: the routed pages are keyed by the streamer,
 * and a page remounting at the old URL would re-apply its `?streamer=` and undo the switch.
 */
export function StreamersProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { error: showError } = useToast();
  const [streamers, setStreamers] = useState<readonly StreamerInfo[]>(NO_STREAMERS);
  // A switch that navigated waits here for its location to commit.
  const pendingSlugRef = useRef<string | null>(null);
  const here = location.pathname + location.search;

  const switchTo = useCallback(
    (slug: string, target: string) => {
      if (target === here) {
        setCurrentStreamer(slug);
        return;
      }
      pendingSlugRef.current = slug;
      navigate(target);
    },
    [here, navigate],
  );

  // The location a switch navigated to has committed: only now may the page tree remount for the
  // new streamer. A layout effect, so the remount lands before the browser paints the old one.
  useLayoutEffect(() => {
    const pending = pendingSlugRef.current;
    if (pending === null) return;
    pendingSlugRef.current = null;
    setCurrentStreamer(pending);
  }, [location.key]);

  const selectStreamer = useCallback(
    (slug: string) => {
      if (slug !== getCurrentStreamer()) switchTo(slug, listRouteFor(here));
    },
    [here, switchTo],
  );

  const correctSelection = useEffectEvent((loaded: readonly StreamerInfo[]) => {
    const first = loaded[0];
    if (first && !loaded.some((streamer) => streamer.slug === getCurrentStreamer())) {
      switchTo(first.slug, '/');
    }
  });
  const reportFailure = useEffectEvent(() => showError('Couldn’t load streamers'));

  useEffect(() => {
    // A StrictMode remount (or an unmount) retires the first request, so it neither corrects the
    // selection nor toasts a second time.
    let current = true;
    api
      .listStreamers()
      .then((res) => {
        if (!current) return;
        setStreamers(res.data);
        correctSelection(res.data);
      })
      .catch(() => {
        if (current) reportFailure();
      });
    return () => {
      current = false;
    };
  }, []);

  const value = useMemo<StreamersValue>(() => ({ streamers, selectStreamer }), [streamers, selectStreamer]);

  return <StreamersContext.Provider value={value}>{children}</StreamersContext.Provider>;
}

/** The approved streamers and `selectStreamer`; outside a provider, no list and a plain store write. */
export function useStreamers(): StreamersValue {
  return useContext(StreamersContext);
}

/** The selected streamer's display name — or its stored slug while the list is not loaded. */
export function useCurrentStreamerName(): string {
  const slug = useCurrentStreamer();
  const { streamers } = useStreamers();
  return streamers.find((streamer) => streamer.slug === slug)?.displayName ?? slug;
}
