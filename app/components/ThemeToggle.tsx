'use client';

import { useState, useEffect } from 'react';
import { Sun, Moon } from 'lucide-react';

export default function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const isDark = document.documentElement.classList.contains('dark');
    setTheme(isDark ? 'dark' : 'light');

    // Follow system preference when no stored preference
    const stored = localStorage.getItem('theme');
    if (stored) return;

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      const next = e.matches ? 'dark' : 'light';
      setTheme(next);
      document.documentElement.classList.toggle('dark', next === 'dark');
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    document.documentElement.classList.toggle('dark', next === 'dark');
    localStorage.setItem('theme', next);
  };

  if (!mounted) return <div style={{ width: 32, height: 32 }} />;

  return (
    <button
      onClick={toggleTheme}
      aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
      className="transition-all hover:scale-110 flex-shrink-0"
      style={{
        width: 32,
        height: 32,
        borderRadius: 'var(--radius-circle)',
        background: 'var(--bg-surface-muted)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-secondary)',
        border: '1px solid var(--border-glass)',
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
