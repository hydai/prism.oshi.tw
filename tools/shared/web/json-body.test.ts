import { parseJsonBody } from './json-body';

declare const process: { exitCode?: number };

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function reqReturning(value: unknown): { json(): Promise<unknown> } {
  return { json: () => Promise.resolve(value) };
}

function reqRejecting(): { json(): Promise<unknown> } {
  return { json: () => Promise.reject(new Error('Unexpected token in JSON')) };
}

async function testValidObjectIsOk(): Promise<void> {
  const result = await parseJsonBody<{ title: string }>(reqReturning({ title: 'hi' }));
  assert(result.ok, 'a plain object body is accepted');
  assert(result.ok && result.body.title === 'hi', 'the parsed body is returned as-is');
  console.log('parseJsonBody accepts a valid object body');
}

async function testRejectingJsonIsInvalidJson(): Promise<void> {
  const result = await parseJsonBody(reqRejecting());
  assert(!result.ok, 'a req.json() rejection is not ok');
  assert(!result.ok && result.reason === 'invalid-json', 'a json() rejection is reported as invalid-json');
  console.log('parseJsonBody reports invalid-json when req.json() rejects');
}

async function testNullBodyIsNotAnObject(): Promise<void> {
  const result = await parseJsonBody(reqReturning(null));
  assert(!result.ok, 'a null body is not ok');
  assert(!result.ok && result.reason === 'not-an-object', 'null is reported as not-an-object');
  console.log('parseJsonBody reports not-an-object for a null body');
}

async function testArrayBodyIsNotAnObject(): Promise<void> {
  const result = await parseJsonBody(reqReturning([1, 2, 3]));
  assert(!result.ok, 'an array body is not ok');
  assert(!result.ok && result.reason === 'not-an-object', 'an array is reported as not-an-object');
  console.log('parseJsonBody reports not-an-object for an array body');
}

async function testNumberBodyIsNotAnObject(): Promise<void> {
  const result = await parseJsonBody(reqReturning(42));
  assert(!result.ok, 'a number body is not ok');
  assert(!result.ok && result.reason === 'not-an-object', 'a number is reported as not-an-object');
  console.log('parseJsonBody reports not-an-object for a number body');
}

async function testStringBodyIsNotAnObject(): Promise<void> {
  const result = await parseJsonBody(reqReturning('str'));
  assert(!result.ok, 'a string body is not ok');
  assert(!result.ok && result.reason === 'not-an-object', 'a string is reported as not-an-object');
  console.log('parseJsonBody reports not-an-object for a string body');
}

// tsx transforms this package to CJS (no "type": "module" in package.json), which
// does not support top-level await — so, like submit-limits.test.ts, the async
// cases run inside main() rather than as bare top-level `await test(...)` calls.
async function main(): Promise<void> {
  await testValidObjectIsOk();
  await testRejectingJsonIsInvalidJson();
  await testNullBodyIsNotAnObject();
  await testArrayBodyIsNotAnObject();
  await testNumberBodyIsNotAnObject();
  await testStringBodyIsNotAnObject();
  console.log('json-body.test: all passed');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
