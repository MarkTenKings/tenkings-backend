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
  if(root.dataset.heroReport==='embedded'){document.dispatchEvent(new Event('atlas-hero-resize'));return;}
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
let cinemaScrollStep=-1;
const cinemaSequence=['edges','surface','corners'];
let inspection='edges',cameraFrame=null,pointerX=0,pointerY=0,cameraPosition=null,lastCameraTime=0;
let lastCameraWidth=0,lastCameraHeight=0;
const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,n));
const ease=n=>n*n*(3-2*n);
function updateCamera(now=performance.now()){
  cameraFrame=null;
  if(cinema.closest(".hc-legacy"))return;
  const paused=manuallyPaused||preference.matches;
  const rect=cinema.getBoundingClientRect();
  const w=cinemaScene.clientWidth,h=cinemaScene.clientHeight;
  const mobile=w<=700;
  const progress=paused?0:clamp(-rect.top/Math.max(1,cinema.offsetHeight-h));
  const chapterStep=Math.min(3,Math.floor(progress*5));
  if(chapterStep!==cinemaScrollStep){cinemaScrollStep=chapterStep;setInspection(cinemaSequence[Math.max(0,chapterStep-1)]);}
  const approach=ease(clamp((progress-.03)/.24));
  const detail=ease(clamp((progress-.12)/.14));
  const intro=1-ease(clamp(progress/.16));
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
  cinema.dataset.phase=progress<.12?'intro':progress>.26?'detail':'transition';
  cinemaIntro.inert=intro<.15;
  cinemaDetail.inert=detail<.5||paused;
  cinema.querySelector('.scene-counter b').textContent=String(Math.max(1,chapterStep)).padStart(2,'0');
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
    window.scrollTo({top:start+length*([.29,.49,.69][cinemaSequence.indexOf(inspection)]),behavior:'smooth'});
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
function lightActive(){return false&&heroVisible&&!manuallyPaused&&!preference.matches&&!document.hidden;}
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
const nfcViews=['chip','slab','tap','inside','tunnel','proof'];
const nfcNarratives=[
 ['01 / INSIDE THE CONNECTION','Big trust. Small beginnings.','Follow the connection from the chip inside the ATLAS logo to the story of your card.','01 / THE CHIP','THE CONNECTION BEGINS'],
 ['02 / THE ATLAS SLAB','A whole story. Sealed together.','The card, its label and the connection back to its record. Find the NFC tag at the ATLAS logo.','02 / THE SLAB','CHIP → CARD'],
 ['03 / TAP THE ATLAS LOGO','Your phone is the way in.','Bring a compatible NFC phone close to the ATLAS logo. Open the notification to view the saved report.','03 / THE TAP','LOGO → PHONE'],
 ['04 / INTO THE CHIP','Follow the signal.','The phone powers the passive tag. The chip shares the link that takes you to the card’s report.','04 / CONCEPTUAL MICRO VIEW','PHONE → CHIP'],
 ['05 / THE CONNECTION','Every detail. One connection.','A cinematic journey through the link to your card’s recorded evidence.','05 / VISUAL METAPHOR','CHIP → RECORD'],
 ['06 / THE PROOF','The story comes into focus.','The report and its ATLAS fingerprint. Together, ready to compare with the card in your hand.','06 / ARRIVAL','RECORD + FINGERPRINT']
];
let nfcPlaying=false,nfcPlayStart=0,nfcPlayProgress=0;
const nfcPlayButton=nfcChapter.querySelector('.nfc-play');
function stopNfcPlayback(){nfcPlaying=false;nfcPlayButton.innerHTML='Replay the connection <span>↻</span>';nfcChapter.querySelector('.nfc-play-status').textContent='A 14-SECOND JOURNEY · OR SCROLL TO EXPLORE';}
function nfcTimeline(progress){const v=clamp(progress)*5,i=Math.min(4,Math.floor(v));return i+ease(v-i);}
nfcPlayButton.addEventListener('click',()=>{
 if(nfcPlaying){manualNfcView=nfcViews[Math.round(nfcPosition)];stopNfcPlayback();queueChapters();return;}
 if(manuallyPaused||preference.matches){manualNfcView='proof';queueChapters();document.getElementById('connected-proof').scrollIntoView({behavior:'auto'});return;}
 manualNfcView=null;nfcPlaying=true;nfcPlayStart=performance.now();nfcPlayProgress=0;nfcPlayButton.innerHTML='Pause the journey <span>Ⅱ</span>';nfcChapter.querySelector('.nfc-play-status').textContent='FOLLOW THE SIGNAL';queueChapters();
});
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
  stopNfcPlayback();manualNfcView=button.dataset.nfcView;followScroll.hidden=false;queueChapters();if(manualNfcView==='proof'){document.getElementById('connected-proof').scrollIntoView({behavior:preference.matches?'auto':'smooth'});document.getElementById('trust-title').focus({preventScroll:true});}
}));
followScroll.addEventListener('click',()=>{
  stopNfcPlayback();manualNfcView=null;followScroll.hidden=true;
  nfcButtons.find(button=>button.getAttribute('aria-pressed')==='true')?.focus({preventScroll:true});queueChapters();
});
function chapterProgress(section,scene){return clamp(-section.getBoundingClientRect().top/Math.max(1,section.offsetHeight-scene.offsetHeight));}
function updateChapters(){
  chapterFrame=null;
  const motionStill=manuallyPaused||preference.matches||document.hidden;
  const still=motionStill||window.innerWidth<=700;
  const progress=still?0:chapterProgress(nfcChapter,nfcScene);
  if(nfcPlaying&&motionStill){manualNfcView=nfcViews[Math.round(nfcPosition)];stopNfcPlayback();}
  if(nfcPlaying)nfcPlayProgress=clamp((performance.now()-nfcPlayStart)/14000);
  nfcPosition=nfcPlaying?nfcTimeline(nfcPlayProgress):manualNfcView?nfcViews.indexOf(manualNfcView):nfcTimeline(progress);
  const view=manualNfcView||nfcViews[Math.min(5,Math.round(nfcPosition))];
  selectNfcView(view);
  nfcChapter.style.setProperty('--chapter-progress',progress.toFixed(4));
  nfcChapter.style.setProperty('--nfc-focus',nfcPosition.toFixed(4));
  nfcChapter.dispatchEvent(new CustomEvent('atlas-nfc-camera',{detail:{position:nfcPosition,still:motionStill}}));
  nfcChapter.style.setProperty('--warp-amount',String(clamp((nfcPosition-3.25)/.65)*(1-clamp((nfcPosition-4.65)/.35))));
  if(nfcPlaying&&nfcPlayProgress===1){stopNfcPlayback();manualNfcView='proof';document.getElementById('connected-proof').scrollIntoView({behavior:'smooth'});document.getElementById('trust-title').focus({preventScroll:true});}
  else if(nfcPlaying)queueChapters();
  const journeyRect=journeyScene.getBoundingClientRect();
  const journeyProgress=clamp((innerHeight-journeyRect.top)/(innerHeight+journeyRect.height*.45));
  journeyChapter.style.setProperty('--chapter-progress',journeyProgress.toFixed(4));
  const routeProgress=motionStill?.96:clamp(journeyProgress*1.15);
  const point=routeLight.getPointAtLength(routeProgress*routeLight.getTotalLength());
  journeyChapter.style.setProperty('--route-progress',routeProgress.toFixed(4));
  journeyChapter.style.setProperty('--parcel-x',`${point.x/10}%`);
  journeyChapter.style.setProperty('--parcel-y',`${point.y/270*routeLight.ownerSVGElement.clientHeight}px`);
  journeyChapter.style.setProperty('--parcel-alpha',still?'0':String(1-ease(clamp((routeProgress-.88)/.12))));
  journeyChapter.dataset.step=String(routeProgress<.39?0:routeProgress<.72?1:2);
}
function queueChapters(){if(chapterFrame===null)chapterFrame=requestAnimationFrame(updateChapters);}
window.addEventListener('scroll',()=>{if(!nfcPlaying&&manualNfcView!==null){manualNfcView=null;followScroll.hidden=true;}queueChapters();},{passive:true});
function interruptNfc(){if(nfcPlaying){manualNfcView=nfcViews[Math.round(nfcPosition)];stopNfcPlayback();queueChapters();}}
window.addEventListener('wheel',interruptNfc,{passive:true});window.addEventListener('touchstart',interruptNfc,{passive:true});document.addEventListener('keydown',event=>{if(event.key==='Escape')interruptNfc();});
window.addEventListener('resize',queueChapters,{passive:true});
document.addEventListener('atlas-motion-change',queueChapters);
document.addEventListener('visibilitychange',queueChapters);
new ResizeObserver(queueChapters).observe(nfcScene);
new ResizeObserver(queueChapters).observe(journeyScene);
routeButtons.forEach(button=>button.addEventListener('click',()=>{
  const route=button.dataset.route;
  journeyChapter.dataset.route=route;
  routeButtons.forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
  routeLight.setAttribute('d',routePaths[route]);
  queueChapters();
}));
queueChapters();

// All locations and measurements below are authored design fixtures, not image analysis.
// Ridge art is a visual metaphor. It does not extract or authenticate a card fingerprint.
const fingerprintCards={
  alakazam:{name:'Alakazam',image:'/homepage/45f15f368852b050/assets/alakazam-reference.jpg',code:'A–001',findings:[
    {point:[7,8],name:'Corner wear.',category:'CORNERS',value:'0.38',unit:'mm',measure:'EXAMPLE LENGTH',copy:'A small interruption at the corner. Its shape and position become part of the card’s recorded story.'},
    {point:[5,72],name:'Edge whitening.',category:'EDGES',value:'0.62',unit:'mm',measure:'EXAMPLE LENGTH',copy:'A break along the border. Look at where it begins, where it ends, and the shape in between.'},
    {point:[65,37],name:'Surface mark.',category:'SURFACE',value:'0.24',unit:'mm²',measure:'EXAMPLE AREA',copy:'A mark within the face of the card. Its location and outline add another detail to compare.'}]},
  charizard:{name:'Charizard',image:'/homepage/45f15f368852b050/marketing/atlas-charizard-first-edition.jpg',code:'C–002',findings:[
    {point:[93,94],name:'Corner nick.',category:'CORNERS',value:'0.21',unit:'mm',measure:'EXAMPLE LENGTH',copy:'A tiny nick at a different corner. Same kind of finding; a different shape and location.'},
    {point:[95,52],name:'Border wear.',category:'EDGES',value:'0.47',unit:'mm',measure:'EXAMPLE LENGTH',copy:'A short worn section along the right edge. The precise pattern matters as much as its size.'},
    {point:[40,29],name:'Holo abrasion.',category:'SURFACE',value:'0.16',unit:'mm²',measure:'EXAMPLE AREA',copy:'A small surface region in the holo field. The report keeps its position and outline visible.'}]},
  kobe:{name:'Kobe Bryant',image:'/homepage/45f15f368852b050/marketing/atlas-kobe-rookie.jpg',code:'K–003',findings:[
    {point:[7,94],name:'Corner compression.',category:'CORNERS',value:'0.29',unit:'mm',measure:'EXAMPLE LENGTH',copy:'A change at the lower corner. Outline, size and position give you details beyond a printed grade.'},
    {point:[54,6],name:'Top-edge nick.',category:'EDGES',value:'0.53',unit:'mm',measure:'EXAMPLE LENGTH',copy:'A localized interruption across the top edge. Compare this exact area with the report photograph.'},
    {point:[76,65],name:'Surface impression.',category:'SURFACE',value:'0.19',unit:'mm²',measure:'EXAMPLE AREA',copy:'A small area on the card’s surface. Together, the findings form a record of this individual card.'}]}
};
// ATLAS_FINGERPRINT_V1_BEGIN — pure recipe; async digest injected for browser/Node parity.
function canonicalFingerprint(input){
  const round=n=>{if(!Number.isFinite(n))throw new TypeError('Fingerprint coordinates must be finite');return Math.round(n*1e6)/1e6;};
  const {card,defects}=input;
  if(!card||!card.edition||!(card.widthMm>0)||!(card.heightMm>0)||!Array.isArray(defects)||!defects.length)throw new TypeError('Incomplete fingerprint record');
  function canonicalPolygon(points){
    if(!Array.isArray(points)||points.length<3)throw new TypeError('A defect needs an outline');
    let p=points.map(([x,y])=>{if(x<0||x>1||y<0||y>1)throw new RangeError('Outline outside normalized card');return [round(x),round(y)];});
    if(JSON.stringify(p[0])===JSON.stringify(p.at(-1)))p=p.slice(0,-1);
    const variants=[];
    for(const direction of [p,[...p].reverse()])for(let i=0;i<p.length;i++)variants.push(JSON.stringify([...direction.slice(i),...direction.slice(0,i)]));
    return JSON.parse(variants.sort()[0]);
  }
  const findings=defects.map(d=>{
    if(!['front','back'].includes(d.side)||!d.kind||!['mm','mm²'].includes(d.unit)||!(d.measurement>0))throw new TypeError('Invalid defect descriptor');
    return {side:d.side,kind:d.kind,outline:canonicalPolygon(d.outline),measurement:round(d.measurement),unit:d.unit};
  }).sort((a,b)=>JSON.stringify(a)<JSON.stringify(b)?-1:JSON.stringify(a)>JSON.stringify(b)?1:0);
  return JSON.stringify({version:'atlas-fingerprint-v1',card:{edition:card.edition.normalize('NFC').trim(),widthMm:round(card.widthMm),heightMm:round(card.heightMm)},defects:findings});
}
function fingerprintGeometry(canonical,digest){
  const record=JSON.parse(canonical),bytes=digest.match(/../g).map(h=>parseInt(h,16));
  const descriptors=record.defects.map(d=>{
    const p=d.outline,n=p.length,cx=p.reduce((a,v)=>a+v[0],0)/n,cy=p.reduce((a,v)=>a+v[1],0)/n;
    let area=0,perimeter=0;
    for(let i=0;i<n;i++){const q=p[(i+1)%n];area+=p[i][0]*q[1]-q[0]*p[i][1];perimeter+=Math.hypot(q[0]-p[i][0],q[1]-p[i][1]);}
    return {x:cx,y:cy,area:Math.abs(area/2),perimeter,weight:Math.log1p(d.measurement*10),side:d.side==='front'?1:-1};
  });
  const meanX=descriptors.reduce((s,d)=>s+d.x*d.weight,0)/descriptors.reduce((s,d)=>s+d.weight,0);
  const meanY=descriptors.reduce((s,d)=>s+d.y*d.weight,0)/descriptors.reduce((s,d)=>s+d.weight,0);
  const family=bytes[6]%3;
  const coreX=140+meanX*35+(family===1?-12:0),coreY=180+meanY*45,angle=(bytes[0]/255-.5)*.6;
  const paths=[];
  for(let ring=0;ring<39;ring++){
    if(family===2&&ring<11){for(const side of [-1,1]){const points=[];for(let j=0;j<=100;j++){const t=j/100*Math.PI*2,x=Math.cos(t)*(2+ring*1.45),y=Math.sin(t)*(3+ring*1.9);points.push([coreX+side*16+x*Math.cos(side*.32)-y*Math.sin(side*.32),coreY+side*9+x*Math.sin(side*.32)+y*Math.cos(side*.32)]);}paths.push(points.map(([x,y],i)=>`${i?'L':'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' '));}continue;}
    const rx=5+ring*(2.95+bytes[1]/255*.25),ry=8+ring*(4.38+bytes[2]/255*.3);
    const gap=ring<9?0:.11+(ring-9)*.006;
    const begin=Math.PI/2+gap,end=2.5*Math.PI-gap;
    const points=[];
    for(let j=0;j<=150;j++){
      const theta=begin+j/150*(end-begin),nx=.5+Math.cos(theta)*ring/80,ny=.5+Math.sin(theta)*ring/80;
      let warp=0;
      for(const d of descriptors){const dist=(nx-d.x)**2+(ny-d.y)**2;warp+=Math.exp(-dist/ .13)*d.weight*(Math.sin(theta*2+d.perimeter*40)+Math.cos(theta*3+d.area*600))*1.15*d.side;}
      const localX=Math.cos(theta)*(rx+warp)+Math.sin(theta*2+bytes[3]/60)*ring*(family===1?.38:.16);
      const localY=Math.sin(theta)*(ry+warp)+Math.cos(theta*2+bytes[4]/70)*ring*.13;
      points.push([coreX+localX*Math.cos(angle)-localY*Math.sin(angle),coreY+localX*Math.sin(angle)+localY*Math.cos(angle)]);
    }
    const path=points.map(([x,y],i)=>`${i?'L':'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
    paths.push(path);
    // Deterministic ridge bifurcations and endings, derived from the full record digest.
    if(ring>12&&ring%7===bytes[5]%7){const start=20+bytes[ring%32]%65;const fork=points.slice(start,start+24).map(([x,y],i)=>[x+Math.sin(i/23*Math.PI)*3.4,y+Math.sin(i/23*Math.PI)*2.1]);paths.push(fork.map(([x,y],i)=>`${i?'L':'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' '));}
  }
  return {version:record.version,digest,paths,family:['whorl','loop','double-loop'][family],defectCount:record.defects.length};
}
async function createAtlasFingerprint(input,digestFn){
  const canonical=canonicalFingerprint(input);
  const digest=await digestFn(canonical);
  if(!/^[a-f0-9]{64}$/.test(digest))throw new TypeError('Expected SHA-256 digest');
  return {...fingerprintGeometry(canonical,digest),canonical};
}
// ATLAS_FINGERPRINT_V1_END
function fingerprintSvg(signature){return signature.paths.map((path,i)=>`<path pathLength="1" style="--ridge-delay:${(i*.026).toFixed(3)}s" d="${path}"/>`).join('');}
async function digestFingerprint(text){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(n=>n.toString(16).padStart(2,'0')).join('');}
const defectPolygons={
  alakazam:[[[.034,.045],[.081,.039],[.098,.075],[.067,.103],[.035,.091]],[[.015,.69],[.049,.697],[.063,.736],[.029,.75],[.018,.724]],[[.62,.35],[.651,.337],[.682,.369],[.663,.397],[.628,.382]]],
  charizard:[[[.91,.91],[.957,.92],[.966,.958],[.927,.967],[.909,.939]],[[.934,.49],[.967,.486],[.977,.542],[.941,.555]],[[.371,.27],[.416,.26],[.433,.291],[.406,.321],[.373,.303]]],
  kobe:[[[.036,.916],[.077,.913],[.105,.937],[.085,.974],[.04,.963]],[[.503,.039],[.56,.031],[.578,.067],[.532,.078]],[[.733,.622],[.772,.618],[.798,.651],[.763,.684],[.738,.66]]]
};
function cardFingerprintRecord(key){const c=fingerprintCards[key];return {card:{edition:`${c.name} / ${c.code}`,widthMm:63,heightMm:88},defects:c.findings.map((f,i)=>({side:'front',kind:f.category,outline:defectPolygons[key][i],measurement:Number(f.value),unit:f.unit}))};}
const fingerprintSection=document.querySelector('.fingerprint-experience');
const fingerprintCardButtons=[...document.querySelectorAll('[data-fingerprint-card]')];
const findingButtons=[...fingerprintSection.querySelectorAll('[data-finding]')];
let selectedFingerprint='alakazam',selectedFinding=0,fingerprintGeneration=0,fingerprintSignature=null,mappingTimers=[],fingerprintSeen=false,fingerprintVisible=false;
const signatureCache=new Map();
function finishMapping(){mappingTimers.forEach(clearTimeout);mappingTimers=[];fingerprintSection.dataset.mapping='complete';fingerprintSection.classList.remove('mapping');fingerprintSection.querySelector('.mapping-status').textContent='ATLAS FINGERPRINT / MAPPED';}
function playFingerprintMapping(){
  finishMapping();
  const stage=fingerprintSection.querySelector('.fingerprint-stage'),threads=stage.querySelector('.mapping-threads'),box=stage.getBoundingClientRect();
  threads.setAttribute('viewBox',`0 0 ${box.width} ${box.height}`);
  threads.innerHTML=[...stage.querySelectorAll('.fingerprint-points button')].map((button,i)=>{const r=button.getBoundingClientRect(),x=r.left-box.left,y=r.top-box.top,tx=box.width*.84,ty=85+fingerprintCards[selectedFingerprint].findings[i].point[1]/100*box.height*.6;return `<path pathLength="1" style="--defect-order:${i}" d="M${x} ${y} C${x+70} ${y-40} ${tx-80} ${ty+30} ${tx} ${ty}"/>`;}).join('');
  if(manuallyPaused||preference.matches||document.hidden)return;
  fingerprintSection.dataset.mapping='detect';void fingerprintSection.offsetWidth;fingerprintSection.classList.add('mapping');
  fingerprintSection.querySelector('.mapping-status').textContent='01 / LOCATE THE DETAILS';
  for(const [time,stage,text] of [[1050,'measure','02 / MAP LOCATION + SHAPE + SIZE'],[1950,'trace','03 / DRAW THE ATLAS FINGERPRINT'],[4300,'complete','ATLAS FINGERPRINT / MAPPED']])mappingTimers.push(setTimeout(()=>{fingerprintSection.dataset.mapping=stage;fingerprintSection.querySelector('.mapping-status').textContent=text;if(stage==='complete')fingerprintSection.classList.remove('mapping');},time));
}
function renderFinding(){
  const card=fingerprintCards[selectedFingerprint],finding=card.findings[selectedFinding];
  findingButtons.forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.finding)===selectedFinding)));
  const panel=fingerprintSection.querySelector('.finding-detail');
  panel.querySelector('.finding-number').textContent=`FINDING 0${selectedFinding+1} / ${finding.category}`;
  panel.querySelector('h3').textContent=finding.name;
  panel.querySelector('.finding-measure strong').replaceChildren(document.createTextNode(`${finding.value} `),Object.assign(document.createElement('small'),{textContent:finding.unit}));
  panel.querySelector('.finding-measure>span').textContent=finding.measure;panel.querySelector('p').textContent=finding.copy;
  const macro=fingerprintSection.querySelector('.finding-macro');macro.style.setProperty('--defect-x',`${finding.point[0]}%`);macro.style.setProperty('--defect-y',`${finding.point[1]}%`);
  macro.setAttribute('aria-label',`${card.name}: enlarged reference region, illustrative ${finding.name.toLowerCase()} Example measurement ${finding.value} ${finding.unit}.`);
  const p=defectPolygons[selectedFingerprint][selectedFinding],xs=p.map(v=>v[0]),ys=p.map(v=>v[1]);
  const x0=Math.min(...xs),y0=Math.min(...ys),w=Math.max(...xs)-x0,h=Math.max(...ys)-y0;
  macro.querySelector('.defect-outline').setAttribute('d',p.map(([x,y],i)=>`${i?'L':'M'}${110+(x-x0)/w*80} ${55+(y-y0)/h*70}`).join(' ')+' Z');
}
async function renderFingerprint(animate=true){
  const generation=++fingerprintGeneration,card=fingerprintCards[selectedFingerprint],key=selectedFingerprint;
  finishMapping();
  fingerprintCardButtons.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.fingerprintCard===key)));
  const photo=fingerprintSection.querySelector('.fingerprint-photo');photo.src=card.image;photo.alt=`${card.name} reference card with illustrative defect locations`;
  fingerprintSection.querySelector('.finding-macro img').src=card.image;
  fingerprintSection.querySelector('.fingerprint-name').textContent=`${card.name.toUpperCase()} / FRONT`;
  fingerprintSection.querySelector('.fingerprint-signature>b').textContent='MAPPING THE RECORD…';
  fingerprintSection.querySelectorAll('.fingerprint-points button').forEach((button,i)=>{button.style.left=`${card.findings[i].point[0]}%`;button.style.top=`${card.findings[i].point[1]}%`;button.style.setProperty('--defect-order',i);button.setAttribute('aria-label',`Inspect example ${card.findings[i].name.toLowerCase().replace(/\.$/,'')}`);});
  fingerprintSection.querySelector('.mapped-defects').innerHTML=defectPolygons[key].map((polygon,i)=>`<path style="--defect-order:${i}" d="${polygon.map(([x,y],j)=>`${j?'L':'M'}${x*320} ${y*440}`).join(' ')} Z"/>`).join('');
  renderFinding();
  try{
    const signature=signatureCache.get(key)||await createAtlasFingerprint(cardFingerprintRecord(key),digestFingerprint);
    signatureCache.set(key,signature);if(generation!==fingerprintGeneration)return;
    fingerprintSignature=signature;
    fingerprintSection.querySelectorAll('.card-ridges,.fingerprint-signature svg').forEach(svg=>svg.innerHTML=fingerprintSvg(signature));
    fingerprintSection.querySelector('.fingerprint-signature>b').textContent=`AF–01 / ${signature.digest.slice(0,12).toUpperCase()}`;
    fingerprintSection.querySelector('.mapping-key').textContent=signature.digest.slice(0,16).toUpperCase();
    updateConnectedRecord(card,signature);
    if(animate||fingerprintVisible)playFingerprintMapping();
  }catch(error){fingerprintSection.querySelector('.mapping-status').textContent='Fingerprint preview unavailable';console.warn('Fingerprint preview:',error.message);}
}
fingerprintCardButtons.forEach(button=>button.addEventListener('click',()=>{selectedFingerprint=button.dataset.fingerprintCard;renderFingerprint();}));
findingButtons.forEach(button=>button.addEventListener('click',()=>{selectedFinding=Number(button.dataset.finding);renderFinding();}));
fingerprintSection.querySelector('.fingerprint-toggle').addEventListener('click',event=>{const visible=fingerprintSection.dataset.overlay!=='true';fingerprintSection.dataset.overlay=String(visible);event.currentTarget.setAttribute('aria-pressed',String(visible));});
fingerprintSection.querySelector('.mapping-replay').addEventListener('click',playFingerprintMapping);
new IntersectionObserver(entries=>{const visible=entries[0].isIntersecting;if(visible&&!fingerprintVisible){fingerprintVisible=true;fingerprintSeen=true;if(fingerprintSignature)playFingerprintMapping();}else if(!visible){fingerprintVisible=false;if(fingerprintSeen)finishMapping();}},{threshold:.25}).observe(fingerprintSection.querySelector('.fingerprint-lab'));
document.addEventListener('atlas-motion-change',()=>{if(manuallyPaused||preference.matches)finishMapping();});document.addEventListener('visibilitychange',()=>{if(document.hidden)finishMapping();});
function updateConnectedRecord(card,signature){
  const connected=document.querySelector('.connected-record');
  connected.querySelector('.connected-card').src=card.image;
  connected.querySelector('.connected-card').alt=`${card.name} illustrative report reference`;
  connected.querySelector('.connected-name').textContent=card.name;
  connected.querySelectorAll('.connected-key').forEach(el=>el.textContent=signature.digest.slice(0,12).toUpperCase());
  connected.querySelector('.connected-print svg').innerHTML=fingerprintSvg(signature);
  connected.querySelector('.connected-findings').innerHTML=card.findings.map(f=>`<p><span>${f.category}</span><b>${f.value} ${f.unit}</b></p>`).join('');
  const phone=document.querySelector('.phone-report');phone.querySelector('img').src=card.image;phone.querySelector('div>span').firstChild.textContent=card.name.toUpperCase();
  [...phone.querySelectorAll('p')].forEach((p,i)=>p.querySelector('b').textContent=`${card.findings[i].value} ${card.findings[i].unit}`);
  document.querySelector('.nfc-experience').dispatchEvent(new CustomEvent('atlas-nfc-specimen',{detail:{image:card.image,name:card.name}}));
}
if(!fingerprintSection.closest(".hc-legacy"))renderFingerprint(false);
let fingerprintScrollStep=-1;
const fingerprintSequence=['alakazam','charizard','kobe'];
function scrollFingerprint(){
 if(fingerprintSection.closest(".hc-legacy"))return;
 if(manuallyPaused||preference.matches)return;
 const scene=fingerprintSection.querySelector('.fingerprint-scene'),r=fingerprintSection.getBoundingClientRect();
 if(r.top>0||r.bottom<scene.offsetHeight)return;
 const p=clamp(-r.top/Math.max(1,r.height-scene.offsetHeight)),i=Math.min(2,Math.floor(p*4));
 if(i!==fingerprintScrollStep){fingerprintScrollStep=i;selectedFingerprint=fingerprintSequence[i];renderFingerprint();}
}
window.addEventListener('scroll',scrollFingerprint,{passive:true});
window.addEventListener('resize',scrollFingerprint,{passive:true});


// Add only permissioned footage and exact associated public reports here.
// With no supplied customer footage, no empty or fictional testimonial is rendered.
const customerStories=[];
const layoutPreview=new URLSearchParams(location.search).get('reactions')==='layout';
const layoutFilms=[
  {title:'Dealer film',credit:'Illustrative service film · Not a customer reaction',poster:'/homepage/45f15f368852b050/service/submission-kiosk.jpg',video:'/homepage/45f15f368852b050/service/submission-kiosk.mp4'},
  {title:'Mail-in film',credit:'Illustrative service film · Not a customer reaction',poster:'/homepage/45f15f368852b050/service/submission-fedex.jpg',video:'/homepage/45f15f368852b050/service/submission-fedex.mp4'}
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

// A user-initiated fictional motion concept; no brand security test is implied.
const heistDetails=document.querySelector('.copycat-film'),heistStage=document.querySelector('.heist-stage');
let heistTimers=[];
const heistActs=[['ready','A perfect-looking label?','The details deserve a second look.'],['copy','Four labels. One copycat.','Our fictional villain thinks the printed number is the whole story.'],['inspect','Then the evidence opens.','The ATLAS record reveals a different set of marks.'],['blocked','The details don’t match.','The collector spots the mismatch before trusting the label.'],['rescue','The evidence saves the day.','Our creature guardians arrive. The copycat makes a furious escape.']];
function setHeistAct(index){const [act,title,copy]=heistActs[index];heistStage.dataset.act=act;heistStage.querySelector('h3').textContent=title;heistStage.querySelector('.heist-caption p').textContent=copy;}
function stopHeist(){heistTimers.forEach(clearTimeout);heistTimers=[];heistStage.classList.remove('playing');}
function playHeist(){stopHeist();if(manuallyPaused||preference.matches){setHeistAct(3);return;}setHeistAct(0);void heistStage.offsetWidth;heistStage.classList.add('playing');[2000,4800,7300,10200].forEach((t,i)=>heistTimers.push(setTimeout(()=>setHeistAct(i+1),t)));heistTimers.push(setTimeout(stopHeist,14000));}
heistDetails.addEventListener('toggle',()=>{if(heistDetails.open){heistStage.scrollIntoView({behavior:preference.matches?'auto':'smooth',block:'center'});playHeist();}else stopHeist();});heistStage.querySelector('.heist-replay').addEventListener('click',playHeist);
document.addEventListener('atlas-motion-change',()=>{if(manuallyPaused||preference.matches){stopHeist();setHeistAct(3);}});document.addEventListener('visibilitychange',()=>{if(document.hidden)stopHeist();});

new IntersectionObserver(entries=>{if(!entries[0].isIntersecting)stopHeist();},{threshold:.05}).observe(heistStage);

document.addEventListener('atlas-report-selected',()=>{if(root.dataset.heroReport==='embedded')cancelInspectionTimers();});
