import * as THREE from '/homepage/fb649faa40d78d04/assets/vendor/three.module.js';
const host=document.getElementById('slab-stage');
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
try {
  const renderer=new THREE.WebGLRenderer({alpha:true,antialias:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.setClearColor(0x080909,0);
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.35;
  const scene=new THREE.Scene();
  const camera=new THREE.PerspectiveCamera(31,1,.1,100);
  camera.position.set(0,0,29);
  const slab=new THREE.Group();scene.add(slab);
  function rounded(w,h,r){
    const s=new THREE.Shape();const x=-w/2,y=-h/2;
    s.moveTo(x+r,y);s.lineTo(x+w-r,y);s.quadraticCurveTo(x+w,y,x+w,y+r);
    s.lineTo(x+w,y+h-r);s.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
    s.lineTo(x+r,y+h);s.quadraticCurveTo(x,y+h,x,y+h-r);
    s.lineTo(x,y+r);s.quadraticCurveTo(x,y,x+r,y);return s;
  }
  const border=rounded(8.1,13.85,.38);
  border.holes.push(new THREE.Path(rounded(7.56,13.25,.26).getPoints(48).reverse()));
  const shell=new THREE.Mesh(new THREE.ExtrudeGeometry(border,{depth:.4,bevelEnabled:true,bevelThickness:.08,bevelSize:.09,bevelSegments:4,steps:1}),new THREE.MeshPhysicalMaterial({color:0xc6d4d8,metalness:.28,roughness:.18,transparent:true,opacity:.40,clearcoat:1}));
  shell.position.z=-.15;slab.add(shell);
  const inner=new THREE.Mesh(new THREE.ShapeGeometry(rounded(7.5,13.2,.25)),new THREE.MeshPhongMaterial({color:0x788c96,transparent:true,opacity:.1,shininess:110,depthWrite:false}));
  inner.position.z=-.2;slab.add(inner);
  const divider=new THREE.Mesh(new THREE.BoxGeometry(7.5,.075,.3),new THREE.MeshStandardMaterial({color:0xb9c5c5,metalness:.65,roughness:.23}));
  divider.position.set(0,3.19,.07);slab.add(divider);
  const loader=new THREE.TextureLoader();
  async function plane(url,w,h,y){
    const map=await loader.loadAsync(url);map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=renderer.capabilities.getMaxAnisotropy();
    const face=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({map,toneMapped:false}));
    face.position.set(0,y,.1);slab.add(face);
  }
  scene.add(new THREE.AmbientLight(0xffffff,1.3));
  const warm=new THREE.PointLight(0xffd994,85,70);warm.position.set(-8,8,10);scene.add(warm);
  const cool=new THREE.PointLight(0xd4ecff,110,70);cool.position.set(9,3,8);scene.add(cool);
  const top=new THREE.DirectionalLight(0xffffff,3);top.position.set(1,10,3);scene.add(top);
  await Promise.all([plane('/homepage/fb649faa40d78d04/assets/alakazam-reference.jpg',6.35,8.89,-1.53),plane('/homepage/fb649faa40d78d04/assets/alakazam-label-sample.svg',6.93,2.107,4.66)]);
  let x=-.17,y=.12,visible=true,frame=null,started=performance.now();
  const presentation=document.querySelector('.specimen-stage');
  slab.rotation.set(y,x,-.055);
  function draw(){renderer.render(scene,camera);}
  function resize(){const w=host.clientWidth,h=host.clientHeight;if(!w||!h)return;renderer.setSize(w,h);camera.aspect=w/h;camera.position.z=camera.aspect<.5?37:camera.aspect<.7?34:29;camera.updateProjectionMatrix();draw();}
  const observer=new ResizeObserver(resize);observer.observe(host);
  renderer.domElement.setAttribute('aria-hidden','true');host.append(renderer.domElement);host.classList.add('has-canvas');resize();
  function active(){return visible&&!document.hidden&&!reduced.matches&&!document.documentElement.classList.contains('motion-off')&&presentation.dataset.mode==='slab';}
  function tick(now){
    frame=null;if(!active())return;
    const t=(now-started)/1000;
    const entrance=Math.max(0,1-Math.min(t/1.8,1));
    slab.rotation.x+=(y+Math.sin(t*.38)*.018-slab.rotation.x)*.045;
    slab.rotation.y+=(x+Math.sin(t*.3)*.035+entrance*entrance*.5-slab.rotation.y)*.045;
    slab.position.y=Math.sin(t*.65)*.065;
    warm.position.x=-7+Math.sin(t*.4)*5;cool.position.y=5+Math.sin(t*.35)*3;
    draw();frame=requestAnimationFrame(tick);
  }
  function sync(){if(frame!==null){cancelAnimationFrame(frame);frame=null;}if(active())frame=requestAnimationFrame(tick);else draw();}
  new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;sync();},{threshold:.05}).observe(host);
  document.addEventListener('atlas-motion-change',sync);document.addEventListener('visibilitychange',sync);reduced.addEventListener('change',sync);
  host.addEventListener('pointermove',event=>{
    if(event.pointerType!=='mouse'||!active())return;
    const rect=host.getBoundingClientRect();x=((event.clientX-rect.left)/rect.width-.5)*.45;y=-((event.clientY-rect.top)/rect.height-.5)*.23;
  });
  host.addEventListener('pointerleave',()=>{x=-.17;y=.12;});
  renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();visible=false;sync();host.classList.remove('has-canvas');});
  sync();
} catch(error) { console.warn('Static slab preview retained:',error.message); }

// Study 07: conceptual NFC architecture, never a claim about actual die geometry.
// Event-driven rendering sleeps after the camera settles, offscreen and when hidden.
const nfcHost=document.getElementById('nfc-stage');
const nfcSection=document.querySelector('.nfc-experience');
let nfcStarted=false;
const nfcLoader=new IntersectionObserver(entries=>{
  if(!entries[0].isIntersecting||nfcStarted)return;
  nfcStarted=true;nfcLoader.disconnect();
  createNfcScene().catch(error=>{nfcHost.classList.remove('has-canvas');console.warn('Static NFC illustration retained:',error.message);});
},{rootMargin:'450px'});
nfcLoader.observe(nfcHost);
async function createNfcScene(){
  const renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power',preserveDrawingBuffer:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.28;
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(35,1,.05,160);
  const model=new THREE.Group();scene.add(model);
  const gold=new THREE.MeshStandardMaterial({color:0xcda965,metalness:.88,roughness:.29});
  const paleGold=new THREE.MeshStandardMaterial({color:0xf3ddad,metalness:.7,roughness:.25});
  const silicon=new THREE.MeshStandardMaterial({color:0x122329,metalness:.68,roughness:.25});
  const ceramic=new THREE.MeshStandardMaterial({color:0x25332a,metalness:.44,roughness:.38});
  const edge=new THREE.MeshStandardMaterial({color:0x84989b,metalness:.8,roughness:.24});
  function box(w,h,d,material,x=0,y=0,z=0,parent=model){const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);mesh.position.set(x,y,z);parent.add(mesh);return mesh;}
  function rounded(w,h,r){const shape=new THREE.Shape(),x=-w/2,y=-h/2;shape.moveTo(x+r,y);shape.lineTo(x+w-r,y);shape.quadraticCurveTo(x+w,y,x+w,y+r);shape.lineTo(x+w,y+h-r);shape.quadraticCurveTo(x+w,y+h,x+w-r,y+h);shape.lineTo(x+r,y+h);shape.quadraticCurveTo(x,y+h,x,y+h-r);shape.lineTo(x,y+r);shape.quadraticCurveTo(x,y,x+r,y);return shape;}
  const slabGroup=new THREE.Group();model.add(slabGroup);
  const border=rounded(7.8,12.8,.35);border.holes.push(new THREE.Path(rounded(7.45,12.42,.29).getPoints(40).reverse()));
  const shell=new THREE.Mesh(new THREE.ExtrudeGeometry(border,{depth:.3,bevelEnabled:true,bevelThickness:.04,bevelSize:.04,bevelSegments:2,steps:1}),new THREE.MeshPhysicalMaterial({color:0xb9cfce,metalness:.3,roughness:.16,transparent:true,opacity:.4}));shell.position.set(0,-3.1,-.9);slabGroup.add(shell);
  const loader=new THREE.TextureLoader();
  const cardTexture=await loader.loadAsync(document.querySelector('.fingerprint-photo').getAttribute('src'));cardTexture.colorSpace=THREE.SRGBColorSpace;
  const card=new THREE.Mesh(new THREE.PlaneGeometry(6.35,8.89),new THREE.MeshBasicMaterial({map:cardTexture,transparent:true,opacity:.42,toneMapped:false}));card.position.set(0,-4.15,-.84);slabGroup.add(card);
  function makeNfcLabel(name){const c=document.createElement('canvas');c.width=1000;c.height=300;const ctx=c.getContext('2d');ctx.fillStyle='#090d0b';ctx.fillRect(0,0,1000,300);ctx.strokeStyle='#c4a569';ctx.lineWidth=7;ctx.strokeRect(6,6,988,288);const logo=document.querySelector('.brand img');if(logo.complete)ctx.drawImage(logo,30,28,250,224);ctx.fillStyle='#e9cb8f';ctx.font='500 45px Oxanium';ctx.fillText('ATLAS GRADING',315,83);ctx.fillStyle='#edf0e6';ctx.font='500 49px Oxanium';ctx.fillText(name.toUpperCase(),315,158);ctx.fillStyle='#97aa9a';ctx.font='25px monospace';ctx.fillText('ILLUSTRATIVE DESIGN SAMPLE',315,221);const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;return texture;}
  const labelTexture=makeNfcLabel(document.querySelector('.connected-name').textContent);
  const label=new THREE.Mesh(new THREE.PlaneGeometry(6.85,2.08),new THREE.MeshBasicMaterial({map:labelTexture,transparent:true,opacity:.45,toneMapped:false}));label.position.set(0,1.78,-.85);slabGroup.add(label);
  const tagAssembly=new THREE.Group();tagAssembly.position.set(-2.2,1.9,.2);tagAssembly.scale.setScalar(.23);model.add(tagAssembly);
  const antenna=new THREE.Group();tagAssembly.add(antenna);
  const backing=new THREE.Mesh(new THREE.ShapeGeometry(rounded(6.7,4.9,.44)),new THREE.MeshStandardMaterial({color:0x15372d,metalness:.5,roughness:.5,transparent:true,opacity:.45,side:THREE.DoubleSide}));backing.position.z=-.32;antenna.add(backing);
  for(let i=0;i<7;i++){
    const w=6.45-i*.25,h=4.65-i*.25,r=.48-i*.028;
    const wire=rounded(w,h,r).getPoints(70).map(p=>new THREE.Vector3(p.x,p.y,-.16));
    const curve=new THREE.CatmullRomCurve3(wire,true);
    antenna.add(new THREE.Mesh(new THREE.TubeGeometry(curve,160,.027,5,true),gold));
  }
  // The oversized central die and its layers are deliberate explanatory geometry.
  const chip=new THREE.Group();tagAssembly.add(chip);
  box(1.64,1.64,.1,edge,0,0,-.16,chip);box(1.53,1.53,.12,ceramic,0,0,-.055,chip);box(1.35,1.35,.1,silicon,0,0,.04,chip);
  for(let i=0;i<14;i++){
    const a=-.64+i*.098;
    for(const side of [-1,1]){
      box(.065,.17,.045,gold,a,side*.745,.04,chip);box(.17,.065,.045,gold,side*.745,a,.04,chip);
      const curve=new THREE.QuadraticBezierCurve3(new THREE.Vector3(a,side*.84,.035),new THREE.Vector3(a*1.13,side*1.02,.27),new THREE.Vector3(a*1.2,side*1.13,-.1));
      chip.add(new THREE.Mesh(new THREE.TubeGeometry(curve,12,.01,4,false),paleGold));
      const curve2=new THREE.QuadraticBezierCurve3(new THREE.Vector3(side*.84,a,.035),new THREE.Vector3(side*1.02,a*1.13,.27),new THREE.Vector3(side*1.13,a*1.2,-.1));
      chip.add(new THREE.Mesh(new THREE.TubeGeometry(curve2,12,.01,4,false),paleGold));
    }
  }
  // Instanced microstructures keep the deep view detailed without hundreds of draw calls.
  const cells=new THREE.InstancedMesh(new THREE.BoxGeometry(.018,.055,.022),gold,520);
  const dummy=new THREE.Object3D();let cellIndex=0;
  for(let col=0;col<26;col++)for(let row=0;row<20;row++){
    const x=-.585+col*.046,y=-.56+row*.058;
    dummy.position.set(x,y,.108+((row+col)%4)*.007);dummy.rotation.z=col%5===0?Math.PI/2:0;dummy.updateMatrix();cells.setMatrixAt(cellIndex++,dummy.matrix);
  }chip.add(cells);
  const traces=new THREE.Group();chip.add(traces);
  for(let i=0;i<16;i++){
    const v=-.58+i*.076;
    box(.006,1.16,.012,paleGold,v,0,.148,traces);
    if(i%2===0)box(1.18,.009,.013,gold,0,v,.15,traces);
  }
  box(.43,.43,.065,ceramic,.07,.04,.17,chip);
  for(let i=0;i<8;i++)box(.32,.011,.018,paleGold,.07,-.11+i*.043,.21,chip);
  // Fine repeated topography becomes legible as the camera moves toward the die.
  const micro=new THREE.InstancedMesh(new THREE.BoxGeometry(.011,.019,.017),edge,192);
  let mi=0;for(let x=0;x<16;x++)for(let y=0;y<12;y++){dummy.position.set(-.59+x*.024,.29+y*.024,.15);dummy.rotation.z=0;dummy.updateMatrix();micro.setMatrixAt(mi++,dummy.matrix);}chip.add(micro);
  const glowMaterial=new THREE.MeshBasicMaterial({color:0xf3ddad,transparent:true,opacity:.2,depthWrite:false});
  for(let i=0;i<3;i++){
    const ring=new THREE.Mesh(new THREE.TorusGeometry(2.4+i*.38,.012,4,80),glowMaterial);ring.scale.y=.69;ring.position.z=.12-i*.1;antenna.add(ring);
  }
  scene.add(new THREE.AmbientLight(0xd2e4e1,1.7));
  const key=new THREE.DirectionalLight(0xffe2a4,5);key.position.set(-3,5,8);scene.add(key);
  const rim=new THREE.DirectionalLight(0xa6d0e9,4);rim.position.set(5,-1,4);scene.add(rim);
  const warm=new THREE.PointLight(0xf3d394,35,18);warm.position.set(0,4,4);scene.add(warm);
  // Electric signal accents are explanatory motion, not physical chip microscopy.
  const signal=new THREE.Group();chip.add(signal);
  const signalMat=new THREE.MeshBasicMaterial({color:0x7dddf1,transparent:true,opacity:.88});
  const signalBars=[];for(let i=0;i<12;i++){const bar=box(.014,.08,.018,signalMat,-.55+i*.1,-.55,.17,signal);signalBars.push(bar);}
  const signalLight=new THREE.PointLight(0x7cdcf4,.035,3);signalLight.position.set(0,0,1);tagAssembly.add(signalLight);
  const warpCanvas=nfcSection.querySelector('.nfc-warp'),warpCtx=warpCanvas.getContext('2d');
  let warpWidth=0,warpHeight=0;
  function resizeWarp(){warpWidth=warpCanvas.clientWidth;warpHeight=warpCanvas.clientHeight;warpCanvas.width=warpWidth;warpCanvas.height=warpHeight;}
  new ResizeObserver(resizeWarp).observe(warpCanvas);resizeWarp();
  function paintWarp(time,amount){
    warpCtx.clearRect(0,0,warpWidth,warpHeight);if(amount<=0)return;
    const cx=warpWidth*.55,cy=warpHeight*.48,max=Math.hypot(warpWidth,warpHeight);
    const glow=warpCtx.createRadialGradient(cx,cy,2,cx,cy,max*.65);glow.addColorStop(0,'#fff3d0');glow.addColorStop(.012,'#f3ddad');glow.addColorStop(.04,'#c9ac67');glow.addColorStop(.13,'#142a30');glow.addColorStop(.45,'#07100f');glow.addColorStop(1,'#030605');warpCtx.fillStyle=glow;warpCtx.fillRect(0,0,warpWidth,warpHeight);
    warpCtx.lineWidth=1.2;
    for(let i=0;i<112;i++){
      const angle=i*2.399963,timeOffset=(time*.65+i*.137)%1,r=12+timeOffset*timeOffset*max*.7,len=20+timeOffset**3*max*.4;
      warpCtx.strokeStyle=i%5===0?'#7dddf1d0':'#e9cb8fc0';warpCtx.shadowColor=i%5===0?'#7dddf1':'#e9cb8f';warpCtx.shadowBlur=8;warpCtx.lineWidth=1+timeOffset*2;warpCtx.globalAlpha=Math.min(1,timeOffset*2);
      warpCtx.beginPath();warpCtx.moveTo(cx+Math.cos(angle)*r,cy+Math.sin(angle)*r);warpCtx.lineTo(cx+Math.cos(angle)*(r+len),cy+Math.sin(angle)*(r+len));warpCtx.stroke();
    }
    warpCtx.shadowBlur=0;warpCtx.lineWidth=1;warpCtx.globalAlpha=.22;warpCtx.strokeStyle='#dcb66d';
    for(let i=0;i<9;i++){const t=(i/9+time*.13)%1;warpCtx.beginPath();warpCtx.ellipse(cx,cy,20+t*t*max*.6,12+t*t*max*.4,time*.08,0,Math.PI*2);warpCtx.stroke();}
    warpCtx.globalAlpha=1;
  }
  let desired=Number(nfcSection.style.getPropertyValue('--nfc-focus'))||0,current=desired,frame=null,visible=false,still=false,pointer=0,tilt=0,lastDraw=0;
  function pose(time=0){
    const index=Math.min(4,Math.floor(current)),fraction=current-index;
    const depths=[1,0,0,1,1,1];
    const deep=THREE.MathUtils.lerp(depths[index],depths[index+1],fraction);
    const tunnel=Math.max(0,Math.min(1,(current-3.3)/.5))*(1-Math.max(0,Math.min(1,(current-4.75)/.25)));
    const aspect=camera.aspect,fit=Math.max(25,12/(2*Math.tan(35*Math.PI/360)*aspect));
    model.position.set(THREE.MathUtils.lerp(-.6,.2,deep),THREE.MathUtils.lerp(1.8,-.1,deep),0);
    model.rotation.set(THREE.MathUtils.lerp(.22,-.47,deep),THREE.MathUtils.lerp(-.35,.31,deep)+tilt,THREE.MathUtils.lerp(-.12,-.58,deep));
    model.updateMatrixWorld(true);const target=tagAssembly.getWorldPosition(new THREE.Vector3());
    const aim=new THREE.Vector3(0,0,0).lerp(target,deep);
    camera.position.set(aim.x,aim.y+.08,THREE.MathUtils.lerp(fit,aim.z+(aspect<.9?1.04:.82),deep));camera.lookAt(aim);
    chip.position.z=deep*.12;traces.position.z=deep*.04;
    slabGroup.visible=deep<.92;antenna.visible=deep<.9;model.visible=tunnel<.97&&current<4.9;
    card.material.opacity=.62;label.material.opacity=.85;backing.material.opacity=.34;glowMaterial.opacity=.1;
    const pulsing=!still&&!reduced.matches&&!document.documentElement.classList.contains('motion-off');
    signalBars.forEach((bar,i)=>{bar.position.y=pulsing?-.58+((time*.3+i*.071)%1)*1.16:0;});
    signalMat.opacity=pulsing?.65+Math.sin(time*2)*.18:.65;
    renderer.render(scene,camera);paintWarp(pulsing?time:0,tunnel);
    const screen=target.clone().project(camera);nfcHost.parentElement.style.setProperty('--tap-x',`${(screen.x*.5+.5)*nfcHost.clientWidth}px`);nfcHost.parentElement.style.setProperty('--tap-y',`${(-screen.y*.5+.5)*nfcHost.clientHeight}px`);
  }
  function active(){return visible&&!document.hidden;}
  function tick(now){frame=null;if(!active())return;
    if(now-lastDraw<32){frame=requestAnimationFrame(tick);return;}lastDraw=now;
    const staticMotion=still||reduced.matches||document.documentElement.classList.contains('motion-off');
    current=staticMotion?desired:THREE.MathUtils.lerp(current,desired,.085);tilt=staticMotion?0:THREE.MathUtils.lerp(tilt,pointer,.07);
    if(Math.abs(current-desired)<.001)current=desired;if(Math.abs(tilt-pointer)<.0002)tilt=pointer;
    pose(now/1000);if(!staticMotion)frame=requestAnimationFrame(tick);
  }
  function request(){if(frame===null&&active())frame=requestAnimationFrame(tick);}
  function resize(){const w=nfcHost.clientWidth,h=nfcHost.clientHeight;if(!w||!h)return;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();pose();request();}
  renderer.domElement.setAttribute('aria-hidden','true');nfcHost.append(renderer.domElement);nfcHost.classList.add('has-canvas');
  new ResizeObserver(resize).observe(nfcHost);resize();
  new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(!visible&&frame!==null){cancelAnimationFrame(frame);frame=null;}else request();},{threshold:.01}).observe(nfcHost);
  let textureRequest=0;
  nfcSection.addEventListener('atlas-nfc-specimen',async event=>{const requestId=++textureRequest;try{const texture=await loader.loadAsync(event.detail.image);texture.colorSpace=THREE.SRGBColorSpace;if(requestId!==textureRequest){texture.dispose();return;}const previous=card.material.map;card.material.map=texture;previous.dispose();const previousLabel=label.material.map;label.material.map=makeNfcLabel(event.detail.name);previousLabel.dispose();request();}catch{}});
  nfcSection.addEventListener('atlas-nfc-camera',event=>{desired=event.detail.position;still=event.detail.still;request();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&frame!==null){cancelAnimationFrame(frame);frame=null;}else request();});
  document.addEventListener('atlas-motion-change',request);reduced.addEventListener('change',request);
  nfcHost.addEventListener('pointermove',event=>{if(event.pointerType!=='mouse')return;const rect=nfcHost.getBoundingClientRect();pointer=((event.clientX-rect.left)/rect.width-.5)*.1;request();});
  nfcHost.addEventListener('pointerleave',()=>{pointer=0;request();});
  renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();visible=false;if(frame!==null)cancelAnimationFrame(frame);frame=null;nfcHost.classList.remove('has-canvas');});
}
