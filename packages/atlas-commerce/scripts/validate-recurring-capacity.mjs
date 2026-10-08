/** Behavioral qualification inside the existing nonce-owned disposable PostgreSQL
 * harness only. Never accepts an external database URL or sends provider requests. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { capacityWeek, customerCapacity } from '../src/capacity.mjs';

export async function qualifyRecurringCapacity({fixture, Client, checks}) {
    assert(fixture.source.staffMigrations.some(row=>row.name==='20261008003000_atlas_recurring_shared_capacity'));
    const db=await fixture.database(),sql=(q,v=[])=>fixture.sql(q,v,db.name);
    const week=capacityWeek(new Date()),prior=capacityWeek(new Date(Date.parse(week.weekStartsAt)-1000));
    const quota=async stamp=>(await sql('SELECT atlas_customer.weekly_capacity_shared_quota($1::timestamptz) n',[stamp])).rows[0].n;
    const materialize=stamp=>sql('SELECT atlas_customer.weekly_capacity_materialize_shared_week($1::timestamptz)',[stamp]);
    const policies=async()=>(await sql('SELECT count(*)::integer n FROM atlas_customer."WeeklyCapacitySharedPolicy"')).rows[0].n;
    const snapshot=async()=>customerCapacity((await sql('SELECT atlas_customer.weekly_capacity_snapshot() v')).rows[0].v);
    assert.equal(await policies(),0,'Migration must not configure a quota');
    const priorPolicy=JSON.stringify((await sql('SELECT to_jsonb(t) v FROM atlas_customer."WeeklyCapacitySharedWeek" t WHERE "weekStartsAt"<>$1 ORDER BY "weekStartsAt"',[week.weekStartsAt])).rows);
    const historicalReservations=(await sql('SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY "paymentId"),\'[]\') v FROM atlas_customer."WeeklyCapacityReservation" r')).rows[0].v;
    // This separate disposable clone models a retained legacy hold with no
    // concrete shared week. Migration preservation was proved before cloning.
    // Only synthetic setup removes this fixture's week; normal writes retain guards.
    await sql('ALTER TABLE atlas_customer."WeeklyCapacitySharedWeek" DISABLE TRIGGER "WeeklyCapacitySharedWeek_immutable"');
    try{await sql('DELETE FROM atlas_customer."WeeklyCapacitySharedWeek" WHERE "weekStartsAt"=$1',[week.weekStartsAt]);}
    finally{await sql('ALTER TABLE atlas_customer."WeeklyCapacitySharedWeek" ENABLE TRIGGER "WeeklyCapacitySharedWeek_immutable"');}
    assert.equal((await snapshot()).total.state,'NOT_CONFIGURED');
    await materialize(week.weekStartsAt);assert.equal(await quota(week.weekStartsAt),null);
    assert.equal((await sql('SELECT count(*)::integer n FROM atlas_customer."WeeklyCapacitySharedWeek" WHERE "weekStartsAt"=$1',[week.weekStartsAt])).rows[0].n,0);
    const account=randomUUID();await sql('INSERT INTO atlas_customer."CustomerAccount"(id,"phoneHash",phone) VALUES($1,$2,$3)',[account,'d'.repeat(64),'+12025550988']);
    await sql('INSERT INTO atlas_customer."CustomerVerifiedEmail"("accountId",email) VALUES($1,$2)',[account,'recurring-capacity@example.invalid']);
    const prepare=async(channel,count)=>{const p={paymentId:randomUUID(),quoteId:randomUUID(),draftId:randomUUID()};await sql('INSERT INTO atlas_customer."CommerceQuote"(id,"accountId","draftId","draftRevision","contentHash",snapshot,"expiresAt") VALUES($1,$2,$3,1,$4,$5::jsonb,clock_timestamp()+interval \'15 minutes\')',[p.quoteId,account,p.draftId,'b'.repeat(64),JSON.stringify({channel,profile:{email:'recurring-capacity@example.invalid'},cards:Array.from({length:count},()=>({cardId:randomUUID()}))})]);return p;};
    const insert=(client,p)=>client.query('INSERT INTO atlas_customer."CommercePayment"(id,"accountId","draftId","quoteId","requestId",merchant,state) VALUES($1,$2,$3,$4,$5,\'{"provider":"SYNTHETIC_RECURRING_CAPACITY_ONLY"}\',\'DISPATCHED\')',[p.paymentId,account,p.draftId,p.quoteId,randomUUID()]);
    const cold=await prepare('MAIL_IN',1);await assert.rejects(insert({query:sql},cold),{code:'PWC01'});
    assert.equal((await sql('SELECT count(*)::int n FROM atlas_customer."CommercePayment" WHERE id=$1',[cold.paymentId])).rows[0].n,0);
    const policy=async(start,amount)=>sql('INSERT INTO atlas_customer."WeeklyCapacitySharedPolicy"("effectiveWeekStartsAt","quotaCards","authorizationReference") VALUES($1,$2,\'SYNTHETIC OWNER POLICY QUALIFICATION\')',[start,amount]);
    for(const stamp of [prior.weekStartsAt,new Date(Date.parse(week.weekStartsAt)+1).toISOString()])await assert.rejects(policy(stamp,1000),/INVALID_RECURRING_CAPACITY_START/);
    await policy(week.weekStartsAt,1000);
    const beforeRead=(await sql('SELECT count(*)::integer n FROM atlas_customer."WeeklyCapacitySharedWeek"')).rows[0].n;
    const available=await snapshot();assert.equal(available.total.quotaCards,1000);
    assert.equal((await sql('SELECT count(*)::integer n FROM atlas_customer."WeeklyCapacitySharedWeek"')).rows[0].n,beforeRead,'Snapshot must not materialize a week');
    assert.equal(available.total.heldCards+available.total.acceptedCards,historicalReservations.filter(r=>Date.parse(r.weekStartsAt)===Date.parse(week.weekStartsAt)&&r.state!=='RELEASED').reduce((n,r)=>n+r.cardCount,0));
    const repeated=[week.resetsAt,'2027-03-08T08:00:59.999Z','2027-03-08T08:01:00.000Z','2027-03-15T07:01:00.000Z','2027-11-01T07:01:00.000Z','2027-11-08T08:01:00.000Z','2038-01-04T08:01:00.000Z'];
    for(const stamp of repeated){const target=capacityWeek(new Date(stamp));const calendar=(await sql('SELECT * FROM atlas_customer.weekly_capacity_week($1::timestamptz)',[stamp])).rows[0];assert.equal(calendar.weekStartsAt.toISOString(),target.weekStartsAt);assert.equal(calendar.resetsAt.toISOString(),target.resetsAt);assert.equal(await quota(target.weekStartsAt),1000);}
    assert.equal(await policies(),1,'Indefinite recurrence must come from one policy, not a seeded horizon');
    // Thirty first-payment contenders cross both routes. The same unique shared
    // week and lock protect automatic first materialization and admission.
    const requests=await Promise.all(Array.from({length:30},(_,i)=>prepare(i%2?'KIOSK':'MAIL_IN',50)));
    const outcomes=await Promise.all(requests.map(async p=>{const c=new Client({connectionString:db.adminUrl,connectionTimeoutMillis:5000});await c.connect();try{await c.query('BEGIN');await insert(c,p);await c.query('SELECT pg_sleep(0.015)');await c.query('COMMIT');return{ok:true,p};}catch(e){await c.query('ROLLBACK');assert.equal(e.code,'PWC02');return{ok:false,p};}finally{await c.end();}}));
    const winners=outcomes.filter(o=>o.ok).map(o=>o.p),expected=Math.floor(available.total.remainingCards/50);assert.equal(winners.length,expected);assert(expected>1);
    let s=await snapshot();assert.equal(s.total.remainingCards,available.total.remainingCards-expected*50);assert.equal(s.total.quotaCards,1000);
    assert.equal((await sql('SELECT count(*)::int n FROM atlas_customer."WeeklyCapacitySharedWeek" WHERE "weekStartsAt"=$1',[week.weekStartsAt])).rows[0].n,1);
    assert.equal((await sql('SELECT count(*)::int n FROM atlas_customer."CommercePayment" WHERE id=ANY($1::uuid[])',[requests.map(p=>p.paymentId)])).rows[0].n,expected);
    assert.equal((await sql('SELECT count(*)::int n FROM atlas_customer."WeeklyCapacityReservation" WHERE "paymentId"=ANY($1::uuid[])',[requests.map(p=>p.paymentId)])).rows[0].n,expected);
    const stableCurrent=(await sql('SELECT to_jsonb(w) v FROM atlas_customer."WeeklyCapacitySharedWeek" w WHERE "weekStartsAt"=$1',[week.weekStartsAt])).rows[0].v;
    await materialize(week.weekStartsAt);assert.deepEqual((await sql('SELECT to_jsonb(w) v FROM atlas_customer."WeeklyCapacitySharedWeek" w WHERE "weekStartsAt"=$1',[week.weekStartsAt])).rows[0].v,stableCurrent);
    const fresh=await prepare('MAIL_IN',1),rr=new Client({connectionString:db.adminUrl});await rr.connect();try{await rr.query('BEGIN ISOLATION LEVEL REPEATABLE READ');await rr.query('SELECT atlas_customer.weekly_capacity_snapshot()');await assert.rejects(insert(rr,fresh),{code:'25000'});await rr.query('ROLLBACK');}finally{await rr.end();}
    const kept=winners[0];for(const state of ['UNKNOWN','AWAITING_PAYMENT','PROCESSING']){await sql('UPDATE atlas_customer."CommercePayment" SET state=$1 WHERE id=$2',[state,kept.paymentId]);assert.equal((await snapshot()).total.remainingCards,s.total.remainingCards);}
    for(let i=0;i<2;i++)await sql('UPDATE atlas_customer."CommercePayment" SET state=\'PAID\' WHERE id=$1',[kept.paymentId]);
    assert.equal((await snapshot()).total.acceptedCards,available.total.acceptedCards+50);
    for(let i=0;i<2;i++)await sql('UPDATE atlas_customer."CommercePayment" SET state=\'CANCELED\' WHERE id=$1',[winners[1].paymentId]);
    const remaining=s.total.remainingCards+50;assert.equal((await snapshot()).total.remainingCards,remaining);
    const refill=await prepare('KIOSK',remaining);await insert({query:sql},refill);assert.equal((await snapshot()).total.state,'FULL');
    for(const route of ['MAIL_IN','KIOSK'])await assert.rejects(insert({query:sql},await prepare(route,1)),{code:'PWC02'});
    assert.deepEqual((await sql('SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY "paymentId"),\'[]\') v FROM atlas_customer."WeeklyCapacityReservation" r WHERE "paymentId"=ANY($1::uuid[])',[historicalReservations.map(r=>r.paymentId)])).rows[0].v,historicalReservations);
    assert.equal(JSON.stringify((await sql('SELECT to_jsonb(t) v FROM atlas_customer."WeeklyCapacitySharedWeek" t WHERE "weekStartsAt"<>$1 ORDER BY "weekStartsAt"',[week.weekStartsAt])).rows),priorPolicy);
    const future=capacityWeek(new Date('2038-01-04T08:01:00.000Z'));await materialize(future.weekStartsAt);assert.equal(await quota(future.weekStartsAt),1000);
    const override=capacityWeek(new Date('2038-01-11T08:01:00.000Z'));await sql('INSERT INTO atlas_customer."WeeklyCapacitySharedWeek"("weekStartsAt","resetsAt","quotaCards") VALUES($1,$2,123)',[override.weekStartsAt,override.resetsAt]);assert.equal(await quota(override.weekStartsAt),123);await materialize(override.weekStartsAt);assert.equal(await quota(override.weekStartsAt),123);
    const disabled=capacityWeek(new Date('2038-01-18T08:01:00.000Z'));await policy(disabled.weekStartsAt,null);assert.equal(await quota(disabled.weekStartsAt),null);await materialize(disabled.weekStartsAt);assert.equal(await quota(disabled.resetsAt),null);assert.equal(await quota(week.weekStartsAt),1000);assert.equal(await quota(future.weekStartsAt),1000);
    for(const command of ['UPDATE atlas_customer."WeeklyCapacitySharedPolicy" SET "quotaCards"=2000','DELETE FROM atlas_customer."WeeklyCapacitySharedPolicy"','TRUNCATE atlas_customer."WeeklyCapacitySharedPolicy"'])await assert.rejects(sql(command));
    const customer=new Client({connectionString:db.customerUrl});await customer.connect();try{await assert.rejects(customer.query('SELECT * FROM atlas_customer."WeeklyCapacitySharedPolicy"'),{code:'42501'});await assert.rejects(customer.query('SELECT atlas_customer.weekly_capacity_shared_quota(now())'),{code:'42501'});await assert.rejects(customer.query('SELECT atlas_customer.weekly_capacity_materialize_shared_week(now())'),{code:'42501'});}finally{await customer.end();}
    checks.push('recurring shared capacity: missing policy stays cold; one configured1000 policy applies current and indefinite future weeks, exact Monday00:01 Los Angeles/DST; read-only fallback, first-payment atomic shared materialization and30 mixed-route contenders cannot overbook; concrete historical weeks/holds take precedence and remain unchanged; UNKNOWN holds, paid/canceled replay and nullable successor preserved; policy and helpers deny serving-role mutation');
}
