import type { ReactNode } from 'react';
import { Chip } from './ui/Toggles';

export interface StatusFilterOption<Value extends string> {
  readonly value: Value;
  readonly label: string;
}

/**
 * One row of mutually exclusive filter chips — the shape every review and
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
      {options.map((option) => (
        <Chip key={option.value || 'all'} active={option.value === value} onClick={() => onChange(option.value)}>
          {option.label}
        </Chip>
      ))}
    </div>
  );
}
