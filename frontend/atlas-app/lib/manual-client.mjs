import { STAFF_BASE_PATH } from './routes.mjs';
import { readManualResponse } from '@atlas/manual-service/response';
export async function manualRequest(path,{method='GET',body,signal,csrf}={}){
  const response=await fetch(`${STAFF_BASE_PATH}${path}`,{method,credentials:'same-origin',cache:'no-store',signal:signal??AbortSignal.timeout(210000),
    ...(body!==undefined?{headers:{'Content-Type':'application/json','x-atlas-csrf':csrf},body:JSON.stringify(body)}:{})});
  return readManualResponse(response);
}
export function manualMessage(error){
  if(error?.fields)return Object.values(error.fields).join(' ');
  return ({SIGN_IN_REQUIRED:'Your session ended. Sign in again to continue.',CSRF_REQUIRED:'Your session changed. Reload before saving.',
    MANUAL_DETAILS_STALE:'The card details changed. Reload the saved details before continuing.',MANUAL_PHOTOS_CHANGED:'The photos changed. Open the saved photo pair to continue.',
    MANUAL_CARD_PROFILE_REQUIRED:'Choose Sports or Pokémon to continue.',MANUAL_CERTIFICATION_REQUIRED:'A currently trained reviewer must approve the final report.',
    INTAKE_SIDE_UPLOAD_PENDING:'A photo upload is already saved for this side. Resume it before choosing another.',
    INTAKE_SIDE_STALE:'This saved upload is no longer the selected photo. Reload the saved state and use the current photo. Verified earlier originals remain retained.',
    INTAKE_PHOTO_TOO_LARGE:'Choose an original photo smaller than 64 MiB.',
    PHOTO_DECODE_TIMEOUT:'Preparing the working image timed out. Your original is saved. Resume this photo to retry preparation.',
    PHOTO_DECODER_FAILED:'The photo decoder could not finish the working image. Your original is saved. Resume this photo to retry preparation.',
    PHOTO_DECODER_UNAVAILABLE:'The photo decoder is unavailable. Your original is saved; keep the saved upload and retry when processing is available.',
    PHOTO_DECODE_LIMIT:'This photo reached a processing limit. Your original is saved; preparation needs review before another retry. (PHOTO_DECODE_LIMIT)',
    PHOTO_DECODE_INVALID:'The photo decoder could not read this original. The saved file is retained; its format needs review. (PHOTO_DECODE_INVALID)',
    PHOTO_MULTIFRAME_UNSUPPORTED:'This photo contains multiple image frames that the current decoder cannot prepare. Your original is saved. Keep it for a decoder review; uploading the same file again will not resolve this. (PHOTO_MULTIFRAME_UNSUPPORTED)',
    PHOTO_FORMAT_UNSUPPORTED:'This original file format is not supported by the current decoder. Your original is saved; its format needs review. (PHOTO_FORMAT_UNSUPPORTED)',
    PHOTO_HEIC_UNSUPPORTED:'This HEIC photo uses a structure the current decoder cannot prepare. Your original is saved; keep it for a decoder review. (PHOTO_HEIC_UNSUPPORTED)',
    PHOTO_HDR_UNSUPPORTED:'This photo uses an HDR treatment the current decoder cannot safely prepare. Your original is saved; keep it for a decoder review. (PHOTO_HDR_UNSUPPORTED)',
    PHOTO_BIT_DEPTH_UNSUPPORTED:'This photo uses a bit depth the current decoder cannot prepare. Your original is saved; keep it for a decoder review. (PHOTO_BIT_DEPTH_UNSUPPORTED)',
    PHOTO_COLOR_UNSUPPORTED:'This photo uses a color treatment the current decoder cannot safely prepare. Your original is saved; keep it for a decoder review. (PHOTO_COLOR_UNSUPPORTED)',
    PHOTO_GEOMETRY_UNSUPPORTED:'This photo uses an orientation or crop treatment the current decoder cannot safely prepare. Your original is saved; keep it for a decoder review. (PHOTO_GEOMETRY_UNSUPPORTED)',
    PHOTO_DECODER_PROTOCOL:'The photo decoder returned an unusable preparation result. Your original is saved; keep it for a processing review. (PHOTO_DECODER_PROTOCOL)',
    PHOTO_DECODE_CANCELLED:'Working-image preparation stopped before completion. Your original is saved. Resume this photo to check preparation.',
    INTAKE_PHOTO_PROCESSOR_UNAVAILABLE:'Photo preparation is unavailable. Your original is saved; keep the saved upload and retry when processing is available.',
    INTAKE_TEMPORARILY_UNAVAILABLE:'The photo service could not finish this step. Resume this side to check its saved upload. If it fails again, keep the upload for review. (INTAKE_TEMPORARILY_UNAVAILABLE)',
    MANUAL_PENDING_REQUEST:'Resume the saved request before starting another change.',
    MANUAL_STAFF_CHANGED:'The signed-in staff account changed. Reload this page before continuing.',
    IDENTIFICATION_RETRY_NOT_ALLOWED:'This identification attempt cannot be retried yet. Your photos are saved; enter the printed details or contact the owner.',
    IDENTIFICATION_RETRY_STALE:'The saved identification attempt or photos changed. Reload the saved card before retrying.',
    IDENTIFICATION_RETRY_ACTION_CONFLICT:'This saved retry belongs to a different identification attempt. Reload the saved card to continue.',
    DEFECT_ANALYSIS_PENDING:'An analysis is already pending for this card. Check its saved status before starting another.',
    DEFECT_ANALYSIS_REPLACEMENT_INVALID:'The previous analysis changed. Check its saved status before starting a new analysis.',
    MANUAL_ANALYSIS_RECONCILE_REQUIRED:'Check the saved analysis status before starting another request.',
    MANUAL_ASTRA_REVIEW_REQUIRED:'Return to Findings, review both sides and confirm the corrected list. Remaining displayed Astra suggestions need that confirmation before report review.',
    MANUAL_ASTRA_REVIEW_STALE:'The saved suggestion list changed. Reload images and review the current list before confirming.',
    MANUAL_ASTRA_ANALYSIS_PENDING:'Astra analysis is still pending. Check its saved status before confirming findings.',
    MANUAL_CONFIRM_DEADLINE:'Confirmation did not complete within its deadline. Your saved work is retained; check the pending save before continuing.',
    MANUAL_REPORT_STALE:'The saved card changed. Return to Findings and open its current draft report.',
    MANUAL_PROCESSING_BUSY:'Image processing is busy. Your saved work is retained; try again shortly.',
    INTAKE_PAIR_NOT_READY:'Save a Front and Back photo first.',MANUAL_IDENTITY_REQUIRED:'Complete the required card details.',
  })[error?.code]??'This step did not finish. Your saved work is retained. Retry the saved request to continue.';
}
