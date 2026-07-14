# Prism Oshi — how to build with this library

`PrismOshi.*` is the compiled component set for a multi-streamer VTuber
karaoke-archive app (browse archived karaoke, play via embedded YouTube, manage
playlists, like songs). Components render from `window.PrismOshi`. They fall
into two tiers:

**Presentational — compose freely, driven only by props (no provider):**
`AlbumArt`, `SongCard`, `TimelineRow`, `ProgressBar`, `VolumeControl`, `Toast`,
`DiscordIcon`, `BottomSheet`, `MobileSearchRow`, `ThemeToggle`.

**Stateful — read app context via hooks** (`usePlayer`, `useStreamer`,
`usePlaylist`, `useLikedSongs`, `useRecentlyPlayed`): `MiniPlayer`,
`NowPlayingModal`, `NowPlayingControls`, `QueuePanel`, `UpNextSection`,
`PlaylistPanel`, `LikedSongsPanel`, `RecentlyPlayedPanel`, `CreatePlaylistDialog`,
`AddToPlaylistDropdown`, `SidebarNav`. These must be mounted inside the app's
provider stack. For mockups, wrap them in **`PrismOshi.PreviewProvider`**, which
mounts every provider pre-seeded with sample track / queue / playlist / liked /
recently-played data:

```jsx
<PrismOshi.PreviewProvider>
  <PrismOshi.MiniPlayer />
  {/* or NowPlayingModal, QueuePanel, PlaylistPanel show, … */}
</PrismOshi.PreviewProvider>
```

Overlay pieces (`NowPlayingModal`, `*Panel`, `CreatePlaylistDialog`,
`BottomSheet`) render via a portal to `document.body` and are `position: fixed`
full-screen/side-panel — place them at the top of a page, not inside a card.

## Styling idiom — CSS custom properties
The whole design language is CSS variables, themed for light AND dark (dark is
`html.dark`). Style your own layout glue with these `var(--*)` tokens — never
hard-code hexes or invent scales. They are the source of truth; the built
`styles.css` defines every one.

- **Accent**: `--accent-pink`, `--accent-pink-dark`, `--accent-pink-light`,
  `--accent-blue`, `--accent-blue-light`, `--accent-purple`
- **Surfaces / page**: `--bg-surface`, `--bg-surface-frosted`,
  `--bg-surface-glass`, `--bg-surface-muted`, `--bg-overlay`,
  `--bg-page-start|-mid|-end`, `--bg-accent-pink[-muted]`, `--bg-accent-blue[-muted]`
- **Text**: `--text-primary`, `--text-secondary`, `--text-tertiary`,
  `--text-muted`, `--text-on-accent`
- **Border**: `--border-default`, `--border-glass`, `--border-table`,
  `--border-accent-pink`, `--border-accent-blue`
- **Radius**: `--radius-xs|-sm|-md|-lg|-xl|-2xl|-3xl|-pill|-circle`
- **Spacing**: `--space-1…-8` (2/4/8/12/16/24/32/40px)
- **Type**: `--font-primary` (DM Sans), `--font-size-xs…-display`
- **Icon sizes**: `--icon-sm|-md|-lg|-xl`

Components apply these almost entirely as **inline `style={{ … }}`** using the
`var(--*)` tokens, alongside standard Tailwind **layout** utilities (`flex`,
`grid`, `gap-*`, `p-*`, `rounded-xl`, `truncate`, …) which ARE in `styles.css`.
The Tailwind preset also declares token-*color/size* utility classes
(`bg-surface`, `text-token-primary`, `rounded-radius-*`, …), but the app styles
with `var(--*)` instead, so those custom utility classes are **mostly NOT
compiled** into the shipped `styles.css`. For new styling, use the `var(--*)`
tokens above (inline) — do not rely on the token utility classes.

## Where to look before composing
- `styles.css` — the complete token set (imports the compiled tokens +
  `_ds_bundle.css` component styles).
- each component's `<Name>.d.ts` (its exact props) and `<Name>.prompt.md`
  (usage) under `components/general/<Name>/`.

## One idiomatic snippet
```jsx
<div style={{
  background: 'var(--bg-surface-glass)',
  border: '1px solid var(--border-glass)',
  borderRadius: 'var(--radius-xl)',
  padding: 'var(--space-6)',
  fontFamily: 'var(--font-primary)',
}}>
  <PrismOshi.SongCard
    song={{ id: 's1', title: '夜に駆ける', originalArtist: 'YOASOBI', tags: [], performances: [] }}
    isExpanded={false}
    onToggleExpand={() => {}} onPlay={() => {}} onAddToQueue={() => {}}
    onAddToPlaylistSuccess={() => {}} isLiked={() => false} onToggleLike={() => {}}
    unavailableVideoIds={new Set()} streamerSlug="demo"
  />
</div>
```
