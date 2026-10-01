import {loadHeroEvidence, fetchVerifiedAsset} from '/homepage/d8ebedb13703d0fd/hero-evidence.mjs';

// Authored explanatory hardware; all card/report pixels and grades remain source-bound.
const chapter = document.querySelector('.at-tap');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const texts = [
  ['01 / CHIP + ANTENNA','The connection starts here.','A passive NFC tag holds the link to the card’s saved report. Your phone supplies the power.','ILLUSTRATIVE TAG ASSEMBLY'],
  ['02 / AT THE LABEL','A little closer to the story.','The connection sits at the ATLAS logo. Bring the top of a compatible NFC phone close to the label.','ILLUSTRATIVE SLAB + LABEL'],
  ['03 / TAP + OPEN','One tap. Then open.','Your phone finds the link. Open the notification to see the saved report.','PHONE TAP DEMONSTRATION'],
  ['04 / THE SAVED REPORT','The evidence comes with it.','The grade, original photographs, recorded findings and ATLAS fingerprint—ready to compare with the card in your hand.','ARCHIVED APPROVED SAMPLE']
];
const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => {const t=clamp(value); return t*t*(3-2*t);};
const mix = (a,b,t) => a+(b-a)*t;
const off = () => reduced.matches || document.documentElement.classList.contains('motion-off');
const resources = [], urls = [];
let sceneApi, readyPromise, active = false, played = false, running = false, frame = 0, start = 0, elapsed = 0, current = 0, target = 0, announced = -1;
const duration = 14400;
const replay = chapter?.querySelector('.at-tap-replay');
function announce(step) {
  if (step === announced) return; announced = step;
  chapter.dataset.step = String(step);
  const copy=texts[step];
  ['.at-tap-kicker','.at-tap-narrative h3','.at-tap-narrative p','.at-tap-object-label'].forEach((selector,index) => chapter.querySelector(selector).textContent=copy[index]);
  chapter.querySelector('.at-tap-stage-index').textContent=`0${step+1} / 04`;
  chapter.querySelectorAll('[data-tap-step]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.tapStep)===step)));
}
function labelReplay() {replay.innerHTML=running?'Pause the connection <span aria-hidden="true">Ⅱ</span>':'Replay the connection <span aria-hidden="true">↻</span>';}
function draw() {
  sceneApi?.pose(current);
  chapter.style.setProperty('--tap-progress',String(current/3));
  announce(Math.min(3,Math.floor(current+.42)));
}
function cancel() {if(frame)cancelAnimationFrame(frame);frame=0;}
function request() {if(!frame&&active&&!document.hidden&&sceneApi)frame=requestAnimationFrame(tick);}
function timeline(ms) {
  const t=ms/1000;
  if(t<2.1)return 0;
  if(t<4.5)return smooth((t-2.1)/2.4);
  if(t<6.1)return 1;
  if(t<8.2)return 1+smooth((t-6.1)/2.1);
  if(t<10.2)return 2;
  if(t<12.4)return 2+smooth((t-10.2)/2.2);
  return 3;
}
let previous=0;
function tick(now) {
  frame=0;if(!active||document.hidden)return;
  const dt=Math.min(50,now-(previous||now)); previous=now;
  if(running&&!off()) {elapsed=Math.min(duration,now-start);current=timeline(elapsed);target=current;if(elapsed===duration){running=false;labelReplay();}}
  else current=off()?target:mix(current,target,1-Math.exp(-dt/210));
  if(Math.abs(current-target)<.0005)current=target;
  draw();if(running||Math.abs(current-target)>.0005)request();
}
async function choose(step) {
  running=false;played=true;labelReplay();await init();target=step;
  if(off()||!active){current=target;draw();}else request();
}
function pausePolicy() {
  if(off()){running=false;target=Math.round(current);current=target;labelReplay();cancel();draw();}
  if(document.hidden||!active){if(running)elapsed=performance.now()-start;cancel();}
  else {if(running)start=performance.now()-elapsed;previous=0;request();}
}
async function init() {
  return readyPromise ||= createScene().then(api=>{sceneApi=api;draw();return api;}).catch(error=>{
    chapter.dataset.fallback='true';running=false;labelReplay();console.warn('ATLAS tap: source-backed static view retained.',error.message);return null;
  });
}
async function verifiedImage(asset) {
  const blob=await fetchVerifiedAsset(asset),url=URL.createObjectURL(blob);urls.push(url);
  const image=new Image();image.src=url;await image.decode();return image;
}
async function createScene() {
  const manifest=await loadHeroEvidence();
  const [presentation, original, fingerprint, THREE]=await Promise.all([
    verifiedImage(manifest.sides.FRONT.presentation),verifiedImage(manifest.sides.FRONT.original),verifiedImage(manifest.sides.FRONT.fingerprint),import('/homepage/d8ebedb13703d0fd/assets/vendor/three.module.js')
  ]);
  const host=chapter.querySelector('.at-tap-stage');
  const fallback=chapter.querySelector('.at-tap-fallback img');fallback.src=presentation.src;fallback.hidden=false;
  await document.fonts.load('600 40px Oxanium');
  const renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power',preserveDrawingBuffer:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.12;
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(33,1,.1,120);
  scene.add(new THREE.HemisphereLight(0xe0f0ec,0x152125,2.2));
  const key=new THREE.DirectionalLight(0xf9e3b8,4.2);key.position.set(-5,7,10);scene.add(key);
  const rim=new THREE.DirectionalLight(0xa5d1dc,3.4);rim.position.set(6,1,6);scene.add(rim);
  function material(color,metalness=.5,roughness=.28,opacity=1) {const m=new THREE.MeshStandardMaterial({color,metalness,roughness,transparent:true,opacity});m.userData.baseOpacity=opacity;return m;}
  function shape(w,h,r) {const s=new THREE.Shape(),x=-w/2,y=-h/2;s.moveTo(x+r,y);s.lineTo(x+w-r,y);s.quadraticCurveTo(x+w,y,x+w,y+r);s.lineTo(x+w,y+h-r);s.quadraticCurveTo(x+w,y+h,x+w-r,y+h);s.lineTo(x+r,y+h);s.quadraticCurveTo(x,y+h,x,y+h-r);s.lineTo(x,y+r);s.quadraticCurveTo(x,y,x+r,y);return s;}
  function plate(w,h,d,r,mat,parent,x=0,y=0,z=0) {const g=new THREE.ExtrudeGeometry(shape(w,h,r),{depth:d,bevelEnabled:true,bevelThickness:.025,bevelSize:.025,bevelSegments:2,steps:1,curveSegments:10});g.translate(0,0,-d/2);const m=new THREE.Mesh(g,mat);m.position.set(x,y,z);parent.add(m);return m;}
  function box(w,h,d,mat,parent,x=0,y=0,z=0){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);parent.add(m);return m;}
  function basic(map,opacity=1){const m=new THREE.MeshBasicMaterial({map,transparent:true,opacity,toneMapped:false});m.userData.baseOpacity=opacity;return m;}
  function texture(image){const t=new THREE.Texture(image);t.colorSpace=THREE.SRGBColorSpace;t.needsUpdate=true;t.anisotropy=Math.min(renderer.capabilities.getMaxAnisotropy(),4);return t;}
  function canvasTexture(canvas){const t=new THREE.CanvasTexture(canvas);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t;}
  const gold=material(0xcda955,.86,.23),copper=material(0xd2a470,.85,.29),dark=material(0x14211d,.62,.27),silver=material(0xabb9b6,.82,.25);
  const tag=new THREE.Group();scene.add(tag);
  const backing=plate(6.7,4.65,.09,.3,material(0x213a32,.5,.4,.72),tag,0,0,-.22);
  const antenna=new THREE.Group();tag.add(antenna);
  for(let i=0;i<7;i++){const curve=new THREE.CatmullRomCurve3(shape(6.35-i*.28,4.3-i*.28,.4).getPoints(60).map(p=>new THREE.Vector3(p.x,p.y,0)),true);antenna.add(new THREE.Mesh(new THREE.TubeGeometry(curve,150,.031,5,true),i<2?gold:copper));}
  const chip=new THREE.Group();tag.add(chip);
  plate(1.65,1.65,.13,.12,silver,chip);plate(1.48,1.48,.15,.08,dark,chip,0,0,.13);
  const die=plate(1.14,1.14,.07,.025,material(0x1b353c,.66,.18),chip,0,0,.255);
  for(let i=0;i<10;i++){const a=-.6+i*.134;box(.06,.23,.035,gold,chip,a,.87,.06);box(.06,.23,.035,gold,chip,a,-.87,.06);box(.23,.06,.035,gold,chip,.87,a,.06);box(.23,.06,.035,gold,chip,-.87,a,.06);}
  const circuits=new THREE.Group();chip.add(circuits);
  for(let i=0;i<8;i++){const v=-.47+i*.133;box(.009,.94,.008,copper,circuits,v,0,.303);if(i%2===0)box(.94,.012,.009,gold,circuits,0,v,.305);}
  const dieTexture=document.createElement('canvas');dieTexture.width=256;dieTexture.height=256;const dc=dieTexture.getContext('2d');dc.fillStyle='#d8c398';dc.font='500 43px Oxanium';dc.textAlign='center';dc.fillText('NFC',128,139);
  const dieMark=new THREE.Mesh(new THREE.PlaneGeometry(.68,.68),basic(canvasTexture(dieTexture)));dieMark.position.z=.315;chip.add(dieMark);
  // Leads show the electrical relationship without suggesting exact production CAD.
  const leads=new THREE.Group();tag.add(leads);
  for(const sign of [-1,1]){const curve=new THREE.QuadraticBezierCurve3(new THREE.Vector3(sign*.85,0,0),new THREE.Vector3(sign*1.18,0,.22),new THREE.Vector3(sign*1.8,0,0));leads.add(new THREE.Mesh(new THREE.TubeGeometry(curve,24,.025,5,false),gold));}
  const slab=new THREE.Group();scene.add(slab);
  const outer=shape(8.0264,13.5382,.36),inner=shape(7.69,13.16,.28);
  outer.holes.push(new THREE.Path(inner.getPoints(48).reverse()));
  const shellMat=material(0xa9c1c4,.48,.2,.64),shell=new THREE.Mesh(new THREE.ExtrudeGeometry(outer,{depth:.6096,bevelEnabled:true,bevelThickness:.045,bevelSize:.045,bevelSegments:3,steps:1}),shellMat);shell.position.z=-.305;slab.add(shell);
  plate(7.63,13.08,.035,.28,material(0xc8e4df,.1,.17,.04),slab,0,0,-.3);
  const recess=shape(6.62,9.1,.12);recess.holes.push(new THREE.Path(shape(6.4,8.93,.09).getPoints(24).reverse()));const seat=new THREE.Mesh(new THREE.ShapeGeometry(recess),material(0x6c8281,.65,.27,.64));seat.position.set(0,-1.28,-.18);slab.add(seat);
  const cardTexture=texture(presentation),crop=manifest.sides.FRONT.presentation.cropUV;
  cardTexture.offset.set(crop[0],1-crop[3]);cardTexture.repeat.set(crop[2]-crop[0],crop[3]-crop[1]);
  const card=new THREE.Mesh(new THREE.PlaneGeometry(6.35,8.89),basic(cardTexture));card.position.set(0,-1.28,0);slab.add(card);
  const labelCanvas=document.createElement('canvas');labelCanvas.width=1360;labelCanvas.height=390;const lc=labelCanvas.getContext('2d');
  lc.fillStyle='#080a0a';lc.fillRect(0,0,1360,390);lc.strokeStyle='#cda955';lc.lineWidth=5;lc.strokeRect(3,3,1354,384);
  const logo=document.querySelector('.brand img');if(logo?.complete&&logo.naturalWidth)lc.drawImage(logo,34,42,238,238);
  lc.fillStyle='#f0eee6';lc.font='600 61px Oxanium';lc.fillText(manifest.report.displayName.toUpperCase(),325,94);
  lc.fillStyle='#c0c6bf';lc.font='31px Arial';lc.fillText('2025 DONRUSS OPTIC · DTBH-DME',325,151);
  lc.fillStyle='#cda955';lc.font='26px Arial';lc.fillText('ARCHIVED APPROVED SAMPLE',325,219);
  lc.fillStyle='#788980';lc.font='23px monospace';lc.fillText(manifest.report.reportNumber,325,278);
  lc.fillStyle='#f0eee6';lc.font='600 143px Oxanium';lc.fillText(String(manifest.report.finalGrade),1080,174);
  lc.fillStyle='#cda955';lc.font='23px Arial';lc.fillText('ATLAS GRADE',1080,216);
  const label=new THREE.Mesh(new THREE.PlaneGeometry(7.03,2.016),basic(canvasTexture(labelCanvas)));label.position.set(0,4.6,.02);slab.add(label);
  // Hardware corner fasteners and seams are illustrative, never evidence overlays.
  for(const x of [-3.65,3.65])for(const y of [-6.38,6.38]){const stud=new THREE.Mesh(new THREE.CylinderGeometry(.07,.07,.13,14),silver);stud.rotation.x=Math.PI/2;stud.position.set(x,y,.03);slab.add(stud);}
  const phone=new THREE.Group();scene.add(phone);
  const phoneFrame=material(0x8e9694,.88,.25);plate(5.68,11.8,.39,.68,phoneFrame,phone);
  plate(5.47,11.57,.09,.58,material(0x06090a,.18,.14),phone,0,0,.235);
  box(.045,1.08,.17,silver,phone,2.87,1.2,.03);box(.045,.55,.17,silver,phone,-2.87,2.5,.03);
  function roundedFill(ctx,x,y,w,h,r,color){ctx.fillStyle=color;ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill();}
  function screenCanvas(report=false,notification=false){
    const c=document.createElement('canvas');c.width=700;c.height=1470;const x=c.getContext('2d');
    x.fillStyle=report?'#fff':'#111a1c';x.fillRect(0,0,700,1470);
    if(!report){const g=x.createLinearGradient(0,0,700,1470);g.addColorStop(0,'#1b343a');g.addColorStop(.54,'#183029');g.addColorStop(1,'#070c0e');x.fillStyle=g;x.fillRect(0,0,700,1470);x.fillStyle='#e3ede6';x.textAlign='center';x.font='34px Arial';x.fillText('THURSDAY',350,211);x.font='170px Arial';x.fillText('9:41',350,380);x.textAlign='left';
      if(notification){roundedFill(x,29,485,642,164,28,'#dfe7df');if(logo?.complete)x.drawImage(logo,49,518,97,97);x.fillStyle='#13221c';x.font='bold 24px Arial';x.fillText('ATLAS GRADING',166,535);x.font='28px Arial';x.fillText('Open the saved report',166,584);x.fillStyle='#536258';x.font='22px Arial';x.fillText('NFC tag detected',166,623);}
    }else{
      x.fillStyle='#080a0a';x.fillRect(0,0,700,132);x.fillStyle='#cda955';x.font='600 34px Oxanium';x.fillText('ATLAS',32,96);x.fillStyle='#687069';x.font='21px Arial';x.fillText('ARCHIVED APPROVED SAMPLE',32,177);
      x.fillStyle='#111a15';x.font='600 48px Oxanium';x.fillText(manifest.report.displayName.toUpperCase(),32,238);x.font='21px Arial';x.fillStyle='#687069';x.fillText('2025 · Donruss Optic · DTBH-DME',32,274);
      const px=31,py=310,pw=368,ph=pw*original.height/original.width;x.drawImage(original,px,py,pw,ph);
      x.save();x.translate(px,py);x.scale(pw/original.width,ph/original.height);x.strokeStyle='#79ff3b';x.lineWidth=8;
      for(const quad of [manifest.sides.FRONT.geometry.physicalQuadSource,manifest.sides.FRONT.geometry.printedQuadSource]){x.beginPath();quad.forEach((p,i)=>i?x.lineTo(...p):x.moveTo(...p));x.closePath();x.stroke();}
      x.fillStyle='#ff1238';for(const f of manifest.findings.filter(f=>f.side==='FRONT'))x.fill(new Path2D(f.sourceSvgPath));x.restore();
      x.fillStyle='#1b2b1e';x.font='600 114px Oxanium';x.fillText(String(manifest.report.finalGrade),434,426);x.font='21px Arial';x.fillStyle='#747c73';x.fillText('ATLAS GRADE',432,465);
      [['CENTERING',manifest.report.subgrades.centering.toFixed(2)],['CORNERS',manifest.report.subgrades.corners],['EDGES',manifest.report.subgrades.edges],['SURFACE',manifest.report.subgrades.surface]].forEach(([name,value],i)=>{x.fillStyle='#747c73';x.font='20px Arial';x.fillText(name,435,526+i*72);x.fillStyle='#1a291c';x.font='600 31px Oxanium';x.fillText(String(value),435,563+i*72);});
      x.fillStyle='#1a291c';x.font='600 30px Oxanium';x.fillText('7 RECORDED FINDINGS',32,872);x.fillStyle='#69736b';x.font='23px Arial';x.fillText('3 front · 4 back',32,909);
      roundedFill(x,30,949,640,362,16,'#080a0a');x.fillStyle='#cda955';x.font='600 27px Oxanium';x.fillText('ATLAS FINGERPRINT',52,992);x.fillStyle='#9ba79d';x.font='21px Arial';x.fillText('The marks that make this card its own.',52,1029);
      const fpw=174,fph=fpw*1778/1270,fx=260,fy=1050;x.save();x.globalAlpha=.56;x.drawImage(original,40,40,1270,1778,fx,fy,fpw,fph);x.globalAlpha=1;x.drawImage(fingerprint,fx,fy,fpw,fph);x.restore();
      x.fillStyle='#788078';x.font='20px monospace';x.fillText(manifest.report.reportNumber,32,1370);
    }
    roundedFill(x,236,24,228,61,32,'#040607');roundedFill(x,231,1430,238,9,5,report?'#111a15':'#d9e2dc');return c;
  }
  const lockTexture=canvasTexture(screenCanvas()),noticeTexture=canvasTexture(screenCanvas(false,true)),reportTexture=canvasTexture(screenCanvas(true));
  const screenGeometry=new THREE.ShapeGeometry(shape(5.22,10.99,.48));
  const positions=screenGeometry.getAttribute('position'),uv=screenGeometry.getAttribute('uv');
  for(let i=0;i<uv.count;i++)uv.setXY(i,positions.getX(i)/5.22+.5,positions.getY(i)/10.99+.5);
  const screen=new THREE.Mesh(screenGeometry,basic(lockTexture));screen.position.z=.35;phone.add(screen);
  const signal=new THREE.Group();scene.add(signal);
  const signalMat=new THREE.MeshBasicMaterial({color:0xa5dadd,transparent:true,opacity:.7,depthWrite:false});signalMat.userData.baseOpacity=.7;
  for(let i=0;i<3;i++){const ring=new THREE.Mesh(new THREE.TorusGeometry(.47+i*.2,.009,4,56),signalMat);ring.position.z=i*.05;signal.add(ring);}
  // Every physical component owns opacity; shared metal must not couple phases.
  scene.traverse(object=>{if(object.isMesh)object.material=Array.isArray(object.material)?object.material.map(m=>m.clone()):object.material.clone();});
  function fade(group,amount){group.visible=amount>.001;group.traverse(object=>{if(object.isMesh){const materials=Array.isArray(object.material)?object.material:[object.material];for(const m of materials)m.opacity=(m.userData.baseOpacity??1)*amount;}});}
  function pose(p){
    const assemble=smooth(p),tap=smooth(p-1),report=smooth(p-2);
    tag.position.set(mix(0,-2.43,assemble)+tap*1.15-report*4.2,mix(.1,4.65,assemble),mix(.1,.22,assemble));
    tag.scale.setScalar(mix(1,.205,assemble));tag.rotation.set(mix(-.46,.06,assemble),mix(-.24,-.1,assemble),mix(-.24,-.025,assemble));
    chip.position.z=mix(1.5,.08,assemble);backing.position.z=mix(-.62,-.22,assemble);leads.scale.z=mix(3,1,assemble);
    antenna.position.z=mix(-.1,0,assemble);fade(tag,1-smooth((p-.84)/.18)); // resolve into the opaque printed logo
    const slabAlpha=smooth((p-.25)/.72)*(1-report);fade(slab,slabAlpha);
    slab.position.set(tap*1.15-report*4.2,-.1,0);slab.rotation.set(mix(.1,.015,report),mix(-.12,.08,tap),mix(-.045,.045,tap));
    phone.position.set(mix(8.6,-1.1,tap)+report*1.1,mix(-2.7,-1.05,tap)+report*1.1,mix(1,3,tap)-report*.3);
    phone.rotation.set(mix(.08,.025,report),mix(-.35,-.03,report),mix(-.28,.018,report));fade(phone,smooth((p-1.04)/.63));
    const next=p>=2.32?reportTexture:p>=1.82?noticeTexture:lockTexture;if(screen.material.map!==next){screen.material.map=next;screen.material.needsUpdate=true;}
    signal.position.set(-1.18,4.5,1.2);signal.rotation.set(.08,0,0);fade(signal,smooth((p-1.6)/.25)*(1-smooth((p-2.1)/.25)));
    const distance=mix(17.9,Math.max(26,15.9/camera.aspect),assemble)+3*tap*(1-report);camera.position.set(0,mix(.15,.3,assemble),distance);camera.lookAt(0,.15,0);
    renderer.render(scene,camera);
  }
  function resize(){const w=host.clientWidth,h=host.clientHeight;if(!w||!h)return;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();pose(current);}
  renderer.domElement.setAttribute('aria-hidden','true');host.append(renderer.domElement);host.classList.add('has-webgl');
  const observer=new ResizeObserver(resize);observer.observe(host);resize();
  renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();running=false;cancel();host.classList.remove('has-webgl');labelReplay();});
  resources.push(()=>{observer.disconnect();scene.traverse(o=>{if(o.isMesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material]){m.map?.dispose();m.dispose();}}});renderer.dispose();});
  return {pose};
}
if(chapter){
  chapter.querySelectorAll('[data-tap-step]').forEach(button=>button.addEventListener('click',()=>choose(Number(button.dataset.tapStep))));
  replay.addEventListener('click',async()=>{await init();if(!sceneApi)return;if(running){running=false;target=current;labelReplay();return;}played=true;if(off()){target=current=3;draw();return;}elapsed=0;current=target=0;running=true;start=performance.now();previous=0;labelReplay();request();});
  const visibility=new IntersectionObserver(async entries=>{active=entries.some(entry=>entry.isIntersecting);if(active){await init();if(!played&&sceneApi){played=true;if(off()){current=target=3;draw();}else {running=true;start=performance.now();elapsed=0;labelReplay();}}}pausePolicy();},{threshold:.18});visibility.observe(chapter.querySelector('.at-tap-visual'));
  const near=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){near.disconnect();init();}},{rootMargin:'350px'});near.observe(chapter);
  document.addEventListener('atlas-motion-change',pausePolicy);document.addEventListener('visibilitychange',pausePolicy);reduced.addEventListener('change',pausePolicy);
  window.addEventListener('pagehide',()=>{cancel();near.disconnect();visibility.disconnect();resources.forEach(dispose=>dispose());urls.forEach(URL.revokeObjectURL);},{once:true});
}
