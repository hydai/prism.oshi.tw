import type { Status } from '../shared/types';

const STATUS_VALUES = ['pending', 'approved', 'rejected', 'excluded', 'extracted'] as const satisfies readonly Status[];

export const VALID_STATUSES: ReadonlySet<Status> = new Set(STATUS_VALUES);

const ALLOWED_TRANSITIONS: Record<Status, ReadonlySet<Status>> = {
  pending: new Set<Status>(['approved', 'rejected', 'excluded', 'extracted']),
  extracted: new Set<Status>(['approved', 'rejected', 'excluded', 'pending']),
  approved: new Set<Status>(['extracted', 'pending']),
  rejected: new Set<Status>(['pending', 'excluded']),
  excluded: new Set<Status>(['pending']),
};

export function isValidStatus(status: string): status is Status {
  return VALID_STATUSES.has(status as Status);
}

export function isValidTransition(from: string, to: string): boolean {
  if (!isValidStatus(from) || !isValidStatus(to)) return false;
  return ALLOWED_TRANSITIONS[from].has(to);
}
