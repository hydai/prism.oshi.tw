import type { InputHTMLAttributes, Ref } from 'react';
import { Field } from './Field';
import { fieldDescription } from './field-core';
import { TextInput } from './Fields';

/**
 * A labelled text input with its hint and inline error: a `Field` around a `TextInput`, with the
 * control's ARIA wiring that `Field` asks of its page done here once. A `required` field is
 * `aria-required="true"`, never the `required` attribute, whose browser validation bubble would pre-empt
 * the inline error. An `error` makes the input `aria-invalid`, and the input is described by the hint and
 * the error that show. Every other native input attribute (`type`, `placeholder`, `inputMode`,
 * `autoComplete`, `readOnly`, ...) and the `ref` reach the input; `onChange` gets the typed text.
 *
 * The field is the root: a page that places it in a grid wraps it, and a page that needs a control the
 * wiring does not fit uses `Field` and the control itself.
 */
export function TextField({
  ref,
  id,
  label,
  value,
  onChange,
  required = false,
  hint,
  error,
  ...inputProps
}: Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'id' | 'value' | 'onChange' | 'required' | 'className' | 'aria-required' | 'aria-invalid' | 'aria-describedby'
> & {
  ref?: Ref<HTMLInputElement>;
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  /** Always shown under the input. */
  hint?: string;
  /** What is wrong with the field, once there is something to show: `null` or empty shows nothing. */
  error?: string | null;
}) {
  return (
    <Field id={id} label={label} required={required} hint={hint} error={error}>
      <TextInput
        id={id}
        ref={ref}
        value={value}
        {...inputProps}
        aria-required={required ? 'true' : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={fieldDescription(id, { hint, error })}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}
