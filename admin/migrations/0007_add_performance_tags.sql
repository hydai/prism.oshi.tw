-- Rendition metadata belongs to one concrete performance. Add the storage layer
-- before seeding the controlled catalog, then repair any controlled language or
-- style IDs that may already have been written to songs/works by older Admin code.
--
-- Apply against remote D1 (from admin/ directory):
--   npx wrangler@latest d1 execute oshi-prism-db --remote --file=migrations/0007_add_performance_tags.sql
--
-- `songs.tags` is nullable and carries no json_valid CHECK (schema.sql), so every
-- read of it is guarded here; an unguarded json_each() aborts the whole file on a
-- single malformed row.
--
-- Every statement below the ALTER is re-runnable. SQLite has no
-- ALTER TABLE ... ADD COLUMN IF NOT EXISTS, so if a retry is needed after the
-- column already landed, skip the ALTER and re-run the remainder; per
-- docs/vod-export-rollout.md a partially migrated target is otherwise reconciled
-- from the Time Travel bookmark.

ALTER TABLE performances
  ADD COLUMN tags TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(tags));

DROP TABLE IF EXISTS _performance_tag_ids_0007;
CREATE TABLE _performance_tag_ids_0007 (
  id TEXT PRIMARY KEY
);

INSERT INTO _performance_tag_ids_0007 (id) VALUES
  ('language:zh'),
  ('language:en'),
  ('language:ja'),
  ('language:ko'),
  ('language:other'),
  ('style:parody'),
  ('style:acoustic'),
  ('style:duet'),
  ('style:a-cappella');

UPDATE performances
SET tags = (
  SELECT json_group_array(value)
  FROM (
    SELECT DISTINCT value
    FROM (
      SELECT value FROM json_each(performances.tags)
      UNION ALL
      SELECT song_tag.value
      FROM songs AS song
      JOIN json_each(
        CASE WHEN json_valid(song.tags) THEN song.tags ELSE '[]' END
      ) AS song_tag
      JOIN _performance_tag_ids_0007 AS allowed ON allowed.id = song_tag.value
      WHERE song.id = performances.song_id

      UNION ALL

      SELECT work_tag.value
      FROM song_work_links AS link
      JOIN works AS work ON work.id = link.work_id
      JOIN json_each(work.tags) AS work_tag
      JOIN _performance_tag_ids_0007 AS allowed ON allowed.id = work_tag.value
      WHERE link.song_id = performances.song_id
    )
    ORDER BY value
  )
),
updated_at = datetime('now')
WHERE EXISTS (
  SELECT 1
  FROM songs AS song
  JOIN json_each(
    CASE WHEN json_valid(song.tags) THEN song.tags ELSE '[]' END
  ) AS song_tag
  JOIN _performance_tag_ids_0007 AS allowed ON allowed.id = song_tag.value
  WHERE song.id = performances.song_id
)
OR EXISTS (
  SELECT 1
  FROM song_work_links AS link
  JOIN works AS work ON work.id = link.work_id
  JOIN json_each(work.tags) AS work_tag
  JOIN _performance_tag_ids_0007 AS allowed ON allowed.id = work_tag.value
  WHERE link.song_id = performances.song_id
);

-- Only strip an ID once it has somewhere to live. A song with no performance row
-- has no destination, so demoting its rendition tags would delete them outright.
UPDATE songs
SET tags = (
  SELECT json_group_array(value)
  FROM (
    SELECT value
    FROM json_each(
      CASE WHEN json_valid(songs.tags) THEN songs.tags ELSE '[]' END
    )
    WHERE value NOT IN (SELECT id FROM _performance_tag_ids_0007)
    ORDER BY value
  )
),
updated_at = datetime('now')
WHERE EXISTS (
  SELECT 1
  FROM json_each(
    CASE WHEN json_valid(songs.tags) THEN songs.tags ELSE '[]' END
  ) AS song_tag
  JOIN _performance_tag_ids_0007 AS moved ON moved.id = song_tag.value
)
AND EXISTS (
  SELECT 1
  FROM performances AS perf
  WHERE perf.song_id = songs.id
);

UPDATE works
SET tags = (
  SELECT json_group_array(value)
  FROM (
    SELECT value
    FROM json_each(works.tags)
    WHERE value NOT IN (SELECT id FROM _performance_tag_ids_0007)
    ORDER BY value
  )
),
updated_at = datetime('now')
WHERE EXISTS (
  SELECT 1
  FROM json_each(works.tags) AS work_tag
  JOIN _performance_tag_ids_0007 AS removed ON removed.id = work_tag.value
)
AND EXISTS (
  SELECT 1
  FROM song_work_links AS link
  JOIN performances AS perf ON perf.song_id = link.song_id
  WHERE link.work_id = works.id
);

DROP TABLE _performance_tag_ids_0007;
