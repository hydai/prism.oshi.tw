/**
 * The vod-export HTTP error contract, pinned twice.
 *
 * 1. An oracle table: every error class the vod-export modules can raise, with
 *    the exact { status, body } `normalizeVodExportError` produces for it. The
 *    expectations were captured from the pre-sub-app implementation (a 7-way
 *    `instanceof` chain in api.ts plus a per-route try/catch in index.ts), so
 *    this table stays an independent oracle for the collapsed
 *    `instanceof VodExportError` form rather than a restatement of it.
 *
 * 2. The mounted sub-app: a thrown `VodExportControlError` reaching the router
 *    from a real route must produce byte-identical JSON, the same status, and
 *    the same `Cache-Control: private, no-store` header the inline try/catch
 *    produced — and must never fall through to the root app.onError contract
 *    ({ error, code: 'INTERNAL_ERROR' }, on-error.test.ts).
 */
import app from '../index';
import { REQUEST_AUTHENTICITY_HEADER, REQUEST_AUTHENTICITY_VALUE } from '../../shared/csrf';
import { normalizeVodExportError, vodExportErrorResponse, VodExportRepairError } from './api';
import { VodExportCandidateError } from './candidate';
import { CanonicalJsonError } from './canonical-json';
import { PUBLICATION_CONTROL_KEY, VodExportControlError } from './control';
import { ExportLimitExceededError } from './limits';
import { VodExportMaintenanceError } from './maintenance';
import { VodExportPublicationError } from './publication';
import { VodExportR2Error } from './r2';
import { VodExportServiceError } from './service';
import { VodExportSourceError } from './source';
import type { CapacityDiagnostic } from './types';

declare const process: { exitCode?: number };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

/** Compares the exact wire bytes, so key order is part of the contract. */
function sameJson(actual: unknown, expected: unknown, message: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}: expected ${expectedJson}, got ${actualJson}`);
  }
}

function captureConsoleError<T>(run: () => T): { result: T; logged: unknown[][] } {
  const original = console.error;
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => { logged.push(args); };
  try {
    return { result: run(), logged };
  } finally {
    console.error = original;
  }
}

const LIMIT_DIAGNOSTIC: CapacityDiagnostic = {
  resource: 'performances',
  actual: 10,
  limit: 5,
  ratio: 2,
  state: 'exceeded',
};

interface ErrorCase {
  readonly name: string;
  readonly error: unknown;
  readonly status: number;
  readonly body: Record<string, unknown>;
}

// Captured from the pre-refactor mapping. Key order is the emitted order.
const ERROR_ORACLE: readonly ErrorCase[] = [
  {
    name: 'VodExportServiceError (plain)',
    error: new VodExportServiceError('SOURCE_CHANGED_DURING_GENERATION', 'Source changed during generation', 409),
    status: 409,
    body: { error: 'Source changed during generation', code: 'SOURCE_CHANGED_DURING_GENERATION' },
  },
  {
    name: 'VodExportServiceError (EXPORT_LIMIT_EXCEEDED with capacity details)',
    error: new VodExportServiceError('EXPORT_LIMIT_EXCEEDED', 'VOD export performances limit exceeded', 422, {
      resource: 'performances',
      actual: 5,
      limit: 4,
    }),
    status: 422,
    body: {
      error: 'VOD export performances limit exceeded',
      code: 'EXPORT_LIMIT_EXCEEDED',
      diagnostics: [{ resource: 'performances', actual: 5, limit: 4, ratio: 1.25, state: 'exceeded' }],
    },
  },
  {
    name: 'VodExportServiceError (EXPORT_LIMIT_EXCEEDED without usable details)',
    error: new VodExportServiceError('EXPORT_LIMIT_EXCEEDED', 'VOD export limit exceeded', 422),
    status: 422,
    body: { error: 'VOD export limit exceeded', code: 'EXPORT_LIMIT_EXCEEDED' },
  },
  {
    name: 'VodExportServiceError (EXPORT_LIMIT_EXCEEDED, non-positive limit in details)',
    error: new VodExportServiceError('EXPORT_LIMIT_EXCEEDED', 'VOD export limit exceeded', 422, {
      resource: 'performances',
      actual: 5,
      limit: 0,
    }),
    status: 422,
    body: { error: 'VOD export limit exceeded', code: 'EXPORT_LIMIT_EXCEEDED' },
  },
  {
    name: 'VodExportCandidateError',
    error: new VodExportCandidateError('CANDIDATE_NOT_FOUND', 'Candidate not found', 404),
    status: 404,
    body: { error: 'Candidate not found', code: 'CANDIDATE_NOT_FOUND' },
  },
  {
    name: 'VodExportControlError (its unresolvedSince stays server-side)',
    error: new VodExportControlError(
      'PUBLICATION_IN_PROGRESS',
      'A VOD export publication is still being prepared',
      409,
      '2026-01-01T00:00:00.000Z',
    ),
    status: 409,
    body: { error: 'A VOD export publication is still being prepared', code: 'PUBLICATION_IN_PROGRESS' },
  },
  {
    name: 'VodExportPublicationError',
    error: new VodExportPublicationError('CANDIDATE_STALE', 'Candidate is stale', 409),
    status: 409,
    body: { error: 'Candidate is stale', code: 'CANDIDATE_STALE' },
  },
  {
    name: 'VodExportSourceError',
    error: new VodExportSourceError('EXPORT_SOURCE_GUARD_MISSING', 'Source guard missing', 503),
    status: 503,
    body: { error: 'Source guard missing', code: 'EXPORT_SOURCE_GUARD_MISSING' },
  },
  {
    // A source-layer capacity refusal is NOT decorated with diagnostics: only
    // service.ts re-raises one as a VodExportServiceError, and only that class
    // carries capacity details out to the client. Pinned so the collapsed
    // instanceof chain cannot quietly start decorating this one.
    name: 'VodExportSourceError (EXPORT_LIMIT_EXCEEDED carries details but emits no diagnostics)',
    error: new VodExportSourceError('EXPORT_LIMIT_EXCEEDED', 'VOD export source limit exceeded', 422, {
      resource: 'performances',
      actual: 5,
      limit: 4,
    }),
    status: 422,
    body: { error: 'VOD export source limit exceeded', code: 'EXPORT_LIMIT_EXCEEDED' },
  },
  {
    name: 'VodExportR2Error (default 503 status)',
    error: new VodExportR2Error('R2_OBJECT_MISSING', 'R2 object missing'),
    status: 503,
    body: { error: 'R2 object missing', code: 'R2_OBJECT_MISSING' },
  },
  {
    name: 'VodExportR2Error (explicit status)',
    error: new VodExportR2Error('R2_PRECONDITION_FAILED', 'Precondition failed', 409),
    status: 409,
    body: { error: 'Precondition failed', code: 'R2_PRECONDITION_FAILED' },
  },
  {
    name: 'VodExportMaintenanceError (fixed code and status)',
    error: new VodExportMaintenanceError('Maintenance failed'),
    status: 503,
    body: { error: 'Maintenance failed', code: 'VOD_EXPORT_MAINTENANCE_FAILED' },
  },
  {
    name: 'VodExportRepairError (fixed code, status and message)',
    error: new VodExportRepairError(),
    status: 404,
    body: { error: 'VOD export source record not found', code: 'VOD_EXPORT_REPAIR_RECORD_NOT_FOUND' },
  },
  {
    name: 'ExportLimitExceededError (httpStatus + diagnostic, not status + details)',
    error: new ExportLimitExceededError(LIMIT_DIAGNOSTIC),
    status: 422,
    body: {
      error: 'VOD export performances limit exceeded',
      code: 'EXPORT_LIMIT_EXCEEDED',
      diagnostics: [LIMIT_DIAGNOSTIC],
    },
  },
  {
    name: 'CanonicalJsonError (its own message never reaches the client)',
    error: new CanonicalJsonError('sha256 must be exactly 64 lowercase hexadecimal characters'),
    status: 503,
    body: { error: 'VOD export canonical serialization failed', code: 'EXPORT_SERIALIZATION_FAILED' },
  },
];

function testErrorOracle(): void {
  for (const testCase of ERROR_ORACLE) {
    const normalized = normalizeVodExportError(testCase.error);
    equal(normalized.status, testCase.status, `${testCase.name}: status`);
    sameJson(normalized.body, testCase.body, `${testCase.name}: body`);
  }
}

async function testEveryErrorRendersTheSameResponse(): Promise<void> {
  // The rendering the sub-app's onError performs: every case in the oracle,
  // not just the one driven through a real route below.
  for (const testCase of ERROR_ORACLE) {
    const res = vodExportErrorResponse(testCase.error);
    equal(res.status, testCase.status, `${testCase.name}: rendered status`);
    equal(
      res.headers.get('Cache-Control'),
      'private, no-store',
      `${testCase.name}: rendered error response is never cacheable`,
    );
    equal(
      res.headers.get('Content-Type'),
      'application/json; charset=utf-8',
      `${testCase.name}: rendered error content type`,
    );
    equal(await res.text(), JSON.stringify(testCase.body), `${testCase.name}: rendered body bytes`);
  }
}

function testUnknownErrorsStayGenericAndLogged(): void {
  const expected = {
    error: 'The VOD export operation failed unexpectedly',
    code: 'VOD_EXPORT_INTERNAL_ERROR',
  };

  const thrown = captureConsoleError(() => normalizeVodExportError(new Error('D1 connection reset')));
  equal(thrown.result.status, 500, 'an unrecognized Error is a 500');
  sameJson(thrown.result.body, expected, 'an unrecognized Error gets the generic vod-export body');
  assert(
    thrown.logged.some((args) => args.some((arg) => typeof arg === 'string' && arg.includes('D1 connection reset'))),
    'the unrecognized error is logged server-side',
  );
  assert(
    !JSON.stringify(thrown.result.body).includes('D1 connection reset'),
    'the unrecognized error message never reaches the client',
  );

  const nonError = captureConsoleError(() => normalizeVodExportError('not an error at all'));
  equal(nonError.result.status, 500, 'a thrown non-Error is a 500 too');
  sameJson(nonError.result.body, expected, 'a thrown non-Error gets the same generic body');
  assert(
    nonError.logged.some((args) => args.some((arg) => typeof arg === 'string' && arg.includes('Unknown error'))),
    'a thrown non-Error is logged as an unknown error',
  );
}

// --- Mounted sub-app -------------------------------------------------------

const CURATOR = 'curator@example.com';

// A publication control slot parked in "acquired": reconcile refuses it with
// VodExportControlError('PUBLICATION_IN_PROGRESS', …, 409).
const ACQUIRED_PUBLICATION_SLOT = {
  kind: 'vod-export-publication-control-v1',
  state: 'acquired',
  intentId: '11111111-1111-4111-8111-111111111111',
  candidateId: '22222222-2222-4222-8222-222222222222',
  acquiredAt: '2026-01-01T00:00:00.000Z',
};

function emptyR2(): unknown {
  return { get: async () => null, put: async () => null };
}

function controlR2(payload: unknown): unknown {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  return {
    get: async (key: string) => (key === PUBLICATION_CONTROL_KEY
      ? {
          size: bytes.byteLength,
          etag: 'control-etag',
          arrayBuffer: async () => bytes.slice().buffer,
        }
      : null),
    put: async () => null,
  };
}

function envWith(privateBucket: unknown) {
  const harmlessD1 = {
    prepare: () => ({
      bind: () => ({
        first: async () => null,
        all: async () => ({ results: [] }),
        run: async () => ({ meta: { changes: 0 } }),
      }),
    }),
  };
  return {
    DB: harmlessD1,
    NOVA_DB: harmlessD1,
    CRYSTAL_DB: harmlessD1,
    CURATOR_EMAILS: CURATOR,
    YOUTUBE_API_KEY: '',
    VOD_EXPORT_PUBLIC: emptyR2(),
    VOD_EXPORT_PRIVATE: privateBucket,
    VOD_EXPORT_DB_ID: 'test-db',
    VOD_EXPORT_NOVA_DB_ID: 'test-nova-db',
  } as unknown as Parameters<typeof app.request>[2];
}

function curatorHeaders(): Record<string, string> {
  return {
    'CF-Access-Authenticated-User-Email': CURATOR,
    [REQUEST_AUTHENTICITY_HEADER]: REQUEST_AUTHENTICITY_VALUE,
  };
}

async function testThrownControlErrorKeepsItsRouteContract(): Promise<void> {
  const res = await app.request(
    '/api/vod-export/reconcile',
    { method: 'POST', headers: curatorHeaders() },
    envWith(controlR2(ACQUIRED_PUBLICATION_SLOT)),
  );

  equal(res.status, 409, 'a VodExportControlError raised inside a route keeps its own status');
  equal(
    res.headers.get('Cache-Control'),
    'private, no-store',
    'a vod-export error response is never cacheable',
  );
  equal(
    res.headers.get('Content-Type'),
    'application/json; charset=utf-8',
    'a vod-export error response keeps the vod-export content type',
  );
  equal(
    await res.text(),
    '{"error":"A VOD export publication is still being prepared","code":"PUBLICATION_IN_PROGRESS"}',
    'the error body is byte-identical to the pre-sub-app contract',
  );
}

async function testVodExportErrorsNeverReachTheRootContract(): Promise<void> {
  const res = await app.request(
    '/api/vod-export/reconcile',
    { method: 'POST', headers: curatorHeaders() },
    envWith(controlR2(ACQUIRED_PUBLICATION_SLOT)),
  );
  const body = await res.json() as { code?: unknown };
  assert(body.code !== 'INTERNAL_ERROR', 'the root app.onError contract must never claim a vod-export error');
  assert(res.status !== 500, 'a vod-export domain error is never genericized into a 500');
}

async function testSuccessfulRouteStillCarriesTheCacheHeader(): Promise<void> {
  const res = await app.request(
    '/api/vod-export/control-recovery',
    { headers: { 'CF-Access-Authenticated-User-Email': CURATOR } },
    envWith(emptyR2()),
  );

  equal(res.status, 200, 'an idle control state is a successful read');
  equal(
    res.headers.get('Cache-Control'),
    'private, no-store',
    'the cache-control middleware still runs on the success path',
  );
  sameJson(await res.json(), { generation: null, publication: null }, 'the success body is unchanged');
}

async function testCuratorGateStillGuardsTheMountedRoutes(): Promise<void> {
  const res = await app.request(
    '/api/vod-export/control-recovery',
    { headers: { 'CF-Access-Authenticated-User-Email': 'contributor@example.com' } },
    envWith(emptyR2()),
  );
  equal(res.status, 403, 'requireCurator still runs per route inside the sub-app');
  equal(
    res.headers.get('Cache-Control'),
    'private, no-store',
    'the cache-control middleware still wraps the authorization gate, as it did before the mount',
  );
}

async function main(): Promise<void> {
  testErrorOracle();
  await testEveryErrorRendersTheSameResponse();
  testUnknownErrorsStayGenericAndLogged();
  await testThrownControlErrorKeepsItsRouteContract();
  await testVodExportErrorsNeverReachTheRootContract();
  await testSuccessfulRouteStillCarriesTheCacheHeader();
  await testCuratorGateStillGuardsTheMountedRoutes();
  console.log('✓ VOD export error oracle and mounted route contract');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
