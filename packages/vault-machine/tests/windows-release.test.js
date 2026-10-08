const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { validateRelease, assertWindowsRelativePath } = require('../windows/verify-release.cjs');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

test('Windows release validation authenticates all copied bytes and rejects path, alias, omitted and changed members', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-release-test-'));
  const release = path.join(directory, 'release'); fs.mkdirSync(release); fs.mkdirSync(path.join(release, 'dist'));
  const bytes = Buffer.from('console.log("safe fixture")\n'); fs.writeFileSync(path.join(release, 'dist/cli.js'), bytes);
  const manifestPath = path.join(directory, 'manifest.json');
  const manifest = { schemaVersion: 1, version: '0.1.0', sourceCommit: 'a'.repeat(40), nodeMajor: 20, files: [{ path: 'dist/cli.js', size: bytes.length, sha256: sha(bytes) }] };
  const write = value => { const encoded = JSON.stringify(value); fs.writeFileSync(manifestPath, encoded); return sha(encoded); };
  try {
    let digest = write(manifest); assert.deepEqual(validateRelease(release, manifestPath, digest), manifest);
    assert.throws(() => validateRelease(release, manifestPath, 'b'.repeat(64)), /digest mismatch/);
    fs.writeFileSync(path.join(release, 'extra.exe'), 'unreviewed'); assert.throws(() => validateRelease(release, manifestPath, digest), /Unlisted/); fs.unlinkSync(path.join(release, 'extra.exe'));
    fs.writeFileSync(path.join(release, 'dist/cli.js'), 'changed'); assert.throws(() => validateRelease(release, manifestPath, digest), /digest\/size mismatch/); fs.writeFileSync(path.join(release, 'dist/cli.js'), bytes);
    const linked = path.join(release, 'outside.js'); fs.symlinkSync(manifestPath, linked); assert.throws(() => validateRelease(release, manifestPath, digest), /symlink\/reparse/); fs.unlinkSync(linked);
    digest = write({ ...manifest, files: [...manifest.files, { ...manifest.files[0], path: 'DIST/CLI.JS' }] }); assert.throws(() => validateRelease(release, manifestPath, digest), /duplicate/);
    for (const member of ['../secret', '/absolute', 'dir\\file', 'file:stream', 'NUL.txt', 'COM1', 'aux ', 'name.', 'dir//file']) assert.throws(() => assertWindowsRelativePath(member), /path/i, member);
    digest = write({ ...manifest, nodeMajor: 22 }); assert.throws(() => validateRelease(release, manifestPath, digest), /Node 20/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
