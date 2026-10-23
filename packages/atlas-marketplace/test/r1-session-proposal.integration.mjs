// Explicit fresh owned PostgreSQL only; excluded from *.test.mjs.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,writeFile,chmod,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {registerHooks} from 'node:module';
import {createR1MarketplaceAuthBridge} from '../src/auth-r1.mjs';
import {loadR1CanonicalAuth} from '../src/host-r1.mjs';

const [pgPath,r1Root,receiptPath]=process.argv.slice(2),run=promisify(execFile),bin='/opt/homebrew/opt/postgresql@17/bin';
assert.ok(pgPath?.endsWith('/continuation/deps/node_modules/pg/lib/index.js'));
assert.equal(r1Root,'/Users/markthomas/.codex/worktrees/atlas-marketplace-foundation/ten-kings-mystery-packs-clean');
assert.ok(receiptPath?.endsWith('/continuation/r2-host-session-proposal-receipt.json'));
const {default:{Pool}}=await import(pathToFileURL(pgPath));
const hook=registerHooks({resolve(specifier,context,next){return specifier==='@atlas/customer-intake/profile'?{url:new URL('../../atlas-customer-intake/src/profile.mjs',import.meta.url).href,shortCircuit:true}:next(specifier,context);}});
const canonical=await loadR1CanonicalAuth();hook.deregister();
const sha=value=>createHash('sha256').update(value).digest('hex');
const baseline=await readFile(r1Root+'/packages/atlas-standalone-database/sql/baseline.sql','utf8');
const proposal=await readFile(new URL('../sql/r1-session-access-proposal.sql',import.meta.url),'utf8');
const guard="DO $$ BEGIN RAISE EXCEPTION 'R1_SESSION_ACCESS_PROPOSAL_NOT_APPROVED'; END $$;";
assert.equal(proposal.split(guard).length,2);const body=proposal.replace(guard,'-- Guard removed only in memory for owned disposable qualification.');
const root=await mkdtemp('/private/tmp/atlas-r2-session-qa-');await chmod(root,0o700);const socket=root+'/socket',data=root+'/data';await mkdir(socket,{mode:0o700});
const receipt={schema:'atlas-r2-owned-session-qualification-v1',realProvider:false,sharedDatabase:false,clusterRoot:root,port:65434,baselineHash:sha(baseline),guardedProposalHash:sha(proposal),qualifiedBodyHash:sha(body),scriptHash:sha(await readFile(new URL(import.meta.url))),guardRemovedOnlyInMemory:true,checks:[]};
const pools=[];let started=false;
try {
  await run(bin+'/initdb',['-D',data,'-U','r2_session_qa_admin','--auth-local=trust','--auth-host=reject','--encoding=UTF8','--locale=C']);
  await run(bin+'/pg_ctl',['-D',data,'-l',root+'/postgres.log','-o',`-k ${socket} -p 65434 -c listen_addresses='' -c unix_socket_permissions=0700`,'-w','start']);started=true;
  const connection={host:socket,port:65434,user:'r2_session_qa_admin',database:'postgres',max:3};const admin=new Pool(connection);pools.push(admin);
  assert.equal((await admin.query('SHOW listen_addresses')).rows[0].listen_addresses,'');receipt.tcpDisabled=true;
  await admin.query('CREATE DATABASE r2_session_qa');await admin.query('CREATE ROLE r2_session_schema_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS');
  await admin.query('CREATE ROLE r2_session_serving LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS');
  await admin.query('GRANT CREATE ON DATABASE r2_session_qa TO r2_session_schema_owner');
  const owners=new Pool({...connection,database:'r2_session_qa'});pools.push(owners);const owner=await owners.connect();
  try {
    await owner.query('SET ROLE r2_session_schema_owner');await owner.query(baseline);await owner.query('SET check_function_bodies=true');
    await owner.query('GRANT USAGE ON SCHEMA atlas_customer TO r2_session_serving');await owner.query('GRANT EXECUTE ON FUNCTION atlas_customer.customer_call(text,jsonb,jsonb) TO r2_session_serving');
    const binding={mode:'LOCAL_FIXTURE',origin:'http://127.0.0.1:4318',deploymentId:'OWNED_PASSIVE_SESSION_TEST',releaseSha:'0'.repeat(40),configHash:'b'.repeat(64)};
    const accountId='11111111-1111-4111-8111-111111111111',browser=Buffer.alloc(32,41).toString('base64url'),session=Buffer.alloc(32,42).toString('base64url');
    const browserHash=sha(browser),sessionHash=sha(session),capability={sessionHash,browserHash},challenge='a'.repeat(43),phoneHash='c'.repeat(64);
    await owner.query('INSERT INTO atlas_customer."CustomerControl"(enabled,mode,origin,"deploymentId","releaseSha","configHash") VALUES(true,$1,$2,$3,$4,$5)',Object.values(binding));
    await owner.query('INSERT INTO atlas_customer."CustomerAccount"(id,"phoneHash",phone) VALUES($1,$2,$3)',[accountId,phoneHash,'+12025550123']);
    await owner.query('INSERT INTO atlas_customer."CustomerBrowser"("tokenHash","controlRevision","createdAt","expiresAt") VALUES($1,1,clock_timestamp()-interval \'1 minute\',clock_timestamp()+interval \'1 day\')',[browserHash]);
    await owner.query('INSERT INTO atlas_customer."CustomerChallenge"(id,"browserHash","requestId","phoneHash",phone,"controlRevision","accountSid","serviceSid","verificationSid",state,"sendClaimId","createdAt","expiresAt","quarantineUntil","consumedAt","replayHash","replayUntil") VALUES($1,$2,$3,$4,$5,1,$6,$7,$8,\'CONSUMED\',$9,clock_timestamp()-interval \'1 minute\',clock_timestamp()+interval \'4 minutes\',clock_timestamp()+interval \'10 minutes\',clock_timestamp(),$10,clock_timestamp()+interval \'1 minute\')',[challenge,browserHash,'22222222-2222-4222-8222-222222222222',phoneHash,'+12025550123','AC'+'0'.repeat(32),'VA'+'0'.repeat(32),'VE'+'0'.repeat(32),'33333333-3333-4333-8333-333333333333','d'.repeat(64)]);
    await owner.query('INSERT INTO atlas_customer."CustomerSession"("tokenHash","accountId","browserHash","challengeId","controlRevision","accessVersion","createdAt","expiresAt") VALUES($1,$2,$3,$4,1,1,clock_timestamp()-interval \'1 minute\',clock_timestamp()+interval \'30 minutes\')',[sessionHash,accountId,browserHash,challenge]);
    const serving=new Pool({...connection,database:'r2_session_qa',user:'r2_session_serving'});pools.push(serving);
    const call=async(action,b=binding,d=capability,client=serving)=>(await client.query('SELECT atlas_customer.customer_call($1,$2::jsonb,$3::jsonb) AS result',[action,JSON.stringify(b),JSON.stringify(d)])).rows[0].result;
    const beforeDelegation=await call('owned_unknown_action');
    await assert.rejects(owner.query(proposal),/R1_SESSION_ACCESS_PROPOSAL_NOT_APPROVED/);await owner.query('ROLLBACK');
    await owner.query(body);receipt.checks.push('unchanged guard refuses; in-memory body compiles with pg_catalog-only search path');
    assert.deepEqual(await call('owned_unknown_action'),beforeDelegation);receipt.checks.push('original wrapper action delegation retained');
    const funcs=(await serving.query("SELECT n.nspname,p.proname,p.prosecdef,p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND has_function_privilege(current_user,p.oid,'EXECUTE')")).rows;
    assert.equal(funcs.length,1);assert.equal(funcs[0].proname,'customer_call');assert.equal(funcs[0].prosecdef,true);assert.deepEqual(funcs[0].proconfig,['search_path=pg_catalog']);
    await assert.rejects(serving.query('SELECT * FROM atlas_customer."CustomerSession"'),{code:'42501'});
    await assert.rejects(serving.query('SELECT atlas_customer.customer_call_before_marketplace_session_access($1,$2::jsonb,$3::jsonb)',['marketplace_session_access',JSON.stringify(binding),JSON.stringify(capability)]),{code:'42501'});
    receipt.checks.push('single EXECUTE-only gateway retained; old wrapper and direct tables refused');
    const snapshot=async()=>{const result=[];for(const table of ['CustomerControl','CustomerAccount','CustomerBrowser','CustomerChallenge','CustomerSession','CustomerRateBucket'])result.push((await owner.query(`SELECT to_jsonb(t) AS row FROM atlas_customer."${table}" t ORDER BY to_jsonb(t)::text`)).rows);return sha(JSON.stringify(result));};
    const before=await snapshot(),access=await call('marketplace_session_access');
    assert.deepEqual(Object.keys(access).sort(),['accountId','browserHash','expiresAt','observedAt','schema','sessionHash']);assert.equal(access.accountId,accountId);assert.equal(access.schema,'atlas-marketplace-session-access-v1');assert.equal(access.sessionHash,sessionHash);assert.equal(access.browserHash,browserHash);assert.ok(Number.isSafeInteger(access.expiresAt)&&Number.isSafeInteger(access.observedAt)&&access.expiresAt>access.observedAt);
    for(const [b,d,code] of [[{...binding,configHash:'f'.repeat(64)},capability,'CUSTOMER_ACCESS_NOT_ENABLED'],[{...binding,extra:true},capability,'CUSTOMER_ACCESS_NOT_ENABLED'],[binding,{...capability,actorId:accountId},'INVALID_REQUEST'],[binding,{...capability,browserHash:'f'.repeat(64)},'SIGN_IN_REQUIRED'],[binding,{browserHash},'INVALID_REQUEST']])assert.equal((await call('marketplace_session_access',b,d)).error.code,code);
    const invalidStates=[['session revocation','UPDATE atlas_customer."CustomerSession" SET "revokedAt"=clock_timestamp()'],['account revocation','UPDATE atlas_customer."CustomerAccount" SET "revokedAt"=clock_timestamp()'],['access-version drift','UPDATE atlas_customer."CustomerAccount" SET "accessVersion"="accessVersion"+1'],['session expiry','UPDATE atlas_customer."CustomerSession" SET "expiresAt"=clock_timestamp()-interval \'1 second\''],['browser expiry','UPDATE atlas_customer."CustomerBrowser" SET "expiresAt"=clock_timestamp()-interval \'1 second\'']];
    for(const [name,sql] of invalidStates){try{await owner.query('BEGIN');await owner.query(sql);await owner.query('SET LOCAL ROLE r2_session_serving');assert.equal((await call('marketplace_session_access',binding,capability,owner)).error.code,'SIGN_IN_REQUIRED',name);}finally{await owner.query('ROLLBACK');}}
    receipt.checks.push('exact deployment/hash-only input; session/account revocation, version and expiry refusal');
    // Minimal tagged-query adapter to the actual canonical CustomerDatabase.
    // Every SQL query executes as the restricted serving role in real PG.
    const prisma={$transaction:async work=>{const client=await serving.connect();try{await client.query('BEGIN');const tagged=async(strings,...values)=>(await client.query(strings.reduce((sql,part,index)=>sql+(index?'$'+index:'')+part,''),values)).rows;const result=await work({$queryRaw:tagged,$executeRaw:tagged});await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}};
    const config={...binding,binding,cookies:{browser:'fixture_browser',session:'fixture_session'},sessionKey:Buffer.alloc(32,43)};
    const auth=new canonical.CustomerAuth({database:new canonical.CustomerDatabase(prisma,config),config,provider:{}});
    const request={method:'GET',url:'/account/marketplace/api/workspace',headers:{host:'127.0.0.1:4318',cookie:`fixture_browser=${browser}; fixture_session=${session}`},socket:{remoteAddress:'127.0.0.1'},rawBody:Buffer.alloc(0)};
    const bridgeOptions={enabled:true,environment:'PROVIDER_SANDBOX',policy:{approved:true,approvalRef:'OWNED_GATEWAY_CONTRACT_TEST',environment:'PROVIDER_SANDBOX',r1Mode:'LOCAL_FIXTURE',customerRoles:['BUYER'],staffRoles:['REVIEWER']},customer:{state:{auth,config,assertRequest:req=>assert.equal(req,request)},CustomerAuth:canonical.CustomerAuth,CustomerDatabase:canonical.CustomerDatabase},admitRequest:async()=>true,clock:()=>Date.now()-500,maxDatabaseClockSkewMs:1000};
    const ctx=createR1MarketplaceAuthBridge(bridgeOptions).open(request,{audience:'BUYER'});const principal=await ctx.resolveSession({cookie:request.headers.cookie,method:'GET',path:'/workspace'});assert.equal(principal.actor.id,accountId);await ctx.admitRequest({sessionId:principal.sessionId,actorId:accountId,method:'GET',path:'/workspace'});assert.equal(await ctx.withAuthorized(principal,actor=>actor.id),accountId);ctx.close();
    const strict=createR1MarketplaceAuthBridge({...bridgeOptions,maxDatabaseClockSkewMs:0}).open(request,{audience:'BUYER'});await assert.rejects(strict.resolveSession({cookie:request.headers.cookie,method:'GET',path:'/workspace'}),{code:'AUTH_BOUNDARY_UNAVAILABLE'});strict.close();
    assert.equal(await snapshot(),before);receipt.noWriteSnapshotHash=before;receipt.checks.push('actual canonical CustomerDatabase/Auth and 500ms DB lead with explicit conservative tolerance','zero-tolerance future observation refused','passive reads leave all control/account/browser/challenge/session/rate rows unchanged');receipt.result='PASSED';
  }finally{owner.release();}
} catch(error){receipt.result='FAILED';receipt.errorCode=error.code??'ASSERTION_FAILED';throw error;}
finally {
  await Promise.all(pools.map(pool=>pool.end()));
  if(started){await run(bin+'/pg_ctl',['-D',data,'-m','fast','-w','stop']);try{await run(bin+'/pg_ctl',['-D',data,'status']);assert.fail('cluster still running');}catch(error){assert.equal(error.code,3);}receipt.clusterStopped=true;}
  await writeFile(receiptPath,JSON.stringify(receipt,null,2)+'\n',{mode:0o600});
}
console.log(JSON.stringify(receipt));
