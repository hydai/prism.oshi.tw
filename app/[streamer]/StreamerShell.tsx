'use client';

import { ReactNode } from 'react';
import { StreamerConfig, StreamerTheme } from '../../lib/types';
import { StreamerProvider } from '../contexts/StreamerContext';
import PlayerWrapper from '../components/PlayerWrapper';

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

export default function StreamerShell({
  config,
  children,
}: {
  config: StreamerConfig;
  children: ReactNode;
}) {
  const cssVars = themeToCSS(config.theme);

  return (
    <div style={cssVars as React.CSSProperties}>
      <StreamerProvider config={config}>
        <PlayerWrapper streamerSlug={config.slug}>
          {children}
        </PlayerWrapper>
      </StreamerProvider>
    </div>
  );
}
