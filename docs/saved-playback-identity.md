# Saved playback identity

Playlists, liked songs and recent plays persist a *performance*: one sung
version of one song in one stream. This page is the contract for what that
record means, what may change underneath it, and how the fan site shows it.

## Identity rules

| Field | Role | Rule |
| --- | --- | --- |
| `performanceId` | identity | the only key for dedupe, lookup, removal, `isLiked` and queue equality |
| `songId` | advisory | the song id the UI held when saving — in the grouped view the work group's canonical member, on pre-2026-08-29 entries a placeholder equal to `performanceId`; never a lookup key |
| `workId` | advisory | composition identity; absent on entries saved before it was stored; never a lookup key |
| `songTitle`, `originalArtist` | snapshot | display fallback |
| `videoId`, `timestamp`, `endTimestamp` | snapshot | playback fallback |
| `streamerSlug` | scope | defaults to the store's slug when absent |

The in-memory type is `PerformanceRef` (`app/types/archive.ts`); every
persisted record uses the same field names, so there is no on-disk migration.

## Storage

| Where | Key / shape |
| --- | --- |
| liked songs | `prism_{slug}_liked_songs`: `Array<PerformanceRef & { likedAt: number }>` |
| recent plays | `prism_{slug}_recently_played`: `Array<PerformanceRef & { playedAt: number }>` (newest first, 50 max) |
| playlists | `prism_{slug}_playlists`: `Playlist[]` (`app/lib/playlist-envelope.ts`) |
| export file | `PlaylistExportEnvelope` — `version: 2`, `source: 'Prism'`; v1 files (`source: 'MizukiPrism'`, entries without `streamerSlug`) still import as mizuki |

Formats are **additive**. A new optional field (like `workId`) does not bump
the envelope version; a bump is only for a change in what an existing field
means. Readers (`normalizeStoredRef`, `validateImport`, `parsePlaylists`)
accept records that lack `songId`, `workId`, `streamerSlug` or `endTimestamp`.
Writers (`pickPerformanceRef`) omit `workId` when the ref has none, so a
re-saved legacy entry never gains a `workId` key (it does gain the defaulted
`songId`, `streamerSlug` and `endTimestamp`, as before). Nothing is written
back to storage by reconciliation; an entry is refreshed on disk only when the
user re-saves it.

## Resolution (`app/lib/saved-refs.ts`)

`ArchiveDataProvider` builds `performanceIndex` (performanceId → owning song +
performance) once the catalog is `ready`; until then it is `null`. Each panel
resolves its stored list through `resolveSavedRefs`:

| Status | When | Shown | Playable |
| --- | --- | --- | --- |
| `live` | the loaded catalog has the performance | catalog title, artist, video, timestamps | yes |
| `missing` | the catalog is loaded and lacks it | the snapshot + 「此版本已無法播放」; play / add-to-queue disabled; play-all skips it (`Track.deleted`) | no |
| `unknown` | catalog still loading or failed | the snapshot, no marker | yes (snapshot) |

The `now-playing` page renders the same two panels but has no catalog; it
passes `performanceIndex={null}` explicitly, so its entries show as `unknown`.

Queue entries carry `deleted` from the panel that enqueued them; `QueuePanel`
and `UpNextSection` render the same marker and the player's advance logic
skips them. `unavailableVideoIds` (YouTube error 100/101/150) is a separate
axis: a video that will not embed is not a missing performance.

## What curators may change

Safe for saved items (they resolve to the new values): renaming a song,
merging songs in the Harmonizer (performance ids are preserved), fixing a
timestamp, replacing a re-uploaded VOD's `videoId`. What marks an item
missing: deleting the performance, or un-approving its song/stream so it
leaves the export — the fan site cannot tell those apart, both show the marker
until the performance is back.

## Constraint for Stage 2 sharding (#60)

`performanceIndex` must stay `null` until *every* performance shard has
loaded; an index built from a partial catalog would mark unloaded years as
missing.

## Tests

- `app/lib/saved-refs.test.ts` — statuses, projection, `workId` never acting as identity, `playableQueue`
- `app/lib/normalize-performance-ref.test.ts`, `app/lib/archive.test.ts` — legacy shapes, `workId` carried only when present
- `app/lib/playlist-envelope.test.ts` — v1/v2 import, rejections, export shape
- `app/lib/playlist-storage.test.ts` — dedupe by `performanceId`
- `app/components/playlist-details-view.test.tsx` — marker only for `missing`
- `tests/saved-items-identity.spec.ts` — legacy storage against a fixture catalog; failed load marks nothing
