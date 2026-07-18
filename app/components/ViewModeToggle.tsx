'use client';

import { Clock, Disc3 } from 'lucide-react';
import type { ArchiveViewMode } from '../types/archive';

interface ViewModeToggleProps {
  value: ArchiveViewMode;
  onChange: (mode: ArchiveViewMode) => void;
  testIdPrefix?: string;
  fullWidth?: boolean;
}

const options: Array<{
  value: ArchiveViewMode;
  label: string;
  icon: typeof Clock;
}> = [
  { value: 'timeline', label: '時間序列', icon: Clock },
  { value: 'grouped', label: '歌曲分組', icon: Disc3 },
];

export default function ViewModeToggle({
  value,
  onChange,
  testIdPrefix = 'view-toggle',
  fullWidth = false,
}: ViewModeToggleProps) {
  return (
    <div
      role="group"
      aria-label="歌曲顯示方式"
      className={`flex items-center gap-1 flex-shrink-0 ${fullWidth ? 'w-full' : ''}`}
      style={{
        background: 'var(--bg-surface-muted)',
        borderRadius: 'var(--radius-pill)',
        padding: '3px',
        border: '1px solid var(--border-glass)',
      }}
    >
      {options.map(option => {
        const isActive = value === option.value;
        const Icon = option.icon;

        return (
          <button
            key={option.value}
            type="button"
            data-testid={`${testIdPrefix}-${option.value}`}
            aria-pressed={isActive}
            onClick={() => onChange(option.value)}
            className={`flex items-center gap-1.5 font-semibold transition-all ${
              fullWidth ? 'flex-1 justify-center' : ''
            } ${
              isActive
                ? 'bg-gradient-to-r from-accent-pink-light to-accent-blue-light text-white shadow-md'
                : ''
            }`}
            style={{
              borderRadius: 'var(--radius-pill)',
              fontSize: 'var(--font-size-sm)',
              padding: fullWidth ? 'var(--space-2) var(--space-3)' : 'var(--space-2) var(--space-4)',
              minHeight: fullWidth ? '44px' : undefined,
              color: isActive ? 'var(--text-on-accent)' : 'var(--text-secondary)',
            }}
          >
            <Icon className="w-3.5 h-3.5" aria-hidden="true" />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
