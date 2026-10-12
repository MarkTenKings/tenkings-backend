import {variantSelectionParallel,compareVariantCardNumber,validateVariantReviewSnapshot,variantSnapshotHash,createManufacturerChecklistVariantProvider} from '@tenkings/card-catalog-evidence';
import {randomUUID} from 'node:crypto';
import {canonical,digest,object,requireThat,uuid} from '@atlas/manual-service/contract';
import {authorizeManualCard} from '@atlas/defect-memory/repository';
import {canonicalizeNewSpeedsterSessionIdentity} from '@atlas/grading-core/identity';
import {prepareVariantListingRequest,variantChecklistListingIdentity,VARIANT_LISTING_REVISION} from './variant-listing-provider.mjs';
import {CODEX_ASSOCIATION_REVISION,variantCodexAliases,codexChoices,codexLibraryKey,codexPhotoPoolKey,validateCodexPhotoPool,codexReadingKey,codexImageReservationKey,validateCodexLibrary,validateVariantReferenceLabels,projectCodexReading} from './variant-codex.mjs';
import {prepareVariantLabelRequest,projectVariantLabelResponse,readVariantLabelResponse,VARIANT_LABEL_POLICY,VARIANT_PHOTO_MODEL} from './variant-photo-provider.mjs';

export const VARIANT_POLICY='atlas-visual-variant-v1';
const table='atlas_manual_connected.variant_job';
const listingDispatchKey=key=>`variant-listing-dispatch:v1:${key}`;
const listingResponseKey=key=>`variant-listing-response:v1:${key}`;
const listingJournalKey=key=>/^(?:variant-(?:listing|label)-(?:dispatch|response):v1:|atlas-codex-)/.test(key);
const labelDispatchKey=key=>`variant-label-dispatch:v1:${key}`;
const labelResponseKey=key=>`variant-label-response:v1:${key}`;
// Provider-owned bodies are evidence, not manual form fields. Keep the manual
// envelope serializer unchanged and permit one explicitly bounded string only.
// Its exact characters are retained; all metadata retains ordinary restrictions.
function evidenceText(value,field,bodyLimit){
 requireThat(value&&Object.getPrototypeOf(value)===Object.prototype,400,'VARIANT_EVIDENCE_INVALID');
 const fields=Object.keys(value),descriptors=Object.getOwnPropertyDescriptors(value);
 requireThat(Reflect.ownKeys(value).length===fields.length&&fields.every(key=>Object.hasOwn(descriptors[key],'value')),400,'VARIANT_EVIDENCE_INVALID');
 if(!Object.hasOwn(value,field))return canonical(value,{maxBytes:8388608});
 const body=descriptors[field].value;
 requireThat(typeof body==='string'&&Buffer.byteLength(body)<=bodyLimit,413,'VARIANT_EVIDENCE_BODY_TOO_LARGE');
 canonical({...value,[field]:''},{maxBytes:8388608});
 const text=`{${fields.sort().map(key=>`${JSON.stringify(key)}:${key===field?JSON.stringify(body):canonical(value[key],{maxBytes:8388608})}`).join(',')}}`;
 requireThat(Buffer.byteLength(text)<=8388608,413,'VARIANT_EVIDENCE_TOO_LARGE');return text;
}
export const variantIdentityHash=identity=>digest(canonical(identity));
export const variantJobKey=input=>digest(canonical([VARIANT_POLICY,input.cardId,input.sourceHash,input.identityRevision,input.identityHash,input.generation??null,...(input.catalogRevision?[input.catalogRevision]:[])]));
export const variantRefreshable=job=>Boolean(job&&(job.state==='READY'||['FAILED','STALE'].includes(job.state)&&!job.dispatch_id));
const unpack=row=>{
 if(!row)return null;
 requireThat(digest(row.input)===row.input_hash&&(!row.response||digest(row.response)===row.response_hash)&&(!row.result||digest(row.result)===row.result_hash),503,'VARIANT_STORED_CONTENT_INVALID');
 const input=JSON.parse(row.input),catalog=row.catalog?JSON.parse(row.catalog):null,result=row.result?JSON.parse(row.result):null;
 requireThat(input.cardId===row.card_id&&input.sourceHash===row.source_hash&&input.identityRevision===row.identity_revision&&input.identityHash===row.identity_hash&&variantJobKey(input)===row.key&&(input.generation??'00000000-0000-0000-0000-000000000000')===row.generation,503,'VARIANT_STORED_CONTENT_INVALID');
 if(catalog){validateVariantReviewSnapshot(catalog);requireThat(catalog.snapshotHash===row.catalog_hash,503,'VARIANT_STORED_CONTENT_INVALID');}
 if(result){requireThat(catalog&&canonical(result.catalog,{maxBytes:1048576})===canonical(catalog,{maxBytes:1048576}),503,'VARIANT_STORED_CONTENT_INVALID');if(result.referenceLabels)validateVariantReferenceLabels(result.referenceLabels,catalog);}
 return {...row,input,catalog,response:row.response?JSON.parse(row.response):null,result};
};
const current=`EXISTS(SELECT 1 FROM atlas_manual.card c WHERE c.id=j.card_id AND c.owner_id=j.actor_id
 AND c.content::jsonb->'source'->>'sourceHash'=j.source_hash
 AND (c.content::jsonb->>'identityRevision')::int=j.identity_revision)
 AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.card_id=j.card_id)
 AND atlas_manual_connected.display_owner_current(j.actor_id,j.access_version)`;
const active=`j.key=$1 AND j.claim_id=$2::uuid AND j.state IN('RUNNING','REQUESTED') AND j.lease_until>clock_timestamp() AND ${current}`;
export function variantBinding(card){const d=card.draft;return {cardId:card.cardId,sourceHash:d.source?.sourceHash,identityRevision:d.identityRevision,identityHash:variantIdentityHash(d.identity)};}
export function variantCatalogIdentity(profile,identity){return {category:profile,name:identity.playerName??identity.cardName,year:identity.year,setName:identity.productSet,cardNumber:identity.cardNumber,manufacturer:identity.manufacturer??null};}
export function variantSelectedIdentity(card,action,result){
  if(action.decision==='UNRESOLVED')return card.draft.identity;
  if(action.decision==='MANUAL')return canonicalizeNewSpeedsterSessionIdentity('playerName'in card.draft.identity?'SPORTS':'POKEMON',{...card.draft.identity,parallel:action.manualParallel});
  const candidate=result?.catalog?.candidates.find(c=>c.candidateId===action.candidateId);
  requireThat(candidate,409,'VARIANT_RESULT_STALE');
  requireThat(typeof candidate.parallel==='string'&&candidate.parallel.trim(),409,'VARIANT_FINISH_UNRESOLVED');
  const profile='playerName' in card.draft.identity?'SPORTS':'POKEMON',i=candidate.identity,old=card.draft.identity;
  requireThat(i.category===profile,409,'VARIANT_IDENTITY_STALE');
  // Scrydex already checked the saved set against its expansion and series
  // names before admitting this candidate. Keep that accepted spelling: e.g.
  // Keep the saved Scarlet & Violet—151 label when the provider returns 151.
  // Unverified provider aliases still adopt the reviewed candidate identity.
  const pokemonSet= candidate.source.provider==='scrydex' && old.productSet
    && !candidate.warnings.includes('SET_NAME_REQUIRES_REVIEW') ? old.productSet : i.setName;
  return canonicalizeNewSpeedsterSessionIdentity(profile,profile==='SPORTS'
    ?{...old,playerName:i.name,year:i.year,manufacturer:i.manufacturer??old.manufacturer,productSet:i.setName,cardNumber:i.cardNumber,parallel:variantSelectionParallel(candidate)}
    :{...old,cardName:i.name,year:i.year,productSet:pokemonSet,cardNumber:i.cardNumber,parallel:variantSelectionParallel(candidate)});
}
export function validateVariantReferencePermission(permission){
  object(permission,['basis','consumers',...(permission&&Object.hasOwn(permission,'detail')?['detail']:[])]);
  requireThat(['owned_original','licensed','permission'].includes(permission.basis)
    &&Array.isArray(permission.consumers)&&permission.consumers.length===2&&permission.consumers[0]==='inventory'&&permission.consumers[1]==='atlas',400,'VARIANT_REFERENCE_PERMISSION_INVALID');
  return permission;
}
export function validateVariantContributionPacket(job,packet){
  object(packet,['ref','sourceHash']);object(packet.ref,['key','sha256','byteCount','lineageSha256','cardId','kind']);
  validateVariantReferencePermission(job.payload.referencePermission);
  const ref=packet.ref,lineage=digest(canonical({cardId:job.card_id,kind:'VARIANT_REFERENCE',sourceHash:job.payload_hash}));
  requireThat(digest(canonical(job.payload,{maxBytes:2097152}))===job.payload_hash&&packet.sourceHash===job.payload_hash&&ref.cardId===job.card_id&&ref.kind==='VARIANT_REFERENCE'
    &&/^[a-f0-9]{64}$/.test(ref.sha256)&&ref.lineageSha256===lineage&&Number.isSafeInteger(ref.byteCount)&&ref.byteCount>0&&ref.byteCount<=16777216
    &&typeof ref.key==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_/-]+\.json$/.test(ref.key)&&!ref.key.includes('..')
    &&ref.key.endsWith(`/${job.card_id}/VARIANT_REFERENCE/${lineage}-${ref.sha256}.json`),409,'VARIANT_REFERENCE_PACKET_INVALID');
  return packet;
}
export function validateVariantAction(action){
  object(action,['type','sourceHash','identityRevision','identityHash','jobId','resultHash','decision','candidateId','reviewed',...(action.decision==='MANUAL'?['manualParallel']:[]),...(Object.hasOwn(action,'referencePermission')?['referencePermission']:[])]);
  requireThat(action.type==='VARIANT_CONFIRM'&&action.reviewed===true&&['SELECTED','MANUAL','UNRESOLVED'].includes(action.decision),400,'VARIANT_CONFIRMATION_INVALID');
  if(Object.hasOwn(action,'referencePermission')){requireThat(action.decision!=='UNRESOLVED',400,'VARIANT_REFERENCE_PERMISSION_INVALID');validateVariantReferencePermission(action.referencePermission);}
  requireThat(/^[a-f0-9]{64}$/.test(action.sourceHash)&&/^[a-f0-9]{64}$/.test(action.identityHash)&&Number.isSafeInteger(action.identityRevision)&&action.identityRevision>0,400,'VARIANT_CONFIRMATION_INVALID');
  if(action.decision==='MANUAL')requireThat(typeof action.manualParallel==='string'&&action.manualParallel.trim().length>0&&action.manualParallel.length<=120,400,'VARIANT_CONFIRMATION_INVALID');
  requireThat((action.jobId===null&&action.resultHash===null)||/^[a-f0-9]{64}$/.test(action.jobId)&&/^[a-f0-9]{64}$/.test(action.resultHash),400,'VARIANT_CONFIRMATION_INVALID');
  requireThat(action.decision==='SELECTED'?/^[a-f0-9]{64}$/.test(action.jobId)&&/^[a-f0-9]{64}$/.test(action.resultHash)&&typeof action.candidateId==='string'&&action.candidateId.length<=240:action.candidateId===null,400,'VARIANT_CONFIRMATION_INVALID');
}
export function createVariantJobStore({boundary,intakeRepository=null,leaseMs=180000}){
  requireThat(typeof boundary.machineTransaction==='function'&&Number.isInteger(leaseMs)&&leaseMs>=1000&&leaseMs<=300000,500,'VARIANT_CONFIG_INVALID');
  const machine=work=>boundary.machineTransaction(null,work);
  const checklist=createManufacturerChecklistVariantProvider();
  async function preparationLock(tx,cardId){await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1,721931))',`atlas-variant-preparation:${cardId}`);}
  // The retained cache is append-only. A transaction-scoped lock and a strict
  // one-record read make these names a permanent request journal, not a TTL
  // acquisition cache. All source writers take the same public-identity lock.
  async function listingLock(tx,key){await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1,721930))',`atlas-listing-source:${key}`);}
  async function listingRead(tx,key){const rows=await tx.$queryRawUnsafe('SELECT snapshot,snapshot_hash FROM atlas_manual_connected.variant_catalog_cache WHERE key=$1 ORDER BY created_at LIMIT 2',key);
    requireThat(rows.length<=1,503,'VARIANT_LISTING_JOURNAL_CONFLICT');if(!rows.length)return null;
    requireThat(digest(rows[0].snapshot)===rows[0].snapshot_hash,503,'VARIANT_CACHE_CORRUPT');return JSON.parse(rows[0].snapshot);}
  async function listingWrite(tx,key,value){await tx.$executeRawUnsafe('INSERT INTO atlas_manual_connected.variant_catalog_cache(key,snapshot,snapshot_hash,expires_at) VALUES($1,$2,$3,$4::timestamptz)',key,value,digest(value),'2000-01-01T00:00:00.000Z');}
  async function retainPhotoPool(tx,catalog){
    if(!catalog.referencePhotos?.length)return;
    const cards=[...new Map(codexChoices(catalog).map(choice=>[choice.cardKey,choice])).values()].sort((a,b)=>a.cardKey.localeCompare(b.cardKey));
    for(const choice of cards){
      const key=codexPhotoPoolKey(choice);await listingLock(tx,key);
      const [prior]=await tx.$queryRawUnsafe('SELECT snapshot,snapshot_hash FROM atlas_manual_connected.variant_catalog_cache WHERE key=$1 ORDER BY created_at DESC LIMIT 1',key);
      const photos=new Map();
      if(prior){requireThat(digest(prior.snapshot)===prior.snapshot_hash,503,'VARIANT_CACHE_CORRUPT');for(const photo of validateCodexPhotoPool(JSON.parse(prior.snapshot),choice).photos)photos.set(photo.sha256,photo);}
      const count=photos.size;for(const photo of catalog.referencePhotos)if(!photos.has(photo.sha256))photos.set(photo.sha256,photo);
      if(photos.size!==count)await listingWrite(tx,key,canonical({schemaVersion:'atlas-codex-photo-pool/v1',cardKey:choice.cardKey,photos:[...photos.values()]},{maxBytes:8388608}));
    }
  }
  function listingResponse(saved,reservation){requireThat(saved?.schemaVersion==='variant-listing-source-journal/v1'&&saved.requestKey===reservation.request.requestKey&&saved.dispatchId===reservation.dispatchId&&saved.reservationHash===digest(canonical(reservation)),503,'VARIANT_LISTING_JOURNAL_CONFLICT');
    const {schemaVersion,dispatchId,reservationHash,sourceSchemaVersion,...source}=saved;requireThat(typeof source.bodyText==='string'&&Buffer.byteLength(source.bodyText)<=1048576&&digest(source.bodyText)===source.sha256,503,'VARIANT_LISTING_SOURCE_INVALID');return {schemaVersion:sourceSchemaVersion,...source};}
  async function authorized(tx,principal,cardId,edit=false){const card=await authorizeManualCard(tx,principal,cardId,{edit});if(intakeRepository)await intakeRepository.assertActiveInTransaction(tx,cardId);return card;}
  async function confirmation(tx,card){const b=variantBinding(card);const [row]=await tx.$queryRawUnsafe(`SELECT * FROM atlas_manual_connected.variant_confirmation WHERE card_id=$1::uuid AND source_hash=$2 AND identity_revision=$3 AND identity_hash=$4 ORDER BY created_at DESC,action_id DESC LIMIT 1`,card.cardId,b.sourceHash,b.identityRevision,b.identityHash);return row??null;}
  async function checkAction(tx,card,action){validateVariantAction(action);const b=variantBinding(card);
    requireThat(b.sourceHash===action.sourceHash,409,'VARIANT_SOURCE_STALE');requireThat(b.identityRevision===action.identityRevision&&b.identityHash===action.identityHash,409,'VARIANT_IDENTITY_STALE');
    let job=null;if(action.jobId!==null){const [row]=await tx.$queryRawUnsafe(`SELECT * FROM ${table} WHERE key=$1 AND card_id=$2::uuid`,action.jobId,card.cardId);job=unpack(row);
      requireThat(job?.catalog&&(job.result_hash===action.resultHash||job.catalog_hash===action.resultHash)&&job.source_hash===b.sourceHash&&(job.identity_revision===b.identityRevision&&job.identity_hash===b.identityHash||(await confirmation(tx,card))?.job_key===job.key),409,'VARIANT_RESULT_STALE');}
    return {job,identity:variantSelectedIdentity(card,action,job?.result??(job?.catalog?{catalog:job.catalog}:null))};
  }
  async function approvalCheck(tx,card){const row=await confirmation(tx,card);requireThat(['SELECTED','MANUAL'].includes(row?.decision),409,'VARIANT_CONFIRMATION_REQUIRED');
    return row;}
  return Object.freeze({
    async discover(limit=25){requireThat(Number.isInteger(limit)&&limit>=1&&limit<=100,500,'VARIANT_CONFIG_INVALID');return machine(async({tx})=>{
      const rows=await tx.$queryRawUnsafe(`SELECT c.id,c.owner_id,c.content,previous.key AS previous_key,atlas_manual_connected.display_owner_version(c.owner_id) access_version
       FROM atlas_manual.card c LEFT JOIN LATERAL (SELECT key FROM ${table} p WHERE p.card_id=c.id AND p.source_hash=c.content::jsonb->'source'->>'sourceHash' AND p.state IN('READY','FAILED') AND (p.identity_revision=(c.content::jsonb->>'identityRevision')::int OR EXISTS(SELECT 1 FROM atlas_manual_connected.variant_confirmation v WHERE v.card_id=c.id AND v.job_key=p.key AND v.identity_revision=(c.content::jsonb->>'identityRevision')::int)) ORDER BY p.created_at DESC,p.key DESC LIMIT 1) previous ON true
       WHERE atlas_manual_connected.display_owner_version(c.owner_id) IS NOT NULL AND EXISTS(SELECT 1 FROM atlas_manual_connected.identification i WHERE i.card_id=c.id AND i.state='COMPLETE' AND i.source_hash=c.content::jsonb->'source'->>'sourceHash')
       AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.card_id=c.id)
       AND (previous.key IS NOT NULL OR (NOT EXISTS(SELECT 1 FROM atlas_manual.approval a WHERE a.card_id=c.id AND a.source_hash=c.content_hash)
        AND NOT EXISTS(SELECT 1 FROM atlas_manual_connected.variant_confirmation v WHERE v.card_id=c.id AND v.source_hash=c.content::jsonb->'source'->>'sourceHash' AND v.identity_revision=(c.content::jsonb->>'identityRevision')::int AND v.decision IN('SELECTED','MANUAL'))))
       AND NOT EXISTS(SELECT 1 FROM ${table} j WHERE j.card_id=c.id AND j.source_hash=c.content::jsonb->'source'->>'sourceHash' AND j.identity_revision=(c.content::jsonb->>'identityRevision')::int AND j.state IN('QUEUED','RUNNING','REQUESTED'))
       AND NOT EXISTS(SELECT 1 FROM ${table} j WHERE j.card_id=c.id AND j.source_hash=c.content::jsonb->'source'->>'sourceHash' AND (j.identity_revision=(c.content::jsonb->>'identityRevision')::int OR EXISTS(SELECT 1 FROM atlas_manual_connected.variant_confirmation v WHERE v.card_id=c.id AND v.job_key=j.key AND v.identity_revision=(c.content::jsonb->>'identityRevision')::int)) AND j.policy=$1 AND j.input::jsonb->>'catalogRevision'=$3)
       ORDER BY c.id LIMIT $2`,VARIANT_POLICY,limit,CODEX_ASSOCIATION_REVISION);
      let count=0;for(const row of rows){const d=JSON.parse(row.content),input={...variantBinding({cardId:row.id,draft:d}),identity:variantCatalogIdentity('playerName'in d.identity?'SPORTS':'POKEMON',d.identity),catalogRevision:CODEX_ASSOCIATION_REVISION,
        ...(row.previous_key?{reuseJobKey:row.previous_key,localOnly:true,generation:randomUUID()}:{})};const value=canonical(input);
       await preparationLock(tx,row.id);
       const [existing]=await tx.$queryRawUnsafe(`SELECT key FROM ${table} WHERE card_id=$1::uuid AND source_hash=$2 AND identity_revision=$3 AND policy=$4 AND (input::jsonb->>'catalogRevision'=$5 OR state IN('QUEUED','RUNNING','REQUESTED')) LIMIT 1`,row.id,input.sourceHash,input.identityRevision,VARIANT_POLICY,CODEX_ASSOCIATION_REVISION);
       if(existing)continue;
       count+=await tx.$executeRawUnsafe(`INSERT INTO ${table}(key,card_id,actor_id,access_version,policy,source_hash,identity_revision,identity_hash,input,input_hash,generation) VALUES($1,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9,$10,$11::uuid) ON CONFLICT DO NOTHING`,variantJobKey(input),row.id,row.owner_id,row.access_version,VARIANT_POLICY,input.sourceHash,input.identityRevision,input.identityHash,value,digest(value),input.generation??'00000000-0000-0000-0000-000000000000');}return count;});},
    async priorCatalog(job){if(!job.input.reuseJobKey)return null;return machine(async({tx})=>{const [row]=await tx.$queryRawUnsafe(`SELECT * FROM ${table} WHERE key=$1 AND card_id=$2::uuid AND source_hash=$3`,job.input.reuseJobKey,job.card_id,job.source_hash);return unpack(row)?.catalog??null;});},
    async read(staff,cardId){uuid(cardId);const savedRead=await boundary.transaction(staff,async({tx,principal})=>{const card=await authorized(tx,principal,cardId);const b=variantBinding(card);const [row]=await tx.$queryRawUnsafe(`SELECT * FROM ${table} WHERE card_id=$1::uuid AND source_hash=$2 AND identity_revision=$3 AND identity_hash=$4 ORDER BY created_at DESC,key DESC LIMIT 1`,cardId,b.sourceHash,b.identityRevision,b.identityHash);const saved=await confirmation(tx,card);let latest=row;if(!latest&&saved?.job_key){[latest]=await tx.$queryRawUnsafe(`SELECT * FROM ${table} WHERE key=$1 AND card_id=$2::uuid AND source_hash=$3`,saved.job_key,cardId,b.sourceHash);}
      const [approved]=await tx.$queryRawUnsafe('SELECT 1 FROM atlas_manual.approval WHERE card_id=$1::uuid AND source_hash=$2 LIMIT 1',cardId,card.contentHash);
      let approvalReady=Boolean(approved),reason=null;try{if(!approved)await approvalCheck(tx,card);approvalReady=true;}catch(e){if(e.code!=='VARIANT_CONFIRMATION_REQUIRED')throw e;reason=e.code;}
      return {card,job:unpack(latest),confirmation:saved,approvalReady,reason,legacyApproved:Boolean(approved)};});
      return savedRead;},
    async refresh(staff,cardId,input){object(input,['requestId','sourceHash','identityRevision','identityHash','jobId']);uuid(input.requestId);requireThat(input.jobId===null||/^[a-f0-9]{64}$/.test(input.jobId),400,'VARIANT_REFRESH_INVALID');return boundary.transaction(staff,async({tx,principal})=>{
      await preparationLock(tx,cardId);
      await tx.$queryRawUnsafe('SELECT id FROM atlas_manual.card WHERE id=$1::uuid FOR UPDATE',cardId);
      const card=await authorized(tx,principal,cardId,true),b=variantBinding(card);
      // Exact saved generations remain acknowledgeable after another session
      // advances the current identity or refresh. Authorization stays current.
      const [historic]=await tx.$queryRawUnsafe(`SELECT * FROM ${table} WHERE card_id=$1::uuid AND generation=$2::uuid`,cardId,input.requestId);
      if(historic){const saved=unpack(historic);requireThat(saved.input.sourceHash===input.sourceHash&&saved.input.identityRevision===input.identityRevision&&saved.input.identityHash===input.identityHash&&saved.input.reuseJobKey===input.jobId,409,'VARIANT_REFRESH_CONFLICT');return saved.key;}
      requireThat(b.sourceHash===input.sourceHash,409,'VARIANT_SOURCE_STALE');requireThat(b.identityRevision===input.identityRevision&&b.identityHash===input.identityHash,409,'VARIANT_IDENTITY_STALE');
      const nextInput={...b,catalogRevision:CODEX_ASSOCIATION_REVISION,identity:variantCatalogIdentity('playerName'in card.draft.identity?'SPORTS':'POKEMON',card.draft.identity),generation:input.requestId,reuseJobKey:input.jobId},key=variantJobKey(nextInput);
      const [existing]=await tx.$queryRawUnsafe(`SELECT * FROM ${table} WHERE key=$1`,key);
      if(existing){requireThat(canonical(unpack(existing).input)===canonical(nextInput),409,'VARIANT_REFRESH_CONFLICT');return key;}
      let [latest]=await tx.$queryRawUnsafe(`SELECT * FROM ${table} WHERE card_id=$1::uuid AND source_hash=$2 AND identity_revision=$3 AND identity_hash=$4 ORDER BY created_at DESC,key DESC LIMIT 1`,cardId,b.sourceHash,b.identityRevision,b.identityHash);
      if(!latest){const saved=await confirmation(tx,card);if(saved?.job_key)[latest]=await tx.$queryRawUnsafe(`SELECT * FROM ${table} WHERE key=$1 AND card_id=$2::uuid AND source_hash=$3`,saved.job_key,cardId,b.sourceHash);}
      requireThat(input.jobId===null?!latest:latest?.key===input.jobId&&variantRefreshable(latest),409,'VARIANT_REFRESH_UNAVAILABLE');
      const [owner]=await tx.$queryRawUnsafe('SELECT owner_id,atlas_manual_connected.display_owner_version(owner_id) access_version FROM atlas_manual.card WHERE id=$1::uuid',cardId);requireThat(owner?.access_version,409,'VARIANT_SOURCE_STALE');
      const value=canonical(nextInput);await tx.$executeRawUnsafe(`INSERT INTO ${table}(key,card_id,actor_id,access_version,policy,generation,source_hash,identity_revision,identity_hash,input,input_hash) VALUES($1,$2::uuid,$3::uuid,$4,$5,$6::uuid,$7,$8,$9,$10,$11)`,key,cardId,owner.owner_id,owner.access_version,VARIANT_POLICY,input.requestId,b.sourceHash,b.identityRevision,b.identityHash,value,digest(value));return key;
    });},
    async reusableResult(job,snapshot){if(!job.input.reuseJobKey||job.input.localOnly)return null;return machine(async({tx})=>{const [row]=await tx.$queryRawUnsafe(`SELECT source.* FROM ${table} source JOIN ${table} j ON j.key=$1 WHERE source.key=$2 AND source.card_id=j.card_id AND source.source_hash=j.source_hash AND source.identity_revision=j.identity_revision AND source.identity_hash=j.identity_hash AND source.state='READY' AND source.catalog_hash=$3 AND ${current}`,job.key,job.input.reuseJobKey,snapshot.snapshotHash);const prior=unpack(row);return prior?.result?.catalog?.snapshotHash===snapshot.snapshotHash?prior.result:null;});},
    async resolve(staff,card,action){return boundary.transaction(staff,async({tx,principal})=>{const actual=await authorized(tx,principal,card.cardId,true);requireThat(actual.contentHash===card.contentHash,409,'MANUAL_DRAFT_STALE');return checkAction(tx,card,action);});},
    async assertApproval(staff,card){return boundary.transaction(staff,async({tx,principal})=>{await authorized(tx,principal,card.cardId);return approvalCheck(tx,card);});},
    async validateCommit({tx,principal,cardId,input,draft}){if(input.action.type==='APPROVE_REPORT'){await approvalCheck(tx,{cardId,draft});return;}if(input.action.type!=='VARIANT_CONFIRM')return;
      const card=await authorized(tx,principal,cardId,true),{job,identity}=await checkAction(tx,card,input.action),changed=variantIdentityHash(identity)!==variantIdentityHash(card.draft.identity),revision=card.draft.identityRevision+(changed?1:0);
      requireThat(variantIdentityHash(draft.identity)===variantIdentityHash(identity)&&draft.identityRevision===revision,409,'VARIANT_IDENTITY_STALE');
      await tx.$executeRawUnsafe(`INSERT INTO atlas_manual_connected.variant_confirmation(card_id,action_id,actor_id,source_hash,identity_revision,identity_hash,job_key,result_hash,catalog_hash,candidate_id,decision,reprocess_required) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9,$10,$11,false)`,cardId,input.actionId,principal.id,input.action.sourceHash,revision,variantIdentityHash(identity),job?.key??null,input.action.resultHash,job?.catalog_hash??null,input.action.candidateId,input.action.decision);
      if(['SELECTED','MANUAL'].includes(input.action.decision)){const candidate=job?.catalog?.candidates.find(c=>c.candidateId===input.action.candidateId);const observedAt=new Date().toISOString(),payload={decision:input.action.decision,cardId,actionId:input.actionId,sourceHash:input.action.sourceHash,identityRevision:revision,identityHash:variantIdentityHash(identity),identity:{...variantCatalogIdentity('playerName'in identity?'SPORTS':'POKEMON',identity),language:candidate?.identity.language??null},parallel:identity.parallel,catalog:job?.catalog??null,candidateId:input.action.candidateId,observedAt,referencePermission:input.action.referencePermission??null},text=canonical(payload,{maxBytes:2097152});
        await tx.$executeRawUnsafe(`INSERT INTO atlas_manual_connected.variant_contribution(action_id,card_id,actor_id,access_version,payload,payload_hash) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6)`,input.actionId,cardId,principal.id,principal.accessVersion,text,digest(text));}
    },
    async codexReadings(job){return machine(async({tx})=>{
      const [live]=await tx.$queryRawUnsafe(`SELECT j.* FROM ${table} j WHERE ${active}`,job.key,job.claim_id);
      requireThat(live,409,'VARIANT_LEASE_LOST');const catalog=unpack(live).catalog,request=prepareVariantLabelRequest(catalog),readings=new Map();
      await retainPhotoPool(tx,catalog);
      for(const candidate of catalog.candidates)for(const choice of variantCodexAliases(candidate)){
        const [row]=await tx.$queryRawUnsafe('SELECT snapshot,snapshot_hash FROM atlas_manual_connected.variant_catalog_cache WHERE key=$1 ORDER BY created_at DESC LIMIT 1',codexLibraryKey(choice));
        if(row){requireThat(digest(row.snapshot)===row.snapshot_hash,503,'VARIANT_CACHE_CORRUPT');const library=validateCodexLibrary(JSON.parse(row.snapshot),choice);
          for(const ref of library.references)if(request.photos.some(p=>p.sha256===ref.image.sha256))readings.set(ref.image.sha256,projectCodexReading(ref.reading,catalog,[library.choice]));}
      }
      for(const photo of request.photos)if(!readings.has(photo.sha256)){
        const saved=await listingRead(tx,codexReadingKey(request,photo.sha256));
        if(saved){requireThat(saved.schemaVersion==='atlas-codex-reading/v1'&&saved.policy===VARIANT_LABEL_POLICY&&saved.reading.sha256===photo.sha256
          &&Array.isArray(saved.choices)&&(saved.reading.candidateKey===null||saved.choices.some(c=>c.key===saved.reading.candidateKey)),503,'VARIANT_CODEX_READING_INVALID');readings.set(photo.sha256,projectCodexReading(saved.reading,catalog,saved.choices,saved.catalogContext??[]));}
      }
      return validateVariantReferenceLabels({version:'atlas-slab-label-associations/v1',associationRevision:CODEX_ASSOCIATION_REVISION,catalogHash:catalog.snapshotHash,readings:[...readings.values()]},catalog);
    });},
    async publishLabelSource(job,request){return machine(async({tx})=>{
      const [live]=await tx.$queryRawUnsafe(`SELECT j.* FROM ${table} j WHERE ${active}`,job.key,job.claim_id);requireThat(live,409,'VARIANT_LEASE_LOST');
      const retained=await listingRead(tx,labelResponseKey(request.requestKey));requireThat(retained,503,'VARIANT_RESPONSE_NOT_SAVED');
      const {schemaVersion,reservationHash,...response}=retained;
      const reservation=await listingRead(tx,labelDispatchKey(request.requestKey));
      requireThat(schemaVersion==='variant-label-response/v1'&&reservationHash===digest(canonical(reservation))&&canonical(response.requestEvidence)===canonical(reservation.evidence)
        &&canonical(request)===canonical(reservation.request),503,'VARIANT_LABEL_JOURNAL_CONFLICT');
      const catalog=validateVariantReviewSnapshot(reservation.catalog);
      const labels=projectVariantLabelResponse(response,catalog),literal=readVariantLabelResponse(response,catalog),choices=codexChoices(catalog);
      for(const key of labels.readings.map(r=>codexReadingKey(request,r.sha256)).sort())await listingLock(tx,key);
      for(const key of [...new Set(labels.readings.filter(r=>r.canonicalPrintingKey).map(r=>codexLibraryKey(choices.find(c=>c.key===r.canonicalPrintingKey))))].sort())await listingLock(tx,key);
      const libraries=new Map();
      for(const r of labels.readings){
        const reading={sha256:r.sha256,candidateKey:r.canonicalPrintingKey,gradingCompany:r.gradingCompany,labelText:r.labelText,reason:r.reason,evidenceKind:r.evidenceKind};
        const record={schemaVersion:'atlas-codex-reading/v1',policy:VARIANT_LABEL_POLICY,choices:literal.request.choices,reading:literal.readings.find(v=>v.sha256===r.sha256),responseHash:digest(response.bodyText),requestKey:request.requestKey,
          ...(request.catalogContext ? {catalogContext:request.catalogContext} : {})};
        const key=codexReadingKey(request,r.sha256);await listingLock(tx,key);
        const existing=await listingRead(tx,key);if(existing)requireThat(canonical(existing)===canonical(record),409,'VARIANT_CODEX_READING_CONFLICT');else await listingWrite(tx,key,canonical(record));
        if(!reading.candidateKey)continue;
        const choice=choices.find(c=>c.key===reading.candidateKey),libraryKey=codexLibraryKey(choice);await listingLock(tx,libraryKey);
        if(!libraries.has(libraryKey)){
          const [prior]=await tx.$queryRawUnsafe('SELECT snapshot,snapshot_hash FROM atlas_manual_connected.variant_catalog_cache WHERE key=$1 ORDER BY created_at DESC LIMIT 1',libraryKey);
          const references=[];
          if(prior){requireThat(digest(prior.snapshot)===prior.snapshot_hash,503,'VARIANT_CACHE_CORRUPT');references.push(...validateCodexLibrary(JSON.parse(prior.snapshot),choice).references);}
          libraries.set(libraryKey,{choice,references,changed:false});
        }
        const library=libraries.get(libraryKey);
        if(library.references.some(v=>v.image.sha256===r.sha256))continue;
        library.references.push({image:catalog.referencePhotos.find(i=>i.sha256===r.sha256),reading,responseHash:record.responseHash,requestKey:request.requestKey});library.changed=true;
      }
      for(const [key,{choice,references,changed}] of libraries)if(changed)
        await listingWrite(tx,key,canonical({schemaVersion:'atlas-codex-library/v1',policy:VARIANT_LABEL_POLICY,choice,references},{maxBytes:8388608}));
      return labels;
    });},
    async labelSource(job,request,evidence=null){return machine(async({tx})=>{
      await listingLock(tx,request.requestKey);
      const [live]=await tx.$queryRawUnsafe(`SELECT j.* FROM ${table} j WHERE ${active} FOR UPDATE`,job.key,job.claim_id);
      requireThat(live,409,'VARIANT_LEASE_LOST');const catalog=unpack(live).catalog;
      requireThat(catalog&&canonical(prepareVariantLabelRequest(catalog,request.photos.map(p=>p.sha256)))===canonical(request)&&request.photos.length>0&&request.photos.length<=8,409,'VARIANT_LABEL_REQUEST_CHANGED');
      // Image-level locks serialize overlapping batches, not just identical batches.
      for(const photo of request.photos)await listingLock(tx,codexReadingKey(request,photo.sha256));
      const reservation=await listingRead(tx,labelDispatchKey(request.requestKey)),saved=await listingRead(tx,labelResponseKey(request.requestKey));
      requireThat(!saved||reservation,503,'VARIANT_LABEL_JOURNAL_CONFLICT');
      if(reservation){
        requireThat(reservation.schemaVersion==='variant-label-dispatch/v1'&&canonical(reservation.request)===canonical(request),503,'VARIANT_LABEL_JOURNAL_CONFLICT');
        if(saved){
          const {schemaVersion,reservationHash,...response}=saved;
          requireThat(schemaVersion==='variant-label-response/v1'&&reservationHash===digest(canonical(reservation))
            &&canonical(response.requestEvidence)===canonical(reservation.evidence),503,'VARIANT_LABEL_JOURNAL_CONFLICT');
          return {state:'REUSED',response};
        }
        const [owner]=await tx.$queryRawUnsafe(`SELECT key FROM ${table} WHERE key=$1 AND claim_id=$2::uuid AND state IN('RUNNING','REQUESTED') AND lease_until>clock_timestamp()`,reservation.jobKey,reservation.claimId);
        return {state:owner?'PENDING':'UNKNOWN'};
      }
      for(const photo of request.photos){
        if(await listingRead(tx,codexReadingKey(request,photo.sha256)))return {state:'PENDING'};
        const previous=await listingRead(tx,codexImageReservationKey(request,photo.sha256));
        if(previous){
          const owner=await listingRead(tx,labelDispatchKey(previous.requestKey));
          requireThat(owner,503,'VARIANT_LABEL_JOURNAL_CONFLICT');
          if(await listingRead(tx,labelResponseKey(previous.requestKey)))return {state:'RECOVER',request:owner.request};
          const [running]=await tx.$queryRawUnsafe(`SELECT key FROM ${table} WHERE key=$1 AND claim_id=$2::uuid AND state IN('RUNNING','REQUESTED') AND lease_until>clock_timestamp()`,owner.jobKey,owner.claimId);
          return {state:running?'PENDING':'UNKNOWN'};
        }
      }
      if(!evidence)return {state:'MISSING'};
      requireThat(evidence.policy===VARIANT_LABEL_POLICY&&evidence.model===VARIANT_PHOTO_MODEL
        &&/^[a-f0-9]{64}$/.test(evidence.requestSha256)&&canonical(evidence.request)===canonical(request),400,'VARIANT_LABEL_REQUEST_CHANGED');
      requireThat(live.state==='RUNNING'&&!live.dispatch_id&&!live.response,409,'VARIANT_PROVIDER_OUTCOME_UNKNOWN');
      const batchCatalog={...catalog,referencePhotos:catalog.referencePhotos.filter(p=>request.photos.some(i=>i.sha256===p.sha256))};
      batchCatalog.snapshotHash=variantSnapshotHash(batchCatalog);validateVariantReviewSnapshot(batchCatalog);
      const created={schemaVersion:'variant-label-dispatch/v1',request,evidence,catalog:batchCatalog,jobKey:job.key,claimId:job.claim_id,reservedAt:new Date().toISOString()};
      await listingWrite(tx,labelDispatchKey(request.requestKey),canonical(created));
      for(const photo of request.photos)await listingWrite(tx,codexImageReservationKey(request,photo.sha256),canonical({schemaVersion:'atlas-codex-reservation/v1',requestKey:request.requestKey}));
      // This journal owns each paid label batch, just as the listing journal
      // owns multiple searches. Preserve the legacy one-photo-call columns.
      return {state:'RESERVED',reservation:created};
    });},
    async saveLabelSource(reservation,response){
      requireThat(response?.version===VARIANT_LABEL_POLICY&&canonical(response.requestEvidence)===canonical(reservation.evidence),400,'VARIANT_LABEL_RESPONSE_CHANGED');
      const value=evidenceText({...response,schemaVersion:'variant-label-response/v1',reservationHash:digest(canonical(reservation))},'bodyText',1048576);
      return machine(async({tx})=>{
        const key=reservation.request.requestKey;await listingLock(tx,key);
        requireThat(canonical(await listingRead(tx,labelDispatchKey(key)))===canonical(reservation),409,'VARIANT_LABEL_RESERVATION_CHANGED');
        const existing=await listingRead(tx,labelResponseKey(key));
        if(existing){requireThat(evidenceText(existing,'bodyText',1048576)===value,409,'VARIANT_LABEL_RESPONSE_CONFLICT');return true;}
        await listingWrite(tx,labelResponseKey(key),value);return true;
      });
    },
    async reserveListingSource(job,request,{retainedOnly=false}={}){
      // Only immutable local manufacturer evidence may fill a missing year
      // for a reference request. Never trust a supplied catalog or request year.
      const discovered=job.input.identity.year?null:await checklist.prepare(job.input.identity);
      const resolvedIdentity=discovered?variantChecklistListingIdentity(job.input.identity,discovered.candidates,request.identity?.year):job.input.identity;
      requireThat(compareVariantCardNumber(resolvedIdentity.cardNumber,request.identity?.cardNumber)==='match',409,'VARIANT_LISTING_REQUEST_CHANGED');
      const listingIdentity={...resolvedIdentity,cardNumber:request.identity.cardNumber};
      const identityEvidence=discovered?discovered.candidates.filter(c=>c.identity.year===listingIdentity.year
        &&canonical(request)===canonical(prepareVariantListingRequest(listingIdentity,{name:c.label,language:c.identity.language},{...(request.generation?{generation:request.generation}:{})})))
        .map(c=>({candidateId:c.candidateId,source:c.source})):null;
      requireThat(!identityEvidence||identityEvidence.length>0,409,'VARIANT_LISTING_REQUEST_CHANGED');
      requireThat(typeof retainedOnly==='boolean'&&request.revision===VARIANT_LISTING_REVISION&&(!request.generation||job.input.reuseJobKey!==null&&request.generation===job.input.generation)&&canonical(request)===canonical(prepareVariantListingRequest(listingIdentity,request.printing??null,{...(request.generation?{generation:request.generation}:{})})),409,'VARIANT_LISTING_REQUEST_CHANGED');return machine(async({tx})=>{
      await listingLock(tx,request.requestKey);
      const [live]=await tx.$queryRawUnsafe(`SELECT j.* FROM ${table} j WHERE ${active} AND j.state='RUNNING' FOR UPDATE`,job.key,job.claim_id);
      requireThat(live,409,'VARIANT_LEASE_LOST');
      requireThat(canonical(unpack(live).input.identity)===canonical(job.input.identity)&&(!request.generation||unpack(live).input.reuseJobKey!==null&&request.generation===unpack(live).input.generation),409,'VARIANT_LISTING_REQUEST_CHANGED');
      const retained=await listingRead(tx,listingDispatchKey(request.requestKey)),response=await listingRead(tx,listingResponseKey(request.requestKey));
      requireThat(!response||retained,503,'VARIANT_LISTING_JOURNAL_CONFLICT');
      if(retained){requireThat(retained.schemaVersion==='variant-listing-dispatch/v1'&&canonical(retained.request)===canonical(request),503,'VARIANT_LISTING_JOURNAL_CONFLICT');
        const source=response?listingResponse(response,retained):null;
        if(!retainedOnly)await tx.$executeRawUnsafe(`UPDATE ${table} j SET audit=audit||jsonb_build_array(jsonb_build_object('event',$3::text,'requestKey',$4::text,'dispatchId',$5::text)),updated_at=clock_timestamp() WHERE ${active}`,job.key,job.claim_id,source?'LISTING_REUSE':'LISTING_UNKNOWN',request.requestKey,retained.dispatchId);
        return source?{state:'REUSED',source}:{state:'UNKNOWN',code:'LISTING_SOURCE_OUTCOME_UNKNOWN'};}
      if(retainedOnly)return {state:'MISSING'};
      const reservation={schemaVersion:'variant-listing-dispatch/v1',request,dispatchId:randomUUID(),jobKey:job.key,claimId:job.claim_id,reservedAt:new Date().toISOString(),...(identityEvidence?{identityEvidence}:{})};
      await listingWrite(tx,listingDispatchKey(request.requestKey),canonical(reservation));
      requireThat(await tx.$executeRawUnsafe(`UPDATE ${table} j SET audit=audit||jsonb_build_array(jsonb_build_object('event','LISTING_DISPATCH','requestKey',$3::text,'dispatchId',$4::text)),updated_at=clock_timestamp() WHERE ${active}`,job.key,job.claim_id,request.requestKey,reservation.dispatchId)===1,409,'VARIANT_LEASE_LOST');
      return {state:'RESERVED',reservation};});},
    async saveListingSource(reservation,source){object(source,['schemaVersion','requestKey','url','httpStatus','contentType','bodyText','sha256','capturedAt']);
      requireThat(source.schemaVersion==='variant-listing-response/v1'&&source.requestKey===reservation.request.requestKey&&source.url===reservation.request.url&&Number.isInteger(source.httpStatus)&&source.httpStatus>=100&&source.httpStatus<=599&&typeof source.contentType==='string'&&source.contentType.length<=200&&typeof source.bodyText==='string'&&digest(source.bodyText)===source.sha256&&typeof source.capturedAt==='string'&&Number.isFinite(Date.parse(source.capturedAt)),400,'VARIANT_LISTING_SOURCE_INVALID');
      const value=evidenceText({...source,schemaVersion:'variant-listing-source-journal/v1',sourceSchemaVersion:source.schemaVersion,dispatchId:reservation.dispatchId,reservationHash:digest(canonical(reservation))},'bodyText',1048576);
      return machine(async({tx})=>{await listingLock(tx,source.requestKey);const retained=await listingRead(tx,listingDispatchKey(source.requestKey));
        requireThat(retained&&canonical(retained)===canonical(reservation),409,'VARIANT_LISTING_RESERVATION_CHANGED');
        const existing=await listingRead(tx,listingResponseKey(source.requestKey));if(existing){requireThat(evidenceText(existing,'bodyText',1048576)===value,409,'VARIANT_LISTING_RESPONSE_CONFLICT');return true;}
        // Evidence may arrive after a lease/source change. Retain it for replay,
        // but the worker's separate current-binding fence still gates a result.
        await listingWrite(tx,listingResponseKey(source.requestKey),value);
        await tx.$executeRawUnsafe(`UPDATE ${table} SET audit=audit||jsonb_build_array(jsonb_build_object('event','LISTING_RESPONSE','requestKey',$2::text,'dispatchId',$3::text,'hash',$4::text)),updated_at=clock_timestamp() WHERE key=$1`,reservation.jobKey,source.requestKey,reservation.dispatchId,source.sha256);return true;});},
    async claim(concurrency=1){requireThat(Number.isInteger(concurrency)&&concurrency>=1&&concurrency<=4,500,'VARIANT_CONFIG_INVALID');return machine(async({tx})=>{
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(721930,77)');
      await tx.$executeRawUnsafe(`UPDATE ${table} j SET state='STALE',claim_id=NULL,lease_until=NULL,code='VARIANT_SOURCE_STALE',updated_at=clock_timestamp() WHERE state IN('QUEUED','RUNNING','REQUESTED') AND (lease_until IS NULL OR lease_until<=clock_timestamp()) AND NOT(${current})`);
      await tx.$executeRawUnsafe(`UPDATE ${table} SET state='UNKNOWN',claim_id=NULL,lease_until=NULL,code='VARIANT_PROVIDER_OUTCOME_UNKNOWN',updated_at=clock_timestamp() WHERE state='REQUESTED' AND lease_until<=clock_timestamp() AND response IS NULL`);
      await tx.$executeRawUnsafe(`UPDATE ${table} SET state='FAILED',claim_id=NULL,lease_until=NULL,code=CASE WHEN response IS NULL THEN 'VARIANT_PREPARATION_EXHAUSTED' ELSE 'VARIANT_PROJECTION_EXHAUSTED' END,updated_at=clock_timestamp() WHERE attempts>=6 AND coalesce(code,'') NOT IN('VARIANT_GRADING_PRIORITY_DEFERRED','VARIANT_LABEL_PENDING') AND state IN('QUEUED','RUNNING','REQUESTED','UNKNOWN') AND (lease_until IS NULL OR lease_until<=clock_timestamp()) AND (dispatch_id IS NULL OR response IS NOT NULL)`);
      const [n]=await tx.$queryRawUnsafe(`SELECT count(*)::int n FROM ${table} WHERE state IN('RUNNING','REQUESTED') AND lease_until>clock_timestamp()`);if(n.n>=concurrency)return null;
      const [row]=await tx.$queryRawUnsafe(`SELECT j.* FROM ${table} j WHERE ${current} AND (attempts<6 OR code IN('VARIANT_GRADING_PRIORITY_DEFERRED','VARIANT_LABEL_PENDING')) AND ((state='QUEUED' AND available_at<=clock_timestamp()) OR (state IN('RUNNING','REQUESTED') AND lease_until<=clock_timestamp()) OR (state='UNKNOWN' AND response IS NOT NULL)) ORDER BY available_at,created_at,key LIMIT 1 FOR UPDATE SKIP LOCKED`);if(!row)return null;
      const claim=randomUUID();const [next]=await tx.$queryRawUnsafe(`UPDATE ${table} SET state='RUNNING',claim_id=$2::uuid,lease_until=clock_timestamp()+($3*interval '1 millisecond'),attempts=attempts+CASE WHEN code IN('VARIANT_GRADING_PRIORITY_DEFERRED','VARIANT_LABEL_PENDING') THEN 0 ELSE 1 END,code=NULL,updated_at=clock_timestamp() WHERE key=$1 RETURNING *`,row.key,claim,leaseMs);return unpack(next);});},
    defer:(job,code='VARIANT_GRADING_PRIORITY_DEFERRED')=>{requireThat(['VARIANT_GRADING_PRIORITY_DEFERRED','VARIANT_LABEL_PENDING'].includes(code),500,'VARIANT_CONFIG_INVALID');return machine(async({tx})=>(await tx.$executeRawUnsafe(`UPDATE ${table} j SET state='QUEUED',claim_id=NULL,lease_until=NULL,code=$3,available_at=clock_timestamp()+interval '5 seconds',updated_at=clock_timestamp() WHERE ${active} AND state='RUNNING' AND dispatch_id IS NULL AND response IS NULL`,job.key,job.claim_id,code))===1);},
    renew:job=>machine(async({tx})=>(await tx.$executeRawUnsafe(`UPDATE ${table} j SET lease_until=clock_timestamp()+($3*interval '1 millisecond'),updated_at=clock_timestamp() WHERE ${active}`,job.key,job.claim_id,leaseMs))===1),
    saveCatalog:(job,catalog)=>machine(async({tx})=>{validateVariantReviewSnapshot(catalog);const value=canonical(catalog,{maxBytes:1048576});const saved=(await tx.$executeRawUnsafe(`UPDATE ${table} j SET catalog=$3,catalog_hash=$4,updated_at=clock_timestamp() WHERE ${active} AND catalog IS NULL`,job.key,job.claim_id,value,catalog.snapshotHash))===1;if(saved)await retainPhotoPool(tx,catalog);return saved;}),
    finish:(job,outcome)=>machine(async({tx})=>{const result=outcome.result?canonical(outcome.result,{maxBytes:2097152}):null;const state=result?'READY':outcome.state==='RETRY'?(job.attempts<6?'QUEUED':'FAILED'):outcome.state;requireThat(['READY','QUEUED','FAILED','UNKNOWN','STALE'].includes(state),500,'VARIANT_OUTCOME_INVALID');return(await tx.$executeRawUnsafe(`UPDATE ${table} j SET state=$3,claim_id=NULL,lease_until=NULL,result=$4,result_hash=$5,code=$6,available_at=clock_timestamp()+interval '30 seconds',updated_at=clock_timestamp() WHERE ${active}`,job.key,job.claim_id,state,result,result?digest(result):null,outcome.code??null))===1;}),
    async claimContribution(){return machine(async({tx})=>{await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(721930,78)');await tx.$executeRawUnsafe("UPDATE atlas_manual_connected.variant_contribution SET state='FAILED',claim_id=NULL,lease_until=NULL,code=CASE WHEN attempts>=6 THEN 'VARIANT_CONTRIBUTION_EXHAUSTED' ELSE 'VARIANT_CONTRIBUTION_ACCESS_REVOKED' END WHERE state IN('QUEUED','RUNNING') AND (lease_until IS NULL OR lease_until<=clock_timestamp()) AND (attempts>=6 OR NOT atlas_manual_connected.display_owner_current(actor_id,access_version))");const [busy]=await tx.$queryRawUnsafe("SELECT 1 FROM atlas_manual_connected.variant_contribution WHERE state='RUNNING' AND lease_until>clock_timestamp() LIMIT 1");if(busy)return null;const [row]=await tx.$queryRawUnsafe(`SELECT * FROM atlas_manual_connected.variant_contribution WHERE attempts<6 AND ((state='QUEUED' AND available_at<=clock_timestamp()) OR (state='RUNNING' AND lease_until<=clock_timestamp())) AND atlas_manual_connected.display_owner_current(actor_id,access_version) ORDER BY created_at,action_id LIMIT 1 FOR UPDATE SKIP LOCKED`);if(!row)return null;const [claimed]=await tx.$queryRawUnsafe("UPDATE atlas_manual_connected.variant_contribution SET state='RUNNING',claim_id=$2::uuid,lease_until=clock_timestamp()+interval '60 seconds',attempts=attempts+1 WHERE action_id=$1::uuid RETURNING *",row.action_id,randomUUID());requireThat(digest(claimed.payload)===claimed.payload_hash&&(!claimed.reference_packet||digest(claimed.reference_packet)===claimed.reference_packet_hash),503,'VARIANT_CONTRIBUTION_CORRUPT');const job={...claimed,payload:JSON.parse(claimed.payload),referencePacket:claimed.reference_packet?JSON.parse(claimed.reference_packet):null};if(job.referencePacket)validateVariantContributionPacket(job,job.referencePacket);return job;});},
    async saveContributionPacket(job,packet){validateVariantContributionPacket(job,packet);const value=canonical(packet,{maxBytes:16384});return machine(async({tx})=>(await tx.$executeRawUnsafe(`UPDATE atlas_manual_connected.variant_contribution SET reference_packet=$3,reference_packet_hash=$4 WHERE action_id=$1::uuid AND claim_id=$2::uuid AND state='RUNNING' AND lease_until>clock_timestamp() AND payload_hash=$5 AND atlas_manual_connected.display_owner_current(actor_id,access_version) AND jsonb_typeof(payload::jsonb->'referencePermission')='object' AND (reference_packet IS NULL OR reference_packet=$3 AND reference_packet_hash=$4)`,job.action_id,job.claim_id,value,digest(value),job.payload_hash))===1);},
    async finishContribution(job,{receipt=null,code=null}){return machine(async({tx})=>{const value=receipt?canonical(receipt):null;return(await tx.$executeRawUnsafe(`UPDATE atlas_manual_connected.variant_contribution SET state=$3,claim_id=NULL,lease_until=NULL,receipt=$4,receipt_hash=$5,code=$6,available_at=clock_timestamp()+interval '60 seconds' WHERE action_id=$1::uuid AND claim_id=$2::uuid AND state='RUNNING' AND lease_until>clock_timestamp()`,job.action_id,job.claim_id,receipt?'READY':job.attempts>=6?'FAILED':'QUEUED',value,value?digest(value):null,code))===1;});},
    cache:{
      get:key=>machine(async({tx})=>{const [row]=await tx.$queryRawUnsafe('SELECT snapshot,snapshot_hash FROM atlas_manual_connected.variant_catalog_cache WHERE key=$1 AND expires_at>clock_timestamp() ORDER BY created_at DESC LIMIT 1',key);if(!row)return null;requireThat(digest(row.snapshot)===row.snapshot_hash,503,'VARIANT_CACHE_CORRUPT');return JSON.parse(row.snapshot);}),
      getRetained:(key,sha256=null)=>machine(async({tx})=>{const [row]=await tx.$queryRawUnsafe("SELECT snapshot,snapshot_hash FROM atlas_manual_connected.variant_catalog_cache WHERE key=$1 AND ($2::text IS NULL OR snapshot::jsonb->>'sha256'=$2) ORDER BY created_at DESC LIMIT 1",key,sha256);if(!row)return null;requireThat(digest(row.snapshot)===row.snapshot_hash,503,'VARIANT_CACHE_CORRUPT');return JSON.parse(row.snapshot);}),
      put:(key,snapshot)=>machine(async({tx})=>{requireThat(!listingJournalKey(key),400,'VARIANT_LISTING_JOURNAL_RESERVED');const image=snapshot?.schemaVersion==='variant-provider-image/v1',value=evidenceText(snapshot,'body',image?Math.ceil(4194304/3)*4:1048576);if(image){const bytes=Buffer.from(snapshot.body,'base64');requireThat(bytes.length>0&&bytes.length<=4194304&&bytes.toString('base64')===snapshot.body&&digest(bytes)===snapshot.sha256,400,'VARIANT_IMAGE_CACHE_INVALID');}await tx.$executeRawUnsafe(`INSERT INTO atlas_manual_connected.variant_catalog_cache(key,snapshot,snapshot_hash,expires_at) VALUES($1,$2,$3,$4::timestamptz) ON CONFLICT DO NOTHING`,key,value,digest(value),snapshot.expiresAt);})},

  });
}
export function variantJobGrantSQL(role,{worker=false}={}){requireThat(/^[a-z][a-z0-9_]{0,62}$/.test(role));return `GRANT USAGE ON SCHEMA atlas_manual_connected TO "${role}";
GRANT SELECT ON atlas_manual_connected.variant_job,atlas_manual_connected.variant_catalog_cache TO "${role}";
GRANT INSERT ON atlas_manual_connected.variant_catalog_cache TO "${role}";
GRANT INSERT ON atlas_manual_connected.variant_job TO "${role}";
GRANT EXECUTE ON FUNCTION atlas_manual_connected.display_owner_version(uuid) TO "${role}";
GRANT ${worker?'SELECT':'SELECT,INSERT'} ON atlas_manual_connected.variant_confirmation,atlas_manual_connected.variant_contribution TO "${role}";${worker?`\nGRANT UPDATE(state,attempts,claim_id,lease_until,dispatch_id,catalog,catalog_hash,response,response_hash,result,result_hash,code,available_at,updated_at,audit) ON atlas_manual_connected.variant_job TO "${role}";
GRANT UPDATE(state,attempts,claim_id,lease_until,receipt,receipt_hash,reference_packet,reference_packet_hash,code,available_at) ON atlas_manual_connected.variant_contribution TO "${role}";
GRANT EXECUTE ON FUNCTION atlas_manual_connected.display_owner_current(uuid,integer),atlas_manual_connected.display_owner_version(uuid) TO "${role}";`:''}`;}
