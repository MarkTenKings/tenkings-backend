import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import * as core from '@atlas/grading-core/geometry';
import * as geometry from '../src/geometry-actions.mjs';
import * as focus from '../src/geometry-focus.mjs';
import {geometryImage} from '../src/geometry-image.mjs';
import {verifiedImageContentKey} from '../src/verified-image.mjs';
import {focusedFixture} from './focused-geometry-fixture.mjs';
const require=createRequire(new URL('../../../frontend/atlas-app/package.json',import.meta.url)),babel=require('next/dist/compiled/babel/core'),nextRequire=createRequire(require.resolve('next/package.json'));
const compiled=babel.transformSync(readFileSync(new URL('../src/FocusedGeometryWorkspace.jsx',import.meta.url),'utf8'),{filename:'FocusedGeometryWorkspace.jsx',presets:[[require.resolve('next/babel'),{'preset-env':{targets:{node:'current'}}}]],babelrc:false,configFile:false}).code;
const text=node=>Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.props?.children):node??'';
const all=(node,predicate,out=[])=>{if(Array.isArray(node))node.forEach(n=>all(n,predicate,out));else if(node&&typeof node==='object'){if(predicate(node))out.push(node);all(node.props?.children,predicate,out);}return out;};
function harness(extra={},load=image=>({url:image?.url})){const instances=new Map();let slots,cursor,dirty,effects=[],tree;
  const effect=(fn,deps)=>{const i=cursor++,current=slots,old=current[i];if(!old||deps.some((v,n)=>!Object.is(v,old.deps[n]))){current[i]={deps,cleanup:old?.cleanup};effects.push(()=>{current[i].cleanup?.();current[i].cleanup=fn();});}};
  const react={Fragment:'fragment',createElement:(type,props,...children)=>({type,props:{...props,children}}),
    useState(initial){const i=cursor++,current=slots;if(!(i in current))current[i]=typeof initial==='function'?initial():initial;return[current[i],change=>{const next=typeof change==='function'?change(current[i]):change;if(!Object.is(next,current[i])){current[i]=next;dirty=true;}}];},
    useRef(value){const i=cursor++;if(!(i in slots))slots[i]={current:value};return slots[i];},useEffect:effect,useLayoutEffect:effect};
  const exports={};vm.runInNewContext(compiled,{exports,require(name){if(name==='react')return react;if(name==='@atlas/grading-core/geometry')return core;if(name==='./geometry-actions.mjs')return geometry;if(name==='./geometry-focus.mjs')return focus;if(name==='./geometry-image.mjs')return{geometryImage};if(name==='./verified-image.mjs')return{useVerifiedImage:load,verifiedImageContentKey};if(name==='./gradient-snap')return{gradientMapFromImage:()=>null};return nextRequire(name.startsWith('@babel/runtime/')?`next/dist/compiled/${name}`:name);}});
  const f={props:{...focusedFixture(),onApproveSide:async()=>{},...extra}};
  function expand(node,path='root'){if(Array.isArray(node))return node.map((n,i)=>expand(n,`${path}.${i}`));if(!node||typeof node!=='object')return node;if(typeof node.type==='function'){const id=`${path}:${node.type.name}:${node.props.key??''}`;if(!instances.has(id))instances.set(id,[]);slots=instances.get(id);cursor=0;return expand(node.type(node.props),`${id}.out`);}return{...node,props:{...node.props,children:expand(node.props.children,`${path}.children`)}};}
  f.render=()=>{let rounds=0;do{dirty=false;tree=expand({type:exports.FocusedGeometryWorkspace,props:f.props});const pending=effects;effects=[];pending.forEach(fn=>fn());assert.ok(++rounds<20);}while(dirty);return tree;};
  f.nodes=predicate=>all(tree,predicate);f.has=value=>text(tree).includes(value);f.button=label=>{const node=f.nodes(n=>n.type==='button'&&(text(n)===label||n.props['aria-label']===label))[0];assert.ok(node,label);return node;};
  f.click=label=>{const node=f.button(label);assert.equal(Boolean(node.props.disabled),false);const p=node.props.onClick();f.render();return p;};
  f.ready=async(width=1600,height=2400)=>{const img=f.nodes(n=>n.type==='img'&&n.props.onLoad)[0];await img.props.onLoad({currentTarget:{naturalWidth:width,naturalHeight:height}});f.render();};
  f.nudge=label=>{f.button(label).props.onKeyDown({key:'ArrowRight',preventDefault(){}});f.render();};f.render();return f;
}
test('rapid geometry starts on one side with both outlines and exactly one Approve',async()=>{
  const f=harness();assert.equal(f.nodes(n=>n.type==='img').length,1);assert.equal(f.nodes(n=>n.props?.className?.startsWith('fg-handle')).length,0);assert.ok(f.button('Approve').props.disabled);
  await f.ready();assert.equal(f.nodes(n=>n.props?.className?.startsWith('fg-handle')).length,8);assert.equal(f.button('Approve').props.disabled,false);
  assert.equal(f.nodes(n=>n.type==='input'&&n.props.type==='checkbox').length,0);assert.equal(f.nodes(n=>n.type==='button'&&text(n)==='Approve').length,1);
  assert.equal(f.has('Back is next'),true);
});
test('missing Astra printed proposal shows its exact observation without a fabricated guide',async()=>{
 const fixture=structuredClone(focusedFixture());fixture.workspace.sides.FRONT.printed=null;
 fixture.workspace.sides.FRONT.visualObservation={frameSha256:fixture.workspace.sides.FRONT.image.frameSha256,responseHash:'a'.repeat(64),model:'gpt-6-astra',reasoning:'xhigh',
  physical:{outlineLocated:true,uncertainty:'LOW',observation:'Visible material edge.'},printed:{outlineLocated:false,uncertainty:'HIGH',observation:'Interrupted printed rails need review.'}};
 const f=harness(fixture);await f.ready();
 assert.ok(f.has('Astra · xhigh'));assert.ok(f.has('Printed border · no outline proposed'));assert.ok(f.has('Interrupted printed rails need review.'));
 assert.ok(f.has('Astra returned no printed outline.'));assert.ok(f.has('Uncertainty: high'));
 assert.equal(f.nodes(n=>n.props?.className==='fg-printed').length,0);assert.equal(f.nodes(n=>n.props?.className?.startsWith('fg-handle')).length,4);
});
test('an Astra outline withheld by failed preparation is never described as a missing model result',async()=>{
 const fixture=structuredClone(focusedFixture());fixture.workspace.sides.FRONT.printed=null;fixture.workspace.sides.FRONT.prepared=null;
 fixture.workspace.sides.FRONT.visualObservation={frameSha256:fixture.workspace.sides.FRONT.image.frameSha256,responseHash:'a'.repeat(64),model:'gpt-6-astra',reasoning:'xhigh',
  physical:{outlineLocated:true,uncertainty:'LOW',observation:'Visible material edge.'},printed:{outlineLocated:true,uncertainty:'LOW',observation:'The yellow margin surrounds the purple field.'}};
 const f=harness(fixture);await f.ready();assert.ok(f.has('Astra returned a printed outline, but image preparation did not finish.'));
 assert.equal(f.has('Astra returned no printed outline.'),false);assert.equal(f.has('not returned by Astra'),false);
 assert.equal(f.nodes(n=>n.props?.className==='fg-printed').length,0);
});
test('the single Approve submits outer and inner adjustments in the source frame and retains them after failure',async()=>{
  const calls=[],f=harness({onApproveSide:async action=>{calls.push(structuredClone(action));throw new Error('save failed');}});await f.ready();
  const before=focus.focusedGeometryOutlines(f.props.workspace,'FRONT');f.nudge('FRONT physical edge Top left');f.nudge('FRONT printed border Top right');
  await f.click('Approve');f.render();assert.equal(calls.length,1);assert.equal(calls[0].physical[0].x,before.physical[0].x+1/1600);assert.equal(calls[0].printedOriginal[1].x,before.printedOriginal[1].x+1/1600);
  assert.equal(f.has('Your adjustment is kept.'),true);await f.click('Approve');f.render();assert.deepEqual(calls[1],calls[0]);
});
test('an acknowledged intermediate physical save does not replace the retained combined draft or captured base',async()=>{
  const calls=[],f=harness({onApproveSide:async action=>{calls.push(structuredClone(action));throw new Error('prepare failed');}});await f.ready();f.nudge('FRONT physical edge Top left');f.nudge('FRONT printed border Top right');await f.click('Approve');f.render();
  const saved=calls[0];f.props.workspace=geometry.applyGeometryEdit(f.props.workspace,{side:'FRONT',kind:'PHYSICAL',base:geometry.geometryBase(f.props.workspace,'FRONT','PHYSICAL'),quad:saved.physical,actor:'HUMAN'}).state;f.render();
  await f.click('Approve');f.render();assert.deepEqual(calls[1],saved,'parent checkpoint receives the exact retained target');
});
test('double activation cannot dispatch two simultaneous saves',async()=>{
  let finish,calls=0;const f=harness({onApproveSide:()=>{calls++;return new Promise(resolve=>{finish=resolve;});}});await f.ready();
  const action=f.button('Approve').props.onClick,first=action();await action();assert.equal(calls,1);f.render();assert.ok(f.button('Saving…').props.disabled);finish();await first;f.render();assert.equal(f.button('Approve').props.disabled,false);
});
test('preview pixels and dimension-mismatched originals cannot enable handles or approval',async()=>{
  const f=harness();await f.ready(800,1200);assert.ok(f.button('Approve').props.disabled);assert.equal(f.nodes(n=>n.props?.className?.startsWith('fg-handle')).length,0);
  const preview=harness({},()=>({url:null,loading:true}));assert.ok(preview.button('Approve').props.disabled);assert.equal(preview.nodes(n=>n.props?.className?.startsWith('fg-handle')).length,0);
});
test('Back renders its own source and controls, not a second paired editor',async()=>{
  const f=harness({side:'BACK'});await f.ready();assert.equal(f.nodes(n=>n.type==='img').length,1);assert.equal(f.nodes(n=>n.props?.['aria-label']?.startsWith('BACK ')).length,8);assert.equal(f.nodes(n=>n.props?.['aria-label']?.startsWith('FRONT ')).length,0);assert.equal(f.has('Findings are next'),true);
});

function placePoint(f,point){
 const stage=f.nodes(n=>n.props?.className==='fg-stage')[0],photo=f.nodes(n=>n.type==='img'&&n.props.onLoad)[0];
 stage.props.onPointerDown({button:0,target:{closest:()=>null},currentTarget:{getBoundingClientRect:()=>({left:0,top:0})},
  clientX:photo.props.style.left+point.x*photo.props.style.width,clientY:photo.props.style.top+point.y*photo.props.style.height,preventDefault(){}});f.render();
}
test('missing printed border requires explicit human placement of all four corners and retains the physical outline',async()=>{
  const fixture=structuredClone(focusedFixture());fixture.workspace.sides.FRONT.printed=null;
  const calls=[],f=harness({...fixture,onApproveSide:async value=>calls.push(value)});await f.ready();
  assert.ok(f.has('Place the printed border'));assert.ok(f.has('Correction required'));assert.ok(f.has('0 of 4 placed'));
  assert.equal(f.nodes(n=>n.props?.className?.startsWith('fg-border-value')).length,0,'placeholder geometry is not shown as a measurement');
  assert.ok(f.button('Approve').props.disabled);await f.button('Approve').props.onClick();assert.equal(calls.length,0);
  const physical=structuredClone(fixture.workspace.sides.FRONT.physical),points=focusedFixture().printedOriginal;
  assert.equal(f.nodes(n=>n.props?.className==='fg-printed').length,0);
  await f.click('Place printed border');
  for(const point of points.slice(0,3))placePoint(f,point);
  assert.ok(f.has('3 of 4 placed'));assert.ok(f.button('Approve').props.disabled);
  assert.equal(f.nodes(n=>n.props?.className==='fg-printed').length,0,'incomplete placement has no invented fourth corner');
  placePoint(f,points[3]);assert.equal(f.button('Approve').props.disabled,false);
  assert.equal(f.nodes(n=>n.props?.className?.startsWith('fg-border-value')).length,4);
  await f.click('Approve');assert.equal(calls.length,1);assert.deepEqual(calls[0].physical,physical.quad);
  calls[0].printedOriginal.forEach((p,i)=>{assert.ok(Math.abs(p.x-points[i].x)<1e-12);assert.ok(Math.abs(p.y-points[i].y)<1e-12);});
});
test('cancelling incomplete explicit placement retains saved outlines and shows no substitute points',async()=>{
 const fixture=structuredClone(focusedFixture());fixture.workspace.sides.FRONT.printed=null;
 const before=structuredClone(fixture.workspace),f=harness(fixture);await f.ready();await f.click('Place printed border');placePoint(f,{x:.2,y:.2});
 assert.equal(f.nodes(n=>n.props?.className==='fg-human-point').length,1);await f.click('Cancel placement');
 assert.equal(f.nodes(n=>n.props?.className==='fg-human-point').length,0);assert.equal(f.nodes(n=>n.props?.className==='fg-printed').length,0);
 assert.deepEqual(f.props.workspace,before);assert.ok(f.button('Approve').props.disabled);
});
test('a missing physical outline starts with only the photograph and accepts four explicit source points',async()=>{
 const fixture=structuredClone(focusedFixture()),points=fixture.workspace.sides.FRONT.physical.quad;
 fixture.workspace.sides.FRONT.physical=null;fixture.workspace.sides.FRONT.printed=null;fixture.workspace.sides.FRONT.prepared=null;
 const f=harness(fixture);await f.ready();assert.equal(f.nodes(n=>n.type==='polygon').length,0);assert.equal(f.nodes(n=>n.props?.className?.startsWith('fg-handle')).length,0);
 await f.click('Place physical edge');for(const point of points)placePoint(f,point);
 assert.equal(f.nodes(n=>n.props?.className==='fg-physical').length,1);assert.equal(f.nodes(n=>n.props?.className==='fg-printed').length,0);
 assert.ok(f.button('Approve').props.disabled);assert.ok(f.has('Place the printed border'));
});
test('explicit absent printed border remains available but never substitutes for a missing physical edge',async()=>{
  const fixture=structuredClone(focusedFixture());fixture.workspace.sides.FRONT.printed=null;
  const f=harness(fixture);await f.ready();await f.click('No printed border');
  assert.equal(f.button('Approve').props.disabled,false);assert.ok(f.has('final grade will remain unavailable'));
  await f.click('No printed border');assert.ok(f.button('Approve').props.disabled);
  const missing=structuredClone(focusedFixture());missing.workspace.sides.FRONT.physical=null;missing.workspace.sides.FRONT.printed=null;missing.workspace.sides.FRONT.prepared=null;
  const g=harness(missing);await g.ready();await g.click('No printed border');assert.ok(g.button('Approve').props.disabled);assert.ok(g.has('Place the physical edge'));
});
test('the persistent review task and keyboard precision view remain in the inspector outside the card stage',async()=>{
  const observation={type:'details',props:{'aria-label':'Original observations',children:'Retained observation'}};
  const f=harness({reviewObservations:observation});await f.ready();
  const inspector=f.nodes(n=>n.props?.className==='fg-inspector')[0],stage=f.nodes(n=>n.props?.className==='fg-stage')[0];
  assert.equal(all(inspector,n=>n.props?.['aria-label']==='Your review').length,1);
  assert.equal(all(stage,n=>n.props?.['aria-label']==='Your review').length,0);
  assert.ok(text(inspector).includes('Retained observation'));
  f.button('FRONT printed border Top left').props.onFocus();f.render();
  assert.equal(f.nodes(n=>n.props?.className==='fg-loupe').length,1);
  f.nudge('FRONT printed border Top left');assert.ok(f.has('Unsaved adjustments'));
  await f.click('Discard unsaved adjustments');assert.ok(f.has('Human review required'));
});


test('a replacement lossless transport requires its own verified decode without changing geometry lineage',async()=>{
  const fixture=focusedFixture(),original=fixture.images.FRONT.original;
  original.byteCount=100;original.mime='image/png';original.display={url:'blob:first',sha256:'d'.repeat(64),byteCount:50,mime:'image/webp',policyVersion:'atlas-review-display-lossless-v1',sourceSha256:original.sha256,width:1600,height:2400};
  const f=harness(fixture);await f.ready();assert.equal(f.button('Approve').props.disabled,false);
  const before=structuredClone(f.props.workspace);
  original.display={...original.display,url:'blob:second',sha256:'e'.repeat(64)};f.render();
  assert.equal(f.nodes(n=>n.props?.className?.startsWith('fg-handle')).length,0);assert.ok(f.button('Approve').props.disabled);
  await f.ready();assert.equal(f.button('Approve').props.disabled,false);assert.deepEqual(f.props.workspace,before);
});

test('pending full detail can show a source-bound preview without giving preview pixels edit authority',()=>{
  const fixture=focusedFixture(),original=fixture.images.FRONT.original,calls=[];
  fixture.images.FRONT.original={sha256:original.sha256,byteCount:100,mime:'image/png',displayState:{state:'PENDING'},preview:{url:'blob:preview',sha256:'e'.repeat(64),byteCount:20,mime:'image/jpeg',width:512,height:768,sourceSha256:original.sha256}};
  const f=harness(fixture,image=>{calls.push(image);return{url:image?.url??null};});
  assert.equal(f.nodes(n=>n.type==='img'&&n.props.src==='blob:preview').length,1);
  assert.equal(calls.some(image=>image?.sha256===original.sha256&&!image.url),false);
  assert.equal(f.nodes(n=>n.props?.className?.startsWith('fg-handle')).length,0);assert.ok(f.button('Approve').props.disabled);
});
