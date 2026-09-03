'use client';

import { Sparkles } from 'lucide-react';

/** The 認證藝人 chip — one badge for both heroes (user ruling 2026-08-31). */
export default function VerifiedBadge() {
  return (
    <div className="flex items-center gap-1.5 w-fit bg-accent-bg-blue-muted text-accent-blue rounded-radius-pill py-token-2 pl-token-3 pr-token-4 text-token-xs font-bold tracking-wider uppercase">
      <Sparkles className="w-3 h-3" />
      認證藝人
    </div>
  );
}
