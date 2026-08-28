import { useCallback, useEffect, useState, type DependencyList } from 'react';

export interface RequestSequencer {
  next(): number;
  isCurrent(id: number): boolean;
  /** Marks a request as finished (success or failure). */
  settle(id: number): void;
  /** True while the newest request is still in flight — its result would still be applied. */
  hasPending(): boolean;
  /** Drops every in-flight request immediately: none of their results will be applied. */
  invalidate(): void;
}

/** Monotonic request ids — a response is applied only if it belongs to the newest request. */
export function createRequestSequencer(): RequestSequencer {
  let latest = 0;
  const inFlight = new Set<number>();
  return {
    next() {
      latest += 1;
      inFlight.add(latest);
      return latest;
    },
    isCurrent(id) {
      return id === latest;
    },
    settle(id) {
      inFlight.delete(id);
    },
    hasPending() {
      return inFlight.has(latest);
    },
    invalidate() {
      latest += 1;
      inFlight.clear();
    },
  };
}

export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export type LoadResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** Runs `fetcher` and hands the outcome to `onResult` only if no newer request has started since. */
export async function loadCurrent<T>(
  sequencer: RequestSequencer,
  fetcher: () => Promise<T>,
  onResult: (result: LoadResult<T>) => void,
): Promise<void> {
  const id = sequencer.next();
  try {
    const data = await fetcher();
    if (sequencer.isCurrent(id)) onResult({ ok: true, data });
  } catch (err: unknown) {
    if (sequencer.isCurrent(id)) onResult({ ok: false, error: errorMessage(err, 'Failed to load') });
  } finally {
    sequencer.settle(id);
  }
}

export interface ApiResource<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** Re-run the fetcher (form submit, "refresh" button, after a bulk action). */
  reload: () => void;
  /**
   * Patch loaded data in place after a row-level mutation. No-op before the first load.
   * If a load is still in flight, it is superseded by a fresh one so its pre-mutation
   * snapshot can never overwrite the patch.
   */
  mutate: (updater: (prev: T) => T) => void;
}

/**
 * Fetch-on-mount + refetch-on-deps with three guarantees the hand-written copies
 * lacked: stale responses are dropped, `error` resets on every new load, and
 * `reload`/`mutate` are stable callbacks. Callers list the fetcher's inputs in
 * `deps` (the fetcher itself is read fresh on each run).
 *
 * Effects run in declaration order: any effect that changes global request
 * state (e.g. `setCurrentStreamer`) must be declared before this hook, or the
 * first load will read the old value.
 */
export function useApiResource<T>(fetcher: () => Promise<T>, deps: DependencyList): ApiResource<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  // Lazy state initializer: the sequencer is built once per mount, never rebuilt on re-render.
  const [sequencer] = useState(createRequestSequencer);

  useEffect(() => {
    setLoading(true);
    setError(null);
    void loadCurrent(sequencer, fetcher, (result) => {
      if (result.ok) setData(result.data);
      else setError(result.error);
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetcher inputs are enumerated in `deps`
  }, [...deps, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const mutate = useCallback((updater: (prev: T) => T) => {
    setData((prev) => (prev === null ? prev : updater(prev)));
    // A load still in flight read the server before this mutation landed. Invalidate it
    // synchronously — `setVersion` only schedules the replacement load, and the old
    // response could arrive before that effect runs — then request a fresh load.
    if (sequencer.hasPending()) {
      sequencer.invalidate();
      setVersion((v) => v + 1);
    }
  }, [sequencer]);

  return { data, loading, error, reload, mutate };
}
