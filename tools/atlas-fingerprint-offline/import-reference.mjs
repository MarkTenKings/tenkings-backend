// Import is inert. Calling importReference reads only one explicitly supplied,
// flat four-file directory. There is no acquisition, URL, environment or CLI.
import { open, lstat, realpath, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, resolve, join } from 'node:path';
import { FILES, LIMITS, digest, parseManifest, validatePacket, validateImage, requireFact } from './contract.mjs';

const sameStat = (a, b) => ['dev', 'ino', 'mode', 'nlink', 'size', 'mtimeNs', 'ctimeNs'].every(key => a[key] === b[key]);
const regular = s => s.isFile() && s.nlink === 1n && (s.mode & 0o111n) === 0n;
const freeze = value => { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };
async function inventory(directory, before) {
  const root = await lstat(directory, { bigint: true });
  requireFact(root.isDirectory() && !root.isSymbolicLink() && (!before || sameStat(root, before)), 'REFERENCE_DIRECTORY_CHANGED');
  const entries = await readdir(directory, { withFileTypes: true });
  requireFact(entries.length === FILES.length && entries.every(entry => entry.isFile() && FILES.includes(entry.name)), 'REFERENCE_DIRECTORY_CONTENTS_INVALID');
  return root;
}
async function read(handle, expected, cap) {
  const before = await handle.stat({ bigint: true });
  requireFact(regular(before) && sameStat(before, expected) && before.size > 0n && before.size <= BigInt(cap), 'REFERENCE_FILE_CHANGED_OR_OVERSIZED');
  // One extra byte detects growth; there is no unbounded stream/readFile.
  const bytes = Buffer.alloc(Number(before.size) + 1); let offset = 0;
  while (offset < bytes.length) {
    const result = await handle.read(bytes, offset, bytes.length - offset, offset);
    if (!result.bytesRead) break; offset += result.bytesRead;
  }
  requireFact(offset === Number(before.size) && sameStat(before, await handle.stat({ bigint: true })), 'REFERENCE_FILE_CHANGED');
  return bytes.subarray(0, offset);
}

/** expectedManifestSha256 is an independent caller pin, not proof of issuer
 * authority. The human-copy acknowledgment is an explicit declaration, not a
 * verified human identity. Use an operator-controlled, quiescent directory.
 * Node path/stat checks do not replace an OS sandbox against a hostile writer
 * concurrently replacing ancestor directories. No files are written here. */
export async function importReference(options) {
  requireFact(options && Object.getPrototypeOf(options) === Object.prototype
    && Reflect.ownKeys(options).length === 3 && ['directory', 'expectedManifestSha256', 'acknowledgeHumanSuppliedCopy'].every(key => Object.hasOwn(Object.getOwnPropertyDescriptor(options, key) ?? {}, 'value')), 'REFERENCE_IMPORT_OPTIONS_INVALID');
  const { directory, expectedManifestSha256, acknowledgeHumanSuppliedCopy } = options;
  requireFact(acknowledgeHumanSuppliedCopy === true, 'REFERENCE_HUMAN_COPY_ACKNOWLEDGMENT_REQUIRED');
  requireFact(typeof expectedManifestSha256 === 'string' && /^[a-f0-9]{64}$/.test(expectedManifestSha256), 'REFERENCE_MANIFEST_PIN_REQUIRED');
  requireFact(typeof directory === 'string' && isAbsolute(directory) && directory === resolve(directory), 'REFERENCE_LOCAL_DIRECTORY_REQUIRED');
  requireFact(typeof constants.O_NOFOLLOW === 'number' && typeof constants.O_NONBLOCK === 'number', 'REFERENCE_PLATFORM_UNSUPPORTED');
  const handles = new Map(), stats = new Map();
  try {
    requireFact(await realpath(directory) === directory, 'REFERENCE_SYMLINK_REFUSED');
    const root = await inventory(directory);
    const caps = { 'manifest.json': LIMITS.manifestBytes, 'packet.json': LIMITS.packetBytes, 'front.webp': LIMITS.imageBytes, 'back.webp': LIMITS.imageBytes };
    // Pin all four regular, non-executable, singly-linked file descriptors
    // before reading any bytes. No nested paths, symlinks or extra files.
    for (const name of FILES) {
      const path = join(directory, name), observed = await lstat(path, { bigint: true });
      requireFact(regular(observed) && observed.size > 0n && observed.size <= BigInt(caps[name]), 'REFERENCE_FILE_UNSAFE_OR_OVERSIZED');
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); handles.set(name, handle);
      const pinned = await handle.stat({ bigint: true });
      requireFact(regular(pinned) && sameStat(observed, pinned), 'REFERENCE_FILE_CHANGED'); stats.set(name, pinned);
    }
    await inventory(directory, root);
    requireFact([...stats.values()].reduce((sum, stat) => sum + stat.size, 0n) <= BigInt(LIMITS.packageBytes), 'REFERENCE_PACKAGE_SIZE');
    const manifestBytes = await read(handles.get('manifest.json'), stats.get('manifest.json'), LIMITS.manifestBytes);
    requireFact(digest(manifestBytes) === expectedManifestSha256, 'REFERENCE_MANIFEST_HASH_MISMATCH');
    const manifest = parseManifest(manifestBytes);
    const packetBytes = await read(handles.get('packet.json'), stats.get('packet.json'), LIMITS.packetBytes);
    const packet = validatePacket(packetBytes, manifest);
    for (const side of ['FRONT', 'BACK']) {
      const name = `${side.toLowerCase()}.webp`;
      validateImage(await read(handles.get(name), stats.get(name), LIMITS.imageBytes), manifest.images[side]);
    }
    await inventory(directory, root);
    for (const name of FILES) requireFact(sameStat(stats.get(name), await handles.get(name).stat({ bigint: true }))
      && sameStat(stats.get(name), await lstat(join(directory, name), { bigint: true })), 'REFERENCE_FILE_CHANGED');
    const traceAvailability = packet.findingCount === 0 ? 'NO_RECORDED_DEFECTS' : packet.availableTraces === 0 ? 'UNAVAILABLE'
      : packet.availableTraces === packet.findingCount ? 'COMPLETE' : 'PARTIAL';
    return freeze({ schema: 'atlas-fingerprint-offline-import-v1', status: 'REFERENCE_BYTES_VALIDATED', manifestSha256: expectedManifestSha256,
      copy: manifest.copy, approval: manifest.approval, identity: packet.identity,
      artifacts: { packet: manifest.packet, images: manifest.images, geometrySha256: manifest.geometrySha256, traces: manifest.traces },
      availability: { findingCount: packet.findingCount, availableTraces: packet.availableTraces, traceAvailability },
      limits: { originAuthority: 'HUMAN_DECLARED_NOT_VERIFIED', reportHash: 'COPIED_IDENTIFIER_ONLY', privateApprovalAction: 'NOT_SUPPLIED',
        rawMasters: 'NOT_SUPPLIED', imageValidation: 'HASH_AND_STATIC_WEBP_HEADER_ONLY', imageDecode: 'NOT_PERFORMED',
        physicalCalibration: 'NOT_QUALIFIED', comparison: 'NOT_IMPLEMENTED' },
      decision: { outcome: 'UNAVAILABLE', reason: 'NO_MATCHER_IMPLEMENTED' } });
  } catch (error) {
    // Do not echo paths, manifest values, credentials or provider text on failure.
    if (typeof error?.code === 'string' && error.code.startsWith('REFERENCE_')) throw error;
    throw Object.assign(new Error('REFERENCE_LOCAL_READ_FAILED'), { code: 'REFERENCE_LOCAL_READ_FAILED' });
  } finally { await Promise.allSettled([...handles.values()].map(handle => handle.close())); }
}
