import { AlbumArt } from 'prism-oshi-tw';

// AlbumArt is a pure placeholder — the archive carries no artwork data — so
// every story shows the branded gradient + music-note tile; only geometry varies.
export const Placeholder = () => <AlbumArt alt="No artwork available" size={160} />;

export const Sizes = () => (
  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16 }}>
    <AlbumArt alt="40" size={40} />
    <AlbumArt alt="64" size={64} />
    <AlbumArt alt="96" size={96} />
    <AlbumArt alt="128" size={128} />
  </div>
);

export const Radius = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
    <AlbumArt alt="square" size={96} borderRadius={0} />
    <AlbumArt alt="rounded" size={96} borderRadius={16} />
    <AlbumArt alt="circle" size={96} borderRadius="50%" />
  </div>
);
