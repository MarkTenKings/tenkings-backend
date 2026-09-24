#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, open, readFile, readdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// A distribution container, not an installer or station provisioner. No command
// creates a station key, changes configuration, starts a service or touches RF.
const REVIEW = 'atlas-mac-station-review-bundle-v1';
const SIGNED = 'atlas-mac-station-signed-bundle-v1';
const IDENTIFIER = 'com.atlasgrading.nfc-companion';
const PRODUCT = 'ATLAS Finishing Station';
const ARCHIVE = 'ATLAS-Finishing-Station.dmg';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const check = (ok, code) => { if (!ok) throw new Error(code); };
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
async function read(path, max = 64 * 1024 * 1024) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    check(stat.isFile() && stat.size > 0 && stat.size <= max, 'DISTRIBUTION_FILE_INVALID');
    return await handle.readFile();
  } finally { await handle.close(); }
}
async function save(path, value) {
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(json(value)); await handle.sync(); } finally { await handle.close(); }
  const parent = await open(dirname(path), constants.O_RDONLY); try { await parent.sync(); } finally { await parent.close(); }
}
async function directory(path) {
  check(isAbsolute(path) && resolve(path) === path && await realpath(path) === path, 'DISTRIBUTION_CANONICAL_PATH_REQUIRED');
  const stat = await lstat(path);
  check(stat.isDirectory() && !stat.isSymbolicLink() && !(stat.mode & 0o022), 'DISTRIBUTION_DIRECTORY_UNSAFE');
  return path;
}
async function census(root, at = '') {
  const files = [];
  for (const entry of await readdir(join(root, at), { withFileTypes: true })) {
    const name = at ? `${at}/${entry.name}` : entry.name;
    check(/^[A-Za-z0-9_. /-]+$/.test(name), 'DISTRIBUTION_FILENAME_INVALID');
    if (entry.isDirectory()) files.push(...await census(root, name));
    else {
      check(entry.isFile(), 'DISTRIBUTION_SYMLINK_OR_SPECIAL_FILE');
      const bytes = await read(join(root, name));
      files.push({ path: name, bytes: bytes.length, sha256: sha(bytes) });
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
export async function verifyDistributionBundle(path, { signed = false } = {}) {
  await directory(path);
  const raw = await read(join(path, 'manifest.json'), 1024 * 1024), manifest = JSON.parse(raw);
  check(manifest.version === (signed ? SIGNED : REVIEW) && manifest.sourceDirty === false
    && /^[a-f0-9]{40}$/.test(manifest.sourceCommit ?? '') && manifest.platform === 'darwin'
    && ['arm64', 'x64'].includes(manifest.architecture) && manifest.requiredNodeMajor === 20
    && manifest.minimumMacOS === '15.0', 'DISTRIBUTION_REVIEW_REQUIRED');
  check(manifest.distributionStatus === (signed ? 'SIGNED_PENDING_NOTARIZATION' : 'UNSIGNED_REVIEW_ONLY')
    && manifest.installed === false && manifest.configured === false, 'DISTRIBUTION_STATUS_INVALID');
  check(Array.isArray(manifest.files) && manifest.files.length > 0 && manifest.files.length <= 512, 'DISTRIBUTION_MANIFEST_INVALID');
  const names = new Set();
  for (const file of manifest.files) {
    check(typeof file.path === 'string' && !isAbsolute(file.path) && !file.path.split('/').some(p => !p || p === '.' || p === '..')
      && !names.has(file.path) && file.path !== 'manifest.json' && digest(file.sha256)
      && Number.isSafeInteger(file.bytes) && file.bytes > 0, 'DISTRIBUTION_MANIFEST_INVALID');
    names.add(file.path);
  }
  check(['atlas-mac-nfc-companion', 'station.mjs', 'library.mjs'].every(name => names.has(name)), 'DISTRIBUTION_PAYLOAD_MISSING');
  const actual = (await census(path)).filter(file => file.path !== 'manifest.json');
  check(JSON.stringify(actual) === JSON.stringify([...manifest.files].sort((a, b) => a.path.localeCompare(b.path))), 'DISTRIBUTION_BYTES_CHANGED');
  return { manifest, manifestSha256: sha(raw), nativeSha256: actual.find(file => file.path === 'atlas-mac-nfc-companion').sha256 };
}
function signingOptions(options) {
  check(typeof options.identity === 'string' && /^[A-Fa-f0-9]{40}$/.test(options.identity), 'DISTRIBUTION_EXACT_IDENTITY_SHA1_REQUIRED');
  check(typeof options.teamId === 'string' && /^[A-Z0-9]{10}$/.test(options.teamId), 'DISTRIBUTION_TEAM_ID_REQUIRED');
  check(isAbsolute(options.output ?? '') && resolve(options.output) === options.output, 'DISTRIBUTION_OUTPUT_INVALID');
}
export async function planDistribution(options) {
  signingOptions(options);
  const reviewed = await verifyDistributionBundle(options.directory);
  return { version: 'atlas-mac-station-distribution-plan-v1', reviewDirectory: options.directory,
    reviewManifestSha256: reviewed.manifestSha256, sourceCommit: reviewed.manifest.sourceCommit,
    identity: options.identity.toUpperCase(), teamId: options.teamId, output: options.output,
    container: 'SIGNED_NOTARIZED_DMG', requiredNodeMajor: 20,
    effects: ['COPY_REVIEW_BUNDLE', 'SIGN_NATIVE_AND_DMG', 'SUBMIT_TO_APPLE_EXPLICITLY', 'STAPLE_AND_VERIFY'],
    stationProvisioned: false, hardwareQualified: false };
}
export function localDistributionCommand(command, args) {
  const result = spawnSync(command, args, { shell: false, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 300000,
    env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, LANG: 'C', LC_ALL: 'C' } });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '',
    ...(result.error ? { error: result.error.code ?? 'EXECUTION_FAILED' } : {}) };
}
function run(command, args, execute) {
  const result = execute(command, args);
  check(result.status === 0 && !result.error, `DISTRIBUTION_COMMAND_FAILED:${command.split('/').at(-1)}`);
  return result;
}
export function verifyDeveloperSignature(result, { teamId, identifier, hardened = false }) {
  const text = `${result.stdout}\n${result.stderr}`;
  check(result.status === 0 && text.split('\n').includes(`TeamIdentifier=${teamId}`)
    && text.split('\n').includes(`Identifier=${identifier}`)
    && new RegExp(`^Authority=Developer ID Application: .+ \\(${teamId}\\)$`, 'm').test(text)
    && /^Timestamp=.+$/m.test(text) && (!hardened || /flags=0x[0-9a-f]+\(runtime\)/i.test(text)), 'DISTRIBUTION_DEVELOPER_SIGNATURE_REQUIRED');
}
function codeDirectoryHash(observation) {
  const value = `${observation.stdout}\n${observation.stderr}`.match(/^CDHash=([a-f0-9]{40,64})$/m)?.[1];
  check(value, 'DISTRIBUTION_CODE_DIRECTORY_HASH_REQUIRED'); return value;
}
async function signature(path, options, execute) {
  run('/usr/bin/codesign', ['--verify', '--strict', '--verbose=2', path], execute);
  const observed = run('/usr/bin/codesign', ['--display', '--verbose=4', path], execute);
  verifyDeveloperSignature(observed, options); return observed;
}
export async function buildDistribution(options, execute = localDistributionCommand) {
  const plan = await planDistribution(options);
  check(process.platform === 'darwin' && process.versions.node.split('.')[0] === '20', 'DISTRIBUTION_MAC_NODE20_REQUIRED');
  const identities = run('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning'], execute).stdout;
  check(identities.split('\n').some(line => line.includes(plan.identity)
    && line.includes('"Developer ID Application: ') && line.includes(`(${plan.teamId})"`)), 'DISTRIBUTION_IDENTITY_UNAVAILABLE');
  await directory(dirname(plan.output)); await mkdir(plan.output, { mode: 0o700 }); await directory(plan.output);
  await save(join(plan.output, 'plan.json'), plan);
  const product = join(plan.output, PRODUCT); await mkdir(product, { mode: 0o755 });
  const reviewed = await verifyDistributionBundle(plan.reviewDirectory);
  check(reviewed.manifestSha256 === plan.reviewManifestSha256, 'DISTRIBUTION_REVIEW_CHANGED');
  for (const file of reviewed.manifest.files) {
    const destination = join(product, file.path); await mkdir(dirname(destination), { recursive: true, mode: 0o755 });
    await copyFile(join(plan.reviewDirectory, file.path), destination, constants.COPYFILE_EXCL);
    check(sha(await read(destination)) === file.sha256, 'DISTRIBUTION_COPY_CHANGED');
    await chmod(destination, file.path === 'atlas-mac-nfc-companion' ? 0o700 : 0o600);
  }
  const native = join(product, 'atlas-mac-nfc-companion');
  run('/usr/bin/codesign', ['--force', '--sign', plan.identity, '--identifier', IDENTIFIER, '--options', 'runtime', '--timestamp', native], execute);
  const nativeSignature = await signature(native, { teamId: plan.teamId, identifier: IDENTIFIER, hardened: true }, execute);
  const capabilities = JSON.parse(run(native, ['capabilities'], execute).stdout);
  check(JSON.stringify(capabilities) === JSON.stringify(reviewed.manifest.capabilities), 'DISTRIBUTION_CAPABILITIES_CHANGED');
  const manifest = { ...reviewed.manifest, version: SIGNED, distributionStatus: 'SIGNED_PENDING_NOTARIZATION',
    reviewManifestSha256: plan.reviewManifestSha256, signing: { identity: plan.identity, teamId: plan.teamId, identifier: IDENTIFIER },
    files: await census(product) };
  await save(join(product, 'manifest.json'), manifest);
  // Readable by the recipient on the mounted image, never group/world writable.
  // The enclosing build output remains private; no config or key is packaged.
  for (const file of [...manifest.files, { path: 'manifest.json' }])
    await chmod(join(product, file.path), file.path === 'atlas-mac-nfc-companion' ? 0o555 : 0o444);
  const checked = await verifyDistributionBundle(product, { signed: true });
  const archive = join(plan.output, ARCHIVE);
  run('/usr/bin/hdiutil', ['create', '-volname', PRODUCT, '-srcfolder', product, '-format', 'UDZO', archive], execute);
  run('/usr/bin/codesign', ['--sign', plan.identity, '--identifier', `${IDENTIFIER}.distribution`, '--timestamp', archive], execute);
  const archiveSignature = await signature(archive, { teamId: plan.teamId, identifier: `${IDENTIFIER}.distribution` }, execute);
  const receipt = { version: 'atlas-mac-station-distribution-build-v1', planSha256: sha(json(plan)), manifestSha256: checked.manifestSha256,
    nativeSha256: checked.nativeSha256, archiveSha256: sha(await read(archive)), nativeSignature, archiveSignature,
    distributionStatus: 'SIGNED_PENDING_NOTARIZATION', stationProvisioned: false, hardwareQualified: false };
  await save(join(plan.output, 'build.json'), receipt); return receipt;
}
async function loadBuild(path, { archiveUnchanged = true } = {}) {
  await directory(path);
  const plan = JSON.parse(await read(join(path, 'plan.json'), 1024 * 1024));
  const receipt = JSON.parse(await read(join(path, 'build.json'), 1024 * 1024));
  check(plan.output === path && receipt.version === 'atlas-mac-station-distribution-build-v1'
    && receipt.planSha256 === sha(json(plan)), 'DISTRIBUTION_BUILD_INVALID');
  signingOptions(plan);
  const bundle = await verifyDistributionBundle(join(path, PRODUCT), { signed: true });
  check(bundle.manifestSha256 === receipt.manifestSha256 && bundle.nativeSha256 === receipt.nativeSha256, 'DISTRIBUTION_PAYLOAD_CHANGED');
  if (archiveUnchanged) check(sha(await read(join(path, ARCHIVE))) === receipt.archiveSha256, 'DISTRIBUTION_ARCHIVE_CHANGED');
  return { plan, receipt, bundle };
}
function profileName(profile) { check(typeof profile === 'string' && /^[A-Za-z0-9][A-Za-z0-9_. -]{0,127}$/.test(profile), 'DISTRIBUTION_NOTARY_PROFILE_REQUIRED'); }
export async function submitDistribution({ directory: path, profile }, execute = localDistributionCommand) {
  profileName(profile); const { receipt } = await loadBuild(path);
  // Persist BEFORE upload. A timeout/lost reply never authorizes another submit.
  const intent = { version: 'atlas-mac-station-notary-intent-v1', id: randomUUID(), archiveSha256: receipt.archiveSha256, profile };
  await save(join(path, 'notary-submit-intent.json'), intent);
  const raw = execute('/usr/bin/xcrun', ['notarytool', 'submit', join(path, ARCHIVE), '--keychain-profile', profile, '--output-format', 'json', '--no-wait']);
  await save(join(path, 'notary-submit-result.json'), raw);
  check(raw.status === 0 && !raw.error, 'DISTRIBUTION_NOTARY_OUTCOME_UNCERTAIN');
  const response = JSON.parse(raw.stdout); check(uuid(response.id), 'DISTRIBUTION_NOTARY_OUTCOME_UNCERTAIN');
  return { submissionId: response.id, status: response.status ?? 'SUBMITTED', archiveSha256: receipt.archiveSha256, resubmitAllowed: false };
}
export async function finalizeDistribution({ directory: path, profile, submissionId }, execute = localDistributionCommand) {
  profileName(profile);
  // Stapling changes the archive. A repeated finalize validates existing output;
  // a crash during stapling can resume with the exact Apple log + payload hashes.
  const { plan, receipt, bundle } = await loadBuild(path, { archiveUnchanged: false });
  const intent = JSON.parse(await read(join(path, 'notary-submit-intent.json'), 16384));
  check(intent.archiveSha256 === receipt.archiveSha256 && intent.profile === profile, 'DISTRIBUTION_NOTARY_INTENT_MISMATCH');
  let observedId;
  try { const saved = JSON.parse(await read(join(path, 'notary-submit-result.json'), 8 * 1024 * 1024)); observedId = JSON.parse(saved.stdout).id; }
  catch { /* Explicit ID from Apple's submission history can reconcile a lost reply. */ }
  const id = submissionId ?? observedId;
  check(uuid(id) && (!observedId || id === observedId), 'DISTRIBUTION_NOTARY_ID_REQUIRED_OR_CONFLICTING');
  const info = run('/usr/bin/xcrun', ['notarytool', 'info', id, '--keychain-profile', profile, '--output-format', 'json'], execute);
  const state = JSON.parse(info.stdout); check(state.id === id, 'DISTRIBUTION_NOTARY_ID_MISMATCH');
  if (state.status !== 'Accepted') return { submissionId: id, status: state.status, distributionReady: false, resubmitAllowed: false };
  const log = run('/usr/bin/xcrun', ['notarytool', 'log', id, '--keychain-profile', profile], execute);
  const accepted = JSON.parse(log.stdout);
  check(accepted.jobId === id && accepted.status === 'Accepted' && accepted.sha256 === receipt.archiveSha256, 'DISTRIBUTION_NOTARY_ARCHIVE_MISMATCH');
  const archive = join(path, ARCHIVE);
  await signature(join(path, PRODUCT, 'atlas-mac-nfc-companion'), { teamId: plan.teamId, identifier: IDENTIFIER, hardened: true }, execute);
  const archiveSignature = await signature(archive, { teamId: plan.teamId, identifier: `${IDENTIFIER}.distribution` }, execute);
  check(codeDirectoryHash(archiveSignature) === codeDirectoryHash(receipt.archiveSignature), 'DISTRIBUTION_ARCHIVE_SIGNATURE_CHANGED');
  // Verify pre-staple bytes OR a previously stapled archive. Never bless arbitrary
  // archive changes merely because another upload with the same name was accepted.
  if (sha(await read(archive)) !== receipt.archiveSha256) run('/usr/bin/xcrun', ['stapler', 'validate', archive], execute);
  else run('/usr/bin/xcrun', ['stapler', 'staple', archive], execute);
  run('/usr/bin/xcrun', ['stapler', 'validate', archive], execute);
  run('/usr/bin/hdiutil', ['verify', archive], execute);
  run('/usr/sbin/spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=2', archive], execute);
  const result = { version: 'atlas-mac-station-notarized-distribution-v1', submissionId: id,
    sourceCommit: bundle.manifest.sourceCommit, manifestSha256: bundle.manifestSha256, nativeSha256: bundle.nativeSha256,
    submittedArchiveSha256: receipt.archiveSha256, finalArchiveSha256: sha(await read(archive)), teamId: plan.teamId,
    distributionReady: true, stationProvisioned: false, hardwareQualified: false,
    capabilities: bundle.manifest.capabilities, appleInfo: state, appleLog: accepted };
  const target = join(path, 'distribution.json');
  try { await save(target, result); }
  catch (error) { if (error.code !== 'EEXIST') throw error; check(sha(await read(target)) === sha(json(result)), 'DISTRIBUTION_RECEIPT_CHANGED'); }
  return result;
}
export async function distributionCli(args) {
  const [command, ...rest] = args, values = {};
  check(['plan', 'build', 'submit', 'finalize'].includes(command) && rest.length % 2 === 0, 'DISTRIBUTION_USAGE');
  const allowed = command === 'plan' || command === 'build' ? ['directory', 'identity', 'team-id', 'output'] : ['directory', 'profile', ...(command === 'finalize' ? ['submission-id'] : [])];
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i].replace(/^--/, '');
    check(rest[i] === `--${key}` && allowed.includes(key) && !Object.hasOwn(values, key) && rest[i + 1], 'DISTRIBUTION_USAGE'); values[key] = rest[i + 1];
  }
  check(values.directory, 'DISTRIBUTION_USAGE');
  const options = { ...values, teamId: values['team-id'], submissionId: values['submission-id'] };
  return ({ plan: planDistribution, build: buildDistribution, submit: submitDistribution, finalize: finalizeDistribution })[command](options);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  distributionCli(process.argv.slice(2)).then(result => process.stdout.write(JSON.stringify(result) + '\n'))
    .catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
