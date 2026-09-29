import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { DiscoveredStream } from '../../../shared/types';
import { useCurrentStreamerName } from '../components/shell/Streamers';
import { BulkBar } from '../components/ui/BulkBar';
import { Button } from '../components/ui/Button';
import { EmptyState, GlassCard } from '../components/ui/Display';
import { Checkbox } from '../components/ui/Fields';
import { Icon } from '../components/ui/Icon';
import { Pill } from '../components/ui/Pill';
import { HeadCell, Table, TableEmptyRow, THead } from '../components/ui/Table';
import { CELL_X, FIRST_CELL_X, LAST_CELL_X } from '../components/ui/table-cells';
import { Chip } from '../components/ui/Toggles';
import { useNow } from '../hooks/useNow';
import { formatRelative } from '../lib/dates';
import { inPrismLabel, summarizeDiscovered, visibleDiscovered, type DiscoverFilter } from './pipeline-discover';

/** Select, thumbnail, video, date, status. */
const DISCOVER_COLUMNS = 5;

/** A failed scan, inline above the results. */
function DangerNote({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-radius-lg border border-tone-danger-line bg-tone-danger-bg px-3 py-2 text-token-sm text-tone-danger-fg"
    >
      {children}
    </p>
  );
}

/**
 * The Discover step's state and handlers. The page holds them (`useDiscover` in `Pipeline.tsx`)
 * rather than the step, so a trip to Extract keeps the scan, the filter and the selection.
 */
export interface DiscoverController {
  streams: DiscoveredStream[];
  loading: boolean;
  importing: boolean;
  error: string | null;
  selected: ReadonlySet<string>;
  filter: DiscoverFilter;
  /** When the last scan succeeded; `null` until one has. */
  lastRunAt: number | null;
  run: () => Promise<void>;
  setFilter: (filter: DiscoverFilter) => void;
  setStreamSelected: (videoId: string, checked: boolean) => void;
  /** Every new video, whether the filter shows it or not — or none. */
  setAllNewSelected: (all: boolean) => void;
  clearSelection: () => void;
  importSelected: () => Promise<void>;
}

/** `Scanned …`: its own component, so the 30 s tick re-renders this text and nothing else. */
function ScannedAgo({ at }: { at: number }) {
  const now = useNow(30_000);
  return <>Scanned {formatRelative(at, now)}</>;
}

function ScanStat({ value, label }: { value: number; label: string }) {
  return (
    <span className="whitespace-nowrap text-[12px] text-fg-muted">
      <b className="font-[750] text-fg">{value}</b> {label}
    </span>
  );
}

interface ScanSummaryProps {
  lastRunAt: number;
  counts: { total: number; fresh: number; existing: number };
  filter: DiscoverFilter;
  onFilterChange: (filter: DiscoverFilter) => void;
}

/** The strip above the table: when the channel was scanned, what the scan found, and the filter chips. */
function ScanSummary({ lastRunAt, counts, filter, onFilterChange }: ScanSummaryProps) {
  return (
    <GlassCard padding="none" className="flex flex-wrap items-center gap-x-2.5 gap-y-2 px-3.5 py-2.5">
      <span className="flex items-center gap-1.5 whitespace-nowrap text-[12px] text-fg-muted">
        <Icon name="check" size={14} className="text-tone-ok-fg" />
        <ScannedAgo at={lastRunAt} />
      </span>
      <span aria-hidden="true" className="h-4 w-px bg-field-line" />
      <ScanStat value={counts.total} label="videos found" />
      <ScanStat value={counts.fresh} label="new" />
      <ScanStat value={counts.existing} label="already in Prism" />
      <div role="group" aria-label="Filter videos" className="flex flex-wrap items-center gap-2 sm:ml-auto">
        <Chip active={filter === 'new'} count={counts.fresh} onClick={() => onFilterChange('new')}>
          New
        </Chip>
        <Chip active={filter === 'existing'} count={counts.existing} onClick={() => onFilterChange('existing')}>
          Already in Prism
        </Chip>
        <Chip active={filter === 'all'} count={counts.total} onClick={() => onFilterChange('all')}>
          All
        </Chip>
      </div>
    </GlassCard>
  );
}

interface DiscoverRowProps {
  stream: DiscoveredStream;
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
}

/** One video: a checkbox when it is new, thumbnail, title and video ID, date, and where it stands. */
function DiscoverRow({ stream, selected, onSelectedChange }: DiscoverRowProps) {
  const name = stream.title || stream.videoId;
  return (
    <tr className={`h-[50px] border-b border-line-soft transition-colors ${selected ? 'bg-selected' : 'hover:bg-row-hover'}`}>
      <td className={`${FIRST_CELL_X} py-1.5`}>
        {stream.isNew ? (
          // A flex box, so the inline label does not sit on the text baseline above the row's middle.
          <div className="flex">
            <Checkbox label={`Select stream ${name}`} checked={selected} onChange={onSelectedChange} />
          </div>
        ) : null}
      </td>
      <td className={`${CELL_X} py-1.5`}>
        {/* Decorative: the title and the video ID beside it carry the meaning. */}
        <img
          src={`https://i.ytimg.com/vi/${stream.videoId}/mqdefault.jpg`}
          alt=""
          width={64}
          height={36}
          loading="lazy"
          className="block h-9 w-16 rounded-radius-sm bg-track object-cover"
        />
      </td>
      <td className={`${CELL_X} py-1.5`}>
        <div title={stream.title} className="truncate font-semibold text-fg">
          {stream.title}
        </div>
        <a
          href={`https://www.youtube.com/watch?v=${stream.videoId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-radius-xs font-mono text-meta text-fg-subtle hover:text-accent-fg hover:underline focus-visible:outline-none focus-visible:shadow-focus"
        >
          {stream.videoId}
        </a>
      </td>
      <td className={`${CELL_X} whitespace-nowrap py-1.5 text-fg-muted`}>{stream.date}</td>
      <td className={`${LAST_CELL_X} py-1.5`}>
        {stream.isNew ? (
          <Pill tone="info">New</Pill>
        ) : (
          <div className="flex items-center gap-2">
            <Pill tone="neutral">{inPrismLabel(stream)}</Pill>
            {stream.existingStreamId ? (
              <Link
                to={`/streams/${stream.existingStreamId}`}
                className="inline-flex items-center gap-0.5 rounded-radius-xs text-[11px] font-[650] text-accent-fg hover:underline focus-visible:outline-none focus-visible:shadow-focus"
              >
                Open
                <span className="sr-only"> {name}</span>
                <Icon name="chevronRight" size={12} />
              </Link>
            ) : null}
          </div>
        )}
      </td>
    </tr>
  );
}

interface DiscoverTableProps {
  streams: DiscoveredStream[];
  selected: ReadonlySet<string>;
  /** False when the scan found nothing new: Select all has nothing to select. */
  hasNew: boolean;
  allNewSelected: boolean;
  /** Checked: select every new video, the ones the filter hides too. Unchecked: select none. */
  onAllNewSelectedChange: (all: boolean) => void;
  onSelectedChange: (videoId: string, selected: boolean) => void;
}

/**
 * The scanned videos under the current filter, in a glass card. Fixed layout: from 1280 px it fits
 * the card and a long title is cut short (full text in `title`); below that it keeps a minimum
 * width and scrolls inside the card. The card clips with `overflow-clip`, which unlike hidden/auto
 * is no scroll container, so the sticky head keeps tracking `<main>`.
 */
function DiscoverTable({
  streams,
  selected,
  hasNew,
  allNewSelected,
  onAllNewSelectedChange,
  onSelectedChange,
}: DiscoverTableProps) {
  return (
    <GlassCard padding="none" className="overflow-clip">
      <Table className="table-fixed text-[12px] max-xl:min-w-[640px]">
        {/* The status column holds the longest pill, `In Prism · Extracted`, and Open on one line. */}
        <colgroup>
          <col className="w-[38px]" />
          <col className="w-[76px]" />
          <col />
          <col className="w-[92px]" />
          <col className="w-[190px]" />
        </colgroup>
        <THead>
          <tr>
            <HeadCell className={FIRST_CELL_X}>
              <div className="flex">
                <Checkbox
                  label="Select all new streams"
                  checked={allNewSelected}
                  disabled={!hasNew}
                  onChange={onAllNewSelectedChange}
                />
              </div>
            </HeadCell>
            <HeadCell className={CELL_X}>
              <span className="sr-only">Thumbnail</span>
            </HeadCell>
            <HeadCell className={CELL_X}>Video</HeadCell>
            <HeadCell className={CELL_X}>Date</HeadCell>
            <HeadCell className={LAST_CELL_X}>Status</HeadCell>
          </tr>
        </THead>
        <tbody>
          {streams.map((stream) => (
            <DiscoverRow
              key={stream.videoId}
              stream={stream}
              selected={selected.has(stream.videoId)}
              onSelectedChange={(checked) => onSelectedChange(stream.videoId, checked)}
            />
          ))}
          {streams.length === 0 ? (
            <TableEmptyRow colSpan={DISCOVER_COLUMNS}>No videos under this filter.</TableEmptyRow>
          ) : null}
        </tbody>
      </Table>
    </GlassCard>
  );
}

/**
 * Step 1: scan the streamer's channel, then import the new videos as pending streams. `hidden`
 * hides the step without unmounting it. Its bulk bar is `fixed`, so it leaves with the step
 * instead: mounted, it would keep marking `<html>` (the toast lift, the page padding) under Extract.
 */
export function DiscoverStep({ hidden, discover }: { hidden: boolean; discover: DiscoverController }) {
  const streamerName = useCurrentStreamerName();
  const { streams, loading, importing, error, selected, filter, lastRunAt } = discover;
  const counts = summarizeDiscovered(streams);
  const allNewSelected = counts.fresh > 0 && streams.every((stream) => !stream.isNew || selected.has(stream.videoId));

  return (
    <section aria-label="Discover" hidden={hidden}>
      {/* While the bulk bar is up, the end of the step scrolls clear of it (BulkBar publishes its height). */}
      <div className="flex flex-col gap-3 p-4 lg:px-5 lg:pb-[18px] [html[data-bulk-bar]_&]:pb-[calc(var(--bulk-bar-h)_+_22px_+_16px)]">
        {error ? <DangerNote>{error}</DangerNote> : null}

        {lastRunAt === null ? (
          <GlassCard>
            <EmptyState
              icon="workflow"
              title="Find new karaoke streams"
              body={`Scans ${streamerName}'s YouTube channel for karaoke streams.`}
              action={
                // Like the header's: no scan starts while an import runs (which ends with its own).
                <Button variant="primary" busy={loading} disabled={importing} onClick={() => void discover.run()}>
                  Discover streams
                </Button>
              }
            />
          </GlassCard>
        ) : streams.length === 0 ? (
          <GlassCard>
            <EmptyState
              icon="workflow"
              title="No videos found"
              body="Nothing on the channel looks like a karaoke stream yet."
            />
          </GlassCard>
        ) : (
          <>
            <ScanSummary lastRunAt={lastRunAt} counts={counts} filter={filter} onFilterChange={discover.setFilter} />
            <DiscoverTable
              streams={visibleDiscovered(streams, filter)}
              selected={selected}
              hasNew={counts.fresh > 0}
              allNewSelected={allNewSelected}
              onAllNewSelectedChange={discover.setAllNewSelected}
              onSelectedChange={discover.setStreamSelected}
            />
          </>
        )}
      </div>

      {!hidden && selected.size > 0 ? (
        <BulkBar countLabel={`已選 ${selected.size} 部新影片`}>
          {/* A scan's answer replaces the rows and the selection: nothing imports until it is back. */}
          <Button
            variant="primary"
            size="sm"
            icon="download"
            busy={importing}
            disabled={loading}
            onClick={() => void discover.importSelected()}
          >
            Import as pending streams
          </Button>
          <Button variant="ghost" size="sm" onClick={discover.clearSelection}>
            Clear
          </Button>
        </BulkBar>
      ) : null}
    </section>
  );
}
