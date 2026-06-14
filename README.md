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

Prism currently archives **33** VTuber streamers. See [`data/registry.json`](data/registry.json) for the full, up-to-date list.

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

Streamers are managed through the Nova admin backend, **not** by hand-editing files —
`data/registry.json` and `lib/streamer-slugs.ts` are auto-generated, so hand edits get overwritten:

1. Approve the streamer in the Nova admin (D1-backed)
2. `npm run sync:registry` — regenerates `data/registry.json` and `lib/streamer-slugs.ts` from the Nova DB
3. `npm run sync:data` — exports approved songs/streams to `data/{slug}/`
4. Commit & push → GitHub Actions rebuilds and deploys

## License

[MIT](LICENSE)
