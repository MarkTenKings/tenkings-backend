// LOCAL FIXTURE ONLY. Production composition uses private object storage.
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, link, unlink, readFile, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { requireThat } from '../src/contract.mjs';

export async function createFileArtifactTransport(directory) {
  const root = await realpath(directory), owner = await stat(root);
  requireThat(owner.isDirectory() && owner.uid === process.getuid() && (owner.mode & 0o077) === 0,
    500, 'MANUAL_FIXTURE_DIRECTORY_INVALID');
  function path(key) {
    requireThat(typeof key === 'string' && /^[A-Za-z0-9_/-]+\.json$/.test(key) && !key.includes('..'));
    return join(root, key);
  }
  return Object.freeze({
    async putIfAbsent({ key, bytes, sha256, lineageSha256, contentType, signal }) {
      requireThat(!signal?.aborted, 503, 'MANUAL_ARTIFACT_WRITE_ABORTED');
      const target = path(key), parent = target.slice(0, target.lastIndexOf('/'));
      await mkdir(parent, { recursive: true, mode: 0o700 });
      const temporary = `${target}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify({ sha256, lineageSha256, contentType, bytes: bytes.toString('base64') }), { flag: 'wx', mode: 0o600 });
        // Hard-link publication is atomic and fails if the immutable key exists.
        await link(temporary, target);
      } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    },
    async read({ key, maxBytes, signal }) {
      requireThat(!signal?.aborted, 503, 'MANUAL_ARTIFACT_READ_ABORTED');
      const target = path(key), info = await stat(target);
      requireThat(info.size <= maxBytes * 2 + 1024 && info.uid === process.getuid(), 503, 'MANUAL_ARTIFACT_UNVERIFIED');
      const record = JSON.parse(await readFile(target, 'utf8'));
      return { bytes: Buffer.from(record.bytes, 'base64'), contentType: record.contentType, lineageSha256: record.lineageSha256 };
    },
  });
}
