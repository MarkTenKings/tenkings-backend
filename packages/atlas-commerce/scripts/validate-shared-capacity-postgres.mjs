import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { capacityWeek, customerCapacity } from '../src/capacity.mjs';
// The only database source is the reviewed nonce-owned disposable harness.
// An external packet can supply source-root for imports; never accepts a DB URL.
const args=process.argv.slice(2), sourceFlag=args.indexOf('--source-root');
const sourceRoot=sourceFlag<0?fileURLToPath(new URL('../../../',import.meta.url)):resolve(args[sourceFlag+1]);
if(sourceFlag>=0)args.splice(sourceFlag,2);
const { disposablePostgres }=await import(pathToFileURL(join(sourceRoot,'frontend/atlas-app/scripts/disposable-postgres.mjs')));
const fixture=await disposablePostgres(args), { Client }=createRequire(import.meta.url)(args[args.indexOf('--pg-module')+1]),checks=[];
try {
 const db=await fixture.database(), sql=(q,v=[])=>fixture.sql(q,v,db.name);
 const registered=fixture.source.staffMigrations.some(r=>r.name==='20261001006000_atlas_shared_weekly_card_capacity');
 const account=randomUUID();await sql('INSERT INTO atlas_customer."CustomerAccount"(id,"phoneHash",phone) VALUES($1,$2,$3)',[account,'b'.repeat(64),'+12025550991']);
 const prepare=async(channel,count)=>{const p={paymentId:randomUUID(),quoteId:randomUUID(),draftId:randomUUID()};await sql('INSERT INTO atlas_customer."CommerceQuote"(id,"accountId","draftId","draftRevision","contentHash",snapshot,"expiresAt") VALUES($1,$2,$3,1,$4,$5::jsonb,clock_timestamp()+interval \'15 minutes\')',[p.quoteId,account,p.draftId,'b'.repeat(64),JSON.stringify({channel,cards:Array.from({length:count},()=>({cardId:randomUUID()}))})]);return p;};
 const insert=(client,p)=>client.query('INSERT INTO atlas_customer."CommercePayment"(id,"accountId","draftId","quoteId","requestId",merchant,state) VALUES($1,$2,$3,$4,$5,$6::jsonb,\'DISPATCHED\')',[p.paymentId,account,p.draftId,p.quoteId,randomUUID(),JSON.stringify({provider:'SYNTHETIC_SHARED_CAPACITY_ONLY'})]);
 // This pre-upgrade unresolved hold proves migration/history preservation.
 await sql('UPDATE atlas_customer."WeeklyCapacityConfig" SET "quotaCards"=1000');
 const legacy=await prepare('MAIL_IN',20);
 if(registered){
  // Seed explicit retained history inside the owned fixture; admissions below all use the live trigger.
  await sql('ALTER TABLE atlas_customer."CommercePayment" DISABLE TRIGGER "CommercePayment_weekly_capacity"');
  try{await insert({query:sql},legacy);}finally{await sql('ALTER TABLE atlas_customer."CommercePayment" ENABLE TRIGGER "CommercePayment_weekly_capacity"');}
  const retainedWeek=capacityWeek(new Date());
  await sql('INSERT INTO atlas_customer."WeeklyCapacityWeek"(channel,"weekStartsAt","resetsAt","quotaCards") VALUES(\'MAIL_IN\',$1,$2,1000)',[retainedWeek.weekStartsAt,retainedWeek.resetsAt]);
  await sql('INSERT INTO atlas_customer."WeeklyCapacityReservation"("paymentId",channel,"weekStartsAt","cardCount") VALUES($1,\'MAIL_IN\',$2,20)',[legacy.paymentId,retainedWeek.weekStartsAt]);
 }else await insert({query:sql},legacy);
 const before=(await sql('SELECT to_jsonb(r) AS value FROM atlas_customer."WeeklyCapacityReservation" r WHERE "paymentId"=$1',[legacy.paymentId])).rows[0].value;
 // Synthetic prior-week evidence is seeded only inside this owned fixture.
 const prior=capacityWeek(new Date(Date.parse(capacityWeek(new Date()).weekStartsAt)-1000));
 const historical=[await prepare('MAIL_IN',7),await prepare('KIOSK',9)];
 await sql('ALTER TABLE atlas_customer."CommercePayment" DISABLE TRIGGER "CommercePayment_weekly_capacity"');
 try{for(const p of historical)await insert({query:sql},p);}finally{await sql('ALTER TABLE atlas_customer."CommercePayment" ENABLE TRIGGER "CommercePayment_weekly_capacity"');}
 for(const [i,p]of historical.entries()){
  const channel=i?'DEALER_DROP_OFF':'MAIL_IN';
  await sql('INSERT INTO atlas_customer."WeeklyCapacityWeek"(channel,"weekStartsAt","resetsAt","quotaCards") VALUES($1,$2,$3,1000)',[channel,prior.weekStartsAt,prior.resetsAt]);
  await sql('INSERT INTO atlas_customer."WeeklyCapacityReservation"("paymentId",channel,"weekStartsAt","cardCount") VALUES($1,$2,$3,$4)',[p.paymentId,channel,prior.weekStartsAt,i?9:7]);
 }
 // Exact restricted private-role grant surface, granted BEFORE migration.
 await sql('CREATE ROLE atlas_shared_fixture_private NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS');
 await sql('GRANT USAGE ON SCHEMA atlas_customer TO atlas_shared_fixture_private; GRANT EXECUTE ON FUNCTION atlas_customer.customer_private_call(text,jsonb,jsonb) TO atlas_shared_fixture_private');
 if(registered)assert(readFileSync(join(sourceRoot,'frontend/atlas-app/prisma/migrations/20261001006000_atlas_shared_weekly_card_capacity/migration.sql')).equals(readFileSync(new URL('../sql/shared-weekly-capacity-proposal.sql',import.meta.url))));
 else await sql(readFileSync(new URL('../sql/shared-weekly-capacity-proposal.sql',import.meta.url),'utf8'));
 assert.deepEqual((await sql('SELECT to_jsonb(r) AS value FROM atlas_customer."WeeklyCapacityReservation" r WHERE "paymentId"=$1',[legacy.paymentId])).rows[0].value,before);
 const snapshot=async()=>customerCapacity((await sql('SELECT atlas_customer.weekly_capacity_snapshot() AS value')).rows[0].value);
 assert.equal((await snapshot()).total.state,'NOT_CONFIGURED');
 const cold=await prepare('KIOSK',1);await assert.rejects(insert({query:sql},cold),{code:'PWC01'});
 assert.equal((await sql('SELECT count(*)::int n FROM atlas_customer."CommercePayment" WHERE id=$1',[cold.paymentId])).rows[0].n,0);
 checks.push((registered?'registered shared schema retains seeded prior20-card hold':'raw upgrade preserves prior20-card hold')+'; unset shared quota fails closed even with legacy route1000 settings; refused payment rolls back');
 const week=capacityWeek(new Date());
 await assert.rejects(sql('INSERT INTO atlas_customer."WeeklyCapacitySharedWeek"("weekStartsAt","resetsAt","quotaCards") VALUES($1,$2,19)',[week.weekStartsAt,week.resetsAt]));
 await sql('INSERT INTO atlas_customer."WeeklyCapacitySharedWeek"("weekStartsAt","resetsAt","quotaCards") VALUES($1,$2,1000)',[week.weekStartsAt,week.resetsAt]);
 assert.equal((await snapshot()).total.remainingCards,980);
 checks.push('explicit1000 total includes preexisting20-card hold and leaves980; allowance below existing holds rejected');
 const requests=await Promise.all(Array.from({length:30},(_,i)=>prepare(i%2?'KIOSK':'MAIL_IN',50)));
 const outcomes=await Promise.all(requests.map(async p=>{const c=new Client({connectionString:db.adminUrl,connectionTimeoutMillis:5000});await c.connect();try{await c.query('BEGIN');await insert(c,p);await c.query('SELECT pg_sleep(0.015)');await c.query('COMMIT');return{ok:true,p};}catch(e){await c.query('ROLLBACK');assert.equal(e.code,'PWC02');return{ok:false,p};}finally{await c.end();}}));
 const winners=outcomes.filter(r=>r.ok).map(r=>r.p);
 assert.equal(winners.length,19);assert.equal((await snapshot()).total.heldCards,970);assert.equal((await snapshot()).total.remainingCards,30);
 assert.equal((await sql('SELECT count(*)::int n FROM atlas_customer."CommercePayment" WHERE id=ANY($1::uuid[])',[requests.map(p=>p.paymentId)])).rows[0].n,19);
 assert.equal((await sql('SELECT count(*)::int n FROM atlas_customer."WeeklyCapacityReservation" WHERE "paymentId"=ANY($1::uuid[])',[requests.map(p=>p.paymentId)])).rows[0].n,19);
 checks.push('30 simultaneous mixed-route50-card transactions share one1000 allowance; exactly19 win after20 held; every losing payment/reservation rolls back');
 // Establish an old snapshot before another route commits a real hold.
 const stale=await prepare('KIOSK',20), fresh=await prepare('MAIL_IN',20);
 const repeatable=new Client({connectionString:db.adminUrl});await repeatable.connect();
 try{await repeatable.query('BEGIN ISOLATION LEVEL REPEATABLE READ');await repeatable.query('SELECT atlas_customer.weekly_capacity_snapshot()');
  await insert({query:sql},fresh);await assert.rejects(insert(repeatable,stale),{code:'25000'});await repeatable.query('ROLLBACK');
 }finally{await repeatable.end();}
 assert.equal((await snapshot()).total.remainingCards,10);
 assert.equal((await sql('SELECT count(*)::int n FROM atlas_customer."CommercePayment" WHERE id=$1',[stale.paymentId])).rows[0].n,0);
 await sql('UPDATE atlas_customer."CommercePayment" SET state=\'CANCELED\' WHERE id=$1',[fresh.paymentId]);
 assert.equal((await snapshot()).total.remainingCards,30);
 checks.push('a REPEATABLE READ transaction with a stale snapshot is refused before admission; fresh other-route hold remains exact; no stale payment orphan');
 const original=winners[0];for(const state of ['UNKNOWN','AWAITING_PAYMENT','PROCESSING']){await sql('UPDATE atlas_customer."CommercePayment" SET state=$1 WHERE id=$2',[state,original.paymentId]);assert.equal((await snapshot()).total.heldCards,970);}
 const c=new Client({connectionString:db.adminUrl});await c.connect();try{await c.query('BEGIN');await c.query('UPDATE atlas_customer."CommercePayment" SET state=\'PAID\' WHERE id=$1',[original.paymentId]);await c.query('ROLLBACK');}finally{await c.end();}
 assert.equal((await snapshot()).total.heldCards,970);assert.equal((await snapshot()).total.acceptedCards,0);
 for(let i=0;i<2;i++)await sql('UPDATE atlas_customer."CommercePayment" SET state=\'PAID\' WHERE id=$1',[original.paymentId]);
 assert.equal((await snapshot()).total.heldCards,920);assert.equal((await snapshot()).total.acceptedCards,50);assert.equal((await snapshot()).total.remainingCards,30);
 checks.push('unknown/awaiting/processing retain holds; failed paid transaction rolls back capacity; paid replay consumes once');
 for(let i=0;i<2;i++)await sql('UPDATE atlas_customer."CommercePayment" SET state=\'CANCELED\' WHERE id=$1',[winners[1].paymentId]);
 assert.equal((await snapshot()).total.remainingCards,80);
 const reuse=await prepare('DEALER_DROP_OFF',80);await insert({query:sql},reuse);assert.equal((await snapshot()).total.remainingCards,0);assert.equal((await snapshot()).total.state,'FULL');
 for(const route of ['MAIL_IN','KIOSK']){const overflow=await prepare(route,1);await assert.rejects(insert({query:sql},overflow),{code:'PWC02'});}
 await assert.rejects(sql('UPDATE atlas_customer."WeeklyCapacityReservation" SET state=\'HELD\' WHERE "paymentId"=$1',[winners[1].paymentId]));
 checks.push('cancelled50-card hold releases once for either route; exact80 refill reachesFULL; neither route can oversell; released evidence cannot reopen');
 const newPayment=await prepare('MAIL_IN',1), rollback=new Client({connectionString:db.adminUrl});await rollback.connect();try{await rollback.query('BEGIN');await rollback.query('UPDATE atlas_customer."CommercePayment" SET state=\'CANCELED\' WHERE id=$1',[reuse.paymentId]);await insert(rollback,newPayment);await rollback.query('ROLLBACK');}finally{await rollback.end();}
 assert.equal((await snapshot()).total.remainingCards,0);assert.equal((await sql('SELECT count(*)::int n FROM atlas_customer."CommercePayment" WHERE id=$1',[newPayment.paymentId])).rows[0].n,0);
 checks.push('outer transaction rollback restores released capacity and removes newly inserted payment/hold together');
 await assert.rejects(sql('UPDATE atlas_customer."WeeklyCapacitySharedWeek" SET "quotaCards"=2000 WHERE "weekStartsAt"=$1',[week.weekStartsAt]));
 await assert.rejects(sql('DELETE FROM atlas_customer."WeeklyCapacitySharedWeek" WHERE "weekStartsAt"=$1',[week.weekStartsAt]));
 await assert.rejects(sql('TRUNCATE atlas_customer."WeeklyCapacitySharedWeek"'));
 const next=capacityWeek(new Date(Date.parse(week.resetsAt)+1000));assert.equal((await sql('SELECT count(*)::int n FROM atlas_customer."WeeklyCapacitySharedWeek" WHERE "weekStartsAt"=$1',[next.weekStartsAt])).rows[0].n,0);
 await sql('UPDATE atlas_customer."WeeklyCapacityConfig" SET "quotaCards"=999999');assert.equal((await snapshot()).total.quotaCards,1000);
 const customer=new Client({connectionString:db.customerUrl});await customer.connect();try{await assert.rejects(customer.query('SELECT * FROM atlas_customer."WeeklyCapacitySharedWeek"'),{code:'42501'});}finally{await customer.end();}
 checks.push('one-week quota immutable/non-recurring; old route config cannot expand it; customer cannot read new private table');
 await sql('UPDATE atlas_customer."CommercePayment" SET state=\'PAID\' WHERE id=$1',[historical[0].paymentId]);
 await sql('UPDATE atlas_customer."CommercePayment" SET state=\'CANCELED\' WHERE id=$1',[historical[1].paymentId]);
 assert.deepEqual((await sql('SELECT state FROM atlas_customer."WeeklyCapacityReservation" WHERE "paymentId"=ANY($1::uuid[]) ORDER BY "cardCount"',[historical.map(p=>p.paymentId)])).rows.map(r=>r.state),['CONSUMED','RELEASED']);
 assert.equal((await snapshot()).total.remainingCards,0);
 assert.equal((await sql('SELECT count(*)::int n FROM atlas_customer."WeeklyCapacitySharedWeek" WHERE "weekStartsAt"=$1',[prior.weekStartsAt])).rows[0].n,0);
 checks.push('prior-week held payments resolve paid/canceled without a shared row; resolution does not consume/release current week capacity');
 const binding={mode:'LOCAL_FIXTURE',origin:'http://127.0.0.1:4318',deploymentId:'local-postgres-fixture',releaseSha:'0'.repeat(40),configHash:'a'.repeat(64)};
 await sql('INSERT INTO atlas_customer."CustomerControl"(enabled,mode,origin,"deploymentId","releaseSha","configHash") VALUES(true,$1,$2,$3,$4,$5)',[binding.mode,binding.origin,binding.deploymentId,binding.releaseSha,binding.configHash]);
 await sql('INSERT INTO atlas_customer."CustomerServiceControl"(enabled,binding,"identificationEnabled") VALUES(true,$1::jsonb,false)',[JSON.stringify(binding)]);
 const gateway=new Client({connectionString:db.adminUrl});await gateway.connect();try{
  await gateway.query('BEGIN');await gateway.query('SET LOCAL ROLE atlas_shared_fixture_private');
  const value=(await gateway.query('SELECT atlas_customer.customer_private_call(\'capacity\',$1::jsonb,\'{"input":{}}\'::jsonb) AS value',[JSON.stringify(binding)])).rows[0].value;
  assert.equal(customerCapacity(value).total.remainingCards,0);
  await assert.rejects(gateway.query('SELECT * FROM atlas_customer."WeeklyCapacitySharedWeek"'),{code:'42501'});
  await gateway.query('ROLLBACK');
 }finally{await gateway.end();}
 checks.push('restricted private gateway grant reads v2 through SECURITY DEFINER; direct new table read remains denied');
 const resultFile=join(fixture.directory,'shared-weekly-capacity-result.json');writeFileSync(resultFile,JSON.stringify({mode:registered?'REGISTERED_SHARED_SCHEMA':'RAW_SHARED_UPGRADE',checks,providerCalls:0,productionEffects:false,snapshot:await snapshot()},null,2));console.log(JSON.stringify({checks:checks.length,resultFile,providerCalls:0,productionEffects:false}));
}finally{await fixture.stop();}
