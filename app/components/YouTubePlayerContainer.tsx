'use client';

import { PLAYER_DIV_ID } from '../lib/player-store';

export default function YouTubePlayerContainer() {
  // Two layers on purpose: new YT.Player('youtube-player') synchronously
  // REPLACES its target node, so React must never use that node as a
  // structural reference. React owns only the outer wrapper (StreamerShell
  // inserts siblings such as MiniPlayer relative to it); the inner div is a
  // leaf React renders once and never revisits, so YouTube may swap it for
  // the player iframe at any time — including mid-tick, before a commit.
  return (
    <div className="fixed top-0 left-0 w-0 h-0 opacity-0 pointer-events-none overflow-hidden">
      <div id={PLAYER_DIV_ID} />
    </div>
  );
}
