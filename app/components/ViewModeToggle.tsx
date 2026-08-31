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
      className={`flex items-center gap-1 flex-shrink-0 bg-surface-muted rounded-radius-pill border border-border-token-glass ${fullWidth ? 'w-full' : ''}`}
      style={{
        padding: '3px',
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
            className={`flex items-center gap-1.5 font-semibold transition-[background,box-shadow,color] rounded-radius-pill text-token-sm py-token-2 ${
              fullWidth ? 'flex-1 justify-center px-token-3' : 'px-token-4'
            } ${
              isActive
                ? 'bg-accent-gradient text-token-on-accent shadow-md'
                : 'text-token-secondary'
            }`}
            style={{
              minHeight: fullWidth ? '44px' : undefined,
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
