# Architecture Overview

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        BUILD TIME (Node 22)                            │
│                                                                         │
│  ┌──────────────┐    ┌─────────────┐    ┌──────────────────────────┐   │
│  │ Cloudflare   │    │   tools/    │    │     data/                │   │
│  │ D1 Databases │───▶│ sync-*/*.ts │───▶│ ├─ registry.json        │   │
│  │              │    │             │    │ ├─ mizuki/               │   │
│  │ oshi-prism-db│    │ sync-data   │    │ │  ├─ songs.json        │   │
│  │ oshi-prism-  │    │ sync-       │    │ │  ├─ streams.json      │   │
│  │   nova       │    │  registry   │    │ │  └─ metadata/         │   │
│  └──────────────┘    └─────────────┘    │ └─ gabu/                │   │
│                                          │    ├─ songs.json        │   │
│                                          │    ├─ streams.json      │   │
│                                          │    └─ metadata/         │   │
│                                          └───────────┬──────────────┘   │
│                                                      │                  │
│                                                      ▼                  │
│                           ┌──────────────────────────────────────┐      │
│                           │          lib/ (shared)               │      │
│                           │  ├─ data.ts      (read JSON files)   │      │
│                           │  ├─ registry.ts  (streamer configs)  │      │
│                           │  ├─ types.ts     (all TS interfaces) │      │
│                           │  ├─ utils.ts     (YouTube helpers)   │      │
│                           │  ├─ parse.ts     (setlist parser)    │      │
│                           │  ├─ itunes.ts    (metadata fetch)    │      │
│                           │  └─ streamer-slugs.ts                │      │
│                           └───────────────┬──────────────────────┘      │
│                                           │                             │
│                                           ▼                             │
│                      ┌───────────────────────────────────┐              │
│                      │  API Routes (force-static)         │              │
│                      │  /api/registry         → Registry  │              │
│                      │  /api/[streamer]/songs  → Song[]   │              │
│                      │  /api/[streamer]/streams→ Stream[] │              │
│                      │  /api/[streamer]/metadata→ Meta[]  │              │
│                      └───────────────┬───────────────────┘              │
│                                      │                                  │
│                              next build (static export)                 │
│                                      │                                  │
│                                      ▼                                  │
│                              ┌──────────────┐                           │
│                              │    out/       │                           │
│                              │  static HTML  │                           │
│                              │  + JSON files │                           │
│                              └──────┬───────┘                           │
└─────────────────────────────────────┼───────────────────────────────────┘
                                      │  GitHub Actions deploy
                                      ▼
                              ┌──────────────┐
                              │ GitHub Pages  │
                              │ prism.oshi.tw │
                              └──────────────┘
```

## 2. React Component Tree & Context Providers

```
app/layout.tsx (RootLayout)
│
└─▶ GlobalProviders.tsx
    │
    ├─▶ FanAuthProvider ─────────────────────── (placeholder, not wired)
    │
    ├─▶ PlayerProvider ◀── YouTube IFrame API
    │   │
    │   ├─▶ YouTubePlayerContainer  (hidden <iframe>)
    │   ├─▶ MiniPlayer              (fixed bottom bar)
    │   ├─▶ NowPlayingModal          (fullscreen overlay)
    │   ├─▶ QueuePanel               (drag-to-reorder queue)
    │   └─▶ RecentlyPlayedTracker    (silent, no UI)
    │
    └─▶ PlaylistProvider
        │
        └─▶ app/[streamer]/layout.tsx
            │
            └─▶ StreamerShell.tsx  (injects CSS theme vars on document.body)
                │
                ├─▶ StreamerProvider  (read-only streamer config)
                │
                └─▶ PerStreamerProviders
                    │
                    ├─▶ LikedSongsProvider   (localStorage per streamer)
                    │
                    └─▶ RecentlyPlayedProvider (localStorage per streamer)
                        │
                        └─▶ [PAGE CONTENT]
                            │
                            ├─▶ app/[streamer]/page.tsx (Main Archive)
                            └─▶ app/[streamer]/now-playing/page.tsx
```

## 3. Main Archive Page Component Dependencies

```
app/[streamer]/page.tsx
│
├── CONTEXTS CONSUMED ─────────────────────────────────────┐
│   useStreamer()        ← StreamerContext                  │
│   usePlayer()         ← PlayerContext                    │
│   usePlaylist()       ← PlaylistContext                  │
│   useLikedSongs()     ← LikedSongsContext                │
│   useRecentlyPlayed() ← RecentlyPlayedContext            │
│                                                           │
├── CHILD COMPONENTS ──────────────────────────────────────┤
│                                                           │
│   ┌─────────────┐  ┌──────────────────┐  ┌────────────┐ │
│   │ SidebarNav  │  │  SongCard        │  │ TimelineRow│ │
│   │             │  │  (grouped view)  │  │ (timeline) │ │
│   │ useStreamer  │  │  ├─ AlbumArt     │  │ ├─ AlbumArt│ │
│   │             │  │  └─ AddToPlaylist │  │ └─ AddTo.. │ │
│   └─────────────┘  │     Dropdown     │  └────────────┘ │
│                     └──────────────────┘                  │
│   ┌───────────────┐  ┌──────────────────┐                │
│   │ PlaylistPanel │  │ LikedSongsPanel  │                │
│   │ ├─ usePlaylist│  │ ├─ useLikedSongs │                │
│   │ ├─ usePlayer  │  │ ├─ usePlayer     │                │
│   │ └─ BottomSheet│  │ └─ BottomSheet   │                │
│   └───────────────┘  └──────────────────┘                │
│   ┌─────────────────────┐  ┌──────────────────────────┐  │
│   │ RecentlyPlayedPanel │  │ CreatePlaylistDialog     │  │
│   │ ├─ useRecentlyPlayed│  │ └─ usePlaylist           │  │
│   │ ├─ usePlayer        │  └──────────────────────────┘  │
│   │ └─ BottomSheet      │                                │
│   └─────────────────────┘  ┌───────────────┐             │
│                             │ MobileSearchRow│             │
│   ┌───────┐                │ (search input) │             │
│   │ Toast │                └───────────────┘             │
│   └───────┘                                              │
└──────────────────────────────────────────────────────────┘
```

## 4. Player System (YouTube Integration)

```
┌─────────────────────────────────────────────────────────────┐
│                    PlayerContext.tsx                          │
│                                                              │
│  State:                    Methods:                          │
│  ├─ currentTrack           ├─ playTrack(track)              │
│  ├─ isPlaying              ├─ togglePlayPause()             │
│  ├─ queue: Track[]         ├─ seekTo(seconds)               │
│  ├─ repeatMode             ├─ previous() / next()           │
│  ├─ shuffleOn              ├─ addToQueue() / removeFromQueue│
│  ├─ volume / isMuted       ├─ toggleRepeat() / Shuffle()    │
│  └─ showModal/showQueue    └─ setVolume() / toggleMute()    │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                YouTube IFrame API                     │   │
│  │                                                       │   │
│  │  1. Load <script> ──▶ onYouTubeIframeAPIReady        │   │
│  │  2. new YT.Player("youtube-player", {...})            │   │
│  │  3. playTrack() ──▶ loadVideoById(videoId, timestamp) │   │
│  │  4. Poll every 500ms:                                 │   │
│  │     currentTime >= endTimestamp? ──▶ next()           │   │
│  │     currentTime >= duration?     ──▶ ended            │   │
│  └──────────────────────────────────────────────────────┘   │
└───────────────────────────┬──────────────────────────────────┘
                            │ usePlayer()
          ┌─────────────────┼─────────────────────┐
          │                 │                     │
          ▼                 ▼                     ▼
┌──────────────┐  ┌────────────────┐  ┌──────────────────┐
│  MiniPlayer  │  │NowPlayingModal │  │   QueuePanel     │
│              │  │                │  │                   │
│ ├─AlbumArt   │  │ ├─ AlbumArt   │  │ ├─ drag-reorder  │
│ ├─ProgressBar│  │ ├─ ProgressBar│  │ ├─ AlbumArt      │
│ └─VolumeCtrl │  │ └─ VolumeCtrl │  │ └─ BottomSheet   │
└──────────────┘  └────────────────┘  └──────────────────┘
```

## 5. Data Flow: Song to Playback

```
data/{slug}/songs.json                    data/{slug}/metadata/
       │                                         │
       ▼                                         ▼
 /api/{slug}/songs ─────────────────── /api/{slug}/metadata
       │                                         │
       └──────────┬──────────────────────────────┘
                  │  fetch() on mount
                  ▼
         ┌────────────────┐
         │  page.tsx       │
         │  merge songs +  │
         │  albumArtMap    │
         └───────┬────────┘
                 │
      ┌──────────┼──────────────┐
      ▼          ▼              ▼
 ┌─────────┐ ┌──────────┐ ┌──────────────────┐
 │SongCard │ │TimelineRow│ │AddToPlaylist     │
 │         │ │          │ │  Dropdown        │
 └────┬────┘ └────┬─────┘ └──────────────────┘
      │           │
      │  onClick: playTrack(track)
      ▼           ▼
 ┌─────────────────────┐
 │   PlayerContext      │
 │   loadVideoById()    │──────▶ YouTube <iframe>
 │   seekTo(timestamp)  │       (hidden, plays audio)
 └─────────────────────┘
```

## 6. Multi-Streamer Isolation

```
┌─────────────────────────────────────────────────────────────┐
│                        GLOBAL STATE                          │
│                 (shared across all streamers)                │
│                                                              │
│   PlayerContext ─── currentTrack, queue, volume, playback   │
│   PlaylistContext ─ playlists (keyed by streamer in storage)│
│   FanAuthContext ── placeholder                              │
│                                                              │
│   localStorage:                                              │
│     prism_volume, prism_muted                                │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────┐  ┌─────────────────────────┐
│   /mizuki               │  │   /gabu                  │
│                          │  │                          │
│ StreamerShell            │  │ StreamerShell            │
│ ├─ theme: pink/blue      │  │ ├─ theme: blue/yellow    │
│ ├─ CSS vars on <body>    │  │ ├─ CSS vars on <body>    │
│ │                        │  │ │                        │
│ │ PerStreamerProviders    │  │ │ PerStreamerProviders    │
│ │ ├─ LikedSongsProvider  │  │ │ ├─ LikedSongsProvider  │
│ │ └─ RecentlyPlayed...   │  │ │ └─ RecentlyPlayed...   │
│ │                        │  │ │                        │
│ │ localStorage:          │  │ │ localStorage:          │
│ │  prism_mizuki_playlists│  │ │  prism_gabu_playlists  │
│ │  prism_mizuki_liked    │  │ │  prism_gabu_liked      │
│ │  prism_mizuki_recent   │  │ │  prism_gabu_recent     │
│ └────────────────────────┘  │ └────────────────────────┘
└─────────────────────────┘  └─────────────────────────┘
```

## 7. Theme System Flow

```
data/registry.json
│
│  theme: {
│    accentPrimary: "#e91e8c",
│    bgPageStart: "#0a0012", ...
│  }
│
▼
StreamerShell.tsx
│
│  themeToCSS(theme) → {
│    "--accent-pink": "#e91e8c",
│    "--bg-page-start": "#0a0012", ...
│  }
│
│  useEffect → document.body.style.setProperty(...)
│
▼
globals.css (default vars)          tailwind.config.ts
│                                    │
│  :root {                           │  colors: {
│    --accent-pink: #e91e8c;         │    'accent-pink': 'var(--accent-pink)',
│    --bg-page-start: ...            │    'surface-default': 'var(--surface-default)',
│    ...53 custom properties         │    ...
│  }                                 │  }
│                                    │
▼                                    ▼
Components use Tailwind classes:  bg-accent-pink, text-token-primary, etc.
│
▼
Fixed-position elements (MiniPlayer, modals)
inherit vars from document.body
```

## 8. External Systems

```
                    ┌──────────────────────┐
                    │   GitHub Actions     │
                    │   (deploy.yml)       │
                    │   push to master     │
                    │   → npm run build    │
                    │   → deploy out/      │
                    └─────────┬────────────┘
                              │
              ┌───────────────┼────────────────┐
              ▼               ▼                ▼
      ┌──────────────┐ ┌────────────┐ ┌──────────────────┐
      │ GitHub Pages │ │ Cloudflare │ │  YouTube API     │
      │ (main site)  │ │  Workers   │ │  IFrame Player   │
      │              │ │            │ │                   │
      │ prism.oshi.tw│ │ ├─ Admin   │ │  Embedded player │
      └──────────────┘ │ ├─ Nova    │ │  Video timestamps│
                        │ ├─ Crystal │ │  Playback control│
                        │ └─ Aurora  │ └──────────────────┘
                        │ (Pages)   │
                        └─────┬─────┘  ┌──────────────────┐
                              │        │  iTunes API      │
                              ▼        │  Album art       │
                        ┌──────────┐   │  Track duration  │
                        │ D1 DBs   │   │  Artist metadata │
                        │ (source  │   └──────────────────┘
                        │  of truth│
                        │  for data│
                        └──────────┘
```

## Key Design Decisions

- **Fully static site** — no server at runtime. API routes are pre-rendered JSON served from GitHub Pages via Next.js `output: "export"` + `force-static`.
- **Theme isolation** — CSS vars set on `document.body` (not a wrapper div) so portal-rendered elements like MiniPlayer and modals inherit the streamer's colors.
- **Two-stage data pipeline** — Cloudflare D1 → sync tools → static JSON → build → GitHub Pages. The admin dashboard (Cloudflare Workers) is the write path; the fan site is read-only.
- **Per-streamer localStorage** — playlists, likes, and history are namespaced by streamer slug. Volume/mute are global.

## 9. Tooling & Infrastructure Relationships

### Tool Inventory

| Path | Type | Purpose |
|------|------|---------|
| `tools/nova/` | Cloudflare Worker (Hono) | Streamer signup & VOD submission forms |
| `tools/crystal/` | Cloudflare Worker (Hono) | Fan feedback & Q&A forms |
| `tools/aurora/` | Vite + React app (CF Pages) | Interactive VOD timestamp editor |
| `tools/sync-registry/` | CLI script (tsx) | Nova DB → `data/registry.json` |
| `tools/sync-data/` | CLI script (tsx) | Admin DB → `data/{slug}/songs.json` & `streams.json` |
| `admin/` | Cloudflare Worker + React UI | Curator dashboard (review, approve, export) |
| `tools/prismlens/` | Python CLI + Flask/Textual | YouTube scraper (legacy data pipeline) |
| `scripts/eximport-all.sh` | Shell script | Batch runner for prismlens eximport |

### Three D1 Databases

```
┌──────────────────────────────────────────────────────────────────────┐
│                       Cloudflare D1 Databases                        │
│                                                                      │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐     │
│  │ oshi-prism-nova  │  │  oshi-prism-db   │  │  oshi-crystal   │     │
│  │                  │  │                  │  │                  │     │
│  │ • submissions    │  │ • songs          │  │ • tickets        │     │
│  │   (streamers)    │  │ • performances   │  │   (feedback)     │     │
│  │ • vod_submissions│  │ • streams        │  │ • replies        │     │
│  │   (songs/VODs)   │  │   (staging area) │  │   (Q&A)         │     │
│  └────────┬─────────┘  └────────┬─────────┘  └────────┬────────┘     │
│           │                     │                      │              │
│   WRITES  │             WRITES  │              WRITES  │              │
│  ┌────────┘     ┌───────────────┘      ┌───────────────┘              │
│  │              │                      │                              │
│  ▼              ▼                      ▼                              │
│  Nova Worker    Admin Worker           Crystal Worker                 │
│                                                                      │
│   READS                READS                    READS                 │
│  ┌─ Admin ◀─── all three databases ───▶ Admin ──┘                    │
│  ├─ sync-registry (reads oshi-prism-nova)                            │
│  └─ sync-data     (reads oshi-prism-db)                              │
└──────────────────────────────────────────────────────────────────────┘
```

### Full Data Pipeline

```
                       PUBLIC INPUT
   ┌─────────────────────────────────────────────────┐
   │                                                   │
   │  Fan submits          Fan submits    Fan submits  │
   │  streamer signup      VOD timestamps  feedback    │
   │        │                    │             │        │
   │        ▼                    ▼             ▼        │
   │  ┌──────────┐       ┌───────────┐  ┌──────────┐  │
   │  │   Nova   │       │  Aurora   │  │ Crystal  │  │
   │  │  Worker  │◀──────│  (Pages)  │  │  Worker  │  │
   │  │          │ CORS   │ timestamp │  │          │  │
   │  └────┬─────┘       │  editor   │  └────┬─────┘  │
   │       │              └──────────┘        │        │
   └───────┼──────────────────────────────────┼────────┘
           │                                   │
           ▼                                   ▼
   ┌──────────────┐                    ┌──────────────┐
   │oshi-prism-nova│                   │oshi-crystal   │
   └──────┬───────┘                    └──────┬───────┘
          │                                    │
          └──────────────┬─────────────────────┘
                         │
                    CURATOR REVIEW
   ┌─────────────────────┼──────────────────────────┐
   │                     ▼                           │
   │              ┌─────────────┐                    │
   │              │   Admin     │                    │
   │              │  Dashboard  │                    │
   │              │             │                    │
   │              │ • Approve / reject submissions   │
   │              │ • Import & edit performances     │
   │              │ • Reply to feedback tickets      │
   │              │ • YouTube pipeline (discover,    │
   │              │   extract timestamps, parse)     │
   │              └──────┬──────┘                    │
   │                     │ writes                    │
   │                     ▼                           │
   │              ┌──────────────┐                   │
   │              │oshi-prism-db │                   │
   │              │  (staging)   │                   │
   │              └──────┬───────┘                   │
   └─────────────────────┼──────────────────────────┘
                         │
                    SYNC TO STATIC
   ┌─────────────────────┼──────────────────────────┐
   │                     │                           │
   │  ┌─────────────────┐│┌────────────────────┐    │
   │  │ sync-registry   │││  sync-data          │    │
   │  │                 │││                     │    │
   │  │ Nova DB         │││  Admin DB           │    │
   │  │   ↓             │││    ↓                │    │
   │  │ registry.json   │││  songs.json         │    │
   │  │ streamer-slugs  │││  streams.json       │    │
   │  │ data/{slug}/    │││  (per streamer)     │    │
   │  └─────────────────┘│└────────────────────┘    │
   │                     │                           │
   └─────────────────────┼──────────────────────────┘
                         │
                     BUILD & DEPLOY
   ┌─────────────────────┼──────────────────────────┐
   │                     ▼                           │
   │          git push to master                     │
   │                     │                           │
   │          GitHub Actions (deploy.yml)            │
   │          Node 22 → npm ci → npm run build       │
   │                     │                           │
   │                     ▼                           │
   │              ┌──────────────┐                   │
   │              │ GitHub Pages │                   │
   │              │ prism.oshi.tw│                   │
   │              └──────────────┘                   │
   └─────────────────────────────────────────────────┘
```

### Cross-Service Communication

```
┌──────────────────────────────────────────────────────────────┐
│                                                                │
│   Aurora (aurora.oshi.tw)                                      │
│     │                                                          │
│     │  CORS fetch (streamer list, VOD submission)              │
│     │  https://nova.oshi.tw/vod/api/*                          │
│     ▼                                                          │
│   Nova (nova.oshi.tw)                                          │
│     │  Access-Control-Allow-Origin:                            │
│     │    https://aurora.oshi.tw                                 │
│     │    https://oshi-prism-aurora.pages.dev                   │
│     │                                                          │
│   Admin (admin.oshi.tw)                                        │
│     │  Reads all 3 D1 databases via worker bindings:           │
│     │    DB         → oshi-prism-db     (song staging)         │
│     │    NOVA_DB    → oshi-prism-nova   (submissions)          │
│     │    CRYSTAL_DB → oshi-crystal      (feedback)             │
│     │                                                          │
│   Sync scripts (local CLI)                                     │
│     │  Direct D1 access via wrangler:                          │
│     │    sync-registry → reads oshi-prism-nova                 │
│     │    sync-data     → reads oshi-prism-db                   │
│                                                                │
└──────────────────────────────────────────────────────────────┘
```

### Deployment Map

```
┌────────────────────┬──────────────────┬──────────────────────┐
│  Service           │  Target          │  How                 │
├────────────────────┼──────────────────┼──────────────────────┤
│  Fan site          │  GitHub Pages    │  AUTO: push master   │
│  (Next.js)         │  prism.oshi.tw   │  → GitHub Actions    │
├────────────────────┼──────────────────┼──────────────────────┤
│  Nova              │  CF Worker       │  MANUAL:             │
│  (tools/nova/)     │  nova.oshi.tw    │  /deploy-nova        │
├────────────────────┼──────────────────┼──────────────────────┤
│  Crystal           │  CF Worker       │  MANUAL:             │
│  (tools/crystal/)  │  crystal.oshi.tw │  /deploy-crystal     │
├────────────────────┼──────────────────┼──────────────────────┤
│  Admin             │  CF Worker       │  MANUAL:             │
│  (admin/)          │  admin.oshi.tw   │  /deploy-admin       │
├────────────────────┼──────────────────┼──────────────────────┤
│  Aurora            │  CF Pages        │  MANUAL:             │
│  (tools/aurora/)   │  aurora.oshi.tw  │  /deploy-aurora      │
│                    │                  │  (--branch main)     │
└────────────────────┴──────────────────┴──────────────────────┘
```
