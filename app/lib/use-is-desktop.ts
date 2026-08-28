'use client';

import { useSyncExternalStore } from 'react';
import { createViewportStore, type ViewportStore } from './viewport-store';

let store: ViewportStore | null = null;
function getStore(): ViewportStore {
  if (store === null) store = createViewportStore((query) => window.matchMedia(query));
  return store;
}

const subscribe = (listener: () => void) => getStore().subscribe(listener);
const getSnapshot = () => getStore().getSnapshot();
const getServerSnapshot = () => false;

/** True at Tailwind's `lg` breakpoint and up. Server/hydration snapshot is `false`. */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
