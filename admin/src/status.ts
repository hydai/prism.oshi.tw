export const VALID_STATUSES = new Set(['pending', 'approved', 'rejected', 'excluded', 'extracted']);

const ALLOWED_TRANSITIONS: Record<string, Set<string>> = {
  pending: new Set(['approved', 'rejected', 'excluded', 'extracted']),
  extracted: new Set(['approved', 'rejected', 'excluded', 'pending']),
  approved: new Set(['extracted', 'pending']),
  rejected: new Set(['pending', 'excluded']),
  excluded: new Set(['pending']),
};

export function isValidTransition(from: string, to: string): boolean {
  return ALLOWED_TRANSITIONS[from]?.has(to) ?? false;
}
