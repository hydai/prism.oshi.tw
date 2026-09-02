/**
 * Structural guards shared by every vod-export module that reads persisted
 * state back (R2 control slots, candidate metadata, publication audits).
 *
 * These validators decide whether bytes written by an earlier build are still
 * trustworthy, so they must answer identically everywhere. They previously
 * lived as per-module copies — three `isCanonicalTimestamp`, two `hasExactKeys`,
 * two `isSourceFingerprint`, two `/^[0-9a-f]{64}$/` literals — which is exactly
 * the shape a divergence hides in. `guards.test.ts` states their edge cases.
 */
import { VOD_EXPORT_SCHEMA_VERSION } from './constants';
import type { VodExportSourceFingerprint } from './source';

/**
 * The hexadecimal body of a SHA-256, unanchored, so composite key patterns
 * (`maintenance.ts`'s snapshot object key) embed the same definition instead of
 * re-spelling it.
 */
export const SHA256_HEX_SOURCE = '[0-9a-f]{64}';

/** A lowercase hex SHA-256 and nothing else. Stateless: never given the `g` flag. */
export const SHA256_PATTERN = new RegExp(`^${SHA256_HEX_SOURCE}$`);

const CANONICAL_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const REVISION_PATTERN = /^(0|[1-9][0-9]*)$/;

/**
 * The exact string `Date#toISOString` emits — shape *and* round trip, so
 * `2026-02-29T00:00:00.000Z` (shape-valid, calendar-invalid) is rejected and no
 * two spellings of the same instant can both be canonical.
 */
export function isCanonicalTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && CANONICAL_TIMESTAMP_PATTERN.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(Date.parse(value)).toISOString() === value;
}

/** Exactly these own keys, no more and no fewer. Value types are the caller's job. */
export function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(record).length === keys.length && keys.every((key) => Object.hasOwn(record, key));
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * A source fingerprint as persisted alongside a candidate or a publication
 * audit. Revisions stay decimal strings (never coerced from numbers) so a
 * SQLite integer that lost precision cannot pass as one.
 */
export function isSourceFingerprint(value: unknown): value is VodExportSourceFingerprint {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return hasExactKeys(record, [
    'dbId', 'dbRevision', 'novaDbId', 'novaRevision', 'schemaVersion', 'exporterBuildId',
  ])
    && isNonEmptyString(record.dbId)
    && typeof record.dbRevision === 'string'
    && REVISION_PATTERN.test(record.dbRevision)
    && isNonEmptyString(record.novaDbId)
    && typeof record.novaRevision === 'string'
    && REVISION_PATTERN.test(record.novaRevision)
    && record.schemaVersion === VOD_EXPORT_SCHEMA_VERSION
    && isNonEmptyString(record.exporterBuildId);
}
