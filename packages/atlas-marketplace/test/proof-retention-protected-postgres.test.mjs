import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {hash} from '../src/contract.mjs';
import {retentionProtectedPostgresConnectionConfiguration,createProofRetentionProtectedConnectionOwner,assertProofRetentionProtectedConnectionOwner} from '../src/proof-retention-postgres-connection.mjs';
import {createProofRetentionProtectedPostgresWriter} from '../src/proof-retention-postgres-writer.mjs';
import {createProofRetentionProtectedPostgresStore,retentionProtectedTransitionIdentity} from '../src/proof-retention-protected-postgres.mjs';
import {RETENTION_PROTECTED_CATALOG_QUERIES,validateRetentionProtectedCatalog} from '../src/proof-retention-protected-catalog.mjs';
const binding={schema:'atlas-marketplace-proof-intake-v1',environment:'SYNTHETIC_LOCAL',policyHash:hash('policy'),storageHash:hash('storage')};
const config=()=>({schema:'atlas-proof-retention-protected-connection-v1',driverDirectory:'/reviewed/driver',endpoint:{kind:'LOCAL_UNIX',directory:'/reviewed/socket',port:55495},database:'atlas_marketplace_review_candidate',role:'atlas_proof_retention_writer',functionOwner:'atlas_marketplace_owner',password:''});
test('protected path is default-off, refuses supplied producers and never loads a driver for non-synthetic scope',()=>{
 for(const factory of [createProofRetentionProtectedPostgresWriter,createProofRetentionProtectedConnectionOwner,createProofRetentionProtectedPostgresStore]){assert.equal(factory(),null);for(const key of ['pool','query','store','authorize','functionHashes'])assert.throws(()=>factory({[key]:()=>assert.fail('callback')}));}
 assert.throws(()=>assertProofRetentionProtectedConnectionOwner({connect(){assert.fail('called');}}));
 assert.throws(()=>createProofRetentionProtectedPostgresStore({enabled:true,owner:{binding:{installedBinding:{binding}}}}),{code:'RETENTION_PROTECTED_OWNER_REQUIRED'});
 assert.throws(()=>createProofRetentionProtectedPostgresWriter({enabled:true,configuration:config(),binding:{...binding,environment:'PRODUCTION'},maxOperations:4}),{code:'RETENTION_PROTECTED_AUTHORITY_NOT_IMPLEMENTED'});
});
test('protected explicit configuration rejects generic role, supplied hashes, ambient and getter options',()=>{
 const c=config(),copy=retentionProtectedPostgresConnectionConfiguration(c);assert.deepEqual(copy,c);assert.ok(Object.isFrozen(copy.endpoint));
 for(const patch of [{role:'atlas_marketplace_writer'},{database:'other'},{functionOwner:'other'},{functionDefinitionHashes:{}},{connectionString:'postgres://ignored'},{password:()=>''},{endpoint:{...c.endpoint,port:'55495'}}])assert.throws(()=>retentionProtectedPostgresConnectionConfiguration({...c,...patch}));
 let calls=0;assert.throws(()=>retentionProtectedPostgresConnectionConfiguration({...c,get endpoint(){calls++;return c.endpoint;}}));assert.equal(calls,0);
});
test('catalog observations cannot substitute role, PostgreSQL major, missing closure, or coerce booleans',()=>{
 const identity={role:'atlas_proof_retention_writer',session_role:'atlas_proof_retention_writer',database:'atlas_marketplace_review_candidate',version:170011,encoding:'UTF8',search_path:'pg_catalog',replication_role:'origin',read_only:'off',synchronous_commit:'on',fsync:'on',full_page_writes:'on',roles:['atlas_marketplace_owner','atlas_marketplace_writer','atlas_proof_retention_writer'].map(name=>({name,login:name!=='atlas_marketplace_owner',super:false,inherit:false,createDb:false,createRole:false,replication:false,bypass:false})),membership:false,settings:false};
 const s=Object.fromEntries(Object.keys(RETENTION_PROTECTED_CATALOG_QUERIES).map(k=>[k,[]]));s.identity=[identity];s.schema=[{}];
 for(const patch of [{role:'atlas_marketplace_owner'},{session_role:'admin'},{version:160011},{version:180000},{replication_role:'replica'},{fsync:'off'},{synchronous_commit:'off'},{membership:0},{membership:true},{settings:null}])assert.throws(()=>validateRetentionProtectedCatalog({...s,identity:[{...identity,...patch}]}),{code:'RETENTION_PROTECTED_IDENTITY'});
 assert.throws(()=>validateRetentionProtectedCatalog(s));assert.throws(()=>validateRetentionProtectedCatalog({...s,authority:true}));
});
test('all fifteen source-owned function body pins match exact inert SQL closure including renamed common CAS',()=>{
 const source=fs.readFileSync(new URL('../src/proof-retention-protected-catalog.mjs',import.meta.url),'utf8'),literal=source.match(/const FUNCTIONS=decoderFreeze\((.*)\);\n/)[1],pins=JSON.parse(literal),found=[];
 for(const [file,base] of [['proposal.sql',true],['r1-proof-retention-gateway-proposal.sql',false]]){const sql=fs.readFileSync(new URL('../sql/'+file,import.meta.url),'utf8');for(const match of sql.matchAll(/CREATE FUNCTION atlas_marketplace\.(\w+)\((.*?)\)\s*RETURNS\s+(.*?)\s+LANGUAGE\s+(sql|plpgsql)(.*?)AS \$\$(.*?)\$\$;/gs)){let [,name,args,,,,body]=match;if(base&&name==='commit_state')name='commit_state_internal_v1';const signature=name+'('+(args?args.split(',').map(a=>a.trim().split(/\s+/)[1]).join(', '):'')+')';found.push(signature);const pin=pins.find(p=>p.name===signature);assert.ok(pin,signature);assert.equal(pin.bodyHash,createHash('sha256').update(body).digest('hex'),signature);}}
 assert.equal(found.length,15);assert.equal(new Set(found).size,15);assert.equal(pins.length,15);
});
test('protected CAS identity derives one new original, rejects history rewrites, ambiguity, and copied hash mismatches',()=>{
 const id=randomUUID(),operation={operationId:id,originalSha256:hash('original')},record={operation,operationHash:hash(operation),phase:'COMMITTED'},prior={marketplaceProofRetentionOperations:{}},next={marketplaceProofRetentionOperations:{[id]:record}};
 assert.deepEqual(retentionProtectedTransitionIdentity(prior,next),{operationId:id,operationHash:record.operationHash});
 assert.throws(()=>retentionProtectedTransitionIdentity(prior,prior));
 assert.throws(()=>retentionProtectedTransitionIdentity(prior,{marketplaceProofRetentionOperations:{[id]:record,[randomUUID()]:record}}));
 assert.throws(()=>retentionProtectedTransitionIdentity(prior,{marketplaceProofRetentionOperations:{[id]:{...record,operationHash:hash('borrowed')}}}));
 const second=randomUUID(),other={operation:{operationId:second},operationHash:hash({operationId:second}),phase:'CANCELLED_BEFORE_COMMIT'};
 assert.throws(()=>retentionProtectedTransitionIdentity(next,{marketplaceProofRetentionOperations:{[id]:{...record,phase:'CANCELLED_BEFORE_COMMIT'},[second]:other}}));
});
