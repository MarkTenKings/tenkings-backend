import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { CARD_IDENTIFICATION_VERSION, parseCardIdentificationInput, parseCardIdentificationResult } from '@tenkings/card-identification-core';
import { CARD_IDENTIFICATION_VERSION_V2, CARD_IDENTIFICATION_GOOGLE_TEXT_FIELDS_V2,
  identifyCardV2, parseCardIdentificationResultV2 } from '@tenkings/card-identification-core/v2';
import { canonical, digest, object, requireThat } from '@atlas/manual-service/contract';

// Input is immutable in PostgreSQL. Historical bare inputs keep V1 semantics;
// new attempts bind V2 before any dispatch. Never infer a version from a reply.
function storedInput(row) {
  const saved = JSON.parse(row.input);
  if (saved && Object.hasOwn(saved, 'engineVersion')) {
    object(saved, ['engineVersion', 'input']);
    requireThat(saved.engineVersion === CARD_IDENTIFICATION_VERSION_V2, 503, 'IDENTIFICATION_VERSION_UNSUPPORTED');
    return { engineVersion: saved.engineVersion, input: parseCardIdentificationInput(saved.input), parseResult: parseCardIdentificationResultV2 };
  }
  return { engineVersion: CARD_IDENTIFICATION_VERSION, input: parseCardIdentificationInput(saved), parseResult: parseCardIdentificationResult };
}

// Only HTTP and credentials live here. The shared engine owns every prompt,
// schema, model setting and OCR/model deadline. SDK retries are not used.
export function identificationEffects({ openaiKey, googleKey, fetchImpl=fetch }) {
  requireThat(typeof openaiKey==='string' && openaiKey.length>=16 && typeof googleKey==='string' && googleKey.length>=16,503,'IDENTIFICATION_NOT_CONFIGURED');
  async function send(url,request,headers,signal) {
    const response=await fetchImpl(url,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(request),signal});
    const reader=response.body?.getReader(); requireThat(reader,503,'IDENTIFICATION_PROVIDER_UNAVAILABLE');
    const chunks=[];let length=0;
    try { while(true){const next=await reader.read();if(next.done)break;length+=next.value.length;requireThat(length<=262144,503,'IDENTIFICATION_RESPONSE_TOO_LARGE');chunks.push(Buffer.from(next.value));}
      const bytes=Buffer.concat(chunks,length);
      // Retain bounded actual replies, including non-2xx replies, before parsing.
      return {bytes,status:response.status};
    } finally {await reader.cancel().catch(()=>{});}
  }
  return { ocr:(request,context)=>{
      const version=context.engineVersion ?? CARD_IDENTIFICATION_VERSION;
      requireThat([CARD_IDENTIFICATION_VERSION,CARD_IDENTIFICATION_VERSION_V2].includes(version),503,'IDENTIFICATION_VERSION_UNSUPPORTED');
      const url=new URL('https://vision.googleapis.com/v1/images:annotate');
      let body=request;
      if(version===CARD_IDENTIFICATION_VERSION_V2){
        object(request,['body','responseFields']);
        requireThat(request.responseFields===CARD_IDENTIFICATION_GOOGLE_TEXT_FIELDS_V2,503,'IDENTIFICATION_OCR_FIELDS_INVALID');
        url.searchParams.set('fields',request.responseFields);body=request.body;
      }
      return send(url.href,body,{'X-Goog-Api-Key':googleKey},context.signal);
    },
    model:(request,context)=>send('https://api.openai.com/v1/responses',request,{Authorization:`Bearer ${openaiKey}`},context.signal) };
}

export function createIdentification({ boundary,intake,intakeRepository,storage,artifacts,details,effects=null,receiptClient=null }) {
  requireThat(!effects || typeof receiptClient?.$queryRawUnsafe==='function',503,'IDENTIFICATION_RECEIPT_STORE_REQUIRED');
  async function transaction(staff,cardId,work,{sourceHash=null,edit=false}={}) {
    return boundary.transaction(staff,async context=>{
      await intakeRepository.authorizeInTransaction(context.tx,context.principal,cardId,{edit,lock:'SHARE'});
      if(sourceHash)await intakeRepository.assertCurrentPair(context.tx,context.principal,{cardId,sourceHash});
      return work(context);
    });
  }
  async function read(staff,cardId,sourceHash) {
    return transaction(staff,cardId,async ({tx})=>{
      const [row]=await tx.$queryRawUnsafe('SELECT * FROM atlas_manual_connected.identification WHERE card_id=$1::uuid AND source_hash=$2',cardId,sourceHash);
      return row??null;
    });
  }
  async function checkedResult(staff,cardId,sourceHash,result){
    await transaction(staff,cardId,async()=>undefined,{sourceHash});return result;
  }
  async function project(staff,row) {
    if(!row)return {state:effects?'NOT_STARTED':'UNAVAILABLE'};
    const saved=storedInput(row);
    const state=row.state==='RUNNING' && Date.now()-new Date(row.created_at).getTime()>120000?'UNKNOWN':row.state;
    const value={attemptId:row.id,state,startedAt:new Date(row.created_at).toISOString()};
    if(row.result){const stored=JSON.parse(row.result); const result=await artifacts.read(stored.ref,{cardId:row.card_id,kind:'IDENTIFICATION_RESULT',sourceHash:row.source_hash});
      value.result=saved.parseResult(result,saved.input);}
    return value;
  }
  async function asset(cardId,kind,value,sourceHash){return {ref:await artifacts.write(value,{cardId,kind,sourceHash})};}
  async function event(staff,row,stage,eventName,requestHash,evidence,requireCurrent=false,signal=null) {
    if(eventName!=='DISPATCH'){
      const receipt=canonical(evidence);
      // Retry only the same already-received receipt, never provider dispatch.
      for(let attempt=0;attempt<3;attempt++){
        try{return await receiptClient.$queryRawUnsafe('SELECT atlas_manual_connected.append_receipt($1::uuid,$2,$3,$4,$5)',row.id,stage,eventName,requestHash,receipt);}
        catch(error){if(attempt===2)throw error;}
      }
    }
    return transaction(staff,row.card_id,async ({tx})=>{
      requireThat(!signal?.aborted,503,'IDENTIFICATION_CANCELLED');
      const text=canonical(evidence);
      const changed=await tx.$executeRawUnsafe('INSERT INTO atlas_manual_connected.effect(attempt_id,stage,event,request_hash,evidence) VALUES($1::uuid,$2,$3,$4,$5) ON CONFLICT DO NOTHING',row.id,stage,eventName,requestHash,text);
      requireThat(changed===1,409,'IDENTIFICATION_EFFECT_ALREADY_DISPATCHED');
    },{edit:true,sourceHash:requireCurrent?row.source_hash:null});
  }
  async function settle(staff,row,state,result=null,error=null) {
    return transaction(staff,row.card_id,async ({tx})=>{
      await tx.$executeRawUnsafe("UPDATE atlas_manual_connected.identification SET state=$1,result=$2,error=$3,finished_at=clock_timestamp() WHERE id=$4::uuid AND state='RUNNING'",state,result?canonical(result):null,error,row.id);
    },{edit:true});
  }
  return Object.freeze({
    async status(staff,cardId){const {card}=await intake.read(staff,cardId);const result=await project(staff,card.ready?await read(staff,cardId,card.sourceHash):null);
      const latest=(await intake.read(staff,cardId)).card;requireThat(latest.sourceHash===card.sourceHash,409,'INTAKE_PAIR_STALE');return result;},
    async run(staff,cardId) {
      const pair=await intake.verifiedPair(staff,cardId);
      const existing=await read(staff,cardId,pair.sourceHash);
      if(existing){
        const value=await project(staff,existing);
        // Reconcile a saved result whose separate suggestion adoption reply was
        // lost. No new OCR/model dispatch is involved.
        if(value.state==='COMPLETE')await details.adopt(staff,cardId,pair.sourceHash,value.result);
        return checkedResult(staff,cardId,pair.sourceHash,value);
      }
      if(!effects)return {state:'UNAVAILABLE'};
      const photos={},loaded=new Map();
      for(const [side,slot] of Object.entries(pair.sides)){
        const photo=slot.photo, found=await storage.readDecodedFrame({frame:photo.workingFrame,original:photo.original,decodePlan:photo.decodePlan});
        const bytes=await sharp(found.bytes,{limitInputPixels:52_000_000,failOn:'warning'}).resize(1400,1400,{fit:'inside',withoutEnlargement:true}).jpeg({quality:92}).toBuffer();
        requireThat(bytes.length<=3*1024*1024,422,'IDENTIFICATION_PHOTO_TOO_LARGE');
        const sha256=digest(bytes), saved=await asset(cardId,'IDENTIFICATION_IMAGE',{base64:bytes.toString('base64'),mime:'image/jpeg',workingFrame:photo.workingFrame,original:photo.original},pair.sourceHash);
        photos[side.toLowerCase()]={ref:saved.ref.key,sha256,byteCount:bytes.length};loaded.set(saved.ref.key,bytes);
      }
      const input=parseCardIdentificationInput({subject:{id:cardId,revision:pair.sourceHash},photos});
      const savedInput={engineVersion:CARD_IDENTIFICATION_VERSION_V2,input};
      const row=await transaction(staff,cardId,async ({tx,principal})=>{
        const id=randomUUID(); const count=await tx.$executeRawUnsafe("INSERT INTO atlas_manual_connected.identification(id,card_id,source_hash,actor_id,state,input) VALUES($1::uuid,$2::uuid,$3,$4::uuid,'RUNNING',$5) ON CONFLICT(card_id,source_hash) DO NOTHING",id,cardId,pair.sourceHash,principal.id,canonical(savedInput));
        const [row]=await tx.$queryRawUnsafe('SELECT * FROM atlas_manual_connected.identification WHERE card_id=$1::uuid AND source_hash=$2',cardId,pair.sourceHash);
        return {...row,won:count===1};
      },{edit:true,sourceHash:pair.sourceHash});
      if(!row.won)return checkedResult(staff,cardId,pair.sourceHash,await project(staff,row));
      const saved=storedInput(row);
      requireThat(saved.engineVersion===CARD_IDENTIFICATION_VERSION_V2,503,'IDENTIFICATION_VERSION_UNSUPPORTED');
      let dispatched=false;
      const effect=kind=>async(request,context)=>{
        requireThat(!context.signal.aborted,503,'IDENTIFICATION_CANCELLED');
        const stage=kind==='model'?'MODEL':`OCR_${context.side.toUpperCase()}`;
        const requestJson=JSON.stringify(request);
        requireThat(digest(requestJson)===context.requestHash,503,'IDENTIFICATION_REQUEST_HASH_INVALID');
        const requestEvidence=await asset(cardId,'IDENTIFICATION_REQUEST',{engineVersion:saved.engineVersion,requestJson,requestHash:context.requestHash,stage,attemptId:row.id},pair.sourceHash);
        requireThat(!context.signal.aborted,503,'IDENTIFICATION_CANCELLED');
        await event(staff,row,stage,'DISPATCH',context.requestHash,requestEvidence,true,context.signal);
        // Once the durable claim exists, any uncertainty retains the attempt.
        // No recovery path starts another provider request for this source pair.
        dispatched=true;
        requireThat(!context.signal.aborted,503,'IDENTIFICATION_CANCELLED');
        try {
          const response=await effects[kind](request,{...context,engineVersion:saved.engineVersion});
          requireThat(response?.bytes instanceof Uint8Array && response.bytes.length<=262144,503,'IDENTIFICATION_PROVIDER_UNAVAILABLE');
          const bytes=Buffer.from(response.bytes);let usage=null;
          try {const body=JSON.parse(bytes);usage=body?.usage??null;}catch{}
          const responseEvidence=await asset(cardId,'IDENTIFICATION_RESPONSE',{engineVersion:saved.engineVersion,attemptId:row.id,stage,status:response.status,base64:bytes.toString('base64'),sha256:digest(bytes),usage},pair.sourceHash);
          await event(staff,row,stage,'RESPONSE',context.requestHash,responseEvidence);
          requireThat(response.status>=200&&response.status<300,503,'IDENTIFICATION_PROVIDER_UNAVAILABLE');return bytes;
        } catch(error){
          await event(staff,row,stage,'FAILURE',context.requestHash,{outcome:'UNKNOWN_OR_REJECTED',code:'IDENTIFICATION_EFFECT_FAILED'}).catch(()=>{});
          throw error;
        }
      };
      try {
        const result=await identifyCardV2(saved.input,{readPhoto:async descriptor=>loaded.get(descriptor.ref),ocr:effect('ocr'),model:effect('model')});
        const stored=await asset(cardId,'IDENTIFICATION_RESULT',result,pair.sourceHash);
        try {await details.adopt(staff,cardId,pair.sourceHash,result);}
        catch(error){if(error?.status===409){await settle(staff,row,'STALE',stored);return {attemptId:row.id,state:'STALE'};}throw error;}
        await settle(staff,row,'COMPLETE',stored);
        return await checkedResult(staff,cardId,pair.sourceHash,{attemptId:row.id,state:'COMPLETE',result});
      } catch(error){
        await settle(staff,row,dispatched?'UNKNOWN':'FAILED',null,'IDENTIFICATION_UNAVAILABLE').catch(()=>{});
        return {attemptId:row.id,state:dispatched?'UNKNOWN':'FAILED'};
      }
    },
  });
}
