import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {hash} from '../src/contract.mjs';
import {createProofRetentionPostgresConnectionOwner,assertProofRetentionPostgresConnectionOwner,retentionPostgresConnectionConfiguration} from '../src/proof-retention-postgres-connection.mjs';
import {createProofRetentionPostgresWriter,assertProofRetentionPostgresWriter,assertProofRetentionPreparedSubmission,assertProofRetentionPostgresOutcome,retentionPreparedOperation} from '../src/proof-retention-postgres-writer.mjs';
const config=()=>({schema:'atlas-proof-retention-postgres-connection-v1',driverDirectory:'/reviewed/node_modules',endpoint:{kind:'LOCAL_UNIX',directory:'/reviewed/socket',port:55492},database:'atlas_marketplace_review_candidate',role:'atlas_marketplace_writer',functionOwner:'atlas_marketplace_fn_owner',password:'',functionDefinitionHashes:{'read_state()':hash('read'),'lock_state()':hash('lock'),'commit_state(bigint, text, jsonb, text, bigint)':hash('commit')}});
const binding={schema:'atlas-marketplace-proof-intake-v1',environment:'SYNTHETIC_LOCAL',policyHash:hash('policy'),storageHash:hash('storage')};
function operation(){const o={schema:'atlas-proof-retention-operation-v1',operationId:randomUUID(),uploadId:'demo_upload',proofId:'demo_proof',orderId:'demo_order',orderHash:hash('order'),actorId:'demo_buyer',actorRole:'BUYER',actorAccessBindingHash:hash('actor'),originalRequestHash:hash('request'),policyHash:binding.policyHash,intakeBindingHash:hash(binding),objectKey:hash({binding,uploadId:'demo_upload'}),manifestHash:hash('manifest'),originalSha256:hash('original'),originalByteCount:20,validationAttemptId:randomUUID(),decoderRequestId:randomUUID(),publicationLedgerId:randomUUID(),publicationSessionId:randomUUID(),publicationOperationId:randomUUID(),publicationRevision:9,publicationEvidenceHash:hash('publication'),qualificationSessionId:randomUUID(),retentionFenceRevision:13,expectedUploadHash:hash('upload')};return o;}
test('default-off factories perform no driver or socket work and reject injection keys/getters',()=>{
 assert.equal(createProofRetentionPostgresConnectionOwner(),null);assert.equal(createProofRetentionPostgresWriter(),null);
 for(const key of ['pool','client','query','store','journal','clock','passwordCallback'])assert.throws(()=>createProofRetentionPostgresWriter({[key]:()=>{throw new Error('called');}}));
 let called=false;assert.throws(()=>createProofRetentionPostgresConnectionOwner({get enabled(){called=true;return true;}}));assert.equal(called,false);
});
test('connection data is explicit and closed; empty explicit secret is allowed without URL/env/callback fallback',()=>{
 const c=config(),v=retentionPostgresConnectionConfiguration(c);assert.equal(v.password,'');assert.ok(Object.isFrozen(v.endpoint));assert.notEqual(v,c);
 for(const key of ['connectionString','ssl','stream','types','env','service','connectionTimeoutMillis'])assert.throws(()=>retentionPostgresConnectionConfiguration({...c,[key]:'injected'}));
 for(const password of [null,undefined,()=>'',{},'x'.repeat(4097)])assert.throws(()=>retentionPostgresConnectionConfiguration({...c,password}));
 assert.throws(()=>retentionPostgresConnectionConfiguration({...c,functionDefinitionHashes:{...c.functionDefinitionHashes,'extra()':hash('extra')}}));
 assert.throws(()=>retentionPostgresConnectionConfiguration({...c,endpoint:{...c.endpoint,port:'55492'}}));
});
test('remote profile requires an explicit DNS endpoint and pinned CA data, with no caller TLS switches',()=>{
 const c=config(),endpoint={kind:'VERIFIED_TLS',hostname:'db.example.test',port:5432,ca:'-----BEGIN CERTIFICATE-----\npublic fixture syntax only\n-----END CERTIFICATE-----\n'};
 assert.equal(retentionPostgresConnectionConfiguration({...c,endpoint}).endpoint.kind,'VERIFIED_TLS');
 for(const bad of [{...endpoint,rejectUnauthorized:false},{...endpoint,hostname:'127.0.0.1'},{...endpoint,ca:''},{...endpoint,key:'secret'}])assert.throws(()=>retentionPostgresConnectionConfiguration({...c,endpoint:bad}));
});
test('prepared full C1 identity copies and freezes exact fields without substituting a new ID/key/revision',()=>{
 const o=operation(),copy=retentionPreparedOperation(o,binding);assert.deepEqual(copy,o);assert.ok(Object.isFrozen(copy));o.proofId='demo_changed';assert.equal(copy.proofId,'demo_proof');
 for(const bad of [{...copy,objectKey:hash('new key')},{...copy,intakeBindingHash:hash('other binding')},{...copy,qualificationSessionId:'fixture'},{...copy,publicationRevision:0},{...copy,extra:true},{...copy,originalByteCount:10485761}])assert.throws(()=>retentionPreparedOperation(bad,binding));
});
test('private connection/writer/handle/outcome verifiers refuse plain JSON and callback-shaped producers',()=>{
 const fake={connect(){throw new Error('never called');},lookupDisposition(){throw new Error('never called');}},handle={report:{operation:operation()}},outcome={disposition:'COMMITTED'};
 assert.throws(()=>assertProofRetentionPostgresConnectionOwner(fake));assert.throws(()=>assertProofRetentionPostgresWriter(fake));assert.throws(()=>assertProofRetentionPreparedSubmission(handle,{writer:fake}));assert.throws(()=>assertProofRetentionPostgresOutcome(outcome,{writer:fake}));
});
test('generic writer cannot create a production producer before the protected gateway adapter exists',()=>{
 assert.throws(()=>createProofRetentionPostgresWriter({enabled:true,configuration:config(),binding:{...binding,environment:'PRODUCTION'},maxOperations:16}),{code:'RETENTION_PROTECTED_GATEWAY_REQUIRED'});
});
