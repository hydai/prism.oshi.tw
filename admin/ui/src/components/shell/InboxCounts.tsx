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

/** Reloads the named inbox's list, or all three when called without a name. */
type RefreshInboxCounts = (inbox?: keyof InboxCounts) => void;

type InboxCountsValue = InboxCounts & { refresh: RefreshInboxCounts };

const InboxCountsContext = createContext<InboxCountsValue | null>(null);

// One stable object for every call outside a provider. Module-private, not exported: a .tsx that
// exports components must export no other runtime value (react-doctor only-export-components).
const OUTSIDE_PROVIDER_VALUE: InboxCountsValue = {
  nova: null,
  vods: null,
  crystal: null,
  refresh: () => {},
};

/**
 * A list's pending count, or `null` if it hasn't loaded yet or its last load failed. `error` is
 * checked before `data`: `useApiResource` keeps a failed reload's previous data on screen (so an
 * already-loaded page doesn't blank out), which would otherwise make a refresh that fails after an
 * earlier success keep reporting the stale count instead of falling back to unknown. The check is
 * `!== null`, not truthiness: an `ApiError` can carry an empty message (`responseError()` in
 * client.ts falls back to `res.statusText`, which is `''` for a bodyless HTTP/2 response), and a
 * truthy check would read that empty string as "no error" and fall through to the stale count.
 */
function pendingCount<T extends { status: string }>(resource: ApiResource<ListResponse<T>>): number | null {
  if (resource.error !== null) return null;
  if (!resource.data) return null;
  return countByStatus(resource.data.data, 'pending');
}

/**
 * Loads the three review inboxes — Nova streamer submissions, Nova VOD submissions, Crystal
 * tickets — once on mount and exposes each one's pending count, plus `refresh`, to
 * `useInboxCounts()`. None of the three lists are scoped to the selected streamer, so none take
 * deps. A failed load is silent: it yields `null` for that count only, never a toast or a thrown
 * error — the sidebar badge is a convenience, not a page a curator is actively working from, so a
 * transient failure (or a 403 for a contributor on a curator-only list) should not interrupt them.
 * The returned value keeps a stable identity while every count and `refresh` are unchanged, so a
 * consumer that only reads `useInboxCounts()` re-renders only when a count actually changes.
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

  const value = useMemo<InboxCountsValue>(
    () => ({ nova, vods, crystal, refresh }),
    [nova, vods, crystal, refresh],
  );

  return <InboxCountsContext.Provider value={value}>{children}</InboxCountsContext.Provider>;
}

/** The provider's `{ nova, vods, crystal, refresh }`; outside a provider, all `null` and a no-op
 * `refresh`. */
export function useInboxCounts(): InboxCounts & { refresh: RefreshInboxCounts } {
  return useContext(InboxCountsContext) ?? OUTSIDE_PROVIDER_VALUE;
}
