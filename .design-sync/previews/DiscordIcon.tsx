import { DiscordIcon } from 'prism-oshi-tw';

// Monochrome brand mark: it fills with `currentColor`, so size comes from the
// w-/h- utilities the app already uses (className="h-4 w-4" at the call sites)
// and color from a wrapping `style={{ color }}`. #5865F2 is Discord "blurple".
const BLURPLE = '#5865F2';

export const Sizes = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 20, color: BLURPLE }}>
    <DiscordIcon className="h-4 w-4" />
    <DiscordIcon className="h-6 w-6" />
    <DiscordIcon className="h-8 w-8" />
    <DiscordIcon className="h-10 w-10" />
    <DiscordIcon className="h-12 w-12" />
  </div>
);

export const Colors = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
    <span style={{ display: 'inline-flex', color: BLURPLE }}>
      <DiscordIcon className="h-8 w-8" />
    </span>
    <span style={{ display: 'inline-flex', color: 'var(--accent-pink)' }}>
      <DiscordIcon className="h-8 w-8" />
    </span>
    <span style={{ display: 'inline-flex', color: 'var(--accent-blue)' }}>
      <DiscordIcon className="h-8 w-8" />
    </span>
    <span style={{ display: 'inline-flex', color: 'var(--text-primary)' }}>
      <DiscordIcon className="h-8 w-8" />
    </span>
  </div>
);
