// Operator-only actual PostgreSQL producer qualification. No database setup,
// credentials discovery, role changes, publication or customer authorization.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {createProofRetentionPostgresWriter,assertProofRetentionPreparedSubmission,assertProofRetentionPostgresOutcome} from '../src/proof-retention-postgres-writer.mjs';
import {createProofRetentionPostgresConnectionOwner} from '../src/proof-retention-postgres-connection.mjs';
import {decoderContractData,decoderExact} from '../src/proof-decoder-profile.mjs';
assert.equal(process.versions.node,'22.16.0');assert.equal(process.argv.length,3);
function read(path){assert.ok(isAbsolute(path)&&resolve(path)===path&&fs.realpathSync(path)===path);for(let p=dirname(path);;p=dirname(p)){const s=fs.lstatSync(p);assert.ok(s.isDirectory()&&[0,process.getuid()].includes(s.uid)&&(s.mode&0o022)===0);if(p==='/')break;}const fd=fs.openSync(path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);try{const s=fs.fstatSync(fd);assert.ok(s.isFile()&&s.nlink===1&&[0,process.getuid()].includes(s.uid)&&(s.mode&0o077)===0&&s.size>0&&s.size<=131072);const bytes=Buffer.alloc(s.size+1);let n=0;while(n<bytes.length){const count=fs.readSync(fd,bytes,n,bytes.length-n,null);if(!count)break;n+=count;}assert.equal(n,s.size);for(const later of [fs.fstatSync(fd),fs.lstatSync(path)])for(const key of ['dev','ino','uid','gid','mode','nlink','size','mtimeMs','ctimeMs'])assert.equal(later[key],s[key]);const value=JSON.parse(bytes.subarray(0,n));bytes.fill(0);return decoderContractData(value);}finally{fs.closeSync(fd);}}
const config=read(process.argv[2]);decoderExact(config,['schema','configuration','binding','maxOperations','operations']);assert.equal(config.schema,'atlas-proof-retention-postgres-operator-v1');assert.equal(config.binding.environment,'SYNTHETIC_LOCAL');decoderExact(config.operations,['clean','cancel','lostCommit','lostBeforeCommit']);assert.equal(new Set(Object.values(config.operations).map(o=>o.operationId)).size,4);
const writer=createProofRetentionPostgresWriter({enabled:true,configuration:config.configuration,binding:config.binding,maxOperations:config.maxOperations}),checks=[];
async function run(name,fn){await fn();checks.push(name);}
try{
 await run('real commit mints only the exact same-writer outcome after audited PostgreSQL completion',async()=>{
  const handle=writer.prepareRetention({operation:config.operations.clean});assert.deepEqual(assertProofRetentionPreparedSubmission(handle,{writer}).operation,config.operations.clean);assert.throws(()=>assertProofRetentionPreparedSubmission(structuredClone(handle),{writer}));
  const result=await writer.commitPrepared(handle);assert.equal(result.disposition,'COMMITTED');assert.equal(assertProofRetentionPostgresOutcome(result,{writer}).disposition,'COMMITTED');assert.throws(()=>assertProofRetentionPostgresOutcome(structuredClone(result),{writer}));await assert.rejects(writer.commitPrepared(handle),{code:'RETENTION_COMMIT_CONSUMED'});
  const lookup=await writer.lookupPrepared(handle);assert.deepEqual(lookup,result);assert.equal(assertProofRetentionPostgresOutcome(lookup,{writer}).action,'LOOKUP');
 });
 await run('real exact-ID tombstone prevents subsequent original dispatch and preserves lookup',async()=>{
  const operation=config.operations.cancel,handle=writer.prepareRetention({operation}),result=await writer.cancelPrepared(handle,{barrierId:randomUUID(),barrierRevision:operation.retentionFenceRevision+1});assert.equal(result.disposition,'CANCELLED_BEFORE_COMMIT');assert.equal(assertProofRetentionPostgresOutcome(result,{writer}).action,'CANCEL');await assert.rejects(writer.commitPrepared(handle),{code:'RETENTION_COMMIT_CONSUMED'});assert.deepEqual(await writer.lookupPrepared(handle),result);
 });
 // Source-external operator instrumentation only. Every successful database
 // response still comes from the real pinned Client. The single injected
 // rejection either suppresses COMMIT sending or drops its observed response;
 // it never manufactures a positive result and is not a network-loss claim.
 const require=createRequire(import.meta.url),Client=require(join(config.configuration.driverDirectory,'pg/lib/client.js'));
 for(const [key,after] of [['lostCommit',true],['lostBeforeCommit',false]])await run('actual PostgreSQL '+key+' remains unknown until exact original lookup/cancellation',async()=>{
  const operation=config.operations[key],handle=writer.prepareRetention({operation}),original=Client.prototype.query;let injected=0;
  Client.prototype.query=function(sql,...args){if(sql==='COMMIT'&&injected===0){injected++;if(after)return Promise.resolve(original.call(this,sql,...args)).then(()=>{throw new Error('OPERATOR_RESPONSE_LOSS');});return Promise.reject(new Error('OPERATOR_BEFORE_COMMIT_LOSS'));}return original.call(this,sql,...args);};
  let unknown;try{await writer.commitPrepared(handle);assert.fail('expected unknown');}catch(error){unknown=error;}finally{Client.prototype.query=original;}
  assert.equal(injected,1);assert.equal(assertProofRetentionPostgresOutcome(unknown,{writer}).disposition,'UNKNOWN');await assert.rejects(writer.commitPrepared(handle),{code:'RETENTION_COMMIT_CONSUMED'});
  const lookup=await writer.lookupPrepared(handle);assert.equal(lookup.disposition,after?'COMMITTED':'ABSENT_HOLD');assert.equal(assertProofRetentionPostgresOutcome(lookup,{writer}).action,'LOOKUP');
  if(!after){const cancelled=await writer.cancelPrepared(handle,{barrierId:randomUUID(),barrierRevision:operation.retentionFenceRevision+1});assert.equal(cancelled.disposition,'CANCELLED_BEFORE_COMMIT');assert.deepEqual(await writer.lookupPrepared(handle),cancelled);}
 });
 await run('actual function-definition mismatch refuses before exposing a usable connection',async()=>{
  const owner=createProofRetentionPostgresConnectionOwner({enabled:true,configuration:{...config.configuration,functionDefinitionHashes:{...config.configuration.functionDefinitionHashes,'read_state()':'0'.repeat(64)}}});try{await assert.rejects(owner.connect(),{code:'RETENTION_FUNCTION_DEFINITION'});}finally{await owner.close();}
 });
}finally{await writer.close();}
console.log(JSON.stringify({schema:'atlas-proof-retention-postgres-operator-result-v1',classification:'UNQUALIFIED',customerPublicationAuthority:false,retentionAuthority:false,tests:checks,realDatabase:true,networkLossTested:false,publisherV4IOTested:false,canonicalGatewayTested:false}));
