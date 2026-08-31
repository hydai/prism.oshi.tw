'use client';

import { ReactNode, useEffect, useMemo, useSyncExternalStore } from 'react';
import { StreamerConfig, StreamerTheme } from '../../lib/types';
import { deriveDarkTheme } from '../../lib/theme-utils';
import { htmlDarkClassStore } from '../lib/theme-store';
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
  // Dark-mode class on <html> is read from an external store instead of an
  // effect+setState — ThemeToggle (and the inline boot script) own the toggle.
  const isDark = useSyncExternalStore(
    htmlDarkClassStore.subscribe,
    htmlDarkClassStore.getSnapshot,
    htmlDarkClassStore.getServerSnapshot,
  );

  const cssVars = useMemo(() => getThemeVars(config.theme, isDark), [config.theme, isDark]);

  // Broadcast the SAME vars to document.body: the portaled surfaces
  // (NowPlayingModal, every BottomSheet panel) render outside this div and
  // can't inherit them; the div's inline copy covers first paint and the
  // in-tree subtree before this effect runs.
  useEffect(() => {
    for (const [key, value] of Object.entries(cssVars)) {
      document.body.style.setProperty(key, value);
    }
    return () => {
      for (const key of Object.keys(cssVars)) {
        document.body.style.removeProperty(key);
      }
    };
  }, [cssVars]);

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
