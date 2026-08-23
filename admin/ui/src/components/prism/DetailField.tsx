import type { ReactNode } from 'react';
import { SectionLabel } from './SectionLabel';

/** Label + value pair for expanded-row detail grids. Renders `—` for empty values. */
export function DetailField({
  label,
  value,
  mono,
  className,
  children,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className ?? ''}`}>
      <SectionLabel>{label}</SectionLabel>
      {children ?? (
        <p
          className={`whitespace-pre-line break-words leading-normal ${
            mono ? 'font-mono text-xs' : 'text-[13px]'
          } ${value ? 'text-token-primary' : 'text-token-tertiary'}`}
        >
          {value || '—'}
        </p>
      )}
    </div>
  );
}
