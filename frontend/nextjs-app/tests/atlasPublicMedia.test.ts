import test from 'node:test';
import assert from 'node:assert/strict';
import { atlasPublicMediaConfig } from '../lib/server/atlasPublicMedia';
const env = { NODE_ENV: 'production', VERCEL_ENV: 'production', ATLAS_PUBLIC_MEDIA_RUNTIME: 's3',
    VERCEL_URL: 'media-release.vercel.app', VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40), ATLAS_PUBLIC_MEDIA_ORIGIN: 'https://bridge.example.test',
    ATLAS_PUBLIC_MEDIA_KEY: Buffer.alloc(32, 3).toString('base64'), ATLAS_PUBLIC_MEDIA_STORAGE_ENDPOINT: 'https://storage.example.test',
    ATLAS_PUBLIC_MEDIA_STORAGE_BUCKET: 'atlas-images', ATLAS_PUBLIC_MEDIA_STORAGE_REGION: 'auto',
    ATLAS_PUBLIC_MEDIA_STORAGE_ACCESS_KEY_ID: 'synthetic-read-key', ATLAS_PUBLIC_MEDIA_STORAGE_SECRET_ACCESS_KEY: 'synthetic-storage-key-only-000000000' };
test('public media requires its own exact production release and dedicated storage credentials', () => {
    const config = atlasPublicMediaConfig(env); assert.equal(config.clientKeyHash.length, 64);
    for (const update of [{ NODE_ENV: 'development' }, { VERCEL_ENV: 'preview' }, { ATLAS_PUBLIC_MEDIA_RUNTIME: '' },
        { ATLAS_LOCAL_POSTGRES: '1' }, { VERCEL_URL: 'bridge.example.test' }, { VERCEL_GIT_COMMIT_SHA: '' },
        { ATLAS_PUBLIC_MEDIA_ORIGIN: 'http://bridge.example.test' }, { ATLAS_PUBLIC_MEDIA_STORAGE_ENDPOINT: 'https://storage.example.test/arbitrary/path' },
        { ATLAS_PUBLIC_MEDIA_KEY: '' }, { ATLAS_PUBLIC_MEDIA_STORAGE_ACCESS_KEY_ID: '' }, { ATLAS_PUBLIC_MEDIA_STORAGE_SECRET_ACCESS_KEY: '' }])
        assert.throws(() => atlasPublicMediaConfig({ ...env, ...update }));
    const rotated = atlasPublicMediaConfig({ ...env, ATLAS_PUBLIC_MEDIA_STORAGE_SECRET_ACCESS_KEY: env.ATLAS_PUBLIC_MEDIA_STORAGE_SECRET_ACCESS_KEY + 'rotated' });
    assert.notEqual(rotated.configHash, config.configHash);
});
test('public media cannot activate from legacy or ambient S3 credentials', () => {
    assert.throws(() => atlasPublicMediaConfig({ ...env, ATLAS_PUBLIC_MEDIA_STORAGE_ACCESS_KEY_ID: undefined,
        AWS_ACCESS_KEY_ID: 'ambient-should-not-be-used', S3_ACCESS_KEY_ID: 'legacy-should-not-be-used' }));
});
