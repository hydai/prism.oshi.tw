# Prism

Multi-streamer VTuber song archive platform. Browse archived karaoke performances, play songs via embedded YouTube, manage playlists, and like songs. Fully static site deployed to GitHub Pages.

## Features

- Song browsing with search, filtering by tags/artists, and timeline views
- Embedded YouTube playback with precise timestamp seeking
- Playlist management (create, edit, import/export as JSON)
- Liked songs collection
- Recently played history
- Virtualized song lists for smooth performance with large archives
- Per-streamer theming with CSS custom properties
- Fully static — no server required at runtime

## Supported Streamers

| Streamer | Group |
|----------|-------|
| [浠Mizuki](https://www.youtube.com/c/%E6%B5%A0MizukiChannel) | 子午計畫 |
| [Gabu ch. 加百利 珈咘](https://www.youtube.com/channel/UCCHsCWNTcGJ8Jml_oZ6nG2Q) | 個人勢 |
| [玥Itsuki](https://www.youtube.com/@ItsukiIanvs) | 子午計畫 |
| [煌Kirali](https://www.youtube.com/@%E7%85%8CKirali) | 子午計畫 |
| [汐Seki](https://www.youtube.com/channel/UC_aaEh6TaE5VpA_zQTUCcNQ) | 子午計畫 |

## Tech Stack

- **Next.js 16** (App Router, static export)
- **React 19**
- **TypeScript 5.9** (strict mode)
- **Tailwind CSS 3.4**
- **@tanstack/react-virtual** for virtualized lists

## Getting Started

```bash
# Install dependencies
npm install

# Start dev server on localhost:3000
npm run dev

# Build static site to out/
npm run build

# Lint
npm run lint

# Run E2E tests (requires dev server on :3000)
npx playwright test
```

## Project Structure

```
app/
  [streamer]/       # Dynamic route per streamer
  components/       # UI components (MiniPlayer, SongCard, PlaylistPanel, etc.)
  contexts/         # React context providers (Player, Playlist, Liked, etc.)
  api/              # Static API routes for songs, streams, metadata
lib/                # Shared utilities, types, data loading
data/
  registry.json     # Streamer configurations
  {slug}/           # Per-streamer songs.json, streams.json, metadata/
admin/              # Cloudflare Workers admin dashboard
tools/              # Data extraction and sync tools
```

## Adding a New Streamer

1. Add an entry to `data/registry.json` with slug, theme, and social links
2. Create `data/{slug}/` with `songs.json`, `streams.json`, and `metadata/` directory
3. Add the slug to `lib/streamer-slugs.ts`
4. Rebuild

## License

[MIT](LICENSE)
