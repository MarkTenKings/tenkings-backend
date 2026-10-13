import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { applyStandaloneBaseline } from '../migrate.mjs';
import { disabledRetainedControls, prepareRetainedCopy, executeRetainedCopy, retainedCopyHash } from '../retained-copy.mjs';

const [bin, modulePath, sourcePath, output] = process.argv.slice(2);
assert(process.argv.length === 6 && [bin,modulePath,sourcePath,output].every(p => p.startsWith('/')), 'Explicit local tools, private snapshot and new output required');
assert(!Object.keys(process.env).some(k => /^(DATABASE_URL|DIRECT_URL|ATLAS_.*DATABASE_URL|PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATABASE|PGSERVICE|PGSERVICEFILE)$/.test(k)), 'Ambient database settings refused');
const { default: pg } = await import(pathToFileURL(modulePath));
const snapshot = JSON.parse(await readFile(sourcePath, 'utf8'));
const binding = {mode:'PRODUCTION',origin:'https://atlasgrading.com',deploymentId:'standalone-rehearsal.vercel.app',releaseSha:'1'.repeat(40),configHash:'2'.repeat(64)};
const options = {controlRows:disabledRetainedControls(snapshot,{staff:binding,publicReader:binding,customer:binding,customerService:binding,commerce:{configHash:'3'.repeat(64),merchant:{}},at:'2026-10-13T05:33:11.847023Z'}),geometryConcurrency:12,neutralReleaseId:'standalone-rehearsal-empty',reason:'Owned local rehearsal of owner-requested empty ATLAS baseline; no serving activation.'};
const {plan,sha256} = prepareRetainedCopy(snapshot, options);
const directory=await mkdtemp('/private/tmp/atlas-copy-qualification-'),data=join(directory,'data'),nonce=randomUUID();
const environment={PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C'};
const exec=(name,args)=>{const r=spawnSync(join(bin,name),args,{env:environment,encoding:'utf8',timeout:30000});if(r.status!==0)throw Error(`${name} failed`);return r.stdout;};
assert.match(exec('postgres',['--version']),/^postgres \(PostgreSQL\) 17\./);
const owner={nonce,uid:process.getuid(),directory,data};
await writeFile(join(directory,'ownership.json'),JSON.stringify(owner),{mode:0o600,flag:'wx'});
let started=false,client,receipt;const checks=[];
try {
  const invalid=structuredClone(snapshot);invalid.observation.counts['atlas_manual.card']=1;
  assert.throws(()=>prepareRetainedCopy(invalid,options),/SOURCE_MUST_BE_EMPTY/);checks.push('source physical-card contamination refuses plan');
  const pending=structuredClone(snapshot),effect=pending.observation.rows['atlas_customer.CommerceEffect'][0];
  if(effect){const row=JSON.parse(effect);row.state='UNKNOWN';pending.observation.rows['atlas_customer.CommerceEffect'][0]=JSON.stringify(row);assert.throws(()=>prepareRetainedCopy(pending,options),/UNRECONCILED_COMMERCE_EFFECT/);}
  checks.push('unreconciled financial effects refuse plan');
  const active=structuredClone(options);active.controlRows['atlas_staff.StaffControl'][0].enabled=true;
  assert.throws(()=>prepareRetainedCopy(snapshot,active),/CONTROL_MUST_REMAIN_DISABLED/);checks.push('enabled control import refused');
  exec('initdb',['-D',data,'--auth=trust','--username=atlas_fixture_owner','--encoding=UTF8','--no-locale']);
  exec('pg_ctl',['-D',data,'-l',join(directory,'postgres.log'),'-o',`-c listen_addresses='' -c unix_socket_directories='${directory}' -c fsync=off`,'-w','-t','20','start']);started=true;
  client=new pg.Client({host:directory,port:5432,database:'postgres',user:'atlas_fixture_owner'});await client.connect();
  await client.query('CREATE DATABASE atlas_copy_fixture');await client.end();
  client=new pg.Client({host:directory,port:5432,database:'atlas_copy_fixture',user:'atlas_fixture_owner'});await client.connect();
  await applyStandaloneBaseline(client);
  await assert.rejects(()=>executeRetainedCopy(client,{plan,reviewedPlanSha256:'0'.repeat(64),expectedDatabase:'atlas_copy_fixture'}),/COPY_PLAN_REVIEW_HASH_DIFFERS/);checks.push('unreviewed plan hash refused before transaction');
  await assert.rejects(()=>executeRetainedCopy(client,{plan,reviewedPlanSha256:sha256,expectedDatabase:'different_database'}),/TARGET_DATABASE_DIFFERS/);checks.push('different target database refused');
  const run=()=>executeRetainedCopy(client,{plan,reviewedPlanSha256:sha256,expectedDatabase:'atlas_copy_fixture'});
  const rehearsal=await run();assert.equal(rehearsal.status,'ROLLBACK_REHEARSAL_PASSED');checks.push('exact private retained snapshot restores with four named trigger exceptions and rolls back');
  assert.equal((await client.query('SELECT count(*)::int n FROM atlas_customer."CustomerAccount"')).rows[0].n,0);
  assert.equal((await client.query('SELECT count(*)::int n FROM atlas_manual.learning_activation_history')).rows[0].n,0);checks.push('rollback leaves no copied accounts or neutral activation history');
  const committed=await executeRetainedCopy(client,{plan,reviewedPlanSha256:sha256,expectedDatabase:'atlas_copy_fixture',commit:true});
  assert.equal(committed.status,'COPIED_DISABLED_NEUTRAL_BASELINE');checks.push('local-only committed restore retains exact financial/account bytes and creates one fresh empty release');
  await assert.rejects(run,/TARGET_NOT_EMPTY/);checks.push('repeat execution refuses nonempty target instead of duplicating retained facts');
  await assert.rejects(()=>client.query('INSERT INTO atlas_staff."SmsPilotControl"(application) VALUES(\'STAFF\')'),/immutable|retained|replaced|SMS/i);
  await assert.rejects(()=>client.query('UPDATE atlas_customer."CommerceOrder" SET reference=\'changed\''),/immutable|retained/i);checks.push('restored SMS and order immutable guards still refuse new invalid mutations');
  assert.equal((await client.query("SELECT count(*)::int n FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname LIKE 'atlas_%' AND NOT t.tgisinternal AND t.tgenabled<>'O'")).rows[0].n,0);
  assert.equal((await client.query('SELECT concurrency FROM atlas_manual_connected.geometry_claim_capacity')).rows[0].concurrency,12);
  assert.equal((await client.query('SELECT count(*)::int n FROM atlas_manual.learning_release_member')).rows[0].n,0);checks.push('all161 current triggers restored; geometry12; zero lesson memberships');
  receipt={status:'STANDALONE_RETAINED_COPY_LOCAL_PASS',checks,sourceSnapshotSha256:retainedCopyHash(snapshot),sourceObservedAt:snapshot.observation.observedAt,planSha256:sha256,copyReceipt:committed,productionWrites:0,targetCalls:0,providerCalls:0,bindings:'SYNTHETIC_DISABLED_REHEARSAL_ONLY'};
} catch(error){console.error(JSON.stringify({name:error.name,code:error.code??null,message:String(error.message).split('\n')[0]}));process.exitCode=1;}
finally{
  await client?.end().catch(()=>{});assert.deepEqual(JSON.parse(await readFile(join(directory,'ownership.json'),'utf8')),owner);assert.equal((await stat(directory)).uid,process.getuid());
  if(started)exec('pg_ctl',['-D',data,'-m','fast','-w','-t','20','stop']);
  assert(spawnSync(join(bin,'pg_ctl'),['-D',data,'status'],{env:environment,encoding:'utf8',timeout:5000}).status!==0);
  await rm(directory,{recursive:true,force:false});
}
if(receipt&&!process.exitCode){receipt.cleanup={ownedClusterStopped:true,ownedDirectoryRemoved:true};await writeFile(output,JSON.stringify(receipt,null,2)+'\n',{mode:0o600,flag:'wx'});console.log(JSON.stringify({status:receipt.status,checks:checks.length,receipt:output,sourceSnapshotSha256:receipt.sourceSnapshotSha256,cleanup:receipt.cleanup}));}
