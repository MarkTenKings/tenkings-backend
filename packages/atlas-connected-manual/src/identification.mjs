import {ATLAS_IDENTIFICATION_LAYOUT_VERSION,identifyAtlasCard,parseAtlasIdentificationResult} from './identification-layout.mjs';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { CARD_IDENTIFICATION_VERSION, parseCardIdentificationInput, parseCardIdentificationResult } from '@tenkings/card-identification-core';
import { CARD_IDENTIFICATION_VERSION_V2, CARD_IDENTIFICATION_GOOGLE_TEXT_FIELDS_V2,
  identifyCardV2, parseCardIdentificationResultV2 } from '@tenkings/card-identification-core/v2';
import { canonical, digest, object, requireThat, uuid } from '@atlas/manual-service/contract';
import { recordedIdentificationEffect, isCreditBalanceRejection, prepareIdentificationRecovery } from './identification-recovery.mjs';

// Input is immutable in PostgreSQL. Historical bare inputs keep V1 semantics;
// new attempts bind V2 before any dispatch. Never infer a version from a reply.
function storedInput(row) {
  const saved = JSON.parse(row.input);
  if (saved && Object.hasOwn(saved, 'engineVersion')) {
    object(saved, ['engineVersion', 'input']);
    requireThat([CARD_IDENTIFICATION_VERSION_V2,ATLAS_IDENTIFICATION_LAYOUT_VERSION].includes(saved.engineVersion), 503, 'IDENTIFICATION_VERSION_UNSUPPORTED');
    return { engineVersion: saved.engineVersion, input: parseCardIdentificationInput(saved.input), parseResult: saved.engineVersion===ATLAS_IDENTIFICATION_LAYOUT_VERSION?parseAtlasIdentificationResult:parseCardIdentificationResultV2 };
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
      requireThat([CARD_IDENTIFICATION_VERSION,CARD_IDENTIFICATION_VERSION_V2,ATLAS_IDENTIFICATION_LAYOUT_VERSION].includes(version),503,'IDENTIFICATION_VERSION_UNSUPPORTED');
      const url=new URL('https://vision.googleapis.com/v1/images:annotate');
      let body=request;
      if(version!==CARD_IDENTIFICATION_VERSION){
        object(request,['body','responseFields']);
        requireThat(request.responseFields===CARD_IDENTIFICATION_GOOGLE_TEXT_FIELDS_V2,503,'IDENTIFICATION_OCR_FIELDS_INVALID');
        url.searchParams.set('fields',request.responseFields);body=request.body;
      }
      return send(url.href,body,{'X-Goog-Api-Key':googleKey},context.signal);
    },
    model:(request,context)=>send('https://api.openai.com/v1/responses',request,{Authorization:`Bearer ${openaiKey}`},context.signal) };
}

export function createIdentification({ boundary,intake,intakeRepository,storage,artifacts,details,effects=null,receiptClient=null,engineVersion=ATLAS_IDENTIFICATION_LAYOUT_VERSION }) {
  requireThat([CARD_IDENTIFICATION_VERSION_V2,ATLAS_IDENTIFICATION_LAYOUT_VERSION].includes(engineVersion),503,'IDENTIFICATION_VERSION_UNSUPPORTED');
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
      const [row]=await tx.$queryRawUnsafe('SELECT i.* FROM atlas_manual_connected.identification i WHERE i.card_id=$1::uuid AND i.source_hash=$2 AND NOT EXISTS(SELECT 1 FROM atlas_manual_connected.identification child WHERE child.retry_of=i.id)',cardId,sourceHash);
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
    if(state==='UNKNOWN' && row.state==='UNKNOWN' && [CARD_IDENTIFICATION_VERSION_V2,ATLAS_IDENTIFICATION_LAYOUT_VERSION].includes(saved.engineVersion)){
      try{
        const access=recoveryAccess(staff,row), model=await recordedIdentificationEffect(row,'MODEL',access);
        if(model.status<200 || model.status>=300){
          value.rejection={code:isCreditBalanceRejection(model)?'API_CREDIT_BALANCE_EXHAUSTED':'API_REQUEST_REJECTED',canRetry:false};
          if(isCreditBalanceRejection(model) && effects){
            await prepareIdentificationRecovery(row,access,model);
            await requireUninitialized(staff,row);
            value.rejection.canRetry=true;
          }
        }
      }catch{/* Missing, malformed or uncertain evidence never enables paid work. */}
    }
    return value;
  }
  function recoveryAccess(staff,row){
    return {
      events:record=>transaction(staff,row.card_id,({tx})=>tx.$queryRawUnsafe('SELECT * FROM atlas_manual_connected.effect WHERE attempt_id=$1::uuid',record.id)),
      attempt:id=>transaction(staff,row.card_id,async({tx})=>{
        const [value]=await tx.$queryRawUnsafe('SELECT * FROM atlas_manual_connected.identification WHERE id=$1::uuid AND card_id=$2::uuid AND source_hash=$3',id,row.card_id,row.source_hash);
        return value??null;
      }),
      artifact:async(record,kind,evidence)=>{
        object(evidence,['ref']);
        return artifacts.read(evidence.ref,{cardId:row.card_id,kind,sourceHash:row.source_hash});
      },
    };
  }
  async function requireUninitialized(staff,row){
    return transaction(staff,row.card_id,async({tx})=>{
      const [manual]=await tx.$queryRawUnsafe('SELECT id FROM atlas_manual.card WHERE id=$1::uuid',row.card_id);
      requireThat(!manual,409,'IDENTIFICATION_RETRY_NOT_ALLOWED');
    });
  }
  async function asset(cardId,kind,value,sourceHash){return {ref:await artifacts.write(value,{cardId,kind,sourceHash})};}
  async function event(staff,row,stage,eventName,requestHash,evidence,requireCurrent=false,signal=null,dispatchSignal=null) {
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
      dispatchSignal?.throwIfAborted();
      if(row.retry_of){
        // Provisioning takes a SHARE lock on these details before creating the
        // workspace. Resolve that race before committing a new paid dispatch.
        await tx.$queryRawUnsafe('SELECT * FROM atlas_manual_connected.details WHERE card_id=$1::uuid FOR UPDATE',row.card_id);
        const [manual]=await tx.$queryRawUnsafe('SELECT id FROM atlas_manual.card WHERE id=$1::uuid',row.card_id);
        requireThat(!manual,409,'IDENTIFICATION_RETRY_NOT_ALLOWED');
      }
      const text=canonical(evidence);
      dispatchSignal?.throwIfAborted();
      const changed=await tx.$executeRawUnsafe('INSERT INTO atlas_manual_connected.effect(attempt_id,stage,event,request_hash,evidence) VALUES($1::uuid,$2,$3,$4,$5) ON CONFLICT DO NOTHING',row.id,stage,eventName,requestHash,text);
      requireThat(changed===1,409,'IDENTIFICATION_EFFECT_ALREADY_DISPATCHED');
      dispatchSignal?.throwIfAborted();
    },{edit:true,sourceHash:requireCurrent?row.source_hash:null});
  }
  async function settle(staff,row,state,result=null,error=null) {
    return transaction(staff,row.card_id,async ({tx})=>{
      await tx.$executeRawUnsafe("UPDATE atlas_manual_connected.identification SET state=$1,result=$2,error=$3,finished_at=clock_timestamp() WHERE id=$4::uuid AND state='RUNNING'",state,result?canonical(result):null,error,row.id);
    },{edit:true});
  }
  async function execute(staff,seedRow,loaded,recovery=null,dispatchSignal=null){
    const saved=storedInput(seedRow);
    const cardId=seedRow.card_id, pair={sourceHash:seedRow.source_hash};
    let row=recovery?null:seedRow, claimError=null, claimStarted=false;
    const verifiedOcr=new Set();
      requireThat([CARD_IDENTIFICATION_VERSION_V2,ATLAS_IDENTIFICATION_LAYOUT_VERSION].includes(saved.engineVersion),503,'IDENTIFICATION_VERSION_UNSUPPORTED');
      let dispatched=false;
      const effect=kind=>async(request,context)=>{
        requireThat(!context.signal.aborted,503,'IDENTIFICATION_CANCELLED');
        dispatchSignal?.throwIfAborted();
        const stage=kind==='model'?'MODEL':`OCR_${context.side.toUpperCase()}`;
        const requestJson=JSON.stringify(request);
        requireThat(digest(requestJson)===context.requestHash,503,'IDENTIFICATION_REQUEST_HASH_INVALID');
        const requestEvidence=await asset(cardId,'IDENTIFICATION_REQUEST',{engineVersion:saved.engineVersion,requestJson,requestHash:context.requestHash,stage,attemptId:row.id},pair.sourceHash);
        requireThat(!context.signal.aborted,503,'IDENTIFICATION_CANCELLED');
        await event(staff,row,stage,'DISPATCH',context.requestHash,requestEvidence,true,context.signal,dispatchSignal);
        // Once the durable claim exists, any uncertainty retains the attempt.
        // Only a separately claimed, verified human retry can start a successor.
        dispatched=true;
        requireThat(!context.signal.aborted,503,'IDENTIFICATION_CANCELLED');
        dispatchSignal?.throwIfAborted();
        try {
          // The admission signal stops only new effects. An in-flight request
          // keeps the engine deadline and always retains its real response.
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
        const identify=saved.engineVersion===ATLAS_IDENTIFICATION_LAYOUT_VERSION?identifyAtlasCard:identifyCardV2;
        const result=await identify(saved.input,{
          readPhoto:async descriptor=>loaded.get(descriptor.ref),
          ocr:recovery?async(request,context)=>{
            const cached=recovery.ocr[context.side];
            requireThat(cached && JSON.stringify(request)===cached.requestJson && context.requestHash===cached.requestHash,409,'IDENTIFICATION_RETRY_NOT_ALLOWED');
            verifiedOcr.add(context.side);
            return Buffer.from(cached.bytes);
          }:effect('ocr'),
          model:recovery?async(request,context)=>{
            requireThat(verifiedOcr.size===2 && JSON.stringify(request)===recovery.model.requestJson && context.requestHash===recovery.model.requestHash,409,'IDENTIFICATION_RETRY_NOT_ALLOWED');
            claimStarted=true;
            try{row=await recovery.claim(context.signal);}catch(error){claimError=error;throw error;}
            requireThat(row.won,409,'IDENTIFICATION_RETRY_REPLAY');
            return effect('model')(request,context);
          }:effect('model'),
        });
        const stored=await asset(cardId,'IDENTIFICATION_RESULT',result,pair.sourceHash);
        try {await details.adopt(staff,cardId,pair.sourceHash,result);}
        catch(error){if(error?.status===409){await settle(staff,row,'STALE',stored);return {attemptId:row.id,state:'STALE'};}throw error;}
        await settle(staff,row,'COMPLETE',stored);
        return await checkedResult(staff,cardId,pair.sourceHash,{attemptId:row.id,state:'COMPLETE',result});
      } catch(error){
        if(recovery && !row){
          if(claimError)throw claimError;
          // A slow transaction may still acknowledge a committed child. Keep
          // the browser's exact action journal until same-action readback.
          requireThat(!claimStarted,503,'IDENTIFICATION_RETRY_CLAIM_UNCERTAIN');
          requireThat(false,409,'IDENTIFICATION_RETRY_NOT_ALLOWED');
        }
        if(recovery && !row.won)return checkedResult(staff,cardId,pair.sourceHash,await project(staff,row));
        let persisted=false;
        try{await settle(staff,row,dispatched?'UNKNOWN':'FAILED',null,'IDENTIFICATION_UNAVAILABLE');persisted=true;}catch{}
        if(!persisted)return {attemptId:row.id,state:dispatched?'UNKNOWN':'FAILED'};
        const terminal={...row,state:dispatched?'UNKNOWN':'FAILED',result:null,finished_at:new Date()};
        return project(staff,terminal);
      }
  }
  return Object.freeze({
    async status(staff,cardId){const {card}=await intake.read(staff,cardId);const result=await project(staff,card.ready?await read(staff,cardId,card.sourceHash):null);
      const latest=(await intake.read(staff,cardId)).card;requireThat(latest.sourceHash===card.sourceHash,409,'INTAKE_PAIR_STALE');return result;},
    async retry(staff,cardId,input){
      object(input,['actionId','expectedAttemptId','sourceHash']);uuid(input.actionId);uuid(input.expectedAttemptId);
      requireThat(typeof input.sourceHash==='string' && /^[a-f0-9]{64}$/.test(input.sourceHash));
      input=structuredClone(input);
      requireThat(effects,409,'IDENTIFICATION_RETRY_NOT_ALLOWED');
      const pair=await intake.verifiedPair(staff,cardId);
      requireThat(pair.sourceHash===input.sourceHash,409,'INTAKE_PAIR_STALE');
      const replay=async tx=>{
        const [found]=await tx.$queryRawUnsafe('SELECT * FROM atlas_manual_connected.identification WHERE card_id=$1::uuid AND retry_action_id=$2::uuid',cardId,input.actionId);
        if(found)requireThat(found.retry_of===input.expectedAttemptId && found.source_hash===input.sourceHash && found.actor_id===staff.id,409,'IDENTIFICATION_RETRY_ACTION_CONFLICT');
        return found??null;
      };
      const prior=await transaction(staff,cardId,({tx})=>replay(tx),{edit:true,sourceHash:input.sourceHash});
      if(prior)return checkedResult(staff,cardId,input.sourceHash,await project(staff,prior));
      const parent=await transaction(staff,cardId,async({tx})=>{
        const [found]=await tx.$queryRawUnsafe('SELECT * FROM atlas_manual_connected.identification WHERE id=$1::uuid AND card_id=$2::uuid AND source_hash=$3',input.expectedAttemptId,cardId,input.sourceHash);
        return found??null;
      },{edit:true,sourceHash:input.sourceHash});
      requireThat(parent?.id===input.expectedAttemptId,409,'IDENTIFICATION_RETRY_STALE');
      await requireUninitialized(staff,parent);
      let evidence;
      try{evidence=await prepareIdentificationRecovery(parent,recoveryAccess(staff,parent));}
      catch{requireThat(false,409,'IDENTIFICATION_RETRY_NOT_ALLOWED');}
      const claim=signal=>transaction(staff,cardId,async({tx,principal})=>{
        requireThat(!signal.aborted,503,'IDENTIFICATION_CANCELLED');
        const [locked]=await tx.$queryRawUnsafe('SELECT * FROM atlas_manual_connected.identification WHERE id=$1::uuid AND card_id=$2::uuid AND source_hash=$3 FOR UPDATE',parent.id,cardId,input.sourceHash);
        const known=await replay(tx);if(known)return {...known,won:false};
        requireThat(locked?.state==='UNKNOWN' && locked.input===parent.input && locked.result===null,409,'IDENTIFICATION_RETRY_STALE');
        const [child]=await tx.$queryRawUnsafe('SELECT * FROM atlas_manual_connected.identification WHERE retry_of=$1::uuid',parent.id);
        requireThat(!child,409,'IDENTIFICATION_RETRY_STALE');
        const [manual]=await tx.$queryRawUnsafe('SELECT id FROM atlas_manual.card WHERE id=$1::uuid',cardId);
        requireThat(!manual,409,'IDENTIFICATION_RETRY_NOT_ALLOWED');
        requireThat(!signal.aborted,503,'IDENTIFICATION_CANCELLED');
        const id=randomUUID();
        const count=await tx.$executeRawUnsafe("INSERT INTO atlas_manual_connected.identification(id,card_id,source_hash,actor_id,state,input,retry_of,retry_action_id,evidence_attempt_id) VALUES($1::uuid,$2::uuid,$3,$4::uuid,'RUNNING',$5,$6::uuid,$7::uuid,$8::uuid) ON CONFLICT DO NOTHING",id,cardId,input.sourceHash,principal.id,parent.input,parent.id,input.actionId,evidence.rootId);
        const found=await replay(tx);
        requireThat(found,409,'IDENTIFICATION_RETRY_ACTION_CONFLICT');
        return {...found,won:count===1};
      },{edit:true,sourceHash:input.sourceHash});
      return execute(staff,parent,evidence.loaded,{...evidence,claim});
    },
    async run(staff,cardId,{dispatchSignal}={}) {
      dispatchSignal?.throwIfAborted();
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
        dispatchSignal?.throwIfAborted();
        const photo=slot.photo, found=await storage.readDecodedFrame({frame:photo.workingFrame,original:photo.original,decodePlan:photo.decodePlan});
        const bytes=await sharp(found.bytes,{limitInputPixels:52_000_000,failOn:'warning'}).resize(1400,1400,{fit:'inside',withoutEnlargement:true}).jpeg({quality:92}).toBuffer();
        requireThat(bytes.length<=3*1024*1024,422,'IDENTIFICATION_PHOTO_TOO_LARGE');
        const sha256=digest(bytes), saved=await asset(cardId,'IDENTIFICATION_IMAGE',{base64:bytes.toString('base64'),mime:'image/jpeg',workingFrame:photo.workingFrame,original:photo.original},pair.sourceHash);
        photos[side.toLowerCase()]={ref:saved.ref.key,sha256,byteCount:bytes.length};loaded.set(saved.ref.key,bytes);
      }
      const input=parseCardIdentificationInput({subject:{id:cardId,revision:pair.sourceHash},photos});
      const savedInput={engineVersion,input};
      dispatchSignal?.throwIfAborted();
      const row=await transaction(staff,cardId,async ({tx,principal})=>{
        dispatchSignal?.throwIfAborted();
        const id=randomUUID(); const count=await tx.$executeRawUnsafe("INSERT INTO atlas_manual_connected.identification(id,card_id,source_hash,actor_id,state,input) VALUES($1::uuid,$2::uuid,$3,$4::uuid,'RUNNING',$5) ON CONFLICT(card_id,source_hash) WHERE retry_of IS NULL DO NOTHING",id,cardId,pair.sourceHash,principal.id,canonical(savedInput));
        const [row]=await tx.$queryRawUnsafe('SELECT i.* FROM atlas_manual_connected.identification i WHERE i.card_id=$1::uuid AND i.source_hash=$2 AND NOT EXISTS(SELECT 1 FROM atlas_manual_connected.identification child WHERE child.retry_of=i.id)',cardId,pair.sourceHash);
        dispatchSignal?.throwIfAborted();
        return {...row,won:count===1};
      },{edit:true,sourceHash:pair.sourceHash});
      if(!row.won)return checkedResult(staff,cardId,pair.sourceHash,await project(staff,row));
      return execute(staff,row,loaded,null,dispatchSignal);
    },
  });
}
