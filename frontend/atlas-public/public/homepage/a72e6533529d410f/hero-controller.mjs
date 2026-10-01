import {loadHeroEvidence,fetchVerifiedAsset,traceSvgPath,canonicalToCleanUV} from './hero-evidence.mjs';
import {buildCenteringInstruments,renderInspectionInstruments} from './hero-metrology.mjs';
const TOUR_DURATION=22;
const host=document.querySelector('.hero-cinematic'),canvas=host.querySelector('canvas'),fallback=host.querySelector('.hc-fallback');
const $=s=>host.querySelector(s),dialog=document.querySelector('.hc-inspector'),$$=s=>dialog.querySelector(s);
const reduce=matchMedia('(prefers-reduced-motion:reduce)'),phone=matchMedia('(max-width:700px)');
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const smooth=v=>{v=clamp(v);return v*v*v*(v*(v*6-15)+10);};
const phase=(a,b,t)=>smooth((t-a)/(b-a));
const pose={yaw:-.16,tilt:.025,roll:-.025,fp:0,centering:1};
let intent=0;
let evidence,gl,program,ready=false,visible=true,running=!reduce.matches,time=0,clock=0,frame=0,last=0,tween=null,side='FRONT',readoutKey='',lost=false,backReady=false;
let width=1,height=1,center=[.42,.49],size=1.63,renderSize=1.63,fpPromise=null,fpReady=false;
let centeringSvg,centeringNodes,inspectionInstruments;
const centeringModels={};
const markerNodes=new Map(),uniforms={},textures=new Map();
const status={renderer:'loading',firstFrameMs:null,frames:0,offscreenSuspensions:0,error:null};
const fmt=n=>Number(n.toFixed(2)).toString();
function announce(s){$('.hc-announcement').textContent=s;}
function fallbackUI(){
 host.classList.remove('hc-ready');host.dataset.ready='false';canvas.hidden=true;$('.hc-markers').hidden=true;$('.hc-leaders')?.setAttribute('hidden','');centeringSvg?.setAttribute('hidden','');
 $('.hc-guide').textContent='Still preview';$('.hc-guide').setAttribute('aria-pressed','false');$('.hc-guide').disabled=true;$('.hc-fingerprint').disabled=true;
 $('.hc-hint').textContent='Select Front, Back, or Examine to inspect the original evidence.';
 host.querySelectorAll('[data-side]').forEach(b=>{b.disabled=false;b.onclick=()=>{side=b.dataset.side;inspect(evidence.findings.find(f=>f.side===side));};});
}
function motionAllowed(){return !reduce.matches&&!document.documentElement.classList.contains('motion-off');}
function guideLabel(){const b=$('.hc-guide');b.textContent=running?'Pause tour Ⅱ':'Replay tour ↻';b.setAttribute('aria-pressed',String(running));b.disabled=!motionAllowed()||!ready;}
function stop(){intent++;running=false;tween=null;guideLabel();}
function requestDraw(){if(!frame&&visible&&!document.hidden&&!lost)frame=requestAnimationFrame(draw);}
function sideFromPose(){return Math.cos(pose.yaw)>=0?'FRONT':'BACK';}
function angleNear(target){return pose.yaw+Math.atan2(Math.sin(target-pose.yaw),Math.cos(target-pose.yaw));}
function moveTo(target,duration=1.45,done){
 if(!motionAllowed()){Object.assign(pose,target);done?.();requestDraw();return;}
 tween={from:{...pose},target,start:performance.now(),duration:duration*1000,done};requestDraw();
}
function setSide(next){stop();side=next;const destination=angleNear(next==='FRONT'?0:Math.PI);moveTo({yaw:destination,tilt:.01,roll:next==='FRONT'?-.018:.018,fp:0,centering:1});announce(`${next==='FRONT'?'Front':'Back'} of the card. ${evidence.findings.filter(f=>f.side===next).length} recorded findings.`);}
function image(asset){return fetchVerifiedAsset(asset).then(async blob=>{const url=URL.createObjectURL(blob),im=new Image();try{im.src=url;await im.decode();return im;}finally{URL.revokeObjectURL(url);}});}
function tex(name,im,unit){let texture=textures.get(name);if(!texture){texture=gl.createTexture();textures.set(name,texture);}gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,im);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.uniform1i(gl.getUniformLocation(program,'u_'+name),unit);}
async function fingerprints(){if(!fpPromise)fpPromise=Promise.all(['FRONT','BACK'].map(async(s,i)=>tex('fp'+s.toLowerCase(),await image(evidence.sides[s].fingerprint),4+i))).then(()=>{fpReady=true;});return fpPromise;}
function matrix(rows){return 'mat3('+[0,1,2].flatMap(c=>[0,1,2].map(r=>Number(rows[r][c]).toPrecision(13))).join(',')+')';}
function compile(type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
async function renderer(){
 if(new URLSearchParams(location.search).get('render')==='still')throw Error('Requested still-preview qualification');
 gl=canvas.getContext('webgl2',{antialias:false,alpha:true,powerPreference:'low-power'});if(!gl)throw Error('WebGL2 unavailable');
 let source=await fetch('/homepage/a72e6533529d410f/hero-card.glsl').then(r=>{if(!r.ok)throw Error('Shader unavailable');return r.text();});
 source=source.replace('FRONT_INVERSE',matrix(evidence.sides.FRONT.transforms.cleanUVToCanonical)).replace('BACK_INVERSE',matrix(evidence.sides.BACK.transforms.cleanUVToCanonical));
 source=source.replace('FRONT_CROP','vec4('+evidence.sides.FRONT.presentation.cropUV.map(n=>n.toFixed(13)).join(',')+')').replace('BACK_CROP','vec4('+evidence.sides.BACK.presentation.cropUV.map(n=>n.toFixed(13)).join(',')+')');
 const vertex='#version 300 es\nin vec2 pos;out vec2 v_uv;void main(){gl_Position=vec4(pos,0.,1.);v_uv=vec2(pos.x*.5+.5,.5-pos.y*.5);}';
 const fragment=`#version 300 es\nprecision highp float;uniform float u_time,u_yaw,u_tilt,u_roll,u_size,u_fingerprint;uniform vec2 u_view,u_center;uniform sampler2D u_front,u_back,u_maskfront,u_maskback,u_fpfront,u_fpback;in vec2 v_uv;out vec4 outColor;${source}\nvoid main(){outColor=pixel(v_uv);}`;
 program=gl.createProgram();gl.attachShader(program,compile(gl.VERTEX_SHADER,vertex));gl.attachShader(program,compile(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
 const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);const pos=gl.getAttribLocation(program,'pos');gl.enableVertexAttribArray(pos);gl.vertexAttribPointer(pos,2,gl.FLOAT,false,0,0);
 for(const name of ['time','yaw','tilt','roll','size','fingerprint','view','center'])uniforms[name]=gl.getUniformLocation(program,'u_'+name);
 // Initialize every sampler; verified small textures replace these independently.
 const blank=document.createElement('canvas');blank.width=blank.height=1;['front','back','maskfront','maskback','fpfront','fpback'].forEach((n,i)=>tex(n,blank,i));
 const loadSide=async(s,offset)=>{const im=await Promise.all([image(evidence.sides[s].presentation),image(evidence.sides[s].mask)]);tex(s.toLowerCase(),im[0],offset);tex('mask'+s.toLowerCase(),im[1],offset+2);};
 host.querySelector('[data-side=BACK]').disabled=true;await loadSide('FRONT',0);ready=true;status.renderer='webgl2';resize();if(frame)cancelAnimationFrame(frame);frame=0;draw(performance.now());host.classList.add('hc-ready');host.dataset.ready='true';status.firstFrameMs=performance.now();host.dataset.firstFrameMs=status.firstFrameMs.toFixed(1);guideLabel();
 await loadSide('BACK',1);backReady=true;host.querySelector('[data-side=BACK]').disabled=false;requestDraw();
}
function rotate(v){const [x,y,z]=v,ct=Math.cos(pose.tilt),st=Math.sin(pose.tilt),cy=Math.cos(pose.yaw),sy=Math.sin(pose.yaw),cr=Math.cos(pose.roll),sr=Math.sin(pose.roll);const yy=y*ct-z*st,zz=y*st+z*ct,xx=x*cy+zz*sy,z2=-x*sy+zz*cy;return [xx*cr-yy*sr,xx*sr+yy*cr,z2];}
function projectUV(uv,face){const u=uv[0],v=uv[1],sign=face==='FRONT'?1:-1;const r=rotate([(u-.5)*2*sign,(.5-v)*2.8,.007*sign]);const C=[(center[0]-.5)*2*(width/height)*.62*4.5,(.5-center[1])*2*.62*4.5];const depth=4.5-r[2]*renderSize;return [(.5+(C[0]+r[0]*renderSize)/(depth*2*(width/height)*.62))*width,(.5-(C[1]+r[1]*renderSize)/(depth*2*.62))*height];}
function project(f){return projectUV(f.centroidCleanUV,f.side);}
function createCentering(){
 const ns='http://www.w3.org/2000/svg';centeringSvg=document.createElementNS(ns,'svg');centeringSvg.classList.add('hc-centering');centeringSvg.setAttribute('aria-hidden','true');$('.hc-stage').append(centeringSvg);
 const el=(tag,cls)=>{const n=document.createElementNS(ns,tag);n.setAttribute('class',cls);centeringSvg.append(n);return n;};
 centeringNodes={physical:el('path','hm-physical-outline'),printed:el('path','hm-printed-outline'),corners:el('path','hc-edge-locks'),gaps:[]};
 for(let i=0;i<4;i++){const path=el('path','hm-border-gap'),g=el('g','hc-border-label'),rect=document.createElementNS(ns,'rect'),text=document.createElementNS(ns,'text');rect.setAttribute('rx','3');g.append(rect,text);centeringNodes.gaps.push({path,g,rect,text});}
 for(const face of ['FRONT','BACK'])centeringModels[face]=buildCenteringInstruments(face,evidence);
}
function drawCentering(){
 const m=centeringModels[side],facing=Math.abs(Math.cos(pose.yaw)),opacity=clamp((facing-.3)/.4)*(.2+.8*pose.centering)*(1-pose.fp*.7);
 centeringSvg.style.opacity=opacity;centeringSvg.setAttribute('width',width);centeringSvg.setAttribute('height',height);
 if(!m||opacity<.01)return;
 const proj=p=>projectUV(canonicalToCleanUV(evidence.sides[side],p),side),outline=p=>p.map((v,i)=>`${i?'L':'M'}${v[0]} ${v[1]}`).join('')+'Z';
 const outer=m.physicalQuad.map(proj),printed=m.printedQuad.map(proj);centeringNodes.physical.setAttribute('d',outline(outer));centeringNodes.printed.setAttribute('d',outline(printed));
 let locks='';for(let i=0;i<4;i++){const p=outer[i];for(const j of [(i+1)%4,(i+3)%4]){const q=outer[j],l=Math.hypot(q[0]-p[0],q[1]-p[1]),d=Math.min(12,l*.1);locks+=`M${p[0]+(q[0]-p[0])*d/l} ${p[1]+(q[1]-p[1])*d/l}L${p[0]} ${p[1]}`;}}centeringNodes.corners.setAttribute('d',locks);
 m.gaps.forEach((gap,i)=>{const a=proj(gap.from),b=proj(gap.to),n=centeringNodes.gaps[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]),nx=-(b[1]-a[1])/len*4,ny=(b[0]-a[0])/len*4;n.path.setAttribute('d',`M${a[0]} ${a[1]}L${b[0]} ${b[1]}M${a[0]-nx} ${a[1]-ny}L${a[0]+nx} ${a[1]+ny}M${b[0]-nx} ${b[1]-ny}L${b[0]+nx} ${b[1]+ny}`);
 const label=gap.id[0].toUpperCase()+' '+gap.label,w=phone.matches?73:82,h=phone.matches?23:25;let x,y;
 if(gap.id==='left'){x=b[0]+9;y=b[1]-h/2;}else if(gap.id==='right'){x=b[0]-w-9;y=b[1]-h/2;}else{x=(a[0]+b[0])/2+10;y=(a[1]+b[1])/2-h/2;}
 x=clamp(x,4,width-w-4);y=clamp(y,4,height-h-4);n.g.setAttribute('transform',`translate(${x} ${y})`);n.g.style.opacity=pose.centering;n.rect.setAttribute('width',w);n.rect.setAttribute('height',h);n.text.setAttribute('x',w/2);n.text.setAttribute('y',h/2);n.text.textContent=label;});
}
function resize(){const r=canvas.getBoundingClientRect();width=r.width;height=r.height;if(!width||!height)return;const dpr=Math.min(window.devicePixelRatio||1,1.5);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);center=[phone.matches?.5:.40,.50];size=(phone.matches?.82:.80)*(4.5*.62)/1.4;if(phone.matches)size=Math.min(size,(width/height)*(.84*4.5*.62));if(gl)gl.viewport(0,0,canvas.width,canvas.height);requestDraw();}
function draw(now){
 frame=0;if(!ready||lost||document.hidden||!visible)return;
 const dt=Math.min(.05,last?(now-last)/1000:0);last=now;
 if(motionAllowed())clock+=dt;
 if(running&&motionAllowed()&&!tween){
  time=Math.min(TOUR_DURATION,time+dt);if(!backReady)time=Math.min(time,4.5);
  pose.yaw=-.16*(1-phase(0,2,time))+Math.PI*phase(5,8,time)+Math.PI*phase(18.5,22,time);
  pose.tilt=.025+.045*Math.sin(phase(5,8,time)*Math.PI);pose.roll=-.025+.05*phase(5,8,time)-.04*phase(18.5,22,time);
  pose.centering=Math.max(1-phase(4.3,5,time),phase(8,8.5,time)*(1-phase(10.5,11.2,time)));pose.fp=phase(15,16.3,time)*(1-phase(17.8,18.5,time));
  if(time>8&&!fpPromise)fingerprints().catch(e=>{status.fingerprintError=e.message;pose.fp=0;});
  if(time>=TOUR_DURATION){running=false;pose.centering=1;guideLabel();}
 }
 if(tween){const p=smooth((now-tween.start)/tween.duration);for(const k in tween.target)pose[k]=tween.from[k]+(tween.target[k]-tween.from[k])*p;if(p===1){const done=tween.done;tween=null;done?.();}}
 side=sideFromPose();renderSize=size/(1+(size/4.5)*Math.abs(Math.sin(pose.yaw)));
 gl.uniform1f(uniforms.time,clock);for(const n of ['yaw','tilt','roll','size'])gl.uniform1f(uniforms[n],n==='size'?renderSize:pose[n]);gl.uniform1f(uniforms.fingerprint,fpReady?pose.fp:0);gl.uniform2f(uniforms.view,width,height);gl.uniform2f(uniforms.center,...center);gl.drawArrays(gl.TRIANGLES,0,6);status.frames++;
 const points=evidence.findings.map(f=>({f,p:project(f)}));
 for(const item of points){item.label=[...item.p];}
 const shownPoints=points.filter(({f})=>f.side===side).sort((a,b)=>a.p[1]-b.p[1]);
 const clusters=[];
 for(const item of shownPoints){const cluster=clusters.at(-1),prev=cluster?.at(-1);if(prev&&Math.abs(item.p[0]-prev.p[0])<50&&item.p[1]-prev.p[1]<60)cluster.push(item);else clusters.push([item]);}
 for(const cluster of clusters){if(cluster.length<2)continue;const avg=cluster.reduce((n,v)=>n+v.p[1],0)/cluster.length,start=clamp(avg-(cluster.length-1)*23,24,height-24-(cluster.length-1)*46);cluster.forEach((v,i)=>v.label=[clamp(v.p[0]+(v.p[0]>width*.5?33:-33),24,width-24),start+i*46]);}
 for(const {f,p,label} of points){const b=markerNodes.get(f.id),shown=f.side===side&&Math.abs(Math.cos(pose.yaw))>.25;b.disabled=!shown;b.style.transform=`translate(${label[0]-22}px,${label[1]-22}px)`;const leader=document.getElementById('leader-'+f.id);leader.setAttribute('d',shown?`M${p[0]} ${p[1]}L${label[0]} ${label[1]}`:'');const anchor=document.getElementById('anchor-'+f.id);anchor.setAttribute('cx',p[0]);anchor.setAttribute('cy',p[1]);anchor.style.opacity=shown&&Math.hypot(label[0]-p[0],label[1]-p[1])>1?'1':'0';} 
 drawCentering();updateReadout();host.style.setProperty('--hc-progress',time/TOUR_DURATION);
 host.dataset.side=side;host.dataset.running=String(running);host.dataset.angle=pose.yaw.toFixed(5);host.dataset.frames=String(status.frames);
 if((motionAllowed()&&!dialog.open)||tween)requestDraw();
}
function updateReadout(){const kind=pose.fp>.35?'fingerprint':pose.centering>.5?'centering':'findings',key=side+kind;if(readoutKey===key)return;readoutKey=key;host.dataset.phase=kind;const s=evidence.sides[side];const name=side==='FRONT'?'FRONT':'BACK';$('.hc-evidence-status').textContent=`7 FINDINGS · ${side==='FRONT'?'3 FRONT / 4 BACK':'4 BACK / 3 FRONT'}`;$('.hc-phase').textContent=kind==='fingerprint'?'03 / THE FINGERPRINT':kind==='findings'?'02 / EVERY FINDING':'01 / THE MEASUREMENTS';$('.hc-readout-label').textContent=kind==='centering'?`CENTERING / ${name}`:kind==='fingerprint'?`ATLAS FINGERPRINT / ${name}`:`THE EVIDENCE / ${name}`;
 const content=$('.hc-metrics');content.replaceChildren();if(kind==='centering'){for(const [label,values]of [['LEFT / RIGHT',s.centering.leftRight],['TOP / BOTTOM',s.centering.topBottom]]){const m=document.createElement('div');m.className='hc-metric';const l=document.createElement('span'),v=document.createElement('strong');l.textContent=label;v.textContent=values.map(n=>Number(n).toFixed(1)).join(' / ');m.append(l,v);content.append(m);}}else{const v=document.createElement('strong');v.className='hc-readout-value';v.textContent=kind==='fingerprint'?'The details leave a signature.':`${evidence.findings.filter(f=>f.side===side).length} recorded findings.`;content.append(v);}
 $('.hc-readout-note').textContent=kind==='centering'?'Outer edge + printed border. Every gap measured.':kind==='fingerprint'?'Its actual fingerprint, over the card. Every finding stays visible.':'Select a red marker. See the exact saved evidence.';
 const old=$('.hc-auto-detail');if(old)old.remove();if(kind==='findings'&&side==='BACK'){const m=evidence.selectedMacro,ns='http://www.w3.org/2000/svg',wrap=document.createElement('div'),svg=document.createElementNS(ns,'svg'),im=document.createElementNS(ns,'image'),trace=document.createElementNS(ns,'path'),label=document.createElement('span');wrap.className='hc-auto-detail';svg.setAttribute('viewBox',`${m.cropPx.x} ${m.cropPx.y} ${m.cropPx.width} ${m.cropPx.height}`);svg.setAttribute('role','img');svg.setAttribute('aria-label','Original photograph with exact saved coating loss');im.setAttribute('href',evidence.sides.BACK.original.src);im.setAttribute('width','1350');im.setAttribute('height','1858');trace.setAttribute('d',m.sourceSvgPath);trace.setAttribute('fill','#ff1238');trace.setAttribute('fill-opacity','.48');svg.append(im,trace);label.textContent=`${m.widthMm} × ${m.heightMm} mm`;wrap.append(svg,label);$('.hc-readout').append(wrap);$('.hc-readout-note').textContent='Print / coating loss. Original photograph.';}
 host.querySelectorAll('[data-side]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.side===side)));$('.hc-fingerprint').setAttribute('aria-pressed',String(kind==='fingerprint'));
}
function humanType(f){return f.defectType==='VISIBLE_SCRATCH_PRINT_COATING_LOSS'?'Print / coating loss':f.defectType.toLowerCase().replaceAll('_',' ').replace(/^./,s=>s.toUpperCase());}
let selected,showTrace=true,whole=false,opener,regionIndex=0;
function inspect(f){stop();opener=document.activeElement;selected=f;showTrace=true;whole=false;regionIndex=0;if(!dialog.open)dialog.showModal();renderInspection();}
function renderInspection(){const f=selected,s=evidence.sides[f.side],n=evidence.findings.indexOf(f)+1;
 $$('.hc-inspect-count').textContent=`FINDING ${String(n).padStart(2,'0')} / ${f.side}`;$$('.hc-inspect-name').textContent=humanType(f);
 const source=$$('.hc-source');const c=f.inspectionCrop;source.setAttribute('viewBox',whole?`0 0 ${s.original.width} ${s.original.height}`:`${c.x} ${c.y} ${c.width} ${c.height}`);
 $$('.hc-source-image').setAttribute('href',s.original.src);$$('.hc-source-trace').setAttribute('d',f.sourceSvgPath||traceSvgPath(f,{space:'source',side:s}));$$('.hc-source-trace').toggleAttribute('hidden',!showTrace);
 inspectionInstruments?.destroy();$$('.hc-source-calipers').setAttribute('d','');inspectionInstruments=renderInspectionInstruments(source,f,s,evidence.card,{show:showTrace,whole,regionIndex,onRegionChange:region=>{regionIndex=region.index;}});
 $$('.hc-show-mark').textContent=showTrace?'Hide trace':'Show trace';$$('.hc-show-mark').setAttribute('aria-pressed',String(showTrace));$$('.hc-whole-card').textContent=whole?'Focus finding':'Whole card';
 const box=$$('.hc-inspect-measures');box.replaceChildren();for(const r of f.regions){const block=document.createElement('div');block.className='hc-region';const label=document.createElement('span'),value=document.createElement('strong'),area=document.createElement('small');label.textContent=r.zone+' / SAVED MEASUREMENT';value.textContent=`${fmt(r.measurement.widthMm)} × ${fmt(r.measurement.heightMm)} mm`;area.textContent=`Affected area ${fmt(r.measurement.areaMm2)} mm²`;block.append(label,value,area);box.append(block);}
 const list=$$('.hc-finding-list');list.querySelectorAll('button').forEach(b=>b.setAttribute('aria-current',String(b.dataset.id===f.id)));const active=list.querySelector('[aria-current=true]');if(active){const a=active.getBoundingClientRect(),l=list.getBoundingClientRect();if(a.top<l.top)list.scrollTop+=a.top-l.top;else if(a.bottom>l.bottom)list.scrollTop+=a.bottom-l.bottom;}
}
async function initialize(){
 evidence=await loadHeroEvidence();createCentering();const ns='http://www.w3.org/2000/svg',leaders=document.createElementNS(ns,'svg');leaders.classList.add('hc-leaders');leaders.setAttribute('aria-hidden','true');$('.hc-stage').append(leaders);
 for(const [i,f]of evidence.findings.entries()){
  const line=document.createElementNS(ns,'path'),anchor=document.createElementNS(ns,'circle');line.id='leader-'+f.id;anchor.id='anchor-'+f.id;anchor.setAttribute('r','3');leaders.append(line,anchor);
  const b=document.createElement('button');b.type='button';b.className='hc-marker';b.dataset.label=String(i+1).padStart(2,'0');b.setAttribute('aria-label',`Inspect finding ${i+1}: ${humanType(f)}, ${f.side.toLowerCase()}`);b.onclick=()=>inspect(f);$('.hc-markers').append(b);markerNodes.set(f.id,b);
  const item=document.createElement('button');item.type='button';item.dataset.id=f.id;const num=document.createElement('span'),title=document.createElement('span'),sideLabel=document.createElement('span');num.textContent=String(i+1).padStart(2,'0');title.textContent=humanType(f);sideLabel.textContent=f.side;item.append(num,title,sideLabel);item.onclick=()=>{selected=f;whole=false;regionIndex=0;renderInspection();};$$('.hc-finding-list').append(item);
 }
 document.addEventListener('atlas-open-finding',event=>{const f=evidence.findings.find(f=>f.id===event.detail?.id);if(f)inspect(f);});
 new ResizeObserver(()=>inspectionInstruments?.refresh()).observe($$('.hc-source'));
 host.querySelectorAll('[data-side]').forEach(b=>b.onclick=()=>setSide(b.dataset.side));$('.hc-examine').onclick=()=>inspect(evidence.findings.find(f=>f.side===side));
 $('.hc-fingerprint').onclick=async()=>{stop();const action=intent;try{await fingerprints();if(intent!==action)return;moveTo({fp:pose.fp>.5?0:1,centering:0},.9);}catch(e){announce('Fingerprint unavailable. The original evidence is still available.');}};
 $('.hc-guide').onclick=()=>{if(running){stop();return;}if(time>=TOUR_DURATION||Math.abs(pose.yaw)>0.01||pose.fp>0.01){moveTo({yaw:angleNear(-.16),tilt:.025,roll:-.025,fp:0,centering:1},1,()=>{pose.yaw=-.16;time=0;running=true;guideLabel();requestDraw();});}else{running=true;guideLabel();requestDraw();}};
 $$('.hc-close').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{opener?.focus({preventScroll:true});requestDraw();});$$('.hc-show-mark').onclick=()=>{showTrace=!showTrace;renderInspection();};$$('.hc-whole-card').onclick=()=>{whole=!whole;renderInspection();};
 let drag=null;canvas.addEventListener('pointerdown',e=>{if(!ready)return;stop();drag={x:e.clientX,y:e.clientY,yaw:pose.yaw,moved:false};canvas.setPointerCapture(e.pointerId);host.classList.add('is-dragging');});canvas.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.abs(dx)<4&&!drag.moved)return;if(Math.abs(dy)>Math.abs(dx)*1.4&&!drag.moved)return;drag.moved=true;pose.yaw=drag.yaw+dx*Math.PI/Math.max(170,width*.6);pose.fp=0;pose.centering=1;requestDraw();});const endDrag=()=>{drag=null;host.classList.remove('is-dragging');};canvas.addEventListener('pointerup',endDrag);canvas.addEventListener('pointercancel',endDrag);
 canvas.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();if(e.key==='Home'||e.key==='End'){setSide(e.key==='Home'?'FRONT':'BACK');return;}stop();moveTo({yaw:pose.yaw+(e.key==='ArrowRight'?.3:-.3),centering:1,fp:0},.25);});
 new ResizeObserver(resize).observe(canvas);
 new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(!visible){status.offscreenSuspensions++;if(frame)cancelAnimationFrame(frame);frame=0;}else{last=0;requestDraw();}host.dataset.visible=String(visible);},{threshold:0}).observe(canvas);
 const sync=()=>{if(!motionAllowed()){stop();}guideLabel();last=0;requestDraw();};reduce.addEventListener('change',sync);document.addEventListener('atlas-motion-change',sync);document.addEventListener('visibilitychange',()=>{last=0;if(document.hidden){if(frame)cancelAnimationFrame(frame);frame=0;}else requestDraw();});
 canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();lost=true;ready=false;stop();host.classList.remove('hc-ready');host.dataset.ready='false';status.renderer='fallback';fallbackUI();$('.hc-markers').hidden=true;$('.hc-leaders').hidden=true;$('.hc-guide').disabled=true;$('.hc-fingerprint').disabled=true;host.querySelectorAll('[data-side]').forEach(b=>{b.disabled=false;b.onclick=()=>inspect(evidence.findings.find(f=>f.side===b.dataset.side));});announce('Showing the still evidence preview. All seven original findings remain available through Examine.');});
 canvas.addEventListener('webglcontextrestored',()=>location.reload());
 Object.defineProperty(window,'atlasHeroState',{get:()=>({...status,side,pose:{...pose},time,running,visible,ready,reducedMotion:reduce.matches})});
 try{await renderer();}catch(e){status.error=e.message;status.renderer='fallback';running=false;ready=false;fallbackUI();$('.hc-markers').hidden=true;host.dataset.ready='false';host.classList.remove('hc-ready');$('.hc-guide').disabled=true;$('.hc-fingerprint').disabled=true;host.querySelectorAll('[data-side]').forEach(b=>{b.disabled=false;b.onclick=()=>{side=b.dataset.side;inspect(evidence.findings.find(f=>f.side===side));};});announce('Showing the still evidence preview. Open Examine to inspect every original finding.');console.warn('ATLAS hero fallback:',e.message);}
}
initialize().catch(e=>{status.error=e.message;status.renderer='fallback';$('.hc-hint').textContent='The still evidence preview is available. Interactive evidence could not load; please refresh.';host.querySelectorAll('button').forEach(b=>b.disabled=true);console.warn('ATLAS evidence load:',e.message);});
