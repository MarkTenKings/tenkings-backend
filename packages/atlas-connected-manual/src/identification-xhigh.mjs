import sharp from 'sharp';
import { CARD_IDENTIFICATION_FIELDS, CARD_IDENTIFICATION_MAX_PROVIDER_BYTES, CARD_IDENTIFICATION_MAX_PHOTO_BYTES,
  CARD_IDENTIFICATION_DEADLINES, CardIdentificationError, parseCardIdentificationInput,
  buildCardIdentificationOcrRequest, parseCardIdentificationOcrOutput, parseCardIdentificationOutput } from '@tenkings/card-identification-core';
import { CARD_IDENTIFICATION_VERSION_V2, CARD_IDENTIFICATION_SOURCE_COMMIT_V2,
  CARD_IDENTIFICATION_GOOGLE_TEXT_FIELDS_V2, cardIdentificationInputHashV2 } from '@tenkings/card-identification-core/v2';
import { buildCardIdentificationRequest } from '@tenkings/card-identification-core/request';
import { buildPokemonRequestV2 } from '@tenkings/card-identification-core/pokemon-request-v2';
import { digest } from '@atlas/manual-service/contract';

const SIDES=['front','back'];
export const ATLAS_IDENTIFICATION_XHIGH_POLICY=Object.freeze({reasoningEffort:'xhigh',maxOutputTokens:32768,
 deadlines:Object.freeze({model:300000,overall:330000}),maximumDurationMs:335000,runningWindowMs:420000});
const check=(ok,code='malformed_response')=>{if(!ok)throw new CardIdentificationError(code);};
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
function providerJson(bytes){
 check(bytes instanceof Uint8Array&&bytes.byteLength>0&&bytes.byteLength<=CARD_IDENTIFICATION_MAX_PROVIDER_BYTES);
 try{return JSON.parse(Buffer.from(bytes).toString('utf8'));}catch{throw new CardIdentificationError('malformed_response');}
}
async function bounded(work,milliseconds,parent){
 if(parent?.aborted)throw new CardIdentificationError('cancelled');
 const controller=new AbortController();let timedOut=false,rejectAbort;
 const cancel=()=>controller.abort();parent?.addEventListener('abort',cancel,{once:true});
 const timer=setTimeout(()=>{timedOut=true;controller.abort();},milliseconds);
 const aborted=new Promise((_,reject)=>{rejectAbort=()=>reject(new CardIdentificationError(timedOut?'timeout':'cancelled'));controller.signal.addEventListener('abort',rejectAbort,{once:true});});
 try{return await Promise.race([work(controller.signal),aborted]);}
 finally{clearTimeout(timer);parent?.removeEventListener('abort',cancel);controller.signal.removeEventListener('abort',rejectAbort);controller.abort();}
}

/** ATLAS layout v2 owns its longer runtime. The frozen shared identifier stays
 * unchanged. Reuse its exact descriptive prompt, OCR parser and Pokémon rules;
 * the layout adapter validates the resulting full source-bound ATLAS record. */
export async function identifyAtlasCardWithExtendedRuntime(input,effects,options){
 const data=freeze(parseCardIdentificationInput(input)),started=Date.now();
 check(effects&&['readPhoto','ocr','model'].every(key=>typeof effects[key]==='function'),'unavailable');
 check(options&&options.deadlines?.model===ATLAS_IDENTIFICATION_XHIGH_POLICY.deadlines.model
  &&options.deadlines?.overall===ATLAS_IDENTIFICATION_XHIGH_POLICY.deadlines.overall,'invalid_input');
 check(options.timeoutMs===undefined||Number.isSafeInteger(options.timeoutMs)&&options.timeoutMs>0,'invalid_input');
 check(options.signal===undefined||options.signal instanceof AbortSignal,'invalid_input');
 const deadline=stage=>Math.min(options.deadlines[stage]??CARD_IDENTIFICATION_DEADLINES[stage],options.timeoutMs??Infinity);
 return bounded(async signal=>{
  const inputHash=cardIdentificationInputHashV2(data),context={subject:data.subject,inputHash,signal};
  const photoStarted=Date.now();
  const loaded=await Promise.all(SIDES.map(side=>bounded(async readSignal=>{
   const descriptor=data.photos[side],supplied=await effects.readPhoto(descriptor,{...context,side,signal:readSignal});
   check(!readSignal.aborted,'cancelled');
   check(supplied instanceof Uint8Array&&supplied.byteLength===descriptor.byteCount,'unverified_photo');
   const bytes=Buffer.from(supplied);check(digest(bytes)===descriptor.sha256,'unverified_photo');
   const meta=await sharp(bytes,{limitInputPixels:1400*1400,failOn:'warning'}).metadata();
   check(!readSignal.aborted,'cancelled');
   check(meta.format==='jpeg'&&meta.width&&meta.height&&meta.width<=1400&&meta.height<=1400&&(meta.pages??1)===1,'unverified_photo');
   return {bytes,width:meta.width,height:meta.height};
  },deadline('photo_read'),signal)));
  const photos={front:loaded[0],back:loaded[1]},photoElapsed=Math.max(0,Date.now()-photoStarted);
  const ocrStarted=Date.now(),ocrHashes={};
  const recognized=await Promise.all(SIDES.map(async side=>{
   try{return await bounded(async ocrSignal=>{
    const request=freeze({body:buildCardIdentificationOcrRequest(photos[side].bytes),responseFields:CARD_IDENTIFICATION_GOOGLE_TEXT_FIELDS_V2});
    const requestHash=digest(JSON.stringify(request));ocrHashes[side]=requestHash;
    const bytes=await effects.ocr(request,{...context,side,photo:data.photos[side],requestHash,signal:ocrSignal});
    check(!ocrSignal.aborted,'cancelled');return parseCardIdentificationOcrOutput(providerJson(bytes));
   },deadline('ocr'),signal);}catch{if(signal.aborted)throw new CardIdentificationError('cancelled');return {text:'',status:'unavailable'};}
  }));
  const ocr={front:recognized[0],back:recognized[1]},ocrElapsed=Math.max(0,Date.now()-ocrStarted),modelStarted=Date.now();
  let request=buildCardIdentificationRequest(photos,ocr),detail=null;
  if(SIDES.some(side=>/\bpok[eé]mon\b/i.test(ocr[side].text))){
   const {width,height,bytes}=photos.front,region={left:0,top:Math.floor(height/2),width,height:height-Math.floor(height/2)};
   const cropped=await sharp(bytes).extract(region).png().toBuffer();check(!signal.aborted,'cancelled');
   check(cropped.length<=CARD_IDENTIFICATION_MAX_PHOTO_BYTES,'unverified_photo');
   detail={transform:'pokemon-lower-front-png-v1',parent_side:'front',parent_sha256:data.photos.front.sha256,
    source_width:width,source_height:height,region,mime_type:'image/png',byte_count:cropped.length,sha256:digest(cropped)};
   request=buildPokemonRequestV2(request,cropped);
  }
  request=freeze(request);const requestHash=digest(JSON.stringify(request));
  const {suggestions,responseHash}=await bounded(async modelSignal=>{
   const bytes=await effects.model(request,{...context,photos:data.photos,requestHash,pokemonDetail:detail,signal:modelSignal});
   check(!modelSignal.aborted,'cancelled');
   return {suggestions:parseCardIdentificationOutput(providerJson(bytes)),responseHash:digest(bytes)};
  },deadline('model'),signal);
  const modelElapsed=Math.max(0,Date.now()-modelStarted);
  return freeze({suggestions,warnings:[
   'Review the suggested details before saving.',
   ...SIDES.filter(side=>ocr[side].status!=='read').map(side=>`${side==='front'?'Front':'Back'} text ${ocr[side].status==='empty'?'was not readable':'recognition was unavailable'}; suggestions use the photos.`),
   ...(CARD_IDENTIFICATION_FIELDS.some(field=>suggestions[field].value===null||suggestions[field].confidence==='low')?['Some details are uncertain or missing. Check those fields on the card.']:[]),
  ],provenance:{engine_version:CARD_IDENTIFICATION_VERSION_V2,source_commit:CARD_IDENTIFICATION_SOURCE_COMMIT_V2,
   subject:data.subject,photos:data.photos,input_sha256:inputHash,request_sha256:requestHash,response_sha256:responseHash,
   model:'gpt-6-astra',reasoning_effort:'low',identified_at:new Date().toISOString(),elapsed_ms:Math.max(0,Date.now()-started),
   stage_timings_ms:{photo_read:photoElapsed,ocr:ocrElapsed,model:modelElapsed},
   ocr:{provider:'google_vision',front:ocr.front.status,back:ocr.back.status,response_fields:CARD_IDENTIFICATION_GOOGLE_TEXT_FIELDS_V2,request_sha256:ocrHashes},
   pokemon_detail:detail,knowledge:null}});
 },deadline('overall'),options.signal).catch(error=>{if(error instanceof CardIdentificationError)throw error;throw new CardIdentificationError('provider_error');});
}
