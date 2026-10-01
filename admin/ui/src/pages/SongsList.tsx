import { useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import type { AuthUser, Song, Status } from '../../../shared/types';
import { api } from '../api/client';
import { sendStatusChange } from '../api/status-change';
import { Pagination } from '../components/Pagination';
import { Button } from '../components/ui/Button';
import { buttonClasses } from '../components/ui/button-classes';
import { GlassCard, Skeleton } from '../components/ui/Display';
import { SearchInput } from '../components/ui/Fields';
import { Icon } from '../components/ui/Icon';
import { Note } from '../components/ui/Note';
import { PageHeader } from '../components/ui/PageHeader';
import { StatusPill } from '../components/ui/Pill';
import { StoredTime } from '../components/ui/StoredTime';
import { HeadCell, SortHeader, Table, TableEmptyRow, THead, type SortDirection } from '../components/ui/Table';
import { CELL_X, FIRST_CELL_X, LAST_CELL_X } from '../components/ui/table-cells';
import { Segmented } from '../components/ui/Toggles';
import { useToast } from '../components/ui/toast';
import { errorMessage, useApiResource } from '../lib/apiResource';

type SortKey = 'title' | 'originalArtist' | 'status' | 'createdAt';

/** What a curator decides about a song that is still waiting (pending) or queued by the extractor. */
type Decision = Extract<Status, 'approved' | 'rejected'>;

const PAGE_SIZE = 50;

const STATUS_OPTIONS: { value: '' | Status; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'excluded', label: 'Excluded' },
  { value: 'extracted', label: 'Extracted' },
];

const NO_ACTIONS: ReadonlyMap<string, Decision> = new Map();

/**
 * Ref for a row's Approve and Reject. They leave with the song's pending / extracted status, while the
 * row stays (now with its new status pill): a keyboard user who was on one of them would be left on
 * <body>, so as the button goes, the focus moves to the row's title link. React runs a ref's cleanup
 * while the button is still in the document, so the link can take the focus before the button is
 * removed. A button that does not hold the focus then (the user has moved on) takes nothing.
 */
function handFocusToTitle(button: HTMLButtonElement | null): (() => void) | undefined {
  if (button === null) return undefined;
  return () => {
    if (document.activeElement !== button) return;
    button.closest('tr')?.querySelector<HTMLElement>('a[href]')?.focus();
  };
}

interface SongRowProps {
  song: Song;
  curator: boolean;
  today: Date;
  /** The decision this song's request is out for, if any. */
  acting: Decision | undefined;
  onDecide: (song: Song, status: Decision) => Promise<void>;
}

/**
 * One song: its title (the link), artist, status and creation time; for a curator, Approve and Reject
 * while it can still be decided. While one request is out, its button is busy and the other is
 * unavailable, so a song is never decided twice at once.
 */
function SongRow({ song, curator, today, acting, onDecide }: SongRowProps) {
  const decidable = curator && (song.status === 'pending' || song.status === 'extracted');
  return (
    <tr className="h-11 border-b border-line-soft transition-colors last:border-b-0 hover:bg-row-hover">
      <td className={FIRST_CELL_X}>
        <Link
          to={`/songs/${encodeURIComponent(song.id)}`}
          title={song.title}
          className="block truncate rounded-radius-xs font-semibold text-fg hover:underline focus-visible:outline-none focus-visible:shadow-focus"
        >
          {song.title}
        </Link>
      </td>
      <td className={CELL_X}>
        <div title={song.originalArtist} className="truncate text-fg-muted">
          {song.originalArtist}
        </div>
      </td>
      <td className={CELL_X}>
        <StatusPill status={song.status} />
      </td>
      <td className={curator ? CELL_X : LAST_CELL_X}>
        <StoredTime value={song.createdAt} today={today} className="whitespace-nowrap text-[11.5px] text-fg-muted" />
      </td>
      {curator ? (
        <td className={LAST_CELL_X}>
          {decidable ? (
            <div className="flex gap-1.5">
              <Button
                ref={handFocusToTitle}
                variant="primary"
                size="sm"
                aria-label={`Approve ${song.title}`}
                busy={acting === 'approved'}
                disabled={acting === 'rejected'}
                onClick={() => void onDecide(song, 'approved')}
              >
                Approve
              </Button>
              <Button
                ref={handFocusToTitle}
                size="sm"
                aria-label={`Reject ${song.title}`}
                busy={acting === 'rejected'}
                disabled={acting === 'approved'}
                onClick={() => void onDecide(song, 'rejected')}
              >
                Reject
              </Button>
            </div>
          ) : null}
        </td>
      ) : null}
    </tr>
  );
}

interface SongsTableProps {
  songs: Song[];
  curator: boolean;
  today: Date;
  sortKey: SortKey;
  sortDir: SortDirection;
  acting: ReadonlyMap<string, Decision>;
  onSort: (key: SortKey) => void;
  onDecide: (song: Song, status: Decision) => Promise<void>;
}

/**
 * The sortable table in its glass card. Fixed layout: from 1280 px it fits the card, a long title or
 * artist cut short (full text in `title`); below that it keeps a minimum width and scrolls inside the
 * card. The card clips with `overflow-clip`, which unlike hidden / auto is no scroll container, so the
 * sticky head keeps tracking `<main>`.
 */
function SongsTable({ songs, curator, today, sortKey, sortDir, acting, onSort, onDecide }: SongsTableProps) {
  const sortProps = { activeField: sortKey, direction: sortDir, onSort };
  return (
    <GlassCard padding="none" className="overflow-clip">
      <Table className="table-fixed text-[12px] max-xl:min-w-[760px]">
        <colgroup>
          <col />
          <col className="w-[26%]" />
          <col className="w-[104px]" />
          <col className="w-[124px]" />
          {curator ? <col className="w-[176px]" /> : null}
        </colgroup>
        <THead>
          <tr>
            <SortHeader label="Title" field="title" {...sortProps} className={FIRST_CELL_X} />
            <SortHeader label="Artist" field="originalArtist" {...sortProps} className={CELL_X} />
            <SortHeader label="Status" field="status" {...sortProps} className={CELL_X} />
            <SortHeader label="Created" field="createdAt" {...sortProps} className={curator ? CELL_X : LAST_CELL_X} />
            {curator ? (
              <HeadCell className={LAST_CELL_X}>
                <span className="sr-only">Actions</span>
              </HeadCell>
            ) : null}
          </tr>
        </THead>
        <tbody>
          {songs.map((song) => (
            <SongRow
              key={song.id}
              song={song}
              curator={curator}
              today={today}
              acting={acting.get(song.id)}
              onDecide={onDecide}
            />
          ))}
          {songs.length === 0 ? <TableEmptyRow colSpan={curator ? 5 : 4}>No songs found.</TableEmptyRow> : null}
        </tbody>
      </Table>
    </GlassCard>
  );
}

/**
 * The song list (spec §8.9): search, a status filter, a table sorted and paged by the server, and for
 * a curator Approve / Reject on the songs still to be decided. The rows stay while a later load is out
 * (the skeleton is for the first one only), so a control that started the load keeps its place.
 */
export default function SongsList({ user }: { user: AuthUser }) {
  const toast = useToast();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | Status>('');
  const [sortKey, setSortKey] = useState<SortKey>('createdAt');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');
  const [page, setPage] = useState(1);
  // The songs whose status request is out, and the decision each one is for.
  const [acting, setActing] = useState(NO_ACTIONS);
  // The same songs, for the handler to read at once: a failure toast's Retry holds a handler from the render that
  // raised it, so what that render's `acting` says is not what is true now.
  const songsOut = useRef(new Set<string>());
  // When the page opened: the Created column only needs it to leave out the current year.
  const [today] = useState(() => new Date());

  const list = useApiResource(
    () =>
      api.listSongs({
        status: statusFilter || undefined,
        search: submittedSearch || undefined,
        page,
        pageSize: PAGE_SIZE,
        sortBy: sortKey,
        sortDir,
      }),
    [statusFilter, submittedSearch, page, sortKey, sortDir],
  );
  const songs = list.data?.data ?? [];
  const total = list.data?.total ?? 0;
  const totalPages = list.data?.totalPages ?? 0;
  const isCurator = user.role === 'curator';

  const handleSearch = (event: FormEvent) => {
    event.preventDefault();
    setPage(1);
    setSubmittedSearch(search);
  };

  const handleStatusChange = (value: '' | Status) => {
    setPage(1);
    setStatusFilter(value);
  };

  const toggleSort = (key: SortKey) => {
    setPage(1);
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  // `retryOf` is the message of the failure toast whose Retry this call is, if it is one.
  const handleDecision = async (song: Song, status: Decision, retryOf?: string) => {
    // A Retry sends the whole decision again: the change, and the read back should it fail once more.
    const raiseFailure = (message: string) =>
      toast.error(message, { action: { label: 'Retry', onClick: () => void handleDecision(song, status, message) } });
    if (songsOut.current.has(song.id)) {
      // Only a Retry gets here, the row's buttons being unavailable while its request is out. Pressing it took its
      // toast down, so the same failure goes back up: the retry waits there instead of being lost.
      if (retryOf !== undefined) raiseFailure(retryOf);
      return;
    }
    songsOut.current.add(song.id);
    setActing((current) => new Map(current).set(song.id, status));
    try {
      // A change that fails reads the song back first, the row busy meanwhile: one that has the status is done.
      const change = () => api.updateSongStatus(song.id, { status });
      const updated = await sendStatusChange(status, change, () => api.getSong(song.id));
      list.mutate((res) => ({ ...res, data: res.data.map((row) => (row.id === song.id ? updated : row)) }));
      toast.success(status === 'approved' ? 'Song approved' : 'Song rejected', song.title);
    } catch (err) {
      raiseFailure(errorMessage(err, 'Failed to update the song'));
    } finally {
      songsOut.current.delete(song.id);
      setActing((current) => {
        const next = new Map(current);
        next.delete(song.id);
        return next;
      });
    }
  };

  const handleRetry = (event: MouseEvent<HTMLButtonElement>) => {
    // The alert leaves as soon as the load restarts, and the Retry that held the focus with it: the
    // page heading takes it, rather than <body>.
    if (document.activeElement === event.currentTarget) headingRef.current?.focus();
    list.reload();
  };

  // Pagination display helpers
  const startItem = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const endItem = Math.min(page * PAGE_SIZE, total);

  return (
    // No blur, transform or filter on this root or its wrappers, and no overflow either: the sticky
    // header and table head track <main>.
    <div className="flex flex-col">
      <PageHeader
        crumb="CATALOG"
        title="Songs"
        titleRef={headingRef}
        actions={
          <Link to="/submit/song" className={buttonClasses({ variant: 'primary' })}>
            <Icon name="plus" size={14} />
            New song
          </Link>
        }
      >
        <form role="search" onSubmit={handleSearch} className="flex min-w-0 flex-1 items-center gap-2">
          <SearchInput
            label="Search by title or artist"
            placeholder="Search by title or artist…"
            value={search}
            onChange={setSearch}
            className="min-w-0 flex-1 sm:w-[260px] sm:flex-none"
          />
          <Button type="submit">Search</Button>
        </form>
      </PageHeader>

      <div className="flex flex-col gap-3 p-4 lg:px-5 lg:pb-[18px]">
        {/* Six options outgrow a phone: there the filter scrolls, not the page. */}
        <div className="min-w-0 max-w-full overflow-x-auto">
          <Segmented
            label="Filter songs by status"
            value={statusFilter}
            onChange={handleStatusChange}
            options={STATUS_OPTIONS}
          />
        </div>

        {list.error !== null ? (
          <Note
            tone="danger"
            icon="alert"
            role="alert"
            title="Couldn't load songs."
            action={<Button size="sm" icon="refresh" onClick={handleRetry}>Retry</Button>}
          >
            {list.error}
          </Note>
        ) : null}

        {list.data === null ? (
          list.loading ? (
            <GlassCard>
              <Skeleton rows={8} label="Loading songs…" />
            </GlassCard>
          ) : null
        ) : (
          <div>
            <SongsTable
              songs={songs}
              curator={isCurator}
              today={today}
              sortKey={sortKey}
              sortDir={sortDir}
              acting={acting}
              onSort={toggleSort}
              onDecide={handleDecision}
            />

            <Pagination
              page={page}
              totalPages={totalPages}
              total={total}
              shown={{ start: startItem, end: endItem }}
              onPrev={() => setPage((p) => Math.max(1, p - 1))}
              onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
            />
          </div>
        )}
      </div>
    </div>
  );
}
