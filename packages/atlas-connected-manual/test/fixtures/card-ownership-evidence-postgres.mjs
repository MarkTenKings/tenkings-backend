// Explicit root-logged disposable PostgreSQL17 only; never imported at runtime.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaClient } from '../../../../frontend/atlas-app/.generated/staff-database/index.js';
import { CustomerAuth } from '../../../../frontend/atlas-customer/lib/server/auth.mjs';
import { CustomerDatabase } from '../../../../frontend/atlas-customer/lib/server/database.mjs';
import { localConfig, fixtureProvider } from '../../../../frontend/atlas-customer/lib/server/fixture.mjs';
import { createOwnedManualFixture } from '../../../atlas-manual-service/scripts/owned-fixture.mjs';
import { canonical, digest } from '../../../atlas-manual-service/src/contract.mjs';
import { createCardOwnershipEvidenceService, cardOwnershipEvidenceGrantSQL } from '../../src/card-ownership-evidence-service.mjs';
const output=process.env.ATLAS_CARD_EVIDENCE_QUALIFICATION;
assert(output&&resolve(output)===output,'Absolute NEW evidence directory required');await mkdir(output,{mode:0o700});
const writer=await readFile(new URL('../../sql/card-ownership-proposal.sql',import.meta.url),'utf8');assert.equal(digest(writer),'00720728d42a1276d50c70998d22e9e309cec2b1bb5cdd9ba8c7126e16fc36a2');
const sql=await readFile(new URL('../../sql/card-ownership-evidence-proposal.sql',import.meta.url),'utf8');
const serviceSource=await readFile(new URL('../../src/card-ownership-evidence-service.mjs',import.meta.url),'utf8');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO/a7X8AAAAASUVORK5CYII=','base64');
const fixture=await createOwnedManualFixture(process.argv.slice(2)),clients=[],checks=[],waitProofs=[];let result;
try{
 await fixture.cluster.sql(writer,[],fixture.database.name);await fixture.cluster.sql(sql,[],fixture.database.name);
 const admin=fixture.admin,connection=fixture.connect(),staffAuth=connection.auth;
 async function staffLogin(phone){const boot=await staffAuth.bootstrap(''),initial=`${fixture.config.cookies.browser}=${boot.browserToken}`;
  const challenge=await staffAuth.send(initial,boot.csrf,{phone,requestId:randomUUID()},'evidence-fixture');const signed=await staffAuth.verify(initial,boot.csrf,{challengeId:challenge.challengeId,code:'424242'},'evidence-fixture');
  const cookie=`${initial}; ${fixture.config.cookies.session}=${signed.token}`,staff=await staffAuth.authenticate(cookie,signed.csrf),principal=await connection.boundary.transaction(staff,({principal})=>principal);
  return{...signed,cookie,staff,principal};}
 const reviewer=await staffLogin('+12025550141'),peer=await staffLogin('+12025550143');
 const authClient=new PrismaClient({datasources:{db:{url:fixture.database.customerUrl}}});clients.push(authClient);
 const config=localConfig({databaseUrl:fixture.database.customerUrl,sessionKey:randomBytes(32),phoneKey:randomBytes(32)});
 const auth=new CustomerAuth({database:new CustomerDatabase(authClient,config),config,provider:fixtureProvider(config)});
 await admin.$executeRawUnsafe('INSERT INTO atlas_customer."CustomerControl"(enabled,mode,origin,"deploymentId","releaseSha","configHash") VALUES(true,$1,$2,$3,$4,$5)',config.mode,config.origin,config.deploymentId,config.releaseSha,config.configHash);
 async function login(phone){const boot=await auth.bootstrap('','evidence-fixture'),initial=`${config.cookies.browser}=${boot.browserToken}`;
  const challenge=await auth.send(initial,boot.csrf,{phone,requestId:randomUUID()},'evidence-fixture');const signed=await auth.verify(initial,boot.csrf,{challengeId:challenge.challengeId,code:'424242'},'evidence-fixture');
  return{...signed,cookie:`${initial}; ${config.cookies.session}=${signed.token}`};}
 const owner=await login('+12025550341'),other=await login('+12025550342'),self=await login('+12025550141'),expiring=await login('+12025550343');
 async function restricted(role,audience){const password=randomBytes(24).toString('hex');await fixture.cluster.sql(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
  await fixture.cluster.sql(cardOwnershipEvidenceGrantSQL(role,audience),[],fixture.database.name);const url=new URL(fixture.database.adminUrl);url.username=role;url.password=password;
  const client=new PrismaClient({datasources:{db:{url:url.href}}});clients.push(client);return client;}
 const customerRole='atlas_fixture_evidence_customer',reviewerRole='atlas_fixture_evidence_reviewer',customerClient=await restricted(customerRole,'CUSTOMER'),reviewerClient=await restricted(reviewerRole,'REVIEWER');
 const customer=createCardOwnershipEvidenceService({auth,client:customerClient,audience:'CUSTOMER'}),review=createCardOwnershipEvidenceService({auth:staffAuth,client:reviewerClient,audience:'REVIEWER'});
 const submit=(d,who=owner,bytes=png)=>customer.submit(who.cookie,who.csrf,d,bytes);
 const decide=(d,who=reviewer,bytes=png)=>review.review(who.cookie,who.csrf,d,bytes);
 async function rawCustomer(action,d,who=owner,bytes=png,binding=config.binding,runner=customerClient){const h=auth.authority(who.cookie);return(await runner.$queryRawUnsafe('SELECT atlas_ownership_evidence.customer_gateway($1,$2,$3::jsonb,$4,$5::jsonb,$6::bytea) result',h.sessionHash,h.browserHash,JSON.stringify(binding),action,JSON.stringify(d),bytes))[0].result;}
 async function rawReview(d,who=reviewer,runner=reviewerClient){const h=staffAuth.actors.get(who.staff),staffBinding=Object.fromEntries(['mode','origin','deploymentId','releaseSha','configHash'].map(k=>[k,fixture.config[k]]));assert(Object.values(staffBinding).every(v=>typeof v==='string'));return(await runner.$queryRawUnsafe('SELECT atlas_ownership_evidence.reviewer_gateway($1,$2,$3::jsonb,$4::text[],$5,$6::jsonb,$7::bytea) result',h.sessionHash,h.browserHash,JSON.stringify(staffBinding),[...fixture.config.phoneByHash.keys()],'review_claim',JSON.stringify(d),png))[0].result;}
 async function seed(actor=reviewer.principal.id){const c={id:randomUUID(),createId:randomUUID(),actionId:randomUUID()};
  await admin.$executeRawUnsafe("INSERT INTO atlas_manual_intake.card(id,pair_id,owner_id,create_request_id,create_request_hash,label) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,'SYNTHETIC EVIDENCE')",c.id,randomUUID(),actor,c.createId,digest(c.createId));
  await admin.$executeRawUnsafe("INSERT INTO atlas_manual.card(id,revision,content,content_hash,owner_id) VALUES($1::uuid,1,'{}',$2,$3::uuid)",c.id,digest('{}'),actor);
  await admin.$executeRawUnsafe('INSERT INTO atlas_manual.public_report_identity(card_id,public_token,report_number) VALUES($1::uuid,$2,$3)',c.id,'ar_'+randomUUID().replaceAll('-','').slice(0,24),'ATLAS-'+randomUUID().replaceAll('-','').slice(0,12).toUpperCase());
  const report=canonical({version:'atlas-manual-report-snapshot-v2',identity:{playerName:'SYNTHETIC evidence fixture'},finalGrade:9});
  await admin.$executeRawUnsafe("INSERT INTO atlas_manual.action(card_id,action_id,actor_id,expected_revision,result_revision,request_hash,request,result) VALUES($1::uuid,$2::uuid,$3::uuid,1,2,$4,'{}','{}')",c.id,c.actionId,actor,digest('{}'));
  await admin.$executeRawUnsafe('INSERT INTO atlas_manual.approval(card_id,action_id,actor_id,source_revision,source_hash,report_hash,report) VALUES($1::uuid,$2::uuid,$3::uuid,1,$4,$5,$6)',c.id,c.actionId,actor,digest('fixture'),digest(report),report);
  await admin.$executeRawUnsafe("INSERT INTO atlas_manual.publication(card_id,action_id,version,mode) VALUES($1::uuid,$2::uuid,1,'LOCAL_FIXTURE')",c.id,c.actionId);
  await admin.$executeRawUnsafe("UPDATE atlas_manual.publication SET state='PUBLISHED',manifest='{}',manifest_hash=$1,public_hash=$2,published_at=clock_timestamp() WHERE card_id=$3::uuid",digest('{}'),digest('fixture-public'),c.id);return c;}
 const card=await seed(),hidden=await seed(peer.principal.id),selfCard=await seed(),waitCard=await seed(),waitReviewCard=await seed(),bypassCard=await seed();
 const claimInput=c=>({requestId:randomUUID(),cardId:c.id,expectedOwnershipRevision:0,proofKind:'FIXTURE_CLAIM'});
 const reviewInput=(c,claim)=>({requestId:randomUUID(),cardId:c.id,claimId:claim.eventId,expectedOwnershipRevision:0,decision:'VERIFY',proofKind:'FIXTURE_REVIEW'});
 const protectedTables=['atlas_manual.card','atlas_manual.action','atlas_manual.approval','atlas_manual.publication','atlas_manual.public_report_identity','atlas_manual_intake.card','atlas_dealer.custody_event','atlas_dealer.manual_card_link','atlas_customer."CommerceOrder"','atlas_customer."CommercePayment"'];
 async function census(){const values={};for(const t of protectedTables)values[t]=(await admin.$queryRawUnsafe(`SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) value FROM ${t} t`))[0].value;return digest(canonical(values));}
 const before=await census();
 await assert.rejects(submit(claimInput(card)),{code:'OWNERSHIP_EVIDENCE_DISABLED'});
 assert.equal(Number((await admin.$queryRawUnsafe('SELECT count(*) n FROM atlas_ownership_evidence.reviewer_grant'))[0].n),0);
 assert.equal(Number((await admin.$queryRawUnsafe('SELECT count(*) n FROM atlas_ownership_evidence.object'))[0].n),0);
 await admin.$executeRawUnsafe("UPDATE atlas_ownership_evidence.policy SET enabled=true,revision=1,accepted_claim_kinds=ARRAY['FIXTURE_CLAIM'],accepted_review_kinds=ARRAY['FIXTURE_REVIEW'],policy_reference='SYNTHETIC TEST ONLY',retention_reference='SYNTHETIC TEST ONLY',retention_seconds=3600,valid_until=clock_timestamp()+interval '1 hour' WHERE id='active'");
 checks.push('schema installs; default disabled and zero live reviewer/object records; synthetic-only owner policy explicitly enabled in disposable fixture');

 const d=claimInput(card),claim=await submit(d);assert.equal(claim.kind,'CLAIM_SUBMITTED');assert.deepEqual(await submit(d),claim);
 const stored=(await admin.$queryRawUnsafe('SELECT o.body,o.sha256,o.byte_count,m.content,m.sha256 manifest_sha,m.customer_id,m.card_id,l.event_id FROM atlas_ownership_evidence.manifest m JOIN atlas_ownership_evidence.object o ON o.id=m.object_id JOIN atlas_ownership_evidence.event_link l ON l.manifest_id=m.id WHERE m.id=$1::uuid',claim.evidence.referenceId))[0];
 assert(Buffer.from(stored.body).equals(png));assert.equal(stored.sha256,digest(png));assert.equal(stored.manifest_sha,claim.evidence.sha256);assert.equal(stored.customer_id,owner.customer.id);assert.equal(stored.card_id,card.id);assert.equal(stored.event_id,claim.eventId);
 const readInput={claimId:claim.eventId,evidenceId:claim.evidence.referenceId},attachment=await customer.read(owner.cookie,readInput);assert(attachment.bytes.equals(png));assert.match(attachment.headers['content-disposition'],/^attachment;/);
 await assert.rejects(customer.read(other.cookie,readInput),{code:'OWNERSHIP_EVIDENCE_NOT_FOUND'});
 await assert.rejects(submit({...d,proofKind:'UNACCEPTED'}),{code:'OWNERSHIP_PROOF_KIND_NOT_ACCEPTED'});
 const changed=Buffer.concat([png.subarray(0,-12),Buffer.from('changed'),png.subarray(-12)]);await assert.rejects(submit(d,owner,changed),{code:'OWNERSHIP_REQUEST_CONFLICT'});
 assert.equal((await rawCustomer('submit_claim',claimInput(card),owner,Buffer.from('<svg/>'))).error.code,'INVALID_OWNERSHIP_EVIDENCE');
 assert.equal((await rawCustomer('submit_claim',claimInput(card),owner,Buffer.alloc(65537))).error.code,'INVALID_OWNERSHIP_EVIDENCE');
 assert.equal((await rawCustomer('submit_claim',claimInput(card),owner,png,{...config.binding,releaseSha:'f'.repeat(40)})).error.code,'SIGN_IN_REQUIRED');
 const pending=await admin.$queryRawUnsafe('SELECT atlas_ownership.current_title($1::uuid) title',card.id);assert.equal(pending[0].title.status,'UNKNOWN');
 checks.push('actual retained bytes/hash/manifest/account/card/event link and durable DB readback; replay exact, payload conflict and unsupported/oversize refused; cross-customer private read denied; title remains UNKNOWN');

 async function grant(until=null){const expiry=until??new Date(Date.now()+3600000);await admin.$executeRawUnsafe('INSERT INTO atlas_ownership.reviewer_authority(staff_id,customer_account_id,authorization_reference,authorized_until) VALUES($1::uuid,$2::uuid,$3,$4) ON CONFLICT(staff_id) DO UPDATE SET customer_account_id=EXCLUDED.customer_account_id,authorization_reference=EXCLUDED.authorization_reference,authorized_until=EXCLUDED.authorized_until,revoked_at=NULL',reviewer.principal.id,self.customer.id,'SYNTHETIC explicit identity review',expiry);
  return(await admin.$queryRawUnsafe('INSERT INTO atlas_ownership_evidence.reviewer_grant(staff_id,customer_account_id,staff_access_version,customer_access_version,policy_revision,identity_reference,authorized_until) SELECT s.id,a.id,s."accessVersion",a."accessVersion",1,$3,$4 FROM atlas_staff."StaffIdentity" s,atlas_customer."CustomerAccount" a WHERE s.id=$1::uuid AND a.id=$2::uuid RETURNING id',reviewer.principal.id,self.customer.id,'SYNTHETIC explicit identity review',expiry))[0].id;}
 const decision=reviewInput(card,claim);await assert.rejects(decide(decision),{code:'OWNERSHIP_REVIEW_REQUIRED'});
 let grantId=await grant();
 const selfClaim=await submit(claimInput(selfCard),self),hiddenClaim=await submit(claimInput(hidden));
 await assert.rejects(decide(reviewInput(selfCard,selfClaim)),{code:'OWNERSHIP_INDEPENDENT_REVIEW_REQUIRED'});
 await assert.rejects(decide(reviewInput(hidden,hiddenClaim)),{code:'OWNERSHIP_NOT_FOUND'});
 await admin.$executeRawUnsafe("INSERT INTO atlas_ownership_evidence.reviewer_revocation(grant_id,reference) VALUES($1::uuid,'SYNTHETIC revoked')",grantId);
 await assert.rejects(decide(decision),{code:'OWNERSHIP_REVIEW_REQUIRED'});grantId=await grant();
 await admin.$executeRawUnsafe('UPDATE atlas_customer."CustomerAccount" SET "accessVersion"="accessVersion"+1 WHERE id=$1::uuid',self.customer.id);
 await assert.rejects(decide(decision),{code:'OWNERSHIP_REVIEW_REQUIRED'});grantId=await grant();
 const verified=await decide(decision);assert.equal(verified.kind,'CLAIM_VERIFIED');assert.deepEqual(await decide(decision),verified);
 const title=(await admin.$queryRawUnsafe('SELECT atlas_ownership.current_title($1::uuid) title',card.id))[0].title;assert.equal(title.ownerAccountId,owner.customer.id);
 const reviewRead={claimId:claim.eventId,evidenceId:verified.evidence.referenceId};assert((await review.read(reviewer.cookie,reviewRead)).bytes.equals(png));
 await assert.rejects(customer.read(owner.cookie,reviewRead),{code:'OWNERSHIP_EVIDENCE_NOT_FOUND'});
 const badDecision=reviewInput(card,claim),countBefore=Number((await admin.$queryRawUnsafe('SELECT count(*) n FROM atlas_ownership_evidence.object'))[0].n);
 await assert.rejects(decide(badDecision),{code:'OWNERSHIP_CLAIM_DECIDED'});assert.equal(Number((await admin.$queryRawUnsafe('SELECT count(*) n FROM atlas_ownership_evidence.object'))[0].n),countBefore);
 checks.push('explicit named grant plus live identity versions required; absent/revoked grants, self review, foreign ACL refused; only explicit VERIFY establishes title; private reviewer attachment scoped and failed decision rolls back object/manifest');

 for(const text of ['SELECT * FROM atlas_ownership_evidence.object','SELECT * FROM atlas_ownership_evidence.event_guard','SELECT * FROM atlas_ownership.event',"SELECT nextval('atlas_ownership.event_sequence_seq')",'SELECT atlas_ownership_evidence.live_policy()','SELECT atlas_ownership.customer_call(NULL,NULL,NULL,NULL,NULL)'])await assert.rejects(customerClient.$queryRawUnsafe(text));
 await fixture.cluster.sql(`GRANT USAGE ON SCHEMA atlas_ownership TO ${customerRole}; GRANT EXECUTE ON FUNCTION atlas_ownership.customer_call(text,text,jsonb,text,jsonb) TO ${customerRole}`,[],fixture.database.name);
 const legacy={requestId:randomUUID(),cardId:bypassCard.id,expectedOwnershipRevision:0,evidence:{referenceId:randomUUID(),sha256:'a'.repeat(64)}},handle=auth.authority(owner.cookie);
 await assert.rejects(customerClient.$queryRawUnsafe('SELECT atlas_ownership.customer_call($1,$2,$3::jsonb,$4,$5::jsonb)',handle.sessionHash,handle.browserHash,JSON.stringify(config.binding),'submit_claim',JSON.stringify(legacy)),/OWNERSHIP_EVIDENCE_GATEWAY_REQUIRED/);
 await assert.rejects(submit(claimInput(bypassCard)),{code:'OWNERSHIP_EVIDENCE_DATABASE_ROLE_INVALID'});
 await fixture.cluster.sql(`REVOKE EXECUTE ON FUNCTION atlas_ownership.customer_call(text,text,jsonb,text,jsonb) FROM ${customerRole}`,[],fixture.database.name);
 assert.equal((await admin.$queryRawUnsafe('SELECT atlas_ownership.current_title($1::uuid) title',bypassCard.id))[0].title.status,'UNKNOWN');
 checks.push('serving role denies data/sequences/helpers/old entrypoints; deliberate accidental old-mutator EXECUTE still cannot insert a claim, and adapter rejects expanded role');

 async function hold(sql,params){let unlock,entered;const ready=new Promise(r=>entered=r),release=new Promise(r=>unlock=r);const task=admin.$transaction(async tx=>{const[{pid}]=await tx.$queryRawUnsafe('SELECT pg_backend_pid() pid');await tx.$queryRawUnsafe(sql,...params);entered(pid);await release;},{timeout:8000});const pid=await ready;return{unlock,task,pid};}
 async function dispatched(client,work){let entered;const ready=new Promise(r=>entered=r);const task=client.$transaction(async tx=>{const[{pid}]=await tx.$queryRawUnsafe('SELECT pg_backend_pid() pid');entered(pid);return work(tx);},{timeout:8000}).then(value=>({value}),error=>({error}));return{pid:await ready,task};}
 async function observeWait(waiter,blocker,authorizationSql,params){const deadline=Date.now()+1500;for(;;){
  const[row]=await admin.$queryRawUnsafe(`SELECT a.pid,a.wait_event_type,pg_blocking_pids(a.pid) blockers,clock_timestamp() observed_at,(${authorizationSql}) authorized FROM pg_stat_activity a WHERE a.pid=$1`,waiter,...params);
  if(row?.wait_event_type==='Lock'&&row.blockers.includes(blocker)){assert.equal(row.authorized,true,'Wait must be observed before authority expiry');return{waiterPid:waiter,blockerPid:blocker,waitEventType:row.wait_event_type,observedAt:row.observed_at,authorizedBeforeExpiry:row.authorized};}
  assert(Date.now()<deadline,'Exact waiter/blocker pair was not observed before deadline');await new Promise(r=>setTimeout(r,20));}}
 const exp=auth.authority(expiring.cookie),sessionExpiry=new Date(Date.now()+2000);
 await admin.$executeRawUnsafe('UPDATE atlas_customer."CustomerSession" SET "expiresAt"=$1 WHERE "tokenHash"=$2',sessionExpiry,exp.sessionHash);
 let lock=await hold('SELECT card_id FROM atlas_manual.public_report_identity WHERE card_id=$1::uuid FOR UPDATE',[waitCard.id]),pendingCall;
 try{pendingCall=await dispatched(customerClient,tx=>rawCustomer('submit_claim',claimInput(waitCard),expiring,png,config.binding,tx));
  waitProofs.push({...await observeWait(pendingCall.pid,lock.pid,'SELECT "expiresAt">clock_timestamp() FROM atlas_customer."CustomerSession" WHERE "tokenHash"=$2',[exp.sessionHash]),kind:'CUSTOMER_SESSION',expiresAt:sessionExpiry});
  await new Promise(r=>setTimeout(r,Math.max(0,sessionExpiry.getTime()-Date.now()+100)));
 }finally{lock.unlock();await lock.task;}
 let finished=await pendingCall.task;assert.ifError(finished.error);assert.equal(finished.value.error.code,'SIGN_IN_REQUIRED');
 const waitingClaim=await submit(claimInput(waitReviewCard)),grantExpiry=new Date(Date.now()+2000);const expiringGrantId=await grant(grantExpiry);
 lock=await hold('SELECT id FROM atlas_customer."CustomerAccount" WHERE id=$1::uuid FOR UPDATE',[owner.customer.id]);
 try{pendingCall=await dispatched(reviewerClient,tx=>rawReview(reviewInput(waitReviewCard,waitingClaim),reviewer,tx));
  waitProofs.push({...await observeWait(pendingCall.pid,lock.pid,'SELECT authorized_until>clock_timestamp() FROM atlas_ownership_evidence.reviewer_grant WHERE id=$2::uuid',[expiringGrantId]),kind:'REVIEWER_GRANT',expiresAt:grantExpiry});
  await new Promise(r=>setTimeout(r,Math.max(0,grantExpiry.getTime()-Date.now()+100)));
 }finally{lock.unlock();await lock.task;}
 finished=await pendingCall.task;assert.ifError(finished.error);assert.equal(finished.value.error.code,'OWNERSHIP_REVIEW_REQUIRED');
 assert.equal((await admin.$queryRawUnsafe('SELECT atlas_ownership.current_title($1::uuid) title',waitReviewCard.id))[0].title.status,'UNKNOWN');
 assert.equal(Number((await admin.$queryRawUnsafe('SELECT count(*) n FROM atlas_ownership_evidence.event_guard'))[0].n),0);assert.equal(await census(),before);
 checks.push('actual controlled identity/account waits span customer session and reviewer grant expiry; no unauthorized event; private guards empty and ten protected grading/intake/custody/commerce tables unchanged');
 result={pass:true,checks,waitProofs,node:process.version,writerSha256:digest(writer),evidenceSqlSha256:digest(sql),serviceSha256:digest(serviceSource),protectedTables,preservationSha256:before,syntheticOnly:true,productionQueries:0,providerCalls:0,notificationEffects:0,financialEffects:0,ownedCluster:fixture.cluster.directory};
}catch(e){result={pass:false,checks,waitProofs,error:{name:e.name,code:e.code,message:e.message},writerSha256:digest(writer),evidenceSqlSha256:digest(sql),syntheticOnly:true,productionQueries:0,providerCalls:0};throw e;}
finally{await Promise.all(clients.map(c=>c.$disconnect()));await fixture.stop();const cleanupPath=resolve(fixture.cluster.directory,'cleanup.json'),cleanup=JSON.parse(await readFile(cleanupPath,'utf8'));result={...result,stoppedVerified:cleanup.stoppedVerified??cleanup.stopped??false,cleanupPath};await copyFile(cleanupPath,resolve(output,'cleanup.json'));await chmod(resolve(output,'cleanup.json'),0o600);try{await copyFile(resolve(fixture.cluster.directory,'validation.log'),resolve(output,'harness-validation.log'));}catch{}await writeFile(resolve(output,'postgres-result.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600,flag:'wx'});process.stdout.write(JSON.stringify(result)+'\n');assert.equal(result.stoppedVerified,true,'Exact owned cluster stop must be verified');}
