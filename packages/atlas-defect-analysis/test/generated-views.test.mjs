import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAstraContextBackgroundDefectRequest,buildAstraContextBackgroundDefectRequestAsync,restorePreparedRequest,restorePreparedRequestAsync,parseDefectProposals,validateRequestEvidence} from '../src/index.mjs';
import {contextInputFixture,raster,outputFixture,hash} from './fixtures.mjs';
import {digest} from '../src/contract.mjs';
function fixture(){const value=contextInputFixture();value.generatedViews=['FRONT','BACK'].map((side,i)=>({side,originalSha256:value.binding.sides[side].frame.originalSha256,generatedSha256:hash('generated-'+side),...raster(100,140,70+i)}));return value;}
test('generated views supplement the ten unchanged coordinate images and restore exact bytes',async()=>{
 const baseline=buildAstraContextBackgroundDefectRequest(contextInputFixture()),input=fixture(),request=buildAstraContextBackgroundDefectRequest(input);
 assert.deepEqual(request.evidence.images,baseline.evidence.images);assert.equal(request.evidence.generatedViews.length,2);
 assert.equal(request.request.input[1].content.filter(p=>p.type==='input_image').length,12);
 assert.match(request.requestText,/may repaint edges/);assert.match(request.requestText,/coordinates only from CURRENT_CARD/);
 assert.deepEqual(validateRequestEvidence(request.evidence),request.evidence);
 assert.equal(restorePreparedRequest(request).requestText,request.requestText);
 assert.equal((await restorePreparedRequestAsync(request)).requestText,request.requestText);
 assert.equal((await buildAstraContextBackgroundDefectRequestAsync(fixture())).requestText,request.requestText);
 input.generatedViews[0].bytes=Buffer.alloc(50);assert.equal(digest(request.requestText),request.requestHash);
 const bad=outputFixture(request.evidence);bad.findings[0].imageId='FRONT:generated';assert.throws(()=>parseDefectProposals(bad,request.evidence));
});
test('generated evidence cannot cross photo bindings, duplicate sides or escape exact request replay',()=>{
 for(const change of [v=>{v.generatedViews[0].originalSha256=hash('different');},v=>{v.generatedViews[1].side='FRONT';},v=>{v.generatedViews[0].sha256=hash('different');}]){
  const input=fixture();change(input);assert.throws(()=>buildAstraContextBackgroundDefectRequest(input));
 }
 const request=buildAstraContextBackgroundDefectRequest(fixture()),body=JSON.parse(request.requestText);
 const metadata=body.input[1].content.find(v=>v.type==='input_text'&&v.text.includes('GENERATED_VIEW_AID'));
 metadata.text=metadata.text.replace('may repaint','cannot repaint');const requestText=JSON.stringify(body);
 assert.throws(()=>restorePreparedRequest({...request,requestText,requestHash:digest(requestText)}));
});
