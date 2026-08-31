'use client';

import type { LucideIcon } from 'lucide-react';

/** Empty block for the dark BottomSheet panels — icon + headline + hint. */
export default function PanelEmptyState({ icon: Icon, title, hint }: {
  icon: LucideIcon;
  title: string;
  hint: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-white/60">
      <Icon className="w-16 h-16 mb-4" />
      <p className="text-center">{title}</p>
      <p className="text-sm text-center mt-2">{hint}</p>
    </div>
  );
}
