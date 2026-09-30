import type { ReactNode } from 'react';
import { fieldErrorId, fieldHintId } from './field-core';

/**
 * A form field: its label, the page's control, a hint and an error, in that order. The control is
 * the page's own (`Field` does not clone it): it carries `id` (the label's `for`), `aria-required`
 * for a required field, `aria-invalid` while `error` is non-empty and
 * `aria-describedby={fieldDescription(id, { hint, error })}`. The asterisk is decoration for the
 * eye, hidden from assistive technology. The error has no `role`: the page announces its errors
 * through its own summary.
 */
export function Field({
  id,
  label,
  required = false,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-token-sm font-semibold text-fg-muted">
        {label}
        {required ? (
          <span aria-hidden="true" className="ml-0.5 text-tone-danger-fg">
            *
          </span>
        ) : null}
      </label>
      {children}
      {hint ? (
        <p id={fieldHintId(id)} className="text-meta text-fg-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={fieldErrorId(id)} className="text-meta font-semibold text-tone-danger-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}
