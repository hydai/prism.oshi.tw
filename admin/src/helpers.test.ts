import { HTTPException } from 'hono/http-exception';
import { getRouteParam, getStreamerId } from './http';
import { isValidTransition, VALID_STATUSES } from './status';

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertDeepEqual(actual: unknown, expected: unknown, message: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}: expected ${expectedJson}, got ${actualJson}`);
  }
}

function queryContext(values: Record<string, string | undefined>) {
  return {
    req: {
      query: (key: string) => values[key],
    },
  };
}

function paramContext(values: Record<string, string | undefined>) {
  return {
    req: {
      param: (key: string) => values[key],
    },
  };
}

assertEqual(getStreamerId(queryContext({})), 'mizuki', 'defaults missing streamer to mizuki');
assertEqual(getStreamerId(queryContext({ streamer: '' })), 'mizuki', 'defaults empty streamer to mizuki');
assertEqual(getStreamerId(queryContext({ streamer: 'nagi' })), 'nagi', 'returns provided streamer');

assertEqual(getRouteParam(paramContext({ id: 'song-1' }), 'id'), 'song-1', 'returns route param');
assertEqual(getRouteParam(paramContext({ id: '' }), 'id'), '', 'preserves empty route params');

async function testMissingRouteParam(): Promise<void> {
  let missingParamError: unknown;
  try {
    getRouteParam(paramContext({}), 'id');
  } catch (error) {
    missingParamError = error;
  }

  if (!(missingParamError instanceof HTTPException)) {
    throw new Error('missing route params should throw HTTPException');
  }

  assertEqual(missingParamError.status, 400, 'missing route params should be HTTP 400');
  const missingParamResponse = missingParamError.getResponse();
  assertEqual(missingParamResponse.status, 400, 'missing route param response should be HTTP 400');
  assertEqual(
    missingParamResponse.headers.get('Content-Type'),
    'application/json',
    'missing route param response should be JSON',
  );
  assertDeepEqual(await missingParamResponse.json(), { error: 'Missing route param: id' }, 'missing route param body');
}

assertDeepEqual(
  [...VALID_STATUSES].sort(),
  ['approved', 'excluded', 'extracted', 'pending', 'rejected'],
  'valid statuses should include every supported workflow state',
);

const validTransitions: Array<[string, string]> = [
  ['pending', 'approved'],
  ['pending', 'rejected'],
  ['pending', 'excluded'],
  ['pending', 'extracted'],
  ['extracted', 'approved'],
  ['extracted', 'rejected'],
  ['extracted', 'excluded'],
  ['extracted', 'pending'],
  ['approved', 'extracted'],
  ['approved', 'pending'],
  ['rejected', 'pending'],
  ['rejected', 'excluded'],
  ['excluded', 'pending'],
];

for (const [from, to] of validTransitions) {
  assertEqual(isValidTransition(from, to), true, `${from} -> ${to} should be valid`);
}

const invalidTransitions: Array<[string, string]> = [
  ['pending', 'pending'],
  ['approved', 'approved'],
  ['approved', 'rejected'],
  ['approved', 'excluded'],
  ['rejected', 'approved'],
  ['excluded', 'approved'],
  ['missing', 'pending'],
  ['pending', 'missing'],
];

for (const [from, to] of invalidTransitions) {
  assertEqual(isValidTransition(from, to), false, `${from} -> ${to} should be invalid`);
}

async function main(): Promise<void> {
  await testMissingRouteParam();
  console.log('✓ admin route helpers');
}

void main();
