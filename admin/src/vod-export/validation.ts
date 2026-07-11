import { SOCIAL_PROVIDERS, VOD_EXPORT_SCHEMA_VERSION } from './constants';
import { FindingCollector, type FindingInput } from './findings';
import {
  assertWithinCapacity,
  measureSourceCapacity,
} from './limits';
import {
  hasValidUnicodeScalars,
  isBlankText,
  isValidDateOnly,
  isValidRfc3339Timestamp,
  isValidStreamerSlug,
  isValidVideoId,
  normalizeDisplayText,
  parseSqliteInteger,
  validateOptionalSafeUrl,
} from './normalization';
import { orderSnapshot } from './ordering';
import type {
  ExportSourcePerformance,
  ExportSourceSong,
  ExportSourceStreamer,
  ExportSourceVod,
  FindingDetails,
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

type IdentityResult =
  | { kind: 'value'; value: string }
  | { kind: 'missing' }
  | { kind: 'invalid-unicode' };

interface ValidatedStreamerRecord {
  source: ExportSourceStreamer;
  slug?: string;
  verifiedChannelId?: string;
  publicBase?: Omit<VodExportStreamer, 'vods'>;
}

interface EligibleOccurrence {
  streamerSlug: string;
  performance: ExportSourcePerformance;
  vod: ExportSourceVod;
  song: ExportSourceSong;
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

type ValidatedPerformance = {
  valid: true;
  performanceId: string;
  startSeconds: number;
  endSeconds: number;
} | {
  valid: false;
  performanceId?: string;
  startSeconds?: number;
  endSeconds?: number;
};

export function buildVodExportSnapshot(source: VodExportSourceData): VodExportBuildResult {
  const capacity = measureSourceCapacity(source);
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

  const streamerScope = new Map<string, string | undefined>();
  for (const record of streamerRecords) {
    const rawSlug = record.source.slug;
    if (rawSlug !== null && !streamerScope.has(rawSlug)) {
      streamerScope.set(rawSlug, record.slug);
    }
  }
  const vodByStreamId = indexBy(source.vods, (vod) => vod.streamId);
  const songBySongId = indexBy(
    source.songs.filter((song): song is ExportSourceSong & { songId: string } => song.songId !== null),
    (song) => song.songId,
  );
  const eligibleOccurrences = collectEligibleOccurrences(
    source.performances,
    streamerScope,
    vodByStreamId,
    songBySongId,
    collector,
  );

  const eligibleVods = new Set(eligibleOccurrences.map((occurrence) => occurrence.vod));
  // The same rule applies to eligible VODs/occurrences: invalid public fields
  // block all bytes instead of shrinking the output. On every successful build
  // these prospective counts equal the assembled canonical snapshot exactly.
  const prospectiveCounts: VodExportCounts = {
    streamers: selectedStreamers.length,
    vods: eligibleVods.size,
    performances: eligibleOccurrences.length,
  };
  capacity.push(
    assertWithinCapacity('vods', prospectiveCounts.vods),
    assertWithinCapacity('performances', prospectiveCounts.performances),
  );

  const validatedVods = new Map<ExportSourceVod, VodExportVod | null>();
  for (const vod of eligibleVods) {
    validatedVods.set(vod, validateVod(vod, collector));
  }
  addDuplicateVodFindings(eligibleVods, collector);

  const eligibleSongs = new Set(eligibleOccurrences.map((occurrence) => occurrence.song));
  const validatedSongs = new Map<ExportSourceSong, ValidatedSong>();
  for (const song of eligibleSongs) {
    validatedSongs.set(song, validateSong(song, collector));
  }

  const validatedPerformances = new Map<ExportSourcePerformance, ValidatedPerformance>();
  for (const occurrence of eligibleOccurrences) {
    if (!validatedPerformances.has(occurrence.performance)) {
      validatedPerformances.set(
        occurrence.performance,
        validatePerformance(occurrence.performance, occurrence.streamerSlug, collector),
      );
    }
  }
  addMissingArtistWarnings(eligibleOccurrences, validatedSongs, collector);

  const provisionalSnapshot = assembleSnapshot(
    streamerRecords,
    eligibleOccurrences,
    validatedVods,
    validatedSongs,
    validatedPerformances,
  );
  const validation = collector.complete();
  capacity.push(...collector.capacity());

  return {
    ...validation,
    snapshot: validation.canPublish ? orderSnapshot(provisionalSnapshot) : null,
    counts: prospectiveCounts,
    capacity,
  };
}

function validateStreamer(source: ExportSourceStreamer, collector: FindingCollector): ValidatedStreamerRecord {
  const slugResult = validateSlugIdentity(source.slug);
  const slug = slugResult.kind === 'value' ? slugResult.value : undefined;
  if (slugResult.kind === 'missing') {
    addStreamerFinding(collector, source, undefined, 'MISSING_STREAMER_SLUG', 'slug');
  } else if (slugResult.kind !== 'value') {
    addStreamerFinding(collector, source, undefined, 'INVALID_STREAMER_SLUG', 'slug');
  }

  const displayName = normalizeDisplayText(source.displayName);
  if (displayName.kind === 'missing') {
    addStreamerFinding(collector, source, slug, 'MISSING_DISPLAY_NAME', 'displayName');
  } else if (displayName.kind === 'invalid-unicode') {
    addStreamerFinding(collector, source, slug, 'INVALID_UNICODE_TEXT', 'displayName');
  }

  const channelIdentity = validateOpaqueIdentity(source.youtubeChannelId);
  let verifiedChannelId: string | undefined;
  if (channelIdentity.kind === 'missing') {
    addStreamerFinding(collector, source, slug, 'MISSING_YOUTUBE_CHANNEL_ID', 'youtubeChannelId');
  } else if (channelIdentity.kind === 'invalid-unicode') {
    addStreamerFinding(collector, source, slug, 'INVALID_UNICODE_TEXT', 'youtubeChannelId');
  } else {
    const verificationIsValid =
      source.verifiedYoutubeChannelId === channelIdentity.value &&
      source.youtubeChannelVerifiedAt !== null &&
      !isBlankText(source.youtubeChannelVerifiedAt) &&
      hasValidUnicodeScalars(source.youtubeChannelVerifiedAt) &&
      isValidRfc3339Timestamp(source.youtubeChannelVerifiedAt);
    if (verificationIsValid) {
      verifiedChannelId = channelIdentity.value;
    } else {
      addStreamerFinding(collector, source, slug, 'UNVERIFIED_YOUTUBE_CHANNEL_ID', 'youtubeChannelId');
    }
  }

  const avatar = validateOptionalSafeUrl(source.avatarUrl, 'avatar');
  if (avatar.kind === 'unsafe') {
    addStreamerFinding(collector, source, slug, 'UNSAFE_AVATAR_URL', 'avatarUrl');
  }

  const group = normalizeDisplayText(source.group);
  if (group.kind === 'invalid-unicode') {
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
    displayName.kind === 'value' &&
    verifiedChannelId !== undefined &&
    group.kind !== 'invalid-unicode'
  ) {
    publicBase = {
      slug,
      displayName: displayName.value,
      youtubeChannelId: verifiedChannelId,
      avatarUrl: avatar.kind === 'safe' ? avatar.url : null,
      group: group.kind === 'value' ? group.value : null,
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
      addStreamerFinding(
        collector,
        record.source,
        record.slug,
        'DUPLICATE_YOUTUBE_CHANNEL_ID',
        'youtubeChannelId',
        { duplicateCount: duplicates.length },
      );
    }
  }
}

function collectEligibleOccurrences(
  performances: readonly ExportSourcePerformance[],
  streamerScope: ReadonlyMap<string, string | undefined>,
  vodByStreamId: ReadonlyMap<string, ExportSourceVod>,
  songBySongId: ReadonlyMap<string, ExportSourceSong>,
  collector: FindingCollector,
): EligibleOccurrence[] {
  const eligible: EligibleOccurrence[] = [];
  for (const performance of performances) {
    if (performance.status !== 'approved' || !streamerScope.has(performance.streamerId)) continue;

    const safeStreamerSlug = streamerScope.get(performance.streamerId);
    const vod = vodByStreamId.get(performance.streamId);
    const song = songBySongId.get(performance.songId);
    const context = performanceContext(performance, safeStreamerSlug);
    if (vod === undefined) collector.add({ ...context, code: 'MISSING_VOD_RELATION' });
    if (song === undefined) collector.add({ ...context, code: 'MISSING_SONG_RELATION' });

    const vodMatches = vod === undefined || vod.streamerId === performance.streamerId;
    const songMatches = song === undefined || song.streamerId === performance.streamerId;
    if (vod !== undefined && !vodMatches) collector.add({ ...context, code: 'VOD_STREAMER_MISMATCH' });
    if (song !== undefined && !songMatches) collector.add({ ...context, code: 'SONG_STREAMER_MISMATCH' });

    if (
      vod !== undefined &&
      song !== undefined &&
      safeStreamerSlug !== undefined &&
      vodMatches &&
      songMatches &&
      vod.status === 'approved' &&
      song.status === 'approved'
    ) {
      eligible.push({ streamerSlug: safeStreamerSlug, performance, vod, song });
    }
  }
  return eligible;
}

function validateVod(source: ExportSourceVod, collector: FindingCollector): VodExportVod | null {
  const videoIdentity = validateVideoIdentity(source.videoId);
  const videoId = videoIdentity.kind === 'value' ? videoIdentity.value : undefined;
  if (videoIdentity.kind === 'missing') {
    addVodFinding(collector, source, undefined, 'MISSING_VIDEO_ID', 'videoId');
  } else if (videoIdentity.kind !== 'value') {
    addVodFinding(collector, source, undefined, 'INVALID_VIDEO_ID', 'videoId');
  }

  const title = normalizeDisplayText(source.title);
  if (title.kind === 'missing') {
    addVodFinding(collector, source, videoId, 'MISSING_VOD_TITLE', 'title');
  } else if (title.kind === 'invalid-unicode') {
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

  if (videoId === undefined || title.kind !== 'value' || date === undefined) return null;
  return { title: title.value, date, videoId, performances: [] };
}

function addDuplicateVodFindings(
  vods: ReadonlySet<ExportSourceVod>,
  collector: FindingCollector,
): void {
  const byStreamer = new Map<string, Map<string, ExportSourceVod[]>>();
  for (const vod of vods) {
    const identity = validateVideoIdentity(vod.videoId);
    if (identity.kind !== 'value') continue;
    let byVideo = byStreamer.get(vod.streamerId);
    if (byVideo === undefined) {
      byVideo = new Map();
      byStreamer.set(vod.streamerId, byVideo);
    }
    const rows = byVideo.get(identity.value) ?? [];
    rows.push(vod);
    byVideo.set(identity.value, rows);
  }

  for (const [streamerSlug, byVideo] of byStreamer) {
    for (const [videoId, duplicates] of byVideo) {
      if (duplicates.length < 2) continue;
      collector.add({
        code: 'DUPLICATE_VOD_VIDEO_ID',
        streamerSlug,
        entityType: 'vod',
        entityId: videoId,
        field: 'videoId',
        details: { duplicateCount: duplicates.length },
      });
    }
  }
}

function validateSong(source: ExportSourceSong, collector: FindingCollector): ValidatedSong {
  const songIdentity = validateOpaqueIdentity(source.songId);
  const songId = songIdentity.kind === 'value' ? songIdentity.value : undefined;
  if (songIdentity.kind === 'missing') {
    addSongFinding(collector, source, undefined, 'MISSING_SONG_ID', 'songId');
  } else if (songIdentity.kind === 'invalid-unicode') {
    addSongFinding(collector, source, undefined, 'INVALID_UNICODE_TEXT', 'songId');
  }

  const title = normalizeDisplayText(source.title);
  if (title.kind === 'missing') {
    addSongFinding(collector, source, songId, 'MISSING_SONG_TITLE', 'title');
  } else if (title.kind === 'invalid-unicode') {
    addSongFinding(collector, source, songId, 'INVALID_UNICODE_TEXT', 'title');
  }

  const artist = normalizeDisplayText(source.originalArtist);
  if (artist.kind === 'invalid-unicode') {
    addSongFinding(collector, source, songId, 'INVALID_UNICODE_TEXT', 'originalArtist');
  }

  const originalArtist = artist.kind === 'value' ? artist.value : null;
  const artistMissing = artist.kind === 'missing';
  if (songId !== undefined && title.kind === 'value' && artist.kind !== 'invalid-unicode') {
    return { valid: true, songId, title: title.value, originalArtist, artistMissing };
  }
  return {
    valid: false,
    ...(songId === undefined ? {} : { songId }),
    ...(title.kind === 'value' ? { title: title.value } : {}),
    originalArtist,
    artistMissing,
  };
}

function validatePerformance(
  source: ExportSourcePerformance,
  streamerSlug: string,
  collector: FindingCollector,
): ValidatedPerformance {
  const identity = validateOpaqueIdentity(source.performanceId);
  const performanceId = identity.kind === 'value' ? identity.value : undefined;
  if (identity.kind === 'missing') {
    addPerformanceFinding(collector, source, streamerSlug, undefined, 'MISSING_PERFORMANCE_ID', 'performanceId');
  } else if (identity.kind === 'invalid-unicode') {
    addPerformanceFinding(collector, source, streamerSlug, undefined, 'INVALID_UNICODE_TEXT', 'performanceId');
  }

  const parsedStart = parseSqliteInteger(source.startSeconds);
  let startSeconds: number | undefined;
  if (parsedStart.kind === 'missing') {
    addPerformanceFinding(collector, source, streamerSlug, performanceId, 'MISSING_START_SECONDS', 'startSeconds');
  } else if (parsedStart.kind === 'invalid' || parsedStart.value < 0) {
    addPerformanceFinding(collector, source, streamerSlug, performanceId, 'INVALID_START_SECONDS', 'startSeconds');
  } else {
    startSeconds = parsedStart.value;
  }

  const parsedEnd = parseSqliteInteger(source.endSeconds);
  let endSeconds: number | undefined;
  if (parsedEnd.kind === 'missing') {
    addPerformanceFinding(collector, source, streamerSlug, performanceId, 'MISSING_END_SECONDS', 'endSeconds');
  } else if (parsedEnd.kind === 'invalid' || parsedEnd.value < 0) {
    addPerformanceFinding(collector, source, streamerSlug, performanceId, 'INVALID_END_SECONDS', 'endSeconds');
  } else {
    endSeconds = parsedEnd.value;
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
    startSeconds !== undefined &&
    endSeconds !== undefined &&
    endSeconds > startSeconds
  ) {
    return { valid: true, performanceId, startSeconds, endSeconds };
  }
  return {
    valid: false,
    ...(performanceId === undefined ? {} : { performanceId }),
    ...(startSeconds === undefined ? {} : { startSeconds }),
    ...(endSeconds === undefined ? {} : { endSeconds }),
  };
}

function addMissingArtistWarnings(
  occurrences: readonly EligibleOccurrence[],
  validatedSongs: ReadonlyMap<ExportSourceSong, ValidatedSong>,
  collector: FindingCollector,
): void {
  const counts = new Map<ExportSourceSong, number>();
  for (const occurrence of occurrences) {
    const validated = validatedSongs.get(occurrence.song);
    if (validated?.artistMissing) counts.set(occurrence.song, (counts.get(occurrence.song) ?? 0) + 1);
  }

  for (const [song, affectedPerformanceCount] of counts) {
    const identity = validateOpaqueIdentity(song.songId);
    const songId = identity.kind === 'value' ? identity.value : undefined;
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
  occurrences: readonly EligibleOccurrence[],
  validatedVods: ReadonlyMap<ExportSourceVod, VodExportVod | null>,
  validatedSongs: ReadonlyMap<ExportSourceSong, ValidatedSong>,
  validatedPerformances: ReadonlyMap<ExportSourcePerformance, ValidatedPerformance>,
): VodExportSnapshot {
  const occurrencesBySlug = groupBy(occurrences, (occurrence) => occurrence.streamerSlug);
  const streamers: VodExportStreamer[] = [];

  for (const record of streamerRecords) {
    if (record.publicBase === undefined || record.slug === undefined) continue;
    const performancesByVod = new Map<ExportSourceVod, VodExportPerformance[]>();

    for (const occurrence of occurrencesBySlug.get(record.slug) ?? []) {
      const vod = validatedVods.get(occurrence.vod);
      const song = validatedSongs.get(occurrence.song);
      const performance = validatedPerformances.get(occurrence.performance);
      if (vod === null || vod === undefined || song === undefined || performance === undefined) continue;
      if (!song.valid || !performance.valid) continue;

      const output: VodExportPerformance = {
        performanceId: performance.performanceId,
        songId: song.songId,
        title: song.title,
        originalArtist: song.originalArtist,
        startSeconds: performance.startSeconds,
        endSeconds: performance.endSeconds,
      };
      const list = performancesByVod.get(occurrence.vod) ?? [];
      list.push(output);
      performancesByVod.set(occurrence.vod, list);
    }

    const vods: VodExportVod[] = [];
    for (const [sourceVod, performances] of performancesByVod) {
      if (performances.length === 0) continue;
      const vod = validatedVods.get(sourceVod);
      if (vod !== null && vod !== undefined) vods.push({ ...vod, performances });
    }
    streamers.push({ ...record.publicBase, vods });
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
  const needsPrivateLocator = identity.kind !== 'value' || streamerSlug === undefined;
  return {
    ...(streamerSlug === undefined ? {} : { streamerSlug }),
    entityType: 'performance',
    ...(identity.kind === 'value' ? { entityId: identity.value } : {}),
    ...(needsPrivateLocator ? { details: { rowId: source.rowId } } : {}),
  };
}

function validateSlugIdentity(value: string | null): IdentityResult {
  if (isBlankText(value)) return { kind: 'missing' };
  if (!hasValidUnicodeScalars(value ?? '') || !isValidStreamerSlug(value ?? '')) return { kind: 'invalid-unicode' };
  return { kind: 'value', value: value ?? '' };
}

function validateVideoIdentity(value: string | null): IdentityResult {
  if (isBlankText(value)) return { kind: 'missing' };
  if (!hasValidUnicodeScalars(value ?? '') || !isValidVideoId(value ?? '')) return { kind: 'invalid-unicode' };
  return { kind: 'value', value: value ?? '' };
}

function validateOpaqueIdentity(value: string | null): IdentityResult {
  if (isBlankText(value)) return { kind: 'missing' };
  if (!hasValidUnicodeScalars(value ?? '')) return { kind: 'invalid-unicode' };
  return { kind: 'value', value: value ?? '' };
}

function indexBy<T>(values: readonly T[], key: (value: T) => string): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    const entryKey = key(value);
    if (!result.has(entryKey)) result.set(entryKey, value);
  }
  return result;
}

function groupBy<T>(values: readonly T[], key: (value: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const value of values) {
    const entryKey = key(value);
    const group = result.get(entryKey) ?? [];
    group.push(value);
    result.set(entryKey, group);
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
