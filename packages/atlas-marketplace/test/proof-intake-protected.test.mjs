import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {hash} from '../src/contract.mjs';
import {intakeProtectedInstallation,intakeProtectedOperation,intakeProtectedCapacity,projectIntakeProtectedOperation,intakeProtectedRecord} from '../src/proof-intake-protected-protocol.mjs';
import {createProofIntakeProtectedPostgres} from '../src/proof-intake-protected-postgres.mjs';
import {createProofIntakeProtectedConnectionOwner,assertProofIntakeProtectedConnectionOwner,intakeProtectedPostgresConnectionConfiguration,retentionProtectedPostgresConnectionConfiguration} from '../src/proof-retention-postgres-connection.mjs';
import {createProofRetentionIntakeConnectionOwner,retentionIntakePostgresConnectionConfiguration} from '../src/proof-retention-postgres-connection.mjs';
import {createProofRetentionIntakePostgresWriter} from '../src/proof-retention-postgres-writer.mjs';
import {publicationRetentionWriterBinding} from '../src/proof-publication-retention.mjs';
import {RETENTION_PROTECTED_CLOSURE_HASH} from '../src/proof-retention-protected-catalog.mjs';
import {validateIntakeProtectedCatalog,validateRetentionIntakeProtectedCatalog,INTAKE_PROTECTED_CLOSURE_HASH,INTAKE_PROTECTED_CATALOG_QUERIES} from '../src/proof-intake-protected-catalog.mjs';
function fixture(){
 const policy={environment:'SYNTHETIC_LOCAL',id:'fixture',version:'v1',approvalRef:'unverified-fixture',retentionRef:'fixture-retention',reviewerAuthorityRef:'unverified-reviewer',effectiveAt:1000,expiresAt:1000000,retentionMs:86400000,maxObjectBytes:10485760,maxProofsPerOrder:2,maxRetainedObjects:10,uploadTtlMs:900000,validationLeaseMs:15000};
 const storage={schema:'atlas-marketplace-proof-encrypted-v1',storageId:'fixture',environment:'SYNTHETIC_LOCAL',retentionRef:policy.retentionRef,keyId:'fixture-key',maxObjectBytes:10485760};
 const installation={schema:'atlas-proof-intake-installed-v1',binding:{schema:'atlas-marketplace-proof-intake-v1',environment:'SYNTHETIC_LOCAL',policyHash:hash(policy),storageHash:hash(storage)},policy,storage,maxOperations:20};
 const order={orderId:'demo_order',cardId:'demo_card',buyerId:'demo_buyer',sellerId:'demo_seller',bindingHash:hash('paid'),policyVersion:'fixture-v1',paymentIntentId:'demo_payment'};
 const state={journals:[],events:[],orders:{demo_order:order},intents:{demo_payment:{kind:'PAYMENT',status:'SUCCEEDED',confirmed:true,orderId:'demo_order',bindingHash:order.bindingHash}},fulfillment:{demo_order:{deliveredAt:1000,releaseNotBefore:86401000}},marketplaceProofUploads:{demo_old:{orderId:'demo_other',status:'VALIDATING',attempts:7,lease:'legacy'}},marketplaceProofObjects:{demo_retained:{manifest:'historical'}},marketplaceProofReviews:{demo_retained:{decision:'APPROVE'}},other:{must:'survive'}};
 const operation={schema:'atlas-proof-intake-operation-v1',operationId:randomUUID(),kind:'CREATE',atMs:2000,bindingHash:hash(installation.binding),actor:{id:'demo_buyer',role:'BUYER'},request:{requestId:'demo_request',orderId:'demo_order',purpose:'RETURN_REQUEST',declaredType:'image/png',byteCount:68,sha256:hash('original')}};
 return {installation,state,operation};
}
const capacity=(creates=0,validations=0)=>({schema:'atlas-proof-intake-capacity-v1',operations:creates+validations,creates,validations,reservedValidations:creates-validations});
const project=(state,o,c,original=null,counts=capacity(original?1:0))=>projectIntakeProtectedOperation(state,o,c,original,counts);
function created(f){const projection=project(f.state,f.operation,f.installation);const record={schema:'atlas-proof-intake-record-v1',operation:f.operation,operationHash:hash(f.operation),dispatchKey:projection.dispatchKey,upload:projection.upload,uploadHash:hash(projection.upload),revision:1};return {...projection,record};}
function validate(f,c){return {schema:'atlas-proof-intake-operation-v1',operationId:randomUUID(),kind:'VALIDATE',atMs:3000,bindingHash:hash(f.installation.binding),createOperationId:f.operation.operationId,createOperationHash:hash(f.operation),expectedUploadHash:hash(c.upload),validationAttemptId:randomUUID(),decoderRequestId:randomUUID(),validation:{schema:'atlas-marketplace-proof-image-v1',decoder:'sharp-0.33.5/libvips-8.15.3',contentType:'image/png',byteCount:68,sha256:f.operation.request.sha256,width:1,height:1}};}
const configuration=()=>({schema:'atlas-proof-intake-protected-connection-v1',driverDirectory:'/reviewed/driver',endpoint:{kind:'LOCAL_UNIX',directory:'/reviewed/socket',port:55497},database:'atlas_marketplace_review_candidate',role:'atlas_proof_intake_writer',functionOwner:'atlas_marketplace_owner',password:''});
test('default-off and closed owned configuration refuse injected authority/transport before driver access',()=>{
 for(const factory of [createProofIntakeProtectedPostgres,createProofIntakeProtectedConnectionOwner]){assert.equal(factory(),null);for(const key of ['pool','query','store','authorize','clock','observer'])assert.throws(()=>factory({[key]:()=>assert.fail('called')}));}
 assert.throws(()=>assertProofIntakeProtectedConnectionOwner({connect(){assert.fail('called');}}),{code:'INTAKE_PROTECTED_OWNER_REQUIRED'});
 const c=configuration();assert.deepEqual(intakeProtectedPostgresConnectionConfiguration(c),c);assert.throws(()=>intakeProtectedPostgresConnectionConfiguration({...c,role:'atlas_marketplace_writer'}));assert.throws(()=>retentionProtectedPostgresConnectionConfiguration(c));
 let calls=0;assert.throws(()=>intakeProtectedPostgresConnectionConfiguration({...c,get password(){calls++;return '';}}));assert.equal(calls,0);
 const f=fixture();f.installation.binding.environment='PRODUCTION';assert.throws(()=>createProofIntakeProtectedPostgres({enabled:true,configuration:c,installation:f.installation}),{code:'INTAKE_PROTECTED_AUTHORITY_NOT_IMPLEMENTED'});
});
test('installation and operation shapes are closed, hash-bound and reject getters/coercions',()=>{
 const f=fixture();assert.ok(Object.isFrozen(intakeProtectedInstallation(f.installation).policy));
 for(const patch of [{maxOperations:1},{maxOperations:4097},{policy:{...f.installation.policy,maxProofsPerOrder:51}},{stageFence:true}])assert.throws(()=>intakeProtectedInstallation({...f.installation,...patch}));
 for(const patch of [{operationId:'caller'},{atMs:2.5},{bindingHash:hash('other')},{authority:true},{request:{...f.operation.request,byteCount:'68'}},{actor:{...f.operation.actor,role:'REVIEWER'}}])assert.throws(()=>intakeProtectedOperation({...f.operation,...patch},f.installation));
 let reads=0;assert.throws(()=>intakeProtectedOperation({...f.operation,get actor(){reads++;return f.operation.actor;}},f.installation));assert.equal(reads,0);
});
test('CREATE preserves exact legacy namespace/key/row shape and unrelated historical attempts without mutating input',()=>{
 const f=fixture(),before=structuredClone(f.state),c=created(f),u=c.upload;assert.deepEqual(f.state,before);
 assert.match(u.uploadId,/^demo_upload_[a-f0-9]{32}$/);assert.equal(u.proofId,'demo_proof_'+hash(u.uploadId).slice(0,32));assert.equal(u.objectKey,hash({binding:f.installation.binding,uploadId:u.uploadId}));assert.equal(u.requestHash,hash(f.operation.request));assert.equal(u.attempts,0);
 assert.deepEqual(c.next.marketplaceProofUploads.demo_old,f.state.marketplaceProofUploads.demo_old);assert.deepEqual(c.next.marketplaceProofObjects,f.state.marketplaceProofObjects);assert.deepEqual(c.next.marketplaceProofReviews,f.state.marketplaceProofReviews);assert.deepEqual(c.next.other,f.state.other);assert.equal(c.next.events.length,1);assert.equal(c.next.events[0].type,'MARKETPLACE_PROOF_PREPARED');assert.deepEqual(intakeProtectedRecord(c.record,f.installation),c.record);
 assert.throws(()=>project(c.next,{...f.operation,operationId:randomUUID()},f.installation),{code:'INTAKE_PROTECTED_ORIGINAL_HOLD'});
});
test('CREATE respects current paid order, buyer window, role purpose, quotas and original policy deadline',()=>{
 const f=fixture();
 for(const edit of [s=>s.intents.demo_payment.confirmed=false,s=>s.orders.demo_order.buyerId='demo_other',s=>s.fulfillment.demo_order.releaseNotBefore=2000]){const s=structuredClone(f.state);edit(s);assert.throws(()=>project(s,f.operation,f.installation));}
 const full=structuredClone(f.state);full.marketplaceProofUploads.a={orderId:'demo_order'};full.marketplaceProofUploads.b={orderId:'demo_order'};assert.throws(()=>project(full,f.operation,f.installation),{code:'INTAKE_PROTECTED_QUOTA'});
 assert.throws(()=>project(f.state,{...f.operation,atMs:f.installation.policy.expiresAt},f.installation),{code:'INTAKE_PROTECTED_EXPIRED'});
 assert.throws(()=>project(f.state,{...f.operation,actor:{id:'demo_staff',role:'STAFF'}},f.installation));
});
test('VALIDATE requires exact original CREATE, refuses legacy adoption/replacement and preserves retained-v1 manifest',()=>{
 const f=fixture(),c=created(f),o=validate(f,c),v=project(c.next,o,f.installation,c.record),u=v.upload,m=u.manifest;
 assert.equal(u.status,'VALIDATED');assert.equal(u.attempts,0);assert.equal(u.objectKey,c.upload.objectKey);assert.equal(m.schema,'atlas-marketplace-retained-proof-v1');assert.deepEqual(m.orderBinding,c.upload.orderBinding);assert.deepEqual(m.validation,o.validation);assert.equal(m.sha256,c.upload.plan.sha256);assert.equal(m.validatedAt,3000);
 assert.equal(v.next.events.length,2);assert.deepEqual(v.next.marketplaceProofUploads.demo_old,f.state.marketplaceProofUploads.demo_old);
 assert.throws(()=>project(c.next,o,f.installation,null,capacity(1)),{code:'INTAKE_PROTECTED_ORIGINAL_HOLD'});
 for(const patch of [{createOperationHash:hash('wrong')},{expectedUploadHash:hash('wrong')},{validation:{...o.validation,sha256:hash('replacement')}},{atMs:c.upload.expiresAt}])assert.throws(()=>project(c.next,{...o,...patch},f.installation,c.record));
 for(const patch of [{attempts:3},{status:'VALIDATING'},{status:'VALIDATED'},{status:'RETAINED'}]){const s=structuredClone(c.next);Object.assign(s.marketplaceProofUploads[c.upload.uploadId],patch);assert.throws(()=>project(s,o,f.installation,c.record),{code:'INTAKE_PROTECTED_ORIGINAL_HOLD'});}
 const record={schema:'atlas-proof-intake-record-v1',operation:o,operationHash:hash(o),dispatchKey:v.dispatchKey,upload:u,uploadHash:hash(u),revision:2};assert.deepEqual(intakeProtectedRecord(record,f.installation),record);
 const changed=structuredClone(record);changed.upload.manifest.storageId='borrowed';changed.uploadHash=hash(changed.upload);assert.throws(()=>intakeProtectedRecord(changed,f.installation));
});
test('sixteen extension function pins and fixed grants cover exact inert SQL, without changing base gateway',()=>{
 const sql=fs.readFileSync(new URL('../sql/r1-proof-intake-gateway-proposal.sql',import.meta.url),'utf8'),catalog=fs.readFileSync(new URL('../src/proof-intake-protected-catalog.mjs',import.meta.url),'utf8'),pins=JSON.parse(catalog.match(/const FUNCTIONS=decoderFreeze\((.*)\);\n/)[1]);let count=0;
 for(const m of sql.matchAll(/CREATE FUNCTION atlas_marketplace\.(\w+)\((.*?)\)\s*RETURNS\s+(.*?)\s+LANGUAGE\s+(sql|plpgsql)(.*?)AS \$\$(.*?)\$\$;/gs)){const [,name,args,,,,body]=m,signature=name+'('+(args?args.split(',').map(a=>a.trim().split(/\s+/)[1]).join(', '):'')+')';assert.equal(pins.find(p=>p.name===signature)?.bodyHash,createHash('sha256').update(body).digest('hex'));count++;}
 assert.equal(count,16);assert.equal(pins.length,16);assert.ok(sql.indexOf("RAISE EXCEPTION 'R1_PROOF_INTAKE_GATEWAY_NOT_APPROVED'")<sql.indexOf('CREATE TABLE'));assert.doesNotMatch(sql,/CREATE OR REPLACE|ALTER FUNCTION atlas_marketplace.commit_state|GRANT .* ON TABLE/);
 for(const key of ['identity','privileges'])assert.match(INTAKE_PROTECTED_CATALOG_QUERIES[key],/atlas_proof_intake_writer/);assert.throws(()=>validateIntakeProtectedCatalog({authority:true}));
});

test('composed retention is explicit, closed, default-off and retains its own role',()=>{
 for(const factory of [createProofRetentionIntakeConnectionOwner,createProofRetentionIntakePostgresWriter]){assert.equal(factory(),null);for(const key of ['pool','query','authorize','owner','clock'])assert.throws(()=>factory({[key]:()=>assert.fail('called')}));}
 const c={...configuration(),schema:'atlas-proof-retention-intake-connection-v1',role:'atlas_proof_retention_writer'};
 assert.deepEqual(retentionIntakePostgresConnectionConfiguration(c),c);
 assert.throws(()=>retentionProtectedPostgresConnectionConfiguration(c));assert.throws(()=>intakeProtectedPostgresConnectionConfiguration(c));
 for(const patch of [{role:'atlas_proof_intake_writer'},{schema:'atlas-proof-retention-protected-connection-v1'},{catalogHash:INTAKE_PROTECTED_CLOSURE_HASH}])assert.throws(()=>retentionIntakePostgresConnectionConfiguration({...c,...patch}));
 const f=fixture();f.installation.policy.id='changed';assert.throws(()=>createProofRetentionIntakePostgresWriter({enabled:true,configuration:c,installation:f.installation,maxOperations:4}),{code:'INTAKE_PROTECTED_INVALID'});
});
test('composed publication binding checks both exact installations without accepting intake-role outcomes',()=>{
 const f=fixture(),raw={schema:'atlas-proof-retention-intake-connection-v1',database:'atlas_marketplace_review_candidate',role:'atlas_proof_retention_writer',functionOwner:'atlas_marketplace_owner',endpoint:configuration().endpoint,driverInventoryHash:hash('synthetic-structure-only'),protectedCatalogHash:RETENTION_PROTECTED_CLOSURE_HASH,installedBinding:{binding:f.installation.binding,maxOperations:4},intakeCatalogHash:INTAKE_PROTECTED_CLOSURE_HASH,installedIntake:f.installation};
 const binding=c=>({schema:'atlas-proof-retention-writer-binding-v1',classification:'UNQUALIFIED',customerPublicationAuthority:false,retentionAuthority:false,intakeBinding:f.installation.binding,connection:{...c,bindingHash:hash(c)},maxOperations:4});
 assert.deepEqual(publicationRetentionWriterBinding(binding(raw)),binding(raw));
 for(const patch of [{role:'atlas_proof_intake_writer'},{intakeCatalogHash:hash('other')},{installedBinding:{...raw.installedBinding,maxOperations:5}},{installedIntake:{...f.installation,policy:{...f.installation.policy,id:'changed'}}},{schema:'atlas-proof-retention-protected-connection-v1'}])assert.throws(()=>publicationRetentionWriterBinding(binding({...raw,...patch})));
 const {intakeCatalogHash,installedIntake,...old}=raw;old.schema='atlas-proof-retention-protected-connection-v1';assert.deepEqual(publicationRetentionWriterBinding(binding(old)),binding(old));
});
test('composed catalog audits never infer a session role from another role or caller option',()=>{
 const s=Object.fromEntries(Object.keys(INTAKE_PROTECTED_CATALOG_QUERIES).map(k=>[k,[]]));s.schema=[{}];
 for(const [validate,role] of [[validateIntakeProtectedCatalog,'atlas_proof_intake_writer'],[validateRetentionIntakeProtectedCatalog,'atlas_proof_retention_writer']]){
  for(const wrong of ['admin','atlas_marketplace_writer',role==='atlas_proof_intake_writer'?'atlas_proof_retention_writer':'atlas_proof_intake_writer']){s.identity=[{role:wrong,session_role:role}];assert.throws(()=>validate(s),{code:'INTAKE_PROTECTED_IDENTITY'});s.identity=[{role,session_role:wrong}];assert.throws(()=>validate(s),{code:'INTAKE_PROTECTED_IDENTITY'});}
 }
 const sql=fs.readFileSync(new URL('../sql/r1-proof-intake-gateway-proposal.sql',import.meta.url),'utf8');assert.match(sql,/GRANT EXECUTE ON FUNCTION atlas_marketplace.read_intake_configuration_v1\(\) TO atlas_proof_retention_writer;/);assert.doesNotMatch(sql,/GRANT EXECUTE ON FUNCTION atlas_marketplace.(?:commit_intake|lookup_intake|read_intake_state).* TO atlas_proof_retention_writer;/);
});

test('CREATE capacity reserves every outstanding original VALIDATE without releasing expired or unknown entries',()=>{
 const f=fixture();f.installation.maxOperations=4;
 assert.deepEqual(intakeProtectedCapacity(capacity(),f.installation,'CREATE'),capacity());
 assert.deepEqual(intakeProtectedCapacity(capacity(1),f.installation,'CREATE'),capacity(1));
 assert.throws(()=>project(f.state,f.operation,f.installation,null,capacity(2)),{code:'INTAKE_PROTECTED_CAPACITY'});
 assert.throws(()=>project(f.state,f.operation,f.installation,null,capacity(2,1)),{code:'INTAKE_PROTECTED_CAPACITY'});
 assert.deepEqual(intakeProtectedCapacity(capacity(2,1),f.installation,'VALIDATE'),capacity(2,1));
 const c=created(f),v=validate(f,c);assert.equal(project(c.next,v,f.installation,c.record,capacity(2,1)).upload.status,'VALIDATED');
 for(const changed of [{...capacity(2),reservedValidations:0},{...capacity(),operations:1},capacity(1,2)])assert.throws(()=>intakeProtectedCapacity(changed,f.installation,'CREATE'),{code:'INTAKE_PROTECTED_CAPACITY_HOLD'});
 f.installation.maxOperations=3;assert.throws(()=>intakeProtectedCapacity(capacity(1),f.installation,'CREATE'),{code:'INTAKE_PROTECTED_CAPACITY'});
});
