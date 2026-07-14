import { BottomSheet } from 'prism-oshi-tw';
import { Music } from 'lucide-react';

const noop = () => {};

// The sheet itself is a hard-coded dark frosted surface, so its children use
// light-on-dark styling. A small realistic queue of karaoke performances.
const ROWS = [
  { title: '夜に駆ける', artist: 'YOASOBI', dur: '4:21' },
  { title: '廻廻奇譚', artist: 'Eve', dur: '3:33' },
  { title: '命に嫌われている。', artist: 'カンザキイオリ', dur: '5:15' },
  { title: 'KING', artist: 'Kanaria', dur: '3:18' },
  { title: '白日', artist: 'King Gnu', dur: '4:46' },
];

function SongRows() {
  return (
    <div style={{ padding: '8px 8px 20px' }}>
      {ROWS.map((r) => (
        <div
          key={r.title}
          className="flex items-center gap-3"
          style={{ padding: '10px 12px', borderRadius: 12 }}
        >
          <div
            className="flex items-center justify-center flex-shrink-0"
            style={{
              width: 44,
              height: 44,
              borderRadius: 8,
              background: 'linear-gradient(135deg, #F472B6, #60A5FA)',
              color: 'white',
            }}
          >
            <Music style={{ width: 18, height: 18 }} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate" style={{ color: 'white', fontSize: 14, fontWeight: 600 }}>
              {r.title}
            </div>
            <div className="truncate" style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>
              {r.artist}
            </div>
          </div>
          <div
            style={{
              color: 'rgba(255,255,255,0.4)',
              fontSize: 12,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {r.dur}
          </div>
        </div>
      ))}
    </div>
  );
}

// Base overlay rendered open: on this narrow viewport the mobile bottom-sheet
// variant shows — drag handle, header (icon + title + headerRight + close),
// scrollable content — rising over a blurred backdrop.
export const Default = () => (
  <BottomSheet
    show
    onClose={noop}
    title="播放佇列"
    titleIcon={<Music style={{ width: 18, height: 18, color: '#F472B6' }} />}
    headerRight={<span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>5 首</span>}
  >
    <SongRows />
  </BottomSheet>
);
