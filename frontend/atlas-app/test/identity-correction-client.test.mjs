import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { correctionAvailable, correctionRequest, correctionResult, retainCorrectionAfterError } from '../lib/identity-correction-client.mjs';
const identity = { playerName:'Example Player', year:'2020', manufacturer:'Example', productSet:'Sample', parallel:null, insert:null, cardNumber:'14' };
const card = { id:randomUUID(), evidenceRevision:3, evidenceHash:'a'.repeat(64), draft:{revision:7}, reviewHash:'b'.repeat(64),
    grading:{sourceRevision:'2026-09-08T10:00:00.000Z', analysisRevision:2, analysisHash:'c'.repeat(64), report:{cardProfile:'SPORTS', identity}} };
const request = () => correctionRequest(card, 'SPORTS', {...identity, playerName:'EXAMPLE PLAYER'}, 'Verified the name on this card.', randomUUID());
test('request captures exact current heads and original canonical identity without retaining mutable form references', () => {
    const values={...identity, playerName:'  EXAMPLE PLAYER  '}, body=correctionRequest(card,'SPORTS',values,'Checked card',randomUUID());
    values.playerName='Changed later';assert.equal(body.next.identity.playerName,'EXAMPLE PLAYER');
    assert.equal(body.sourceRevision,card.grading.sourceRevision);assert.equal(body.expectedReviewRevision,7);assert.equal(body.expectedEvidenceRevision,3);
    assert.equal(correctionAvailable({...card,grading:{...card.grading,sourceRevision:'local-illustration-v1'}}),false);
    assert.throws(()=>correctionRequest(card,'SPORTS',{...identity,year:' '},'Checked',randomUUID()));
    const pokemon=correctionRequest(card,'POKEMON',{cardName:'Sample',year:'2020',productSet:'Sample',layoutType:'ENERGY',manufacturer:'must not leak',insert:'must not leak'},'Checked',randomUUID());
    assert.deepEqual(pokemon.next.identity,{cardName:'Sample',year:'2020',productSet:'Sample',parallel:null,cardNumber:null,layoutType:'ENERGY'});
});
test('foreign or malformed correction receipts cannot release the exact pending request', () => {
    const body=request(),receipt={status:'CORRECTED',receiptId:randomUUID(),operationId:body.operationId,analysisRevision:3,reviewRevision:8,evidenceRevision:4,
        evidenceHash:'d'.repeat(64),sourceHash:'e'.repeat(64),reviewHash:'f'.repeat(64),createdAt:'2026-09-08T10:01:00.000Z'};
    assert.deepEqual(correctionResult({correction:receipt},body),receipt);
    for(const patch of [{operationId:randomUUID()},{reviewRevision:9},{createdAt:'2026-09-08'},{evidenceHash:'bad'},{rawSource:'forbidden'}])
        assert.throws(()=>correctionResult({correction:{...receipt,...patch}},body));
});
test('reprocess and no-change replies must describe the submitted identity and allowed reasons', () => {
    const body=request(),advisory={status:'REPROCESS_REQUIRED',advisory:true,reasons:['EXACT_MAP_KEY_CHANGED'],changedFields:['playerName'],identity:body.next.identity};
    assert.equal(correctionResult({correction:advisory},body).status,'REPROCESS_REQUIRED');
    for(const patch of [{reasons:[]},{reasons:['RUN_STARTED']},{identity:{...identity,playerName:'Foreign identity'}},{status:'NO_CHANGE'},{changedFields:['sourceOwnerId']}])
        assert.throws(()=>correctionResult({correction:{...advisory,...patch}},body));
    assert.equal(correctionResult({correction:{...advisory,status:'NO_CHANGE',reasons:[],changedFields:[]}},body).status,'NO_CHANGE');
});
test('initial pre-dispatch refusal releases the form; unknown outcomes survive later configuration and auth failures', () => {
    for(const error of [{status:400,code:'IDENTITY_REQUEST_INVALID'},{status:503,code:'IDENTITY_NOT_CONFIGURED'}])
        assert.equal(retainCorrectionAfterError({uncertain:false},error),false);
    const retained={uncertain:false};assert.equal(retainCorrectionAfterError(retained,{status:0}),true);
    for(const error of [{status:503,code:'IDENTITY_NOT_CONFIGURED'},{status:403},{status:409}]) assert.equal(retainCorrectionAfterError(retained,error),true);
    assert.equal(retainCorrectionAfterError({uncertain:false},{status:503,code:'IDENTITY_OUTCOME_UNCONFIRMED'}),true);
});
test('post-dispatch failures retain correction uncertainty while a fresh unsent access failure does not invent it',()=>{
    for(const error of [{status:401,code:'SIGN_IN_REQUIRED'},{status:403,code:'FRESH_IDENTITY_REVIEWER_REQUIRED'},
        {status:409,code:'IDENTITY_HEAD_CHANGED'},{status:409,code:'IDENTITY_REQUEST_CONFLICT'},
        {status:408},{status:422},{status:500},{status:503,code:'IDENTITY_RESPONSE_INVALID'},{status:0}]){
        const posted={uncertain:false};assert.equal(retainCorrectionAfterError(posted,error,{dispatched:true}),true);assert.equal(posted.uncertain,true);
        const unsent={uncertain:false};assert.equal(retainCorrectionAfterError(unsent,error,{dispatched:false}),false);assert.equal(unsent.uncertain,false);
        assert.equal(retainCorrectionAfterError(posted,error,{dispatched:false}),true);
    }
});
