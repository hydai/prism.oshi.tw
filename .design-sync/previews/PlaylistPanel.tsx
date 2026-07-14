import { PlaylistPanel } from 'prism-oshi-tw';

const noop = () => {};

// The catalog PlaylistPanel resolves versions against: performance ids perf-0…
// perf-5 match the two playlists the harness seeds (お気に入り · 3 / 作業用BGM · 4),
// so every saved version resolves as playable.
const SONGS: Array<[string, string, string]> = [
  ['夜に駆ける', 'YOASOBI', 'prevVIDaa01'],
  ['廻廻奇譚', 'Eve', 'prevVIDaa02'],
  ['命に嫌われている。', 'カンザキイオリ', 'prevVIDaa03'],
  ['KING', 'Kanaria', 'prevVIDaa04'],
  ['白日', 'King Gnu', 'prevVIDaa05'],
  ['花に亡霊', 'ヨルシカ', 'prevVIDaa06'],
];

const songsData = SONGS.map(([title, originalArtist, videoId], i) => ({
  id: `song-${i}`,
  title,
  originalArtist,
  tags: ['J-POP'],
  performances: [
    {
      id: `perf-${i}`,
      streamId: `s${i}`,
      date: '2024-03-15',
      streamTitle: '深夜の歌枠 🌙',
      videoId,
      timestamp: 100 * (i + 1),
      endTimestamp: 100 * (i + 1) + 240,
      note: '',
    },
  ],
}));

// Opens on the playlist index (お気に入り · 3 首歌曲 / 作業用BGM · 4 首歌曲) with
// per-card rename/export/play/delete actions.
export const Default = () => (
  <PlaylistPanel show songsData={songsData} onClose={noop} onToast={noop} />
);
