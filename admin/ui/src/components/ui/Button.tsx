import type { ButtonHTMLAttributes, Ref } from 'react';
import { buttonClasses, type ButtonSize, type ButtonVariant } from './button-classes';
import { Icon, type IconName } from './Icon';
import { Tooltip } from './Tooltip';

export type { ButtonVariant, ButtonSize } from './button-classes';

export function Button({
  ref,
  variant = 'secondary',
  size = 'md',
  icon,
  busy = false,
  type = 'button',
  className,
  disabled,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  ref?: Ref<HTMLButtonElement>;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  busy?: boolean;
}) {
  // busy always shows the spinning refresh icon, even if `icon` was also given.
  const displayIcon: IconName | undefined = busy ? 'refresh' : icon;
  const classes = className
    ? `${buttonClasses({ variant, size })} ${className}`
    : buttonClasses({ variant, size });

  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      className={classes}
      disabled={disabled || busy}
      aria-busy={busy ? 'true' : undefined}
    >
      {displayIcon ? <Icon name={displayIcon} size={14} className={busy ? 'animate-spin' : undefined} /> : null}
      {children}
    </button>
  );
}

type IconButtonTone = 'default' | 'ok' | 'danger';

/** `xs` is the 21 px chip of a compact toggle group (the theme toggle), with a 12 px icon. */
type IconButtonSize = 'xs' | ButtonSize;

const ICON_BUTTON_SIZE_CLASSES: Record<IconButtonSize, string> = {
  xs: 'h-[21px] w-[21px]',
  sm: 'h-7 w-7',
  md: 'h-8 w-8',
};

const ICON_SIZES: Record<IconButtonSize, number> = {
  xs: 12,
  sm: 14,
  md: 16,
};

const ICON_BUTTON_TONE_CLASSES: Record<IconButtonTone, string> = {
  default: 'text-fg-muted hover:bg-field hover:text-fg',
  ok: 'text-tone-ok-fg hover:bg-tone-ok-bg',
  danger: 'text-tone-danger-fg hover:bg-tone-danger-bg',
};

/** An icon-only button: `label` is its accessible name and its tooltip (`tooltipSide` = where that opens). */
export function IconButton({
  ref,
  label,
  icon,
  tone = 'default',
  size = 'md',
  tooltipSide,
  type = 'button',
  className,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'> & {
  ref?: Ref<HTMLButtonElement>;
  label: string;
  icon: IconName;
  tone?: IconButtonTone;
  size?: IconButtonSize;
  tooltipSide?: 'top' | 'bottom';
}) {
  const classes = `inline-flex shrink-0 items-center justify-center rounded-radius-pill transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:shadow-focus ${ICON_BUTTON_SIZE_CLASSES[size]} ${ICON_BUTTON_TONE_CLASSES[tone]}${className ? ` ${className}` : ''}`;

  return (
    <Tooltip label={label} side={tooltipSide}>
      <button {...rest} ref={ref} type={type} aria-label={label} className={classes}>
        <Icon name={icon} size={ICON_SIZES[size]} />
      </button>
    </Tooltip>
  );
}
