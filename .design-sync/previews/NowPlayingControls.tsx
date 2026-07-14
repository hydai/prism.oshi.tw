import { NowPlayingControls } from 'prism-oshi-tw';

// Context-driven transport bar: the harness seeds a paused player, so the
// gradient play button shows the Play glyph; shuffle/repeat sit in their "off"
// (tertiary) state. It nests VolumeControl (volume 70). `size` is required and
// drives all dimensions (mobile is larger). Stage on the app page gradient (the
// Now Playing modal surface) so the nested volume track and tertiary icons read.
const panel = {
  display: 'inline-flex',
  padding: '28px 40px',
  borderRadius: 20,
  background:
    'linear-gradient(135deg, var(--bg-page-start), var(--bg-page-mid), var(--bg-page-end))',
  border: '1px solid var(--border-glass)',
} as const;

export const Desktop = () => (
  <div style={panel}>
    <NowPlayingControls size="desktop" />
  </div>
);

export const Mobile = () => (
  <div style={panel}>
    <NowPlayingControls size="mobile" />
  </div>
);
