import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {canonicalJSON,requireValue} from './contract.mjs';
import {engineDataOptions} from './proof-decoder-engine-json.mjs';
import {PROOF_AUTHORITY_ROLES,parseProofAuthorityRequest,parseProofAuthorityReply,proofAuthorityRequestHash} from './proof-authority-protocol.mjs';

const adapters=new WeakMap(),heldAccess=new WeakMap();
export function assertProofAuthorityHeldAccess(value,{gateway}){const entry=heldAccess.get(value);check(entry?.gateway===assertProofAuthorityPostgres(gateway,'REQUEST',true)&&entry.active&&entry.current()&&performance.now()<entry.monotonicDeadline&&Date.now()<entry.expiresAt,'PROOF_AUTHORITY_ACCESS_HOLD_REQUIRED');return entry.request;}
export function assertProofAuthorityPostgres(value,role,requireClosure=false){const state=adapters.get(value);requireValue(state&&(!role||state.role===role)&&(!requireClosure||state.completeClosure),'PROOF_AUTHORITY_ADAPTER_REQUIRED');return value;}
export function assertProofAuthorityCommittedReport(value,{gateway,action}){const state=adapters.get(assertProofAuthorityPostgres(gateway)),entry=state.reports.get(value);requireValue(entry&&entry.action===action,'PROOF_AUTHORITY_COMMITTED_REPORT_REQUIRED');return entry.request;}
const check=(v,c)=>requireValue(v,c);
const identifier=v=>typeof v==='string'&&/^[a-z][a-z0-9_]{0,62}$/.test(v);
const sameConfig=v=>Array.isArray(v)&&v.length===1&&v[0]==='search_path=pg_catalog';
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export const PROOF_AUTHORITY_CLOSURE=Object.freeze([
 'canonical_v1(jsonb, integer)','hash_v1(jsonb)','fence_report_v1(atlas_proof_authority.fence)','record_guard_v1()',
 'observation_v1(boolean)','exact_object_v1(jsonb, text[])','lock_canonical_rows_v1(jsonb)',
 'observe_access_v1(jsonb)','claim_stage_v1(jsonb)','lookup_stage_v1(uuid, text)','lookup_claim_v1(uuid, text)','settle_stage_v1(jsonb)',
 'read_drain_v1(uuid)','begin_logout_v1(jsonb)','settle_drain_v1(jsonb)','apply_mutation_v1(uuid, text)',
 'operator_access_v1(jsonb)','authorize_mutation_v1(jsonb)','begin_mutation_v1(jsonb)','reject_unjoined_authority_write()'
]);
const ACTIONS=Object.freeze({
  observe_access_v1:{signature:'observe_access_v1(jsonb)',sql:'SELECT atlas_proof_authority.observe_access_v1($1::jsonb) AS result',json:true},
  authorize_mutation_v1:{signature:'authorize_mutation_v1(jsonb)',sql:'SELECT atlas_proof_authority.authorize_mutation_v1($1::jsonb) AS result',json:true,write:true,id:'requestId'},
  claim_stage_v1:{signature:'claim_stage_v1(jsonb)',sql:'SELECT atlas_proof_authority.claim_stage_v1($1::jsonb) AS result',json:true,write:true,id:'stageId'},
  lookup_stage_v1:{signature:'lookup_stage_v1(uuid, text)',sql:'SELECT atlas_proof_authority.lookup_stage_v1($1::uuid,$2::text) AS result',keys:['stageId','operationHash']},
  lookup_claim_v1:{signature:'lookup_claim_v1(uuid, text)',sql:'SELECT atlas_proof_authority.lookup_claim_v1($1::uuid,$2::text) AS result',keys:['stageId','claimHash']},
  begin_logout_v1:{signature:'begin_logout_v1(jsonb)',sql:'SELECT atlas_proof_authority.begin_logout_v1($1::jsonb) AS result',json:true,write:true,id:'mutationId'},
  settle_stage_v1:{signature:'settle_stage_v1(jsonb)',sql:'SELECT atlas_proof_authority.settle_stage_v1($1::jsonb) AS result',json:true,write:true,id:'stageId'},
  settle_drain_v1:{signature:'settle_drain_v1(jsonb)',sql:'SELECT atlas_proof_authority.settle_drain_v1($1::jsonb) AS result',json:true,write:true,id:'mutationId'},
  read_drain_v1:{signature:'read_drain_v1(uuid)',sql:'SELECT atlas_proof_authority.read_drain_v1($1::uuid) AS result',keys:['mutationId']},
  begin_mutation_v1:{signature:'begin_mutation_v1(jsonb)',sql:'SELECT atlas_proof_authority.begin_mutation_v1($1::jsonb) AS result',json:true,write:true,id:'mutationId'},
  apply_mutation_v1:{signature:'apply_mutation_v1(uuid, text)',sql:'SELECT atlas_proof_authority.apply_mutation_v1($1::uuid,$2::text) AS result',keys:['mutationId','mutationHash'],write:true,id:'mutationId'},
});

/** Concrete SQL transport, not an authority producer. No environment lookup,
 * migration, generic SQL callback or automatic retry. A supplied pool and
 * independently reviewed pg_get_functiondef hashes belong to trusted host
 * composition. Returned data is branded privately only AFTER the audited transaction commits. */
export function createProofAuthorityPostgres(options={}){
  const o=engineDataOptions(options,[],['enabled','pool','roleKind','expectedRole','expectedDatabase','expectedFunctionOwner','functionHashes','closureHashes','maxTrackedMutations']);
  if(o.enabled!==true)return null;
  check(typeof o.roleKind==='string'&&Object.hasOwn(PROOF_AUTHORITY_ROLES,o.roleKind),'PROOF_AUTHORITY_ROLE_INVALID');
  check(identifier(o.expectedRole)&&identifier(o.expectedDatabase)&&identifier(o.expectedFunctionOwner)&&o.expectedRole!==o.expectedFunctionOwner,'PROOF_AUTHORITY_DATABASE_BINDING');
  const allowed=PROOF_AUTHORITY_ROLES[o.roleKind],pins=engineDataOptions(o.functionHashes,allowed);
  check(Object.values(pins).every(sha),'PROOF_AUTHORITY_FUNCTION_PINS');
  const closure=o.closureHashes===undefined?null:engineDataOptions(o.closureHashes,PROOF_AUTHORITY_CLOSURE);
  check(!closure||Object.values(closure).every(sha)&&allowed.every(name=>closure[name]===pins[name]),'PROOF_AUTHORITY_CLOSURE_PINS');
  const pool=o.pool,connect=pool?.connect;check(pool&&typeof connect==='function','PROOF_AUTHORITY_POOL_REQUIRED');
  const max=o.maxTrackedMutations??4096;check(Number.isSafeInteger(max)&&max>=1&&max<=4096,'PROOF_AUTHORITY_LIMIT_INVALID');
  // These are bounded process-local replay holds, not durable restart state.
  // The genuine owner must persist dispatch uncertainty before using this
  // transport. close/reconstruction never establishes permission to retry.
  const pending=new Set(),unknown=new Set(),seen=new Map(),reports=new WeakMap();let closed=false;
  async function acquire(){
    check(!closed&&pool.connect===connect,'PROOF_AUTHORITY_CLOSED_OR_CHANGED');
    const client=await connect.call(pool);let released=false;
    const release=broken=>{if(!released){released=true;client.release(broken);}};
    try{
      check(client&&typeof client.query==='function'&&typeof client.release==='function','PROOF_AUTHORITY_CLIENT_INVALID');
      // Bound catalog audits as well as the gateway statement. The trusted
      // dedicated pool owns connection-acquisition timeout and cancellation.
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='1500ms'; SET LOCAL statement_timeout='3000ms'; SET LOCAL idle_in_transaction_session_timeout='5000ms'");
      const {rows:[r]}=await client.query(`SELECT current_user AS role,current_database() AS database,
        rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolinherit,
        EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members WHERE member=r.oid) AS membership,
        EXISTS(SELECT 1 FROM pg_catalog.pg_database WHERE datname=current_database() AND datdba=r.oid) AS database_owner
        FROM pg_catalog.pg_roles r WHERE rolname=current_user`);
      check(r?.role===o.expectedRole&&r.database===o.expectedDatabase&&['rolsuper','rolcreatedb','rolcreaterole','rolreplication','rolbypassrls','rolinherit','membership','database_owner'].every(k=>r[k]===false),'PROOF_AUTHORITY_ROLE_REFUSED');
      const {rows:[p]}=await client.query(`SELECT
        has_schema_privilege(current_user,'atlas_proof_authority','USAGE') AS gateway_usage,
        has_database_privilege(current_user,current_database(),'CREATE,TEMPORARY') AS database_write,
        EXISTS(SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname !~ '^pg_' AND nspname<>'information_schema'
          AND (nspowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user) OR has_schema_privilege(current_user,oid,'CREATE'))) AS schema_write,
        EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f')
          AND (c.relowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user)
            OR has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
            OR EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
              AND has_column_privilege(current_user,c.oid,a.attnum,'SELECT,INSERT,UPDATE,REFERENCES')))) AS direct_table,
        EXISTS(WITH sequences AS MATERIALIZED (SELECT c.oid,c.relowner FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
          WHERE c.relkind='S' AND n.nspname !~ '^pg_' AND n.nspname<>'information_schema')
          SELECT 1 FROM sequences WHERE relowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user)
          OR has_sequence_privilege(current_user,oid,'USAGE,SELECT,UPDATE')) AS sequence_access`);
      check(p?.gateway_usage===true&&['database_write','schema_write','direct_table','sequence_access'].every(k=>p[k]===false),'PROOF_AUTHORITY_GRANTS_REFUSED');
      const {rows:fs}=await client.query(`SELECT n.nspname AS schema,p.proname||'('||pg_catalog.oidvectortypes(p.proargtypes)||')' AS name,
        p.prosecdef AS definer,p.proconfig AS config,pg_catalog.pg_get_userbyid(p.proowner) AS owner,
        pg_catalog.pg_get_functiondef(p.oid) AS definition
        FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND
          (p.proowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user) OR has_function_privilege(current_user,p.oid,'EXECUTE'))`);
      check(fs.length===allowed.length&&new Set(fs.map(f=>f.name)).size===allowed.length&&fs.every(f=>f.schema==='atlas_proof_authority'&&allowed.includes(f.name)&&f.owner===o.expectedFunctionOwner&&f.definer===true&&Array.isArray(f.config)&&f.config.length===1&&f.config[0]==='search_path=pg_catalog'&&typeof f.definition==='string'&&Buffer.byteLength(f.definition)<=262144&&createHash('sha256').update(f.definition).digest('hex')===pins[f.name]),'PROOF_AUTHORITY_FUNCTIONS_REFUSED');
      if(closure){
        const {rows:all}=await client.query(`SELECT p.proname||'('||pg_catalog.oidvectortypes(p.proargtypes)||')' AS name,pg_catalog.pg_get_userbyid(p.proowner) AS owner,p.proconfig AS config,pg_catalog.pg_get_functiondef(p.oid) AS definition FROM pg_catalog.pg_proc p WHERE p.pronamespace='atlas_proof_authority'::regnamespace`);
        check(all.length===PROOF_AUTHORITY_CLOSURE.length&&new Set(all.map(x=>x.name)).size===all.length&&all.every(x=>Object.hasOwn(closure,x.name)&&x.owner===o.expectedFunctionOwner&&sameConfig(x.config)&&typeof x.definition==='string'&&Buffer.byteLength(x.definition)<=262144&&createHash('sha256').update(x.definition).digest('hex')===closure[x.name]),'PROOF_AUTHORITY_CLOSURE_CHANGED');
        const {rows:hooks}=await client.query(`SELECT n.nspname AS schema,c.relname AS relation,t.tgname AS name,t.tgtype::integer AS type,t.tgenabled AS enabled,pg_catalog.pg_get_userbyid(p.proowner) AS owner,p.proname AS function FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid WHERE t.tgname IN ('proof_authority_drain','proof_authority_no_truncate','proof_authority_control_drain','proof_authority_control_no_truncate') AND n.nspname IN ('atlas_staff','atlas_customer','atlas_proof_authority')`);
        const relations=['atlas_staff.StaffControl','atlas_staff.StaffIdentity','atlas_staff.StaffSession','atlas_staff.StaffBrowser','atlas_customer.CustomerControl','atlas_customer.CustomerAccount','atlas_customer.CustomerSession','atlas_customer.CustomerBrowser','atlas_customer.CustomerServiceControl','atlas_proof_authority.control'];
        check(hooks.length===20&&relations.every(name=>{const pair=hooks.filter(x=>x.schema+'.'+x.relation===name);return pair.length===2&&pair.some(x=>x.type===27)&&pair.some(x=>x.type===34)&&pair.every(x=>x.enabled==='O'&&x.owner===o.expectedFunctionOwner&&x.function==='reject_unjoined_authority_write');}),'PROOF_AUTHORITY_WRITER_HOOKS_REQUIRED');
      }
      return {client,release};
    }catch(error){if(client&&typeof client.release==='function')release(true);throw error;}
  }
  async function invoke(action,input){
    check(!closed,'PROOF_AUTHORITY_CLOSED_OR_CHANGED');const spec=ACTIONS[action];
    check(allowed.includes(spec.signature),'PROOF_AUTHORITY_ACTION_REFUSED');
    const v=parseProofAuthorityRequest(action,input),requestHash=proofAuthorityRequestHash(action,v),key=spec.write?`${action}:${v[spec.id]}`:null;
    if(key){check(!unknown.has(key),'PROOF_AUTHORITY_UNKNOWN_HOLD');check(!pending.has(key),'PROOF_AUTHORITY_PENDING_HOLD');check(!seen.has(key)||seen.get(key)===requestHash,'PROOF_AUTHORITY_ID_CONFLICT');check(seen.has(key)||seen.size<max,'PROOF_AUTHORITY_CAPACITY_HOLD');seen.set(key,requestHash);pending.add(key);}
    let held,began=false,commitAttempted=false,broken=false;
    try{
      held=await acquire();began=true;check(!closed,'PROOF_AUTHORITY_CLOSED_OR_CHANGED');const c=held.client;
      const {rows}=await c.query(spec.sql,spec.json?[canonicalJSON(v)]:spec.keys.map(k=>v[k]));
      check(Array.isArray(rows)&&rows.length===1,'PROOF_AUTHORITY_RESPONSE_REFUSED');
      const result=parseProofAuthorityReply(rows[0]?.result);
      check(result.schema==='atlas-proof-authority-observation-v1'||closure,'PROOF_AUTHORITY_CLOSURE_REQUIRED');
      check(!spec.json||result.requestHash===null||result.requestHash===requestHash,'PROOF_AUTHORITY_RESPONSE_REFUSED');
      await c.query('SET CONSTRAINTS ALL IMMEDIATE');
      commitAttempted=true;await c.query('COMMIT');began=false;
      reports.set(result,{action,request:v});return result;
    }catch(cause){
      if(began&&!commitAttempted){try{await held.client.query('ROLLBACK');}catch{broken=true;}}
      if(commitAttempted&&spec.write){unknown.add(key);const error=new Error('Proof authority commit outcome is unknown; retain the exact original operation for lookup.');error.code='PROOF_AUTHORITY_COMMIT_UNKNOWN';error.cause=cause;throw error;}
      throw cause;
    }finally{if(held)held.release(broken||began&&commitAttempted);if(key)pending.delete(key);}
  }
  async function withAccess(input,work){
    check(o.roleKind==='REQUEST'&&closure&&typeof work==='function','PROOF_AUTHORITY_ACCESS_HOLD_REQUIRED');
    const v=parseProofAuthorityRequest('observe_access_v1',input);check(v.schema==='atlas-proof-access-observe-v1','PROOF_AUTHORITY_ACCESS_HOLD_REQUIRED');
    let held,entry,result,output,began=false,broken=false;
    const invalidate=()=>{if(entry)entry.active=false;};
    try{
      held=await acquire();began=true;
      held.client.on?.('error',invalidate);held.client.on?.('end',invalidate);
      const {rows}=await held.client.query(ACTIONS.observe_access_v1.sql,[canonicalJSON(v)]);
      check(rows?.length===1,'PROOF_AUTHORITY_RESPONSE_REFUSED');result=parseProofAuthorityReply(rows[0].result);
      check(result.schema==='atlas-proof-access-report-v1'&&result.requestHash===proofAuthorityRequestHash('observe_access_v1',v),'PROOF_AUTHORITY_ACCESS_HOLD_REQUIRED');
      entry={gateway,request:v,active:true,current:()=>!closed&&pool.connect===connect,monotonicDeadline:performance.now()+4000,expiresAt:Math.min(result.deadlineAt,Date.now()+4000)};heldAccess.set(result,entry);
      output=await work(result);assertProofAuthorityHeldAccess(result,{gateway});
      // Keep the same transaction alive through the entire callback. No report
      // is usable after it finishes, and no observed JSON can recreate the hold.
      await held.client.query('COMMIT');began=false;return output;
    }catch(error){if(output?.bytes&&Buffer.isBuffer(output.bytes))output.bytes.fill(0);if(began){try{await held.client.query('ROLLBACK');began=false;}catch{broken=true;}}throw error;}
    finally{invalidate();if(held){held.client.removeListener?.('error',invalidate);held.client.removeListener?.('end',invalidate);held.release(broken||began);}}
  }
  const methods={
    observeInstallation:v=>{check(v?.schema==='atlas-proof-installation-observe-v1','PROOF_AUTHORITY_PROTOCOL_INVALID');return invoke('observe_access_v1',v);},
    claimStage:v=>invoke('claim_stage_v1',v),lookupStage:v=>invoke('lookup_stage_v1',v),lookupClaim:v=>invoke('lookup_claim_v1',v),
    settleDrain:v=>invoke('settle_drain_v1',v),beginLogout:v=>invoke('begin_logout_v1',v),settleStage:v=>invoke('settle_stage_v1',v),readDrain:v=>invoke('read_drain_v1',v),
    authorizeMutation:v=>invoke('authorize_mutation_v1',v),beginMutation:v=>invoke('begin_mutation_v1',v),applyMutation:v=>invoke('apply_mutation_v1',v),
  };
  // Expose only this role's finite methods, never a call(sql/action,callback).
  const publicMethods=Object.fromEntries(Object.entries(methods).filter(([name])=>allowed.some(signature=>({observeInstallation:'observe_access_v1',authorizeMutation:'authorize_mutation_v1',settleDrain:'settle_drain_v1',claimStage:'claim_stage_v1',lookupStage:'lookup_stage_v1',lookupClaim:'lookup_claim_v1',beginLogout:'begin_logout_v1',settleStage:'settle_stage_v1',readDrain:'read_drain_v1',beginMutation:'begin_mutation_v1',applyMutation:'apply_mutation_v1'}[name])===signature.split('(')[0])));
  const gateway=Object.freeze({...publicMethods,...(o.roleKind==='REQUEST'?{withAccess}:{}),classification:'UNQUALIFIED',authority:false,close(){closed=true;}});adapters.set(gateway,{role:o.roleKind,reports,completeClosure:closure!==null});return gateway;
}
