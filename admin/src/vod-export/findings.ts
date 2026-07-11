import { SOCIAL_PROVIDERS, VOD_EXPORT_LIMITS } from './constants';
import { ExportLimitExceededError, capacityDiagnostic } from './limits';
import {
  hasValidUnicodeScalars,
  isBlankText,
  isValidStreamerSlug,
  isValidVideoId,
  jsonStringByteLength,
  utf8ByteLength,
} from './normalization';
import { compareFindings } from './ordering';
import type {
  CapacityDiagnostic,
  FindingCode,
  FindingDetails,
  FindingEntityType,
  FindingSeverity,
  PublicFindingField,
  VodExportFinding,
  VodExportValidationResult,
} from './types';

const FINDING_SEVERITY: Readonly<Record<FindingCode, FindingSeverity>> = {
  MISSING_STREAMER_SLUG: 'error',
  INVALID_STREAMER_SLUG: 'error',
  DUPLICATE_STREAMER_SLUG: 'error',
  MISSING_DISPLAY_NAME: 'error',
  MISSING_YOUTUBE_CHANNEL_ID: 'error',
  UNVERIFIED_YOUTUBE_CHANNEL_ID: 'error',
  DUPLICATE_YOUTUBE_CHANNEL_ID: 'error',
  MISSING_VOD_RELATION: 'error',
  MISSING_SONG_RELATION: 'error',
  VOD_STREAMER_MISMATCH: 'error',
  SONG_STREAMER_MISMATCH: 'error',
  MISSING_VIDEO_ID: 'error',
  INVALID_VIDEO_ID: 'error',
  DUPLICATE_VOD_VIDEO_ID: 'error',
  MISSING_VOD_TITLE: 'error',
  MISSING_VOD_DATE: 'error',
  INVALID_VOD_DATE: 'error',
  MISSING_SONG_ID: 'error',
  MISSING_SONG_TITLE: 'error',
  MISSING_PERFORMANCE_ID: 'error',
  INVALID_UNICODE_TEXT: 'error',
  MISSING_START_SECONDS: 'error',
  INVALID_START_SECONDS: 'error',
  MISSING_END_SECONDS: 'error',
  INVALID_END_SECONDS: 'error',
  INVALID_END_RANGE: 'error',
  UNSAFE_AVATAR_URL: 'warning',
  UNSAFE_SOCIAL_LINK: 'warning',
  MISSING_ORIGINAL_ARTIST: 'warning',
};

const FINDING_MESSAGE: Readonly<Record<FindingCode, string>> = {
  MISSING_STREAMER_SLUG: 'Streamer slug is required.',
  INVALID_STREAMER_SLUG: 'Streamer slug does not match the canonical format.',
  DUPLICATE_STREAMER_SLUG: 'Streamer slug is bound to multiple approved, enabled streamers.',
  MISSING_DISPLAY_NAME: 'Streamer display name is required.',
  MISSING_YOUTUBE_CHANNEL_ID: 'Verified YouTube channel ID is required.',
  UNVERIFIED_YOUTUBE_CHANNEL_ID: 'YouTube channel ID does not match persisted verification state.',
  DUPLICATE_YOUTUBE_CHANNEL_ID: 'YouTube channel ID is bound to multiple approved, enabled streamers.',
  MISSING_VOD_RELATION: 'Approved performance references a missing VOD.',
  MISSING_SONG_RELATION: 'Approved performance references a missing song.',
  VOD_STREAMER_MISMATCH: 'Performance and referenced VOD belong to different streamers.',
  SONG_STREAMER_MISMATCH: 'Performance and referenced song belong to different streamers.',
  MISSING_VIDEO_ID: 'VOD video ID is required.',
  INVALID_VIDEO_ID: 'VOD video ID does not match the canonical 11-character format.',
  DUPLICATE_VOD_VIDEO_ID: 'VOD video ID occurs more than once for this streamer.',
  MISSING_VOD_TITLE: 'Canonical VOD title is required.',
  MISSING_VOD_DATE: 'Canonical VOD date is required.',
  INVALID_VOD_DATE: 'Canonical VOD date must be a real date in YYYY-MM-DD form.',
  MISSING_SONG_ID: 'Song ID is required.',
  MISSING_SONG_TITLE: 'Canonical song title is required.',
  MISSING_PERFORMANCE_ID: 'Performance ID is required.',
  INVALID_UNICODE_TEXT: 'Public text contains invalid Unicode.',
  MISSING_START_SECONDS: 'Performance startSeconds is required.',
  INVALID_START_SECONDS: 'Performance startSeconds must be a non-negative safe integer stored as SQLite INTEGER.',
  MISSING_END_SECONDS: 'Performance endSeconds is required.',
  INVALID_END_SECONDS: 'Performance endSeconds must be a non-negative safe integer stored as SQLite INTEGER.',
  INVALID_END_RANGE: 'Performance endSeconds must be greater than startSeconds.',
  UNSAFE_AVATAR_URL: 'Unsafe avatar URL was replaced with null.',
  UNSAFE_SOCIAL_LINK: 'Unsafe social links were omitted.',
  MISSING_ORIGINAL_ARTIST: 'Original artist is missing and was replaced with null.',
};

const CODE_DETAIL_KEYS: Readonly<Partial<Record<FindingCode, readonly (keyof FindingDetails)[]>>> = {
  MISSING_STREAMER_SLUG: ['submissionId'],
  INVALID_STREAMER_SLUG: ['submissionId'],
  DUPLICATE_STREAMER_SLUG: ['duplicateCount'],
  DUPLICATE_YOUTUBE_CHANNEL_ID: ['duplicateCount'],
  MISSING_VIDEO_ID: ['streamId'],
  INVALID_VIDEO_ID: ['streamId'],
  DUPLICATE_VOD_VIDEO_ID: ['duplicateCount'],
  MISSING_SONG_ID: ['rowId'],
  MISSING_PERFORMANCE_ID: ['rowId'],
  INVALID_END_RANGE: ['startSeconds', 'endSeconds'],
  UNSAFE_SOCIAL_LINK: SOCIAL_PROVIDERS,
  MISSING_ORIGINAL_ARTIST: ['affectedPerformanceCount'],
};

const CODE_REQUIRED_DETAIL_KEYS: Readonly<Partial<Record<FindingCode, readonly (keyof FindingDetails)[]>>> = {
  MISSING_STREAMER_SLUG: ['submissionId'],
  INVALID_STREAMER_SLUG: ['submissionId'],
  DUPLICATE_STREAMER_SLUG: ['duplicateCount'],
  DUPLICATE_YOUTUBE_CHANNEL_ID: ['duplicateCount'],
  MISSING_VIDEO_ID: ['streamId'],
  INVALID_VIDEO_ID: ['streamId'],
  DUPLICATE_VOD_VIDEO_ID: ['duplicateCount'],
  MISSING_SONG_ID: ['rowId'],
  MISSING_PERFORMANCE_ID: ['rowId'],
  INVALID_END_RANGE: ['startSeconds', 'endSeconds'],
  MISSING_ORIGINAL_ARTIST: ['affectedPerformanceCount'],
};

const DETAIL_KEY_ORDER: readonly (keyof FindingDetails)[] = [
  'submissionId',
  'streamId',
  'rowId',
  'duplicateCount',
  'startSeconds',
  'endSeconds',
  'affectedPerformanceCount',
  ...SOCIAL_PROVIDERS,
];

const RESPONSE_SUFFIX_BYTES = utf8ByteLength(']}');

export interface FindingInput {
  code: FindingCode;
  streamerSlug?: string;
  entityType: FindingEntityType;
  entityId?: string;
  field?: PublicFindingField;
  details?: FindingDetails;
}

export class FindingCollector {
  private readonly findings: VodExportFinding[] = [];
  private readonly dedupeKeys = new Set<string>();
  private serializedEntriesBytes = 0;
  private hasError = false;

  add(input: FindingInput): void {
    const finding = createFinding(input);
    const dedupeKey = findingDedupeKey(finding);
    if (this.dedupeKeys.has(dedupeKey)) return;

    const nextCount = this.findings.length + 1;
    if (nextCount > VOD_EXPORT_LIMITS.findings) {
      throw new ExportLimitExceededError(capacityDiagnostic('findings', nextCount));
    }

    const serializedFindingBytes = findingJsonByteLength(finding);
    const nextEntriesBytes = this.serializedEntriesBytes + serializedFindingBytes + (this.findings.length > 0 ? 1 : 0);
    const nextHasError = this.hasError || finding.severity === 'error';
    const nextResponseBytes = responsePrefixBytes(nextHasError) + nextEntriesBytes + RESPONSE_SUFFIX_BYTES;
    if (nextResponseBytes > VOD_EXPORT_LIMITS.findingsBytes) {
      throw new ExportLimitExceededError(capacityDiagnostic('findingsBytes', nextResponseBytes));
    }

    this.findings.push(finding);
    this.dedupeKeys.add(dedupeKey);
    this.serializedEntriesBytes = nextEntriesBytes;
    this.hasError = nextHasError;
  }

  complete(): VodExportValidationResult {
    return {
      canPublish: !this.hasError,
      findings: [...this.findings].sort(compareFindings),
    };
  }

  capacity(): CapacityDiagnostic[] {
    return [
      capacityDiagnostic('findings', this.findings.length),
      capacityDiagnostic('findingsBytes', this.responseByteLength()),
    ];
  }

  responseByteLength(): number {
    return responsePrefixBytes(this.hasError) + this.serializedEntriesBytes + RESPONSE_SUFFIX_BYTES;
  }
}

export function createFinding(input: FindingInput): VodExportFinding {
  validateFindingContext(input);
  const details = normalizeAndValidateDetails(input);
  const finding: VodExportFinding = {
    code: input.code,
    severity: FINDING_SEVERITY[input.code],
    message: FINDING_MESSAGE[input.code],
  } as VodExportFinding;

  if (input.streamerSlug !== undefined) finding.streamerSlug = input.streamerSlug;
  finding.entityType = input.entityType;
  if (input.entityId !== undefined) finding.entityId = input.entityId;
  if (input.field !== undefined) finding.field = input.field;
  if (details !== undefined) finding.details = details;
  return finding;
}

export function serializeValidationResult(result: VodExportValidationResult): string {
  return JSON.stringify({ canPublish: result.canPublish, findings: result.findings });
}

function normalizeAndValidateDetails(input: FindingInput): FindingDetails | undefined {
  const providedDetails = input.details ?? {};
  const actualKeys = Object.keys(providedDetails) as (keyof FindingDetails)[];
  const allowedKeys = new Set<keyof FindingDetails>(CODE_DETAIL_KEYS[input.code] ?? []);
  const needsFallbackLocator = input.entityId === undefined || input.streamerSlug === undefined;
  if (needsFallbackLocator) {
    const fallbackKey = fallbackKeyForEntity(input.entityType);
    allowedKeys.add(fallbackKey);
  }
  for (const key of actualKeys) {
      if (!allowedKeys.has(key)) throw new TypeError(`Finding ${input.code} does not allow details.${key}`);
  }

  const requiredKeys = new Set<keyof FindingDetails>(CODE_REQUIRED_DETAIL_KEYS[input.code] ?? []);
  if (needsFallbackLocator) requiredKeys.add(fallbackKeyForEntity(input.entityType));
  for (const key of requiredKeys) {
    if (providedDetails[key] === undefined) throw new TypeError(`Finding ${input.code} requires details.${key}`);
  }
  if (
    input.code === 'UNSAFE_SOCIAL_LINK' &&
    !SOCIAL_PROVIDERS.some((provider) => providedDetails[provider] === true)
  ) {
    throw new TypeError('Finding UNSAFE_SOCIAL_LINK requires at least one rejected provider flag');
  }

  const normalized: FindingDetails = {};
  for (const key of DETAIL_KEY_ORDER) {
    const value = providedDetails[key];
    if (value === undefined) continue;
    validateDetailValue(key, value);
    setDetail(normalized, key, value);
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function validateDetailValue(key: keyof FindingDetails, value: string | number | boolean): void {
  if (key === 'submissionId' || key === 'streamId') {
    if (
      typeof value !== 'string' ||
      value.length === 0 ||
      !hasValidUnicodeScalars(value)
    ) {
      throw new TypeError(`details.${key} must be a bounded non-empty Unicode string`);
    }
    return;
  }

  if ((SOCIAL_PROVIDERS as readonly string[]).includes(key)) {
    if (value !== true) throw new TypeError(`details.${key} must be true when present`);
    return;
  }

  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`details.${key} must be a non-negative safe integer`);
  }
  if ((key === 'duplicateCount' && value < 2) || (key === 'affectedPerformanceCount' && value < 1)) {
    throw new TypeError(`details.${key} is below its allowed minimum`);
  }
}

function setDetail(
  target: FindingDetails,
  key: keyof FindingDetails,
  value: string | number | boolean,
): void {
  // Assignment through a switch retains strict primitive types without an
  // index signature that would permit arbitrary diagnostic keys.
  switch (key) {
    case 'submissionId':
    case 'streamId':
      target[key] = value as string;
      break;
    case 'rowId':
    case 'duplicateCount':
    case 'startSeconds':
    case 'endSeconds':
    case 'affectedPerformanceCount':
      target[key] = value as number;
      break;
    case 'youtube':
    case 'twitter':
    case 'facebook':
    case 'instagram':
    case 'twitch':
      target[key] = value as boolean;
      break;
  }
}

function fallbackKeyForEntity(entityType: FindingEntityType): 'submissionId' | 'streamId' | 'rowId' {
  if (entityType === 'streamer') return 'submissionId';
  if (entityType === 'vod') return 'streamId';
  return 'rowId';
}

function findingDedupeKey(finding: VodExportFinding): string {
  const identity = finding.entityId === undefined ? fallbackLocator(finding.details) : finding.entityId;
  return [
    finding.code,
    finding.streamerSlug ?? '',
    finding.entityType,
    identity,
    finding.field ?? '',
  ].join('\u0000');
}

function fallbackLocator(details: FindingDetails | undefined): string {
  if (details?.submissionId !== undefined) return `submission:${details.submissionId}`;
  if (details?.streamId !== undefined) return `stream:${details.streamId}`;
  if (details?.rowId !== undefined) return `row:${details.rowId}`;
  return '';
}

function responsePrefixBytes(hasError: boolean): number {
  return utf8ByteLength(`{"canPublish":${hasError ? 'false' : 'true'},"findings":[`);
}

function validateFindingContext(input: FindingInput): void {
  if (input.streamerSlug !== undefined && !isValidStreamerSlug(input.streamerSlug)) {
    throw new TypeError('Finding streamerSlug must be a safe canonical public slug');
  }
  if (input.entityId === undefined) return;
  if (isBlankText(input.entityId) || !hasValidUnicodeScalars(input.entityId)) {
    throw new TypeError('Finding entityId must be a non-empty valid Unicode public identifier');
  }
  if (input.entityType === 'streamer' && input.entityId !== input.streamerSlug) {
    throw new TypeError('Streamer finding entityId must equal streamerSlug');
  }
  if (input.entityType === 'vod' && !isValidVideoId(input.entityId)) {
    throw new TypeError('VOD finding entityId must be a canonical videoId');
  }
}

function findingJsonByteLength(finding: VodExportFinding): number {
  let byteLength = 2;
  let propertyCount = 0;
  const addProperty = (key: string, valueLength: number): void => {
    if (propertyCount > 0) byteLength += 1;
    byteLength += jsonStringByteLength(key) + 1 + valueLength;
    propertyCount += 1;
  };

  addProperty('code', jsonStringByteLength(finding.code));
  addProperty('severity', jsonStringByteLength(finding.severity));
  addProperty('message', jsonStringByteLength(finding.message));
  if (finding.streamerSlug !== undefined) {
    addProperty('streamerSlug', jsonStringByteLength(finding.streamerSlug));
  }
  addProperty('entityType', jsonStringByteLength(finding.entityType));
  if (finding.entityId !== undefined) addProperty('entityId', jsonStringByteLength(finding.entityId));
  if (finding.field !== undefined) addProperty('field', jsonStringByteLength(finding.field));
  if (finding.details !== undefined) addProperty('details', detailsJsonByteLength(finding.details));
  return byteLength;
}

function detailsJsonByteLength(details: FindingDetails): number {
  let byteLength = 2;
  let propertyCount = 0;
  for (const key of DETAIL_KEY_ORDER) {
    const value = details[key];
    if (value === undefined) continue;
    if (propertyCount > 0) byteLength += 1;
    byteLength += jsonStringByteLength(key) + 1;
    if (typeof value === 'string') byteLength += jsonStringByteLength(value);
    else if (typeof value === 'boolean') byteLength += value ? 4 : 5;
    else byteLength += String(value).length;
    propertyCount += 1;
  }
  return byteLength;
}
