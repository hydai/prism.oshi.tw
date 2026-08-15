import { useEffect, useSyncExternalStore } from 'react';
import { Sun, Moon } from 'lucide-react';

type Theme = 'light' | 'dark';

const THEME_CHANGE_EVENT = 'prism-theme-change';

function getThemeSnapshot(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

function getServerThemeSnapshot(): Theme {
  return 'light';
}

function subscribeToTheme(onStoreChange: () => void) {
  window.addEventListener(THEME_CHANGE_EVENT, onStoreChange);
  return () => window.removeEventListener(THEME_CHANGE_EVENT, onStoreChange);
}

function updateDocumentTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

export default function ThemeToggle() {
  const theme = useSyncExternalStore(
    subscribeToTheme,
    getThemeSnapshot,
    getServerThemeSnapshot,
  );

  useEffect(() => {
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

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    updateDocumentTheme(next);
    localStorage.setItem('theme', next);
  };

  return (
    <button
      onClick={toggleTheme}
      aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
      className="w-8 h-8 rounded-full flex items-center justify-center border border-[var(--border-default)] bg-white/60 dark:bg-white/[0.06] text-[var(--text-secondary)] hover:scale-110 transition-[background-color,border-color,color,transform] cursor-pointer shrink-0"
    >
      {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
    </button>
  );
}
