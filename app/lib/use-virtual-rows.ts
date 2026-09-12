'use client';

import { useLayoutEffect, useReducer, useState, useSyncExternalStore } from 'react';
import { createVirtualRowsStore, type VirtualRows, type VirtualRowsOptions } from './virtual-rows-store';

export type { VirtualRows } from './virtual-rows-store';

/**
 * TanStack Virtual for one list, as values.
 *
 * `useVirtualizer` from `@tanstack/react-virtual` returns the mutable
 * `Virtualizer` itself, whose methods read state that changes outside React.
 * React Compiler cannot memoize that safely (`react-hooks/incompatible-library`),
 * and every component handed the instance inherits the problem. Here the
 * instance lives in a store and `useSyncExternalStore` publishes a snapshot
 * whose identity only changes when the rows do, so callers render from it like
 * any other value.
 */
export function useVirtualRows(options: VirtualRowsOptions): VirtualRows {
  const [store] = useState(() => createVirtualRowsStore(options));
  const [, renderAgain] = useReducer((pass: number) => pass + 1, 0);
  // Same render-time handoff as @tanstack/react-virtual: the instance needs
  // this render's options before the snapshot is read below.
  store.setOptions(options);
  const rows = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  // The two lifecycle calls every TanStack adapter makes: mount attaches the
  // scroll-element observers (and returns their cleanup); update re-checks
  // the scroll element after each commit. The list offset is measured in the
  // same pass — layout is settled here, and a render must not read the DOM.
  useLayoutEffect(() => store.virtualizer._didMount(), [store]);
  useLayoutEffect(() => {
    store.measureScrollMargin();
    store.virtualizer._willUpdate();
    // useSyncExternalStore subscribes from a passive effect, so a change the
    // lifecycle above just caused (the first viewport size, a moved list) has
    // no listener yet. Rendering again from here lands before paint, the way
    // react-virtual's layout-phase rerender does; once subscribed, the store's
    // own notification and this update coalesce into one render.
    if (store.getSnapshot() !== rows) renderAgain();
  });
  return rows;
}
