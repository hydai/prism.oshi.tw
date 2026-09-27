import { IconButton } from './Button';
import { useTheme } from './theme';
import type { ThemePreference } from './theme-core';
import type { IconName } from './Icon';

const THEME_OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string; icon: IconName }> = [
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
  { value: 'system', label: 'System', icon: 'monitor' },
];

/**
 * Light / Dark / System, as a compact group of 21 px icon chips (mockup `.theme`, 75 px wide, so
 * the sidebar footer keeps room for the email). The chips sit 3 px apart — a 24 px pitch, the
 * spacing WCAG 2.2 SC 2.5.8 asks of a target smaller than 24 px. The chosen one is lifted onto the
 * active surface with the accent icon colour — `aria-pressed` drives both the state and the look.
 */
export function ThemeToggle() {
  const { preference, setPreference } = useTheme();

  return (
    <div
      role="group"
      aria-label="Theme"
      className="inline-flex shrink-0 items-center gap-[3px] rounded-radius-pill border border-field-line bg-field p-0.5"
    >
      {THEME_OPTIONS.map((option) => (
        <IconButton
          key={option.value}
          label={option.label}
          icon={option.icon}
          size="xs"
          aria-pressed={preference === option.value}
          onClick={() => setPreference(option.value)}
          className="aria-pressed:bg-nav-active-bg aria-pressed:text-accent-fg"
        />
      ))}
    </div>
  );
}
