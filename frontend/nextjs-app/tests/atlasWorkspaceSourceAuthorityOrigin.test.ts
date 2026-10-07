import assert from 'node:assert/strict';
import test from 'node:test';
import { createAtlasWorkspaceSourceAuthority, type AtlasWorkspaceSourceAuthorityConfig } from '../lib/server/atlasWorkspaceSourceAuthority';

const config: AtlasWorkspaceSourceAuthorityConfig = { mode: 'LOCAL_FIXTURE', staffOrigin: 'http://127.0.0.1:4318',
    staffDeploymentId: 'owned-local-fixture', sourceDeploymentId: 'owned-local-source', staffReleaseSha: '0'.repeat(40),
    sourceReleaseSha: '0'.repeat(40), staffConfigHash: 'a'.repeat(64), configHash: 'b'.repeat(64),
    sourceConfigHash: 'c'.repeat(64), allowedPhoneHashes: ['d'.repeat(64)] };
const create = (changes: Partial<AtlasWorkspaceSourceAuthorityConfig> = {}) => createAtlasWorkspaceSourceAuthority({} as never, { ...config, ...changes });

test('only the exact established loopback origin is accepted for an explicit local fixture', () => {
    assert.ok(create());
    assert.ok(create({ staffOrigin: 'https://source.example.test' }));
    for (const staffOrigin of ['http://localhost:4318', 'http://127.0.0.1:4319', 'http://127.0.0.1:4318/path',
        'http://127.0.0.1:4318?x=y', 'http://user@127.0.0.1:4318', 'http://source.example.test'])
        assert.throws(() => create({ staffOrigin }), /WORKSPACE_SOURCE_CONFIGURATION_INVALID/);
    assert.throws(() => create({ mode: 'PRODUCTION' }), /WORKSPACE_SOURCE_CONFIGURATION_INVALID/);
});

test('production execution rejects every local fixture and retains exact HTTPS production origins', () => {
    const prior = process.env.NODE_ENV;
    try {
        Object.assign(process.env, { NODE_ENV: 'production' });
        assert.throws(() => create(), /WORKSPACE_SOURCE_CONFIGURATION_INVALID/);
        assert.throws(() => create({ staffOrigin: 'https://source.example.test' }), /WORKSPACE_SOURCE_CONFIGURATION_INVALID/);
        assert.ok(create({ mode: 'PRODUCTION', staffOrigin: 'https://source.example.test' }));
    } finally {
        if (prior === undefined) delete process.env.NODE_ENV; else Object.assign(process.env, { NODE_ENV: prior });
    }
});
