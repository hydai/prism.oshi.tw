import { useState } from 'react';
import type { AuthUser, CrystalTicketStatus, CrystalTicketType } from '../../../shared/types';
import { api } from '../api/client';
import { useApiResource, errorMessage } from '../lib/apiResource';
import { countByStatus, replaceById } from '../lib/status-totals';
import { GradientButton, OutlineButton } from '../components/prism/Buttons';
import { Chip } from '../components/prism/Chip';
import { DetailField } from '../components/prism/DetailField';
import { PrismTextarea } from '../components/prism/Fields';
import { GlassCard } from '../components/prism/GlassCard';
import { Icon, type IconName } from '../components/prism/Icon';
import { Pill, StatusPill } from '../components/prism/Pill';
import { PrismPage } from '../components/prism/PrismPage';
import { SectionLabel } from '../components/prism/SectionLabel';

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

const STATUS_FILTERS = ['', 'pending', 'replied', 'closed'] as const;
const TYPE_FILTERS = ['', 'bug', 'feat', 'ui', 'other'] as const;

const STATUS_FILTER_LABEL_ID = 'crystal-ticket-status-filter-label';
const TYPE_FILTER_LABEL_ID = 'crystal-ticket-type-filter-label';

function statusFilterLabel(status: '' | CrystalTicketStatus): string {
  if (!status) return 'All';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export default function CrystalTickets({ user }: { user: AuthUser }) {
  const [statusFilter, setStatusFilter] = useState<'' | CrystalTicketStatus>('pending');
  const [typeFilter, setTypeFilter] = useState<'' | CrystalTicketType>('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState<Record<string, string>>({});
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const list = useApiResource(
    async () => {
      const [res, all] = await Promise.all([
        api.listCrystalTickets({
          status: statusFilter || undefined,
          type: typeFilter || undefined,
        }),
        api.listCrystalTickets(),
      ]);
      return { tickets: res.data, allTickets: all.data };
    },
    [statusFilter, typeFilter],
  );
  const tickets = list.data?.tickets ?? [];
  const allTickets = list.data?.allTickets ?? [];
  const loading = list.loading;

  const handleReply = async (id: string) => {
    const text = replyText[id]?.trim();
    if (!text) return;
    setActionLoading(id);
    try {
      const updated = await api.replyCrystalTicket(id, text);
      list.mutate(({ tickets, allTickets }) => ({ tickets: replaceById(tickets, updated), allTickets: replaceById(allTickets, updated) }));
      setReplyText((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (err) {
      setActionError(errorMessage(err, 'Reply failed'));
    } finally {
      setActionLoading(null);
    }
  };

  const handleStatusChange = async (id: string, status: CrystalTicketStatus) => {
    setActionLoading(id);
    try {
      const updated = await api.updateCrystalTicketStatus(id, status);
      list.mutate(({ tickets, allTickets }) => ({ tickets: replaceById(tickets, updated), allTickets: replaceById(allTickets, updated) }));
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
          <div className="flex items-center gap-1.5" role="group" aria-labelledby={STATUS_FILTER_LABEL_ID}>
            <span id={STATUS_FILTER_LABEL_ID} className="sr-only">Status:</span>
            {STATUS_FILTERS.map((s) => (
              <Chip key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)}>
                {statusFilterLabel(s)}
              </Chip>
            ))}
          </div>
          <div aria-hidden="true" className="h-5 w-px bg-border-token" />
          <div className="flex items-center gap-1.5" role="group" aria-labelledby={TYPE_FILTER_LABEL_ID}>
            <span id={TYPE_FILTER_LABEL_ID} className="sr-only">Type:</span>
            {TYPE_FILTERS.map((t) => (
              <Chip key={t} active={typeFilter === t} onClick={() => setTypeFilter(t)}>
                {t ? TYPE_LABELS[t] : 'All types'}
              </Chip>
            ))}
          </div>
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
            {tickets.map((ticket) => {
              const isExpanded = expandedId === ticket.id;
              const type = TYPE_STYLES[ticket.type];
              const detailsId = `crystal-ticket-details-${ticket.id}`;
              return (
                <div key={ticket.id} className={`rounded-radius-lg ${isExpanded ? 'bg-[#FCE7F320]' : ''}`}>
                  {/* Summary row */}
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : ticket.id)}
                    aria-expanded={isExpanded}
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
                          isExpanded ? 'text-accent-pink-dark' : 'text-token-primary'
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
                      <Icon name={isExpanded ? 'chevronDown' : 'chevronRight'} size={20} />
                    </span>
                  </button>

                  {/* Expanded detail */}
                  {isExpanded && (
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
                            value={replyText[ticket.id] ?? ''}
                            onChange={(e) => setReplyText((prev) => ({ ...prev, [ticket.id]: e.target.value }))}
                          />
                          <div className="flex items-center gap-2">
                            <GradientButton
                              icon="send"
                              onClick={() => handleReply(ticket.id)}
                              disabled={actionLoading === ticket.id || !replyText[ticket.id]?.trim()}
                            >
                              {actionLoading === ticket.id ? '...' : (ticket.admin_reply ? 'Update Reply' : 'Send Reply')}
                            </GradientButton>
                            {ticket.status !== 'closed' && (
                              <OutlineButton
                                icon="check"
                                onClick={() => handleStatusChange(ticket.id, 'closed')}
                                disabled={actionLoading === ticket.id}
                              >
                                Close
                              </OutlineButton>
                            )}
                            {ticket.status === 'closed' && (
                              <OutlineButton
                                icon="undo"
                                onClick={() => handleStatusChange(ticket.id, 'pending')}
                                disabled={actionLoading === ticket.id}
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
            })}
          </div>
        )}
      </div>
    </PrismPage>
  );
}
