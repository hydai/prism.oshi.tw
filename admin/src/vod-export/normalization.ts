import type { SocialProvider } from './constants';
import type { SqliteIntegerSource } from './types';

const CONFIRMED_WHITESPACE =
  '[\\u0009-\\u000D\\u0020\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]';
const LEADING_CONFIRMED_WHITESPACE = new RegExp(`^${CONFIRMED_WHITESPACE}+`, 'u');
const TRAILING_CONFIRMED_WHITESPACE = new RegExp(`${CONFIRMED_WHITESPACE}+$`, 'u');

const STREAMER_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const DECIMAL_INTEGER_PATTERN = /^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const RFC3339_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/;

const ALLOWED_HOSTS: Readonly<Record<UrlProvider, ReadonlySet<string>>> = {
  youtube: new Set(['youtube.com', 'm.youtube.com', 'youtu.be']),
  twitter: new Set(['twitter.com', 'mobile.twitter.com', 'x.com']),
  facebook: new Set(['facebook.com', 'm.facebook.com', 'fb.com']),
  instagram: new Set(['instagram.com']),
  twitch: new Set(['twitch.tv']),
  avatar: new Set([
    'yt3.ggpht.com',
    'yt4.ggpht.com',
    'yt3.googleusercontent.com',
    'lh3.googleusercontent.com',
  ]),
};

export type UrlProvider = SocialProvider | 'avatar';

export type NormalizedDisplayText =
  | { kind: 'value'; value: string }
  | { kind: 'missing' }
  | { kind: 'invalid-unicode' };

export type OptionalSafeUrl =
  | { kind: 'safe'; url: string }
  | { kind: 'absent' }
  | { kind: 'unsafe' };

export type ParsedSqliteInteger =
  | { kind: 'value'; value: number }
  | { kind: 'missing' }
  | { kind: 'invalid' };

export function trimConfirmedWhitespace(value: string): string {
  return value.replace(LEADING_CONFIRMED_WHITESPACE, '').replace(TRAILING_CONFIRMED_WHITESPACE, '');
}

export function isBlankText(value: string | null | undefined): boolean {
  if (value == null || value.length === 0) return true;
  for (let index = 0; index < value.length; index += 1) {
    if (!isConfirmedWhitespaceCodeUnit(value.charCodeAt(index))) return false;
  }
  return true;
}

export function hasValidUnicodeScalars(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

export function normalizeDisplayText(value: string | null | undefined): NormalizedDisplayText {
  if (value == null) return { kind: 'missing' };
  if (!hasValidUnicodeScalars(value)) return { kind: 'invalid-unicode' };

  const normalized = trimConfirmedWhitespace(value.normalize('NFC'));
  return normalized.length === 0 ? { kind: 'missing' } : { kind: 'value', value: normalized };
}

export function isValidStreamerSlug(value: string): boolean {
  return value.length <= 50 && STREAMER_SLUG_PATTERN.test(value);
}

export function isValidVideoId(value: string): boolean {
  return VIDEO_ID_PATTERN.test(value);
}

export function isValidDateOnly(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;

  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthLengths = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= (monthLengths[month - 1] ?? 0);
}

export function isValidRfc3339Timestamp(value: string): boolean {
  const match = RFC3339_PATTERN.exec(value);
  if (!match || !isValidDateOnly(`${match[1]}-${match[2]}-${match[3]}`)) return false;

  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (hour > 23 || minute > 59 || second > 59) return false;

  const zone = match[8] ?? '';
  if (zone !== 'Z') {
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return false;
  }

  return Number.isFinite(Date.parse(value));
}

export function parseSqliteInteger(source: SqliteIntegerSource): ParsedSqliteInteger {
  if (source.storageClass === 'null') return { kind: 'missing' };
  if (source.storageClass !== 'integer' || source.decimalText == null) return { kind: 'invalid' };
  if (!DECIMAL_INTEGER_PATTERN.test(source.decimalText)) return { kind: 'invalid' };

  const integer = BigInt(source.decimalText);
  if (integer < BigInt(Number.MIN_SAFE_INTEGER) || integer > BigInt(Number.MAX_SAFE_INTEGER)) {
    return { kind: 'invalid' };
  }

  const value = Number(integer);
  if (!Number.isSafeInteger(value) || Object.is(value, -0)) return { kind: 'invalid' };
  return { kind: 'value', value };
}

export function validateOptionalSafeUrl(
  rawValue: string | null | undefined,
  provider: UrlProvider,
): OptionalSafeUrl {
  if (rawValue == null) return { kind: 'absent' };

  const trimmed = trimConfirmedWhitespace(rawValue);
  if (trimmed.length === 0) return { kind: 'absent' };
  if (!hasValidUnicodeScalars(trimmed) || hasExplicitPort(trimmed)) return { kind: 'unsafe' };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { kind: 'unsafe' };
  }

  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '' || parsed.port !== '') {
    return { kind: 'unsafe' };
  }

  const host = normalizeHostname(parsed.hostname);
  if (!ALLOWED_HOSTS[provider].has(host)) return { kind: 'unsafe' };
  if ((host === 'youtube.com' || host === 'm.youtube.com') && parsed.pathname === '/redirect') {
    return { kind: 'unsafe' };
  }

  return { kind: 'safe', url: trimmed };
}

export function compareUtf8Ordinal(left: string, right: string): number {
  if (left === right) return 0;
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftScalar = scalarAt(left, leftIndex);
    const rightScalar = scalarAt(right, rightIndex);
    if (leftScalar.value !== rightScalar.value) return leftScalar.value - rightScalar.value;
    leftIndex += leftScalar.width;
    rightIndex += rightScalar.width;
  }
  if (leftIndex === left.length && rightIndex === right.length) return 0;
  return leftIndex === left.length ? -1 : 1;
}

export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x7f) {
      bytes += 1;
    } else if (codeUnit <= 0x7ff) {
      bytes += 2;
    } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        // TextEncoder replaces an unpaired surrogate with U+FFFD.
        bytes += 3;
      }
    } else {
      // Includes BMP scalars and unpaired low surrogates (also U+FFFD).
      bytes += 3;
    }
  }
  return bytes;
}

/** Exact UTF-8 byte length after JSON string escaping, including both quotes. */
export function jsonStringByteLength(value: string): number {
  if (!hasValidUnicodeScalars(value)) throw new TypeError('JSON string contains an unpaired surrogate');

  let bytes = 2;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (
      codeUnit === 0x08 ||
      codeUnit === 0x09 ||
      codeUnit === 0x0a ||
      codeUnit === 0x0c ||
      codeUnit === 0x0d ||
      codeUnit === 0x22 ||
      codeUnit === 0x5c
    ) {
      bytes += 2;
    } else if (codeUnit <= 0x1f) {
      bytes += 6;
    } else if (codeUnit <= 0x7f) {
      bytes += 1;
    } else if (codeUnit <= 0x7ff) {
      bytes += 2;
    } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      bytes += 4;
      index += 1;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '');
}

function isConfirmedWhitespaceCodeUnit(codeUnit: number): boolean {
  return (
    (codeUnit >= 0x0009 && codeUnit <= 0x000d) ||
    codeUnit === 0x0020 ||
    codeUnit === 0x00a0 ||
    codeUnit === 0x1680 ||
    (codeUnit >= 0x2000 && codeUnit <= 0x200a) ||
    codeUnit === 0x2028 ||
    codeUnit === 0x2029 ||
    codeUnit === 0x202f ||
    codeUnit === 0x205f ||
    codeUnit === 0x3000 ||
    codeUnit === 0xfeff
  );
}

/** UTF-8 byte order is scalar-value order; invalid surrogates match TextEncoder's U+FFFD replacement. */
function scalarAt(value: string, index: number): { value: number; width: number } {
  const first = value.charCodeAt(index);
  if (first >= 0xd800 && first <= 0xdbff) {
    const second = value.charCodeAt(index + 1);
    if (second >= 0xdc00 && second <= 0xdfff) {
      return {
        value: 0x10000 + ((first - 0xd800) << 10) + (second - 0xdc00),
        width: 2,
      };
    }
    return { value: 0xfffd, width: 1 };
  }
  if (first >= 0xdc00 && first <= 0xdfff) return { value: 0xfffd, width: 1 };
  return { value: first, width: 1 };
}

/** URL.port hides an explicit default :443, so inspect the original authority. */
function hasExplicitPort(value: string): boolean {
  const schemeEnd = value.indexOf('://');
  if (schemeEnd < 0) return false;
  const authorityStart = schemeEnd + 3;
  const pathStartCandidates = [value.indexOf('/', authorityStart), value.indexOf('?', authorityStart), value.indexOf('#', authorityStart)]
    .filter((index) => index >= 0);
  const authorityEnd = pathStartCandidates.length > 0 ? Math.min(...pathStartCandidates) : value.length;
  const authority = value.slice(authorityStart, authorityEnd);
  const hostPort = authority.slice(authority.lastIndexOf('@') + 1);

  if (hostPort.startsWith('[')) {
    const closingBracket = hostPort.indexOf(']');
    return closingBracket >= 0 && hostPort.slice(closingBracket + 1).startsWith(':');
  }
  return hostPort.includes(':');
}
