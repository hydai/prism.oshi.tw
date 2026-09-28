import type { ReactNode } from 'react';
import { capitalizeStatus, statusTone, type Tone } from './pill-core';

export type { Tone } from './pill-core';

const TONE_CLASSES: Record<Tone, string> = {
  ok: 'bg-tone-ok-bg text-tone-ok-fg border-tone-ok-line',
  warn: 'bg-tone-warn-bg text-tone-warn-fg border-tone-warn-line',
  danger: 'bg-tone-danger-bg text-tone-danger-fg border-tone-danger-line',
  info: 'bg-tone-info-bg text-tone-info-fg border-tone-info-line',
  neutral: 'bg-tone-neutral-bg text-tone-neutral-fg border-tone-neutral-line',
  violet: 'bg-tone-violet-bg text-tone-violet-fg border-tone-violet-line',
  teal: 'bg-tone-teal-bg text-tone-teal-fg border-tone-teal-line',
};

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
  const classes = `inline-flex items-center whitespace-nowrap rounded-radius-pill border px-2 py-0.5 text-2xs font-bold ${TONE_CLASSES[tone]}${className ? ` ${className}` : ''}`;
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
