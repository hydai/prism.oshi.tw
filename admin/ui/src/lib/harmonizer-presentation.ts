import type { HarmonizeGroupMatchType } from '../../../shared/types';

export function matchTypeClasses(matchType: HarmonizeGroupMatchType): string {
  if (matchType === 'work_id') return 'bg-blue-100 text-blue-700';
  if (matchType === 'exact') return 'bg-green-100 text-green-700';
  return 'bg-yellow-100 text-yellow-700';
}
