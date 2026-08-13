import assert from 'node:assert/strict';
import { runWithLoadingState } from '../src/lib/loadingState';

async function main(): Promise<void> {
  const successTransitions: boolean[] = [];
  const result = await runWithLoadingState(
    (loading) => successTransitions.push(loading),
    async () => 'done',
  );

  assert.equal(result, 'done');
  assert.deepEqual(successTransitions, [true, false]);

  const failureTransitions: boolean[] = [];
  await assert.rejects(
    runWithLoadingState(
      (loading) => failureTransitions.push(loading),
      async () => {
        throw new Error('network failed');
      },
    ),
    /network failed/,
  );
  assert.deepEqual(failureTransitions, [true, false]);

  console.log('✓ loading state resets after successful and failed operations');
}

await main();
