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

Do not edit generated `data/*/songs.json` files to assign tags by hand. D1 is the
authoritative source after the initial rollout, and `sync:data` exports curator
changes to the static files. The versioned `data/tag-catalog.json` and migration
0008 are frozen records of the one-time seed; catalog tooling never overlays those
assignments onto a D1 export.

## Initial catalog

The repository ships conservative initial assignments in `data/tag-catalog.json`,
rendered into migration 0008. They are a seed for D1, not static site data: the
assignments reach the fan site only after the migrations are applied and `sync:data`
regenerates the streamer files (see [Initial rollout](#initial-rollout)).
Classification uses, in descending confidence:

1. explicit language and rendition annotations in the title;
2. language-specific writing systems;
3. a reviewed frequent-artist language table and cross-song artist signals;
4. dominant genres returned for an identity-verified frequent artist by Apple's
   public iTunes Search API snapshot; localized names use reviewed Apple artist IDs;
5. explicit voice-synth names, reviewed Vocaloid producers, and streamer/artist
   identity matches.

Ambiguous songs remain untagged. In particular, mood, anime, and game source tags
are not guessed from an artist's general catalog. The generated catalog retains an
evidence string for every assignment, and `tools/tag-catalog/apple-artist-metadata.json`
retains the external lookup results used by the classifier.

The classifier and frozen artifacts have separate checks:

```bash
npm run test:tag-catalog
```

`tags:check` validates the committed catalog records and confirms migration 0008
was rendered from exactly those records. It deliberately does not read or rewrite
`data/*/songs.json`, so removing or replacing a seeded tag in Admin remains
authoritative after `sync:data`.

`npm run tags:seed:build` is an explicit seed-authoring command retained for a new
pre-rollout seed. It rebuilds only `data/tag-catalog.json` and migration 0008 from
the current static snapshot; it never changes streamer song files. Do not run it
as part of normal curator, sync, or CI workflows.

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

D1 is the source of truth for tags. `data/*/songs.json` carries no tag data until
`sync:data` regenerates it from D1, so the fan-site tag panel stays hidden — the page
gates it on `tagCounts.size > 0` — until the last step lands.

The order below is a constraint, not a preference:

```bash
cd admin
npx wrangler@latest d1 time-travel info oshi-prism-db          # 1. record the bookmark

npx wrangler@latest d1 execute oshi-prism-db --remote \
  --file=migrations/0007_add_performance_tags.sql              # 2. storage + scope repair

npm run deploy                                                 # 3. Worker

npx wrangler@latest d1 execute oshi-prism-db --remote \
  --file=migrations/0008_seed_initial_tags.sql                 # 4. seed

cd .. && npm run sync:data -- <slug>                           # 5. regenerate static data
```

**0007 must precede the deploy.** The Worker names `performances.tags` in its INSERT
and SELECT statements and in `PATCH /api/performances/:id/tags`, so deploying it
against an unmigrated database fails with `no such column: tags` the first time a
performance is written.

**Do not curate between steps 2 and 3.** The previously deployed Worker still writes
the legacy layer: `PUT /api/songs/:id` forwards `body.tags` into `songs.tags`, and its
`prepareEnsureWorkForSongUpdate` copies `songs.tags` into the work it creates for a
renamed song. Either one re-introduces the out-of-scope IDs that 0007 has just moved
down, and 0007 is not meant to be re-run — its `ALTER TABLE` is one-shot, and the
recovery procedure is in the migration header. Keep this window short.

**0008 is a commitment.** It unions the seed into existing tags and never removes
anything, and its header forbids reapplying it once curators own the data. Applying it
gives up the ability to correct the seed: if the classifier changes afterwards,
already-seeded rows can only be fixed by hand. Apply it only when
`data/tag-catalog.json` is final, and retry it only while still completing this
rollout, before handing tag ownership to curators.

Migration 0007 adds the storage column and moves any controlled language/style IDs
already present on songs or works down to their linked performances. It leaves them in
place when a song or work has no performance to receive them — demoting them there
would delete them outright — and TagPicker surfaces those leftovers so a curator can
clear them.

Deploying the Worker and applying migrations are separate operator actions; merging
the PR does not mutate production D1.

## Scope

Work tags apply to every linked rendition. Performance tags apply only to the
specific recording, so a bilingual, parody, acoustic, duet, or a-cappella rendition
does not change the metadata of another performance of the same song.
