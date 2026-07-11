# VOD Export Data Issues

- Audit time: 2026-07-10T15:22:49Z
- Status: Ready for remediation — specification approved; no source rows changed
- Source of truth checked: remote `oshi-prism-db` D1
- Cross-check: committed `data/{slug}/songs.json`
- Scope: VOD, performance, and song are all `approved` and belong to the same
  streamer, matching confirmed export rule D-005.1

## Remediation prerequisites

`vod-export-spec.md` received final approval on 2026-07-11. These rows are now
eligible for a separate remediation pass, but no repair is part of this
documentation change. Do not hand-edit generated files under `data/`.

When remediation is authorized:

1. Verify each timestamp against the source YouTube VOD.
2. Correct the canonical Admin D1 record through the approved admin workflow.
3. Re-run the audit query in this document.
4. Run the normal data sync so committed JSON is regenerated from D1.
5. Mark each issue resolved only after both D1 and generated JSON agree.

## Summary

| Category | Count | Admin finding code | Export consequence if unresolved |
|---|---:|---|---|
| Missing end time (`end_timestamp IS NULL`) | 15 | `MISSING_END_SECONDS` | Invalid under revised D-008.1; repair before first publication |
| Invalid range (`end_timestamp <= timestamp`) | 4 | `INVALID_END_RANGE` | Rejected by the confirmed `endSeconds > startSeconds` invariant |
| Total affected performances | 19 | — | Blocks complete publication under D-010.1; ready for remediation |

Separate non-blocking data-quality scan: 144 canonical song rows have an empty
`originalArtist`, affecting 148 performances. They produce song-level
`MISSING_ORIGINAL_ARTIST` warnings; they are not part of the 19 blocking
end-time rows counted above.

No `end_timestamp = timestamp` row was found; all four invalid ranges have an
end value strictly earlier than their start value.

## Missing end times

Revised D-008.1 requires a non-null integer `endSeconds` greater than
`startSeconds`. All rows in this section are therefore invalid for export and
must be repaired before the first publication.

All 15 rows belong to the same VOD:

- Streamer: `mizuki`
- Stream ID: `stream-2022-01-01`
- Date: `2022-01-01`
- Video ID: `owFUTmhXWCI`
- VOD: [【歌枠】2022初歌回！充滿浠望的出發吧！【浠Mizuki Karaoke】](https://www.youtube.com/watch?v=owFUTmhXWCI)

| Issue | Performance ID | Song ID | Song | Original artist | Start | Review | Committed source |
|---|---|---|---|---|---:|---|---|
| END-MISSING-001 | `p612-1` | `song-612` | 快晴 | Orangestar | 292 (`0:04:52`) | [YouTube](https://www.youtube.com/watch?v=owFUTmhXWCI&t=292s) | [mizuki songs:67361](data/mizuki/songs.json#L67361) |
| END-MISSING-002 | `p613-1` | `song-613` | Jump Up Super Star! | Super Mario Odyssey | 781 (`0:13:01`) | [YouTube](https://www.youtube.com/watch?v=owFUTmhXWCI&t=781s) | [mizuki songs:67399](data/mizuki/songs.json#L67399) |
| END-MISSING-003 | `p614-1` | `song-614` | Bang Bang | Jessie J-Ariana Grande-Nicki Minaj | 1035 (`0:17:15`) | [YouTube](https://www.youtube.com/watch?v=owFUTmhXWCI&t=1035s) | [mizuki songs:67417](data/mizuki/songs.json#L67417) |
| END-MISSING-004 | `p615-1` | `song-615` | 夕景イエスタデイ | じん(自然の敵P) | 1583 (`0:26:23`) | [YouTube](https://www.youtube.com/watch?v=owFUTmhXWCI&t=1583s) | [mizuki songs:67455](data/mizuki/songs.json#L67455) |
| END-MISSING-005 | `p616-1` | `song-616` | だんだん早くなる | 40mP | 2103 (`0:35:03`) | [YouTube](https://www.youtube.com/watch?v=owFUTmhXWCI&t=2103s) | [mizuki songs:67473](data/mizuki/songs.json#L67473) |
| END-MISSING-006 | `p617-1` | `song-617` | だんだん早くなる | 40mP | 2280 (`0:38:00`) | [YouTube](https://www.youtube.com/watch?v=owFUTmhXWCI&t=2280s) | [mizuki songs:67491](data/mizuki/songs.json#L67491) |
| END-MISSING-007 | `p618-1` | `song-618` | ねこみみスイッチ | daniwell | 2759 (`0:45:59`) | [YouTube](https://www.youtube.com/watch?v=owFUTmhXWCI&t=2759s) | [mizuki songs:67509](data/mizuki/songs.json#L67509) |
| END-MISSING-008 | `p619-1` | `song-619` | C大調 | 張韶涵 | 3210 (`0:53:30`) | [YouTube](https://www.youtube.com/watch?v=owFUTmhXWCI&t=3210s) | [mizuki songs:67527](data/mizuki/songs.json#L67527) |
| END-MISSING-009 | `p620-1` | `song-620` | 彩虹 | 張惠妹 | 3587 (`0:59:47`) | [YouTube](https://www.youtube.com/watch?v=owFUTmhXWCI&t=3587s) | [mizuki songs:67591](data/mizuki/songs.json#L67591) |
| END-MISSING-010 | `p621-1` | `song-621` | 0x.The Coconut Song | *(empty)* | 4054 (`1:07:34`) | [YouTube](https://www.youtube.com/watch?v=owFUTmhXWCI&t=4054s) | [mizuki songs:67619](data/mizuki/songs.json#L67619) |
| END-MISSING-011 | `p622-1` | `song-622` | 野子 | 蘇運瑩 | 4159 (`1:09:19`) | [YouTube](https://www.youtube.com/watch?v=owFUTmhXWCI&t=4159s) | [mizuki songs:67637](data/mizuki/songs.json#L67637) |
| END-MISSING-012 | `p623-1` | `song-623` | 倔強 | 五月天 | 4543 (`1:15:43`) | [YouTube](https://www.youtube.com/watch?v=owFUTmhXWCI&t=4543s) | [mizuki songs:67665](data/mizuki/songs.json#L67665) |
| END-MISSING-013 | `p624-1` | `song-624` | 明日も | MUSH&Co. | 5119 (`1:25:19`) | [YouTube](https://www.youtube.com/watch?v=owFUTmhXWCI&t=5119s) | [mizuki songs:67683](data/mizuki/songs.json#L67683) |
| END-MISSING-014 | `p625-1` | `song-625` | 瞬き | back number | 5576 (`1:32:56`) | [YouTube](https://www.youtube.com/watch?v=owFUTmhXWCI&t=5576s) | [mizuki songs:67721](data/mizuki/songs.json#L67721) |
| END-MISSING-015 | `p626-1` | `song-626` | 14.8月31日 | DECO*27 | 6139 (`1:42:19`) | [YouTube](https://www.youtube.com/watch?v=owFUTmhXWCI&t=6139s) | [mizuki songs:67749](data/mizuki/songs.json#L67749) |

Additional observation: `p621-1` is one of the 148 affected performances with
an empty `originalArtist`. That is not counted as an end-time issue. D-008.7
represents it as `"originalArtist": null` in an export, and D-010.4 emits the
non-blocking Admin warning `MISSING_ORIGINAL_ARTIST` while this source-data gap
remains in the later remediation queue.

## Invalid end ranges

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
- Committed source: [sakuro songs:1215](data/sakuro/songs.json#L1215)

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
- Committed source: [seki songs:19285](data/seki/songs.json#L19285)

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
- Committed source: [seki songs:25045](data/seki/songs.json#L25045)

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
- Committed source: [seki songs:3895](data/seki/songs.json#L3895)

## Reproduction query

The remote D1 audit used this read-only query:

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
