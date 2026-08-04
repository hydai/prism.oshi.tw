# Tag system

Prism stores stable tag IDs at the scope where they are true. Composition metadata
lives in `works.tags`; rendition metadata lives in `performances.tags`.
`songs.tags` remains a read-only compatibility layer for older data that applies to
every performance linked to that local song. The fan-site exporter publishes both an
inherited layer and each concrete performance layer:

```text
works.tags (shared composition metadata)
  + legacy songs.tags (local metadata inherited by every performance)
  = song.inheritedTags

song.inheritedTags + performance.tags
  = tags used to filter that concrete performance

union of every effective performance
  = song.tags (card counts and backward compatibility)
```

Do not edit generated `data/*/songs.json` files to assign tags by hand. The initial
catalog is versioned in `data/tag-catalog.json`; `npm run tags:build` applies it to
the static song files and generates the matching D1 backfill migration. Later
curator changes still come from Admin D1 and are exported by `sync:data`.

## Initial catalog

The repository ships with conservative initial assignments so the filter is useful
as soon as this change is merged. Classification uses, in descending confidence:

1. explicit language and rendition annotations in the title;
2. language-specific writing systems;
3. a reviewed frequent-artist language table and cross-song artist signals;
4. dominant genres returned for the same frequent artist by Apple's public iTunes
   Search API snapshot;
5. explicit voice-synth names, reviewed Vocaloid producers, and streamer/artist
   identity matches.

Ambiguous songs remain untagged. In particular, mood, anime, and game source tags
are not guessed from an artist's general catalog. The generated catalog retains an
evidence string for every assignment, and `tools/tag-catalog/apple-artist-metadata.json`
retains the external lookup results used by the classifier.

Run these checks after changing a rule or reviewed artist:

```bash
npm run tags:build
npm run test:tag-catalog
```

`tags:build` removes the previous generated assignment before applying its
replacement, while preserving tags that are not owned by the catalog. CI runs
`tags:check` to catch stale generated files.

## Taxonomy

The controlled catalog lives in `lib/tags.ts`. A stored ID such as
`language:zh` is stable; its label (`中文歌`) and search aliases may change without
rewriting D1 rows.

Categories use faceted matching on the fan site:

- tags selected inside one category are OR conditions;
- selections from different categories are AND conditions;
- tag conditions are ANDed with search, artist, year, and stream filters.

Language describes the language actually sung in that rendition, not the origin
country of the composition. Genre, source, and composition-level mood belong on a
global work; language and rendition-style tags belong on a concrete performance.
The API rejects controlled IDs written at the wrong scope.

## Curator workflow

1. Use **Global Song Library** to edit tags shared by every linked VTuber song.
2. Select up to 100 works on the current page to add or remove tags in bulk.
3. Use **Untagged only** to work through the initial catalog backlog.
4. Use a song's detail page to edit each performance's language and rendition style.
5. Run `npm run sync:stale` (or `npm run sync:data -- <slug>`) and commit the
   regenerated static data.

Changing a global work advances `works.updated_at`. Freshness detection includes
that timestamp, so every affected streamer is marked stale and receives the new
effective tags on the next sync.

## Initial rollout

The static song files already contain the initial effective tags. Before running a
future D1-to-static sync, apply the generated additive migration so D1 becomes
consistent with those files:

```bash
cd admin
npx wrangler@latest d1 time-travel info oshi-prism-db
npx wrangler@latest d1 execute oshi-prism-db --remote \
  --file=migrations/0007_add_performance_tags.sql
npx wrangler@latest d1 execute oshi-prism-db --remote \
  --file=migrations/0008_seed_initial_tags.sql
```

Migration 0007 adds the storage column and moves any controlled language/style IDs
already present on songs or works down to their linked performances. Migration 0008
preserves existing curator tags, de-duplicates generated tags, and is safe to retry.
Apply them in order. As with every production D1 change, record the Time Travel
bookmark first. Deploying the Worker and applying migrations are separate operator
actions; merging the PR does not mutate production D1.

## Scope

Work tags apply to every linked rendition. Performance tags apply only to the
specific recording, so a bilingual, parody, acoustic, duet, or a-cappella rendition
does not change the metadata of another performance of the same song.
