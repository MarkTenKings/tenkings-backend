import test from 'node:test';
import assert from 'node:assert/strict';
import {openLocalStore} from '../src/store.mjs';
import {recordOperationalAlert, reviewOperationalAlert, createFinanceAlertOutbox} from '../src/finance-alerts.mjs';
import {projectMarketplaceWorkspace} from '../src/projections.mjs';
import {hash} from '../src/contract.mjs';

function fixture(t) {
  let now=1000;
  const store=openLocalStore({filename:':memory:',environment:'SYNTHETIC_LOCAL',clock:()=>now});t.after(()=>store.close());
  const scope=hash({environment:'SYNTHETIC_LOCAL',platformAccountId:'demo_platform'});
  const add=(evidence='one')=>store.transaction(tx=>recordOperationalAlert(tx,{scope,topic:'original',code:'UNKNOWN_RESULT',reference:'original_intent',evidenceHash:hash(evidence)}));
  const review=(row,action,requestId=action)=>store.transaction(tx=>reviewOperationalAlert(tx,{actor:{id:'demo_staff',role:'STAFF'},requestId,alertId:row.alertId,expectedVersion:row.version,action,reviewRef:'demo_review',evidenceHash:row.latestEvidenceHash}));
  return {store,scope,add,review,tick:()=>now++};
}
test('incident review is compare-and-swap, idempotent and isolated from financial outcomes',t=>{
  const f=fixture(t),row=f.add(),before=f.store.read();
  const ack=f.review(row,'ACKNOWLEDGE');assert.equal(ack.status,'ACKNOWLEDGED');
  assert.deepEqual(f.review(row,'ACKNOWLEDGE'),ack);
  assert.throws(()=>f.review({...row,version:ack.version},'RESOLVE','ACKNOWLEDGE'),{code:'IDEMPOTENCY_CONFLICT'});
  f.add('changed');
  assert.throws(()=>f.review({...row,version:ack.version},'RESOLVE'),{code:'FINANCE_INCIDENT_CHANGED'});
  const current=f.store.read(s=>s.financeOperationalAlerts[row.alertId]);f.review(current,'RESOLVE');
  const after=f.store.read();
  for(const key of ['journals','intents','orders','fulfillment'])assert.deepEqual(after[key],before[key]);
  assert.equal(after.financeAlertOutbox[row.alertId].dispatchCount,0);
  assert.equal(after.financeOperationalAlerts[row.alertId].history.length,2);
  assert.throws(()=>f.store.transaction(tx=>reviewOperationalAlert(tx,{actor:{id:'demo_buyer',role:'BUYER'}})),{code:'FORBIDDEN'});
});
test('recurrence sends a new immutable envelope while prior uncertain delivery stays lookup-only',async t=>{
  const f=fixture(t),first=f.add(),sends=[],lookups=[];
  const sender={assertReady:()=>true,async send(input){sends.push(input);return {status:'UNKNOWN'};},async lookup(input){lookups.push(input);return {status:'NOT_FOUND'};}};
  const outbox=createFinanceAlertOutbox({enabled:true,store:f.store,scope:f.scope,config:{approvalRef:'demo_approval',destinationRef:'demo_sink',maxItems:10,leaseMs:1000},assertRuntimeReady:()=>true,sender});
  await outbox.flush();f.review(first,'RESOLVE');f.tick();const second=f.add('new');
  assert.equal(second.generation,2);assert.notEqual(second.deliveryKey,first.deliveryKey);
  await outbox.flush();await outbox.flush();
  assert.deepEqual(sends.map(x=>x.idempotencyKey),[first.deliveryKey,second.deliveryKey]);
  assert.equal(sends[0].alert.evidenceHash,hash('one'));assert.equal(sends[1].alert.evidenceHash,hash('new'));
  assert.ok(lookups.some(x=>x.idempotencyKey===first.deliveryKey));
  assert.equal(f.store.read(s=>s.financeAlertOutbox[first.deliveryKey].dispatchCount),1);
  const third=f.add('still_active');assert.equal(third.generation,2);assert.equal(Object.keys(f.store.read().financeAlertOutbox).length,2);
});
test('operational projection is bounded staff-only, redacted, and does not claim liveness',t=>{
  const f=fixture(t),row=f.add();
  f.store.transaction(tx=>{tx.state.financeHostedRuns={x:{scope:f.scope,runId:'run',status:'COMPLETED',completedAt:1000,secret:'not_projected'}};});
  const options={environment:'SYNTHETIC_LOCAL',platformAccountId:'demo_platform',now:1000};
  for(const role of ['SELLER','BUYER'])assert.equal(projectMarketplaceWorkspace(f.store.read(),{id:'demo_actor',role},options).operations,undefined);
  const ops=projectMarketplaceWorkspace(f.store.read(),{id:'demo_staff',role:'STAFF'},options).operations;
  assert.equal(ops.incidents[0].alertId,row.alertId);assert.equal(ops.incidentCounts.open,1);
  assert.equal(ops.recovery.liveness,'EXTERNAL_MONITOR_REQUIRED');assert.equal(JSON.stringify(ops).includes('not_projected'),false);
});
