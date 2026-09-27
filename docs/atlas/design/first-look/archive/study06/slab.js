import * as THREE from '/assets/vendor/three.module.js';
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
  await Promise.all([plane('/assets/alakazam-reference.jpg',6.35,8.89,-1.53),plane('/assets/alakazam-label-sample.svg',6.93,2.107,4.66)]);
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

// The separate product showcase starts near the viewport and sleeps when settled.
// This is presentation geometry, not production slab CAD or optical evidence.
const productHost=document.getElementById('product-stage');
const productSection=document.querySelector('.product-showcase');
let productStarted=false;
const productLoader=new IntersectionObserver(entries=>{
  if(!entries[0].isIntersecting||productStarted)return;
  productStarted=true;productLoader.disconnect();
  createProductShowcase().catch(error=>{productHost.classList.remove('has-canvas');console.warn('Product concept uses its static fallback:',error.message);});
},{rootMargin:'450px'});
productLoader.observe(productHost);
async function createProductShowcase(){
  const renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power',preserveDrawingBuffer:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.3;
  const scene=new THREE.Scene();
  const camera=new THREE.PerspectiveCamera(31,1,.1,90);
  const model=new THREE.Group();scene.add(model);
  const resources=[];
  function shape(w,h,r){
    const s=new THREE.Shape(),x=-w/2,y=-h/2;
    s.moveTo(x+r,y);s.lineTo(x+w-r,y);s.quadraticCurveTo(x+w,y,x+w,y+r);
    s.lineTo(x+w,y+h-r);s.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
    s.lineTo(x+r,y+h);s.quadraticCurveTo(x,y+h,x,y+h-r);
    s.lineTo(x,y+r);s.quadraticCurveTo(x,y,x+r,y);return s;
  }
  function mesh(geometry,material,z=0){
    resources.push(geometry,material);
    const item=new THREE.Mesh(geometry,material);item.position.z=z;model.add(item);return item;
  }
  const ring=shape(8.1,13.85,.38);
  ring.holes.push(new THREE.Path(shape(7.56,13.25,.26).getPoints(48).reverse()));
  mesh(new THREE.ExtrudeGeometry(ring,{depth:.4,bevelEnabled:true,bevelThickness:.08,bevelSize:.09,bevelSegments:4,steps:1}),new THREE.MeshPhysicalMaterial({color:0xc6d4d8,metalness:.38,roughness:.19,transparent:true,opacity:.34,clearcoat:1}),-.15);
  mesh(new THREE.ShapeGeometry(shape(7.5,13.2,.25)),new THREE.MeshPhongMaterial({color:0x788c96,transparent:true,opacity:.11,shininess:110,depthWrite:false}),-.2);
  const separator=mesh(new THREE.BoxGeometry(7.5,.075,.3),new THREE.MeshStandardMaterial({color:0xb9c5c5,metalness:.65,roughness:.23}),.07);separator.position.y=3.19;
  const loader=new THREE.TextureLoader();
  const textures=await Promise.all([loader.loadAsync('/assets/alakazam-reference.jpg'),loader.loadAsync('/assets/alakazam-label-sample.svg')]);
  textures.forEach(map=>{map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());resources.push(map);});
  const card=mesh(new THREE.PlaneGeometry(6.35,8.89),new THREE.MeshBasicMaterial({map:textures[0],toneMapped:false}),.1);card.position.y=-1.53;
  const label=mesh(new THREE.PlaneGeometry(6.93,2.107),new THREE.MeshBasicMaterial({map:textures[1],toneMapped:false}),.1);label.position.y=4.66;
  scene.add(new THREE.AmbientLight(0xffffff,1.6));
  const gold=new THREE.PointLight(0xffd994,110,65);gold.position.set(-7,8,9);scene.add(gold);
  const silver=new THREE.PointLight(0xd4ecff,140,65);silver.position.set(9,3,7);scene.add(silver);
  const key=new THREE.DirectionalLight(0xffffff,3.5);key.position.set(1,10,5);scene.add(key);
  let frame=null,visible=false,lost=false,current=null,previousTime=0,mouseX=0,mouseY=0;
  let position=Number(productSection.style.getPropertyValue('--product-focus'))||0;
  const motionOff=()=>reduced.matches||document.documentElement.classList.contains('motion-off');
  function pose(){
    const aperture=2*Math.tan(THREE.MathUtils.degToRad(31/2));
    const aspect=productHost.clientWidth/Math.max(1,productHost.clientHeight);
    const fullDistance=Math.max(29,9/(aperture*aspect*.92));
    const labelDistance=Math.max(14,7.7/(aperture*aspect*.95));
    const cardDistance=Math.max(22,7.2/(aperture*aspect*.9));
    const views=[{z:fullDistance,y:0,rx:.07,ry:-.20,rz:.055},{z:labelDistance,y:4.55,rx:0,ry:-.03,rz:0},{z:cardDistance,y:-1.5,rx:0,ry:.06,rz:-.025}];
    const first=Math.min(1,Math.floor(position)),blend=Math.min(1,position-first),result={};
    for(const k of Object.keys(views[0]))result[k]=views[first][k]+(views[first+1][k]-views[first][k])*blend;
    if(!motionOff()){result.ry+=mouseX*.16;result.rx-=mouseY*.08;}
    return result;
  }
  function paint(now){
    frame=null;
    if(!visible||document.hidden||lost)return;
    const target=pose();
    if(!current||motionOff())current={...target};
    const blend=1-Math.exp(-Math.min(50,now-previousTime||16)/115);previousTime=now;
    let moving=false;
    for(const key of Object.keys(target)){
      const delta=target[key]-current[key];
      if(Math.abs(delta)>.0005){current[key]+=delta*blend;moving=true;}else current[key]=target[key];
    }
    camera.position.set(0,current.y,current.z);camera.lookAt(0,current.y,0);
    model.rotation.set(current.rx,current.ry,current.rz);
    gold.position.x=-7+position*2;silver.position.y=3+position*2;
    renderer.render(scene,camera);
    if(moving&&!motionOff())frame=requestAnimationFrame(paint);
  }
  function queue(){if(frame===null&&visible&&!document.hidden&&!lost)frame=requestAnimationFrame(paint);}
  function resize(){
    const w=productHost.clientWidth,h=productHost.clientHeight;if(!w||!h)return;
    renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();queue();
  }
  renderer.domElement.setAttribute('aria-hidden','true');productHost.append(renderer.domElement);
  productHost.classList.add('has-canvas');resize();
  const resizeObserver=new ResizeObserver(resize);resizeObserver.observe(productHost);
  new IntersectionObserver(entries=>{
    visible=entries[0].isIntersecting;
    if(!visible&&frame!==null){cancelAnimationFrame(frame);frame=null;}
    queue();
  },{threshold:0}).observe(productHost);
  productSection.addEventListener('atlas-product-camera',event=>{position=event.detail.position;queue();});
  document.addEventListener('atlas-motion-change',()=>{mouseX=0;mouseY=0;queue();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&frame!==null){cancelAnimationFrame(frame);frame=null;}else queue();});
  productHost.addEventListener('pointermove',event=>{
    if(event.pointerType!=='mouse'||motionOff())return;
    const r=productHost.getBoundingClientRect();mouseX=(event.clientX-r.left)/r.width-.5;mouseY=(event.clientY-r.top)/r.height-.5;queue();
  },{passive:true});
  productHost.addEventListener('pointerleave',()=>{mouseX=0;mouseY=0;queue();});
  renderer.domElement.addEventListener('webglcontextlost',()=>{
    lost=true;if(frame!==null)cancelAnimationFrame(frame);frame=null;
    resizeObserver.disconnect();productHost.classList.remove('has-canvas');
    resources.forEach(resource=>resource.dispose());renderer.dispose();
  });
}
