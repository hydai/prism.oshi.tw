import type { ReactNode } from 'react';
import { Chip } from './prism/Chip';

export interface StatusFilterOption<Value extends string> {
  readonly value: Value;
  readonly label: string;
  /**
   * Slate list pages fill the active pill in that status's own colour; prism
   * pages leave this out and take the gradient chip instead.
   */
  readonly activeClass?: string;
}

/** Pill button whose active state is the caller's colour (slate list pages). */
export function FilterPill({
  active,
  activeClass,
  onClick,
  children,
}: {
  active: boolean;
  activeClass: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        active ? activeClass : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
      }`}
    >
      {children}
    </button>
  );
}

/**
 * One row of mutually exclusive filter buttons — the shape every review and
 * list page had hand-rolled. The group needs an accessible name: either
 * `label`, or `labelledBy` pointing at a `heading` rendered inside it.
 */
export function StatusFilterBar<Value extends string>({
  options,
  value,
  onChange,
  label,
  labelledBy,
  heading,
  className = 'gap-1.5',
}: {
  options: readonly StatusFilterOption<Value>[];
  value: Value;
  onChange: (value: Value) => void;
  label?: string;
  labelledBy?: string;
  heading?: ReactNode;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} aria-labelledby={labelledBy} className={`flex items-center ${className}`}>
      {heading}
      {options.map((option) => {
        const active = option.value === value;
        const key = option.value || 'all';
        return option.activeClass === undefined ? (
          <Chip key={key} active={active} onClick={() => onChange(option.value)}>
            {option.label}
          </Chip>
        ) : (
          <FilterPill key={key} active={active} activeClass={option.activeClass} onClick={() => onChange(option.value)}>
            {option.label}
          </FilterPill>
        );
      })}
    </div>
  );
}
