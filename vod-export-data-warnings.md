# VOD Export Data Warnings

- Initial audit time: 2026-07-11T15:08:27Z
- Refreshed after A/B repair: 2026-07-11T16:13:23.181Z
- Refreshed after VOD deletion: 2026-07-11T17:32:53.828Z
- Refreshed after final C/D review: 2026-07-11T17:57:15.885Z
- Refreshed after Jingle Bells update: 2026-07-11T18:05:09.020Z
- Status: Resolved — MISSING_ORIGINAL_ARTIST is zero
- Finding code: `MISSING_ORIGINAL_ARTIST`
- Source of truth: remote `oshi-prism-db` D1, scoped by approved and enabled
  streamers from remote `oshi-prism-nova`
- Scope: streamer is approved and enabled; VOD, song, and performance are all
  `approved` and belong to the same streamer

## Summary

| Streamer | Songs to repair | Affected performances | Affected VODs |
|---|---:|---:|---:|
| `mizuki` | 0 | 0 | 0 |

All other 35 approved and enabled streamers currently have zero
`MISSING_ORIGINAL_ARTIST` warnings.

The initial audit contained 143 songs affecting 147 performances. Class A/B
filled 53 songs covering 54 performances. The non-song VOD 9aGua1HjH14 was
removed with 21 songs and 21 performances; 20 were warning rows. The
interactive C/D review then filled 67 additional songs and deleted song-454
and song-1495.

The final blank song, song-2580 (Jingle Bells), was updated with
originalArtist = Jingle Bells. The current warning count is zero.

MISSING_ORIGINAL_ARTIST is fully resolved for the approved export scope; no
approved occurrence emits originalArtist: null.

## Repair workflow

1. Open the song through its Admin link.
2. Use the embedded performances and linked VOD timestamps to verify the
   canonical original artist.
3. Select **Edit**, fill **Original artist**, and save.
4. Do not enter placeholders such as `Unknown` or guess a value. If the song or
   performance should not exist, remove it through the normal Admin workflow.

After a repair pass, regenerate the VOD Export preview. Completion means
`MISSING_ORIGINAL_ARTIST` is zero; if generated site data also needs the
correction, run the normal stale-data sync afterward.

## Mizuki

| Song ID / Admin | Song title | Affected performances / evidence |
|---|---|---|

## Verification query

After the approved-and-enabled streamer scope was established from Nova, the
current Mizuki rows were collected with this read-only Admin D1 query. Do not
reuse this query alone as a complete cross-database exporter audit: the VOD
Export preview remains authoritative because it selects streamers from Nova
and applies the full Unicode normalization rules from the specification. The
report groups these occurrence rows by song and natural-sorts the displayed
song IDs; the SQL ordering below is only the raw query order.

```sql
SELECT
  p.streamer_id,
  s.id AS song_id,
  s.title AS song_title,
  p.id AS performance_id,
  p.stream_id,
  st.date AS vod_date,
  st.video_id,
  p.timestamp AS start_seconds,
  p.end_timestamp AS end_seconds
FROM performances p
JOIN songs s
  ON s.id = p.song_id
 AND s.streamer_id = p.streamer_id
JOIN streams st
  ON st.id = p.stream_id
 AND st.streamer_id = p.streamer_id
WHERE p.status = 'approved'
  AND s.status = 'approved'
  AND st.status = 'approved'
  AND p.streamer_id = 'mizuki'
  AND trim(coalesce(s.original_artist, '')) = ''
ORDER BY p.streamer_id, s.id, st.date, p.timestamp, p.id;
```
