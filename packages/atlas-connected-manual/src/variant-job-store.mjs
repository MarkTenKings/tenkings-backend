import {variantSelectionParallel,validateVariantReviewSnapshot} from '@tenkings/card-catalog-evidence';
import {randomUUID} from 'node:crypto';
import {canonical,digest,object,requireThat,uuid} from '@atlas/manual-service/contract';
import {authorizeManualCard} from '@atlas/defect-memory/repository';
import {canonicalizeNewSpeedsterSessionIdentity} from '@atlas/grading-core/identity';

export const variantAnalysisActionId=actionId=>{const h=digest(`atlas-variant-recheck-v1:${actionId}`);return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;};
export const VARIANT_POLICY='atlas-visual-variant-v1';
const table='atlas_manual_connected.variant_job';
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
export const variantJobKey=input=>digest(canonical([VARIANT_POLICY,input.cardId,input.sourceHash,input.identityRevision,input.identityHash,input.generation??null]));
export const variantRefreshable=job=>Boolean(job&&(job.state==='READY'||['FAILED','STALE'].includes(job.state)&&!job.dispatch_id));
const unpack=row=>{
 if(!row)return null;
 requireThat(digest(row.input)===row.input_hash&&(!row.response||digest(row.response)===row.response_hash)&&(!row.result||digest(row.result)===row.result_hash),503,'VARIANT_STORED_CONTENT_INVALID');
 const input=JSON.parse(row.input),catalog=row.catalog?JSON.parse(row.catalog):null,result=row.result?JSON.parse(row.result):null;
 requireThat(input.cardId===row.card_id&&input.sourceHash===row.source_hash&&input.identityRevision===row.identity_revision&&input.identityHash===row.identity_hash&&variantJobKey(input)===row.key&&(input.generation??'00000000-0000-0000-0000-000000000000')===row.generation,503,'VARIANT_STORED_CONTENT_INVALID');
 if(catalog){validateVariantReviewSnapshot(catalog);requireThat(catalog.snapshotHash===row.catalog_hash,503,'VARIANT_STORED_CONTENT_INVALID');}
 if(result)requireThat(catalog&&canonical(result.catalog,{maxBytes:1048576})===canonical(catalog,{maxBytes:1048576}),503,'VARIANT_STORED_CONTENT_INVALID');
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
  return canonicalizeNewSpeedsterSessionIdentity(profile,profile==='SPORTS'
    ?{...old,playerName:i.name,year:i.year,manufacturer:i.manufacturer??old.manufacturer,productSet:i.setName,cardNumber:i.cardNumber,parallel:variantSelectionParallel(candidate)}
    :{...old,cardName:i.name,year:i.year,productSet:i.setName,cardNumber:i.cardNumber,parallel:variantSelectionParallel(candidate)});
}
export function validateVariantReferencePermission(permission){
  object(permission,['basis','detail','consumers']);
  requireThat(['owned_original','licensed','permission'].includes(permission.basis)&&typeof permission.detail==='string'
    &&permission.detail.trim()===permission.detail&&permission.detail.length>=1&&permission.detail.length<=1000&&!/[\x00-\x1f\x7f]/.test(permission.detail)
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
  object(action,['type','sourceHash','identityRevision','identityHash','jobId','resultHash','decision','candidateId','reviewed',...(action.decision==='MANUAL'?['manualParallel','observedFeatures']:[]),...(Object.hasOwn(action,'referencePermission')?['referencePermission']:[])]);
  requireThat(action.type==='VARIANT_CONFIRM'&&action.reviewed===true&&['SELECTED','MANUAL','UNRESOLVED'].includes(action.decision),400,'VARIANT_CONFIRMATION_INVALID');
  if(Object.hasOwn(action,'referencePermission')){requireThat(action.decision!=='UNRESOLVED',400,'VARIANT_REFERENCE_PERMISSION_INVALID');validateVariantReferencePermission(action.referencePermission);}
  requireThat(/^[a-f0-9]{64}$/.test(action.sourceHash)&&/^[a-f0-9]{64}$/.test(action.identityHash)&&Number.isSafeInteger(action.identityRevision)&&action.identityRevision>0,400,'VARIANT_CONFIRMATION_INVALID');
  if(action.decision==='MANUAL')requireThat(typeof action.manualParallel==='string'&&action.manualParallel.trim().length>0&&action.manualParallel.length<=120&&typeof action.observedFeatures==='string'&&action.observedFeatures.trim().length>0&&action.observedFeatures.length<=1000,400,'VARIANT_CONFIRMATION_INVALID');
  requireThat((action.jobId===null&&action.resultHash===null)||/^[a-f0-9]{64}$/.test(action.jobId)&&/^[a-f0-9]{64}$/.test(action.resultHash),400,'VARIANT_CONFIRMATION_INVALID');
  requireThat(action.decision==='SELECTED'?/^[a-f0-9]{64}$/.test(action.jobId)&&/^[a-f0-9]{64}$/.test(action.resultHash)&&typeof action.candidateId==='string'&&action.candidateId.length<=240:action.candidateId===null,400,'VARIANT_CONFIRMATION_INVALID');
}
export function createVariantJobStore({boundary,intakeRepository=null,leaseMs=180000,analysisCompatible=null}){
  requireThat(typeof boundary.machineTransaction==='function'&&Number.isInteger(leaseMs)&&leaseMs>=1000&&leaseMs<=300000,500,'VARIANT_CONFIG_INVALID');
  const machine=work=>boundary.machineTransaction(null,work);
  async function authorized(tx,principal,cardId,edit=false){const card=await authorizeManualCard(tx,principal,cardId,{edit});if(intakeRepository)await intakeRepository.assertActiveInTransaction(tx,cardId);return card;}
  async function recheck(tx,cardId,actionId){
    const [refused]=await tx.$queryRawUnsafe('SELECT analysis_id FROM atlas_defect_analysis.request_refusal WHERE card_id=$1::uuid AND action_id=$2::uuid',cardId,actionId);
    if(refused)return {state:'REFUSED',retryable:true,analysisId:refused.analysis_id,binding:null};
    const [run]=await tx.$queryRawUnsafe(`SELECT r.*,response.evidence response_evidence,outcome.evidence outcome_evidence,
      EXISTS(SELECT 1 FROM atlas_defect_analysis.provider_event p WHERE p.analysis_id=r.id AND p.kind='ACCEPTED') accepted,
      (SELECT p.evidence FROM atlas_defect_analysis.provider_event p WHERE p.analysis_id=r.id AND p.kind='ACCEPTED') acceptance_evidence
      FROM atlas_defect_analysis.run r LEFT JOIN atlas_defect_analysis.receipt response ON response.analysis_id=r.id AND response.kind='RESPONSE'
      LEFT JOIN atlas_defect_analysis.receipt outcome ON outcome.analysis_id=r.id AND outcome.kind='OUTCOME'
      WHERE r.card_id=$1::uuid AND r.action_id=$2::uuid`,cardId,actionId);
    if(!run)return {state:'QUEUED',retryable:false,analysisId:null,binding:null};
    const response=run.response_evidence?JSON.parse(run.response_evidence):null,outcome=run.outcome_evidence?JSON.parse(run.outcome_evidence):null,acceptance=run.acceptance_evidence?JSON.parse(run.acceptance_evidence):null;
    const state=response?.state??(acceptance?(Date.parse(acceptance.pollUntil)>Date.now()?'DISPATCHED':'UNKNOWN'):outcome?.state??(run.state==='DISPATCHED'&&Date.parse(run.expires_at)<=Date.now()?'UNKNOWN':run.state));
    requireThat(digest(run.binding)===run.binding_hash&&digest(run.request_evidence)===run.evidence_hash,503,'VARIANT_STORED_CONTENT_INVALID');
    return {state,retryable:state==='REFUSED'&&!run.accepted&&Boolean(response),analysisId:run.id,binding:JSON.parse(run.binding),
      run:{analysisId:run.id,cardId,actionId,requestHash:run.request_hash,binding:JSON.parse(run.binding),requestEvidence:JSON.parse(run.request_evidence),responseEvidenceHash:run.response_evidence?digest(run.response_evidence):null}};
  }
  async function confirmation(tx,card){const b=variantBinding(card);const [row]=await tx.$queryRawUnsafe(`SELECT * FROM atlas_manual_connected.variant_confirmation WHERE card_id=$1::uuid AND source_hash=$2 AND identity_revision=$3 AND identity_hash=$4 ORDER BY created_at DESC,action_id DESC LIMIT 1`,card.cardId,b.sourceHash,b.identityRevision,b.identityHash);if(row){const run=row.reprocess_required?await recheck(tx,card.cardId,row.analysis_action_id):{state:'NOT_REQUIRED',retryable:false,analysisId:null,binding:null};return {...row,recheck_state:run.state,recheck_retryable:run.retryable,recheck_analysis_id:run.analysisId,recheck_binding:run.binding,recheck_run:run.run??null};}return null;}
  // Hydration may read immutable artifacts. Keep it outside every database
  // transaction; the manual CAS and a compact evidence fence bind its result.
  async function compatibleConfirmation(card,row){
    if(!row||row.recheck_state!=='READY'||!analysisCompatible)return row;
    const compatible=await analysisCompatible({card,run:row.recheck_run});
    return {...row,recheck_compatible:compatible===true,recheck_retryable:compatible===false,
      recheck_reason:compatible===false?'VARIANT_ANALYSIS_STALE':null};
  }
  async function loadConfirmation(staff,card){
    const row=await boundary.transaction(staff,async({tx,principal})=>{await authorized(tx,principal,card.cardId);return confirmation(tx,card);});
    return compatibleConfirmation(card,row);
  }
  function recheckFence(card,row){return {version:'atlas-variant-recheck-fence-v1',cardId:card.cardId,contentHash:card.contentHash,
    analysisActionId:row.analysis_action_id,analysisId:row.recheck_analysis_id,requestHash:row.recheck_run.requestHash,
    responseEvidenceHash:row.recheck_run.responseEvidenceHash,compatible:false};}
  async function checkAction(tx,card,action){validateVariantAction(action);const b=variantBinding(card);
    requireThat(b.sourceHash===action.sourceHash,409,'VARIANT_SOURCE_STALE');requireThat(b.identityRevision===action.identityRevision&&b.identityHash===action.identityHash,409,'VARIANT_IDENTITY_STALE');
    let job=null;if(action.jobId!==null){const [row]=await tx.$queryRawUnsafe(`SELECT * FROM ${table} WHERE key=$1 AND card_id=$2::uuid`,action.jobId,card.cardId);job=unpack(row);
      requireThat(job?.state==='READY'&&job.result_hash===action.resultHash&&job.source_hash===b.sourceHash&&(job.identity_revision===b.identityRevision&&job.identity_hash===b.identityHash||(await confirmation(tx,card))?.job_key===job.key),409,'VARIANT_RESULT_STALE');}
    return {job,identity:variantSelectedIdentity(card,action,job?.result)};
  }
  async function approvalCheck(tx,card){const row=await confirmation(tx,card);requireThat(['SELECTED','MANUAL'].includes(row?.decision),409,'VARIANT_CONFIRMATION_REQUIRED');
    if(row.reprocess_required)requireThat(row.recheck_state==='READY'&&row.recheck_binding?.sourceHash===row.source_hash&&row.recheck_binding?.identityRevision===row.identity_revision,409,'VARIANT_REPROCESS_REQUIRED');return row;}
  return Object.freeze({
    async discover(limit=25){requireThat(Number.isInteger(limit)&&limit>=1&&limit<=100,500,'VARIANT_CONFIG_INVALID');return machine(async({tx})=>{
      const rows=await tx.$queryRawUnsafe(`SELECT c.id,c.owner_id,c.content,atlas_manual_connected.display_owner_version(c.owner_id) access_version FROM atlas_manual.card c
       WHERE atlas_manual_connected.display_owner_version(c.owner_id) IS NOT NULL AND EXISTS(SELECT 1 FROM atlas_manual_connected.identification i WHERE i.card_id=c.id AND i.state='COMPLETE' AND i.source_hash=c.content::jsonb->'source'->>'sourceHash')
       AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.card_id=c.id)
       AND NOT EXISTS(SELECT 1 FROM atlas_manual.approval a WHERE a.card_id=c.id AND a.source_hash=c.content_hash)
       AND NOT EXISTS(SELECT 1 FROM atlas_manual_connected.variant_confirmation v WHERE v.card_id=c.id AND v.source_hash=c.content::jsonb->'source'->>'sourceHash' AND v.identity_revision=(c.content::jsonb->>'identityRevision')::int AND v.decision IN('SELECTED','MANUAL'))
       AND NOT EXISTS(SELECT 1 FROM ${table} j WHERE j.card_id=c.id AND j.source_hash=c.content::jsonb->'source'->>'sourceHash' AND j.identity_revision=(c.content::jsonb->>'identityRevision')::int AND j.policy=$1)
       ORDER BY c.id LIMIT $2`,VARIANT_POLICY,limit);
      let count=0;for(const row of rows){const d=JSON.parse(row.content),input={...variantBinding({cardId:row.id,draft:d}),identity:variantCatalogIdentity('playerName'in d.identity?'SPORTS':'POKEMON',d.identity)};const value=canonical(input);
       count+=await tx.$executeRawUnsafe(`INSERT INTO ${table}(key,card_id,actor_id,access_version,policy,source_hash,identity_revision,identity_hash,input,input_hash) VALUES($1,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,variantJobKey(input),row.id,row.owner_id,row.access_version,VARIANT_POLICY,input.sourceHash,input.identityRevision,input.identityHash,value,digest(value));}return count;});},
    async read(staff,cardId){uuid(cardId);const savedRead=await boundary.transaction(staff,async({tx,principal})=>{const card=await authorized(tx,principal,cardId);const b=variantBinding(card);const [row]=await tx.$queryRawUnsafe(`SELECT * FROM ${table} WHERE card_id=$1::uuid AND source_hash=$2 AND identity_revision=$3 AND identity_hash=$4 ORDER BY created_at DESC,key DESC LIMIT 1`,cardId,b.sourceHash,b.identityRevision,b.identityHash);const saved=await confirmation(tx,card);let latest=row;if(!latest&&saved?.job_key){[latest]=await tx.$queryRawUnsafe(`SELECT * FROM ${table} WHERE key=$1 AND card_id=$2::uuid AND source_hash=$3`,saved.job_key,cardId,b.sourceHash);}
      const [approved]=await tx.$queryRawUnsafe('SELECT 1 FROM atlas_manual.approval WHERE card_id=$1::uuid AND source_hash=$2 LIMIT 1',cardId,card.contentHash);
      let approvalReady=Boolean(approved),reason=null;try{if(!approved)await approvalCheck(tx,card);approvalReady=true;}catch(e){if(!['VARIANT_CONFIRMATION_REQUIRED','VARIANT_REPROCESS_REQUIRED'].includes(e.code))throw e;reason=e.code;}
      return {card,job:unpack(latest),confirmation:saved,approvalReady,reason,legacyApproved:Boolean(approved)};});
      const checked=await compatibleConfirmation(savedRead.card,savedRead.confirmation);return {...savedRead,confirmation:checked,...(!savedRead.legacyApproved&&checked?.recheck_compatible===false?{approvalReady:false,reason:'VARIANT_REPROCESS_REQUIRED'}:{})};},
    async refresh(staff,cardId,input){object(input,['requestId','sourceHash','identityRevision','identityHash','jobId']);uuid(input.requestId);requireThat(/^[a-f0-9]{64}$/.test(input.jobId),400,'VARIANT_REFRESH_INVALID');return boundary.transaction(staff,async({tx,principal})=>{
      await tx.$queryRawUnsafe('SELECT id FROM atlas_manual.card WHERE id=$1::uuid FOR UPDATE',cardId);
      const card=await authorized(tx,principal,cardId,true),b=variantBinding(card);
      // Exact saved generations remain acknowledgeable after another session
      // advances the current identity or refresh. Authorization stays current.
      const [historic]=await tx.$queryRawUnsafe(`SELECT * FROM ${table} WHERE card_id=$1::uuid AND generation=$2::uuid`,cardId,input.requestId);
      if(historic){const saved=unpack(historic);requireThat(saved.input.sourceHash===input.sourceHash&&saved.input.identityRevision===input.identityRevision&&saved.input.identityHash===input.identityHash&&saved.input.reuseJobKey===input.jobId,409,'VARIANT_REFRESH_CONFLICT');return saved.key;}
      requireThat(b.sourceHash===input.sourceHash,409,'VARIANT_SOURCE_STALE');requireThat(b.identityRevision===input.identityRevision&&b.identityHash===input.identityHash,409,'VARIANT_IDENTITY_STALE');
      const nextInput={...b,identity:variantCatalogIdentity('playerName'in card.draft.identity?'SPORTS':'POKEMON',card.draft.identity),generation:input.requestId,reuseJobKey:input.jobId},key=variantJobKey(nextInput);
      const [existing]=await tx.$queryRawUnsafe(`SELECT * FROM ${table} WHERE key=$1`,key);
      if(existing){requireThat(canonical(unpack(existing).input)===canonical(nextInput),409,'VARIANT_REFRESH_CONFLICT');return key;}
      let [latest]=await tx.$queryRawUnsafe(`SELECT * FROM ${table} WHERE card_id=$1::uuid AND source_hash=$2 AND identity_revision=$3 AND identity_hash=$4 ORDER BY created_at DESC,key DESC LIMIT 1`,cardId,b.sourceHash,b.identityRevision,b.identityHash);
      if(!latest){const saved=await confirmation(tx,card);if(saved?.job_key)[latest]=await tx.$queryRawUnsafe(`SELECT * FROM ${table} WHERE key=$1 AND card_id=$2::uuid AND source_hash=$3`,saved.job_key,cardId,b.sourceHash);}
      requireThat(latest?.key===input.jobId&&variantRefreshable(latest),409,'VARIANT_REFRESH_UNAVAILABLE');
      const [owner]=await tx.$queryRawUnsafe('SELECT owner_id,atlas_manual_connected.display_owner_version(owner_id) access_version FROM atlas_manual.card WHERE id=$1::uuid',cardId);requireThat(owner?.access_version,409,'VARIANT_SOURCE_STALE');
      const value=canonical(nextInput);await tx.$executeRawUnsafe(`INSERT INTO ${table}(key,card_id,actor_id,access_version,policy,generation,source_hash,identity_revision,identity_hash,input,input_hash) VALUES($1,$2::uuid,$3::uuid,$4,$5,$6::uuid,$7,$8,$9,$10,$11)`,key,cardId,owner.owner_id,owner.access_version,VARIANT_POLICY,input.requestId,b.sourceHash,b.identityRevision,b.identityHash,value,digest(value));return key;
    });},
    async reusableResult(job,snapshot){if(!job.input.reuseJobKey)return null;return machine(async({tx})=>{const [row]=await tx.$queryRawUnsafe(`SELECT source.* FROM ${table} source JOIN ${table} j ON j.key=$1 WHERE source.key=$2 AND source.card_id=j.card_id AND source.source_hash=j.source_hash AND source.identity_revision=j.identity_revision AND source.identity_hash=j.identity_hash AND source.state='READY' AND source.catalog_hash=$3 AND ${current}`,job.key,job.input.reuseJobKey,snapshot.snapshotHash);const prior=unpack(row);return prior?.result?.catalog?.snapshotHash===snapshot.snapshotHash?prior.result:null;});},
    async resolve(staff,card,action){return boundary.transaction(staff,async({tx,principal})=>{const actual=await authorized(tx,principal,card.cardId,true);requireThat(actual.contentHash===card.contentHash,409,'MANUAL_DRAFT_STALE');return checkAction(tx,card,action);});},
    currentConfirmation:loadConfirmation,
    async prepareConfirmation({staff,card,action}){if(action.type!=='VARIANT_CONFIRM'||action.decision==='UNRESOLVED')return null;const row=await loadConfirmation(staff,card);return row?.recheck_compatible===false?recheckFence(card,row):null;},
    async pendingRechecks(limit=4){return machine(async({tx})=>tx.$queryRawUnsafe(`SELECT v.*,c.owner_id,atlas_manual_connected.display_owner_version(c.owner_id) access_version FROM atlas_manual_connected.variant_confirmation v JOIN atlas_manual.card c ON c.id=v.card_id JOIN atlas_manual.action a ON a.card_id=v.card_id AND a.action_id=v.action_id WHERE atlas_manual_connected.display_owner_version(c.owner_id) IS NOT NULL AND a.result::jsonb->'card'->'draft'->'identity'=c.content::jsonb->'identity' AND v.action_id=(SELECT latest.action_id FROM atlas_manual_connected.variant_confirmation latest WHERE latest.card_id=c.id AND latest.source_hash=v.source_hash AND latest.identity_revision=v.identity_revision AND latest.identity_hash=v.identity_hash ORDER BY latest.created_at DESC,latest.action_id DESC LIMIT 1) AND v.reprocess_required AND v.identity_revision=(c.content::jsonb->>'identityRevision')::int AND v.source_hash=c.content::jsonb->'source'->>'sourceHash' AND v.decision IN('SELECTED','MANUAL') AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.card_id=c.id) AND NOT EXISTS(SELECT 1 FROM atlas_defect_analysis.request_refusal f WHERE f.card_id=c.id AND f.action_id=v.analysis_action_id) AND NOT EXISTS(SELECT 1 FROM atlas_defect_analysis.run r WHERE r.card_id=c.id AND r.action_id=v.analysis_action_id AND (r.state<>'PREPARED' OR EXISTS(SELECT 1 FROM atlas_defect_analysis.receipt receipt WHERE receipt.analysis_id=r.id))) ORDER BY v.created_at LIMIT $1`,limit));},
    async assertApproval(staff,card){return boundary.transaction(staff,async({tx,principal})=>{await authorized(tx,principal,card.cardId);return approvalCheck(tx,card);});},
    async validateCommit({tx,principal,cardId,input,draft,commitGuard=null}){if(input.action.type==='APPROVE_REPORT'){await approvalCheck(tx,{cardId,draft});return;}if(input.action.type!=='VARIANT_CONFIRM')return;
      const card=await authorized(tx,principal,cardId,true),{job,identity}=await checkAction(tx,card,input.action),changed=variantIdentityHash(identity)!==variantIdentityHash(card.draft.identity),revision=card.draft.identityRevision+(changed?1:0),previous=await confirmation(tx,card);
      const staleReady=commitGuard?.version==='atlas-variant-recheck-fence-v1';
      if(staleReady)requireThat(previous?.recheck_state==='READY'&&canonical(commitGuard)===canonical(recheckFence(card,previous)),409,'VARIANT_RECHECK_STALE');
      const needsRecheck=changed||previous?.reprocess_required===true,analysisActionId=changed||previous?.recheck_retryable===true||staleReady?variantAnalysisActionId(input.actionId):previous?.analysis_action_id??variantAnalysisActionId(input.actionId);
      requireThat(variantIdentityHash(draft.identity)===variantIdentityHash(identity)&&draft.identityRevision===revision,409,'VARIANT_IDENTITY_STALE');
      await tx.$executeRawUnsafe(`INSERT INTO atlas_manual_connected.variant_confirmation(card_id,action_id,actor_id,source_hash,identity_revision,identity_hash,job_key,result_hash,catalog_hash,candidate_id,decision,reprocess_required,analysis_action_id,observed_features) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::uuid,$14)`,cardId,input.actionId,principal.id,input.action.sourceHash,revision,variantIdentityHash(identity),job?.key??null,job?.result_hash??null,job?.catalog_hash??null,input.action.candidateId,input.action.decision,needsRecheck,analysisActionId,input.action.observedFeatures??null);
      if(['SELECTED','MANUAL'].includes(input.action.decision)){const candidate=job?.result?.catalog?.candidates.find(c=>c.candidateId===input.action.candidateId);const observedAt=new Date().toISOString(),payload={decision:input.action.decision,cardId,actionId:input.actionId,sourceHash:input.action.sourceHash,identityRevision:revision,identityHash:variantIdentityHash(identity),identity:{...variantCatalogIdentity('playerName'in identity?'SPORTS':'POKEMON',identity),language:candidate?.identity.language??null},parallel:identity.parallel,observedFeatures:input.action.observedFeatures??null,catalog:job?.catalog??null,candidateId:input.action.candidateId,observedAt,referencePermission:input.action.referencePermission??null},text=canonical(payload,{maxBytes:2097152});
        await tx.$executeRawUnsafe(`INSERT INTO atlas_manual_connected.variant_contribution(action_id,card_id,actor_id,access_version,payload,payload_hash) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6)`,input.actionId,cardId,principal.id,principal.accessVersion,text,digest(text));}
    },
    async claim(concurrency=1){requireThat(Number.isInteger(concurrency)&&concurrency>=1&&concurrency<=4,500,'VARIANT_CONFIG_INVALID');return machine(async({tx})=>{
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(721930,77)');
      await tx.$executeRawUnsafe(`UPDATE ${table} j SET state='STALE',claim_id=NULL,lease_until=NULL,code='VARIANT_SOURCE_STALE',updated_at=clock_timestamp() WHERE state IN('QUEUED','RUNNING','REQUESTED') AND (lease_until IS NULL OR lease_until<=clock_timestamp()) AND NOT(${current})`);
      await tx.$executeRawUnsafe(`UPDATE ${table} SET state='UNKNOWN',claim_id=NULL,lease_until=NULL,code='VARIANT_PROVIDER_OUTCOME_UNKNOWN',updated_at=clock_timestamp() WHERE state='REQUESTED' AND lease_until<=clock_timestamp() AND response IS NULL`);
      await tx.$executeRawUnsafe(`UPDATE ${table} SET state='FAILED',claim_id=NULL,lease_until=NULL,code=CASE WHEN response IS NULL THEN 'VARIANT_PREPARATION_EXHAUSTED' ELSE 'VARIANT_PROJECTION_EXHAUSTED' END,updated_at=clock_timestamp() WHERE attempts>=6 AND state IN('QUEUED','RUNNING','REQUESTED','UNKNOWN') AND (lease_until IS NULL OR lease_until<=clock_timestamp()) AND (dispatch_id IS NULL OR response IS NOT NULL)`);
      const [n]=await tx.$queryRawUnsafe(`SELECT count(*)::int n FROM ${table} WHERE state IN('RUNNING','REQUESTED') AND lease_until>clock_timestamp()`);if(n.n>=concurrency)return null;
      const [row]=await tx.$queryRawUnsafe(`SELECT j.* FROM ${table} j WHERE ${current} AND attempts<6 AND ((state='QUEUED' AND available_at<=clock_timestamp()) OR (state IN('RUNNING','REQUESTED') AND lease_until<=clock_timestamp()) OR (state='UNKNOWN' AND response IS NOT NULL)) ORDER BY available_at,created_at,key LIMIT 1 FOR UPDATE SKIP LOCKED`);if(!row)return null;
      const claim=randomUUID();const [next]=await tx.$queryRawUnsafe(`UPDATE ${table} SET state='RUNNING',claim_id=$2::uuid,lease_until=clock_timestamp()+($3*interval '1 millisecond'),attempts=attempts+1,updated_at=clock_timestamp() WHERE key=$1 RETURNING *`,row.key,claim,leaseMs);return unpack(next);});},
    renew:job=>machine(async({tx})=>(await tx.$executeRawUnsafe(`UPDATE ${table} j SET lease_until=clock_timestamp()+($3*interval '1 millisecond'),updated_at=clock_timestamp() WHERE ${active}`,job.key,job.claim_id,leaseMs))===1),
    saveCatalog:(job,catalog)=>machine(async({tx})=>{validateVariantReviewSnapshot(catalog);const value=canonical(catalog,{maxBytes:1048576});return(await tx.$executeRawUnsafe(`UPDATE ${table} j SET catalog=$3,catalog_hash=$4,updated_at=clock_timestamp() WHERE ${active} AND catalog IS NULL`,job.key,job.claim_id,value,catalog.snapshotHash))===1;}),
    dispatch:(job,evidence=null)=>machine(async({tx})=>(await tx.$executeRawUnsafe(`UPDATE ${table} j SET state='REQUESTED',dispatch_id=$2::uuid,audit=audit||jsonb_build_array(jsonb_build_object('event','DISPATCH','id',$2::text,'evidence',$3::jsonb)),updated_at=clock_timestamp() WHERE ${active} AND state='RUNNING' AND dispatch_id IS NULL AND response IS NULL AND catalog IS NOT NULL`,job.key,job.claim_id,canonical(evidence)))===1),
    response:(job,response)=>machine(async({tx})=>{const value=evidenceText(response,'bodyText',1048576);return(await tx.$executeRawUnsafe(`UPDATE ${table} SET response=$3,response_hash=$4,audit=audit||jsonb_build_array(jsonb_build_object('event','RESPONSE','hash',$4::text)),updated_at=clock_timestamp() WHERE key=$1 AND dispatch_id=$2::uuid AND response IS NULL AND ($5::jsonb IS NULL OR $5::jsonb=(SELECT event->'evidence' FROM jsonb_array_elements(audit) event WHERE event->>'event'='DISPATCH' AND event->>'id'=$2::text))`,job.key,job.claim_id,value,digest(value),response.requestEvidence?canonical(response.requestEvidence):null))===1;}),
    finish:(job,outcome)=>machine(async({tx})=>{const result=outcome.result?canonical(outcome.result,{maxBytes:2097152}):null;const state=result?'READY':outcome.state==='RETRY'?(job.attempts<6?'QUEUED':'FAILED'):outcome.state;requireThat(['READY','QUEUED','FAILED','UNKNOWN','STALE'].includes(state),500,'VARIANT_OUTCOME_INVALID');return(await tx.$executeRawUnsafe(`UPDATE ${table} j SET state=$3,claim_id=NULL,lease_until=NULL,result=$4,result_hash=$5,code=$6,available_at=clock_timestamp()+interval '30 seconds',updated_at=clock_timestamp() WHERE ${active}`,job.key,job.claim_id,state,result,result?digest(result):null,outcome.code??null))===1;}),
    async claimContribution(){return machine(async({tx})=>{await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(721930,78)');await tx.$executeRawUnsafe("UPDATE atlas_manual_connected.variant_contribution SET state='FAILED',claim_id=NULL,lease_until=NULL,code=CASE WHEN attempts>=6 THEN 'VARIANT_CONTRIBUTION_EXHAUSTED' ELSE 'VARIANT_CONTRIBUTION_ACCESS_REVOKED' END WHERE state IN('QUEUED','RUNNING') AND (lease_until IS NULL OR lease_until<=clock_timestamp()) AND (attempts>=6 OR NOT atlas_manual_connected.display_owner_current(actor_id,access_version))");const [busy]=await tx.$queryRawUnsafe("SELECT 1 FROM atlas_manual_connected.variant_contribution WHERE state='RUNNING' AND lease_until>clock_timestamp() LIMIT 1");if(busy)return null;const [row]=await tx.$queryRawUnsafe(`SELECT * FROM atlas_manual_connected.variant_contribution WHERE attempts<6 AND ((state='QUEUED' AND available_at<=clock_timestamp()) OR (state='RUNNING' AND lease_until<=clock_timestamp())) AND atlas_manual_connected.display_owner_current(actor_id,access_version) ORDER BY created_at,action_id LIMIT 1 FOR UPDATE SKIP LOCKED`);if(!row)return null;const [claimed]=await tx.$queryRawUnsafe("UPDATE atlas_manual_connected.variant_contribution SET state='RUNNING',claim_id=$2::uuid,lease_until=clock_timestamp()+interval '60 seconds',attempts=attempts+1 WHERE action_id=$1::uuid RETURNING *",row.action_id,randomUUID());requireThat(digest(claimed.payload)===claimed.payload_hash&&(!claimed.reference_packet||digest(claimed.reference_packet)===claimed.reference_packet_hash),503,'VARIANT_CONTRIBUTION_CORRUPT');const job={...claimed,payload:JSON.parse(claimed.payload),referencePacket:claimed.reference_packet?JSON.parse(claimed.reference_packet):null};if(job.referencePacket)validateVariantContributionPacket(job,job.referencePacket);return job;});},
    async saveContributionPacket(job,packet){validateVariantContributionPacket(job,packet);const value=canonical(packet,{maxBytes:16384});return machine(async({tx})=>(await tx.$executeRawUnsafe(`UPDATE atlas_manual_connected.variant_contribution SET reference_packet=$3,reference_packet_hash=$4 WHERE action_id=$1::uuid AND claim_id=$2::uuid AND state='RUNNING' AND lease_until>clock_timestamp() AND payload_hash=$5 AND atlas_manual_connected.display_owner_current(actor_id,access_version) AND jsonb_typeof(payload::jsonb->'referencePermission')='object' AND (reference_packet IS NULL OR reference_packet=$3 AND reference_packet_hash=$4)`,job.action_id,job.claim_id,value,digest(value),job.payload_hash))===1);},
    async finishContribution(job,{receipt=null,code=null}){return machine(async({tx})=>{const value=receipt?canonical(receipt):null;return(await tx.$executeRawUnsafe(`UPDATE atlas_manual_connected.variant_contribution SET state=$3,claim_id=NULL,lease_until=NULL,receipt=$4,receipt_hash=$5,code=$6,available_at=clock_timestamp()+interval '60 seconds' WHERE action_id=$1::uuid AND claim_id=$2::uuid AND state='RUNNING' AND lease_until>clock_timestamp()`,job.action_id,job.claim_id,receipt?'READY':job.attempts>=6?'FAILED':'QUEUED',value,value?digest(value):null,code))===1;});},
    cache:{
      get:key=>machine(async({tx})=>{const [row]=await tx.$queryRawUnsafe('SELECT snapshot,snapshot_hash FROM atlas_manual_connected.variant_catalog_cache WHERE key=$1 AND expires_at>clock_timestamp() ORDER BY created_at DESC LIMIT 1',key);if(!row)return null;requireThat(digest(row.snapshot)===row.snapshot_hash,503,'VARIANT_CACHE_CORRUPT');return JSON.parse(row.snapshot);}),
      getRetained:(key,sha256=null)=>machine(async({tx})=>{const [row]=await tx.$queryRawUnsafe("SELECT snapshot,snapshot_hash FROM atlas_manual_connected.variant_catalog_cache WHERE key=$1 AND ($2::text IS NULL OR snapshot::jsonb->>'sha256'=$2) ORDER BY created_at DESC LIMIT 1",key,sha256);if(!row)return null;requireThat(digest(row.snapshot)===row.snapshot_hash,503,'VARIANT_CACHE_CORRUPT');return JSON.parse(row.snapshot);}),
      put:(key,snapshot)=>machine(async({tx})=>{const image=snapshot?.schemaVersion==='variant-provider-image/v1',value=evidenceText(snapshot,'body',image?Math.ceil(4194304/3)*4:1048576);if(image){const bytes=Buffer.from(snapshot.body,'base64');requireThat(bytes.length>0&&bytes.length<=4194304&&bytes.toString('base64')===snapshot.body&&digest(bytes)===snapshot.sha256,400,'VARIANT_IMAGE_CACHE_INVALID');}await tx.$executeRawUnsafe(`INSERT INTO atlas_manual_connected.variant_catalog_cache(key,snapshot,snapshot_hash,expires_at) VALUES($1,$2,$3,$4::timestamptz) ON CONFLICT DO NOTHING`,key,value,digest(value),snapshot.expiresAt);})},

  });
}
export function variantJobGrantSQL(role,{worker=false}={}){requireThat(/^[a-z][a-z0-9_]{0,62}$/.test(role));return `GRANT USAGE ON SCHEMA atlas_manual_connected TO "${role}";
GRANT SELECT ON atlas_manual_connected.variant_job,atlas_manual_connected.variant_catalog_cache TO "${role}";
GRANT INSERT ON atlas_manual_connected.variant_job TO "${role}";
GRANT EXECUTE ON FUNCTION atlas_manual_connected.display_owner_version(uuid) TO "${role}";
GRANT ${worker?'SELECT':'SELECT,INSERT'} ON atlas_manual_connected.variant_confirmation,atlas_manual_connected.variant_contribution TO "${role}";${worker?`\nGRANT INSERT ON atlas_manual_connected.variant_catalog_cache TO "${role}";\nGRANT UPDATE(state,attempts,claim_id,lease_until,dispatch_id,catalog,catalog_hash,response,response_hash,result,result_hash,code,available_at,updated_at,audit) ON atlas_manual_connected.variant_job TO "${role}";
GRANT UPDATE(state,attempts,claim_id,lease_until,receipt,receipt_hash,reference_packet,reference_packet_hash,code,available_at) ON atlas_manual_connected.variant_contribution TO "${role}";
GRANT EXECUTE ON FUNCTION atlas_manual_connected.display_owner_current(uuid,integer),atlas_manual_connected.display_owner_version(uuid) TO "${role}";`:''}`;}
