import { requireThat } from '@atlas/manual-service/contract';

/** Saved navigation evidence. No hydration, preparation, publication or model
 * work is reachable. Original fallbacks use the same verified frame as grading. */
export function createThumbnailReader({ intake, workflow, readManifest, imageReadUrl, readCleanDescriptor = null, readGradingPhoto, gradingPhotoStatus }) {
  return async function thumbnails(staff,cardId) {
    const {card}=await intake.read(staff,cardId);
    let manual=null;
    try{manual=await workflow.service.read(staff,cardId);}catch(error){if(error?.code!=='MANUAL_CARD_NOT_FOUND')throw error;}
    const images=Object.fromEntries(await Promise.all(['FRONT','BACK'].map(async side=>{
      const upload=card.sides[side].upload;if(!upload?.source)return[side,{state:'PENDING'}];
      const {photo}=await intake.readSource(staff,cardId,upload.uploadId);
      if(readCleanDescriptor){
        const clean=await readCleanDescriptor({cardId,uploadId:upload.uploadId,side,photo});
        if(clean)return[side,{state:'READY',preview:clean}];
      }
      const status=await gradingPhotoStatus?.({cardId,uploadId:upload.uploadId,side});
      if(status?.state==='READY' && status.source==='ORIGINAL' && imageReadUrl && readGradingPhoto){
        const selected=await readGradingPhoto({cardId,uploadId:upload.uploadId,side,photo});
        const preview=await imageReadUrl({kind:'original',descriptor:selected.photo.workingFrame,photo:selected.photo,
          photoSource:upload.source,contextOnly:true});
        return[side,{state:'READY',source:'ORIGINAL',preview}];
      }
      return[side,{state:'PENDING'}];
    })));
    const current=(await intake.read(staff,cardId)).card;
    requireThat(current.revision===card.revision&&current.sourceHash===card.sourceHash,409,'MANUAL_PHOTOS_CHANGED');
    if(manual){const after=await workflow.service.read(staff,cardId);requireThat(after.revision===manual.revision&&after.contentHash===manual.contentHash,409,'MANUAL_PHOTOS_CHANGED');}
    return {cardId,sourceHash:card.sourceHash,images};
  };
}
