import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { applyTheme, readThemePreference, resolveTheme, THEME_STORAGE_KEY } from './theme-core';
import type { ThemePreference } from './theme-core';

interface ThemeContextValue {
  preference: ThemePreference;
  resolved: 'light' | 'dark';
  setPreference: (next: ThemePreference) => void;
}

const DEFAULT_THEME_CONTEXT: ThemeContextValue = {
  preference: 'system',
  resolved: 'light',
  setPreference: () => {},
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const PREFERS_DARK_QUERY = '(prefers-color-scheme: dark)';

// Module-level and stable: `useSyncExternalStore` must never see a new subscribe/getSnapshot
// function from one render to the next, or it resubscribes every render.
function subscribeToPrefersDark(onChange: () => void): () => void {
  const media = window.matchMedia(PREFERS_DARK_QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

function getPrefersDarkSnapshot(): boolean {
  return window.matchMedia(PREFERS_DARK_QUERY).matches;
}

function getPrefersDarkServerSnapshot(): boolean {
  return false;
}

function getBrowserStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
    readThemePreference(getBrowserStorage()),
  );
  const prefersDark = useSyncExternalStore(
    subscribeToPrefersDark,
    getPrefersDarkSnapshot,
    getPrefersDarkServerSnapshot,
  );
  const resolved = resolveTheme(preference, prefersDark);

  // Before paint: keeps <html> in agreement with the pre-paint script's own resolution, both on
  // mount and on every later preference or OS change.
  useLayoutEffect(() => {
    applyTheme(document.documentElement, resolved);
  }, [resolved]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    try {
      getBrowserStorage()?.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage can be blocked (private mode, quota, disabled); the in-memory preference for
      // this session still applies.
    }
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Outside a `ThemeProvider`, reads as light/system with a no-op setter. */
export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext) ?? DEFAULT_THEME_CONTEXT;
}
