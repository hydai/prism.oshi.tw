import { AddToPlaylistDropdown } from 'prism-oshi-tw';
import { Music } from 'lucide-react';

const noop = () => {};

// Realistic PlaylistVersion (a specific karaoke performance to add).
const version = {
  performanceId: 'perf-2',
  songTitle: '命に嫌われている。',
  originalArtist: 'カンザキイオリ',
  videoId: 'prevVIDaa03',
  timestamp: 315,
  endTimestamp: 630,
  streamerSlug: 'demo',
};

// AddToPlaylistDropdown is a trigger-only control: it renders a compact ListPlus
// icon button and opens its playlist menu on click (internal state, no `show`
// prop). It can't be opened statically, so the trigger is shown in the song-row
// context where it actually lives, with the row's text color set so the icon is
// visible. See learnings/dialogs.md — the open menu needs interaction to grade.
export const Trigger = () => (
  <div
    className="flex items-center gap-3"
    style={{
      width: 340,
      padding: '12px 14px',
      borderRadius: 12,
      background: 'var(--bg-surface)',
      border: '1px solid var(--border-default)',
      color: 'var(--text-secondary)',
    }}
  >
    <div
      className="flex items-center justify-center flex-shrink-0"
      style={{
        width: 40,
        height: 40,
        borderRadius: 8,
        background: 'linear-gradient(135deg, #F472B6, #60A5FA)',
        color: 'white',
      }}
    >
      <Music style={{ width: 16, height: 16 }} />
    </div>
    <div className="min-w-0 flex-1">
      <div
        className="truncate"
        style={{ color: 'var(--text-primary)', fontSize: 14, fontWeight: 600 }}
      >
        {version.songTitle}
      </div>
      <div className="truncate" style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>
        {version.originalArtist}
      </div>
    </div>
    <AddToPlaylistDropdown version={version} onSuccess={noop} />
  </div>
);
