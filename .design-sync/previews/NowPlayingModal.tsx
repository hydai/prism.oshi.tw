import { NowPlayingModal } from 'prism-oshi-tw';

// Context-only component: the preview harness (cfg.provider) seeds a current
// track, queue, and showModal=true, so the full "正在播放" modal renders.
// Rendered as a single full-bleed card (cfg.overrides.NowPlayingModal).
export const Default = () => <NowPlayingModal />;
