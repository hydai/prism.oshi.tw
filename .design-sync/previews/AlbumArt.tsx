import { AlbumArt } from 'prism-oshi-tw';

// A stand-in cover so the image path renders offline (no network in capture).
const COVER =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'>" +
      "<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>" +
      "<stop offset='0' stop-color='#EC4899'/><stop offset='0.5' stop-color='#A855F7'/><stop offset='1' stop-color='#3B82F6'/>" +
      '</linearGradient></defs>' +
      "<rect width='300' height='300' fill='url(#g)'/>" +
      "<circle cx='150' cy='150' r='74' fill='rgba(255,255,255,0.16)'/>" +
      "<circle cx='150' cy='150' r='22' fill='rgba(255,255,255,0.92)'/>" +
      '</svg>',
  );

export const WithArtwork = () => <AlbumArt src={COVER} alt="夜に駆ける — YOASOBI" size={160} />;

// No src → the component's branded gradient + music-note placeholder.
export const Placeholder = () => <AlbumArt alt="No artwork available" size={160} />;

export const Sizes = () => (
  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16 }}>
    <AlbumArt src={COVER} alt="40" size={40} />
    <AlbumArt src={COVER} alt="64" size={64} />
    <AlbumArt src={COVER} alt="96" size={96} />
    <AlbumArt src={COVER} alt="128" size={128} />
  </div>
);

export const Radius = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
    <AlbumArt src={COVER} alt="square" size={96} borderRadius={0} />
    <AlbumArt src={COVER} alt="rounded" size={96} borderRadius={16} />
    <AlbumArt src={COVER} alt="circle" size={96} borderRadius="50%" />
  </div>
);
