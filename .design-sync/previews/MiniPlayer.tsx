import { MiniPlayer } from 'prism-oshi-tw';

// Context-only, no props. The harness seeds a current track (夜に駆ける —
// YOASOBI, paused), a 5-item queue, and volume 70; usePathname is stubbed to '/'.
//
// MiniPlayer is a `position: fixed; bottom: 0` bar with no in-flow height, so on
// its own it escapes the card's content crop (only the progress sliver shows).
// The `transform` on this fixed-height box makes it the containing block for the
// fixed bar, docking it at the bottom over a page-gradient backdrop exactly as in
// the app. Wide viewport → the desktop now-playing bar renders: album art + track
// info, shuffle / prev / play / next / repeat transport, a scrubbable progress bar
// with time labels, and expand / like / queue / volume on the right.
export const Default = () => (
  <div
    style={{
      position: 'relative',
      height: 200,
      transform: 'translateZ(0)',
      overflow: 'hidden',
      borderRadius: 8,
      background: 'linear-gradient(180deg, #FFF0F5 0%, #F0F8FF 55%, #E6E6FA 100%)',
    }}
  >
    <MiniPlayer />
  </div>
);
