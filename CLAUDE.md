# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Multi-streamer VTuber song archive platform. Users browse archived karaoke performances, play songs via embedded YouTube, manage playlists, and like songs. Fully static site deployed to GitHub Pages.

## Commands

```bash
npm run dev          # Dev server on localhost:3000
npm run build        # Static export to out/
npm run lint         # ESLint (next/core-web-vitals)
npx playwright test  # E2E tests (requires dev server running on :3000)
```

No environment variables required. All config lives in `data/registry.json` and CSS variables.

## Tech Stack

- **Next.js 16** (App Router, `output: "export"` — static HTML only, no SSR)
- **React 19**, **TypeScript 5.9** (strict mode)
- **Tailwind CSS 3.4** with CSS variable-backed design tokens
- **@tanstack/react-virtual** for virtualized song lists
- Path alias: `@/*` maps to project root

## Architecture

### Multi-Streamer Design

The app serves multiple VTuber archives from a single codebase. Each streamer has:
- Config entry in `data/registry.json` (slug, theme, social links)
- Data directory at `data/{slug}/` with `songs.json`, `streams.json`, `metadata/`
- Dynamic route at `app/[streamer]/` with static generation via `generateStaticParams()`
- Per-streamer CSS theme injected by `StreamerShell.tsx` onto `document.body`
- Isolated localStorage keys: `prism_{slug}_playlists`, `prism_{slug}_liked_songs`

### Data Flow

1. **Static JSON files** in `data/` → loaded by `lib/data.ts` at build time
2. **API routes** (`app/api/[streamer]/{songs,streams,metadata}`) — all `force-static`, pre-rendered
3. **Client components** fetch these API routes on mount, no server needed at runtime
4. **Album art** comes from iTunes/Deezer metadata cached in `data/{slug}/metadata/`

### State Management (Context API)

Six contexts in `app/contexts/`, wrapped by `GlobalProviders.tsx`:
- **PlayerContext** — playback state, queue, shuffle/repeat, YouTube IFrame API control
- **PlaylistContext** — CRUD playlists, localStorage persistence, JSON import/export
- **LikedSongsContext** — favorite songs, localStorage-backed
- **RecentlyPlayedContext** — play history tracking
- **StreamerContext** — read-only current streamer config
- **FanAuthContext** — minimal auth placeholder

### Theme System

- Global CSS variables defined in `app/globals.css` (~53 custom properties)
- Per-streamer overrides from `registry.json` theme object (12 color tokens)
- Tailwind config extends with `token-*`, `accent-*`, `surface-*` utilities that reference CSS vars
- `StreamerShell.tsx` applies streamer theme vars to `document.body` so fixed-position elements (MiniPlayer, modals) inherit correctly

### Key Types (`lib/types.ts`)

- `Song` → `{ id, title, originalArtist, tags, performances[] }`
- `Performance` → `{ streamId, videoId, timestamp, endTimestamp, ... }`
- `Stream` → `{ id, title, date, videoId, youtubeUrl }`
- `StreamerConfig` → `{ slug, displayName, theme, socialLinks, enabled, ... }`
- `SongMetadata` → `{ albumArtUrl, trackDuration, itunesTrackId, fetchStatus, ... }`

### YouTube Integration

Hidden `<iframe>` controlled via YouTube IFrame API. Songs reference specific video timestamps. `lib/utils.ts` has YouTube URL/timestamp helpers.

## Key Directories

- `app/[streamer]/page.tsx` — main archive page (largest file, song browsing + timeline views)
- `app/components/` — UI components (MiniPlayer, SongCard, PlaylistPanel, etc.)
- `app/contexts/` — all React context providers
- `lib/` — shared utilities (data loading, parsing, iTunes API, types)
- `data/` — static JSON data files per streamer
- `admin/` — separate Cloudflare Workers admin dashboard (excluded from tsconfig)
- `tools/` — data extraction tools like prismlens (excluded from tsconfig)

## Adding a New Streamer

1. Add entry to `data/registry.json` with slug, theme, social links
2. Create `data/{slug}/` with `songs.json`, `streams.json`, `metadata/` directory
3. Add slug to `lib/streamer-slugs.ts`
4. Rebuild

## Deployment

Push to `master` triggers GitHub Actions (`.github/workflows/deploy.yml`):
Node 22 → `npm ci` → `npm run build` → deploy `out/` to GitHub Pages
