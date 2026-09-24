import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDistribution, distributionCli, finalizeDistribution, planDistribution, submitDistribution,
  verifyDeveloperSignature, verifyDistributionBundle } from '../scripts/distribution.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const identity = 'A'.repeat(40), teamId = 'ABCDE12345', profile = 'atlas-notary';
const id = '12345678-1234-4234-8234-123456789abc';
const capabilities = { protocol: 'atlas-mac-companion-rpc-v1', productionReady: false, qualifiedProfileAvailable: false };
const platformAvailable = process.platform === 'darwin' && process.versions.node.split('.')[0] === '20';
const json = value => JSON.stringify(value, null, 2) + '\n';
async function fixture(fn) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'atlas-distribution-test-')));
  try {
    const review = join(root, 'review'); await mkdir(review, { mode: 0o700 });
    const files = [];
    for (const path of ['atlas-mac-nfc-companion', 'station.mjs', 'library.mjs']) {
      const bytes = Buffer.from(`fixture:${path}`); await writeFile(join(review, path), bytes, { mode: 0o600 });
      files.push({ path, bytes: bytes.length, sha256: sha(bytes) });
    }
    const manifest = { version: 'atlas-mac-station-review-bundle-v1', sourceCommit: 'b'.repeat(40), sourceDirty: false,
      platform: 'darwin', architecture: process.arch, minimumMacOS: '15.0', requiredNodeMajor: 20,
      distributionStatus: 'UNSIGNED_REVIEW_ONLY', installed: false, configured: false, capabilities, inputs: [],
      files: files.sort((a, b) => a.path.localeCompare(b.path)) };
    await writeFile(join(review, 'manifest.json'), json(manifest));
    const options = { directory: review, identity, teamId, output: join(root, 'distribution') };
    await fn({ root, review, manifest, options });
  } finally { await rm(root, { recursive: true, force: true }); }
}
function fakeTools(options = {}) {
  const calls = [], uploaded = {};
  const execute = (command, args) => {
    calls.push({ command, args }); const ok = stdout => ({ status: 0, stdout, stderr: '' });
    if (command === '/usr/bin/security') return ok(options.noIdentity ? '0 valid identities found' : `1) ${identity} "Developer ID Application: Test (${teamId})"`);
    if (command === '/usr/bin/codesign' && args[0] === '--force') { appendFileSync(args.at(-1), '-SIGNED'); return ok(''); }
    if (command === '/usr/bin/codesign' && args[0] === '--sign') return ok('');
    if (command === '/usr/bin/codesign' && args[0] === '--verify') return ok('');
    if (command === '/usr/bin/codesign' && args[0] === '--display') {
      const dmg = args.at(-1).endsWith('.dmg');
      return ok(`Identifier=com.atlasgrading.nfc-companion${dmg ? '.distribution' : ''}\nAuthority=Developer ID Application: Test (${teamId})\nTeamIdentifier=${teamId}\nTimestamp=Sep 23, 2026\nCodeDirectory flags=0x10000(runtime)\nCDHash=${options.changedCodeDirectory && dmg ? 'd' : 'c'}${'c'.repeat(39)}\n`);
    }
    if (args[0] === 'capabilities') return ok(JSON.stringify(capabilities));
    if (command === '/usr/bin/hdiutil' && args[0] === 'create') { writeFileSync(args.at(-1), 'SIGNED-DMG-CONTENT'); return ok(''); }
    if (command === '/usr/bin/xcrun' && args[0] === 'notarytool') {
      if (args[1] === 'submit') { uploaded.sha256 = sha(readFileSync(args[2])); return options.lostReply ? { status: null, stdout: '', stderr: '', error: 'ETIMEDOUT' } : ok(JSON.stringify({ id, status: 'In Progress' })); }
      if (args[1] === 'info') return ok(JSON.stringify({ id, status: options.notaryStatus ?? 'Accepted' }));
      if (args[1] === 'log') return ok(JSON.stringify({ jobId: id, status: 'Accepted', sha256: options.wrongArchive ? '0'.repeat(64) : uploaded.sha256 }));
    }
    if (command === '/usr/bin/xcrun' && args[0] === 'stapler') {
      if (args[1] === 'staple') appendFileSync(args[2], '-STAPLED');
      if (args[1] === 'validate' && !readFileSync(args[2], 'utf8').endsWith('-STAPLED')) return { status: 1, stdout: '', stderr: '' };
      return ok('');
    }
    if (command === '/usr/bin/hdiutil' && args[0] === 'verify') return ok('');
    if (command === '/usr/sbin/spctl') return options.gatekeeperReject ? { status: 3, stdout: '', stderr: 'rejected' } : ok('accepted');
    throw new Error(`Unexpected command ${command} ${args.join(' ')}`);
  };
  return { execute, calls, uploaded, options };
}
test('plan is hardware/key/network-free, preserves review bytes and does not create its output', async () => fixture(async ({ root, options }) => {
  const before = await readdir(root), result = await planDistribution(options);
  assert.equal(result.reviewManifestSha256, (await verifyDistributionBundle(options.directory)).manifestSha256);
  assert.equal(result.stationProvisioned, false); assert.equal(result.hardwareQualified, false);
  assert.deepEqual(await readdir(root), before);
}));
test('distribution refuses dirty source, changed or extra bytes, symlinks and path escapes', async () => fixture(async ({ review, manifest, options }) => {
  const manifestPath = join(review, 'manifest.json');
  for (const patch of [{ sourceDirty: true }, { files: [...manifest.files, { path: '../escape', bytes: 1, sha256: 'a'.repeat(64) }] }]) {
    await writeFile(manifestPath, json({ ...manifest, ...patch })); await assert.rejects(planDistribution(options), /DISTRIBUTION_/);
  }
  await writeFile(manifestPath, json(manifest));
  await writeFile(join(review, 'unexpected.json'), '{}'); await assert.rejects(planDistribution(options), /BYTES_CHANGED/); await rm(join(review, 'unexpected.json'));
  await symlink(join(review, 'station.mjs'), join(review, 'alias')); await assert.rejects(planDistribution(options), /SYMLINK/); await rm(join(review, 'alias'));
  await writeFile(join(review, 'station.mjs'), 'changed'); await assert.rejects(planDistribution(options), /BYTES_CHANGED/);
}));
test('CLI rejects secrets, duplicate options, unknown modes and imprecise signing identities', async () => fixture(async ({ options }) => {
  await assert.rejects(distributionCli(['submit', '--directory', options.directory, '--password', 'never-forwarded']), /USAGE/);
  await assert.rejects(distributionCli(['submit', '--directory', options.directory, '--directory', options.directory]), /USAGE/);
  await assert.rejects(distributionCli(['install']), /USAGE/);
  await assert.rejects(planDistribution({ ...options, identity: 'Developer ID Application: ambiguous' }), /EXACT_IDENTITY/);
}));
test('signature evidence requires Developer ID, exact team/identifier, timestamp and hardened runtime', () => {
  const good = { status: 0, stdout: `Identifier=com.atlasgrading.nfc-companion\nTeamIdentifier=${teamId}\nAuthority=Developer ID Application: Test (${teamId})\nTimestamp=today\nCodeDirectory flags=0x10000(runtime)`, stderr: '' };
  const options = { teamId, identifier: 'com.atlasgrading.nfc-companion', hardened: true };
  verifyDeveloperSignature(good, options);
  for (const [from, to] of [['Developer ID Application', 'Apple Development'], [teamId, 'ZZZZZ99999'], ['Timestamp=', 'Signed Time='], ['(runtime)', '(adhoc)']]) {
    assert.throws(() => verifyDeveloperSignature({ ...good, stdout: good.stdout.replaceAll(from, to) }, options), /DEVELOPER_SIGNATURE/);
  }
});
test('build requires a real selected identity before creating any release directory', { skip: !platformAvailable }, async () => fixture(async ({ root, options }) => {
  const before = await readdir(root), tools = fakeTools({ noIdentity: true });
  await assert.rejects(buildDistribution(options, tools.execute), /IDENTITY_UNAVAILABLE/);
  assert.deepEqual(await readdir(root), before); assert.equal(tools.calls.length, 1);
}));
test('signed final native bytes replace review hashes; notarization keeps hardware pending and retry has no new upload', { skip: !platformAvailable }, async () => fixture(async ({ review, options }) => {
  const tools = fakeTools(), original = await verifyDistributionBundle(review);
  const built = await buildDistribution(options, tools.execute);
  assert.notEqual(built.nativeSha256, original.nativeSha256);
  assert.equal((await verifyDistributionBundle(review)).manifestSha256, original.manifestSha256);
  const signed = await verifyDistributionBundle(join(options.output, 'ATLAS Finishing Station'), { signed: true });
  assert.equal(signed.nativeSha256, built.nativeSha256);
  const submitted = await submitDistribution({ directory: options.output, profile }, tools.execute); assert.equal(submitted.submissionId, id);
  await assert.rejects(submitDistribution({ directory: options.output, profile }, tools.execute), /EEXIST/);
  const result = await finalizeDistribution({ directory: options.output, profile }, tools.execute);
  assert.equal(result.distributionReady, true); assert.equal(result.capabilities.productionReady, false); assert.equal(result.hardwareQualified, false);
  assert.notEqual(result.finalArchiveSha256, result.submittedArchiveSha256);
  assert.deepEqual(await finalizeDistribution({ directory: options.output, profile }, tools.execute), result);
  assert.equal(tools.calls.filter(call => call.args[0] === 'notarytool' && call.args[1] === 'submit').length, 1);
  assert.equal(tools.calls.filter(call => call.args[0] === 'stapler' && call.args[1] === 'staple').length, 1);
}));
test('lost upload reply is retained and only a matching Apple archive log can reconcile it', { skip: !platformAvailable }, async () => fixture(async ({ options }) => {
  const tools = fakeTools({ lostReply: true }); await buildDistribution(options, tools.execute);
  await assert.rejects(submitDistribution({ directory: options.output, profile }, tools.execute), /OUTCOME_UNCERTAIN/);
  assert.equal(JSON.parse(await readFile(join(options.output, 'notary-submit-result.json'))).error, 'ETIMEDOUT');
  await assert.rejects(submitDistribution({ directory: options.output, profile }, tools.execute), /EEXIST/);
  await assert.rejects(finalizeDistribution({ directory: options.output, profile }, tools.execute), /ID_REQUIRED/);
  tools.options.wrongArchive = true;
  await assert.rejects(finalizeDistribution({ directory: options.output, profile, submissionId: id }, tools.execute), /ARCHIVE_MISMATCH/);
  tools.options.wrongArchive = false;
  assert.equal((await finalizeDistribution({ directory: options.output, profile, submissionId: id }, tools.execute)).distributionReady, true);
}));
test('pending/rejected Apple results cannot staple or claim readiness', { skip: !platformAvailable }, async () => fixture(async ({ options }) => {
  const tools = fakeTools({ notaryStatus: 'Invalid' }); await buildDistribution(options, tools.execute);
  await submitDistribution({ directory: options.output, profile }, tools.execute);
  const result = await finalizeDistribution({ directory: options.output, profile }, tools.execute);
  assert.equal(result.distributionReady, false); assert.equal(result.status, 'Invalid');
  assert.equal(tools.calls.some(call => call.args[0] === 'stapler'), false);
}));
test('post-build payload drift and another signed archive cannot be accepted', { skip: !platformAvailable }, async () => fixture(async ({ options }) => {
  const tools = fakeTools(); await buildDistribution(options, tools.execute);
  await submitDistribution({ directory: options.output, profile }, tools.execute);
  tools.options.changedCodeDirectory = true;
  await assert.rejects(finalizeDistribution({ directory: options.output, profile }, tools.execute), /ARCHIVE_SIGNATURE_CHANGED/);
  tools.options.changedCodeDirectory = false;
  await chmod(join(options.output, 'ATLAS Finishing Station', 'station.mjs'), 0o600);
  await writeFile(join(options.output, 'ATLAS Finishing Station', 'station.mjs'), 'changed');
  await assert.rejects(finalizeDistribution({ directory: options.output, profile }, tools.execute), /BYTES_CHANGED/);
}));
test('failed Gatekeeper assessment retains stapled bytes for evidence-only finalization', { skip: !platformAvailable }, async () => fixture(async ({ options }) => {
  const tools = fakeTools({ gatekeeperReject: true }); await buildDistribution(options, tools.execute);
  await submitDistribution({ directory: options.output, profile }, tools.execute);
  await assert.rejects(finalizeDistribution({ directory: options.output, profile }, tools.execute), /COMMAND_FAILED:spctl/);
  assert.equal((await readdir(options.output)).includes('distribution.json'), false);
  tools.options.gatekeeperReject = false;
  assert.equal((await finalizeDistribution({ directory: options.output, profile }, tools.execute)).distributionReady, true);
  assert.equal(tools.calls.filter(call => call.args[0] === 'stapler' && call.args[1] === 'staple').length, 1);
}));
