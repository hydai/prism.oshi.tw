import { useSyncExternalStore } from 'react';
import { getCurrentStreamer, getStreamerServerSnapshot, onStreamerChange } from '../api/client';

/**
 * The selected streamer, read straight from the store in `api/client` that every
 * request already consults. Subscribing through `useSyncExternalStore` keeps the
 * rendered value and the value the next request will send from ever disagreeing —
 * nothing mirrors the selection into component state.
 */
export function useCurrentStreamer(): string {
  return useSyncExternalStore(onStreamerChange, getCurrentStreamer, getStreamerServerSnapshot);
}
