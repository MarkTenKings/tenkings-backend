import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {decode,PROOF_IMAGE_LIMITS} from './proof-image-decode.mjs';
import {createProofDecoderWorkerRequestReader,encodeProofDecoderWorkerResult} from './proof-decoder-worker-protocol.mjs';

const workerFile=fileURLToPath(import.meta.url);
const fixedEnvironment=Object.freeze({HOME:'/nonexistent',HOSTNAME:'atlas-proof-decoder',PATH:'/opt/atlas-proof-decoder/bin',UV_THREADPOOL_SIZE:'1',VIPS_CONCURRENCY:'1'});
const imageCodes=new Set(['PROOF_IMAGE_INVALID','PROOF_IMAGE_LIMIT','PROOF_FORMAT_MISMATCH','PROOF_FORMAT_UNSUPPORTED']);

/** Conservative classification: an unrecognized native/setup error is unavailable,
 * never evidence of invalid pixels. No native exception text is written to stdout. */
export function classifyProofDecoderWorkerFailure(error){
  if(imageCodes.has(error?.code))return 'INVALID_IMAGE';
  if(error?.code!==undefined)return 'DECODER_FAILURE';
  const message=typeof error?.message==='string'?error.message:'';
  if(/alloc|memory|resource|thread|timeout|timed out|killed|out of space|too many open/i.test(message))return 'DECODER_FAILURE';
  if(message==='VipsJpeg: Corrupt JPEG data: premature end of data segment')return 'INVALID_IMAGE';
  if(/^(?:pngload_buffer: (?:IDAT stream error|libspng read error)|Input image exceeds pixel limit)$/.test(message))return 'INVALID_IMAGE';
  return 'DECODER_FAILURE';
}

export function proofDecoderWorkerEnvironmentMatches(environment,{platform,uid}){
  if(!environment||!['linux','darwin'].includes(platform))return false;
  // Darwin's Node runtime adds this CoreFoundation key even to a supplied
  // five-entry environment. It is not an accepted Linux image environment.
  const osEncoding=platform==='darwin'&&Number.isSafeInteger(uid)&&uid>=0&&environment.__CF_USER_TEXT_ENCODING==='0x'+uid.toString(16).toUpperCase()+':0x0:0x0';
  const keys=Object.keys(environment).filter(key=>!(osEncoding&&key==='__CF_USER_TEXT_ENCODING'));
  return keys.sort().join(',')===Object.keys(fixedEnvironment).sort().join(',')&&Object.entries(fixedEnvironment).every(([key,value])=>environment[key]===value);
}

async function main(){
  // The trusted launcher must prevent NODE_OPTIONS/LD_PRELOAD injection before
  // process creation. These checks only reject unexpected realized inputs.
  if(process.argv.length!==2||process.execArgv.length!==1||process.execArgv[0]!=='--max-old-space-size=128'||
    !proofDecoderWorkerEnvironmentMatches(process.env,{platform:process.platform,uid:typeof process.getuid==='function'?process.getuid():undefined})){process.exitCode=2;return;}
  const started=performance.now();let deadline=started+PROOF_IMAGE_LIMITS.timeoutMs,timer,header=null,request=null,reader;
  const expired=()=>performance.now()>=deadline;
  const stop=()=>{reader?.dispose();process.stdin.destroy();process.stdout.destroy();process.exit(2);};
  const schedule=()=>{clearTimeout(timer);const remaining=deadline-performance.now();if(remaining<=0)stop();timer=setTimeout(stop,Math.ceil(remaining));};
  reader=createProofDecoderWorkerRequestReader({onHeader(value){header=value;deadline=started+value.limits.timeoutMs;schedule();}});
  schedule();
  process.stdout.on('error',stop);
  try{
    for await(const chunk of process.stdin){if(expired())stop();reader.feed(chunk);}
    request=reader.end();if(expired())stop();
    let outcome,validation=null;
    try{validation=await decode(request.bytes,request.plan,request.limits);outcome='SUCCESS';}
    catch(error){outcome=classifyProofDecoderWorkerFailure(error);}
    if(expired())stop();
    request.bytes.fill(0);
    const output=encodeProofDecoderWorkerResult({requestId:request.requestId,outcome,validation});
    await new Promise((accept,reject)=>{process.stdout.end(output,error=>error?reject(error):accept());});
    if(expired())stop();
    clearTimeout(timer);reader.dispose();process.exit(outcome==='DECODER_FAILURE'?2:0);
  }catch{
    // Framing, source mismatch, allocation and transport failures are availability
    // failures. Without a complete input no image classification is permitted.
    request?.bytes.fill(0);reader.dispose();
    if(header&&!expired()){
      try{const output=encodeProofDecoderWorkerResult({requestId:header.requestId,outcome:'DECODER_FAILURE',validation:null});await new Promise((accept,reject)=>process.stdout.end(output,error=>error?reject(error):accept()));}catch{}
    }
    clearTimeout(timer);process.exit(2);
  }
}
// Importing the library does not start a worker or inspect the environment.
if(process.argv[1]&&resolve(process.argv[1])===workerFile)await main();
