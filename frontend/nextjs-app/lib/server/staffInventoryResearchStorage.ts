import { createHash } from 'node:crypto';
import { getStorageMode, uploadPrivateChecksumBuffer } from './storage';

/** Private evidence bytes are retained independently of expiring eBay URLs. */
export async function archiveStaffInventoryResearchImage(image: {
  bytes: Buffer; sha256: string; content_type: 'image/jpeg' | 'image/png' | 'image/webp'; source_url: string; retrieved_at: string;
}, signal: AbortSignal) {
  if (signal.aborted || getStorageMode() !== 's3' || image.bytes.length > 2 * 1024 * 1024 || createHash('sha256').update(image.bytes).digest('hex') !== image.sha256) throw new Error('Research image cannot be retained.');
  const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[image.content_type];
  const storage_key = `research-evidence/${image.sha256}.${extension}`;
  await uploadPrivateChecksumBuffer(storage_key, image.bytes, image.content_type, { checksumSha256: image.sha256, cacheControl: 'private, max-age=31536000, immutable', signal });
  if (signal.aborted) throw new Error('Research image archive was cancelled.');
  return { storage_key };
}
