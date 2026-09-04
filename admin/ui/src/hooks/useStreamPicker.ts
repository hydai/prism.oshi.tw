import { useCallback, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { StreamWithPending } from '../../../shared/types';
import { api } from '../api/client';

export interface StreamPicker {
  streams: StreamWithPending[];
  /**
   * Re-reads the sidebar, whose per-stream badges count the songs still to stamp. Resolves with
   * the freshly loaded list, so a caller that needs to act on the load (StampEditor selecting a
   * deep-linked stream once it appears) can chain onto this same fetch instead of watching
   * `streams` for the change from an effect of its own.
   */
  reloadStreams: () => Promise<StreamWithPending[]>;
  streamSearch: string;
  setStreamSearch: Dispatch<SetStateAction<string>>;
  streamYearFilter: string;
  setStreamYearFilter: Dispatch<SetStateAction<string>>;
  selectedStreamId: string | null;
  selectStreamId: (streamId: string) => void;
  selectedStream: StreamWithPending | undefined;
  streamYears: string[];
  filteredStreams: StreamWithPending[];
}

/**
 * The stamp editor's stream sidebar: the list, its search/year filters, and the current pick.
 *
 * Nothing here fetches on its own — the caller triggers `reloadStreams` (on mount, and whenever
 * it needs a fresh list), the same shape `usePerformances`'s callers already use for their own
 * loads. That keeps this hook a plain picker with no opinion on deep links or anything else a
 * caller might want to do once a load lands.
 */
export function useStreamPicker(): StreamPicker {
  const [streams, setStreams] = useState<StreamWithPending[]>([]);
  const [streamSearch, setStreamSearch] = useState('');
  const [streamYearFilter, setStreamYearFilter] = useState('');
  const [selectedStreamId, setSelectedStreamId] = useState<string | null>(null);

  const reloadStreams = useCallback(() => {
    return api.listStampStreams().then(({ data }) => {
      setStreams(data);
      return data;
    });
  }, []);

  const selectStreamId = useCallback((streamId: string) => {
    setSelectedStreamId(streamId);
  }, []);

  const selectedStream = useMemo(
    () => streams.find((stream) => stream.id === selectedStreamId),
    [streams, selectedStreamId],
  );

  const streamYears = useMemo(() => {
    const years = new Set<string>();
    for (const stream of streams) {
      const year = stream.date?.slice(0, 4);
      if (year) years.add(year);
    }
    return [...years].sort().reverse();
  }, [streams]);

  const filteredStreams = useMemo(() => {
    let list = streams;
    if (streamYearFilter) {
      list = list.filter((stream) => stream.date?.startsWith(streamYearFilter));
    }
    if (streamSearch) {
      const query = streamSearch.toLowerCase();
      list = list.filter(
        (stream) => stream.title.toLowerCase().includes(query) || stream.date.includes(streamSearch),
      );
    }
    return list;
  }, [streams, streamYearFilter, streamSearch]);

  return {
    streams,
    reloadStreams,
    streamSearch,
    setStreamSearch,
    streamYearFilter,
    setStreamYearFilter,
    selectedStreamId,
    selectStreamId,
    selectedStream,
    streamYears,
    filteredStreams,
  };
}
