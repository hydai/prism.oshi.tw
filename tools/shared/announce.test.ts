import * as assert from 'node:assert/strict';

import { parseDevVar } from './announce.ts';

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    console.error(`✗ ${name}`);
    throw err;
  }
}

test('parseDevVar extracts the value', () => {
  assert.equal(parseDevVar('DISCORD_WEBHOOK_ANNOUNCE=https://x/y\n', 'DISCORD_WEBHOOK_ANNOUNCE'), 'https://x/y');
});

test('parseDevVar returns null when the key is absent', () => {
  assert.equal(parseDevVar('OTHER=1\n', 'DISCORD_WEBHOOK_ANNOUNCE'), null);
});

test('parseDevVar ignores commented lines', () => {
  assert.equal(parseDevVar('# DISCORD_WEBHOOK_ANNOUNCE=nope\nDISCORD_WEBHOOK_ANNOUNCE=real\n', 'DISCORD_WEBHOOK_ANNOUNCE'), 'real');
});

test('parseDevVar strips surrounding quotes', () => {
  assert.equal(parseDevVar('DISCORD_WEBHOOK_ANNOUNCE="https://x/y"\n', 'DISCORD_WEBHOOK_ANNOUNCE'), 'https://x/y');
});

test('parseDevVar treats an empty value as null', () => {
  assert.equal(parseDevVar('DISCORD_WEBHOOK_ANNOUNCE=\n', 'DISCORD_WEBHOOK_ANNOUNCE'), null);
});

console.log('announce.test: all passed');
