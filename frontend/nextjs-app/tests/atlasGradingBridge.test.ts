import test from 'node:test';
import assert from 'node:assert/strict';
import { atlasGradingBridgeConfig, atlasGradingPolicyHash, atlasSpeedsterSourceEvidence } from '../lib/server/atlasGradingBridge';
import { currentSpeedsterDetectorReleasePolicy } from '../lib/server/speedsterCurrentRelease';

test('ATLAS private bridge cannot activate through local, preview or copied fixture flags', () => {
    for (const env of [{}, { NODE_ENV: 'development', ATLAS_GRADING_BRIDGE_ENABLED: 'true' },
        { NODE_ENV: 'production', VERCEL_ENV: 'preview', ATLAS_GRADING_BRIDGE_ENABLED: 'true' },
        { NODE_ENV: 'production', VERCEL_ENV: 'production', ATLAS_GRADING_BRIDGE_ENABLED: 'true', ATLAS_LOCAL_POSTGRES: '1' }])
        assert.throws(() => atlasGradingBridgeConfig(env), /BRIDGE_NOT_ENABLED/);
});
test('unadmitted preparation is not converted into a live ATLAS grading policy', () => {
    assert.throws(() => atlasGradingPolicyHash(), /preparation.*release|release.*preparation/i);
});
test('legacy capture without preserved preparation cannot become ATLAS evidence', () => {
    assert.throws(() => atlasSpeedsterSourceEvidence({ id: 'captured-session', createdByUserId: 'source-owner', workflowState: 'CAPTURED',
        capture: { front: { originalStorageKey: 'unbound' }, back: { originalStorageKey: 'unbound' } },
        reviewedDefects: [], gradeReport: null, updatedAt: new Date() }), /PRESERVED_PREPARATION_REQUIRED/);
});
test('current detector policy projection cannot mutate the original admission policy', () => {
    const before = currentSpeedsterDetectorReleasePolicy(), copy = currentSpeedsterDetectorReleasePolicy();
    Object.assign(copy.policy, { measurementVersion: 'untrusted replacement' });
    assert.deepEqual(currentSpeedsterDetectorReleasePolicy(), before);
});
