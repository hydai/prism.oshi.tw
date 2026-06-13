import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { clearPendingAnnouncements, enqueueAnnouncements, parseDevVar, readPendingAnnouncements } from './announce.ts';

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

test('pending queue: missing file reads as empty, enqueue accumulates, clear removes', () => {
  const tmp = path.join(os.tmpdir(), `pending-announce-${process.pid}.json`);
  fs.rmSync(tmp, { force: true });
  assert.deepEqual(readPendingAnnouncements(tmp), []); // ENOENT → []
  enqueueAnnouncements([{ title: 'a' }], tmp);
  enqueueAnnouncements([{ title: 'b' }, { title: 'c' }], tmp);
  assert.deepEqual(readPendingAnnouncements(tmp), [{ title: 'a' }, { title: 'b' }, { title: 'c' }]);
  clearPendingAnnouncements(tmp);
  assert.deepEqual(readPendingAnnouncements(tmp), []);
});

test('pending queue: enqueue of an empty list is a no-op (no file created)', () => {
  const tmp = path.join(os.tmpdir(), `pending-announce-empty-${process.pid}.json`);
  fs.rmSync(tmp, { force: true });
  enqueueAnnouncements([], tmp);
  assert.equal(fs.existsSync(tmp), false);
});

console.log('announce.test: all passed');
