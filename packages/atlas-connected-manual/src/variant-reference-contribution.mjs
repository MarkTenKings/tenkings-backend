import sharp from 'sharp';
import { canonical, digest, requireThat } from '@atlas/manual-service/contract';
import { canonicalJson, prepareObservationProposal } from '@tenkings/card-catalog-evidence';
import { prepareVariantCatalogObservation } from './variant-catalog-proposal.mjs';
import { validateVariantReferencePermission, variantBinding } from './variant-job-store.mjs';
import { VARIANT_SOURCE_PHOTO_POLICY } from './variant-source-photos.mjs';

export const VARIANT_REFERENCE_PHOTO_POLICY=Object.freeze({version:'atlas-reference-photo-v1',maxDimension:1600,
  quality:85,fallbackQuality:70,chromaSubsampling:'4:4:4',maxImageBytes:1572864,maxTotalBytes:3145728});
const PACKET='atlas-variant-reference-packet/v1';
const same=(a,b)=>canonical(a,{maxBytes:8388608})===canonical(b,{maxBytes:8388608});

function referenceCapture(payload,photoDerivation) {
  const capture={schemaVersion:'atlas-variant-reference-capture/v1',physicalCardRef:payload.cardId,actionId:payload.actionId,
    inputRevision:`identity:${payload.identityRevision}:${payload.identityHash}:source:${payload.sourceHash}`,
    sourceHash:payload.sourceHash,identityHash:payload.identityHash,identityRevision:payload.identityRevision,observedAt:payload.observedAt,
    sourcePhotoPolicy:VARIANT_SOURCE_PHOTO_POLICY,referencePhotoPolicy:VARIANT_REFERENCE_PHOTO_POLICY,photoDerivation};
  const bytes=Buffer.from(canonicalJson(capture)),sha256=digest(bytes);
  requireThat(bytes.length<=16384,503,'VARIANT_REFERENCE_PACKET_INVALID');
  const origins=[...new Set(['FRONT','BACK'].flatMap(side=>['originalSha256','frameSha256'].map(field=>`bytes:${photoDerivation?.[side]?.[field]}`)))].sort();
  return {bytes,source:{sourceId:'physical-review',kind:'PHYSICAL_OBSERVATION',sourceRef:`catalog:sha256:${sha256}`,
    sourceUrl:null,sha256,parentSourceIds:[],originKeys:[`physical:atlas:${payload.cardId}`,...origins]}};
}

async function referencePhoto(photo) {
  requireThat(Buffer.isBuffer(photo.bytes)&&digest(photo.bytes)===photo.sha256,409,'VARIANT_REFERENCE_SOURCE_INVALID');
  const decoder=sharp(photo.bytes,{limitInputPixels:52_000_000,failOn:'warning'})
    .resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true});
  let quality=85,bytes=await decoder.clone().jpeg({quality,chromaSubsampling:'4:4:4'}).toBuffer();
  if(bytes.length>VARIANT_REFERENCE_PHOTO_POLICY.maxImageBytes){quality=70;bytes=await decoder.clone().jpeg({quality,chromaSubsampling:'4:4:4'}).toBuffer();}
  requireThat(bytes.length>0&&bytes.length<=VARIANT_REFERENCE_PHOTO_POLICY.maxImageBytes,413,'VARIANT_REFERENCE_TOO_LARGE');
  const metadata=await sharp(bytes).metadata();
  return {bytes,sha256:digest(bytes),mimeType:'image/jpeg',width:metadata.width,height:metadata.height,quality};
}

function checkedPacket(packet,payload,payloadHash) {
  requireThat(packet?.schemaVersion===PACKET&&packet.payloadHash===payloadHash
    && same(packet.photoPolicy,VARIANT_REFERENCE_PHOTO_POLICY),503,'VARIANT_REFERENCE_PACKET_INVALID');
  const prepared=prepareObservationProposal(packet.request?.proposal),p=prepared.proposal;
  const expected=prepareVariantCatalogObservation(payload).proposal;
  const capture=referenceCapture(payload,packet.photoDerivation);
  requireThat(p.producer==='atlas'&&p.physicalCardRef===payload.cardId&&p.observationId===`variant-reference:${payload.actionId}`
    && ['inputRevision','identity','observedAt','basedOnPublication'].every(field=>same(p[field],expected[field]))
    && p.sources.length===3&&same(p.sources.find(s=>s.sourceId==='physical-review'),capture.source)
    && same(packet.request.sourceArtifacts,[{sourceId:'physical-review',bytesBase64:capture.bytes.toString('base64')}])
    && p.images.length===2&&same(packet.request.observation,{physicalCardRef:p.physicalCardRef,observationId:p.observationId,
      inputRevision:p.inputRevision,evidenceSha256:prepared.proposalSha256})
    && Array.isArray(packet.request.images)&&packet.request.images.length===2,503,'VARIANT_REFERENCE_PACKET_INVALID');
  let total=0;
  for(const side of ['FRONT','BACK']){
    const image=p.images.find(i=>i.role===side.toLowerCase()),upload=packet.request.images.find(i=>i.imageId===image?.imageId);
    requireThat(image&&upload&&same(upload.permission,payload.referencePermission),503,'VARIANT_REFERENCE_PACKET_INVALID');
    const sourceId=`photo-${side.toLowerCase()}`,source=p.sources.find(s=>s.sourceId===sourceId),d=packet.photoDerivation?.[side];
    requireThat(same(image.sourceIds,[sourceId])&&image.parentImageIds.length===0
      && image.imageId===`atlas-reference:${side.toLowerCase()}:${image.sha256}`
      && source&&same(source,{sourceId,kind:'DERIVED',sourceRef:`catalog:sha256:${image.sha256}`,
        sourceUrl:null,sha256:image.sha256,parentSourceIds:['physical-review'],originKeys:[`physical:atlas:${payload.cardId}`]})
      && d&&Object.keys(d).sort().join(',')==='comparisonSha256,frameSha256,originalSha256,quality,referenceSha256'
      && ['originalSha256','frameSha256','comparisonSha256'].every(field=>/^[a-f0-9]{64}$/.test(d[field]??''))
      && d.referenceSha256===image.sha256&&[85,70].includes(d.quality)
      && image.mimeType==='image/jpeg'&&image.width<=1600&&image.height<=1600,503,'VARIANT_REFERENCE_PACKET_INVALID');
    const bytes=Buffer.from(upload.bytesBase64,'base64');total+=bytes.length;
    requireThat(bytes.toString('base64')===upload.bytesBase64&&bytes.length>0&&bytes.length<=VARIANT_REFERENCE_PHOTO_POLICY.maxImageBytes
      && digest(bytes)===image.sha256&&image.mediaRef===`catalog:sha256:${image.sha256}`,503,'VARIANT_REFERENCE_PACKET_INVALID');
  }
  requireThat(total<=VARIANT_REFERENCE_PHOTO_POLICY.maxTotalBytes,503,'VARIANT_REFERENCE_PACKET_INVALID');
  return packet.request;
}

/** Runs only in the bounded background process, after a concrete human choice
 * and an optional explicit permission assertion. Exact private upload bytes
 * are persisted before POST, so restart/redeploy retries cannot re-encode or
 * change the immutable submission. No photo bytes enter a public source cache. */
export function createVariantReferenceContribution({store,artifacts,boundary,workflow,loadPhotos,catalog,transform=referencePhoto}) {
  async function current(job){
    const staff=boundary.machineOwner({ownerId:job.actor_id,accessVersion:job.access_version});
    const card=await workflow.service.read(staff,job.card_id),b=variantBinding(card),p=job.payload;
    requireThat(b.cardId===p.cardId&&b.sourceHash===p.sourceHash&&b.identityHash===p.identityHash&&b.identityRevision===p.identityRevision,
      409,'VARIANT_REFERENCE_SOURCE_STALE');
    return b;
  }
  return async(job,{signal}={})=>{
    const payload=job.payload;
    if(!payload.referencePermission)return null;
    validateVariantReferencePermission(payload.referencePermission);
    const payloadHash=digest(canonical(payload,{maxBytes:2097152}));
    requireThat(payloadHash===job.payload_hash,503,'VARIANT_CONTRIBUTION_CORRUPT');
    const binding=await current(job),source={cardId:job.card_id,kind:'VARIANT_REFERENCE',sourceHash:payloadHash};
    let pinned=job.referencePacket,packet;
    if(pinned){
      requireThat(pinned.sourceHash===payloadHash,503,'VARIANT_REFERENCE_PACKET_INVALID');
      packet=await artifacts.read(pinned.ref,source,{signal});
    }else{
      const photos=await loadPhotos({...job,input:binding},{signal}),prepared=prepareVariantCatalogObservation(payload);
      requireThat(photos.sourceHash===payload.sourceHash&&same(photos.policy,VARIANT_SOURCE_PHOTO_POLICY),409,'VARIANT_REFERENCE_SOURCE_INVALID');
      const proposal=structuredClone(prepared.proposal),images=[],derivation={};
      proposal.observationId=`variant-reference:${payload.actionId}`;
      // Only the physical root belongs in a private photo contribution.
      // External provider URLs remain in the separate metadata observation.
      proposal.sources=proposal.sources.filter(s=>s.kind==='PHYSICAL_OBSERVATION');
      proposal.images=[];
      proposal.note=`Human-confirmed physical reference: ${payload.parallel}. Pending catalog and image-permission review. ${payload.observedFeatures??''}`.trim().slice(0,500);
      for(const side of ['FRONT','BACK']){
        signal?.throwIfAborted();const photo=await transform(photos[side]),sourceId=`photo-${side.toLowerCase()}`;
        const imageId=`atlas-reference:${side.toLowerCase()}:${photo.sha256}`;
        proposal.sources.push({sourceId,kind:'DERIVED',sourceRef:`catalog:sha256:${photo.sha256}`,
          sourceUrl:null,sha256:photo.sha256,parentSourceIds:['physical-review'],originKeys:[`physical:atlas:${payload.cardId}`]});
        proposal.images.push({imageId,mediaRef:`catalog:sha256:${photo.sha256}`,sha256:photo.sha256,mimeType:photo.mimeType,
          width:photo.width,height:photo.height,role:side.toLowerCase(),sourceIds:[sourceId],parentImageIds:[]});
        images.push({imageId,bytesBase64:photo.bytes.toString('base64'),permission:payload.referencePermission});
        derivation[side]={originalSha256:photos[side].originalSha256,frameSha256:photos[side].frameSha256,
          comparisonSha256:photos[side].sha256,referenceSha256:photo.sha256,quality:photo.quality};
      }
      const capture=referenceCapture(payload,derivation);
      proposal.sources[0]=capture.source;
      const final=prepareObservationProposal(proposal);
      packet={schemaVersion:PACKET,payloadHash,photoPolicy:VARIANT_REFERENCE_PHOTO_POLICY,photoDerivation:derivation,
        request:{proposal:final.proposal,observation:{physicalCardRef:proposal.physicalCardRef,observationId:proposal.observationId,
          inputRevision:proposal.inputRevision,evidenceSha256:final.proposalSha256},images,
          sourceArtifacts:[{sourceId:'physical-review',bytesBase64:capture.bytes.toString('base64')}]}};
      checkedPacket(packet,payload,payloadHash);
      await current(job);
      pinned={ref:await artifacts.write(packet,source,{signal}),sourceHash:payloadHash};
      requireThat(await store.saveContributionPacket(job,pinned),409,'VARIANT_CONTRIBUTION_LEASE_LOST');
    }
    const request=checkedPacket(packet,payload,payloadHash);
    await current(job);signal?.throwIfAborted();
    return catalog.submitReference(request,{signal});
  };
}
