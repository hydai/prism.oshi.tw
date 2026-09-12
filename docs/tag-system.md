# Tag system

Tags are stable string IDs stored on the shared work (`works.tags`) and exported
onto every linked song as `tags: string[]`. The dictionary lives in `lib/tags.ts`:

| 類別 | ID | 顯示名稱 |
|---|---|---|
| 語言 | `language:zh` / `ja` / `en` / `ko` | 中文歌／日文歌／英文歌／韓文歌 |
| 來源 | `source:vocaloid` / `anime` / `game` / `original` | Vocaloid／動畫歌／遊戲歌／原創曲 |

Language means the composition's original language; a cover sung in another
language is normally a separate work whose title says so. `source:original`
means the original artist is one of this site's VTubers. An untagged field means
unknown — nothing is inferred at display time.

The fan site filters with OR inside a category and AND across categories, on
top of search, artist, year and stream. The chip rows (desktop sidebar, mobile
search tab) only appear once a streamer has at least one tagged song.

## Curating in Admin

1. **Global Song Library** → *Edit tags* on a row replaces that work's tags. The save
   is refused if the work changed at all (tags, title, artist or a merge) since you
   opened the editor; the page says so and reloads, then edit again.
2. Tick rows and use the batch bar to add or remove tags on up to 100 works at
   once. The delta is computed from the rows as read when you submit; a work another
   curator changed in between — including one whose delta looked like a no-op — is
   skipped (never overwritten) and reported; reload and apply again for those.
3. *未標語言* + sort by performances finds the most-played works without a
   language. Tag at least two works per frequent original artist with the same
   language: the fill propagates only from two or more agreeing works (L3's 2 / 75%
   rule), so a single seed does nothing.
4. Editing a work's tags invalidates any in-flight Harmonizer merge preview of
   that work (the merge guard's intent) and marks every linked streamer stale
   for `sync:status` / `sync:stale`.

Song-level tag inputs no longer exist; `songs.tags` is a retired column that
always holds `[]`. Retitling a song (title or original artist) that lands on a
brand-new work identity carries the previous work's tags over, so fixing a typo
keeps its language and sources; if you re-identify a song as a *different*
composition, check the new work's tags afterwards — `source:original` in
particular no longer applies once the original artist is not one of this site's
VTubers.

## Filling empty tags

```bash
npm run tags:fill              # preview: reads the admin D1, prints the plan
npm run tags:fill -- --details # preview plus one line per work: id, title, stored tags, additions (rule)
npm run tags:fill -- --apply   # writes the plan
```

Rules, in order, only for fields that are empty on the work:

| # | Fills | Rule |
|---|---|---|
| L1 | language | title script after dropping bracketed segments: Hangul→ko, kana→ja, bopomofo→zh, Han plus a Chinese-only character→zh |
| L2 | language | original artist contains Hangul→ko or kana→ja |
| L3 | language | same original artist (exact string) already has a language on ≥2 works at ≥75% agreement; `Unknown`/`不明`/`不詳`/`未知`/`佚名` or an empty artist never propagate |
| S1 | `source:vocaloid` | CJK voice-synth names (初音ミク／初音未來, 鏡音リン／レン, 巡音ルカ, 洛天依, 重音テト, 音街ウナ, 結月ゆかり, ボカロ) in the title or the artist; Latin names (`vocaloid`, `gumi`, `kaito`, `meiko`, `flower`, `ia`, whole words only) and `可不` in the artist only |
| S2 | `source:original` | artist equals a registry `displayName` or `slug` after normalization (NFKC, lowercase, letters and digits only); normalized keys shorter than 3 characters never match |

The command never removes or replaces a tag, so it can be re-run any time, and
a run over already-filled data writes nothing. Each `UPDATE` is guarded by the tag
value that was read, so a work a curator edits between the read and the write is
skipped rather than overwritten; the apply report names such works and they simply
reappear in the next preview. Anime and game are curator-only.

## Rollout of a fresh environment

1. Record a Time Travel bookmark, apply `admin/migrations/0010_fan_export_works_update.sql` (requires 0009, which production already has; SQLite accepts a trigger against a missing table, so a wrong order would only surface as a 500 on the first tag write).
2. Deploy the admin worker (`/deploy-admin`).
3. `npm run tags:fill`, review, then `npm run tags:fill -- --apply`.
4. Tag two works per frequent artist (same language) in the Global Library, run the fill again.
5. `/sync-stale`, commit, push.

The site can be deployed at any point: without tag data the chip rows are hidden.
