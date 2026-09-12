import { STAFF_BASE_PATH } from './routes.mjs';
export async function manualRequest(path,{method='GET',body,signal,csrf}={}){
  const response=await fetch(`${STAFF_BASE_PATH}${path}`,{method,credentials:'same-origin',cache:'no-store',signal:signal??AbortSignal.timeout(210000),
    ...(body!==undefined?{headers:{'Content-Type':'application/json','x-atlas-csrf':csrf},body:JSON.stringify(body)}:{})});
  const result=await response.json();if(!response.ok)throw Object.assign(new Error(result.error??'Save unavailable'),{code:result.error,status:response.status,fields:result.fields});return result;
}
export function manualMessage(error){
  if(error?.fields)return Object.values(error.fields).join(' ');
  return ({SIGN_IN_REQUIRED:'Your session ended. Sign in again to continue.',CSRF_REQUIRED:'Your session changed. Reload before saving.',
    MANUAL_DETAILS_STALE:'The card details changed. Reload the saved details before continuing.',MANUAL_PHOTOS_CHANGED:'The photos changed. Open the saved photo pair to continue.',
    MANUAL_CARD_PROFILE_REQUIRED:'Choose Sports or Pokémon to continue.',MANUAL_CERTIFICATION_REQUIRED:'A currently trained reviewer must approve the final report.',
    INTAKE_SIDE_UPLOAD_PENDING:'A photo upload is already saved for this side. Resume it before choosing another.',
    INTAKE_PHOTO_TOO_LARGE:'Choose an original photo smaller than 64 MiB.',
    MANUAL_PENDING_REQUEST:'Resume the saved request before starting another change.',
    MANUAL_STAFF_CHANGED:'The signed-in staff account changed. Reload this page before continuing.',
    MANUAL_PROCESSING_BUSY:'Image processing is busy. Your saved work is retained; try again shortly.',
    INTAKE_PAIR_NOT_READY:'Save a Front and Back photo first.',MANUAL_IDENTITY_REQUIRED:'Complete the required card details.',
  })[error?.code]??'This step did not finish. Your saved work is retained. Retry the saved request to continue.';
}
