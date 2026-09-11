import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { operatorControl, assertOperatorDispatch, assertOperatorApply, pauseAfterAppliedAction,
    planOperatorControl, projectOperatorControl } from '../src/workflow-control.mjs';
import { OperatorLedger } from '../src/ledger.mjs';
import { canonical, digest } from '@atlas/service-bridge/protocol';
import { MODEL, PRICING, instructionsFor } from '../src/responses.mjs';

const run = () => ({ id: randomUUID(), state: 'RUNNING', controlState: 'RUNNING', controlRevision: 1,
    executionMode: 'CONTINUOUS', stepBudget: 0, revision: 1, leaseFence: 1, leaseOwner: randomUUID(),
    deadlineAt: new Date(Date.now() + 60_000), policyCanonical: '{}', inputCanonical: 'private continuation',
    reservedMicroUsd: 55_000_000n });

function claimFixture(binding = current => ({ runId: current.id, controlRevision: current.controlRevision })) {
    const now=new Date(), current={...run(),phase:'REPORT_REVIEW',specimenId:randomUUID(),pilotId:randomUUID(),leaseOwner:null,
        controlRevision:3,executionMode:'STEP',stepBudget:1,policyHash:'a'.repeat(64),runtimeHash:'b'.repeat(64),gradingPolicyHash:'c'.repeat(64),
        evidenceHash:'d'.repeat(64),expectedAnalysisRevision:1,expectedReviewRevision:2,
        inputCanonical:'{}',inputHash:digest('{}'),manifestCanonical:'{}',manifestHash:digest('{}')};
    const attempts=[{id:randomUUID(),state:'RESERVED'},{id:randomUUID(),state:'UNKNOWN'}],events=[];
    const tx={
        $queryRaw:async(strings,...values)=>{const sql=strings.join('?');
            if(sql.includes('"StaffOperatorRun"')) {assert(sql.includes('FOR UPDATE'));assert.equal(values[0],current.id);events.push('locked-run');return [current];}
            assert(sql.includes('lock_operator_specimen'));return [{id:current.specimenId,evidenceHash:current.evidenceHash,analysisRevision:1,draftRevision:2}];},
        staffGradingOperation:{count:async()=>0},
        staffOperatorAttempt:{findMany:async()=>{events.push('pending-read');return attempts;},update:async({where,data})=>{
            events.push('attempt-write');Object.assign(attempts.find(row=>row.id===where.id),data);}},
        staffOperatorRun:{count:async()=>0,update:async({data})=>{events.push('run-write');
            const {leaseFence,...fields}=data;Object.assign(current,fields);if(leaseFence) current.leaseFence+=leaseFence.increment;return current;}},
    };
    const context={tx,now,policy:{pilotId:current.pilotId,tools:['read_card_report'],leaseMs:10_000},control:{policyHash:current.policyHash},
        bridge:{gradingPolicyHash:current.gradingPolicyHash},budget:{specimenIds:[current.specimenId]}};
    const expectedClaim=binding(current),ledger=new OperatorLedger({client:null,config:{configHash:current.runtimeHash},
        ...(expectedClaim===undefined?{}:{expectedClaim})});
    ledger.transaction=async work=>work(context);
    return {ledger,current,attempts,events,expectedClaim,context};
}

test('claim checks the locked control generation before cancelling reservations or replacing a lease',async()=>{
    for(const change of [current=>{current.controlRevision+=2;},current=>{current.id=randomUUID();}]) {
        const f=claimFixture();change(f.current);const before=structuredClone({run:f.current,attempts:f.attempts});
        await assert.rejects(f.ledger.claim(f.current.id,randomUUID()),error=>error.code==='ASTRA_CONTROL_REVISION_STALE');
        assert.deepEqual(f.events,['locked-run']);assert.deepEqual({run:f.current,attempts:f.attempts},before);
    }
});

test('claim binding is copied at construction and malformed or partial bindings cannot create a ledger',async()=>{
    const f=claimFixture();f.expectedClaim.controlRevision=5;f.current.controlRevision=5;
    await assert.rejects(f.ledger.claim(f.current.id,randomUUID()),/ASTRA_CONTROL_REVISION_STALE/);
    for(const expectedClaim of [null,{}, {runId:f.current.id}, {controlRevision:1},
        ...[0,-1,1.5,Number.MAX_SAFE_INTEGER+1,'3'].map(controlRevision=>({runId:f.current.id,controlRevision})),
        {runId:f.current.id,controlRevision:3,provider:'untrusted'}])
        assert.throws(()=>new OperatorLedger({client:null,config:{},expectedClaim}),/ASTRA_CLAIM_BINDING_INVALID/);
});

test('current or legacy claim retains reconciliation behavior and later generation changes do not block lease renewal',async()=>{
    for(const binding of [current=>({runId:current.id,controlRevision:current.controlRevision}),()=>undefined]) {
        const f=claimFixture(binding),owner=randomUUID(),claimed=await f.ledger.claim(f.current.id,owner);
        assert.equal(claimed.mode,'RECONCILE_ONLY');assert.equal(f.current.leaseOwner,owner);
        assert.equal(f.attempts[0].state,'FAILED');assert.equal(f.attempts[1].state,'UNKNOWN');assert.equal(f.current.stepBudget,1);
        assert.deepEqual(f.events,['locked-run','pending-read','attempt-write','run-write']);
        f.current.controlRevision++;assert.deepEqual(await f.ledger.renew(claimed.lease),claimed.lease);
        assert.equal(f.events.at(-1),'run-write');assert.equal(f.attempts[1].state,'UNKNOWN');
    }
});

test('a stale invocation binding still retains an uncertain receipt and its cost hold after control changes',async()=>{
    const f=claimFixture(),{tx,now}=f.context,attempt=f.attempts[1],dispatchClaimId=randomUUID(),stored=[];
    f.current.controlRevision+=2;f.ledger.config.providerBindingHash='e'.repeat(64);
    Object.assign(attempt,{runId:f.current.id,dispatchClaimId,providerBindingHash:f.ledger.config.providerBindingHash,dispatchedAt:now});
    tx.$queryRaw=async strings=>{assert(strings.join('?').includes('"StaffOperatorAttempt"'));return [attempt];};
    tx.staffOperatorReceipt={findUnique:async()=>null,create:async({data})=>{stored.push(data);return data;}};
    tx.staffOperatorRun.findUnique=async()=>f.current;tx.staffOperatorControl={findUnique:async()=>({enabled:false})};
    f.ledger.transaction=async(work,options)=>{assert.deepEqual(options,{active:false});return work(f.context);};
    const result=await f.ledger.recordReceipt({attemptId:attempt.id,dispatchClaimId,receipt:{state:'UNKNOWN',attemptId:attempt.id,
        startedAt:now.toISOString(),receivedAt:now.toISOString(),httpStatus:null,failureCode:'ASTRA_OUTCOME_UNCONFIRMED'}});
    assert.equal(result.state,'UNKNOWN');assert.equal(stored.length,1);assert.equal(attempt.state,'UNKNOWN');
    assert.equal(f.current.controlRevision,5);assert.equal(f.current.stepBudget,1);assert.equal(f.current.reservedMicroUsd,55_000_000n);
});

test('historical runs keep continuous semantics and controls never mint authority, time or budget', () => {
    assert.deepEqual(operatorControl({}), { state: 'RUNNING', mode: 'CONTINUOUS', revision: 1, stepBudget: 0 });
    assertOperatorDispatch({}); assertOperatorApply({});
    const current = run(), snapshot = structuredClone(current);
    const next = planOperatorControl(current, [], 'PAUSE');
    assert.equal(next.runUpdate.controlState, 'PAUSED');
    assert.deepEqual(current, snapshot);
    for (const key of ['deadlineAt', 'policyCanonical', 'inputCanonical', 'reservedMicroUsd', 'revision', 'leaseFence'])
        assert.equal(Object.hasOwn(next.runUpdate, key), false);
});

test('pause retains dispatched/received/unknown work and cost holds; takeover cannot discard it', () => {
    for (const state of ['DISPATCHED', 'RECEIVED', 'UNKNOWN']) {
        const current = run(), attempts = [{ id: randomUUID(), state, reservedMicroUsd: 20_000_000n }];
        const snapshot = structuredClone(attempts), next = planOperatorControl(current, attempts, 'PAUSE');
        assert.equal(next.runUpdate.controlState, 'PAUSE_REQUESTED');
        assert.equal(Object.hasOwn(next.runUpdate, 'leaseOwner'), false);
        assert.deepEqual(next.cancelAttemptIds, []); assert.deepEqual(attempts, snapshot);
        assert.throws(() => planOperatorControl(current, attempts, 'TAKE_OVER'), /ASTRA_WORK_UNRESOLVED/);
        assertOperatorApply({ ...current, ...next.runUpdate });
        assert.throws(() => assertOperatorDispatch({ ...current, ...next.runUpdate }), /ASTRA_WORKFLOW_PAUSED/);
    }
    assert.throws(() => planOperatorControl({ ...run(), state: 'UNKNOWN' }, [], 'TAKE_OVER'), /ASTRA_WORK_UNRESOLVED/);
});

test('only never-dispatched reservations can be cancelled at an idle takeover boundary', () => {
    const current = run(), id = randomUUID(), attempts = [{ id, state: 'RESERVED', reservedMicroUsd: 20_000_000n }];
    const next = planOperatorControl(current, attempts, 'TAKE_OVER');
    assert.deepEqual(next.cancelAttemptIds, [id]);
    assert.equal(next.runUpdate.state, 'FAILED'); assert.equal(next.runUpdate.controlState, 'TAKEN_OVER');
    assert.equal(next.runUpdate.leaseOwner, null); assert.equal(next.takenOver, true);
    assert.equal(attempts[0].reservedMicroUsd, 20_000_000n);
    assert.throws(() => assertOperatorApply({ ...current, ...next.runUpdate }), /ASTRA_HUMAN_TAKEOVER/);
});

test('step grants one dispatch only and cannot be issued over pending or running work', () => {
    const current = { ...run(), controlState: 'PAUSED', executionMode: 'STEP' };
    const granted = { ...current, ...planOperatorControl(current, [], 'STEP').runUpdate };
    assertOperatorDispatch(granted); assert.equal(granted.stepBudget, 1);
    const consumed = { ...granted, stepBudget: 0 };
    assert.throws(() => assertOperatorDispatch(consumed), /ASTRA_WORKFLOW_PAUSED/);
    assertOperatorApply(consumed); assert(pauseAfterAppliedAction(consumed, 'RUNNING'));
    assert.equal(pauseAfterAppliedAction(consumed, 'READY_FOR_HUMAN'), false);
    for (const action of ['STEP', 'RESUME']) {
        assert.throws(() => planOperatorControl(current, [{ id: randomUUID(), state: 'RECEIVED' }], action), /ASTRA_CONTROL_NOT_SETTLED/);
        assert.throws(() => planOperatorControl(granted, [], action), /ASTRA_CONTROL_NOT_SETTLED/);
    }
});

test('safe controls use unresolved attempts instead of treating the paused run itself as pending', () => {
    const current = { ...run(), controlState: 'PAUSED' };
    const safe = projectOperatorControl(current, []);
    assert.equal(safe.pending, 0); assert(safe.canResume && safe.canStep && safe.canTakeOver);
    assert.equal(JSON.stringify(safe).includes('private continuation'), false);
    const held = projectOperatorControl(current, [{ state: 'UNKNOWN' }]);
    assert.equal(held.canResume || held.canStep || held.canTakeOver, false);
    const conflict = { ...current, state: 'UNKNOWN' }, conflicted = projectOperatorControl(conflict, []);
    assert.equal(conflicted.pending, 0); assert.equal(conflicted.canResume || conflicted.canStep || conflicted.canTakeOver, false);
    assert.throws(() => planOperatorControl(conflict, [], 'STEP'), /ASTRA_CONTROL_NOT_SETTLED/);
});

test('actual ledger dispatch consumes STEP after the admitted attempt transition in the same transaction', async () => {
    const current = { ...run(), executionMode: 'STEP', stepBudget: 1, specimenId: randomUUID(), pilotId: randomUUID() };
    const id = randomUUID(), events = [], attempt = { id, runId: current.id, state: 'RESERVED',
        runRevision: current.revision, leaseFence: current.leaseFence, requestCanonical: '{}', requestHash: digest('{}'),
        providerBindingHash: 'a'.repeat(64) };
    const astra = { version: 'atlas-astra-policy-v1', model: MODEL, returnedModel: MODEL, effort: 'max', serviceTier: 'default',
        maxOutputTokens: 128, requestTimeoutMs: 1000, pricingVersion: PRICING.version,
        inputNanoUsdPerToken: PRICING.inputNanoUsdPerToken, outputNanoUsdPerToken: PRICING.outputNanoUsdPerToken };
    const tx = {
        staffOperatorAttempt: { findUnique: async () => attempt, update: async ({ data }) => {
            assert.equal(current.stepBudget, 1); events.push('attempt-dispatched'); Object.assign(attempt, data); } },
        staffOperatorRun: { update: async ({ data }) => { events.push('permit-consumed'); Object.assign(current,
            { stepBudget: data.stepBudget, controlRevision: current.controlRevision + 1 }); } },
        $queryRaw: async () => [{ overrun: false, total: 25_000_000n, card: 25_000_000n }],
    };
    const ledger = new OperatorLedger({ client: null, config: {} });
    const context = { tx, run: current, policy: { astra, prompt: 'Synthetic policy.', tools: ['read_card_report'],
        expiresAt: new Date(Date.now() + 120_000).toISOString() }, budget: { version: 'atlas-grading-bridge-policy-v1',
        pilotId: current.pilotId, specimenIds: [current.specimenId, ...Array.from({ length: 9 }, randomUUID)],
        maxTotalMicroUsd: 90_000_000, maxCardMicroUsd: 30_000_000, reservationPerOperationMicroUsd: 1_000_000,
        maxOperationsPerCard: 20, maxWorkerCalls: 4, deadlineMs: 200_000,
        expiresAt: new Date(Date.now() + 120_000).toISOString() }, now: new Date() };
    ledger.transaction = async work => work(context); ledger.leased = async () => context;
    const grant = await ledger.takeDispatch({}, id);
    assert.deepEqual(events, ['attempt-dispatched', 'permit-consumed']); assert.equal(grant.attemptId, id);
    assert.equal(grant.promptHash, digest(instructionsFor(context.policy.prompt)));
    await assert.rejects(ledger.takeDispatch({}, id), /ASTRA_WORKFLOW_PAUSED/);
    assert.equal(events.length, 2);
});

test('actual ledger refuses stale or unresolved pause release without erasing requests', async () => {
    const current = { ...run(), runtimeHash: 'b'.repeat(64), controlState: 'PAUSED' };
    const lease = { runId: current.id, owner: current.leaseOwner, fence: current.leaseFence, revision: current.revision };
    let writes = 0, pending = [{ id: randomUUID(), state: 'UNKNOWN' }];
    const tx = { $queryRaw: async () => [current], staffOperatorAttempt: { findMany: async () => pending,
        update: async () => { writes++; } }, staffOperatorRun: { update: async () => { writes++; } } };
    const ledger = new OperatorLedger({ client: null, config: { configHash: current.runtimeHash },
        expectedClaim: { runId: current.id, controlRevision: current.controlRevision + 1 } });
    ledger.transaction = async work => work({ tx, now: new Date() });
    await assert.rejects(ledger.releasePause(lease), /ASTRA_WORK_UNRESOLVED/); assert.equal(writes, 0);
    pending = []; await assert.rejects(ledger.releasePause({ ...lease, fence: 2 }), /ASTRA_LEASE_STALE/);
    assert.equal(writes, 0); assert.deepEqual(await ledger.releasePause(lease), { state: 'PAUSED' }); assert.equal(writes, 1);
});
