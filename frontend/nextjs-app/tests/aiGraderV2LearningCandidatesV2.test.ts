import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import baseline from './fixtures/atlasLearningHarvestBeforeExtraction.json';
import { harvestSpeedsterLearningCandidatesV2, harvestSpeedsterLearningSessionV2 } from '../lib/ai-grader-v2/learning-harvest-v2';
import { SPEEDSTER_LEARNING_FINGERPRINT_VERSION } from '../lib/ai-grader-v2/learning-v2';

function freezeDeep<T>(value: T): T {
    if (value && typeof value === 'object') {
        for (const child of Object.values(value)) freezeDeep(child);
        Object.freeze(value);
    }
    return value;
}

for (const fixture of baseline.fixtures) {
    test(`candidate extraction preserves pre-extraction output: ${fixture.name}`, () => {
        const input = freezeDeep(structuredClone(fixture.session)), rawBefore = JSON.stringify(input.reviewedDefects);
        const result = harvestSpeedsterLearningSessionV2(input);
        assert.deepEqual(result, fixture.expected);
        assert.equal(createHash('sha256').update(JSON.stringify(result)).digest('hex'), fixture.expectedJsonSha256);
        const candidates = harvestSpeedsterLearningCandidatesV2({ fingerprintVersion: input.fingerprintVersion,
            reviewedDefects: input.reviewedDefects });
        assert.deepEqual(candidates, { lessons: fixture.expected.history.lessons, diagnostics: fixture.expected.diagnostics });
        assert.equal(JSON.stringify(input.reviewedDefects), rawBefore);
        assert.deepEqual(Object.keys(candidates), ['lessons', 'diagnostics']);
    });
}

test('candidate generation needs no completion identity and retains each paired relabel candidate', () => {
    const result = harvestSpeedsterLearningCandidatesV2({ fingerprintVersion: SPEEDSTER_LEARNING_FINGERPRINT_VERSION,
        reviewedDefects: [{ id:'exact-finding',origin:'DETECTOR',detectedDefectType:'VISIBLE_WHITENING',defectType:'FRAYING',
            reviewResult:'TYPE_CORRECTED',sourceViewId:'FRONT:ORIGINAL',featureFingerprint:Array.from({length:32},(_,i)=>i===0?2:0) }] });
    assert.deepEqual(result.lessons.map(({ proposalOrder, lessonOrder, polarity, provenance }) => ({ proposalOrder,lessonOrder,polarity,provenance })), [
        { proposalOrder:0,lessonOrder:0,polarity:'NEGATIVE',provenance:'DETECTOR_RELABELED_NEGATIVE' },
        { proposalOrder:0,lessonOrder:1,polarity:'POSITIVE',provenance:'DETECTOR_RELABELED_POSITIVE' },
    ]);
    assert.equal(Object.hasOwn(result,'history'),false); assert.equal(Object.hasOwn(result,'approval'),false);
});

test('wrapper preserves original Date and metadata without passing them into candidate authority', () => {
    const completedAt=new Date('2026-09-08T12:34:56.789Z');
    const output=harvestSpeedsterLearningSessionV2({ sessionId:'original-session',completedAt,completionOrder:17,
        fingerprintVersion:SPEEDSTER_LEARNING_FINGERPRINT_VERSION,reviewedDefects:[] });
    assert.equal(output.history.completedAt,completedAt); assert.equal(output.history.sessionId,'original-session');
    assert.equal(output.history.completionOrder,17);
});

test('candidate normalization does not mutate or alias original fingerprints, masks or removed findings', () => {
    const fingerprint=Array.from({length:32},(_,i)=>i===0?2:0), mask={sha256:'a'.repeat(64),runs:[0,3,2]};
    const finding={id:'raw-removed',origin:'DETECTOR',defectType:'VISIBLE_WHITENING',detectedDefectType:'VISIBLE_WHITENING',
        reviewResult:'REMOVED',sourceViewId:'BACK:ORIGINAL',featureFingerprint:fingerprint,detectedMask:mask};
    const raw=freezeDeep([finding]), before=JSON.stringify(raw);
    const result=harvestSpeedsterLearningCandidatesV2({fingerprintVersion:SPEEDSTER_LEARNING_FINGERPRINT_VERSION,reviewedDefects:raw});
    assert.equal(result.lessons.length,1); assert.equal(result.lessons[0].polarity,'NEGATIVE');
    assert.notEqual(result.lessons[0].fingerprint,fingerprint); assert.equal(result.lessons[0].fingerprint[0],1);
    assert.equal(JSON.stringify(raw),before); assert.equal(raw[0].reviewResult,'REMOVED'); assert.equal(raw[0].detectedMask,mask);
});
