# Floating Playback Pill (Admin / StreamDetail)

Date: 2026-06-12
Status: Approved

## Problem

In the admin StreamDetail page, the YouTube player and the current
playback time readout live at the top of a normally-flowing page.
Scrolling down the performances table scrolls them out of view, so
while stamping you cannot see the current playback time — making it
hard to compare against Nova-submitted timestamps.

StampEditor does not have this problem: its root is `h-full` with an
internally scrolling table, so the player and time stay pinned.

## Decision

Add a floating pill, fixed to the bottom-right corner of the
viewport, that appears only when the player is scrolled out of view.

Content (top to bottom):

1. `▶ 1:23:45` — current playback time, monospace, prominent
2. Selected song title (when a row is selected)
3. `start 1:21:03 → end 1:25:40` — the selected row's stamps; end
   shows `—` when not yet marked

Clicking the pill scrolls back to the player (`scrollIntoView`).

## Architecture

- New presentational component
  `admin/ui/src/components/FloatingPlaybackPill.tsx`
  - Props: `currentTime: number`,
    `perf: { title, timestamp, endTimestamp } | null`,
    `onClick: () => void`
  - Styling: `fixed bottom-4 right-4 z-30`, white card, shadow
- StreamDetail integration:
  - `playerBoxRef` on the player wrapper div
  - `IntersectionObserver` (viewport root) toggles a
    `playerVisible` state
  - Pill renders only when `!playerVisible`
  - Data reuses the existing 500 ms `currentTime` polling and
    `detail.performances[selectedIndex]` — no new polling, no new API

## Edge cases

- No row selected → pill shows the time line only
- Modals (`z-40`) cover the pill (`z-30`) — intended
- Toast is bottom-center `z-50` — no spatial overlap
- StampEditor: not included; its player never scrolls out of view

## Verification

The admin UI has no test harness (no test script, no vitest).
Verification is `tsc -b && vite build` passing plus a manual scroll
smoke test after deployment.
