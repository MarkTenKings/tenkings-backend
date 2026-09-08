import { makeTrustedLearningConfig, trustedLearningClient } from '@atlas/service-bridge/trusted-learning';
import { keyBytes } from '@atlas/service-bridge/protocol';
import { canonical } from '../review-contract.mjs';
import { deny, hash } from '../policy.mjs';
import { StaffTrustedLearning, learningCandidatePort } from './learning.mjs';

// The original private generator has independent deployment/release pins.
// Parse each request so cached services cannot retain disabled configuration.
export function learningRuntimeSettings(env, staffConfig) {
    if (env.ATLAS_TRUSTED_LEARNING_ENABLED !== 'true') return null;
    if (staffConfig.mode !== 'PRODUCTION' || env.NODE_ENV !== 'production' || env.VERCEL_ENV !== 'production'
        || Object.keys(env).some(name => name.startsWith('ATLAS_LOCAL_'))) deny(503, 'LEARNING_NOT_CONFIGURED');
    return makeTrustedLearningConfig({ mode: 'PRODUCTION', origin: env.ATLAS_TRUSTED_LEARNING_ORIGIN,
        deploymentId: env.ATLAS_TRUSTED_LEARNING_DEPLOYMENT_ID, releaseSha: env.ATLAS_TRUSTED_LEARNING_RELEASE_SHA,
        key: keyBytes(env.ATLAS_TRUSTED_LEARNING_KEY), gradingPolicyHash: env.ATLAS_TRUSTED_LEARNING_GRADING_POLICY_HASH,
        phoneAllowlistHash: hash(canonical([...staffConfig.phoneByHash.keys()].sort())),
        otherKeyHashes: [hash(staffConfig.sessionKey), hash(staffConfig.phoneKey),
            ...['ATLAS_GRADING_BRIDGE_KEY', 'ATLAS_INTAKE_KEY', 'ATLAS_OPERATOR_EVIDENCE_KEY', 'ATLAS_PUBLIC_MEDIA_KEY',
                'ATLAS_MACHINE_ADMISSION_KEY', 'ATLAS_MACHINE_EXECUTION_KEY']
                .filter(name => env[name] !== undefined).map(name => hash(keyBytes(env[name])))] });
}

export function createLearningRuntime({ env, staffConfig, auth, review, fetchImpl }) {
    let config = null;
    try { config = learningRuntimeSettings(env, staffConfig); } catch { /* New candidates deny; retained decisions remain readable. */ }
    return new StaffTrustedLearning({ auth, review,
        candidates: config ? learningCandidatePort({ client: trustedLearningClient(config, fetchImpl) }) : null });
}
