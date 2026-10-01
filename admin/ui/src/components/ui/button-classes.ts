export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

const BUTTON_SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'gap-1.5 px-3 py-1.5 text-token-sm',
  md: 'gap-2 px-4 py-2 text-token-base',
};

const BUTTON_VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-gradient-fg shadow-primary hover:brightness-105',
  secondary: 'border border-field-line bg-field text-fg hover:border-accent-fg',
  ghost: 'bg-transparent text-fg-muted hover:bg-field hover:text-fg',
  danger: 'bg-danger-solid text-white hover:brightness-105',
};

/**
 * The class string `Button` renders with, exported so a router `Link` can look like a
 * button (R4). Lives here, outside `Button.tsx`, because a `.tsx` module that exports
 * React components must not also export a plain runtime value — react-doctor's
 * `only-export-components` (ruling R14). A `disabled` button and an `aria-disabled` one (a busy
 * `Button`, which stays enabled to keep its keyboard focus) share the dimmed, not-allowed look.
 */
export function buttonClasses({
  variant = 'secondary',
  size = 'md',
}: { variant?: ButtonVariant; size?: ButtonSize } = {}): string {
  return `inline-flex items-center justify-center whitespace-nowrap rounded-radius-pill font-semibold transition-[filter,background-color,box-shadow,border-color] disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 focus-visible:outline-none focus-visible:shadow-focus ${BUTTON_SIZE_CLASSES[size]} ${BUTTON_VARIANT_CLASSES[variant]}`;
}
