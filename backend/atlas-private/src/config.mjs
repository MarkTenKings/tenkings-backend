import { bridgeOrigin, canonical, digest, keyBytes, keys, requireBridge as check } from '@atlas/service-bridge/protocol';

const sha = /^[a-f0-9]{64}$/, release = /^[a-f0-9]{40}$/;
const text = (value, minimum, maximum) => typeof value === 'string' && value.length >= minimum && value.length <= maximum && /^[\x21-\x7e]+$/.test(value);
function secret(env, name, minimum = 32, maximum = 256) {
    const value = env[name]; check(text(value, minimum, maximum), 'ATLAS_PRIVATE_CONFIGURATION_INVALID'); return value;
}
function databaseUrl(value, role = 'source') {
    let url; try { url = new URL(value); } catch { check(false, 'ATLAS_PRIVATE_DATABASE_INVALID'); }
    check(url.protocol === 'postgresql:' && url.hostname.endsWith('.db.ondigitalocean.com') && url.port === '25060'
        && url.pathname === '/defaultdb' && new RegExp(`^atlas_workspace_${role}_[a-z0-9_]{1,32}$`).test(url.username)
        && text(url.password, 32, 512) && !url.hash && url.searchParams.get('schema') === 'atlas_staff'
        && url.searchParams.get('sslmode') === 'require'
        && [...url.searchParams.keys()].every(name => ['schema', 'sslmode', 'connection_limit', 'pool_timeout', 'connect_timeout'].includes(name))
        && new Set(url.searchParams.keys()).size === [...url.searchParams.keys()].length,
    'ATLAS_PRIVATE_DATABASE_INVALID');
    for (const name of ['connection_limit', 'pool_timeout', 'connect_timeout']) if (url.searchParams.has(name))
        check(/^[1-9]\d?$/.test(url.searchParams.get(name)), 'ATLAS_PRIVATE_DATABASE_INVALID');
    check(Number(url.searchParams.get('connection_limit') ?? '6') <= 6, 'ATLAS_PRIVATE_DATABASE_INVALID');
    return url.toString();
}

/** Dedicated private-service settings. Generic credentials cannot become a
 * fallback. Exact serving controls and actual role grants are checked again
 * on each authority transaction before original source operations. */
export function privateRuntimeConfig(env, gradingPolicyHash) {
    check(env.NODE_ENV === 'production' && env.ATLAS_PRIVATE_ENABLED === 'true' && sha.test(gradingPolicyHash)
        && !Object.keys(env).some(name => name.startsWith('ATLAS_LOCAL_'))
        && !['DATABASE_URL', 'OPENAI_API_KEY', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'].some(name => name in env),
    'ATLAS_PRIVATE_NOT_ENABLED');
    const origin = bridgeOrigin(env.ATLAS_PRIVATE_ORIGIN);
    const releaseSha = env.VERCEL_GIT_COMMIT_SHA ?? env.ATLAS_PRIVATE_RELEASE_SHA;
    const deploymentId = env.VERCEL_URL ?? env.ATLAS_PRIVATE_DEPLOYMENT_ID;
    check(release.test(releaseSha ?? '') && /^[a-zA-Z0-9._-]{1,120}$/.test(deploymentId ?? ''), 'ATLAS_PRIVATE_RELEASE_REQUIRED');
    if (env.VERCEL_URL) check(env.VERCEL_ENV === 'production' && /^[a-z0-9-]+\.vercel\.app$/.test(deploymentId), 'ATLAS_PRIVATE_RELEASE_REQUIRED');
    const raw = env.ATLAS_PRIVATE_BINDINGS_JSON;
    check(typeof raw === 'string' && Buffer.byteLength(raw) <= 16384, 'ATLAS_PRIVATE_CONFIGURATION_INVALID');
    let binding; try { binding = JSON.parse(raw); } catch { check(false, 'ATLAS_PRIVATE_CONFIGURATION_INVALID'); }
    keys(binding, ['version', 'storage', 'workers', 'operatorRuntimeHash', 'allowedPhoneHashes']);
    check(binding.version === 'atlas-private-bindings-v1' && sha.test(binding.operatorRuntimeHash)
        && Array.isArray(binding.allowedPhoneHashes) && binding.allowedPhoneHashes.length > 0 && binding.allowedPhoneHashes.length <= 100
        && binding.allowedPhoneHashes.every(hash => sha.test(hash))
        && new Set(binding.allowedPhoneHashes).size === binding.allowedPhoneHashes.length, 'ATLAS_PRIVATE_CONFIGURATION_INVALID');
    keys(binding.storage, ['endpoint', 'uploadOrigin', 'bucket', 'region']);
    const storage = { ...binding.storage, endpoint: bridgeOrigin(binding.storage.endpoint), uploadOrigin: bridgeOrigin(binding.storage.uploadOrigin) };
    check(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(storage.bucket) && /^[a-z0-9-]{1,64}$/.test(storage.region), 'ATLAS_PRIVATE_STORAGE_INVALID');
    keys(binding.workers, ['geometryOrigin', 'preparationOrigin', 'detectorOrigin', 'registrationOrigin']);
    const workers = Object.fromEntries(Object.entries(binding.workers).map(([name, value]) => [name, bridgeOrigin(value)]));
    check(workers.preparationOrigin !== workers.detectorOrigin && workers.preparationOrigin !== workers.geometryOrigin,
        'ATLAS_PRIVATE_WORKER_INVALID');
    const sourceDatabaseUrl = databaseUrl(env.ATLAS_PRIVATE_SOURCE_DATABASE_URL);
    let dispatch = null;
    if (env.ATLAS_PRIVATE_DISPATCH_ENABLED === 'true') {
        const coordinatorDatabaseUrl = databaseUrl(env.ATLAS_PRIVATE_COORDINATOR_DATABASE_URL, 'coordinator');
        const artifactRoot = env.ATLAS_PRIVATE_OPERATOR_ARTIFACT_ROOT, manifestPath = env.ATLAS_PRIVATE_OPERATOR_MANIFEST_PATH;
        const manifestHash = env.ATLAS_PRIVATE_OPERATOR_MANIFEST_SHA256;
        check([artifactRoot, manifestPath].every(value => typeof value === 'string' && value.startsWith('/')
            && value.length <= 512 && !value.split('/').some(part => part === '.' || part === '..'))
            && sha.test(manifestHash ?? ''), 'ATLAS_PRIVATE_OPERATOR_ARTIFACT_REQUIRED');
        const names = ['ATLAS_OPERATOR_ENABLED', 'ATLAS_OPERATOR_RELEASE_SHA', 'ATLAS_OPERATOR_BUILD_HASH', 'ATLAS_OPERATOR_RUNTIME_HASH',
            'ATLAS_OPERATOR_DATABASE_URL', 'ATLAS_OPERATOR_OPENAI_PROJECT_ID', 'ATLAS_OPERATOR_OPENAI_API_KEY',
            'ATLAS_OPERATOR_EVIDENCE_ORIGIN', 'ATLAS_OPERATOR_EVIDENCE_KEY'];
        check(names.every(name => text(env[name], 1, 4096)) && env.ATLAS_OPERATOR_ENABLED === 'true',
            'ATLAS_PRIVATE_OPERATOR_CONFIGURATION_REQUIRED');
        // The workspace coordinator owns source initialization. Its verified
        // operator executes already-enqueued runs and receives no admission key.
        check(!Object.keys(env).some(name => name.startsWith('ATLAS_MACHINE_')), 'ATLAS_PRIVATE_OPERATOR_CONFIGURATION_REQUIRED');
        const operatorEnv = Object.freeze({ NODE_ENV: 'production', ...Object.fromEntries(names.map(name => [name, env[name]])) });
        check(new Set([sourceDatabaseUrl, coordinatorDatabaseUrl, operatorEnv.ATLAS_OPERATOR_DATABASE_URL]).size === 3,
            'ATLAS_PRIVATE_DATABASE_REUSED');
        dispatch = Object.freeze({ coordinatorDatabaseUrl, artifactRoot, manifestPath, manifestHash, operatorEnv });
    } else check(!['ATLAS_PRIVATE_COORDINATOR_DATABASE_URL', 'ATLAS_PRIVATE_OPERATOR_ARTIFACT_ROOT',
        'ATLAS_PRIVATE_OPERATOR_MANIFEST_PATH', 'ATLAS_PRIVATE_OPERATOR_MANIFEST_SHA256'].some(name => name in env),
    'ATLAS_PRIVATE_DISPATCH_NOT_ENABLED');
    const workspaceKey = keyBytes(env.ATLAS_PRIVATE_WORKSPACE_KEY), gradingKey = keyBytes(env.ATLAS_PRIVATE_GRADING_KEY), imageKey = keyBytes(env.ATLAS_PRIVATE_IMAGE_KEY);
    check(new Set([workspaceKey, gradingKey, imageKey].map(digest)).size === 3, 'ATLAS_PRIVATE_KEY_REUSED');
    const credentials = {
        storageAccessKey: secret(env, 'ATLAS_PRIVATE_STORAGE_ACCESS_KEY_ID', 16, 128),
        storageSecretKey: secret(env, 'ATLAS_PRIVATE_STORAGE_SECRET_ACCESS_KEY'),
        geometryKey: secret(env, 'ATLAS_PRIVATE_GEOMETRY_KEY', 16, 512),
        preparationKey: secret(env, 'ATLAS_PRIVATE_PREPARATION_KEY', 32, 128),
        detectorKey: secret(env, 'ATLAS_PRIVATE_DETECTOR_KEY', 16, 512),
        registrationKey: secret(env, 'ATLAS_PRIVATE_REGISTRATION_KEY', 16, 512),
        colorReceiptKey: secret(env, 'ATLAS_PRIVATE_COLOR_RECEIPT_KEY'),
        detectionReceiptKey: secret(env, 'ATLAS_PRIVATE_DETECTION_RECEIPT_KEY'),
        mapReceiptKey: secret(env, 'ATLAS_PRIVATE_MAP_RECEIPT_KEY'),
    };
    const receiptIds = Object.fromEntries(['COLOR', 'DETECTION', 'MAP'].map(kind => {
        const id = env[`ATLAS_PRIVATE_${kind}_RECEIPT_KEY_ID`];
        check(typeof id === 'string' && /^[a-zA-Z0-9._-]{1,80}$/.test(id), 'ATLAS_PRIVATE_CONFIGURATION_INVALID'); return [kind, id];
    }));
    check([credentials.colorReceiptKey, credentials.mapReceiptKey].every(value => /^[A-Za-z0-9_-]{43,256}$/.test(value)),
        'ATLAS_PRIVATE_RECEIPT_KEY_INVALID');
    check(credentials.preparationKey !== credentials.geometryKey && credentials.preparationKey !== credentials.detectorKey
        && credentials.preparationKey !== credentials.registrationKey
        && new Set([credentials.colorReceiptKey, credentials.detectionReceiptKey, credentials.mapReceiptKey]).size === 3,
    'ATLAS_PRIVATE_KEY_REUSED');
    const fixed = { version: 'atlas-private-runtime-v1', mode: 'PRODUCTION', origin, releaseSha, deploymentId,
        storage, workers, operatorRuntimeHash: binding.operatorRuntimeHash,
        allowedPhoneHashes: [...binding.allowedPhoneHashes].sort(), gradingPolicyHash,
        sourceDatabaseBindingHash: digest(sourceDatabaseUrl),
        workspaceKeyHash: digest(workspaceKey), gradingKeyHash: digest(gradingKey), imageKeyHash: digest(imageKey),
        dispatch: dispatch ? { coordinatorDatabaseBindingHash: digest(dispatch.coordinatorDatabaseUrl),
            artifactRoot: dispatch.artifactRoot, manifestPath: dispatch.manifestPath, manifestHash: dispatch.manifestHash,
            operatorEnvironmentHash: digest(canonical(dispatch.operatorEnv)) } : null,
        credentialHashes: Object.fromEntries(Object.entries(credentials).map(([name, value]) => [name, digest(value)])), receiptIds };
    const configHash = digest(canonical(fixed));
    const grading = { mode: fixed.mode, origin, deploymentId, releaseSha, clientKeyHash: fixed.gradingKeyHash,
        serviceUrl: workers.detectorOrigin, gradingPolicyHash, key: gradingKey,
        configHash: digest(canonical({ version: 'atlas-private-grading-config-v1', privateConfigHash: configHash })) };
    const image = { mode: fixed.mode, origin, deploymentId, releaseSha, clientKeyHash: fixed.imageKeyHash,
        gradingPolicyHash, key: imageKey,
        configHash: digest(canonical({ version: 'atlas-private-image-config-v1', privateConfigHash: configHash })) };
    return Object.freeze({ ...fixed, configHash, sourceDatabaseUrl, workspaceKey, grading, image, credentials, dispatch });
}

export function privateWorkspaceBinding(config, staff) {
    check(staff?.enabled && staff.mode === 'PRODUCTION' && release.test(staff.releaseSha ?? '')
        && sha.test(staff.configHash ?? '') && /^[a-zA-Z0-9._-]{1,120}$/.test(staff.deploymentId ?? ''),
    'ATLAS_PRIVATE_STAFF_NOT_ENABLED');
    const admission = { purpose: 'atlas-workspace-service-v1', staffConfigHash: staff.configHash,
        origin: config.origin, uploadOrigin: config.storage.uploadOrigin,
        serviceReleaseSha: config.releaseSha, serviceDeploymentId: config.deploymentId, clientKeyHash: config.workspaceKeyHash };
    return { ...admission, configHash: digest(canonical(admission)), key: config.workspaceKey,
        releaseSha: staff.releaseSha, deploymentId: staff.deploymentId };
}
