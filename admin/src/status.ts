import type { NovaStatus, Status } from '../shared/types';

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

// Hard delete is blocked for approved (live) streams — unapprove first.
export function canHardDeleteStream(status: Status): boolean {
  return status !== 'approved';
}

// VOD import is gated on whether the video already exists in the admin DB, not on the
// Nova submission status. This keeps an approval whose import previously failed
// retryable (absent → import), while a re-approve of an already-imported VOD won't
// delete/recreate its curated performances (present → skip). Relies on importVodToAdminDb
// writing atomically via db.batch(), so a failed import leaves nothing behind to detect.
export function shouldImportVod(targetStatus: NovaStatus, alreadyImported: boolean): boolean {
  return targetStatus === 'approved' && !alreadyImported;
}
