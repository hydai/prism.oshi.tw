'use client';

import { ReactNode, useEffect, useState } from 'react';
import { StreamerConfig, StreamerTheme } from '../../lib/types';
import { deriveDarkTheme } from '../../lib/theme-utils';
import { StreamerProvider } from '../contexts/StreamerContext';
import { PlayerProvider } from '../contexts/PlayerContext';
import PerStreamerProviders from '../components/PerStreamerProviders';
import MiniPlayer from '../components/MiniPlayer';
import NowPlayingModal from '../components/NowPlayingModal';
import YouTubePlayerContainer from '../components/YouTubePlayerContainer';
import QueuePanel from '../components/QueuePanel';
import RecentlyPlayedTracker from '../components/RecentlyPlayedTracker';

function themeToCSS(theme: StreamerTheme): Record<string, string> {
  return {
    '--accent-pink': theme.accentPrimary,
    '--accent-pink-dark': theme.accentPrimaryDark,
    '--accent-pink-light': theme.accentPrimaryLight,
    '--accent-blue': theme.accentSecondary,
    '--accent-blue-light': theme.accentSecondaryLight,
    '--bg-page-start': theme.bgPageStart,
    '--bg-page-mid': theme.bgPageMid,
    '--bg-page-end': theme.bgPageEnd,
    '--bg-accent-pink': theme.bgAccentPrimary,
    '--bg-accent-pink-muted': theme.bgAccentPrimaryMuted,
    '--border-accent-pink': theme.borderAccentPrimary,
    '--border-accent-blue': theme.borderAccentSecondary,
  };
}

function getThemeVars(theme: StreamerTheme, isDark: boolean): Record<string, string> {
  return isDark ? deriveDarkTheme(theme) : themeToCSS(theme);
}

export default function StreamerShell({
  config,
  children,
}: {
  config: StreamerConfig;
  children: ReactNode;
}) {
  const [isDark, setIsDark] = useState(false);

  // Watch for dark mode changes on <html> element
  useEffect(() => {
    const html = document.documentElement;
    setIsDark(html.classList.contains('dark'));

    const observer = new MutationObserver(() => {
      setIsDark(html.classList.contains('dark'));
    });
    observer.observe(html, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const cssVars = getThemeVars(config.theme, isDark);

  // Broadcast theme CSS vars to document.body so fixed-position elements
  // (MiniPlayer, QueuePanel, NowPlayingModal) inherit the current page's theme
  useEffect(() => {
    const vars = getThemeVars(config.theme, isDark);
    for (const [key, value] of Object.entries(vars)) {
      document.body.style.setProperty(key, value);
    }
    return () => {
      for (const key of Object.keys(vars)) {
        document.body.style.removeProperty(key);
      }
    };
  }, [config.theme, isDark]);

  return (
    <div style={cssVars as React.CSSProperties}>
      <StreamerProvider config={config}>
        <PlayerProvider>
          <PerStreamerProviders streamerSlug={config.slug}>
            {children}
            <MiniPlayer />
            <NowPlayingModal />
            <YouTubePlayerContainer />
            <QueuePanel />
            <RecentlyPlayedTracker />
          </PerStreamerProviders>
        </PlayerProvider>
      </StreamerProvider>
    </div>
  );
}
