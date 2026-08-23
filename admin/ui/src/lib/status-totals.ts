/**
 * Helpers for the review pages' hero totals. The hero counts come from an
 * unfiltered fetch kept alongside the filtered list, so the same by-id updates
 * are applied to both after an action.
 */

export function countByStatus<T extends { status: string }>(items: T[], status: string): number {
  return items.filter((item) => item.status === status).length;
}

export function replaceById<T extends { id: string }>(items: T[], updated: T): T[] {
  return items.map((item) => (item.id === updated.id ? updated : item));
}

export function removeById<T extends { id: string }>(items: T[], id: string): T[] {
  return items.filter((item) => item.id !== id);
}
