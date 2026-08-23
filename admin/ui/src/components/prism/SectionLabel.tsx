import type { ReactNode } from 'react';

/** 10px uppercase tracking label used for field names and column heads. */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={`text-[10px] font-bold uppercase tracking-[0.1em] text-token-tertiary ${className ?? ''}`}>
      {children}
    </div>
  );
}
