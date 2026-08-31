'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { Sun, Moon } from 'lucide-react';
import { useHydrated } from '../lib/use-hydrated';
import { htmlDarkClassStore } from '../lib/theme-store';

type Theme = 'light' | 'dark';

function updateDocumentTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

export default function ThemeToggle() {
  const hydrated = useHydrated();
  const isDark = useSyncExternalStore(
    htmlDarkClassStore.subscribe,
    htmlDarkClassStore.getSnapshot,
    htmlDarkClassStore.getServerSnapshot,
  );
  const theme: Theme = isDark ? 'dark' : 'light';

  useEffect(() => {
    // Follow system preference when no stored preference
    const stored = localStorage.getItem('theme');
    if (stored) return;

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      const next = e.matches ? 'dark' : 'light';
      updateDocumentTheme(next);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Raw localStorage by design: the 'theme' key is the pre-hydration contract
  // shared with the <head> boot script, not something the store abstracts over.
  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    updateDocumentTheme(next);
    localStorage.setItem('theme', next);
  };

  if (!hydrated) return <div style={{ width: 32, height: 32 }} />;

  return (
    <button
      onClick={toggleTheme}
      aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
      className="transition-[background-color,border-color,color,transform] hover:scale-110 flex-shrink-0 rounded-radius-circle bg-surface-muted text-token-secondary border border-border-token-glass"
      style={{
        width: 32,
        height: 32,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
      }}
    >
      {theme === 'light' ? (
        <Moon style={{ width: 16, height: 16 }} />
      ) : (
        <Sun style={{ width: 16, height: 16 }} />
      )}
    </button>
  );
}
