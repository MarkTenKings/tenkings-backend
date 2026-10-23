import {createHash} from 'node:crypto';
import {canonicalJSON,requireValue} from './contract.mjs';
import {assertProofDecoderPlan,assertProofDecoderValidation,proofDecoderLimits,proofDecoderLimitsHash,PROOF_DECODER_LIMITS} from './proof-decoder-protocol.mjs';

export const WORKER_REQUEST_SCHEMA='atlas-proof-decoder-worker-request-v1';
export const WORKER_RESULT_SCHEMA='atlas-proof-decoder-worker-result-v1';
export const WORKER_REQUEST_METADATA_BYTES=1024;
export const WORKER_RESULT_METADATA_BYTES=4096;
const magic=Buffer.from('PDW1');
const check=value=>requireValue(value,'PROOF_WORKER_PROTOCOL');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const requestId=value=>check(typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value));
function exact(value,keys){check(value&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).sort().join(',')===[...keys].sort().join(','));}
function request(value){
  exact(value,['schema','requestId','plan','limits','limitsHash']);check(value.schema===WORKER_REQUEST_SCHEMA);requestId(value.requestId);
  assertProofDecoderPlan(value.plan);exact(value.limits,Object.keys(PROOF_DECODER_LIMITS));
  const limits=proofDecoderLimits(value.limits);check(value.limitsHash===proofDecoderLimitsHash(limits)&&value.plan.byteCount<=limits.maxObjectBytes);
  return Object.freeze({...value,plan:Object.freeze({...value.plan}),limits});
}
function result(value){
  exact(value,['schema','requestId','outcome','validation']);check(value.schema===WORKER_RESULT_SCHEMA);requestId(value.requestId);
  check(['SUCCESS','INVALID_IMAGE','DECODER_FAILURE'].includes(value.outcome));
  if(value.outcome==='SUCCESS')assertProofDecoderValidation(value.validation);else check(value.validation===null);
  return Object.freeze({...value,validation:value.validation===null?null:Object.freeze({...value.validation})});
}
function parse(payload,validate){
  const text=payload.toString('utf8');let depth=0,string=false,escaped=false;
  for(const char of text){if(string){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')string=false;}else if(char==='"')string=true;else if(char==='{'||char==='[')check(++depth<=4);else if(char==='}'||char===']')check(--depth>=0);}
  check(!string&&depth===0);let value;
  try{value=JSON.parse(text);check(Buffer.from(canonicalJSON(value),'utf8').equals(payload));return validate(value);}catch{check(false);}
}
function frame(value,limit){
  const body=Buffer.from(canonicalJSON(value),'utf8');check(body.length>0&&body.length<=limit);
  const header=Buffer.alloc(8);magic.copy(header);header.writeUInt32BE(body.length,4);return Buffer.concat([header,body]);
}
export function encodeProofDecoderWorkerRequestHeader(input){
  exact(input,['requestId','plan','limits','limitsHash']);
  return frame(request({schema:WORKER_REQUEST_SCHEMA,...input}),WORKER_REQUEST_METADATA_BYTES);
}
export function encodeProofDecoderWorkerRequest(input,bytes){
  const header=encodeProofDecoderWorkerRequestHeader(input);check(Buffer.isBuffer(bytes)&&bytes.length===input.plan.byteCount&&bytes.length<=input.limits.maxObjectBytes&&digest(bytes)===input.plan.sha256);
  return Buffer.concat([header,bytes]);
}
export function encodeProofDecoderWorkerResult(input){
  exact(input,['requestId','outcome','validation']);
  return frame(result({schema:WORKER_RESULT_SCHEMA,...input}),WORKER_RESULT_METADATA_BYTES);
}
function reader({kind,onHeader,onValue}){
  const requestMode=kind==='request',cap=requestMode?WORKER_REQUEST_METADATA_BYTES:WORKER_RESULT_METADATA_BYTES;
  const header=Buffer.alloc(8);let headerAt=0,metadata=null,metadataAt=0,value=null,body=null,bodyAt=0,totalBytes=0,ended=false,disposed=false;
  return Object.freeze({
    feed(chunk){
      check(!ended&&!disposed&&Buffer.isBuffer(chunk));totalBytes+=chunk.length;check(totalBytes<=8+cap+(requestMode?PROOF_DECODER_LIMITS.maxObjectBytes:0));
      let at=0;
      while(at<chunk.length){
        if(headerAt<8){const n=Math.min(8-headerAt,chunk.length-at);chunk.copy(header,headerAt,at,at+n);headerAt+=n;at+=n;if(headerAt<8)continue;
          check(header.subarray(0,4).equals(magic));const size=header.readUInt32BE(4);check(size>0&&size<=cap);metadata=Buffer.alloc(size);
        }
        if(metadataAt<metadata.length){const n=Math.min(metadata.length-metadataAt,chunk.length-at);chunk.copy(metadata,metadataAt,at,at+n);metadataAt+=n;at+=n;if(metadataAt<metadata.length)continue;
          value=parse(metadata,requestMode?request:result);if(onHeader)onHeader(value);
          if(requestMode)body=Buffer.alloc(value.plan.byteCount);
        }
        if(requestMode&&bodyAt<body.length){const n=Math.min(body.length-bodyAt,chunk.length-at);chunk.copy(body,bodyAt,at,at+n);bodyAt+=n;at+=n;}
        check(at===chunk.length);
      }
    },
    end(){
      check(!ended&&!disposed&&value!==null&&headerAt===8&&metadataAt===metadata.length&&(!requestMode||bodyAt===body.length));ended=true;
      if(requestMode)check(digest(body)===value.plan.sha256);
      const output=requestMode?Object.freeze({...value,bytes:body}):value;if(onValue)onValue(output);return output;
    },
    dispose(){disposed=true;header.fill(0);metadata?.fill(0);body?.fill(0);},
    status(){return{ended,disposed,totalBytes,bufferedBytes:headerAt+metadataAt+bodyAt,allocatedBytes:8+(metadata?.length??0)+(body?.length??0)};},
  });
}
export function createProofDecoderWorkerRequestReader({onHeader,onRequest}={}){
  check((onHeader===undefined||typeof onHeader==='function')&&(onRequest===undefined||typeof onRequest==='function'));
  return reader({kind:'request',onHeader,onValue:onRequest});
}
export function createProofDecoderWorkerResultReader({onResult}={}){
  check(onResult===undefined||typeof onResult==='function');return reader({kind:'result',onValue:onResult});
}

// Input-bound decoder output is untrusted until its exact envelope is checked.
// This validates structure and originals only; it does not establish process exit.
export function assertProofDecoderWorkerResult(value,expected){
  const parsed=result(value);exact(expected,['requestId','plan','limits']);requestId(expected.requestId);assertProofDecoderPlan(expected.plan);
  const limits=proofDecoderLimits(expected.limits);check(parsed.requestId===expected.requestId);
  if(parsed.outcome==='SUCCESS'){const v=parsed.validation;check(v.sha256===expected.plan.sha256&&v.byteCount===expected.plan.byteCount&&v.contentType===expected.plan.declaredType&&v.width*v.height<=limits.maxPixels);}
  return parsed;
}
