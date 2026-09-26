const root=document.documentElement;
const preference=matchMedia('(prefers-reduced-motion: reduce)');
const stage=document.querySelector('.specimen-stage');
const service=document.querySelector('.service-choice');
const motionButton=document.getElementById('motion');
const serviceMotion=document.querySelector('.service-motion-toggle');
const crop=document.querySelector('.evidence-crop');
const zoom=document.querySelector('.zoom-control');
const bitmap=document.querySelector('.evidence-bitmap');
const reference=bitmap.querySelector('img');
// Presentation fixtures only. These are not measurements or an ATLAS grading policy.
const inspectionSamples={
  centering:{x:.5,y:.5,scale:1.12,label:'EXAMPLE LEFT / RIGHT BALANCE',value:'53 : 47',unit:'',deduction:1,score:9,shape:'M18 15 L982 15 L982 985 L18 985 Z',rule:'M18 155 L82 155 M18 145 L18 165 M82 145 L82 165 M918 155 L982 155 M918 145 L918 165 M982 145 L982 165',map:[1,1,98,98]},
  corners:{x:.93,y:.07,scale:4.2,label:'EXAMPLE AFFECTED AREA',value:'0.12',unit:'mm²',deduction:1,score:9,shape:'M945 20 L978 20 L988 37 L984 65 L968 54 Z',rule:'M939 82 L988 82 M939 73 L939 91 M988 73 L988 91',map:[82,0,18,13]},
  edges:{x:.065,y:.755,scale:3.7,label:'EXAMPLE AFFECTED LENGTH',value:'0.38',unit:'mm',deduction:1.5,score:8.5,shape:'M18 715 L40 715 L40 795 L18 795 Z',rule:'M58 715 L58 795 M48 715 L68 715 M48 795 L68 795',map:[0,65,12,25]},
  surface:{x:.5,y:.39,scale:3.4,label:'EXAMPLE AFFECTED AREA',value:'0.24',unit:'mm²',deduction:.5,score:9.5,shape:'M443 365 L533 352 L549 400 L468 418 Z',rule:'M443 441 L549 441 M443 431 L443 451 M549 431 L549 451',map:[30,25,40,30]}
};
let reportMagnified=false,activeInspection='edges',inspectionTimers=[];
const inspector=document.querySelector('.inspection-explanation');
const inspectionMap=document.querySelector('.inspection-map');
const readout=document.querySelector('.inspection-readout');
function renderReportCamera(){
  const sample=inspectionSamples[activeInspection];
  const scale=reportMagnified?sample.scale:1;
  const width=bitmap.offsetWidth,height=bitmap.offsetHeight;
  const x=reportMagnified?(.5-sample.x)*width*scale:0;
  const y=reportMagnified?(.5-sample.y)*height*scale:0;
  bitmap.style.transform=`translate(${x}px,${y}px) scale(${scale})`;
  bitmap.style.setProperty('--inspection-scale',scale);
  crop.querySelector('.camera-readout').textContent=reportMagnified?`${scale.toFixed(1)}× DIGITAL ZOOM`:'FULL CARD';
}
function cancelInspectionTimers(){inspectionTimers.forEach(clearTimeout);inspectionTimers=[];}
function setInspectionStep(step){
  inspector.dataset.step=step;crop.dataset.step=step;
  const measured=step==='measure'||step==='deduction';
  inspector.querySelector('.inspection-measure').setAttribute('aria-hidden',String(!measured));
  inspector.querySelector('.inspection-deduction').setAttribute('aria-hidden',String(step!=='deduction'));
  inspector.querySelector('.inspection-equation').setAttribute('aria-hidden',String(step!=='deduction'));
  if(step==='deduction'){
    const item=inspectionSamples[activeInspection];
    inspector.querySelector('.inspection-announcement').textContent=`Illustrative ${activeInspection} example. ${item.label.replace('EXAMPLE ','').toLowerCase()}: ${item.value} ${item.unit}. Example category deduction: ${item.deduction.toFixed(1)} points. Category score: ${item.score.toFixed(1)}. Not measured from this photograph.`;
  }
}
function beginInspection(name){
  cancelInspectionTimers();activeInspection=name;
  const item=inspectionSamples[name];
  inspector.querySelector('.inspection-invitation').hidden=true;
  inspector.querySelector('.inspection-facts').hidden=false;
  inspector.querySelector('.inspection-metric-label').textContent=item.label;
  const metric=inspector.querySelector('.inspection-metric');
  metric.replaceChildren(document.createTextNode(item.value+' '));
  const unit=document.createElement('small');unit.textContent=item.unit;metric.append(unit);
  inspector.querySelector('.deduction-value').textContent=`−${item.deduction.toFixed(1)}`;
  const equation=inspector.querySelector('.inspection-equation b');
  equation.replaceChildren(document.createTextNode('10.0 '));
  const minus=document.createElement('i');minus.textContent=`− ${item.deduction.toFixed(1)}`;
  const score=document.createElement('em');score.textContent=item.score.toFixed(1);
  equation.append(minus,document.createTextNode(' = '),score);
  bitmap.querySelector('.measure-shape').setAttribute('d',item.shape);
  bitmap.querySelector('.measure-rule').setAttribute('d',item.rule);
  readout.querySelector('strong').textContent=`${item.value} ${item.unit}`;
  readout.querySelector('span').textContent=name==='centering'?'EXAMPLE BORDER BALANCE':'EXAMPLE MEASUREMENT';
  const marker=inspectionMap.querySelector('span');
  marker.style.left=item.map[0]+'%';marker.style.top=item.map[1]+'%';marker.style.width=item.map[2]+'%';marker.style.height=item.map[3]+'%';
  inspector.querySelector('.inspection-announcement').textContent='';
  setReportZoom(true);setInspectionStep('detail');
  if(preference.matches||manuallyPaused||document.hidden){setInspectionStep('deduction');return;}
  inspectionTimers.push(setTimeout(()=>setInspectionStep('measure'),850),setTimeout(()=>setInspectionStep('deduction'),1450));
}
function setReportZoom(enlarged){
  reportMagnified=enlarged;crop.classList.toggle('zoomed',enlarged);
  zoom.setAttribute('aria-pressed',String(enlarged));zoom.textContent=enlarged?'− Full card':'＋ Enlarge region';
  inspectionMap.hidden=!enlarged;renderReportCamera();
}

function fitEvidence(){
  const ratio=(reference.naturalWidth||610)/(reference.naturalHeight||845);
  const width=Math.min(crop.clientWidth*.9,crop.clientHeight*.9*ratio);
  bitmap.style.width=width+'px';bitmap.style.height=(width/ratio)+'px';renderReportCamera();
}
new ResizeObserver(fitEvidence).observe(crop);reference.addEventListener('load',fitEvidence);fitEvidence();
let manuallyPaused=false,serviceVisible=false;
const films=[...document.querySelectorAll('.service-film video')];
const individualPauses=new WeakSet();
const visibleFilms=new WeakSet();
const filmButtons=new Map();
function syncMotion(){
  const paused=manuallyPaused||preference.matches||document.hidden;
  root.classList.toggle('motion-off',paused);
  motionButton.textContent=paused?'▶':'Ⅱ';
  motionButton.setAttribute('aria-pressed',String(paused));
  const title=preference.matches?'Reduced motion enabled':paused?'Play motion':'Pause motion';
  motionButton.setAttribute('aria-label',title);motionButton.title=title;motionButton.disabled=preference.matches;
  service.dataset.motion=paused||!serviceVisible?'paused':'running';
  service.dataset.reducedMotion=String(preference.matches);
  serviceMotion.disabled=preference.matches;serviceMotion.setAttribute('aria-pressed',String(paused));
  serviceMotion.setAttribute('aria-label',title);serviceMotion.title=title;
  serviceMotion.querySelector('path').setAttribute('d',paused?'m9 5 11 7-11 7Z':'M7 5h3v14H7zm7 0h3v14h-3z');
  for(const video of films){
    if(paused||!visibleFilms.has(video)||individualPauses.has(video))video.pause();
    else video.play().catch(()=>{});
    const button=filmButtons.get(video);if(button)button.disabled=paused;
  }
  document.dispatchEvent(new Event('atlas-motion-change'));
}
function toggleMotion(){manuallyPaused=!manuallyPaused;syncMotion();}
motionButton.addEventListener('click',toggleMotion);serviceMotion.addEventListener('click',toggleMotion);
preference.addEventListener('change',syncMotion);document.addEventListener('visibilitychange',syncMotion);
for(const video of films){
  video.muted=true;
  video.preload='none';
  const button=document.createElement('button');button.type='button';button.className='film-control';video.parentElement.append(button);filmButtons.set(video,button);
  function update(){button.textContent=video.paused?'▶':'Ⅱ';button.setAttribute('aria-label',`${video.paused?'Play':'Pause'} ${video.getAttribute('aria-label')}`);}
  button.addEventListener('click',()=>{if(video.paused){individualPauses.delete(video);video.play().catch(()=>{});}else{individualPauses.add(video);video.pause();}update();});
  video.addEventListener('play',update);video.addEventListener('pause',update);update();
}
new IntersectionObserver(entries=>{serviceVisible=entries[0].isIntersecting;syncMotion();},{threshold:0}).observe(service);
const filmVisibility=new IntersectionObserver(entries=>{
  for(const entry of entries){if(entry.isIntersecting)visibleFilms.add(entry.target);else visibleFilms.delete(entry.target);}
  syncMotion();
},{threshold:.2});
films.forEach(video=>filmVisibility.observe(video));
const cardVisibility=new IntersectionObserver(entries=>entries.forEach(entry=>{entry.target.dataset.onscreen=String(entry.isIntersecting);}),{threshold:0});
document.querySelectorAll('.service-card').forEach(card=>cardVisibility.observe(card));
function mode(value){
  stage.dataset.mode=value;
  document.querySelectorAll('.view-switch button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.mode===value)));
  document.querySelector('.evidence-stage').setAttribute('aria-hidden',String(value!=='evidence'));
  document.querySelector('.evidence-stage').inert=value!=='evidence';
  document.querySelector('.slab-stage').setAttribute('aria-hidden',String(value!=='slab'));
  zoom.tabIndex=value==='evidence'?0:-1;
  document.dispatchEvent(new Event('atlas-motion-change'));
}
document.querySelectorAll('.view-switch button').forEach(button=>button.addEventListener('click',()=>mode(button.dataset.mode)));
const findings={
  centering:{title:'Almost balanced. Not quite.',body:'Slightly uneven borders would lower this sample’s centering score. Inspect the border balance around all four sides.'},
  corners:{title:'The smallest points matter.',body:'Slight corner wear would keep this sample below a 10. Open the highlighted corner to inspect it more closely.'},
  edges:{title:'A little wear. A lower score.',body:'Minor edge wear is the largest deduction in this sample. The image highlights where you would inspect it.'},
  surface:{title:'Clean at first glance. Look closer.',body:'A small surface mark would explain this sample’s half-point deduction. A real report would show its reviewed location.'}
};
function resetZoom(){setReportZoom(false);}
document.querySelectorAll('.subgrades button').forEach(button=>button.addEventListener('click',()=>{
  const name=button.dataset.category;const item=findings[name];
  document.querySelectorAll('.subgrades button').forEach(other=>other.setAttribute('aria-pressed',String(other===button)));
  crop.dataset.category=name;mode('evidence');beginInspection(name);
  const finding=document.getElementById('finding');
  finding.querySelector('.finding-label').textContent=`${name.toUpperCase()} / EXAMPLE FINDING`;
  finding.querySelector('h2').textContent=item.title;finding.querySelector('p').textContent=item.body;
  finding.classList.remove('changed');void finding.offsetWidth;finding.classList.add('changed');
}));
zoom.addEventListener('click',()=>{
  if(reportMagnified){cancelInspectionTimers();setInspectionStep('deduction');setReportZoom(false);}
  else beginInspection(crop.dataset.category);
});
inspectionMap.addEventListener('click',()=>{cancelInspectionTimers();setInspectionStep('deduction');setReportZoom(false);zoom.focus({preventScroll:true});});
document.addEventListener('atlas-motion-change',()=>{
  if((preference.matches||manuallyPaused||document.hidden)&&inspector.dataset.step!=='idle'){
    cancelInspectionTimers();setInspectionStep('deduction');
  }
});
document.getElementById('explore')?.addEventListener('click',()=>{
  mode('evidence');document.querySelector('.subgrades [data-category="edges"]').click();
  const selected=document.querySelector('.subgrades [aria-pressed="true"]');
  document.getElementById('report').scrollIntoView({behavior:preference.matches||manuallyPaused?'instant':'smooth',block:'center'});
  selected.focus({preventScroll:true});
});
mode('evidence');syncMotion();

// Scroll is the camera; all report interactions remain ordinary, usable controls.
const cinema=document.querySelector('.cinema');
const cinemaScene=cinema.querySelector('.cinema-scene');
const cinemaObject=cinema.querySelector('.cinema-object');
const cinemaIntro=cinema.querySelector('.cinema-copy');
const cinemaDetail=cinema.querySelector('.cinema-detail');
const inspectButtons=[...cinema.querySelectorAll('[data-inspect]')];
const inspectionViews={
  centering:{x:.5,y:.5,left:'1%',top:'1%',width:'98%',height:'98%',scale:1.1,description:'See the balance of all four borders.\nThe whole card is part of the explanation.'},
  edges:{x:.06,y:.775,left:'0%',top:'65%',width:'12%',height:'25%',description:'Follow the highlighted edge.\nThis is where the explanation begins.'},
  corners:{x:.91,y:.065,left:'82%',top:'0%',width:'18%',height:'13%',description:'Look closer at the corner.\nEven the smallest points have a story.'},
  surface:{x:.5,y:.4,left:'30%',top:'25%',width:'40%',height:'30%',description:'Explore the surface.\nThere is more to see beneath the first impression.'}
};
let inspection='edges',cameraFrame=null,pointerX=0,pointerY=0,cameraPosition=null,lastCameraTime=0;
let lastCameraWidth=0,lastCameraHeight=0;
const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,n));
const ease=n=>n*n*(3-2*n);
function updateCamera(now=performance.now()){
  cameraFrame=null;
  const paused=manuallyPaused||preference.matches;
  const rect=cinema.getBoundingClientRect();
  const w=cinemaScene.clientWidth,h=cinemaScene.clientHeight;
  const mobile=w<=700;
  const progress=paused?0:clamp(-rect.top/Math.max(1,cinema.offsetHeight-h));
  const approach=ease(clamp((progress-.08)/.70));
  const detail=ease(clamp((progress-.34)/.25));
  const intro=1-ease(clamp(progress/.30));
  const fade=1-ease(clamp((progress-.88)/.12))*.4;
  const view=inspectionViews[inspection];
  const scale=1+approach*((view.scale||(mobile?2.55:3.05))-1);
  const objectW=cinemaObject.offsetWidth,objectH=cinemaObject.offsetHeight;
  const startX=mobile?0:w*.25,startY=mobile?90:20;
  const destinationX=(mobile?0:w*.23)-(view.x-.5)*objectW*scale;
  const destinationY=(mobile?h*.22:0)-(view.y-.5)*objectH*scale;
  const dx=startX+(destinationX-startX)*approach;
  const dy=startY+(destinationY-startY)*approach;
  const yaw=(-16+pointerX*6)*(1-approach),roll=7*(1-approach);
  const target={x:dx,y:dy,scale,yaw,roll,pitch:pointerY*(1-approach)*-3};
  const resized=w!==lastCameraWidth||h!==lastCameraHeight;
  lastCameraWidth=w;lastCameraHeight=h;
  if(!cameraPosition||paused||resized)cameraPosition={...target};
  const blend=1-Math.exp(-clamp(now-lastCameraTime,1,50)/95);
  lastCameraTime=now;
  let traveling=false;
  for(const key of Object.keys(target)){
    const delta=target[key]-cameraPosition[key];
    if(Math.abs(delta)>(key==='scale'?.0003:.035)){cameraPosition[key]+=delta*blend;traveling=true;}
    else cameraPosition[key]=target[key];
  }
  const position=cameraPosition;
  cinemaObject.style.transform=`translate(-50%,-50%) translate(${position.x}px,${position.y}px) perspective(1400px) rotateX(${position.pitch}deg) rotateY(${position.yaw}deg) rotateZ(${position.roll}deg) scale(${position.scale})`;
  if(traveling&&!paused&&!document.hidden)queueCamera();
  cinema.style.setProperty('--journey',progress.toFixed(4));
  cinema.style.setProperty('--detail',detail.toFixed(4));
  cinema.style.setProperty('--intro',intro.toFixed(4));
  cinema.style.setProperty('--identity',Math.max(0,1-progress*6).toFixed(4));
  cinema.style.setProperty('--scene-exit',fade.toFixed(4));
  cinema.dataset.phase=progress<.3?'intro':progress>.4?'detail':'transition';
  cinemaIntro.inert=intro<.15;
  cinemaDetail.inert=detail<.5||paused;
  cinema.querySelector('.scene-counter b').textContent=progress<.35?'01':progress<.9?'02':'03';
  cinema.querySelector('.scroll-invitation').lastChild.textContent=paused?' EXPLORE AT YOUR PACE':progress>.9?' YOUR CARDS. NEXT.':' SCROLL TO LOOK CLOSER';
}
function queueCamera(){if(cameraFrame===null)cameraFrame=requestAnimationFrame(updateCamera);}
window.addEventListener('scroll',queueCamera,{passive:true});window.addEventListener('resize',queueCamera,{passive:true});
new ResizeObserver(queueCamera).observe(cinemaScene);
document.addEventListener('atlas-motion-change',()=>{pointerX=0;pointerY=0;queueCamera();});
cinemaScene.addEventListener('pointermove',event=>{
  if(event.pointerType!=='mouse'||manuallyPaused||preference.matches)return;
  pointerX=event.clientX/cinemaScene.clientWidth-.5;pointerY=event.clientY/cinemaScene.clientHeight-.5;queueCamera();
});
cinemaScene.addEventListener('pointerleave',()=>{pointerX=0;pointerY=0;queueCamera();});
function setInspection(name){
  const view=inspectionViews[name];if(!view)return;
  inspection=name;
  inspectButtons.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.inspect===name)));
  cinema.style.setProperty('--target-x',view.left);cinema.style.setProperty('--target-y',view.top);
  cinema.style.setProperty('--target-w',view.width);cinema.style.setProperty('--target-h',view.height);
  cinema.querySelector('.detail-description').textContent=view.description;
  cinema.querySelector('.inspection-feedback').textContent=`${name[0].toUpperCase()+name.slice(1)} selected · Illustrative inspection region`;
  queueCamera();
}
inspectButtons.forEach(button=>button.addEventListener('click',()=>{
  setInspection(button.dataset.inspect);
  document.querySelector(`.subgrades [data-category="${inspection}"]`).click();
  if(!manuallyPaused&&!preference.matches){
    const start=window.scrollY+cinema.getBoundingClientRect().top;
    const length=cinema.offsetHeight-cinemaScene.offsetHeight;
    window.scrollTo({top:start+length*.70,behavior:'smooth'});
  }
}));
document.querySelectorAll('.subgrades button').forEach(button=>button.addEventListener('click',()=>setInspection(button.dataset.category)));
new IntersectionObserver(entries=>{cinema.dataset.onscreen=String(entries[0].isIntersecting);},{threshold:0}).observe(cinema);
const revealObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{
  if(entry.isIntersecting){entry.target.classList.add('is-revealed');revealObserver.unobserve(entry.target);}
}),{threshold:.12});
document.querySelectorAll('.report-introduction,.bridge,.submission>.eyebrow,.service-comparison-heading,.closing').forEach(element=>{
  element.classList.add('reveal-ready');revealObserver.observe(element);
});
// Anchor navigation gives keyboard users the same direct access to the report.
document.querySelectorAll('a[href="#report"]').forEach(link=>link.addEventListener('click',event=>{
  event.preventDefault();mode('evidence');
  const report=document.getElementById('report');
  report.scrollIntoView({behavior:preference.matches||manuallyPaused?'instant':'smooth',block:'start'});
  report.focus({preventScroll:true});
}));
queueCamera();

// Decorative light is outside the report. No scores, evidence or controls are animated away.
const evidenceHero=document.querySelector('.evidence-hero');
const presentation=document.querySelector('.report-presentation');
const lightCanvas=document.getElementById('hero-light-field');
const lightContext=lightCanvas.getContext('2d');
let lightFrame=null,heroVisible=true,lightWidth=0,lightHeight=0,lightPointerX=0,lightPointerY=0;
let lightTime=0,lightLast=0,responseUntil=0,responseTimer;
function lightActive(){return heroVisible&&!manuallyPaused&&!preference.matches&&!document.hidden;}
function drawLight(now){
  lightFrame=null;
  if(!lightContext||!lightWidth||!lightHeight)return;
  if(lightActive())lightTime+=Math.min(40,now-lightLast||16)/1000;
  lightLast=now;
  const ctx=lightContext,w=lightWidth,h=lightHeight,t=lightTime;
  ctx.clearRect(0,0,w,h);
  const response=Math.max(0,(responseUntil-now)/1200);
  const glow=ctx.createRadialGradient(w*.71+lightPointerX*30,h*.47,0,w*.71,h*.47,w*.53);
  glow.addColorStop(0,`rgba(202,163,93,${.035+response*.04})`);glow.addColorStop(1,'rgba(202,163,93,0)');
  ctx.fillStyle=glow;ctx.fillRect(0,0,w,h);
  for(let row=0;row<15;row++){
    const gradient=ctx.createLinearGradient(0,0,w,0);
    gradient.addColorStop(0,'rgba(190,160,108,0)');
    gradient.addColorStop(.25,`rgba(190,160,108,${.035+row*.002})`);
    gradient.addColorStop(.61,`rgba(235,212,167,${.10+response*.11})`);
    gradient.addColorStop(.87,'rgba(161,188,190,.06)');gradient.addColorStop(1,'rgba(190,160,108,0)');
    ctx.strokeStyle=gradient;ctx.lineWidth=row%4===0?1:.55;ctx.beginPath();
    for(let step=0;step<=85;step++){
      const u=step/85;
      const x=u*w*1.2-w*.1;
      const y=h*(.31+row*.046)+Math.sin(u*6+t*.20+row*.10)*h*.12-Math.sin(u*Math.PI)*h*.25+lightPointerY*7;
      if(step===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
    }
    ctx.stroke();
  }
  if(lightActive())lightFrame=requestAnimationFrame(drawLight);
}
function syncHeroLight(){
  if(lightFrame!==null){cancelAnimationFrame(lightFrame);lightFrame=null;}
  lightLast=performance.now();drawLight(lightLast);
}
function resizeHeroLight(){
  const rect=evidenceHero.getBoundingClientRect();lightWidth=rect.width;lightHeight=rect.height;
  const ratio=Math.min(devicePixelRatio||1,2);
  lightCanvas.width=Math.round(lightWidth*ratio);lightCanvas.height=Math.round(lightHeight*ratio);
  lightContext?.setTransform(ratio,0,0,ratio,0,0);syncHeroLight();
}
new ResizeObserver(resizeHeroLight).observe(evidenceHero);
new IntersectionObserver(entries=>{heroVisible=entries[0].isIntersecting;evidenceHero.dataset.onscreen=String(heroVisible);syncHeroLight();},{threshold:0}).observe(evidenceHero);
document.addEventListener('atlas-motion-change',syncHeroLight);
evidenceHero.addEventListener('pointermove',event=>{
  if(event.pointerType!=='mouse'||!lightActive())return;
  const rect=evidenceHero.getBoundingClientRect();
  lightPointerX=(event.clientX-rect.left)/rect.width-.5;lightPointerY=(event.clientY-rect.top)/rect.height-.5;
  evidenceHero.style.setProperty('--light-x',`${(lightPointerX+.5)*100}%`);
  evidenceHero.style.setProperty('--light-y',`${(lightPointerY+.5)*100}%`);
},{passive:true});
evidenceHero.addEventListener('pointerleave',()=>{lightPointerX=0;lightPointerY=0;});
function respondToEvidence(){
  if(manuallyPaused||preference.matches)return;
  responseUntil=performance.now()+1200;
  presentation.classList.remove('responding');void presentation.offsetWidth;presentation.classList.add('responding');
  clearTimeout(responseTimer);responseTimer=setTimeout(()=>presentation.classList.remove('responding'),1250);
}
document.querySelectorAll('.subgrades button,.view-switch button,.zoom-control,.math summary').forEach(button=>button.addEventListener('click',respondToEvidence));
// Finish the decorative entrance immediately when somebody starts using the report.
function settleReport(){presentation.style.animation='none';}
presentation.addEventListener('pointerdown',settleReport,{once:true});presentation.addEventListener('focusin',settleReport,{once:true});
resizeHeroLight();

// Study 07: native scroll and direct controls share the same NFC camera states.
const nfcChapter=document.querySelector('.nfc-experience');
const nfcScene=nfcChapter.querySelector('.nfc-scene');
const nfcButtons=[...nfcChapter.querySelectorAll('[data-nfc-view]')];
const followScroll=nfcChapter.querySelector('.nfc-follow');
const journeyChapter=document.querySelector('.submission-journey');
const journeyScene=journeyChapter.querySelector('.journey-scene');
const routeButtons=[...journeyChapter.querySelectorAll('.route-switch button')];
const routeLight=journeyChapter.querySelector('.route-light');
let chapterFrame=null,manualNfcView=null,nfcPosition=0;
const nfcViews=['tap','report','inside'];
const nfcNarratives=[
  ['01 / TAP THE SLAB','Closer is all it takes.','Bring a compatible NFC phone close to the slab’s tag. Open the notification to see the card’s report.','01 / THE CONNECTION','SLAB → PHONE'],
  ['02 / OPEN THE FINGERPRINT','The card’s story. In your hand.','Photographs. Findings. Measurements. The report puts the recorded details in front of you, ready to compare with your card.','02 / THE RECORD','PHONE → EVIDENCE'],
  ['03 / INSIDE THE CONNECTION','Small chip. A bigger story.','The antenna draws energy from your phone’s field. The chip shares the report link. No battery in the tag. The evidence lives in the report.','03 / CONCEPTUAL MICRO VIEW','ANTENNA → CHIP']
];
const routePaths={dealer:'M55 55 H255 C350 55 345 135 450 135 H945',mail:'M55 215 H255 C350 215 345 135 450 135 H945'};
function selectNfcView(view){
  const changed=nfcChapter.dataset.view!==view;
  nfcChapter.dataset.view=view;
  nfcButtons.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.nfcView===view)));
  if(changed){
    const copy=nfcNarratives[nfcViews.indexOf(view)];
    ['.nfc-step-label','.nfc-narrative h3','.nfc-narrative p','.nfc-depth-label','.nfc-depth-value'].forEach((selector,i)=>nfcChapter.querySelector(selector).textContent=copy[i]);
  }
}
nfcButtons.forEach(button=>button.addEventListener('click',()=>{
  manualNfcView=button.dataset.nfcView;followScroll.hidden=false;queueChapters();
}));
followScroll.addEventListener('click',()=>{
  manualNfcView=null;followScroll.hidden=true;
  nfcButtons.find(button=>button.getAttribute('aria-pressed')==='true')?.focus({preventScroll:true});queueChapters();
});
function chapterProgress(section,scene){return clamp(-section.getBoundingClientRect().top/Math.max(1,section.offsetHeight-scene.offsetHeight));}
function updateChapters(){
  chapterFrame=null;
  const still=manuallyPaused||preference.matches||document.hidden||window.innerWidth<=700;
  const progress=still?0:chapterProgress(nfcChapter,nfcScene);
  nfcPosition=manualNfcView?nfcViews.indexOf(manualNfcView):progress<.25?0:progress<.65?ease(clamp((progress-.25)/.22)):1+ease(clamp((progress-.65)/.29));
  const view=manualNfcView||nfcViews[nfcPosition<.5?0:nfcPosition<1.5?1:2];
  selectNfcView(view);
  nfcChapter.style.setProperty('--chapter-progress',progress.toFixed(4));
  nfcChapter.style.setProperty('--nfc-focus',nfcPosition.toFixed(4));
  nfcChapter.dispatchEvent(new CustomEvent('atlas-nfc-camera',{detail:{position:nfcPosition,still}}));
  const journeyProgress=still?0:chapterProgress(journeyChapter,journeyScene);
  journeyChapter.style.setProperty('--chapter-progress',journeyProgress.toFixed(4));
  const routeProgress=still?.96:clamp(journeyProgress*1.15);
  const point=routeLight.getPointAtLength(routeProgress*routeLight.getTotalLength());
  journeyChapter.style.setProperty('--route-progress',routeProgress.toFixed(4));
  journeyChapter.style.setProperty('--parcel-x',`${point.x/10}%`);
  journeyChapter.style.setProperty('--parcel-y',`${point.y/2.7}%`);
  journeyChapter.style.setProperty('--parcel-alpha',still?'0':String(1-ease(clamp((routeProgress-.88)/.12))));
  journeyChapter.dataset.step=String(routeProgress<.39?0:routeProgress<.72?1:2);
}
function queueChapters(){if(chapterFrame===null)chapterFrame=requestAnimationFrame(updateChapters);}
window.addEventListener('scroll',queueChapters,{passive:true});
window.addEventListener('resize',queueChapters,{passive:true});
document.addEventListener('atlas-motion-change',queueChapters);
new ResizeObserver(queueChapters).observe(nfcScene);
new ResizeObserver(queueChapters).observe(journeyScene);
routeButtons.forEach(button=>button.addEventListener('click',()=>{
  const route=button.dataset.route;
  journeyChapter.dataset.route=route;
  routeButtons.forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
  routeLight.setAttribute('d',routePaths[route]);
  const first=journeyChapter.querySelector('[data-journey-step="0"]');
  const last=journeyChapter.querySelector('[data-journey-step="2"]');
  first.querySelector('h3').textContent=route==='dealer'?'Drop off at your dealer.':'Send your cards with FedEx.';
  first.querySelector('p').textContent=route==='dealer'?'Use the ATLAS kiosk at an authorized location.':'Pack your cards and follow the confirmed shipping instructions.';
  last.querySelector('h3').textContent=route==='dealer'?'Back to the same dealer.':'Your cards, shipped back.';
  last.querySelector('p').textContent=route==='dealer'?'Pick up your graded cards where you dropped them off.':'Return shipping follows your confirmed service terms.';
  queueChapters();
}));
queueChapters();

// All locations and measurements below are authored design fixtures, not image analysis.
// Ridge art is a visual metaphor. It does not extract or authenticate a card fingerprint.
const fingerprintCards={
  alakazam:{name:'Alakazam',image:'/assets/alakazam-reference.jpg',seed:2,code:'A–001',findings:[
    {point:[7,8],name:'Corner wear.',category:'CORNERS',value:'0.38',unit:'mm',measure:'EXAMPLE LENGTH',copy:'A small interruption at the corner. Its shape and position become part of the card’s recorded story.'},
    {point:[5,72],name:'Edge whitening.',category:'EDGES',value:'0.62',unit:'mm',measure:'EXAMPLE LENGTH',copy:'A break along the border. Look at where it begins, where it ends, and the shape in between.'},
    {point:[65,37],name:'Surface mark.',category:'SURFACE',value:'0.24',unit:'mm²',measure:'EXAMPLE AREA',copy:'A mark within the face of the card. Its location and outline add another detail to compare.'}]},
  charizard:{name:'Charizard',image:'/marketing/atlas-charizard-first-edition.jpg',seed:7,code:'C–002',findings:[
    {point:[93,94],name:'Corner nick.',category:'CORNERS',value:'0.21',unit:'mm',measure:'EXAMPLE LENGTH',copy:'A tiny nick at a different corner. Same kind of finding; a different shape and location.'},
    {point:[95,52],name:'Border wear.',category:'EDGES',value:'0.47',unit:'mm',measure:'EXAMPLE LENGTH',copy:'A short worn section along the right edge. The precise pattern matters as much as its size.'},
    {point:[40,29],name:'Holo abrasion.',category:'SURFACE',value:'0.16',unit:'mm²',measure:'EXAMPLE AREA',copy:'A small surface region in the holo field. The report keeps its position and outline visible.'}]},
  kobe:{name:'Kobe Bryant',image:'/marketing/atlas-kobe-rookie.jpg',seed:12,code:'K–003',findings:[
    {point:[7,94],name:'Corner compression.',category:'CORNERS',value:'0.29',unit:'mm',measure:'EXAMPLE LENGTH',copy:'A change at the lower corner. Outline, size and position give you details beyond a printed grade.'},
    {point:[54,6],name:'Top-edge nick.',category:'EDGES',value:'0.53',unit:'mm',measure:'EXAMPLE LENGTH',copy:'A localized interruption across the top edge. Compare this exact area with the report photograph.'},
    {point:[76,65],name:'Surface impression.',category:'SURFACE',value:'0.19',unit:'mm²',measure:'EXAMPLE AREA',copy:'A small area on the card’s surface. Together, the findings form a record of this individual card.'}]}
};
function fingerprintArt(seed){
  let paths='';
  for(let ring=0;ring<27;ring++){
    let d='';
    for(let step=0;step<=105;step++){
      const start=ring<8?0:Math.PI*(.68+(ring-8)*.007);
      const sweep=ring<8?Math.PI*2:Math.PI*(1.65-(ring-8)*.014);
      const angle=start+step/105*sweep+Math.sin(seed)*.13;
      const rx=16+ring*4.7,ry=23+ring*6.6;
      const warp=Math.sin(angle*3+seed*.49)*ring*.48;
      const x=160+Math.cos(angle)*(rx+warp)+Math.sin(angle*2+seed)*5;
      const y=212+Math.sin(angle)*(ry+warp)+Math.cos(angle+seed)*ring*.31;
      d+=`${step?'L':'M'}${x.toFixed(1)} ${y.toFixed(1)} `;
    }
    paths+=`<path d="${d}"/>`;
  }
  return paths;
}
const fingerprintSection=document.querySelector('.fingerprint-experience');
const fingerprintCardButtons=[...document.querySelectorAll('[data-fingerprint-card]')];
const findingButtons=[...fingerprintSection.querySelectorAll('[data-finding]')];
let selectedFingerprint='alakazam',selectedFinding=0,scanTimer;
function renderFinding(){
  const card=fingerprintCards[selectedFingerprint],finding=card.findings[selectedFinding];
  findingButtons.forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.finding)===selectedFinding)));
  const panel=fingerprintSection.querySelector('.finding-detail');
  panel.querySelector('.finding-number').textContent=`FINDING 0${selectedFinding+1} / ${finding.category}`;
  panel.querySelector('h3').textContent=finding.name;
  panel.querySelector('.finding-measure strong').replaceChildren(document.createTextNode(`${finding.value} `),Object.assign(document.createElement('small'),{textContent:finding.unit}));
  panel.querySelector('.finding-measure>span').textContent=finding.measure;
  panel.querySelector('p').textContent=finding.copy;
  const macro=fingerprintSection.querySelector('.finding-macro');
  macro.style.setProperty('--defect-x',`${finding.point[0]}%`);macro.style.setProperty('--defect-y',`${finding.point[1]}%`);
  macro.setAttribute('aria-label',`${card.name}: enlarged reference region, illustrative ${finding.name.toLowerCase()} Example measurement ${finding.value} ${finding.unit}.`);
  const outlines=['M115 72 L141 56 L174 68 L188 103 L159 126 L127 110 Z','M102 73 L141 66 L184 71 L197 87 L174 93 L139 84 L106 88 Z','M120 70 Q157 57 187 83 L177 110 Q148 129 121 106 Z'];
  macro.querySelector('.defect-outline').setAttribute('d',outlines[selectedFinding]);
}
function renderFingerprint(){
  const card=fingerprintCards[selectedFingerprint];
  fingerprintCardButtons.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.fingerprintCard===selectedFingerprint)));
  const photo=fingerprintSection.querySelector('.fingerprint-photo');photo.src=card.image;photo.alt=`${card.name} reference card with illustrative defect locations`;
  fingerprintSection.querySelector('.finding-macro img').src=card.image;
  fingerprintSection.querySelector('.fingerprint-name').textContent=`${card.name.toUpperCase()} / FRONT`;
  fingerprintSection.querySelector('.fingerprint-signature>b').textContent=`EXAMPLE / ${card.code}`;
  fingerprintSection.querySelectorAll('.card-ridges,.fingerprint-signature svg').forEach(svg=>svg.innerHTML=fingerprintArt(card.seed));
  fingerprintSection.querySelectorAll('.fingerprint-points button').forEach((button,i)=>{
    button.style.left=`${card.findings[i].point[0]}%`;button.style.top=`${card.findings[i].point[1]}%`;
    button.setAttribute('aria-label',`Inspect example ${card.findings[i].name.toLowerCase().replace(/\.$/,'')}`);
  });
  fingerprintSection.classList.remove('changing');void fingerprintSection.offsetWidth;fingerprintSection.classList.add('changing');
  clearTimeout(scanTimer);scanTimer=setTimeout(()=>fingerprintSection.classList.remove('changing'),1250);
  renderFinding();
}
fingerprintCardButtons.forEach(button=>button.addEventListener('click',()=>{selectedFingerprint=button.dataset.fingerprintCard;renderFingerprint();}));
findingButtons.forEach(button=>button.addEventListener('click',()=>{selectedFinding=Number(button.dataset.finding);renderFinding();}));
fingerprintSection.querySelector('.fingerprint-toggle').addEventListener('click',event=>{
  const visible=fingerprintSection.dataset.overlay!=='true';fingerprintSection.dataset.overlay=String(visible);event.currentTarget.setAttribute('aria-pressed',String(visible));
});
renderFingerprint();
const trustSection=document.querySelector('.trust-experience');
trustSection.querySelectorAll('.trust-fingerprint,.recorded-print,.physical-print').forEach(svg=>svg.innerHTML=fingerprintArt(2));
trustSection.querySelectorAll('[data-compare]').forEach(button=>button.addEventListener('click',()=>{
  const same=button.dataset.compare==='recorded';trustSection.dataset.compare=button.dataset.compare;
  trustSection.querySelectorAll('[data-compare]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
  trustSection.querySelector('.physical-print').innerHTML=fingerprintArt(same?2:9);
  trustSection.querySelector('.swap-verdict b').textContent=same?'THE DETAILS LINE UP.':'DIFFERENT DETAILS. STOP AND LOOK CLOSER.';
  trustSection.querySelector('.swap-verdict>span').textContent=same?'Compare the location, shape and size of the recorded marks.':'The example marks have moved and the pattern has changed. A familiar label does not establish a match.';
}));

// Add only permissioned footage and exact associated public reports here.
// With no supplied customer footage, no empty or fictional testimonial is rendered.
const customerStories=[];
const layoutPreview=new URLSearchParams(location.search).get('reactions')==='layout';
const layoutFilms=[
  {title:'Dealer film',credit:'Illustrative service film · Not a customer reaction',poster:'/service/submission-kiosk.jpg',video:'/service/submission-kiosk.mp4'},
  {title:'Mail-in film',credit:'Illustrative service film · Not a customer reaction',poster:'/service/submission-fedex.jpg',video:'/service/submission-fedex.mp4'}
];
const stories=layoutPreview?layoutFilms:customerStories;
const reactions=document.getElementById('reactions');
const reactionDialog=document.querySelector('.reaction-dialog');
const reactionVideo=reactionDialog.querySelector('video');
let reactionTrigger=null;
function closeReaction(){reactionDialog.close();}
reactionDialog.querySelector('.reaction-close').addEventListener('click',closeReaction);
reactionDialog.addEventListener('click',event=>{if(event.target!==reactionDialog)return;const r=reactionDialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeReaction();});
reactionDialog.addEventListener('close',()=>{
  reactionVideo.pause();reactionVideo.removeAttribute('src');reactionVideo.replaceChildren();reactionVideo.load();
  reactionTrigger?.focus({preventScroll:true});
});
document.addEventListener('visibilitychange',()=>{if(document.hidden)reactionVideo.pause();});
if(stories.length){
  reactions.hidden=false;
  if(layoutPreview){
    reactions.querySelector('.eyebrow').textContent='FOOTAGE LAYOUT PREVIEW';
    reactions.querySelector('h2').textContent='Room for the real reaction.';
    reactions.querySelector('.reactions-heading>p:last-child').textContent='Player demonstration using the existing service films. Customer footage has not been supplied.';
  }
  for(const story of stories){
    const tile=document.createElement('article');tile.className='reaction-tile';
    const button=document.createElement('button');button.type='button';button.className='reaction-play';button.setAttribute('aria-label',`Play ${story.title}`);
    const poster=document.createElement('img');poster.src=story.poster;poster.alt='';poster.loading='lazy';poster.width=540;poster.height=960;
    const label=document.createElement('span');const play=document.createElement('b');play.textContent='▶';play.setAttribute('aria-hidden','true');label.append(play,document.createTextNode(story.title));button.append(poster,label);
    const credit=document.createElement('p');credit.textContent=story.credit;tile.append(button,credit);reactions.querySelector('.reaction-clips').append(tile);
    button.addEventListener('click',()=>{
      reactionTrigger=button;
      reactionDialog.querySelector('h2').textContent=story.title;
      reactionDialog.querySelector('.reaction-credit').textContent=story.credit;
      const link=reactionDialog.querySelector('.reaction-report');link.hidden=!story.report;
      if(story.report)link.href=story.report;else link.removeAttribute('href');
      reactionVideo.poster=story.poster;reactionVideo.src=story.video;
      if(story.captions){const track=document.createElement('track');track.kind='captions';track.src=story.captions;track.srclang=story.language||'en';track.label=story.captionLabel||'English';track.default=true;reactionVideo.append(track);}
      reactionDialog.showModal();reactionVideo.play().catch(()=>{});
    });
  }
}
