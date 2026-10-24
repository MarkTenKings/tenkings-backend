import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {hash} from '../src/contract.mjs';
import {intakeProtectedOperation,projectIntakeProtectedOperation,intakeProtectedRecord} from '../src/proof-intake-protected-protocol.mjs';
import {createR1ProofIntakeAccountedPostgres,assertProofIntakeAccountedPostgres,proofIntakeAccountedAttemptSubmission} from '../src/proof-intake-protected-postgres.mjs';
import {createR1ProofIntakeAccountedConnectionOwner,createR1ProofRetentionIntakeConnectionOwner,createProofIntakeAccountedConnectionOwner} from '../src/proof-retention-postgres-connection.mjs';
import {createR1ProofRetentionIntakePostgresWriter} from '../src/proof-retention-postgres-writer.mjs';

import {R1_MANAGED_INSTALLATION_PROFILE,R1_MANAGED_INTAKE_CATALOG_QUERIES,R1_MANAGED_INTAKE_CLOSURE_HASH,R1_INTAKE_INSTALLED_CLOSURE_HASH,INTAKE_PROTECTED_CATALOG_QUERIES,validateR1ManagedMembershipCatalog,validateR1IntakeInstalledCatalog,validateR1RetentionIntakeInstalledCatalog,validateIntakeProtectedCatalog} from '../src/proof-intake-protected-catalog.mjs';
import {RETENTION_PROTECTED_CLOSURE_HASH} from '../src/proof-retention-protected-catalog.mjs';
import {intakeProtectedPostgresConnectionConfiguration} from '../src/proof-retention-postgres-connection.mjs';
import {publicationRetentionWriterBinding} from '../src/proof-publication-retention.mjs';

// Real-environment shape coverage only. These data are not installed policy,
// canonical actors, private decoder results, or a qualification capability.
function fixture(){
 const actorId=randomUUID(),now=Date.now(),policy={environment:'PROVIDER_SANDBOX',id:'STRUCTURAL_TEST_ONLY',version:'v1',approvalRef:'UNQUALIFIED',retentionRef:'UNQUALIFIED',reviewerAuthorityRef:'UNQUALIFIED',effectiveAt:now-1000,expiresAt:now+600000,retentionMs:86400000,maxObjectBytes:10485760,maxProofsPerOrder:2,maxRetainedObjects:10,uploadTtlMs:300000,validationLeaseMs:15000};
 const storage={schema:'atlas-marketplace-proof-encrypted-v1',storageId:'STRUCTURAL_TEST_ONLY',environment:policy.environment,retentionRef:policy.retentionRef,keyId:'structural',maxObjectBytes:10485760};
 const installation={schema:'atlas-proof-intake-installed-v1',binding:{schema:'atlas-marketplace-proof-intake-v1',environment:policy.environment,policyHash:hash(policy),storageHash:hash(storage)},policy,storage,maxOperations:4};
 const order={orderId:'atlas_order_test',cardId:'atlas_card_test',buyerId:actorId,sellerId:randomUUID(),bindingHash:hash('structural'),policyVersion:'v1',paymentIntentId:'atlas_payment_test'};
 const state={journals:[],events:[],orders:{[order.orderId]:order},intents:{[order.paymentIntentId]:{kind:'PAYMENT',status:'SUCCEEDED',confirmed:true,orderId:order.orderId,bindingHash:order.bindingHash}},fulfillment:{[order.orderId]:{deliveredAt:now-1000,releaseNotBefore:now-1000+86400000}}};
 const operation={schema:'atlas-proof-intake-operation-v1',operationId:randomUUID(),kind:'CREATE',atMs:now,bindingHash:hash(installation.binding),actor:{id:actorId,role:'BUYER'},request:{requestId:'atlas_request_test',orderId:order.orderId,purpose:'RETURN_REQUEST',declaredType:'image/png',byteCount:68,sha256:hash('structural-original')}};
 return {installation,state,operation};
}
test('real-environment protected projection preserves UUID actor, atlas key and retained-v1 manifest',()=>{
 const f=fixture(),capacity={schema:'atlas-proof-intake-capacity-v1',operations:0,creates:0,validations:0,reservedValidations:0},p=projectIntakeProtectedOperation(f.state,f.operation,f.installation,null,capacity);
 assert.match(p.upload.uploadId,/^atlas_upload_[a-f0-9]{32}$/);assert.match(p.upload.proofId,/^atlas_proof_[a-f0-9]{32}$/);assert.equal(p.upload.actorId,f.operation.actor.id);
 const record={schema:'atlas-proof-intake-record-v1',operation:f.operation,operationHash:hash(f.operation),dispatchKey:p.dispatchKey,upload:p.upload,uploadHash:hash(p.upload),revision:1};assert.deepEqual(intakeProtectedRecord(record,f.installation),record);
 for(const patch of [{actor:{...f.operation.actor,id:'demo_buyer'}},{request:{...f.operation.request,requestId:'demo_request'}},{request:{...f.operation.request,orderId:'constructor'}}])assert.throws(()=>intakeProtectedOperation({...f.operation,...patch},f.installation));
});
test('installed factories are default-off, reject callback transports and do not promote fixture factories',()=>{
 for(const factory of [createR1ProofIntakeAccountedPostgres,createR1ProofIntakeAccountedConnectionOwner,createR1ProofRetentionIntakeConnectionOwner,createR1ProofRetentionIntakePostgresWriter]){assert.equal(factory(),null);for(const key of ['pool','query','authorize','clock','catalogHashes'])assert.throws(()=>factory({[key]:()=>assert.fail('called')}));}
 const f=fixture(),accounting={schema:'atlas-proof-intake-accounting-installed-v1',intakeInstallationHash:hash(f.installation),operationalLimit:2};
 assert.throws(()=>createProofIntakeAccountedConnectionOwner({enabled:true,installation:f.installation,accounting}),{code:'INTAKE_PROTECTED_AUTHORITY_NOT_IMPLEMENTED'});
 const copied={binding:{installedIntake:f.installation},decoderAttemptReport:()=>assert.fail('called')};assert.throws(()=>assertProofIntakeAccountedPostgres(copied));assert.throws(()=>proofIntakeAccountedAttemptSubmission(copied,{}));
});
test('installed SQL function bodies match fixed source pins and keep guarded installation plus distinct roles',()=>{
 const sql=fs.readFileSync(new URL('../sql/r1-proof-intake-installation.sql',import.meta.url),'utf8'),source=fs.readFileSync(new URL('../src/proof-intake-protected-catalog.mjs',import.meta.url),'utf8');
 const pins=JSON.parse(source.match(/const INSTALLED_FUNCTION_HASHES=Object.freeze\((.*)\);/)[1]);let count=0;
 for(const m of sql.matchAll(/CREATE FUNCTION atlas_marketplace\.(\w+)\((.*?)\)\s*RETURNS\s+(.*?)\s+LANGUAGE\s+(sql|plpgsql)(.*?)AS \$\$(.*?)\$\$;/gs)){const [,name,args,,,,body]=m,signature=name+'('+(args?args.split(',').map(a=>a.trim().split(/\s+/)[1]).join(', '):'')+')';assert.equal(pins[signature],createHash('sha256').update(body).digest('hex'));count++;}
 assert.equal(count,16);assert.equal(Object.keys(pins).length,16);assert.ok(sql.indexOf('R1_PROOF_INTAKE_INSTALLATION_REQUIRES_OPERATOR')<sql.indexOf('CREATE TABLE'));
 assert.match(sql,/PROVIDER_SANDBOX','PRODUCTION/);assert.doesNotMatch(sql,/GRANT .* ON TABLE|CREATE OR REPLACE/);
});

test('real canonical role installation retains the exact operator ACL and refuses fixture database',()=>{
 const sql=fs.readFileSync(new URL('../sql/r1-proof-authority-role-installation.sql',import.meta.url),'utf8');
 assert.ok(sql.indexOf('R1_PROOF_AUTHORITY_ROLE_INSTALLATION_REQUIRES_OPERATOR')<sql.indexOf('CREATE ROLE'));
 assert.match(sql,/current_database\(\)='atlas_proof_authority_review_candidate'/);
 assert.match(sql,/authorize_mutation_v1\(jsonb\),atlas_proof_authority.begin_mutation_v1/);
 assert.doesNotMatch(sql,/GRANT SELECT.*TO atlas_proof_(request|settler|revoker)|GRANT.*TO PUBLIC/);
});

// These deliberately constructed catalog observations test refusal semantics.
// They cannot construct a private connection/producer or establish safe custody.
function managedMemberships(){return ['atlas_marketplace_owner','atlas_marketplace_writer','atlas_proof_intake_writer','atlas_proof_retention_writer'].map(role=>({role,member:'doadmin',grantor:'postgres',grantor_oid:10,grantor_super:true,member_login:true,member_super:false,member_create_role:true,admin_option:true,inherit_option:false,set_option:false}));}
test('managed membership auditor accepts only the four source-pinned bootstrap administrator edges',()=>{
 const rows=managedMemberships(),before=structuredClone(rows);
 assert.equal(validateR1ManagedMembershipCatalog(rows,'atlas_marketplace'),undefined);assert.deepEqual(rows,before);
 for(const patch of [{role:'atlas_other'},{member:'untrusted'},{member:'atlas_marketplace_writer'},{grantor:'doadmin'},{grantor_oid:11},{grantor_super:false},{member_login:false},{member_super:true},{member_create_role:false},{admin_option:false},{inherit_option:true},{set_option:true},{admin_option:1},{authority:true}]){const changed=structuredClone(rows);Object.assign(changed[0],patch);assert.throws(()=>validateR1ManagedMembershipCatalog(changed,'atlas_marketplace'),{code:'INTAKE_INSTALLED_MEMBERSHIP'});}
 for(const changed of [rows.slice(1),[...rows,rows[0]],[rows[0],rows[0],...rows.slice(2)],[...rows,{...rows[0],role:'doadmin',member:'atlas_proof_intake_writer'}]])assert.throws(()=>validateR1ManagedMembershipCatalog(changed,'atlas_marketplace'),{code:'INTAKE_INSTALLED_MEMBERSHIP'});
 for(const database of ['atlas_grading','atlas_marketplace_review_candidate','other'])assert.throws(()=>validateR1ManagedMembershipCatalog(rows,database),{code:'INTAKE_INSTALLED_MEMBERSHIP'});
 let reads=0;const changed=structuredClone(rows);Object.defineProperty(changed[0],'member',{get(){reads++;return 'doadmin';},enumerable:true});assert.throws(()=>validateR1ManagedMembershipCatalog(changed,'atlas_marketplace'));assert.equal(reads,0);
 const {operator_membership,...unchanged}=R1_MANAGED_INTAKE_CATALOG_QUERIES;assert.deepEqual(unchanged,INTAKE_PROTECTED_CATALOG_QUERIES);
 assert.match(operator_membership,/OR u\.rolname=ANY/);assert.match(operator_membership,/LIMIT 5$/);assert.notEqual(R1_MANAGED_INTAKE_CLOSURE_HASH,R1_INTAKE_INSTALLED_CLOSURE_HASH);
});
test('installed auditors require explicit managed opt-in and still reject identity, role and effective-ACL drift',()=>{
 for(const [audit,role] of [[validateR1IntakeInstalledCatalog,'atlas_proof_intake_writer'],[validateR1RetentionIntakeInstalledCatalog,'atlas_proof_retention_writer']]){
  const s=Object.fromEntries(Object.keys(R1_MANAGED_INTAKE_CATALOG_QUERIES).map(k=>[k,[]]));s.schema=[{}];s.operator_membership=managedMemberships();s.identity=[{role,session_role:role,database:'atlas_marketplace',membership:true,roles:[{name:'atlas_proof_intake_writer',login:true,super:false,inherit:false,createDb:false,createRole:false,replication:false,bypass:false}]}];s.privileges=[{role:'atlas_proof_intake_writer',database_write:false,schema_write:false,table_access:false,sequence_access:false,other_functions:false,usage:true}];
  const run=x=>audit(x,'atlas_marketplace',R1_MANAGED_INSTALLATION_PROFILE);
  // Membership acceptance alone cannot bypass the missing fixed function closure.
  assert.throws(()=>run(s),{code:'INTAKE_PROTECTED_FUNCTION'});
  assert.throws(()=>audit(s,'atlas_marketplace'));assert.throws(()=>validateIntakeProtectedCatalog(s));
  for(const profile of ['other',{},true])assert.throws(()=>audit(s,'atlas_marketplace',profile),{code:'INTAKE_INSTALLED_PROFILE'});
  assert.throws(()=>audit(s,'atlas_marketplace_review_candidate',R1_MANAGED_INSTALLATION_PROFILE),{code:'INTAKE_INSTALLED_PROFILE'});
  for(const patch of [{role:'doadmin'},{session_role:'doadmin'}]){const changed=structuredClone(s);Object.assign(changed.identity[0],patch);assert.throws(()=>run(changed),{code:'INTAKE_PROTECTED_IDENTITY'});}
  const changed=structuredClone(s);changed.identity[0].roles[0].createRole=true;assert.throws(()=>run(changed),{code:'INTAKE_PROTECTED_CATALOG'});
  for(const key of ['database_write','schema_write','table_access','sequence_access','other_functions']){const changed=structuredClone(s);changed.privileges[0][key]=true;assert.throws(()=>run(changed),{code:'INTAKE_PROTECTED_PRIVILEGES'});}
  const inconsistent=structuredClone(s);inconsistent.identity[0].membership=false;assert.throws(()=>run(inconsistent),{code:'INTAKE_INSTALLED_MEMBERSHIP'});
 }
});
test('managed configuration is real-only, TLS-only and cannot replace independent installation or authority',()=>{
 const f=fixture(),configuration={schema:'atlas-r1-proof-intake-connection-v1',driverDirectory:'/reviewed/driver',endpoint:{kind:'VERIFIED_TLS',hostname:'structural.invalid',port:5432,ca:'-----BEGIN CERTIFICATE-----\nstructural-only\n-----END CERTIFICATE-----'},database:'atlas_marketplace',role:'atlas_proof_intake_writer',functionOwner:'atlas_marketplace_owner',password:'',installationProfile:R1_MANAGED_INSTALLATION_PROFILE},accounting={schema:'atlas-proof-intake-accounting-installed-v1',intakeInstallationHash:hash(f.installation),operationalLimit:2};
 for(const patch of [{endpoint:{kind:'LOCAL_UNIX',directory:'/reviewed/socket',port:55497}},{installationProfile:'other'},{installationProfile:{operator:'doadmin'}},{database:'atlas_marketplace_review_candidate'},{database:'atlas_grading'}])assert.throws(()=>createR1ProofIntakeAccountedConnectionOwner({enabled:true,configuration:{...configuration,...patch},installation:f.installation,accounting}),{code:'INTAKE_INSTALLED_PROFILE'});
 assert.throws(()=>intakeProtectedPostgresConnectionConfiguration({...configuration,schema:'atlas-proof-intake-protected-connection-v1',database:'atlas_marketplace_review_candidate'}));
 const raw={schema:'atlas-r1-proof-retention-connection-v1',database:'atlas_marketplace',role:'atlas_proof_retention_writer',functionOwner:'atlas_marketplace_owner',endpoint:{kind:'VERIFIED_TLS',hostname:'structural.invalid',port:5432,caHash:hash('structural-only')},installationProfile:R1_MANAGED_INSTALLATION_PROFILE,driverInventoryHash:hash('structural-only'),protectedCatalogHash:RETENTION_PROTECTED_CLOSURE_HASH,installedBinding:{binding:f.installation.binding,maxOperations:4},intakeCatalogHash:R1_MANAGED_INTAKE_CLOSURE_HASH,installedIntake:f.installation};
 const binding=c=>({schema:'atlas-proof-retention-writer-binding-v1',classification:'UNQUALIFIED',customerPublicationAuthority:false,retentionAuthority:false,intakeBinding:f.installation.binding,connection:{...c,bindingHash:hash(c)},maxOperations:4});
 assert.deepEqual(publicationRetentionWriterBinding(binding(raw)),binding(raw));
 assert.throws(()=>createR1ProofRetentionIntakePostgresWriter({enabled:true,owner:binding(raw)}));
 for(const patch of [{installationProfile:'other'},{database:'atlas_marketplace_review_candidate'},{database:'atlas_grading'},{intakeCatalogHash:R1_INTAKE_INSTALLED_CLOSURE_HASH},{role:'doadmin'},{schema:'atlas-proof-retention-intake-connection-v1'},{endpoint:{kind:'LOCAL_UNIX',directory:'/reviewed/socket',port:55497}}])assert.throws(()=>publicationRetentionWriterBinding(binding({...raw,...patch})));
 const {installationProfile,...defaultRaw}=raw;defaultRaw.intakeCatalogHash=R1_INTAKE_INSTALLED_CLOSURE_HASH;assert.deepEqual(publicationRetentionWriterBinding(binding(defaultRaw)),binding(defaultRaw));
});
