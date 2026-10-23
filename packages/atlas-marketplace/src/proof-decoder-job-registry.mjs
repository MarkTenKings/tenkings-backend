import {DatabaseSync} from 'node:sqlite';
import {constants,existsSync,lstatSync,realpathSync,readdirSync,mkdirSync,openSync,closeSync,readSync,writeFileSync,fstatSync,fsyncSync} from 'node:fs';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {canonicalJSON,hash,requireValue} from './contract.mjs';
import {assertProofDecoderLaunchPlan,decoderContractData,decoderExact,decoderFreeze} from './proof-decoder-profile.mjs';
import {assertProofDecoderPlan} from './proof-decoder-protocol.mjs';
import {proofDecoderOwnedIdentity} from './proof-decoder-owned-operations.mjs';
import {assertLocalFixtureDecoderCleanupReceipt} from './proof-decoder-fixture-executor.mjs';

const registries=new WeakMap(),DB='jobs.sqlite',MANIFEST='ownership.json',APP_ID=0x41544452;
const phases={RESERVED:['CREATE_INTENT','STOP_INTENT','QUARANTINED'],CREATE_INTENT:['CREATED','STOP_INTENT','QUARANTINED'],CREATED:['START_INTENT','STOP_INTENT','QUARANTINED'],START_INTENT:['RUNNING','STOP_INTENT','QUARANTINED'],RUNNING:['STOP_INTENT','QUARANTINED'],STOP_INTENT:['CLEANUP_OBSERVED','QUARANTINED'],CLEANUP_OBSERVED:['FINALIZED','QUARANTINED'],QUARANTINED:['STOP_INTENT'],FINALIZED:[]};
const error=(condition,code='DECODER_REGISTRY_INVALID')=>requireValue(condition,code);
const stamp=stat=>({device:stat.dev,inode:stat.ino});
function readOwned(path,max,expected) {
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {const st=fstatSync(fd);error(st.isFile()&&st.nlink===1&&st.uid===process.getuid()&&(st.mode&0o777)===0o600&&st.size<=max,'DECODER_REGISTRY_FOREIGN_FILE');if(expected)error(st.dev===expected.device&&st.ino===expected.inode,'DECODER_REGISTRY_FOREIGN_FILE');const bytes=Buffer.alloc(st.size);error(readSync(fd,bytes,0,bytes.length,0)===bytes.length);return {bytes,stat:st};}finally{closeSync(fd);}
}
function durableFile(path,bytes) {const fd=openSync(path,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}}
const syncDirectory=path=>{const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{fsyncSync(fd);}finally{closeSync(fd);}};

/** Fresh private directory, or exact explicit ownership receipt for reopening.
 * Any SQLite sidecar is refused BEFORE opening/recovery/writes. Hot-journal
 * recovery is deliberately outside this local source stage. */
export function openProofDecoderJobRegistry({enabled=false,directory,plan:input,ownership,maxRetainedJobs=128,busyTimeoutMs=100}={}) {
  if(enabled!==true)return null;
  const plan=assertProofDecoderLaunchPlan(input);
  error(typeof directory==='string'&&isAbsolute(directory)&&resolve(directory)===directory&&realpathSync(dirname(directory))===dirname(directory));
  error(Number.isSafeInteger(maxRetainedJobs)&&maxRetainedJobs>0&&maxRetainedJobs<=1024&&Number.isSafeInteger(busyTimeoutMs)&&busyTimeoutMs>=0&&busyTimeoutMs<=1000);
  if(!existsSync(directory)){error(!ownership,'DECODER_REGISTRY_OWNERSHIP_REQUIRED');mkdirSync(directory,{mode:0o700});}
  const directoryStat=lstatSync(directory);error(directoryStat.isDirectory()&&!directoryStat.isSymbolicLink()&&directoryStat.uid===process.getuid()&&(directoryStat.mode&0o777)===0o700,'DECODER_REGISTRY_FOREIGN_FILE');
  const dbPath=join(directory,DB),manifestPath=join(directory,MANIFEST);let manifest,receipt,manifestBytes;
  function validateRecord(input) {
    const row=decoderContractData(input);decoderExact(row,['identity','requestPlan','phase','revision','createdAt','deadlineAt','startedAt','cleanup']);
    proofDecoderOwnedIdentity(row.identity,plan);error(row.identity.registryId===manifest.registryId,'DECODER_REGISTRY_RECORD_INVALID');assertProofDecoderPlan(row.requestPlan);error(row.requestPlan.byteCount<=plan.profile.limits.maxObjectBytes,'DECODER_REGISTRY_RECORD_INVALID');
    error(Object.hasOwn(phases,row.phase)&&Number.isSafeInteger(row.revision)&&row.revision>=0&&row.revision<=1024&&Number.isSafeInteger(row.createdAt)&&row.createdAt>=0&&Number.isSafeInteger(row.deadlineAt)&&row.deadlineAt>row.createdAt&&row.deadlineAt-row.createdAt<=plan.profile.limits.timeoutMs,'DECODER_REGISTRY_RECORD_INVALID');
    error(row.startedAt===null||Number.isSafeInteger(row.startedAt)&&row.startedAt>=row.createdAt&&row.startedAt<=row.deadlineAt,'DECODER_REGISTRY_RECORD_INVALID');
    if(['CREATED','START_INTENT','RUNNING'].includes(row.phase))error(row.identity.containerId!==null,'DECODER_REGISTRY_RECORD_INVALID');
    if(row.phase==='RUNNING')error(row.startedAt!==null,'DECODER_REGISTRY_RECORD_INVALID');
    if(row.cleanup!==null){const c=row.cleanup;decoderExact(c,['schema','classification','evidenceOrigin','identity','processState','waitObserved','cgroupState','containerAbsent','confirmed','observedAt']);error(c.schema==='atlas-proof-decoder-local-cleanup-v1'&&c.classification==='UNQUALIFIED'&&c.evidenceOrigin==='LOCAL_FIXTURE'&&canonicalJSON(c.identity)===canonicalJSON(row.identity)&&c.confirmed===true&&c.containerAbsent===true&&c.cgroupState==='SIMULATED_EMPTY'&&['NOT_STARTED','EXITED'].includes(c.processState)&&c.waitObserved===(c.processState==='EXITED')&&Number.isSafeInteger(c.observedAt)&&c.observedAt>=row.createdAt,'DECODER_REGISTRY_RECORD_INVALID');}
    if(['CLEANUP_OBSERVED','FINALIZED'].includes(row.phase))error(row.cleanup!==null,'DECODER_REGISTRY_RECORD_INVALID');
    return row;
  }
  function decode(row) {if(!row)return null;error(typeof row.record==='string'&&Buffer.byteLength(row.record)<=8192,'DECODER_REGISTRY_RECORD_INVALID');let parsed;try{parsed=JSON.parse(row.record);}catch{error(false,'DECODER_REGISTRY_RECORD_INVALID');}const result=validateRecord(parsed);if(row.id!==undefined)error(row.id===result.identity.jobId&&row.revision===result.revision,'DECODER_REGISTRY_RECORD_INVALID');return result;}
  function inspectDirectory() {
    const st=lstatSync(directory);error(st.isDirectory()&&!st.isSymbolicLink()&&st.dev===directoryStat.dev&&st.ino===directoryStat.ino&&st.uid===process.getuid()&&(st.mode&0o777)===0o700,'DECODER_REGISTRY_FOREIGN_FILE');
    const entries=readdirSync(directory);
    error(!entries.some(name=>name.startsWith(DB+'-')),'DECODER_REGISTRY_RECOVERY_REQUIRED');
    error(entries.every(name=>[DB,MANIFEST].includes(name)),'DECODER_REGISTRY_FOREIGN_FILE');
    return entries;
  }
  const initial=inspectDirectory();
  if(!initial.length) {
    error(!ownership,'DECODER_REGISTRY_OWNERSHIP_REQUIRED');
    const token=randomBytes(32).toString('hex'),registryId=randomUUID();durableFile(dbPath,Buffer.alloc(0));
    manifest={schema:'atlas-proof-decoder-registry-v1',registryId,tokenHash:hash(token),profileHash:plan.profileHash,uid:process.getuid(),directory:stamp(directoryStat),database:stamp(lstatSync(dbPath))};
    manifestBytes=Buffer.from(canonicalJSON(manifest));durableFile(manifestPath,manifestBytes);syncDirectory(directory);
    receipt=decoderFreeze({registryId,token,manifestHash:hash(manifest)});
  } else {
    error(initial.length===2&&ownership,'DECODER_REGISTRY_OWNERSHIP_REQUIRED');
    receipt=decoderContractData(ownership);decoderExact(receipt,['registryId','token','manifestHash']);error(typeof receipt.token==='string'&&/^[a-f0-9]{64}$/.test(receipt.token),'DECODER_REGISTRY_OWNERSHIP_REQUIRED');
    manifestBytes=readOwned(manifestPath,4096).bytes;
    try{manifest=JSON.parse(manifestBytes.toString('utf8'));}catch{error(false,'DECODER_REGISTRY_FOREIGN_FILE');}
    decoderExact(manifest,['schema','registryId','tokenHash','profileHash','uid','directory','database']);
    error(canonicalJSON(manifest)===manifestBytes.toString('utf8')&&manifest.schema==='atlas-proof-decoder-registry-v1'&&manifest.registryId===receipt.registryId&&manifest.tokenHash===hash(receipt.token)&&manifest.profileHash===plan.profileHash&&receipt.manifestHash===hash(manifest)&&manifest.uid===process.getuid()&&canonicalJSON(manifest.directory)===canonicalJSON(stamp(directoryStat)),'DECODER_REGISTRY_OWNERSHIP_REQUIRED');
    const bytes=readOwned(dbPath,16*1024*1024,manifest.database).bytes;
    error(bytes.length>=100&&bytes.subarray(0,16).equals(Buffer.from('SQLite format 3\0'))&&bytes.readUInt32BE(68)===APP_ID&&bytes.readUInt32BE(60)===1,'DECODER_REGISTRY_FOREIGN_FILE');
    // A read-only probe follows all file/sidecar checks; never permit SQLite to
    // adopt or repair an unknown DB merely to discover its metadata.
    const probe=new DatabaseSync(dbPath,{readOnly:true});try{error(probe.prepare('SELECT value FROM registry_metadata WHERE id=1').get()?.value===canonicalJSON(manifest),'DECODER_REGISTRY_FOREIGN_FILE');const rows=probe.prepare('SELECT id,revision,record FROM jobs').all();error(rows.length<=maxRetainedJobs,'DECODER_REGISTRY_RECORD_INVALID');rows.forEach(decode);}finally{probe.close();}
  }
  inspectDirectory();readOwned(dbPath,16*1024*1024,manifest.database);let db;
  try {
    db=new DatabaseSync(dbPath);db.exec(`PRAGMA busy_timeout=${busyTimeoutMs}; PRAGMA journal_mode=DELETE; PRAGMA synchronous=EXTRA;`);
    error(db.prepare('PRAGMA journal_mode').get().journal_mode==='delete'&&db.prepare('PRAGMA synchronous').get().synchronous===3);
    if(!initial.length){db.exec(`PRAGMA application_id=${APP_ID}; PRAGMA user_version=1; CREATE TABLE registry_metadata(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL); CREATE TABLE jobs(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,record TEXT NOT NULL);`);db.prepare('INSERT INTO registry_metadata VALUES(1,?)').run(canonicalJSON(manifest));}
  }catch(cause){db?.close();throw cause;}
  let closed=false,quarantined=false;
  function ready() {error(!closed,'DECODER_REGISTRY_CLOSED');try{inspectDirectory();error(readOwned(manifestPath,4096).bytes.equals(manifestBytes),'DECODER_REGISTRY_FOREIGN_FILE');readOwned(dbPath,16*1024*1024,manifest.database);}catch(cause){quarantined=true;throw cause;}error(!quarantined,'DECODER_REGISTRY_QUARANTINED');}
  function transaction(run) {ready();db.exec('BEGIN IMMEDIATE');try{const result=run();db.exec('COMMIT');return result;}catch(cause){try{db.exec('ROLLBACK');}catch{quarantined=true;}throw cause;}}
  const registry=Object.freeze({classification:'UNQUALIFIED',ownership:decoderFreeze(receipt),profileHash:plan.profileHash,
    reserve({requestId,epoch,requestPlan,deadlineAt,now}) {
      error(typeof requestId==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(requestId)&&typeof epoch==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(epoch)&&Number.isSafeInteger(now)&&now>=0&&Number.isSafeInteger(deadlineAt)&&deadlineAt>now&&deadlineAt-now<=plan.profile.limits.timeoutMs);
      const original=decoderContractData(requestPlan);assertProofDecoderPlan(original);error(original.byteCount<=plan.profile.limits.maxObjectBytes);
      return transaction(()=>{error(db.prepare('SELECT count(*) AS count FROM jobs').get().count<maxRetainedJobs,'DECODER_REGISTRY_FULL');const rows=db.prepare('SELECT id,revision,record FROM jobs').all().map(decode);error(!rows.some(row=>row.identity.requestId===requestId),'DECODER_REQUEST_REPLAY');error(rows.filter(row=>row.phase!=='FINALIZED').length<plan.profile.limits.maxConcurrent,'DECODER_SUPERVISOR_BUSY');const jobId=randomUUID();const record={identity:{registryId:manifest.registryId,jobId,requestId,ownerNonce:randomBytes(32).toString('hex'),epoch,profileHash:plan.profileHash,image:plan.profile.image,name:`atlas-proof-${manifest.registryId}-${jobId}`,containerId:null},requestPlan:original,phase:'RESERVED',revision:0,createdAt:now,deadlineAt,startedAt:null,cleanup:null};db.prepare('INSERT INTO jobs VALUES(?,?,?)').run(jobId,0,canonicalJSON(record));return decoderFreeze(record);});
    },
    transition(jobId,revision,patch) {
      const change=decoderContractData(patch);error(Object.keys(change).every(key=>['phase','containerId','startedAt','cleanup'].includes(key))&&typeof change.phase==='string');
      return transaction(()=>{const current=decode(db.prepare('SELECT id,revision,record FROM jobs WHERE id=?').get(jobId));error(current&&current.revision===revision,'DECODER_REGISTRY_CAS');error(phases[current.phase]?.includes(change.phase)||(current.phase==='STOP_INTENT'&&change.phase==='STOP_INTENT'&&(change.containerId!==undefined||change.startedAt!==undefined)&&change.cleanup===undefined),'DECODER_REGISTRY_TRANSITION');
        if(change.containerId!==undefined){error(current.identity.containerId===null&&/^[a-f0-9]{64}$/.test(change.containerId));current.identity.containerId=change.containerId;}
        if(change.startedAt!==undefined){error(current.startedAt===null&&Number.isSafeInteger(change.startedAt)&&change.startedAt>=current.createdAt);current.startedAt=change.startedAt;}
        if(change.cleanup!==undefined){assertLocalFixtureDecoderCleanupReceipt(patch.cleanup,{identity:current.identity});current.cleanup=change.cleanup;}
        if(change.phase==='FINALIZED')error(current.cleanup?.confirmed===true,'DECODER_CLEANUP_UNCONFIRMED');
        current.phase=change.phase;current.revision++;validateRecord(current);const updated=db.prepare('UPDATE jobs SET revision=?,record=? WHERE id=? AND revision=?').run(current.revision,canonicalJSON(current),jobId,revision);error(updated.changes===1,'DECODER_REGISTRY_CAS');return decoderFreeze(current);});
    },
    get(jobId){ready();return decoderFreeze(decode(db.prepare('SELECT id,revision,record FROM jobs WHERE id=?').get(jobId)));},
    snapshot(){ready();const jobs=db.prepare('SELECT id,revision,record FROM jobs ORDER BY id').all().map(decode);return decoderFreeze({classification:'UNQUALIFIED',registryId:manifest.registryId,directory,profileHash:plan.profileHash,quarantined,journalMode:'delete',synchronous:3,jobs,occupiedSlots:jobs.filter(job=>job.phase!=='FINALIZED').length});},
    status(){return {classification:'UNQUALIFIED',closed,quarantined,directory,registryId:manifest.registryId};},
    close(){if(!closed){closed=true;db.close();}}
  });registries.set(registry,{profileHash:plan.profileHash});return registry;
}
export function assertProofDecoderJobRegistry(value,{plan}) {error(registries.get(value)?.profileHash===plan.profileHash,'DECODER_REGISTRY_REQUIRED');return value;}
