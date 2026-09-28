import { descriptorSha256, parseDecodedFrame, parseDerivative } from '@atlas/photo-core';
import { canonical, digest, requireThat } from '@atlas/manual-service/contract';
import { inspectionPreviewMedia, inspectionPreviewGrant, rethrowPreviewControlFailure } from './inspection-preview.mjs';

export const REVIEW_DISPLAY_POLICY = 'atlas-review-display-lossless-v1';
const IDENTITY = [1,0,0,0,1,0,0,0,1];
const LIMITS = Object.freeze({ maxInputBytes: 256*1024*1024, maxPixels: 52_000_000,
  maxRasterBytes: 512*1024*1024, maxOutputBytes: 128*1024*1024, timeoutMs: 90000 });
const PUBLISHED_OPERATIONAL=new Set(['PHOTO_STORAGE_UNAVAILABLE','PHOTO_STORAGE_TIMEOUT','MANUAL_ARTIFACT_UNAVAILABLE','DISPLAY_WORKER_STOPPED','ECONNRESET','ECONNREFUSED','ETIMEDOUT','EPIPE','EAI_AGAIN','ENETUNREACH','EHOSTUNREACH','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_SOCKET']);
const safeCode = error => /^[A-Z][A-Z0-9_]{0,100}$/.test(error?.code ?? '') ? error.code : 'DISPLAY_INTERRUPTED';
const status = row => {
  const state=row?.state==='READY'?'READY':row?.state==='FAILED'?'FAILED':'PENDING';
  const retry=state==='FAILED'&&row.recovery<3&&row.id?{jobId:row.id,photoSourceHash:row.photo_hash}:null;
  return {state,...(row?.code?{code:row.code}:{}),retryable:!!retry,...(retry?{retry}: {})};
};

function previewBinding(saved,frame){
  const d=saved.raster.dimensions,source=frame.raster.dimensions,sx=d.width/source.width,sy=d.height/source.height;
  return Math.max(d.width,d.height)<=768&&d.width<=source.width&&d.height<=source.height
    &&Math.abs(d.width*source.height-d.height*source.width)<=Math.max(source.width,source.height)
    &&canonical(saved.frameToDerivative)===canonical([sx,0,(sx-1)/2,0,sy,(sy-1)/2,0,0,1]);
}

function descriptor(photo, output, kind, keyPrefix) {
  const frame = parseDecodedFrame(photo.workingFrame,photo.original,photo.decodePlan), key = descriptorSha256(frame);
  const dimensions=output.dimensions, sx=dimensions.width/frame.raster.dimensions.width, sy=dimensions.height/frame.raster.dimensions.height;
  requireThat(output.content.mime===(kind==='full'?'image/webp':'image/jpeg')
    && (kind==='full' ? dimensions.width===frame.raster.dimensions.width && dimensions.height===frame.raster.dimensions.height
      : Math.max(dimensions.width,dimensions.height)<=768),503,'MANUAL_DISPLAY_BINDING_INVALID');
  return parseDerivative({schemaVersion:1,kind:'derivative',id:`${photo.original.uploadId}:review:${kind}:${output.content.sha256}`,purpose:'preview',
    originalDescriptorSha256:frame.originalDescriptorSha256,frameDescriptorSha256:key,
    raster:{content:output.content,dimensions,object:{key:`${keyPrefix}/derived/${photo.original.binding.cardId}/${photo.original.uploadId}/review-v1-${key}-${kind}-${output.content.sha256}.${kind==='full'?'webp':'jpg'}`,versionId:null}},
    frameToDerivative:kind==='full'?IDENTITY:[sx,0,(sx-1)/2,0,sy,(sy-1)/2,0,0,1],
    encoder:{name:REVIEW_DISPLAY_POLICY,version:'1',settingsSha256:descriptorSha256({policyVersion:REVIEW_DISPLAY_POLICY,kind})}},frame,photo.original,photo.decodePlan);
}

/** Cold construction. Browser reads only read a durable index and sign saved
 * derivatives. Generation belongs exclusively to explicit worker lifecycle. */
export function createReviewDisplay({ store, storage, intake, artifacts, authorityFor, keyPrefix,
  limited=work=>work(), generate=async input=>(await import('@atlas/photo-runtime')).createReviewDisplay(input),
  onError=()=>{}, timers=globalThis, intervalMs=2000, concurrency=2, now=Date.now, previewTimeoutMs=2000 }={}) {
  requireThat(store && storage && intake && artifacts && typeof authorityFor==='function'
    && Number.isInteger(concurrency)&&concurrency>=1&&concurrency<=4
    &&Number.isInteger(previewTimeoutMs)&&previewTimeoutMs>=1&&previewTimeoutMs<=2000,500,'MANUAL_DISPLAY_CONFIG_INVALID');
  function optionalPreview(work,parentSignal){
    const controller=new AbortController();let timer;
    const callerAbort=()=>controller.abort(parentSignal.reason);
    let rejectAbort;const aborted=new Promise((_resolve,reject)=>{rejectAbort=reject;});
    const abort=()=>rejectAbort(controller.signal.reason??Object.assign(Error('Preview cancelled'),{name:'AbortError'}));
    controller.signal.addEventListener('abort',abort,{once:true});
    parentSignal?.addEventListener('abort',callerAbort,{once:true});
    if(parentSignal?.aborted)callerAbort();
    else timer=setTimeout(()=>controller.abort(Object.assign(Error('Optional preview deadline'),{code:'MANUAL_PREVIEW_TIMEOUT'})),previewTimeoutMs);
    // Both branches have rejection observers even when an injected transport
    // ignores abort and settles late. The original caller's signal is retained.
    const operation=Promise.resolve().then(()=>{controller.signal.throwIfAborted();return work(controller.signal);});
    return Promise.race([operation,aborted]).finally(()=>{
      clearTimeout(timer);parentSignal?.removeEventListener('abort',callerAbort);controller.signal.removeEventListener('abort',abort);
    });
  }
  const selected=new Map();let schedulingTurn=0;
  const priorities=()=>{for(const [hash,until]of selected)if(until<=now())selected.delete(hash);return [...selected.keys()];};
  function rememberSelected(source){
    const hash=source?.ref?.sha256;if(!/^[a-f0-9]{64}$/.test(hash))return;
    priorities();selected.delete(hash);if(selected.size>=16)selected.delete(selected.keys().next().value);
    selected.set(hash,now()+60000);
  }
  const grant = (photo,saved,signal) => storage.createImmutableDerivativeRead({descriptor:saved,
    frame:photo.workingFrame??photo.frame,original:photo.original,decodePlan:photo.decodePlan,expiresIn:300,signal});
  function checked(photo,row,kind) {
    if(row?.state!=='READY')return null;
    const value=row.result, frame=photo.workingFrame??photo.frame;
    requireThat(value?.policyVersion===REVIEW_DISPLAY_POLICY && value.sourceSha256===frame.raster.content.sha256,
      503,'MANUAL_DISPLAY_BINDING_INVALID');
    const saved=parseDerivative(value.descriptor,frame,photo.original,photo.decodePlan),{content,dimensions}=saved.raster;
    requireThat(saved.purpose==='preview' && content.mime===(kind==='full'?'image/webp':'image/jpeg')
      && (kind==='full' ? canonical(saved.frameToDerivative)===canonical(IDENTITY)
        && dimensions.width===frame.raster.dimensions.width && dimensions.height===frame.raster.dimensions.height
        : previewBinding(saved,frame)),503,'MANUAL_DISPLAY_BINDING_INVALID');
    return saved;
  }
  async function read(photo,photoSource,{contextOnly=false,signal}={}) {
    signal?.throwIfAborted();
    const frame=parseDecodedFrame(photo.workingFrame,photo.original,photo.decodePlan);
    let contextError;
    const [context,full]=await Promise.all([optionalPreview(async previewSignal=>{
      const row=await store.read(photoSource,'context'),saved=checked(photo,row,'preview');
      const preview=saved?inspectionPreviewGrant({descriptor:saved,sourceSha256:frame.raster.content.sha256,policyVersion:REVIEW_DISPLAY_POLICY},await grant(photo,saved,previewSignal)):null;
      return {row,preview};
    },signal).catch(error=>{rethrowPreviewControlFailure(error,signal);contextError=error;emit(error);return null;}),
    contextOnly?null:store.read(photoSource,'full').then(row=>{if(row?.state!=='READY')rememberSelected(photoSource);return row;})]);
    signal?.throwIfAborted();
    const value={...frame.raster.content,...frame.raster.dimensions,descriptorSha256:descriptorSha256(frame),
      displayState:status(contextOnly?context?.row:full),previewState:status(context?.row)};
    if(contextError){value.previewState={state:'FAILED',code:safeCode(contextError),retryable:false};if(contextOnly)value.displayState=value.previewState;}
    if(context?.preview)value.preview=context.preview;
    const original=contextOnly?null:checked(photo,full,'full');
    if(original)value.display={...await grant(photo,original,signal),...original.raster.dimensions,
      sourceSha256:frame.raster.content.sha256,policyVersion:REVIEW_DISPLAY_POLICY,...(value.preview?{preview:value.preview}:{})};
    signal?.throwIfAborted();
    // No URL for the huge authoritative PNG: missing transport is explicit.
    return value;
  }
  async function inspection(photo,image,savedPreview=null,{expiresIn=300,signal}={}) {
    try {
      return await optionalPreview(async previewSignal=>{
        let preview=inspectionPreviewMedia(savedPreview,image,photo);
        if(!preview){const row=await store.inspection(image.raster.content.sha256,descriptorSha256(photo.workingFrame??photo.frame));
          if(row)preview=inspectionPreviewMedia(row.result,image,photo);}
        return preview?inspectionPreviewGrant(preview,await storage.createImmutableDerivativeRead({descriptor:preview.descriptor,
          frame:photo.workingFrame??photo.frame,original:photo.original,decodePlan:photo.decodePlan,expiresIn,signal:previewSignal})):null;
      },signal);
    } catch(error) { rethrowPreviewControlFailure(error,signal);emit(error);return null; }
  }
  async function prepareInspection(job,photo,image,savedPreview,signal){
    const frame=photo.workingFrame;
      const existing=inspectionPreviewMedia(savedPreview,image,photo);
      if(existing)return {result:existing,sourceImageSha256:image.raster.content.sha256};
      const found=await storage.readDerivative({descriptor:image,frame,original:photo.original,decodePlan:photo.decodePlan,signal});
      const sharp=(await import('sharp')).default;
      const {data,info}=await sharp(found.bytes,{limitInputPixels:1350*1858,failOn:'warning'}).resize({width:768,height:768,fit:'inside',withoutEnlargement:true})
        .jpeg({quality:78,chromaSubsampling:'4:4:4'}).toBuffer({resolveWithObject:true});
      signal.throwIfAborted();
      requireThat(data.length<=1024*1024 && image.raster.dimensions.width===1350 && image.raster.dimensions.height===1858,503,'MANUAL_PREVIEW_BINDING_INVALID');
      const sx=info.width/1350,sy=info.height/1858,h=image.frameToDerivative;
      const transform=[sx*h[0]+(sx-1)/2*h[6],sx*h[1]+(sx-1)/2*h[7],sx*h[2]+(sx-1)/2*h[8],
        sy*h[3]+(sy-1)/2*h[6],sy*h[4]+(sy-1)/2*h[7],sy*h[5]+(sy-1)/2*h[8],...h.slice(6)];
      const next=parseDerivative({...image,id:`${image.id}:display-preview`,purpose:'preview',frameToDerivative:transform,
        raster:{content:{mime:'image/jpeg',sha256:digest(data),byteCount:data.length},dimensions:{width:info.width,height:info.height},
          object:{key:`${keyPrefix}/derived/${job.card_id}/display-preview/${image.raster.content.sha256}-${digest(data)}.jpg`,versionId:null}},
        encoder:{name:'sharp-inspection-preview',version:sharp.versions.sharp,settingsSha256:descriptorSha256({quality:78,chromaSubsampling:'4:4:4',maxDimension:768})}},frame,photo.original,photo.decodePlan);
      const stored=await storage.writeDerivative({descriptor:next,frame,original:photo.original,decodePlan:photo.decodePlan,bytes:data,signal});
      return {result:{policyVersion:'atlas-inspection-preview-v1',sourceSha256:image.raster.content.sha256,descriptor:stored},sourceImageSha256:image.raster.content.sha256};
  }
  async function prepare(job,photo,signal) {
    const frame=photo.workingFrame;
    if(job.prepared){
      const saved=await artifacts.read(job.prepared.ref,{cardId:job.card_id,kind:'PREPARED_IMAGES',sourceHash:job.prepared.sourceHash},{signal});
      requireThat(digest(JSON.stringify(saved))===job.prepared.sourceHash,503,'MANUAL_IMAGE_BINDING_INVALID');
      const image=parseDerivative(saved.images.inspection,frame,photo.original,photo.decodePlan);
      return prepareInspection(job,photo,image,saved.inspectionPreview,signal);
    }
    const found=await storage.readDecodedFrame({frame,original:photo.original,decodePlan:photo.decodePlan,signal});
    const kind=job.variant==='context'?'preview':'full';
    const generated=await generate({bytes:found.bytes,frame,original:photo.original,decodePlan:photo.decodePlan,limits:LIMITS,signal,output:kind});
    signal.throwIfAborted();
    requireThat(generated.policyVersion===REVIEW_DISPLAY_POLICY&&generated.sourceSha256===frame.raster.content.sha256,503,'MANUAL_DISPLAY_BINDING_INVALID');
    const output=generated[kind],saved=descriptor(photo,output,kind,keyPrefix);
    const stored=await storage.writeDerivative({descriptor:saved,frame,original:photo.original,decodePlan:photo.decodePlan,bytes:output.bytes,signal});
    return {result:{policyVersion:REVIEW_DISPLAY_POLICY,sourceSha256:frame.raster.content.sha256,descriptor:stored},sourceImageSha256:frame.raster.content.sha256};
  }
  const tasks=new Set(),controllers=new Set();let stopped=true,closed=false,timer=null,cycling=null;
  const emit=error=>{try{onError({code:safeCode(error)});}catch{}};
  async function execute(job){
    const controller=new AbortController();controllers.add(controller);let renewal=null;
    const heartbeat=timers.setInterval(()=>{if(renewal)return;renewal=store.renew(job).then(ok=>{if(!ok)controller.abort(Object.assign(new Error('DISPLAY_LEASE_LOST'),{code:'DISPLAY_LEASE_LOST'}));})
      .catch(error=>controller.abort(error)).finally(()=>{renewal=null;});},30000);heartbeat?.unref?.();
    try{
      let result;
      if(job.publication){
        const manifest=job.publication;
        requireThat(manifest.version==='atlas-manual-publication-manifest-v1'&&manifest.packet.ref.sha256===manifest.publicHash,503,'MANUAL_PUBLICATION_CORRUPT');
        const media=await artifacts.read(manifest.media.ref,{cardId:job.card_id,kind:'APPROVED_MEDIA',sourceHash:manifest.media.sourceHash},{signal:controller.signal});
        requireThat(digest(JSON.stringify(media))===manifest.media.sourceHash,503,'MANUAL_PUBLICATION_CORRUPT');
        const saved=media[job.side],photo={...saved,workingFrame:saved?.frame};
        requireThat(photo.original?.binding?.cardId===job.card_id&&photo.original?.binding?.side===job.side,503,'DISPLAY_PUBLICATION_BINDING_INVALID');
        const frame=parseDecodedFrame(photo.workingFrame,photo.original,photo.decodePlan),image=parseDerivative(saved.descriptor,frame,photo.original,photo.decodePlan);
        result=await limited(()=>prepareInspection(job,photo,image,saved.inspectionPreview,controller.signal));
      }else{
        const staff=await authorityFor(job),{upload,photo}=await intake.readSource(staff,job.card_id,job.upload_id,{signal:controller.signal});
        requireThat(canonical(upload.source)===canonical(job.photoSource),409,'DISPLAY_SOURCE_CHANGED');
        result=await limited(()=>prepare(job,photo,controller.signal));
      }
      controller.signal.throwIfAborted();
      await store.finish(job,result);
    }catch(error){const code=safeCode(error),permanent=/(?:_UNSUPPORTED|_INVALID|_MISMATCH|_CONFLICT|_CHANGED|_REVOKED|_LIMIT|_CORRUPT|_UNVERIFIED)$/.test(code)
        ||[401,403,409].includes(error?.status);
      emit(error);const operational=job.publication&&!permanent&&(PUBLISHED_OPERATIONAL.has(code)||controller.signal.aborted
        ||['TimeoutError','AbortError'].includes(error?.name)||[429,500,502,503,504].includes(error?.$metadata?.httpStatusCode));
      try{await store.finish(job,{code,retry:operational||job.attempts<6&&(controller.signal.aborted||!permanent)});}catch(saveError){emit(saveError);}
    }finally{timers.clearInterval(heartbeat);await renewal;controllers.delete(controller);}
  }
  async function tick(){if(stopped||cycling)return cycling;
    cycling=(async()=>{await store.discover(8,{priorityPhotoHashes:priorities()});let claimed=0;while(!stopped&&tasks.size<concurrency&&claimed++<concurrency){
      const lane=['context','selected','context','oldest'][schedulingTurn++%4];
      const job=await store.claim(concurrency,{priorityPhotoHashes:priorities(),lane});if(!job)break;
      const task=execute(job).finally(()=>tasks.delete(task));tasks.add(task);}})().catch(emit).finally(()=>{cycling=null;});return cycling;}
  return Object.freeze({read,inspection,
    async retry(staff,cardId,input){const result=await store.retry(staff,cardId,input);if(!stopped)void tick();return result;},
    start(){if(closed||!stopped)return false;stopped=false;timer=timers.setInterval(()=>void tick(),intervalMs);timer?.unref?.();void tick();return true;},
    wake(){if(!stopped)void tick();},tick,
    async stop(){closed=true;stopped=true;timers.clearInterval(timer);for(const c of controllers)c.abort(Object.assign(new Error('DISPLAY_WORKER_STOPPED'),{code:'DISPLAY_WORKER_STOPPED'}));await cycling;await Promise.allSettled([...tasks]);},
    status:()=>({stopped,active:tasks.size})});
}
