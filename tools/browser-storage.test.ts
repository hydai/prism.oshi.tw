import assert from 'node:assert/strict';
import {
  AURORA_RECENT_STORAGE_KEY,
  pushRecentVideo,
} from '../lib/aurora-recent';

function memoryStorage(entries: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(entries));
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    key(index) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

const recentStorage = memoryStorage({
  'aurora:recent': JSON.stringify(['old-video', 'duplicate-video']),
});
pushRecentVideo('duplicate-video', recentStorage);
assert.deepEqual(JSON.parse(recentStorage.getItem(AURORA_RECENT_STORAGE_KEY) ?? 'null'), [
  'duplicate-video',
  'old-video',
]);
assert.equal(recentStorage.getItem('aurora:recent'), null);

const corruptStorage = memoryStorage({ 'aurora:recent': '{invalid json' });
pushRecentVideo('recovered-video', corruptStorage);
assert.deepEqual(JSON.parse(corruptStorage.getItem(AURORA_RECENT_STORAGE_KEY) ?? 'null'), [
  'recovered-video',
]);
assert.equal(corruptStorage.getItem('aurora:recent'), null);

for (let index = 0; index < 12; index += 1) {
  pushRecentVideo(`video-${index}`, recentStorage);
}
assert.equal(
  (JSON.parse(recentStorage.getItem(AURORA_RECENT_STORAGE_KEY) ?? '[]') as string[]).length,
  10,
);

async function testAdminClientStorageFallbacks(): Promise<void> {
  const blockedStorage = memoryStorage();
  blockedStorage.getItem = () => {
    throw new Error('storage read blocked');
  };
  blockedStorage.setItem = () => {
    throw new Error('storage write blocked');
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: blockedStorage,
    configurable: true,
  });

  const { getCurrentStreamer, setCurrentStreamer } = await import('../admin/ui/src/api/client');
  assert.equal(getCurrentStreamer(), 'mizuki');
  assert.doesNotThrow(() => setCurrentStreamer('gabu'));
  assert.equal(getCurrentStreamer(), 'gabu');

  Object.defineProperty(globalThis, 'localStorage', {
    get() {
      throw new Error('storage getter blocked');
    },
    configurable: true,
  });
  assert.doesNotThrow(() => setCurrentStreamer('gabu'));
  assert.doesNotThrow(() => pushRecentVideo('blocked-video'));

  const streamerStorage = memoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    value: streamerStorage,
    configurable: true,
  });
  setCurrentStreamer('seki');
  assert.equal(streamerStorage.getItem('prism_admin_streamer'), 'seki');
}

testAdminClientStorageFallbacks()
  .then(() => console.log('✓ browser storage migrations and non-browser import safety'))
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
