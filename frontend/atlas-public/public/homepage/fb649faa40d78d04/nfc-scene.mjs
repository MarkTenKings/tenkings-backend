import {loadHeroEvidence,fetchVerifiedAsset} from './hero-evidence.mjs';

// Shared explanatory hardware. Card/report texture bytes stay source-bound.
const clamp=value=>Math.max(0,Math.min(1,value));
const smooth=value=>{const t=clamp(value);return t*t*(3-2*t);};
const mix=(a,b,t)=>a+(b-a)*t;

export async function createNfcScene({chapter,getPose=()=>0,onContextLost=()=>{},signal:abortSignal}) {
  const urls=[],textures=new Set();
  let disposed=false;
  const revokeUrls=()=>{urls.splice(0).forEach(URL.revokeObjectURL);};
  abortSignal?.addEventListener("abort",revokeUrls,{once:true});
  async function verifiedImage(asset){const blob=await fetchVerifiedAsset(asset,{signal:abortSignal}),url=URL.createObjectURL(blob);urls.push(url);const image=new Image();image.src=url;await image.decode();return image;}
  const manifest=await loadHeroEvidence(undefined,{signal:abortSignal});
  const host=chapter.querySelector('.at-tap-stage');
  const presentation=await verifiedImage(manifest.sides.FRONT.presentation);
  const fallback=chapter.querySelector('.at-tap-fallback img');fallback.src=presentation.src;fallback.hidden=false;chapter.querySelector('.at-tap-fallback-label b').textContent=String(manifest.report.finalGrade);
  const [reportCapture, THREE]=await Promise.all([verifiedImage({"src":new URL("./assets/nfc/report-screen.jpg",import.meta.url).href,"contentType":"image/jpeg","sha256":"beb4e593eab91a9578979623b7b1edee72fb1ef652a77dc6bb1524409a18b815","bytes":60540,"width":390,"height":844}),import('./assets/vendor/three.module.js')]);
  await document.fonts.load('600 40px Oxanium');
  const renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power',preserveDrawingBuffer:false});
  renderer.transmissionResolutionScale=.5;
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.96;
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(33,1,.1,120);
  // A small prefiltered studio, built once. Broad reflections describe the surfaces;
  // the evidence itself remains an unlit source texture.
  const studio=new THREE.Scene();studio.background=new THREE.Color(0x161b1d);
  function softbox(w,h,color,intensity,x,y,z){const light=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide}));light.material.color.multiplyScalar(intensity);light.position.set(x,y,z);light.lookAt(0,0,0);studio.add(light);}
  softbox(5,16,0xffffff,2.6,-7,4,7);softbox(2,12,0xcfe4e5,1.8,8,1,4);softbox(10,3,0xffead0,1.8,0,10,-2);softbox(7,9,0xffffff,.65,1,-3,-8);
  const pmrem=new THREE.PMREMGenerator(renderer),environment=pmrem.fromScene(studio,.035,.1,80);scene.environment=environment.texture;pmrem.dispose();
  studio.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
  scene.add(new THREE.HemisphereLight(0xeaf1f0,0x152027,.85));
  const key=new THREE.DirectionalLight(0xfff1db,2.1);key.position.set(-5,7,10);scene.add(key);
  const rim=new THREE.DirectionalLight(0xe6f5ff,1.4);rim.position.set(6,1,6);scene.add(rim);
  function material(color,metalness=.5,roughness=.28,opacity=1) {const m=new THREE.MeshStandardMaterial({color,metalness,roughness,transparent:true,opacity,envMapIntensity:.95});m.userData.baseOpacity=opacity;return m;}
  function polymer(opacity=1,roughness=.09){const m=new THREE.MeshPhysicalMaterial({color:0xe9f2f3,metalness:0,roughness,transmission:.94,thickness:.22,ior:1.49,clearcoat:1,clearcoatRoughness:.045,envMapIntensity:.95,transparent:true,opacity,depthWrite:false});m.userData.baseOpacity=opacity;return m;}
  function shape(w,h,r) {const s=new THREE.Shape(),x=-w/2,y=-h/2;s.moveTo(x+r,y);s.lineTo(x+w-r,y);s.quadraticCurveTo(x+w,y,x+w,y+r);s.lineTo(x+w,y+h-r);s.quadraticCurveTo(x+w,y+h,x+w-r,y+h);s.lineTo(x+r,y+h);s.quadraticCurveTo(x,y+h,x,y+h-r);s.lineTo(x,y+r);s.quadraticCurveTo(x,y,x+r,y);return s;}
  function plate(w,h,d,r,mat,parent,x=0,y=0,z=0) {const g=new THREE.ExtrudeGeometry(shape(w,h,r),{depth:d,bevelEnabled:true,bevelThickness:.025,bevelSize:.025,bevelSegments:2,steps:1,curveSegments:10});g.translate(0,0,-d/2);const m=new THREE.Mesh(g,mat);m.position.set(x,y,z);parent.add(m);return m;}
  function box(w,h,d,mat,parent,x=0,y=0,z=0){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);parent.add(m);return m;}
  function basic(map,opacity=1){const m=new THREE.MeshBasicMaterial({map,transparent:true,opacity,toneMapped:false});m.userData.baseOpacity=opacity;return m;}
  function texture(image){const t=new THREE.Texture(image);t.colorSpace=THREE.SRGBColorSpace;textures.add(t);t.needsUpdate=true;t.anisotropy=Math.min(renderer.capabilities.getMaxAnisotropy(),4);return t;}
  function canvasTexture(canvas){const t=new THREE.CanvasTexture(canvas);textures.add(t);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t;}
  function ring(w,h,r,inset,depth,mat,parent,x=0,y=0,z=0){const outline=shape(w,h,r);outline.holes.push(new THREE.Path(shape(w-inset*2,h-inset*2,Math.max(.02,r-inset)).getPoints(48).reverse()));const geo=new THREE.ExtrudeGeometry(outline,{depth,bevelEnabled:true,bevelThickness:Math.min(depth/3,.018),bevelSize:Math.min(inset/3,.022),bevelSegments:3,steps:1,curveSegments:16});geo.translate(0,0,-depth/2);const mesh=new THREE.Mesh(geo,mat);mesh.position.set(x,y,z);parent.add(mesh);return mesh;}
  const gold=material(0xc8a35c,.94,.24),copper=material(0xb8884c,.94,.28),dark=material(0x161c20,.35,.28),silver=material(0xc4cecf,.93,.24);
  const tag=new THREE.Group();scene.add(tag);
  // Transparent polymer support and shallow etched conductor, never a green PCB.
  const backing=plate(6.7,4.65,.035,.29,polymer(.11,.12),tag,0,0,-.22);
  const carrierEdge=ring(6.7,4.65,.29,.018,.025,material(0xc7d7d7,.2,.24,.25),backing);
  const antenna=new THREE.Group();tag.add(antenna);
  for(let i=0;i<7;i++)ring(6.35-i*.28,4.3-i*.28,.42,.047,.025,i<2?gold:copper,antenna,0,0,0);
  const chip=new THREE.Group();tag.add(chip);
  plate(1.48,1.48,.075,.07,material(0xbfc6c4,.92,.28),chip);
  plate(1.36,1.36,.11,.055,dark,chip,0,0,.095);
  const die=plate(.92,.92,.045,.018,material(0x161d25,.3,.28),chip,0,0,.178);
  // A few visible bond wires and contact pads communicate depth without fake schematics.
  for(let i=0;i<6;i++){const a=-.48+i*.192;for(const side of [-1,1]){box(.09,.2,.021,gold,chip,a,side*.73,.065);box(.2,.09,.021,gold,chip,side*.73,a,.065);const curve=new THREE.QuadraticBezierCurve3(new THREE.Vector3(a,side*.65,.13),new THREE.Vector3(a*.82,side*.55,.35),new THREE.Vector3(a*.8,side*.4,.21));chip.add(new THREE.Mesh(new THREE.TubeGeometry(curve,16,.007,5,false),gold));}}
  const dieTexture=document.createElement('canvas');dieTexture.width=256;dieTexture.height=256;const dc=dieTexture.getContext('2d');dc.strokeStyle='#777e80';dc.lineWidth=1;dc.strokeRect(17,17,222,222);dc.fillStyle='#c4c8c5';dc.font='500 32px Oxanium';dc.textAlign='center';dc.fillText('NFC',128,137);
  const dieMark=new THREE.Mesh(new THREE.PlaneGeometry(.76,.76),basic(canvasTexture(dieTexture)));dieMark.position.z=.24;chip.add(dieMark);
  const leads=new THREE.Group();tag.add(leads);
  for(const sign of [-1,1]){const curve=new THREE.QuadraticBezierCurve3(new THREE.Vector3(sign*.72,0,1.37),new THREE.Vector3(sign*1.22,0,1.05),new THREE.Vector3(sign*2.05,0,0));leads.add(new THREE.Mesh(new THREE.TubeGeometry(curve,32,.014,6,false),gold));}
  const slab=new THREE.Group();scene.add(slab);
  // Verified exterior proportions; internal cavity, label bay and weld seam are illustrative.
  const shellBack=new THREE.Group(),shellFront=new THREE.Group();slab.add(shellBack,shellFront);
  ring(8.0264-.044,13.5382-.044,.36,.205,.2236,polymer(.48),shellBack,0,0,-.175);
  ring(8.0264-.044,13.5382-.044,.36,.205,.2236,polymer(.48),shellFront,0,0,.175);
  ring(7.972,13.484,.34,.031,.035,material(0xbdd0d3,.25,.14,.29),slab,0,0,0);
  // Fine bevel highlights and a recessed clear seam reveal the assembled thickness.
  ring(7.918,13.43,.315,.018,.018,material(0xe6f2f2,.05,.16,.37),shellFront,0,0,.2898);
  ring(7.775,13.27,.28,.022,.02,material(0xa2b5b8,.08,.23,.27),shellBack,0,0,-.285);
  plate(7.61,13.08,.032,.27,polymer(.055,.15),shellBack,0,0,-.262);
  ring(6.66,9.2,.15,.11,.14,polymer(.43,.17),slab,0,-1.28,-.105);
  ring(7.27,2.25,.14,.085,.09,polymer(.4,.2),slab,0,4.6,-.09);
  box(7.45,.055,.17,polymer(.35,.18),slab,0,3.19,-.06);
  const cardTexture=texture(presentation),crop=manifest.sides.FRONT.presentation.cropUV;
  cardTexture.offset.set(crop[0],1-crop[3]);cardTexture.repeat.set(crop[2]-crop[0],crop[3]-crop[1]);
  const card=new THREE.Mesh(new THREE.PlaneGeometry(6.35,8.89),basic(cardTexture));card.position.set(0,-1.28,0);slab.add(card);
  const labelCanvas=document.createElement('canvas');labelCanvas.width=1360;labelCanvas.height=390;const lc=labelCanvas.getContext('2d');
  lc.fillStyle='#080a0a';lc.fillRect(0,0,1360,390);lc.strokeStyle='#cda955';lc.lineWidth=5;lc.strokeRect(3,3,1354,384);
  const logo=document.querySelector('.brand img');if(logo?.complete&&logo.naturalWidth)lc.drawImage(logo,34,42,238,238);
  lc.fillStyle='#f0eee6';lc.font='600 61px Oxanium';lc.fillText(manifest.report.displayName.toUpperCase(),325,94);
  lc.fillStyle='#c0c6bf';lc.font='31px Arial';lc.fillText(`${manifest.report.identity.year} DONRUSS OPTIC · ${manifest.report.identity.cardNumber}`,325,151);
  lc.fillStyle='#cda955';lc.font='26px Arial';lc.fillText('ARCHIVED APPROVED SAMPLE',325,219);
  lc.fillStyle='#788980';lc.font='23px monospace';lc.fillText(manifest.report.reportNumber,325,278);
  lc.fillStyle='#f0eee6';lc.font='600 143px Oxanium';lc.fillText(String(manifest.report.finalGrade),1080,174);
  lc.fillStyle='#cda955';lc.font='23px Arial';lc.fillText('ATLAS GRADE',1080,216);
  const label=new THREE.Mesh(new THREE.PlaneGeometry(7.03,2.016),basic(canvasTexture(labelCanvas)));label.position.set(0,4.6,.02);slab.add(label);
  const physicalEnvelope=new THREE.Box3().setFromObject(slab).getSize(new THREE.Vector3()).multiplyScalar(10);

  const phone=new THREE.Group();scene.add(phone);
  const phoneFrame=material(0x8e9694,.88,.25);plate(5.68,11.8,.39,.68,phoneFrame,phone);ring(5.65,11.77,.67,.026,.026,material(0xd9e0df,.92,.19),phone,0,0,.175);
  plate(5.47,11.57,.09,.58,material(0x06090a,.18,.14),phone,0,0,.235);
  box(.045,1.08,.17,silver,phone,2.87,1.2,.03);box(.045,.55,.17,silver,phone,-2.87,2.5,.03);
  function roundedFill(ctx,x,y,w,h,r,color){ctx.fillStyle=color;ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill();}
  function screenCanvas(report=false,notification=false){
    const c=document.createElement('canvas');c.width=700;c.height=1470;const x=c.getContext('2d');
    x.fillStyle=report?'#fff':'#111a1c';x.fillRect(0,0,700,1470);
    if(!report){const g=x.createLinearGradient(0,0,700,1470);g.addColorStop(0,'#1b343a');g.addColorStop(.54,'#183029');g.addColorStop(1,'#070c0e');x.fillStyle=g;x.fillRect(0,0,700,1470);x.fillStyle='#e3ede6';x.textAlign='center';x.font='34px Arial';x.fillText('THURSDAY',350,211);x.font='170px Arial';x.fillText('9:41',350,380);x.textAlign='left';
      if(notification){roundedFill(x,29,485,642,164,28,'#dfe7df');if(logo?.complete)x.drawImage(logo,49,518,97,97);x.fillStyle='#13221c';x.font='bold 24px Arial';x.fillText('ATLAS GRADING',166,535);x.font='28px Arial';x.fillText('Open the saved report',166,584);x.fillStyle='#536258';x.font='22px Arial';x.fillText('NFC tag detected',166,623);}
    }else{
      // Browser capture of the actual approved-report component, not recreated UI.
      // Uniform scaling and viewport clipping only; no source evidence is repainted.
      x.fillStyle='#fff';x.fillRect(0,0,700,1470);
      x.drawImage(reportCapture,0,70,700,700*reportCapture.height/reportCapture.width);
      x.fillStyle='#171e1b';x.font='22px Arial';x.fillText('9:41',35,46);
      x.fillStyle='#64716b';x.font='16px Arial';x.textAlign='right';x.fillText('ATLAS',666,46);x.textAlign='left';
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
  const originalMaterials=new Set();
  scene.traverse(object=>{if(object.isMesh){const copy=m=>{originalMaterials.add(m);return m.clone();};object.material=Array.isArray(object.material)?object.material.map(copy):copy(object.material);}});
  originalMaterials.forEach(material=>material.dispose());
  function fade(group,amount){group.visible=amount>.001;group.traverse(object=>{if(object.isMesh){const materials=Array.isArray(object.material)?object.material:[object.material];for(const m of materials)m.opacity=(m.userData.baseOpacity??1)*amount;}});}
  const labelAnchor=new THREE.Vector3((153/1360-.5)*7.03,4.6+(.5-161/390)*2.016,.06);
  const dockPoint=new THREE.Vector3(),phoneTop=new THREE.Vector3();
  const settledTapAnchor=labelAnchor.clone().applyEuler(new THREE.Euler(.085,.08,.035)).add(new THREE.Vector3(1.12,-.1,0));
  function pose(p){
    const assemble=smooth(p),tap=smooth(p-1),report=smooth(p-2);
    // One continuous camera: inspect the assembly, settle at the label, follow the
    // phone into its screen. The chip never changes identity at the phase boundaries.
    slab.position.set(tap*1.12-report*4.2,-.1,0);slab.rotation.set(mix(.085,.015,report),mix(-.3,.08,tap),mix(-.025,.035,tap));
    dockPoint.copy(labelAnchor).applyEuler(slab.rotation).add(slab.position);
    tag.position.set(mix(0,dockPoint.x,assemble),mix(-.1,dockPoint.y,assemble),mix(.1,dockPoint.z,assemble));
    tag.scale.setScalar(mix(1.12,.205,assemble));tag.rotation.set(mix(-.5,.085,assemble),mix(-.22,-.3,assemble),mix(-.2,-.025,assemble));
    chip.position.z=mix(1.25,.055,assemble);backing.position.z=mix(-.32,-.16,assemble);leads.scale.z=mix(1,.12,assemble);
    antenna.position.z=mix(.04,0,assemble);fade(tag,1-smooth((p-.86)/.14));
    const slabAlpha=smooth((p-.29)/.59)*(1-report);fade(slab,slabAlpha);
    const shellSpread=.45*(1-smooth((p-.55)/.4));shellFront.position.z=shellSpread;shellBack.position.z=-shellSpread;
    phone.rotation.set(mix(.065,0,report),mix(-.3,-.025,report),mix(-.24,0,report));
    // Phone top approaches the same label anchor, then becomes the camera subject.
    const phoneAnchor=p>2?settledTapAnchor:dockPoint;
    phoneTop.set(0,5.35,-.195).applyEuler(phone.rotation);
    phone.position.set(mix(mix(8.6,phoneAnchor.x-phoneTop.x+.18,tap),0,report),mix(mix(-2.7,phoneAnchor.y-phoneTop.y,tap),.05,report),mix(mix(1,phoneAnchor.z-phoneTop.z+.65,tap),3.3,report));fade(phone,smooth((p-1.04)/.63));
    const next=p>=2.32?reportTexture:p>=1.82?noticeTexture:lockTexture;if(screen.material.map!==next){screen.material.map=next;screen.material.needsUpdate=true;}
    signal.position.copy(dockPoint);signal.position.z+=.37;signal.rotation.set(.08,0,0);fade(signal,smooth((p-1.6)/.25)*(1-smooth((p-2.1)/.25)));
    const tagDistance=Math.max(16.7,13.8/camera.aspect),slabDistance=Math.max(26.6,15.9/camera.aspect);
    const distance=mix(tagDistance,slabDistance,smooth(p/.48))+2.4*tap*(1-report)-1.3*report;
    camera.position.set(0,mix(.15,.25,assemble),distance);camera.lookAt(0,mix(.15,.25,assemble),0);
    renderer.render(scene,camera);
  }
  function resize(){const w=host.clientWidth,h=host.clientHeight;if(!w||!h)return;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();pose(getPose());}
  renderer.domElement.setAttribute('aria-hidden','true');host.append(renderer.domElement);host.classList.add('has-webgl');
  const observer=new ResizeObserver(resize);observer.observe(host);resize();
  renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();host.classList.remove('has-webgl');onContextLost();});
  function dispose(){
    if(disposed)return;disposed=true;observer.disconnect();
    const geometries=new Set(),materials=new Set();scene.traverse(o=>{if(o.isMesh){geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);}});
    geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());
    environment.dispose();renderer.dispose();renderer.domElement.remove();abortSignal?.removeEventListener("abort",revokeUrls);revokeUrls();
  }
  function statistics(){return {drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,programs:renderer.info.programs.length,pmrem:[environment.width,environment.height],pixelRatio:renderer.getPixelRatio(),transmissionResolutionScale:renderer.transmissionResolutionScale,assembledEnvelopeMm:physicalEnvelope.toArray()};}
  return {pose,dispose,statistics};
}
