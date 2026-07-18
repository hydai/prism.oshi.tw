# Prism Admin UI Specification

> Comprehensive reference for discussing the admin dashboard redesign with designers.
> Generated from the current codebase as of 2026-07-18.

---

## Table of Contents

1. [Global Layout & Shell](#1-global-layout--shell)
2. [Authentication & Roles](#2-authentication--roles)
3. [Design Tokens & Shared Components](#3-design-tokens--shared-components)
4. [Dashboard](#4-dashboard--page)
5. [Songs List](#5-songs-list-songs-page)
6. [Song Detail](#6-song-detail-songsid-page)
7. [Streams List](#7-streams-list-streams-page)
8. [Stream Detail](#8-stream-detail-streamsid-page)
9. [Submit Song](#9-submit-song-submitsong-page)
10. [Submit Stream](#10-submit-stream-submitstream-page)
11. [Stamp Editor](#11-stamp-editor-stamp-page)
12. [Pipeline](#12-pipeline-pipeline-page)
13. [Harmonizer](#13-harmonizer-harmonizer-page)
14. [Nova Submissions](#14-nova-submissions-nova-page)
15. [Nova VOD Submissions](#15-nova-vod-submissions-novavods-page)
16. [Crystal Tickets](#16-crystal-tickets-crystal-page)
17. [Navigation Flow & Page Relationships](#17-navigation-flow--page-relationships)
18. [Global Song Library](#18-global-song-library-works-page)

---

## 1. Global Layout & Shell

### Structure

```
┌─────────────────────────────────────────────────────────┐
│ ┌──────────┐ ┌──────────────────────────────────────────┐│
│ │          │ │                                          ││
│ │ Sidebar  │ │           Main Content Area              ││
│ │ (w-60)   │ │           (flex-1, scrollable)           ││
│ │          │ │           bg-slate-50, p-6               ││
│ │          │ │                                          ││
│ └──────────┘ └──────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
```

- **Full viewport height** (`h-screen`), no outer scrollbar
- **Sidebar**: fixed 240px width (`w-60`), dark background (`bg-slate-900`), white text
- **Main content**: fills remaining width, independently scrollable, light gray bg (`bg-slate-50`) with 24px padding

### Sidebar Sections (top to bottom)

#### 1.1 Header
- **Title**: "Prism" — `text-lg font-bold tracking-tight`, white
- **Subtitle**: "Admin" — `text-sm text-slate--400`
- Separated from below by `border-b border-slate-700`

#### 1.2 Streamer Selector
- Label: "STREAMER" — `text-xs uppercase tracking-wider text-slate--500`
- **Dropdown** (`<select>`): full width, dark bg (`bg-slate-800`), rounded, shows streamer `displayName`
- Changing the streamer navigates to `/` (Dashboard) and reloads data globally
- Value persisted in `localStorage` under key `prism_admin_streamer`
- Options populated from `GET /api/streamers` (approved streamers only)

#### 1.3 Navigation Links
Links in a vertical list, each styled as:
- Rounded pill (`rounded-md px-3 py-2 text-sm font-medium`)
- **Active**: `bg-slate-700 text-white`
- **Inactive**: `text-slate-300 hover:bg-slate-800 hover:text-white`

Navigation items in order:
| Label | Route |
|-------|-------|
| Dashboard | `/` |
| Songs | `/songs` |
| Global Library (curator-only) | `/works` |
| Streams | `/streams` |
| Submit Song | `/submit/song` |
| Submit Stream | `/submit/stream` |
| Stamp Editor | `/stamp` |
| Pipeline | `/pipeline` |
| Harmonizer | `/harmonizer` |
| Nova | `/nova` |
| Nova VODs | `/nova/vods` |
| Crystal | `/crystal` |

#### 1.4 User Info (bottom)
- **Email**: truncated, `text-sm text-slate-300`
- **Role**: `text-xs capitalize text-slate-500` (shows "curator" or "contributor")
- Separated from above by `border-t border-slate-700`

---

## 2. Authentication & Roles

### Auth Flow
- On app load, `GET /api/me` is called to verify authentication
- **Loading state**: centered "Loading..." in viewport
- **Auth failure**: centered error message with title "Authentication Required"
- Production: reads `CF-Access-Authenticated-User-Email` header (Cloudflare Access)
- Local dev: falls back to `DEV_AUTH_EMAIL` env var

### Two Roles

| Role | Access |
|------|--------|
| **Curator** | Full access: approve/reject/edit all items, bulk operations, export, pipeline, harmonizer, Nova, Crystal |
| **Contributor** | Limited: submit songs/streams, edit own pending items only |

### Role-Based UI Differences
- **Actions column** in tables: only visible to curators
- **Approve/Reject buttons**: curator-only
- **Edit button** on Song Detail: curator-only (contributors cannot see it)
- **Pipeline, Harmonizer, Nova, Crystal pages**: all API calls are curator-only, though the nav links remain visible
- **Global Library**: route, navigation item, and API are curator-only

---

## 3. Design Tokens & Shared Components

### Color Palette (Tailwind classes used)

| Purpose | Colors |
|---------|--------|
| Page background | `bg-slate-50` |
| Sidebar | `bg-slate-900` |
| Cards/tables | `bg-white`, `border-slate-200` |
| Primary action | `bg-blue-600 hover:bg-blue-700` |
| Success/Approve | `bg-green-600 hover:bg-green-700` |
| Danger/Reject | `bg-red-600 hover:bg-red-700` |
| Warning/Unapprove | `bg-yellow-500 hover:bg-yellow-600` |
| Neutral/Exclude | `bg-slate-500 hover:bg-slate-600` |
| Purple accent | `bg-purple-600 hover:bg-purple-700` (Crystal replies) |
| Indigo accent | `bg-indigo-600 hover:bg-indigo-700` (subscriber fetch) |

### StatusBadge Component

Pill-shaped badge (`rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize`):

| Status | Background | Text | Border | Extra |
|--------|-----------|------|--------|-------|
| pending | `bg-yellow-100` | `text-yellow-800` | `border-yellow-300` | — |
| approved | `bg-green-100` | `text-green-800` | `border-green-300` | — |
| rejected | `bg-red-100` | `text-red-800` | `border-red-300` | — |
| excluded | `bg-slate-100` | `text-slate-500` | `border-slate-300` | `line-through` |
| extracted | `bg-teal-100` | `text-teal-800` | `border-teal-300` | — |

### Toast Notifications

- Fixed position: `bottom-6 left-1/2 -translate-x-1/2`
- Z-index: `z-50`
- Background: `bg-slate-800` (success) or `bg-red-600` (error), both white text
- Auto-dismiss after **2 seconds**
- Rounded with shadow: `rounded-lg px-4 py-2 text-sm font-medium shadow-lg`

### Standard Table Pattern

All data tables follow a consistent structure:
- Container: `rounded-lg border border-slate-200 bg-white`, with `overflow-x-auto`
- Header row: `border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500`
- Body rows: `divide-y divide-slate-100`, `hover:bg-slate-50`
- Cell padding: `px-4 py-3`
- Sortable headers: `cursor-pointer select-none hover:text-slate-700`, show `↑`/`↓` indicator

### Standard Filter Bar Pattern

Horizontally stacked controls with `flex flex-wrap gap-3`:
- **Search**: text input + "Search" button (form submit on Enter)
- **Status dropdown**: `<select>` with "All statuses" + status options
- **Year filter** (Streams only): `<select>` populated from data

### Standard Action Buttons

- **Approve**: `rounded bg-green-600 px-2 py-1 text-xs text-white`
- **Reject**: `rounded bg-red-600 px-2 py-1 text-xs text-white`
- **Unapprove/Restore**: `rounded bg-yellow-500 px-2 py-1 text-xs text-white`
- **Exclude**: `rounded bg-slate-500 px-2 py-1 text-xs text-white`
- **Delete**: `rounded bg-red-800 px-2 py-1 text-xs text-white` (darker red for destructive)

### InlineEdit Component

Used in StreamDetail and StampEditor for editing text fields in-place:
- Replaces display text with a focused `<input>` (blue border: `border-blue-400`)
- **Enter**: commits the change
- **Escape**: cancels
- **Blur**: cancels (StreamDetail) or commits (varies)
- Auto-focuses and selects text on mount

### Modal Dialogs

- Backdrop: `fixed inset-0 z-40 bg-black/40`
- Content card: `rounded-lg bg-white shadow-xl`, centered in viewport
- Consistent button layout: Cancel (left, gray) + Action (right, primary blue)

---

## 4. Dashboard (`/` page)

### Purpose
Overview of data counts and recent activity for the selected streamer.

### Layout

```
┌──────────────────────────────────────────────┐
│ Dashboard                                      │
│                                                │
│ ┌──────────┐ ┌──────────┐ ┌──────────────────┐│
│ │  Songs   │ │ Streams  │ │  Performances    ││
│ │  Card    │ │  Card    │ │  Card            ││
│ └──────────┘ └──────────┘ └──────────────────┘│
│                                                │
│ Recent Submissions                             │
│ ┌──────────────────────────────────────────────┐│
│ │ Title | Type | Status | Submitted By | Date  ││
│ │ ...                                          ││
│ └──────────────────────────────────────────────┘│
└──────────────────────────────────────────────┘
```

### StatCard (×3, grid `sm:grid-cols-3 gap-4`)
Each card is `rounded-lg border border-slate-200 bg-white p-5 shadow-sm`:
- **Label**: `text-sm font-medium text-slate-500` (e.g., "Songs")
- **Total count**: `text-2xl font-bold text-slate-900` + "total" suffix in `text-sm text-slate-400`
- **Breakdown pills** (inline, `flex flex-wrap gap-2 text-xs`):
  - Pending: `bg-yellow-100 text-yellow-800`
  - Approved: `bg-green-100 text-green-800`
  - Rejected: `bg-red-100 text-red-800`
  - Extracted: `bg-teal-100 text-teal-800` (shown only if > 0)
  - Excluded: `bg-slate-100 text-slate-600` (shown only if > 0)

### Recent Submissions Table
Standard table with columns:
| Column | Content |
|--------|---------|
| Title | Song or stream title, `font-medium text-slate-800` |
| Type | "Song" or "Stream", `text-slate-500` |
| Status | StatusBadge component |
| Submitted By | Email or "—", `text-slate-500` |
| Date | ISO datetime string, `text-slate-500` |

- Empty state: "No recent submissions."
- Distinguishes type by checking if object has `originalArtist` property

---

## 5. Songs List (`/songs` page)

### Purpose
Browse, search, filter, sort, and manage all songs for the selected streamer.

### Header Row
- **Title**: "Songs" (`text-xl font-semibold`)
- **CTA button** (right-aligned): "+ Submit Song" → links to `/submit/song`
  - Style: `bg-blue-600 rounded-md px-4 py-2 text-sm font-medium text-white`

### Filter Bar
- **Search form**: text input with placeholder "Search by title or artist..." + "Search" button
  - Submits on Enter or button click; server-side search
- **Status dropdown**: All statuses / Pending / Approved / Rejected / Excluded / Extracted

### Data Table
| Column | Sortable | Content |
|--------|----------|---------|
| Title | Yes (`↑`/`↓`) | Link to `/songs/:id`, `text-blue-600 hover:underline font-medium` |
| Artist | Yes | `text-slate-600` |
| Status | Yes | StatusBadge |
| Tags | No | Comma-separated pills (`bg-slate-100 px-1.5 py-0.5 text-xs rounded`) or "—" |
| Created | Yes | ISO date, `text-slate-500` |
| Actions | No | **Curator-only column** |

### Actions (Curator only, shown when `status === 'pending'`)
- **Approve** (green button) + **Reject** (red button)

### Pagination
- 50 items per page
- Bottom bar: "Showing X–Y of Z" (left) + Previous/Next buttons with page indicator (right)
- Buttons: `border border-slate-300 rounded-md px-3 py-1.5`, disabled when at boundary

### Empty State
"No songs found." — centered in table, full colspan

---

## 6. Song Detail (`/songs/:id` page)

### Purpose
View and edit a single song's metadata, see all its performances with embedded YouTube players.

### Navigation
- **Back link**: "← Back to Songs" → `/songs` (`text-sm text-blue-600`)

### Song Info Card
White card (`rounded-lg border border-slate-200 bg-white p-6 shadow-sm`):

#### View Mode
- **Title**: `text-xl font-semibold text-slate-800`
- **Artist**: `text-slate-600`, below title
- **Tags**: horizontal pills (`bg-slate-100 px-2 py-0.5 text-xs text-slate-600 rounded`)
- **Status badge** + **Edit button** (curator-only): top-right corner

#### Edit Mode (curator only, toggled by Edit button)
Three stacked inputs:
1. **Title** — `text-lg font-semibold` styling on input
2. **Original artist** — placeholder "Original artist"
3. **Tags** — placeholder "Tags (comma-separated)", parsed on save

Buttons: **Save** (blue) + **Cancel** (gray slate)

#### Metadata Grid (2 columns, `grid grid-cols-2 gap-4`)
| Field | Content |
|-------|---------|
| Submitted by | Email or "—" |
| Reviewed by | Email or "—" |
| Created | ISO datetime |
| Updated | ISO datetime |

#### Curator Actions (shown when status is 'pending')
Below a separator: **Approve** (green, larger) + **Reject** (red, larger)
- Style: `px-4 py-2 text-sm font-medium`

### Performances Section
Below the song card, headed "Performances":
- Each performance is its own white card (`rounded-lg border border-slate-200 bg-white p-4 shadow-sm`)
- Shows:
  - **Stream title**: `font-medium text-slate-800`
  - **Date · timestamp range**: `text-sm text-slate-500` (e.g., "2024-12-25 · 5:30 – 9:15")
  - **Note** (if any): `text-sm text-slate-600`
  - **Status badge**: top-right of card
  - **Embedded YouTube player**: 16:9 aspect ratio, max width 512px, starts at song's timestamp

---

## 7. Streams List (`/streams` page)

### Purpose
Browse, search, filter, and manage all stream (VOD) entries.

### Header Row
- **Title**: "Streams" + count badge (`(N)` or `(filtered / total)`)
- **CTA**: "+ Submit Stream" → `/submit/stream`

### Filter Bar
- **Search form**: placeholder "Search by title..."
- **Status dropdown**: same 5 options as songs
- **Year dropdown** (conditional): only shown when multiple years exist in data; options derived from stream dates, newest first

### Data Table
| Column | Sortable | Content |
|--------|----------|---------|
| Title | Yes | Link to `/streams/:id`, blue underline |
| Date | Yes (default: desc) | `text-slate-600` |
| Video ID | No | External link to YouTube, `text-blue-600 hover:underline` |
| Status | Yes | StatusBadge |
| Submitted By | No | Email or "—" |
| Created | Yes | ISO date |
| Actions | No | **Curator-only column** |

### Actions (Curator only)
Context-dependent buttons per row:

| Current Status | Available Actions |
|----------------|-------------------|
| pending / extracted | **Approve** (green) + **Reject** (red) |
| approved | **Unapprove** (yellow) |
| Any except excluded | **Exclude** (slate) |
| excluded | **Restore** (blue) |

**Note**: Approving a stream also bulk-approves all its pending songs and performances (with a success alert showing counts).

### Sorting
- Client-side sorting after fetch (unlike Songs which uses server-side)
- Year filter is also client-side

---

## 8. Stream Detail (`/streams/:id` page)

### Purpose
Comprehensive view and editing interface for a single stream. Combines metadata editing, performance list management, YouTube playback, inline editing, and bulk operations. This is one of the most complex pages.

### Layout

```
┌─────────────────────────────────────────────────────┐
│ ← Back to Streams                                    │
│ [◀ Prev]                              [Next ▶]       │
│                                                       │
│ ┌───────────────────────┐ ┌─────────────────────────┐│
│ │ YouTube Player        │ │ Stream Info Card         ││
│ │ (16:9 aspect ratio)   │ │ Title (inline-editable) ││
│ │                       │ │ Date (inline-editable)  ││
│ │                       │ │ Video ID (link)         ││
│ │ Playback time: M:SS   │ │ Status badge            ││
│ │ [Set Start] [Set End] │ │ Credit info             ││
│ │ [◀ Seek] [Seek ▶]     │ │ Submitted/Reviewed by   ││
│ │ [◀ Prev] [Next ▶]     │ │ Action buttons          ││
│ └───────────────────────┘ └─────────────────────────┘│
│                                                       │
│ Toolbar: [+ Add Song] [Paste Import] [Copy VOD URL]  │
│          [Export Song List] [Approve All]              │
│          [Unapprove All] [Fetch All Durations]        │
│                                                       │
│ ┌───────────────────────────────────────────────────┐│
│ │ # │ Start │ End │ Title │ Artist │ Note │ Actions  ││
│ │ ▶ 1│ 0:30  │ 4:12│ Song..│ Artist│ ...  │ ⋯       ││
│ │   2│ 4:15  │ —   │ Song..│ Artist│ ...  │ ⋯       ││
│ └───────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────┘
```

### Stream Navigation
- **Prev/Next buttons**: navigate between streams (sorted by date desc)
- Shows stream title as button label

### YouTube Player
- Component: `<YouTubePlayer>` with imperative handle for `seekTo()` and `getCurrentTime()`
- Displays current playback time updated every 500ms
- **Stamp controls** (below player):
  - **Set Start**: captures current playback time → updates selected performance's `timestamp`
  - **Set End**: captures current playback time → updates selected performance's `endTimestamp`
  - **Seek to Start** / **Seek to End**: jumps player to the selected performance's timestamps
  - **Prev** / **Next**: selects the previous/next performance in the list

### Stream Info Card (right of player)
- **Title**: inline-editable (click to edit, curator only)
- **Date**: inline-editable (date picker, curator only)
- **Video ID**: external link to YouTube + "Copy VOD URL" action
- **Status**: StatusBadge + status action buttons
- **Credit info**: author name, author URL, comment URL (if set)
- **Submitted by** / **Reviewed by**: email labels

### Toolbar
Row of action buttons below the info section:

| Button | Style | Behavior |
|--------|-------|----------|
| + Add Song | Blue | Opens **Add Song Modal** |
| Paste Import | Blue outline | Opens **Paste Import Modal** |
| Copy VOD URL | Slate | Copies YouTube URL to clipboard |
| Export Song List | Slate | Copies formatted song list to clipboard |
| Approve All | Green, curator-only | Bulk-approves all pending performances + songs |
| Unapprove All | Yellow, curator-only | Reverts all approved back to pending |
| Fetch All Durations | Indigo, curator-only | Fetches end timestamps from iTunes for all songs |

### Performance Table
| Column | Content |
|--------|---------|
| # | Row number, selected row highlighted (`bg-blue-50`) |
| Start | Timestamp in `M:SS` or `H:MM:SS` format, monospace font, clickable (seeks player) |
| End | End timestamp or "—", with clear button (`×`) |
| Title | Inline-editable text (click to edit) |
| Artist | Inline-editable text (click to edit) |
| Note | Inline-editable text |
| Status | StatusBadge |
| Actions | Approve/Reject + Fetch Duration + Delete buttons |

- **Selected row**: highlighted with `bg-blue-50`, clicking a row selects it and seeks the player
- **Row highlight by playback**: current playing song highlighted based on `currentTime`
- **Currently playing indicator**: row whose timestamp range contains the current playback time gets visual emphasis

### Add Song Modal
- Title: "Add Song"
- Fields: Song title (required), Original artist (optional)
- Buttons: Cancel + Add
- On submit: creates a performance at timestamp 0 for the current stream

### Paste Import Modal
- Title: "Paste Import"
- Description: 'Paste a timestamp list (e.g. "5:30 Song Name - Artist")'
- **Textarea**: monospace, 10 rows, auto-focused
  - Placeholder shows example format
- **Replace checkbox** (shown when stream has existing performances):
  - "Replace existing performances (delete current songs first)"
- **Live preview table**: parsed songs shown below textarea as user types
  - Columns: #, Start, End, Title, Artist
  - Real-time parsing via `parseTextToSongs()` utility
- Buttons: Cancel + "Import N Songs" (disabled until valid parse)
- Max height: 85vh with internal scroll

---

## 9. Submit Song (`/submit/song` page)

### Purpose
Form to create a new song with optional inline performance entries.

### Layout
Centered form, max-width 672px (`max-w-2xl`).

### Form Fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Title | Text input | Yes | — |
| Original Artist | Text input | Yes | — |
| Tags | Text input | No | Placeholder: "Comma-separated, e.g. J-Pop, anime" |

### Inline Performances Section
Below a divider (`border-t`):
- Header: "Performances" + "+ Add Performance" link (`text-blue-600`)
- Each performance is a bordered card (`border border-slate-200 bg-slate-50 p-3 rounded-md`) with:
  - Header: "Performance #N" + "Remove" link (red)
  - **2-column grid** of fields:
    - Stream ID (text)
    - Stream title (text)
    - Video ID (text)
    - Date (date picker)
    - Start seconds (number, default "0")
    - End seconds (number, optional)
  - Note field (full-width text input)

### Buttons
- **Submit Song** (blue) + **Cancel** (gray, navigates to `/songs`)
- Shows "Submitting..." during API call

---

## 10. Submit Stream (`/submit/stream` page)

### Purpose
Form to create a new stream entry with YouTube URL auto-parsing and live preview.

### Layout
Centered form, max-width 672px.

### Form Fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Title | Text input | Yes | Placeholder: "e.g. 歌枠 2024-12-25" |
| Date | Date picker | Yes | — |
| YouTube URL | URL input | No | Auto-extracts Video ID on change |
| Video ID | Text input | Yes | Auto-filled from URL, or manual entry |

### Credit Section (optional, below divider)
- Header: "Credit (optional)"
- Fields: Credit author (text), Author URL (url), Comment URL (url)

### YouTube Preview
When Video ID is filled, shows:
- "Preview" heading
- Embedded YouTube iframe (16:9, max-width ~448px)

### Buttons
- **Submit Stream** (blue) + **Cancel** (gray, navigates to `/streams`)

---

## 11. Stamp Editor (`/stamp` page)

### Purpose
Dedicated workflow for efficiently stamping end timestamps on performances. Designed for batch processing — curator watches the YouTube stream and marks when each song ends.

### Layout

```
┌───────────────────────────────────────────────────────┐
│ Stamp Editor                                           │
│ Stats: 4200 total │ 3800 filled │ 400 remaining        │
│                                                         │
│ ┌─────────────────────┐  ┌────────────────────────────┐│
│ │ Stream List          │  │ YouTube Player             ││
│ │ (left panel)         │  │ + Performance Table        ││
│ │                      │  │ (right panel)              ││
│ │ Search + Year filter │  │                            ││
│ │ ┌──────────────────┐ │  │ Current time: M:SS         ││
│ │ │ Stream rows      │ │  │ [Set Start] [Set End]      ││
│ │ │ (click to select)│ │  │ [◀ Prev] [Next ▶]         ││
│ │ │ shows pending    │ │  │ [◀ Seek] [Seek ▶]         ││
│ │ │ count per stream │ │  │                            ││
│ │ └──────────────────┘ │  │ Toolbar:                   ││
│ └─────────────────────┘  │ [+Add] [Paste] [ApproveAll]││
│                           │ [UnapproveAll] [FetchAll]  ││
│                           │                            ││
│                           │ ┌────────────────────────┐ ││
│                           │ │ Performance rows       │ ││
│                           │ │ (selected = blue bg)   │ ││
│                           │ └────────────────────────┘ ││
│                           └────────────────────────────┘│
└───────────────────────────────────────────────────────┘
```

### Stats Bar
Three numbers displayed at top: Total performances, Filled (have end timestamp), Remaining.

### Stream List Panel (left)
- **Search**: text input to filter stream titles
- **Year filter**: dropdown populated from stream dates
- **Stream rows**: each shows:
  - Stream title (clickable)
  - Date
  - **Pending count badge** — number of performances still missing end timestamps
  - Selected stream highlighted with `bg-blue-50`

### YouTube Player + Controls (right)
Same YouTube player component as Stream Detail:
- Current playback time displayed, updates every 500ms
- **Set Start** / **Set End**: captures current time for selected performance
- **Seek to Start** / **Seek to End**: jumps to selected performance's timestamps
- **Prev** / **Next**: navigate through performances

### Toolbar (same pattern as Stream Detail)
- **+ Add Song** → Add Song Modal
- **Paste Import** → Paste Import Modal
- **Approve All** / **Unapprove All** (curator)
- **Fetch All Durations**: fetches end timestamps for all performances via iTunes API

### Performance Table
Simpler than Stream Detail — focused on stamping:

| Column | Content |
|--------|---------|
| # | Row number, selected row = `bg-blue-50` |
| Start | Timestamp, monospace, clickable to seek |
| End | End timestamp or "—" with clear button (×) |
| Title | Inline-editable |
| Artist | Inline-editable |
| Actions | Delete button |

### Key Workflow
1. Select a stream from the left panel
2. Performances load in the right panel, first one auto-selected
3. Player auto-seeks to the first performance's start
4. Curator plays the video, presses **Set End** when song finishes
5. Auto-advances to next unstamped performance
6. Stats update in real-time

### Keyboard Interaction
- Title/artist fields support **Enter** to commit edit, **Escape** to cancel

---

## 12. Pipeline (`/pipeline` page)

### Purpose
Automated workflow to discover karaoke streams from YouTube and extract song timestamps from video comments/descriptions.

### Tab Navigation
Two tabs at top (`border-b-2 border-blue-600` for active):
- **Discover** — find new YouTube videos
- **Extract** — pull timestamps from comments

---

### 12.1 Discover Tab

#### Action Buttons
- **Discover Streams** (blue): fetches karaoke videos from the streamer's YouTube channel
  - Shows "Discovering..." during API call
- **Import Selected (N)** (green): imports checked videos to the database
  - Shows "Importing..." during API call

#### Results Table
| Column | Content |
|--------|---------|
| Checkbox | Select/deselect for import. "Select all" in header. Only new streams are selectable. |
| Title | Video title |
| Date | Video publish date |
| Status | **NEW** badge (green pill) for undiscovered, or existing status (gray pill) |
| Video ID | External link to YouTube |

- New streams are auto-checked on discover
- Existing streams show their current status and cannot be selected
- Success message: "Imported N stream(s)"

---

### 12.2 Extract Tab

#### Two-Column Layout

**Left column** — Stream selector table (for pending streams):
| Column | Content |
|--------|---------|
| # | Row number |
| Date | Stream date |
| Title | Link to YouTube video |
| Action | **Extract** button per row |

- Selected/extracting stream highlighted with `bg-blue-50`

**Right column** — Candidates panel (320px fixed width):

When no extraction done:
- Dashed border placeholder: "Select a stream and click Extract"

After extraction:
- **Source indicator**: "Comment by [Author]" or "Video description" or "No timestamps found" (amber warning)
- **Candidate list**: each candidate comment shows:
  - Author name + stats (likes count, timestamp count)
  - **PIN** badge (amber pill) if comment is pinned
  - **Active** badge or **Use This** button
  - Comment text preview (truncated to 300 chars, in `<pre>`)

#### Parsed Songs Table (full width, below two columns)
When songs are parsed:
- Header: "Parsed Songs (N)" + **Import N Songs** button (green)
- Editable table:

| Column | Content |
|--------|---------|
| # | Row number |
| Start | Timestamp (read-only, monospace) |
| End | End timestamp or "—" (read-only) |
| Title | **Editable** text input |
| Artist | **Editable** text input |
| × | Remove button (red, removes song from list) |

- Songs can be edited before import
- If stream already has performances, import prompts for confirmation (409 conflict → "Replace?" dialog)

---

## 13. Harmonizer (`/harmonizer` page)

### Purpose
Detect and merge duplicate or similar song titles and artist names using exact or fuzzy matching.

### Tab Navigation
Two tabs: **Similar Songs** | **Similar Artists**

---

### 13.1 Similar Songs Tab

#### Controls Bar
- **Scan** button (blue): runs similarity detection
- **Mode dropdown**: Exact / Fuzzy
- **Threshold** input (only shown in Fuzzy mode): number 0.50–1.00, step 0.05, default 0.85
- **Stats**: "N group(s), M song(s) affected"
- Song merges are applied one reviewed group at a time; there is no bulk merge button

#### Similarity Groups
Each group is an expandable card (`rounded-lg border border-slate-200 bg-white`):

**Collapsed header** (clickable):
- Expand arrow (`▶` / `▼`)
- Normalized key text (the canonical form)
- Variant count: "N variants"
- Match type badge: **EXACT** (green pill) or **FUZZY** (yellow pill)

**Expanded body** — table:
| Column | Content |
|--------|---------|
| Use (radio) | Select canonical version — selected row gets `bg-blue-50` |
| Title | Canonical title shown in `text-blue-700 font-medium`; non-canonical shows ~~strikethrough~~ original + new blue text |
| Artist | Canonical artist stays unchanged; non-canonical differences preview the replacement |
| Status | StatusBadge |
| Perfs | Performance count (right-aligned) |

- **Merge into Selected Song** button (blue) at bottom right
- Confirmation shows the number of source song rows and performances
- Applying a group repoints every performance to the canonical song, records source rows in `song_aliases`, then removes only those source song rows; it never deletes performances

#### Auto-Selection Logic
Canonical is auto-selected as the song with:
1. Approved status (preferred over non-approved)
2. Highest performance count (tiebreaker)

---

### 13.2 Similar Artists Tab

Same layout pattern as Similar Songs, with differences:

#### Expanded Body
- **Canonical name** text input (editable, allows manual override)
- Table columns: Artist Name (clickable to set as canonical) | Songs count | Preview

#### Preview Column
- Matching canonical: shows "no change" in green
- Non-matching: shows ~~strikethrough~~ old name + blue new name

---

## 14. Nova Submissions (`/nova` page)

### Purpose
Manage VTuber streamer submissions from the public Nova submission form. Curators review, edit metadata, manage theme colors, and control which streamers appear on the fan site.

### Header
- Title: "Nova Submissions"
- Subtitle: "Review VTuber submissions from the public Nova form."

### Filter Bar
- **Status dropdown**: All / Pending (default) / Approved / Rejected
- **Fetch All Subscribers** button (indigo, curator-only): bulk-fetches YouTube subscriber counts for all approved streamers

### Bulk Fetch Result
Shown below filter bar after bulk fetch:
- Summary: "Updated N, Failed M"
- Expandable `<details>` with per-streamer results

### Submissions Table
| Column | Content |
|--------|---------|
| Display Name | Click to expand. Shows `▶`/`▼` indicator. `font-medium text-slate-800` |
| Slug | Monospace, `text-xs text-slate-600` |
| YouTube Channel | Link to channel URL, shows brand name if available |
| Subscribers | Count string (e.g., "21.8萬") or "—" |
| Status | StatusBadge (pending/approved/rejected) |
| Submitted | ISO date |
| Actions | Curator-only: Approve/Reject or Revert to Pending + Delete |

### Expanded Detail Row
Two-column layout (`grid md:grid-cols-2`):

**Left column — Submission Fields:**

**View mode** shows read-only fields:
- Avatar image (64×64 rounded circle)
- Brand Name, Group, Enabled (Yes/No), Display Order
- YouTube Channel URL (link), YouTube Channel ID
- Description
- Subscriber Count
- Social Links: horizontal badges (YouTube, Twitter, Facebook, Instagram, Twitch)
  - Active links: `bg-slate-200 text-slate-700` clickable badges
  - Missing: `bg-slate-100 text-slate-400 line-through`
- Theme Colors: row of 12 colored squares (5×5px), showing per-streamer theme
- Reviewed At, Reviewer Note

**Edit mode** (curator clicks "Edit" button):
All fields become editable inputs/textareas:
- 15 text fields (Display Name, Slug, Brand Name, Group, URLs, social links, etc.)
- **Subscriber Count** field has inline "Fetch" button (indigo) to pull from YouTube API
- **Enabled** checkbox + **Display Order** number input
- **Theme Colors**: 12 color pickers (`<input type="color">`) in a 2-column grid
  - Each shows: color swatch (28×28px) + key name + hex value
  - 12 tokens: `accentPrimary`, `accentPrimaryDark`, `accentPrimaryLight`, `accentSecondary`, `accentSecondaryLight`, `bgPageStart`, `bgPageMid`, `bgPageEnd`, `bgAccentPrimary`, `bgAccentPrimaryMuted`, `borderAccentPrimary`, `borderAccentSecondary`

Save/Cancel buttons at top of edit section.

**Right column** (curator only, pending status only, view mode):
- **Reviewer Note** textarea: optional note shown on reject

### Actions per Row
| Current Status | Buttons |
|----------------|---------|
| pending | Approve (green) + Reject (red) + Delete (dark red) |
| approved/rejected | Revert to Pending (amber) + Delete (dark red) |

---

## 15. Nova VOD Submissions (`/nova/vods` page)

### Purpose
Review VOD (karaoke stream) submissions from fans, including attached song timestamp lists.

### Header
- Title: "Nova VOD Submissions"
- Subtitle: "Review VOD submissions from fans."

### Filter Bar
- **Status dropdown**: All / Pending (default) / Approved / Rejected
- **Streamer dropdown**: All + dynamically populated streamer slugs from data

### VOD Table
| Column | Content |
|--------|---------|
| Streamer | Streamer slug with expand indicator (`▶`/`▼`) |
| Title | Stream title or "—" |
| Video ID | Monospace link to YouTube |
| Date | Date or **"No date"** in amber bold (highlights missing data) |
| Status | StatusBadge |
| Submitted | ISO date |
| Actions | Curator-only |

### Expanded Detail Row
Two-column layout:

**Left column:**
- **Thumbnail** (if available): `h-28 rounded-md border`
- Video URL (link)
- Stream Title, Stream Date (amber warning if missing)
- Submitter Note
- Reviewer Note, Reviewed At
- **Songs table** (if any):
  | # | Title | Artist | Start | End |
  |---|-------|--------|-------|-----|
  | Monospace timestamps, green for start, orange for end |
  - Empty state: "No song timestamps submitted."

**Right column** (curator only, pending status):
- Reviewer Note textarea

### Actions
Same pattern as Nova: Approve/Reject (pending) or Revert to Pending + Delete.

---

## 16. Crystal Tickets (`/crystal` page)

### Purpose
Manage public feedback tickets submitted via the Crystal widget. Supports categorized tickets (bug/feature/UI/other) with admin replies.

### Header
- Title: "Crystal Tickets" (`text-2xl font-bold`)

### Filter Controls
Two groups of **toggle buttons** (not dropdowns):

**Status group**: `All | Pending | Replied | Closed`
- Active: `bg-slate-800 text-white`
- Inactive: `bg-white text-slate-600 hover:bg-slate-100`

**Type group**: `All | Bug | Feature | UI | Other`
- Same toggle button style

### Type Badges
| Type | Color |
|------|-------|
| Bug | `bg-red-100 text-red-700` |
| Feature | `bg-purple-100 text-purple-700` |
| UI | `bg-blue-100 text-blue-700` |
| Other | `bg-slate-100 text-slate-700` |

### Status Badges
| Status | Color |
|--------|-------|
| Pending | `bg-yellow-100 text-yellow-700` |
| Replied | `bg-green-100 text-green-700` |
| Closed | `bg-slate-100 text-slate-500` |

### Ticket List
**Card-based layout** (not table), vertical stack with `space-y-2`:

Each ticket card (`rounded-lg border border-slate-200 bg-white`):

**Summary row** (clickable to expand):
- Type badge + Status badge
- **Public** badge (indigo, if `is_public_reply_allowed`)
- Ticket title (`flex-1 truncate text-sm font-medium`)
- Submitter info: "nickname · YYYY-MM-DD" (`text-xs text-slate-400`)
- Expand chevron (rotates on expand)

**Expanded detail:**
- **Metadata grid** (2 columns):
  - ID (monospace)
  - Contact info
  - Context URL (blue, full-width span if present)
- **Description**: `whitespace-pre-wrap text-sm text-slate-700`
- **Existing reply** (if any):
  - Purple left-border card (`border-l-4 border-purple-400 bg-purple-50`)
  - Shows reply date + reply text
- **Curator actions:**
  - **Reply textarea**: placeholder "Write a reply..." or "Update reply..."
  - **Send Reply** / **Update Reply** button (purple)
  - **Close** button (slate) — or **Reopen** button (yellow) if already closed

---

## 17. Navigation Flow & Page Relationships

```
Dashboard ─┐
            ├──→ Songs List ──→ Song Detail
            │      ↑ (submit)
            │      └── Submit Song
            │
            ├──→ Global Song Library (cross-streamer, curator-only)
            │
            ├──→ Streams List ──→ Stream Detail ──→ (same as Stamp Editor features)
            │      ↑ (submit)
            │      └── Submit Stream
            │
            ├──→ Stamp Editor (stream selection → performance stamping)
            │
            ├──→ Pipeline (Discover → Import → Extract → Import Songs)
            │
            ├──→ Harmonizer (Scan → Review → Apply)
            │
            ├──→ Nova Submissions (Review → Approve/Edit/Reject)
            │      └── Nova VODs (Review → Approve/Reject)
            │
            └──→ Crystal Tickets (Review → Reply → Close)
```

### Cross-Page Navigation
- Songs List → Song Detail (click song title)
- Song Detail → Songs List (back link)
- Streams List → Stream Detail (click stream title)
- Stream Detail → Streams List (back link)
- Stream Detail → Prev/Next Stream Detail (navigation buttons)
- Songs List → Submit Song (CTA button)
- Streams List → Submit Stream (CTA button)
- Submit Song → Songs List (after submit or cancel)
- Submit Stream → Streams List (after submit or cancel)

### Data Dependencies
- **Streamer selector** affects streamer-scoped pages; the Global Library is the deliberate site-wide exception
- **Songs** reference **Performances** which reference **Streams**
- Streamer-local **Songs** reference one global **Work**; the Global Library aggregates those links across every streamer and is not scoped by the streamer selector
- **Pipeline** creates Streams and Performances
- **Harmonizer** modifies Song titles and artist names
- **Nova Submissions** feeds the streamer selector dropdown
- **Crystal Tickets** are independent (separate database)

### Status Lifecycle

```
                  ┌──────────┐
                  │ pending  │ ← initial state for all submissions
                  └────┬─────┘
                       │
          ┌────────────┼──────────────┐
          ▼            ▼              ▼
    ┌──────────┐ ┌──────────┐  ┌───────────┐
    │ approved │ │ rejected │  │ extracted │ ← auto-extracted from YouTube
    └────┬─────┘ └────┬─────┘  └─────┬─────┘
         │            │              │
         │            ▼              │
         │      ┌──────────┐        │
         │      │ excluded │ ◄──────┘
         │      └──────────┘        │
         │                          │
         └──── can unapprove ───────┘
                 back to pending
```

---

## 18. Global Song Library (`/works` page)

### Purpose
Curator-only, cross-streamer view of the composition catalog. A work is the shared identity for exact `title + original artist` matches; local song rows keep each streamer's moderation state, tags, and performances.

### Scope and summary cards
- The request deliberately omits the selected-streamer parameter and aggregates the entire site.
- Five cards show: global works, works shared by multiple VTubers, linked local songs, linked performances, and unlinked local songs.
- A non-zero unlinked count is highlighted in amber as a rollout/integrity warning.

### Filters and table
- Search by global title or original artist.
- “Shared by multiple VTubers only” checkbox isolates likely cross-channel reuse.
- Server-side sorting and 50-row pagination.

| Column | Content |
|--------|---------|
| Title | Canonical work title plus global tag pills |
| Original artist | Canonical original-artist text |
| VTubers | Streamer slug pills for every linked local song |
| Local songs | Number of linked streamer-local song rows |
| Performances | Number of performances reachable through those songs |
| Work ID | Stable global identity exported to fan-site `songs.json` as `workId` |

The initial page is read-only. Global alias/merge controls can be layered on later without changing the existing song or performance IDs.
