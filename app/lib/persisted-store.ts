import { useSyncExternalStore } from 'react';
import { saveJsonToStorage, type StorageSaveResult } from './playlist-storage';

export interface PersistedStoreOptions<T> {
  key: string;
  storage?: () => Storage | null;
  fallback: T;
  parse: (raw: unknown) => T;
  serialize?: (value: T) => unknown;
  /**
   * 'required' (default): the in-memory value changes only after a
   * successful write — right for data the user must not believe is saved
   * when it is not.
   * 'best-effort': the in-memory value always changes and listeners are
   * notified regardless of whether the write succeeded (the write result is
   * still returned) — right for volatile UI settings, where freezing the UI
   * on a storage failure is worse than not persisting.
   */
  persist?: 'required' | 'best-effort';
  /** Injectable cross-tab serialization and event source for deterministic tests. */
  locks?: Pick<LockManager, 'request'> | null;
  /** null disables external refreshes, including on UI resubscription. */
  events?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
}

export interface PersistedStore<T> {
  getSnapshot: () => T;
  getServerSnapshot: () => T;
  subscribe: (listener: () => void) => () => void;
  available: boolean;
  update: (updater: (prev: T) => T) => StorageSaveResult;
  updateExclusive: (updater: (prev: T) => T, validate?: (prev: T) => string | undefined) => Promise<StorageSaveResult>;
}

const PROBE_KEY = '__prism_ls_test__';

function probe(storage: Storage | null): boolean {
  if (!storage) return false;
  try {
    storage.setItem(PROBE_KEY, '1');
    storage.removeItem(PROBE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function getLocalStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null; // access itself throws when storage is disabled
  }
}

export function getSessionStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

const STORAGE_UNAVAILABLE = '您的瀏覽器不支援本機儲存';

/**
 * One storage key as an external store. Loading is a lazy client-side read
 * (never an effect + setState), writes are functional updates persisted
 * synchronously before listeners fire, and the server snapshot is `fallback`
 * so SSR and hydration never touch storage.
 */
export function createPersistedStore<T>(options: PersistedStoreOptions<T>): PersistedStore<T> {
  const { key, fallback, parse } = options;
  const serialize = options.serialize ?? ((value: T) => value);
  const persist = options.persist ?? 'required';
  const storage = (options.storage ?? getLocalStorage)();
  const available = probe(storage);
  const listeners = new Set<() => void>();
  // `loaded` (not a sentinel on snapshot's value) tracks whether storage has
  // been read yet, so a genuinely loaded `undefined` value — valid for any T
  // that includes it — isn't mistaken for "not loaded" and reloaded forever.
  let snapshot: T = fallback;
  let loaded = false;
  let dirty = false;
  const events = options.events === undefined ? (typeof window === 'undefined' ? null : window) : options.events;
  const locks = options.locks === undefined ? (typeof navigator === 'undefined' ? null : navigator.locks) : options.locks;

  const load = (): T => {
    if (!storage) return fallback;
    try {
      const raw = storage.getItem(key);
      return raw === null ? fallback : parse(JSON.parse(raw));
    } catch {
      return fallback;
    }
  };

  const notify = () => { for (const listener of listeners) listener(); };
  const refresh = (event: StorageEvent) => {
    if (event.storageArea !== storage || (event.key !== key && event.key !== null)) return;
    snapshot = load();
    loaded = true;
    dirty = false;
    notify();
  };
  const update = (updater: (prev: T) => T, validate?: (prev: T) => string | undefined): StorageSaveResult => {
    // A render snapshot is not a write base: another tab may have committed
    // since our last storage event. Preserve best-effort unsaved UI state only.
    const current = dirty ? snapshot : load();
    const error = validate?.(current);
    if (error) return { success: false, error };
    const next = updater(current);
    const saved: StorageSaveResult = storage
      ? saveJsonToStorage(storage, key, serialize(next))
      : { success: false, error: STORAGE_UNAVAILABLE };
    if (!saved.success && persist === 'required') return saved;
    snapshot = next;
    loaded = true;
    dirty = !saved.success;
    notify();
    return saved;
  };

  return {
    available,
    getServerSnapshot: () => fallback,
    getSnapshot: () => {
      if (!loaded) {
        snapshot = load();
        loaded = true;
      }
      return snapshot;
    },
    subscribe: (listener) => {
      if (listeners.size === 0) {
        events?.addEventListener('storage', refresh);
        // Catch a write between construction/render and subscribing, or while
        // nobody was subscribed. useSyncExternalStore rechecks after subscribe.
        // Explicitly tab-local stores must keep their loaded active state.
        if (!dirty && (options.events !== null || !loaded)) { snapshot = load(); loaded = true; }
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) events?.removeEventListener('storage', refresh);
      };
    },
    update,
    updateExclusive: async (updater, validate) => {
      try {
        // Evergreen browsers on HTTPS provide Web Locks. Older/non-secure
        // clients still re-read before writing, but cannot guarantee exclusion.
        return locks
          ? await locks.request(`prism:storage:${key}`, () => update(updater, validate))
          : update(updater, validate);
      } catch {
        return { success: false, error: STORAGE_UNAVAILABLE };
      }
    },
  };
}

export function usePersistedStore<T>(store: PersistedStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
}
