import { TimelineRow } from 'prism-oshi-tw';

const noop = () => {};

// TimelineRow's stream-title + date columns and its 6-column grid are `lg:`-gated
// (≥1024px), and the row's queue/playlist/YouTube actions are hover-only —
// laid out to overflow-but-invisible until hover. The capture viewport is 900px,
// so this scoped shim promotes the row to its desktop layout: the 6-column grid,
// the revealed stream-title + date columns, the desktop track number, and the
// overflow hover-actions trimmed so only the persistent like + duration remain.
// A config viewport override (width ≥ 1024) would render this natively and let
// the shim be dropped — see .design-sync/learnings/content.md.
const SHIM = `
.ds-tl [data-testid="performance-row"]{grid-template-columns:32px 40px 2fr 2fr 100px 60px !important}
.ds-tl .lg\\:hidden{display:none !important}
.ds-tl .hidden{display:flex !important}
.ds-tl [data-testid="add-to-queue"]{display:none !important}
.ds-tl [data-testid="performance-row"] > div:last-child > a{display:none !important}
.ds-tl [data-testid="performance-row"] > div:last-child > div{display:none !important}
`;

// FlattenedSong (app/types/archive) — a single karaoke performance row.
const song = {
  id: 'song-1',
  title: '夜に駆ける',
  originalArtist: 'YOASOBI',
  performanceId: 'perf-1',
  streamId: 'stream-1',
  date: '2024-03-15',
  streamTitle: '深夜の歌枠 🌙 リクエスト大歓迎',
  videoId: 'prevVIDaa01',
  timestamp: 372,
  endTimestamp: 633,
  note: 'アコースティックver.',
  searchString: '夜に駆ける yoasobi よるにかける',
  year: 2024,
};

const common = {
  index: 0,
  isUnavailable: false,
  onToggleLike: noop,
  onPlay: noop,
  onAddToQueue: noop,
  onAddToPlaylistSuccess: noop,
  streamerSlug: 'demo',
};

// Resting row: #, album-art placeholder, title + blue note pill, artist,
// stream title, date, like affordance, duration.
export const Default = () => (
  <>
    <style>{SHIM}</style>
    <div className="ds-tl" style={{ width: 800 }}>
      <TimelineRow {...common} song={song} isCurrentlyPlaying={false} isLiked={false} />
    </div>
  </>
);

// Currently-playing + liked: pink accent title, current-row tint, filled heart.
export const Playing = () => (
  <>
    <style>{SHIM}</style>
    <div className="ds-tl" style={{ width: 800 }}>
      <TimelineRow
        {...common}
        index={1}
        song={{
          ...song,
          id: 'song-2',
          performanceId: 'perf-2',
          title: '白日',
          originalArtist: 'King Gnu',
          videoId: 'prevVIDaa05',
          timestamp: 640,
          endTimestamp: 926,
          note: '',
          streamTitle: '登録者10万人記念スペシャル配信',
          date: '2024-01-08',
          searchString: '白日 king gnu はくじつ',
        }}
        isCurrentlyPlaying
        isLiked
      />
    </div>
  </>
);
