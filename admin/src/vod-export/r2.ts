import {
  VOD_EXPORT_CONTENT_TYPE,
  VOD_EXPORT_MANIFEST_CACHE_CONTROL,
  VOD_EXPORT_SNAPSHOT_CACHE_CONTROL,
} from './constants';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export const PRIVATE_JSON_HTTP_METADATA: R2HTTPMetadata = {
  contentType: VOD_EXPORT_CONTENT_TYPE,
  cacheControl: 'private, no-store',
};

export const PUBLIC_SNAPSHOT_HTTP_METADATA: R2HTTPMetadata = {
  contentType: VOD_EXPORT_CONTENT_TYPE,
  cacheControl: VOD_EXPORT_SNAPSHOT_CACHE_CONTROL,
};

export const PUBLIC_MANIFEST_HTTP_METADATA: R2HTTPMetadata = {
  contentType: VOD_EXPORT_CONTENT_TYPE,
  cacheControl: VOD_EXPORT_MANIFEST_CACHE_CONTROL,
};

export type VodExportR2ErrorCode =
  | 'R2_OBJECT_MISSING'
  | 'R2_OBJECT_TOO_LARGE'
  | 'R2_OBJECT_INVALID_UTF8'
  | 'R2_OBJECT_INVALID_JSON'
  | 'R2_OBJECT_METADATA_MISMATCH'
  | 'R2_OBJECT_CHECKSUM_MISMATCH'
  | 'R2_PRECONDITION_FAILED';

export class VodExportR2Error extends Error {
  constructor(
    readonly code: VodExportR2ErrorCode,
    message: string,
    readonly status = 503,
  ) {
    super(message);
    this.name = 'VodExportR2Error';
  }
}

export interface R2JsonObject<T> {
  value: T;
  object: R2Object;
  bytes: Uint8Array;
}

export async function getJsonObject<T>(
  bucket: R2Bucket,
  key: string,
  maxBytes: number,
): Promise<R2JsonObject<T> | null> {
  const object = await bucket.get(key);
  if (object === null) return null;
  if (object.size > maxBytes) {
    throw new VodExportR2Error('R2_OBJECT_TOO_LARGE', `R2 object ${key} exceeds its private JSON limit`);
  }
  const bytes = new Uint8Array(await object.arrayBuffer());
  let text: string;
  try {
    text = textDecoder.decode(bytes);
  } catch {
    throw new VodExportR2Error('R2_OBJECT_INVALID_UTF8', `R2 object ${key} is not valid UTF-8`);
  }
  try {
    return { value: JSON.parse(text) as T, object, bytes };
  } catch {
    throw new VodExportR2Error('R2_OBJECT_INVALID_JSON', `R2 object ${key} is not valid JSON`);
  }
}

export function encodePrivateJson(value: unknown): Uint8Array {
  return textEncoder.encode(JSON.stringify(value));
}

export async function createJsonObject(
  bucket: R2Bucket,
  key: string,
  value: unknown,
  customMetadata?: Record<string, string>,
): Promise<R2Object | null> {
  return bucket.put(key, encodePrivateJson(value), {
    onlyIf: new Headers({ 'If-None-Match': '*' }),
    httpMetadata: PRIVATE_JSON_HTTP_METADATA,
    customMetadata,
  });
}

export async function replaceJsonObject(
  bucket: R2Bucket,
  key: string,
  value: unknown,
  expectedEtag: string,
  customMetadata?: Record<string, string>,
): Promise<R2Object | null> {
  return bucket.put(key, encodePrivateJson(value), {
    onlyIf: { etagMatches: expectedEtag },
    httpMetadata: PRIVATE_JSON_HTTP_METADATA,
    customMetadata,
  });
}

export async function createBytesObject(
  bucket: R2Bucket,
  key: string,
  bytes: Uint8Array,
  options: Omit<R2PutOptions, 'onlyIf'>,
): Promise<R2Object | null> {
  return bucket.put(key, bytes, {
    ...options,
    onlyIf: new Headers({ 'If-None-Match': '*' }),
  });
}

export function assertHttpMetadata(
  object: R2Object,
  expected: R2HTTPMetadata,
  label: string,
): void {
  const actual = object.httpMetadata ?? {};
  if (
    actual.contentType !== expected.contentType
    || actual.cacheControl !== expected.cacheControl
    || actual.contentEncoding !== undefined
    || actual.contentDisposition !== undefined
  ) {
    throw new VodExportR2Error(
      'R2_OBJECT_METADATA_MISMATCH',
      `${label} has incompatible R2 HTTP metadata`,
      503,
    );
  }
}

export function checksumSha256Hex(object: R2Object): string | null {
  const checksum = object.checksums.sha256;
  if (checksum === undefined) return null;
  return bytesToHex(new Uint8Array(checksum));
}

export function bytesToHex(bytes: Uint8Array): string {
  let result = '';
  for (const byte of bytes) result += byte.toString(16).padStart(2, '0');
  return result;
}
