import {DatabaseSync} from 'node:sqlite';
import {constants,openSync,closeSync,readSync,writeFileSync,fstatSync,lstatSync,realpathSync,fsyncSync,opendirSync,renameSync,unlinkSync} from 'node:fs';
import {dirname,isAbsolute,join,resolve,sep} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {canonicalJSON,hash,requireValue} from './contract.mjs';
import {decoderContractData,decoderExact,decoderFreeze} from './proof-decoder-profile.mjs';
import {engineDataOptions,parseProofDecoderEngineJSON} from './proof-decoder-engine-json.mjs';
import {assertProofDecoderValidation} from './proof-decoder-protocol.mjs';
import {createEncryptedProofStorage,PROOF_STORAGE_SCHEMA} from './proof-storage.mjs';

const MARKERS=Object.freeze({classification:'UNQUALIFIED',runtimeQualified:false,customerPublicationAuthority:false});
const DB='publication.sqlite',MANIFEST='ownership.json',LOCK='writer.lock',SEAL='.atlas-proof-publisher-seal-v1';
const MAX_DB=16*1024*1024,MAX_RECORD=32768,MAX_OPERATIONS=128,MAX_EVENTS=512,APP_ID=0x41545053;
const REASONS=['OPERATOR_REVOKED','SERVICE_STOP','ADMISSION_REVOKED','STORAGE_UNCERTAIN'];
const check=(value,code='PUBLICATION_STORE_INVALID')=>requireValue(value,code);
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const integer=(value,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(value)&&value>=0&&value<=max;
const text=value=>typeof value==='string'&&value.length>0&&value.length<=500&&value.trim()===value;
const same=(a,b)=>canonicalJSON(a)===canonicalJSON(b);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const identity=st=>({device:String(st.dev),inode:String(st.ino)});
const unchanged=(a,b)=>['dev','ino','mode','uid','gid','nlink','size','mtimeMs','ctimeMs'].every(key=>a[key]===b[key]);
function names(directory,max=4096){const dir=opendirSync(directory),result=[];try{let item;while((item=dir.readSync())){check(result.length<max,'PUBLICATION_STORE_FULL');result.push(item.name);}return result;}finally{dir.closeSync();}}
function canonicalPath(path){check(typeof path==='string'&&path.length<=1024&&isAbsolute(path)&&resolve(path)===path&&realpathSync(path)===path,'PUBLICATION_PATH_REFUSED');}
function ancestors(path,uid){for(let current=dirname(path);;current=dirname(current)){const info=lstatSync(current);check(info.isDirectory()&&!info.isSymbolicLink()&&[0,uid].includes(info.uid)&&(info.mode&0o022)===0,'PUBLICATION_PATH_REFUSED');if(current===sep)break;}}
function directory(path,uid,expected){canonicalPath(path);ancestors(path,uid);const info=lstatSync(path);check(info.isDirectory()&&!info.isSymbolicLink()&&info.uid===uid&&(info.mode&0o7777)===0o700&&(!expected||same(identity(info),expected)),'PUBLICATION_PATH_REFUSED');return identity(info);}
function regular(path,{uid,mode,max,expected,readMax=max}){
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK|constants.O_CLOEXEC);
  try{const before=fstatSync(fd);check(before.isFile()&&before.nlink===1&&before.uid===uid&&(mode===undefined?(before.mode&0o7022)===0:(before.mode&0o7777)===mode)&&before.size<=max&&(!expected||same(identity(before),expected)),'PUBLICATION_FILE_REFUSED');
    const bytes=Buffer.alloc(Math.min(before.size,readMax));let at=0;while(at<bytes.length){const n=readSync(fd,bytes,at,bytes.length-at,at);check(n>0,'PUBLICATION_FILE_CHANGED');at+=n;}
    check(unchanged(before,fstatSync(fd)),'PUBLICATION_FILE_CHANGED');return {bytes,stamp:identity(before),stat:before};
  }finally{closeSync(fd);}
}
function absent(path){try{lstatSync(path);return false;}catch(error){if(error.code==='ENOENT')return true;throw error;}}
function durableFile(path,bytes){const fd=openSync(path,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK|constants.O_CLOEXEC,0o600);try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}}
function syncDirectory(path){const fd=openSync(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW|constants.O_CLOEXEC);try{fsyncSync(fd);}finally{closeSync(fd);}}
function json(bytes,max=MAX_RECORD){return decoderContractData(parseProofDecoderEngineJSON(bytes,{maxBytes:max}));}
function storedJSON(value){check(typeof value==='string'&&Buffer.byteLength(value)<=MAX_RECORD,'PUBLICATION_STORE_CORRUPT');const result=json(Buffer.from(value));check(canonicalJSON(result)===value,'PUBLICATION_STORE_CORRUPT');return result;}
function synchronous(value){check(!(value&&typeof value.then==='function'),'PUBLICATION_ASYNC_REFUSED');return value;}

function configured(options){
  const input=engineDataOptions(options,[],['enabled','descriptorPath','encryptionKey']);
  if(input.enabled!==true)return null;
  check(process.platform==='linux'&&process.versions.node==='22.16.0','PUBLICATION_PLATFORM_REFUSED');
  const path=input.descriptorPath;canonicalPath(path);ancestors(path,0);
  const source=regular(path,{uid:0,max:16384}),config=json(source.bytes,16384);
  decoderExact(config,['schema','publisher','app','worker','ledgerDirectory','storage']);
  check(config.schema==='atlas-proof-publication-descriptor-v1');
  decoderExact(config.publisher,['uid','gid']);decoderExact(config.app,['uid']);decoderExact(config.worker,['uid']);
  for(const value of [config.publisher.uid,config.publisher.gid,config.app.uid,config.worker.uid])check(integer(value,2147483647)&&value>0);
  check(new Set([config.publisher.uid,config.app.uid,config.worker.uid]).size===3&&process.getuid()===config.publisher.uid&&process.geteuid()===config.publisher.uid&&process.getgid()===config.publisher.gid&&process.getegid()===config.publisher.gid,'PUBLICATION_ROLE_REFUSED');
  decoderExact(config.storage,['directory','keyId','storageId','environment','retentionRef','maxObjectBytes']);
  const s=config.storage;check(typeof s.keyId==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(s.keyId)&&text(s.storageId)&&text(s.retentionRef)&&['SYNTHETIC_LOCAL','PROVIDER_SANDBOX','PRODUCTION'].includes(s.environment)&&integer(s.maxObjectBytes,10485760)&&s.maxObjectBytes>0);
  check(Buffer.isBuffer(input.encryptionKey)&&input.encryptionKey.length===32,'PUBLICATION_KEY_REQUIRED');
  const ledger=directory(config.ledgerDirectory,config.publisher.uid),objects=directory(s.directory,config.publisher.uid);
  check(config.ledgerDirectory!==s.directory&&!config.ledgerDirectory.startsWith(s.directory+sep)&&!s.directory.startsWith(config.ledgerDirectory+sep),'PUBLICATION_PATH_REFUSED');
  const binding={schema:PROOF_STORAGE_SCHEMA,storageId:s.storageId,environment:s.environment,retentionRef:s.retentionRef,keyId:s.keyId,maxObjectBytes:s.maxObjectBytes};
  const storage=createEncryptedProofStorage({...s,encryptionKey:input.encryptionKey});
  check(storage.put.constructor.name!=='AsyncFunction'&&storage.get.constructor.name!=='AsyncFunction','PUBLICATION_ASYNC_REFUSED');
  function ready(){canonicalPath(path);ancestors(path,0);const current=regular(path,{uid:0,max:16384,expected:source.stamp});check(current.bytes.equals(source.bytes),'PUBLICATION_DESCRIPTOR_CHANGED');check(process.getuid()===config.publisher.uid&&process.geteuid()===config.publisher.uid&&process.getgid()===config.publisher.gid&&process.getegid()===config.publisher.gid,'PUBLICATION_ROLE_REFUSED');directory(config.ledgerDirectory,config.publisher.uid,ledger);directory(s.directory,config.publisher.uid,objects);}
  function original(objectKey,manifestHash){
    check(digest(objectKey)&&digest(manifestHash));ready();const path=join(s.directory,objectKey+'.proof');
    if(absent(path))return null;
    // Refuse FIFOs/symlinks before the unchanged legacy reader opens the file.
    const before=regular(path,{uid:config.publisher.uid,mode:0o400,max:Math.ceil(s.maxObjectBytes*1.8)+32768,readMax:0});
    const value=synchronous(storage.get({objectKey}));
    try{check(value&&value.manifestHash===manifestHash&&hash(value.manifest)===manifestHash,'PUBLICATION_ORIGINAL_MISMATCH');const after=regular(path,{uid:config.publisher.uid,mode:0o400,max:Math.ceil(s.maxObjectBytes*1.8)+32768,expected:before.stamp,readMax:0});check(unchanged(before.stat,after.stat),'PUBLICATION_FILE_CHANGED');return value;}catch(error){value?.bytes?.fill(0);throw error;}
  }
  return {config,source,descriptorHash:sha(source.bytes),ledger,objects,binding,storage,ready,original};
}
function manifestData(value,binding){
  const m=decoderContractData(value);decoderExact(m,['schema','proofId','uploadId','environment','storageId','retentionRef','retainUntil','createdAt','validatedAt','policyHash','orderBinding','actorId','actorRole','purpose','byteCount','sha256','validation']);
  check(Buffer.byteLength(canonicalJSON(m))<=MAX_RECORD&&m.schema==='atlas-marketplace-retained-proof-v1'&&m.environment===binding.environment&&m.storageId===binding.storageId&&m.retentionRef===binding.retentionRef);
  for(const k of ['proofId','uploadId','actorId'])check(text(m[k]));check(['BUYER','STAFF'].includes(m.actorRole)&&['RETURN_REQUEST','PACK','DISPATCH','DELIVERY','RELEASE','RETURN_INSPECTION','RETURN_REVIEW','REFUND_REVIEW'].includes(m.purpose)&&digest(m.policyHash));
  decoderExact(m.orderBinding,['orderId','cardId','buyerId','sellerId','bindingHash','policyVersion']);for(const value of Object.values(m.orderBinding))check(text(value));
  check(integer(m.createdAt)&&integer(m.validatedAt)&&integer(m.retainUntil)&&m.validatedAt>=m.createdAt&&m.retainUntil>m.createdAt&&integer(m.byteCount,binding.maxObjectBytes)&&m.byteCount>0&&digest(m.sha256));
  assertProofDecoderValidation(m.validation);check(m.validation.byteCount===m.byteCount&&m.validation.sha256===m.sha256);return m;
}
const SQL={
 metadata:'CREATE TABLE metadata(id INTEGER PRIMARY KEY CHECK(id=1),manifest TEXT NOT NULL,state TEXT NOT NULL)',
 operations:'CREATE TABLE operations(id TEXT PRIMARY KEY,object_key TEXT UNIQUE,record TEXT NOT NULL)',
 events:'CREATE TABLE events(revision INTEGER PRIMARY KEY,previous_hash TEXT,record TEXT NOT NULL,event_hash TEXT NOT NULL)',
 events_no_update:"CREATE TRIGGER events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'append only'); END",
 events_no_delete:"CREATE TRIGGER events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'append only'); END",
 manifest_immutable:"CREATE TRIGGER manifest_immutable BEFORE UPDATE OF manifest ON metadata BEGIN SELECT RAISE(ABORT,'immutable'); END"
};
function stateData(value){decoderExact(value,['revision','phase','heldOperationId','revocationId','reason']);check(integer(value.revision,MAX_EVENTS-1)&&['ACTIVE','DRAINING','REVOKED'].includes(value.phase)&&(value.heldOperationId===null||uuid(value.heldOperationId))&&(value.revocationId===null||uuid(value.revocationId))&&(value.reason===null||REASONS.includes(value.reason)),'PUBLICATION_STORE_CORRUPT');check((value.phase==='ACTIVE')===(value.reason===null)&&!(value.phase==='REVOKED'&&value.heldOperationId!==null),'PUBLICATION_STORE_CORRUPT');return value;}
function operationData(value){decoderExact(value,['operationId','kind','request','phase','intentRevision','completedRevision']);check(uuid(value.operationId)&&['PUBLICATION','REVOKE'].includes(value.kind)&&['INTENT','COMPLETED','UNKNOWN'].includes(value.phase)&&integer(value.intentRevision,MAX_EVENTS-1)&&value.intentRevision>0&&(value.completedRevision===null||integer(value.completedRevision,MAX_EVENTS-1)&&value.completedRevision>value.intentRevision),'PUBLICATION_STORE_CORRUPT');check((value.phase==='COMPLETED')===(value.completedRevision!==null),'PUBLICATION_STORE_CORRUPT');if(value.kind==='PUBLICATION'){decoderExact(value.request,['objectKey','manifestHash','byteCount','sha256']);check(digest(value.request.objectKey)&&digest(value.request.manifestHash)&&integer(value.request.byteCount,10485760)&&value.request.byteCount>0&&digest(value.request.sha256),'PUBLICATION_STORE_CORRUPT');}else{decoderExact(value.request,['reason']);check(REASONS.includes(value.request.reason),'PUBLICATION_STORE_CORRUPT');}return value;}

/** Real local owner-only IO, still UNQUALIFIED. This module is not a customer
 * admission port. Its sole writer owns both durable revocation and the entire
 * synchronous storage.put critical section; it never delegates or awaits a put.
 * Unknown outcomes leave the intent, volume checkpoint and writer lock held. */
export function openProofPublicationStore(options={}){
  const c=configured(options);if(!c)return null;
  const {config,storage}=c,uid=config.publisher.uid,ledger=config.ledgerDirectory,objects=config.storage.directory;
  const dbPath=join(ledger,DB),manifestPath=join(ledger,MANIFEST),lockPath=join(ledger,LOCK),sealPath=join(objects,SEAL);
  let db,manifest,manifestBytes,sealBytes,sealStamp,lockBytes,lockStamp,closed=false,poisoned=false,busy=false,readOnly=false;
  function files(locked){c.ready();const list=names(ledger,5);check(!list.some(name=>name.startsWith(DB+'-')),'PUBLICATION_RECOVERY_REQUIRED');check(!list.includes(LOCK)||locked,'PUBLICATION_WRITER_LOCKED');check(list.every(name=>[DB,MANIFEST,...(locked?[LOCK]:[])].includes(name)),'PUBLICATION_FOREIGN_FILE');const contents=names(objects);check(contents.every(name=>/^[a-f0-9]{64}\.proof$/.test(name)||name===SEAL),'PUBLICATION_RECOVERY_REQUIRED');return list;}
  function seal(value){decoderExact(value,['schema','manifest','revision','headHash']);check(value.schema==='atlas-proof-publication-volume-seal-v1'&&same(value.manifest,manifest)&&integer(value.revision,MAX_EVENTS-1)&&digest(value.headHash),'PUBLICATION_SEAL_CHANGED');return value;}
  function anchor(revision,headHash,initial=false){const bytes=Buffer.from(canonicalJSON({schema:'atlas-proof-publication-volume-seal-v1',manifest,revision,headHash}));
    if(initial)durableFile(sealPath,bytes);
    else{check(regular(sealPath,{uid,mode:0o600,max:16384,expected:sealStamp}).bytes.equals(sealBytes),'PUBLICATION_SEAL_CHANGED');const temporary=sealPath+'.pending-'+randomUUID();durableFile(temporary,bytes);check(regular(sealPath,{uid,mode:0o600,max:16384,expected:sealStamp}).bytes.equals(sealBytes),'PUBLICATION_SEAL_CHANGED');renameSync(temporary,sealPath);}
    syncDirectory(objects);const saved=regular(sealPath,{uid,mode:0o600,max:16384});check(saved.bytes.equals(bytes),'PUBLICATION_SEAL_CHANGED');sealBytes=bytes;sealStamp=saved.stamp;
  }
  function state(){return stateData(storedJSON(db.prepare('SELECT state FROM metadata WHERE id=1').get().state));}
  function operation(id){const row=db.prepare('SELECT id,object_key,record FROM operations WHERE id=?').get(id);if(!row)return null;const value=operationData(storedJSON(row.record));check(value.operationId===row.id&&row.object_key===(value.kind==='PUBLICATION'?value.request.objectKey:null),'PUBLICATION_STORE_CORRUPT');return value;}
  function validate(){
    const schema=db.prepare("SELECT name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name,sql})=>({name,sql}));check(same(schema,Object.entries(SQL).sort(([a],[b])=>a.localeCompare(b)).map(([name,sql])=>({name,sql}))),'PUBLICATION_STORE_CORRUPT');
    const meta=db.prepare('SELECT id,manifest,state FROM metadata').all();check(meta.length===1&&meta[0].id===1&&meta[0].manifest===canonicalJSON(manifest),'PUBLICATION_STORE_CORRUPT');const current=state();
    const count=db.prepare('SELECT count(*) AS n FROM events').get().n;check(count>0&&count<=MAX_EVENTS,'PUBLICATION_STORE_CORRUPT');const history=db.prepare('SELECT revision,previous_hash,record,event_hash FROM events ORDER BY revision').all();
    let previous=null,last=null;const lastOperations=new Map();
    for(let i=0;i<history.length;i++){const row=history[i],event=storedJSON(row.record);decoderExact(event,['kind','state','operation']);stateData(event.state);check(row.revision===i&&event.state.revision===i&&row.previous_hash===previous&&row.event_hash===hash(event)&&['GENESIS','INTENT','COMPLETE','REVOKE','REVOKED','UNKNOWN'].includes(event.kind),'PUBLICATION_STORE_CORRUPT');
      if(i===0)check(event.kind==='GENESIS'&&event.operation===null&&same(event.state,{revision:0,phase:'ACTIVE',heldOperationId:null,revocationId:null,reason:null}),'PUBLICATION_STORE_CORRUPT');
      else check(event.kind!=='GENESIS','PUBLICATION_STORE_CORRUPT');
      if(event.operation!==null){operationData(event.operation);lastOperations.set(event.operation.operationId,event.operation);}last=event.state;previous=row.event_hash;
    }
    check(same(current,last),'PUBLICATION_STORE_CORRUPT');const countOps=db.prepare('SELECT count(*) AS n FROM operations').get().n;check(countOps<=MAX_OPERATIONS&&countOps===lastOperations.size,'PUBLICATION_STORE_CORRUPT');let held=0;
    for(const [id,expected] of lastOperations){const actual=operation(id);check(same(actual,expected),'PUBLICATION_STORE_CORRUPT');if(actual.kind==='PUBLICATION'&&actual.phase!=='COMPLETED'){held++;check(current.heldOperationId===id,'PUBLICATION_STORE_CORRUPT');}}
    check(held<=1&&((held===0)===(current.heldOperationId===null)),'PUBLICATION_STORE_CORRUPT');
    if(current.phase==='REVOKED')check(current.revocationId!==null&&operation(current.revocationId)?.phase==='COMPLETED','PUBLICATION_STORE_CORRUPT');
    const checkpoint=seal(json(sealBytes));check(checkpoint.revision===current.revision&&checkpoint.headHash===previous,'PUBLICATION_LEDGER_ROLLBACK');return current;
  }
  function ready(){check(!closed,'PUBLICATION_STORE_CLOSED');files(!readOnly);check(regular(manifestPath,{uid,mode:0o600,max:16384}).bytes.equals(manifestBytes),'PUBLICATION_OWNERSHIP_CHANGED');regular(dbPath,{uid,mode:0o600,max:MAX_DB,expected:manifest.database,readMax:100});check(regular(sealPath,{uid,mode:0o600,max:16384,expected:sealStamp}).bytes.equals(sealBytes),'PUBLICATION_SEAL_CHANGED');if(!readOnly)check(regular(lockPath,{uid,mode:0o600,max:1024,expected:lockStamp}).bytes.equals(lockBytes),'PUBLICATION_WRITER_LOCKED');return validate();}
  function critical(work){check(!busy,'PUBLICATION_REENTRANT_REFUSED');busy=true;try{return synchronous(work());}finally{busy=false;}}
  function commit(kind,next,op=null){check(!readOnly&&!poisoned&&next.revision<MAX_EVENTS,'PUBLICATION_STORE_HELD');let began=false;
    try{db.exec('BEGIN IMMEDIATE');began=true;const prior=state();check(next.revision===prior.revision+1,'PUBLICATION_CAS_CONFLICT');const previous=db.prepare('SELECT event_hash FROM events WHERE revision=?').get(prior.revision).event_hash;stateData(next);if(op!==null){operationData(op);const key=op.kind==='PUBLICATION'?op.request.objectKey:null;db.prepare('INSERT INTO operations VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record').run(op.operationId,key,canonicalJSON(op));}const event={kind,state:next,operation:op};db.prepare('UPDATE metadata SET state=? WHERE id=1').run(canonicalJSON(next));db.prepare('INSERT INTO events VALUES(?,?,?,?)').run(next.revision,previous,canonicalJSON(event),hash(event));db.exec('COMMIT');began=false;anchor(next.revision,hash(event));return next;
    }catch(error){poisoned=true;if(began)try{db.exec('ROLLBACK');}catch{}throw error;}
  }
  function observation(record){return decoderFreeze({...MARKERS,ledgerId:manifest.ledgerId,storageHash:manifest.storageHash,record});}
  function revokeInternal(value){decoderExact(value,['operationId','expectedRevision','reason']);check(uuid(value.operationId)&&integer(value.expectedRevision,MAX_EVENTS-1)&&REASONS.includes(value.reason));const current=ready(),prior=operation(value.operationId);if(prior){check(prior.kind==='REVOKE'&&prior.request.reason===value.reason&&value.expectedRevision<=current.revision,'PUBLICATION_OPERATION_CONFLICT');check(prior.phase==='COMPLETED','PUBLICATION_STORE_HELD');return observation(prior);}
    check(!readOnly&&!poisoned&&current.phase==='ACTIVE'&&current.heldOperationId===null,'PUBLICATION_STORE_HELD');check(value.expectedRevision===current.revision,'PUBLICATION_CAS_CONFLICT');check(db.prepare('SELECT count(*) AS n FROM operations').get().n<MAX_OPERATIONS,'PUBLICATION_STORE_FULL');const intent={operationId:value.operationId,kind:'REVOKE',request:{reason:value.reason},phase:'INTENT',intentRevision:current.revision+1,completedRevision:null};const draining=commit('REVOKE',{...current,revision:current.revision+1,phase:'DRAINING',revocationId:value.operationId,reason:value.reason},intent);const completed={...intent,phase:'COMPLETED',completedRevision:draining.revision+1};commit('REVOKED',{...draining,revision:draining.revision+1,phase:'REVOKED'},completed);return observation(completed);
  }
  try{
    const found=files(false),hasSeal=!absent(sealPath);
    if(found.length===0){
      check(!hasSeal,'PUBLICATION_LEDGER_REPLACED');lockBytes=Buffer.from(canonicalJSON({schema:'atlas-proof-publication-lock-v1',nonce:randomUUID()}));durableFile(lockPath,lockBytes);lockStamp=regular(lockPath,{uid,mode:0o600,max:1024}).stamp;syncDirectory(ledger);
      durableFile(dbPath,Buffer.alloc(0));manifest={schema:'atlas-proof-publication-ownership-v1',ledgerId:randomUUID(),descriptorHash:c.descriptorHash,storageHash:hash(c.binding),publisher:config.publisher,ledgerDirectory:c.ledger,objectsDirectory:c.objects,database:identity(lstatSync(dbPath))};manifestBytes=Buffer.from(canonicalJSON(manifest));durableFile(manifestPath,manifestBytes);syncDirectory(ledger);
      db=new DatabaseSync(dbPath);db.exec('PRAGMA busy_timeout=100; PRAGMA journal_mode=DELETE; PRAGMA synchronous=EXTRA; PRAGMA max_page_count=4096;');check(db.prepare('PRAGMA page_size').get().page_size===4096&&db.prepare('PRAGMA synchronous').get().synchronous===3&&db.prepare('PRAGMA journal_mode').get().journal_mode==='delete');db.exec('BEGIN IMMEDIATE');db.exec(`PRAGMA application_id=${APP_ID}; PRAGMA user_version=1;`);for(const sql of Object.values(SQL))db.exec(sql);
      const initial={revision:0,phase:'ACTIVE',heldOperationId:null,revocationId:null,reason:null},event={kind:'GENESIS',state:initial,operation:null};db.prepare('INSERT INTO metadata VALUES(1,?,?)').run(canonicalJSON(manifest),canonicalJSON(initial));db.prepare('INSERT INTO events VALUES(0,NULL,?,?)').run(canonicalJSON(event),hash(event));db.exec('COMMIT');anchor(0,hash(event),true);
    }else{
      check(found.length===2&&found.includes(DB)&&found.includes(MANIFEST)&&hasSeal,'PUBLICATION_RECOVERY_REQUIRED');manifestBytes=regular(manifestPath,{uid,mode:0o600,max:16384}).bytes;manifest=json(manifestBytes);decoderExact(manifest,['schema','ledgerId','descriptorHash','storageHash','publisher','ledgerDirectory','objectsDirectory','database']);check(manifest.schema==='atlas-proof-publication-ownership-v1'&&uuid(manifest.ledgerId)&&manifest.descriptorHash===c.descriptorHash&&manifest.storageHash===hash(c.binding)&&same(manifest.publisher,config.publisher)&&same(manifest.ledgerDirectory,c.ledger)&&same(manifest.objectsDirectory,c.objects)&&canonicalJSON(manifest)===manifestBytes.toString(),'PUBLICATION_OWNERSHIP_CHANGED');
      const saved=regular(sealPath,{uid,mode:0o600,max:16384});sealBytes=saved.bytes;sealStamp=saved.stamp;seal(json(sealBytes));const header=regular(dbPath,{uid,mode:0o600,max:MAX_DB,expected:manifest.database,readMax:100}).bytes;check(header.length===100&&header.subarray(0,16).equals(Buffer.from('SQLite format 3\0'))&&header.readUInt32BE(68)===APP_ID&&header.readUInt32BE(60)===1,'PUBLICATION_LEDGER_REPLACED');
      readOnly=true;db=new DatabaseSync(dbPath,{readOnly:true});db.exec('PRAGMA busy_timeout=100;');check(validate().phase==='REVOKED','PUBLICATION_RECOVERY_REQUIRED');
    }
    validate();
  }catch(error){try{db?.close();}finally{storage.close();}throw error;}
  return Object.freeze({...MARKERS,binding:decoderFreeze(c.binding),
    status(){return critical(()=>{const current=ready();return decoderFreeze({...MARKERS,ledgerId:manifest.ledgerId,storageHash:manifest.storageHash,...current,poisoned,readOnly,closed});});},
    publishOriginal(options){return critical(()=>{
      const input=engineDataOptions(options,['operationId','expectedRevision','objectKey','manifest','bytes']);check(uuid(input.operationId)&&integer(input.expectedRevision,MAX_EVENTS-1)&&digest(input.objectKey)&&Buffer.isBuffer(input.bytes)&&input.bytes.length>0&&input.bytes.length<=config.storage.maxObjectBytes);const m=manifestData(input.manifest,c.binding),bytes=Buffer.from(input.bytes);
      try{check(bytes.length===m.byteCount&&sha(bytes)===m.sha256,'PUBLICATION_SOURCE_MISMATCH');const request={objectKey:input.objectKey,manifestHash:hash(m),byteCount:m.byteCount,sha256:m.sha256},current=ready(),prior=operation(input.operationId);
        if(prior){check(prior.kind==='PUBLICATION'&&same(prior.request,request)&&input.expectedRevision<=current.revision,'PUBLICATION_OPERATION_CONFLICT');check(prior.phase==='COMPLETED','PUBLICATION_STORE_HELD');let saved;try{saved=c.original(request.objectKey,request.manifestHash);check(saved&&saved.bytes.equals(bytes),'PUBLICATION_ORIGINAL_MISMATCH');}catch(error){poisoned=true;throw error;}finally{saved?.bytes.fill(0);}return observation(prior);}
        check(!readOnly&&!poisoned&&current.phase==='ACTIVE'&&current.heldOperationId===null,'PUBLICATION_STORE_HELD');check(input.expectedRevision===current.revision,'PUBLICATION_CAS_CONFLICT');check(db.prepare('SELECT count(*) AS n FROM operations').get().n<MAX_OPERATIONS-1,'PUBLICATION_STORE_FULL');check(!db.prepare('SELECT id FROM operations WHERE object_key=?').get(input.objectKey),'PUBLICATION_OPERATION_CONFLICT');check(absent(join(objects,input.objectKey+'.proof')),'PUBLICATION_UNTRACKED_ORIGINAL');
        const intent={operationId:input.operationId,kind:'PUBLICATION',request,phase:'INTENT',intentRevision:current.revision+1,completedRevision:null};let saved;
        try{
          const pending=commit('INTENT',{...current,revision:current.revision+1,heldOperationId:input.operationId},intent);
          // No await, caller callback, alternate writer or revocation writer may
          // run between this durable intent and the completed readback record.
          ready();const put=synchronous(storage.put({objectKey:input.objectKey,manifest:m,bytes}));decoderExact(put,['objectKey','manifestHash']);check(put.objectKey===request.objectKey&&put.manifestHash===request.manifestHash,'PUBLICATION_ORIGINAL_MISMATCH');
          saved=c.original(input.objectKey,request.manifestHash);check(saved&&saved.bytes.equals(bytes),'PUBLICATION_ORIGINAL_MISMATCH');const completed={...intent,phase:'COMPLETED',completedRevision:pending.revision+1};commit('COMPLETE',{...pending,revision:pending.revision+1,heldOperationId:null},completed);return observation(completed);
        }catch(error){
          // Preserve the committed INTENT even when SQLite/volume writes fail.
          // A durable UNKNOWN update is best effort, never a release or retry.
          if(!poisoned)try{const held=state(),stored=operation(input.operationId);if(stored?.phase==='INTENT')commit('UNKNOWN',{...held,revision:held.revision+1,phase:'DRAINING',reason:'STORAGE_UNCERTAIN'},{...stored,phase:'UNKNOWN'});}catch{}
          poisoned=true;throw error;
        }finally{saved?.bytes.fill(0);}
      }finally{bytes.fill(0);}
    });},
    lookupOperation(input){return critical(()=>{const value=decoderContractData(input);decoderExact(value,['operationId']);check(uuid(value.operationId));ready();return observation(operation(value.operationId));});},
    lookupOriginal(input){return critical(()=>{const value=decoderContractData(input);decoderExact(value,['objectKey','manifestHash']);check(digest(value.objectKey)&&digest(value.manifestHash));ready();const row=db.prepare('SELECT id FROM operations WHERE object_key=?').get(value.objectKey),op=row?operation(row.id):null;if(op)check(op.request.manifestHash===value.manifestHash,'PUBLICATION_OPERATION_CONFLICT');let original;try{original=c.original(value.objectKey,value.manifestHash);if(op&&!original)poisoned=true;return decoderFreeze({...MARKERS,objectKey:value.objectKey,manifestHash:value.manifestHash,observation:original?(op?.phase==='COMPLETED'?'TRACKED_ORIGINAL':op?'UNRESOLVED_ORIGINAL_HOLD':'UNTRACKED_ORIGINAL'):op?'ORIGINAL_UNAVAILABLE_HOLD':'ABSENT',operation:op});}catch(error){poisoned=true;throw error;}finally{original?.bytes.fill(0);}});},
    readOriginal(input){return critical(()=>{const value=decoderContractData(input);decoderExact(value,['objectKey','manifestHash']);check(!closed,'PUBLICATION_STORE_CLOSED');return c.original(value.objectKey,value.manifestHash);});},
    revoke(input){return critical(()=>revokeInternal(decoderContractData(input)));},
    close(){if(closed)return;return critical(()=>{let clean=false;try{if(!poisoned){const current=ready();if(current.phase==='ACTIVE')revokeInternal({operationId:randomUUID(),expectedRevision:current.revision,reason:'SERVICE_STOP'});clean=state().phase==='REVOKED';}}finally{closed=true;try{db.close();}finally{storage.close();}if(clean&&!readOnly){check(regular(lockPath,{uid,mode:0o600,max:1024,expected:lockStamp}).bytes.equals(lockBytes),'PUBLICATION_WRITER_LOCKED');unlinkSync(lockPath);syncDirectory(ledger);}}});}
  });
}

/** The trusted publisher can serve retained originals even while the write
 * ledger is restart-quarantined. Caller/actor authorization belongs to the
 * future concrete IPC service. This facade never opens or mutates SQLite. */
export function openProofOriginalReader(options={}){
  const c=configured(options);if(!c)return null;let closed=false;
  const sealPath=join(c.config.storage.directory,SEAL);
  function ready(){check(!closed,'PUBLICATION_STORE_CLOSED');c.ready();const value=json(regular(sealPath,{uid:c.config.publisher.uid,mode:0o600,max:16384}).bytes);decoderExact(value,['schema','manifest','revision','headHash']);const m=value.manifest;check(value.schema==='atlas-proof-publication-volume-seal-v1'&&m.schema==='atlas-proof-publication-ownership-v1'&&m.descriptorHash===c.descriptorHash&&m.storageHash===hash(c.binding)&&same(m.publisher,c.config.publisher)&&same(m.ledgerDirectory,c.ledger)&&same(m.objectsDirectory,c.objects),'PUBLICATION_SEAL_CHANGED');}
  try{ready();}catch(error){c.storage.close();throw error;}
  return Object.freeze({...MARKERS,binding:decoderFreeze(c.binding),readOriginal(input){const value=decoderContractData(input);decoderExact(value,['objectKey','manifestHash']);ready();return c.original(value.objectKey,value.manifestHash);},close(){if(!closed){closed=true;c.storage.close();}}});
}
