// Explicit read-only retained-photo proof, run inside the candidate image.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import sharp from 'sharp';
import {verifyAndDecodePhoto,deriveSdrWorkingPhoto} from '@atlas/photo-runtime';
const hash=value=>createHash('sha256').update(value).digest('hex');
assert.equal(process.platform,'linux');assert.equal(process.arch,'x64');assert.equal(process.versions.node.split('.')[0],'20');
const python=process.env.ATLAS_MANUAL_PYTHON;
const versions=JSON.parse(execFileSync(python,['-c','import json,cv2,numpy,platform; print(json.dumps({"python":platform.python_version(),"opencv":cv2.__version__,"numpy":numpy.__version__}))'],{encoding:'utf8'}));
assert.equal(versions.opencv,'4.10.0');assert.equal(versions.numpy,'1.26.4');
const observations=[];
for(const side of ['FRONT','BACK']){
 const path=`/retained/${side}-original-download.HEIC`,bytes=await readFile(path),originalHash=hash(bytes);
 const originalObject={key:`qualification/originals/${side}`,versionId:null};
 const input={bytes,uploadPlan:{schemaVersion:1,uploadId:`linux-${side}`,binding:{cardId:'linux-retained-proof',pairId:'retained',side,version:1},object:originalObject,expected:{sha256:originalHash,byteCount:bytes.length}},observedObject:originalObject,
 limits:{maxInputBytes:256*1024*1024,maxPixels:52000000,maxRasterBytes:512*1024*1024,maxOutputBytes:256*1024*1024,timeoutMs:90000}};
 await assert.rejects(verifyAndDecodePhoto(input),error=>['PHOTO_HDR_UNSUPPORTED','PHOTO_HEIC_UNSUPPORTED'].includes(error.code));
 const rich=await verifyAndDecodePhoto({...input,heicHdrPolicy:'retain-hdr-use-sdr-base'});
 const working=await deriveSdrWorkingPhoto(rich,{limits:input.limits});
 assert.equal(hash(await readFile(path)),originalHash);assert.deepEqual(working.original,rich.original);
 assert.deepEqual(working.raster.dimensions,{width:3024,height:4032});
 for(const [name,value] of [['primary',rich],['working',working]]){
   const result=await sharp(value.png,{ignoreIcc:true}).raw().toBuffer();
   const oracle=await sharp(await readFile(`/mac-oracle/${side.toLowerCase()}-${name}.png`),{ignoreIcc:true}).raw().toBuffer();
   assert.deepEqual(result,oracle,`${side} ${name} actual pixels differ across runtimes`);
   observations.push({side,kind:name,pngSha256:hash(value.png),rawSha256:hash(result),byteCount:value.png.length,dimensions:value.raster.dimensions,originalSha256:originalHash,originalByteCount:bytes.length,macPixelComparison:'EXACT'});
 }
}
console.log(JSON.stringify({status:'LINUX_NODE20_RETAINED_PHOTOS_PASS',node:process.version,platform:process.platform,arch:process.arch,versions,observations},null,2));
