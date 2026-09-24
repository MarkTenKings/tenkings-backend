import sharp from 'sharp';
import {canonical,digest,requireThat} from '@atlas/manual-service/contract';
/** Research derivatives never replace grading originals or invent Inventory keys. */
export async function loadResearchPhotos({staff,cardId,source,intake,storage,artifacts}){
  const pair=await intake.verifiedPair(staff,cardId),loaded=new Map(),photos={},lineage={};
  const manifest=JSON.parse(source.row.manifest);
  const media=await artifacts.read(manifest.media.ref,{cardId,kind:'APPROVED_MEDIA',sourceHash:manifest.media.sourceHash});
  for(const [side,slot] of Object.entries(pair.sides)){
    const photo=slot.photo,expected=media?.[side];
    // Publication media's exact original is the approved physical evidence.
    requireThat(expected&&canonical(expected.original)===canonical(photo.original),409,'RESEARCH_PHOTOS_CHANGED');
    const found=await storage.readDecodedFrame({frame:photo.workingFrame,original:photo.original,decodePlan:photo.decodePlan});
    const bytes=await sharp(found.bytes,{limitInputPixels:52_000_000,failOn:'warning'}).resize(1400,1400,{fit:'inside',withoutEnlargement:true}).jpeg({quality:92}).toBuffer();
    requireThat(bytes.length>0&&bytes.length<=2*1024*1024,422,'RESEARCH_PHOTO_TOO_LARGE');
    const key=side.toLowerCase(),sha256=digest(bytes),descriptor={ref:`atlas-${key}-${sha256}`,sha256,sourceSha256:photo.original.content.sha256,mimeType:'image/jpeg',byteCount:bytes.length};
    const ref=await artifacts.write({version:'atlas-research-photo-v1',descriptor,base64:bytes.toString('base64'),original:photo.original,workingFrame:photo.workingFrame,decodePlan:photo.decodePlan},{cardId,kind:'RESEARCH_IMAGE',sourceHash:source.publicHash});
    photos[key]=descriptor;lineage[key]={ref};loaded.set(descriptor.ref,{...descriptor,bytes});
  }
  requireThat(photos.front&&photos.back&&photos.front.sourceSha256!==photos.back.sourceSha256,409,'RESEARCH_PHOTO_PAIR_REQUIRED');
  const after=await intake.verifiedPair(staff,cardId);requireThat(after.sourceHash===pair.sourceHash,409,'RESEARCH_PHOTOS_CHANGED');
  return {photos,lineage,loaded,pairHash:pair.sourceHash};
}
export async function readResearchPhotos({artifacts,cardId,sourceHash,input,lineage}){
  const loaded=new Map();
  for(const side of ['front','back']){
    const photo=await artifacts.read(lineage[side].ref,{cardId,kind:'RESEARCH_IMAGE',sourceHash});
    const bytes=Buffer.from(photo.base64,'base64'),descriptor=input.photos[side];
    requireThat(photo.version==='atlas-research-photo-v1'&&canonical(photo.descriptor)===canonical(descriptor)&&bytes.toString('base64')===photo.base64&&digest(bytes)===descriptor.sha256&&bytes.length===descriptor.byteCount
      &&photo.original.content.sha256===descriptor.sourceSha256,503,'RESEARCH_PHOTO_CORRUPT');
    loaded.set(descriptor.ref,{...descriptor,bytes});
  }
  return loaded;
}
