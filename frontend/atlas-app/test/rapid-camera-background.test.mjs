import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fitRapidCameraPreview } from '../../atlas-shared/rapid-camera.mjs';

const req=createRequire(new URL('../package.json',import.meta.url)),babel=req('next/dist/compiled/babel/core'),nextReq=createRequire(req.resolve('next/package.json'));
const code=babel.transformSync(readFileSync(new URL('../../atlas-shared/RapidCardCamera.jsx',import.meta.url),'utf8'),{filename:'RapidCardCamera.jsx',presets:[[req.resolve('next/babel'),{'preset-env':{targets:{node:'current'}}}]],babelrc:false,configFile:false}).code;
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const all=(node,p,out=[])=>{if(Array.isArray(node))node.forEach(n=>all(n,p,out));else if(node&&typeof node==='object'){if(p(node))out.push(node);all(node.props?.children,p,out);}return out;};
const text=node=>Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.props?.children):node??'';

function fixture(props={}) {
  const f={captures:[],saved:[],props:{side:'FRONT',autoStart:false,showBackgroundControl:true,...props}};
  f.props.onCapture=async(...args)=>{f.saved.push(args);if(f.save)await f.save.promise;};
  const slots=[],effects=[];let cursor=0,dirty=false,tree;
  const react={Fragment:'fragment',createElement:(type,props,...children)=>({type,props:{...props,children}}),useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],next=>{const value=typeof next==='function'?next(slots[i]):next;if(!Object.is(slots[i],value)){slots[i]=value;dirty=true;}}];},useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},useEffect(work,deps){const i=cursor++,old=slots[i];if(!old||deps.some((x,j)=>x!==old.deps[j])){slots[i]={deps,cleanup:old?.cleanup};effects.push(()=>{slots[i].cleanup?.();slots[i].cleanup=work();});}}};
  const video={videoWidth:1280,videoHeight:960,paused:false,play:async()=>{},pause(){}},track={readyState:'live',stop(){}},stream={getTracks:()=>[track],getVideoTracks:()=>[track]};
  const exports={};vm.runInNewContext(code,{exports,setTimeout(){},ResizeObserver:class{observe(){}disconnect(){}},document:{body:{style:{}},addEventListener(){},removeEventListener(){}},window:{addEventListener(){},removeEventListener(){}},navigator:{mediaDevices:{getUserMedia:async()=>stream}},require(name){
    if(name==='react')return react;
    if(name.endsWith('.css'))return {};
    if(name==='./rapid-camera.mjs')return {fitRapidCameraPreview,rapidCameraError:e=>e.message,RAPID_CAMERA_CONSTRAINTS:{},captureRapidCameraPhoto:async(_video,_track,side,options)=>{f.captures.push({side,options});if(f.acquire)await f.acquire.promise;return {file:{name:`${side}.png`},capture:{source:'LOSSLESS_VIDEO_FRAME',width:1280,height:960}};}};
    return nextReq(name.startsWith('@babel/runtime/')?`next/dist/compiled/${name}`:name);
  }});
  f.render=()=>{let count=0;do{dirty=false;cursor=0;tree=exports.default(f.props);for(const n of all(tree,n=>n.props?.ref)){n.props.ref.current??=n.type==='video'?video:{focus(){},getBoundingClientRect:()=>({width:390,height:480})};}effects.splice(0).forEach(work=>work());assert.ok(++count<20);}while(dirty);return tree;};
  f.button=label=>all(tree,n=>n.type==='button'&&(n.props['aria-label']??text(n))===label)[0];
  f.begin=async()=>{f.render();f.button('Resume camera').props.onClick();await flush();f.render();};
  f.unmount=()=>slots.forEach(s=>s?.cleanup?.());return f;
}

test('camera snapshots the background at the shutter and resets only after durable save',async()=>{
  const f=fixture();await f.begin();assert.equal(f.button('Black').props['aria-pressed'],true);
  const staleWhite=f.button('White').props.onClick;
  staleWhite();f.render();assert.equal(f.button('White').props['aria-pressed'],true);
  f.acquire=deferred();f.save=deferred();f.button('Capture Front').props.onClick();f.render();
  assert.equal(f.button('White').props.disabled,true);assert.equal(f.button('Black').props.disabled,true);
  // Parent progress can render the next side before this shutter's promise ends.
  f.props.side='BACK';f.props.disabled=true;f.render();f.button('Black').props.onClick();f.render();
  assert.equal(f.button('White').props['aria-pressed'],true);assert.equal(f.saved.length,0);
  f.acquire.resolve();await flush();f.render();assert.equal(f.saved[0][0].name,'FRONT.png');assert.equal(f.saved[0][2],'WHITE');
  assert.equal(Object.hasOwn(f.saved[0][1],'matColor'),false,'Background is not injected into the image-acquisition contract');
  assert.equal(f.button('White').props['aria-pressed'],true,'No reset before the original is durable');
  f.save.resolve();await flush();f.props.disabled=false;f.render();assert.equal(f.button('Black').props['aria-pressed'],true);
  f.acquire=null;f.save=null;f.button('Capture Back').props.onClick();await flush();f.render();
  assert.deepEqual(f.saved.map(args=>[args[0].name,args[2]]),[['FRONT.png','WHITE'],['BACK.png','BLACK']]);
  f.props.side='FRONT';f.render();assert.equal(f.button('Black').props['aria-pressed'],true);f.unmount();
});

test('failed durable capture keeps the chosen background for the retry',async()=>{
  const f=fixture({side:'BACK'});await f.begin();f.button('White').props.onClick();f.render();f.save=deferred();
  f.button('Capture Back').props.onClick();await flush();f.save.reject(new Error('Device storage is full'));await flush();
  assert.match(text(f.render()),/Device storage is full/);assert.equal(f.button('White').props['aria-pressed'],true);
  assert.equal(f.button('Capture Back').props.disabled,false);f.save=null;f.button('Capture Back').props.onClick();await flush();f.render();
  assert.deepEqual(f.saved.map(args=>args[2]),['WHITE','WHITE']);assert.equal(f.button('Black').props['aria-pressed'],true);f.unmount();
});

test('shared camera only exposes the background control to an opted-in capture flow',async()=>{
  const f=fixture({showBackgroundControl:false});await f.begin();assert.equal(f.button('Black'),undefined);assert.equal(f.button('White'),undefined);
  f.button('Capture Front').props.onClick();await flush();assert.equal(f.saved[0][2],'BLACK');f.unmount();
});
