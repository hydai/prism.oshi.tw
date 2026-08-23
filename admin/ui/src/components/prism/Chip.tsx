import type { ReactNode } from 'react';

/** Filter chip: pill button whose active state is the prism gradient. */
export function Chip({
  active,
  onClick,
  children,
  className,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`whitespace-nowrap rounded-radius-pill px-3 py-1 text-[11px] font-medium leading-4 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-pink ${
        active ? 'prism-gradient text-white' : 'bg-surface-muted text-token-secondary hover:text-accent-pink'
      } ${className ?? ''}`}
    >
      {children}
    </button>
  );
}
