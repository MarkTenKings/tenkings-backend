import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { applyStandaloneBaseline, applyStandaloneMigrations } from '../migrate.mjs';
import { initializeStandaloneCoordination } from '../initialize.mjs';
import { standaloneRoleSQL } from '../grants.mjs';
import { staffGrantSQL, assertStaffPrivileges } from '../../../frontend/atlas-app/lib/server/access/privileges.mjs';
import { customerGrantSQL, assertCustomerPrivileges } from '../../../frontend/atlas-customer/lib/server/database.mjs';
import { customerPrivateGrantSQL, assertCustomerPrivatePrivileges } from '../../atlas-connected-manual/scripts/customer-database.mjs';

const [bin, modulePath, output] = process.argv.slice(2);
assert(process.argv.length === 5 && [bin,modulePath,output].every(p => p.startsWith('/')),'Explicit local tools and new output file required');
assert(!Object.keys(process.env).some(k => /^(DATABASE_URL|DIRECT_URL|ATLAS_.*DATABASE_URL|PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATABASE|PGSERVICE|PGSERVICEFILE)$/.test(k)), 'Ambient database settings refused');
const { default: pg } = await import(pathToFileURL(modulePath));
const directory = await mkdtemp('/private/tmp/atlas-standalone-db-'), data = join(directory,'data'), nonce = randomUUID();
const environment = { PATH:'/usr/bin:/bin', LANG:'C', LC_ALL:'C' };
const exec = (name,args,timeout=30000) => {
  const result=spawnSync(join(bin,name),args,{env:environment,encoding:'utf8',timeout});
  if(result.status!==0) throw new Error(`${name} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
};
assert.match(exec('postgres',['--version']),/^postgres \(PostgreSQL\) 17\./);
const owner={nonce,uid:process.getuid(),directory,data,createdByHarness:true};
await writeFile(join(directory,'ownership.json'),JSON.stringify(owner),{mode:0o600,flag:'wx'});
let started=false, client, receipt;const checks=[];
const catalog = async()=> (await client.query("SELECT jsonb_build_object('tables',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname LIKE 'atlas_%' AND c.relkind='r'),'functions',(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname LIKE 'atlas_%'),'triggers',(SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname LIKE 'atlas_%' AND NOT t.tgisinternal),'ledger',(SELECT jsonb_agg(to_jsonb(m)) FROM atlas_staff._standalone_migrations m)) AS result")).rows[0].result;
try {
  exec('initdb',['-D',data,'--auth=trust','--username=atlas_fixture_owner','--encoding=UTF8','--no-locale']);
  exec('pg_ctl',['-D',data,'-l',join(directory,'postgres.log'),'-o',`-c listen_addresses='' -c unix_socket_directories='${directory}' -c fsync=off`,'-w','-t','20','start']);started=true;
  client=new pg.Client({host:directory,port:5432,database:'postgres',user:'atlas_fixture_owner'});await client.connect();
  await client.query('CREATE DATABASE atlas_standalone_fixture');await client.end();
  client=new pg.Client({host:directory,port:5432,database:'atlas_standalone_fixture',user:'atlas_fixture_owner'});await client.connect();
  await client.query('CREATE FUNCTION public.fixture_obsolete_bridge() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$');
  await assert.rejects(()=>applyStandaloneBaseline(client),/STANDALONE_REQUIRES_EMPTY_DATABASE/);
  await client.query('DROP FUNCTION public.fixture_obsolete_bridge()');checks.push('preexisting public function refuses installation');
  assert.equal((await applyStandaloneBaseline(client)).status,'APPLIED');checks.push('empty PG17 baseline restored');
  const manifest=JSON.parse(await readFile(new URL('../baseline.manifest.json',import.meta.url),'utf8'));
  for(const relation of manifest.tables) {
    const [schema,name]=relation.split('.');assert.match(schema,/^atlas_[a-z_]+$/);assert.match(name,/^[A-Za-z_]+$/);
    assert.equal((await client.query(`SELECT count(*)::int n FROM "${schema}"."${name}"`)).rows[0].n,0,relation);
  }
  checks.push('all 108 application tables begin empty');
  assert.equal((await initializeStandaloneCoordination(client,{geometryConcurrency:2})).status,'INITIALIZED');
  assert.equal((await initializeStandaloneCoordination(client,{geometryConcurrency:2})).status,'NO_OP');
  await assert.rejects(()=>initializeStandaloneCoordination(client,{geometryConcurrency:3}),/STANDALONE_COORDINATION_DIFFERS/);
  checks.push('fresh geometry capacity initialized at explicit two; no-op exact and differing value refused');
  const before=await catalog();assert.equal(before.tables,109);assert.equal(before.functions,186);assert.equal(before.triggers,161);
  assert.equal((await applyStandaloneBaseline(client)).status,'NO_OP');assert.deepEqual(await catalog(),before);checks.push('second application exact catalog/ledger no-op');
  const forbidden=await client.query("SELECT count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' OR c.relname IN ('StaffSpecimen','StaffWorkspaceCard','CustomerSubmission','CustomerCard','variant_contribution','_prisma_migrations')");assert.equal(forbidden.rows[0].n,0);checks.push('no public or obsolete specimen/submission/Prisma objects');
  const roles={staff:'atlas_fixture_staff',manual:'atlas_fixture_manual',variant:'atlas_fixture_variant',customer:'atlas_fixture_customer',customerPrivate:'atlas_fixture_customer_private'};
  assert.equal((await applyStandaloneMigrations(client)).status,'APPLIED');
  await client.query(standaloneRoleSQL(roles));
  checks.push('all five current runtime role contracts installed without legacy dependencies');
  for(const role of Object.values(roles)) {
    for(const relation of ['atlas_manual.learning_control','atlas_manual.learning_release','atlas_manual.learning_release_member']) {
      const {rows:[p]}=await client.query("SELECT has_table_privilege($1,$2,'INSERT,UPDATE,DELETE,TRUNCATE') allowed",[role,relation]);
      assert.equal(p.allowed,false,`${role} ${relation}`);
    }
    const {rows:[p]}=await client.query("SELECT has_schema_privilege($1,'public','CREATE') allowed",[role]);assert.equal(p.allowed,false);
  }
  checks.push('serving roles cannot promote learning or create public objects');
  for(const role of [roles.manual,roles.variant]) {
    const {rows:[p]}=await client.query("SELECT has_function_privilege($1,'atlas_manual_connected.read_grading_photo(uuid,uuid,text,text)','EXECUTE') allowed",[role]);assert.equal(p.allowed,true);
  }
  checks.push('main and variant generated-frame readers remain available');
  const tx = { async $queryRaw(strings,...values) {
    const sql=strings.reduce((result,part,index)=>result+(index?'$'+index:'')+part,'');
    return (await client.query(sql,values)).rows;
  } };
  for(const [role,check] of [['atlas_fixture_staff',assertStaffPrivileges],['atlas_fixture_customer',assertCustomerPrivileges],['atlas_fixture_customer_private',assertCustomerPrivatePrivileges]]) {
    await client.query(`SET ROLE ${role}`);await check(tx);await client.query('RESET ROLE');
  }
  checks.push('all three actual serving privilege checkers pass');
  await client.query('GRANT UPDATE ON atlas_staff."StaffControl" TO atlas_fixture_staff');
  await client.query('SET ROLE atlas_fixture_staff');await assert.rejects(()=>assertStaffPrivileges(tx),error=>error.code==='STAFF_DATABASE_ROLE_INVALID');await client.query('RESET ROLE');
  await client.query('REVOKE UPDATE ON atlas_staff."StaffControl" FROM atlas_fixture_staff');checks.push('extra control authority refused by actual staff checker');
  const actor='11111111-1111-4111-8111-111111111111',phoneHash='a'.repeat(64);
  await client.query('INSERT INTO atlas_staff."StaffIdentity" (id,"phoneHash",name) VALUES($1,$2,$3)',[actor,phoneHash,'Synthetic retained identity']);
  await client.query('SET ROLE atlas_fixture_staff');
  assert.deepEqual((await client.query('SELECT id,"phoneHash",name FROM atlas_staff."StaffIdentity" WHERE "phoneHash"=$1',[phoneHash])).rows,[{id:actor,phoneHash,name:'Synthetic retained identity'}]);
  await assert.rejects(()=>client.query(`UPDATE atlas_staff."StaffIdentity" SET role='OBSERVER' WHERE id=$1`,[actor]));
  await client.query('RESET ROLE');checks.push('retained identity/hash lookup works; serving cannot change role');
  const binding={mode:'LOCAL_FIXTURE',origin:'http://127.0.0.1:4318',deploymentId:'local-customer-fixture',releaseSha:'0'.repeat(40),configHash:'b'.repeat(64)};
  await client.query(`INSERT INTO atlas_customer."CustomerControl"(id,enabled,mode,origin,"deploymentId","releaseSha","configHash",revision) VALUES('active',true,$1,$2,$3,$4,$5,1)`,Object.values(binding));
  await client.query('INSERT INTO atlas_customer."CustomerAccount"(id,"phoneHash",phone,profile) VALUES($1,$2,$3,$4)',[actor,phoneHash,'+12025550141',JSON.stringify({name:'Synthetic customer'})]);
  const lookup=(await client.query('SELECT id,"phoneHash",profile FROM atlas_customer."CustomerAccount" WHERE "phoneHash"=$1',[phoneHash])).rows[0];assert.equal(lookup.id,actor);assert.equal(lookup.profile.name,'Synthetic customer');
  await client.query('SET ROLE atlas_fixture_customer');
  const boot=(await client.query('SELECT atlas_customer.customer_call($1,$2::jsonb,$3::jsonb) result',['bootstrap',JSON.stringify(binding),JSON.stringify({newBrowserHash:'c'.repeat(64),clientHash:'d'.repeat(64)})])).rows[0].result;
  assert.equal(boot.browserHash,'c'.repeat(64));assert.equal(boot.customer,null);
  await assert.rejects(()=>client.query('SELECT * FROM atlas_customer."CustomerAccount"'));
  await client.query('RESET ROLE');checks.push('customer private account bytes retained; real restricted auth bootstrap succeeds');
  const prior=(await client.query('SELECT * FROM atlas_staff._standalone_migrations')).rows;
  await client.query("UPDATE atlas_staff._standalone_migrations SET checksum=repeat('0',64)");
  await assert.rejects(()=>applyStandaloneBaseline(client),/STANDALONE_MIGRATION_LEDGER_INVALID/);
  for (const row of prior) await client.query('UPDATE atlas_staff._standalone_migrations SET checksum=$1 WHERE version=$2',[row.checksum,row.version]);checks.push('changed migration receipt refuses replay');

  receipt={status:'STANDALONE_LOCAL_PG17_PASS',sourceBaselineSha256:createHash('sha256').update(await readFile(new URL('../sql/baseline.sql',import.meta.url))).digest('hex'),checks,catalog:before,productionCalls:0,providerCalls:0};

} catch(error) { console.error(error);process.exitCode=1; }
finally {
  await client?.end().catch(()=>{});
  const saved=JSON.parse(await readFile(join(directory,'ownership.json'),'utf8'));assert.deepEqual(saved,owner);assert.equal((await stat(directory)).uid,process.getuid());
  if(started)exec('pg_ctl',['-D',data,'-m','fast','-w','-t','20','stop']);
  assert(spawnSync(join(bin,'pg_ctl'),['-D',data,'status'],{env:environment,encoding:'utf8',timeout:5000}).status!==0);
  const log=await readFile(join(directory,'postgres.log'),'utf8').catch(()=> '');
  if(process.exitCode)await writeFile(output+'.failure.log',log,{mode:0o600,flag:'wx'});
  await rm(directory,{recursive:true,force:false});
}

if (!process.exitCode && receipt) {
  receipt.cleanup = { ownedClusterStopped: true, ownedDirectoryRemoved: true };
  await writeFile(output,JSON.stringify(receipt,null,2)+'\n',{mode:0o600,flag:'wx'});
  console.log(JSON.stringify(receipt));
}
