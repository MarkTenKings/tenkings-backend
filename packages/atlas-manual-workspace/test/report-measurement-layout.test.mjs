import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeSpeedsterTraceRleV1} from '@atlas/grading-core/trace-codec';
import {reportMarkedSpan, reportSpanRuler, reportMeasurementPlacement, rectanglesOverlap} from '../src/report-review-ui.mjs';
function finding(pixels){const bitmap=new Uint8Array(1270*1778);for(const [x,y] of pixels)bitmap[y*1270+x]=1;return {detectorMask:encodeSpeedsterTraceRleV1(bitmap)};}
test('diagonal trace uses actual extreme pixels and canonical scale, not box width, height, area or path length',()=>{
 const f=finding(Array.from({length:21},(_,i)=>[100+i,100+i]));const span=reportMarkedSpan(f);
 assert.ok(Math.abs(span.mm-Math.hypot(21,21)/20)<1e-10);assert.notEqual(span.mm,21/20);
 assert.equal(reportMarkedSpan(f),span);assert.equal(reportMarkedSpan({...f,geometryExclusion:true}),null);
 assert.equal(reportMarkedSpan({canonicalContour:[{x:0,y:0},{x:1,y:1}]}),null);
 const ruler=reportSpanRuler(span,p=>({x:p.x*1270,y:p.y*1778}));assert.ok(ruler.path);assert.ok(ruler.bounds.width>21);
});
test('maximum span retains disconnected damage and agrees with exhaustive pixel-edge distances',()=>{
 for(const pixels of [[[0,0]],[[0,0],[1269,1777]],[[3,4],[60,19],[9,40],[55,70],[80,26]],[[50,50],[51,50],[50,51],[51,51]]]){
  const edges=pixels.flatMap(([x,y])=>[[x,y],[x+1,y],[x,y+1],[x+1,y+1]]);
  const expected=Math.max(...edges.flatMap(a=>edges.map(b=>Math.hypot(a[0]-b[0],a[1]-b[1]))))/20;
  assert.ok(Math.abs(reportMarkedSpan(finding(pixels)).mm-expected)<1e-9);
 }
});
test('callouts avoid trace, ruler and locator at every edge; crowded and phone panes fall back outside the photo',()=>{
 for(const size of [{width:400,height:540},{width:750,height:720}])for(const x of [-50,0,size.width/2,size.width-30])for(const y of [-50,0,size.height/2,size.height-30]){
  const obstacles=[{x,y,width:60,height:120},{x:x-24,y:y-24,width:108,height:168},{x:size.width-140,y:size.height-192,width:140,height:192}];
  const box=reportMeasurementPlacement(size,obstacles);
  if(box){assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=size.width&&box.y+box.height<=size.height);for(const obstacle of obstacles)assert.equal(rectanglesOverlap(box,obstacle),false);}
 }
 assert.equal(reportMeasurementPlacement({width:180,height:500},[]),null);
 assert.equal(reportMeasurementPlacement({width:400,height:540},[{x:0,y:0,width:400,height:540}]),null);
});
