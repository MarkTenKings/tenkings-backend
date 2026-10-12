import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {canonical,digest} from '@atlas/manual-service/contract';
import {createVariantReviewSnapshot} from '@tenkings/card-catalog-evidence';
import {variantBinding,variantCatalogIdentity,variantJobKey,VARIANT_POLICY} from '../src/variant-job-store.mjs';
import {createVariantWorker} from '../src/variant-worker.mjs';
import {prepareVariantLabelRequest} from '../src/variant-photo-provider.mjs';
import {CODEX_ASSOCIATION_REVISION} from '../src/variant-codex.mjs';
/** Caller owns a disposable fixture. No external services or production rows. */
export async function validateVariantLocalRefresh({fixture,store,staff,seed,review,service,worker,catalog,candidate}) {
 await worker.drainOnce();await worker.drainOnce();
 const cardId=await seed(),card=await service.read(staff,cardId),input={...variantBinding(card),identity:variantCatalogIdentity('POKEMON',card.draft.identity)},key=variantJobKey(input),text=canonical(input);
 await fixture.admin.$executeRawUnsafe(`INSERT INTO atlas_manual_connected.variant_job(key,card_id,actor_id,access_version,policy,source_hash,identity_revision,identity_hash,input,input_hash)
 SELECT $1,c.id,c.owner_id,atlas_manual_connected.display_owner_version(c.owner_id),$3,$4,$5,$6,$7,$8 FROM atlas_manual.card c WHERE c.id=$2::uuid`,key,cardId,VARIANT_POLICY,input.sourceHash,input.identityRevision,input.identityHash,text,digest(text));
 const old=await store.claim(1);assert.equal(old.key,key);
 const empty=createVariantReviewSnapshot({identity:input.identity,candidates:[],capturedAt:'2026-10-12T00:00:00.000Z'});
 assert(await store.saveCatalog(old,empty));assert(await store.finish(old,{result:{catalog:empty,suggestion:{candidateId:null,confidence:null,reason:'Historical empty catalog',evidence:[]}}}));
 const oldStatus=await review.status(staff,cardId),manual=await review.confirm(staff,cardId,{actionId:randomUUID(),expectedRevision:oldStatus.revision,sourceHash:oldStatus.sourceHash,identityRevision:oldStatus.identityRevision,identityHash:oldStatus.identityHash,jobId:oldStatus.jobId,resultHash:oldStatus.resultHash,decision:'MANUAL',candidateId:null,reviewed:true,manualParallel:'English Holo'});
 assert.equal(manual.identityRevision,old.identity_revision+1);
 const preview=await service.previewReport(staff,cardId);await service.execute(staff,cardId,{actionId:randomUUID(),expectedRevision:manual.revision,action:{type:'APPROVE_REPORT',reportHash:preview.reportHash,reviewed:true}});
 const humanRows=()=>Promise.all(['atlas_manual.card','atlas_manual.action','atlas_manual.approval','atlas_manual_connected.variant_confirmation'].map(table=>fixture.admin.$queryRawUnsafe(`SELECT to_jsonb(t) row FROM ${table} t WHERE ${table==='atlas_manual.card'?'id':'card_id'}=$1::uuid ORDER BY to_jsonb(t)::text`,cardId)));
 const humanBefore=await humanRows();
 const before=await fixture.admin.$queryRawUnsafe('SELECT to_jsonb(j) row FROM atlas_manual_connected.variant_job j WHERE key=$1',key);
 assert.equal(await store.discover(),1);assert.equal(await store.discover(),0);
 const [queued]=await fixture.admin.$queryRawUnsafe("SELECT input,generation FROM atlas_manual_connected.variant_job WHERE card_id=$1::uuid AND state='QUEUED'",cardId),local=JSON.parse(queued.input);
 assert.equal(local.localOnly,true);assert.equal(local.catalogRevision,CODEX_ASSOCIATION_REVISION);assert.equal(local.reuseJobKey,key);assert.notEqual(queued.generation,'00000000-0000-0000-0000-000000000000');
 const noModel=()=>assert.fail('Local refresh cannot dispatch OCR');noModel.labelRequest=prepareVariantLabelRequest;
 const reproject=createVariantWorker({store,catalog:{prepare:async(request,{priorCatalog})=>{assert.equal(request.localOnly,true);assert.equal(priorCatalog.snapshotHash,empty.snapshotHash);return catalog;}},provider:noModel});
 await reproject.drainOnce();const refreshed=await review.status(staff,cardId);assert.equal(refreshed.state,'READY');assert(refreshed.result.catalog.candidates.length>0);assert.equal(await store.discover(),0);
 assert.deepEqual(await fixture.admin.$queryRawUnsafe('SELECT to_jsonb(j) row FROM atlas_manual_connected.variant_job j WHERE key=$1',key),before);
 assert.deepEqual(await humanRows(),humanBefore);assert.equal(refreshed.approvalReady,true);
 // A new human identity revision needs normal acquisition. The existence of a
 // READY result for the same photograph must not turn it into a local refresh.
 const editedCard=await service.read(staff,cardId),editedDraft=structuredClone(editedCard.draft);
 editedDraft.identity.cardName='Different Pokémon';editedDraft.identityRevision++;
 await fixture.admin.$executeRawUnsafe('UPDATE atlas_manual.card SET content=$2,content_hash=$3,revision=revision+1 WHERE id=$1::uuid',cardId,canonical(editedDraft),digest(canonical(editedDraft)));
 assert.equal(await store.discover(),1);const edited=await store.claim(1);assert.equal(edited.card_id,cardId);
 assert.equal(edited.input.identity.name,'Different Pokémon');assert.equal(edited.input.localOnly,undefined);assert.equal(edited.input.reuseJobKey,undefined);
 assert(await store.finish(edited,{state:'FAILED',code:'SYNTHETIC_CASE_FINISHED'}));
 const waiting=await seed();assert.equal(await store.discover(),1);const job=await store.claim(1);assert.equal(job.card_id,waiting);assert(await store.saveCatalog(job,catalog));
 const status=await review.status(staff,waiting);assert.equal(status.state,'SEARCHING');assert.equal(status.resultHash,catalog.snapshotHash);assert(status.result.catalog.candidates.length);
 const confirmed=await review.confirm(staff,waiting,{actionId:randomUUID(),expectedRevision:status.revision,sourceHash:status.sourceHash,identityRevision:status.identityRevision,identityHash:status.identityHash,jobId:status.jobId,resultHash:status.resultHash,decision:'SELECTED',candidateId:candidate.candidateId,reviewed:true});
 assert.equal(confirmed.approvalReady,true);assert.equal(confirmed.confirmation.resultHash,catalog.snapshotHash);assert.equal(await store.discover(),0);await store.claim(1);
 return ['association revision schedules exactly one local-only refresh with a new generation, repairs an empty catalog and preserves old job bytes','current human confirmation links its earlier identity job for local refresh; card, actions, approval and confirmation remain byte-identical','later human identity edit receives ordinary acquisition despite same-photo READY history','human confirmation adopts a saved catalog while reference processing is SEARCHING, without model or image readiness'];
}
