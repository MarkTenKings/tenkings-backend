import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {learningFixture} from './fixtures/trusted-learning.mjs';
import {canonical,digest} from '../src/protocol.mjs';
import {validateLearningCandidates} from '../src/trusted-learning.mjs';
const require=createRequire(import.meta.url);
const {harvestSpeedsterLearningCandidatesV2}=require('../../../frontend/nextjs-app/lib/ai-grader-v2/learning-harvest-v2.ts');
const {SPEEDSTER_LEARNING_FINGERPRINT_VERSION}=require('../../../frontend/nextjs-app/lib/ai-grader-v2/learning-v2.ts');

test('scoped bridge preserves exact original negative and paired relabel lessons without raw finding mutation',async()=>{
    for(const relabel of [false,true]){
        const f=learningFixture();
        if(relabel){f.snapshot.reviewedDefects[0].defectType='FRAYING';f.snapshot.reviewedDefects[0].reviewResult='TYPE_CORRECTED';}
        f.analysis.sourceCanonical=canonical(f.snapshot);f.analysis.sourceHash=digest(f.analysis.sourceCanonical);
        const admission=JSON.parse(f.analysis.admissionCanonical);admission.sourceHash=f.analysis.sourceHash;
        f.analysis.admissionCanonical=canonical(admission);f.analysis.admissionHash=digest(f.analysis.admissionCanonical);
        f.approval.analysisHash=f.analysis.sourceHash;f.scope.analysisHash=f.analysis.sourceHash;
        f.ports.fingerprintVersion=()=>SPEEDSTER_LEARNING_FINGERPRINT_VERSION;
        f.ports.generateCandidates=harvestSpeedsterLearningCandidatesV2;
        const raw=canonical(f.snapshot),expected=harvestSpeedsterLearningCandidatesV2({fingerprintVersion:SPEEDSTER_LEARNING_FINGERPRINT_VERSION,
            reviewedDefects:f.snapshot.reviewedDefects}),wire=await f.run();
        const candidates=validateLearningCandidates(f.state.rows[0]);
        assert.deepEqual(candidates.map(entry=>entry.lesson),expected.lessons);
        assert.equal(candidates.length,relabel?2:1);assert.equal(new Set(candidates.map(entry=>entry.candidateId)).size,candidates.length);
        assert.equal(canonical(f.snapshot),raw);assert.equal(f.raw.workflowState,'CAPTURED');
        assert.equal(JSON.stringify(wire).includes('fingerprint'),false);assert.equal(Object.hasOwn(wire,'completedAt'),false);
    }
});
