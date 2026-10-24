import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../src/contract.mjs';
import {publicationRetentionWriterBinding} from '../src/proof-publication-retention.mjs';
import {RETENTION_PROTECTED_CLOSURE_HASH} from '../src/proof-retention-protected-catalog.mjs';
function binding(){
 const intakeBinding={schema:'atlas-marketplace-proof-intake-v1',environment:'SYNTHETIC_LOCAL',policyHash:hash('policy'),storageHash:hash('storage')};
 const connection={schema:'atlas-proof-retention-protected-connection-v1',database:'atlas_marketplace_review_candidate',role:'atlas_proof_retention_writer',functionOwner:'atlas_marketplace_owner',endpoint:{kind:'LOCAL_UNIX',directory:'/run/atlas-r2-pg-publisher-join-01',port:55496},driverInventoryHash:hash('driver'),protectedCatalogHash:RETENTION_PROTECTED_CLOSURE_HASH,installedBinding:{binding:structuredClone(intakeBinding),maxOperations:5}};connection.bindingHash=hash(connection);
 return {schema:'atlas-proof-retention-writer-binding-v1',classification:'UNQUALIFIED',customerPublicationAuthority:false,retentionAuthority:false,intakeBinding,connection,maxOperations:5};
}
function seal(b){const {bindingHash,...raw}=b.connection;b.connection.bindingHash=hash(raw);return b;}
test('protected historical data projection binds exact installed intake/capacity and source-owned catalog, never grants authority',()=>{
 const b=binding(),copy=publicationRetentionWriterBinding(b);assert.deepEqual(copy,b);assert.ok(Object.isFrozen(copy.connection.installedBinding));assert.equal(copy.retentionAuthority,false);
 for(const change of [x=>x.connection.installedBinding.maxOperations++,x=>x.connection.installedBinding.binding.storageHash=hash('other'),x=>x.connection.protectedCatalogHash=hash('other closure'),x=>x.connection.database='other',x=>x.connection.role='atlas_marketplace_writer',x=>x.connection.functionOwner='other',x=>x.connection.functionDefinitionHashes={},x=>x.retentionAuthority=true]){const bad=structuredClone(b);change(bad);assert.throws(()=>publicationRetentionWriterBinding(seal(bad)));}
});
test('generic historical binding remains byte-for-byte accepted under its original separate schema',()=>{
 const b=binding();b.connection={schema:'atlas-proof-retention-postgres-connection-v1',database:'old_fixture',role:'old_writer',functionOwner:'old_owner',endpoint:{kind:'LOCAL_UNIX',directory:'/old/retained',port:55494},driverInventoryHash:hash('old driver'),functionDefinitionHashes:{'read_state()':hash('read'),'lock_state()':hash('lock'),'commit_state(bigint, text, jsonb, text, bigint)':hash('commit')}};seal(b);
 assert.deepEqual(publicationRetentionWriterBinding(b),b);assert.throws(()=>publicationRetentionWriterBinding({...b,connection:{...b.connection,installedBinding:{binding:b.intakeBinding,maxOperations:5}}}));
});
