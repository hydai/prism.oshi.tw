export type ThemePreference = 'light' | 'dark' | 'system';

export const THEME_STORAGE_KEY = 'prism_admin_theme';

function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

/**
 * Reads the stored theme preference. A missing storage, an invalid stored value, or a
 * `getItem` that throws (private browsing, disabled storage, a quota error) all fall back to
 * `'system'` instead of surfacing an error — the same resolution the inline pre-paint script
 * in `index.html` mirrors.
 */
export function readThemePreference(storage: Pick<Storage, 'getItem'> | undefined): ThemePreference {
  if (!storage) return 'system';
  try {
    const stored = storage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

/** Resolves a preference to the concrete theme actually painted. */
export function resolveTheme(preference: ThemePreference, prefersDark: boolean): 'light' | 'dark' {
  return preference === 'system' ? (prefersDark ? 'dark' : 'light') : preference;
}

/** Applies the resolved theme to `<html>`: toggles the `dark` class and sets `color-scheme`. */
export function applyTheme(root: HTMLElement, resolved: 'light' | 'dark'): void {
  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;
}
