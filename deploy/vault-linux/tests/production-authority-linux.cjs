#!/usr/bin/env node
'use strict';
/**
 * SYNTHETIC_ONLY: operational production-authority factory validation against an
 * ACTUAL signed release, inside a NEW disposable Docker container only.
 *
 * /input/release/runtime/bin/node /source/deploy/vault-linux/tests/production-authority-linux.cjs \
 *   --release /input/release --release-public-key /input/release-public.pem \
 *   --output /evidence/production-authority.json --ack-synthetic-container
 *
 * Requires VAULT_DISPOSABLE_REHEARSAL=1 and VAULT_PRODUCTION_AUTHORITY_SYNTHETIC=1.
 * Mount /input and /source read-only; provide no secrets/devices/network and do
 * not mount host /etc or /opt. The supplied key is PUBLIC ONLY. This script never
 * signs/modifies source release bytes or manufactures completed-build metadata.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const child = require('node:child_process');
const assert = require('node:assert/strict');
const TRUST = '/etc/tenkings-vault';
const INSTALL = '/opt/tenkings-vault';
const MARKER = 'SYNTHETIC_AUTHORITY_TEST_OWNER.json';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const fail = code => { throw new Error(code); };
const need = (test, code) => { if (!test) fail(code); };
const safeError = error => /^[A-Z][A-Z0-9_]{1,100}$/.test(error?.code ?? '') ? error.code : /^[A-Z][A-Z0-9_]{1,100}$/.test(error?.message ?? '') ? error.message : 'SYNTHETIC_ASSERTION_FAILED';

function argumentsMap() {
  const args = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    need(['--release', '--release-public-key', '--output', '--ack-synthetic-container', '--internal-child', '--source-manifest-sha256'].includes(name), 'UNKNOWN_ARGUMENT');
    need(!Object.hasOwn(options, name), 'DUPLICATE_ARGUMENT');
    options[name] = name === '--ack-synthetic-container' || name === '--internal-child' ? true : args[++i];
    need(options[name], 'ARGUMENT_VALUE_REQUIRED');
  }
  return options;
}

function containerGuard(options) {
  need(options['--ack-synthetic-container'] === true && process.env.VAULT_DISPOSABLE_REHEARSAL === '1'
    && process.env.VAULT_PRODUCTION_AUTHORITY_SYNTHETIC === '1', 'EXPLICIT_DISPOSABLE_ACK_REQUIRED');
  need(process.platform === 'linux' && process.arch === 'x64' && process.getuid?.() === 0 && process.versions.node === '22.23.2', 'PACKAGED_LINUX_X64_ROOT_REQUIRED');
  need(fs.existsSync('/.dockerenv') && fs.lstatSync('/.dockerenv').isFile(), 'DOCKER_CONTAINER_REQUIRED');
  const mounts = fs.readFileSync('/proc/self/mountinfo', 'utf8').trim().split('\n').map(line => {
    const [left, right] = line.split(' - '), fields = left.split(' ');
    return { target: fields[4].replace(/\\([0-7]{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8))), options: fields[5].split(','), type: right.split(' ')[0] };
  });
  need(mounts.find(m => m.target === '/')?.type === 'overlay', 'DISPOSABLE_OVERLAY_ROOT_REQUIRED');
  // Docker's ordinary /etc/hosts, hostname and resolv.conf mounts are harmless.
  // Reject mounts over either protected tree, their parents, or any descendants.
  need(!mounts.some(m => m.target !== '/' && [TRUST, INSTALL].some(root => m.target === root
    || m.target.startsWith(root + '/') || root.startsWith(m.target + '/'))), 'HOST_TRUST_OR_INSTALL_MOUNT_FORBIDDEN');
  const networkInterfaces = fs.readFileSync('/proc/net/dev', 'utf8').trim().split('\n').slice(2).map(line => line.split(':')[0].trim());
  need(networkInterfaces.every(name => name === 'lo'), 'NETWORK_NONE_REQUIRED');
  for (const key of ['--release', '--release-public-key']) {
    const file = options[key];
    need(typeof file === 'string' && path.isAbsolute(file) && path.resolve(file) === file && fs.realpathSync(file) === file, 'CANONICAL_INPUT_PATH_REQUIRED');
  }
  need(process.execPath === path.join(options['--release'], 'runtime/bin/node'), 'ACTUAL_PACKAGED_NODE_REQUIRED');
  const readOnlyMount = file => mounts.filter(m => m.target === '/' || file === m.target || file.startsWith(m.target + '/'))
    .sort((a, b) => b.target.length - a.target.length)[0]?.options.includes('ro');
  need(readOnlyMount(__filename) && readOnlyMount(options['--release-public-key'])
    && (options['--internal-child'] || readOnlyMount(options['--release'])), 'READ_ONLY_SOURCE_AND_PUBLIC_KEY_MOUNTS_REQUIRED');
}

function regularTree(root) {
  for (const name of fs.readdirSync(root)) {
    const file = path.join(root, name), stat = fs.lstatSync(file);
    need(!stat.isSymbolicLink() && (stat.isDirectory() || stat.isFile()), 'RELEASE_LINK_OR_SPECIAL_FILE_FORBIDDEN');
    if (stat.isDirectory()) regularTree(file);
  }
}
function write(file, value) { fs.writeFileSync(file, value, { mode: 0o644 }); fs.chmodSync(file, 0o644); }
function writeJson(file, value) { write(file, JSON.stringify(value, null, 2) + '\n'); }
function expectedOwner(directory, token) {
  if (!fs.existsSync(directory)) return false;
  const stat = fs.lstatSync(directory), marker = path.join(directory, MARKER);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0 || !fs.existsSync(marker)) return false;
  const markerStat = fs.lstatSync(marker);
  return markerStat.isFile() && !markerStat.isSymbolicLink() && markerStat.uid === 0 && json(marker).token === token;
}

function bootstrap(options) {
  containerGuard(options);
  need(!fs.existsSync(TRUST) && !fs.existsSync(INSTALL), 'FRESH_CONTAINER_WITHOUT_VAULT_INSTALL_REQUIRED');
  const output = options['--output'];
  need(typeof output === 'string' && path.isAbsolute(output) && path.resolve(output) === output && !fs.existsSync(output)
    && ![TRUST, INSTALL, options['--release']].some(root => output === root || output.startsWith(root + '/')), 'NEW_EXTERNAL_EVIDENCE_PATH_REQUIRED');
  need(fs.lstatSync(path.dirname(output)).isDirectory() && fs.realpathSync(path.dirname(output)) === path.dirname(output), 'EVIDENCE_PARENT_REQUIRED');
  const source = options['--release'], manifestBytes = fs.readFileSync(path.join(source, 'release.json'));
  const publicPem = fs.readFileSync(options['--release-public-key'], 'utf8');
  need(/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\r?\n?$/.test(publicPem), 'PUBLIC_KEY_ONLY_REQUIRED');
  const manifest = JSON.parse(manifestBytes), publicKey = crypto.createPublicKey(publicPem);
  need(publicKey.asymmetricKeyType === 'ed25519' && crypto.verify(null, manifestBytes, publicKey, fs.readFileSync(path.join(source, 'release.sig'))), 'ACTUAL_RELEASE_SIGNATURE_INVALID');
  const provenance = json(path.join(source, 'source-build.json'));
  need(provenance.sourceState === 'CLEAN_COMMITTED' && provenance.releaseAuthorized === true && provenance.buildCompleted === true
    && provenance.sourceCommit === manifest.sourceCommit && provenance.nativeBuild === 'linux-x64', 'ACTUAL_COMPLETED_RELEASE_REQUIRED');
  regularTree(source);
  const token = crypto.randomBytes(32).toString('hex'), clone = path.join(INSTALL, 'releases', 'synthetic-authority-' + crypto.randomUUID());
  let result, status = 1, sourceManifestUnchanged = true;
  try {
    fs.mkdirSync(INSTALL, { mode: 0o755 });
    writeJson(path.join(INSTALL, MARKER), { classification: 'SYNTHETIC_ONLY', token });
    fs.mkdirSync(path.dirname(clone), { mode: 0o755 });
    fs.cpSync(source, clone, { recursive: true, force: false, errorOnExist: true, dereference: false });
    fs.chmodSync(clone, 0o755);
    const run = child.spawnSync(path.join(clone, 'runtime/bin/node'), [__filename, '--internal-child', '--release', clone,
      '--release-public-key', options['--release-public-key'], '--source-manifest-sha256', hash(manifestBytes), '--ack-synthetic-container'], {
      encoding: 'utf8', timeout: 600000, maxBuffer: 2 * 1024 * 1024,
      env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', TZ: 'UTC', VAULT_DISPOSABLE_REHEARSAL: '1', VAULT_PRODUCTION_AUTHORITY_SYNTHETIC: '1', VAULT_SYNTHETIC_AUTHORITY_OWNER: token },
    });
    status = run.status ?? 1;
    try { result = JSON.parse(run.stdout); } catch { result = { passed: false, errorCode: run.error?.code === 'ETIMEDOUT' ? 'VALIDATION_TIMEOUT' : 'VALIDATION_CHILD_FAILED' }; }
    sourceManifestUnchanged = hash(fs.readFileSync(path.join(source, 'release.json'))) === hash(manifestBytes);
    need(sourceManifestUnchanged, 'SOURCE_RELEASE_MANIFEST_CHANGED');
  } catch (error) { result = { ...result, passed: false, errorCode: safeError(error) }; status = 1; }
  finally {
    // Only remove directories bearing this process's unpredictable ownership tag.
    if (expectedOwner(TRUST, token)) fs.rmSync(TRUST, { recursive: true });
    if (expectedOwner(INSTALL, token)) fs.rmSync(INSTALL, { recursive: true });
  }
  result = { ...result, classification: 'SYNTHETIC_ONLY', externalAcceptance: false, installedProductionActivation: false,
    sourceCommit: manifest.sourceCommit, releaseManifestSha256: hash(manifestBytes), sourceReleaseMountedReadOnly: true, sourceManifestUnchanged,
    containerTrustCleaned: !fs.existsSync(TRUST), containerReleaseCopyCleaned: !fs.existsSync(INSTALL), completedAt: new Date().toISOString() };
  if (!result.containerTrustCleaned || !result.containerReleaseCopyCleaned) { result.passed = false; result.errorCode = 'SYNTHETIC_CLEANUP_INCOMPLETE'; status = 1; }
  const fd = fs.openSync(output, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(result, null, 2) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  process.stdout.write(JSON.stringify({ classification: 'SYNTHETIC_ONLY', passed: result.passed === true && status === 0, checks: result.checks?.length ?? 0, evidence: output }) + '\n');
  process.exitCode = result.passed === true && status === 0 ? 0 : 1;
}

function exercise(options) {
  const checks = []; let networkAttempts = 0;
  const record = (name, action) => { action(); checks.push({ name, result: 'PASS' }); };
  const rejects = (name, action, expectedCode) => record(name, () => assert.throws(action, error => !expectedCode || error.code === expectedCode));
  try {
    containerGuard(options);
    const root = options['--release'], token = process.env.VAULT_SYNTHETIC_AUTHORITY_OWNER;
    need(/^[a-f0-9]{64}$/.test(token ?? '') && expectedOwner(INSTALL, token) && root.startsWith(INSTALL + '/releases/synthetic-authority-') && !fs.existsSync(TRUST), 'OWNED_SYNTHETIC_CHILD_REQUIRED');
    const denyNetwork = () => { networkAttempts++; fail('NETWORK_FORBIDDEN_IN_AUTHORITY_TEST'); };
    globalThis.fetch = denyNetwork;
    for (const moduleName of ['node:http', 'node:https']) { const module = require(moduleName); module.request = denyNetwork; module.get = denyNetwork; }
    require('node:net').Socket.prototype.connect = denyNetwork;
    require('node:tls').connect = denyNetwork;
    const { createSparkProductionAuthority } = require(path.join(root, 'packages/vault-machine/dist/spark-activation.js'));
    const { buildSparkProvisioning, SPARK_PROMOTION_EVIDENCE } = require(path.join(root, 'packages/vault-machine/dist/spark-provisioning.js'));
    const { waveshareBindingDigest } = require(path.join(root, 'packages/vault-machine/dist/waveshare-controller.js'));
    const { digest } = require(path.join(root, 'packages/vault-machine/dist/util.js'));
    const { canonicalJson } = require(path.join(root, 'packages/vault-contracts/dist/index.js'));
    const manifestBytes = fs.readFileSync(path.join(root, 'release.json')), manifest = JSON.parse(manifestBytes);
    need(hash(manifestBytes) === options['--source-manifest-sha256'], 'COPIED_ACTUAL_RELEASE_MANIFEST_MISMATCH');
    const pair = crypto.generateKeyPairSync('ed25519'); // Private key never leaves memory.
    const activationKey = pair.publicKey.export({ type: 'spki', format: 'pem' });
    const sign = payload => crypto.sign(null, Buffer.from(canonicalJson(payload)), pair.privateKey).toString('base64');
    const machineId = crypto.randomUUID(), previousBindingDigest = hash('SYNTHETIC_ONLY previous binding');
    const machineConfigDigest = hash('SYNTHETIC_ONLY machine configuration ' + machineId);
    const controller = { adapterId: 'waveshare-modbus-rtu-relay-32ch-v2', mode: 'LIVE', devicePath: '/dev/serial/by-id/SYNTHETIC_ONLY_NEVER_OPENED', serialFormat: '9600/8N1',
      endpoints: [{ endpointId: 'synthetic-board', address: 1, expectedFirmwareRegister: 100 }], mapping: [{ doorId: 'synthetic-door', controllerEndpointId: 'synthetic-board', controllerChannel: 1 }],
      mappingVersion: '1', profileDigest: hash('SYNTHETIC_ONLY controller profile'), pulseMs: 100, offSettleMs: 300, minimumOffMs: 100, qualificationEvidenceDigest: hash('SYNTHETIC_ONLY pulse evidence') };
    const provisioning = { schemaVersion: 1, machineId, stage: 'PRODUCTION', callbackOrigin: 'https://synthetic.invalid', callbackHeaderName: 'x-synthetic-spark-secret', profile: {
      // Offline provisioning enforces the vendor domain suffix. This invented
      // hostname is never resolved or contacted; network-none is mandatory.
      apiBase: 'https://synthetic-only-never-contact.nayax.com/api', environment: 'PRODUCTION', sandboxConfirmed: false, productionConfirmed: true, credentialGeneration: crypto.randomUUID(), preSelectionConfirmed: true,
      currency: 'USD', currencyConfirmed: true, terminalId: 'SYNTHETICONLY123', terminalIdType: 1, nayaxMachineId: '71234996', hwSerial: 'SYNTHETICONLY123', siteId: 2,
      integratorId: '927', tokenId: 116383, signingProfile: 'CURRENT_GUID_SHA256', wireApiVersion: null, vendorApprovalReference: 'SYNTHETIC_ONLY_NOT_VENDOR_ACCEPTANCE', maxTotalCents: 100000,
      callbackTerminalIdRepresentation: 'HW_SERIAL', acquiringOnlyConfirmed: true, cardUidPolicy: 'REJECT_AMBIGUOUS', acquiringCardBrands: ['Visa'], unsupportedCardBrands: ['SMC'],
      triggerReplayPolicy: 'DISABLED', cancelReplayPolicy: 'DISABLED', maxTriggerAttempts: 1, maxCancelAttempts: 1,
    } };
    const plan = buildSparkProvisioning(provisioning), controllerBindingDigest = waveshareBindingDigest(controller);
    fs.mkdirSync(TRUST, { mode: 0o755 }); writeJson(path.join(TRUST, MARKER), { classification: 'SYNTHETIC_ONLY', token });
    write(path.join(TRUST, 'release-public.pem'), fs.readFileSync(options['--release-public-key']));
    write(path.join(TRUST, 'spark-activation-public.pem'), activationKey);
    const evidencePath = path.join(TRUST, 'synthetic-evidence'); fs.mkdirSync(evidencePath, { mode: 0o755 });
    const activatedAt = new Date(Date.now() - 60000).toISOString();
    const records = SPARK_PROMOTION_EVIDENCE.map(kind => {
      const artifact = Buffer.from('SYNTHETIC_ONLY generated authority test fixture, not external acceptance: ' + kind);
      const record = { schemaVersion: 1, kind, outcome: 'ACCEPTED', evidenceClass: 'EXTERNAL_ACCEPTANCE', machineId, sourceCommit: manifest.sourceCommit, machineConfigDigest,
        paymentBindingDigest: kind === 'TERMINAL_SANDBOX' ? previousBindingDigest : plan.bindingDigest, controllerBindingDigest, releaseManifestSha256: hash(manifestBytes),
        observedAt: activatedAt, reviewedAt: activatedAt, reviewedBy: 'SYNTHETIC_ONLY_TEST_REVIEWER', artifactSha256: hash(artifact) };
      const bytes = Buffer.from(JSON.stringify(record)); write(path.join(evidencePath, kind + '.evidence'), bytes); write(path.join(evidencePath, kind + '.artifact'), artifact);
      return { kind, sha256: hash(bytes) };
    });
    const promotionPayload = { schemaVersion: 1, purpose: 'VAULT_SPARK_PRODUCTION_PROMOTION', machineId, configurationDigest: plan.configurationDigest, previousBindingDigest,
      targetBindingDigest: plan.bindingDigest, sourceCommit: manifest.sourceCommit, approvedBy: 'SYNTHETIC_ONLY_TEST_REVIEWER', approvedAt: activatedAt, expiresAt: new Date(Date.now() + 3600000).toISOString(), evidence: records };
    const activationPayload = { schemaVersion: 1, purpose: 'VAULT_SPARK_RUNTIME_ACTIVATION', activationId: crypto.randomUUID(), machineId, configurationDigest: plan.configurationDigest, machineConfigDigest,
      paymentBindingDigest: plan.bindingDigest, controllerBindingDigest, sourceCommit: manifest.sourceCommit, releaseManifestSha256: hash(manifestBytes), promotionAuthorityDigest: digest(promotionPayload),
      activatedAt, expiresAt: new Date(Date.now() + 86400000).toISOString(), approvedBy: 'SYNTHETIC_ONLY_TEST_REVIEWER' };
    const envelope = { payload: activationPayload, signature: sign(activationPayload), promotion: { payload: promotionPayload, signature: sign(promotionPayload) } };
    const activationPath = path.join(TRUST, 'synthetic-activation.json'), provisioningPath = path.join(TRUST, 'synthetic-provisioning.json'), profilePath = path.join(TRUST, 'synthetic-profile.json'), controllerPath = path.join(TRUST, 'synthetic-controller.json');
    writeJson(activationPath, envelope); writeJson(provisioningPath, provisioning); writeJson(profilePath, provisioning.profile); writeJson(controllerPath, controller);
    const env = { VAULT_RELEASE_ROOT: root, VAULT_SOURCE_COMMIT: manifest.sourceCommit, VAULT_RELEASE_PUBLIC_KEY_PATH: path.join(TRUST, 'release-public.pem'),
      VAULT_SPARK_ACTIVATION_PUBLIC_KEY_PATH: path.join(TRUST, 'spark-activation-public.pem'), VAULT_SPARK_PROVISIONING_PATH: provisioningPath,
      VAULT_SPARK_ACTIVATION_PATH: activationPath, VAULT_SPARK_EVIDENCE_PATH: evidencePath, VAULT_SPARK_CONFIG_PATH: profilePath, VAULT_WAVESHARE_CONFIG_PATH: controllerPath };
    const context = { machineId, sourceCommit: manifest.sourceCommit, machineConfigDigest, paymentBindingDigest: plan.bindingDigest, controllerBindingDigest };
    const fresh = () => createSparkProductionAuthority(env, machineId, controller);
    let authority;
    record('actual_signed_packaged_release_positive_factory', () => { authority = fresh(); authority.assertAuthorized(context); assert.equal(authority.paymentBindingDigest, plan.bindingDigest); });
    record('independent_restart_reverifies_actual_release', () => fresh().assertAuthorized(context));
    for (const [field, value] of [['machineId', crypto.randomUUID()], ['machineConfigDigest', 'f'.repeat(64)], ['paymentBindingDigest', 'f'.repeat(64)], ['controllerBindingDigest', 'f'.repeat(64)], ['sourceCommit', 'f'.repeat(40)]])
      rejects('effect_rejects_changed_' + field, () => authority.assertAuthorized({ ...context, [field]: value }));
    fs.unlinkSync(activationPath);
    rejects('effect_rejects_removed_activation', () => authority.assertAuthorized(context));
    rejects('restart_rejects_removed_activation', fresh);
    writeJson(activationPath, envelope);
    record('restored_exact_trusted_activation_reverifies', () => authority.assertAuthorized(context));
    const forged = structuredClone(envelope); forged.signature = 'A'.repeat(86) + '=='; writeJson(activationPath, forged);
    rejects('effect_rejects_forged_activation', () => authority.assertAuthorized(context), 'SPARK_ACTIVATION_SIGNATURE_INVALID'); writeJson(activationPath, envelope);
    write(env.VAULT_SPARK_ACTIVATION_PUBLIC_KEY_PATH, crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }));
    rejects('effect_rejects_replaced_activation_trust', () => authority.assertAuthorized(context), 'SPARK_ACTIVATION_SIGNATURE_INVALID'); write(env.VAULT_SPARK_ACTIVATION_PUBLIC_KEY_PATH, activationKey);
    fs.chmodSync(env.VAULT_SPARK_ACTIVATION_PUBLIC_KEY_PATH, 0o666);
    rejects('effect_rejects_writable_trust', () => authority.assertAuthorized(context), 'SPARK_ACTIVATION_UNTRUSTED_PATH'); fs.chmodSync(env.VAULT_SPARK_ACTIVATION_PUBLIC_KEY_PATH, 0o644);
    const releasePublicKeyBytes = fs.readFileSync(env.VAULT_RELEASE_PUBLIC_KEY_PATH);
    fs.unlinkSync(env.VAULT_RELEASE_PUBLIC_KEY_PATH);
    rejects('effect_rejects_missing_release_trust', () => authority.assertAuthorized(context));
    rejects('restart_rejects_missing_release_trust', fresh);
    write(env.VAULT_RELEASE_PUBLIC_KEY_PATH, activationKey);
    rejects('effect_rejects_changed_release_trust', () => authority.assertAuthorized(context), 'SPARK_ACTIVATION_RELEASE_TRUST_CHANGED');
    rejects('restart_rejects_wrong_release_trust', fresh, 'SPARK_ACTIVATION_SIGNATURE_INVALID');
    write(env.VAULT_RELEASE_PUBLIC_KEY_PATH, releasePublicKeyBytes);
    fs.chmodSync(evidencePath, 0o777);
    rejects('effect_rejects_writable_evidence_directory', () => authority.assertAuthorized(context), 'SPARK_ACTIVATION_UNTRUSTED_PATH'); fs.chmodSync(evidencePath, 0o755);
    const artifactPath = path.join(evidencePath, 'CABINET_ACCEPTANCE.artifact'), originalArtifact = fs.readFileSync(artifactPath); write(artifactPath, 'SYNTHETIC_ONLY changed evidence');
    rejects('effect_rejects_changed_report_bytes', () => authority.assertAuthorized(context), 'SPARK_ACTIVATION_EVIDENCE_INVALID'); write(artifactPath, originalArtifact);
    writeJson(profilePath, { ...provisioning.profile, tokenId: provisioning.profile.tokenId + 1 });
    rejects('effect_rejects_local_profile_drift', () => authority.assertAuthorized(context), 'SPARK_ACTIVATION_PROFILE_CHANGED'); writeJson(profilePath, provisioning.profile);
    writeJson(controllerPath, { ...controller, endpoints: [{ ...controller.endpoints[0], expectedFirmwareRegister: 101 }] });
    rejects('effect_rejects_controller_configuration_drift', () => authority.assertAuthorized(context), 'SPARK_ACTIVATION_PROFILE_CHANGED'); writeJson(controllerPath, controller);
    const expired = structuredClone(envelope); expired.payload.expiresAt = new Date(Date.now() - 10000).toISOString(); expired.signature = sign(expired.payload); writeJson(activationPath, expired);
    rejects('effect_rejects_expired_lease', () => authority.assertAuthorized(context), 'SPARK_ACTIVATION_LEASE_EXPIRED');
    record('expired_authentic_lease_can_restart_read_only', () => { const readOnly = fresh(); assert.throws(() => readOnly.assertAuthorized(context), { code: 'SPARK_ACTIVATION_LEASE_EXPIRED' }); });
    const renewed = structuredClone(envelope); renewed.payload.activationId = crypto.randomUUID(); renewed.payload.expiresAt = new Date(Date.now() + 2 * 86400000).toISOString(); renewed.signature = sign(renewed.payload); writeJson(activationPath, renewed);
    record('fresh_signed_lease_renewal_rechecks_without_process_restart', () => authority.assertAuthorized(context));
    const actualNow = Date.now;
    try {
      Date.now = () => Date.parse(activatedAt) - 1;
      rejects('effect_rejects_clock_before_signed_activation', () => authority.assertAuthorized(context), 'SPARK_ACTIVATION_LEASE_EXPIRED');
      rejects('restart_rejects_clock_before_signed_activation', fresh, 'SPARK_ACTIVATION_LEASE_EXPIRED');
    } finally { Date.now = actualNow; }
    // Mutations occur ONLY in this container's disposable copy. Original release
    // signatures/provenance remain untouched; no fake completed build is created.
    const payloadPath = path.join(root, 'frontend/vault-kiosk/dist/index.html'), originalPayload = fs.readFileSync(payloadPath), originalMode = fs.statSync(payloadPath).mode & 0o777;
    try {
      fs.appendFileSync(payloadPath, '\nSYNTHETIC_ONLY mutation\n');
      rejects('effect_rejects_changed_installed_payload', () => authority.assertAuthorized(context), 'SPARK_ACTIVATION_RELEASE_CHANGED');
      rejects('restart_rejects_changed_installed_payload_hash', fresh, 'SPARK_ACTIVATION_RELEASE_INTEGRITY_FAILED');
    } finally { fs.writeFileSync(payloadPath, originalPayload); fs.chmodSync(payloadPath, originalMode); }
    rejects('restoring_bytes_does_not_restore_stale_process_baseline', () => authority.assertAuthorized(context), 'SPARK_ACTIVATION_RELEASE_CHANGED');
    record('fresh_restart_rehashes_restored_signed_bytes', () => { authority = fresh(); authority.assertAuthorized(context); });
    const extraPath = path.join(root, 'SYNTHETIC_ONLY_UNEXPECTED_MEMBER');
    try { write(extraPath, 'synthetic fixture'); rejects('effect_rejects_release_membership_change', () => authority.assertAuthorized(context), 'SPARK_ACTIVATION_RELEASE_CHANGED'); rejects('restart_rejects_unlisted_release_member', fresh, 'SPARK_ACTIVATION_RELEASE_MEMBERSHIP_INVALID'); }
    finally { fs.unlinkSync(extraPath); }
    record('final_exact_release_integrity_passes', () => fresh().assertAuthorized(context));
    record('no_provider_network_or_serial_composition', () => assert.equal(networkAttempts, 0));
    process.stdout.write(JSON.stringify({ passed: true, classification: 'SYNTHETIC_ONLY', checks, nodeVersion: process.versions.node, platform: process.platform, architecture: process.arch,
      providerNetworkAttempts: networkAttempts, serialComposed: false, syntheticPrivateKeysWritten: false, releasePayloadBytesChangedOnlyInDiscardedCopy: true }) + '\n');
  } catch (error) {
    process.stdout.write(JSON.stringify({ passed: false, classification: 'SYNTHETIC_ONLY', checks, errorCode: safeError(error), providerNetworkAttempts: networkAttempts, serialComposed: false, syntheticPrivateKeysWritten: false }) + '\n');
    process.exitCode = 1;
  }
}

try { const options = argumentsMap(); if (options['--internal-child']) exercise(options); else bootstrap(options); }
catch (error) { process.stderr.write('SYNTHETIC_ONLY validation refused: ' + safeError(error) + '\n'); process.exitCode = 1; }
