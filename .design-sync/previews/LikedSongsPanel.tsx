import { LikedSongsPanel } from 'prism-oshi-tw';

const noop = () => {};

// Context-only: the harness seeds 4 liked songs (夜に駆ける · 命に嫌われている。·
// 白日 · 花に亡霊), so the "喜愛的歌曲" panel renders the list + 播放全部 button.
export const Default = () => <LikedSongsPanel show onClose={noop} onToast={noop} />;
