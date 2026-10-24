// Closed extension catalog; observations are never authority. Keep the original
// retention-only audit unchanged, then validate this exact additional closure.
import {canonicalJSON,requireValue} from './contract.mjs';
import {decoderContractData,decoderExact,decoderFreeze} from './proof-decoder-profile.mjs';
import {RETENTION_PROTECTED_CATALOG_QUERIES,RETENTION_PROTECTED_CLOSURE_HASH,validateRetentionProtectedCatalog} from './proof-retention-protected-catalog.mjs';
import {createHash} from 'node:crypto';
const OWNER='atlas_marketplace_owner',ROLE='atlas_proof_intake_writer',RETENTION='atlas_proof_retention_writer';
export const INTAKE_PROTECTED_ROLE=ROLE;
const check=(v,c='INTAKE_PROTECTED_CATALOG')=>requireValue(v,c),same=(a,b)=>canonicalJSON(a)===canonicalJSON(b);
const FUNCTIONS=decoderFreeze([{"name":"check_intake_configuration_v1(jsonb)","bodyHash":"1864af22c185877a177f77121e525ba5175cb5b13d9502277de9f9c337cfe912","argnames":["c"],"result":"void","language":"plpgsql","definer":false,"volatility":"v","setof":false,"defaults":null},{"name":"project_intake_operation_v1(jsonb, jsonb, jsonb, jsonb)","bodyHash":"40eb922523dd50248528e8e16b9aa3f839ed2b63beeb9c66222667c132667b64","argnames":["old_document","o","c","original_create"],"result":"jsonb","language":"plpgsql","definer":false,"volatility":"v","setof":false,"defaults":null},{"name":"read_intake_configuration_v1()","bodyHash":"d065b77bd0dbfea199a73768a6128c2c0e5846bbdbceb3773456553225b4c184","argnames":null,"result":"jsonb","language":"plpgsql","definer":true,"volatility":"v","setof":false,"defaults":null},{"name":"read_intake_state_v1()","bodyHash":"e36032db17566b7c0866b242875b711e7133aceee0aebd2acb5d3f657e86bea0","argnames":null,"result":"atlas_marketplace.state","language":"sql","definer":true,"volatility":"v","setof":true,"defaults":null},{"name":"lookup_intake_operation_v1(uuid, text)","bodyHash":"33144a7df3710a39537c110caab2e3d1f06ee26950b2cba32ce19940886aff06","argnames":["operation_id","operation_hash"],"result":"jsonb","language":"plpgsql","definer":true,"volatility":"v","setof":false,"defaults":null},{"name":"commit_intake_operation_v1(bigint, text, jsonb, jsonb, text)","bodyHash":"82ed383428f419fb9d84005f83aaec27878e1c2bebc7a3a4815b7a7b4008546a","argnames":["expected_revision","expected_hash","operation","next_document","next_hash"],"result":"jsonb","language":"plpgsql","definer":true,"volatility":"v","setof":false,"defaults":null},{"name":"read_intake_capacity_v1()","bodyHash":"92b6f8c207f61f4ef8a27f228899bc0998e6cf1b56282e30d84b403bbeb4e5d6","argnames":null,"result":"jsonb","language":"plpgsql","definer":true,"volatility":"v","setof":false,"defaults":null}]);

const publicFunctions=['read_intake_configuration_v1()','read_intake_state_v1()','read_intake_capacity_v1()','lookup_intake_operation_v1(uuid, text)','commit_intake_operation_v1(bigint, text, jsonb, jsonb, text)'];
const tableColumns={proof_intake_binding_v1:[['id','boolean'],['configuration','jsonb']],proof_intake_operations_v1:[['operation_id','text'],['operation_hash','text'],['dispatch_key','text'],['document','jsonb']]};
const indexes={proof_intake_binding_v1_pkey:['proof_intake_binding_v1','id',true],proof_intake_operations_v1_pkey:['proof_intake_operations_v1','operation_id',true],proof_intake_operations_v1_dispatch_key_key:['proof_intake_operations_v1','dispatch_key',false]};
const checks={proof_intake_binding_v1_id_check:['proof_intake_binding_v1','id','id'],proof_intake_binding_v1_configuration_check:['proof_intake_binding_v1','configuration',"jsonb_typeof(configuration) = 'object'::text"],proof_intake_operations_v1_document_check:['proof_intake_operations_v1','document',"jsonb_typeof(document) = 'object'::text"]};
const triggers={proof_intake_binding_immutable:['proof_intake_binding_v1',27],proof_intake_binding_no_truncate:['proof_intake_binding_v1',34],proof_intake_operations_immutable:['proof_intake_operations_v1',27],proof_intake_operations_no_truncate:['proof_intake_operations_v1',34]};
export const INTAKE_PROTECTED_CATALOG_QUERIES=Object.freeze(Object.fromEntries(Object.entries(RETENTION_PROTECTED_CATALOG_QUERIES).map(([k,v])=>[k,v.replaceAll("'atlas_proof_retention_writer'","'atlas_proof_retention_writer','atlas_proof_intake_writer'")])));
export function validateIntakeProtectedCatalog(input){return validateExtension(input,ROLE);}
export function validateRetentionIntakeProtectedCatalog(input){return validateExtension(input,RETENTION);}
function validateExtension(input,expectedRole){
 const s=decoderContractData(input);decoderExact(s,Object.keys(INTAKE_PROTECTED_CATALOG_QUERIES));
 check(Buffer.byteLength(canonicalJSON(s))<=262144&&Object.values(s).every(v=>Array.isArray(v)&&v.length<=64));
 check(s.identity.length===1&&s.schema.length===1&&s.identity[0].role===expectedRole&&s.identity[0].session_role===expectedRole,'INTAKE_PROTECTED_IDENTITY');
 const observedRole={name:ROLE,login:true,super:false,inherit:false,createDb:false,createRole:false,replication:false,bypass:false};
 check(s.identity[0].roles?.filter(r=>r.name===ROLE).length===1&&same(s.identity[0].roles.find(r=>r.name===ROLE),observedRole));
 const privilege={role:ROLE,database_write:false,schema_write:false,table_access:false,sequence_access:false,other_functions:false,usage:true};
 check(s.privileges.filter(r=>r.role===ROLE).length===1&&same(s.privileges.find(r=>r.role===ROLE),privilege),'INTAKE_PROTECTED_PRIVILEGES');
 for(const f of FUNCTIONS){const expected={...f,config:['search_path=pg_catalog'],owner:OWNER,kind:'f',strict:false,leakproof:false,parallel:'u',binary:null,no_support:true,no_sqlbody:true,simple_arguments:true,cost:'100',rows:f.setof?'1000':'0',acl:[OWNER+':EXECUTE:false',...(publicFunctions.includes(f.name)?[ROLE+':EXECUTE:false']:[]),...(f.name==='read_intake_configuration_v1()'?[RETENTION+':EXECUTE:false']:[])].sort()};check(s.functions.filter(r=>r.name===f.name).length===1&&same(s.functions.find(r=>r.name===f.name),expected),'INTAKE_PROTECTED_FUNCTION');}
 const tableACL=['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'].map(v=>OWNER+':'+v+':false').sort();
 for(const [name,columns] of Object.entries(tableColumns)){
  const expected={name,kind:'r',owner:OWNER,persistence:'p',rls:false,force_rls:false,partition:false,options:null,rules:false,access_method:'heap',replica_identity:'d',inheritance:false,acl:tableACL,columns:columns.map(([name,type])=>({name,type,notnull:true,default:name==='id'?'true':null,identity:'',generated:'',dropped:false,acl:null,collation:type==='text'?'pg_catalog.default':null}))};
  check(s.relations.filter(r=>r.name===name).length===1&&same(s.relations.find(r=>r.name===name),expected),'INTAKE_PROTECTED_TABLE');
 }
 for(const [name,[table,column,primary]] of Object.entries(indexes)){
  const expected={name,table_name:table,owner:OWNER,persistence:'p',options:null,method:'btree',unique:true,primary,valid:true,ready:true,live:true,immediate:true,replica:false,nulls_not_distinct:false,plain:true,one_key:true,columns:[column],classes:['pg_catalog.'+(column==='id'?'bool':'text')+'_ops'],key_options:'0',collations:column==='id'?'0':s.schema[0].default_collation};
  check(s.indexes.filter(r=>r.name===name).length===1&&same(s.indexes.find(r=>r.name===name),expected),'INTAKE_PROTECTED_INDEX');
 }
 for(const [name,[table,column,expression]] of Object.entries({...checks,...Object.fromEntries(Object.entries(indexes).map(([n,[t,c,p]])=>[n,[t,c,p?'p':'u']]))})){
  const isCheck=Object.hasOwn(checks,name),expected={name,table_name:table,type:isCheck?'c':expression,valid:true,deferrable:false,deferred:false,local:true,inherited:0,inheritance_safe:true,no_parent:true,expression:isCheck?expression:null,columns:[column]};
  check(s.constraints.filter(r=>r.name===name).length===1&&same(s.constraints.find(r=>r.name===name),expected),'INTAKE_PROTECTED_CONSTRAINT');
 }
 for(const [name,[table,type]] of Object.entries(triggers)){
  const expected={name,table_name:table,type,enabled:'O',internal:false,no_constraint:true,deferrable:false,deferred:false,nargs:0,no_args:true,no_when:true,no_columns:true,no_transition:true,function:'atlas_marketplace.reject_change()'};
  check(s.triggers.filter(r=>r.name===name).length===1&&same(s.triggers.find(r=>r.name===name),expected),'INTAKE_PROTECTED_TRIGGER');
 }
 check(s.schema[0].acl.filter(v=>v===ROLE+':USAGE:false').length===1);
 // Only after every extension row is checked is its exact subset removed. The
 // original audit still validates all base functions, owner/grants, hooks,
 // schema/constraints, role membership, PUBLIC/inherited effective privileges.
 const base=structuredClone(s);base.identity[0].role=RETENTION;base.identity[0].session_role=RETENTION;base.identity[0].roles=base.identity[0].roles.filter(r=>r.name!==ROLE);
 base.privileges=base.privileges.filter(r=>r.role!==ROLE);base.schema[0].acl=base.schema[0].acl.filter(v=>v!==ROLE+':USAGE:false');
 base.functions=base.functions.filter(r=>!FUNCTIONS.some(f=>f.name===r.name));base.relations=base.relations.filter(r=>!Object.hasOwn(tableColumns,r.name));base.indexes=base.indexes.filter(r=>!Object.hasOwn(indexes,r.name));base.constraints=base.constraints.filter(r=>!Object.hasOwn(indexes,r.name)&&!Object.hasOwn(checks,r.name));base.triggers=base.triggers.filter(r=>!Object.hasOwn(triggers,r.name));
 validateRetentionProtectedCatalog(base);
}
export const INTAKE_PROTECTED_CLOSURE_HASH=createHash('sha256').update(canonicalJSON({base:RETENTION_PROTECTED_CLOSURE_HASH,functions:FUNCTIONS,publicFunctions,retentionReadonly:'read_intake_configuration_v1()',tableColumns,indexes,checks,triggers,queries:INTAKE_PROTECTED_CATALOG_QUERIES})).digest('hex');
