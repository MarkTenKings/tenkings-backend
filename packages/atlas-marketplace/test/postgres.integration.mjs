// Explicit owned QA cluster only; excluded from the default unit suite.
import assert from 'node:assert/strict';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createPostgresStore, emptyMarketplaceState, POSTGRES_STORE_FORMAT } from '../src/store-postgres.mjs';
import { canonicalJSON, hash } from '../src/contract.mjs';
import { openLocalStore } from '../src/store.mjs';
import { createMarketplacePilot, intentId } from '../src/service.mjs';
import { actors, createLocalFixture, syntheticFulfillmentEvidence } from '../scripts/local-fixture.mjs';
import { reconcileFinanceIntent } from '../src/payment.mjs';
import { assertJournal } from '../src/ledger.mjs';

const [pgPath,socket,receiptPath,phase='create']=process.argv.slice(2);
assert.ok(pgPath?.endsWith('/deps/node_modules/pg/lib/index.js'));
assert.match(socket??'',/^\/private\/tmp\/atlas-r2-qa-[a-zA-Z0-9_-]+$/);
assert.equal((await stat(socket)).mode&0o777,0o700);
assert.ok(receiptPath?.includes('/atlas-r2-parallel-lead-20261022/continuation/'));
const {default:{Pool}}=await import(pathToFileURL(pgPath));
const connection={host:socket,port:65432,user:'atlas_r2_qa_owner',database:'postgres',max:5};
const admin=new Pool(connection);
const pools=[];
let local;
try {
  if(phase==='create') {
    await admin.query('CREATE DATABASE atlas_r2_qa');
    for(const role of ['atlas_r2_writer','atlas_r2_reader']) await admin.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
  } else assert.ok(['verify','continue','drift'].includes(phase));
  const owner=new Pool({...connection,database:'atlas_r2_qa'}); pools.push(owner);
  const writer=new Pool({...connection,database:'atlas_r2_qa',user:'atlas_r2_writer'}); pools.push(writer);
  const reader=new Pool({...connection,database:'atlas_r2_qa',user:'atlas_r2_reader'}); pools.push(reader);
  const options={pool:writer,environment:'SYNTHETIC_LOCAL',expectedRole:'atlas_r2_writer',expectedDatabase:'atlas_r2_qa',expectedFunctionOwner:'atlas_r2_qa_owner',enabled:true};
  let store=createPostgresStore(options);
  if(phase==='drift') {
    const receipt=JSON.parse(await readFile(receiptPath,'utf8')),before=await store.read();
    assert.equal(hash(before),receipt.stateHash);
    const driftCases=[
      ['unrelated table SELECT', 'GRANT SELECT ON unrelated_private.sentinel TO atlas_r2_writer', 'DATABASE_GRANTS_REFUSED'],
      ['unrelated column SELECT without schema usage', 'GRANT SELECT(value) ON unrelated_private.sentinel TO atlas_r2_writer', 'DATABASE_GRANTS_REFUSED'],
      ['PUBLIC column SELECT', 'GRANT SELECT(value) ON unrelated_private.sentinel TO PUBLIC', 'DATABASE_GRANTS_REFUSED'],
      ['unrelated view SELECT', 'CREATE VIEW unrelated_private.drift_view AS SELECT value FROM unrelated_private.sentinel; GRANT SELECT ON unrelated_private.drift_view TO atlas_r2_writer', 'DATABASE_GRANTS_REFUSED'],
      ['unrelated materialized view SELECT', 'CREATE MATERIALIZED VIEW unrelated_private.drift_materialized AS SELECT value FROM unrelated_private.sentinel; GRANT SELECT ON unrelated_private.drift_materialized TO atlas_r2_writer', 'DATABASE_GRANTS_REFUSED'],
      ['unrelated sequence USAGE', 'CREATE SEQUENCE unrelated_private.drift_sequence; GRANT USAGE ON SEQUENCE unrelated_private.drift_sequence TO atlas_r2_writer', 'DATABASE_GRANTS_REFUSED'],
      ['unrelated schema CREATE', 'GRANT CREATE ON SCHEMA unrelated_private TO atlas_r2_writer', 'DATABASE_GRANTS_REFUSED'],
      ['database CREATE', 'GRANT CREATE ON DATABASE atlas_r2_qa TO atlas_r2_writer', 'DATABASE_GRANTS_REFUSED'],
      ['unrelated table ownership', 'ALTER TABLE unrelated_private.sentinel OWNER TO atlas_r2_writer', 'DATABASE_GRANTS_REFUSED'],
      ['role membership', 'GRANT atlas_r2_reader TO atlas_r2_writer', 'DATABASE_ROLE_MEMBERSHIP_REFUSED'],
      ['unrelated SECURITY DEFINER function', "CREATE FUNCTION unrelated_private.drift_definer() RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS 'SELECT 1'", 'DATABASE_FUNCTION_GRANTS_REFUSED'],
      ['unrelated invoker function', "CREATE FUNCTION unrelated_private.drift_invoker() RETURNS integer LANGUAGE sql AS 'SELECT 1'", 'DATABASE_FUNCTION_GRANTS_REFUSED'],
      ['trigger helper EXECUTE', 'GRANT EXECUTE ON FUNCTION atlas_marketplace.reject_change() TO atlas_r2_writer', 'DATABASE_FUNCTION_GRANTS_REFUSED'],
      ['missing writer gateway', 'REVOKE EXECUTE ON FUNCTION atlas_marketplace.commit_state(bigint,text,jsonb,text,bigint) FROM atlas_r2_writer', 'DATABASE_FUNCTION_GRANTS_REFUSED'],
      ['function owner drift', 'ALTER FUNCTION atlas_marketplace.read_state() OWNER TO atlas_r2_reader', 'DATABASE_FUNCTION_GRANTS_REFUSED'],
      ['function search path drift', 'ALTER FUNCTION atlas_marketplace.read_state() SET search_path=public,pg_catalog', 'DATABASE_FUNCTION_GRANTS_REFUSED'],
      ['function definer drift', 'ALTER FUNCTION atlas_marketplace.read_state() SECURITY INVOKER', 'DATABASE_FUNCTION_GRANTS_REFUSED']
    ];
    for(const [name,sql,code] of driftCases) {
      // The artificial grants are visible only inside this owned transaction.
      // They are always rolled back, including assertion/query failures.
      const client=await owner.connect();
      try {
        await client.query('BEGIN'); await client.query(sql); await client.query('SET LOCAL ROLE atlas_r2_writer');
        const scoped=createPostgresStore({...options,pool:{connect:async()=>({query:(...args)=>client.query(...args),release(){}})}});
        await assert.rejects(()=>scoped.read(),{code},name); scoped.close();
      } finally {try {await client.query('ROLLBACK');} finally {client.release();}}
      assert.equal(hash(await store.read()),receipt.stateHash,name);
    }
    let executed=false;
    await assert.rejects(()=>store.transaction(async()=>{executed=true;throw Error('must not execute');}),{code:'ASYNC_TRANSACTION_REFUSED'});
    assert.equal(executed,false);
    await assert.rejects(()=>store.transaction(tx=>{tx.state.consent.drift_uncommitted=true;return Promise.reject(Error('observed unexpected reducer rejection'));}),{code:'ASYNC_TRANSACTION_REFUSED'});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(hash(await store.read()),receipt.stateHash);
    assert.equal((await owner.query('SELECT value FROM unrelated_private.sentinel')).rows[0].value,'untouched');
    const driftReceipt={environment:'SYNTHETIC_LOCAL',realProvider:false,database:'atlas_r2_qa',role:'atlas_r2_writer',statePreserved:true,stateHash:receipt.stateHash,grantDriftCases:driftCases.map(([name])=>name),asyncReducerPreExecutionRefused:true,rejectedPromiseObservedAndRolledBack:true};
    await writeFile(receiptPath.replace(/\.json$/,'-privilege-drift.json'),JSON.stringify(driftReceipt,null,2)+'\n',{mode:0o600});
    console.log(JSON.stringify(driftReceipt));
  } else if(phase==='verify') {
    const receipt=JSON.parse(await readFile(receiptPath,'utf8')),state=await store.read();
    assert.equal(hash(state),receipt.stateHash); assertJournal(state.journals);
    const sentinel=await owner.query('SELECT value FROM unrelated_private.sentinel');
    assert.equal(sentinel.rows[0].value,'untouched');
    console.log(JSON.stringify({postgresRestartVerified:true,stateHash:hash(state),journalEntries:state.journals.length}));
  } else {
    if(phase==='create') {
    await owner.query(await readFile(new URL('../sql/proposal.sql',import.meta.url),'utf8'));
    const empty=emptyMarketplaceState();
    await owner.query('INSERT INTO atlas_marketplace.state VALUES(true,$1,$2,0,$3::jsonb,$4)',[POSTGRES_STORE_FORMAT,'SYNTHETIC_LOCAL',canonicalJSON(empty),hash(empty)]);
    await owner.query(`GRANT USAGE ON SCHEMA atlas_marketplace TO atlas_r2_writer,atlas_r2_reader;
      GRANT EXECUTE ON FUNCTION atlas_marketplace.read_state() TO atlas_r2_writer,atlas_r2_reader;
      GRANT EXECUTE ON FUNCTION atlas_marketplace.lock_state(),atlas_marketplace.commit_state(bigint,text,jsonb,text,bigint) TO atlas_r2_writer;
      CREATE SCHEMA unrelated_private; REVOKE ALL ON SCHEMA unrelated_private FROM PUBLIC;
      CREATE TABLE unrelated_private.sentinel(value text); INSERT INTO unrelated_private.sentinel VALUES('untouched')`);
    }
    await assert.rejects(()=>writer.query('SELECT * FROM unrelated_private.sentinel'),{code:'42501'});
    await assert.rejects(()=>writer.query('SELECT * FROM atlas_marketplace.state'),{code:'42501'});
    await assert.rejects(()=>writer.query('DELETE FROM atlas_marketplace.journal'),{code:'42501'});
    await assert.rejects(()=>reader.query('SELECT * FROM atlas_marketplace.lock_state()'),{code:'42501'});
    assert.equal((await reader.query('SELECT * FROM atlas_marketplace.read_state()')).rows.length,1);
    const privileged=createPostgresStore({...options,pool:owner,expectedRole:'atlas_r2_qa_owner',expectedFunctionOwner:'separate_owner'});
    await assert.rejects(()=>privileged.read(),{code:'DATABASE_AUTHORITY_REFUSED'});
    const before=hash(await store.read());
    await assert.rejects(()=>store.transaction(tx=>{tx.state.bad=true; throw Error('rollback assertion');}),/rollback assertion/);
    assert.equal(hash(await store.read()),before);
    await assert.rejects(()=>store.transaction(async()=>null),{code:'ASYNC_TRANSACTION_REFUSED'});
    local=openLocalStore({filename:':memory:',environment:'SYNTHETIC_LOCAL'});
    const fixture=createLocalFixture({store:local,assets:false});
    const serviceFor=()=>createMarketplacePilot({...fixture,store,enabled:true,environment:'SYNTHETIC_LOCAL',platformAccountId:'demo_platform'});
    let service=serviceFor(); const provider=fixture.provider;
    await service.recordConsent(actors.seller,{requestId:'demo_pg_consent_v2',cardId:'demo_card',choice:'HOLD_AND_LIST',evidenceRef:'demo_hold_consent'});
    const listing=await service.publishListing(actors.seller,{requestId:'demo_pg_listing',cardId:'demo_card',askingPriceCents:12500});
    const buyers=[actors.buyer,actors.alternateBuyer];
    const quotes=await Promise.all(buyers.map(actor=>service.quote(actor,listing.id)));
    const contenders=await Promise.allSettled(buyers.map((actor,index)=>service.reserve(actor,{requestId:`demo_pg_reserve_${index}`,listingId:listing.id,listingVersion:listing.version,listingHash:listing.bindingHash,quoteId:quotes[index].quoteId})));
    assert.equal(contenders.filter(row=>row.status==='fulfilled').length,1);
    assert.equal(contenders.find(row=>row.status==='rejected').reason.code,'CARD_RESERVED');
    const winner=contenders.findIndex(row=>row.status==='fulfilled'),buyer=buyers[winner],reservation=contenders[winner].value;
    const paymentId=intentId('payment',reservation.id);
    provider.failNextCreateAfterCommit(paymentId);
    await assert.rejects(()=>service.pay(buyer,{reservationId:reservation.id}),{code:'SYNTHETIC_RESPONSE_LOST'});
    store.close(); store=createPostgresStore(options); service=serviceFor();
    await provider.resolve(paymentId,{status:'succeeded',processingFeeCents:300});
    const order=await service.reconcilePayment(buyer,{reservationId:reservation.id});
    assert.equal(order.status,'PAID');
    for(const action of ['PACK','DISPATCH','DELIVER','RELEASE']) await service.fulfill(actors.staff,{requestId:`demo_pg_${action}`,orderId:order.orderId,action,evidence:syntheticFulfillmentEvidence(order,action)});
    const transferId=intentId('transfer',order.orderId);
    await provider.resolve(transferId,{status:'succeeded'});
    await reconcileFinanceIntent({store,provider,intentId:transferId});
    const payout=await service.withdraw(actors.seller,{requestId:'demo_pg_payout',amountCents:12000,externalAccountId:'demo_bank'});
    await provider.resolve(payout.id,{status:'paid'});
    await service.reconcileWithdrawal(actors.seller,{intentId:payout.id});
    assert.equal((await service.balance(actors.seller)).paidOutCents,12000);
    assert.equal(local.read().syntheticProvider.calls[paymentId],1);
    const state=await store.read(); assertJournal(state.journals);
    await assert.rejects(()=>store.transaction(tx=>{tx.state.journals[0].kind='changed';}),{code:'JOURNAL_MUTATION'});
    await assert.rejects(()=>owner.query("UPDATE atlas_marketplace.journal SET document='{}'::jsonb"),{code:'23514'});
    const projection=await owner.query('SELECT (SELECT count(*) FROM atlas_marketplace.active_cards) AS cards,(SELECT count(*) FROM atlas_marketplace.active_reservations) AS reservations');
    assert.deepEqual(projection.rows[0],{cards:'1',reservations:'0'});
    const snapshot=await owner.query('SELECT * FROM atlas_marketplace.read_state()');
    const duplicate=structuredClone(state); duplicate.listings.demo_duplicate={...duplicate.listings[listing.id],id:'demo_duplicate'};
    await assert.rejects(()=>writer.query('SELECT atlas_marketplace.commit_state($1,$2,$3::jsonb,$4,$5)',[snapshot.rows[0].revision,snapshot.rows[0].state_hash,canonicalJSON(duplicate),hash(duplicate),Date.now()]),{code:'23505'});
    assert.equal(hash(await store.read()),hash(state));
    const receipt={environment:'SYNTHETIC_LOCAL',realProvider:false,database:'atlas_r2_qa',role:'atlas_r2_writer',orders:Object.keys(state.orders).length,journalEntries:state.journals.length,events:state.events.length,stateHash:hash(state),paidOutCents:12000,checks:['restricted roles','private schema isolation','rollback','async transaction refusal','concurrent reservation','unknown payment recovery','store reopen','full sale to payout','immutable history','database uniqueness','no duplicate provider dispatch']};
    await writeFile(receiptPath,JSON.stringify(receipt,null,2)+'\n',{mode:0o600});
    console.log(JSON.stringify(receipt));
  }
} finally {local?.close(); await Promise.all(pools.map(pool=>pool.end())); await admin.end();}
