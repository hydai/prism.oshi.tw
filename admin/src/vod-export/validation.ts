import { SOCIAL_PROVIDERS, VOD_EXPORT_SCHEMA_VERSION } from './constants';
import { FindingCollector, type FindingInput } from './findings';
import {
  assertWithinCapacity,
  measureOwnedSourceCapacity,
  measureSourceCapacity,
} from './limits';
import {
  hasValidUnicodeScalars,
  isBlankText,
  isValidDateOnly,
  isValidRfc3339Timestamp,
  isValidStreamerSlug,
  isValidVideoId,
  INVALID_NORMALIZED_DISPLAY_TEXT,
  normalizeDisplayTextValue,
  parseSqliteIntegerValue,
  validateOptionalSafeUrl,
} from './normalization';
import { orderOwnedSnapshotInPlace } from './ordering';
import type {
  ExportSourcePerformance,
  ExportSourceSong,
  ExportSourceStreamer,
  ExportSourceVod,
  FindingDetails,
  OwnedVodExportSourceData,
  PublicFindingField,
  VodExportBuildResult,
  VodExportCounts,
  VodExportPerformance,
  VodExportSnapshot,
  VodExportSocialLinks,
  VodExportSourceData,
  VodExportStreamer,
  VodExportVod,
} from './types';

const MISSING_IDENTITY = Symbol('missing-identity');
const INVALID_IDENTITY = Symbol('invalid-identity');
type IdentityValue = string | typeof MISSING_IDENTITY | typeof INVALID_IDENTITY;
const OWNED_SONG_VALIDATION = Symbol('owned-song-validation');
const SONG_VALID = 1;
const SONG_ARTIST_MISSING = 2;
type OwnedSongValidation = 0 | 1 | 2 | 3;
type OwnedSourceSong = ExportSourceSong & { [OWNED_SONG_VALIDATION]?: OwnedSongValidation };

interface ValidatedStreamerRecord {
  source?: ExportSourceStreamer;
  slug?: string;
  verifiedChannelId?: string;
  publicBase?: Omit<VodExportStreamer, 'vods'>;
}

type ValidatedSong = {
  valid: true;
  songId: string;
  title: string;
  originalArtist: string | null;
  artistMissing: boolean;
} | {
  valid: false;
  songId?: string;
  title?: string;
  originalArtist: string | null;
  artistMissing: boolean;
};

interface OccurrenceAssembly {
  vodsByStreamer: Map<string, VodExportVod[]>;
  vodCount: number;
  performanceCount: number;
}

export function buildVodExportSnapshot(source: VodExportSourceData): VodExportBuildResult {
  return buildVodExportSnapshotInternal(source, false);
}

/** Consumes adapter-owned source arrays so raw rows can be reclaimed during generation. */
export function buildOwnedVodExportSnapshot(
  source: OwnedVodExportSourceData,
  onCheckpoint?: (label: string) => void,
): VodExportBuildResult {
  return buildVodExportSnapshotInternal(source, true, onCheckpoint);
}

function buildVodExportSnapshotInternal(
  source: VodExportSourceData | OwnedVodExportSourceData,
  consumeSource: boolean,
  onCheckpoint?: (label: string) => void,
): VodExportBuildResult {
  const capacity = consumeSource
    ? measureOwnedSourceCapacity(source as OwnedVodExportSourceData)
    : measureSourceCapacity(source);
  onCheckpoint?.('source-capacity');
  const collector = new FindingCollector();
  const selectedStreamers = source.streamers.filter(
    (streamer) => streamer.status === 'approved' && streamer.enabled,
  );
  // Required-field failures block the complete publication; they never turn a
  // selected streamer into a silently omitted row. Therefore this intended
  // emitted scope is also the exact candidate count whenever canPublish=true,
  // while checking it early prevents invalid rows from bypassing memory caps.
  capacity.push(assertWithinCapacity('streamers', selectedStreamers.length));

  const streamerRecords = selectedStreamers.map((streamer) => validateStreamer(streamer, collector));
  addDuplicateStreamerFindings(streamerRecords, collector);
  onCheckpoint?.('streamers-validated');

  const streamerScope = new Map<string, string | undefined>();
  for (const record of streamerRecords) {
    const rawSlug = record.source?.slug ?? null;
    if (rawSlug !== null && !streamerScope.has(rawSlug)) {
      streamerScope.set(rawSlug, record.slug);
    }
  }
  for (const record of streamerRecords) record.source = undefined;
  if (consumeSource) {
    releaseOwnedRows(selectedStreamers);
    releaseOwnedRows(source.streamers);
  }
  const vodByStreamId = indexBy(source.vods, (vod) => vod.streamId);
  const songBySongId = new Map<string, ExportSourceSong>();
  for (const song of source.songs) {
    if (song.songId !== null) songBySongId.set(song.songId, song);
  }
  onCheckpoint?.('relations-indexed');
  const occurrenceAssembly = validateAndAssembleOccurrences(
    source.performances,
    streamerScope,
    vodByStreamId,
    songBySongId,
    collector,
    consumeSource,
    onCheckpoint,
  );
  onCheckpoint?.('occurrences-assembled');
  if (consumeSource) {
    vodByStreamId.clear();
    songBySongId.clear();
    releaseOwnedRows(source.vods);
    releaseOwnedRows(source.songs);
  }
  onCheckpoint?.('source-released');
  // The same rule applies to eligible VODs/occurrences: invalid public fields
  // block all bytes instead of shrinking the output. On every successful build
  // these prospective counts equal the assembled canonical snapshot exactly.
  const prospectiveCounts: VodExportCounts = {
    streamers: selectedStreamers.length,
    vods: occurrenceAssembly.vodCount,
    performances: occurrenceAssembly.performanceCount,
  };
  capacity.push(
    assertWithinCapacity('vods', prospectiveCounts.vods),
    assertWithinCapacity('performances', prospectiveCounts.performances),
  );

  const validation = collector.complete();
  capacity.push(...collector.capacity());
  onCheckpoint?.('findings-complete');
  const snapshot = validation.canPublish
    ? orderOwnedSnapshotInPlace(assembleSnapshot(
        streamerRecords,
        occurrenceAssembly.vodsByStreamer,
      ))
    : null;
  onCheckpoint?.('snapshot-ordered');

  return {
    ...validation,
    snapshot,
    counts: prospectiveCounts,
    capacity,
  };
}

function validateStreamer(source: ExportSourceStreamer, collector: FindingCollector): ValidatedStreamerRecord {
  const slugResult = validateSlugIdentity(source.slug);
  const slug = typeof slugResult === 'string' ? slugResult : undefined;
  if (slugResult === MISSING_IDENTITY) {
    addStreamerFinding(collector, source, undefined, 'MISSING_STREAMER_SLUG', 'slug');
  } else if (slugResult === INVALID_IDENTITY) {
    addStreamerFinding(collector, source, undefined, 'INVALID_STREAMER_SLUG', 'slug');
  }

  const displayName = normalizeDisplayTextValue(source.displayName);
  if (displayName === null) {
    addStreamerFinding(collector, source, slug, 'MISSING_DISPLAY_NAME', 'displayName');
  } else if (displayName === INVALID_NORMALIZED_DISPLAY_TEXT) {
    addStreamerFinding(collector, source, slug, 'INVALID_UNICODE_TEXT', 'displayName');
  }

  const channelIdentity = validateOpaqueIdentity(source.youtubeChannelId);
  let verifiedChannelId: string | undefined;
  if (channelIdentity === MISSING_IDENTITY) {
    addStreamerFinding(collector, source, slug, 'MISSING_YOUTUBE_CHANNEL_ID', 'youtubeChannelId');
  } else if (channelIdentity === INVALID_IDENTITY) {
    addStreamerFinding(collector, source, slug, 'INVALID_UNICODE_TEXT', 'youtubeChannelId');
  } else {
    const verificationIsValid =
      source.verifiedYoutubeChannelId === channelIdentity &&
      source.youtubeChannelVerifiedAt !== null &&
      !isBlankText(source.youtubeChannelVerifiedAt) &&
      hasValidUnicodeScalars(source.youtubeChannelVerifiedAt) &&
      isValidRfc3339Timestamp(source.youtubeChannelVerifiedAt);
    if (verificationIsValid) {
      verifiedChannelId = channelIdentity;
    } else {
      addStreamerFinding(collector, source, slug, 'UNVERIFIED_YOUTUBE_CHANNEL_ID', 'youtubeChannelId');
    }
  }

  const avatar = validateOptionalSafeUrl(source.avatarUrl, 'avatar');
  if (avatar.kind === 'unsafe') {
    addStreamerFinding(collector, source, slug, 'UNSAFE_AVATAR_URL', 'avatarUrl');
  }

  const group = normalizeDisplayTextValue(source.group);
  if (group === INVALID_NORMALIZED_DISPLAY_TEXT) {
    addStreamerFinding(collector, source, slug, 'INVALID_UNICODE_TEXT', 'group');
  }

  const socialLinks: VodExportSocialLinks = {};
  const unsafeSocialDetails: FindingDetails = {};
  for (const provider of SOCIAL_PROVIDERS) {
    const result = validateOptionalSafeUrl(source.socialLinks[provider], provider);
    if (result.kind === 'safe') socialLinks[provider] = result.url;
    if (result.kind === 'unsafe') setSocialFlag(unsafeSocialDetails, provider);
  }
  if (Object.keys(unsafeSocialDetails).length > 0) {
    addStreamerFinding(collector, source, slug, 'UNSAFE_SOCIAL_LINK', 'socialLinks', unsafeSocialDetails);
  }

  let publicBase: Omit<VodExportStreamer, 'vods'> | undefined;
  if (
    slug !== undefined &&
    typeof displayName === 'string' &&
    verifiedChannelId !== undefined &&
    group !== INVALID_NORMALIZED_DISPLAY_TEXT
  ) {
    publicBase = {
      slug,
      displayName,
      youtubeChannelId: verifiedChannelId,
      avatarUrl: avatar.kind === 'safe' ? avatar.url : null,
      group: typeof group === 'string' ? group : null,
      socialLinks,
    };
  }

  return { source, slug, verifiedChannelId, publicBase };
}

function addDuplicateStreamerFindings(
  records: readonly ValidatedStreamerRecord[],
  collector: FindingCollector,
): void {
  const bySlug = groupDefined(records, (record) => record.slug);
  for (const [slug, duplicates] of bySlug) {
    if (duplicates.length < 2) continue;
    collector.add({
      code: 'DUPLICATE_STREAMER_SLUG',
      streamerSlug: slug,
      entityType: 'streamer',
      entityId: slug,
      field: 'slug',
      details: { duplicateCount: duplicates.length },
    });
  }

  const byChannel = groupDefined(records, (record) => record.verifiedChannelId);
  for (const duplicates of byChannel.values()) {
    if (duplicates.length < 2) continue;
    for (const record of duplicates) {
      const source = record.source;
      if (source === undefined) {
        throw new Error('streamer source was released before duplicate validation completed');
      }
      addStreamerFinding(
        collector,
        source,
        record.slug,
        'DUPLICATE_YOUTUBE_CHANNEL_ID',
        'youtubeChannelId',
        { duplicateCount: duplicates.length },
      );
    }
  }
}

function validateAndAssembleOccurrences(
  performances: readonly ExportSourcePerformance[],
  streamerScope: ReadonlyMap<string, string | undefined>,
  vodByStreamId: ReadonlyMap<string, ExportSourceVod>,
  songBySongId: ReadonlyMap<string, ExportSourceSong>,
  collector: FindingCollector,
  consumeSource: boolean,
  onCheckpoint?: (label: string) => void,
): OccurrenceAssembly {
  const validatedVods = new Map<ExportSourceVod, VodExportVod | null>();
  const eligibleVodIdentities = new Map<string, Map<string, number>>();
  const validatedSongs = consumeSource ? null : new Map<ExportSourceSong, ValidatedSong>();
  const missingArtistCounts = new Map<ExportSourceSong, number>();
  const vodsByStreamer = new Map<string, VodExportVod[]>();
  let performanceCount = 0;

  for (let index = 0; index < performances.length; index += 1) {
    const performance = performances[index];
    if (performance === undefined) continue;
    try {
      if (performance.status !== 'approved' || !streamerScope.has(performance.streamerId)) continue;

      const safeStreamerSlug = streamerScope.get(performance.streamerId);
      const vod = vodByStreamId.get(performance.streamId);
      const song = songBySongId.get(performance.songId);
      if (vod === undefined || song === undefined) {
        const context = performanceContext(performance, safeStreamerSlug);
        if (vod === undefined) collector.add({ ...context, code: 'MISSING_VOD_RELATION' });
        if (song === undefined) collector.add({ ...context, code: 'MISSING_SONG_RELATION' });
      }

      const vodMatches = vod === undefined || vod.streamerId === performance.streamerId;
      const songMatches = song === undefined || song.streamerId === performance.streamerId;
      if (!vodMatches || !songMatches) {
        const context = performanceContext(performance, safeStreamerSlug);
        if (!vodMatches) collector.add({ ...context, code: 'VOD_STREAMER_MISMATCH' });
        if (!songMatches) collector.add({ ...context, code: 'SONG_STREAMER_MISMATCH' });
      }

      if (
        vod !== undefined &&
        song !== undefined &&
        safeStreamerSlug !== undefined &&
        vodMatches &&
        songMatches &&
        vod.status === 'approved' &&
        song.status === 'approved'
      ) {
        performanceCount += 1;

        let validatedVod: VodExportVod | null;
        if (validatedVods.has(vod)) {
          validatedVod = validatedVods.get(vod) ?? null;
        } else {
          validatedVod = validateVod(vod, collector, eligibleVodIdentities);
          validatedVods.set(vod, validatedVod);
        }
        let songId: string | undefined;
        let songTitle: string | undefined;
        let originalArtist: string | null = null;
        let artistMissing: boolean;
        if (consumeSource) {
          const state = validateOwnedSong(song, collector);
          artistMissing = (state & SONG_ARTIST_MISSING) !== 0;
          if ((state & SONG_VALID) !== 0) {
            songId = song.songId ?? undefined;
            songTitle = song.title ?? undefined;
            originalArtist = song.originalArtist;
          }
        } else {
          let validatedSong = validatedSongs?.get(song);
          if (validatedSong === undefined) {
            validatedSong = validateSong(song, collector);
            validatedSongs?.set(song, validatedSong);
          }
          artistMissing = validatedSong.artistMissing;
          if (validatedSong.valid) {
            songId = validatedSong.songId;
            songTitle = validatedSong.title;
            originalArtist = validatedSong.originalArtist;
          }
        }
        const validatedPerformance = validatePerformance(
          performance,
          safeStreamerSlug,
          songId,
          songTitle,
          originalArtist,
          collector,
        );

        if (artistMissing) {
          missingArtistCounts.set(song, (missingArtistCounts.get(song) ?? 0) + 1);
        }
        if (validatedVod !== null && validatedPerformance !== null) {
          if (validatedVod.performances.length === 0) {
            const vods = vodsByStreamer.get(safeStreamerSlug);
            if (vods === undefined) vodsByStreamer.set(safeStreamerSlug, [validatedVod]);
            else vods.push(validatedVod);
          }
          validatedVod.performances.push(validatedPerformance);
        }
      }
    } finally {
      if (consumeSource) releaseOwnedRow(performances, index);
    }
    if ((index + 1) % 10_000 === 0) onCheckpoint?.(`performance-${index + 1}`);
  }

  addDuplicateVodFindings(eligibleVodIdentities, collector);
  onCheckpoint?.('vod-duplicates-checked');
  addMissingArtistWarnings(missingArtistCounts, collector);
  onCheckpoint?.('artist-warnings-added');

  onCheckpoint?.('vods-grouped');

  const vodCount = validatedVods.size;
  eligibleVodIdentities.clear();
  validatedVods.clear();
  validatedSongs?.clear();
  missingArtistCounts.clear();

  return {
    vodsByStreamer,
    vodCount,
    performanceCount,
  };
}

function validateVod(
  source: ExportSourceVod,
  collector: FindingCollector,
  eligibleVodIdentities: Map<string, Map<string, number>>,
): VodExportVod | null {
  const videoIdentity = validateVideoIdentity(source.videoId);
  const videoId = typeof videoIdentity === 'string' ? videoIdentity : undefined;
  if (videoIdentity === MISSING_IDENTITY) {
    addVodFinding(collector, source, undefined, 'MISSING_VIDEO_ID', 'videoId');
  } else if (videoIdentity === INVALID_IDENTITY) {
    addVodFinding(collector, source, undefined, 'INVALID_VIDEO_ID', 'videoId');
  } else {
    const byVideo = eligibleVodIdentities.get(source.streamerId) ?? new Map<string, number>();
    byVideo.set(videoIdentity, (byVideo.get(videoIdentity) ?? 0) + 1);
    eligibleVodIdentities.set(source.streamerId, byVideo);
  }

  const title = normalizeDisplayTextValue(source.title);
  if (title === null) {
    addVodFinding(collector, source, videoId, 'MISSING_VOD_TITLE', 'title');
  } else if (title === INVALID_NORMALIZED_DISPLAY_TEXT) {
    addVodFinding(collector, source, videoId, 'INVALID_UNICODE_TEXT', 'title');
  }

  let date: string | undefined;
  if (isBlankText(source.date)) {
    addVodFinding(collector, source, videoId, 'MISSING_VOD_DATE', 'date');
  } else if (!hasValidUnicodeScalars(source.date ?? '')) {
    addVodFinding(collector, source, videoId, 'INVALID_UNICODE_TEXT', 'date');
  } else if (!isValidDateOnly(source.date ?? '')) {
    addVodFinding(collector, source, videoId, 'INVALID_VOD_DATE', 'date');
  } else {
    date = source.date ?? undefined;
  }

  if (videoId === undefined || typeof title !== 'string' || date === undefined) return null;
  return { title, date, videoId, performances: [] };
}

function addDuplicateVodFindings(
  identities: ReadonlyMap<string, ReadonlyMap<string, number>>,
  collector: FindingCollector,
): void {
  for (const [streamerSlug, byVideo] of identities) {
    for (const [videoId, duplicateCount] of byVideo) {
      if (duplicateCount < 2) continue;
      collector.add({
        code: 'DUPLICATE_VOD_VIDEO_ID',
        streamerSlug,
        entityType: 'vod',
        entityId: videoId,
        field: 'videoId',
        details: { duplicateCount },
      });
    }
  }
}

function validateSong(source: ExportSourceSong, collector: FindingCollector): ValidatedSong {
  const songIdentity = validateOpaqueIdentity(source.songId);
  const songId = typeof songIdentity === 'string' ? songIdentity : undefined;
  if (songIdentity === MISSING_IDENTITY) {
    addSongFinding(collector, source, undefined, 'MISSING_SONG_ID', 'songId');
  } else if (songIdentity === INVALID_IDENTITY) {
    addSongFinding(collector, source, undefined, 'INVALID_UNICODE_TEXT', 'songId');
  }

  const title = normalizeDisplayTextValue(source.title);
  if (title === null) {
    addSongFinding(collector, source, songId, 'MISSING_SONG_TITLE', 'title');
  } else if (title === INVALID_NORMALIZED_DISPLAY_TEXT) {
    addSongFinding(collector, source, songId, 'INVALID_UNICODE_TEXT', 'title');
  }

  const artist = normalizeDisplayTextValue(source.originalArtist);
  if (artist === INVALID_NORMALIZED_DISPLAY_TEXT) {
    addSongFinding(collector, source, songId, 'INVALID_UNICODE_TEXT', 'originalArtist');
  }

  const originalArtist = typeof artist === 'string' ? artist : null;
  const artistMissing = artist === null;
  if (songId !== undefined && typeof title === 'string' && artist !== INVALID_NORMALIZED_DISPLAY_TEXT) {
    return { valid: true, songId, title, originalArtist, artistMissing };
  }
  return {
    valid: false,
    ...(songId === undefined ? {} : { songId }),
    ...(typeof title === 'string' ? { title } : {}),
    originalArtist,
    artistMissing,
  };
}

function validateOwnedSong(source: ExportSourceSong, collector: FindingCollector): OwnedSongValidation {
  const ownedSource = source as OwnedSourceSong;
  const previous = ownedSource[OWNED_SONG_VALIDATION];
  if (previous !== undefined) return previous;

  const songIdentity = validateOpaqueIdentity(source.songId);
  const songId = typeof songIdentity === 'string' ? songIdentity : undefined;
  if (songIdentity === MISSING_IDENTITY) {
    addSongFinding(collector, source, undefined, 'MISSING_SONG_ID', 'songId');
  } else if (songIdentity === INVALID_IDENTITY) {
    addSongFinding(collector, source, undefined, 'INVALID_UNICODE_TEXT', 'songId');
  }

  const title = normalizeDisplayTextValue(source.title);
  if (title === null) {
    addSongFinding(collector, source, songId, 'MISSING_SONG_TITLE', 'title');
  } else if (title === INVALID_NORMALIZED_DISPLAY_TEXT) {
    addSongFinding(collector, source, songId, 'INVALID_UNICODE_TEXT', 'title');
  }

  const artist = normalizeDisplayTextValue(source.originalArtist);
  if (artist === INVALID_NORMALIZED_DISPLAY_TEXT) {
    addSongFinding(collector, source, songId, 'INVALID_UNICODE_TEXT', 'originalArtist');
  }

  const artistMissing = artist === null;
  const valid = songId !== undefined
    && typeof title === 'string'
    && artist !== INVALID_NORMALIZED_DISPLAY_TEXT;
  const state = ((valid ? SONG_VALID : 0) | (artistMissing ? SONG_ARTIST_MISSING : 0)) as OwnedSongValidation;
  if (valid) {
    source.songId = songId;
    source.title = title;
    source.originalArtist = typeof artist === 'string' ? artist : null;
  }
  ownedSource[OWNED_SONG_VALIDATION] = state;
  return state;
}

function validatePerformance(
  source: ExportSourcePerformance,
  streamerSlug: string,
  songId: string | undefined,
  songTitle: string | undefined,
  originalArtist: string | null,
  collector: FindingCollector,
): VodExportPerformance | null {
  const identity = validateOpaqueIdentity(source.performanceId);
  const performanceId = typeof identity === 'string' ? identity : undefined;
  if (identity === MISSING_IDENTITY) {
    addPerformanceFinding(collector, source, streamerSlug, undefined, 'MISSING_PERFORMANCE_ID', 'performanceId');
  } else if (identity === INVALID_IDENTITY) {
    addPerformanceFinding(collector, source, streamerSlug, undefined, 'INVALID_UNICODE_TEXT', 'performanceId');
  }

  const parsedStart = parseSqliteIntegerValue(source.startStorageClass, source.startDecimalText);
  let startSeconds: number | undefined;
  if (parsedStart === 'missing') {
    addPerformanceFinding(collector, source, streamerSlug, performanceId, 'MISSING_START_SECONDS', 'startSeconds');
  } else if (parsedStart === 'invalid' || parsedStart < 0) {
    addPerformanceFinding(collector, source, streamerSlug, performanceId, 'INVALID_START_SECONDS', 'startSeconds');
  } else {
    startSeconds = parsedStart;
  }

  const parsedEnd = parseSqliteIntegerValue(source.endStorageClass, source.endDecimalText);
  let endSeconds: number | undefined;
  if (parsedEnd === 'missing') {
    addPerformanceFinding(collector, source, streamerSlug, performanceId, 'MISSING_END_SECONDS', 'endSeconds');
  } else if (parsedEnd === 'invalid' || parsedEnd < 0) {
    addPerformanceFinding(collector, source, streamerSlug, performanceId, 'INVALID_END_SECONDS', 'endSeconds');
  } else {
    endSeconds = parsedEnd;
  }

  if (startSeconds !== undefined && endSeconds !== undefined && endSeconds <= startSeconds) {
    addPerformanceFinding(
      collector,
      source,
      streamerSlug,
      performanceId,
      'INVALID_END_RANGE',
      'endSeconds',
      { startSeconds, endSeconds },
    );
  }

  if (
    performanceId !== undefined &&
    songId !== undefined &&
    songTitle !== undefined &&
    startSeconds !== undefined &&
    endSeconds !== undefined &&
    endSeconds > startSeconds
  ) {
    return {
      performanceId,
      songId,
      title: songTitle,
      originalArtist,
      startSeconds,
      endSeconds,
    };
  }
  return null;
}

function addMissingArtistWarnings(
  counts: ReadonlyMap<ExportSourceSong, number>,
  collector: FindingCollector,
): void {
  for (const [song, affectedPerformanceCount] of counts) {
    const identity = validateOpaqueIdentity(song.songId);
    const songId = typeof identity === 'string' ? identity : undefined;
    addSongFinding(
      collector,
      song,
      songId,
      'MISSING_ORIGINAL_ARTIST',
      'originalArtist',
      { affectedPerformanceCount },
    );
  }
}

function assembleSnapshot(
  streamerRecords: readonly ValidatedStreamerRecord[],
  vodsByStreamer: ReadonlyMap<string, VodExportVod[]>,
): VodExportSnapshot {
  const streamers: VodExportStreamer[] = [];

  for (const record of streamerRecords) {
    if (record.publicBase === undefined || record.slug === undefined) continue;
    streamers.push({ ...record.publicBase, vods: vodsByStreamer.get(record.slug) ?? [] });
  }

  return { schemaVersion: VOD_EXPORT_SCHEMA_VERSION, streamers };
}

function addStreamerFinding(
  collector: FindingCollector,
  source: ExportSourceStreamer,
  slug: string | undefined,
  code: FindingInput['code'],
  field: PublicFindingField,
  codeDetails?: FindingDetails,
): void {
  collector.add({
    code,
    ...(slug === undefined
      ? { entityType: 'streamer' as const, details: { submissionId: source.submissionId, ...codeDetails } }
      : { streamerSlug: slug, entityType: 'streamer' as const, entityId: slug, details: codeDetails }),
    field,
  });
}

function addVodFinding(
  collector: FindingCollector,
  source: ExportSourceVod,
  videoId: string | undefined,
  code: FindingInput['code'],
  field: PublicFindingField,
  codeDetails?: FindingDetails,
): void {
  collector.add({
    code,
    streamerSlug: source.streamerId,
    entityType: 'vod',
    ...(videoId === undefined
      ? { details: { streamId: source.streamId, ...codeDetails } }
      : { entityId: videoId, details: codeDetails }),
    field,
  });
}

function addSongFinding(
  collector: FindingCollector,
  source: ExportSourceSong,
  songId: string | undefined,
  code: FindingInput['code'],
  field: PublicFindingField,
  codeDetails?: FindingDetails,
): void {
  collector.add({
    code,
    streamerSlug: source.streamerId,
    entityType: 'song',
    ...(songId === undefined
      ? { details: { rowId: source.rowId, ...codeDetails } }
      : { entityId: songId, details: codeDetails }),
    field,
  });
}

function addPerformanceFinding(
  collector: FindingCollector,
  source: ExportSourcePerformance,
  streamerSlug: string,
  performanceId: string | undefined,
  code: FindingInput['code'],
  field: PublicFindingField,
  codeDetails?: FindingDetails,
): void {
  collector.add({
    code,
    streamerSlug,
    entityType: 'performance',
    ...(performanceId === undefined
      ? { details: { rowId: source.rowId, ...codeDetails } }
      : { entityId: performanceId, details: codeDetails }),
    field,
  });
}

function performanceContext(
  source: ExportSourcePerformance,
  streamerSlug: string | undefined,
): Omit<FindingInput, 'code'> {
  const identity = validateOpaqueIdentity(source.performanceId);
  const needsPrivateLocator = typeof identity !== 'string' || streamerSlug === undefined;
  return {
    ...(streamerSlug === undefined ? {} : { streamerSlug }),
    entityType: 'performance',
    ...(typeof identity === 'string' ? { entityId: identity } : {}),
    ...(needsPrivateLocator ? { details: { rowId: source.rowId } } : {}),
  };
}

function validateSlugIdentity(value: string | null): IdentityValue {
  if (isBlankText(value)) return MISSING_IDENTITY;
  if (!hasValidUnicodeScalars(value ?? '') || !isValidStreamerSlug(value ?? '')) return INVALID_IDENTITY;
  return value ?? '';
}

function validateVideoIdentity(value: string | null): IdentityValue {
  if (isBlankText(value)) return MISSING_IDENTITY;
  if (!hasValidUnicodeScalars(value ?? '') || !isValidVideoId(value ?? '')) return INVALID_IDENTITY;
  return value ?? '';
}

function validateOpaqueIdentity(value: string | null): IdentityValue {
  if (isBlankText(value)) return MISSING_IDENTITY;
  if (!hasValidUnicodeScalars(value ?? '')) return INVALID_IDENTITY;
  return value ?? '';
}

function indexBy<T>(values: readonly T[], key: (value: T) => string): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    const entryKey = key(value);
    if (!result.has(entryKey)) result.set(entryKey, value);
  }
  return result;
}

function groupDefined<T>(
  values: readonly T[],
  key: (value: T) => string | undefined,
): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const value of values) {
    const entryKey = key(value);
    if (entryKey === undefined) continue;
    const group = result.get(entryKey) ?? [];
    group.push(value);
    result.set(entryKey, group);
  }
  return result;
}

function setSocialFlag(details: FindingDetails, provider: (typeof SOCIAL_PROVIDERS)[number]): void {
  switch (provider) {
    case 'youtube':
      details.youtube = true;
      break;
    case 'twitter':
      details.twitter = true;
      break;
    case 'facebook':
      details.facebook = true;
      break;
    case 'instagram':
      details.instagram = true;
      break;
    case 'twitch':
      details.twitch = true;
      break;
  }
}

function releaseOwnedRows<T>(rows: readonly T[]): void {
  const ownedRows = rows as unknown as Array<T | undefined>;
  for (let index = 0; index < ownedRows.length; index += 1) {
    ownedRows[index] = undefined;
  }
}

function releaseOwnedRow<T>(rows: readonly T[], index: number): void {
  (rows as unknown as Array<T | undefined>)[index] = undefined;
}
