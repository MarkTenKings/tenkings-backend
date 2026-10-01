import { filmSelector, parseApprovedFilmManifest, approvedFilmFilename } from '../../atlas-report-view/src/approved-film-contract.mjs';
const hex=bytes=>Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('');
export const sha256=async bytes=>hex(await crypto.subtle.digest('SHA-256',bytes));
export async function boundedFilmResponse(response,limit,signal) {
  if(!response.ok||!response.body)throw Error(response.status===404?'REPORT_UNAVAILABLE':'FILM_UNAVAILABLE');
  const reader=response.body.getReader(),parts=[];let size=0;
  try{while(true){signal?.throwIfAborted();const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)throw Error('FILM_RESPONSE_TOO_LARGE');parts.push(value);}}
  finally{await reader.cancel().catch(()=>{});}
  const out=new Uint8Array(size);let offset=0;for(const p of parts){out.set(p,offset);offset+=p.length;}return out;
}
async function readApprovedFilmManifest(reportUrl,{signal,fetcher}) {
  const selected=filmSelector(reportUrl);if(!selected)throw Error('REPORT_UNAVAILABLE');
  const response=await fetcher(selected.url,{signal,credentials:'omit',cache:'no-store',redirect:'error'});
  if(!/^application\/json(?:;|$)/i.test(response.headers.get('content-type')??''))throw Error('FILM_UNAVAILABLE');
  const bytes=await boundedFilmResponse(response,12*1024*1024,signal),manifest=parseApprovedFilmManifest(JSON.parse(new TextDecoder().decode(bytes)),reportUrl);
  if(await sha256(new TextEncoder().encode(JSON.stringify(manifest.packet)))!==manifest.publicHash)throw Error('FILM_BINDING_INVALID');
  return manifest;
}
async function readApprovedFilmPhotos(manifest,{signal,fetcher}) {
  const photos={};try{for(const side of['FRONT','BACK']){const d=manifest.packet.images[side],url=`/api/reports/${manifest.packet.publicToken}/images/${side}?v=${manifest.packet.approvalVersion}`;
    const response=await fetcher(url,{signal,credentials:'omit',cache:'no-store',redirect:'error'});
    if(response.headers.get('content-type')?.split(';')[0]!==d.contentType)throw Error('FILM_IMAGE_UNAVAILABLE');
    const bytes=await boundedFilmResponse(response,d.byteCount,signal);if(bytes.length!==d.byteCount||await sha256(bytes)!==d.sha256)throw Error('FILM_IMAGE_MISMATCH');
    const image=await createImageBitmap(new Blob([bytes],{type:d.contentType}));if(image.width!==d.width||image.height!==d.height){image.close();throw Error('FILM_IMAGE_MISMATCH');}photos[side]=image;
  }return photos;}catch(error){Object.values(photos).forEach(image=>image.close());throw error;}
}
async function withFilmLoadDeadline(parent,task) {
  parent?.throwIfAborted();const controller=new AbortController(),abort=()=>controller.abort(parent.reason);
  parent?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>controller.abort(Error('FILM_LOAD_TIMEOUT')),30000);
  try{return await task(controller.signal);}finally{clearTimeout(timer);parent?.removeEventListener('abort',abort);}
}
export function loadApprovedFilmManifest(reportUrl,{signal,fetcher=fetch}={}) {
  return withFilmLoadDeadline(signal,bounded=>readApprovedFilmManifest(reportUrl,{signal:bounded,fetcher}));
}
export function loadApprovedFilmPhotos(manifest,{signal,fetcher=fetch}={}) {
  return withFilmLoadDeadline(signal,bounded=>readApprovedFilmPhotos(manifest,{signal:bounded,fetcher}));
}
export function filmRecordingFormat(Recorder=globalThis.MediaRecorder) {
  if(typeof Recorder?.isTypeSupported!=='function')return null;
  for(const [mimeType,extension]of[['video/mp4;codecs=avc1.42E01E','mp4'],['video/mp4','mp4'],['video/webm;codecs=vp9','webm'],['video/webm;codecs=vp8','webm'],['video/webm','webm']])
    if(Recorder.isTypeSupported(mimeType))return{mimeType,extension};
  return null;
}
/** Explicit local export, cancelled on navigation/backgrounding. No server job or upload. */
export async function recordApprovedFilm({canvas,renderer,manifest,signal,onProgress=()=>{},verify=()=>loadApprovedFilmManifest(manifest.reportUrl,{signal})}) {
  const format=filmRecordingFormat();if(!format||typeof canvas.captureStream!=='function')throw Error('FILM_EXPORT_UNSUPPORTED');
  signal?.throwIfAborted();renderer.paint(0);const stream=canvas.captureStream(30);let recorder,frame,timer,error,complete=false,bytes=0;const parts=[];
  try {
    recorder=new MediaRecorder(stream,{mimeType:format.mimeType,videoBitsPerSecond:6_000_000});
    await new Promise((resolve,reject)=>{
      const fail=reason=>{error=reason;cancelAnimationFrame(frame);if(recorder.state!=='inactive')recorder.stop();else reject(reason);};
      const abort=()=>fail(Object.assign(Error('FILM_CANCELLED'),{name:'AbortError'}));
      const hidden=()=>{if(document.hidden)fail(Error('FILM_EXPORT_INTERRUPTED'));};
      const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);document.removeEventListener('visibilitychange',hidden);};
      recorder.ondataavailable=e=>{if(e.data.size){bytes+=e.data.size;if(bytes>32*1024*1024){fail(Error('FILM_EXPORT_TOO_LARGE'));return;}parts.push(e.data);}};
      recorder.onerror=()=>fail(Error('FILM_EXPORT_FAILED'));
      recorder.onstop=()=>{cleanup();error?reject(error):complete?resolve():reject(Error('FILM_EXPORT_INTERRUPTED'));};
      signal?.addEventListener('abort',abort,{once:true});document.addEventListener('visibilitychange',hidden);
      timer=setTimeout(()=>fail(Error('FILM_EXPORT_TIMEOUT')),22000);
      try{recorder.start(250);}catch(e){cleanup();reject(e);return;}
      const start=performance.now();let last=-Infinity;
      const paint=now=>{if(error)return;try{const t=Math.min(manifest.duration,(now-start)/1000);if(now-last>=30||t===manifest.duration){renderer.paint(t);last=now;onProgress(t/manifest.duration);}if(t>=manifest.duration){complete=true;recorder.stop();}else frame=requestAnimationFrame(paint);}catch(e){fail(e);}};
      frame=requestAnimationFrame(paint);
    });
    signal?.throwIfAborted();const current=await verify();
    if(current.publicHash!==manifest.publicHash||current.packet.reportHash!==manifest.packet.reportHash)throw Error('REPORT_CHANGED');
    const type=recorder.mimeType||format.mimeType,extension=type.startsWith('video/mp4')?'mp4':type.startsWith('video/webm')?'webm':null;
    if(!extension||bytes===0)throw Error('FILM_EXPORT_FAILED');
    return{blob:new Blob(parts,{type}),filename:approvedFilmFilename(manifest,extension),mimeType:type};
  }finally{clearTimeout(timer);cancelAnimationFrame(frame);if(recorder?.state&&recorder.state!=='inactive')recorder.stop();stream.getTracks().forEach(track=>track.stop());}
}
