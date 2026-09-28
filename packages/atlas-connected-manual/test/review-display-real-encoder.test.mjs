import test from 'node:test';import assert from 'node:assert/strict';import sharp from 'sharp';
import {setup,photo,photoSource,working} from './review-display-fixture.mjs';
test('background real encoder retains exact full pixels and cold reads reuse persisted descriptors',async()=>{
 const before=structuredClone(photo),f=setup({real:true});await f.run();await f.service.stop();
 const read=await f.service.read(photo,photoSource);assert.equal(read.displayState.state,'READY');assert.equal(f.objects.size,2);
 const full=f.objects.get(f.jobs.get('full').result.descriptor.raster.object.key);
 assert.deepEqual(await sharp(full,{ignoreIcc:true}).raw().toBuffer(),await sharp(working.png,{ignoreIcc:true}).raw().toBuffer());
 const calls=f.reads;await f.service.read(photo,photoSource);assert.equal(f.reads,calls);assert.deepEqual(photo,before);
});
