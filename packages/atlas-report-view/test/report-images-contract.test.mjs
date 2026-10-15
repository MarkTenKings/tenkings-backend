import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReportImages, reportImageURL } from '../src/report-images-contract.mjs';

const binding={publicToken:'ar_'+'A'.repeat(24),approvalVersion:1,publicHash:'a'.repeat(64)};
const base={...binding,side:'FRONT',sourceSha256:'b'.repeat(64),sha256:'c'.repeat(64),contentType:'image/png',transparent:true,presentationOnly:true};
const cleaned={...base,width:3024,height:4032,byteCount:19_166_170,preservesOriginalRGB:false,preservesOpaqueRGB:true,foregroundRGBValidation:'bounded-edge-rgb-v1',alignment:'original-frame',
 recipeVersion:'atlas-photoroom-plus-hd-v2',execution:'PHOTOROOM_PLUS_API',segmentationSourceSha256:'d'.repeat(64),originalSha256:'e'.repeat(64),url:reportImageURL(base)};
const legacy={...base,width:1104,height:1520,byteCount:2_000_000,preservesOriginalRGB:false,alignment:'approximate-frame-fit',
 promptVersion:'atlas-background-grading-api-v3',model:'gpt-image-2.5-sunburst-2026-09-08',execution:'OPENAI_IMAGES_API',
 generationSourceSha256:'d'.repeat(64),originalSha256:'e'.repeat(64),url:reportImageURL(base)};
const manifest=image=>({version:'atlas-report-images-v1',...binding,images:{FRONT:image}});
const packet={...binding,images:{FRONT:{sha256:base.sourceSha256}}};

test('full-resolution Photoroom presentation has segmentation provenance and historical images stay readable',()=>{
 for(const image of [cleaned,legacy])assert.deepEqual(parseReportImages(manifest(image),{packet,publicHash:binding.publicHash}),manifest(image));
 assert.equal(parseReportImages(manifest(cleaned)).images.FRONT.model,undefined);
});

test('historical image bounds and fidelity claims cannot be relaxed by the Photoroom reader',()=>{
 for(const patch of [{width:3024,height:4032},{byteCount:4*1024*1024+1},{preservesOriginalRGB:true},{alignment:'original-frame'},
  {recipeVersion:'atlas-photoroom-plus-hd-v2'},{execution:'PHOTOROOM_PLUS_API'}])assert.throws(()=>parseReportImages(manifest({...legacy,...patch})));
});

test('Photoroom report rejects invalid full-frame bounds, source association and false generative metadata',()=>{
 for(const patch of [{width:5001},{byteCount:101*1024*1024+1},{preservesOriginalRGB:true},{preservesOpaqueRGB:false},
  {foregroundRGBValidation:'exact-visible-rgb-v1'},{alignment:'approximate-frame-fit'},
  {model:'gpt-image-2.5-sunburst-2026-09-08'},{promptVersion:'old'},{generationSourceSha256:'d'.repeat(64)},
  {sourceSha256:'f'.repeat(64)},{url:'/different'},{originalSha256:undefined}]){
  assert.throws(()=>parseReportImages(manifest({...cleaned,...patch}),{packet,publicHash:binding.publicHash}));
 }
});
