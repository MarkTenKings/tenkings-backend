import {canonicalJSON,hash,requireValue} from './contract.mjs';

export const PROOF_DECODER_PROTOCOL='atlas-proof-decoder-protocol-v1';
export const PROOF_DECODER_VERSION='sharp-0.33.5/libvips-8.15.3';
export const PROOF_DECODER_LIMITS=Object.freeze({maxObjectBytes:10485760,maxPixels:16000000,timeoutMs:15000,maxConcurrent:2});
export const PROOF_DECODER_FRAME_BYTES=65536;
const types=Object.freeze({HELLO:1,START:2,ACCEPT:3,DATA:4,CANCEL:5,TERMINAL:6});
const names=Object.fromEntries(Object.entries(types).map(([name,value])=>[value,name]));
const caps=Object.freeze({HELLO:4096,START:1024,ACCEPT:512,DATA:65536,CANCEL:128,TERMINAL:4096});
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const nonce=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const id=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
const check=value=>requireValue(value,'PROOF_DECODER_PROTOCOL');
function exact(value,keys){check(value&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).sort().join(',')===[...keys].sort().join(','));}
export function proofDecoderLimits(input={}){
  check(input&&Object.getPrototypeOf(input)===Object.prototype);exact(input,Object.keys(input));check(Object.keys(input).every(key=>Object.hasOwn(PROOF_DECODER_LIMITS,key)));
  const limits=Object.fromEntries(Object.entries(PROOF_DECODER_LIMITS).map(([key,max])=>{const value=input[key]===undefined?max:input[key];check(Number.isSafeInteger(value)&&value>0&&value<=max);return[key,value];}));
  return Object.freeze(limits);
}
export const proofDecoderLimitsHash=limits=>hash(limits);
export function assertProofDecoderPlan(plan){exact(plan,['byteCount','sha256','declaredType']);check(Number.isSafeInteger(plan.byteCount)&&plan.byteCount>0&&plan.byteCount<=PROOF_DECODER_LIMITS.maxObjectBytes&&hex(plan.sha256)&&['image/png','image/jpeg'].includes(plan.declaredType));return plan;}
export function assertProofDecoderValidation(value){
  exact(value,['schema','decoder','contentType','byteCount','sha256','width','height']);
  check(value.schema==='atlas-marketplace-proof-image-v1'&&value.decoder===PROOF_DECODER_VERSION);
  assertProofDecoderPlan({byteCount:value.byteCount,sha256:value.sha256,declaredType:value.contentType});
  check(Number.isSafeInteger(value.width)&&Number.isSafeInteger(value.height)&&value.width>0&&value.height>0&&value.width<=PROOF_DECODER_LIMITS.maxPixels&&value.height<=PROOF_DECODER_LIMITS.maxPixels&&value.width*value.height<=PROOF_DECODER_LIMITS.maxPixels);return value;
}
function metadata(type,value){
  if(type==='HELLO'){exact(value,['schema','qualificationHash','epoch','limitsHash']);check(value.schema===PROOF_DECODER_PROTOCOL&&hex(value.qualificationHash)&&hex(value.limitsHash)&&id(value.epoch));}
  else if(type==='START'){exact(value,['schema','requestId','qualificationHash','epoch','limitsHash','plan']);check(value.schema===PROOF_DECODER_PROTOCOL&&nonce(value.requestId)&&hex(value.qualificationHash)&&hex(value.limitsHash)&&id(value.epoch));assertProofDecoderPlan(value.plan);}
  else if(type==='ACCEPT'){exact(value,['requestId','qualificationHash','epoch']);check(nonce(value.requestId)&&hex(value.qualificationHash)&&id(value.epoch));}
  else if(type==='CANCEL'){exact(value,['requestId']);check(nonce(value.requestId));}
  else if(type==='TERMINAL'){
    exact(value,['requestId','qualificationHash','epoch','outcome','workerState','validation']);check(nonce(value.requestId)&&hex(value.qualificationHash)&&id(value.epoch));
    check(['SUCCESS','INVALID_IMAGE','BUSY','CANCELLED','TIMEOUT','CONTAINMENT_FAILURE'].includes(value.outcome)&&['NOT_STARTED','REAPED','UNKNOWN'].includes(value.workerState));
    if(value.outcome==='SUCCESS'){check(value.workerState==='REAPED');assertProofDecoderValidation(value.validation);}else check(value.validation===null);
    if(value.workerState==='UNKNOWN')check(value.outcome==='CONTAINMENT_FAILURE');if(value.outcome==='BUSY')check(value.workerState==='NOT_STARTED');
  }else check(false);
  return value;
}
function parseMetadata(type,payload){
  // Canonical UTF-8 JSON is the wire grammar. Round-trip equality refuses all
  // duplicate keys, including escaped aliases, before any metadata is accepted.
  const text=payload.toString('utf8');let depth=0,inString=false,escaped=false;
  for(const char of text){if(inString){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')inString=false;}else if(char==='"')inString=true;else if(char==='{'||char==='['){check(++depth<=4);}else if(char==='}'||char===']'){check(--depth>=0);}}
  check(!inString&&depth===0);
  let value;try{value=JSON.parse(text);check(Buffer.from(canonicalJSON(value),'utf8').equals(payload));return metadata(type,value);}catch{check(false);}
}
export function encodeProofDecoderFrame(type,value){
  check(Object.hasOwn(types,type));const payload=type==='DATA'?(check(Buffer.isBuffer(value)),value):Buffer.from(canonicalJSON(metadata(type,value)),'utf8');
  check(payload.length>0&&payload.length<=caps[type]);const header=Buffer.alloc(8);header.writeUInt32BE(payload.length,0);header[4]=1;header[5]=types[type];return Buffer.concat([header,payload]);
}
/** Incremental bounded parser. It retains at most one admitted frame, rejects
 * excess bytes before allocation, and requires explicit end() for truncation. */
export function createProofDecoderFrameReader({onFrame,allowedTypes=Object.keys(types),maxFrames=164,maxTotalBytes=PROOF_DECODER_LIMITS.maxObjectBytes+16384}={}){
  check(typeof onFrame==='function'&&Array.isArray(allowedTypes)&&allowedTypes.length>0&&allowedTypes.every(type=>Object.hasOwn(types,type))&&Number.isSafeInteger(maxFrames)&&maxFrames>0&&maxFrames<=164&&Number.isSafeInteger(maxTotalBytes)&&maxTotalBytes>0&&maxTotalBytes<=PROOF_DECODER_LIMITS.maxObjectBytes+16384);
  const allowed=new Set(allowedTypes),header=Buffer.alloc(8);let headerAt=0,payload=null,payloadAt=0,type=null,totalBytes=0,frames=0,ended=false;
  return Object.freeze({
    feed(chunk){check(!ended&&Buffer.isBuffer(chunk));totalBytes+=chunk.length;check(totalBytes<=maxTotalBytes);let at=0;
      while(at<chunk.length){
        if(!payload){const n=Math.min(8-headerAt,chunk.length-at);chunk.copy(header,headerAt,at,at+n);headerAt+=n;at+=n;if(headerAt<8)continue;
          const size=header.readUInt32BE(0);type=names[header[5]];check(header[4]===1&&header.readUInt16BE(6)===0&&allowed.has(type)&&size>0&&size<=caps[type]&&++frames<=maxFrames);payload=Buffer.alloc(size);payloadAt=0;
        }
        const n=Math.min(payload.length-payloadAt,chunk.length-at);chunk.copy(payload,payloadAt,at,at+n);payloadAt+=n;at+=n;
        if(payloadAt===payload.length){const body=payload,kind=type;payload=null;headerAt=0;payloadAt=0;type=null;onFrame(kind,kind==='DATA'?body:parseMetadata(kind,body));}
      }
    },
    end(){check(!ended&&headerAt===0&&payload===null);ended=true;},
    status(){return{bufferedBytes:headerAt+payloadAt,allocatedBytes:8+(payload?.length??0),frames,totalBytes,ended};},
  });
}
