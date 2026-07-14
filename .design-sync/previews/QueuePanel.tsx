import { QueuePanel } from 'prism-oshi-tw';

// Context-only: the harness seeds a 5-track queue (廻廻奇譚 · 命に嫌われている。·
// KING · 白日 · 花に亡霊) and showQueue=true, so the full "播放佇列" side panel
// renders populated with no props. Single-card mode (cfg.overrides.QueuePanel).
export const Default = () => <QueuePanel />;
