import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {canonical} from '@atlas/manual-service/contract';
import {createVariantReviewSnapshot} from '@tenkings/card-catalog-evidence';
import {labelCatalog} from '../test/variant-label-fixture.mjs';
import {readManualResponse} from '@atlas/manual-service/response';

export async function validateVariantPackets({fixture,store,review,staff,seed}){
 const cardId=await seed();await store.discover();const job=await store.claim(1);assert.equal(job.card_id,cardId);
 const full=labelCatalog({count:58,photos:1800,source:'large-checkpoint-packet',candidateTransform:c=>{c.canonical.cardId='large-packet-fixture-card';c.source.recordId='large-packet-fixture-card';}});
 const identity={category:'POKEMON',name:'Magikarp',year:'2020',setName:'Rebel Clash',cardNumber:'039/192',manufacturer:null,language:null};
 const checkpoint=photos=>createVariantReviewSnapshot({identity,candidates:full.candidates,referencePhotos:full.referencePhotos.slice(0,photos),
  capturedAt:full.capturedAt,problems:['REFERENCE_ACQUISITION_PENDING']});
 assert(await store.saveCatalog(job,checkpoint(0)));
 const early=await review.status(staff,cardId);assert.equal(early.state,'SEARCHING');assert.equal(early.result.catalog.candidates.length,58);
 assert(await store.saveCatalog(job,checkpoint(1)));
 const overwrite=async value=>fixture.admin.$executeRawUnsafe('UPDATE atlas_manual_connected.variant_job SET catalog=$2,catalog_hash=$3 WHERE key=$1',job.key,canonical(value,{maxBytes:4194304}),value.snapshotHash);
 await assert.rejects(overwrite(checkpoint(0)),error=>error.meta?.code==='P0001');
 const other=labelCatalog({count:57,photos:1,source:'large-checkpoint-packet',candidateTransform:c=>{c.canonical.cardId='large-packet-fixture-card';c.source.recordId='large-packet-fixture-card';}});await assert.rejects(overwrite(other),error=>error.meta?.code==='P0001');
 const large=checkpoint(1800);assert(Buffer.byteLength(JSON.stringify(large))>1048576);
 assert(await store.saveCatalog(job,large));
 const resumed=await review.status(staff,cardId);assert.equal(resumed.result.catalog.referencePhotos.length,1800);
 const body=await readManualResponse(Response.json(resumed));assert.deepEqual(body,resumed);
 assert(await store.saveCatalog(job,full));
 await assert.rejects(overwrite(large),error=>error.meta?.code==='P0001');
 assert(await store.finish(job,{result:{catalog:full,suggestion:{candidateId:null,confidence:null,reason:'Fixture-only review.',evidence:[]}}}));
 const finished=await review.status(staff,cardId);
 const confirmed=await review.confirm(staff,cardId,{actionId:randomUUID(),expectedRevision:finished.revision,sourceHash:finished.sourceHash,
  identityRevision:finished.identityRevision,identityHash:finished.identityHash,jobId:finished.jobId,resultHash:finished.resultHash,
  decision:'SELECTED',candidateId:full.candidates[0].candidateId,reviewed:true});
 assert.equal(confirmed.approvalReady,true);
 return ['58 official-shaped choices are visible before acquisition, photo checkpoints append under the same live claim, changing choices/removing photos/final catalog mutation are rejected',
  '1800-photo packet exceeding1MiB survives PostgreSQL, ordinary status JSON transport and explicit human confirmation; no paid provider work'];
}
