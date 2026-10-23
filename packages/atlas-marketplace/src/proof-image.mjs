import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { requireValue } from './contract.mjs';
import { PROOF_IMAGE_LIMITS, source, decode } from './proof-image-decode.mjs';
export { PROOF_IMAGE_LIMITS } from './proof-image-decode.mjs';

const validators = new WeakSet();
const workerFile = fileURLToPath(import.meta.url);
/** Full raster decode in a killable child with fixed inputs and no inherited
 * application environment. This is process isolation, not an OS/network or
 * native-allocation sandbox; the deployment must qualify that containment. */
export function createProofImageValidator({maxObjectBytes=PROOF_IMAGE_LIMITS.maxObjectBytes,maxPixels=PROOF_IMAGE_LIMITS.maxPixels,timeoutMs=PROOF_IMAGE_LIMITS.timeoutMs,maxConcurrent=PROOF_IMAGE_LIMITS.maxConcurrent}={}) {
  for(const [key,value] of Object.entries({maxObjectBytes,maxPixels,timeoutMs,maxConcurrent})) requireValue(Number.isSafeInteger(value)&&value>0&&value<=PROOF_IMAGE_LIMITS[key],'PROOF_VALIDATOR_LIMIT_INVALID');
  const limits=Object.freeze({maxObjectBytes,maxPixels,timeoutMs,maxConcurrent}); let active=0,closed=false; const children=new Set();
  const validator=Object.freeze({limits, async validate({bytes,plan}) {
    requireValue(!closed,'PROOF_VALIDATOR_CLOSED');source(bytes,plan,limits); requireValue(active<maxConcurrent,'PROOF_VALIDATOR_BUSY'); active++;
    try {return await new Promise((accept,reject)=>{
      const child=spawn(process.execPath,['--max-old-space-size=128',workerFile,'--marketplace-proof-worker'],{cwd:fileURLToPath(new URL('.',import.meta.url)),env:{UV_THREADPOOL_SIZE:'1',VIPS_CONCURRENCY:'1'},stdio:['pipe','pipe','pipe']});
      let output='',count=0,errors=0,failure=null;
      const fail=code=>{failure??=code;child.kill('SIGKILL');};
      let completed;const record={fail,done:new Promise(resolveDone=>{completed=resolveDone;})};children.add(record);
      const timer=setTimeout(()=>fail('PROOF_VALIDATOR_TIMEOUT'),timeoutMs);
      child.stdout.on('data',chunk=>{count+=chunk.length;if(count>4096)fail('PROOF_VALIDATOR_PROTOCOL');else output+=chunk.toString('utf8');});
      child.stderr.on('data',chunk=>{errors+=chunk.length;if(errors>4096)fail('PROOF_VALIDATOR_PROTOCOL');});
      child.stdin.on('error',()=>{});
      child.on('error',()=>{failure??='PROOF_DECODER_UNAVAILABLE';});
      child.on('close',(code,signal)=>{clearTimeout(timer);children.delete(record);completed();try{requireValue(!failure,failure);requireValue(code===0&&!signal,'PROOF_DECODER_UNAVAILABLE');const result=JSON.parse(output);requireValue(result.ok===true,typeof result.code==='string'&&/^PROOF_[A-Z_]+$/.test(result.code)?result.code:'PROOF_IMAGE_INVALID');const value=result.validation;requireValue(value?.sha256===plan.sha256&&value.byteCount===plan.byteCount&&value.contentType===plan.declaredType&&value.schema==='atlas-marketplace-proof-image-v1'&&value.decoder==='sharp-0.33.5/libvips-8.15.3','PROOF_VALIDATOR_PROTOCOL');accept(value);}catch(error){reject(error);}});
      child.stdin.end(JSON.stringify({plan,limits,bytes:bytes.toString('base64')}));
    });}finally{active--;}
  }, async close(){closed=true;const pending=[...children];for(const child of pending)child.fail('PROOF_VALIDATOR_CLOSED');await Promise.all(pending.map(child=>child.done));} });validators.add(validator);return validator;
}
export function assertProofImageValidator(validator){requireValue(validators.has(validator),'PROOF_DECODER_UNAVAILABLE');return validator;}
if(process.argv[1]&&resolve(process.argv[1])===workerFile&&process.argv[2]==='--marketplace-proof-worker') {
  try {let chunks=[],size=0;for await(const chunk of process.stdin){size+=chunk.length;requireValue(size<=Math.ceil(PROOF_IMAGE_LIMITS.maxObjectBytes*1.4)+8192,'PROOF_IMAGE_LIMIT');chunks.push(chunk);}const request=JSON.parse(Buffer.concat(chunks).toString('utf8'));const validation=await decode(Buffer.from(request.bytes,'base64'),request.plan,request.limits);process.stdout.write(JSON.stringify({ok:true,validation}));}
  catch(error){process.stdout.write(JSON.stringify({ok:false,code:error.code??'PROOF_IMAGE_INVALID'}));}
}
