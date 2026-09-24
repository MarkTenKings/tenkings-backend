import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {researchCardSubject,StaffInventoryResearchInputSchema,StaffInventoryResearchResultSchema} from '../src/index.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const subject={namespace:'atlas',id:'opaque-owned-subject',revision:'d'.repeat(64)};
const description={name:'Synthetic Player',category:'Sports cards',year:'2026',manufacturer:'Fixture',set_name:'Synthetic product',card_number:'001',variant:null,card_type:null};
test('neutral contract carries an opaque subject and exact byte descriptors without Inventory unit/event/storage authority',()=>{
 const input={schema_version:1,subject,description,photos:{front:null,back:null}};
 assert.deepEqual(StaffInventoryResearchInputSchema.parse(input),input);
 assert.equal(StaffInventoryResearchInputSchema.safeParse({...input,unit_id:'inventory-owned-unit'}).success,false);
 assert.equal(StaffInventoryResearchInputSchema.safeParse({...input,photos:{front:{ref:'http://private-storage',sha256:'a'.repeat(64),sourceSha256:'b'.repeat(64),mimeType:'image/jpeg',byteCount:2,storage_key:'private'},back:null}}).success,false);
});
test('neutral photo reader verifies caller binding and derivative bytes before any visual model assessment',async()=>{
 const bytes=await sharp({create:{width:20,height:30,channels:3,background:'white'}}).jpeg().toBuffer();
 const descriptor={ref:'opaque-photo',sha256:hash(bytes),sourceSha256:'b'.repeat(64),mimeType:'image/jpeg',byteCount:bytes.length};
 const input={schema_version:1,subject,description,photos:{front:descriptor,back:null}},calls=[];
 const result=await researchCardSubject(input,{env:{OPENAI_API_KEY:'owned-test-key',SOLDCOMPS_API_KEY:'owned-sold-key'},requestCount:40,hydrateBoa:false,
  loadPhoto:async photo=>({...photo,sourceSha256:'c'.repeat(64),bytes}),fetchImpl:async url=>{calls.push(url);return Response.json({keyword:new URL(url).searchParams.get('keyword'),page:1,totalItems:0,hasNextPage:false,items:[]});}});
 assert.equal(result.subject.namespace,'atlas');assert.equal(result.photos.front,null);assert(result.warnings.some(w=>w.includes('front photo could not be verified')));
 assert(calls.every(url=>url.startsWith('https://api.sold-comps.com/')));assert.equal('unit_id' in result,false);assert.equal(StaffInventoryResearchResultSchema.safeParse(result).success,true);
});
