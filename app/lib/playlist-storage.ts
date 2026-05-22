export const STORAGE_QUOTA_ERROR = '本機儲存空間不足';
export const STORAGE_SAVE_ERROR = '無法儲存播放清單，請確認瀏覽器允許本機儲存';

export type StorageSaveResult = { success: true } | { success: false; error: string };

type StorageErrorShape = {
  name?: string;
  code?: number;
};

export function isStorageQuotaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const storageError = error as StorageErrorShape;
  return (
    storageError.name === 'QuotaExceededError' ||
    storageError.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    storageError.code === 22 ||
    storageError.code === 1014
  );
}

export function getStorageSaveError(error: unknown): string {
  return isStorageQuotaError(error) ? STORAGE_QUOTA_ERROR : STORAGE_SAVE_ERROR;
}

export function saveJsonToStorage(
  storage: Pick<Storage, 'setItem'>,
  key: string,
  value: unknown,
): StorageSaveResult {
  try {
    storage.setItem(key, JSON.stringify(value) ?? 'null');
    return { success: true };
  } catch (error) {
    return { success: false, error: getStorageSaveError(error) };
  }
}
