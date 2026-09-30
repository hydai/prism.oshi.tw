import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import type { AuthUser, Status, Stream } from '../../../shared/types';
import { api, getCurrentStreamer, setCurrentStreamer } from '../api/client';
import { sendStatusChange } from '../api/status-change';
import { StatusFilterBar, type StatusFilterOption } from '../components/StatusFilterBar';
import { Button, IconButton } from '../components/ui/Button';
import { buttonClasses } from '../components/ui/button-classes';
import { GlassCard, Skeleton } from '../components/ui/Display';
import { SearchInput } from '../components/ui/Fields';
import { Icon } from '../components/ui/Icon';
import { Note } from '../components/ui/Note';
import { PageHeader } from '../components/ui/PageHeader';
import { StatusPill } from '../components/ui/Pill';
import { Menu, Popover, type MenuItem } from '../components/ui/Popover';
import { HeadCell, SortHeader, Table, TableEmptyRow, THead, type SortDirection } from '../components/ui/Table';
import { CELL_X, FIRST_CELL_X, LAST_CELL_X } from '../components/ui/table-cells';
import { useToast } from '../components/ui/toast';
import { useSearchParamState } from '../hooks/useSearchParamState';
import { errorMessage, useApiResource } from '../lib/apiResource';
import { formatFullTime, formatWhen, storedTimeIso } from '../lib/dates';
import { loadStreamsFilter, saveStreamsFilter, resolveYear } from '../lib/streamsFilter';
import { streamStatusActions } from './stream-detail-actions';

type SortKey = 'title' | 'date' | 'status' | 'createdAt';

const STATUS_FILTERS: ReadonlyArray<StatusFilterOption<'' | Status>> = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'excluded', label: 'Excluded' },
  { value: 'extracted', label: 'Extracted' },
];

const STATUS_FILTER_LABEL_ID = 'streams-status-filter-label';
const YEAR_FILTER_LABEL_ID = 'streams-year-filter-label';
/** The uppercase micro label a filter group is named by (spec §4.3). */
const GROUP_LABEL = 'text-2xs font-bold uppercase tracking-[0.12em] text-fg-subtle';
const OUTLINED_ICON_BUTTON = 'border border-field-line bg-field';

/** The status each stream with a request out is heading for. */
const NO_ACTIONS: ReadonlyMap<string, Status> = new Map();

function isStatusFilter(value: string): value is '' | Status {
  return STATUS_FILTERS.some((option) => option.value === value);
}

/**
 * The rows with one stream's status changed. The worker answers a status change with `{ id, status }`
 * and nothing else, so the row takes the new status and keeps every other field it shows.
 */
function withStatus(rows: Stream[], id: string, status: Status): Stream[] {
  return rows.map((row) => (row.id === id ? { ...row, status } : row));
}

/** The header's count: how many streams there are, or how many of them the year filter leaves. */
function countText(shown: number, total: number): string {
  if (shown !== total) return `${shown} of ${total} streams`;
  return `${total} ${total === 1 ? 'stream' : 'streams'}`;
}

/** What a status change is called in its toast: Restore and Unapprove both set pending, and read differently. */
function statusChangeWord(from: Status, to: Status): string {
  if (to !== 'pending') return to;
  return from === 'approved' ? 'unapproved' : 'restored';
}

/**
 * Ref for a row's primary action. It goes only when the stream's status is one this page has no action
 * for (the worker moved on first). A keyboard user who was on it would be left on <body>, so as the
 * button goes, the focus moves to the row's title link. React runs a ref's cleanup while the button is
 * still in the document, so the link can take the focus before the button is removed. A button that does
 * not hold the focus then (the user has moved on) takes nothing.
 */
function handFocusToTitle(button: HTMLButtonElement | null): (() => void) | undefined {
  if (button === null) return undefined;
  return () => {
    if (document.activeElement !== button) return;
    button.closest('tr')?.querySelector<HTMLElement>('a[href]')?.focus();
  };
}

/**
 * Ref for the wrapper of a row's ⋯ menu. The menu goes when a status change leaves the stream with no
 * menu (Exclude on a rejected stream, say), and the ⋯ button that held the focus goes with it: the row's
 * primary action takes the focus instead, or the title link where that has gone too. Only when the focus
 * was inside the menu then, so an answer that lands after the user has moved on takes nothing.
 */
function handFocusToPrimary(menu: HTMLElement | null): (() => void) | undefined {
  if (menu === null) return undefined;
  return () => {
    if (!menu.contains(document.activeElement)) return;
    const row = menu.closest('tr');
    (row?.querySelector<HTMLElement>('[data-row-primary]') ?? row?.querySelector<HTMLElement>('a[href]'))?.focus();
  };
}

interface StreamActionsProps {
  stream: Stream;
  /** The status this stream's request is out for, if any. */
  acting: Status | undefined;
  onChange: (stream: Stream, status: Status) => void;
}

/**
 * What a curator can do to one stream (`streamStatusActions`, as on Stream Detail): its primary action on
 * a button, the rest in a ⋯ menu. While a request is out for the stream, the button that started it is busy
 * and keeps the focus, the other is unavailable (`aria-disabled`, never `disabled`, which would drop the
 * focus), and the menu's items are unavailable; the ⋯ button itself stays enabled, since it may be where
 * the focus is (a menu closes onto it).
 *
 * Neither the menu nor the ⋯ button's hover label gets a side from the page. The menu is the kit Popover's:
 * it opens in the top layer, so no card or scroll box clips it, and takes the other side by itself where the
 * viewport lacks room. The hover label is in flow, inside the table's card: on top, where even the first row
 * has room (over the head), and lined up with the button's end, which is the card's edge.
 */
function StreamActions({ stream, acting, onChange }: StreamActionsProps) {
  const { primary, menu } = streamStatusActions(stream.status);
  const out = acting !== undefined;
  const items: MenuItem[] = menu.map((action) => ({
    label: action.label,
    disabled: out,
    onSelect: () => onChange(stream, action.status),
  }));
  return (
    <div className="flex items-center gap-1.5">
      {primary ? (
        <Button
          ref={handFocusToTitle}
          data-row-primary=""
          variant={primary.status === 'approved' ? 'primary' : 'secondary'}
          size="sm"
          icon={primary.status === 'approved' ? 'check' : 'undo'}
          aria-label={`${primary.label}: ${stream.title}`}
          busy={acting === primary.status}
          aria-disabled={out && acting !== primary.status ? true : undefined}
          onClick={() => onChange(stream, primary.status)}
        >
          {primary.label}
        </Button>
      ) : null}
      {menu.length > 0 ? (
        <span ref={handFocusToPrimary} className="inline-flex">
          <Popover
            kind="menu"
            label={`More actions for ${stream.title}`}
            align="end"
            trigger={({ triggerProps }) => (
              <IconButton
                {...triggerProps}
                label={`More actions for ${stream.title}`}
                icon="more"
                size="sm"
                tooltipAlign="end"
                className={OUTLINED_ICON_BUTTON}
              />
            )}
          >
            {(close) => <Menu items={items} onDone={close} />}
          </Popover>
        </span>
      ) : null}
    </div>
  );
}

interface StreamRowProps {
  stream: Stream;
  curator: boolean;
  today: Date;
  acting: Status | undefined;
  onChange: (stream: Stream, status: Status) => void;
}

/** One stream: its title (the link), date, video, status, submitter and creation time; a curator's actions. */
function StreamRow({ stream, curator, today, acting, onChange }: StreamRowProps) {
  return (
    <tr className="h-11 border-b border-line-soft transition-colors last:border-b-0 hover:bg-row-hover">
      <td className={FIRST_CELL_X}>
        <Link
          to={`/streams/${encodeURIComponent(stream.id)}`}
          title={stream.title}
          className="block truncate rounded-radius-xs font-semibold text-fg hover:underline focus-visible:outline-none focus-visible:shadow-focus"
        >
          {stream.title}
        </Link>
      </td>
      <td className={`${CELL_X} whitespace-nowrap text-fg-muted`}>{stream.date}</td>
      <td className={CELL_X}>
        <a
          href={stream.youtubeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 whitespace-nowrap rounded-radius-xs font-mono text-fg-muted transition-colors hover:text-accent-fg focus-visible:outline-none focus-visible:shadow-focus"
        >
          {stream.videoId}
          <Icon name="arrowUpRight" size={12} />
        </a>
      </td>
      <td className={CELL_X}>
        <StatusPill status={stream.status} />
      </td>
      <td className={CELL_X}>
        <div title={stream.submittedBy ?? undefined} className="truncate text-[11.5px] text-fg-muted">
          {stream.submittedBy ?? '—'}
        </div>
      </td>
      <td className={curator ? CELL_X : LAST_CELL_X}>
        <time
          dateTime={storedTimeIso(stream.createdAt)}
          title={formatFullTime(stream.createdAt)}
          className="whitespace-nowrap text-[11.5px] text-fg-muted"
        >
          {formatWhen(stream.createdAt, today)}
        </time>
      </td>
      {curator ? (
        <td className={LAST_CELL_X}>
          <StreamActions stream={stream} acting={acting} onChange={onChange} />
        </td>
      ) : null}
    </tr>
  );
}

interface StreamsTableProps {
  streams: Stream[];
  curator: boolean;
  today: Date;
  sortKey: SortKey;
  sortDir: SortDirection;
  acting: ReadonlyMap<string, Status>;
  onSort: (key: SortKey) => void;
  onChange: (stream: Stream, status: Status) => void;
}

/**
 * The sortable table in its glass card. Fixed layout: a long title or submitter is cut short (full text in
 * `title`), and every other column is as wide as its widest content, with a few px to spare: a stream date,
 * an 11-character video ID, the longest status pill, a creation time, Approve stream beside the ⋯ button
 * (measured in Chromium). Below 1280 px the table keeps a minimum width, which still fits the card at
 * 1100 px (834 px of table there), and scrolls inside the card below that. The card clips with
 * `overflow-clip`, which unlike hidden / auto is no scroll container, so the sticky head keeps tracking `<main>`.
 */
function StreamsTable({ streams, curator, today, sortKey, sortDir, acting, onSort, onChange }: StreamsTableProps) {
  const sortProps = { activeField: sortKey, direction: sortDir, onSort };
  return (
    <GlassCard padding="none" className="overflow-clip">
      <Table className="table-fixed text-[12px] max-xl:min-w-[800px]">
        <colgroup>
          <col />
          <col className="w-[88px]" />
          <col className="w-[112px]" />
          <col className="w-[84px]" />
          <col className="w-[15%]" />
          <col className="w-[104px]" />
          {curator ? <col className="w-[192px]" /> : null}
        </colgroup>
        <THead>
          <tr>
            <SortHeader label="Title" field="title" {...sortProps} className={FIRST_CELL_X} />
            <SortHeader label="Date" field="date" {...sortProps} className={CELL_X} />
            <HeadCell className={CELL_X}>Video ID</HeadCell>
            <SortHeader label="Status" field="status" {...sortProps} className={CELL_X} />
            <HeadCell className={CELL_X}>Submitted by</HeadCell>
            <SortHeader label="Created" field="createdAt" {...sortProps} className={curator ? CELL_X : LAST_CELL_X} />
            {curator ? (
              <HeadCell className={LAST_CELL_X}>
                <span className="sr-only">Actions</span>
              </HeadCell>
            ) : null}
          </tr>
        </THead>
        <tbody>
          {streams.map((stream) => (
            <StreamRow
              key={stream.id}
              stream={stream}
              curator={curator}
              today={today}
              acting={acting.get(stream.id)}
              onChange={onChange}
            />
          ))}
          {streams.length === 0 ? <TableEmptyRow colSpan={curator ? 7 : 6}>No streams found.</TableEmptyRow> : null}
        </tbody>
      </Table>
    </GlassCard>
  );
}

/**
 * The stream list (spec §8.9): search, status and year chips, a table sorted in the browser, and for a
 * curator one status action per row. The rows stay while a later load is out (the skeleton is for the
 * first one only), so a control that started the load keeps its place.
 *
 * Only the submitted search term is fetched. A row's request is tracked twice, on purpose: `acting` is what
 * the rows render from, and `rowsOut` is what the handlers read, because a failure toast's Retry holds a
 * handler from the render that raised it, and what that render's state says is not what is true now.
 */
export default function StreamsList({ user }: { user: AuthUser }) {
  const toast = useToast();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [requestedStreamer] = useSearchParamState('streamer', '');
  // Storage is only the fallback for what the URL does not say, so it is read once.
  const [rememberedFilter] = useState(loadStreamsFilter);
  const [statusFilter, setStatusFilter] = useSearchParamState<'' | Status>(
    'status',
    rememberedFilter.status,
    { validate: isStatusFilter },
  );
  const [submittedSearch, setSubmittedSearch] = useSearchParamState('search', '');
  // The typed term only narrows the table once the search form is submitted.
  const [search, setSearch] = useState(submittedSearch);
  // The box follows the URL's term: a link to /streams?search=… followed while the page is open (Submit Stream's
  // duplicate link) puts its term in the box, as the fetch follows it. Adjusted while rendering, not in an effect.
  const [seededFrom, setSeededFrom] = useState(submittedSearch);
  if (seededFrom !== submittedSearch) {
    setSeededFrom(submittedSearch);
    setSearch(submittedSearch);
  }
  const [yearFilter, setYearFilter] = useState<string>(rememberedFilter.year);
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');
  const [acting, setActing] = useState(NO_ACTIONS);
  const rowsOut = useRef(new Set<string>());
  // When the page opened: the Created column only needs it to leave out the current year.
  const [today] = useState(() => new Date());

  // Declared before `useApiResource`, which runs its first fetch in an effect after this one: the
  // streamer a link names has to be the current one by then.
  useEffect(() => {
    if (requestedStreamer && requestedStreamer !== getCurrentStreamer()) {
      setCurrentStreamer(requestedStreamer);
    }
  }, [requestedStreamer]);

  const list = useApiResource(
    () =>
      api.listStreams({
        status: statusFilter || undefined,
        search: submittedSearch || undefined,
      }),
    [statusFilter, submittedSearch],
  );
  // Stable reference while loading, so the memos below don't recompute every render.
  const streams = useMemo(() => list.data?.data ?? [], [list.data]);
  // What a failure toast's Retry reads: the last status this page knows for each stream, not the one the render
  // that raised the toast saw, nor the list on screen. It is merged from every list the page loads or patches
  // and never pruned, so a stream that a filter or a search has left out keeps the status it was last seen with.
  // Kept current after each commit, never written while rendering.
  const lastSeenStatus = useRef(new Map<string, Status>());
  useEffect(() => {
    for (const row of streams) lastSeenStatus.current.set(row.id, row.status);
  }, [streams]);

  // Remember the filter choice across visits (single global key).
  useEffect(() => {
    saveStreamsFilter({ status: statusFilter, year: yearFilter });
  }, [statusFilter, yearFilter]);

  const handleSearch = (event: FormEvent) => {
    event.preventDefault();
    // A new term is fetched because the URL carries it; the same one again refreshes the list.
    if (search === submittedSearch) list.reload();
    else setSubmittedSearch(search);
  };

  // Extract unique years from stream dates for filter
  const years = useMemo(() => {
    const ySet = new Set<string>();
    for (const s of streams) {
      const y = s.date?.slice(0, 4);
      if (y) ySet.add(y);
    }
    return [...ySet].sort().reverse();
  }, [streams]);
  const yearOptions = useMemo(() => [{ value: '', label: 'All' }, ...years.map((y) => ({ value: y, label: y }))], [years]);

  // The saved year may not exist in the current data (e.g. after switching
  // streamer); fall back to "All" for display/filtering while keeping the saved value.
  const effectiveYear = resolveYear(yearFilter, years);

  const sorted = useMemo(() => {
    let filtered = streams;
    if (effectiveYear) {
      filtered = filtered.filter((s) => s.date?.startsWith(effectiveYear));
    }
    const copy = [...filtered];
    copy.sort((a, b) => {
      const av = a[sortKey] ?? '';
      const bv = b[sortKey] ?? '';
      const cmp = String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [streams, effectiveYear, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  // The status a row now has: in the list, and in what the page last saw. An answer can land after its row has
  // left the list (a filter or a search, while the request was out), where there is nothing to patch, and a
  // Retry must still read the status the page applied. So the two move together here, once the cascade has
  // settled: the listed row stays pending until then, and noting the status any earlier would have the next
  // merge of the list put the old one back.
  const patchRow = (id: string, status: Status) => {
    lastSeenStatus.current.set(id, status);
    list.mutate((res) => ({ ...res, data: withStatus(res.data, id, status) }));
  };

  /**
   * Runs `work` as the one request this row has out, heading for `status`. A failure toast's Retry reaches
   * here from the render that raised it, past the row's unavailable buttons: if the row is out by then,
   * nothing is sent and the same failure goes back up (the press took its toast down), so the retry is not
   * lost. `retry` is the message of that failure, for a Retry.
   */
  const runOnRow = async (
    id: string,
    status: Status,
    retry: { of: string | undefined; raise: (message: string) => void },
    work: () => Promise<void>,
  ) => {
    if (rowsOut.current.has(id)) {
      if (retry.of !== undefined) retry.raise(retry.of);
      return;
    }
    rowsOut.current.add(id);
    setActing((current) => new Map(current).set(id, status));
    try {
      await work();
    } finally {
      rowsOut.current.delete(id);
      setActing((current) => {
        const next = new Map(current);
        next.delete(id);
        return next;
      });
    }
  };

  const raiseSongsFailure = (stream: Stream, message: string) =>
    toast.error(message, { action: { label: 'Retry', onClick: () => void handleSongs(stream, message) } });

  /** The stream is approved: approves its songs and performances too, and says how that went. */
  const approveSongs = async (stream: Stream) => {
    try {
      const { songs, performances } = await api.approveAllForStream(stream.id);
      toast.success(`Stream approved · ${songs} song(s), ${performances} performance(s)`, stream.title);
    } catch (err) {
      raiseSongsFailure(stream, `Stream approved, but its songs were not: ${errorMessage(err, 'Failed to approve its songs')}`);
    }
  };

  // Only the cascade: what a failed cascade's Retry calls, the status change having landed already. That toast
  // stays until it is dismissed, so the stream can have been unapproved since: approving the songs of a stream
  // that is not approved would be wrong, and the toast saying so false. The Retry sends nothing unless the last
  // status this page saw for the stream is approved, and says why. A stream that a filter or a search has left
  // out of the list keeps the status it was last seen with, so its Retry goes through if it is still approved.
  // (A status change's Retry is left alone: sending the same change again keeps a stream and its songs
  // consistent.)
  const handleSongs = (stream: Stream, retryOf?: string) => {
    if (lastSeenStatus.current.get(stream.id) !== 'approved') {
      toast.info('Stream is no longer approved', stream.title);
      return undefined;
    }
    return runOnRow(stream.id, 'approved', { of: retryOf, raise: (message) => raiseSongsFailure(stream, message) }, () =>
      approveSongs(stream),
    );
  };

  // `retryOf` is the message of the failure toast whose Retry this call is, if it is one.
  const handleStatus = (stream: Stream, status: Status, retryOf?: string) => {
    // A Retry sends the whole change again: the change, and the read back should it fail once more.
    const raiseFailure = (message: string) =>
      toast.error(message, { action: { label: 'Retry', onClick: () => void handleStatus(stream, status, message) } });
    return runOnRow(stream.id, status, { of: retryOf, raise: raiseFailure }, async () => {
      let saved: Status;
      try {
        // A change that fails reads the stream back first, the row busy: one that has the status is done, cascade too.
        const change = () => api.updateStreamStatus(stream.id, { status });
        saved = (await sendStatusChange(status, change, () => api.getStreamDetail(stream.id))).status;
      } catch (err) {
        raiseFailure(errorMessage(err, 'Failed to update the stream'));
        return;
      }
      if (saved === 'approved') {
        // Approving a stream carries its songs and performances with it, as Stream Detail's Approve stream
        // does. The row is busy for both, and shows its new status once they are done.
        await approveSongs(stream);
      } else {
        toast.success(`Stream ${statusChangeWord(stream.status, saved)}`, stream.title);
      }
      patchRow(stream.id, saved);
    });
  };

  const handleChange = (stream: Stream, status: Status) => void handleStatus(stream, status);

  const handleRetry = (event: MouseEvent<HTMLButtonElement>) => {
    // The alert leaves as soon as the load restarts, and the Retry that held the focus with it: the
    // page heading takes it, rather than <body>.
    if (document.activeElement === event.currentTarget) headingRef.current?.focus();
    list.reload();
  };

  const isCurator = user.role === 'curator';

  return (
    // No blur, transform or filter on this root or its wrappers, and no overflow either: the sticky
    // header and table head track <main>.
    <div className="flex flex-col">
      <PageHeader
        crumb="CATALOG"
        title="Streams"
        titleRef={headingRef}
        meta={list.data === null ? undefined : countText(sorted.length, streams.length)}
        actions={
          <Link to="/submit/stream" className={buttonClasses({ variant: 'primary' })}>
            <Icon name="plus" size={14} />
            New stream
          </Link>
        }
      >
        <form role="search" onSubmit={handleSearch} className="flex min-w-0 flex-1 items-center gap-2">
          <SearchInput
            aria-label="Search streams by title or video ID"
            label="Search streams"
            placeholder="Search by title or video ID…"
            value={search}
            onChange={setSearch}
            className="min-w-0 flex-1 sm:w-[260px] sm:flex-none"
          />
          <Button type="submit">Search</Button>
        </form>
      </PageHeader>

      <div className="flex flex-col gap-3 p-4 lg:px-5 lg:pb-[18px]">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <StatusFilterBar
            options={STATUS_FILTERS}
            value={statusFilter}
            onChange={setStatusFilter}
            labelledBy={STATUS_FILTER_LABEL_ID}
            className="flex-wrap gap-2"
            heading={
              <span id={STATUS_FILTER_LABEL_ID} className={GROUP_LABEL}>
                Status
              </span>
            }
          />
          {years.length > 1 ? (
            <StatusFilterBar
              options={yearOptions}
              value={effectiveYear}
              onChange={setYearFilter}
              labelledBy={YEAR_FILTER_LABEL_ID}
              className="flex-wrap gap-2"
              heading={
                <span id={YEAR_FILTER_LABEL_ID} className={GROUP_LABEL}>
                  Year
                </span>
              }
            />
          ) : null}
        </div>

        {list.error !== null ? (
          <Note tone="danger" icon="alert" role="alert" title="Couldn't load streams.">
            <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
              <span>{list.error}</span>
              <Button size="sm" icon="refresh" onClick={handleRetry}>
                Retry
              </Button>
            </span>
          </Note>
        ) : null}

        {list.data === null ? (
          list.loading ? (
            <GlassCard>
              <Skeleton rows={8} label="Loading streams…" />
            </GlassCard>
          ) : null
        ) : (
          <StreamsTable
            streams={sorted}
            curator={isCurator}
            today={today}
            sortKey={sortKey}
            sortDir={sortDir}
            acting={acting}
            onSort={toggleSort}
            onChange={handleChange}
          />
        )}
      </div>
    </div>
  );
}
