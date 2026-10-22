// Inert on import. New nonce-owned local PostgreSQL17 only; no serving import.
// --prepare writes a plan, --execute is finite; preview lifetime belongs to its
// separately logged loopback runner. All remote fetch is injected in process.
import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, stat, rm, readdir, copyFile } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PrismaClient } from '../../../../frontend/atlas-app/.generated/staff-database/index.js';
import { applyStandaloneBaseline, applyStandaloneMigrations } from '../../../atlas-standalone-database/migrate.mjs';
import { initializeStandaloneCoordination } from '../../../atlas-standalone-database/initialize.mjs';
import { localAccessConfig, seedLocalStaff, fixtureVerifyProvider } from '../../../../frontend/atlas-app/lib/server/access/fixture.mjs';
import { DurableStaffAuth } from '../../../../frontend/atlas-app/lib/server/access/auth.mjs';
import { StaffDatabase } from '../../../../frontend/atlas-app/lib/server/access/database.mjs';
import { staffGrantSQL } from '../../../../frontend/atlas-app/lib/server/access/privileges.mjs';
import { createDurableStaffBoundary } from '../../../atlas-manual-service/src/staff-auth.mjs';
import { canonical, digest } from '../../../atlas-manual-service/src/contract.mjs';
import { createManualArtifactStore } from '../../../atlas-manual-service/src/artifacts.mjs';
import { createFileArtifactTransport } from '../../../atlas-manual-service/scripts/file-artifacts.mjs';
import { createIntakeRepository } from '../../../atlas-manual-intake/src/repository.mjs';
import { publicationFixture } from '../publication-fixture.mjs';
import { createPublicationRepository } from '../../src/publication-repository.mjs';
import { createManualFinishing } from '../../src/finishing.mjs';
import { createPresentationMarket, marketPreviewHash, publishedMarketQuery } from '../../src/presentation-market.mjs';
import { createPresentationMarketService } from '../../src/presentation-market-service.mjs';
import { createCompCurationDatabase, inspectCompCurationSchema } from '../../src/comp-curation-database.mjs';
import { createStaffCompCurationProxyComposition, createStaffCompCurationPrivateAdapter } from '../../../../frontend/atlas-app/lib/server/staff-comp-curation-proxy-composition.mjs';
import { createStaffCompCurationResponseTransport } from '../../../../frontend/atlas-app/lib/staff-comp-curation-response-transport.mjs';
import { createHandler } from '../../../../frontend/atlas-app/lib/server/http.mjs';
import { assertProductionStaffRequest } from '../../../../frontend/atlas-app/lib/server/access/config.mjs';
import { readCardHistory } from '../../../../frontend/atlas-app/lib/card-history-client.mjs';
import { routeEnvelope } from '../../../atlas-site-router/routes.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const bin = '/opt/homebrew/opt/postgresql@17/bin', pgModule = '/Users/markthomas/.codex/atlas-handoffs/atlas-v4-labels-pg-runtime/node_modules/pg';
const ownPath = 'packages/atlas-connected-manual/test/fixtures/staff-comp-curation-journey-postgres.mjs';
const paths = [ownPath, 'frontend/atlas-app/test/staff-comp-curation-journey.test.mjs',
 'frontend/atlas-app/test/staff-comp-curation-ui-fixture.mjs','frontend/atlas-app/test/staff-comp-curation-fixture.mjs',
 'packages/atlas-connected-manual/src/comp-curation-database.mjs','packages/atlas-connected-manual/sql/comp-curation-role-proposal.sql',
 'packages/atlas-connected-manual/sql/comp-curation-proposal.sql','packages/atlas-connected-manual/src/comp-curation-service.mjs',
 'packages/atlas-connected-manual/src/comp-curation-contract.mjs','packages/atlas-connected-manual/src/publication-repository.mjs',
 'packages/atlas-connected-manual/src/finishing.mjs','packages/atlas-connected-manual/src/presentation-market.mjs',
 'packages/atlas-connected-manual/src/presentation-market-service.mjs','packages/atlas-connected-manual/src/presentation-repository.mjs','packages/atlas-connected-manual/src/transport.mjs',
 'packages/atlas-connected-manual/test/publication-fixture.mjs','packages/atlas-manual-service/src/staff-auth.mjs',
 'packages/atlas-manual-service/src/artifacts.mjs','packages/atlas-manual-service/scripts/file-artifacts.mjs',
 'packages/atlas-manual-intake/src/repository.mjs','packages/atlas-site-router/routes.mjs','packages/atlas-site-router/server.mjs','packages/atlas-site-router/report-entry.mjs',
 'packages/atlas-manual-workspace/src/sold-reference-ui.mjs','packages/atlas-grading-core/dist/identity.js','packages/atlas-grading-core/src/identity.ts',
 'frontend/atlas-app/lib/graded-cards-client.mjs','frontend/atlas-app/lib/order-desk-client.mjs','frontend/atlas-app/lib/routes.mjs',
 ...['staff-comp-curation-native-composition','staff-comp-curation-proxy-composition','staff-comp-curation-frontend-proxy','staff-comp-curation-frontend-runtime','staff-comp-curation-private-adapter','staff-comp-curation-transport-boundary','staff-comp-curation-http','http','policy','access/auth','access/database','access/config','access/fixture','access/privileges'].map(n=>`frontend/atlas-app/lib/server/${n}.mjs`),
 ...['staff-comp-curation-response-transport','staff-comp-curation-transport-contract','staff-comp-curation-client','staff-comp-curation-controller','staff-comp-curation-entry','card-history-client'].map(n=>`frontend/atlas-app/lib/${n}.mjs`),
 ...['CardHistory.jsx','StaffCompCuration.jsx','StaffCompCuration.module.css'].map(n=>`frontend/atlas-app/components/${n}`),
 'packages/atlas-standalone-database/sql/baseline.sql','packages/atlas-standalone-database/baseline.manifest.json','packages/atlas-standalone-database/migrations.manifest.json',
 ...['002-variant-label-retry','003-report-image-retry','004-label-sheets','005-photoroom-removal','006-variant-shared-label-retry','007-label-layout-retry','008-graded-cards-archive','009-card-provenance','010-collection-foundation'].map(n=>`packages/atlas-standalone-database/sql/${n}.sql`)];
const save = (path, value) => writeFile(path, JSON.stringify(value, null, 2)+'\n', {flag:'wx',mode:0o600});
const pin = async path => ({path,sha256:digest(await readFile(path))});
function noInheritedDatabase() { assert(!Object.keys(process.env).some(k=>/^(DATABASE_URL|DIRECT_URL|ATLAS_DATABASE_URL|PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATA|PGSERVICE|PGSERVICEFILE)$/.test(k))); }
export function validateCompJourneyPlan(plan,output,purpose) {
 assert.equal(plan.schema,'atlas-comp-journey-owned-pg-v1');assert.equal(plan.purpose,purpose);assert(['finite','preview'].includes(purpose));
 assert.equal(resolve(output),output);assert.equal(plan.output,output);assert.equal(plan.directory,resolve(output,'cluster'));assert.equal(plan.data,resolve(plan.directory,'data'));
 assert.equal(plan.host,'127.0.0.1');assert.equal(plan.unixSockets,false);assert.equal(plan.bin,bin);assert.equal(plan.pgModule,pgModule);assert.equal(plan.policy,null);
 assert.match(plan.nonce,/^[a-f0-9]{32}$/);assert(Number.isInteger(plan.port)&&plan.port>=1024&&plan.port<=65535);
 assert.deepEqual(plan.sources.map(r=>r.path),paths);for(const ref of plan.sources)assert.match(ref.sha256,/^[a-f0-9]{64}$/);
 for(const ref of [plan.roleResult,plan.schemaRef]){assert.equal(resolve(ref.path),ref.path);assert.match(ref.sha256,/^[a-f0-9]{64}$/);}
 assert.match(plan.schemaSha256,/^[a-f0-9]{64}$/);assert.equal(plan.listener,null);assert.equal(plan.noProvider,true);assert.equal(plan.noProduction,true);
 return plan;
}
export async function prepareCompJourney({output,roleResult,schemaPath,purpose='finite',dbPort=55439}) {
 noInheritedDatabase(); assert(resolve(output)===output); assert(['finite','preview'].includes(purpose));
 assert(Number.isInteger(dbPort)&&dbPort>=1024&&dbPort<=65535);
 const receipt=JSON.parse(await readFile(roleResult,'utf8')),schema=JSON.parse(await readFile(schemaPath,'utf8'));
 assert.equal(receipt.pass,true);assert.equal(receipt.stoppedVerified,true);assert.equal(receipt.schemaSha256,schema.sha256);
 assert.match(schema.sha256,/^[a-f0-9]{64}$/);assert.equal(receipt.policy,null);
 for(const ref of receipt.sourceRefs) assert.equal(digest(await readFile(resolve(root,ref.path))),ref.sha256,ref.path);
 await mkdir(output,{mode:0o700});await mkdir(resolve(output,'cluster'),{mode:0o700});await mkdir(resolve(output,'source-used'),{mode:0o700});
 const sources=[];for(const path of paths){const b=await readFile(resolve(root,path));sources.push({path,sha256:digest(b)});await writeFile(resolve(output,'source-used',path.replaceAll('/','__')),b,{flag:'wx',mode:0o600});}
 const plan={schema:'atlas-comp-journey-owned-pg-v1',purpose,output,directory:resolve(output,'cluster'),data:resolve(output,'cluster/data'),
  host:'127.0.0.1',unixSockets:false,port:dbPort,nonce:randomBytes(16).toString('hex'),bin,pgModule,roleResult:await pin(roleResult),schemaRef:await pin(schemaPath),schemaSha256:schema.sha256,
  sources,pinScope:'Explicit listed fixture/authority modules and all direct custom hook-driver imports; not a full vendor/transitive runtime closure',sourceCommit:spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).stdout.trim(),policy:null,
  actual:['CardHistory/StaffCompCuration source','Response transport','frontend proxy and original-byte HMAC signer','private adapter/native composition','DurableStaffAuth','restricted comp role/checker','curation and saved-market services'],
  synthetic:['parent history/media projection','local seeded published approval/pool','site-router ingress signer and local-only sessions','private network is in-process injected fetch'],
  noProvider:true,noProduction:true,listener:null,entryReadGrant:{schemas:['atlas_manual','atlas_manual_intake'],select:['atlas_manual.card','atlas_manual.publication','atlas_manual.public_report_identity','atlas_manual.presentation','atlas_manual.presentation_market','atlas_manual_intake.card','atlas_manual_intake.discarded_card'],execute:['atlas_manual.authenticate(text,text,jsonb,text[])'],updateIdLockOnly:['atlas_manual.card','atlas_manual_intake.card'],insert:[],qualification:'Fixture-only companion; not an operational role proposal'}};
 validateCompJourneyPlan(plan,output,purpose);await save(resolve(output,'launch-plan.json'),plan);return {planPath:resolve(output,'launch-plan.json'),sha256:digest(await readFile(resolve(output,'launch-plan.json'))),port:dbPort,nonce:plan.nonce,purpose};
}
export async function openCompJourney(output, purpose) {
 noInheritedDatabase();const planPath=resolve(output,'launch-plan.json'),plan=JSON.parse(await readFile(planPath,'utf8'));
 validateCompJourneyPlan(plan,output,purpose);
 for(const ref of plan.sources)assert.equal(digest(await readFile(resolve(root,ref.path))),ref.sha256,ref.path);
 for(const ref of [plan.roleResult,plan.schemaRef])assert.equal(digest(await readFile(ref.path)),ref.sha256,ref.path);
 const qualified=JSON.parse(await readFile(plan.roleResult.path,'utf8'));assert.equal(qualified.pass,true);assert.equal(qualified.stoppedVerified,true);assert.equal(qualified.schemaSha256,plan.schemaSha256);
 await assert.rejects(stat(plan.data),{code:'ENOENT'});await save(resolve(output,'execute-intent.json'),{nonce:plan.nonce,planSha256:digest(await readFile(planPath)),pid:process.pid});
 const {Client}=createRequire(import.meta.url)(pgModule),clients=new Set(),sockets=new Set(),compositions=new Set();
 const passwords=Array.from({length:3},()=>randomBytes(24).toString('hex')),ownerRole='atlas_fixture_owner',staffRole='atlas_fixture_staff',role='atlas_fixture_curation';
 const dbName=`atlas_journey_${plan.nonce.slice(0,12)}`;
 const url=(who,database=dbName)=>`postgresql://${who}:${passwords[[ownerRole,staffRole,role].indexOf(who)]}@127.0.0.1:${plan.port}/${database}?schema=${who===role?'atlas_manual':'atlas_staff'}&connection_limit=4`;
 const cleanEnv={HOME:process.env.HOME,PATH:'/usr/bin:/bin:/opt/homebrew/bin',LANG:'C'};
 let log='',started=false,closed=false,db,admin;const extraSecrets=[]; const checks=[],phases=[],exchanges=[],privateExchanges=[];
 const safe=v=>[...passwords,...extraSecrets].reduce((s,p)=>s.replaceAll(p,'[fixture-secret]'),String(v));
 const run=(cmd,args)=>{const r=spawnSync(cmd,args,{env:cleanEnv,encoding:'utf8',timeout:120000,maxBuffer:8e6});log+=safe((r.stdout??'')+(r.stderr??''));assert.equal(r.status,0,safe(r.error?.message??r.stderr));return r.stdout;};
 const open=who=>{const c=new PrismaClient({datasources:{db:{url:url(who)}}});clients.add(c);return c;};
 const socket=async(who=ownerRole,database=dbName)=>{const c=new Client({connectionString:url(who,database),connectionTimeoutMillis:3000});await c.connect();sockets.add(c);return c;};
 const raw=c=>({$queryRawUnsafe:async(q,...v)=>(await c.query(q,v)).rows,$executeRawUnsafe:async(q,...v)=>(await c.query(q,v)).rowCount});
 async function close(result={pass:false,reason:'No finite result'}) {
  if(closed)return;closed=true;for(const c of compositions)c.close();db?.close();
  const disconnected=await Promise.allSettled([...clients].map(c=>c.$disconnect()));await Promise.allSettled([...sockets].map(c=>c.end()));
  let stoppedVerified=false;
  if(started){const sentinel=JSON.parse(await readFile(resolve(plan.directory,'ownership.json'),'utf8'));
   assert.equal(sentinel.nonce,plan.nonce);assert.equal(sentinel.ownerPid,process.pid);assert.equal((await stat(plan.directory)).uid,process.getuid());
   const status=spawnSync(resolve(bin,'pg_ctl'),['-D',plan.data,'status'],{env:cleanEnv});
   if(status.status===0)run(resolve(bin,'pg_ctl'),['-D',plan.data,'-m','fast','-w','stop']);else assert.equal(status.status,3);
   assert.equal(spawnSync(resolve(bin,'pg_ctl'),['-D',plan.data,'status'],{env:cleanEnv}).status,3);
   await rm(plan.data,{recursive:true});await assert.rejects(stat(plan.data),{code:'ENOENT'});stoppedVerified=true;
  }
  await writeFile(resolve(output,'validation.log'),log,{flag:'wx',mode:0o600});
  await save(resolve(output,'cleanup.json'),{stoppedVerified,ownedDataAbsent:stoppedVerified,nonce:plan.nonce,directory:plan.directory,clientDisconnects:disconnected.map(r=>r.status)});
  await copyFile(resolve(plan.directory,'postgres.log'),resolve(output,'postgres.log')).catch(()=>{});
  await save(resolve(output,'postgres-result.json'),{...result,checks,phases,exchanges,privateExchanges,sourceRefs:plan.sources,planSha256:digest(await readFile(planPath)),schemaSha256:plan.schemaSha256,
   policy:null,node:process.version,stoppedVerified,syntheticOnly:true,productionQueries:0,externalProviderCalls:0,storageProviderCalls:0,notificationEffects:0,actualBrowser:false,
   ownedDirectory:plan.directory,port:plan.port,nonce:plan.nonce,cleanupSha256:digest(await readFile(resolve(output,'cleanup.json')))});
 }
 try {
  await save(resolve(plan.directory,'ownership.json'),{nonce:plan.nonce,data:plan.data,ownerPid:process.pid,uid:process.getuid(),createdByHarness:true,port:plan.port});
  const pw=resolve(plan.directory,'owner-password');await writeFile(pw,passwords[0],{flag:'wx',mode:0o600});
  assert.match(run(resolve(bin,'postgres'),['--version']),/PostgreSQL\) 17\./);
  run(resolve(bin,'initdb'),['-D',plan.data,'--username',ownerRole,'--pwfile',pw,'--auth-host=scram-sha-256','--auth-local=reject','--encoding=UTF8','--locale=C']);started=true;
  run(resolve(bin,'pg_ctl'),['-D',plan.data,'-l',resolve(plan.directory,'postgres.log'),'-o',`-h 127.0.0.1 -p ${plan.port} -c unix_socket_directories=''`,'-w','start']);await rm(pw);
  const control=await socket(ownerRole,'postgres');assert.deepEqual((await control.query("SELECT current_setting('data_directory') data,current_setting('listen_addresses') host,current_setting('unix_socket_directories') sockets")).rows[0],{data:plan.data,host:'127.0.0.1',sockets:''});
  await control.query(`CREATE DATABASE ${dbName}`);const setup=await socket();
  await applyStandaloneBaseline(setup);await applyStandaloneMigrations(setup);await initializeStandaloneCoordination(setup,{geometryConcurrency:2});
  await setup.query(await readFile(resolve(root,'packages/atlas-connected-manual/sql/comp-curation-proposal.sql'),'utf8'));
  await setup.query(`REVOKE TEMPORARY ON DATABASE ${dbName} FROM PUBLIC`);
  for(const [i,who]of [[1,staffRole],[2,role]])await control.query(`CREATE ROLE ${who} LOGIN PASSWORD '${passwords[i]}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`);
  await setup.query(staffGrantSQL(staffRole));await setup.query((await readFile(resolve(root,'packages/atlas-connected-manual/sql/comp-curation-role-proposal.sql'),'utf8')).replaceAll(':"curation_role"',`"${role}"`));
  await setup.query('SET search_path=pg_catalog');const observed=await inspectCompCurationSchema(raw(setup));assert.equal(observed.sha256,plan.schemaSha256,'Existing independently reviewed schema pin required');await save(resolve(output,'observed-owned-schema.json'),observed);
  admin=open(ownerRole);const staffClient=open(staffRole),restricted=open(role);
  const config=localAccessConfig({databaseUrl:url(staffRole),sessionKey:randomBytes(32),phoneKey:randomBytes(32),phones:['+12025550141','+12025550142','+12025550143']});await seedLocalStaff(admin,config,{trained:true});
  const auth=new DurableStaffAuth({database:new StaffDatabase(staffClient,config),config,provider:fixtureVerifyProvider(config)});
  db=createCompCurationDatabase({client:restricted,role,schemaOwner:ownerRole,schemaSha256:plan.schemaSha256});const boundary=createDurableStaffBoundary({auth,manualClient:db});
  const objectDirectory=resolve(plan.directory,'artifacts');await mkdir(objectDirectory,{mode:0o700});const artifacts=createManualArtifactStore({transport:await createFileArtifactTransport(objectDirectory)});
  const intake=createIntakeRepository({boundary,keyPrefix:'journey-synthetic',maxOriginalBytes:65536});const validateAccess=({tx,cardId})=>intake.assertActiveInTransaction(tx,cardId);
  async function login(phone){const boot=await auth.bootstrap(''),initial=`${config.cookies.browser}=${boot.browserToken}`;
   const challenge=await auth.send(initial,boot.csrf,{phone,requestId:randomUUID()},'journey-local');const signed=await auth.verify(initial,boot.csrf,{challengeId:challenge.challengeId,code:'424242'},'journey-local');
   const cookie=`${initial}; ${config.cookies.session}=${signed.token}`,staff=await auth.authenticate(cookie,signed.csrf);return {staff,principal:{id:staff.id},cookie,csrf:signed.csrf};}
  const owner=await login('+12025550141'),other=await login('+12025550143');
  const f = await publicationFixture(); await f.publication.publish({}, f.cardId, f.actionId);
  const row = f.row, actionResult = JSON.parse(row.result); actionResult.receipt.actorId = owner.principal.id;
  const originalManifest = JSON.parse(row.manifest), packet = await f.artifacts.read(originalManifest.packet.ref,
    { cardId: f.cardId, kind: 'PUBLIC_REPORT', sourceHash: originalManifest.packet.sourceHash });
  const packetRef = await artifacts.write(packet, { cardId: f.cardId, kind: 'PUBLIC_REPORT', sourceHash: row.public_hash });
  const manifest = canonical({ ...originalManifest, packet: { ref: packetRef, sourceHash: row.public_hash } });
  await admin.$executeRawUnsafe('INSERT INTO atlas_manual.card(id,revision,content,content_hash,owner_id,approvers) VALUES($1::uuid,11,$2,$3,$4::uuid,$5::uuid[])',
    f.cardId, canonical(f.draft), row.source_hash, owner.principal.id, [other.principal.id]);
  await admin.$executeRawUnsafe('INSERT INTO atlas_manual_intake.card(id,pair_id,owner_id,create_request_id,create_request_hash,label) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6)',
    f.cardId, randomUUID(), owner.principal.id, randomUUID(), digest('synthetic-journey-curation'), 'SYNTHETIC RESTRICTED JOURNEY ONLY');
  async function seedApproval(actionId, version, published) {
    const value = structuredClone(actionResult); value.receipt.actionId = actionId;
    await admin.$executeRawUnsafe('INSERT INTO atlas_manual.action(card_id,action_id,actor_id,expected_revision,result_revision,request_hash,request,result) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8)',
      f.cardId, actionId, owner.principal.id, version === 1 ? 10 : 11, version === 1 ? 11 : 12, digest('{}'), '{}', canonical(value));
    await admin.$executeRawUnsafe('INSERT INTO atlas_manual.approval(card_id,action_id,actor_id,source_revision,source_hash,report_hash,report,approved_at) VALUES($1::uuid,$2::uuid,$3::uuid,10,$4,$5,$6,$7::timestamptz)',
      f.cardId, actionId, owner.principal.id, row.source_hash, row.report_hash, row.report, row.approved_at);
    if (version === 1) await admin.$executeRawUnsafe('INSERT INTO atlas_manual.public_report_identity(card_id,public_token,report_number) VALUES($1::uuid,$2,$3)', f.cardId, row.public_token, row.report_number);
    await admin.$executeRawUnsafe("INSERT INTO atlas_manual.publication(card_id,action_id,version,mode) VALUES($1::uuid,$2::uuid,$3,'LOCAL_FIXTURE')", f.cardId, actionId, version);
    if (published) await admin.$executeRawUnsafe("UPDATE atlas_manual.publication SET state='PUBLISHED',manifest=$1,manifest_hash=$2,public_hash=$3,published_at=clock_timestamp() WHERE card_id=$4::uuid AND action_id=$5::uuid",
      manifest, digest(manifest), row.public_hash, f.cardId, actionId);
  }
  await seedApproval(f.actionId, 1, true);
  // Existing v2 projector: designation is unknown, never inferred STANDARD.
  const previewId = randomUUID(), source = { packet, publicHash: row.public_hash }, context = publishedMarketQuery(source);
  const items = [{ id: 'synthetic-saved:1', title: 'SYNTHETIC retained sale', listingUrl: 'https://www.ebay.com/itm/123456789100',
    imageUrl: null, soldDate: '2026-10-19', soldPriceCents: 1000, currency: 'USD', priceBasis: 'EXACT' }];
  const preview = createPresentationMarket().project(source, { responsePolicy: 'ATLAS_SLAB_V1', source: 'EBAY_SOLD', engineVersion: 'ebay-sold-comps-v2.3.0',
    query: context.query, retrievedAt: '2026-10-20T12:00:00.000Z', items, acquisitionDiagnostics: { returnedItemCount: 1 },
    imageMatch: { policy: 'atlas-market-slab-label-v1', counts: {}, readings: [{ rowId: items[0].id, evidenceKind: 'SLABBED', identityMatch: 'MATCH',
      numericGrade: 9, gradingCompany: 'PSA', labelText: null, sha256: null, reason: 'Synthetic offline qualification' }] } }).preview;
  assert.equal(preview.version, 'atlas-market-preview-v2');
  assert(preview.candidates.every(candidate => candidate.sale.designation === null));
  const artifactHash = digest(JSON.stringify(preview)), ref = await artifacts.write(preview, { cardId: f.cardId, kind: 'MARKET_PREVIEW', sourceHash: artifactHash });
  const marketRequest = canonical({ requestId: previewId, approvalActionId: f.actionId, expectedRevision: 0 });
  await admin.$executeRawUnsafe('INSERT INTO atlas_manual.presentation_market(card_id,approval_action_id,request_id,actor_id,request,request_hash) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6)',
    f.cardId, f.actionId, previewId, owner.principal.id, marketRequest, digest(marketRequest));
  const marketResult = canonical({ state: 'READY', ref, artifactHash, sourceHash: marketPreviewHash(preview) });
  await admin.$executeRawUnsafe("UPDATE atlas_manual.presentation_market SET state='READY',result=$1,result_hash=$2 WHERE card_id=$3::uuid AND request_id=$4::uuid", marketResult, digest(marketResult), f.cardId, previewId);
  const approved=createManualFinishing({repository:createPublicationRepository({boundary,validateAccess}),artifacts});
  // The saved-market entry has a separate READ client. It is not the curation
  // writer and its actual repository also reads presentation, outside SELECT9.
  const readerRole='atlas_fixture_market_reader',readerPassword=randomBytes(24).toString('hex');extraSecrets.push(readerPassword);
  await control.query(`CREATE ROLE ${readerRole} LOGIN PASSWORD '${readerPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`);
  await setup.query(`GRANT USAGE ON SCHEMA atlas_manual,atlas_manual_intake TO ${readerRole};
    GRANT SELECT ON atlas_manual.card,atlas_manual.publication,atlas_manual.public_report_identity,atlas_manual.presentation,atlas_manual.presentation_market,atlas_manual_intake.card,atlas_manual_intake.discarded_card TO ${readerRole};
    GRANT EXECUTE ON FUNCTION atlas_manual.authenticate(text,text,jsonb,text[]) TO ${readerRole};
    GRANT UPDATE(id) ON atlas_manual.card,atlas_manual_intake.card TO ${readerRole};`);
  const readerUrl=new URL(url(role));readerUrl.username=readerRole;readerUrl.password=readerPassword;
  const readerClient=new PrismaClient({datasources:{db:{url:readerUrl.href}}});clients.add(readerClient);
  const readBoundary=createDurableStaffBoundary({auth,manualClient:readerClient});
  const {createPresentationRepository}=await import('../../src/presentation-repository.mjs');
  const readIntake=createIntakeRepository({boundary:readBoundary,keyPrefix:'journey-reader',maxOriginalBytes:65536});
  const market=createPresentationMarketService({repository:createPresentationRepository({boundary:readBoundary,keyPrefix:'journey-reader',
    validateAccess:({tx,cardId})=>readIntake.assertActiveInTransaction(tx,cardId)}),approved,artifacts});
  assert.equal(market.enabled,false);
  const cardId=f.cardId,readInput={approvalActionId:f.actionId,previewId},hooks={};
  const ingress={mode:'PRODUCTION',origin:'https://atlasgrading.com',basePath:'/admin',application:'atlas-staff',
    deploymentId:'synthetic-journey.vercel.app',routerKey:randomBytes(32)};
  // These hostname strings are signed input only. No DNS, fetch or listener is
  // used for them: the private fetch capability below dispatches in-process.
  const key=randomBytes(32),privateOrigin='https://synthetic-journey.atlasgrading.com';
  const native=createStaffCompCurationPrivateAdapter({enabled:true,key,origin:ingress.origin,
    native:{environment:{},auth,boundary,approved,artifacts,validateAccess}});compositions.add(native);
  async function invoke(handler,req){let status=200,payload;const headers=new Headers({'content-type':'application/json'});
    const res={setHeader(k,v){headers.set(k,Array.isArray(v)?v.join(', '):v);},status(n){status=n;return this;},json(v){payload=v;return this;}};
    const handled=await handler(req,res);assert(handled!==false,'Fixture dispatch cannot fall through');return {status,payload,headers};}
  const proxy=createStaffCompCurationProxyComposition({enabled:true,auth,origin:ingress.origin,privateOrigin,key,
    staffKeys:[config.sessionKey,config.phoneKey,ingress.routerKey],assertRequest(req){assertProductionStaffRequest(req,ingress);},
    async fetchImpl(target,options){const u=new URL(target);assert.equal(u.origin,privateOrigin);
      const req={method:options.method,url:u.pathname+u.search,headers:{...options.headers},rawBody:Buffer.from(options.body??'')};
      const result=await invoke(native.handler,req);
      const body=req.rawBody.length?JSON.parse(req.rawBody):null;
      privateExchanges.push({method:req.method,path:req.url,status:result.status,rawBodySha256:digest(req.rawBody),
        ...(body?{requestId:body.requestId,outcome:body.outcome,...(result.status===200?{receiptRequestId:result.payload.result.requestId,receiptRevision:result.payload.result.revision}:{} )}:{}),...(result.status!==200?{error:result.payload.error}:{})});
      await hooks.afterNative?.({method:req.method,body,result});
      return new Response(JSON.stringify(result.payload),{status:result.status,headers:result.headers});
    }});compositions.add(proxy);
  const actualSession=createHandler({auth,origin:ingress.origin,mode:'SYNTHETIC_LOCAL',cookies:config.cookies,
    assertRequest(req){assertProductionStaffRequest(req,ingress);}},{});
  let active=owner;
  async function frontFetch(path,options={}) {
    assert.equal(closed,false);assert.equal(options.credentials,'same-origin');assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');
    assert(path.startsWith('/admin/api/staff/'));const method=options.method??'GET',internal=path.slice(6),captured=active;
    await hooks.beforeFrontend?.({method,path});
    const issuedAt=Date.now(),proof=createHmac('sha256',ingress.routerKey).update(routeEnvelope({zone:'staff',deployment:`https://${ingress.deploymentId}`,method,target:path,issuedAt})).digest('hex');
    const supplied=Object.fromEntries(new Headers(options.headers).entries());
    const req={method,url:internal,body:options.body===undefined?'':JSON.parse(options.body),socket:{remoteAddress:'127.0.0.1'},
      headers:{host:'atlasgrading.com','x-forwarded-host':'atlasgrading.com','x-forwarded-proto':'https',cookie:captured.cookie,
        'x-atlas-route-issued':String(issuedAt),'x-atlas-route-target':path,'x-atlas-route-proof':proof,
        ...(method==='POST'?{origin:ingress.origin}:{}),...supplied}};
    let result;
    if(internal==='/api/staff/session') {assert.equal(method,'GET');result=await invoke(actualSession,req);}
    else if(internal===`/api/staff/manual-connected/cards/${cardId}/presentation/market`){
      assert.equal(method,'GET');assertProductionStaffRequest(req,ingress);
      try {const staff=await auth.authenticate(captured.cookie),payload=await market.status(staff,cardId);await auth.authenticate(captured.cookie);
        result={status:200,payload,headers:new Headers({'content-type':'application/json','cache-control':'private, no-store'})};
      } catch(error){result={status:error.status??503,payload:{error:error.code??'COMP_UNAVAILABLE'},headers:new Headers({'content-type':'application/json','cache-control':'private, no-store'})};}
    } else {result=await invoke(proxy.handler,req);}
    exchanges.push({method,path,status:result.status,...(req.body?.requestId?{requestId:req.body.requestId}:{}),...(result.status!==200?{error:result.payload.error}:{})});
    return new Response(JSON.stringify(result.payload),{status:result.status,headers:result.headers});
  }
  const card={cardId,approvalActionId:f.actionId,sourceRevision:row.source_revision,sourceHash:row.source_hash,mode:'LOCAL_FIXTURE',
    report:{state:'PUBLISHED',publicToken:row.public_token,version:1,publicHash:row.public_hash,reportHash:row.report_hash}};
  // Explicit seeded parent projection, not a claim of provenance-reader/media
  // privilege. Its exact approval/report binding comes from the seeded row.
  const detail=readCardHistory({schemaVersion:1,card:{...card,certificateNumber:row.report_number,identity:{category:'SPORTS',playerName:'SYNTHETIC restricted-role journey'},
    finalGrade:9,approvedAt:row.approved_at.replace('.000Z','.000000Z'),report:{...card.report,path:`/reports/${row.public_token}?v=1`},media:{},
    savedComparables:{state:'UNAVAILABLE'}},
    ownership:{status:'UNKNOWN',verification:'UNKNOWN',history:[]},custody:{status:'UNKNOWN',currentPhysicalHolder:'UNKNOWN'},
    history:{scope:'RECORDED_ATLAS_EVENTS',complete:false,snapshot:'2026-10-22T08:00:00.000000Z',events:[],nextCursor:null}},cardId);
  async function parentRequest(path,{signal}={}){if(signal?.aborted)throw new Error('Fixture request cancelled');
    if(path==='session'){const r=await frontFetch('/admin/api/staff/session',{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{}});return r.json();}
    assert.equal(path,`manual-connected/cards/${cardId}/provenance?limit=50`);await auth.authenticate(active.cookie);return structuredClone(detail);}
  function browser(){const value=createStaffCompCurationResponseTransport({enabled:true,staff:active.staff,fetchImpl:frontFetch,events:new EventTarget()});compositions.add(value);return value;}
  const tables=await admin.$queryRawUnsafe("SELECT n.nspname schema,c.relname name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname LIKE 'atlas\\_%' ESCAPE '\\' ORDER BY n.nspname,c.relname");assert(tables.length>100);
  async function census(){const out={};for(const t of tables){assert(/^[A-Za-z_][A-Za-z0-9_]*$/.test(t.schema)&&/^[A-Za-z_][A-Za-z0-9_]*$/.test(t.name));out[`${t.schema}.${t.name}`]=(await admin.$queryRawUnsafe(`SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) value FROM "${t.schema}"."${t.name}" r`))[0].value;}return out;}
  async function files(dir=objectDirectory){const out=[];for(const e of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const path=resolve(dir,e.name);if(e.isDirectory())out.push(...await files(path));else{assert(e.isFile());const bytes=await readFile(path);out.push({path:relative(objectDirectory,path),byteCount:bytes.length,sha256:digest(bytes)});}}return out;}
  function differences(a,b){const out={};for(const key of Object.keys(a)){const before=a[key].map(JSON.stringify),after=b[key].map(JSON.stringify);if(JSON.stringify(before)!==JSON.stringify(after))out[key]={removed:before.filter(v=>!after.includes(v)).map(JSON.parse),added:after.filter(v=>!before.includes(v)).map(JSON.parse)};}return out;}
  const counts=delta=>Object.fromEntries(Object.entries(delta).map(([key,v])=>[key,{removed:v.removed.length,added:v.added.length}]));
  const baseline=await census(),initialArtifacts=await files();
  async function phase(name,expected,work){const before=await census(),objects=await files();const value=await work();const after=await census(),delta=differences(before,after);
    assert.deepEqual(counts(delta),expected,name);assert.deepEqual(await files(),objects,name);phases.push({name,tableCount:tables.length,before:digest(JSON.stringify(before)),after:digest(JSON.stringify(after)),changes:counts(delta),exactDelta:delta});return value;}
  async function result(){const final=await census(),delta=differences(baseline,final);assert.deepEqual(await files(),initialArtifacts);
    const intended=new Map();for(const wire of privateExchanges.filter(r=>r.method==='POST'&&r.status===200)){
      assert.equal(wire.receiptRequestId,wire.requestId);const prior=intended.get(wire.requestId);if(prior)assert.deepEqual(prior,{outcome:wire.outcome,revision:wire.receiptRevision});
      intended.set(wire.requestId,{outcome:wire.outcome,revision:wire.receiptRevision});}
    const expectedCount=purpose==='finite'?5:intended.size;
    assert.deepEqual(counts(delta),expectedCount?{'atlas_manual.comp_curation':{removed:0,added:expectedCount}}:{});
    assert.equal(intended.size,expectedCount);
    for(const added of delta['atlas_manual.comp_curation']?.added??[]){const r=JSON.parse(added.receipt);assert.equal(r.policy,null);assert.equal(r.guidance,null);assert.equal(r.reportSnapshotUnaffected,true);
      assert.equal(added.actor_id,owner.staff.id);assert.deepEqual(intended.get(added.request_id),{outcome:r.outcome,revision:r.revision});}
    if(purpose==='finite')assert.deepEqual([...intended.values()].sort((a,b)=>a.revision-b.revision).map(r=>r.outcome),['SKIP','NO_SUITABLE_COMPS','SKIP','SKIP','SKIP']);
    return {pass:true,tableCount:tables.length,wholeJourney:{changes:counts(delta),unchangedTables:tables.length-Object.keys(delta).length},artifactsPreserved:initialArtifacts,
      actualMountedSource:true,actualBrowser:false,syntheticParentProjection:true,dedicatedRole:role,readRole:readerRole};}
  return {plan,owner,other,card,detail,previewId,readInput,frontFetch,parentRequest,browser,hooks,exchanges,privateExchanges,checks,phase,result,close,
    setActor(which){assert(['owner','other'].includes(which));active=which==='owner'?owner:other;},
    async metrics(){const rows=await admin.$queryRawUnsafe('SELECT receipt FROM atlas_manual.comp_curation WHERE card_id=$1::uuid ORDER BY revision',cardId);
      return {decisions:rows.length,posts:privateExchanges.filter(r=>r.method==='POST').length,gets:privateExchanges.filter(r=>r.method==='GET').length,last:rows.length?JSON.parse(rows.at(-1).receipt):null};},
    async appendLaterReceipt(body){const reply=await frontFetch(`/admin/api/staff/comp-curation/cards/${cardId}/decision`,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',
      headers:{'content-type':'application/json','x-atlas-csrf':owner.csrf},body:JSON.stringify({...body,requestId:randomUUID(),expectedSelectionRevision:body.expectedSelectionRevision+1})});assert.equal(reply.status,200);return reply.json();},
  };
 }catch(error){await close({pass:false,error:{code:error.code,message:safe(error.message),stack:safe(error.stack)}});throw error;}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [mode,output,...rest]=process.argv.slice(2);
 if(mode==='--check-driver-import'){assert.equal(output,undefined);assert.equal(rest.length,0);const driver=await import('../../../../frontend/atlas-app/test/staff-comp-curation-journey.test.mjs');assert.equal(typeof driver.runMountedCompJourney,'function');console.log('MOUNTED_DRIVER_IMPORT_SETTLED');}
 else if(mode==='--prepare'){assert.equal(rest.length,4);console.log(JSON.stringify(await prepareCompJourney({output,roleResult:rest[0],schemaPath:rest[1],purpose:rest[2],dbPort:Number(rest[3])})));}
 else if(mode==='--execute'){assert.equal(rest.length,0);let journey;try{journey=await openCompJourney(output,'finite');
   const {runMountedCompJourney}=await import('../../../../frontend/atlas-app/test/staff-comp-curation-journey.test.mjs');await runMountedCompJourney(journey);
   await journey.close(await journey.result());console.log(JSON.stringify({pass:true,output}));
  }catch(error){if(journey)await journey.close({pass:false,error:{code:error.code,message:error.message,stack:error.stack}});throw error;}}
 else throw new Error('Explicit --prepare or --execute required');
}
