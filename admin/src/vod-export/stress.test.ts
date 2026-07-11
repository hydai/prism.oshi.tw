import { canonicalSnapshotByteLength, createOrderedSnapshotArtifact } from './canonical-json';
import {
  assertApiFindingsCapacity,
  forEachD1LookupBinding,
  vodExportPreviewApiResponse,
  type VodExportFindingApi,
} from './api';
import { VOD_EXPORT_LIMITS } from './constants';
import { countExportRelevantSourceTextBytes } from './limits';
import { jsonStringByteLength, utf8ByteLength } from './normalization';
import { buildOwnedVodExportSnapshot, buildVodExportSnapshot } from './validation';
import type {
  CapacityDiagnostic,
  ExportSourcePerformance,
  ExportSourceSong,
  ExportSourceStreamer,
  ExportSourceVod,
  OwnedVodExportSourceData,
  VodExportBuildResult,
  VodExportFinding,
  VodExportSnapshot,
  VodExportSourceData,
} from './types';

declare const process: {
  exitCode?: number;
  cpuUsage(previous?: { user: number; system: number }): { user: number; system: number };
  memoryUsage(): {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
    arrayBuffers: number;
  };
};

const LOCAL_MEMORY_GATE_BYTES = 96 * 1024 * 1024;
const decoder = new TextDecoder();

interface MemorySample {
  label: string;
  isolateEstimate: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
  rss: number;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function forceGc(): void {
  const gc = (globalThis as typeof globalThis & { gc?: () => void }).gc;
  if (gc === undefined) throw new Error('Run this stress gate with node --expose-gc');
  gc();
}

function sampleMemory(label: string): MemorySample {
  const usage = process.memoryUsage();
  const sample = {
    label,
    // Node's external value already includes ArrayBuffers. Heap + external is
    // the conservative local approximation used for the Worker isolate gate.
    isolateEstimate: usage.heapUsed + usage.external,
    heapUsed: usage.heapUsed,
    external: usage.external,
    arrayBuffers: usage.arrayBuffers,
    rss: usage.rss,
  };
  console.log(JSON.stringify({
    label,
    estimatedIsolateMiB: mib(sample.isolateEstimate),
    heapUsedMiB: mib(sample.heapUsed),
    externalMiB: mib(sample.external),
    arrayBuffersMiB: mib(sample.arrayBuffers),
    rssMiB: mib(sample.rss),
  }));
  return sample;
}

function mib(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 10) / 10;
}

function streamerId(index: number): string {
  return `s${String(index % VOD_EXPORT_LIMITS.streamers).padStart(3, '0')}`;
}

function videoId(index: number): string {
  return `v${index.toString(36).padStart(10, '0')}`;
}

function flatAscii(byteLength: number, salt: number): string {
  const bytes = new Uint8Array(byteLength);
  bytes.fill(0x61 + (salt % 26));
  return decoder.decode(bytes);
}

function flatAsciiWithPrefix(prefix: string, byteLength: number, salt: number): string {
  assert(byteLength >= prefix.length, 'flat ASCII fixture preserves its unique prefix');
  const bytes = new Uint8Array(byteLength);
  bytes.fill(0x61 + (salt % 26));
  for (let index = 0; index < prefix.length; index += 1) {
    const codeUnit = prefix.charCodeAt(index);
    assert(codeUnit <= 0x7f, 'flat ASCII fixture prefix must be ASCII');
    bytes[index] = codeUnit;
  }
  return decoder.decode(bytes);
}

function songRepairPath(index: number): string {
  return `/vod-export/repair/song/${index + 1}`;
}

function rawFindingsTargetBytes(): number {
  let repairPathBytes = 0;
  for (let index = 0; index < VOD_EXPORT_LIMITS.findings; index += 1) {
    repairPathBytes += 1
      + jsonStringByteLength('repairPath')
      + 1
      + jsonStringByteLength(songRepairPath(index));
  }
  return VOD_EXPORT_LIMITS.findingsBytes - repairPathBytes;
}

function buildMaxFixture(): OwnedVodExportSourceData {
  const streamers: ExportSourceStreamer[] = Array.from(
    { length: VOD_EXPORT_LIMITS.streamers },
    (_, index) => {
      const slug = streamerId(index);
      return {
        submissionId: `submission-${index}`,
        slug,
        displayName: `Streamer ${index}`,
        youtubeChannelId: `channel-${index}`,
        verifiedYoutubeChannelId: `channel-${index}`,
        youtubeChannelVerifiedAt: '2026-07-11T00:00:00.000Z',
        avatarUrl: null,
        group: null,
        socialLinks: {},
        enabled: true,
        status: 'approved',
      };
    },
  );
  const vods: ExportSourceVod[] = Array.from(
    { length: VOD_EXPORT_LIMITS.vods },
    (_, index) => ({
      streamId: `v${index.toString(36)}`,
      streamerId: streamerId(index),
      title: `VOD ${index}`,
      date: '2026-07-11',
      videoId: videoId(index),
      status: 'approved',
    }),
  );
  // Production preflight counts all approved rows, but complete song/VOD rows
  // are loaded only when an approved performance references them.
  const songCount = VOD_EXPORT_LIMITS.performances;
  const songs: ExportSourceSong[] = Array.from({ length: songCount }, (_, index) => {
    const songId = `song${String(index).padStart(5, '0')}`;
    return {
      rowId: index + 1,
      songId: index < VOD_EXPORT_LIMITS.findings
        ? flatAsciiWithPrefix(songId, songId.length + 500, index)
        : songId,
      streamerId: streamerId(index),
      title: `Song ${index}`,
      originalArtist: index < VOD_EXPORT_LIMITS.findings ? null : 'Artist',
      status: 'approved',
    };
  });
  const performances: ExportSourcePerformance[] = Array.from(
    { length: VOD_EXPORT_LIMITS.performances },
    (_, index) => {
      const songId = songs[index]?.songId ?? '';
      return {
        rowId: index + 1,
        performanceId: `p${index.toString(36)}`,
        streamerId: streamerId(index),
        // D1 returns independent row strings; do not let the fixture share the
        // large song-ID allocation between the song and performance objects.
        songId: flatAsciiWithPrefix(songId, songId.length, index),
        streamId: `v${(index % VOD_EXPORT_LIMITS.vods).toString(36)}`,
        startStorageClass: 'integer',
        startDecimalText: String(index * 2),
        endStorageClass: 'integer',
        endDecimalText: String(index * 2 + 1),
        status: 'approved',
      };
    },
  );
  const source: VodExportSourceData = { streamers, vods, songs, performances };

  let probe: VodExportBuildResult | null = buildVodExportSnapshot(source);
  const findingsBytes = capacityActual(probe.capacity, 'findingsBytes');
  const findingsDelta = rawFindingsTargetBytes() - findingsBytes;
  assert(findingsDelta >= 0, 'base stress fixture exceeds the findings byte limit');
  const perFinding = Math.floor(findingsDelta / VOD_EXPORT_LIMITS.findings);
  const remainder = findingsDelta % VOD_EXPORT_LIMITS.findings;
  for (let index = 0; index < VOD_EXPORT_LIMITS.findings; index += 1) {
    const extra = perFinding + (index < remainder ? 1 : 0);
    if (extra === 0) continue;
    const song = songs[index];
    const performance = performances[index];
    assert(song?.songId !== null && song?.songId !== undefined && performance !== undefined, 'warning fixture row exists');
    song.songId = flatAsciiWithPrefix(song.songId, song.songId.length + extra, index);
    performance.songId = flatAsciiWithPrefix(song.songId, song.songId.length, index);
  }

  probe = buildVodExportSnapshot(source);
  const snapshot = requireSnapshot(probe);
  const snapshotBytes = snapshotByteCapacity(probe, snapshot);
  const snapshotDelta = VOD_EXPORT_LIMITS.snapshotBytes - snapshotBytes;
  assert(snapshotDelta >= 0, 'findings-saturated fixture exceeds the snapshot byte limit');
  const referencedSong = songs[VOD_EXPORT_LIMITS.findings];
  assert(referencedSong?.title !== null && referencedSong?.title !== undefined, 'referenced filler song exists');
  referencedSong.title = flatAsciiWithPrefix(
    referencedSong.title,
    referencedSong.title.length + snapshotDelta,
    VOD_EXPORT_LIMITS.findings,
  );

  probe = buildVodExportSnapshot(source);
  const sourceDelta = VOD_EXPORT_LIMITS.sourceTextBytes - countExportRelevantSourceTextBytes(source);
  assert(sourceDelta >= 0, 'snapshot-saturated fixture exceeds the source text byte limit');
  const perStreamer = Math.floor(sourceDelta / streamers.length);
  const sourceRemainder = sourceDelta % streamers.length;
  for (let index = 0; index < streamers.length; index += 1) {
    const streamer = streamers[index];
    assert(streamer !== undefined, 'private source filler streamer exists');
    const extra = perStreamer + (index < sourceRemainder ? 1 : 0);
    streamer.submissionId = flatAscii(streamer.submissionId.length + extra, index);
  }
  source.preflightCapacity = {
    sourceRows: VOD_EXPORT_LIMITS.sourceRows,
    sourceTextBytes: VOD_EXPORT_LIMITS.sourceTextBytes,
  };
  probe = null;
  forceGc();
  return source as OwnedVodExportSourceData;
}

function capacityActual(
  capacity: readonly CapacityDiagnostic[],
  resource: CapacityDiagnostic['resource'],
): number {
  const diagnostic = capacity.find((item) => item.resource === resource);
  assert(diagnostic !== undefined, `missing ${resource} capacity diagnostic`);
  return diagnostic.actual;
}

function requireSnapshot(build: VodExportBuildResult): VodExportSnapshot {
  assert(build.canPublish && build.snapshot !== null, 'max fixture must remain publishable');
  return build.snapshot;
}

function snapshotByteCapacity(build: VodExportBuildResult, snapshot: VodExportSnapshot): number {
  void build;
  return canonicalSnapshotByteLength(snapshot);
}

async function main(): Promise<void> {
  forceGc();
  const source = buildMaxFixture();
  forceGc();
  const samples: MemorySample[] = [sampleMemory('fixture')];

  const cpuStart = process.cpuUsage();
  let build: VodExportBuildResult | null = buildOwnedVodExportSnapshot(
    source,
    (label) => samples.push(sampleMemory(`build-${label}`)),
  );
  samples.push(sampleMemory('build-transient'));
  assert(capacityActual(build.capacity, 'sourceRows') === VOD_EXPORT_LIMITS.sourceRows, 'source rows hit limit');
  assert(capacityActual(build.capacity, 'sourceTextBytes') === VOD_EXPORT_LIMITS.sourceTextBytes, 'source text hits limit');
  assert(capacityActual(build.capacity, 'findings') === VOD_EXPORT_LIMITS.findings, 'findings hit limit');
  assert(
    capacityActual(build.capacity, 'findingsBytes') === rawFindingsTargetBytes(),
    'raw findings leave exact room for server-controlled repair paths',
  );

  let snapshot: VodExportSnapshot | null = requireSnapshot(build);
  const findings: VodExportFinding[] = build.findings;
  const buildCapacity = build.capacity;
  build = null;
  samples.push(sampleMemory('build-references-released'));

  let artifact = await createOrderedSnapshotArtifact(snapshot);
  samples.push(sampleMemory('artifact-transient'));
  assert(artifact.uncompressedBytes === VOD_EXPORT_LIMITS.snapshotBytes, 'snapshot bytes hit limit');
  const artifactSummary = {
    sha256: artifact.sha256,
    uncompressedBytes: artifact.uncompressedBytes,
    counts: artifact.counts,
  };
  snapshot = null;
  samples.push(sampleMemory('snapshot-reference-released'));

  let metadata: Record<string, unknown> | null = {
    kind: 'vod-export-candidate-v1',
    candidateId: '00000000-0000-4000-8000-000000000000',
    schemaVersion: '1.0.0',
    generatedAt: '2026-07-11T00:00:00.000Z',
    expiresAt: '2026-07-12T00:00:00.000Z',
    sha256: artifact.sha256,
    uncompressedBytes: artifact.uncompressedBytes,
    counts: artifact.counts,
    warningCount: findings.length,
    findings,
    capacity: buildCapacity,
    snapshotKey: 'candidates/v1/00000000-0000-4000-8000-000000000000/snapshot.json',
    snapshotUrl: artifact.snapshotUrl,
    downloadFilename: artifact.downloadFilename,
    sourceFingerprint: {
      dbId: 'db',
      dbRevision: '1',
      novaDbId: 'nova',
      novaRevision: '1',
      schemaVersion: '1.0.0',
      exporterBuildId: 'stress',
    },
  };
  let metadataJson: string | null = JSON.stringify(metadata);
  const metadataBytes = utf8ByteLength(metadataJson);
  samples.push(sampleMemory('candidate-metadata-transient'));
  assert(metadataBytes < 5_000_000, 'candidate metadata stays inside its private limit');
  // The R2 put has consumed the fixed-size metadata string at this boundary;
  // generation-only snapshot bytes cannot overlap the subsequent API phase.
  metadataJson = null;
  artifact = null as unknown as typeof artifact;
  forceGc();
  samples.push(sampleMemory('candidate-r2-handoff'));

  const lookupStats = await forEachD1LookupBinding(
    findings.map((finding) => finding.entityId ?? ''),
    async (binding) => {
      if (binding.kind === 'packed') {
        assert(binding.value.byteLength <= 1_900_008, 'lookup buffer remains below the D1 value limit');
      }
    },
  );
  assert(lookupStats.skippedValues === 0, 'all warning repair IDs remain bindable');
  samples.push(sampleMemory('api-lookup-plan-transient'));

  const apiFindings = findings as VodExportFindingApi[];
  for (let index = 0; index < apiFindings.length; index += 1) {
    const finding = apiFindings[index];
    assert(finding !== undefined, 'API warning fixture remains dense');
    finding.repairPath = songRepairPath(index);
  }
  const apiFindingsCapacity = assertApiFindingsCapacity(true, apiFindings);
  assert(
    apiFindingsCapacity.actual === VOD_EXPORT_LIMITS.findingsBytes,
    'decorated API findings hit the complete private response limit exactly',
  );
  samples.push(sampleMemory('api-findings-transient'));

  const apiResponse = vodExportPreviewApiResponse({
    canPublish: true,
    findings: apiFindings,
    candidate: {
      candidateId: '00000000-0000-4000-8000-000000000000',
      schemaVersion: '1.0.0',
      sha256: artifactSummary.sha256,
      uncompressedBytes: artifactSummary.uncompressedBytes,
      counts: artifactSummary.counts,
      generatedAt: '2026-07-11T00:00:00.000Z',
      expiresAt: '2026-07-12T00:00:00.000Z',
      state: 'ready',
    },
    capacity: buildCapacity,
  });
  samples.push(sampleMemory('api-response-created'));
  equalHeader(apiResponse.headers.get('Content-Type'), 'application/json; charset=UTF-8');

  // Returning the streaming Response ends the heavy handler phase. The body
  // generator retains only the API result, so collect generation-only objects
  // before measuring the backpressured response phase as a separate live set.
  metadata = null;
  forceGc();
  samples.push(sampleMemory('api-response-handoff'));
  const reader = apiResponse.body?.getReader();
  assert(reader !== undefined, 'streamed API response has a body');
  let responseBytes = 0;
  let largestResponseChunkBytes = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    responseBytes += next.value.byteLength;
    largestResponseChunkBytes = Math.max(largestResponseChunkBytes, next.value.byteLength);
  }
  assert(responseBytes > VOD_EXPORT_LIMITS.findingsBytes, 'complete API envelope includes bounded metadata');
  assert(largestResponseChunkBytes <= 24_576, 'API response serialization remains chunk-bounded');
  samples.push(sampleMemory('api-response-streamed'));

  const cpu = process.cpuUsage(cpuStart);
  const cpuMs = (cpu.user + cpu.system) / 1_000;
  const peak = Math.max(...samples.map((sample) => sample.isolateEstimate));
  console.log(JSON.stringify({
    result: 'vod-export-local-stress',
    cpuMs: Math.round(cpuMs * 10) / 10,
    sampledPeakEstimatedIsolateMiB: mib(peak),
    nodeMemoryGateMiB: mib(LOCAL_MEMORY_GATE_BYTES),
    metadataBytes,
  }));
  assert(cpuMs <= 30_000, 'local stress CPU exceeds 30 seconds');
  assert(peak <= LOCAL_MEMORY_GATE_BYTES, 'local sampled heap + external memory exceeds 96 MiB');
}

function equalHeader(actual: string | null, expected: string): void {
  if (actual !== expected) throw new Error(`response header: expected ${expected}, got ${String(actual)}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
