import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { Icon } from './Icon';

const FIELD =
  'w-full border border-border-token-glass bg-surface-frosted text-sm leading-5 text-token-primary outline-none transition-[border-color,box-shadow] placeholder:text-token-tertiary focus:border-border-token-accent-pink focus:shadow-[0_0_0_3px_rgba(236,72,153,0.1)] disabled:cursor-not-allowed disabled:opacity-60';

/** Single-line field: prism pill input. All native props (id, aria-*, value…) pass through. */
export function PrismInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${FIELD} rounded-radius-pill px-4 py-2 ${className ?? ''}`} {...rest} />;
}

/** Multi-line field: 16px radius, vertical resize. */
export function PrismTextarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`${FIELD} block resize-y rounded-radius-xl px-3 py-2.5 leading-normal ${className ?? ''}`}
      {...rest}
    />
  );
}

/** Native select styled as a pill with a trailing chevron. */
export function PrismSelect({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={`relative ${className ?? ''}`}>
      <select
        className={`${FIELD} cursor-pointer appearance-none rounded-radius-pill py-2 pl-4 pr-9 text-[11px] font-semibold text-token-secondary`}
        {...rest}
      >
        {children}
      </select>
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-token-tertiary">
        <Icon name="chevronDown" size={14} />
      </span>
    </div>
  );
}
