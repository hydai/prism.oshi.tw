import {
  SOCIAL_PROVIDERS,
  VOD_EXPORT_CAPACITY_WARNING_RATIO,
  VOD_EXPORT_LIMITS,
} from './constants';
import { utf8ByteLength } from './normalization';
import type {
  CapacityDiagnostic,
  CapacityResource,
  VodExportCounts,
  VodExportSourceData,
} from './types';

export class ExportLimitExceededError extends Error {
  readonly code = 'EXPORT_LIMIT_EXCEEDED' as const;
  readonly httpStatus = 422 as const;
  readonly diagnostic: CapacityDiagnostic;

  constructor(diagnostic: CapacityDiagnostic) {
    super(`VOD export ${diagnostic.resource} limit exceeded`);
    this.name = 'ExportLimitExceededError';
    this.diagnostic = diagnostic;
  }
}

export function capacityDiagnostic(
  resource: CapacityResource,
  actual: number,
  limit = limitForResource(resource),
): CapacityDiagnostic {
  assertSafeCapacityNumber(actual, 'actual');
  assertSafeCapacityNumber(limit, 'limit');
  if (limit === 0) throw new RangeError('Capacity limit must be greater than zero');

  const ratio = actual / limit;
  const state = actual > limit
    ? 'exceeded'
    : ratio >= VOD_EXPORT_CAPACITY_WARNING_RATIO
      ? 'warning'
      : 'ok';
  return { resource, actual, limit, ratio, state };
}

export function assertWithinCapacity(
  resource: CapacityResource,
  actual: number,
  limit = limitForResource(resource),
): CapacityDiagnostic {
  const diagnostic = capacityDiagnostic(resource, actual, limit);
  if (diagnostic.state === 'exceeded') throw new ExportLimitExceededError(diagnostic);
  return diagnostic;
}

export function measureSourceCapacity(source: VodExportSourceData): CapacityDiagnostic[] {
  const sourceRows = source.vods.length + source.songs.length + source.performances.length;
  const sourceTextBytes = countExportRelevantSourceTextBytes(source);
  return [
    assertWithinCapacity('sourceRows', sourceRows),
    assertWithinCapacity('sourceTextBytes', sourceTextBytes),
  ];
}

export function measureEmittedCapacity(counts: VodExportCounts): CapacityDiagnostic[] {
  return [
    assertWithinCapacity('streamers', counts.streamers),
    assertWithinCapacity('vods', counts.vods),
    assertWithinCapacity('performances', counts.performances),
  ];
}

export function countExportRelevantSourceTextBytes(source: VodExportSourceData): number {
  let total = 0;
  const add = (value: string | null | undefined): void => {
    if (value !== null && value !== undefined) total += utf8ByteLength(value);
  };

  for (const streamer of source.streamers) {
    add(streamer.submissionId);
    add(streamer.slug);
    add(streamer.displayName);
    add(streamer.youtubeChannelId);
    add(streamer.verifiedYoutubeChannelId);
    add(streamer.youtubeChannelVerifiedAt);
    add(streamer.avatarUrl);
    add(streamer.group);
    add(streamer.status);
    for (const provider of SOCIAL_PROVIDERS) add(streamer.socialLinks[provider]);
  }

  for (const vod of source.vods) {
    add(vod.streamId);
    add(vod.streamerId);
    add(vod.title);
    add(vod.date);
    add(vod.videoId);
    add(vod.status);
  }

  for (const song of source.songs) {
    add(song.songId);
    add(song.streamerId);
    add(song.title);
    add(song.originalArtist);
    add(song.status);
  }

  for (const performance of source.performances) {
    add(performance.performanceId);
    add(performance.streamerId);
    add(performance.songId);
    add(performance.streamId);
    add(performance.startSeconds.decimalText);
    add(performance.endSeconds.decimalText);
    add(performance.status);
  }

  return total;
}

export function limitForResource(resource: CapacityResource): number {
  return VOD_EXPORT_LIMITS[resource];
}

function assertSafeCapacityNumber(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`Capacity ${label} must be a non-negative safe integer`);
  }
}
