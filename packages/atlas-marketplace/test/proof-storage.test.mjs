import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync,copyFileSync,mkdirSync,readFileSync,readdirSync,symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createEncryptedProofStorage } from '../src/proof-storage.mjs';
import { fixture,image,buyer } from './proof-fixtures.mjs';

test('immutable object refuses changed bytes, rebinding, symlink replacement and wrong key',async t=>{
  const f=fixture(t),bytes=await image(),proof=await f.retain(bytes),stored=f.store.read(s=>s.marketplaceProofObjects[proof.proofId]);
  assert.throws(()=>f.storage.put({objectKey:stored.objectKey,manifest:{...stored.manifest,purpose:'PACK'},bytes}),{code:'PROOF_OBJECT_CONFLICT'});
  const badKey=createEncryptedProofStorage({directory:join(f.directory,'objects'),encryptionKey:Buffer.alloc(32,5),keyId:'demo_test_key',storageId:'demo_owned_proof_test',environment:'SYNTHETIC_LOCAL',retentionRef:f.policy.retentionRef});t.after(()=>badKey.close());assert.throws(()=>badKey.get({objectKey:stored.objectKey}),{code:'PROOF_STORAGE_CORRUPT'});
  assert.throws(()=>f.storage.get({objectKey:'../outside'}),{code:'PROOF_OBJECT_KEY_INVALID'});
  const alternate=join(f.directory,'alternate');mkdirSync(alternate,{mode:0o700});symlinkSync(join(f.directory,'objects',stored.objectKey+'.proof'),join(alternate,stored.objectKey+'.proof'));
  const linked=createEncryptedProofStorage({directory:alternate,encryptionKey:Buffer.alloc(32,5),keyId:'demo_test_key',storageId:'demo_owned_proof_test',environment:'SYNTHETIC_LOCAL',retentionRef:f.policy.retentionRef});t.after(()=>linked.close());assert.throws(()=>linked.get({objectKey:stored.objectKey}));
});

test('storage permissions drift closes reads and no API exposes destructive retention cleanup',async t=>{
  const f=fixture(t),bytes=await image(),proof=await f.retain(bytes);
  assert.equal(f.storage.delete,undefined);assert.equal(f.storage.remove,undefined);
  chmodSync(join(f.directory,'objects'),0o755);await assert.rejects(f.intake.read(buyer,{proofId:proof.proofId}),{code:'PROOF_STORAGE_PERMISSIONS_REFUSED'});chmodSync(join(f.directory,'objects'),0o700);
  assert.ok((await f.intake.read(buyer,{proofId:proof.proofId})).bytes.equals(bytes));
});
