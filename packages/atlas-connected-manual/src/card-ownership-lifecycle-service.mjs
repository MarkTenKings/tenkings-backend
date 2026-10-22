// Unregistered server-only adapters. No network, role creation, routes or storage I/O.
import { requireThat } from '@atlas/manual-service/contract';
import { ownershipLifecycleInput, projectOwnershipLifecycle, ownershipProofObjectInput, ownershipProofObjectPlan, ownershipProofObjectObservation, ownershipProofCanonical } from './card-ownership-proof-contract.mjs';
const HASH = /^[a-f0-9]{64}$/, KEYS = ['mode','origin','deploymentId','releaseSha','configHash'];
const bindingOf = config => Object.fromEntries(KEYS.map(k=>[k,config?.[k]]));
const valid = ok => requireThat(ok,500,'OWNERSHIP_LIFECYCLE_ADAPTER_INVALID');
const response = ok => requireThat(ok,503,'OWNERSHIP_LIFECYCLE_RESPONSE_INVALID');
async function assertGatewayRole(tx, audience) {
  const rows = await tx.$queryRawUnsafe(`SELECT r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls
    OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid)
    OR has_database_privilege(current_user,current_database(),'CREATE')
    OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname<>'information_schema' AND has_schema_privilege(current_user,oid,'CREATE'))
    OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
      WHERE c.relkind IN ('r','p','v','m','f') AND a.attnum>0 AND NOT a.attisdropped AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'
      AND (has_column_privilege(current_user,c.oid,a.attnum,'SELECT,INSERT,UPDATE,REFERENCES') OR has_table_privilege(current_user,c.oid,'DELETE,TRUNCATE,TRIGGER')))
    OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='S'
      AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND has_sequence_privilege(current_user,c.oid,'USAGE,SELECT,UPDATE')) AS unsafe
    FROM pg_roles r WHERE r.rolname=current_user`);
  const role = ok => requireThat(ok, 503, 'OWNERSHIP_LIFECYCLE_DATABASE_ROLE_INVALID');
  role(rows.length === 1 && rows[0].unsafe === false);
  const routines = await tx.$queryRawUnsafe(`SELECT n.nspname AS schema,p.proname || '(' || oidvectortypes(p.proargtypes) || ')' AS name,
    p.prosecdef AS definer,p.proconfig AS config,p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS owned
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'
    AND NOT (NOT p.prosecdef AND p.probin='$libdir/uuid-ossp' AND EXISTS(SELECT 1 FROM pg_depend d JOIN pg_extension e ON e.oid=d.refobjid
      WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.refclassid='pg_extension'::regclass AND d.deptype='e' AND e.extname='uuid-ossp'))
    AND (p.prorettype<>'trigger'::regtype OR n.nspname IN ('atlas_ownership_evidence','atlas_ownership_proof','atlas_ownership_lifecycle')) AND has_function_privilege(current_user,p.oid,'EXECUTE')`);
  const expected = audience === 'CUSTOMER' ? 'customer_gateway(text, text, jsonb, text, jsonb)' : audience === 'REVIEWER' ? 'reviewer_gateway(text, text, jsonb, text[], text, jsonb)' : 'object_gateway(text, text, jsonb, text, jsonb)';
  role(routines.length === 1 && routines[0].schema === (audience === 'INGESTOR' ? 'atlas_ownership_proof' : 'atlas_ownership_lifecycle') && routines[0].name === expected
    && routines[0].definer === true && routines[0].owned === false && JSON.stringify(routines[0].config) === '["search_path=pg_catalog"]');
  const guards = await tx.$queryRawUnsafe(`SELECT t.tgenabled,t.tgtype,p.prosecdef,p.proconfig,n.nspname,p.proname,
    p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS owned, encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') AS source_hash
    FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE t.tgrelid=(SELECT c.oid FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE ns.nspname='atlas_ownership' AND c.relname='event')
    AND t.tgname='evidence_gateway' AND NOT t.tgisinternal`);
  role(guards.length === 1 && guards[0].tgenabled === 'O' && guards[0].tgtype === 7 && guards[0].prosecdef === true
    && guards[0].nspname === 'atlas_ownership_evidence' && guards[0].proname === 'enforce_event'
    && guards[0].owned === false && guards[0].source_hash === '110a14c67c49c0c7a3d982e3e4281876bf584dd6a97ed09c8fb83685b44c680e' && JSON.stringify(guards[0].proconfig) === '["search_path=pg_catalog"]');
}

/** Text-only proposal for a NEW restricted role. Never reuse the original writer,
 * ordinary CustomerDatabase or browser gateway role for retained observations. */
export function cardOwnershipLifecycleGrantSQL(role,audience){
 valid(typeof role==='string'&&/^[a-z][a-z0-9_]{0,62}$/.test(role)&&role!=='public'&&!role.startsWith('pg_')&&['CUSTOMER','REVIEWER','INGESTOR'].includes(audience));
 const schema=audience==='INGESTOR'?'atlas_ownership_proof':'atlas_ownership_lifecycle';
 const signature=audience==='CUSTOMER'?'customer_gateway(text,text,jsonb,text,jsonb)':audience==='REVIEWER'?'reviewer_gateway(text,text,jsonb,text[],text,jsonb)':'object_gateway(text,text,jsonb,text,jsonb)';
 return `GRANT USAGE ON SCHEMA ${schema} TO "${role}";\nGRANT EXECUTE ON FUNCTION ${schema}.${signature} TO "${role}";`;
}
function unbox(rows){response(rows.length===1&&rows[0]?.result&&typeof rows[0].result==='object');const value=rows[0].result;
 if(value.error){const{status,code}=value.error;response(Number.isInteger(status)&&status>=400&&status<=599&&/^[A-Z][A-Z0-9_]{2,90}$/.test(code));requireThat(false,status,code);}return value;}
function adapter({auth,client,audience}){
 valid(['CUSTOMER','REVIEWER','INGESTOR'].includes(audience)&&auth?.config&&typeof client?.$transaction==='function');
 valid(audience==='REVIEWER'?typeof auth.authenticate==='function'&&auth.actors instanceof WeakMap&&auth.config.phoneByHash instanceof Map:typeof auth.authority==='function');
 const binding=bindingOf(auth.config),encoded=JSON.stringify(binding);
 valid(KEYS.every(k=>typeof binding[k]==='string')&&['PRODUCTION','LOCAL_FIXTURE'].includes(binding.mode)&&/^https?:\/\/[^\s]{1,200}$/.test(binding.origin)
 &&/^[a-z0-9.-]{1,200}$/.test(binding.deploymentId)&&/^[a-f0-9]{40}$/.test(binding.releaseSha)&&HASH.test(binding.configHash));
 const phones=audience==='REVIEWER'?[...auth.config.phoneByHash.keys()].sort():null;if(phones)valid(phones.length>0&&phones.every(x=>HASH.test(x)));
 return async function call(cookie,csrf,action,data,project){
  const writing=audience==='INGESTOR'||!['read_claim','read_bundle','recover_request'].includes(action);
  requireThat(typeof cookie==='string'&&cookie.length<=8192,401,'SIGN_IN_REQUIRED');
  if(writing)requireThat(typeof csrf==='string'&&csrf.length>0&&csrf.length<=512,403,'CSRF_REQUIRED');
  valid(JSON.stringify(bindingOf(auth.config))===encoded&&(!phones||JSON.stringify([...auth.config.phoneByHash.keys()].sort())===JSON.stringify(phones)));
  const handle=audience==='REVIEWER'?auth.actors.get(await auth.authenticate(cookie,writing?csrf:undefined)):auth.authority(cookie,writing?csrf:undefined);
  requireThat(handle&&HASH.test(handle.sessionHash)&&HASH.test(handle.browserHash),401,'SIGN_IN_REQUIRED');
  return client.$transaction(async tx=>{
   await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '1500ms'");await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '5000ms'");
   await assertGatewayRole(tx,audience);
   const args=[handle.sessionHash,handle.browserHash,encoded,...(phones?[phones]:[]),action,JSON.stringify(data)];
   const query=audience==='REVIEWER'?'SELECT atlas_ownership_lifecycle.reviewer_gateway($1,$2,$3::jsonb,$4::text[],$5,$6::jsonb) AS result':
   audience==='CUSTOMER'?'SELECT atlas_ownership_lifecycle.customer_gateway($1,$2,$3::jsonb,$4,$5::jsonb) AS result':'SELECT atlas_ownership_proof.object_gateway($1,$2,$3::jsonb,$4,$5::jsonb) AS result';
   return project(unbox(await tx.$queryRawUnsafe(query,...args)));
  },{maxWait:3000,timeout:8000});
 };
}
export function createCardOwnershipLifecycleService({auth,client,audience}){
 valid(['CUSTOMER','REVIEWER'].includes(audience));const invoke=adapter({auth,client,audience});
 return Object.freeze({call(cookie,csrf,action,input){const data=ownershipLifecycleInput(audience,action,input);return invoke(cookie,csrf,action,data,v=>projectOwnershipLifecycle(audience,action,v,data));}});
}
/** Only the trusted object ingestor receives this client. CustomerAuth creates
 * digests and validates CSRF; SQL independently checks live identity/control.
 * No HTTP adapter accepts observations, storage keys or account assertions. */
export function createOwnershipProofObjectGateway({customerAuth,client}){
 const invoke=adapter({auth:customerAuth,client,audience:'INGESTOR'});
 async function readPlan(cookie,csrf,input){const ids=ownershipProofObjectInput(input);return invoke(cookie,csrf,'read_plan',ids,v=>{
  let plan;try{plan=ownershipProofObjectPlan(v);}catch{response(false);}response(plan.bundleId===ids.bundleId&&plan.objectId===ids.objectId);return plan;});}
 return Object.freeze({readPlan,async retainObject(cookie,csrf,input,observation){
  const ids=ownershipProofObjectInput(input),plan=await readPlan(cookie,csrf,ids),checked=ownershipProofObjectObservation(observation,plan);
  return invoke(cookie,csrf,'retain_object',{...ids,observation:checked},v=>{let result;try{result=ownershipProofObjectObservation(v,plan);}catch{response(false);}
   response(ownershipProofCanonical(result)===ownershipProofCanonical(checked));return result;});
 }});
}
