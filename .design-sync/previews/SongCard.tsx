import { SongCard } from 'prism-oshi-tw';

const noop = () => {};

const song = {
  id: 'song-1',
  title: '夜に駆ける',
  originalArtist: 'YOASOBI',
  tags: ['J-POP', 'ボカロ'],
  performances: [
    { id: 'p1', streamId: 's1', date: '2024-03-15', streamTitle: '深夜の歌枠 🌙', videoId: 'prevVIDaa01', timestamp: 372, endTimestamp: 633, note: '' },
    { id: 'p2', streamId: 's2', date: '2024-01-08', streamTitle: '新年カラオケ配信', videoId: 'prevVIDaa11', timestamp: 1200, endTimestamp: 1461, note: 'アコースティックver.' },
    { id: 'p3', streamId: 's3', date: '2023-11-20', streamTitle: '登録者記念スペシャル', videoId: 'prevVIDaa21', timestamp: 640, endTimestamp: 901, note: '' },
  ],
};

const common = {
  song,
  onToggleExpand: noop,
  onPlay: noop,
  onAddToQueue: noop,
  onAddToPlaylistSuccess: noop,
  isLiked: () => false,
  onToggleLike: noop,
  unavailableVideoIds: new Set<string>(),
  streamerSlug: 'demo',
};

export const Collapsed = () => (
  <div style={{ maxWidth: 640 }}>
    <SongCard {...common} isExpanded={false} />
  </div>
);

export const Expanded = () => (
  <div style={{ maxWidth: 640 }}>
    <SongCard {...common} isExpanded />
  </div>
);
