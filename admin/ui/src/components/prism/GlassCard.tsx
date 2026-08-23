import type { ReactNode } from 'react';

/** Frosted glass surface (prism SongCard): translucent white, glass border, 16px radius. */
export function GlassCard({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={`rounded-radius-xl border border-border-token-glass bg-surface-glass backdrop-blur ${className ?? ''}`}
    >
      {children}
    </div>
  );
}
