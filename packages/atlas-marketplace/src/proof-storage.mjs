import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { constants, closeSync, fchmodSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { canonicalJSON, hash, requireValue } from './contract.mjs';

const stores = new WeakMap();
export const PROOF_STORAGE_SCHEMA = 'atlas-marketplace-proof-encrypted-v1';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const keyValid = key => typeof key === 'string' && /^[a-f0-9]{64}$/.test(key);
function privateDirectory(directory) {
  requireValue(isAbsolute(directory) && realpathSync(directory) === resolve(directory), 'PROOF_STORAGE_PATH_REFUSED');
  const info = lstatSync(directory);
  requireValue(info.isDirectory() && !info.isSymbolicLink() && (info.mode & 0o077) === 0 && info.uid === process.getuid?.(), 'PROOF_STORAGE_PERMISSIONS_REFUSED');
}
function syncDirectory(directory) { const fd = openSync(directory, constants.O_RDONLY); try { fsyncSync(fd); } finally { closeSync(fd); } }

/** Owned, encrypted, create-only storage. No environment discovery, public URLs,
 * overwrite or delete operation. A host must qualify backup and physical volume
 * retention separately. Root must already exist with owner-only permissions. */
export function createEncryptedProofStorage({ directory, encryptionKey, keyId, storageId, environment, retentionRef, maxObjectBytes = 10485760, readOnly = false } = {}) {
  requireValue(typeof directory === 'string' && isAbsolute(directory), 'PROOF_STORAGE_PATH_REFUSED');
  privateDirectory(directory);
  requireValue(Buffer.isBuffer(encryptionKey) && encryptionKey.length === 32 && typeof keyId === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(keyId), 'PROOF_STORAGE_KEY_REQUIRED');
  requireValue(typeof storageId === 'string' && storageId.length > 0 && typeof retentionRef === 'string' && retentionRef.length > 0 && ['SYNTHETIC_LOCAL','PROVIDER_SANDBOX','PRODUCTION'].includes(environment), 'PROOF_STORAGE_CONFIGURATION_REQUIRED');
  requireValue(Number.isSafeInteger(maxObjectBytes) && maxObjectBytes > 0 && maxObjectBytes <= 10485760, 'PROOF_STORAGE_LIMIT_INVALID');
  const key = Buffer.from(encryptionKey), binding = Object.freeze({ schema: PROOF_STORAGE_SCHEMA, storageId, environment, retentionRef, keyId, maxObjectBytes });
  let closed = false;
  const ready = () => { requireValue(!closed, 'PROOF_STORAGE_UNAVAILABLE'); privateDirectory(directory); };
  function file(objectKey) { requireValue(keyValid(objectKey), 'PROOF_OBJECT_KEY_INVALID'); return join(directory, objectKey + '.proof'); }
  function read(objectKey) {
    ready(); const filename = file(objectKey);
    let fd;
    try { fd = openSync(filename, constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    try {
      const stat = fstatSync(fd);
      requireValue(stat.isFile() && stat.uid === process.getuid?.() && (stat.mode & 0o077) === 0 && stat.size > 0 && stat.size <= Math.ceil(maxObjectBytes * 1.8) + 32768, 'PROOF_STORAGE_CORRUPT');
      const envelope = JSON.parse(readFileSync(fd, 'utf8'));
      requireValue(envelope.schema === PROOF_STORAGE_SCHEMA && envelope.keyId === keyId && envelope.objectKey === objectKey && envelope.storageHash === hash(binding), 'PROOF_STORAGE_BINDING_MISMATCH');
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
      decipher.setAAD(Buffer.from(canonicalJSON({ binding, objectKey })));
      decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
      const plain = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]);
      let retained; try { retained = JSON.parse(plain.toString('utf8')); } finally { plain.fill(0); }
      const bytes = Buffer.from(retained.bytes, 'base64'), manifest = retained.manifest;
      requireValue(bytes.length > 0 && bytes.length <= maxObjectBytes && bytes.length === manifest.byteCount && sha(bytes) === manifest.sha256 && hash(manifest) === envelope.manifestHash, 'PROOF_STORAGE_CORRUPT');
      return { manifest, bytes, objectKey, manifestHash: envelope.manifestHash };
    } catch (error) { requireValue(false, error.code?.startsWith('PROOF_') ? error.code : 'PROOF_STORAGE_CORRUPT'); }
    finally { closeSync(fd); }
  }
  const storage = Object.freeze({ binding,
    put({ objectKey, manifest, bytes }) {
      requireValue(!readOnly, 'PROOF_STORAGE_READ_ONLY');
      ready(); requireValue(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= maxObjectBytes && manifest?.byteCount === bytes.length && manifest?.sha256 === sha(bytes), 'PROOF_STORAGE_SOURCE_MISMATCH');
      requireValue(manifest.environment === environment && manifest.storageId === storageId && manifest.retentionRef === retentionRef && Number.isSafeInteger(manifest.retainUntil) && manifest.retainUntil > manifest.createdAt, 'PROOF_STORAGE_BINDING_MISMATCH');
      const prior = read(objectKey);
      if (prior) { requireValue(prior.manifestHash === hash(manifest) && prior.bytes.equals(bytes), 'PROOF_OBJECT_CONFLICT'); prior.bytes.fill(0); return { objectKey, manifestHash: hash(manifest) }; }
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(canonicalJSON({ binding, objectKey })));
      const plain = Buffer.from(canonicalJSON({ manifest, bytes: bytes.toString('base64') }));
      let ciphertext; try { ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]); } finally { plain.fill(0); }
      const envelope = { schema: PROOF_STORAGE_SCHEMA, keyId, storageHash: hash(binding), objectKey, manifestHash: hash(manifest), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
      // A fully written private staging file is linked atomically to the final
      // name. A crash can leave an encrypted staging file, never partial proof.
      const temporary = join(directory, '.pending-' + randomBytes(16).toString('hex'));
      let fd;
      try { fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); writeFileSync(fd, canonicalJSON(envelope)); fchmodSync(fd, 0o400); fsyncSync(fd); }
      finally { if (fd !== undefined) closeSync(fd); }
      // rename would replace; link is an atomic no-overwrite publication.
      try { linkFile(temporary, file(objectKey)); }
      catch (error) { if (error.code !== 'EEXIST') throw error; const existing = read(objectKey); requireValue(existing?.manifestHash === hash(manifest) && existing.bytes.equals(bytes), 'PROOF_OBJECT_CONFLICT'); existing.bytes.fill(0); }
      finally { removeStaging(temporary); }
      syncDirectory(directory);
      return { objectKey, manifestHash: hash(manifest) };
    },
    get({ objectKey }) { return read(objectKey); },
    close() { closed = true; key.fill(0); }
  });
  stores.set(storage, { binding, ready }); return storage;
}
// Only agent-owned encrypted staging is removed; retained originals have no
// application deletion path, including after retention minimum has elapsed.
import { linkSync as linkFile, unlinkSync as removeStaging } from 'node:fs';
export function assertProofStorage(storage, { environment, retentionRef } = {}) {
  requireValue(stores.has(storage) && storage.binding.environment === environment && storage.binding.retentionRef === retentionRef, 'PROOF_STORAGE_UNAVAILABLE');
  stores.get(storage).ready();return storage;
}
