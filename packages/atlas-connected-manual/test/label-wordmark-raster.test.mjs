import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {digest} from '@atlas/manual-service/contract';
import {validateLabelWordmarkImage,LABEL_WORDMARK_RASTER_POLICY} from '../src/label-wordmark-image.mjs';
const width=1536,height=1024;
async function fixture({noise=0,spread=14,background=[253,254,254],tint=false}={}){
  const data=Buffer.alloc(width*height*3);for(let i=0;i<width*height;i++)data.set(background,i*3);
  for(let y=400;y<600;y++)for(let x=200;x<1200;x++)data.set(tint?[20,25,28]:[20,20,20],(y*width+x)*3);
  for(let i=0;i<noise;i++)data.set([30,30,30+spread],((400+Math.floor(i/1000))*width+200+i%1000)*3);
  const bytes=await sharp(data,{raw:{width,height,channels:3}}).png().toBuffer();
  return {bytes,sha256:digest(bytes),width,height,mimeType:'image/png'};
}
test('isolated near-gray sample noise is bounded and recorded while raw bytes remain unchanged',async()=>{
  const image=await fixture({noise:250}),before=digest(image.bytes),decoded=await validateLabelWordmarkImage(image);
  assert.equal(digest(image.bytes),before);assert.equal(decoded.normalization.policy,LABEL_WORDMARK_RASTER_POLICY);
  assert.equal(decoded.normalization.maxChannelSpread,14);assert.equal(decoded.normalization.pixelsAboveSpread8,250);
  assert.equal(decoded.gray[0],255);assert.equal(decoded.gray[400*width+200],35);
  assert.equal(decoded.gray[500*width+200],20);assert.equal(decoded.inkPixels,200000);
});
test('true color, widespread tint and excessive near-gray deviations still fail closed',async()=>{
  for(const options of [{noise:1,spread:17},{noise:1600,spread:9},{background:[246,250,254],tint:true}])
    await assert.rejects(validateLabelWordmarkImage(await fixture(options)),/LABEL_WORDMARK_COLOR_INVALID|LABEL_WORDMARK_CLIPPED/);
});
