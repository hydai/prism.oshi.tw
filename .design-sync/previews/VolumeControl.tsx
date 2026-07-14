import { VolumeControl } from 'prism-oshi-tw';

// Context-driven: the harness seeds player volume=70 (not muted), so the icon is
// Volume2 and the slider fills 70% with the accent-pink gradient. The unfilled
// track and hover states use translucent-white tokens invisible on flat white,
// so stage each size on the app page gradient (the player-bar surface).
const panel = {
  display: 'inline-flex',
  padding: '16px 20px',
  borderRadius: 16,
  background:
    'linear-gradient(135deg, var(--bg-page-start), var(--bg-page-mid), var(--bg-page-end))',
  border: '1px solid var(--border-glass)',
} as const;

export const Compact = () => (
  <div style={panel}>
    <VolumeControl size="compact" />
  </div>
);

export const Full = () => (
  <div style={panel}>
    <VolumeControl size="full" />
  </div>
);
