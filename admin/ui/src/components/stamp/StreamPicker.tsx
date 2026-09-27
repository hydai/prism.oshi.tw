import type { StampStats, StreamWithPending } from '../../../../shared/types';
import { Select } from '../ui/Fields';
import { Icon } from '../ui/Icon';
import { Pill } from '../ui/Pill';
import { Popover } from '../ui/Popover';
import { SearchableList } from '../ui/SearchableList';

/** What the picker calls a stream: its title, or its video ID while it has none. */
function streamLabel(stream: StreamWithPending): string {
  return stream.title || stream.videoId;
}

/**
 * The Stamp Editor's stream picker (spec §8.2): a listbox popover over the streams, searchable and
 * filterable by year, each option with its date, its title and how many of its songs still need
 * an end timestamp. The footer counts the whole streamer's stamped songs. Search, year and the open
 * state are the page's, so the Newer / Older buttons step through the same filtered list and the
 * empty state can open it. A long title is cut by CSS only; the full text stays in `title`.
 */
export function StreamPicker({
  streams,
  selectedStream,
  onSelect,
  search,
  onSearchChange,
  yearFilter,
  onYearFilterChange,
  years,
  stats,
  statsUnavailable,
  open,
  onOpenChange,
}: {
  streams: StreamWithPending[];
  selectedStream: StreamWithPending | undefined;
  onSelect: (stream: StreamWithPending) => void;
  search: string;
  onSearchChange: (value: string) => void;
  yearFilter: string;
  onYearFilterChange: (value: string) => void;
  years: string[];
  stats: StampStats | null;
  statsUnavailable: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Popover
      kind="listbox"
      label="Streams"
      open={open}
      onOpenChange={onOpenChange}
      // 240 px at lg, where the 224 px sidebar leaves the header too little room for 320.
      className="min-w-0 flex-1 sm:w-[320px] sm:flex-none lg:w-[240px] xl:w-[320px]"
      trigger={({ triggerProps }) => (
        <button
          {...triggerProps}
          type="button"
          className="flex h-[34px] w-full min-w-0 items-center gap-2 rounded-radius-pill border border-field-line bg-field pl-[5px] pr-3 text-left text-fg-subtle transition-colors hover:border-accent-fg focus-visible:outline-none focus-visible:shadow-focus"
        >
          <span className="sr-only">Stream: </span>
          {selectedStream ? (
            <>
              <Pill tone="neutral" className="shrink-0">
                {selectedStream.date}
              </Pill>
              <span title={streamLabel(selectedStream)} className="min-w-0 flex-1 truncate text-[12.5px] text-fg">
                {streamLabel(selectedStream)}
              </span>
            </>
          ) : (
            <span className="min-w-0 flex-1 truncate pl-2 text-[12.5px] text-fg-muted">Choose a stream</span>
          )}
          <Icon name="chevronsUpDown" size={14} className="shrink-0" />
        </button>
      )}
    >
      {(close) => (
        <SearchableList
          items={streams}
          getKey={(stream) => stream.id}
          getTitle={streamLabel}
          isSelected={(stream) => stream.id === selectedStream?.id}
          onSelect={(stream) => {
            close();
            onSelect(stream);
          }}
          renderItem={(stream) => (
            <>
              <Pill tone="neutral" className="shrink-0">
                {stream.date}
              </Pill>
              <span className="min-w-0 flex-1 truncate">{streamLabel(stream)}</span>
              {stream.pendingCount > 0 ? (
                <Pill tone="warn" className="shrink-0">
                  {stream.pendingCount}
                </Pill>
              ) : null}
            </>
          )}
          search={search}
          onSearchChange={onSearchChange}
          searchLabel="Search streams"
          searchPlaceholder="Search streams..."
          label="Streams"
          toolbar={
            years.length > 1 ? (
              <Select
                aria-label="Filter streams by year"
                value={yearFilter}
                onChange={(event) => onYearFilterChange(event.target.value)}
              >
                <option value="">All</option>
                {years.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </Select>
            ) : undefined
          }
          footer={
            statsUnavailable ? (
              'Stats unavailable'
            ) : stats ? (
              <>
                <span className="font-semibold text-fg">
                  {stats.filled}/{stats.total}
                </span>{' '}
                stamped
                {stats.remaining > 0 ? (
                  <span className="ml-1 text-tone-warn-fg">({stats.remaining} remaining)</span>
                ) : null}
              </>
            ) : undefined
          }
          emptyText="No streams"
        />
      )}
    </Popover>
  );
}
