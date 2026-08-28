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
npx --yes --package react-doctor@0.9.12 -- react-doctor . --scope changed --base master --blocking warning --yes --no-score
                     # React Doctor, same gate as CI (see Commit & Review SOP)
```

No environment variables required. All config lives in `data/registry.json` and CSS variables.

Data-pipeline & ops scripts run via `npm run` or slash commands — e.g. `sync:registry`, `sync:data`, `sync:status`, `inbox:status`, `fetch:channel-info` (see Deployment). Unit tests run via `npm run test:*` (parse, archive, playlist-storage, youtube-iframe); CI (`.github/workflows/ci.yml`) runs them on push.

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
- Data directory at `data/{slug}/` with `songs.json` and `streams.json`
- Dynamic route at `app/[streamer]/` with static generation via `generateStaticParams()`
- Per-streamer CSS theme injected by `StreamerShell.tsx` onto `document.body`
- Isolated localStorage keys: `prism_{slug}_playlists`, `prism_{slug}_liked_songs`

### Data Flow

1. **Static JSON files** in `data/` → loaded by `lib/data.ts` at build time
2. **API routes** (`app/api/[streamer]/{songs,streams}`) — all `force-static`, pre-rendered
3. **Client components** fetch these API routes on mount, no server needed at runtime

### State Management (Context API)

Six contexts in `app/contexts/`, wired in two layers:
- **App-wide** (`GlobalProviders.tsx`, root layout): **FanAuthContext** — minimal auth placeholder
- **Per-streamer** (`app/[streamer]/StreamerShell.tsx`): **StreamerContext** (read-only current streamer config) → **PlayerContext** (playback state, queue, shuffle/repeat, YouTube IFrame API control) → `PerStreamerProviders.tsx`, which nests **PlaylistContext** (CRUD playlists, JSON import/export), **LikedSongsContext**, **RecentlyPlayedContext** — each localStorage-backed and keyed by `streamerSlug`

### Theme System

- Global CSS variables defined in `app/globals.css` (~61 custom properties)
- Per-streamer overrides from `registry.json` theme object (12 color tokens)
- Tailwind config extends with `token-*`, `accent-*`, `surface-*` utilities that reference CSS vars
- `StreamerShell.tsx` applies streamer theme vars to `document.body` so fixed-position elements (MiniPlayer, modals) inherit correctly

### Key Types (`lib/types.ts`)

- `Song` → `{ id, title, originalArtist, tags, performances[] }`
- `Performance` → `{ streamId, videoId, timestamp, endTimestamp, ... }`
- `Stream` → `{ id, title, date, videoId, youtubeUrl }`
- `StreamerConfig` → `{ slug, displayName, theme, socialLinks, enabled, ... }`

### YouTube Integration

Hidden `<iframe>` controlled via YouTube IFrame API. Songs reference specific video timestamps. `lib/utils.ts` has YouTube URL/timestamp helpers.

## Key Directories

- `app/[streamer]/page.tsx` — main archive page (largest file, song browsing + timeline views)
- `app/components/` — UI components (MiniPlayer, SongCard, PlaylistPanel, etc.)
- `app/contexts/` — all React context providers
- `lib/` — shared utilities (data loading, parsing, types; `lib/itunes.ts` is used only by `tools/aurora`)
- `data/` — static JSON data files per streamer
- `admin/` — Cloudflare Workers admin dashboard + D1 database (`schema.sql`, `migrations/`, `seed.ts`); excluded from tsconfig
- `tools/` — backend services & data pipeline (excluded from tsconfig): `nova` (submission worker), `crystal` (feedback worker), `aurora` (Cloudflare Pages song editor), `sync-{registry,data,stale,status}` (Nova DB → repo sync), `fetch-channel-info`, `inbox-status`, `shared`

## Adding a New Streamer

Streamers are managed through the Nova admin backend, **not** by hand-editing files:
1. Approve the streamer in the Nova admin (D1-backed; see `admin/` + `tools/nova/`)
2. `/sync-registry` (`npm run sync:registry`) — regenerates `data/registry.json` **and** `lib/streamer-slugs.ts` from the Nova DB
3. `/sync-data` (`npm run sync:data`) — exports approved songs/streams to `data/{slug}/`
4. Commit & push → GitHub Actions rebuilds and deploys

> `lib/streamer-slugs.ts` and `data/registry.json` are generated by `/sync-registry` — hand edits get overwritten.

## Commit & Review SOP

Run before every commit and again before requesting review:

1. `npm run lint` + the `npm run test:*` suites for what you touched (`.github/workflows/ci.yml` lists them); `npm run check` in `admin/` and `admin/ui/` when those changed.
2. **React Doctor** — `.github/workflows/react-doctor.yml` runs `millionco/react-doctor` v0.9.12 with `scope: full` + `blocking: warning` on every PR to `master` and every `master` push. **Any warning fails the check; `master` baseline is 0 warnings.**
   - Dev loop: the `--scope changed --base master` command above (only new issues vs. `master`). To reproduce the CI report exactly: `--scope full --verbose`.
   - Findings are hypotheses: read the code at `file:line` (same npx prefix + `react-doctor why <file:line>` explains the rule) and fix the root cause — refactor, don't reach for config or suppressions.
   - Only when the pattern is deliberate (e.g. sequential awaits for D1 serialization or rate limiting, `<img>` in a static export), keep it but annotate: a one-line *why* comment directly followed by `// react-doctor-disable-next-line react-doctor/<rule>` (JSX: `{/* ... */}`) on the offending line — see commits #136 / #137. No blanket `doctor.config.*` ignores.
   - Findings in commits of your own unmerged branch get folded into the originating commit (fixup + autosquash), not a trailing "fix doctor" commit.
   - Gotcha: local full scans also read gitignored dirs such as `ds-bundle/` (Claude Design output) — ignore findings outside tracked files.
3. Land only when lint, tests, and React Doctor are all green locally; then check the PR's **React Doctor** and **CI** checks after pushing.

## Deployment

Push to `master` triggers GitHub Actions (`.github/workflows/deploy.yml`):
Node 22 → `npm ci` → `npm run build` → deploy `out/` to GitHub Pages

Workers & Pages are deployed manually via slash commands (`/deploy-nova`, `/deploy-crystal`, `/deploy-admin`, `/deploy-aurora`).
**IMPORTANT**: Aurora is a Cloudflare Pages project — must deploy with `--branch main` (not `production` or `master`).
**IMPORTANT**: After modifying code in `tools/nova/`, `tools/crystal/`, `admin/`, or Aurora, always deploy the affected service before finishing. These are Cloudflare Workers/Pages — code changes only take effect after deployment.
