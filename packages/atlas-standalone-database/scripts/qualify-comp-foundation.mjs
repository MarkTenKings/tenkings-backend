// Finite owned SQL011 rehearsal. Import is inert; prepare performs local file I/O
// only. Execution requires the separate exact reviewed plan hash and fresh intent.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, stat, rm, copyFile, readdir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '../../../frontend/atlas-app/.generated/staff-database/index.js';
import { applyStandaloneBaseline, applyStandaloneMigrations } from '../migrate.mjs';
import { registeredMigrations } from '../registered-migrations.mjs';
import { assertRegisteredCompFoundation } from '../test/comp-foundation-fixture.mjs';
import { localConfig as customerLocalConfig } from '../../../frontend/atlas-customer/lib/server/fixture.mjs';
import { standaloneRoleSQL } from '../grants.mjs';
import { localAccessConfig, seedLocalStaff, fixtureVerifyProvider } from '../../../frontend/atlas-app/lib/server/access/fixture.mjs';
import { DurableStaffAuth } from '../../../frontend/atlas-app/lib/server/access/auth.mjs';
import { StaffDatabase } from '../../../frontend/atlas-app/lib/server/access/database.mjs';
import { makeAccessConfig } from '../../../frontend/atlas-app/lib/server/access/config.mjs';
import { createDurableStaffBoundary } from '../../atlas-manual-service/src/staff-auth.mjs';
import { canonical, digest } from '../../atlas-manual-service/src/contract.mjs';
import { createManualArtifactStore } from '../../atlas-manual-service/src/artifacts.mjs';
import { createFileArtifactTransport } from '../../atlas-manual-service/scripts/file-artifacts.mjs';
import { createIntakeRepository } from '../../atlas-manual-intake/src/repository.mjs';
import { publicationFixture } from '../../atlas-connected-manual/test/publication-fixture.mjs';
import { createPublicationRepository } from '../../atlas-connected-manual/src/publication-repository.mjs';
import { createManualFinishing } from '../../atlas-connected-manual/src/finishing.mjs';
import { createPresentationMarket, marketPreviewHash, publishedMarketQuery } from '../../atlas-connected-manual/src/presentation-market.mjs';
import { createNativeCompCurationRuntime } from '../../atlas-connected-manual/src/comp-curation-runtime.mjs';
import { createPrivateManualNonceStore, createManualServiceProxy } from '../../atlas-connected-manual/src/transport.mjs';
import { createCompCurationService } from '../../atlas-connected-manual/src/comp-curation-service.mjs';
import { createCompCurationDatabase, assertCompCurationDatabase, inspectCompCurationSchema } from '../../atlas-connected-manual/src/comp-curation-database.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const hash = x => createHash('sha256').update(x).digest('hex');
const stable = x => JSON.stringify(x, (_k, v) => v && Object.getPrototypeOf(v) === Object.prototype ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
const save = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
export const COMP_VERSION = 'atlas-standalone-011-comp-curation';
export const COMP_SCHEMA_SHA = 'a1bbdf297ec7c426358a9f6dee0fd90fb23a109bb92007f0b2ccfa5b3b842ff7';
const PROPOSAL_SHA = '3eb42a3f93e4caf7b9e1a53cecd5290ad6b0aaf22cbe35bd039951f8e6cbf0d2';
const MIGRATION_SHA = 'aa19879134c9ad6261fa33ad96ed0f5be6ee2e498b601c3e2f12deee407fe36a';
const PREFIX = [
  {
    "version": "atlas-standalone-002-variant-label-retry",
    "file": "sql/002-variant-label-retry.sql",
    "sqlSha256": "dae816990ab42d99204bf07f2a009af4e4ca92ccaab154da213137492be84396"
  },
  {
    "version": "atlas-standalone-003-report-image-retry",
    "file": "sql/003-report-image-retry.sql",
    "sqlSha256": "550d947fb3dc00cd56358896a755f3e2825b48fe37b7fa3124e86f90e2cfa586"
  },
  {
    "version": "atlas-standalone-004-label-sheets",
    "file": "sql/004-label-sheets.sql",
    "sqlSha256": "7f8bd1c94defc85ad6c8b97256745297acc740c532a16912b73dd5785d1e066a"
  },
  {
    "version": "atlas-standalone-005-photoroom-removal",
    "file": "sql/005-photoroom-removal.sql",
    "sqlSha256": "f76f882edb3bad6f36e423bf388380a16f8602de29eddb32a647dc8916763089"
  },
  {
    "version": "atlas-standalone-006-variant-shared-label-retry",
    "file": "sql/006-variant-shared-label-retry.sql",
    "sqlSha256": "e073b918aa83aecc52453deb10ba6abbc603b167881fde347518dc12fd37d5b0"
  },
  {
    "version": "atlas-standalone-007-label-layout-retry",
    "file": "sql/007-label-layout-retry.sql",
    "sqlSha256": "4ff9745a5553fe8252f37b1c311ea8b63c1f4b1f4c5636bed4ada92924ad26e3"
  },
  {
    "version": "atlas-standalone-008-graded-cards-archive",
    "file": "sql/008-graded-cards-archive.sql",
    "sqlSha256": "734094259335780542e0b53ae5b4d663a057283d670d700119f4cbc4cf05f063"
  },
  {
    "version": "atlas-standalone-009-card-provenance",
    "file": "sql/009-card-provenance.sql",
    "sqlSha256": "5b014085bd88f1422da1f02ba7d8ddc5455073d5e79775e6d04e6a5218b3392b"
  },
  {
    "version": "atlas-standalone-010-collection-foundation",
    "file": "sql/010-collection-foundation.sql",
    "sqlSha256": "a6de21a978dc5b3bb5e21dbdf408d60709fa2c724a3e17376ff11502e6ef42a9"
  }
];
export async function compQualificationDefinition() {
  const migrations = await registeredMigrations();
  assert.deepEqual(migrations.slice(0, 9).map(({ sql, ...m }) => m), PREFIX);
  assert.equal(migrations.length, 10); const migration = migrations[9];
  assert.equal(migration.version, COMP_VERSION); assert.equal(migration.file, 'sql/011-comp-curation.sql'); assert.equal(migration.sqlSha256, MIGRATION_SHA);
  const proposal = await readFile(new URL('../../atlas-connected-manual/sql/comp-curation-proposal.sql', import.meta.url), 'utf8');
  assert.equal(hash(proposal), PROPOSAL_SHA);
  assert.equal(migration.sql, proposal.replace('\nBEGIN;\n', '\n').replace(/\nCOMMIT;\n$/, '\n'));
  return { migration, migrations };
}

// The real owned run uses these same comparisons; units verify that rows,
// unknown catalog entries and role changes cannot disappear from the proof.
export function assertCompUpgrade(before, after) {
  assert.deepEqual(Object.keys(after.rows).filter(k => !Object.hasOwn(before.rows, k)), ['atlas_manual.comp_curation']);
  assert.equal(after.rows['atlas_manual.comp_curation'].count, 0);
  assert.equal(after.rows['atlas_staff._standalone_migrations'].count, before.rows['atlas_staff._standalone_migrations'].count + 1);
  for (const [key, value] of Object.entries(before.rows)) if (key !== 'atlas_staff._standalone_migrations') assert.deepEqual(after.rows[key], value, key);
  assert.equal(after.ledger.length, before.ledger.length + 1);
  const added = after.ledger.filter(row => row.version === COMP_VERSION);
  assert.equal(added.length, 1); assert.equal(added[0].checksum, MIGRATION_SHA);
  assert.deepEqual(after.ledger.filter(row => row.version !== COMP_VERSION), before.ledger);
  assert.deepEqual(after.roles, before.roles);
  for (const entry of before.catalog) assert.deepEqual(after.catalog.find(r => r.name === entry.name), entry, entry.name);
}

export async function main(argv = process.argv.slice(2)) {
 const [mode, output, argument] = argv;
 assert(argv.length === 3 && ['--prepare', '--execute'].includes(mode) && output && resolve(output) === output);
 assert(!Object.keys(process.env).some(k => /^(DATABASE_URL|DIRECT_URL|ATLAS_.*DATABASE_URL|PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATA|PGDATABASE|PGSERVICE|PGSERVICEFILE)$/.test(k)));
 const bin = '/opt/homebrew/opt/postgresql@17/bin', pgModule = '/Users/markthomas/.codex/atlas-handoffs/atlas-v4-labels-pg-runtime/node_modules/pg';
 const planPath = resolve(output, 'launch-plan.json'), definition = await compQualificationDefinition();
 const sourcePaths = [
  'packages/atlas-standalone-database/scripts/qualify-comp-foundation.mjs',
  ...['migrate.mjs','registered-migrations.mjs','grants.mjs','baseline.manifest.json','migrations.manifest.json','sql/baseline.sql','test/qualify-comp-foundation.test.mjs','test/comp-foundation-fixture.mjs',...definition.migrations.map(m=>m.file)].map(p=>'packages/atlas-standalone-database/'+p),
  ...['comp-curation-proposal.sql','comp-curation-role-proposal.sql'].map(p=>'packages/atlas-connected-manual/sql/'+p),
  ...['comp-curation-service.mjs','comp-curation-database.mjs','comp-curation-contract.mjs','comp-curation-runtime.mjs','transport.mjs','graded-cards-contract.mjs','card-provenance-contract.mjs','publication-repository.mjs','finishing.mjs','presentation-market.mjs','research-market-query.mjs'].map(p=>'packages/atlas-connected-manual/src/'+p),
  ...['publication-fixture.mjs','comp-curation-runtime.test.mjs','fixtures/comp-curation-runtime-fixture.mjs'].map(p=>'packages/atlas-connected-manual/test/'+p),
  ...['staff-comp-curation-private-adapter.mjs','staff-comp-curation-native-composition.mjs','staff-comp-curation-http.mjs','staff-comp-curation-transport-boundary.mjs','policy.mjs'].map(p=>'frontend/atlas-app/lib/server/'+p),
  ...['staff-comp-curation-transport-contract.mjs','staff-comp-curation-client.mjs','routes.mjs'].map(p=>'frontend/atlas-app/lib/'+p),
  ...['fixture.mjs','config.mjs','policy.mjs'].map(p=>'frontend/atlas-customer/lib/server/'+p),
  ...['staff-auth.mjs','contract.mjs','artifacts.mjs','response.mjs'].map(p=>'packages/atlas-manual-service/src/'+p),
  'packages/atlas-manual-service/scripts/file-artifacts.mjs','packages/atlas-manual-intake/src/repository.mjs',
  ...['auth.mjs','database.mjs','config.mjs','fixture.mjs','fixture-verify.mjs','privileges.mjs'].map(p=>'frontend/atlas-app/lib/server/access/'+p),
 ];
 const schemaPath='/Users/markthomas/.codex/atlas-handoffs/atlas-staff-comp-curation-20261021/restricted-role-pg-03/reviewed-owned-schema.json';
 const pin=async path=>({path,sha256:hash(await readFile(resolve(root,path)))});
 if(mode==='--prepare'){
  assert(/^[1-9][0-9]{3,4}$/.test(argument));const port=Number(argument);assert(port<=65535);
  await mkdir(output,{mode:0o700});await mkdir(resolve(output,'cluster'),{mode:0o700});await mkdir(resolve(output,'source-used'),{mode:0o700});
  const sources=[];for(const path of sourcePaths){sources.push(await pin(path));await writeFile(resolve(output,'source-used',path.replaceAll('/','__')),await readFile(resolve(root,path)),{flag:'wx',mode:0o600});}
  assert.equal(JSON.parse(await readFile(schemaPath)).sha256,COMP_SCHEMA_SHA);
  await save(planPath,{schema:'atlas-comp-foundation-owned-pg-v1',output,directory:resolve(output,'cluster'),data:resolve(output,'cluster/data'),host:'127.0.0.1',unixSockets:false,port,nonce:randomBytes(16).toString('hex'),bin,pgModule,sources,
   compSchema:{path:schemaPath,sha256:hash(await readFile(schemaPath)),schemaSha256:COMP_SCHEMA_SHA},
   groups:['populated exact010 prefix and seven synthetic controls','011 additive old row/catalog/role/ACL preservation','repeat no-op and existing-role denial, external comp schema pin','actual restricted staff read/Skip/NoSuitable plus native signed read and historical replay, exactly two receipts and preserved artifacts','fresh full chain without seeds','forced ledger INSERT rollback and partial/tampered prefix refusal'],
   fixtureOnlySmsSetup:'Two disabled synthetic SMS controls under scoped no_replace trigger exception restored before baseline.',syntheticOnly:true,productionQueries:0,providerCalls:0});
  process.stdout.write(JSON.stringify({prepared:true,planPath,sha256:hash(await readFile(planPath)),port})+'\n');return;
 }
 assert.equal(hash(await readFile(planPath)),argument,'Exact separately reviewed plan required');const plan=JSON.parse(await readFile(planPath));
 assert.equal(plan.schema,'atlas-comp-foundation-owned-pg-v1');assert.equal(plan.output,output);assert.equal(plan.directory,resolve(output,'cluster'));assert.equal(plan.data,resolve(plan.directory,'data'));assert.equal(plan.host,'127.0.0.1');assert.equal(plan.unixSockets,false);assert.equal(plan.bin,bin);assert.equal(plan.pgModule,pgModule);assert.match(plan.nonce,/^[a-f0-9]{32}$/);assert(Number.isInteger(plan.port)&&plan.port>=1024&&plan.port<=65535);
 assert.deepEqual(plan.sources.map(r=>r.path),sourcePaths);for(const r of plan.sources)assert.deepEqual(await pin(r.path),r);
 assert.equal(plan.compSchema.path,schemaPath);assert.equal(hash(await readFile(schemaPath)),plan.compSchema.sha256);assert.equal(plan.compSchema.schemaSha256,COMP_SCHEMA_SHA);
 await assert.rejects(stat(plan.data),{code:'ENOENT'});await save(resolve(output,'execute-intent.json'),{nonce:plan.nonce,planSha256:argument,pid:process.pid});
 const {Client}=createRequire(import.meta.url)(pgModule),sockets=new Set(),clients=new Set(),runtimes=new Set();
 const ownerRole='atlas_fixture_owner',staffRole='atlas_comp_staff',compRole='atlas_comp_restricted';
 const roles={staff:staffRole,manual:'atlas_comp_manual',variant:'atlas_comp_variant',customer:'atlas_comp_customer',customerPrivate:'atlas_comp_customer_private'};
 const passwords=Object.fromEntries([ownerRole,staffRole,compRole].map(r=>[r,randomBytes(24).toString('hex')]));
 const dbName='atlas_comp_'+plan.nonce.slice(0,12),checks=[],evidence=[];
 const url=(role,database=dbName)=>`postgresql://${role}:${passwords[role]}@127.0.0.1:${plan.port}/${database}?schema=atlas_staff&connection_limit=2`;
 const safe=x=>Object.values(passwords).reduce((v,p)=>v.replaceAll(p,'[fixture-secret]'),String(x));
 const env={PATH:'/usr/bin:/bin:/opt/homebrew/bin',LANG:'C'};let log='',started=false,failure,result;
 const run=(name,args)=>{const r=spawnSync(resolve(bin,name),args,{env,encoding:'utf8',timeout:120000,maxBuffer:8e6});log+=safe((r.stdout??'')+(r.stderr??''));assert.equal(r.status,0,safe(r.error?.message??r.stderr));return r.stdout;};
 const socket=async(role=ownerRole,database=dbName)=>{const c=new Client({connectionString:url(role,database),connectionTimeoutMillis:3000});sockets.add(c);await c.connect();return c;};
 const txRaw=c=>({$executeRawUnsafe:async(q,...a)=>(await c.query(q,a)).rowCount,$queryRawUnsafe:async(q,...a)=>(await c.query(q,a)).rows});
 const open=role=>{const c=new PrismaClient({datasources:{db:{url:url(role)}}});clients.add(c);return c;};
 const applyPrefix=async c=>{await applyStandaloneBaseline(c);for(const m of definition.migrations.slice(0,9)){await c.query('BEGIN');try{await c.query(m.sql);await c.query('INSERT INTO atlas_staff._standalone_migrations(version,checksum) VALUES($1,$2)',[m.version,m.sqlSha256]);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}}};
  const census = async c => {
    const tables = (await c.query("SELECT n.nspname AS schema,c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname LIKE 'atlas_%' ORDER BY n.nspname,c.relname")).rows;
    const out = {};
    for (const t of tables) { const id = `"${t.schema}"."${t.name}"`, rows = (await c.query(`SELECT to_jsonb(t) AS row FROM ${id} t ORDER BY to_jsonb(t)::text`)).rows.map(r => r.row); out[t.schema + '.' + t.name] = { count: rows.length, sha256: hash(stable(rows)) }; }
    return out;
  };
  const catalog = async c => (await c.query(`SELECT 'schema:'||nspname AS name,jsonb_build_object('owner',nspowner,'acl',nspacl) AS value FROM pg_namespace WHERE nspname LIKE 'atlas_%'
    UNION ALL SELECT 'relation:'||n.nspname||'.'||c.relname,jsonb_build_object('owner',c.relowner,'acl',c.relacl,'kind',c.relkind,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'options',c.reloptions,'index',CASE WHEN c.relkind='i' THEN pg_get_indexdef(c.oid) ELSE NULL END,
      'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'acl',a.attacl,'identity',a.attidentity,'generated',a.attgenerated,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
      'constraints',(SELECT jsonb_agg(jsonb_build_object('name',k.conname,'definition',pg_get_constraintdef(k.oid,false),'valid',k.convalidated) ORDER BY k.conname) FROM pg_constraint k WHERE k.conrelid=c.oid)) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname LIKE 'atlas_%'
    UNION ALL SELECT 'routine:'||n.nspname||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')',jsonb_build_object('owner',p.proowner,'acl',p.proacl,'definition',pg_get_functiondef(p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname LIKE 'atlas_%'
    UNION ALL SELECT 'trigger:'||n.nspname||'.'||c.relname||'.'||t.tgname,jsonb_build_object('enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid,false)) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname LIKE 'atlas_%' ORDER BY name`)).rows;

  try {
    await save(resolve(plan.directory,'ownership.json'),{nonce:plan.nonce,directory:plan.directory,data:plan.data,ownerPid:process.pid,uid:process.getuid(),createdByHarness:true});
    const passwordFile=resolve(plan.directory,'owner-password');await writeFile(passwordFile,passwords[ownerRole],{flag:'wx',mode:0o600});
    assert.match(run('postgres',['--version']),/PostgreSQL\) 17\./);
    run('initdb',['-D',plan.data,'--username',ownerRole,'--pwfile',passwordFile,'--auth-host=scram-sha-256','--auth-local=reject','--encoding=UTF8','--locale=C']);
    started=true;run('pg_ctl',['-D',plan.data,'-l',resolve(plan.directory,'postgres.log'),'-o',`-h 127.0.0.1 -p ${plan.port} -c unix_socket_directories=''`,'-w','start']);await rm(passwordFile);
    const control=await socket(ownerRole,'postgres');assert.deepEqual((await control.query("SELECT current_setting('data_directory') data,current_setting('listen_addresses') host,current_setting('unix_socket_directories') sockets")).rows[0],{data:plan.data,host:'127.0.0.1',sockets:''});
    await control.query(`CREATE DATABASE ${dbName}`);const setup=await socket();await applyPrefix(setup);
    await setup.query(`REVOKE TEMPORARY ON DATABASE ${dbName} FROM PUBLIC`);await setup.query(standaloneRoleSQL(roles));
    await control.query(`ALTER ROLE ${staffRole} LOGIN PASSWORD '${passwords[staffRole]}'`);
    await control.query(`CREATE ROLE ${compRole} LOGIN PASSWORD '${passwords[compRole]}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`);
    const admin=open(ownerRole),staffClient=open(staffRole),config=makeAccessConfig({...localAccessConfig({databaseUrl:url(staffRole),sessionKey:randomBytes(32),phoneKey:randomBytes(32)}),routerKey:Buffer.alloc(32,0x32)});
    await seedLocalStaff(admin,config,{trained:true});
    const customerConfig=customerLocalConfig({databaseUrl:url(staffRole),sessionKey:randomBytes(32),phoneKey:randomBytes(32)});
    await setup.query('INSERT INTO atlas_customer."CustomerControl"(enabled,mode,origin,"deploymentId","releaseSha","configHash") VALUES(false,$1,$2,$3,$4,$5)',[customerConfig.mode,customerConfig.origin,customerConfig.deploymentId,customerConfig.releaseSha,customerConfig.configHash]);
    await setup.query('INSERT INTO atlas_staff."PublicReaderControl"(enabled,mode,origin,"deploymentId","releaseSha","configHash") VALUES(false,$1,$2,$3,$4,$5)',[config.mode,'http://127.0.0.1:4319','local-public-fixture',config.releaseSha,config.configHash]);
    await setup.query('INSERT INTO atlas_customer."CustomerServiceControl"(binding) VALUES($1)',[customerConfig.binding]);
    await setup.query('INSERT INTO atlas_customer."CommerceControl"(binding,merchant) VALUES($1,$2)',[customerConfig.binding,{}]);
    // Synthetic setup only; no exception survives into the baseline or011.
    await setup.query('BEGIN');try{await setup.query('ALTER TABLE atlas_staff."SmsPilotControl" DISABLE TRIGGER "SmsPilotControl_no_replace"');await setup.query("INSERT INTO atlas_staff.\"SmsPilotControl\"(application) VALUES('STAFF'),('CUSTOMER')");await setup.query('ALTER TABLE atlas_staff."SmsPilotControl" ENABLE TRIGGER "SmsPilotControl_no_replace"');await setup.query('COMMIT');}catch(e){await setup.query('ROLLBACK');throw e;}
    const auth=new DurableStaffAuth({database:new StaffDatabase(staffClient,config),config,provider:fixtureVerifyProvider(config)});
    const boot=await auth.bootstrap(''),initial=`${config.cookies.browser}=${boot.browserToken}`;
    const challenge=await auth.send(initial,boot.csrf,{phone:'+12025550141',requestId:randomUUID()},'comp-foundation');
    const signed=await auth.verify(initial,boot.csrf,{challengeId:challenge.challengeId,code:'424242'},'comp-foundation');
    const cookie=`${initial}; ${config.cookies.session}=${signed.token}`,staff=await auth.authenticate(cookie,signed.csrf);
    const objectDirectory=resolve(plan.directory,'artifacts');await mkdir(objectDirectory,{mode:0o700});
    const artifacts=createManualArtifactStore({transport:await createFileArtifactTransport(objectDirectory)});
    const f=await publicationFixture();await f.publication.publish({},f.cardId,f.actionId);
    const row=f.row,actionResult=JSON.parse(row.result);actionResult.receipt.actorId=staff.id;
    const originalManifest=JSON.parse(row.manifest),packet=await f.artifacts.read(originalManifest.packet.ref,{cardId:f.cardId,kind:'PUBLIC_REPORT',sourceHash:originalManifest.packet.sourceHash});
    const packetRef=await artifacts.write(packet,{cardId:f.cardId,kind:'PUBLIC_REPORT',sourceHash:row.public_hash});
    const manifest=canonical({...originalManifest,packet:{ref:packetRef,sourceHash:row.public_hash}});
    await setup.query('INSERT INTO atlas_manual.card(id,revision,content,content_hash,owner_id) VALUES($1,11,$2,$3,$4)',[f.cardId,canonical(f.draft),row.source_hash,staff.id]);
    await setup.query('INSERT INTO atlas_manual_intake.card(id,pair_id,owner_id,create_request_id,create_request_hash,label) VALUES($1,$2,$3,$4,$5,$6)',[f.cardId,randomUUID(),staff.id,randomUUID(),digest('synthetic-comp-foundation'),'SYNTHETIC COMP FOUNDATION']);
    await setup.query('INSERT INTO atlas_manual.action(card_id,action_id,actor_id,expected_revision,result_revision,request_hash,request,result) VALUES($1,$2,$3,10,11,$4,$5,$6)',[f.cardId,f.actionId,staff.id,digest('{}'),'{}',canonical(actionResult)]);
    await setup.query('INSERT INTO atlas_manual.approval(card_id,action_id,actor_id,source_revision,source_hash,report_hash,report,approved_at) VALUES($1,$2,$3,10,$4,$5,$6,$7)',[f.cardId,f.actionId,staff.id,row.source_hash,row.report_hash,row.report,row.approved_at]);
    await setup.query('INSERT INTO atlas_manual.public_report_identity(card_id,public_token,report_number) VALUES($1,$2,$3)',[f.cardId,row.public_token,row.report_number]);
    await setup.query("INSERT INTO atlas_manual.publication(card_id,action_id,version,mode) VALUES($1,$2,1,'LOCAL_FIXTURE')",[f.cardId,f.actionId]);
    await setup.query("UPDATE atlas_manual.publication SET state='PUBLISHED',manifest=$1,manifest_hash=$2,public_hash=$3,published_at=clock_timestamp() WHERE card_id=$4 AND action_id=$5",[manifest,digest(manifest),row.public_hash,f.cardId,f.actionId]);
    const previewId=randomUUID(),source={packet,publicHash:row.public_hash},context=publishedMarketQuery(source);
    const items=[{id:'synthetic-saved:1',title:'SYNTHETIC retained sale',listingUrl:'https://www.ebay.com/itm/123456789100',imageUrl:null,soldDate:'2026-10-19',soldPriceCents:1000,currency:'USD',priceBasis:'EXACT'}];
    const preview=createPresentationMarket().project(source,{responsePolicy:'ATLAS_SLAB_V1',source:'EBAY_SOLD',engineVersion:'ebay-sold-comps-v2.3.0',query:context.query,retrievedAt:'2026-10-20T12:00:00.000Z',items,acquisitionDiagnostics:{returnedItemCount:1},imageMatch:{policy:'atlas-market-slab-label-v1',counts:{},readings:[{rowId:items[0].id,evidenceKind:'SLABBED',identityMatch:'MATCH',numericGrade:9,gradingCompany:'PSA',labelText:null,sha256:null,reason:'Synthetic offline qualification'}]}}).preview;
    const artifactHash=digest(JSON.stringify(preview)),ref=await artifacts.write(preview,{cardId:f.cardId,kind:'MARKET_PREVIEW',sourceHash:artifactHash});
    const marketRequest=canonical({requestId:previewId,approvalActionId:f.actionId,expectedRevision:0});
    await setup.query('INSERT INTO atlas_manual.presentation_market(card_id,approval_action_id,request_id,actor_id,request,request_hash) VALUES($1,$2,$3,$4,$5,$6)',[f.cardId,f.actionId,previewId,staff.id,marketRequest,digest(marketRequest)]);
    const marketResult=canonical({state:'READY',ref,artifactHash,sourceHash:marketPreviewHash(preview)});
    await setup.query("UPDATE atlas_manual.presentation_market SET state='READY',result=$1,result_hash=$2 WHERE card_id=$3 AND request_id=$4",[marketResult,digest(marketResult),f.cardId,previewId]);
    const files=async(dir=objectDirectory)=>{const out=[];for(const e of(await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const path=resolve(dir,e.name);if(e.isDirectory())out.push(...await files(path));else out.push({path:relative(objectDirectory,path),sha256:hash(await readFile(path))});}return out;};
    const roleSnapshot=async()=>({roles:(await setup.query('SELECT * FROM pg_roles WHERE rolname=ANY($1::text[]) ORDER BY rolname',[[ownerRole,...Object.values(roles),compRole]])).rows,memberships:(await setup.query('SELECT * FROM pg_auth_members ORDER BY roleid,member')).rows});
    const snapshot=async()=>({rows:await census(setup),catalog:await catalog(setup),roles:await roleSnapshot(),ledger:(await setup.query('SELECT * FROM atlas_staff._standalone_migrations ORDER BY version')).rows});
    const before=await snapshot(),originalFiles=await files();assert.equal(before.ledger.length,10);checks.push('populated exact010 prefix, seven controls, saved report and market artifacts, retained serving roles');
    const applied=await applyStandaloneMigrations(setup);assert.deepEqual(applied.applied,[{version:COMP_VERSION,checksum:MIGRATION_SHA}]);
    const after=await snapshot();assertCompUpgrade(before,after);assert.deepEqual(await files(),originalFiles);
    const addedCatalog=after.catalog.filter(x=>!before.catalog.some(y=>y.name===x.name)).map(x=>x.name).sort();
    assert.deepEqual(addedCatalog,['relation:atlas_manual.comp_curation','relation:atlas_manual.comp_curation_card_id_request_id_key','relation:atlas_manual.comp_curation_pkey','routine:atlas_manual.comp_curation_guard()','trigger:atlas_manual.comp_curation.curation_guard','trigger:atlas_manual.comp_curation.immutable','trigger:atlas_manual.comp_curation.immutable_truncate'].sort());
    evidence.push({phase:'upgrade',before,after,addedCatalog,artifacts:originalFiles});checks.push('011 only adds empty private curation objects and one ledger row; every prior row/catalog/ACL/role unchanged');
    assert.equal((await applyStandaloneMigrations(setup)).status,'NO_OP');assert.deepEqual(await snapshot(),after);
    await setup.query('SET search_path=pg_catalog');await assertRegisteredCompFoundation((q,...values)=>setup.query(q,values));
    const schema=await inspectCompCurationSchema(txRaw(setup));assert.equal(schema.sha256,COMP_SCHEMA_SHA);await save(resolve(output,'observed-comp-schema.json'),schema);
    for(const role of Object.values(roles)){
      const probe=(await setup.query("SELECT has_table_privilege($1,'atlas_manual.comp_curation','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') AS relation,has_function_privilege($1,'atlas_manual.comp_curation_guard()','EXECUTE') AS routine",[role])).rows;
      assert.deepEqual(probe,[{relation:false,routine:false}]);
    }
    checks.push('repeat no-op, no new rights for existing roles, and unchanged externally reviewed comp schema');
    await setup.query((await readFile(resolve(root,'packages/atlas-connected-manual/sql/comp-curation-role-proposal.sql'),'utf8')).replaceAll(':"curation_role"',`"${compRole}"`));
    const restricted=open(compRole),db=createCompCurationDatabase({client:restricted,role:compRole,schemaOwner:ownerRole,schemaSha256:COMP_SCHEMA_SHA});
    const boundary=createDurableStaffBoundary({auth,manualClient:db}),intake=createIntakeRepository({boundary,keyPrefix:'comp-foundation-synthetic',maxOriginalBytes:65536});
    const validateAccess=({tx,cardId})=>intake.assertActiveInTransaction(tx,cardId);
    const approved=createManualFinishing({repository:createPublicationRepository({boundary,validateAccess}),artifacts});
    const service=createCompCurationService({boundary,approved,artifacts,validateAccess,policy:null});
    const readInput={approvalActionId:f.actionId,previewId},serviceBefore=await census(setup),state=await service.read(staff,f.cardId,readInput);
    assert.equal(state.availability,'POLICY_REQUIRED');assert.equal(state.policy,null);assert.equal(state.revision,0);assert.deepEqual(await census(setup),serviceBefore);
    const requests=[],receipts=[];
    for(const [revision,outcome]of ['SKIP','NO_SUITABLE_COMPS'].entries()){
      const input={requestId:randomUUID(),approvalActionId:f.actionId,expectedSelectionRevision:revision,previewId,expectedPreviewHash:marketPreviewHash(preview),outcome,selectedIds:[],reviewedIds:[],expectedPolicyHash:null};
      const receipt=await service.decide(staff,f.cardId,input);assert.equal(receipt.outcome,outcome);assert.equal(receipt.revision,revision+1);assert.equal(receipt.policy,null);assert.equal(receipt.guidance,null);requests.push(input);receipts.push(receipt);
      const saved=await census(setup);assert.deepEqual(await service.decide(staff,f.cardId,input),receipt);assert.deepEqual(await census(setup),saved);
    }
    // Historical same-request replay is not replaced by the newer current head.
    assert.deepEqual(await service.decide(staff,f.cardId,requests[0]),receipts[0]);
    const current=await service.read(staff,f.cardId,readInput);assert.equal(current.revision,2);assert.deepEqual(current.selection,receipts[1]);
    await assert.rejects(service.decide(staff,f.cardId,{...requests[0],requestId:randomUUID(),expectedSelectionRevision:2,outcome:'SELECTED',selectedIds:[items[0].id],reviewedIds:[items[0].id],expectedPolicyHash:'a'.repeat(64)}),e=>e.code==='COMP_POLICY_CHANGED');
    // Actual native factory with a different owned Prisma client, the same
    // live DurableStaffAuth, shared nonce store and read-only artifact capability.
    // The injected fetch is an in-process signed transport, never a listener or
    // remote request; it cannot acquire a new market pool or select a policy.
    const nativeBefore=await census(setup),nativeUrl=new URL(url(compRole));nativeUrl.search='?schema=atlas_manual';
    const counts={created:0,disconnected:0,signedRequests:0},nonceStore=createPrivateManualNonceStore(),transportKey=Buffer.alloc(32,0x31);
    const runtime=createNativeCompCurationRuntime({enabled:true,environment:{},auth,staffConfig:config,
      settings:{databaseUrl:nativeUrl.href,role:compRole,schemaOwner:ownerRole,schemaSha256:COMP_SCHEMA_SHA,origin:config.origin,transportKey},nonceStore,
      artifactReader:{read:(ref,expected,options)=>artifacts.read(ref,expected,options)},
      createClient({databaseUrl}){assert.equal(databaseUrl,nativeUrl.href);counts.created++;
        const client=new PrismaClient({datasources:{db:{url:databaseUrl}}});assert.notEqual(client,restricted);assert.notEqual(client,staffClient);
        const disconnect=client.$disconnect.bind(client);client.$disconnect=async()=>{counts.disconnected++;await disconnect();};return client;}});
    runtimes.add(runtime);assert.equal(counts.created,0);assert.equal(runtime.configuredForDisplay,true);
    const response=()=>({statusCode:200,headers:{},setHeader(key,value){this.headers[key]=value;},status(value){this.statusCode=value;return this;},
      json(value){this.body=value;return this;},send(value){this.body=JSON.parse(Buffer.from(value).toString('utf8'));return this;}});
    const proxy=createManualServiceProxy({origin:'https://synthetic-native.atlasgrading.com',key:transportKey,async fetchImpl(target,init){
      const parsed=new URL(target);assert.equal(parsed.origin,'https://synthetic-native.atlasgrading.com');counts.signedRequests++;
      const request={method:init.method,url:parsed.pathname+parsed.search,headers:{...init.headers},rawBody:Buffer.from(init.body??'')},out=response();
      assert.equal(await runtime.handler(request,out),true);
      return new Response(JSON.stringify(out.body),{status:out.statusCode,headers:{'content-type':'application/json',...out.headers}});
    }});
    const nativePath=`/api/staff/manual-connected/cards/${f.cardId}/comp-curation`;
    const nativeRead=response();assert.equal(await proxy({method:'GET',url:`${nativePath}?approvalActionId=${f.actionId}&previewId=${previewId}`,headers:{cookie}},nativeRead),true);
    assert.equal(nativeRead.statusCode,200);assert.equal(nativeRead.body.result.revision,2);assert.deepEqual(nativeRead.body.result.selection,receipts[1]);
    assert.equal(nativeRead.body.result.policy,null);assert.equal(nativeRead.body.result.selection.guidance,null);assert.deepEqual(await census(setup),nativeBefore);
    const nativeReplay=response();assert.equal(await proxy({method:'POST',url:nativePath+'/decision',headers:{cookie,origin:config.origin,'content-type':'application/json','x-atlas-csrf':signed.csrf},body:requests[0]},nativeReplay),true);
    assert.equal(nativeReplay.statusCode,200);assert.deepEqual(nativeReplay.body.result,receipts[0]);assert.deepEqual(await census(setup),nativeBefore);
    await runtime.close();await runtime.close();assert.equal(runtime.configuredForDisplay,false);assert.deepEqual(counts,{created:1,disconnected:1,signedRequests:2});
    const nativeProof={sameLiveAuth:true,ownedDistinctPrisma:true,privateSignatureAndNonce:true,policy:null,counts,
      readRevision:nativeRead.body.result.revision,replayedRequestId:requests[0].requestId,replayedRevision:nativeReplay.body.result.revision,
      before:nativeBefore,after:await census(setup),closed:true};assert.deepEqual(nativeProof.after,nativeBefore);
    const finalRows=await census(setup);for(const [name,value]of Object.entries(serviceBefore))if(name!=='atlas_manual.comp_curation')assert.deepEqual(finalRows[name],value,name);assert.equal(finalRows['atlas_manual.comp_curation'].count,2);
    const events=(await setup.query('SELECT * FROM atlas_manual.comp_curation ORDER BY revision')).rows;assert.equal(events.length,2);
    events.forEach((event,i)=>{assert.equal(event.card_id,f.cardId);assert.equal(event.actor_id,staff.id);assert.equal(event.request_id,requests[i].requestId);assert.equal(event.request,canonical(requests[i]));assert.equal(event.receipt,canonical(receipts[i]));assert.equal(event.selected_facts,'[]');});
    assert.deepEqual(await files(),originalFiles);evidence.push({phase:'service',before:serviceBefore,after:finalRows,events,nativeRuntime:nativeProof,artifacts:await files()});db.close();checks.push('actual restricted auth/source read, Skip/NoSuitable plus native signed read/historical replay add exactly two private receipts, no guidance or old-row/artifact changes');
    await control.query('CREATE DATABASE atlas_comp_fresh');const fresh=await socket(ownerRole,'atlas_comp_fresh');await applyStandaloneMigrations(fresh);await fresh.query('SET search_path=pg_catalog');await assertRegisteredCompFoundation((q,...v)=>fresh.query(q,v));
    const freshRows=await census(fresh);for(const [name,value]of Object.entries(freshRows))if(!name.endsWith('._standalone_migrations'))assert.equal(value.count,0,name);assert.equal(freshRows['atlas_staff._standalone_migrations'].count,11);evidence.push({phase:'fresh',rows:freshRows});checks.push('fresh full registered chain has eleven ledger rows and zero application seeds');
    await control.query('CREATE DATABASE atlas_comp_atomic');const atomic=await socket(ownerRole,'atlas_comp_atomic');await applyPrefix(atomic);
    await atomic.query("CREATE FUNCTION atlas_staff.fixture_reject_011_ledger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.version='atlas-standalone-011-comp-curation' THEN RAISE EXCEPTION 'OWNED_FIXTURE_LEDGER_INSERT_REFUSED'; END IF; RETURN NEW; END $$");
    await atomic.query('CREATE TRIGGER fixture_reject_011_ledger BEFORE INSERT ON atlas_staff._standalone_migrations FOR EACH ROW EXECUTE FUNCTION atlas_staff.fixture_reject_011_ledger()');
    const atomicBefore={rows:await census(atomic),catalog:await catalog(atomic)};
    await assert.rejects(applyStandaloneMigrations(atomic),e=>e.code==='P0001'&&e.message==='OWNED_FIXTURE_LEDGER_INSERT_REFUSED');
    assert.deepEqual({rows:await census(atomic),catalog:await catalog(atomic)},atomicBefore);
    assert.deepEqual((await atomic.query("SELECT to_regclass('atlas_manual.comp_curation') AS relation,to_regprocedure('atlas_manual.comp_curation_guard()') AS routine")).rows,[{relation:null,routine:null}]);
    await control.query('CREATE DATABASE atlas_comp_refusal');const refusal=await socket(ownerRole,'atlas_comp_refusal');await applyPrefix(refusal);await refusal.query('CREATE TABLE atlas_manual.comp_curation(marker text)');
    const partialBefore={rows:await census(refusal),catalog:await catalog(refusal)};await assert.rejects(applyStandaloneMigrations(refusal),e=>e.code==='42P07');assert.deepEqual({rows:await census(refusal),catalog:await catalog(refusal)},partialBefore);
    // Only this explicitly created empty owned fixture table is removed.
    await refusal.query('DROP TABLE atlas_manual.comp_curation');await refusal.query('UPDATE atlas_staff._standalone_migrations SET checksum=$1 WHERE version=$2',['0'.repeat(64),definition.migrations[0].version]);
    const driftBefore={rows:await census(refusal),catalog:await catalog(refusal)};await assert.rejects(applyStandaloneMigrations(refusal),/LEDGER_INVALID/);assert.deepEqual({rows:await census(refusal),catalog:await catalog(refusal)},driftBefore);
    evidence.push({phase:'refusal',atomic:atomicBefore,partial:partialBefore,tampered:driftBefore,atomicDdlAbsent:true});checks.push('actual post-DDL ledger INSERT refusal rolls back011; partial table and tampered prefix refuse without repair');
    result={pass:true,checks,evidence,previousLedgerRows:10,ledgerRows:11,existingTables:Object.keys(before.rows).length,afterTables:Object.keys(after.rows).length,existingCatalogEntries:before.catalog.length,compSchemaSha256:COMP_SCHEMA_SHA,syntheticOnly:true};
  }catch(error){failure=error;result={pass:false,checks,evidence,error:{name:error.name,code:error.code,message:safe(error.message),stack:safe(error.stack)}};}
  finally{
    const runtimeCloses=await Promise.allSettled([...runtimes].map(r=>Promise.resolve().then(()=>r.close())));
    const clientCloses=await Promise.allSettled([...clients].map(c=>Promise.resolve().then(()=>c.$disconnect()))),socketCloses=await Promise.allSettled([...sockets].map(c=>Promise.resolve().then(()=>c.end())));
    const outcomes=values=>values.map(v=>v.status==='fulfilled'?{status:v.status}:{status:v.status,error:safe(v.reason?.message??v.reason)});let stoppedVerified=false;
    if(started){const own=JSON.parse(await readFile(resolve(plan.directory,'ownership.json')));assert.equal(own.nonce,plan.nonce);assert.equal(own.data,plan.data);assert.equal(own.ownerPid,process.pid);assert.equal((await stat(plan.directory)).uid,process.getuid());const status=spawnSync(resolve(bin,'pg_ctl'),['-D',plan.data,'status'],{env});if(status.status===0)run('pg_ctl',['-D',plan.data,'-m','fast','-w','stop']);else assert.equal(status.status,3);assert.equal(spawnSync(resolve(bin,'pg_ctl'),['-D',plan.data,'status'],{env}).status,3);await rm(plan.data,{recursive:true});await assert.rejects(stat(plan.data),{code:'ENOENT'});stoppedVerified=true;}
    await writeFile(resolve(output,'validation.log'),log,{flag:'wx',mode:0o600});await copyFile(resolve(plan.directory,'postgres.log'),resolve(output,'postgres.log')).catch(()=>{});
    await save(resolve(output,'cleanup.json'),{stoppedVerified,ownedDataAbsent:stoppedVerified,nonce:plan.nonce,directory:plan.directory,runtimeCloses:outcomes(runtimeCloses),clientCloses:outcomes(clientCloses),socketCloses:outcomes(socketCloses)});
    if([...runtimeCloses,...clientCloses,...socketCloses].some(v=>v.status==='rejected')){failure??=Error('Owned connection cleanup failed after stop');result={...result,pass:false,cleanupFailure:true};}
    result={...result,sourceRefs:plan.sources,planSha256:argument,stoppedVerified,node:process.version,productionQueries:0,providerCalls:0,externalStorageCalls:0,cleanupSha256:hash(await readFile(resolve(output,'cleanup.json')))};
    await save(resolve(output,'postgres-result.json'),result);process.stdout.write(JSON.stringify({pass:result.pass,groups:checks.length,stoppedVerified,output})+'\n');
  }
  if(failure)throw failure;

}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
