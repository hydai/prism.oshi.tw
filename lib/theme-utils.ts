import { StreamerTheme } from './types';

/**
 * Parse a hex color (#RRGGBB or #RGB) into [r, g, b].
 */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3
    ? h.split('').map(c => c + c).join('')
    : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/**
 * Convert a hex color to rgba() with given alpha.
 */
export function hexToRgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Brighten a hex color by a factor (0–1). Clamps at 255.
 */
export function lightenHex(hex: string, amount = 0.15): string {
  const [r, g, b] = hexToRgb(hex);
  const lighten = (v: number) => Math.min(255, Math.round(v + (255 - v) * amount));
  const toHex = (v: number) => v.toString(16).padStart(2, '0');
  return `#${toHex(lighten(r))}${toHex(lighten(g))}${toHex(lighten(b))}`;
}

/**
 * Convert a light-mode StreamerTheme into CSS variable overrides for dark mode.
 *
 * Strategy:
 * - Accent colors: use the light variant as primary (brighter pops on dark)
 * - Page backgrounds: universal dark gradient
 * - Accent backgrounds: accent color with low alpha
 * - Accent borders: accent color with medium alpha
 */
export function deriveDarkTheme(theme: StreamerTheme): Record<string, string> {
  return {
    '--accent-pink': theme.accentPrimaryLight,
    '--accent-pink-dark': theme.accentPrimary,
    '--accent-pink-light': lightenHex(theme.accentPrimaryLight),
    '--accent-blue': theme.accentSecondaryLight,
    '--accent-blue-light': lightenHex(theme.accentSecondaryLight),

    '--bg-page-start': '#0F0A1A',
    '--bg-page-mid': '#0D1117',
    '--bg-page-end': '#0A0E1A',

    '--bg-accent-pink': hexToRgba(theme.accentPrimaryLight, 0.10),
    '--bg-accent-pink-muted': hexToRgba(theme.accentPrimaryLight, 0.15),

    '--border-accent-pink': hexToRgba(theme.accentPrimaryLight, 0.25),
    '--border-accent-blue': hexToRgba(theme.accentSecondaryLight, 0.25),
  };
}
