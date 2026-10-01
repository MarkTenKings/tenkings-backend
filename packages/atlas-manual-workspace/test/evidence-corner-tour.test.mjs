import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeSpeedsterTraceRleV1} from '@atlas/grading-core/trace-codec';
import {CORNER_FIELDS,cornerContact,createCornerTour,sampleCornerTour} from '../src/evidence-corner-tour.mjs';
import {edgeCamera} from '../src/evidence-edge-tour.mjs';
function finding(id,pixels,side='FRONT'){
  const bitmap=new Uint8Array(1270*1778);for(const[x,y]of pixels)bitmap[y*1270+x]=1;
  return {id,side,reviewResult:'ACCEPTED',defectType:'LIGHT_SCRATCH_SCUFF',finalTrace:encodeSpeedsterTraceRleV1(bitmap),measurementRegions:[{zone:'SURFACE',measurement:{areaMm2:pixels.length/400}}]};
}
test('corner scan membership follows exact pixels, not bounding boxes or grading categories',()=>{
  const contact=finding('surface',[[319,319],[320,319],[319,320]]);
  const before=JSON.stringify(contact),hit=cornerContact(contact,CORNER_FIELDS[0]);
  assert.ok(hit);assert.equal(hit.start,319/320);assert.equal(hit.end,1);
  assert.equal(hit.finding,contact);assert.equal(hit.finding.measurementRegions[0].zone,'SURFACE');assert.equal(JSON.stringify(contact),before);
  assert.equal(cornerContact(finding('empty-corner-bounds',[[0,900],[600,0]]),CORNER_FIELDS[0]),null);
  assert.equal(cornerContact({...contact,reviewResult:'REMOVED'},CORNER_FIELDS[0]),null);
  assert.equal(cornerContact({...contact,reviewResult:'PROPOSED'},CORNER_FIELDS[0]),null);
});
test('each corner gets the same field and actual findings retain their whole trace at inspection stops',()=>{
  const source=[finding('tl',[[0,0]]),finding('tr',[[1269,0]],'BACK'),finding('br',[[1269,1777]]),finding('bl',[[0,1777]],'BACK')];
  const plan=createCornerTour(source);assert.deepEqual(plan.hits.map(h=>h.finding.id),['tl','tr','br','bl']);
  assert.deepEqual(CORNER_FIELDS.map(f=>[f.width,f.height]),Array(4).fill([320,320]));
  for(const hold of plan.segments.filter(s=>s.kind==='inspect')){
    const sample=sampleCornerTour(plan,(hold.start+1)/plan.duration);
    assert.equal(sample.finding,hold.finding);assert.equal(sample.finding.finalTrace,source.find(f=>f.id===hold.finding.id).finalTrace);
    assert.ok(Math.abs(hold.end-hold.start-3.5)<1e-10);
  }
  assert.equal(plan.sample,sampleCornerTour);assert.equal('angle' in sampleCornerTour(plan,.5),false);
});
test('reverse scrubbing is deterministic and empty-corner cameras stay inside saved photographs',()=>{
  const plan=createCornerTour([]);assert.equal(plan.hits.length,0);assert.equal(plan.segments.filter(s=>s.kind==='field-complete').length,4);
  for(const p of [0,.1,.5,.9,1,.5,0]){
    const sample=sampleCornerTour(plan,p),camera=edgeCamera(sample,358,430);
    assert.ok(camera.x>=0&&camera.y>=0&&camera.x+camera.width<=1350&&camera.y+camera.height<=1858);
    assert.ok(sample.scan>=0&&sample.scan<=1);assert.deepEqual(sample,sampleCornerTour(plan,p));
  }
});
