import { createPrivateKey, createPublicKey } from 'node:crypto';
import { ATLAS_NFC, validateNfcTrust } from '@atlas/finishing/nfc';
import { canonical } from '../review-contract.mjs';
import { deny, hash } from '../policy.mjs';
import { StaffFinishing } from './finishing.mjs';

const unavailable = () => deny(503, 'NFC_NOT_CONFIGURED');
const pins = ['mode', 'origin', 'deploymentId', 'releaseSha'];

/** Explicit server-owned constructor, also used for deliberate synthetic fixtures.
 * Hashes contain only public signing/trust material and exact deployment pins.
 */
export function makeFinishingConfig({ mode, origin, deploymentId, releaseSha, privateKeyPem, trust }) {
    try {
        if (!['PRODUCTION', 'LOCAL_FIXTURE'].includes(mode)
            || origin !== (mode === 'PRODUCTION' ? ATLAS_NFC.staffOrigin : 'http://127.0.0.1:4318')
            || typeof deploymentId !== 'string' || !/^[A-Za-z0-9._-]{1,160}$/.test(deploymentId)
            || !/^[a-f0-9]{40}$/.test(releaseSha ?? '') || typeof privateKeyPem !== 'string') unavailable();
        if (mode === 'PRODUCTION' && (!/^[a-z0-9-]+\.vercel\.app$/.test(deploymentId) || releaseSha === '0'.repeat(40))) unavailable();
        if (mode === 'LOCAL_FIXTURE' && releaseSha !== '0'.repeat(40)) unavailable();
        const privateKey = createPrivateKey(privateKeyPem), publicKey = createPublicKey(privateKey);
        if (publicKey.asymmetricKeyType !== 'ec' || publicKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1') unavailable();
        const publicSpkiDerBase64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
        const signingKeyHash = hash(Buffer.from(publicSpkiDerBase64, 'base64'));
        validateNfcTrust(trust);
        if (!trust.serverKeys.some(key => key.keyId === signingKeyHash)) unavailable();
        const normalizedTrust = Object.freeze({ schemaVersion: trust.schemaVersion,
            serverKeys: Object.freeze(trust.serverKeys.map(key => Object.freeze({ ...key })).sort((a, b) => a.keyId.localeCompare(b.keyId))),
            workstationKeys: Object.freeze(trust.workstationKeys.map(key => Object.freeze({ ...key })).sort((a, b) => a.keyId.localeCompare(b.keyId))) });
        const trustHash = hash(canonical(normalizedTrust));
        const configHash = hash(canonical({ version: 'atlas-approved-finishing-config-v1', purpose: ATLAS_NFC.purpose,
            mode, origin, deploymentId, releaseSha, signingKeyHash, publicSpkiDerBase64, trustHash }));
        return Object.freeze({ enabled: true, mode, origin, deploymentId, releaseSha, configHash, signingKeyHash, trustHash,
            privateKeyPem, trust: normalizedTrust });
    } catch { unavailable(); }
}

/** Called anew for every NFC availability check/write. No local/environment
 * aliases, legacy authority, shared bridge key or cached enabled configuration.
 */
export function finishingRuntimeSettings(env, staffConfig) {
    if (env.ATLAS_NFC_ENABLED !== 'true') return null;
    if (staffConfig.mode !== 'PRODUCTION' || env.NODE_ENV !== 'production' || env.VERCEL_ENV !== 'production'
        || Object.keys(env).some(name => name.startsWith('ATLAS_LOCAL_') || name.startsWith('TEN_KINGS_V2_NFC_')
            || name === 'TENKINGS_NFC_V2_SERVER_JOB_PUBLIC_KEYS_JSON')) unavailable();
    let trust;
    try { trust = JSON.parse(env.ATLAS_NFC_TRUST_JSON); } catch { unavailable(); }
    const config = makeFinishingConfig({ mode: 'PRODUCTION', origin: env.ATLAS_NFC_ORIGIN,
        deploymentId: env.ATLAS_NFC_DEPLOYMENT_ID, releaseSha: env.ATLAS_NFC_RELEASE_SHA,
        privateKeyPem: env.ATLAS_NFC_SIGNING_PRIVATE_KEY_PEM, trust });
    if (pins.some(key => config[key] !== staffConfig[key])) unavailable();
    // Reject accidental aliases even when another server's key is represented
    // as PEM or base64 PKCS8. Normal independent HMAC keys are not EC signers.
    for (const name of ['ATLAS_GRADING_BRIDGE_KEY', 'ATLAS_OPERATOR_EVIDENCE_KEY', 'ATLAS_PUBLIC_MEDIA_KEY',
        'ATLAS_INTAKE_KEY', 'ATLAS_AUTH_SESSION_KEY', 'ATLAS_AUTH_PHONE_KEY', 'ATLAS_MACHINE_ADMISSION_KEY',
        'ATLAS_MACHINE_EXECUTION_KEY', 'ATLAS_TRUSTED_LEARNING_KEY']) {
        const value = env[name]; if (value === undefined) continue;
        if (value === config.privateKeyPem) unavailable();
        let publicKey;
        try { publicKey = createPublicKey(createPrivateKey(typeof value === 'string' && value.includes('-----BEGIN')
            ? value : { key: Buffer.from(value, 'base64'), format: 'der', type: 'pkcs8' })); } catch { continue; }
        if (hash(publicKey.export({ type: 'spki', format: 'der' })) === config.signingKeyHash) unavailable();
    }
    return config;
}

/** Always construct the finishing service, including when NFC is disabled.
 * A retained service reparses current settings; no signer state is cached here.
 * Tests can deliberately inject makeFinishingConfig through StaffFinishing.
 */
export function createFinishingRuntime({ auth, review, staffConfig, env = process.env }) {
    return new StaffFinishing({ auth, review, nfc: () => finishingRuntimeSettings(typeof env === 'function' ? env() : env, staffConfig) });
}
