import { RecentlyPlayedPanel } from 'prism-oshi-tw';

const noop = () => {};

// Context-only: the harness seeds 4 recently-played entries (廻廻奇譚 · KING ·
// 夜に駆ける · 花に亡霊), so the "最近播放" panel renders the history list, the
// per-row relative timestamp, the 清除全部 header action, and 播放全部 button.
export const Default = () => <RecentlyPlayedPanel show onClose={noop} onToast={noop} />;
