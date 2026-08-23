import { useId } from 'react';
import { Icon } from './Icon';

/** Pill search field with a leading icon and a screen-reader-only label (prism SearchBox). */
export function SearchInput({
  value,
  onChange,
  placeholder,
  label,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={`relative ${className ?? 'w-60'}`}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-token-tertiary">
        <Icon name="search" size={16} />
      </span>
      <input
        id={id}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-radius-pill border border-border-token-glass bg-surface-glass py-2 pl-9 pr-4 text-[13px] font-medium leading-5 text-token-primary outline-none backdrop-blur placeholder:text-token-tertiary focus:border-border-token-accent-pink focus:shadow-[0_0_0_3px_rgba(236,72,153,0.1)]"
      />
    </div>
  );
}
