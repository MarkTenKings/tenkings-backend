import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { ATLAS_NFC } from '@atlas/finishing/nfc';
import { makeFinishingConfig, finishingRuntimeSettings, createFinishingRuntime } from '../lib/server/access/finishing-runtime.mjs';
import { canonical } from '../lib/server/review-contract.mjs';
import { hash } from '../lib/server/policy.mjs';

function pair() {
    const value = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const der = value.publicKey.export({ type: 'spki', format: 'der' });
    return { entry: { keyId: hash(der), publicSpkiDerBase64: der.toString('base64') },
        pem: value.privateKey.export({ type: 'pkcs8', format: 'pem' }),
        base64: value.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64') };
}
function fixture() {
    const server = pair(), workstation = pair(), prior = pair();
    const staff = { mode: 'PRODUCTION', origin: 'https://app.atlasgrading.com', deploymentId: 'staff-synthetic.vercel.app', releaseSha: 'a'.repeat(40) };
    const trust = { schemaVersion: 'atlas-nfc-trust-v1', serverKeys: [server.entry, prior.entry],
        workstationKeys: [{ ...workstation.entry, enrollmentPolicy: ATLAS_NFC.workstationEnrollmentPolicy }] };
    const env = { NODE_ENV: 'production', VERCEL_ENV: 'production', ATLAS_NFC_ENABLED: 'true',
        ATLAS_NFC_ORIGIN: staff.origin, ATLAS_NFC_DEPLOYMENT_ID: staff.deploymentId, ATLAS_NFC_RELEASE_SHA: staff.releaseSha,
        ATLAS_NFC_SIGNING_PRIVATE_KEY_PEM: server.pem, ATLAS_NFC_TRUST_JSON: JSON.stringify(trust) };
    return { staff, server, workstation, prior, trust, env };
}
const invalid = work => assert.throws(work, { code: 'NFC_NOT_CONFIGURED', status: 503 });

test('historical Windows NFC protocol retains its exact origin and independent deployment pins', () => {
    const f = fixture(), parsed = finishingRuntimeSettings(f.env, f.staff);
    assert.equal(parsed.signingKeyHash, f.server.entry.keyId);
    for (const change of [{ NODE_ENV: 'development' }, { VERCEL_ENV: 'preview' }, { ATLAS_NFC_ORIGIN: 'https://atlasgrading.com' },
        { ATLAS_NFC_DEPLOYMENT_ID: 'another-synthetic.vercel.app' }, { ATLAS_NFC_RELEASE_SHA: 'b'.repeat(40) },
        { ATLAS_LOCAL_SYNTHETIC: '1' }, { ATLAS_NFC_SIGNING_PRIVATE_KEY_PEM: undefined }, { ATLAS_NFC_TRUST_JSON: '{}' },
        { TEN_KINGS_V2_NFC_JOB_SIGNING_PRIVATE_KEY_PKCS8_BASE64: f.prior.base64 }]) {
        invalid(() => finishingRuntimeSettings({ ...f.env, ...change }, f.staff));
    }
    for (const flag of [undefined, false, 'false', 'TRUE', '1'])
        assert.equal(finishingRuntimeSettings({ ...f.env, ATLAS_NFC_ENABLED: flag }, f.staff), null);
    invalid(() => finishingRuntimeSettings(f.env, { ...f.staff, mode: 'LOCAL_FIXTURE' }));
    const local = makeFinishingConfig({ ...f.staff, mode: 'LOCAL_FIXTURE', origin: 'http://127.0.0.1:4318',
        releaseSha: '0'.repeat(40), privateKeyPem: f.server.pem, trust: f.trust });
    assert.equal(local.mode, 'LOCAL_FIXTURE'); // Deliberate constructor, no runtime fallback.
});

test('admin staff origin cannot activate or relabel the legacy Windows NFC protocol', () => {
    const f = fixture(), current = { ...f.staff, origin: 'https://atlasgrading.com', basePath: '/admin' };
    invalid(() => finishingRuntimeSettings(f.env, current));
    invalid(() => finishingRuntimeSettings({ ...f.env, ATLAS_NFC_ORIGIN: current.origin }, current));
    invalid(() => makeFinishingConfig({ ...current, privateKeyPem: f.server.pem, trust: f.trust }));
    assert.equal(finishingRuntimeSettings({ ...f.env, ATLAS_NFC_ENABLED: 'false' }, current), null);
    assert.equal(ATLAS_NFC.staffOrigin, 'https://app.atlasgrading.com');
});

test('configuration hash is stable for equivalent trust ordering/PEM and changes with trust, signer or deployment', () => {
    const f = fixture(), config = finishingRuntimeSettings(f.env, f.staff);
    const reordered = { ...f.trust, serverKeys: [...f.trust.serverKeys].reverse() };
    const same = finishingRuntimeSettings({ ...f.env, ATLAS_NFC_TRUST_JSON: JSON.stringify(reordered, null, 2),
        ATLAS_NFC_SIGNING_PRIVATE_KEY_PEM: f.server.pem.replaceAll('\n', '\r\n') }, f.staff);
    assert.equal(same.configHash, config.configHash); assert.equal(same.trustHash, config.trustHash);
    assert.equal(config.trustHash, hash(canonical(config.trust)));
    assert(Object.isFrozen(config)); assert(Object.isFrozen(config.trust.serverKeys[0]));
    for (const input of [
        { privateKeyPem: f.prior.pem },
        { trust: { ...f.trust, serverKeys: [f.server.entry] } },
        { releaseSha: 'b'.repeat(40) }, { deploymentId: 'new-synthetic.vercel.app' },
    ]) assert.notEqual(makeFinishingConfig({ ...f.staff, privateKeyPem: f.server.pem, trust: f.trust, ...input }).configHash, config.configHash);
    const before = config.trust.serverKeys[0].keyId; f.trust.serverKeys[0].keyId = '0'.repeat(64);
    assert.equal(config.trust.serverKeys[0].keyId, before); // No mutable caller-owned trust retained.
});

test('HMAC, wrong-curve, untrusted and legacy/shared-key aliases cannot sign ATLAS jobs', () => {
    const f = fixture();
    for (const value of [Buffer.alloc(32, 1).toString('base64'), f.workstation.pem,
        generateKeyPairSync('ec', { namedCurve: 'secp384r1' }).privateKey.export({ type: 'pkcs8', format: 'pem' })])
        invalid(() => finishingRuntimeSettings({ ...f.env, ATLAS_NFC_SIGNING_PRIVATE_KEY_PEM: value }, f.staff));
    for (const name of ['ATLAS_GRADING_BRIDGE_KEY', 'ATLAS_PUBLIC_MEDIA_KEY', 'ATLAS_AUTH_SESSION_KEY',
        'ATLAS_MACHINE_ADMISSION_KEY', 'ATLAS_MACHINE_EXECUTION_KEY', 'ATLAS_TRUSTED_LEARNING_KEY'])
        for (const value of [f.server.pem, f.server.base64]) invalid(() => finishingRuntimeSettings({ ...f.env, [name]: value }, f.staff));
    invalid(() => finishingRuntimeSettings({ ...f.env, ATLAS_NFC_TRUST_JSON: JSON.stringify({ ...f.trust,
        workstationKeys: [{ ...f.server.entry, enrollmentPolicy: ATLAS_NFC.workstationEnrollmentPolicy }] }) }, f.staff));
    assert(finishingRuntimeSettings({ ...f.env, ATLAS_GRADING_BRIDGE_KEY: Buffer.alloc(32, 4).toString('base64') }, f.staff));
});

test('retained runtime reparses every request and disabled/malformed config only removes NFC availability', async () => {
    const f = fixture(), config = finishingRuntimeSettings(f.env, f.staff);
    const control = { ...config, id: 'active', revision: 4 }; delete control.privateKeyPem; delete control.trust;
    let locks = 0;
    const context = { control: f.staff, tx: { $queryRaw: async strings => {
        assert.match(strings.join(''), /atlas_staff\.lock_nfc_control\(\)/); locks++; return [control];
    } } };
    const runtime = createFinishingRuntime({ auth: {}, review: {}, staffConfig: f.staff, env: () => f.env });
    assert.equal((await runtime.nfcConfig(context)).nfcControlRevision, 4);
    f.env.ATLAS_NFC_ENABLED = 'false';
    assert.equal(await runtime.nfcConfig(context, false), null);
    await assert.rejects(() => runtime.nfcConfig(context), { code: 'NFC_NOT_CONFIGURED' });
    f.env.ATLAS_NFC_ENABLED = 'true'; f.env.ATLAS_NFC_TRUST_JSON = 'broken';
    assert.equal(await runtime.nfcConfig(context, false), null);
    await assert.rejects(() => runtime.nfcConfig(context), { code: 'NFC_NOT_CONFIGURED' });
    f.env.ATLAS_NFC_TRUST_JSON = JSON.stringify(f.trust); control.enabled = false;
    assert.equal(await runtime.nfcConfig(context, false), null); assert.equal(locks, 6);
    const disabled = createFinishingRuntime({ auth: {}, review: {}, staffConfig: f.staff, env: {} });
    assert.equal(typeof disabled.issueLabel, 'function'); assert.equal(typeof disabled.retrieveNfcJob, 'function');
    assert.equal(typeof disabled.recordPhysical, 'function');
});
