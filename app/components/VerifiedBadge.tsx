'use client';

import { Sparkles } from 'lucide-react';

/** The 認證藝人 chip — one badge for both heroes (user ruling 2026-08-31). */
export default function VerifiedBadge() {
  return (
    <div
      className="flex items-center gap-1.5 w-fit"
      style={{
        background: 'var(--bg-accent-blue-muted)',
        color: 'var(--accent-blue)',
        borderRadius: 'var(--radius-pill)',
        padding: '4px 12px 4px 8px',
        fontSize: 'var(--font-size-xs)',
        fontWeight: 700,
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
      }}
    >
      <Sparkles style={{ width: '12px', height: '12px' }} />
      認證藝人
    </div>
  );
}
