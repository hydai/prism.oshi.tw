import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/** A pill-shaped toggle button (spec §5): filter and tag chips. */
export function Chip({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count?: number;
  children: ReactNode;
}) {
  const classes = `inline-flex items-center gap-1.5 whitespace-nowrap rounded-radius-pill border px-3 py-1.5 text-token-sm font-semibold transition-colors focus-visible:outline-none focus-visible:shadow-focus ${
    active ? 'border-transparent bg-accent text-white' : 'border-field-line bg-field text-fg-muted hover:text-fg'
  }`;

  return (
    <button type="button" aria-pressed={active} onClick={onClick} className={classes}>
      {children}
      {count !== undefined ? <span className={active ? 'text-white' : 'text-fg-subtle'}>{count}</span> : null}
    </button>
  );
}

/** A `role="group"` of mutually exclusive `aria-pressed` buttons (spec §5). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  disabled,
}: {
  value: T;
  onChange: (value: T) => void;
  /** `step`: a workflow position (Pipeline's "1 Discover" / "2 Extract") drawn as a circled number
   *  before the label. It is decorative (`aria-hidden`) — the option's accessible name stays its
   *  label (and count). */
  options: { value: T; label: string; count?: number; icon?: IconName; step?: number }[];
  label: string;
  /** Disables every option button (a page that must not switch view while a request is in flight). */
  disabled?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex items-center gap-1 rounded-radius-pill border border-field-line bg-field p-1"
    >
      {options.map((option) => {
        const isActive = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isActive}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-radius-pill px-3 py-1.5 text-token-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:shadow-focus ${
              isActive ? 'bg-accent text-white shadow-primary' : 'text-fg-muted enabled:hover:text-fg'
            }`}
          >
            {option.step !== undefined ? (
              <span
                aria-hidden="true"
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-current text-2xs font-bold"
              >
                {option.step}
              </span>
            ) : null}
            {option.icon ? <Icon name={option.icon} size={14} /> : null}
            {option.label}
            {option.count !== undefined ? (
              <span className={isActive ? 'text-white' : 'text-fg-subtle'}>{option.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
