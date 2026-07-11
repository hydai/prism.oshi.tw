import { compactJsonChunks, createCompactJsonStream } from './json-stream';
import { utf8ByteLength } from './normalization';

declare const process: { exitCode?: number };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
}

async function testMatchesCompactJson(): Promise<void> {
  const value = {
    text: 'quote" slash\\ controls\b\f\n\r\t\u0000\u001f',
    unicode: '繁體中文😀\u2028\u2029',
    unpaired: '\ud800x\udc00',
    numbers: [-0, 1.25, 1e-7, Number.NaN, Number.POSITIVE_INFINITY],
    array: [undefined, () => undefined, Symbol('ignored'), true, null],
    omitted: undefined,
    nested: { z: 1, a: false },
  };
  const streamed = await new Response(createCompactJsonStream(value)).text();
  equal(streamed, JSON.stringify(value), 'streamed JSON matches native compact JSON exactly');
}

function testChunksRemainBounded(): void {
  const value = { huge: `${'界'.repeat(20_000)}${'\u0000'.repeat(20_000)}` };
  let totalBytes = 0;
  let chunks = 0;
  for (const chunk of compactJsonChunks(value)) {
    const bytes = utf8ByteLength(chunk);
    assert(bytes <= 24_576, 'each compact JSON text chunk remains bounded');
    totalBytes += bytes;
    chunks += 1;
  }
  assert(chunks > 1, 'large JSON is emitted incrementally');
  equal(totalBytes, utf8ByteLength(JSON.stringify(value)), 'chunked JSON preserves its exact UTF-8 length');
}

async function main(): Promise<void> {
  await testMatchesCompactJson();
  testChunksRemainBounded();
  console.log('✓ VOD export compact JSON streaming');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
