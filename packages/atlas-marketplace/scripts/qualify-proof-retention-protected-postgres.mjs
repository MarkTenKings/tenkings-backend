// Operator-only NEW isolated PostgreSQL17 fixture. Owns explicit fixed clients;
// never used by runtime. Root must review/install/seed the inert SQL beforehand.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {canonicalJSON,hash} from '../src/contract.mjs';
import {decoderContractData,decoderExact} from '../src/proof-decoder-profile.mjs';
import {createProofRetentionProtectedConnectionOwner} from '../src/proof-retention-postgres-connection.mjs';
import {createProofRetentionProtectedPostgresWriter,assertProofRetentionPostgresOutcome} from '../src/proof-retention-postgres-writer.mjs';
assert.equal(process.versions.node,'22.16.0');assert.equal(process.argv.length,3);
function read(path){
 assert.ok(isAbsolute(path)&&resolve(path)===path&&fs.realpathSync(path)===path);for(let p=dirname(path);;p=dirname(p)){const s=fs.lstatSync(p);assert.ok(s.isDirectory()&&[0,process.getuid()].includes(s.uid)&&(s.mode&0o022)===0);if(p==='/')break;}
 const fd=fs.openSync(path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);try{const s=fs.fstatSync(fd);assert.ok(s.isFile()&&s.nlink===1&&s.uid===process.getuid()&&(s.mode&0o077)===0&&s.size>0&&s.size<=131072);const raw=Buffer.alloc(s.size+1);let n=0;while(n<raw.length){const count=fs.readSync(fd,raw,n,raw.length-n,null);if(!count)break;n+=count;}assert.equal(n,s.size);for(const later of [fs.fstatSync(fd),fs.lstatSync(path)])for(const k of ['dev','ino','uid','gid','mode','nlink','size','mtimeMs','ctimeMs'])assert.equal(later[k],s[k]);const value=JSON.parse(raw.subarray(0,n));raw.fill(0);return decoderContractData(value);}finally{fs.closeSync(fd);}
}
const config=read(process.argv[2]);decoderExact(config,['schema','configuration','binding','maxOperations','operations','admin','expectedDataDirectory']);
assert.equal(config.schema,'atlas-proof-retention-protected-operator-v1');assert.equal(config.binding.environment,'SYNTHETIC_LOCAL');assert.equal(config.configuration.endpoint.kind,'LOCAL_UNIX');
decoderExact(config.operations,['clean','cancel','lostCommit','lostBeforeCommit']);assert.equal(new Set(Object.values(config.operations).map(o=>o.operationId)).size,4);assert.equal(config.maxOperations,4);
decoderExact(config.admin,['role','password']);assert.equal(config.admin.role,'atlas_r2_protected_fixture_owner');assert.equal(typeof config.admin.password,'string');assert.ok(config.admin.password.length>0&&config.admin.password.length<=4096);assert.ok(isAbsolute(config.expectedDataDirectory)&&resolve(config.expectedDataDirectory)===config.expectedDataDirectory);
// This verifies the complete pinned driver before the operator imports Client.
const owner=createProofRetentionProtectedConnectionOwner({enabled:true,configuration:config.configuration,binding:config.binding,maxOperations:config.maxOperations});
const require=createRequire(import.meta.url),Client=require(join(config.configuration.driverDirectory,'pg/lib/client.js')),endpoint=config.configuration.endpoint;
const admin=new Client({host:endpoint.directory,port:endpoint.port,database:config.configuration.database,user:config.admin.role,password:()=>config.admin.password,ssl:false,binary:false,replication:false,options:'-c search_path=pg_catalog',client_encoding:'UTF8',application_name:'atlas-r2-protected-operator-v1',fallback_application_name:'atlas-r2-protected-operator-v1',connectionTimeoutMillis:3000,query_timeout:20000,statement_timeout:15000,lock_timeout:5000,idle_in_transaction_session_timeout:15000});
admin.connectionParameters.binary=false;admin.connectionParameters.replication=false;admin.binary=false;admin.replication=false;
let writer;const results=[];let refusals=0;
const state=async()=>{const {rows}=await admin.query('SELECT revision,state_hash,document FROM atlas_marketplace.state WHERE id');assert.equal(rows.length,1);assert.equal(hash(rows[0].document),rows[0].state_hash);return rows[0];};
async function probe(){const c=await owner.connect();try{return(await c.query('SELECT atlas_marketplace.read_retention_binding_v1() AS binding')).rows;}finally{c.release();}}
async function mutate(name,apply,restore){
 const before=await state();let applied=false;
 try{applied=true;await apply();await assert.rejects(probe,error=>typeof error.code==='string'&&/^RETENTION_PROTECTED_/.test(error.code));refusals++;}
 finally{if(applied)await restore();}
 assert.deepEqual(await state(),before);await probe();results.push(name);
}
try{
 await admin.connect();const facts=(await admin.query("SELECT current_user AS role,current_database() AS database,current_setting('server_version_num') AS version,current_setting('data_directory') AS directory,current_setting('listen_addresses') AS listen,current_setting('unix_socket_directories') AS sockets,current_setting('fsync') AS fsync,current_setting('synchronous_commit') AS sync")).rows[0];
 assert.equal(facts.role,config.admin.role);assert.equal(facts.database,config.configuration.database);assert.equal(facts.version,'170011');assert.equal(facts.directory,config.expectedDataDirectory);assert.equal(facts.listen,'');assert.equal(facts.sockets,endpoint.directory);assert.equal(facts.fsync,'on');assert.equal(facts.sync,'on');assert.equal((await state()).revision,'0');
 assert.deepEqual(await probe(),[{binding:{schema:'atlas-proof-retention-installed-binding-v1',binding:config.binding,maxOperations:4}}]);results.push('actual full installed closure and bounded binding accessor');
 const wrong=createProofRetentionProtectedConnectionOwner({enabled:true,configuration:config.configuration,binding:{...config.binding,storageHash:hash('wrong installation')},maxOperations:4});try{await assert.rejects(wrong.connect(),{code:'RETENTION_PROTECTED_BINDING'});refusals++;}finally{await wrong.close();}
 results.push('actual installed binding mismatch refuses without exposing connection');
 const definitions=new Map();for(const name of ['proof_hash_v1(jsonb)','commit_state_internal_v1(bigint,text,jsonb,text,bigint)']){const definition=(await admin.query('SELECT pg_catalog.pg_get_functiondef($1::regprocedure) AS definition',['atlas_marketplace.'+name])).rows[0].definition;assert.ok(typeof definition==='string'&&Buffer.byteLength(definition)<131072);definitions.set(name,definition);}
 await mutate('private helper body substitution refused',()=>admin.query("CREATE OR REPLACE FUNCTION atlas_marketplace.proof_hash_v1(v jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$ SELECT '0'::text $$"),()=>admin.query(definitions.get('proof_hash_v1(jsonb)')));
 await mutate('common CAS body substitution refused',()=>admin.query("CREATE OR REPLACE FUNCTION atlas_marketplace.commit_state_internal_v1(expected_revision bigint,expected_hash text,next_document jsonb,next_hash text,at_ms bigint) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN RETURN expected_revision+1; END $$"),()=>admin.query(definitions.get('commit_state_internal_v1(bigint,text,jsonb,text,bigint)')));
 const cases=[
 ['PUBLIC helper execution','GRANT EXECUTE ON FUNCTION atlas_marketplace.proof_hash_v1(jsonb) TO PUBLIC','REVOKE EXECUTE ON FUNCTION atlas_marketplace.proof_hash_v1(jsonb) FROM PUBLIC'],
 ['generic helper execution','GRANT EXECUTE ON FUNCTION atlas_marketplace.proof_hash_v1(jsonb) TO atlas_marketplace_writer','REVOKE EXECUTE ON FUNCTION atlas_marketplace.proof_hash_v1(jsonb) FROM atlas_marketplace_writer'],
 ['PUBLIC direct column read','GRANT SELECT(binding) ON atlas_marketplace.proof_retention_binding_v1 TO PUBLIC','REVOKE SELECT(binding) ON atlas_marketplace.proof_retention_binding_v1 FROM PUBLIC'],
 ['PUBLIC schema CREATE','GRANT CREATE ON SCHEMA public TO PUBLIC','REVOKE CREATE ON SCHEMA public FROM PUBLIC'],
 ['generic role MAINTAIN','GRANT MAINTAIN ON atlas_marketplace.state TO atlas_marketplace_writer','REVOKE MAINTAIN ON atlas_marketplace.state FROM atlas_marketplace_writer'],
 ['owner SET ROLE membership','GRANT atlas_marketplace_owner TO atlas_proof_retention_writer','REVOKE atlas_marketplace_owner FROM atlas_proof_retention_writer'],
 ['public gateway invoker','ALTER FUNCTION atlas_marketplace.read_retention_state_v1() SECURITY INVOKER','ALTER FUNCTION atlas_marketplace.read_retention_state_v1() SECURITY DEFINER'],
 ['disabled immutable trigger','ALTER TABLE atlas_marketplace.proof_retention_binding_v1 DISABLE TRIGGER proof_retention_binding_immutable','ALTER TABLE atlas_marketplace.proof_retention_binding_v1 ENABLE TRIGGER proof_retention_binding_immutable'],
 ['weakened bound constraint','ALTER TABLE atlas_marketplace.proof_retention_binding_v1 DROP CONSTRAINT proof_retention_binding_v1_max_operations_check; ALTER TABLE atlas_marketplace.proof_retention_binding_v1 ADD CONSTRAINT proof_retention_binding_v1_max_operations_check CHECK(max_operations BETWEEN 1 AND 8192)','ALTER TABLE atlas_marketplace.proof_retention_binding_v1 DROP CONSTRAINT proof_retention_binding_v1_max_operations_check; ALTER TABLE atlas_marketplace.proof_retention_binding_v1 ADD CONSTRAINT proof_retention_binding_v1_max_operations_check CHECK(max_operations BETWEEN 1 AND 4096)'],
 ['unvalidated constraint','ALTER TABLE atlas_marketplace.state DROP CONSTRAINT state_revision_check; ALTER TABLE atlas_marketplace.state ADD CONSTRAINT state_revision_check CHECK(revision>=0) NOT VALID','ALTER TABLE atlas_marketplace.state VALIDATE CONSTRAINT state_revision_check'],
 ['changed column default','ALTER TABLE atlas_marketplace.state ALTER COLUMN revision SET DEFAULT 0','ALTER TABLE atlas_marketplace.state ALTER COLUMN revision DROP DEFAULT'],
 ['missing fourth grant','REVOKE EXECUTE ON FUNCTION atlas_marketplace.read_retention_binding_v1() FROM atlas_proof_retention_writer','GRANT EXECUTE ON FUNCTION atlas_marketplace.read_retention_binding_v1() TO atlas_proof_retention_writer']
 ];
 for(const [name,apply,restore] of cases)await mutate(name+' refused',()=>admin.query(apply),()=>admin.query(restore));
 assert.equal((await state()).revision,'0');await owner.close();
 writer=createProofRetentionProtectedPostgresWriter({enabled:true,configuration:config.configuration,binding:config.binding,maxOperations:4});
 for(const [name,action] of [['clean','COMMIT'],['cancel','CANCEL']]){const operation=config.operations[name],handle=writer.prepareRetention({operation});const result=await(action==='COMMIT'?writer.commitPrepared(handle):writer.cancelPrepared(handle,{barrierId:randomUUID(),barrierRevision:operation.retentionFenceRevision+1}));assert.equal(result.disposition,action==='COMMIT'?'COMMITTED':'CANCELLED_BEFORE_COMMIT');assert.equal(assertProofRetentionPostgresOutcome(result,{writer}).action,action);assert.throws(()=>assertProofRetentionPostgresOutcome(structuredClone(result),{writer}));assert.deepEqual(await writer.lookupPrepared(handle),result);await assert.rejects(writer.commitPrepared(handle),{code:'RETENTION_COMMIT_CONSUMED'});results.push('protected real '+name+' and exact-original lookup');}
 // Only the operator instruments source-external response loss; no runtime seam
 // and no claim of real network/power failure. SQL replies always remain actual.
 for(const [name,after] of [['lostCommit',true],['lostBeforeCommit',false]]){const operation=config.operations[name],handle=writer.prepareRetention({operation}),original=Client.prototype.query;let injected=0,error;
  Client.prototype.query=function(sql,...args){if(sql==='COMMIT'&&injected===0){injected++;return after?Promise.resolve(original.call(this,sql,...args)).then(()=>{throw new Error('OPERATOR_RESPONSE_LOSS');}):Promise.reject(new Error('OPERATOR_BEFORE_COMMIT_LOSS'));}return original.call(this,sql,...args);};
  try{await writer.commitPrepared(handle);assert.fail('expected unknown');}catch(e){error=e;}finally{Client.prototype.query=original;}
  assert.equal(injected,1);assert.equal(assertProofRetentionPostgresOutcome(error,{writer}).disposition,'UNKNOWN');await assert.rejects(writer.commitPrepared(handle),{code:'RETENTION_COMMIT_CONSUMED'});const lookup=await writer.lookupPrepared(handle);assert.equal(lookup.disposition,after?'COMMITTED':'ABSENT_HOLD');if(!after){const result=await writer.cancelPrepared(handle,{barrierId:randomUUID(),barrierRevision:operation.retentionFenceRevision+1});assert.equal(result.disposition,'CANCELLED_BEFORE_COMMIT');}results.push('protected '+name+' unknown then original lookup/cancellation');
 }
 const final=await state();assert.equal(final.revision,'4');assert.equal(final.document.events.length,4);assert.equal(Object.keys(final.document.marketplaceProofRetentionOperations).length,4);assert.equal(Object.keys(final.document.marketplaceProofObjects).length,2);
 console.log(JSON.stringify({schema:'atlas-proof-retention-protected-operator-result-v1',classification:'UNQUALIFIED',tests:results,refusals,revision:final.revision,stateHash:final.state_hash,realDatabase:true,canonicalAuthorityTested:false,initialIntakeTested:false,networkLossTested:false,publisherV4IOTested:false}));
}finally{await writer?.close();await owner.close();await admin.end();}
