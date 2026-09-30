import type { ReactNode } from 'react';
import type { SimilarityGroup } from '../../../../shared/types';
import { matchTypePill } from '../../lib/harmonizer-presentation';
import { IconButton } from '../ui/Button';
import { GlassCard } from '../ui/Display';
import { Pill } from '../ui/Pill';

/** The header's previous / next buttons: the mockup's round, outlined `.ib`. */
const OUTLINED_ICON_BUTTON = 'border border-field-line bg-field';

/**
 * The frame of a Harmonizer queue's detail (spec §8.7, the mockup's `.det`), the same for both tabs:
 * a glass section named "Selected group", headed by the group key with its variant count and match
 * type and the previous / next group buttons, then the tab's own body (`children`). `onPrevious` /
 * `onNext` are absent at the list's first / last group, which disables that button.
 */
export default function GroupDetailCard({
  group,
  onPrevious,
  onNext,
  children,
}: {
  group: SimilarityGroup<unknown>;
  onPrevious?: () => void;
  onNext?: () => void;
  children: ReactNode;
}) {
  const matchPill = matchTypePill(group.matchType);
  return (
    <GlassCard as="section" aria-label="Selected group" padding="none" className="flex flex-col gap-3 px-[18px] py-3.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <h2 className="mr-1 min-w-0 break-words text-[15px] font-bold text-fg">{group.normalizedKey}</h2>
        <Pill tone="neutral">{group.items.length} variants</Pill>
        <Pill tone={matchPill.tone}>{matchPill.label}</Pill>
        <span className="ml-auto flex items-center gap-1">
          <IconButton
            label="Previous group"
            icon="chevronLeft"
            size="sm"
            className={OUTLINED_ICON_BUTTON}
            disabled={onPrevious === undefined}
            onClick={onPrevious}
          />
          <IconButton
            label="Next group"
            icon="chevronRight"
            size="sm"
            className={OUTLINED_ICON_BUTTON}
            disabled={onNext === undefined}
            onClick={onNext}
          />
        </span>
      </div>
      {children}
    </GlassCard>
  );
}
