import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { disposablePostgres } from '../../../frontend/atlas-app/scripts/disposable-postgres.mjs';
import { capacityWeek, customerCapacity } from '../src/capacity.mjs';

// No external database URL accepted. Existing owned native harness applies the
// COMPLETE migration chain twice and creates only its nonce-owned local cluster.
const sharedRegistered=existsSync(new URL('../../../frontend/atlas-app/prisma/migrations/20261001006000_atlas_shared_weekly_card_capacity/migration.sql',import.meta.url));
if(sharedRegistered){
    // The normal command validates the current shared contract. The historical
    // independent-pool rehearsal below executes only against pre-shared source.
    await import('./validate-shared-capacity-postgres.mjs');
}else{
const args=process.argv.slice(2), fixture=await disposablePostgres(args);
const { Client }=createRequire(import.meta.url)(args[args.indexOf('--pg-module')+1]);
const checks=[];
try {
    const db=await fixture.database(), sql=(q,v=[])=>fixture.sql(q,v,db.name);
    const aid=randomUUID();
    await sql('INSERT INTO atlas_customer."CustomerAccount"(id,"phoneHash",phone) VALUES($1,$2,$3)',[aid,'a'.repeat(64),'+12025550199']);
    const prepare = async(channel,count) => {
        const quoteId=randomUUID(),draftId=randomUUID(),paymentId=randomUUID();
        const snapshot={channel,cards:Array.from({length:count},()=>({cardId:randomUUID()}))};
        await sql('INSERT INTO atlas_customer."CommerceQuote"(id,"accountId","draftId","draftRevision","contentHash",snapshot,"expiresAt") VALUES($1,$2,$3,1,$4,$5::jsonb,clock_timestamp()+interval \'15 minutes\')',
            [quoteId,aid,draftId,'a'.repeat(64),JSON.stringify(snapshot)]);
        return {paymentId,quoteId,draftId};
    };
    const insert = (client,p) => client.query('INSERT INTO atlas_customer."CommercePayment"(id,"accountId","draftId","quoteId","requestId",merchant,state) VALUES($1,$2,$3,$4,$5,$6::jsonb,\'DISPATCHED\')',
        [p.paymentId,aid,p.draftId,p.quoteId,randomUUID(),JSON.stringify({provider:'SYNTHETIC_CAPACITY_FIXTURE'})]);
    const registered=fixture.source.staffMigrations.some(row=>row.name==='20261001001000_atlas_weekly_card_capacity');
    // Construct an explicitly historical pre-capacity payment in this owned
    // synthetic fixture. At registered head, the owner temporarily disables
    // only this new allocation trigger while constructing that legacy row;
    // every actual admission/concurrency test below uses the enabled trigger.
    const legacy=await prepare('MAIL_IN',1);
    if(registered) {
        assert(readFileSync(new URL('../../../frontend/atlas-app/prisma/migrations/20261001001000_atlas_weekly_card_capacity/migration.sql',import.meta.url)).equals(readFileSync(new URL('../sql/weekly-capacity-proposal.sql',import.meta.url))));
        await sql('ALTER TABLE atlas_customer."CommercePayment" DISABLE TRIGGER "CommercePayment_weekly_capacity"');
        try {await insert({query:sql},legacy);} finally {await sql('ALTER TABLE atlas_customer."CommercePayment" ENABLE TRIGGER "CommercePayment_weekly_capacity"');}
    } else {
        await insert({query:sql},legacy);
        await sql(readFileSync(new URL('../sql/weekly-capacity-proposal.sql',import.meta.url),'utf8'));
    }
    assert.equal((await sql('SELECT count(*)::integer n FROM atlas_customer."WeeklyCapacityReservation" WHERE "paymentId"=$1',[legacy.paymentId])).rows[0].n,0);
    const snapshot=async()=>customerCapacity((await sql('SELECT atlas_customer.weekly_capacity_snapshot() AS value')).rows[0].value);
    const binding={mode:'LOCAL_FIXTURE',origin:'http://127.0.0.1:4318',deploymentId:'capacity-fixture',releaseSha:'1'.repeat(40),configHash:'b'.repeat(64)};
    const privateRead=async(b=binding,input={input:{}})=>(await sql('SELECT atlas_customer.customer_private_call(\'capacity\',$1::jsonb,$2::jsonb) AS result',[JSON.stringify(b),JSON.stringify(input)])).rows[0].result;
    assert.equal((await privateRead()).error.code,'CUSTOMER_SERVICE_NOT_ENABLED');
    await sql('INSERT INTO atlas_customer."CustomerControl"(enabled,mode,origin,"deploymentId","releaseSha","configHash") VALUES(true,$1,$2,$3,$4,$5)',Object.values(binding));
    await sql('INSERT INTO atlas_customer."CustomerServiceControl"(enabled,binding) VALUES(true,$1::jsonb)',[JSON.stringify(binding)]);
    assert.equal(customerCapacity(await privateRead()).pools[0].state,'NOT_CONFIGURED');
    assert.equal((await privateRead({...binding,releaseSha:'2'.repeat(40)})).error.code,'CUSTOMER_SERVICE_NOT_ENABLED');
    assert.equal((await privateRead(binding,{input:{quotaCards:999}})).error.code,'INVALID_REQUEST');
    checks.push('narrow service capacity read requires exact enabled release binding and empty input');
    assert((await snapshot()).pools.every(p=>p.state==='NOT_CONFIGURED'&&p.quotaCards===null));
    const cold=await prepare('MAIL_IN',1);
    await assert.rejects(insert({query:sql},cold),{code:'PWC01'});
    assert.equal((await sql('SELECT count(*)::integer n FROM atlas_customer."CommercePayment" WHERE id=$1',[cold.paymentId])).rows[0].n,0);
    checks.push('NULL quotas refuse atomically; no guessed 500/1000 quota and no orphan payment');
    for(const value of ['2026-10-05T07:00:59.999Z','2026-10-05T07:01:00.000Z','2026-03-06T20:00:00.000Z','2026-10-30T20:00:00.000Z']) {
        const w=(await sql('SELECT * FROM atlas_customer.weekly_capacity_week($1::timestamptz)',[value])).rows[0];
        assert.deepEqual({weekStartsAt:w.weekStartsAt.toISOString(),resetsAt:w.resetsAt.toISOString()},capacityWeek(new Date(value)));
    }
    checks.push('SQL/JS Monday 00:01 parity including 167/169-hour DST weeks');
    await sql('UPDATE atlas_customer."WeeklyCapacityConfig" SET "quotaCards"=CASE channel WHEN \'MAIL_IN\' THEN 20 ELSE 7 END');
    const requests=await Promise.all(Array.from({length:30},()=>prepare('MAIL_IN',3)));
    const result=await Promise.all(requests.map(async p=>{
        const client=new Client({connectionString:db.adminUrl,connectionTimeoutMillis:5000});await client.connect();
        try {await client.query('BEGIN');await insert(client,p);await client.query('SELECT pg_sleep(0.015)');await client.query('COMMIT');return {ok:true,p};}
        catch(error){await client.query('ROLLBACK');assert.equal(error.code,'PWC02');return {ok:false,p};}
        finally{await client.end();}
    }));
    const winners=result.filter(r=>r.ok).map(r=>r.p);
    assert.equal(winners.length,6);
    let pool=(await snapshot()).pools[0];assert.equal(pool.heldCards,18);assert.equal(pool.remainingCards,2);assert.equal(pool.acceptedCards,0);
    assert.equal((await sql('SELECT count(*)::integer n FROM atlas_customer."CommercePayment" WHERE id=ANY($1::uuid[])',[requests.map(p=>p.paymentId)])).rows[0].n,6);
    checks.push('30 real concurrent transactions against 20-card pool admit exactly six 3-card batches; losing payments rolled back');
    const shop=await prepare('KIOSK',7);await insert({query:sql},shop);
    assert.equal((await snapshot()).pools[1].heldCards,7);
    const shopOverflow=await prepare('DEALER_DROP_OFF',1);await assert.rejects(insert({query:sql},shopOverflow),{code:'PWC02'});
    assert.equal((await snapshot()).pools[0].remainingCards,2);
    checks.push('independent card-shop pool maps legacy KIOSK; same customer may submit multiple batches');
    const unknown=winners[0];
    await sql('UPDATE atlas_customer."CommercePayment" SET state=\'UNKNOWN\' WHERE id=$1',[unknown.paymentId]);
    assert.equal((await snapshot()).pools[0].heldCards,18);
    await sql('UPDATE atlas_customer."CommercePayment" SET state=\'AWAITING_PAYMENT\' WHERE id=$1',[unknown.paymentId]);
    assert.equal((await snapshot()).pools[0].heldCards,18);
    await sql('UPDATE atlas_customer."CommercePayment" SET state=\'PROCESSING\' WHERE id=$1',[unknown.paymentId]);
    assert.equal((await snapshot()).pools[0].heldCards,18);
    // Simulate a failed order transaction after payment success: capacity must
    // roll back with the same payment/order transaction.
    const client=new Client({connectionString:db.adminUrl});await client.connect();
    try {await client.query('BEGIN');await client.query('UPDATE atlas_customer."CommercePayment" SET state=\'PAID\' WHERE id=$1',[unknown.paymentId]);await client.query('ROLLBACK');}
    finally{await client.end();}
    assert.equal((await snapshot()).pools[0].heldCards,18);assert.equal((await snapshot()).pools[0].acceptedCards,0);
    await sql('UPDATE atlas_customer."CommercePayment" SET state=\'PAID\' WHERE id=$1',[unknown.paymentId]);
    await sql('UPDATE atlas_customer."CommercePayment" SET state=\'PAID\' WHERE id=$1',[unknown.paymentId]);
    pool=(await snapshot()).pools[0];assert.equal(pool.heldCards,15);assert.equal(pool.acceptedCards,3);assert.equal(pool.remainingCards,2);
    await assert.rejects(insert({query:sql},unknown),{code:'23505'});
    checks.push('UNKNOWN/awaiting/processing keep hold; rollback retains hold; paid replay consumes exactly once');
    await sql('UPDATE atlas_customer."CommercePayment" SET state=\'CANCELED\' WHERE id=$1',[winners[1].paymentId]);
    assert.equal((await snapshot()).pools[0].remainingCards,5);
    const canceledReplay=(await sql('SELECT state FROM atlas_customer."WeeklyCapacityReservation" WHERE "paymentId"=$1',[winners[1].paymentId])).rows[0];
    assert.equal(canceledReplay.state,'RELEASED');
    await assert.rejects(sql('UPDATE atlas_customer."WeeklyCapacityReservation" SET state=\'HELD\' WHERE "paymentId"=$1',[winners[1].paymentId]));
    checks.push('terminal cancellation releases exact card count; released/consumed reservations cannot reopen');
    // A next-week configuration change cannot expand this frozen week.
    await sql('UPDATE atlas_customer."WeeklyCapacityConfig" SET "quotaCards"=100 WHERE channel=\'MAIL_IN\'');
    assert.equal((await snapshot()).pools[0].quotaCards,20);
    const old=capacityWeek(new Date(Date.now()-8*86400000));
    await sql('INSERT INTO atlas_customer."WeeklyCapacityWeek"(channel,"weekStartsAt","resetsAt","quotaCards") VALUES(\'MAIL_IN\',$1,$2,1)',[old.weekStartsAt,old.resetsAt]);
    await sql('INSERT INTO atlas_customer."WeeklyCapacityReservation"("paymentId",channel,"weekStartsAt","cardCount",state) VALUES($1,\'MAIL_IN\',$2,1,\'HELD\')',[legacy.paymentId,old.weekStartsAt]);
    assert.equal((await snapshot()).pools[0].remainingCards,5);
    assert.equal((await sql('SELECT state FROM atlas_customer."WeeklyCapacityReservation" WHERE "paymentId"=$1',[legacy.paymentId])).rows[0].state,'HELD');
    checks.push('weekly snapshot/reset retains historical unresolved backlog; frozen current quota is unchanged');
    for(const target of ['WeeklyCapacityConfig','WeeklyCapacityWeek','WeeklyCapacityReservation']) {
        const c=new Client({connectionString:db.customerUrl});await c.connect();
        try{await assert.rejects(c.query(`SELECT * FROM atlas_customer."${target}"`),{code:'42501'});}finally{await c.end();}
    }
    checks.push('customer cannot read or alter private capacity tables');
    const resultFile=join(fixture.directory,'weekly-capacity-result.json');
    writeFileSync(resultFile,JSON.stringify({checks,providerCalls:0,productionEffects:false,snapshot:await snapshot()},null,2));
    process.stdout.write(JSON.stringify({checks:checks.length,resultFile,providerCalls:0,productionEffects:false})+'\n');
} finally {await fixture.stop();}

}
