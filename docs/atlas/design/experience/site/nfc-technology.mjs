// ATLAS NFC TECHNOLOGY. A single reusable illustrative product, authored in 3D Jutsu.
// This module does not read or mutate card, grade, report, hardware or account state.
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const ease=t=>{t=clamp(t);return t*t*(3-2*t);};
const lerp=(a,b,t)=>a+(b-a)*t;
export const NFC_PARTS=Object.freeze({
  cover:{name:'Face layer',title:'The outside of the connection.',description:'A thin face layer covers the inlay beneath it.',rest:[0,.00105,0],open:[-.001,.047,-.002],anchor:[.018,0,0],side:'right',row:0},
  chip:{name:'Silicon chip',title:'A small chip. A saved link.',description:'The chip stores the encoded link your phone reads.',rest:[0,.00072,0],open:[.002,.031,.001],anchor:[.002,0,0],side:'right',row:1},
  antenna:{name:'Antenna',title:'The connection starts here.',description:'The metal antenna couples with a nearby phone to power the passive tag and exchange data.',rest:[0,.0004,0],open:[0,.017,0],anchor:[-.021,0,.004],side:'left',row:2},
  carrier:{name:'Carrier film',title:'A foundation for the circuit.',description:'A thin carrier holds the antenna and chip in position.',rest:[0,.00018,0],open:[0,.001,0],anchor:[.023,0,.004],side:'right',row:3},
  adhesive:{name:'Adhesive',title:'Made to become part of the label.',description:'An adhesive layer attaches the inlay within a finished label assembly.',rest:[0,-.00003,0],open:[0,-.013,0],anchor:[-.02,0,.004],side:'left',row:4}
});

export async function mountNfcTechnology(section,{signal,modelUrl=new URL('./assets/nfc/atlas-nfc.glb',import.meta.url),onReady=()=>{},onError=()=>{}}={}){
  if(!section)throw new Error('NFC technology section is required.');
  const started=performance.now(),lifecycle=new AbortController(),localSignal=lifecycle.signal;
  const stage=section.querySelector('[data-nfc-stage]'),fallback=section.querySelector('[data-nfc-poster]');
  const detailTitle=section.querySelector('[data-nfc-detail-title]'),detailText=section.querySelector('[data-nfc-detail-text]');
  const status=section.querySelector('[data-nfc-status]'),motionButton=section.querySelector('[data-nfc-motion]'),resetButton=section.querySelector('[data-nfc-reset]');
  if(!stage||!detailTitle||!detailText||!motionButton)throw new Error('NFC technology markup is incomplete.');
  let renderer,scene,assetScene,camera,product,environment,resizeObserver,visibilityObserver,frame=null,disposed=false,lost=false;
  let visible=false,playing=false,selected=null,drag=null,yaw=0,pitch=0,orbitYaw=0,elapsed=0,last=0,amount=0,zoom=1;
  let reduced=matchMedia('(prefers-reduced-motion: reduce)').matches,requestedAmount=null;
  let renderedFrames=0,readyMs=null,drawCalls=0,triangles=0,pointerWasDrag=false;
  const media=matchMedia('(prefers-reduced-motion: reduce)'),meshes=[],partObjects={},buttons={},paths={};
  const globallyPaused=()=>document.documentElement.classList.contains('motion-off');
  const resources={geometries:new Set(),materials:new Set(),textures:new Set()};
  const listen=(el,type,fn,options={})=>el?.addEventListener(type,fn,{...options,signal:localSignal});
  function disposeObject(root){root?.traverse(o=>{if(o.geometry)resources.geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])if(m){resources.materials.add(m);for(const v of Object.values(m))if(v?.isTexture)resources.textures.add(v);}});}
  function dispose(){
    if(disposed)return;disposed=true;lifecycle.abort();if(frame!==null)cancelAnimationFrame(frame);frame=null;
    resizeObserver?.disconnect();visibilityObserver?.disconnect();media.removeEventListener('change',onReducedChange);
    signal?.removeEventListener('abort',dispose);disposeObject(scene);disposeObject(assetScene);
    resources.geometries.forEach(g=>g.dispose());resources.materials.forEach(m=>m.dispose());resources.textures.forEach(t=>{t.dispose();t.source?.data?.close?.();});
    environment?.dispose();renderer?.dispose();renderer?.domElement.remove();
    for(const path of Object.values(paths))path.remove();
    section.classList.remove('nfc-ready','nfc-selected');delete section.dataset.nfcReady;
  }
  const state=()=>({ready:!!product&&!lost&&!disposed,disposed,lost,playing,globallyPaused:globallyPaused(),selected,reduced,elapsed,amount,renderedFrames,readyMs,drawCalls,triangles,dpr:renderer?.getPixelRatio(),canvasCount:stage.querySelectorAll('canvas').length});
  const api={dispose,getState:state,selectPart:key=>select(key),setPlaying:value=>setPlaying(value),reset:()=>reset()};
  signal?.addEventListener('abort',dispose,{once:true});
  if(signal?.aborted){dispose();return api;}
  let THREE;
  const focus={x:0,y:.016,z:0};
  const defaultTitle=detailTitle.innerText.replace(/\s+/g,' ').trim(),defaultText=detailText.textContent;
  function updateUI(){
    section.classList.toggle('nfc-selected',!!selected);
    section.classList.toggle('nfc-playing',playing&&!globallyPaused());
    motionButton.textContent=playing?'Pause motion':selected?'Resume motion':'Play motion';
    motionButton.setAttribute('aria-pressed',String(playing));
    if(resetButton)resetButton.hidden=!selected&&!yaw&&!pitch;
    for(const [key,b] of Object.entries(buttons))b.setAttribute('aria-pressed',String(key===selected));
  }
  function setPlaying(value){
    if(disposed||lost)return;playing=!!value;
    if(playing){selected=null;requestedAmount=null;detailTitle.textContent=defaultTitle;detailText.textContent=defaultText;elapsed=4.5;}
    else requestedAmount=amount;
    updateUI();last=0;request();
  }
  function reset(){
    if(disposed||lost)return;selected=null;yaw=0;pitch=0;orbitYaw=0;requestedAmount=reduced?1:null;playing=!reduced;elapsed=4.5;
    detailTitle.textContent=defaultTitle;detailText.textContent=defaultText;updateUI();last=0;request();
  }
  function select(key){
    if(disposed||lost||!NFC_PARTS[key]||!product)return;
    selected=key;playing=false;requestedAmount=1;
    detailTitle.textContent=NFC_PARTS[key].title;detailText.textContent=NFC_PARTS[key].description;
    updateUI();request();
  }
  function onReducedChange(event){reduced=event.matches;if(reduced){playing=false;amount=1;requestedAmount=1;yaw=0;pitch=0;}updateUI();last=0;request();}
  function request(){if(!disposed&&!lost&&renderer&&visible&&!document.hidden&&frame===null)frame=requestAnimationFrame(draw);}
  function autoAmount(t){t%=16;return t<.6?0:t<4.2?ease((t-.6)/3.6):t<10.6?1:t<14.6?1-ease((t-10.6)/4):0;}
  function resize(){
    if(!renderer||disposed)return;const w=stage.clientWidth,h=stage.clientHeight;if(!w||!h)return;
    renderer.setSize(w,h,false);const vertical=w<520?.112:.095;
    camera.left=-vertical*w/h/2;camera.right=vertical*w/h/2;camera.top=vertical/2;camera.bottom=-vertical/2;camera.updateProjectionMatrix();request();
  }
  function setPartPose(t){
    for(const [key,p] of Object.entries(partObjects)){
      const d=NFC_PARTS[key];p.position.set(...d.rest.map((v,i)=>lerp(v,d.open[i],t)));
      p.rotation.set(key==='cover'?-.025*t:0,key==='chip'?.025*t:0,key==='cover'?-.05*t:0);
      p.scale.setScalar(1);
    }
  }
  function updateCallouts(){
    const w=stage.clientWidth,h=stage.clientHeight;
    for(const [key,o] of Object.entries(partObjects)){
      const d=NFC_PARTS[key],point=new THREE.Vector3(...d.anchor);o.localToWorld(point);point.project(camera);
      const px=(point.x*.5+.5)*w,py=(-point.y*.5+.5)*h;
      const b=buttons[key];if(!b)continue;
      const bw=b.offsetWidth,bh=b.offsetHeight;
      const left=d.side==='left'?14:w-bw-14;
      // Label tracks its part vertically, while a bounded rail prevents clipping.
      const top=clamp(py-bh/2,48+d.row*36,h-52-(4-d.row)*36);
      b.style.transform=`translate(${left}px,${top}px)`;
      const bx=d.side==='left'?left+bw:left,by=top+bh/2;
      paths[key].setAttribute('d',`M ${bx} ${by} L ${lerp(bx,px,.5)} ${by} L ${px} ${py}`);
      paths[key].classList.toggle('is-selected',key===selected);
      const concealed=amount<.24&&key!=='cover'&&!selected;
      b.style.opacity=concealed?'0':'1';
      b.style.visibility=concealed?'hidden':'visible';
      b.style.pointerEvents=concealed?'none':'auto';
      paths[key].style.opacity=concealed?'0':'1';
    }
  }
  function draw(now){
    frame=null;if(disposed||lost||!visible||document.hidden)return;
    const dt=last?Math.min((now-last)/1000,.06):1/60;last=now;
    const motionActive=playing&&!globallyPaused();
    if(motionActive)elapsed+=dt;
    const wanted=requestedAmount??(globallyPaused()?amount:autoAmount(elapsed)),blend=reduced||globallyPaused()?1:1-Math.exp(-dt*6);
    amount=lerp(amount,wanted,blend);if(Math.abs(amount-wanted)<.0003)amount=wanted;
    setPartPose(amount);
    if(motionActive)orbitYaw=Math.sin((elapsed%16)/16*Math.PI*2)*.22;
    product.rotation.set(0,yaw+orbitYaw,0);
    const selectedObject=selected?partObjects[selected]:null;
    const target=selectedObject?selectedObject.getWorldPosition(new THREE.Vector3()):new THREE.Vector3(0,.016,0);
    // Selected chip gets a modest closer inspection; all parts retain their own true geometry.
    const targetZoom=selected==='chip'?1.12:selected==='antenna'?1.08:1;
    zoom=lerp(zoom,targetZoom,blend);focus.x=lerp(focus.x,target.x*.18,blend);focus.y=lerp(focus.y,selected?lerp(.016,target.y,.4):.016,blend);focus.z=0;
    const phi=.56+pitch;camera.position.set(.066,Math.sin(phi)*.145+.016,Math.cos(phi)*.145);
    camera.lookAt(focus.x,focus.y,focus.z);camera.zoom=zoom;camera.updateProjectionMatrix();
    for(const m of meshes){const part=m.userData.nfcPart;for(const mat of Array.isArray(m.material)?m.material:[m.material]){
      if(mat.emissive){mat.emissive.setHex(part===selected?0x6f5725:0x000000);mat.emissiveIntensity=part===selected?.17:0;}
    }}
    scene.updateMatrixWorld(true);updateCallouts();renderer.render(scene,camera);renderedFrames++;
    drawCalls=renderer.info.render.calls;triangles=renderer.info.render.triangles;
    const moving=Math.abs(amount-wanted)>.0003||Math.abs(zoom-targetZoom)>.001||Math.abs(focus.y-(selected?lerp(.016,target.y,.4):.016))>.00001;
    if(!globallyPaused()&&(playing||moving))request();
  }
  try{
    const [three,loaderModule,buffer]=await Promise.all([
      import('./assets/vendor/three.module.js'),import('./assets/vendor/GLTFLoader.js'),
      fetch(modelUrl,{signal:localSignal}).then(r=>{if(!r.ok)throw new Error('NFC model unavailable.');return r.arrayBuffer();})
    ]);
    THREE=three;if(disposed)return api;
    const gltf=await new loaderModule.GLTFLoader().parseAsync(buffer,new URL('.',modelUrl).href);assetScene=gltf.scene;
    if(disposed){disposeObject(gltf.scene);resources.geometries.forEach(g=>g.dispose());resources.materials.forEach(m=>m.dispose());return api;}
    product=gltf.scene.getObjectByName('NFC_Product');
    if(!product)throw new Error('NFC semantic model root is missing.');
    scene=new THREE.Scene();scene.add(product);product.position.set(0,0,0);product.rotation.set(0,0,0);
    for(const key of Object.keys(NFC_PARTS)){
      partObjects[key]=product.getObjectByName('NFC_'+key[0].toUpperCase()+key.slice(1));
      if(!partObjects[key])throw new Error('NFC part is missing: '+key);
      partObjects[key].traverse(o=>{if(o.isMesh){o.userData.nfcPart=key;meshes.push(o);for(const m of Array.isArray(o.material)?o.material:[o.material]){m.envMapIntensity=.85;if(m.transparent)m.depthWrite=false;if(m.transmission)m.transmission=0;}}});
    }
    renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});
    renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.08;renderer.transmissionResolutionScale=.5;
    camera=new THREE.OrthographicCamera(-.05,.05,.05,-.05,.001,5);
    // Soft studio reflections describe metal and film; there are no texture downloads.
    const studio=new THREE.Scene();studio.background=new THREE.Color(0x17221e);
    function softbox(w,h,color,power,pos){const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide}));m.material.color.multiplyScalar(power);m.position.set(...pos);m.lookAt(0,0,0);studio.add(m);}
    softbox(7,14,0xfff3dc,3.2,[-7,7,5]);softbox(2,10,0xb4e4d0,2.1,[7,3,-3]);softbox(9,3,0xffffff,2.4,[0,10,0]);softbox(6,5,0x96adb2,.8,[1,-4,6]);
    const pmrem=new THREE.PMREMGenerator(renderer);environment=pmrem.fromScene(studio,.035,.1,80);pmrem.dispose();scene.environment=environment.texture;
    studio.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
    scene.add(new THREE.HemisphereLight(0xe7f1e9,0x11251a,1.2));
    const keyLight=new THREE.DirectionalLight(0xffefcc,2.5);keyLight.position.set(-.08,.12,.10);scene.add(keyLight);
    const rim=new THREE.DirectionalLight(0xa8dfc1,1.6);rim.position.set(.08,.08,-.08);scene.add(rim);
    const fill=new THREE.DirectionalLight(0xffffff,.8);fill.position.set(.08,.01,.1);scene.add(fill);
    renderer.domElement.setAttribute('aria-hidden','true');renderer.domElement.className='at-nfc-canvas';stage.append(renderer.domElement);
    const svg=section.querySelector('[data-nfc-lines]');
    for(const [key,d] of Object.entries(NFC_PARTS)){
      const b=section.querySelector(`[data-nfc-part="${key}"]`);buttons[key]=b;
      if(b){listen(b,'click',()=>select(key));b.setAttribute('aria-pressed','false');}
      const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.dataset.part=key;svg?.append(path);paths[key]=path;
    }
    const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
    function hit(event){const r=stage.getBoundingClientRect();pointer.set((event.clientX-r.left)/r.width*2-1,-(event.clientY-r.top)/r.height*2+1);raycaster.setFromCamera(pointer,camera);return raycaster.intersectObjects(meshes,false).find(v=>v.object.visible)?.object.userData.nfcPart;}
    listen(stage,'pointerdown',e=>{if(e.target.closest('button'))return;drag={id:e.pointerId,x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY,touch:e.pointerType==='touch',active:false};pointerWasDrag=false;});
    listen(stage,'pointermove',e=>{
      if(!drag||e.pointerId!==drag.id)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
      if(!drag.active&&Math.abs(dx)>7&&(!drag.touch||Math.abs(dx)>Math.abs(dy)*1.25)){drag.active=true;stage.setPointerCapture(e.pointerId);playing=false;requestedAmount=1;updateUI();}
      if(drag.active){e.preventDefault();pointerWasDrag=true;yaw+=(e.clientX-drag.lastX)*.008;if(!drag.touch)pitch=clamp(pitch-(e.clientY-drag.lastY)*.004,-.28,.6);request();}
      drag.lastX=e.clientX;drag.lastY=e.clientY;
    },{passive:false});
    listen(stage,'pointerup',e=>{if(!drag||e.pointerId!==drag.id)return;if(!pointerWasDrag&&!e.target.closest('button')){const key=hit(e);if(key)select(key);}if(stage.hasPointerCapture(e.pointerId))stage.releasePointerCapture(e.pointerId);drag=null;});
    listen(stage,'pointercancel',()=>{drag=null;});
    listen(stage,'keydown',e=>{
      if(e.target.closest('button'))return;
      if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','Escape',' '].includes(e.key))e.preventDefault();
      if(e.key==='ArrowLeft'||e.key==='ArrowRight'){playing=false;requestedAmount=1;yaw+=e.key==='ArrowLeft'?-.18:.18;updateUI();request();}
      if(e.key==='ArrowUp'||e.key==='ArrowDown'){playing=false;requestedAmount=1;pitch=clamp(pitch+(e.key==='ArrowUp'?.12:-.12),-.28,.6);updateUI();request();}
      if(e.key==='Escape'||e.key==='Home')reset();if(e.key===' ')setPlaying(!playing);
    });
    listen(motionButton,'click',()=>setPlaying(!playing));listen(resetButton,'click',reset);
    listen(document,'visibilitychange',()=>{last=0;if(document.hidden&&frame!==null){cancelAnimationFrame(frame);frame=null;}else request();});
    listen(document,'atlas-motion-change',()=>{last=0;if(frame!==null){cancelAnimationFrame(frame);frame=null;}updateUI();request();});
    listen(renderer.domElement,'webglcontextlost',event=>{event.preventDefault();lost=true;playing=false;if(frame!==null)cancelAnimationFrame(frame);frame=null;section.classList.remove('nfc-ready');status.textContent='Interactive view unavailable. The tag anatomy remains below.';motionButton.disabled=true;for(const b of Object.values(buttons))if(b)b.disabled=true;onError(new Error('NFC WebGL context lost.'));});
    media.addEventListener('change',onReducedChange);
    resizeObserver=new ResizeObserver(resize);resizeObserver.observe(stage);
    visibilityObserver=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;last=0;if(!visible&&frame!==null){cancelAnimationFrame(frame);frame=null;}else request();},{rootMargin:'60px',threshold:0});visibilityObserver.observe(section);
    playing=!reduced;amount=reduced||globallyPaused()?1:0;requestedAmount=reduced?1:null;readyMs=performance.now()-started;
    section.classList.add('nfc-ready');section.dataset.nfcReady='true';status.textContent='Select a part to explore. Drag to turn.';
    updateUI();resize();onReady(api);return api;
  }catch(error){
    if(disposed||error.name==='AbortError')return api;
    dispose();
    status.textContent='NFC tag anatomy';motionButton.disabled=true;
    // The permanent HTML explanation and rendered poster remain usable.
    onError(error);return api;
  }
}
