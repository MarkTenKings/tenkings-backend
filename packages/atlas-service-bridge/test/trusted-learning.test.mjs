import test from 'node:test';
import assert from 'node:assert/strict';
import {canonical,digest} from '../src/protocol.mjs';
import {makeTrustedLearningConfig,ScopedTrustedLearningCandidates,signTrustedLearningRequest,verifyTrustedLearningRequest,
    validateLearningCandidates,publicLearningCandidates,trustedLearningClient} from '../src/trusted-learning.mjs';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,h=n=>String(n).repeat(64);
import {learningFixture} from './fixtures/trusted-learning.mjs';
test('candidate bridge uses exact approved source, independent learning human and no private vectors on wire',async()=>{
    const f=learningFixture(),before=canonical(f.snapshot),result=await f.run();assert.equal(result.candidates.length,1);assert.equal(f.state.rows.length,1);
    assert.equal(f.i.certificationUntil,null);assert.notEqual(f.approval.actorId,f.i.id);assert.equal(canonical(f.snapshot),before);
    assert.equal(JSON.stringify(result).includes('fingerprint'),false);assert.equal(JSON.stringify(result).includes('rawMask'),false);
    assert.equal(validateLearningCandidates(f.state.rows[0]).length,1);assert.deepEqual(publicLearningCandidates(f.state.rows[0]),result.candidates);
});
test('same nonce returns one receipt and changed raw source fails before generator',async()=>{
    const f=learningFixture();assert.deepEqual(await f.run(),await f.run());assert.equal(f.state.rows.length,1);
    f.raw.updatedAt=new Date(+f.raw.updatedAt+1);const before=f.state.generatorCalls;await assert.rejects(f.run(),/LEARNING_SOURCE_CHANGED/);assert.equal(f.state.generatorCalls,before);
});
test('certification or operations is never a substitute for fresh learning training and assignment',async()=>{
    for(const mutate of [f=>f.i.trustedLearningUntil=null,f=>f.i.trustedLearningUntil=f.state.now,f=>f.i.role='OBSERVER',f=>f.session.createdAt=new Date(+f.state.now-300001),
        f=>f.assignment.canReview=false,f=>f.assignment.fence++,f=>f.browser.expiresAt=f.state.now,f=>f.i.accessVersion++,f=>f.session.revokedAt=f.state.now]){
        const f=learningFixture();f.i.certificationUntil=new Date(+f.state.now+600000);mutate(f);await assert.rejects(f.run(),/FRESH_TRUSTED_LEARNING_REVIEWER_REQUIRED/);assert.equal(f.state.rows.length,0);
    }
});
test('changed approval, raw analysis, source owner or bridge control fails closed',async()=>{
    for(const mutate of [f=>f.publication.currentApprovalId=id(8),f=>f.card.analysisRevision++,f=>f.raw.createdByUserId='other-owner',
        f=>f.analysis.sourceCanonical+=' ',f=>f.snapshot.reviewedDefects[0].reviewResult='ACCEPTED',f=>f.learning.enabled=false,f=>f.learning.phoneAllowlistHash=h(0)]){
        const f=learningFixture();mutate(f);await assert.rejects(f.run());assert.equal(f.state.rows.length,0);
    }
});
test('final freshness and deferred constraint failure roll back immutable candidate INSERT',async()=>{
    const f=learningFixture();f.state.end=new Date(+f.state.now+30001);await assert.rejects(f.run(),/EXPIRED/);assert.equal(f.state.rows.length,0);
    const g=learningFixture();g.state.failFlush=true;await assert.rejects(g.run(),/deferred-failure/);assert.equal(g.state.rows.length,0);
});
test('candidate request rejects substituted purpose, extra source locator, bad key and expired time',()=>{
    const f=learningFixture(),signed=signTrustedLearningRequest(f.config,f.scope,+f.state.now);
    assert.throws(()=>verifyTrustedLearningRequest(f.config,signed.body,h(0),+f.state.now),/AUTHENTICATION/);
    assert.throws(()=>verifyTrustedLearningRequest(f.config,signed.body,signed.signature,+f.state.now+30000),/EXPIRED/);
    assert.throws(()=>signTrustedLearningRequest(f.config,{...f.scope,sourceId:'client-chosen'}));
    assert.throws(()=>makeTrustedLearningConfig({...f.config,otherKeyHashes:[f.config.clientKeyHash]}),/CONFIGURATION/);
});
test('candidate client uses fixed origin without redirects and drops server candidate wire data',async()=>{
    const f=learningFixture(),result=await f.run();const client=trustedLearningClient(f.config,async(url,options)=>{
        assert.equal(url,`${f.config.origin}/api/internal/atlas/trusted-learning/candidates`);assert.equal(options.redirect,'error');
        verifyTrustedLearningRequest(f.config,options.body,options.headers['x-atlas-learning-signature']);return new Response(canonical(result),{headers:{'content-type':'application/json'}});});
    assert.deepEqual(await client.call(f.scope),{receiptId:result.receiptId,bundleHash:result.bundleHash});
});
test('candidate transport bounds uncooperative fetch, body reads and cancellation without another request',async()=>{
    const f=learningFixture(),timers={setTimeout:fn=>setTimeout(fn,5),clearTimeout};
    let calls=0,cancelled=0,released=0;
    await assert.rejects(trustedLearningClient(f.config,()=>{calls++;return new Promise(()=>{});},{timers}).call(f.scope),/LEARNING_OUTCOME_UNCONFIRMED/);
    assert.equal(calls,1);
    const body={getReader:()=>({read:()=>new Promise(()=>{}),cancel(){cancelled++;return new Promise(()=>{});},releaseLock(){released++;}})};
    await assert.rejects(trustedLearningClient(f.config,async()=>({status:200,headers:new Headers({'content-type':'application/json'}),body}),{timers}).call(f.scope),/LEARNING_OUTCOME_UNCONFIRMED/);
    assert.equal(cancelled,1);assert.equal(released,1);
});
test('candidate transport rejects oversized and noncanonical responses; late fetch is cancelled',async()=>{
    const f=learningFixture(),wire=await f.run(),timers={setTimeout:fn=>setTimeout(fn,5),clearTimeout};
    for(const response of [new Response(JSON.stringify(wire),{headers:{'content-type':'application/json'}}),
        new Response('x'.repeat(131073),{headers:{'content-type':'application/json'}}),new Response('{}',{headers:{'content-length':'999999','content-type':'application/json'}})])
        await assert.rejects(trustedLearningClient(f.config,async()=>response).call(f.scope));
    let finish,cancelled=0;
    const call=trustedLearningClient(f.config,()=>new Promise(resolve=>{finish=resolve;}),{timers}).call(f.scope);
    await assert.rejects(call,/LEARNING_OUTCOME_UNCONFIRMED/);
    finish({body:{cancel(){cancelled++;}}});await new Promise(resolve=>setTimeout(resolve,0));assert.equal(cancelled,1);
});
test('generator receives a detached raw array and invalid lesson references cannot create receipts',async()=>{
    const f=learningFixture(),original=f.ports.generateCandidates,before=canonical(f.snapshot);
    f.ports.generateCandidates=input=>{const result=original(input);input.reviewedDefects[0].rawMask.sha256=h(0);return result;};
    await f.run();assert.equal(canonical(f.snapshot),before);
    for(const lesson of [null,{proposalOrder:-1},{proposalOrder:999}]){
        const g=learningFixture();g.ports.generateCandidates=()=>({lessons:[lesson]});
        await assert.rejects(g.run(),/LEARNING_CANDIDATES_INVALID/);assert.equal(g.state.rows.length,0);
    }
});
