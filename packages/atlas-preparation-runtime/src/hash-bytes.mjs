import { createHash, webcrypto } from 'node:crypto';
import { aborted, PreparationError } from './process.mjs';

// Only accept the caller's already-owned snapshot. Descriptor hashes remain
// synchronous; large image digests run in the bounded Node worker pool.
export async function hashOwnedBytes(bytes, signal) {
  if (aborted(signal)) throw new PreparationError('PREPARATION_CANCELLED');
  const hash = bytes.byteLength < 1024 * 1024 ? createHash('sha256').update(bytes).digest('hex')
    : Buffer.from(await webcrypto.subtle.digest('SHA-256', bytes)).toString('hex');
  if (aborted(signal)) throw new PreparationError('PREPARATION_CANCELLED');
  return hash;
}
