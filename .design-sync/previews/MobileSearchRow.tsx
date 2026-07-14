import { MobileSearchRow } from 'prism-oshi-tw';

const noop = () => {};

const song = {
  id: 'song-1',
  performanceId: 'perf-1',
  title: '夜に駆ける',
  originalArtist: 'YOASOBI',
  videoId: 'prevVIDaa01',
  timestamp: 372,
  endTimestamp: 633,
};

// Resting state: gradient play button, title/artist, VOD start timestamp.
export const Default = () => (
  <div style={{ width: 380 }}>
    <MobileSearchRow
      song={song}
      isCurrentlyPlaying={false}
      isUnavailable={false}
      onPlay={noop}
      streamerSlug="demo"
    />
  </div>
);

// Currently-playing state: pink-muted row background + pink accent title.
export const NowPlaying = () => (
  <div style={{ width: 380 }}>
    <MobileSearchRow
      song={{
        id: 'song-2',
        performanceId: 'perf-2',
        title: '花に亡霊',
        originalArtist: 'ヨルシカ',
        videoId: 'prevVIDaa06',
        timestamp: 512,
        endTimestamp: 754,
      }}
      isCurrentlyPlaying
      isUnavailable={false}
      onPlay={noop}
      streamerSlug="demo"
    />
  </div>
);
