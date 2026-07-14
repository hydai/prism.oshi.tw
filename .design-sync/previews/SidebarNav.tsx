import { SidebarNav } from 'prism-oshi-tw';

const noop = () => {};

// SidebarNav's root <aside> is `hidden lg:flex` — it only becomes visible at the
// lg (1024px) breakpoint. The capture viewport is 900px, so a scoped display
// shim reveals it (the nav is a fixed 256px column, so it looks identical to how
// it renders natively at lg+). A config viewport override (width ≥ 1024) would
// drop the shim entirely — see .design-sync/learnings/content.md.
// Counts mirror the seeded harness state: 4 liked, 4 recently played, 2 playlists.
export const Default = () => (
  <>
    <style>{`.ds-sidebarnav-card aside{display:flex !important}`}</style>
    <div className="ds-sidebarnav-card" style={{ height: 640, width: 280, display: 'flex' }}>
      <SidebarNav
        activePage="home"
        onViewLikedSongs={noop}
        likedSongsCount={4}
        onViewRecentlyPlayed={noop}
        recentlyPlayedCount={4}
        onCreatePlaylist={noop}
        onViewPlaylists={noop}
        playlistCount={2}
      />
    </div>
  </>
);
