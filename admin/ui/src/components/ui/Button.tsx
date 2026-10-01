import type { ButtonHTMLAttributes, MouseEvent, Ref } from 'react';
import { buttonClasses, type ButtonSize, type ButtonVariant } from './button-classes';
import { Icon, type IconName } from './Icon';
import { Tooltip, type TooltipAlign } from './Tooltip';

export type { ButtonVariant, ButtonSize } from './button-classes';

/**
 * The click of a button that is `aria-disabled`, busy or not. Enter and Space reach a button as a click,
 * and so does implicit submission (Enter in a text field clicks the form's default button), so this one
 * handler covers them all. `preventDefault` is what stops a submit button from submitting its form;
 * `stopPropagation` keeps the click from any ancestor's handler, as the click of a `disabled` button
 * never reached one.
 */
function ignoreClick(event: MouseEvent<HTMLButtonElement>): void {
  event.preventDefault();
  event.stopPropagation();
}

/**
 * `aria-disabled` is how a button is unavailable without losing the keyboard focus: a browser drops the
 * focus from a button that turns `disabled`, but leaves it on an `aria-disabled` one. So a Button that is
 * `aria-disabled` ignores whatever would activate it (see `ignoreClick`), as a disabled one does, and dims
 * like one. That is the button that is busy, whose click (or key) started the work, and equally one its
 * caller gives `aria-disabled`: Pagination's step at the end of its range, which the press that got there
 * has just made unavailable. Only a true `aria-disabled` counts; `false` leaves the button live.
 *
 * `busy` is `aria-disabled` plus `aria-busy` and a spinning icon, never the `disabled` attribute; `aria-busy`
 * and the spinner are for `busy` alone. `busy` also wins over `disabled`: whatever else disables the
 * button, the busy one keeps its focus until the work is done. `disabled` alone is still the attribute.
 */
export function Button({
  ref,
  variant = 'secondary',
  size = 'md',
  icon,
  busy = false,
  type = 'button',
  className,
  disabled,
  'aria-disabled': ariaDisabled,
  onClick,
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
  // aria-disabled as React takes it: `true` or `'true'`; busy is aria-disabled by definition.
  const inert = busy || ariaDisabled === true || ariaDisabled === 'true';
  const classes = className
    ? `${buttonClasses({ variant, size })} ${className}`
    : buttonClasses({ variant, size });

  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      className={classes}
      disabled={busy ? undefined : disabled}
      aria-disabled={busy ? 'true' : ariaDisabled}
      aria-busy={busy ? 'true' : undefined}
      onClick={inert ? ignoreClick : onClick}
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

/**
 * An icon-only button: `label` is its accessible name and its tooltip (`tooltipSide` = where that
 * opens, `tooltipAlign` = which edge of the button it lines up with; see `Tooltip`).
 *
 * `busy` and `aria-disabled` are `Button`'s, whose comment says why: `busy` is `aria-disabled` plus
 * `aria-busy` and a spinning refresh icon in place of `icon`, never the `disabled` attribute, so the
 * button whose press started the work keeps the keyboard focus; a button that is busy, or given a true
 * `aria-disabled`, ignores click, Enter, Space and implicit submission (see `ignoreClick`) and dims. Its
 * label, and so its name and its tooltip, stay what they were.
 */
export function IconButton({
  ref,
  label,
  icon,
  tone = 'default',
  size = 'md',
  busy = false,
  tooltipSide,
  tooltipAlign,
  type = 'button',
  className,
  disabled,
  'aria-disabled': ariaDisabled,
  onClick,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'> & {
  ref?: Ref<HTMLButtonElement>;
  label: string;
  icon: IconName;
  tone?: IconButtonTone;
  size?: IconButtonSize;
  busy?: boolean;
  tooltipSide?: 'top' | 'bottom';
  tooltipAlign?: TooltipAlign;
}) {
  // aria-disabled as React takes it: `true` or `'true'`; busy is aria-disabled by definition.
  const inert = busy || ariaDisabled === true || ariaDisabled === 'true';
  const classes = `inline-flex shrink-0 items-center justify-center rounded-radius-pill transition-colors disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 focus-visible:outline-none focus-visible:shadow-focus ${ICON_BUTTON_SIZE_CLASSES[size]} ${ICON_BUTTON_TONE_CLASSES[tone]}${className ? ` ${className}` : ''}`;

  return (
    <Tooltip label={label} side={tooltipSide} align={tooltipAlign}>
      <button
        {...rest}
        ref={ref}
        type={type}
        aria-label={label}
        className={classes}
        disabled={busy ? undefined : disabled}
        aria-disabled={busy ? 'true' : ariaDisabled}
        aria-busy={busy ? 'true' : undefined}
        onClick={inert ? ignoreClick : onClick}
      >
        <Icon name={busy ? 'refresh' : icon} size={ICON_SIZES[size]} className={busy ? 'animate-spin' : undefined} />
      </button>
    </Tooltip>
  );
}
