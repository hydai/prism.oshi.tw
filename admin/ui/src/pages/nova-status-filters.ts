import type { NovaStatus } from '../../../shared/types';
import type { StatusFilterOption } from '../components/StatusFilterBar';

/** Both Nova inboxes (streamer submissions and VOD submissions) review the same three states. */
export const NOVA_STATUS_FILTERS: ReadonlyArray<StatusFilterOption<'' | NovaStatus>> = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];
