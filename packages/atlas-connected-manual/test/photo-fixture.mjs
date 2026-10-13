import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {verifyAndDecodePhoto,deriveSdrWorkingPhoto,describeDecodedFrame} from '@atlas/photo-runtime';
export const sha=value=>createHash('sha256').update(value).digest('hex');
const bytes=await readFile(new URL('../../atlas-photo-runtime/test/fixtures/browser-canvas/opaque-p3.png',import.meta.url));
const object={key:'test/originals/front',versionId:null};
export const working=await deriveSdrWorkingPhoto(await verifyAndDecodePhoto({bytes,limits:{maxInputBytes:2e6,maxPixels:1e6,maxRasterBytes:8e6,maxOutputBytes:4e6,timeoutMs:5000},
  observedObject:object,uploadPlan:{schemaVersion:1,uploadId:'synthetic-upload',binding:{cardId:'synthetic-card',pairId:'pair',side:'FRONT',version:1},object,expected:{byteCount:bytes.length,sha256:sha(bytes)}}}));
export const photo={original:working.original,decodePlan:working.decodePlan,workingFrame:describeDecodedFrame(working,{id:'working',object:{key:'test/derived/working.png',versionId:null}})};
export const photoSource={ref:{sha256:'a'.repeat(64)}};
