const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, rmSync, symlinkSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createHash } = require('node:crypto');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function fixture(run) {
  const { simulatorSourceIdentity } = await import('../../../scripts/vault-simulator-source.mjs');
  const root = mkdtempSync(join(tmpdir(), 'vault-source-provenance-'));
  const manifest = { schemaVersion: 1, sourceState: 'UNCOMMITTED_CANDIDATE', baseCommit: 'a'.repeat(40), files: [{ path: 'source.js', size: 5, sha256: hash('hello') }] };
  const path = join(root, 'candidate-source.json');
  const save = () => writeFileSync(path, JSON.stringify(manifest));
  writeFileSync(join(root, 'source.js'), 'hello'); save();
  try { await run({ root, path, manifest, save, read: () => simulatorSourceIdentity(root, path) }); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

test('Git-free candidate retains exact source hash without asserting a certified source commit', async () => fixture(({ read }) => {
  const identity = read();
  assert.equal(identity.sourceState, 'UNCOMMITTED_CANDIDATE');
  assert.match(identity.sourceCommit, /^CANDIDATE_SHA256:[a-f0-9]{64}$/);
  assert.ok(!/^[a-f0-9]{40}$/.test(identity.sourceCommit));
}));
test('changed source and repeated or escaping manifest paths are rejected', async () => fixture(({ root, manifest, save, read }) => {
  writeFileSync(join(root, 'source.js'), 'other');
  assert.throws(read, /Candidate file changed/);
  writeFileSync(join(root, 'source.js'), 'hello');
  manifest.files.push({ ...manifest.files[0] }); save();
  assert.throws(read, /Duplicate/);
  manifest.files.pop(); manifest.files[0].path = '../source.js'; save();
  assert.throws(read, /Unsafe candidate path/);
}));
test('candidate verification rejects symlinked source', async () => fixture(({ root, read }) => {
  rmSync(join(root, 'source.js'));
  writeFileSync(join(root, 'elsewhere.js'), 'hello');
  symlinkSync('elsewhere.js', join(root, 'source.js'));
  assert.throws(read, /symlinks/);
}));
