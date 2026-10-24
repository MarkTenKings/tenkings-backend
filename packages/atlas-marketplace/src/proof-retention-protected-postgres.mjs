// Concrete protected store; internal C1 machinery only. No supplied pool,
// authorization callback, clock, operation ID override or receipt factory.
import {AsyncLocalStorage} from 'node:async_hooks';
import {isAsyncFunction} from 'node:util/types';
import {canonicalJSON,clone,hash,requireValue} from './contract.mjs';
import {assertJournal} from './ledger.mjs';
import {engineDataOptions} from './proof-decoder-engine-json.mjs';
import {assertProofRetentionProtectedConnectionOwner} from './proof-retention-postgres-connection.mjs';
const check=(value,code)=>requireValue(value,code);
export function retentionProtectedTransitionIdentity(prior,next){
  const before=prior.marketplaceProofRetentionOperations??{},after=next.marketplaceProofRetentionOperations;
  check(before&&after&&typeof before==='object'&&typeof after==='object'&&!Array.isArray(before)&&!Array.isArray(after),'RETENTION_PROTECTED_TRANSITION');
  const old=Object.keys(before),added=Object.keys(after).filter(k=>!Object.hasOwn(before,k));
  check(old.length<=4096&&Object.keys(after).length===old.length+1&&added.length===1&&old.every(k=>Object.hasOwn(after,k)&&canonicalJSON(before[k])===canonicalJSON(after[k])),'RETENTION_PROTECTED_TRANSITION');
  const id=added[0],record=after[id];
  check(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id)&&record?.operation?.operationId===id&&['COMMITTED','CANCELLED_BEFORE_COMMIT'].includes(record.phase)&&record.operationHash===hash(record.operation),'RETENTION_PROTECTED_TRANSITION');
  return Object.freeze({operationId:id,operationHash:record.operationHash});
}
export function createProofRetentionProtectedPostgresStore(options={}){
  const input=engineDataOptions(options,[],['enabled','owner']);if(input.enabled!==true)return null;
  const owner=assertProofRetentionProtectedConnectionOwner(input.owner),environment=owner.binding.installedBinding.binding.environment,context=new AsyncLocalStorage();let closed=false;
  const acquire=()=>{check(!closed,'STORE_CLOSED');return owner.connect();};
  function decode(row){check(row?.format==='atlas-marketplace-v2'&&row.environment===environment&&Number.isSafeInteger(Number(row.revision))&&Number(row.revision)>=0,'DATABASE_SCOPE_MISMATCH');check(hash(row.document)===row.state_hash,'STORE_CORRUPT');assertJournal(row.document.journals);return clone(row.document);}
  return Object.freeze({
    async read(fn=value=>value){check(typeof fn==='function','INVALID_READ_CALLBACK');const client=await acquire();try{const {rows}=await client.query('SELECT * FROM atlas_marketplace.read_retention_state_v1()');check(rows.length===1,'STORE_UNINITIALIZED');return clone(fn(decode(rows[0])));}finally{client.release();}},
    async transaction(fn){
      check(typeof fn==='function','INVALID_TRANSACTION_CALLBACK');check(!isAsyncFunction(fn),'ASYNC_TRANSACTION_REFUSED');check(!context.getStore(),'NESTED_TRANSACTION');
      const client=await acquire();let began=false,commitAttempted=false;
      try{
        await client.query('BEGIN');began=true;
        await client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='15s'; SET LOCAL idle_in_transaction_session_timeout='15s'");
        const {rows}=await client.query('SELECT * FROM atlas_marketplace.lock_retention_state_v1()');check(rows.length===1,'STORE_UNINITIALIZED');const row=rows[0],state=decode(row),prior=clone(state),now=Date.now();check(Number.isSafeInteger(now)&&now>=0,'INVALID_CLOCK');
        const result=context.run(true,()=>fn({state,now,emit(type,payload){state.events.push({sequence:state.events.length+1,type,payload:clone(payload),at:now,environment});}}));
        if(result&&typeof result.then==='function'){Promise.resolve(result).catch(()=>{});check(false,'ASYNC_TRANSACTION_REFUSED');}
        check(state.journals.length>=prior.journals.length&&hash(state.journals.slice(0,prior.journals.length))===hash(prior.journals),'JOURNAL_MUTATION');check(state.events.length>=prior.events.length&&hash(state.events.slice(0,prior.events.length))===hash(prior.events),'EVENT_MUTATION');assertJournal(state.journals);
        const stateHash=hash(state);
        if(stateHash!==row.state_hash){const identity=retentionProtectedTransitionIdentity(prior,state);const committed=await client.query('SELECT atlas_marketplace.commit_retention_state_v1($1,$2,$3::jsonb,$4,$5,$6::uuid,$7) AS revision',[row.revision,row.state_hash,canonicalJSON(state),stateHash,now,identity.operationId,identity.operationHash]);check(committed.rows.length===1&&Number(committed.rows[0].revision)===Number(row.revision)+1,'RETENTION_PROTECTED_CAS_RESULT');}
        commitAttempted=true;await client.query('COMMIT');began=false;return clone(result);
      }catch(error){if(began&&!commitAttempted)try{await client.query('ROLLBACK');}catch{}if(commitAttempted)throw Object.assign(new Error('STORE_COMMIT_UNKNOWN'),{code:'STORE_COMMIT_UNKNOWN',cause:error});throw error;}
      finally{client.release();}
    },close(){closed=true;}
  });
}
