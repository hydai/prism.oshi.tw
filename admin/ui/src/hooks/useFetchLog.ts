import { useCallback, useRef, useState } from 'react';
import type { FetchLogEntry } from '../components/FetchLogPanel';
import type { OutcomeTone } from '../lib/itunes';

export type AppendFetchLog = (title: string, tone: OutcomeTone, text: string) => void;

/** Newest-first log of iTunes duration lookups, rendered by `FetchLogPanel`. */
export function useFetchLog(): {
  fetchLog: FetchLogEntry[];
  appendFetchLog: AppendFetchLog;
  clearFetchLog: () => void;
} {
  const [fetchLog, setFetchLog] = useState<FetchLogEntry[]>([]);
  const fetchLogKeyRef = useRef(0);

  const appendFetchLog = useCallback((title: string, tone: OutcomeTone, text: string) => {
    fetchLogKeyRef.current += 1;
    setFetchLog((prev) => [{ key: fetchLogKeyRef.current, title, tone, text }, ...prev]);
  }, []);

  const clearFetchLog = useCallback(() => setFetchLog([]), []);

  return { fetchLog, appendFetchLog, clearFetchLog };
}
