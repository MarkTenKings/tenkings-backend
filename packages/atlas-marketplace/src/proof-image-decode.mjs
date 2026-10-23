import { createHash } from 'node:crypto';
import { requireValue } from './contract.mjs';

export const PROOF_IMAGE_LIMITS = Object.freeze({ maxObjectBytes: 10485760, maxPixels: 16000000, timeoutMs: 15000, maxConcurrent: 2, formats: Object.freeze(['image/png','image/jpeg']) });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function source(bytes, plan, limits) {
  requireValue(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= limits.maxObjectBytes && bytes.length === plan.byteCount && digest(bytes) === plan.sha256, 'PROOF_SOURCE_MISMATCH');
  requireValue(PROOF_IMAGE_LIMITS.formats.includes(plan.declaredType), 'PROOF_FORMAT_UNSUPPORTED');
}
function container(bytes) {
  if (bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    let at = 8, ended = false, chunks = 0;
    while (at < bytes.length) {
      requireValue(at + 12 <= bytes.length && ++chunks <= 10000, 'PROOF_IMAGE_INVALID');
      const length = bytes.readUInt32BE(at), type = bytes.toString('ascii',at+4,at+8), end = at+12+length;
      requireValue(end <= bytes.length && /^[A-Za-z]{4}$/.test(type) && !['acTL','fcTL','fdAT'].includes(type), 'PROOF_IMAGE_INVALID');
      requireValue(chunks !== 1 || type === 'IHDR' && length === 13, 'PROOF_IMAGE_INVALID');
      let crc = 0xffffffff;
      for (const byte of bytes.subarray(at+4,end-4)) { crc ^= byte; for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0); }
      requireValue(((crc^0xffffffff)>>>0) === bytes.readUInt32BE(end-4), 'PROOF_IMAGE_INVALID');
      at = end;
      if(type === 'IEND') { requireValue(length===0 && at===bytes.length,'PROOF_IMAGE_INVALID'); ended=true; break; }
    }
    requireValue(ended, 'PROOF_IMAGE_INVALID'); return 'png';
  }
  requireValue(bytes.length >= 4 && bytes[0]===255 && bytes[1]===216,'PROOF_IMAGE_INVALID');
  // Walk segment lengths and entropy escapes so an EOI in EXIF cannot disguise
  // truncation or an appended second image. Actual raster decoding follows.
  let at = 2, scan = false, segments = 0;
  while(at < bytes.length) {
    requireValue(++segments <= bytes.length, 'PROOF_IMAGE_INVALID');
    if(scan) {
      while(at < bytes.length && bytes[at]!==255)at++;
      requireValue(at < bytes.length,'PROOF_IMAGE_INVALID');
    }
    requireValue(bytes[at++]===255,'PROOF_IMAGE_INVALID');
    while(bytes[at]===255)at++;
    const marker=bytes[at++];
    if(scan && (marker===0 || marker>=208&&marker<=215))continue;
    scan=false;
    if(marker===217){requireValue(at===bytes.length,'PROOF_IMAGE_INVALID');return 'jpeg';}
    requireValue(marker!==216 && marker!==0 && marker!==undefined && at+2<=bytes.length,'PROOF_IMAGE_INVALID');
    const length=bytes.readUInt16BE(at);
    requireValue(length>=2 && at+length<=bytes.length,'PROOF_IMAGE_INVALID');
    at+=length; if(marker===218)scan=true;
  }
  requireValue(false,'PROOF_IMAGE_INVALID');
}
export async function decode(bytes, plan, limits) {
  source(bytes,plan,limits); const format=container(bytes);
  requireValue(plan.declaredType === (format==='png'?'image/png':'image/jpeg'),'PROOF_FORMAT_MISMATCH');
  const sharp=(await import('sharp')).default;
  requireValue(sharp.versions.sharp==='0.33.5' && sharp.versions.vips==='8.15.3','PROOF_DECODER_VERSION_UNAVAILABLE');
  sharp.cache(false); sharp.concurrency(1);
  const options={failOn:'warning',sequentialRead:true,limitInputPixels:limits.maxPixels};
  const metadata=await sharp(bytes,options).metadata();
  const {width,height}=metadata;
  requireValue(metadata.format===format && (metadata.pages??1)===1 && Number.isSafeInteger(width) && Number.isSafeInteger(height) && width>=1 && height>=1 && width*height<=limits.maxPixels,'PROOF_IMAGE_LIMIT');
  const {data,info}=await sharp(bytes,options).raw({depth:'uchar'}).toBuffer({resolveWithObject:true});
  requireValue(info.width===width && info.height===height && Number.isSafeInteger(info.channels) && info.channels>=1 && info.channels<=4 && data.length===width*height*info.channels && data.length<=limits.maxPixels*4,'PROOF_DECODE_INVALID');
  data.fill(0);
  return {schema:'atlas-marketplace-proof-image-v1',decoder:'sharp-0.33.5/libvips-8.15.3',contentType:plan.declaredType,byteCount:bytes.length,sha256:digest(bytes),width,height};
}
