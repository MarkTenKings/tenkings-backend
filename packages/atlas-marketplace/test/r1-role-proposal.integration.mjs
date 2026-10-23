// Explicit owned cluster only. Not part of the default *.test.mjs suite.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,writeFile,chmod,stat,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createPostgresStore,emptyMarketplaceState,POSTGRES_STORE_FORMAT} from '../src/store-postgres.mjs';
import {canonicalJSON,hash} from '../src/contract.mjs';

const run=promisify(execFile),bin='/opt/homebrew/opt/postgresql@17/bin';
const [pgPath,receiptPath]=process.argv.slice(2);
assert.ok(pgPath?.endsWith('/continuation/deps/node_modules/pg/lib/index.js'));
assert.ok(receiptPath?.endsWith('/continuation/r2-host-role-proposal-receipt.json'));
const {default:{Pool}}=await import(pathToFileURL(pgPath));
const root=await mkdtemp('/private/tmp/atlas-r2-host-qa-');await chmod(root,0o700);
const socket=root+'/socket',data=root+'/data';await mkdir(socket,{mode:0o700});
assert.equal((await stat(root)).mode&0o777,0o700);assert.equal((await stat(socket)).mode&0o777,0o700);
const digest=value=>createHash('sha256').update(value).digest('hex');
const schema=await readFile(new URL('../sql/proposal.sql',import.meta.url),'utf8');
const proposal=await readFile(new URL('../sql/r1-marketplace-role-proposal.sql',import.meta.url),'utf8');
const guard="DO $$ BEGIN RAISE EXCEPTION 'R1_MARKETPLACE_ROLE_PROPOSAL_NOT_APPROVED'; END $$;";
assert.equal(proposal.split(guard).length,2);
const qualifiedBody=proposal.replace(guard,'-- Owned disposable qualification removed exactly the unconditional proposal guard.');
const receipt={schema:'atlas-r2-owned-role-qualification-v1',environment:'PROVIDER_SANDBOX',realProvider:false,sharedDatabase:false,clusterRoot:root,
  scriptHash:digest(await readFile(new URL(import.meta.url))),storageProposalHash:digest(schema),guardedRoleProposalHash:digest(proposal),qualifiedBodyHash:digest(qualifiedBody),guardRemovedOnlyInMemory:true,port:65433,checks:[]};
let started=false,store;const pools=[];
try {
  await run(bin+'/initdb',['-D',data,'-U','r2_host_qa_admin','--auth-local=trust','--auth-host=reject','--encoding=UTF8','--locale=C']);
  await run(bin+'/pg_ctl',['-D',data,'-l',root+'/postgres.log','-o',`-k ${socket} -p 65433 -c listen_addresses='' -c unix_socket_permissions=0700`,'-w','start']);started=true;
  const connection={host:socket,port:65433,user:'r2_host_qa_admin',database:'postgres',max:2};
  const admin=new Pool(connection);pools.push(admin);
  assert.equal((await admin.query('SHOW listen_addresses')).rows[0].listen_addresses,'');receipt.tcpDisabled=true;
  await admin.query('CREATE DATABASE atlas_marketplace_review_candidate');
  const owner=new Pool({...connection,database:'atlas_marketplace_review_candidate'});pools.push(owner);
  await owner.query(schema);
  const ownerClient=await owner.connect();
  try {await assert.rejects(ownerClient.query(proposal),/R1_MARKETPLACE_ROLE_PROPOSAL_NOT_APPROVED/);}finally{await ownerClient.query('ROLLBACK');ownerClient.release();}
  receipt.checks.push('unmodified proposal guard refuses execution');
  await owner.query(qualifiedBody);
  const roles=(await owner.query("SELECT rolname,rolcanlogin,rolinherit,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname IN ('atlas_marketplace_owner','atlas_marketplace_writer') ORDER BY rolname")).rows;
  assert.equal(roles.length,2);assert.equal(roles[0].rolcanlogin,false);assert.equal(roles[1].rolcanlogin,true);
  for(const role of roles)for(const key of ['rolinherit','rolsuper','rolcreatedb','rolcreaterole','rolreplication','rolbypassrls'])assert.equal(role[key],false);
  const empty=emptyMarketplaceState();await owner.query('INSERT INTO atlas_marketplace.state VALUES(true,$1,$2,0,$3::jsonb,$4)',[POSTGRES_STORE_FORMAT,'PROVIDER_SANDBOX',canonicalJSON(empty),hash(empty)]);
  const writer=new Pool({...connection,database:'atlas_marketplace_review_candidate',user:'atlas_marketplace_writer'});pools.push(writer);
  const functions=(await writer.query("SELECT p.proname,pg_get_userbyid(p.proowner) AS owner,p.prosecdef,p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND has_function_privilege(current_user,p.oid,'EXECUTE') ORDER BY p.proname")).rows;
  assert.deepEqual(functions.map(row=>row.proname),['commit_state','lock_state','read_state']);
  for(const fn of functions){assert.equal(fn.owner,'atlas_marketplace_owner');assert.equal(fn.prosecdef,true);assert.deepEqual(fn.proconfig,['search_path=pg_catalog']);}
  for(const sql of ['SELECT * FROM atlas_marketplace.state','UPDATE atlas_marketplace.state SET revision=9','DELETE FROM atlas_marketplace.journal','SELECT atlas_marketplace.reject_change()','CREATE TABLE public.refused(id integer)'])await assert.rejects(writer.query(sql),{code:'42501'});
  receipt.checks.push('distinct NOLOGIN owner and no-membership writer','exact three SECURITY DEFINER gateways with pg_catalog only','direct state read/write and journal deletion refused','trigger execution and public schema creation refused');
  store=createPostgresStore({enabled:true,pool:writer,environment:'PROVIDER_SANDBOX',expectedRole:'atlas_marketplace_writer',expectedDatabase:'atlas_marketplace_review_candidate',expectedFunctionOwner:'atlas_marketplace_owner'});
  assert.deepEqual(await store.read(),empty);
  await store.transaction(tx=>{tx.state.roleProposalQualification={kind:'OWNED_DISPOSABLE_PG_ONLY'};});
  const state=await store.read();assert.equal(state.roleProposalQualification.kind,'OWNED_DISPOSABLE_PG_ONLY');
  receipt.checks.push('actual runtime privilege qualification, durable commit and read');receipt.stateHash=hash(state);receipt.journalEntries=state.journals.length;
  const client=await owner.connect();
  try {await client.query('BEGIN');await client.query('SET LOCAL ROLE atlas_marketplace_owner');await client.query("CREATE FUNCTION atlas_marketplace.future_ungranted() RETURNS integer LANGUAGE sql AS 'SELECT 1'");assert.equal((await client.query("SELECT has_function_privilege('atlas_marketplace_writer','atlas_marketplace.future_ungranted()','EXECUTE') AS allowed")).rows[0].allowed,false);}finally{await client.query('ROLLBACK');client.release();}
  receipt.checks.push('new owner functions do not inherit PUBLIC EXECUTE');receipt.result='PASSED';
} catch(error) {receipt.result='FAILED';receipt.errorCode=error.code??'ASSERTION_FAILED';throw error;}
finally {
  store?.close();await Promise.all(pools.map(pool=>pool.end()));
  if(started){await run(bin+'/pg_ctl',['-D',data,'-m','fast','-w','stop']);try{await run(bin+'/pg_ctl',['-D',data,'status']);assert.fail('cluster still running');}catch(error){assert.equal(error.code,3);}receipt.clusterStopped=true;}
  await writeFile(receiptPath,JSON.stringify(receipt,null,2)+'\n',{mode:0o600});
}
console.log(JSON.stringify(receipt));
