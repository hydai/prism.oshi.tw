import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import type { ListResponse } from '../../../../shared/types';
import { api } from '../../api/client';
import { useApiResource, type ApiResource } from '../../lib/apiResource';
import { countByStatus } from '../../lib/status-totals';

/**
 * Pending counts for the sidebar's three review inboxes. `null` means unknown — either the list
 * hasn't loaded yet or its last load failed — never a stale or partial number.
 */
export type InboxCounts = { nova: number | null; vods: number | null; crystal: number | null };

/**
 * Where one inbox's list load stands, as `useApiResource` reports it: `loading` while a load is in
 * flight (a reload included, which keeps the count it had), and why the last load failed, or `null`
 * when it did not.
 */
interface InboxLoad {
  loading: boolean;
  error: string | null;
}

/** Reloads the named inbox's list, or all three when called without a name. */
type RefreshInboxCounts = (inbox?: keyof InboxCounts) => void;

type InboxCountsValue = InboxCounts & { loads: Record<keyof InboxCounts, InboxLoad>; refresh: RefreshInboxCounts };

const InboxCountsContext = createContext<InboxCountsValue | null>(null);

/** Nothing in flight, and no failure. */
const SETTLED: InboxLoad = { loading: false, error: null };

// One stable object for every call outside a provider. Module-private, not exported: a .tsx that
// exports components must export no other runtime value (react-doctor only-export-components).
const OUTSIDE_PROVIDER_VALUE: InboxCountsValue = {
  nova: null,
  vods: null,
  crystal: null,
  loads: { nova: SETTLED, vods: SETTLED, crystal: SETTLED },
  refresh: () => {},
};

/**
 * A list's pending count, or `null` if it hasn't loaded yet or its last load failed. `error` is
 * checked before `data`: `useApiResource` keeps a failed reload's previous data on screen (so an
 * already-loaded page doesn't blank out), which would otherwise make a refresh that fails after an
 * earlier success keep reporting the stale count instead of falling back to unknown. The check is
 * `!== null`, not truthiness, because the error slot is `null` exactly when the last load
 * succeeded — that identity is what should decide the count, not whatever the message says.
 */
function pendingCount<T extends { status: string }>(resource: ApiResource<ListResponse<T>>): number | null {
  if (resource.error !== null) return null;
  if (!resource.data) return null;
  return countByStatus(resource.data.data, 'pending');
}

/**
 * Loads the three review inboxes — Nova streamer submissions, Nova VOD submissions, Crystal
 * tickets — once on mount and exposes each one's pending count, each one's load state (`loads`),
 * and `refresh` to `useInboxCounts()`. None of the three lists are scoped to the selected streamer,
 * so none take deps. A failed load is silent: it yields `null` for that count only, never a toast or
 * a thrown error — the sidebar badge is a convenience, not a page a curator is actively working
 * from, so a transient failure (or a 403 for a contributor on a curator-only list) should not
 * interrupt them. `loads` lets a page that shows the counts as its own, the Dashboard's Inbox card,
 * say which list is still loading or has failed, and retry that one. The returned value keeps a
 * stable identity while every count, every load state and `refresh` are unchanged, so a consumer
 * that only reads `useInboxCounts()` re-renders only when one of them actually changes.
 *
 * The inbox pages load their own copy of these lists, so after every action that can change a
 * pending count — a review, a delete, a Crystal reply or status change — and on their own reload,
 * they call `refresh` with their inbox's name; nothing else reloads a count.
 */
export function InboxCountsProvider({ children }: { children: ReactNode }) {
  const novaResource = useApiResource(api.listNovaSubmissions, []);
  const vodsResource = useApiResource(api.listNovaVods, []);
  const crystalResource = useApiResource(api.listCrystalTickets, []);

  const nova = pendingCount(novaResource);
  const vods = pendingCount(vodsResource);
  const crystal = pendingCount(crystalResource);

  // Destructured to plain locals so the deps array below lists simple identifiers: `reload` is
  // stable for the lifetime of each `useApiResource` call, but the resource objects that hold
  // them are fresh literals every render (their `data`/`error` change often), so depending on the
  // objects themselves would rebuild `refresh` — and so the memoized value below — on every render.
  const { reload: reloadNova } = novaResource;
  const { reload: reloadVods } = vodsResource;
  const { reload: reloadCrystal } = crystalResource;
  const refresh = useCallback<RefreshInboxCounts>(
    (inbox) => {
      if (inbox === undefined || inbox === 'nova') reloadNova();
      if (inbox === undefined || inbox === 'vods') reloadVods();
      if (inbox === undefined || inbox === 'crystal') reloadCrystal();
    },
    [reloadNova, reloadVods, reloadCrystal],
  );

  // Each list's load state as plain values, so the memo below compares them one by one.
  const { loading: novaLoading, error: novaError } = novaResource;
  const { loading: vodsLoading, error: vodsError } = vodsResource;
  const { loading: crystalLoading, error: crystalError } = crystalResource;

  const value = useMemo<InboxCountsValue>(
    () => ({
      nova,
      vods,
      crystal,
      loads: {
        nova: { loading: novaLoading, error: novaError },
        vods: { loading: vodsLoading, error: vodsError },
        crystal: { loading: crystalLoading, error: crystalError },
      },
      refresh,
    }),
    [nova, vods, crystal, novaLoading, novaError, vodsLoading, vodsError, crystalLoading, crystalError, refresh],
  );

  return <InboxCountsContext.Provider value={value}>{children}</InboxCountsContext.Provider>;
}

/** The provider's `{ nova, vods, crystal, loads, refresh }`; outside a provider, all `null`, nothing
 * in flight or failed, and a no-op `refresh`. */
export function useInboxCounts(): InboxCountsValue {
  return useContext(InboxCountsContext) ?? OUTSIDE_PROVIDER_VALUE;
}
