import { useCallback, useSyncExternalStore } from 'react';

function getServerSnapshot(): boolean {
  return false;
}

/**
 * Live viewport-media match. `subscribe` and the snapshot both call `window.matchMedia(query)`
 * fresh, rather than a `MediaQueryList` captured once at mount, so a test can stub `matchMedia`
 * either before or after the hook subscribes. No `window` or no `matchMedia` (SSR, or an
 * unsupported environment) reads `false`.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => undefined;
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    [query],
  );

  const getSnapshot = useCallback((): boolean => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  }, [query]);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
