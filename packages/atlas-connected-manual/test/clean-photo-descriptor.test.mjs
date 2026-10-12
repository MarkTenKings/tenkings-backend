import test from 'node:test';
import assert from 'node:assert/strict';
import {createCleanPhotoDescriptor} from '../src/clean-photo-descriptor.mjs';
import {photo} from './review-display-fixture.mjs';

test('saved clean grants retain their generating frame and cannot bind to a different original',async()=>{
  const media={original:photo.original,frame:photo.workingFrame,decodePlan:photo.decodePlan,
    descriptor:{purpose:'reveal',raster:{content:{sha256:'a'.repeat(64),mime:'image/png',byteCount:1000},dimensions:{width:40,height:56}}}};
  let job={state:'READY',bound_original_sha256:photo.original.content.sha256,result:{media,output:{sha256:'a'.repeat(64)}}},calls=0;
  const read=createCleanPhotoDescriptor({reportImages:{async photo(input){assert.equal(input.uploadId,'current-upload');return job;}},
    imageReadUrl:async input=>{calls++;assert.equal(input.kind,'clean');assert.equal(input.photo.workingFrame,media.frame);
      return{...input.descriptor.raster.content,url:'https://fixture.invalid/clean'};}});
  const input={cardId:'card',uploadId:'current-upload',side:'FRONT',photo};
  const clean=await read(input);assert.equal(clean.generative,true);assert.equal(clean.width,40);assert.equal(calls,1);
  const substituted=structuredClone(photo);substituted.original.content.sha256='b'.repeat(64);
  assert.equal(await read({...input,photo:substituted}),null,'bad optional cutout cannot hide original review');assert.equal(calls,1);
  job={state:'QUEUED'};assert.equal(await read(input),null);assert.equal(calls,1);
});
