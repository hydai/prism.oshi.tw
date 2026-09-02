import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { StreamWithPending } from '../../../shared/types';
import { api } from '../api/client';

export interface StreamPicker {
  streams: StreamWithPending[];
  /** Re-reads the sidebar, whose per-stream badges count the songs still to stamp. */
  reloadStreams: () => void;
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

/** The stamp editor's stream sidebar: the list, its search/year filters, and the current pick. */
export function useStreamPicker(): StreamPicker {
  const [streams, setStreams] = useState<StreamWithPending[]>([]);
  const [streamSearch, setStreamSearch] = useState('');
  const [streamYearFilter, setStreamYearFilter] = useState('');
  const [selectedStreamId, setSelectedStreamId] = useState<string | null>(null);

  const reloadStreams = useCallback(() => {
    api.listStampStreams().then(({ data }) => setStreams(data));
  }, []);

  useEffect(() => {
    reloadStreams();
  }, [reloadStreams]);

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
