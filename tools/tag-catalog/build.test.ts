import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import {
  checkSeedArtifacts,
  renderMigration,
  type TagCatalog,
} from './build';

function seedCatalog(): TagCatalog {
  return {
    schemaVersion: 2,
    generatedAt: '2026-08-04T00:00:00.000Z',
    methodology: 'Test seed',
    sources: ['Test fixture'],
    summary: {
      totalWorks: 1,
      totalSongs: 1,
      totalPerformances: 1,
      taggedWorks: 1,
      taggedSongs: 1,
      taggedPerformances: 1,
      effectiveTaggedSongs: 1,
      countsByTag: {
        'genre:rock': 1,
        'language:ja': 1,
      },
    },
    works: [{
      id: 'work-1',
      title: 'Seeded work',
      originalArtist: 'Artist',
      tags: ['genre:rock'],
      evidence: { 'genre:rock': 'Seed evidence' },
    }],
    performances: [{
      id: 'performance-1',
      songId: 'song-1',
      workId: 'work-1',
      streamer: 'tester',
      title: 'Seeded work',
      originalArtist: 'Artist',
      tags: ['language:ja'],
      evidence: { 'language:ja': 'Seed evidence' },
    }],
  };
}

test('artifact checks ignore curator-owned synced song tags', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-tag-seed-'));
  try {
    const catalog = seedCatalog();
    const catalogPath = path.join(root, 'tag-catalog.json');
    const migrationPath = path.join(root, '0008_seed_initial_tags.sql');
    const songsPath = path.join(root, 'songs.json');
    fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
    fs.writeFileSync(migrationPath, renderMigration(catalog.works, catalog.performances));
    fs.writeFileSync(songsPath, '[{"id":"song-1","inheritedTags":["genre:rock"]}]\n');

    assert.doesNotThrow(() => checkSeedArtifacts(catalogPath, migrationPath));

    const curatedExport = '[{"id":"song-1","inheritedTags":["genre:pop"]}]\n';
    fs.writeFileSync(songsPath, curatedExport);
    assert.doesNotThrow(() => checkSeedArtifacts(catalogPath, migrationPath));
    assert.equal(fs.readFileSync(songsPath, 'utf8'), curatedExport);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('artifact checks reject a migration that differs from the frozen catalog', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-tag-seed-'));
  try {
    const catalog = seedCatalog();
    const catalogPath = path.join(root, 'tag-catalog.json');
    const migrationPath = path.join(root, '0008_seed_initial_tags.sql');
    fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
    fs.writeFileSync(migrationPath, '-- stale migration\n');

    assert.throws(
      () => checkSeedArtifacts(catalogPath, migrationPath),
      /migration is stale/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('artifact checks reject tags stored at the wrong scope', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-tag-seed-'));
  try {
    const catalog = seedCatalog();
    catalog.works[0].tags = ['language:ja'];
    catalog.works[0].evidence = { 'language:ja': 'Wrong scope' };
    const catalogPath = path.join(root, 'tag-catalog.json');
    const migrationPath = path.join(root, '0008_seed_initial_tags.sql');
    fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
    fs.writeFileSync(migrationPath, renderMigration(catalog.works, catalog.performances));

    assert.throws(
      () => checkSeedArtifacts(catalogPath, migrationPath),
      /not valid for work scope/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
