import test from 'node:test';
import assert from 'node:assert/strict';
import {focusedGeometryOutlines,sourceQuadToPrepared,draftPrintedQuad,focusedCentering,geometryFocusBounds,geometryCamera} from '../src/geometry-focus.mjs';
import {applyGeometryEdit,geometryBase,preparedPointToOriginal} from '../src/geometry-actions.mjs';
import {focusedFixture,printed} from './focused-geometry-fixture.mjs';

const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
test('source and live-preview projections preserve skew and exact width convention',()=>{
  for(const perspective of [false,true]){
    const {workspace,printedOriginal}=focusedFixture({perspective});
    for(const projected of [sourceQuadToPrepared(workspace,'FRONT',printedOriginal),draftPrintedQuad(workspace.sides.FRONT.physical.quad,printedOriginal)])
      projected.forEach((point,i)=>{near(point.x,printed[i].x);near(point.y,printed[i].y);});
    const live=focusedCentering(workspace.sides.FRONT.physical.quad,printedOriginal),saved=workspace.sides.FRONT.printed.centering;
    live.leftRight.forEach((n,i)=>near(n,saved.leftRightBalance[i]));
    live.topBottom.forEach((n,i)=>near(n,saved.topBottomBalance[i]));
  }
});
test('a changed physical outline cannot use the now-invalidated prepared frame',()=>{
  const {workspace,printedOriginal}=focusedFixture();
  const changed=workspace.sides.FRONT.physical.quad.map(p=>({...p,x:p.x+.01}));
  const next=applyGeometryEdit(workspace,{side:'FRONT',kind:'PHYSICAL',quad:changed,base:geometryBase(workspace,'FRONT','PHYSICAL'),actor:'HUMAN'}).state;
  assert.throws(()=>sourceQuadToPrepared(next,'FRONT',printedOriginal),error=>error.code==='ATLAS_GEOMETRY_PREPARED_FRAME_REQUIRED');
  assert.notDeepEqual(focusedCentering(changed,printedOriginal),focusedCentering(workspace.sides.FRONT.physical.quad,printedOriginal));
});
test('perspective boundary roundoff is accepted but actual off-card points are rejected',()=>{
  const {workspace}=focusedFixture({perspective:true});
  const edge=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];
  const source=edge.map(p=>preparedPointToOriginal(workspace,'FRONT',p));
  sourceQuadToPrepared(workspace,'FRONT',source).forEach((p,i)=>{near(p.x,edge[i].x);near(p.y,edge[i].y);});
  const outside=edge.map(p=>preparedPointToOriginal(workspace,'FRONT',{...p,x:p.x===1?1.000001:p.x}));
  assert.throws(()=>sourceQuadToPrepared(workspace,'FRONT',outside),error=>error.code==='ATLAS_GEOMETRY_QUAD_INVALID');
});
test('invalid and outside-card printed outlines cannot silently produce centering or be clipped',()=>{
  const {workspace}=focusedFixture();
  const crossed=[printed[0],printed[2],printed[1],printed[3]];
  assert.equal(focusedCentering(workspace.sides.FRONT.physical.quad,crossed),null);
  assert.throws(()=>sourceQuadToPrepared(workspace,'FRONT',[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]));
});
test('card fit keeps all eight handles visible at laptop and phone sizes without changing evidence',()=>{
  const {workspace}=focusedFixture({perspective:true}),before=JSON.stringify(workspace),slot=workspace.sides.FRONT;
  const outlines=focusedGeometryOutlines(workspace,'FRONT'),bounds=geometryFocusBounds(outlines.physical,slot.image);
  for(const viewport of [{width:1200,height:600},{width:370,height:470}]){
    const camera=geometryCamera(bounds,viewport,slot.image);
    for(const p of [...outlines.physical,...outlines.printedOriginal]){
      const x=camera.left+p.x*camera.width,y=camera.top+p.y*camera.height;
      assert.ok(x>=20&&x<=viewport.width-20);assert.ok(y>=20&&y<=viewport.height-20);
    }
    assert.ok(camera.height*(Math.max(...outlines.physical.map(p=>p.y))-Math.min(...outlines.physical.map(p=>p.y)))>viewport.height*.65);
  }
  assert.equal(JSON.stringify(workspace),before);
});
