# Design: `fetch-channel-info` command

**Date:** 2026-05-26
**Status:** Approved

> Terminology: the repo calls these `.claude/commands/*.md` entries **commands**; the
> requester referred to this one as a "skill." This document uses **command** throughout.

## Purpose

Refresh every approved streamer's YouTube subscriber count and avatar from the agent —
producing the same result as the admin "Fetch All Channel Info" button — without opening
the admin UI.

## Users

The **curator/maintainer** (sole operator of this archive), running the agent locally,
already authenticated to Cloudflare via `wrangler login`.

## Reference: the existing button

`POST /api/nova/submissions/fetch-all-subscribers` (`requireCurator`) selects approved
submissions that have a channel ID, fetches each channel's statistics + avatar from
YouTube, formats the count into 萬 notation, and updates the row. Hidden or missing
channels are recorded as failures and skipped. It returns `{ updated, failed, results[] }`.

## Constraints (any valid solution must satisfy these)

1. **Cloudflare Access guards the deployed endpoint.** It trusts the
   `CF-Access-Authenticated-User-Email` header, injected only after a browser login, so the
   agent cannot call the production endpoint directly.
2. **The YouTube API key exists only as a deployed Worker secret** — not in
   `admin/.dev.vars` — so any local execution must obtain the key explicitly.
3. **Established pattern.** Sibling commands (`sync:registry`, `sync:data`) are thin
   `.claude/commands/*.md` files backed by `tools/*/*.ts` scripts that reach production data
   via `wrangler d1 execute oshi-prism-nova --remote`.

## Behavior (target state)

The command runs a one-shot local script that mirrors the button. (A local script was
chosen over driving the deployed worker via `wrangler dev --remote` or a Cloudflare Access
service token; the comparison lives in the design discussion / commit history.)

| State / Operation | Result |
|---|---|
| `wrangler` not authenticated | Stop; instruct the operator to run `npx wrangler login`. |
| `YOUTUBE_API_KEY` absent from `admin/.dev.vars` | Stop; instruct the operator to add it. |
| No approved streamers with a channel ID | Report "nothing to fetch"; exit success. |
| Channel hidden or not found | Record a per-streamer failure; leave that row unchanged; continue. |
| YouTube fetch error (including quota / HTTP 429) | Record a per-streamer failure; continue. Quota exhaustion is not special-cased and early-abort is not a goal. |
| Channel resolved | Update that streamer's subscriber count (萬 notation) and avatar. |

On completion the command prints a summary shaped like `BulkFetchSubscribersResponse`:
`updated`, `failed`, and one line per streamer (slug + new count, or the failure reason),
so the operator can confirm it matches the admin UI.

The count formatting reuses the worker's `formatSubscriberCount`, relocated to
`admin/shared/format.ts` so the worker and the command share one definition. The YouTube
fetch reuses the worker's exported `fetchChannelInfo`.

## Contracts

- **Input:** none — the command takes no arguments and always targets all approved streamers.
- **YouTube key:** read from `admin/.dev.vars` (gitignored).
- **Data source/sink:** production D1 `oshi-prism-nova`, via the operator's `wrangler` login.
- **Write contract:** only resolved channels are written; failed rows keep their previous
  values. A failure during the write step is reported with a non-zero exit and an error
  message — the command never reports success on an unwritten or partially-written result.
  Values written to D1 are escaped so that arbitrary channel or display strings cannot break
  or inject SQL.
- **Output:** a human-readable summary matching `BulkFetchSubscribersResponse`
  (`admin/shared/types.ts`).

## Components

| File | Change | Role |
|------|--------|------|
| `admin/shared/format.ts` | new | `formatSubscriberCount` (萬 notation), shared by worker + command. |
| `admin/src/index.ts` | edit | Import `formatSubscriberCount` from `../shared/format`; remove the local copy (behavior unchanged). |
| `tools/fetch-channel-info/fetch.ts` | new | The one-shot script. |
| `tools/fetch-channel-info/fetch.test.ts` | new | Unit tests for the pure helpers. |
| `package.json` | edit | Add `"fetch:channel-info"` script. |
| `.claude/commands/fetch-channel-info.md` | new | Slash-command wrapper, `sync-registry.md` style. |

Editing `admin/src/index.ts` is a Worker code change and **must** be followed by a
`/deploy-admin` deployment before it takes effect; the refactor is behavior-preserving.

## Testing

- **Unit** (`fetch.test.ts`, run via `npx tsx`, matching the repo's `test:*` scripts):
  `.dev.vars` parsing, the value-escaping used for writes, and summary formatting. These are
  pure functions — no network or D1.
- **End-to-end (manual):** run `npm run fetch:channel-info` once and confirm the printed
  counts match the admin UI button.

## Non-goals

- Per-streamer or subset targeting (the command mirrors the button: all approved streamers).
- Dry-run mode.
- Any change to the admin UI or the existing endpoint.

## Build mechanics (deferred to the implementation plan)

Exact `wrangler` invocations, the query and update SQL, the batching/temp-file write
strategy, and filesystem details are decided in the `writing-plans` step, not here.
