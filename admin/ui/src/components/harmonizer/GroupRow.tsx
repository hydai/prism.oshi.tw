import type { ReactNode } from 'react';
import type { SimilarityGroup } from '../../../../shared/types';
import { matchTypePill } from '../../lib/harmonizer-presentation';
import { Pill } from '../ui/Pill';

/**
 * A Harmonizer queue's list row, inside the row's button: the group key, then its variant count, its
 * match type and whatever pills the tab adds after them (`children`: the songs tab's Global merge).
 */
export default function GroupRow({ group, children }: { group: SimilarityGroup<unknown>; children?: ReactNode }) {
  const pill = matchTypePill(group.matchType);
  return (
    <>
      <span className="truncate text-[12.5px] font-[650] text-fg">{group.normalizedKey}</span>
      <span className="mt-0.5 flex flex-wrap gap-[5px]">
        <Pill tone="neutral">{group.items.length} variants</Pill>
        <Pill tone={pill.tone}>{pill.label}</Pill>
        {children}
      </span>
    </>
  );
}
