import { useMemo, useState } from 'react';
import type { AuthUser, CrystalTicket, CrystalTicketStatus, CrystalTicketType } from '../../../shared/types';
import { api } from '../api/client';
import { useApiResource, errorMessage } from '../lib/apiResource';
import { countByStatus, matchesFilter, replaceById } from '../lib/status-totals';
import { GradientButton, OutlineButton } from '../components/prism/Buttons';
import { DetailField } from '../components/prism/DetailField';
import { PrismTextarea } from '../components/prism/Fields';
import { GlassCard } from '../components/prism/GlassCard';
import { Icon, type IconName } from '../components/prism/Icon';
import { Pill, StatusPill } from '../components/prism/Pill';
import { PrismPage } from '../components/prism/PrismPage';
import { SectionLabel } from '../components/prism/SectionLabel';
import { StatusFilterBar, type StatusFilterOption } from '../components/StatusFilterBar';

const TYPE_LABELS: Record<CrystalTicketType, string> = {
  bug: 'Bug',
  feat: 'Feature',
  ui: 'UI',
  other: 'Other',
};

// Tinted icon tile + coloured type word, as on the prism-styled Q&A page.
const TYPE_STYLES: Record<CrystalTicketType, { icon: IconName; tile: string; text: string }> = {
  bug: { icon: 'bug', tile: 'bg-[#FEE2E2] text-[#DC2626]', text: 'text-[#DC2626]' },
  feat: { icon: 'lightbulb', tile: 'bg-[#F3E8FF] text-[#A855F7]', text: 'text-[#A855F7]' },
  ui: { icon: 'layout', tile: 'bg-accent-bg-blue-muted text-accent-blue', text: 'text-accent-blue' },
  other: { icon: 'message', tile: 'bg-[#F1F5F9] text-[#64748B]', text: 'text-token-secondary' },
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

export default function CrystalTickets({ user }: { user: AuthUser }) {
  const [statusFilter, setStatusFilter] = useState<'' | CrystalTicketStatus>('pending');
  const [typeFilter, setTypeFilter] = useState<'' | CrystalTicketType>('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // One unfiltered load feeds both the table and the hero totals; the filters
  // are chips, not a reason to ask the server for the same rows again.
  const list = useApiResource(async () => (await api.listCrystalTickets()).data, []);
  // Stable reference while loading, so the filter memo doesn't recompute every render.
  const allTickets = useMemo(() => list.data ?? [], [list.data]);
  const tickets = useMemo(
    () => allTickets.filter(
      (ticket) => matchesFilter(ticket.status, statusFilter) && matchesFilter(ticket.type, typeFilter),
    ),
    [allTickets, statusFilter, typeFilter],
  );
  const loading = list.loading;

  /** Resolves true once the row may clear the draft it just sent. */
  const handleReply = async (id: string, text: string): Promise<boolean> => {
    setActionLoading(id);
    setActionError(null);
    try {
      const updated = await api.replyCrystalTicket(id, text);
      list.mutate((tickets) => replaceById(tickets, updated));
      return true;
    } catch (err) {
      setActionError(errorMessage(err, 'Reply failed'));
      return false;
    } finally {
      setActionLoading(null);
    }
  };

  const handleStatusChange = async (id: string, status: CrystalTicketStatus) => {
    setActionLoading(id);
    setActionError(null);
    try {
      const updated = await api.updateCrystalTicketStatus(id, status);
      list.mutate((tickets) => replaceById(tickets, updated));
    } catch (err) {
      setActionError(errorMessage(err, 'Status update failed'));
    } finally {
      setActionLoading(null);
    }
  };

  const isCurator = user.role === 'curator';
  const countOf = (status: CrystalTicketStatus) => countByStatus(allTickets, status);

  return (
    <PrismPage
      icon="crystal"
      badge="Feedback"
      title="Crystal"
      description="Bug reports and suggestions from the public Crystal form."
      count={`${allTickets.length} tickets`}
      stats={[
        { value: countOf('pending'), label: 'Pending' },
        { value: countOf('replied'), label: 'Replied' },
        { value: countOf('closed'), label: 'Closed' },
      ]}
      toolbar={
        <>
          <StatusFilterBar
            options={STATUS_FILTERS}
            value={statusFilter}
            onChange={setStatusFilter}
            labelledBy={STATUS_FILTER_LABEL_ID}
            heading={<span id={STATUS_FILTER_LABEL_ID} className="sr-only">Status:</span>}
          />
          <div aria-hidden="true" className="h-5 w-px bg-border-token" />
          <StatusFilterBar
            options={TYPE_FILTERS}
            value={typeFilter}
            onChange={setTypeFilter}
            labelledBy={TYPE_FILTER_LABEL_ID}
            heading={<span id={TYPE_FILTER_LABEL_ID} className="sr-only">Type:</span>}
          />
        </>
      }
    >
      <div className="px-6 pb-6 pt-3">
        {list.error && (
          <div className="mb-4 rounded-radius-lg border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#B91C1C]">
            {list.error}
          </div>
        )}
        {actionError && (
          <div className="mb-4 rounded-radius-lg border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#B91C1C]">
            {actionError}
          </div>
        )}

        {loading ? (
          <p className="py-6 text-center text-sm text-token-secondary">Loading...</p>
        ) : tickets.length === 0 ? (
          <p className="py-6 text-center text-sm text-token-tertiary">No tickets found.</p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {tickets.map((ticket) => (
              <TicketRow
                key={ticket.id}
                ticket={ticket}
                isCurator={isCurator}
                expanded={expandedId === ticket.id}
                actionLoading={actionLoading === ticket.id}
                onToggle={() => setExpandedId(expandedId === ticket.id ? null : ticket.id)}
                onReply={handleReply}
                onStatusChange={handleStatusChange}
              />
            ))}
          </div>
        )}
      </div>
    </PrismPage>
  );
}

/**
 * One ticket: its summary row and, while expanded, its detail and reply
 * editor. The reply draft lives here — typing re-renders this ticket rather
 * than the inbox, and collapsing the row keeps what has been written.
 */
export function TicketRow({
  ticket,
  isCurator,
  expanded,
  actionLoading,
  onToggle,
  onReply,
  onStatusChange,
}: {
  ticket: CrystalTicket;
  isCurator: boolean;
  expanded: boolean;
  actionLoading: boolean;
  onToggle: () => void;
  /** Resolves true when the reply landed, so the row may clear its draft. */
  onReply: (id: string, text: string) => Promise<boolean>;
  onStatusChange: (id: string, status: CrystalTicketStatus) => void;
}) {
  const [replyText, setReplyText] = useState('');
  const type = TYPE_STYLES[ticket.type];
  const detailsId = `crystal-ticket-details-${ticket.id}`;

  const send = async () => {
    const text = replyText.trim();
    if (!text) return;
    if (await onReply(ticket.id, text)) setReplyText('');
  };

  return (
    <div className={`rounded-radius-lg ${expanded ? 'bg-[#FCE7F320]' : ''}`}>
      {/* Summary row */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={detailsId}
        className="hover-row flex w-full items-center gap-3 rounded-radius-lg px-3 py-2.5 text-left"
      >
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-radius-sm ${type.tile}`}
        >
          <Icon name={type.icon} size={16} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span
            className={`truncate text-[15px] font-bold leading-tight ${
              expanded ? 'text-accent-pink-dark' : 'text-token-primary'
            }`}
          >
            {ticket.title}
          </span>
          <span className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-token-secondary">
            <span className={`font-semibold ${type.text}`}>{TYPE_LABELS[ticket.type]}</span>
            <span className="text-token-tertiary">·</span>
            <span>{ticket.nickname || 'anon'}</span>
            <span className="text-token-tertiary">·</span>
            <span className="font-mono">{ticket.submitted_at?.slice(0, 10)}</span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {ticket.is_public_reply_allowed ? (
            <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-radius-pill border border-border-token px-2 py-0.5 text-[10px] font-semibold leading-4 text-token-secondary">
              <Icon name="globe" size={11} />
              Public
            </span>
          ) : null}
          <StatusPill status={ticket.status} />
        </span>
        <span className="flex w-7 justify-end text-token-tertiary">
          <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={20} />
        </span>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div
          id={detailsId}
          className={`grid gap-6 border-t border-border-token-table px-3 pb-3 pt-4 ${
            isCurator ? 'grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px]' : 'grid-cols-1'
          }`}
        >
          <div className="flex min-w-0 flex-col gap-4">
            <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-3">
              <DetailField label="ID" value={ticket.id} mono />
              <DetailField label="Contact" value={ticket.contact} />
              <DetailField label="Submitted" value={ticket.submitted_at} />
              {ticket.context_url && (
                <DetailField label="Context URL" className="col-span-3">
                  <p className="break-all text-[13px] leading-normal text-accent-blue">{ticket.context_url}</p>
                </DetailField>
              )}
            </div>

            <DetailField label="Description">
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-token-primary">{ticket.body}</p>
            </DetailField>

            {/* Existing reply */}
            {ticket.admin_reply && (
              <div className="flex flex-col gap-2 rounded-radius-lg border border-border-token-glass bg-surface-glass px-3.5 py-3">
                <div className="flex items-center gap-2">
                  <Pill tone="pink">Reply</Pill>
                  <span className="font-mono text-[11px] text-token-secondary">{ticket.replied_at?.slice(0, 10)}</span>
                </div>
                <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-token-primary">{ticket.admin_reply}</p>
              </div>
            )}
          </div>

          {/* Actions */}
          {isCurator && (
            <GlassCard className="flex flex-col gap-2.5 self-start p-4">
              <SectionLabel>Reply</SectionLabel>
              <PrismTextarea
                rows={4}
                placeholder={ticket.admin_reply ? 'Update reply...' : 'Write a reply...'}
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
              />
              <div className="flex items-center gap-2">
                <GradientButton icon="send" onClick={send} disabled={actionLoading || !replyText.trim()}>
                  {actionLoading ? '...' : (ticket.admin_reply ? 'Update Reply' : 'Send Reply')}
                </GradientButton>
                {ticket.status !== 'closed' && (
                  <OutlineButton
                    icon="check"
                    onClick={() => onStatusChange(ticket.id, 'closed')}
                    disabled={actionLoading}
                  >
                    Close
                  </OutlineButton>
                )}
                {ticket.status === 'closed' && (
                  <OutlineButton
                    icon="undo"
                    onClick={() => onStatusChange(ticket.id, 'pending')}
                    disabled={actionLoading}
                  >
                    Reopen
                  </OutlineButton>
                )}
              </div>
            </GlassCard>
          )}
        </div>
      )}
    </div>
  );
}
