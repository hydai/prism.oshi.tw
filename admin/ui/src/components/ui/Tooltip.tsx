import { cloneElement, useId, type ReactElement } from 'react';

const SIDE_CLASSES: Record<'top' | 'bottom', string> = {
  top: 'bottom-full mb-2',
  bottom: 'top-full mt-2',
};

/**
 * CSS-only tooltip (no React state): shown on hover or focus-within after a 400 ms
 * delay, linked to its child via `aria-describedby`. The wrapper uses the NAMED group
 * `group/tip` (never the unnamed `group`) so an IconButton nested in a row that relies
 * on the unnamed `group` for hover actions never collides with this one. It opens above its
 * target; `side="bottom"` opens it below, for a target at the top of the viewport.
 *
 * A tooltip that only repeats its child's accessible name (`aria-label`, as on every
 * IconButton) is for the eyes alone: it is neither the child's description nor in the
 * accessibility tree, so a screen reader does not say the name twice.
 */
export function Tooltip({
  label,
  side = 'top',
  children,
}: {
  label: string;
  side?: 'top' | 'bottom';
  children: ReactElement<{ 'aria-describedby'?: string; 'aria-label'?: string }>;
}) {
  const id = useId();
  const describes = children.props['aria-label'] !== label;
  return (
    <span className="group/tip relative inline-flex">
      {describes ? cloneElement(children, { 'aria-describedby': id }) : children}
      <span
        id={id}
        role="tooltip"
        aria-hidden={describes ? undefined : true}
        className={`pointer-events-none absolute left-1/2 z-50 ${SIDE_CLASSES[side]} -translate-x-1/2 whitespace-nowrap rounded-radius-sm bg-tooltip-bg px-2 py-1 text-meta text-tooltip-fg opacity-0 transition-opacity delay-[400ms] duration-150 group-hover/tip:opacity-100 group-focus-within/tip:opacity-100`}
      >
        {label}
      </span>
    </span>
  );
}
