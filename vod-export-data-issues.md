# VOD Export Data Issues

- Audit time: 2026-07-10T15:22:49Z
- Resolution verified: 2026-07-11T14:59:19Z
- Status: Resolved — canonical Admin D1 and generated JSON agree
- Source of truth checked: remote `oshi-prism-db` D1
- Cross-check: regenerated `data/{mizuki,sakuro,seki}/songs.json`
- Scope: VOD, performance, and song are all `approved` and belong to the same
  streamer, matching confirmed export rule D-005.1

## Resolution verification

The original 19 blocking findings are resolved:

- 14 missing end times were filled with verified values.
- `p621-1` and its song `song-621` were intentionally deleted because the
  performance should not have existed.
- All four invalid ranges were corrected.
- The verification query at the end of this document now returns zero rows.
- A full scan of all 8,533 approved performances found zero missing, invalid,
  or non-increasing start/end values.
- `npm run sync:status` reports all streamer snapshots fresh after syncing
  `mizuki`, `sakuro`, and `seki`.

| Issue | Performance ID | Resolution | Final range |
|---|---|---|---:|
| END-MISSING-001 | `p612-1` | End time filled | 292–556 |
| END-MISSING-002 | `p613-1` | End time filled | 781–1024 |
| END-MISSING-003 | `p614-1` | End time filled | 1035–1231 |
| END-MISSING-004 | `p615-1` | End time filled | 1583–1811 |
| END-MISSING-005 | `p616-1` | End time filled | 2103–2241 |
| END-MISSING-006 | `p617-1` | End time filled; title corrected to `だんだん高くなる` | 2280–2422 |
| END-MISSING-007 | `p618-1` | End time filled | 2759–2992 |
| END-MISSING-008 | `p619-1` | End time filled | 3210–3415 |
| END-MISSING-009 | `p620-1` | End time filled | 3587–3837 |
| END-MISSING-010 | `p621-1` | Intentionally deleted with `song-621` | — |
| END-MISSING-011 | `p622-1` | End time filled | 4159–4335 |
| END-MISSING-012 | `p623-1` | End time filled | 4543–4805 |
| END-MISSING-013 | `p624-1` | End time filled | 5119–5372 |
| END-MISSING-014 | `p625-1` | End time filled | 5576–5899 |
| END-MISSING-015 | `p626-1` | End time filled; title corrected to `8月31日` | 6139–6350 |
| END-RANGE-001 | `p-7e622f16` | End time corrected | 5417–5573 |
| END-RANGE-002 | `p-0ef60c63` | End time corrected | 6423–6637 |
| END-RANGE-003 | `p-b14e136c` | End time corrected | 13370–13609 |
| END-RANGE-004 | `p-a90fe217` | Start and end times corrected | 7002–7114 |

The non-blocking missing-artist scan decreased from 144 songs / 148
performances to 143 / 147 after removing song-621 and p621-1. Class A/B
filled 53 songs covering 54 performances. The non-song VOD 9aGua1HjH14 was
removed with 21 songs and 21 performances. Interactive C/D review filled 67 additional songs and deleted song-454 and
song-1495. The final blank song-2580 was then filled with originalArtist =
Jingle Bells, so the current backlog is zero.

## Completed remediation procedure

`vod-export-spec.md` received final approval on 2026-07-11. These rows are now
repaired in the canonical Admin D1. Generated files under `data/` were updated
through the normal sync workflow rather than hand-edited.

Completed steps:

1. Verified each timestamp against the source YouTube VOD.
2. Corrected the canonical Admin D1 records through the approved Admin workflow.
3. Re-ran the audit query in this document and received zero rows.
4. Ran the normal data sync so generated JSON was regenerated from D1.
5. Confirmed D1 and generated JSON agree before marking the issues resolved.

## Original issue summary

| Category | Original count | Admin finding code | Resolution |
|---|---:|---|---|
| Missing end time (`end_timestamp IS NULL`) | 15 | `MISSING_END_SECONDS` | 14 repaired; 1 invalid source row intentionally deleted |
| Invalid range (`end_timestamp <= timestamp`) | 4 | `INVALID_END_RANGE` | All repaired |
| Total affected performances | 19 | — | Resolved; no longer blocks publication |

The original separate non-blocking data-quality scan found 144 canonical song
rows with an empty `originalArtist`, affecting 148 performances. They produce
song-level `MISSING_ORIGINAL_ARTIST` warnings and were not part of the 19
blocking end-time rows counted above. After the intentional deletion, the
counts were 143 song rows and 147 performances. After the approved class A/B
repair, the counts were 90 song rows and 93 performances. After deleting the
non-song VOD `9aGua1HjH14`, the counts were 70 song rows and 73
performances. After finalizing song-2580, the current missing-artist counts
are zero songs and zero performances.

At audit time, no `end_timestamp = timestamp` row was found; all four invalid
ranges had an end value strictly earlier than their start value.

## Original missing end-time findings

This section preserves the pre-remediation values. Revised D-008.1 requires a
non-null integer `endSeconds` greater than `startSeconds`; the final values are
recorded in the resolution table above.

All 15 rows belong to the same VOD:

- Streamer: `mizuki`
- Stream ID: `stream-2022-01-01`
- Date: `2022-01-01`
- Video ID: `owFUTmhXWCI`
- VOD: [【歌枠】2022初歌回！充滿浠望的出發吧！【浠Mizuki Karaoke】](https://www.youtube.com/watch?v=owFUTmhXWCI)

| Issue | Performance ID | Song ID | Song at audit time | Original artist | Start | Review |
|---|---|---|---|---|---:|---|
| END-MISSING-001 | `p612-1` | `song-612` | 快晴 | Orangestar | 292 (`0:04:52`) | [YouTube](https://www.youtube.com/watch?v=owFUTmhXWCI&t=292s) |
| END-MISSING-002 | `p613-1` | `song-613` | Jump Up Super Star! | Super Mario Odyssey | 781 (`0:13:01`) | [YouTube](https://www.youtube.com/watch?v=owFUTmhXWCI&t=781s) |
| END-MISSING-003 | `p614-1` | `song-614` | Bang Bang | Jessie J-Ariana Grande-Nicki Minaj | 1035 (`0:17:15`) | [YouTube](https://www.youtube.com/watch?v=owFUTmhXWCI&t=1035s) |
| END-MISSING-004 | `p615-1` | `song-615` | 夕景イエスタデイ | じん(自然の敵P) | 1583 (`0:26:23`) | [YouTube](https://www.youtube.com/watch?v=owFUTmhXWCI&t=1583s) |
| END-MISSING-005 | `p616-1` | `song-616` | だんだん早くなる | 40mP | 2103 (`0:35:03`) | [YouTube](https://www.youtube.com/watch?v=owFUTmhXWCI&t=2103s) |
| END-MISSING-006 | `p617-1` | `song-617` | だんだん早くなる | 40mP | 2280 (`0:38:00`) | [YouTube](https://www.youtube.com/watch?v=owFUTmhXWCI&t=2280s) |
| END-MISSING-007 | `p618-1` | `song-618` | ねこみみスイッチ | daniwell | 2759 (`0:45:59`) | [YouTube](https://www.youtube.com/watch?v=owFUTmhXWCI&t=2759s) |
| END-MISSING-008 | `p619-1` | `song-619` | C大調 | 張韶涵 | 3210 (`0:53:30`) | [YouTube](https://www.youtube.com/watch?v=owFUTmhXWCI&t=3210s) |
| END-MISSING-009 | `p620-1` | `song-620` | 彩虹 | 張惠妹 | 3587 (`0:59:47`) | [YouTube](https://www.youtube.com/watch?v=owFUTmhXWCI&t=3587s) |
| END-MISSING-010 | `p621-1` | `song-621` | 0x.The Coconut Song | *(empty)* | 4054 (`1:07:34`) | [YouTube](https://www.youtube.com/watch?v=owFUTmhXWCI&t=4054s) |
| END-MISSING-011 | `p622-1` | `song-622` | 野子 | 蘇運瑩 | 4159 (`1:09:19`) | [YouTube](https://www.youtube.com/watch?v=owFUTmhXWCI&t=4159s) |
| END-MISSING-012 | `p623-1` | `song-623` | 倔強 | 五月天 | 4543 (`1:15:43`) | [YouTube](https://www.youtube.com/watch?v=owFUTmhXWCI&t=4543s) |
| END-MISSING-013 | `p624-1` | `song-624` | 明日も | MUSH&Co. | 5119 (`1:25:19`) | [YouTube](https://www.youtube.com/watch?v=owFUTmhXWCI&t=5119s) |
| END-MISSING-014 | `p625-1` | `song-625` | 瞬き | back number | 5576 (`1:32:56`) | [YouTube](https://www.youtube.com/watch?v=owFUTmhXWCI&t=5576s) |
| END-MISSING-015 | `p626-1` | `song-626` | 14.8月31日 | DECO*27 | 6139 (`1:42:19`) | [YouTube](https://www.youtube.com/watch?v=owFUTmhXWCI&t=6139s) |

Resolution note: `p621-1` had an empty `originalArtist`, but review determined
that the performance itself should not have existed. It and `song-621` were
therefore intentionally deleted instead of exported with a null artist.

## Original invalid end ranges

### END-RANGE-001

- Streamer: `sakuro`
- Performance ID: `p-7e622f16`
- Song ID: `song-8b36cb5f`
- Song: Stay — Zedd, Alessia Cara
- VOD: [【英文歌回】I Sing You Sing【朔Sakuro】](https://www.youtube.com/watch?v=2wxID-o2_kU&t=5417s)
- VOD date / video ID: `2026-03-08` / `2wxID-o2_kU`
- Start: 5417 (`1:30:17`)
- End: 4560 (`1:16:00`)
- Invalid difference: `-857` seconds
- Original generated source: `data/sakuro/songs.json` (pre-remediation snapshot)

### END-RANGE-002

- Streamer: `seki`
- Performance ID: `p-0ef60c63`
- Song ID: `song-bde2a9ee`
- Song: blue — yung kai
- VOD: [【歌回】最後一次的普通歌回因為下週有酷企劃｜汐Seki](https://www.youtube.com/watch?v=6jHTZ9c_4g8&t=6423s)
- VOD date / video ID: `2025-03-16` / `6jHTZ9c_4g8`
- Start: 6423 (`1:47:03`)
- End: 6175 (`1:42:55`)
- Invalid difference: `-248` seconds
- Original generated source: `data/seki/songs.json` (pre-remediation snapshot)

### END-RANGE-003

- Streamer: `seki`
- Performance ID: `p-b14e136c`
- Song ID: `song-f4330e8b`
- Song: 直到我遇見了你 — 李友廷 (Yo Lee)
- VOD: [【歌回】今天唱你們想聽的歌🎵｜汐Seki](https://www.youtube.com/watch?v=zp4g7JwgFSo&t=13370s)
- VOD date / video ID: `2025-03-09` / `zp4g7JwgFSo`
- Start: 13370 (`3:42:50`)
- End: 10010 (`2:46:50`)
- Invalid difference: `-3360` seconds
- Original generated source: `data/seki/songs.json` (pre-remediation snapshot)

### END-RANGE-004

- Streamer: `seki`
- Performance ID: `p-a90fe217`
- Song ID: `song-2585fa0b`
- Song: 誰 — 廖俊濤
- VOD: [【歌回】穿上美美的新衣唱歌給你聽💜｜汐Seki](https://www.youtube.com/watch?v=mebw4ey9G50&t=7249s)
- VOD date / video ID: `2024-11-03` / `mebw4ey9G50`
- Start: 7249 (`2:00:49`)
- End: 7120 (`1:58:40`)
- Invalid difference: `-129` seconds
- Original generated source: `data/seki/songs.json` (pre-remediation snapshot)

## Verification query

The remote D1 audit and post-remediation verification used this read-only
query. The verification run returned zero rows:

```sql
SELECT
  p.streamer_id,
  p.id AS performance_id,
  p.song_id,
  s.title AS song_title,
  s.original_artist,
  p.stream_id,
  st.title AS vod_title,
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
  AND (p.end_timestamp IS NULL OR p.end_timestamp <= p.timestamp)
ORDER BY
  CASE WHEN p.end_timestamp IS NULL THEN 0 ELSE 1 END,
  p.streamer_id,
  st.date DESC,
  p.timestamp,
  p.id;
```
