import {
  headStorageObject,
  verifyStorageObjectIntegrity,
  isStorageObjectNotFoundError,
  type StorageObjectIntegrityDependencies,
} from './storage';

export const MAX_INVENTORY_PHOTO_BYTES = 3 * 1024 * 1024;
const PHOTO_KEY = /^inventory-photos\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\/([a-f0-9]{64})\.jpg$/;

/** A content-addressed name or caller metadata is not proof of stored bytes. */
export async function verifyInventoryPhoto(key: string, deps: StorageObjectIntegrityDependencies = {}) {
  const checksum = PHOTO_KEY.exec(key)?.[1];
  if (!checksum) return false;
  let head;
  try { head = await (deps.headObject ?? headStorageObject)(key); }
  catch (error) { if (isStorageObjectNotFoundError(error)) return false; throw error; }
  if (head.storageKey !== key || head.contentType !== 'image/jpeg' || !Number.isSafeInteger(head.byteSize) || !head.byteSize || head.byteSize < 0 || head.byteSize > MAX_INVENTORY_PHOTO_BYTES) return false;
  const verified = await verifyStorageObjectIntegrity({
    storageKey: key,
    expectedByteSize: head.byteSize,
    expectedChecksumSha256: checksum,
    maxByteSize: MAX_INVENTORY_PHOTO_BYTES,
  }, { ...deps, headObject: async () => head });
  return verified.ok && verified.contentType === 'image/jpeg';
}
