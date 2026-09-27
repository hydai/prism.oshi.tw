import { useId, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Icon } from './Icon';

const FIELD_CLASSES =
  'w-full rounded-[14px] border border-field-line bg-field px-3 py-2 text-token-sm text-fg placeholder:text-fg-subtle disabled:cursor-not-allowed disabled:opacity-50';

/** A styled native text input; every native `<input>` prop passes through (spec §5). */
export function TextInput({ className, type = 'text', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} type={type} className={className ? `${FIELD_CLASSES} ${className}` : FIELD_CLASSES} />;
}

/** A styled native textarea; every native `<textarea>` prop passes through (spec §5). */
export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={className ? `${FIELD_CLASSES} ${className}` : FIELD_CLASSES} />;
}

/** A styled native select with a trailing chevron; every native `<select>` prop passes through (spec §5). */
export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className={className ? `relative inline-flex w-full ${className}` : 'relative inline-flex w-full'}>
      <select {...rest} className={`${FIELD_CLASSES} appearance-none pr-8`}>
        {children}
      </select>
      <Icon
        name="chevronDown"
        size={14}
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-fg-muted"
      />
    </span>
  );
}

/** A pill-shaped search field with a leading icon and a visually-hidden label (spec §5). */
export function SearchInput({
  value,
  onChange,
  placeholder,
  label,
  className,
  id,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  className?: string;
}) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return (
    <span className={className ? `relative inline-flex items-center ${className}` : 'relative inline-flex items-center'}>
      <label htmlFor={inputId} className="sr-only">
        {label}
      </label>
      <Icon name="search" size={14} className="pointer-events-none absolute left-3 text-fg-subtle" />
      <input
        {...rest}
        id={inputId}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-radius-pill border border-field-line bg-field py-2 pl-8 pr-3 text-token-sm text-fg placeholder:text-fg-subtle"
      />
    </span>
  );
}

/** A visually custom checkbox over a native `<input type="checkbox">` (spec §5); keyboard and label behaviour stay native. */
export function Checkbox({
  checked,
  onChange,
  label,
  visibleLabel = false,
  className,
  id,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'checked' | 'onChange'> & {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  visibleLabel?: boolean;
  className?: string;
}) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return (
    <label
      htmlFor={inputId}
      className={
        className
          ? `inline-flex cursor-pointer items-center gap-2 select-none ${className}`
          : 'inline-flex cursor-pointer items-center gap-2 select-none'
      }
    >
      <span className="relative inline-flex h-4 w-4 shrink-0">
        <input
          {...rest}
          id={inputId}
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          aria-label={visibleLabel ? undefined : label}
          className="peer h-4 w-4 shrink-0 appearance-none rounded-radius-xs border border-field-line bg-field checked:border-transparent checked:bg-accent focus-visible:outline-none focus-visible:shadow-focus"
        />
        <Icon
          name="check"
          size={10}
          className="pointer-events-none absolute inset-0 m-auto text-white opacity-0 peer-checked:opacity-100"
        />
      </span>
      {visibleLabel ? <span className="text-token-sm text-fg">{label}</span> : null}
    </label>
  );
}

/** A styled native radio input sharing a `name` group (spec §5). */
export function Radio({
  checked,
  onChange,
  label,
  name,
  className,
  id,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'checked' | 'onChange' | 'name'> & {
  checked: boolean;
  onChange: () => void;
  label: string;
  name: string;
  className?: string;
}) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return (
    <label
      htmlFor={inputId}
      className={
        className
          ? `inline-flex cursor-pointer items-center gap-2 select-none ${className}`
          : 'inline-flex cursor-pointer items-center gap-2 select-none'
      }
    >
      <input
        {...rest}
        id={inputId}
        type="radio"
        name={name}
        checked={checked}
        onChange={onChange}
        className="h-4 w-4 shrink-0 appearance-none rounded-full border border-field-line bg-field checked:border-4 checked:border-accent-fg focus-visible:outline-none focus-visible:shadow-focus"
      />
      <span className="text-token-sm text-fg">{label}</span>
    </label>
  );
}
