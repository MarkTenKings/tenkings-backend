// Source-owned INTERNAL storage adapter. No public endpoint or authority.
import {randomUUID} from 'node:crypto';
import {canonicalJSON,hash,requireValue} from './contract.mjs';
import {assertJournal} from './ledger.mjs';
import {engineDataOptions} from './proof-decoder-engine-json.mjs';
import {decoderFreeze} from './proof-decoder-profile.mjs';
import {createProofIntakeProtectedConnectionOwner} from './proof-retention-postgres-connection.mjs';
import {intakeProtectedInstallation,intakeProtectedOperation,intakeProtectedRecord,projectIntakeProtectedOperation} from './proof-intake-protected-protocol.mjs';
const check=(v,c)=>requireValue(v,c),same=(a,b)=>canonicalJSON(a)===canonicalJSON(b);
const markers={classification:'UNQUALIFIED',customerPublicationAuthority:false,canonicalAuthorityTested:false,decoderAuthority:false};
export function createProofIntakeProtectedPostgres(options={}){
 const input=engineDataOptions(options,[],['enabled','configuration','installation']);if(input.enabled!==true)return null;
 const installation=intakeProtectedInstallation(input.installation),owner=createProofIntakeProtectedConnectionOwner({enabled:true,configuration:input.configuration,installation});
 const handles=new WeakMap();let closed=false,active=false,preparedCount=0;
 const ready=()=>check(!closed,'INTAKE_PROTECTED_CLOSED');
 function prepare(kind,value){
  ready();check(preparedCount<installation.maxOperations,'INTAKE_PROTECTED_CAPACITY');
  const fields=engineDataOptions(value,kind==='CREATE'?['actor','request']:['createOperationId','createOperationHash','expectedUploadHash','validationAttemptId','decoderRequestId','validation'],[]);
  const operation=intakeProtectedOperation({schema:'atlas-proof-intake-operation-v1',operationId:randomUUID(),kind,atMs:Date.now(),bindingHash:hash(installation.binding),...fields},installation);
  const handle=Object.freeze({});handles.set(handle,{operation,consumed:false,result:null});preparedCount++;return handle;
 }
 function owned(handle){ready();const h=handles.get(handle);check(h,'INTAKE_PROTECTED_HANDLE_REQUIRED');return h;}
 function report(record,operation){
  if(record===null)return decoderFreeze({...markers,disposition:'ABSENT_HOLD',operation,operationHash:hash(operation)});
  const r=intakeProtectedRecord(record,installation);check(same(r.operation,operation),'INTAKE_PROTECTED_ORIGINAL_HOLD');
  return decoderFreeze({...markers,disposition:'COMMITTED',record:r});
 }
 async function original(client,operation){const {rows}=await client.query('SELECT atlas_marketplace.lookup_intake_operation_v1($1::uuid,$2) AS record',[operation.operationId,hash(operation)]);check(rows.length===1,'INTAKE_PROTECTED_RESULT');return report(rows[0].record,operation);}
 async function lookup(operation){
  ready();check(!active,'INTAKE_PROTECTED_BUSY');active=true;let client;
  try{client=await owner.connect();return await original(client,operation);}finally{client?.release();active=false;}
 }
 return Object.freeze({...markers,binding:owner.binding,
  prepareCreate(value){return prepare('CREATE',value);},prepareValidation(value){return prepare('VALIDATE',value);},
  preparedReport(handle){return owned(handle).operation;},
  async commitPrepared(handle){
   const h=owned(handle);check(!h.consumed&&!active,'INTAKE_PROTECTED_COMMIT_CONSUMED');h.consumed=true;active=true;let client,began=false,commitAttempted=false;
   try{
    check(Date.now()-h.operation.atMs<=15000,'INTAKE_PROTECTED_EXPIRED');client=await owner.connect();
    await client.query('BEGIN');began=true;await client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='15s'; SET LOCAL idle_in_transaction_session_timeout='15s'");
    const {rows}=await client.query('SELECT * FROM atlas_marketplace.read_intake_state_v1()');check(rows.length===1,'INTAKE_PROTECTED_STATE');const row=rows[0];
    check(row.format==='atlas-marketplace-v2'&&row.environment==='SYNTHETIC_LOCAL'&&Number.isSafeInteger(Number(row.revision))&&Number(row.revision)>=0&&hash(row.document)===row.state_hash,'INTAKE_PROTECTED_STATE');assertJournal(row.document.journals);
    let created=null;
    if(h.operation.kind==='VALIDATE'){
     // The actual immutable CREATE record is read by ID. The projection is
     // compared again inside the locked gateway; no stale read grants commit.
     const found=await client.query('SELECT atlas_marketplace.lookup_intake_operation_v1($1::uuid,$2) AS record',[h.operation.createOperationId,h.operation.createOperationHash]);
     check(found.rows.length===1&&found.rows[0].record!==null,'INTAKE_PROTECTED_ORIGINAL_HOLD');created=intakeProtectedRecord(found.rows[0].record,installation);
    }
    const capacity=(await client.query('SELECT atlas_marketplace.read_intake_capacity_v1() AS capacity')).rows;check(capacity.length===1,'INTAKE_PROTECTED_CAPACITY_HOLD');
    const projected=projectIntakeProtectedOperation(row.document,h.operation,installation,created,capacity[0].capacity);
    const committed=await client.query('SELECT atlas_marketplace.commit_intake_operation_v1($1,$2,$3::jsonb,$4::jsonb,$5) AS record',[row.revision,row.state_hash,canonicalJSON(h.operation),canonicalJSON(projected.next),hash(projected.next)]);
    check(committed.rows.length===1,'INTAKE_PROTECTED_RESULT');const result=report(committed.rows[0].record,h.operation);check(result.disposition==='COMMITTED'&&same(result.record.upload,projected.upload)&&result.record.revision===Number(row.revision)+1,'INTAKE_PROTECTED_RESULT');
    commitAttempted=true;await client.query('COMMIT');began=false;h.result=result;return result;
   }catch(error){
    if(began&&!commitAttempted)try{await client.query('ROLLBACK');}catch{}
    // Any failed submission is an absorbing local uncertainty. The original
    // operation may only be looked up; no handle reset or commit retry exists.
    h.result=decoderFreeze({...markers,disposition:'UNKNOWN',operation:h.operation,operationHash:hash(h.operation)});return h.result;
   }finally{client?.release();active=false;}
  },
  async lookupPrepared(handle){const h=owned(handle);check(h.consumed,'INTAKE_PROTECTED_NOT_SUBMITTED');return lookup(h.operation);},
  async lookupOriginal(value){return lookup(intakeProtectedOperation(value,installation));},
  async close(){closed=true;await owner.close();}
 });
}
