import type { ReactNode, Ref } from 'react';
import { Icon, type IconName } from './Icon';
import type { Tone } from './Pill';

const PADDING_CLASSES: Record<'none' | 'sm' | 'md', string> = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
};

/**
 * The frosted-glass card surface (spec §4.1 `--glass-card`, §4.3 18px card radius, `shadow-card`).
 * `ref` (React 19 ref-as-prop) reaches the card's own element, a `div` unless `as` says otherwise.
 * `tabIndex` / `aria-label` pass through for a card a page must be able to focus programmatically
 * (e.g. the Stamp Editor's player box, which its floating pill hands focus to).
 */
export function GlassCard({
  ref,
  as: Component = 'div',
  padding = 'md',
  className,
  tabIndex,
  'aria-label': ariaLabel,
  children,
}: {
  ref?: Ref<HTMLDivElement>;
  as?: 'div' | 'section' | 'aside';
  padding?: 'none' | 'sm' | 'md';
  className?: string;
  tabIndex?: number;
  'aria-label'?: string;
  children: ReactNode;
}) {
  const paddingClass = PADDING_CLASSES[padding];
  const classes = `glass-card rounded-[18px] shadow-card${paddingClass ? ` ${paddingClass}` : ''}${className ? ` ${className}` : ''}`;
  return (
    <Component ref={ref} tabIndex={tabIndex} aria-label={ariaLabel} className={classes}>
      {children}
    </Component>
  );
}

const TONE_TEXT_CLASSES: Record<Tone, string> = {
  ok: 'text-tone-ok-fg',
  warn: 'text-tone-warn-fg',
  danger: 'text-tone-danger-fg',
  info: 'text-tone-info-fg',
  neutral: 'text-tone-neutral-fg',
  violet: 'text-tone-violet-fg',
  teal: 'text-tone-teal-fg',
};

/** A glass tile (spec §4.3 "tiles 14-16px" radius) with an uppercase 9.5px label and a 20px/750 value. */
export function StatTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
}) {
  const valueToneClass = tone ? TONE_TEXT_CLASSES[tone] : 'text-fg';
  return (
    <div className="glass-card rounded-[14px] px-3.5 py-2.5 shadow-card">
      <div className="text-2xs font-bold uppercase tracking-[0.12em] text-fg-subtle">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        <span className={`text-token-xl font-[750] tracking-[-0.01em] ${valueToneClass}`}>{value}</span>
        {hint ? (
          <span className={`text-token-sm font-semibold ${tone ? TONE_TEXT_CLASSES[tone] : 'text-fg-muted'}`}>
            {hint}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** An inline key label (spec §4.3: mono, 9.5px). */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[1.4em] items-center justify-center rounded-radius-xs border border-b-2 border-field-line bg-field px-1.5 py-0.5 font-mono text-2xs font-semibold text-fg-muted">
      {children}
    </kbd>
  );
}

/** A determinate progress meter (spec §5). */
export function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label}
      className="h-1.5 w-full overflow-hidden rounded-radius-pill bg-track"
    >
      <div className="h-full rounded-radius-pill bg-accent transition-[width]" style={{ width: `${percent}%` }} />
    </div>
  );
}

/** A centred placeholder for an empty list or panel (spec §5). */
export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: IconName;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-4 py-6 text-center">
      <div className="mb-2.5 flex h-14 w-14 items-center justify-center rounded-radius-xl bg-accent text-white shadow-primary">
        <Icon name={icon} size={24} />
      </div>
      <h4 className="text-token-md font-bold text-fg">{title}</h4>
      {body ? <p className="mt-1 max-w-[260px] text-token-sm leading-relaxed text-fg-muted">{body}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

/** A loading placeholder: `role="status"` with a visually-hidden label and pulsing bars that respect reduced motion. */
export function Skeleton({ rows = 3, label }: { rows?: number; label?: string }) {
  return (
    <div role="status" className="flex flex-col gap-2">
      <span className="sr-only">{label ?? 'Loading...'}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} aria-hidden="true" className="h-3 animate-pulse rounded-radius-sm bg-track" />
      ))}
    </div>
  );
}
