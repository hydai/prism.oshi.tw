import type { ReactNode } from 'react';
import { capitalizeStatus, statusTone, TONE_BOX_CLASS, type Tone } from './pill-core';

export type { Tone } from './pill-core';

/** A tone-coloured badge (spec §4.1 status tones): 10px/700 text, 1px tinted border, full pill radius. */
export function Pill({
  tone,
  children,
  className,
}: {
  tone: Tone;
  children: ReactNode;
  className?: string;
}) {
  const classes = `inline-flex items-center whitespace-nowrap rounded-radius-pill border px-2 py-0.5 text-2xs font-bold ${TONE_BOX_CLASS[tone]}${className ? ` ${className}` : ''}`;
  return <span className={classes}>{children}</span>;
}

/** Maps every Status, Nova and Crystal status string to a tone (spec §5); unknown statuses fall back to neutral. */
export function StatusPill({ status }: { status: string }) {
  const tone = statusTone(status);
  return (
    <Pill tone={tone} className={status === 'excluded' ? 'line-through' : undefined}>
      {capitalizeStatus(status)}
    </Pill>
  );
}
