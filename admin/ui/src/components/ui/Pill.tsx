import type { ReactNode } from 'react';

export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral' | 'violet' | 'teal';

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

type KnownStatus = 'approved' | 'replied' | 'pending' | 'rejected' | 'closed' | 'excluded' | 'extracted';

const STATUS_TONE: Record<KnownStatus, Tone> = {
  approved: 'ok',
  replied: 'ok',
  pending: 'warn',
  rejected: 'danger',
  closed: 'neutral',
  excluded: 'neutral',
  extracted: 'teal',
};

function capitalize(value: string): string {
  return value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1);
}

/** Maps every Status, Nova and Crystal status string to a tone (spec §5); unknown statuses fall back to neutral. */
export function StatusPill({ status }: { status: string }) {
  const tone = (STATUS_TONE as Record<string, Tone>)[status] ?? 'neutral';
  return (
    <Pill tone={tone} className={status === 'excluded' ? 'line-through' : undefined}>
      {capitalize(status)}
    </Pill>
  );
}
