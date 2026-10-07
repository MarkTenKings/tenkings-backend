import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { canonical, digest } from '@atlas/service-bridge/protocol';
import { privateRuntimeConfig, privateWorkspaceBinding } from '../src/config.mjs';

function fixture() {
    const env = { NODE_ENV: 'production', ATLAS_PRIVATE_ENABLED: 'true', ATLAS_PRIVATE_ORIGIN: 'https://private.example',
        ATLAS_PRIVATE_RELEASE_SHA: 'a'.repeat(40), ATLAS_PRIVATE_DEPLOYMENT_ID: 'fixture-private-release',
        ATLAS_PRIVATE_SOURCE_DATABASE_URL: `postgresql://atlas_workspace_source_fixture:${'x'.repeat(40)}@fixture.db.ondigitalocean.com:25060/defaultdb?schema=atlas_staff&sslmode=require&connection_limit=4`,
        ATLAS_PRIVATE_BINDINGS_JSON: JSON.stringify({ version: 'atlas-private-bindings-v1',
            storage: { endpoint: 'https://storage.example', uploadOrigin: 'https://storage.example', bucket: 'private-fixture', region: 'nyc3' },
            workers: { geometryOrigin: 'https://geometry.example', preparationOrigin: 'https://preparation.example',
                detectorOrigin: 'https://detector.example', registrationOrigin: 'https://registration.example' },
            operatorRuntimeHash: 'b'.repeat(64), allowedPhoneHashes: ['c'.repeat(64)] }) };
    for (const name of ['WORKSPACE_KEY', 'GRADING_KEY', 'IMAGE_KEY', 'STORAGE_ACCESS_KEY_ID', 'STORAGE_SECRET_ACCESS_KEY',
        'GEOMETRY_KEY', 'PREPARATION_KEY', 'DETECTOR_KEY', 'REGISTRATION_KEY', 'COLOR_RECEIPT_KEY', 'DETECTION_RECEIPT_KEY', 'MAP_RECEIPT_KEY'])
        env[`ATLAS_PRIVATE_${name}`] = randomBytes(32).toString(['WORKSPACE_KEY', 'GRADING_KEY', 'IMAGE_KEY'].includes(name) ? 'base64' : 'base64url');
    for (const name of ['COLOR', 'DETECTION', 'MAP']) env[`ATLAS_PRIVATE_${name}_RECEIPT_KEY_ID`] = `fixture-${name.toLowerCase()}`;
    return env;
}
test('private configuration binds every dedicated credential without disclosing it in public hashes', () => {
    const env = fixture(), config = privateRuntimeConfig(env, 'd'.repeat(64));
    assert.equal(config.mode, 'PRODUCTION'); assert.match(config.configHash, /^[a-f0-9]{64}$/);
    for (const name of ['ATLAS_PRIVATE_WORKSPACE_KEY', 'ATLAS_PRIVATE_PREPARATION_KEY', 'ATLAS_PRIVATE_SOURCE_DATABASE_URL']) {
        const changed = { ...env, [name]: name.endsWith('DATABASE_URL') ? env[name].replace('x'.repeat(40), 'y'.repeat(40))
            : randomBytes(32).toString(name.endsWith('WORKSPACE_KEY') ? 'base64' : 'base64url') };
        assert.notEqual(privateRuntimeConfig(changed, 'd'.repeat(64)).configHash, config.configHash);
    }
});
test('generic credentials, reused secrets, invalid fixed origins, broad DB and local fixture settings fail closed', () => {
    for (const change of [{ DATABASE_URL: '' }, { OPENAI_API_KEY: '' }, { AWS_ACCESS_KEY_ID: '' }, { ATLAS_LOCAL_SYNTHETIC: '' },
        { NODE_ENV: 'development' }, { ATLAS_PRIVATE_ENABLED: 'false' }, { ATLAS_PRIVATE_ORIGIN: 'http://private.example' },
        { ATLAS_PRIVATE_ORIGIN: 'https://private.example/path' }, { ATLAS_PRIVATE_RELEASE_SHA: 'latest' },
        { VERCEL_URL: 'private.vercel.app', VERCEL_ENV: 'preview' }]) assert.throws(() => privateRuntimeConfig({ ...fixture(), ...change }, 'd'.repeat(64)));
    const env = fixture();
    assert.throws(() => privateRuntimeConfig({ ...env, ATLAS_PRIVATE_GRADING_KEY: env.ATLAS_PRIVATE_WORKSPACE_KEY }, 'd'.repeat(64)));
    assert.throws(() => privateRuntimeConfig({ ...env, ATLAS_PRIVATE_PREPARATION_KEY: env.ATLAS_PRIVATE_GEOMETRY_KEY }, 'd'.repeat(64)));
    for (const name of ['ATLAS_PRIVATE_COLOR_RECEIPT_KEY', 'ATLAS_PRIVATE_MAP_RECEIPT_KEY'])
        for (const value of ['x'.repeat(32), 'x'.repeat(43) + '+', 'é'.repeat(43)])
            assert.throws(() => privateRuntimeConfig({ ...env, [name]: value }, 'd'.repeat(64)));
    for (const url of [env.ATLAS_PRIVATE_SOURCE_DATABASE_URL.replace('atlas_workspace_source_fixture', 'doadmin'),
        env.ATLAS_PRIVATE_SOURCE_DATABASE_URL.replace('sslmode=require', 'sslmode=disable'),
        env.ATLAS_PRIVATE_SOURCE_DATABASE_URL + '&options=malicious', env.ATLAS_PRIVATE_SOURCE_DATABASE_URL + '&schema=public'])
        assert.throws(() => privateRuntimeConfig({ ...env, ATLAS_PRIVATE_SOURCE_DATABASE_URL: url }, 'd'.repeat(64)));
});
test('current staff peer reproduces the actual staff workspace binding and changes on rebind', () => {
    const config = privateRuntimeConfig(fixture(), 'd'.repeat(64));
    const staff = { enabled: true, mode: 'PRODUCTION', releaseSha: 'e'.repeat(40), deploymentId: 'staff-release-one', configHash: 'f'.repeat(64) };
    const value = privateWorkspaceBinding(config, staff);
    assert.equal(value.releaseSha, staff.releaseSha); assert.equal(value.deploymentId, staff.deploymentId);
    assert.equal(value.configHash, digest(canonical({ purpose: 'atlas-workspace-service-v1', staffConfigHash: staff.configHash,
        origin: config.origin, uploadOrigin: config.storage.uploadOrigin, serviceReleaseSha: config.releaseSha,
        serviceDeploymentId: config.deploymentId, clientKeyHash: config.workspaceKeyHash })));
    assert.notEqual(privateWorkspaceBinding(config, { ...staff, configHash: '0'.repeat(64) }).configHash, value.configHash);
    assert.throws(() => privateWorkspaceBinding(config, { ...staff, enabled: false }));
});

function dispatchFixture() {
    const env = fixture();
    Object.assign(env, { ATLAS_PRIVATE_DISPATCH_ENABLED: 'true',
        ATLAS_PRIVATE_COORDINATOR_DATABASE_URL: env.ATLAS_PRIVATE_SOURCE_DATABASE_URL.replace('atlas_workspace_source_', 'atlas_workspace_coordinator_'),
        ATLAS_PRIVATE_OPERATOR_ARTIFACT_ROOT: '/operator', ATLAS_PRIVATE_OPERATOR_MANIFEST_PATH: '/run/secrets/operator-manifest.json',
        ATLAS_PRIVATE_OPERATOR_MANIFEST_SHA256: '8'.repeat(64), ATLAS_OPERATOR_ENABLED: 'true',
        ATLAS_OPERATOR_RELEASE_SHA: 'a'.repeat(40), ATLAS_OPERATOR_BUILD_HASH: '1'.repeat(64), ATLAS_OPERATOR_RUNTIME_HASH: 'b'.repeat(64),
        ATLAS_OPERATOR_DATABASE_URL: env.ATLAS_PRIVATE_SOURCE_DATABASE_URL.replace('atlas_workspace_source_', 'atlas_operator_'),
        ATLAS_OPERATOR_OPENAI_PROJECT_ID: 'proj_private_fixture', ATLAS_OPERATOR_OPENAI_API_KEY: 'fixture-operator-key-' + 'x'.repeat(40),
        ATLAS_OPERATOR_EVIDENCE_ORIGIN: env.ATLAS_PRIVATE_ORIGIN, ATLAS_OPERATOR_EVIDENCE_KEY: env.ATLAS_PRIVATE_IMAGE_KEY });
    return env;
}
test('dispatcher binds independent coordinator, verified operator manifest and dedicated operator environment', () => {
    const env = dispatchFixture(), config = privateRuntimeConfig(env, 'd'.repeat(64));
    assert.equal(config.dispatch.operatorEnv.NODE_ENV, 'production');
    assert(!('ATLAS_PRIVATE_SOURCE_DATABASE_URL' in config.dispatch.operatorEnv));
    assert(!('ATLAS_PRIVATE_STORAGE_SECRET_ACCESS_KEY' in config.dispatch.operatorEnv));
    for (const change of [{ ATLAS_PRIVATE_OPERATOR_MANIFEST_SHA256: '9'.repeat(64) },
        { ATLAS_OPERATOR_OPENAI_API_KEY: 'fixture-other-key-' + 'y'.repeat(40) },
        { ATLAS_PRIVATE_COORDINATOR_DATABASE_URL: env.ATLAS_PRIVATE_COORDINATOR_DATABASE_URL.replace('x'.repeat(40), 'z'.repeat(40)) }])
        assert.notEqual(privateRuntimeConfig({ ...env, ...change }, 'd'.repeat(64)).configHash, config.configHash);
});
test('dispatcher rejects credential-role reuse, unbound manifests, admission keys and disabled credential residue', () => {
    const env = dispatchFixture();
    for (const change of [{ ATLAS_PRIVATE_COORDINATOR_DATABASE_URL: env.ATLAS_PRIVATE_SOURCE_DATABASE_URL },
        { ATLAS_PRIVATE_OPERATOR_MANIFEST_SHA256: 'latest' }, { ATLAS_PRIVATE_OPERATOR_ARTIFACT_ROOT: '/operator/../unreviewed' },
        { ATLAS_OPERATOR_ENABLED: 'false' }, { ATLAS_MACHINE_ADMISSION_KEY: '' }, { ATLAS_PRIVATE_DISPATCH_ENABLED: 'false' }])
        assert.throws(() => privateRuntimeConfig({ ...env, ...change }, 'd'.repeat(64)));
});
