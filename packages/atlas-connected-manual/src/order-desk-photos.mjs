import { createHash } from 'node:crypto';
import { requireThat, canonical } from '@atlas/manual-service/contract';
import { ownedUpload } from '@atlas/customer-intake/contract';
import { processedPhoto } from '@atlas/manual-intake/contract';

const LIMITS=Object.freeze({maxInputBytes:256*1024*1024,maxPixels:52_000_000,maxRasterBytes:512*1024*1024,maxOutputBytes:4*1024*1024,timeoutMs:90000});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const need=value=>requireThat(value,503,'ORDER_PHOTO_BINDING_INVALID');

export async function generateOrderDeskDisplay({bytes,frame,signal,output}) {
  const {default:sharp}=await import('sharp');signal?.throwIfAborted();
  const maximum=output==='preview'?768:2560;
  let result;
  for(const [size,quality] of [[maximum,88],[Math.min(maximum,1920),75]]) {
    result=await sharp(bytes,{limitInputPixels:LIMITS.maxPixels,failOn:'error',sequentialRead:true})
      .resize({width:size,height:size,fit:'inside',withoutEnlargement:true}).jpeg({quality,mozjpeg:false}).timeout({seconds:80}).toBuffer({resolveWithObject:true});
    signal?.throwIfAborted();if(result.data.length<=LIMITS.maxOutputBytes)break;
  }
  need(result.data.length<=LIMITS.maxOutputBytes);
  return {sourceSha256:frame.raster.content.sha256,[output]:{bytes:result.data,content:{mime:'image/jpeg',byteCount:result.data.length,sha256:sha(result.data)},dimensions:{width:result.info.width,height:result.info.height}}};
}

/** Separate navigation media derived from the exact customer working frame.
 * Never modifies originals, creates grading evidence, signs public URLs or
 * invokes identification/preparation/providers. Cache bytes remain private and
 * bounded; the service reauthenticates even when this reader hits its cache. */
export function createOrderDeskPhotoReader({storage,generate=generateOrderDeskDisplay,limited=work=>work(),maxCacheBytes=64*1024*1024,now=Date.now}={}) {
  need(storage?.readDecodedFrame && typeof generate==='function' && typeof limited==='function');
  need(Number.isSafeInteger(maxCacheBytes)&&maxCacheBytes>=0&&maxCacheBytes<=128*1024*1024);
  const cache=new Map(),pending=new Map();let cachedBytes=0;
  function evict(key){const item=cache.get(key);if(item){cachedBytes-=item.value.bytes.length;cache.delete(key);}}
  return Object.freeze({async read(source,size) {
    need(['thumbnail','detail'].includes(size));const upload=ownedUpload(source?.upload);
    need(source.uploadId===upload.plan.uploadId && source.photoPairHash===source.paidPhotoPairHash);
    requireThat(upload.verification && upload.prepared,409,'ORDER_PHOTO_NOT_PREPARED');
    const photo=processedPhoto(upload.prepared,upload.plan,upload.verification),frame=photo.workingFrame;
    need(frame.raster.object.key.startsWith(`atlas-customer/derived/${upload.cardId}/`));
    const key=sha(canonical({orderId:source.orderId,uploadId:source.uploadId,photoPairHash:source.photoPairHash,photo,size}));
    for(const [id,item] of cache)if(item.expires<=now())evict(id);
    const hit=cache.get(key);if(hit){cache.delete(key);cache.set(key,hit);return {...hit.value,bytes:Buffer.from(hit.value.bytes)};}
    if(!pending.has(key)) {
      requireThat(pending.size<32,503,'ORDER_PHOTO_BUSY');
      const work=limited(async()=>{
        const signal=AbortSignal.timeout(LIMITS.timeoutMs),found=await storage.readDecodedFrame({frame,original:photo.original,decodePlan:photo.decodePlan,signal});
        need(found.bytes instanceof Uint8Array && found.byteCount===frame.raster.content.byteCount && found.sha256===frame.raster.content.sha256
          && found.contentType==='image/png' && canonical(found.object)===canonical(frame.raster.object) && sha(found.bytes)===frame.raster.content.sha256);
        const generated=await generate({bytes:found.bytes,frame,original:photo.original,decodePlan:photo.decodePlan,limits:LIMITS,signal,output:size==='thumbnail'?'preview':'full'});
        const output=generated?.[size==='thumbnail'?'preview':'full'];need(generated?.sourceSha256===frame.raster.content.sha256 && output?.bytes instanceof Uint8Array);
        const bytes=Buffer.from(output.bytes),contentType='image/jpeg';
        need(bytes.length>0&&bytes.length<=LIMITS.maxOutputBytes&&output.content?.mime===contentType&&output.content.byteCount===bytes.length&&output.content.sha256===sha(bytes));
        need(Number.isInteger(output.dimensions?.width)&&Number.isInteger(output.dimensions?.height)&&output.dimensions.width>=2&&output.dimensions.height>=2);
        if(size==='thumbnail')need(output.dimensions.width<=Math.min(768,frame.raster.dimensions.width)&&output.dimensions.height<=Math.min(768,frame.raster.dimensions.height));
        else need(output.dimensions.width<=Math.min(2560,frame.raster.dimensions.width)&&output.dimensions.height<=Math.min(2560,frame.raster.dimensions.height));
        need(Math.abs(output.dimensions.width*frame.raster.dimensions.height-output.dimensions.height*frame.raster.dimensions.width)<=Math.max(frame.raster.dimensions.width,frame.raster.dimensions.height));
        const value={bytes,contentType,sha256:output.content.sha256,width:output.dimensions.width,height:output.dimensions.height};
        while(cachedBytes+bytes.length>maxCacheBytes&&cache.size)evict(cache.keys().next().value);
        if(bytes.length<=maxCacheBytes){cache.set(key,{value,expires:now()+300000});cachedBytes+=bytes.length;}
        return value;
      });
      pending.set(key,Promise.resolve(work).finally(()=>pending.delete(key)));
    }
    const result=await pending.get(key);return {...result,bytes:Buffer.from(result.bytes)};
  }});
}
