import assert from 'node:assert/strict';
import {
  dedupePlaylistVersions,
  getStorageSaveError,
  isStorageQuotaError,
  migrateGlobalPlaylistsForStreamer,
  saveJsonToStorage,
  STORAGE_QUOTA_ERROR,
  STORAGE_SAVE_ERROR,
} from './playlist-storage';

const duplicateVersions = [
  { performanceId: 'performance-1', title: 'first occurrence' },
  { performanceId: 'performance-2', title: 'unique occurrence' },
  { performanceId: 'performance-1', title: 'duplicate occurrence' },
];
assert.deepEqual(dedupePlaylistVersions(duplicateVersions), duplicateVersions.slice(0, 2));

const globalPlaylists = [
  {
    id: 'mixed',
    createdAt: 10,
    updatedAt: 20,
    versions: [
      { performanceId: 'performance-1', streamerSlug: 'mizuki', title: 'first occurrence' },
      { performanceId: 'performance-1', streamerSlug: 'mizuki', title: 'duplicate occurrence' },
      { performanceId: 'performance-2', streamerSlug: 'gabu', title: 'other streamer' },
    ],
  },
  {
    id: 'excluded',
    createdAt: 0,
    updatedAt: 0,
    versions: [
      { performanceId: 'performance-3', streamerSlug: 'gabu', title: 'other streamer' },
    ],
  },
  {
    id: 'fallback-date',
    createdAt: 0,
    updatedAt: 0,
    versions: [
      { performanceId: 'performance-4', streamerSlug: 'mizuki', title: 'matching streamer' },
    ],
  },
  {
    id: 'empty',
    createdAt: 30,
    updatedAt: 40,
    versions: [],
  },
];
let fallbackNow = 100;
assert.deepEqual(
  migrateGlobalPlaylistsForStreamer(globalPlaylists, 'mizuki', () => fallbackNow++),
  [
    {
      id: 'mixed',
      createdAt: 10,
      updatedAt: 20,
      versions: [
        { performanceId: 'performance-1', streamerSlug: 'mizuki', title: 'first occurrence' },
      ],
    },
    {
      id: 'fallback-date',
      createdAt: 0,
      updatedAt: 101,
      versions: [
        { performanceId: 'performance-4', streamerSlug: 'mizuki', title: 'matching streamer' },
      ],
    },
  ],
);
assert.equal(fallbackNow, 102);
assert.equal(globalPlaylists[0]?.versions.length, 3);

type SetItemCall = [key: string, value: string];

function memoryStorage(calls: SetItemCall[]): Pick<Storage, 'setItem'> {
  return {
    setItem(key, value) {
      calls.push([key, value]);
    },
  };
}

function throwingStorage(error: unknown): Pick<Storage, 'setItem'> {
  return {
    setItem() {
      throw error;
    },
  };
}

const calls: SetItemCall[] = [];
assert.deepEqual(saveJsonToStorage(memoryStorage(calls), 'playlists', [{ id: 'one' }]), { success: true });
assert.deepEqual(calls, [['playlists', '[{"id":"one"}]']]);

const quotaByName = Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
assert.equal(isStorageQuotaError(quotaByName), true);
assert.equal(getStorageSaveError(quotaByName), STORAGE_QUOTA_ERROR);
assert.deepEqual(saveJsonToStorage(throwingStorage(quotaByName), 'playlists', []), {
  success: false,
  error: STORAGE_QUOTA_ERROR,
});

const quotaByFirefoxName = Object.assign(new Error('quota'), { name: 'NS_ERROR_DOM_QUOTA_REACHED' });
assert.equal(isStorageQuotaError(quotaByFirefoxName), true);
assert.equal(getStorageSaveError(quotaByFirefoxName), STORAGE_QUOTA_ERROR);

const quotaByCode = Object.assign(new Error('quota'), { code: 22 });
assert.equal(isStorageQuotaError(quotaByCode), true);
assert.equal(getStorageSaveError(quotaByCode), STORAGE_QUOTA_ERROR);

const quotaByFirefoxCode = Object.assign(new Error('quota'), { code: 1014 });
assert.equal(isStorageQuotaError(quotaByFirefoxCode), true);
assert.equal(getStorageSaveError(quotaByFirefoxCode), STORAGE_QUOTA_ERROR);

const securityError = Object.assign(new Error('blocked'), { name: 'SecurityError' });
assert.equal(isStorageQuotaError(securityError), false);
assert.equal(getStorageSaveError(securityError), STORAGE_SAVE_ERROR);
assert.deepEqual(saveJsonToStorage(throwingStorage(securityError), 'playlists', []), {
  success: false,
  error: STORAGE_SAVE_ERROR,
});

const circular: Record<string, unknown> = {};
circular.self = circular;
const circularCalls: SetItemCall[] = [];
assert.deepEqual(saveJsonToStorage(memoryStorage(circularCalls), 'playlists', circular), {
  success: false,
  error: STORAGE_SAVE_ERROR,
});
assert.deepEqual(circularCalls, []);

console.log('✓ playlist storage helpers');
