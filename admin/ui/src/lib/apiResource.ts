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
 * What one finished load produced, tagged with the request it answered: the deps
 * (by value) and the `version` those deps were loaded at.
 */
interface Resolution<T> {
  deps: readonly unknown[];
  version: number;
  data: T | null;
  error: string | null;
}

/** Compares a stored snapshot against a live deps list the way React compares deps. */
function sameDeps(snapshot: readonly unknown[], deps: DependencyList): boolean {
  return snapshot.length === deps.length && snapshot.every((value, i) => Object.is(value, deps[i]));
}

/**
 * Fetch-on-mount + refetch-on-deps with three guarantees the hand-written copies
 * lacked: stale responses are dropped, `error` resets on every new load, and
 * `reload`/`mutate` are stable callbacks. Callers list the fetcher's inputs in
 * `deps` (the fetcher itself is read fresh on each run).
 *
 * `deps` must be values React can compare — primitives, or references stable across
 * renders. That has always been the contract (React re-runs the effect whenever a
 * dep fails `Object.is`, so a value rebuilt every render refetches forever), and the
 * derivation below rests on it too: a hook fed such a value never reads as loaded,
 * because `loading` is an element-wise `Object.is` comparison against the deps a
 * resolution was requested for.
 *
 * `loading` is derived, not stored: the only state a load writes is its own
 * resolution, tagged with the deps and `version` it answers. Anything else is
 * still loading — the first render, a render whose deps have moved on, and a
 * `reload()`. So a deps change reads as loading on the render that made it,
 * instead of costing a second render just to flip the flag.
 *
 * Effects run in declaration order: any effect that changes global request
 * state (e.g. `setCurrentStreamer`) must be declared before this hook, or the
 * first load will read the old value.
 */
export function useApiResource<T>(fetcher: () => Promise<T>, deps: DependencyList): ApiResource<T> {
  const [resolution, setResolution] = useState<Resolution<T> | null>(null);
  const [version, setVersion] = useState(0);
  // Lazy state initializer: the sequencer is built once per mount, never rebuilt on re-render.
  const [sequencer] = useState(createRequestSequencer);

  useEffect(() => {
    // The request this run answers. Snapshotted by value: `deps` is a fresh array
    // every render, and the caller may reuse it.
    const requested = { deps: [...deps], version };
    void loadCurrent(sequencer, fetcher, (result) => {
      setResolution((prev) => ({
        ...requested,
        // A failed load leaves the last data on screen and reports why it is stale.
        data: result.ok ? result.data : (prev?.data ?? null),
        error: result.ok ? null : result.error,
      }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetcher inputs are enumerated in `deps`
  }, [...deps, version]);

  // A resolution answers the render in front of us only if it was requested for these
  // deps at this version. Otherwise a load is still owed — including the case where an
  // older request resolved after the deps moved on but before its replacement started.
  const resolved =
    resolution !== null && resolution.version === version && sameDeps(resolution.deps, deps)
      ? resolution
      : null;

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const mutate = useCallback((updater: (prev: T) => T) => {
    setResolution((prev) =>
      prev === null || prev.data === null ? prev : { ...prev, data: updater(prev.data) },
    );
    // A load still in flight read the server before this mutation landed. Invalidate it
    // synchronously — `setVersion` only schedules the replacement load, and the old
    // response could arrive before that effect runs — then request a fresh load.
    if (sequencer.hasPending()) {
      sequencer.invalidate();
      setVersion((v) => v + 1);
    }
  }, [sequencer]);

  return {
    // The previous deps' data stays on screen while the new ones load, as it always has;
    // `error`, by contrast, belongs to the load in front of us, so one still owed reports
    // none — a failure the deps have moved on from is not this render's news.
    data: resolution?.data ?? null,
    loading: resolved === null,
    error: resolved?.error ?? null,
    reload,
    mutate,
  };
}
