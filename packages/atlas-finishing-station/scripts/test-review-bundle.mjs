#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, writeFile, readdir, rm, realpath } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { createManualLabelPdfRenderer } from '../../atlas-finishing/src/label-pdf.mjs';
import { samplePlan } from '../../atlas-finishing/test/manual-fixture.mjs';
import { stationProfileHash } from '../../atlas-finishing/src/station-protocol.mjs';

const args = process.argv.slice(2);
assert(args.length === 2 && args[0] === '--directory' && isAbsolute(args[1]));
const directory = await realpath(args[1]), hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(await readFile(join(directory, 'manifest.json')));
assert.equal(manifest.version, 'atlas-mac-station-review-bundle-v1');
for (const file of manifest.files) {
  assert(!isAbsolute(file.path) && !file.path.split('/').includes('..'));
  const bytes = await readFile(join(directory, file.path));
  assert.equal(bytes.length, file.bytes); assert.equal(hash(bytes), file.sha256);
}
const runtime = await import(pathToFileURL(join(directory, 'library.mjs')));
const layout = { version: 'atlas-label-sheet-v1', widthPoints: 196.56, heightPoints: 59.76,
  pages: [{ placements: [{ face: 'FRONT', x: 0, y: 0, rotation: 0 }] }, { placements: [{ face: 'REVERSE', x: 0, y: 0, rotation: 180 }] }] };
const plan = samplePlan({ mode: 'LOCAL_FIXTURE' });
const sheet = { version: 'atlas-label-sheet-v1', widthPoints: 612, heightPoints: 792,
  pages: [{ placements: [{ face: 'FRONT', x: 36, y: 36, rotation: 0 }, { face: 'REVERSE', x: 36, y: 110, rotation: 180 }] }] };
for (const selected of [layout, sheet]) {
  const options = { layout: selected, palette: 'NOIR_GOLD' }, source = await createManualLabelPdfRenderer(options)(plan);
  const packaged = await runtime.createManualLabelPdfRenderer(options)(plan);
  assert.equal(packaged.sha256, source.sha256); assert.deepEqual(packaged.bytes, source.bytes);
}
const temporary = await realpath(await mkdtemp(join(tmpdir(), 'atlas-bundle-acceptance-')));
try {
  // CPU-only fixture host identity. No protected station key is requested.
  const host = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const profile = { id: 'atlas-mac-f8215-production-v1', qualificationHash: 'e'.repeat(64), firstUserPage: 4, lastUserPage: 63 };
  profile.profileHash = stationProfileHash(profile);
  const nativeConfig = { version: 'atlas-mac-companion-config-v1', stationId: 'fixture-station', enrollmentId: '11111111-1111-4111-8111-111111111111',
    keyId: 'fixture-key', hostKeyId: 'fixture-host', hostPublicKeySpki: host.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    protectionEvidenceHash: 'd'.repeat(64), profile };
  const nativeConfigurationPath = join(temporary, 'native.json'), configurationPath = join(temporary, 'station.json');
  await writeFile(nativeConfigurationPath, JSON.stringify(nativeConfig), { mode: 0o600 });
  const config = { version: 'atlas-finishing-station-config-v1', origin: 'https://atlasgrading.com', nativeExecutable: join(directory, 'atlas-mac-nfc-companion'),
    nativeSha256: manifest.files.find(file => file.path === 'atlas-mac-nfc-companion').sha256, nativeConfigurationPath,
    stateDirectory: join(temporary, 'must-remain-absent'), printer: null, label: null };
  await writeFile(configurationPath, JSON.stringify(config), { mode: 0o600 });
  const before = await readdir(temporary), checked = await runtime.checkLocalStationConfiguration({ configurationPath });
  assert.equal(checked.configurationValid, true); assert.equal(checked.printerConfigured, false);
  assert.equal(checked.nativeCapabilities.productionReady, false); assert.equal(checked.nativeCapabilities.qualifiedProfileAvailable, false);
  assert.equal(checked.hardwareInspected, false); assert.equal(checked.keychainInspected, false);
  const cli = spawnSync(process.execPath, [join(directory, 'station.mjs'), '--check-configuration', configurationPath], { encoding: 'utf8', timeout: 15000 });
  assert.equal(cli.status, 0, cli.stderr); assert.deepEqual(JSON.parse(cli.stdout), checked);
  assert.deepEqual(await readdir(temporary), before);
  await writeFile(nativeConfigurationPath, JSON.stringify({ ...nativeConfig, profile: { ...profile, profileHash: '0'.repeat(64) } }));
  await assert.rejects(runtime.checkLocalStationConfiguration({ configurationPath }), /STATION_NATIVE_REFUSED/);
} finally { await rm(temporary, { recursive: true, force: true }); }
process.stdout.write(JSON.stringify({ ok: true, filesVerified: manifest.files.length, labelLayoutsByteIdentical: 2,
  packagedNativeConfigurationAccepted: true, malformedNativeConfigurationRejected: true,
  noJournalCreated: true, hardwareCalls: 0, keychainCalls: 0, printerCalls: 0, hostCalls: 0 }) + '\n');
