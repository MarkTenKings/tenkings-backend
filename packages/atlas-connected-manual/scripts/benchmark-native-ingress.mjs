// Explicit local-file native-capacity benchmark. No provider, DB or storage
// credentials are used. This is decode/working-image capacity, not E2E grading.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { verifyAndDecodePhoto, deriveSdrWorkingPhoto } from '@atlas/photo-runtime';

const [frontPath, backPath, countText='50', intervalText='2400'] = process.argv.slice(2);
assert(frontPath && backPath, 'Two explicit retained original paths required');
const count=Number(countText), intervalMs=Number(intervalText), concurrency=2;
assert(Number.isInteger(count)&&count>=1&&count<=100);
assert(Number.isInteger(intervalMs)&&intervalMs>=0&&intervalMs<=10000);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const files=await Promise.all([frontPath,backPath].map(async path=>{const bytes=await readFile(path);return{bytes,sha256:hash(bytes)};}));
const limits={maxInputBytes:256*1024*1024,maxPixels:52_000_000,maxRasterBytes:512*1024*1024,maxOutputBytes:256*1024*1024,timeoutMs:90000};
const started=performance.now(), queue=[], completed=[], failures=[], active=new Set();
let peakQueue=0,peakRss=0,admitted=0;
const sample=setInterval(()=>{peakRss=Math.max(peakRss,process.memoryUsage().rss);},100);
async function processImage(index,admittedAt){
  const file=files[index%2], side=index%2?'BACK':'FRONT';
  const object={key:`benchmark/original/${index}`,versionId:null};
  const begin=performance.now();
  const decoded=await verifyAndDecodePhoto({bytes:file.bytes,uploadPlan:{schemaVersion:1,uploadId:`benchmark-${index}`,
    binding:{cardId:`benchmark-card-${Math.floor(index/2)}`,pairId:`benchmark-pair-${Math.floor(index/2)}`,side,version:1},object,
    expected:{sha256:file.sha256,byteCount:file.bytes.length}},observedObject:object,
    limits,heicHdrPolicy:'retain-hdr-use-sdr-base',jpegHdrPolicy:'retain-hdr-use-sdr-base'});
  const working=await deriveSdrWorkingPhoto(decoded,{limits});
  assert.equal(hash(file.bytes),file.sha256);assert.equal(working.original.content.sha256,file.sha256);
  completed.push({index,originalBytes:file.bytes.length,originalSha256:file.sha256,dimensions:working.raster.dimensions,
    waitMs:begin-admittedAt,processingMs:performance.now()-begin,totalMs:performance.now()-admittedAt});
}
function drain(){while(queue.length&&active.size<concurrency){
  const item=queue.shift();const task=processImage(item.index,item.at).catch(error=>failures.push({index:item.index,code:error.code??error.name}))
    .finally(()=>{active.delete(task);drain();});active.add(task);
}}
for(let index=0;index<count;index++){
  const remaining=started+index*intervalMs-performance.now();if(remaining>0)await new Promise(resolve=>setTimeout(resolve,remaining));
  queue.push({index,at:performance.now()});admitted++;peakQueue=Math.max(peakQueue,queue.length);drain();
}
while(active.size||queue.length)await Promise.allSettled([...active]);
clearInterval(sample);
const elapsedMs=performance.now()-started;
const peakCgroupMemoryBytes=await readFile('/sys/fs/cgroup/memory.peak','utf8').then(value=>Number(value.trim())).catch(()=>null);
const percentile=(values,q)=>values.sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*q))]??null;
console.log(JSON.stringify({status:failures.length?'NATIVE_INGRESS_FAILED':'NATIVE_INGRESS_COMPLETE',
  scope:'actual retained original replay through native decode and full-resolution working-image derivation; excludes network, geometry and model grading',
  node:process.version,platform:process.platform,arch:process.arch,concurrency,admitted,completed:completed.length,failures,
  arrivalImagesPerMinute:intervalMs?60000/intervalMs:null,elapsedMs,completedImagesPerMinute:completed.length*60000/elapsedMs,
  peakQueue,peakRssBytes:peakRss,peakCgroupMemoryBytes,p50ProcessingMs:percentile(completed.map(x=>x.processingMs),.5),
  p95ProcessingMs:percentile(completed.map(x=>x.processingMs),.95),p95WaitMs:percentile(completed.map(x=>x.waitMs),.95),observations:completed},null,2));
if(failures.length)process.exitCode=1;
