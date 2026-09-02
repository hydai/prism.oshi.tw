import type {
  CrystalTicket,
  CrystalTicketStatus,
  CrystalTicketType,
  NovaStatus,
  NovaSubmission,
  NovaVodSubmission,
} from '../../../shared/types';
import { matchesFilter, matchesSearch } from './status-totals';

/**
 * Which rows a review page shows. Each page loads its list once, unfiltered, so
 * the filtering the endpoints used to do happens here — plus one thing the
 * server never had to think about.
 *
 * `justActed` holds the rows acted on since the filter was last set. Without it
 * an approval on the (default) pending view would delete its own row from the
 * table the instant it succeeded; with it the row stays where it is, showing its
 * new status, until the curator asks a different question — another filter,
 * another search, or a fresh load. Hero totals ignore it: they count the true
 * statuses of the whole list.
 */
export interface RecentlyActedOn {
  justActed: ReadonlySet<string>;
}

/** Stable empty set, so clearing it never invalidates a visible-rows memo twice. */
export const NO_RECENT_ACTIONS: ReadonlySet<string> = new Set();

export interface TicketFilters extends RecentlyActedOn {
  status: '' | CrystalTicketStatus;
  type: '' | CrystalTicketType;
}

export function visibleTickets(tickets: CrystalTicket[], filters: TicketFilters): CrystalTicket[] {
  return tickets.filter(
    (ticket) => filters.justActed.has(ticket.id)
      || (matchesFilter(ticket.status, filters.status) && matchesFilter(ticket.type, filters.type)),
  );
}

export interface SubmissionFilters extends RecentlyActedOn {
  status: '' | NovaStatus;
  search: string;
}

export function visibleSubmissions(
  submissions: NovaSubmission[],
  filters: SubmissionFilters,
): NovaSubmission[] {
  return submissions.filter(
    (sub) => filters.justActed.has(sub.id)
      || (matchesFilter(sub.status, filters.status)
        && matchesSearch([sub.id, sub.slug, sub.display_name, sub.youtube_channel_id], filters.search)),
  );
}

export interface VodFilters extends RecentlyActedOn {
  status: '' | NovaStatus;
  streamer: string;
}

export function visibleVods(vods: NovaVodSubmission[], filters: VodFilters): NovaVodSubmission[] {
  return vods.filter(
    (vod) => filters.justActed.has(vod.id)
      || (matchesFilter(vod.status, filters.status) && matchesFilter(vod.streamer_slug, filters.streamer)),
  );
}
