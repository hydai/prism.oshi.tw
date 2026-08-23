import type { ButtonHTMLAttributes } from 'react';
import { Icon, type IconName } from './Icon';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

/** Primary action: gradient pill. `md` is the page-level size, `sm` the in-row/panel size. */
export function GradientButton({
  icon,
  size = 'sm',
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps & { icon?: IconName; size?: 'sm' | 'md' }) {
  const sizing = size === 'md' ? 'px-7 py-3 text-[15px] leading-5' : 'px-4 py-2 text-[11px] leading-4';
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-radius-pill prism-gradient font-semibold text-white shadow-[0_4px_16px_rgba(244,114,182,0.35)] transition-[filter,opacity] hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50 ${sizing} ${className ?? ''}`}
      {...rest}
    >
      {icon ? <Icon name={icon} size={14} /> : null}
      {children}
    </button>
  );
}

/** Secondary action: outlined pill (prism's 追蹤 button); `danger` for destructive choices. */
export function OutlineButton({
  icon,
  tone = 'default',
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps & { icon?: IconName; tone?: 'default' | 'danger' }) {
  const colors =
    tone === 'danger'
      ? 'border-[#FECACA] text-[#B91C1C] hover:bg-[#FEE2E2]'
      : 'border-border-token text-token-secondary hover:border-border-token-accent-pink hover:text-accent-pink';
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-radius-pill border bg-transparent px-4 py-2 text-[11px] font-semibold leading-4 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${colors} ${className ?? ''}`}
      {...rest}
    >
      {icon ? <Icon name={icon} size={14} /> : null}
      {children}
    </button>
  );
}
