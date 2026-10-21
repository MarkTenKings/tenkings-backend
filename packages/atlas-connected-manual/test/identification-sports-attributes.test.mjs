import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { digest } from '@atlas/manual-service/contract';
import { identifyAtlasCard, parseAtlasIdentificationResult } from '../src/identification-layout.mjs';
import { sportsAttributesModelProposal, parseSportsAttributesProposal, emptySportsAttributesModelProposal } from '../src/identification-sports-attributes.mjs';
const input={subject:{id:'local-fixture',revision:'f'.repeat(64)},photos:{front:{ref:'front',sha256:'a'.repeat(64),byteCount:100},back:{ref:'back',sha256:'b'.repeat(64),byteCount:100}}};
test('machine proposals retain actual source slots, cannot claim absence, and fail stale or invented evidence',()=>{
 const raw=emptySportsAttributesModelProposal();raw.serial={printed:'007/099',confidence:'high',evidence:[{side:'BACK',observation:'Back: 007/099.'}]};
 const p=sportsAttributesModelProposal(raw,input);assert.equal(p.attributes.serial.evidence[0].imageSha256,input.photos.back.sha256);assert.equal(p.attributes.serial.numerator,7);assert.deepEqual(parseSportsAttributesProposal(p,input),p);
 const stale=structuredClone(input);stale.subject.revision='e'.repeat(64);assert.throws(()=>parseSportsAttributesProposal(p,stale));
 const absent=structuredClone(raw);absent.autograph.presence='ABSENT';assert.throws(()=>sportsAttributesModelProposal(absent,input));
 const unsupported=structuredClone(raw);unsupported.serial.evidence=[];assert.throws(()=>sportsAttributesModelProposal(unsupported,input));
 const unknown=sportsAttributesModelProposal(emptySportsAttributesModelProposal(),input);assert.equal(unknown.attributes.autograph.presence,'UNKNOWN');
 assert.equal(sportsAttributesModelProposal(emptySportsAttributesModelProposal(),input,{sports:false}),null);
 assert.throws(()=>sportsAttributesModelProposal(raw,input,{sports:false}));
});
test('stored v3 and v4 executions retain their original schema, no sports proposal, and stable request bytes',async()=>{
 const bytes=Object.fromEntries(await Promise.all(['front','back'].map(async(side,index)=>[side,await sharp({create:{width:20,height:28,channels:3,background:index?'#eeeeee':'#ffffff'}}).jpeg().toBuffer()])));
 const source={...input,photos:Object.fromEntries(['front','back'].map(side=>[side,{ref:side,sha256:digest(bytes[side]),byteCount:bytes[side].length}]))};
 // Captured with these exact synthetic inputs from reconciled live source c4b7cc85.
 const originalRequestHashes={'atlas-identification-layout-v3':'5a09e1799a90cbdeaa2bef9638aa40ea622d343a56d473fe666160f8ffec0af5','atlas-identification-layout-v4':'2710f828006abb4061be5972cabbe64d6a9fb72a0d4addf11e78a46aab42aa80'};
 const values={name:'Fixture Player',category:'Sports cards',manufacturer:'Fixture',card_number:'007',year:'2026',set_name:'Test set',variant:null,card_type:null};
 for(const engineVersion of ['atlas-identification-layout-v3','atlas-identification-layout-v4']){
  const requests=[];const effects={readPhoto:async(_photo,context)=>bytes[context.side],ocr:async()=>Buffer.from(JSON.stringify({responses:[{fullTextAnnotation:{text:'Fixture Player 2026'}}]})),model:async request=>{
   requests.push(JSON.stringify(request));const fields=Object.fromEntries(Object.entries(values).map(([key,value])=>[key,{value,confidence:value?'high':'unknown',evidence:value?`Front: ${value}`:null}]));
   return Buffer.from(JSON.stringify({model:'gpt-6-astra',status:'completed',error:null,incomplete_details:null,usage:{input_tokens:1,output_tokens:1},output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({...fields,layout_type:{value:null,confidence:'unknown',evidence:null}})}]}]}));
  }};
  const result=await identifyAtlasCard(source,effects,{engineVersion});await identifyAtlasCard(source,effects,{engineVersion});
  assert.equal(digest(requests[0]),originalRequestHashes[engineVersion]);assert.equal(requests[0],requests[1]);assert.equal(JSON.parse(requests[0]).text.format.name,engineVersion.endsWith('v4')?'atlas_card_details_layout_v4':'atlas_card_details_layout_v3');
  assert.equal(Object.hasOwn(JSON.parse(requests[0]).text.format.schema.properties,'sports_attributes'),false);
  assert.equal(Object.hasOwn(result,'sportsAttributesProposal'),false);assert.deepEqual(parseAtlasIdentificationResult(result,source,engineVersion),result);
 }
});
