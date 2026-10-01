import { useMemo, useRef, useState, type MouseEvent } from 'react';
import type { AuthUser, CrystalTicket, CrystalTicketStatus, CrystalTicketType } from '../../../shared/types';
import { api } from '../api/client';
import { useInboxCounts } from '../components/shell/InboxCounts';
import { StatusFilterBar, type StatusFilterOption } from '../components/StatusFilterBar';
import { Button } from '../components/ui/Button';
import { DetailField, SectionLabel } from '../components/ui/DetailField';
import { EmptyState, GlassCard, Skeleton } from '../components/ui/Display';
import { Textarea } from '../components/ui/Fields';
import { Icon, type IconName } from '../components/ui/Icon';
import { Note } from '../components/ui/Note';
import { PageHeader } from '../components/ui/PageHeader';
import { Pill, StatusPill } from '../components/ui/Pill';
import { statusTone, TONE_BOX_CLASS, TONE_TEXT_CLASS, type Tone } from '../components/ui/pill-core';
import { useToast } from '../components/ui/toast';
import { useRowDrafts, type RowDrafts } from '../hooks/useRowDrafts';
import { errorMessage, useApiResource } from '../lib/apiResource';
import { formatFullTime, formatWhen, storedTimeIso } from '../lib/dates';
import { NO_RECENT_ACTIONS, visibleTickets } from '../lib/review-lists';
import { countByStatus, replaceById } from '../lib/status-totals';

const TYPE_LABELS: Record<CrystalTicketType, string> = {
  bug: 'Bug',
  feat: 'Feature',
  ui: 'UI',
  other: 'Other',
};

/** A type's icon and tone: its tile is the tone's box, and its name in the meta line the tone's text. */
const TYPE_STYLES: Record<CrystalTicketType, { icon: IconName; tone: Tone }> = {
  bug: { icon: 'bug', tone: 'danger' },
  feat: { icon: 'lightbulb', tone: 'violet' },
  ui: { icon: 'layout', tone: 'info' },
  other: { icon: 'message', tone: 'neutral' },
};

const STATUS_FILTERS: ReadonlyArray<StatusFilterOption<'' | CrystalTicketStatus>> = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'replied', label: 'Replied' },
  { value: 'closed', label: 'Closed' },
];

const TYPE_FILTERS: ReadonlyArray<StatusFilterOption<'' | CrystalTicketType>> = [
  { value: '', label: 'All types' },
  { value: 'bug', label: TYPE_LABELS.bug },
  { value: 'feat', label: TYPE_LABELS.feat },
  { value: 'ui', label: TYPE_LABELS.ui },
  { value: 'other', label: TYPE_LABELS.other },
];

const STATUS_FILTER_LABEL_ID = 'crystal-ticket-status-filter-label';
const TYPE_FILTER_LABEL_ID = 'crystal-ticket-type-filter-label';
/** The uppercase micro label a filter group is named by (spec §4.3). */
const GROUP_LABEL = 'text-2xs font-bold uppercase tracking-[0.12em] text-fg-subtle';

/** The two statuses a curator moves a ticket between by hand; a reply moves it to replied itself. */
type TicketStatusChange = Extract<CrystalTicketStatus, 'closed' | 'pending'>;

/** What a ticket's request is out for: its reply, or the status it is heading for. */
type TicketAction = 'reply' | TicketStatusChange;

/** The tickets with a request out, each with what it is out for. */
const NO_ACTIONS: ReadonlyMap<string, TicketAction> = new Map();

/** A stored time: the short form in the row, the full time on hover and the exact instant for machines. */
function StoredTime({ value, today }: { value: string; today: Date }) {
  return (
    <time dateTime={storedTimeIso(value)} title={formatFullTime(value)}>
      {formatWhen(value, today)}
    </time>
  );
}

/** The header's count: how many tickets there are, whatever the filters keep. */
function countText(total: number): string {
  return `${total} ${total === 1 ? 'ticket' : 'tickets'}`;
}

/**
 * The Crystal inbox (spec §8.9): the tickets visitors send from the public Crystal form, with their
 * status and type as chips and, for a curator, a reply and a status change on each. One unfiltered
 * load feeds the rows and the header's counts; the chips only choose which rows are shown. A ticket
 * just replied to or closed stays in view until the filter changes, so it does not vanish from the
 * Pending list under the cursor. A reply or a status change reports how it went in a toast, and the
 * button that sent it is busy meanwhile.
 */
export default function CrystalTickets({ user }: { user: AuthUser }) {
  const toast = useToast();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [statusFilter, setStatusFilter] = useState<'' | CrystalTicketStatus>('pending');
  const [typeFilter, setTypeFilter] = useState<'' | CrystalTicketType>('');
  const [justActed, setJustActed] = useState<ReadonlySet<string>>(NO_RECENT_ACTIONS);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [acting, setActing] = useState(NO_ACTIONS);
  // Reply drafts outlive their rows, which unmount on a filter change or a reload.
  const replyDrafts = useRowDrafts();
  // When the page opened: the times only need it to leave out the current year.
  const [today] = useState(() => new Date());

  // One unfiltered load feeds both the list and the header's counts; the filters
  // are chips, not a reason to ask the server for the same rows again.
  const list = useApiResource(async () => (await api.listCrystalTickets()).data, []);
  // The sidebar's pending badge loads this list separately: every change here reloads it too.
  const { refresh: refreshInboxCounts } = useInboxCounts();
  // Stable reference while loading, so the filter memo doesn't recompute every render.
  const allTickets = useMemo(() => list.data ?? [], [list.data]);
  const tickets = useMemo(
    () => visibleTickets(allTickets, { status: statusFilter, type: typeFilter, justActed }),
    [allTickets, statusFilter, typeFilter, justActed],
  );

  // A new filter is a new question: the rows held over from the last action go.
  const changeStatusFilter = (status: '' | CrystalTicketStatus) => {
    setStatusFilter(status);
    setJustActed(NO_RECENT_ACTIONS);
  };
  const changeTypeFilter = (type: '' | CrystalTicketType) => {
    setTypeFilter(type);
    setJustActed(NO_RECENT_ACTIONS);
  };
  const keepVisible = (id: string) => setJustActed((prev) => new Set(prev).add(id));

  /** Records what a ticket's request is out for, or (null) that it is done. Kept here, not in the row, which can unmount meanwhile. */
  const markActing = (id: string, action: TicketAction | null) =>
    setActing((current) => {
      const next = new Map(current);
      if (action === null) next.delete(id);
      else next.set(id, action);
      return next;
    });

  /** Resolves true once the row may clear the draft it just sent. */
  const handleReply = async (id: string, text: string): Promise<boolean> => {
    const updating = Boolean(allTickets.find((ticket) => ticket.id === id)?.admin_reply);
    markActing(id, 'reply');
    try {
      const updated = await api.replyCrystalTicket(id, text);
      list.mutate((rows) => replaceById(rows, updated));
      refreshInboxCounts('crystal');
      keepVisible(id);
      replyDrafts.clear(id);
      toast.success(updating ? 'Reply updated' : 'Reply sent');
      return true;
    } catch (err) {
      toast.error(errorMessage(err, 'Reply failed'));
      return false;
    } finally {
      markActing(id, null);
    }
  };

  /** Resolves true once the ticket has its new status. */
  const handleStatusChange = async (id: string, status: TicketStatusChange): Promise<boolean> => {
    markActing(id, status);
    try {
      const updated = await api.updateCrystalTicketStatus(id, status);
      list.mutate((rows) => replaceById(rows, updated));
      refreshInboxCounts('crystal');
      keepVisible(id);
      toast.success(status === 'closed' ? 'Ticket closed' : 'Ticket reopened');
      return true;
    } catch (err) {
      toast.error(errorMessage(err, 'Status update failed'));
      return false;
    } finally {
      markActing(id, null);
    }
  };

  const handleRetry = (event: MouseEvent<HTMLButtonElement>) => {
    // The alert leaves as soon as the load restarts, and the Retry that held the focus with it: the
    // page heading takes it, rather than <body>.
    if (document.activeElement === event.currentTarget) headingRef.current?.focus();
    list.reload();
  };

  const isCurator = user.role === 'curator';
  const countOf = (status: CrystalTicketStatus) => countByStatus(allTickets, status);

  // The skeleton is for the first load only: a later one keeps the rows, so the control that started it keeps its place.
  const showSkeleton = list.data === null && list.loading;
  const showEmpty = list.data !== null && tickets.length === 0;

  return (
    // No blur, transform or filter on this root or its wrappers, and no overflow either: the sticky
    // header tracks <main>.
    <div className="flex flex-col">
      <PageHeader
        crumb="INBOX"
        title="Crystal"
        titleRef={headingRef}
        meta={
          list.data === null ? undefined : (
            <>
              <span>{countText(allTickets.length)}</span>
              <Pill tone={statusTone('pending')}>{countOf('pending')} Pending</Pill>
              <Pill tone={statusTone('replied')}>{countOf('replied')} Replied</Pill>
              <Pill tone={statusTone('closed')}>{countOf('closed')} Closed</Pill>
            </>
          )
        }
      />

      <div className="flex flex-col gap-3 p-4 lg:px-5 lg:pb-[18px]">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <StatusFilterBar
            options={STATUS_FILTERS}
            value={statusFilter}
            onChange={changeStatusFilter}
            labelledBy={STATUS_FILTER_LABEL_ID}
            className="flex-wrap gap-2"
            heading={
              <span id={STATUS_FILTER_LABEL_ID} className={GROUP_LABEL}>
                Status
              </span>
            }
          />
          <StatusFilterBar
            options={TYPE_FILTERS}
            value={typeFilter}
            onChange={changeTypeFilter}
            labelledBy={TYPE_FILTER_LABEL_ID}
            className="flex-wrap gap-2"
            heading={
              <span id={TYPE_FILTER_LABEL_ID} className={GROUP_LABEL}>
                Type
              </span>
            }
          />
        </div>

        {list.error !== null ? (
          <Note tone="danger" icon="alert" role="alert" title="Couldn't load tickets.">
            <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
              <span>{list.error}</span>
              <Button size="sm" icon="refresh" onClick={handleRetry}>
                Retry
              </Button>
            </span>
          </Note>
        ) : null}

        {showSkeleton ? (
          <GlassCard>
            <Skeleton rows={6} label="Loading tickets…" />
          </GlassCard>
        ) : null}

        {showEmpty ? (
          <GlassCard>
            <EmptyState icon="inbox" title="No tickets found." />
          </GlassCard>
        ) : null}

        {tickets.length > 0 ? (
          <GlassCard padding="sm">
            <ul className="flex flex-col gap-0.5">
              {tickets.map((ticket) => (
                <li key={ticket.id}>
                  <TicketRow
                    ticket={ticket}
                    isCurator={isCurator}
                    expanded={expandedId === ticket.id}
                    acting={acting.get(ticket.id)}
                    today={today}
                    onToggle={() => setExpandedId(expandedId === ticket.id ? null : ticket.id)}
                    drafts={replyDrafts}
                    onReply={handleReply}
                    onStatusChange={handleStatusChange}
                  />
                </li>
              ))}
            </ul>
          </GlassCard>
        ) : null}
      </div>
    </div>
  );
}

interface TicketRowProps {
  ticket: CrystalTicket;
  isCurator: boolean;
  expanded: boolean;
  /** What this ticket's request is out for, if one is. */
  acting: TicketAction | undefined;
  /** When the page opened: the times only need it to leave out the current year. */
  today: Date;
  onToggle: () => void;
  /** The page's draft store: this row seeds from it and writes back to it. */
  drafts: RowDrafts;
  /** Resolves true when the reply landed, so the row may clear its draft. */
  onReply: (id: string, text: string) => Promise<boolean>;
  /** Resolves true when the status changed. */
  onStatusChange: (id: string, status: TicketStatusChange) => Promise<boolean>;
}

/**
 * One ticket: its summary row and, while expanded, its detail and reply card. The reply draft is
 * local — typing re-renders this ticket rather than the inbox — and is seeded from, and written
 * through to, the page's store, so it survives the row unmounting.
 *
 * While a request is out for the ticket, the button that started it is busy and keeps the focus, and
 * the other is unavailable (`aria-disabled`, never `disabled`, which would drop the focus). When the
 * request lands, that button is disabled (Send Reply, its draft gone) or turns into another (Close
 * into Reopen), so focus still on it goes to the summary row, which stays: never to <body>. Focus
 * anywhere else is the user's and stays: the reply box a curator has clicked into meanwhile, another
 * control, another row.
 */
export function TicketRow({
  ticket,
  isCurator,
  expanded,
  acting,
  today,
  onToggle,
  drafts,
  onReply,
  onStatusChange,
}: TicketRowProps) {
  const [replyText, setReplyText] = useState(() => drafts.read(ticket.id));
  const summaryRef = useRef<HTMLButtonElement>(null);
  const sendRef = useRef<HTMLButtonElement>(null);
  // Close and Reopen are one button as far as the focus goes: the same element is relabelled.
  const statusRef = useRef<HTMLButtonElement>(null);
  const type = TYPE_STYLES[ticket.type];
  const detailsId = `crystal-ticket-details-${ticket.id}`;
  const replying = acting === 'reply';
  const changingStatus = acting !== undefined && !replying;

  // Read once the request has landed, so `sender` is the button as it is by then. Only focus still on it,
  // or in no place at all, moves: an answer that lands after the user has gone elsewhere takes nothing.
  const handFocusToSummary = (sender: HTMLButtonElement | null) => {
    const held = document.activeElement;
    const nowhere = held === null || held === document.body;
    if (nowhere || (sender !== null && held === sender)) summaryRef.current?.focus();
  };

  const send = async () => {
    const text = replyText.trim();
    if (!text) return;
    if (await onReply(ticket.id, text)) {
      setReplyText('');
      handFocusToSummary(sendRef.current);
    }
  };

  const changeStatus = async (status: TicketStatusChange) => {
    if (await onStatusChange(ticket.id, status)) handFocusToSummary(statusRef.current);
  };

  return (
    <div className={`rounded-radius-lg ${expanded ? 'bg-selected' : ''}`}>
      {/* Summary row */}
      <button
        ref={summaryRef}
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={detailsId}
        className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 rounded-radius-lg px-3 py-2.5 text-left transition-colors hover:bg-row-hover focus-visible:outline-none focus-visible:shadow-focus sm:grid-cols-[auto_minmax(0,1fr)_auto_auto]"
      >
        <span
          className={`row-span-2 flex h-8 w-8 shrink-0 items-center justify-center self-start rounded-radius-sm border sm:row-span-1 sm:self-center ${TONE_BOX_CLASS[type.tone]}`}
        >
          <Icon name={type.icon} size={16} />
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span
            title={ticket.title}
            className={`text-[15px] font-bold leading-tight ${expanded ? 'break-words text-accent-fg' : 'truncate text-fg'}`}
          >
            {ticket.title}
          </span>
          <span className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-fg-muted">
            <span className={`font-semibold ${TONE_TEXT_CLASS[type.tone]}`}>{TYPE_LABELS[ticket.type]}</span>
            <span className="text-fg-subtle">·</span>
            <span>{ticket.nickname || 'anon'}</span>
            <span className="text-fg-subtle">·</span>
            <StoredTime value={ticket.submitted_at} today={today} />
          </span>
        </span>
        <span className="col-start-2 row-start-2 flex items-center gap-2 sm:col-start-3 sm:row-start-1">
          {ticket.is_public_reply_allowed ? (
            <Pill tone="neutral" className="gap-1">
              <Icon name="globe" size={11} />
              Public
            </Pill>
          ) : null}
          <StatusPill status={ticket.status} />
        </span>
        <span className="col-start-3 row-span-2 row-start-1 flex w-7 justify-end text-fg-subtle sm:col-start-4 sm:row-span-1">
          <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={20} />
        </span>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div
          id={detailsId}
          className={`grid gap-6 border-t border-line-soft px-3 pb-3 pt-4 ${
            isCurator ? 'grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px]' : 'grid-cols-1'
          }`}
        >
          <div className="flex min-w-0 flex-col gap-4">
            <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-3">
              <DetailField label="ID">
                <span className="font-mono text-xs">{ticket.id}</span>
              </DetailField>
              <DetailField label="Contact">{ticket.contact || '—'}</DetailField>
              <DetailField label="Submitted">
                <StoredTime value={ticket.submitted_at} today={today} />
              </DetailField>
              {ticket.context_url ? (
                <DetailField label="Context URL" className="sm:col-span-3">
                  <span className="break-all">{ticket.context_url}</span>
                </DetailField>
              ) : null}
              <DetailField label="Description" className="sm:col-span-3">
                <p className="whitespace-pre-wrap leading-relaxed">{ticket.body}</p>
              </DetailField>
            </dl>

            {/* Existing reply */}
            {ticket.admin_reply ? (
              <div className="flex flex-col gap-2 rounded-radius-lg border border-field-line bg-field px-3.5 py-3">
                <div className="flex items-center gap-2">
                  <Pill tone="neutral">Reply</Pill>
                  {ticket.replied_at ? (
                    <span className="text-[11px] text-fg-muted">
                      <StoredTime value={ticket.replied_at} today={today} />
                    </span>
                  ) : null}
                </div>
                <p className="whitespace-pre-wrap text-token-base leading-relaxed text-fg">{ticket.admin_reply}</p>
              </div>
            ) : null}
          </div>

          {/* Actions */}
          {isCurator ? (
            <GlassCard className="flex flex-col gap-2.5 self-start">
              <SectionLabel>Reply</SectionLabel>
              <Textarea
                rows={4}
                aria-label={ticket.admin_reply ? 'Update reply' : 'Reply'}
                placeholder={ticket.admin_reply ? 'Update reply...' : 'Write a reply...'}
                className="block resize-y"
                value={replyText}
                onChange={(e) => {
                  drafts.write(ticket.id, e.target.value);
                  setReplyText(e.target.value);
                }}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  ref={sendRef}
                  variant="primary"
                  size="sm"
                  icon="send"
                  busy={replying}
                  disabled={!replyText.trim()}
                  aria-disabled={changingStatus ? true : undefined}
                  onClick={() => void send()}
                >
                  {ticket.admin_reply ? 'Update Reply' : 'Send Reply'}
                </Button>
                {ticket.status !== 'closed' ? (
                  <Button
                    ref={statusRef}
                    size="sm"
                    icon="check"
                    busy={acting === 'closed'}
                    aria-disabled={replying ? true : undefined}
                    onClick={() => void changeStatus('closed')}
                  >
                    Close
                  </Button>
                ) : (
                  <Button
                    ref={statusRef}
                    size="sm"
                    icon="undo"
                    busy={acting === 'pending'}
                    aria-disabled={replying ? true : undefined}
                    onClick={() => void changeStatus('pending')}
                  >
                    Reopen
                  </Button>
                )}
              </div>
            </GlassCard>
          ) : null}
        </div>
      )}
    </div>
  );
}
