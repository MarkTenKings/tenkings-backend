import {loadHeroEvidence, fetchVerifiedAsset, findingsForSide, traceSvgPath} from '/homepage/56c03a479d0d827e/hero-evidence.mjs';
import {renderInspectionInstruments} from '/homepage/56c03a479d0d827e/hero-metrology.mjs';
import {createSectionSession, sectionFindingDetail, sideGeometry, fingerprintArea} from './continuation-state.mjs';

// Read-only presentation of the retained, approved report. No grade is recomputed.
const reportSection = document.querySelector('.ac-report-chapter');
const fingerprintSection = document.querySelector('.ac-fingerprint-chapter');
const SVG_NS = 'http://www.w3.org/2000/svg';
const cleanups = [];
const sessionFor = section => {
  const session=createSectionSession({section,load:loadHeroEvidence,fetchAsset:fetchVerifiedAsset,createURL:blob=>URL.createObjectURL(blob),revokeURL:url=>URL.revokeObjectURL(url)});
  cleanups.push(()=>session.dispose());return session;
};
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const svgEl = (tag, attributes = {}) => {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
};
const decimal = value => Number.isFinite(value)?new Intl.NumberFormat('en-US', {maximumFractionDigits:2}).format(value):'—';
const ratio = values => Array.isArray(values)&&values.length===2&&values.every(Number.isFinite)?values.map(value => value.toFixed(1)).join(' / '):'Not available';
const titleCase = text => text.toLowerCase().replace(/\b\w/g, char => char.toUpperCase());
const number = index => String(index + 1).padStart(2, '0');
const findingName = finding => ({LIGHT_SCRATCH_SCUFF:'Light scratch / scuff',VISIBLE_SCRATCH_PRINT_COATING_LOSS:'Print / coating loss'}[finding.defectType] || titleCase(finding.defectType.replaceAll('_', ' ')));
const pressed = (section, selector, key, side) => section.querySelectorAll(selector).forEach(button => button.setAttribute('aria-pressed', String(button.dataset[key] === side)));
const onNear = (node, callback) => {
  if (!node) return;
  if (!('IntersectionObserver' in window)) { callback(); return; }
  const observer = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); callback(); }
  }, {rootMargin:'450px 0px'});
  observer.observe(node); cleanups.push(() => observer.disconnect());
};

function appendDetails(parent, pairs) {
  const list = el('dl');
  for (const [label, value] of pairs) list.append(el('dt', '', label), el('dd', '', String(value)));
  parent.replaceChildren(list);
}

function makeReportPhoto(manifest, sideName, photoUrl, selectFinding) {
  const side = manifest.sides[sideName];
  const svg = svgEl('svg', {viewBox:`0 0 ${side.original.width} ${side.original.height}`, role:'group', 'aria-label':`${titleCase(sideName)} photograph with selectable recorded findings`});
  svg.append(svgEl('image', {href:photoUrl, x:0, y:0, width:side.original.width, height:side.original.height}));
  const measure = svgEl('g', {class:'ac-centering-instruments',fill:'none', stroke:'#79ff3b', 'stroke-linejoin':'round'});
  const geometry=sideGeometry(side);
  if(geometry){
  measure.append(svgEl('polygon', {points:side.geometry.physicalQuadSource.map(point => point.join(',')).join(' '), 'stroke-width':7}));
  measure.append(svgEl('polygon', {points:side.geometry.printedQuadSource.map(point => point.join(',')).join(' '), 'stroke-width':5, 'stroke-dasharray':'18 12'}));
  const outer = side.geometry.physicalQuadSource;
  const inner = side.geometry.printedQuadSource;
  // The same reference axes as the hero: bisect the saved physical card.
  const midpoint = (a,b) => a.map((value,axis) => (value+b[axis])/2);
  for (const [from,to] of [
    [midpoint(outer[0],outer[1]),midpoint(outer[3],outer[2])],
    [midpoint(outer[0],outer[3]),midpoint(outer[1],outer[2])]
  ]) measure.append(svgEl('path', {class:'ac-card-centerline',d:`M${from.join(' ')}L${to.join(' ')}`,stroke:'#c3ff9c','stroke-width':1.15,'stroke-dasharray':'6 5','vector-effect':'non-scaling-stroke',opacity:.8}));
  // Brackets connect the saved physical and printed edges, not an estimated inset.
  for (let edge = 0; edge < 4; edge++) {
    const next = (edge + 1) % 4;
    const a = outer[edge].map((value, axis) => (value + outer[next][axis]) / 2);
    const b = inner[edge].map((value, axis) => (value + inner[next][axis]) / 2);
    measure.append(svgEl('path', {d:`M${a[0]} ${a[1]}L${b[0]} ${b[1]}`, 'stroke-width':7}));
    for (const point of [a,b]) {
      const horizontal = edge % 2 === 0;
      measure.append(svgEl('path', {d:horizontal ? `M${point[0]-25} ${point[1]}h50` : `M${point[0]} ${point[1]-25}v50`, 'stroke-width':7}));
    }
  }
  }
  svg.append(measure);
  const findings = findingsForSide(manifest, sideName);
  for (const finding of findings) svg.append(svgEl('path', {
    d:traceSvgPath(finding, {space:'source',side}), fill:'#ff1238', 'fill-opacity':.8
  }));
  // Screen-sized controls retain the exact photo anchors at every viewport.
  const locator=svgEl('g',{class:'ac-photo-locators'});svg.append(locator);
  function refresh(){
    const ctm=svg.getScreenCTM(),box=svg.getBoundingClientRect();
    if(!ctm||!box.width||!box.height)return;
    const inverse=ctm.inverse();
    locator.setAttribute('transform',`matrix(${inverse.a} ${inverse.b} ${inverse.c} ${inverse.d} ${inverse.e} ${inverse.f})`);
    const point=([x,y])=>[ctm.a*x+ctm.c*y+ctm.e,ctm.b*x+ctm.d*y+ctm.f];
    const labels=findings.map(finding=>{
      const [x,y]=point(finding.centroidSource);
      return {finding,anchor:[x,y],x:Math.max(box.left+24,Math.min(box.right-24,x+(x<box.left+box.width/2?44:-44))),y:Math.max(box.top+24,Math.min(box.bottom-24,y))};
    }).sort((a,b)=>a.y-b.y);
    for(let i=1;i<labels.length;i++)if(Math.abs(labels[i].x-labels[i-1].x)<50&&labels[i].y-labels[i-1].y<50)labels[i].y=labels[i-1].y+50;
    const over=Math.max(0,(labels.at(-1)?.y||0)-(box.bottom-24));
    for(const label of labels)label.y-=over;
    locator.replaceChildren();
    for(const label of labels){
      const index=manifest.findings.indexOf(label.finding);
      const target=svgEl('g',{class:'ac-photo-finding',role:'button',tabindex:0,'data-finding-id':label.finding.id,'aria-label':`Inspect finding ${number(index)}: ${findingName(label.finding)}`});
      target.append(svgEl('path',{d:`M${label.anchor[0]} ${label.anchor[1]}L${label.x} ${label.y}`,fill:'none',stroke:'#c91934','stroke-width':1}));
      target.append(svgEl('circle',{class:'ac-locator-ring',cx:label.x,cy:label.y,r:22,fill:'#f6f7f4',stroke:'#c91934','stroke-width':1}));
      const text=svgEl('text',{x:label.x,y:label.y+1,fill:'#94102a','font-family':'Oxanium, sans-serif','font-size':12,'font-weight':700,'text-anchor':'middle','dominant-baseline':'central','pointer-events':'none'});text.textContent=number(index);target.append(text);
      target.addEventListener('click',()=>selectFinding?.(label.finding));
      target.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();selectFinding?.(label.finding);}});
      locator.append(target);
    }
  }
  return {svg,refresh};
}

function sectionStatus(section, selector, retry) {
  const status=section.querySelector(selector)||el('p','ac-source-status');
  if(!status.parentNode)section.append(status);
  status.setAttribute('role','status');
  const actions=el('div','ac-sample-actions'),button=el('button','','Try again'),link=el('a','','Open this card’s report ↗');
  button.type='button';button.hidden=true;link.hidden=true;
  button.addEventListener('click',retry);actions.append(button,link);status.after(actions);
  return {
    set(message,error=false){status.textContent=message;button.hidden=!error;},
    bind(manifest){link.href=manifest.report.liveUrl;link.hidden=false;section.dataset.reportKey=manifest.report.bindingKey;}
  };
}
function openFinding(section,manifest,id){
  document.dispatchEvent(new CustomEvent('atlas-open-finding',{detail:sectionFindingDetail(section,manifest,id)}));
}
function observeSize(node,callback){
  if(!node||!('ResizeObserver' in window))return;
  const observer=new ResizeObserver(callback);observer.observe(node);cleanups.push(()=>observer.disconnect());
}
function watchMotion(node,callback){
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');let visible=false;
  const update=()=>callback(visible&&!document.hidden&&!reduced.matches&&!document.documentElement.classList.contains('motion-off'));
  let observer;
  if('IntersectionObserver' in window){observer=new IntersectionObserver(entries=>{visible=entries.some(entry=>entry.isIntersecting);update();});observer.observe(node);}else visible=true;
  document.addEventListener('atlas-motion-change',update);document.addEventListener('visibilitychange',update);reduced.addEventListener('change',update);
  cleanups.push(()=>{observer?.disconnect();document.removeEventListener('atlas-motion-change',update);document.removeEventListener('visibilitychange',update);reduced.removeEventListener('change',update);callback(false);});
  update();return ()=>visible&&!document.hidden&&!reduced.matches&&!document.documentElement.classList.contains('motion-off');
}
function initReport(section){
  const session=sessionFor('report'),q=selector=>section.querySelector(selector);
  const photo=q('.ac-report-photo'),focusPhoto=q('.ac-focus-image');
  if(!photo||!focusPhoto)return;
  let manifest,initPromise,currentSide='FRONT',selectedFinding,focusInstruments,photoInstruments,traceVisible=true;
  const status=sectionStatus(section,'.ac-source-status',()=>initialize());
  const highlight=()=>section.querySelectorAll('[data-finding-id]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.findingId===selectedFinding?.id)));
  function clearFocus(message='No recorded findings on this side.'){
    selectedFinding=null;session.request('focus');focusInstruments?.destroy();focusInstruments=null;
    focusPhoto.replaceChildren();q('.ac-focus-name').textContent=message;
    for(const selector of ['.ac-focus-kicker','.ac-focus-zone','.ac-focus-dimensions','.ac-focus-area'])q(selector).textContent='';
    q('.ac-focus-open').disabled=true;q('.ac-focus-trace').disabled=true;q('.ac-focus').setAttribute('aria-busy','false');highlight();
  }
  async function focusFinding(finding){
    if(!finding){clearFocus();return;}
    clearFocus('Loading the selected finding…');
    const request=session.request('focus');selectedFinding=finding;highlight();
    q('.ac-focus').setAttribute('aria-busy','true');q('.ac-focus-open').disabled=true;
    q('.ac-focus-trace').disabled=true;
    let nextInstruments=null,published=false;
    if(currentSide!==finding.side)await showSide(finding.side);
    try{
      const side=manifest.sides[finding.side],url=await session.asset(side.original,request);
      if(!request.current())return;
      const crop=finding.inspectionCrop;
      const svg=svgEl('svg',{viewBox:`${crop.x} ${crop.y} ${crop.width} ${crop.height}`,'aria-label':`${findingName(finding)}, enlarged original photograph`,role:'group'});
      svg.append(svgEl('image',{href:url,width:side.original.width,height:side.original.height,x:0,y:0}));
      const mask=svgEl('path',{class:'ac-focus-mask',d:traceSvgPath(finding,{space:'source',side}),fill:'#ff1238','fill-opacity':.56});
      mask.style.display=traceVisible?'':'none';svg.append(mask);
      const showRegion=region=>{
        q('.ac-focus-zone').textContent=region?`${titleCase(region.zone)} · Saved measurement`:'Saved trace';
        q('.ac-focus-dimensions').textContent=region?`${decimal(region.measurement.widthMm)} × ${decimal(region.measurement.heightMm)} mm`:'';
        q('.ac-focus-area').textContent=region?`Affected area ${decimal(region.measurement.areaMm2)} mm²`:'';
      };
      if(finding.regions?.length&&manifest.card.widthMm&&manifest.card.heightMm){
        nextInstruments=renderInspectionInstruments(svg,finding,side,manifest.card,{show:true,onRegionChange:region=>{if(published)showRegion(region);}});
        nextInstruments.group.style.display=traceVisible?'':'none';
      }
      if(!request.current()){nextInstruments?.destroy();return;}
      focusInstruments=nextInstruments;focusPhoto.replaceChildren(svg);published=true;
      q('.ac-focus-kicker').textContent=`FINDING ${number(manifest.findings.indexOf(finding))} / ${finding.side}`;
      q('.ac-focus-name').textContent=findingName(finding);showRegion(focusInstruments?.model.regions[0]??null);
      focusInstruments?.refresh();q('.ac-focus-open').disabled=false;q('.ac-focus-trace').disabled=false;
    }catch(error){
      if(!published)nextInstruments?.destroy();
      if(request.current()){clearFocus('This detail could not be loaded. Select the finding to retry.');status.set('The selected detail is temporarily unavailable.',true);}
    }
    finally{if(request.current())q('.ac-focus').setAttribute('aria-busy','false');}
  }
  q('.ac-focus-trace').addEventListener('click',()=>{
    traceVisible=!traceVisible;q('.ac-focus-trace').textContent=traceVisible?'Hide trace':'Show trace';q('.ac-focus-trace').setAttribute('aria-pressed',String(traceVisible));
    const mask=focusPhoto.querySelector('.ac-focus-mask');if(mask)mask.style.display=traceVisible?'':'none';
    if(focusInstruments)focusInstruments.group.style.display=traceVisible?'':'none';
  });
  q('.ac-focus-open').addEventListener('click',()=>{if(selectedFinding)openFinding('report',manifest,selectedFinding.id);});
  let moving=false,animations=[];
  function stopMotion(){for(const animation of animations)animation.cancel();animations=[];}
  function updateMotion(){stopMotion();if(!moving)return;for(const ring of photo.querySelectorAll('.ac-locator-ring'))animations.push(ring.animate([{opacity:.6},{opacity:1}],{duration:2800,easing:'ease-in-out',iterations:Infinity,direction:'alternate'}));}
  watchMotion(photo,enabled=>{moving=enabled;updateMotion();});
  observeSize(photo,()=>{photoInstruments?.refresh();highlight();updateMotion();});
  observeSize(focusPhoto,()=>focusInstruments?.refresh());
  cleanups.push(()=>{stopMotion();focusInstruments?.destroy();});
  async function showSide(sideName){
    const request=session.request('side');currentSide=sideName;pressed(section,'[data-report-side]','reportSide',sideName);
    photo.setAttribute('aria-busy','true');photo.replaceChildren();photoInstruments=null;stopMotion();
    q('.ac-centering').replaceChildren();status.set(`Loading the ${titleCase(sideName)} photograph…`);
    try{
      const side=manifest.sides[sideName],url=await session.asset(side.original,request);
      if(!request.current())return false;
      photoInstruments=makeReportPhoto(manifest,sideName,url,focusFinding);photo.replaceChildren(photoInstruments.svg);photoInstruments.refresh();highlight();updateMotion();
      photo.setAttribute('aria-label',`${titleCase(sideName)} original photograph and ${findingsForSide(manifest,sideName).length} recorded findings`);
      q('.ac-centering').replaceChildren(...[['LEFT / RIGHT',side.centering?.leftRight],['TOP / BOTTOM',side.centering?.topBottom]].map(([label,value])=>{const group=el('div');group.append(el('dt','',label),el('dd','',ratio(value)));return group;}));
      const unavailable=manifest.report.unavailableFindingCount||0;
      status.set(unavailable?`Original photographs and saved findings. ${unavailable} recorded ${unavailable===1?'finding has':'findings have'} no displayable trace; open the full report for details.`:'An approved card, with its original photographs and recorded findings available to explore.');return true;
    }catch(error){if(request.current())status.set('This photograph could not be loaded. Try again or choose the side again.',true);return false;}
    finally{if(request.current())photo.setAttribute('aria-busy','false');}
  }
  async function initialize(){
    if(initPromise)return initPromise;
    initPromise=(async()=>{
      q('.ac-paper').setAttribute('aria-busy','true');
      try{
        manifest=await session.load();status.bind(manifest);const report=manifest.report;
        q('.ac-paper').setAttribute('aria-label',`${report.displayName} approved report preview`);
        q('.ac-card-name').textContent=report.displayName;q('.ac-card-subtitle').textContent=report.subtitle||'';q('.ac-award-value').textContent=String(report.finalGrade??'—');
        q('.ac-subgrades').replaceChildren(...Object.entries(report.subgrades||{}).map(([category,value])=>{const group=el('div','ac-subgrade');group.append(el('span','',titleCase(category)),el('data','',decimal(value)));return group;}));
        q('.ac-finding-count').textContent=`${report.recordedFindingCount??report.findingCount??manifest.findings.length} FINDINGS`;
        q('.ac-findings').setAttribute('aria-label',`Choose any of ${manifest.findings.length} recorded findings`);
        q('.ac-findings').replaceChildren(...manifest.findings.map((finding,index)=>{
          const item=el('li'),button=el('button','ac-finding-button'),copy=el('span','ac-finding-copy');button.type='button';button.dataset.findingId=finding.id;
          copy.append(el('strong','',findingName(finding)),el('small','',titleCase(finding.side)));
          button.append(el('span','ac-finding-number',number(index)),copy);button.setAttribute('aria-label',`Inspect finding ${number(index)}, ${titleCase(finding.side)}, ${findingName(finding)}`);
          button.addEventListener('click',()=>focusFinding(finding));item.append(button);return item;
        }));
        q('.ac-format').textContent=manifest.card.widthMm&&manifest.card.heightMm?`Card format · ${manifest.card.widthMm} × ${manifest.card.heightMm} mm`:'Saved card photographs';
        q('.ac-record-reference').textContent=`Approved card · ${report.reportNumber}`;
        const details=[['Awarded grade',report.finalGrade],...Object.entries(report.subgrades||{}).map(([key,value])=>[`${titleCase(key)} — stored value`,value])];
        for(const side of ['FRONT','BACK'])details.push([`${titleCase(side)} left / right`,ratio(manifest.sides[side].centering?.leftRight)],[`${titleCase(side)} top / bottom`,ratio(manifest.sides[side].centering?.topBottom)]);
        details.push(['Report number',report.reportNumber],['Approved at',report.approvedAt],['Report hash',report.reportHash]);appendDetails(q('.ac-precision-content'),details);
        if(await showSide(currentSide))await focusFinding(findingsForSide(manifest,currentSide)[0]);
      }catch(error){if(error.name!=='AbortError')status.set('The approved card is temporarily unavailable. Try again.',true);}
      finally{q('.ac-paper').setAttribute('aria-busy','false');initPromise=null;}
    })();return initPromise;
  }
  for(const button of section.querySelectorAll('[data-report-side]'))button.addEventListener('click',async()=>{
    currentSide=button.dataset.reportSide;clearFocus('Loading this side…');
    if(!manifest){await initialize();return;}if(await showSide(currentSide))await focusFinding(findingsForSide(manifest,currentSide)[0]);
  });
  clearFocus('Select a finding to explore its detail.');onNear(section,initialize);
}

// Exact saved traces remain selectable if optional fingerprint artwork is unavailable.
async function fingerprintPhoto(session,manifest,sideName,request,{selectable=false}={}){
  const side=manifest.sides[sideName],photo=await session.asset(side.original,request),crop=side.originalCardCrop;
  const svg=svgEl('svg',{viewBox:`${crop.x} ${crop.y} ${crop.width} ${crop.height}`,role:'group','aria-label':`${titleCase(sideName)} photograph and recorded marks`});
  svg.append(svgEl('image',{class:'ac-fingerprint-photo',href:photo,x:0,y:0,width:side.original.width,height:side.original.height}));
  const field=svgEl('g',{class:'ac-fingerprint-field'});let optionalFailure=false;
  try{const url=await session.asset(side.fingerprint,request);field.append(svgEl('image',{href:url,x:crop.x,y:crop.y,width:crop.width,height:crop.height}));}
  catch(error){if(error.name==='AbortError')throw error;optionalFailure=true;for(const finding of findingsForSide(manifest,sideName))field.append(svgEl('path',{d:traceSvgPath(finding,{space:'source',side}),fill:'#ff1238',stroke:'none','fill-opacity':.8}));}
  svg.append(field);
  if(selectable)for(const finding of findingsForSide(manifest,sideName)){
    const index=manifest.findings.indexOf(finding),target=svgEl('g',{role:'button',tabindex:0,'aria-label':`Inspect finding ${number(index)}: ${findingName(finding)}`});
    const [cx,cy]=finding.centroidSource;target.append(svgEl('circle',{cx,cy,r:28,fill:'transparent',stroke:'none'}));
    const select=()=>openFinding(session.section,manifest,finding.id);target.addEventListener('click',select);target.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();select();}});svg.append(target);
  }
  return {svg,photo,optionalFailure};
}
function initFingerprint(section){
  const session=sessionFor('fingerprint'),q=selector=>section.querySelector(selector),stage=q('.ac-fingerprint-stage');if(!stage)return;
  stage.setAttribute('role','group');
  let manifest,initPromise,currentSide='FRONT',overlay=true,reveal;
  const status=sectionStatus(section,'.ac-fingerprint-status',()=>initialize());
  const stopReveal=()=>{reveal?.cancel();reveal=null;};
  const canMove=watchMotion(stage,enabled=>{if(!enabled)stopReveal();});
  function replay(){
    stopReveal();overlay=true;stage.dataset.overlay='true';q('.ac-overlay-toggle').setAttribute('aria-pressed','true');q('.ac-overlay-toggle').textContent='Fingerprint on';
    const field=stage.querySelector('.ac-fingerprint-field');if(!field||!canMove()||!findingsForSide(manifest,currentSide).length)return;
    reveal=field.animate([{opacity:0},{opacity:1}],{duration:1400,easing:'ease-out'});
  }
  const choices=el('div','ac-fingerprint-findings');choices.setAttribute('role','group');choices.setAttribute('aria-label','Inspect a recorded finding');q('.ac-fingerprint-controls').after(choices);
  async function showSide(sideName){
    const request=session.request('side');currentSide=sideName;stopReveal();pressed(section,'[data-fingerprint-side]','fingerprintSide',sideName);stage.setAttribute('aria-busy','true');stage.replaceChildren();choices.replaceChildren();
    q('.ac-fingerprint-caption').textContent=`Loading ${titleCase(sideName)}…`;
    q('.ac-fingerprint-count').textContent='—';q('.ac-marked-area').textContent='—';
    q('.ac-overlay-toggle').disabled=true;q('.ac-replay').disabled=true;status.set(`Loading the ${titleCase(sideName)} photograph and fingerprint…`);
    try{
      const result=await fingerprintPhoto(session,manifest,sideName,request,{selectable:true});if(!request.current())return;
      stage.replaceChildren(result.svg);stage.dataset.overlay=String(overlay);
      q('.ac-fingerprint-caption').textContent=`${manifest.report.displayName.toUpperCase()} / ${sideName}`;
      const findings=findingsForSide(manifest,sideName);q('.ac-fingerprint-count').textContent=String(findings.length);
      const area=fingerprintArea(manifest,manifest.sides[sideName]);q('.ac-marked-area').textContent=area===null?'Not available':`${decimal(area)} mm²`;
      q('.ac-overlay-toggle').disabled=false;q('.ac-replay').disabled=!findings.length;
      choices.replaceChildren(...findings.map(finding=>{const button=el('button','',number(manifest.findings.indexOf(finding)));button.type='button';button.setAttribute('aria-label',`Inspect ${findingName(finding)}`);button.addEventListener('click',()=>openFinding('fingerprint',manifest,finding.id));return button;}));
      status.set(!findings.length?`${titleCase(sideName)} · No recorded findings on this side.`:result.optionalFailure?'Fingerprint artwork is temporarily unavailable. Exact saved marks are shown; try again to load the pattern.':`${titleCase(sideName)} · This card’s saved ATLAS fingerprint.`,result.optionalFailure);
    }catch(error){if(request.current())status.set('This fingerprint could not be loaded. Try again or choose the side again.',true);}
    finally{if(request.current())stage.setAttribute('aria-busy','false');}
  }
  async function initialize(){if(initPromise)return initPromise;initPromise=(async()=>{try{manifest=await session.load();status.bind(manifest);await showSide(currentSide);}catch(error){if(error.name!=='AbortError')status.set('The approved card is temporarily unavailable. Try again.',true);}finally{initPromise=null;}})();return initPromise;}
  for(const button of section.querySelectorAll('[data-fingerprint-side]'))button.addEventListener('click',async()=>{currentSide=button.dataset.fingerprintSide;if(!manifest)await initialize();else await showSide(currentSide);});
  q('.ac-replay').addEventListener('click',async()=>{if(!manifest)await initialize();if(manifest)replay();});
  q('.ac-overlay-toggle').addEventListener('click',()=>{stopReveal();overlay=!overlay;stage.dataset.overlay=String(overlay);q('.ac-overlay-toggle').setAttribute('aria-pressed',String(overlay));q('.ac-overlay-toggle').textContent=overlay?'Fingerprint on':'Show fingerprint';});
  onNear(section,initialize);
}
function initConnected(section){
  const connected=section.querySelector('.connected-record');if(!connected)return;
  const session=sessionFor('connected'),q=selector=>connected.querySelector(selector);
  let manifest,initPromise,currentSide='FRONT';
  const status=sectionStatus(section,'.technology-note',()=>initialize());
  const toolbar=el('div','connected-compare'),caption=el('p','','Loading the approved card…'),switches=el('div','connected-side-switch');caption.setAttribute('aria-live','polite');switches.setAttribute('role','group');switches.setAttribute('aria-label','Compare card and fingerprint side');toolbar.append(caption,switches);connected.before(toolbar);
  for(const side of ['FRONT','BACK']){const button=el('button','',titleCase(side));button.type='button';button.dataset.connectedSide=side;button.setAttribute('aria-pressed',String(side==='FRONT'));button.addEventListener('click',async()=>{currentSide=side;if(!manifest)await initialize();else await showSide(side);});switches.append(button);}
  async function showSide(sideName){
    const request=session.request('side');currentSide=sideName;pressed(switches,'[data-connected-side]','connectedSide',sideName);connected.setAttribute('aria-busy','true');caption.textContent=`Loading ${titleCase(sideName)}…`;
    q('.connected-card').removeAttribute('src');q('.connected-card').alt='';q('.connected-print svg').replaceChildren();status.set(`Loading the ${titleCase(sideName)} photograph and fingerprint…`);
    try{
      const result=await fingerprintPhoto(session,manifest,sideName,request,{selectable:true});if(!request.current())return;
      const original=manifest.sides[sideName].original,card=q('.connected-card');card.src=result.photo;card.width=original.width;card.height=original.height;card.alt=`${manifest.report.displayName} ${titleCase(sideName)} original photograph, grade ${manifest.report.finalGrade}`;
      q('.connected-print svg').replaceWith(result.svg);
      const count=findingsForSide(manifest,sideName).length;caption.textContent=`${titleCase(sideName)} photograph + ${count? 'its fingerprint':'no recorded findings'}`;
      status.set(result.optionalFailure?'Fingerprint artwork is temporarily unavailable. Exact saved marks are shown; try again to load the pattern.':'The photographs, findings and fingerprint belong to this same approved card.',result.optionalFailure);
    }catch(error){if(request.current()){caption.textContent='This side could not be loaded.';status.set('The approved card could not be loaded. Try again or choose the side again.',true);}}
    finally{if(request.current())connected.setAttribute('aria-busy','false');}
  }
  async function initialize(){if(initPromise)return initPromise;initPromise=(async()=>{try{
    manifest=await session.load();status.bind(manifest);q('.connected-name').textContent=manifest.report.displayName;q('.connected-top small').textContent='APPROVED CARD';q('.connected-report-body .eyebrow').textContent=`AWARDED GRADE ${manifest.report.finalGrade}`;
    q('.connected-findings').replaceChildren(...manifest.findings.map(finding=>{const row=el('p'),button=el('button','connected-finding',`${titleCase(finding.side)} · ${findingName(finding)} ↗`);button.type='button';button.addEventListener('click',()=>openFinding('connected',manifest,finding.id));row.append(button);return row;}));
    if(!manifest.findings.length)q('.connected-findings').append(el('p','','No recorded findings.'));
    for(const id of connected.querySelectorAll('.connected-id'))id.textContent=manifest.report.reportNumber;
    await showSide(currentSide);
  }catch(error){if(error.name!=='AbortError')status.set('The approved card is temporarily unavailable. Try again.',true);}finally{initPromise=null;}})();return initPromise;}
  onNear(section,initialize);
}
if(reportSection)initReport(reportSection);
if(fingerprintSection)initFingerprint(fingerprintSection);
const connectedSection=document.querySelector('#connected-proof');if(connectedSection)initConnected(connectedSection);
function releaseContinuation(event){if(event.persisted)return;window.removeEventListener('pagehide',releaseContinuation);for(const cleanup of cleanups)cleanup();}
window.addEventListener('pagehide',releaseContinuation);
