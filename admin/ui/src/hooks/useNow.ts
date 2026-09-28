import { useEffect, useState } from 'react';

/**
 * The current time in ms, refreshed every `intervalMs` while mounted (the pattern
 * `VodExport.tsx`'s own `now` tick already used, generalised). The lazy initializer reads
 * `Date.now()` once for the first render; after that, only the interval callback calls it again.
 */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(interval);
  }, [intervalMs]);

  return now;
}
