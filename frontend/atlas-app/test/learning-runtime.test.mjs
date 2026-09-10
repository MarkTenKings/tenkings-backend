import test from 'node:test';
import assert from 'node:assert/strict';
import { learningRuntimeSettings, createLearningRuntime } from '../lib/server/access/learning-runtime.mjs';
import { DurableStaffAuth } from '../lib/server/access/auth.mjs';
import { canonical } from '../lib/server/review-contract.mjs';
import { hash } from '../lib/server/policy.mjs';
const key=n=>Buffer.alloc(32,n),sha=n=>String(n).repeat(64);
function fixture(){
    const staff={mode:'PRODUCTION',sessionKey:key(1),phoneKey:key(2),phoneByHash:new Map([[sha(3),'fixture-only'],[sha(4),'fixture-only']])};
    const env={NODE_ENV:'production',VERCEL_ENV:'production',ATLAS_TRUSTED_LEARNING_ENABLED:'true',
        ATLAS_TRUSTED_LEARNING_ORIGIN:'https://private.example.test',ATLAS_TRUSTED_LEARNING_DEPLOYMENT_ID:'private-dpl',
        ATLAS_TRUSTED_LEARNING_RELEASE_SHA:'a'.repeat(40),ATLAS_TRUSTED_LEARNING_KEY:key(5).toString('base64'),
        ATLAS_TRUSTED_LEARNING_GRADING_POLICY_HASH:sha(6)};
    return {staff,env};
}
test('staff learning binds private deployment, current policy and independent hashed roster',()=>{
    const {staff,env}=fixture(),config=learningRuntimeSettings(env,staff);
    assert.equal(config.deploymentId,'private-dpl');assert.equal(config.releaseSha,'a'.repeat(40));
    assert.equal(config.phoneAllowlistHash,hash(canonical([...staff.phoneByHash.keys()].sort())));
    const changed=learningRuntimeSettings({...env,ATLAS_TRUSTED_LEARNING_DEPLOYMENT_ID:'next-private-dpl'},staff);
    assert.notEqual(changed.configHash,config.configHash);
    assert.equal(learningRuntimeSettings({...env,ATLAS_TRUSTED_LEARNING_ENABLED:'false'},staff),null);
});
test('learning cannot borrow another purpose key, local flags or staff deployment as its private binding',()=>{
    const {staff,env}=fixture();
    for(const change of [{NODE_ENV:'development'},{VERCEL_ENV:'preview'},{ATLAS_LOCAL_POSTGRES:''},
        {ATLAS_TRUSTED_LEARNING_DEPLOYMENT_ID:undefined},{ATLAS_TRUSTED_LEARNING_RELEASE_SHA:'0'.repeat(40)},
        {ATLAS_TRUSTED_LEARNING_KEY:staff.sessionKey.toString('base64')},
        {ATLAS_TRUSTED_LEARNING_KEY:staff.phoneKey.toString('base64')},
        ...['ATLAS_GRADING_BRIDGE_KEY','ATLAS_INTAKE_KEY','ATLAS_OPERATOR_EVIDENCE_KEY','ATLAS_PUBLIC_MEDIA_KEY',
            'ATLAS_MACHINE_ADMISSION_KEY','ATLAS_MACHINE_EXECUTION_KEY'].map(name=>({[name]:env.ATLAS_TRUSTED_LEARNING_KEY}))])
        assert.throws(()=>learningRuntimeSettings({...env,...change},staff));
    assert.throws(()=>learningRuntimeSettings(env,{...staff,mode:'LOCAL_FIXTURE'}));
});
test('runtime reparses removed or malformed configuration while preserving the history service',()=>{
    const {staff,env}=fixture(),auth=new DurableStaffAuth({database:{},config:staff}),review={assigned(){}};
    const create=()=>createLearningRuntime({env,staffConfig:staff,auth,review,fetchImpl(){throw Error('No transport call allowed');}});
    const first=create();assert(first.candidates);
    env.ATLAS_TRUSTED_LEARNING_ENABLED='false';const disabled=create();assert.equal(disabled.candidates,null);
    env.ATLAS_TRUSTED_LEARNING_ENABLED='true';env.ATLAS_TRUSTED_LEARNING_KEY='invalid';assert.equal(create().candidates,null);
    assert.equal(typeof disabled.read,'function');assert.equal(typeof disabled.decide,'function');
});
