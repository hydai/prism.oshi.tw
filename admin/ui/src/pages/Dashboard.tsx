import { useCallback, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { AuthUser, Song, Stream, StreamWithPending, WorkMatchStats } from '../../../shared/types';
import { api } from '../api/client';
import type { VodExportStatusResponse } from '../api/vodExportTypes';
import { AttentionCard } from '../components/dashboard/AttentionCard';
import { CatalogBars } from '../components/dashboard/CatalogBars';
import { useInboxCounts } from '../components/shell/InboxCounts';
import { useCurrentStreamerName } from '../components/shell/Streamers';
import { Button } from '../components/ui/Button';
import { EmptyState, GlassCard, Skeleton } from '../components/ui/Display';
import { Icon } from '../components/ui/Icon';
import { PageHeader } from '../components/ui/PageHeader';
import { Pill, StatusPill } from '../components/ui/Pill';
import { HeadCell, Table, TableEmptyRow, THead } from '../components/ui/Table';
import { CELL_X, FIRST_CELL_X, LAST_CELL_X } from '../components/ui/table-cells';
import { useNow } from '../hooks/useNow';
import { useApiResource } from '../lib/apiResource';
import { formatFullTime, formatRelative, formatWhen } from '../lib/dates';
import {
  continueStampingStreams,
  inboxTotal,
  monthDay,
  oldestPendingDate,
  streamsWithWork,
  vodExportState,
} from '../lib/dashboard-data';

type LoadState = 'loading' | 'error' | 'ready';

/** Where a card or a section stands: its load's own state, or a Retry of that failed load still running. */
type ShownState = LoadState | 'retrying';

/** The page's own loads, by name (the inbox counts are the shell's). */
type LoadName = 'stats' | 'stampStats' | 'stampStreams' | 'pendingStreams' | 'workMatches' | 'vodStatus';

/**
 * Where one load stands. An error wins over data: `useApiResource` keeps a failed reload's previous
 * data, which must not pass for current (the inbox counts read it the same way). Data kept through
 * a reload stays on screen rather than dropping back to a skeleton.
 */
function loadState(resource: { data: unknown; error: string | null }): LoadState {
  if (resource.error !== null) return 'error';
  return resource.data !== null ? 'ready' : 'loading';
}

/**
 * A card over two loads: a failure of either wins (each Retry reloads what failed), then a Retry
 * still running, then the first load's own state — its value is the card's.
 */
function combined(first: ShownState, second: ShownState): ShownState {
  if (first === 'error' || second === 'error') return 'error';
  if (first === 'retrying' || second === 'retrying') return 'retrying';
  return first;
}

// --- Needs attention ---

type DotTone = ReturnType<typeof vodExportState>['tone'];

const DOT_STATUS_CLASSES: Record<DotTone, { text: string; dot: string }> = {
  info: { text: 'text-tone-info-fg', dot: 'bg-tone-info-fg shadow-[0_0_0_3px_var(--tone-info-bg)]' },
  warn: { text: 'text-tone-warn-fg', dot: 'bg-tone-warn-fg shadow-[0_0_0_3px_var(--tone-warn-bg)]' },
  ok: { text: 'text-tone-ok-fg', dot: 'bg-tone-ok-fg shadow-[0_0_0_3px_var(--tone-ok-bg)]' },
};

/**
 * The VOD export card's value: a haloed dot and a word in the state's tone (mockup `.state`). The
 * dot sits on the first line, which is where it stays when a phone's narrow card wraps the words.
 */
function DotStatus({ tone, children }: { tone: DotTone; children: string }) {
  const classes = DOT_STATUS_CLASSES[tone];
  return (
    <span className={`inline-flex items-start gap-1.5 text-[13px] font-[750] leading-[1.2] tracking-normal ${classes.text}`}>
      <span aria-hidden="true" className={`mt-1 h-2 w-2 shrink-0 rounded-full ${classes.dot}`} />
      {children}
    </span>
  );
}

/** One inbox on the Inbox card, linking to it: its name and pending count (`—` while unknown). */
function InboxChip({ to, label, count }: { to: string; label: string; count: number | null }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center whitespace-nowrap rounded-radius-pill border border-field-line bg-field px-2 py-0.5 text-meta font-semibold text-fg-muted transition-colors hover:border-accent-fg hover:text-fg focus-visible:outline-none focus-visible:shadow-focus"
    >
      {label} <b className="ml-0.5 font-bold text-fg">{count === null ? '—' : count.toLocaleString()}</b>
    </Link>
  );
}

// --- Section cards ---

/**
 * A section card's head row (mockup `.ph`): the title, then whatever follows it. The title takes
 * the focus (`tabIndex={-1}`, out of the tab order) when a Retry in a section with no link lands.
 */
function SectionHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1">
      <h2
        tabIndex={-1}
        className="rounded-radius-xs text-[13.5px] font-bold text-fg focus-visible:outline-none focus-visible:shadow-focus"
      >
        {title}
      </h2>
      {children}
    </div>
  );
}

/** A head-row link onward (mockup `.lnk`). */
function SectionLink({ to, children }: { to: string; children: string }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-0.5 rounded-radius-xs text-[11.5px] font-[650] text-accent-fg hover:underline focus-visible:outline-none focus-visible:shadow-focus"
    >
      {children}
      <Icon name="chevronRight" size={14} />
    </Link>
  );
}

/**
 * A section whose load failed: what could not load, and a Retry of that load. While the Retry's load
 * runs (`busy`) the Retry stays, busy (`aria-disabled`, spinning, a click does nothing), so it keeps
 * the focus; if it still has it when the load lands, the section's first link — or its title, where
 * it has none — takes it. The Retry's cleanup runs while it is still in the document, before the
 * section's new content arrives, so the first link is the section head's own.
 */
function SectionError({ what, title, busy, onRetry }: { what: string; title: string; busy: boolean; onRetry: () => void }) {
  const retryRef = useCallback((button: HTMLButtonElement | null) => {
    if (button === null) return undefined;
    return () => {
      if (document.activeElement !== button) return;
      const section = button.closest('section');
      (section?.querySelector<HTMLElement>('a[href]') ?? section?.querySelector<HTMLElement>('h2'))?.focus();
    };
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 py-2 text-token-sm">
      <Icon name="alert" size={14} className="text-tone-danger-fg" />
      <p role="alert" className="text-fg-muted">
        Couldn’t load {what}.
      </p>
      <Button
        ref={retryRef}
        size="sm"
        icon="refresh"
        aria-label={busy ? `Retrying ${title}…` : `Retry ${title}`}
        aria-disabled={busy ? 'true' : undefined}
        className={busy ? 'cursor-progress [&>svg]:animate-spin' : undefined}
        onClick={busy ? undefined : onRetry}
      >
        {busy ? 'Retrying…' : 'Retry'}
      </Button>
    </div>
  );
}

/** Continue stamping's rows: each opens its stream in the Stamp Editor. */
function StampingList({ streams }: { streams: StreamWithPending[] }) {
  if (streams.length === 0) return <EmptyState icon="checkCircle" title="Nothing left to stamp" />;
  return (
    <ul>
      {streams.map((stream) => {
        const name = stream.title || stream.videoId;
        return (
          <li key={stream.id} className="border-b border-line-soft last:border-b-0">
            <Link
              to={`/stamp?stream=${encodeURIComponent(stream.id)}`}
              className="grid h-9 grid-cols-[auto_minmax(0,1fr)_auto_14px] items-center gap-2.5 rounded-radius-sm text-[12px] transition-colors hover:bg-field focus-visible:outline-none focus-visible:shadow-focus"
            >
              {/* The full date from 640 px, MM-DD on a phone. */}
              <Pill tone="neutral" className="tabular-nums">
                <span className="max-sm:hidden">{stream.date}</span>
                <span className="sm:hidden">{monthDay(stream.date)}</span>
              </Pill>
              {/* A long title is cut by CSS only; the full text stays in `title`. */}
              <span title={name} className="truncate font-[550] text-fg">
                {name}
              </span>
              <span className="whitespace-nowrap text-[11px] font-bold text-tone-warn-fg">
                {stream.pendingCount.toLocaleString()} left
              </span>
              <Icon name="chevronRight" size={14} className="text-fg-subtle" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Type icon, title, type, status, submitter, when. */
const RECENT_COLUMNS = 6;

/**
 * The newest songs and streams, in the kit table. A click anywhere on a row opens the record; the
 * title is the link a keyboard reaches, and a click on it is left to the link alone, so it neither
 * opens the record twice nor overrides a modified click (a new tab). Fixed layout: from 1280 px it
 * fits the card, the title and submitter cut short (full text in `title`); below that it keeps a
 * minimum width and scrolls inside the card, which clips with `overflow-clip` (no scroll container,
 * so the sticky head keeps tracking `<main>`). `now` is when the page loaded: a date only needs it
 * to leave out the current year, so no clock tick re-renders the table.
 */
function RecentSubmissions({ items, now }: { items: (Song | Stream)[]; now: number }) {
  const navigate = useNavigate();
  const today = new Date(now);
  return (
    <Table className="table-fixed text-[12px] max-xl:min-w-[720px]">
      <colgroup>
        <col className="w-[36px]" />
        <col />
        <col className="w-[72px]" />
        <col className="w-[96px]" />
        <col className="w-[180px]" />
        <col className="w-[120px]" />
      </colgroup>
      <THead>
        <tr>
          <HeadCell className={FIRST_CELL_X}>
            <span className="sr-only">Icon</span>
          </HeadCell>
          <HeadCell className={CELL_X}>Title</HeadCell>
          <HeadCell className={CELL_X}>Type</HeadCell>
          <HeadCell className={CELL_X}>Status</HeadCell>
          <HeadCell className={CELL_X}>Submitted by</HeadCell>
          <HeadCell className={LAST_CELL_X}>When</HeadCell>
        </tr>
      </THead>
      <tbody>
        {items.map((item) => {
          const isSong = 'originalArtist' in item;
          const href = `${isSong ? '/songs' : '/streams'}/${encodeURIComponent(item.id)}`;
          return (
            <tr
              key={`${isSong ? 'song' : 'stream'}-${item.id}`}
              onClick={(event) => {
                if (event.target instanceof Element && event.target.closest('a')) return;
                navigate(href);
              }}
              className="h-11 cursor-pointer border-b border-line-soft transition-colors last:border-b-0 hover:bg-field"
            >
              <td className={FIRST_CELL_X}>
                <Icon name={isSong ? 'music' : 'radio'} size={14} className="text-fg-subtle" />
              </td>
              <td className={CELL_X}>
                <Link
                  to={href}
                  title={item.title}
                  className="block truncate rounded-radius-xs font-semibold text-fg hover:underline focus-visible:outline-none focus-visible:shadow-focus"
                >
                  {item.title}
                </Link>
              </td>
              <td className={`${CELL_X} text-fg-muted`}>{isSong ? 'Song' : 'Stream'}</td>
              <td className={CELL_X}>
                <StatusPill status={item.status} />
              </td>
              <td className={CELL_X}>
                <div title={item.submittedBy ?? undefined} className="truncate text-[11.5px] text-fg-muted">
                  {item.submittedBy ?? '—'}
                </div>
              </td>
              <td className={LAST_CELL_X}>
                <span title={formatFullTime(item.createdAt)} className="whitespace-nowrap text-[11.5px] text-fg-muted">
                  {formatWhen(item.createdAt, today)}
                </span>
              </td>
            </tr>
          );
        })}
        {items.length === 0 ? <TableEmptyRow colSpan={RECENT_COLUMNS}>No recent submissions.</TableEmptyRow> : null}
      </tbody>
    </Table>
  );
}

// --- Dashboard Page ---

/** "Updated …" in the header, on its own 30 s tick: the tick re-renders this text, not the page. */
function UpdatedAgo({ at }: { at: number }) {
  const now = useNow(30_000);
  return <span className="text-token-sm text-fg-muted">Updated {formatRelative(at, now)}</span>;
}

/**
 * What needs attention today (spec §8.1): five cards — To stamp, Streams to review, Inbox, and for
 * a curator Duplicate candidates and VOD export — each loading and failing on its own; the catalog
 * as stacked bars; the streams to continue stamping; the newest submissions. Six loads, each with
 * its own Retry; Refresh reloads all six and the inbox counts. A contributor's page never asks for
 * the curator-only data.
 */
export default function Dashboard({ user }: { user: AuthUser }) {
  const isCurator = user.role === 'curator';
  const streamerName = useCurrentStreamerName();
  const inbox = useInboxCounts();
  // When the page last loaded everything: the "Updated …" text counts from it, and the dates on the
  // page read their year off it.
  const [refreshedAt, setRefreshedAt] = useState(() => Date.now());
  // The loads currently shown suppressed after a failure — added by a Retry, or by a Refresh of a
  // load that is still failing; Refresh drops whichever are no longer failing (see `shown`).
  const [retried, setRetried] = useState<ReadonlySet<LoadName>>(() => new Set());

  const stats = useApiResource(api.stats, []);
  const stampStats = useApiResource(api.stampStats, []);
  const stampStreams = useApiResource(() => api.listStampStreams().then((res) => res.data), []);
  const pendingStreams = useApiResource(() => api.listStreams({ status: 'pending' }).then((res) => res.data), []);
  // Curator-only endpoints: for a contributor these resolve `null` without sending a request.
  const workMatches = useApiResource<WorkMatchStats | null>(
    () => (isCurator ? api.listWorkMatches({ pageSize: 1 }).then((res) => res.stats) : Promise.resolve(null)),
    [isCurator],
  );
  const vodStatus = useApiResource<VodExportStatusResponse | null>(
    () => (isCurator ? api.vodExportStatus() : Promise.resolve(null)),
    [isCurator],
  );

  const loads: Record<LoadName, { loading: boolean; data: unknown; error: string | null; reload: () => void }> = {
    stats,
    stampStats,
    stampStreams,
    pendingStreams,
    workMatches,
    vodStatus,
  };

  /**
   * Where a load stands on screen. `useApiResource` keeps a load's last data through a reload, so a
   * Retry of a failed load would show the value it had before it failed (or, with none, a skeleton
   * that takes the focused Retry away) until it lands. So a load a Retry reloaded is `retrying` for
   * as long as that reload runs: its card and sections keep their failed layout, the Retry busy.
   */
  const shown = (name: LoadName): ShownState =>
    retried.has(name) && loads[name].loading ? 'retrying' : loadState(loads[name]);

  /** A Retry: reloads whichever of `names` failed, and marks them retried. */
  const retry = (names: LoadName[]) => {
    const failed = names.filter((name) => loads[name].error !== null);
    if (failed.length === 0) return;
    setRetried((previous) => new Set([...previous, ...failed]));
    for (const name of failed) loads[name].reload();
  };

  const refresh = () => {
    // A load that is currently shown failed or mid-retry stays suppressed through this reload too,
    // so it never flashes the value it had before it ever failed; a load that is currently fine
    // keeps today's stale-while-revalidate treatment. Read before `reload()` changes `loading`.
    // A plain loop, not `.filter()`: a callback here reads as impure-during-render to the compiler
    // once this function also calls `Date.now()` below.
    const loadNames: LoadName[] = ['stats', 'stampStats', 'stampStreams', 'pendingStreams', 'workMatches', 'vodStatus'];
    const stillFailing: LoadName[] = [];
    for (const name of loadNames) {
      if (loads[name].error !== null || (retried.has(name) && loads[name].loading)) stillFailing.push(name);
    }
    stats.reload();
    stampStats.reload();
    stampStreams.reload();
    pendingStreams.reload();
    workMatches.reload();
    vodStatus.reload();
    inbox.refresh();
    setRetried(new Set(stillFailing));
    setRefreshedAt(Date.now());
  };

  // A card over two loads fails with either; its Retry reloads the ones that failed. To stamp's
  // streams only complete its sub-line, so their failure is Continue stamping's alone.
  const retryStamp = () => retry(['stampStats', 'stampStreams']);
  const retryReview = () => retry(['stats', 'pendingStreams']);

  const today = new Date(refreshedAt);

  const stampCounts = stampStats.data;
  const workStreams = shown('stampStreams') === 'ready' ? stampStreams.data : null;
  const withWork = workStreams ? streamsWithWork(workStreams) : null;
  // Each part stays on one line, so a phone never leaves "done" on a line of its own.
  let stampSub: string[] | undefined;
  if (stampCounts) {
    const done = `${stampCounts.filled.toLocaleString()} / ${stampCounts.total.toLocaleString()} done`;
    stampSub = withWork === null ? [done] : [`${withWork.toLocaleString()} ${withWork === 1 ? 'stream' : 'streams'}`, done];
  }

  const pendingList = shown('pendingStreams') === 'ready' ? pendingStreams.data : null;
  const oldestPending = pendingList ? oldestPendingDate(pendingList) : null;
  let reviewSub: string | undefined;
  if (pendingList) reviewSub = oldestPending ? `Oldest from ${oldestPending}` : 'Nothing waiting';

  const waiting = inboxTotal(inbox);
  const matchStats = workMatches.data;
  const vod = vodStatus.data;
  const vodState = vod ? vodExportState(vod) : null;
  let vodSub: string | undefined;
  if (vod) {
    vodSub = vod.currentPublication
      ? `Last published ${formatWhen(vod.currentPublication.publishedAt, today)}`
      : 'Never published';
  }

  const statsState = shown('stats');
  const stampStreamsState = shown('stampStreams');

  let catalogBody: ReactNode;
  let recentBody: ReactNode;
  if (statsState === 'ready' && stats.data) {
    catalogBody = (
      <CatalogBars
        rows={[
          { label: 'Songs', counts: stats.data.songs },
          { label: 'Streams', counts: stats.data.streams },
          { label: 'Performances', counts: stats.data.performances },
        ]}
      />
    );
    recentBody = <RecentSubmissions items={stats.data.recentSubmissions} now={refreshedAt} />;
  } else if (statsState === 'error' || statsState === 'retrying') {
    const busy = statsState === 'retrying';
    catalogBody = <SectionError what="the catalog" title="Catalog" busy={busy} onRetry={() => retry(['stats'])} />;
    recentBody = (
      <div className="px-4 pb-2">
        <SectionError what="recent submissions" title="Recent submissions" busy={busy} onRetry={() => retry(['stats'])} />
      </div>
    );
  } else {
    catalogBody = <Skeleton rows={3} label="Loading the catalog..." />;
    recentBody = (
      <div className="px-4 pb-3">
        <Skeleton rows={5} label="Loading recent submissions..." />
      </div>
    );
  }

  let stampingBody: ReactNode;
  if (stampStreamsState === 'ready' && stampStreams.data) {
    stampingBody = <StampingList streams={continueStampingStreams(stampStreams.data)} />;
  } else if (stampStreamsState === 'error' || stampStreamsState === 'retrying') {
    stampingBody = (
      <SectionError
        what="the streams to stamp"
        title="Continue stamping"
        busy={stampStreamsState === 'retrying'}
        onRetry={() => retry(['stampStreams'])}
      />
    );
  } else {
    stampingBody = <Skeleton rows={4} label="Loading the streams to stamp..." />;
  }

  return (
    <div className="flex flex-col">
      <PageHeader
        crumb={`Overview · ${streamerName}`}
        title="Dashboard"
        actions={
          <>
            <UpdatedAgo at={refreshedAt} />
            <Button size="sm" icon="refresh" onClick={refresh}>
              Refresh
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-3 p-4 lg:px-5 lg:pb-[18px]">
        <section className="flex flex-col gap-3">
          <h2 className="text-2xs font-bold uppercase tracking-[0.12em] text-fg-subtle">Needs attention</h2>
          <ul className={`grid grid-cols-2 gap-3 lg:grid-cols-3${isCurator ? ' xl:grid-cols-5' : ''}`}>
            <li className="min-w-0">
              <AttentionCard
                to="/stamp"
                icon="timer"
                tone="warn"
                title="To stamp"
                state={shown('stampStats')}
                value={stampCounts?.remaining.toLocaleString()}
                unit={stampCounts?.remaining === 1 ? 'song' : 'songs'}
                sub={stampSub}
                onRetry={retryStamp}
              />
            </li>
            <li className="min-w-0">
              <AttentionCard
                to="/streams?status=pending"
                icon="radio"
                tone="warn"
                title="Streams to review"
                shortTitle="To review"
                state={combined(statsState, shown('pendingStreams'))}
                value={stats.data?.streams.pending.toLocaleString()}
                unit="pending"
                sub={reviewSub}
                onRetry={retryReview}
              />
            </li>
            <li className="min-w-0">
              {/* The inbox counts are the shell's, unknown (`null`) until loaded: never a failure of
                  this page's own, so the card is always ready, with `—` while a count is unknown. */}
              <AttentionCard
                icon="inbox"
                tone="info"
                title="Inbox"
                state="ready"
                value={waiting === null ? '—' : waiting.toLocaleString()}
                unit={waiting === null ? undefined : 'waiting'}
                onRetry={() => inbox.refresh()}
              >
                <div className="flex flex-wrap gap-[5px]">
                  <InboxChip to="/nova" label="Nova" count={inbox.nova} />
                  <InboxChip to="/nova/vods" label="VODs" count={inbox.vods} />
                  <InboxChip to="/crystal" label="Crystal" count={inbox.crystal} />
                </div>
              </AttentionCard>
            </li>
            {isCurator ? (
              <>
                <li className="min-w-0">
                  <AttentionCard
                    to="/works/review"
                    icon="gitCompare"
                    tone="violet"
                    title="Duplicate candidates"
                    shortTitle="Duplicates"
                    state={shown('workMatches')}
                    value={matchStats?.pendingCount.toLocaleString()}
                    unit="open"
                    sub={matchStats ? `${matchStats.needsResearchCount.toLocaleString()} marked “needs research”` : undefined}
                    onRetry={() => retry(['workMatches'])}
                  />
                </li>
                <li className="min-w-0">
                  <AttentionCard
                    to="/vod-export"
                    icon="package"
                    tone="teal"
                    title="VOD export"
                    state={shown('vodStatus')}
                    value={vodState ? <DotStatus tone={vodState.tone}>{vodState.label}</DotStatus> : undefined}
                    sub={vodSub}
                    onRetry={() => retry(['vodStatus'])}
                  />
                </li>
              </>
            ) : null}
          </ul>
        </section>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <GlassCard as="section" padding="none" className="min-w-0 px-4 py-3">
            <SectionHead title="Catalog">
              <span className="text-[11.5px] text-fg-muted">{streamerName}</span>
              <div className="ml-auto flex items-center gap-3">
                <SectionLink to="/songs">Songs</SectionLink>
                <SectionLink to="/streams">Streams</SectionLink>
              </div>
            </SectionHead>
            <div className="mt-1.5">{catalogBody}</div>
          </GlassCard>

          <GlassCard as="section" padding="none" className="min-w-0 px-4 py-3">
            <SectionHead title="Continue stamping">
              <div className="ml-auto">
                <SectionLink to="/stamp">Stamp Editor</SectionLink>
              </div>
            </SectionHead>
            <div className="mt-1.5">{stampingBody}</div>
          </GlassCard>
        </div>

        <GlassCard as="section" padding="none" className="overflow-clip">
          <div className="px-4 pb-1.5 pt-3">
            <SectionHead title="Recent submissions">
              <span className="text-[11.5px] text-fg-muted">click a row to open it</span>
            </SectionHead>
          </div>
          {recentBody}
        </GlassCard>
      </div>
    </div>
  );
}
