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

export const INVALID_NORMALIZED_DISPLAY_TEXT = Symbol('invalid-normalized-display-text');
export type NormalizedDisplayTextValue = string | null | typeof INVALID_NORMALIZED_DISPLAY_TEXT;

export type OptionalSafeUrl =
  | { kind: 'safe'; url: string }
  | { kind: 'absent' }
  | { kind: 'unsafe' };

export type ParsedSqliteInteger =
  | { kind: 'value'; value: number }
  | { kind: 'missing' }
  | { kind: 'invalid' };

export type ParsedSqliteIntegerValue = number | 'missing' | 'invalid';

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
  const normalized = normalizeDisplayTextValue(value);
  if (normalized === null) return { kind: 'missing' };
  if (normalized === INVALID_NORMALIZED_DISPLAY_TEXT) return { kind: 'invalid-unicode' };
  return { kind: 'value', value: normalized };
}

/** Allocation-free scalar form for the bounded validation hot path. */
export function normalizeDisplayTextValue(
  value: string | null | undefined,
): NormalizedDisplayTextValue {
  if (value == null) return null;
  if (!hasValidUnicodeScalars(value)) return INVALID_NORMALIZED_DISPLAY_TEXT;

  const normalized = trimConfirmedWhitespace(value.normalize('NFC'));
  return normalized.length === 0 ? null : normalized;
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
  const parsed = parseSqliteIntegerValue(source.storageClass, source.decimalText);
  return typeof parsed === 'number' ? { kind: 'value', value: parsed } : { kind: parsed };
}

/** Allocation-free scalar form for the bounded validation hot path. */
export function parseSqliteIntegerValue(
  storageClass: string,
  decimalText: string | null,
): ParsedSqliteIntegerValue {
  if (storageClass === 'null') return 'missing';
  if (storageClass !== 'integer' || decimalText == null) return 'invalid';
  if (!DECIMAL_INTEGER_PATTERN.test(decimalText)) return 'invalid';

  const value = Number(decimalText);
  if (
    !Number.isSafeInteger(value)
    || Object.is(value, -0)
    || String(value) !== decimalText
  ) return 'invalid';
  return value;
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
    const leftFirst = left.charCodeAt(leftIndex);
    const leftSecond = left.charCodeAt(leftIndex + 1);
    const leftIsPair = leftFirst >= 0xd800 && leftFirst <= 0xdbff
      && leftSecond >= 0xdc00 && leftSecond <= 0xdfff;
    const leftScalar = leftIsPair
      ? 0x10000 + ((leftFirst - 0xd800) << 10) + (leftSecond - 0xdc00)
      : leftFirst >= 0xd800 && leftFirst <= 0xdfff ? 0xfffd : leftFirst;

    const rightFirst = right.charCodeAt(rightIndex);
    const rightSecond = right.charCodeAt(rightIndex + 1);
    const rightIsPair = rightFirst >= 0xd800 && rightFirst <= 0xdbff
      && rightSecond >= 0xdc00 && rightSecond <= 0xdfff;
    const rightScalar = rightIsPair
      ? 0x10000 + ((rightFirst - 0xd800) << 10) + (rightSecond - 0xdc00)
      : rightFirst >= 0xd800 && rightFirst <= 0xdfff ? 0xfffd : rightFirst;

    if (leftScalar !== rightScalar) return leftScalar - rightScalar;
    leftIndex += leftIsPair ? 2 : 1;
    rightIndex += rightIsPair ? 2 : 1;
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
