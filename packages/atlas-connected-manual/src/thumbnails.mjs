import { requireThat } from '@atlas/manual-service/contract';
import { rethrowPreviewControlFailure } from './inspection-preview.mjs';

/** Lightweight navigation evidence. No hydration, full-image grant, decode,
 * preparation, publication, or model work is reachable from this reader. */
export function createThumbnailReader({ intake, workflow, readManifest, imageReadUrl, reviewDisplay }) {
  return async function thumbnails(staff,cardId) {
    const {card}=await intake.read(staff,cardId);
    let manual=null;
    try{manual=await workflow.service.read(staff,cardId);}catch(error){if(error?.code!=='MANUAL_CARD_NOT_FOUND')throw error;}
    const images=Object.fromEntries(await Promise.all(['FRONT','BACK'].map(async side=>{
      const upload=card.sides[side].upload;if(!upload?.source)return[side,{state:'PENDING'}];
      const {photo}=await intake.readSource(staff,cardId,upload.uploadId);
      if(manual?.draft.source?.sourceHash===card.sourceHash){
        const saved=await readManifest(manual,side);
        if(saved?.images?.inspection&&reviewDisplay){
          try { const preview=await reviewDisplay.inspection(photo,saved.images.inspection,saved.inspectionPreview);
            if(preview)return[side,{state:'READY',preview}];
          } catch(error) { rethrowPreviewControlFailure(error); }
        }
      }
      if(!imageReadUrl)return[side,{state:'PENDING'}];
      let value;
      try { value=await imageReadUrl({kind:'original',descriptor:photo.workingFrame,photo,photoSource:upload.source,contextOnly:true}); }
      catch(error) { rethrowPreviewControlFailure(error);return[side,{state:'FAILED',code:'MANUAL_PREVIEW_UNAVAILABLE',retryable:false}]; }
      return[side,{state:value.preview?'READY':value.displayState?.state??'PENDING',
        ...(value.preview?{preview:value.preview}:{}),...(value.displayState?.code?{code:value.displayState.code}: {}),
        ...(!value.preview&&value.displayState?.retry?{retryable:true,retry:value.displayState.retry}:{})}];
    })));
    const current=(await intake.read(staff,cardId)).card;
    requireThat(current.revision===card.revision&&current.sourceHash===card.sourceHash,409,'MANUAL_PHOTOS_CHANGED');
    if(manual){const after=await workflow.service.read(staff,cardId);requireThat(after.revision===manual.revision&&after.contentHash===manual.contentHash,409,'MANUAL_PHOTOS_CHANGED');}
    return {cardId,sourceHash:card.sourceHash,images};
  };
}
