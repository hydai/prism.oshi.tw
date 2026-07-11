import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { VodExportManifest, VodExportSnapshot } from '../src/vod-export/types';
import {
  PUBLIC_DOCUMENTATION_ARTIFACTS,
  VOD_EXPORT_GUIDE_URL,
  VOD_EXPORT_MANIFEST_SCHEMA_URL,
  VOD_EXPORT_SNAPSHOT_SCHEMA_URL,
  assertPublicDocumentationResponseMetadata,
  assertPublicDocumentPair,
  loadPublicSchemaValidators,
  verifyLiveVodExport,
  verifyLocalDocumentationArtifacts,
} from './vod-export-docs';

function fixture(): {
  manifest: VodExportManifest;
  snapshot: VodExportSnapshot;
  bytes: Uint8Array;
} {
  const snapshot: VodExportSnapshot = {
    schemaVersion: '1.0.0',
    streamers: [
      {
        slug: 'alpha',
        displayName: 'Alpha',
        youtubeChannelId: 'channel-alpha',
        avatarUrl: null,
        group: null,
        socialLinks: {},
        vods: [
          {
            title: 'Alpha Song Stream',
            date: '2026-07-12',
            videoId: 'dQw4w9WgXcQ',
            performances: [
              {
                performanceId: 'performance-alpha-1',
                songId: 'song-alpha',
                title: 'Example Song',
                originalArtist: null,
                startSeconds: 0,
                endSeconds: 120,
              },
            ],
          },
        ],
      },
      {
        slug: 'beta',
        displayName: 'Beta',
        youtubeChannelId: 'channel-beta',
        avatarUrl: 'HTTPS://yt3.ggpht.com/avatar',
        group: 'Example Group',
        socialLinks: {
          youtube: 'https://www.youtube.com/@beta',
        },
        vods: [],
      },
    ],
  };
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return {
    snapshot,
    bytes,
    manifest: {
      schemaVersion: '1.0.0',
      snapshotUrl: `https://data.oshi.tw/vod/v1/snapshots/${sha256}.json`,
      sha256,
      publishedAt: '2026-07-12T00:00:00.000Z',
      uncompressedBytes: bytes.byteLength,
      counts: {
        streamers: 2,
        vods: 1,
        performances: 1,
      },
    },
  };
}

function expectContractFailure(run: () => void, pattern: RegExp): void {
  assert.throws(run, pattern);
}

async function main(): Promise<void> {
  const validators = await loadPublicSchemaValidators();
  await verifyLocalDocumentationArtifacts();

  assert.deepEqual(
    PUBLIC_DOCUMENTATION_ARTIFACTS.map((artifact) => artifact.publicUrl),
    [
      VOD_EXPORT_MANIFEST_SCHEMA_URL,
      VOD_EXPORT_SNAPSHOT_SCHEMA_URL,
      VOD_EXPORT_GUIDE_URL,
    ],
  );
  assert(PUBLIC_DOCUMENTATION_ARTIFACTS.every((artifact) => !artifact.key.includes('llms')));
  assert.equal(PUBLIC_DOCUMENTATION_ARTIFACTS[0].immutable, true);
  assert.equal(PUBLIC_DOCUMENTATION_ARTIFACTS[1].immutable, true);
  assert.equal(PUBLIC_DOCUMENTATION_ARTIFACTS[2].immutable, false);

  const guideArtifact = PUBLIC_DOCUMENTATION_ARTIFACTS[2];
  assertPublicDocumentationResponseMetadata(new Response('', {
    status: 200,
    headers: { 'content-type': guideArtifact.contentType },
  }), guideArtifact);
  expectContractFailure(
    () => assertPublicDocumentationResponseMetadata(new Response('', {
      status: 200,
      headers: { 'content-type': 'text/markdown' },
    }), guideArtifact),
    /unexpected Content-Type/,
  );
  expectContractFailure(
    () => assertPublicDocumentationResponseMetadata(new Response('', {
      status: 200,
      headers: {
        'content-type': guideArtifact.contentType,
        'content-disposition': 'attachment',
      },
    }), guideArtifact),
    /must not have Content-Disposition/,
  );

  const valid = fixture();
  assertPublicDocumentPair(validators, valid.manifest, valid.snapshot, valid.bytes);

  const futureManifest = {
    ...valid.manifest,
    schemaVersion: '1.1.0',
    futureManifestField: true,
    counts: { ...valid.manifest.counts, futureCountsField: true },
  };
  const futureSnapshot = structuredClone(valid.snapshot) as unknown as Record<string, unknown>;
  futureSnapshot.schemaVersion = '1.1.0';
  futureSnapshot.futureSnapshotField = true;
  const futureStreamers = futureSnapshot.streamers as Array<Record<string, unknown>>;
  futureStreamers[0].futureStreamerField = true;
  const futureSocialLinks = futureStreamers[0].socialLinks as Record<string, unknown>;
  futureSocialLinks.futureProvider = { ignored: true };
  const futureVods = futureStreamers[0].vods as Array<Record<string, unknown>>;
  futureVods[0].futureVodField = true;
  const futurePerformances = futureVods[0].performances as Array<Record<string, unknown>>;
  futurePerformances[0].futurePerformanceField = true;
  assert.equal(validators.manifest(futureManifest), true);
  assert.equal(validators.snapshot(futureSnapshot), true);

  assert.equal(validators.manifest({ ...valid.manifest, schemaVersion: '2.0.0' }), false);
  assert.equal(validators.manifest({ ...valid.manifest, sha256: 'ABC' }), false);
  assert.equal(validators.manifest({ ...valid.manifest, uncompressedBytes: 10_485_761 }), false);

  const missingTitle = structuredClone(valid.snapshot) as unknown as Record<string, unknown>;
  const missingTitleStreamers = missingTitle.streamers as Array<Record<string, unknown>>;
  const missingTitleVods = missingTitleStreamers[0].vods as Array<Record<string, unknown>>;
  delete missingTitleVods[0].title;
  assert.equal(validators.snapshot(missingTitle), false);

  const emptyPerformances = structuredClone(valid.snapshot);
  emptyPerformances.streamers[0].vods[0].performances = [];
  assert.equal(validators.snapshot(emptyPerformances), false);

  const nullEnd = structuredClone(valid.snapshot) as unknown as Record<string, unknown>;
  const nullEndStreamers = nullEnd.streamers as Array<Record<string, unknown>>;
  const nullEndVods = nullEndStreamers[0].vods as Array<Record<string, unknown>>;
  const nullEndPerformances = nullEndVods[0].performances as Array<Record<string, unknown>>;
  nullEndPerformances[0].endSeconds = null;
  assert.equal(validators.snapshot(nullEnd), false);

  const nullSocial = structuredClone(valid.snapshot) as unknown as Record<string, unknown>;
  const nullSocialStreamers = nullSocial.streamers as Array<Record<string, unknown>>;
  nullSocialStreamers[0].socialLinks = { youtube: null };
  assert.equal(validators.snapshot(nullSocial), false);

  const invalidVideoId = structuredClone(valid.snapshot);
  invalidVideoId.streamers[0].vods[0].videoId = 'short';
  assert.equal(validators.snapshot(invalidVideoId), false);

  const invalidDate = structuredClone(valid.snapshot);
  invalidDate.streamers[0].vods[0].date = '2026-02-30';
  assert.equal(validators.snapshot(invalidDate), false);

  const wrongCounts = structuredClone(valid.manifest);
  wrongCounts.counts.performances += 1;
  expectContractFailure(
    () => assertPublicDocumentPair(validators, wrongCounts, valid.snapshot, valid.bytes),
    /counts do not match/,
  );

  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    if (fetchCalls > 1) {
      throw new Error('The untrusted snapshot URL was fetched');
    }
    return new Response(JSON.stringify({
      ...valid.manifest,
      snapshotUrl: `https://attacker.invalid/vod/v1/snapshots/${valid.manifest.sha256}.json`,
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    await assert.rejects(
      () => verifyLiveVodExport(validators),
      /trusted origin and adjacent sha256 path/,
    );
    assert.equal(fetchCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const wrongRange = structuredClone(valid.snapshot);
  wrongRange.streamers[0].vods[0].performances[0].startSeconds = 120;
  wrongRange.streamers[0].vods[0].performances[0].endSeconds = 120;
  expectContractFailure(
    () => assertPublicDocumentPair(validators, valid.manifest, wrongRange),
    /Invalid timestamp range/,
  );

  const duplicateChannel = structuredClone(valid.snapshot);
  duplicateChannel.streamers[1].youtubeChannelId = duplicateChannel.streamers[0].youtubeChannelId;
  expectContractFailure(
    () => assertPublicDocumentPair(validators, valid.manifest, duplicateChannel),
    /Duplicate youtubeChannelId/,
  );

  const wrongOrder = structuredClone(valid.snapshot);
  wrongOrder.streamers.reverse();
  expectContractFailure(
    () => assertPublicDocumentPair(validators, valid.manifest, wrongOrder),
    /not ordered by slug/,
  );

  const nonNfcTitle = structuredClone(valid.snapshot);
  nonNfcTitle.streamers[0].vods[0].performances[0].title = 'Cafe\u0301';
  expectContractFailure(
    () => assertPublicDocumentPair(validators, valid.manifest, nonNfcTitle),
    /not normalized display text/,
  );

  const unsafeAvatar = structuredClone(valid.snapshot);
  unsafeAvatar.streamers[1].avatarUrl = 'https://example.com/avatar.jpg';
  expectContractFailure(
    () => assertPublicDocumentPair(validators, valid.manifest, unsafeAvatar),
    /not an approved canonical public URL/,
  );

  const malformedAvatar = structuredClone(valid.snapshot);
  malformedAvatar.streamers[1].avatarUrl = 'https://';
  expectContractFailure(
    () => assertPublicDocumentPair(validators, valid.manifest, malformedAvatar),
    /not an approved canonical public URL/,
  );

  const wrongBytes = new Uint8Array(valid.bytes);
  wrongBytes[wrongBytes.length - 1] ^= 1;
  expectContractFailure(
    () => assertPublicDocumentPair(validators, valid.manifest, valid.snapshot, wrongBytes),
    /SHA-256 does not match/,
  );

  console.log('VOD export documentation schema and semantic tests passed.');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
