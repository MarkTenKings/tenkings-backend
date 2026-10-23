import {createHash} from 'node:crypto';
import {canonicalJSON,requireValue} from './contract.mjs';
import {decoderContractData,decoderExact,decoderFreeze} from './proof-decoder-profile.mjs';
import {engineDataOptions,parseProofDecoderEngineJSON} from './proof-decoder-engine-json.mjs';
import {assertProofDecoderPlan,assertProofDecoderValidation,PROOF_DECODER_LIMITS} from './proof-decoder-protocol.mjs';

export const TARGET_BROKER_SCHEMA='atlas-proof-decoder-target-broker-v2';
export const TARGET_BROKER_SOCKET='/run/atlas-r2-decoder/broker.sock';
export const TARGET_BROKER_CHUNK=65536;
const types=Object.freeze({HELLO:1,START:2,ACCEPT:3,DATA:4,INPUT_END:5,CANCEL:6,TERMINAL:7});
const names=Object.fromEntries(Object.entries(types).map(([key,value])=>[value,key]));
const caps={HELLO:2048,START:2048,ACCEPT:1024,DATA:TARGET_BROKER_CHUNK,INPUT_END:256,CANCEL:256,TERMINAL:4096};
const check=value=>requireValue(value,'DECODER_BROKER_PROTOCOL');
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
export function brokerNanoseconds(value){check(typeof value==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(value)&&BigInt(value)<=18446744073709551615n);return BigInt(value);}
function metadata(type,input){
  const value=decoderContractData(input);
  if(type==='HELLO'){
    decoderExact(value,['schema','bootId','epoch','bindingHash','profileHash','limitsHash','nonce','nowNs']);
    check(value.schema===TARGET_BROKER_SCHEMA&&typeof value.bootId==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.bootId)&&typeof value.epoch==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value.epoch)&&digest(value.bindingHash)&&digest(value.profileHash)&&digest(value.limitsHash)&&digest(value.nonce));brokerNanoseconds(value.nowNs);
  }else{
    const common=['requestId','nonce'];
    check(uuid(value.requestId)&&digest(value.nonce));
    if(type==='START'){decoderExact(value,[...common,'bindingHash','deadlineBootNs','plan']);check(digest(value.bindingHash));brokerNanoseconds(value.deadlineBootNs);assertProofDecoderPlan(value.plan);}
    else if(type==='ACCEPT'){decoderExact(value,[...common,'jobId','deadlineBootNs']);check(uuid(value.jobId));brokerNanoseconds(value.deadlineBootNs);}
    else if(type==='INPUT_END'||type==='CANCEL')decoderExact(value,common);
    else if(type==='TERMINAL'){
      decoderExact(value,[...common,'schema','classification','executionAllowed','freshPublicationAllowed','bindingHash','jobId','outcome','reportedCleanup','validation']);
      check(value.schema===TARGET_BROKER_SCHEMA&&value.classification==='UNQUALIFIED'&&value.executionAllowed===false&&value.freshPublicationAllowed===false&&digest(value.bindingHash)&&uuid(value.jobId)&&['SUCCESS','INVALID_IMAGE','QUARANTINED'].includes(value.outcome));
      check(value.reportedCleanup===(value.outcome==='QUARANTINED'?'UNKNOWN':'OBSERVED'));
      if(value.outcome==='SUCCESS')assertProofDecoderValidation(value.validation);else check(value.validation===null);
    }else check(false);
  }
  return decoderFreeze(value);
}
export function encodeTargetBrokerFrame(type,value){
  check(typeof type==='string'&&Object.hasOwn(types,type));
  const payload=type==='DATA'?(check(Buffer.isBuffer(value)),value):Buffer.from(canonicalJSON(metadata(type,value)));
  check(payload.length>0&&payload.length<=caps[type]);const header=Buffer.alloc(8);header.writeUInt32BE(payload.length);header[4]=2;header[5]=types[type];return Buffer.concat([header,payload]);
}
/** Pure bounded wire parser. Version 2 carries unqualified transport reports,
 * never v1 qualification claims or private Engine/kernel receipt brands. */
export function createTargetBrokerFrameReader(options){
  const {onFrame,allowedTypes,maxFrames,maxTotalBytes}=engineDataOptions(options,['onFrame','allowedTypes','maxFrames','maxTotalBytes']);
  check(typeof onFrame==='function'&&Array.isArray(allowedTypes)&&allowedTypes.length>0&&allowedTypes.every(type=>typeof type==='string'&&Object.hasOwn(types,type))&&Number.isSafeInteger(maxFrames)&&maxFrames>0&&maxFrames<=166&&Number.isSafeInteger(maxTotalBytes)&&maxTotalBytes>0&&maxTotalBytes<=PROOF_DECODER_LIMITS.maxObjectBytes+16384);
  const allowed=new Set(allowedTypes),header=Buffer.alloc(8);let headerAt=0,payload=null,payloadAt=0,type=null,totalBytes=0,frames=0,ended=false,failed=false;
  const clear=()=>{header.fill(0);payload?.fill(0);payload=null;headerAt=0;payloadAt=0;};
  return Object.freeze({
    feed(chunk){
      try{check(!ended&&!failed&&Buffer.isBuffer(chunk));totalBytes+=chunk.length;check(totalBytes<=maxTotalBytes);let at=0;
        while(at<chunk.length){
          if(payload===null){const count=Math.min(8-headerAt,chunk.length-at);chunk.copy(header,headerAt,at,at+count);headerAt+=count;at+=count;if(headerAt<8)continue;
            const length=header.readUInt32BE(0);type=names[header[5]];check(header[4]===2&&header.readUInt16BE(6)===0&&allowed.has(type)&&length>0&&length<=caps[type]&&++frames<=maxFrames);payload=Buffer.alloc(length);payloadAt=0;}
          const count=Math.min(payload.length-payloadAt,chunk.length-at);chunk.copy(payload,payloadAt,at,at+count);payloadAt+=count;at+=count;
          if(payloadAt===payload.length){const body=payload,kind=type;payload=null;headerAt=0;payloadAt=0;type=null;
            if(kind==='DATA'){try{onFrame(kind,body);}catch(error){body.fill(0);throw error;}}
            else{try{const value=parseProofDecoderEngineJSON(body,{maxBytes:caps[kind]});check(Buffer.from(canonicalJSON(value)).equals(body));onFrame(kind,metadata(kind,value));}finally{body.fill(0);}}}
        }
      }catch(error){failed=true;clear();throw error;}
    },
    end(){try{check(!ended&&!failed&&headerAt===0&&payload===null);ended=true;clear();}catch(error){failed=true;clear();throw error;}},
    close(){ended=true;clear();},
    status(){return Object.freeze({bufferedBytes:headerAt+payloadAt,allocatedBytes:8+(payload?.length??0),frames,totalBytes,ended,failed});}
  });
}

/** Bounded original-byte collection only; this object conveys no authority. */
export function createTargetBrokerInputCollector(input){
  const plan=decoderFreeze(decoderContractData(input));assertProofDecoderPlan(plan);
  const original=Buffer.alloc(plan.byteCount),digest=createHash('sha256');let received=0,ended=false,closed=false;
  const close=()=>{closed=true;original.fill(0);};
  return Object.freeze({
    feed(bytes){try{check(!closed&&!ended&&Buffer.isBuffer(bytes)&&received<original.length&&bytes.length===Math.min(TARGET_BROKER_CHUNK,original.length-received));digest.update(bytes);bytes.copy(original,received);received+=bytes.length;}catch(error){close();throw error;}},
    end(){try{check(!closed&&!ended&&received===original.length&&digest.digest('hex')===plan.sha256);ended=true;return original;}catch(error){close();throw error;}},
    close,
    status(){return Object.freeze({received,allocatedBytes:original.length,ended,closed});}
  });
}
