import {loadHeroEvidence, fetchVerifiedAsset, findingsForSide, traceSvgPath} from '/homepage/c6d8946d5ff927f5/hero-evidence.mjs';
import {renderInspectionInstruments} from '/homepage/c6d8946d5ff927f5/hero-metrology.mjs';

// Read-only presentation of the retained, approved report. No grade is recomputed.
const reportSection = document.querySelector('.ac-report-chapter');
const fingerprintSection = document.querySelector('.ac-fingerprint-chapter');
const SVG_NS = 'http://www.w3.org/2000/svg';
const blobCache = new Map();
const urls = new Set();
const cleanups = [];
let evidencePromise;
const evidence = () => evidencePromise ||= loadHeroEvidence();
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
const decimal = value => new Intl.NumberFormat('en-US', {maximumFractionDigits:2}).format(value);
const ratio = values => values.map(value => value.toFixed(1)).join(' / ');
const titleCase = text => text.toLowerCase().replace(/\b\w/g, char => char.toUpperCase());
const number = index => String(index + 1).padStart(2, '0');
const findingName = finding => ({LIGHT_SCRATCH_SCUFF:'Light scratch / scuff',VISIBLE_SCRATCH_PRINT_COATING_LOSS:'Print / coating loss'}[finding.defectType] || titleCase(finding.defectType.replaceAll('_', ' ')));
const pressed = (section, selector, key, side) => section.querySelectorAll(selector).forEach(button => button.setAttribute('aria-pressed', String(button.dataset[key] === side)));
const assetUrl = asset => {
  if (!blobCache.has(asset.sha256)) blobCache.set(asset.sha256, fetchVerifiedAsset(asset).then(blob => {
    const url = URL.createObjectURL(blob); urls.add(url); return url;
  }).catch(error => { blobCache.delete(asset.sha256); throw error; }));
  return blobCache.get(asset.sha256);
};
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

function initReport(section) {
  let initPromise, manifest, currentSide='FRONT', request=0;
  let selectedFinding,focusRequest=0,focusInstruments,traceVisible=true,photoInstruments;
  const q = selector => section.querySelector(selector);
  const photo=q('.ac-report-photo');
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  const focusPhoto=q('.ac-focus-image');
  const focusResize=new ResizeObserver(()=>focusInstruments?.refresh());focusResize.observe(focusPhoto);
  const photoResize=new ResizeObserver(()=>{stopInstruments();photoInstruments?.refresh();highlightSelected();syncInstruments();});photoResize.observe(photo);
  cleanups.push(()=>{photoResize.disconnect();focusResize.disconnect();focusInstruments?.destroy();});
  function highlightSelected(){
    section.querySelectorAll('[data-finding-id]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.findingId===selectedFinding?.id)));
  }
  async function focusFinding(finding){
    if(!finding)return;
    selectedFinding=finding;const token=++focusRequest;
    highlightSelected();q('.ac-focus').setAttribute('aria-busy','true');
    const side=manifest.sides[finding.side];
    if(currentSide!==finding.side)showSide(finding.side);
    try{
      const url=await assetUrl(side.original);if(token!==focusRequest)return;
      focusInstruments?.destroy();
      const crop=finding.inspectionCrop;
      const svg=svgEl('svg',{viewBox:`${crop.x} ${crop.y} ${crop.width} ${crop.height}`,'aria-label':`${findingName(finding)}, enlarged original photograph`,role:'group'});
      svg.append(svgEl('image',{href:url,width:side.original.width,height:side.original.height,x:0,y:0}));
      const mask=svgEl('path',{class:'ac-focus-mask',d:traceSvgPath(finding,{space:'source',side}),fill:'#ff1238','fill-opacity':.56});
      mask.style.display=traceVisible?'':'none';svg.append(mask);focusPhoto.replaceChildren(svg);
      const index=manifest.findings.indexOf(finding);
      q('.ac-focus-kicker').textContent=`FINDING ${number(index)} / ${finding.side}`;
      q('.ac-focus-name').textContent=findingName(finding);
      function showRegion(region){
        q('.ac-focus-zone').textContent=`${titleCase(region.zone)} · Saved measurement`;
        q('.ac-focus-dimensions').textContent=`${decimal(region.measurement.widthMm)} × ${decimal(region.measurement.heightMm)} mm`;
        q('.ac-focus-area').textContent=`Affected area ${decimal(region.measurement.areaMm2)} mm²`;
      }
      focusInstruments=renderInspectionInstruments(svg,finding,side,manifest.card,{show:true,onRegionChange:showRegion});
      focusInstruments.group.style.display=traceVisible?'':'none';showRegion(focusInstruments.model.regions[0]);
      if(!reduced.matches&&!document.documentElement.classList.contains('motion-off'))focusPhoto.animate([{opacity:.55},{opacity:1}],{duration:250,easing:'ease-out'});
    }catch(error){q('.ac-focus-name').textContent='This detail could not be loaded. Select the finding to retry.';console.error('ATLAS inline detail:',error);}
    finally{if(token===focusRequest)q('.ac-focus').setAttribute('aria-busy','false');}
  }
  q('.ac-focus-trace').addEventListener('click',()=>{
    traceVisible=!traceVisible;q('.ac-focus-trace').textContent=traceVisible?'Hide trace':'Show trace';q('.ac-focus-trace').setAttribute('aria-pressed',String(traceVisible));
    const mask=focusPhoto.querySelector('.ac-focus-mask');if(mask)mask.style.display=traceVisible?'':'none';
    if(focusInstruments)focusInstruments.group.style.display=traceVisible?'':'none';
  });
  q('.ac-focus-open').addEventListener('click',()=>{if(selectedFinding)document.dispatchEvent(new CustomEvent('atlas-open-finding',{detail:{id:selectedFinding.id}}));});
  let visible=false,activeSvg=null,instrumentAnimations=[];
  function stopInstruments(){for(const animation of instrumentAnimations)animation.cancel();instrumentAnimations=[];activeSvg=null;}
  function syncInstruments(){
    const svg=photo.querySelector('svg');
    if(!svg||!visible||document.hidden||reduced.matches||document.documentElement.classList.contains('motion-off')){stopInstruments();return;}
    if(activeSvg===svg)return;
    stopInstruments();activeSvg=svg;
    // Only the measuring overlay and locator circles move in opacity. Source photograph,
    // exact red mask paths, locator numbers and leader lines remain fully static.
    instrumentAnimations.push(svg.querySelector('.ac-centering-instruments').animate([{opacity:.5},{opacity:1}],{duration:1900,easing:'ease-out'}));
    for(const ring of svg.querySelectorAll('.ac-locator-ring'))instrumentAnimations.push(ring.animate([{opacity:.6},{opacity:1}],{duration:2800,easing:'ease-in-out',iterations:Infinity,direction:'alternate'}));
  }
  let instrumentObserver;
  if('IntersectionObserver' in window){instrumentObserver=new IntersectionObserver(entries=>{visible=entries.some(entry=>entry.isIntersecting);syncInstruments();});instrumentObserver.observe(photo);}else visible=true;
  document.addEventListener('atlas-motion-change',syncInstruments);document.addEventListener('visibilitychange',syncInstruments);reduced.addEventListener('change',syncInstruments);
  cleanups.push(()=>{stopInstruments();instrumentObserver?.disconnect();document.removeEventListener('atlas-motion-change',syncInstruments);document.removeEventListener('visibilitychange',syncInstruments);reduced.removeEventListener('change',syncInstruments);});
  async function showSide(sideName) {
    const token = ++request;
    currentSide = sideName;
    pressed(section,'[data-report-side]','reportSide',sideName);
    q('.ac-report-photo').setAttribute('aria-busy','true');
    try {
      const side = manifest.sides[sideName];
      const url = await assetUrl(side.original);
      if (token !== request) return;
      photoInstruments=makeReportPhoto(manifest,sideName,url,focusFinding);
      q('.ac-report-photo').replaceChildren(photoInstruments.svg);photoInstruments.refresh();highlightSelected();
      syncInstruments();
      q('.ac-report-photo').setAttribute('aria-label',`${titleCase(sideName)} original photograph, saved card and printed-border centering geometry, and all ${findingsForSide(manifest,sideName).length} recorded findings`);
      const pairs = [['LEFT / RIGHT',side.centering.leftRight],['TOP / BOTTOM',side.centering.topBottom]];
      const fragments = pairs.map(([label,value]) => {
        const group = el('div');const dd=el('dd','',ratio(value));dd.title=value.join(' / ');
        group.append(el('dt','',label),dd);return group;
      });
      q('.ac-centering').replaceChildren(...fragments);
      q('.ac-source-status').textContent='An approved sample, with the original photographs and every recorded finding available to explore.';
    } catch (error) { q('.ac-source-status').textContent='This photograph could not be loaded. Choose the side again to retry.';console.error('ATLAS report photograph:',error); }
    finally { if(token===request)q('.ac-report-photo').setAttribute('aria-busy','false'); }
  }
  async function initialize() {
    try {
      manifest = await evidence();
      const report=manifest.report;
      q('.ac-card-name').textContent=report.displayName;
      q('.ac-card-subtitle').textContent=report.subtitle;
      q('.ac-award-value').textContent=String(report.finalGrade);
      q('.ac-subgrades').replaceChildren(...Object.entries(report.subgrades).map(([category,value])=>{
        const group=el('div','ac-subgrade');const score=el('data','',decimal(value));score.value=String(value);score.title=`Stored value: ${value}`;
        group.append(el('span','',titleCase(category)),score);return group;
      }));
      q('.ac-finding-count').textContent=`${report.findingCount} FINDINGS`;
      q('.ac-findings').replaceChildren(...manifest.findings.map((finding,index)=>{
        const item=el('li');const button=el('button','ac-finding-button');button.type='button';button.dataset.findingId=finding.id;
        const copy=el('span','ac-finding-copy');
        copy.append(el('strong','',findingName(finding)),el('small','',titleCase(finding.side)));
        for (const region of finding.regions) copy.append(el('span','',`${titleCase(region.zone)} · ${decimal(region.measurement.widthMm)} × ${decimal(region.measurement.heightMm)} mm`));
        const arrow=el('span','ac-finding-arrow','↗');arrow.setAttribute('aria-hidden','true');
        button.append(el('span','ac-finding-number',number(index)),copy,arrow);
        button.setAttribute('aria-label',`Inspect finding ${number(index)}, ${titleCase(finding.side)}, ${findingName(finding)}`);
        button.title=`${number(index)} / ${titleCase(finding.side)} / ${findingName(finding)}`;
        button.addEventListener('click',()=>focusFinding(finding));
        item.append(button);return item;
      }));
      q('.ac-format').textContent=`Sports card format · ${manifest.card.widthMm} × ${manifest.card.heightMm} mm`;
      q('.ac-record-reference').textContent=`Approved sample · ${report.reportNumber}`;
      const details = [['Awarded grade',report.finalGrade],...Object.entries(report.subgrades).map(([key,value])=>[`${titleCase(key)} — stored value`,value])];
      for(const sideName of ['FRONT','BACK']){
        const centering=manifest.sides[sideName].centering;
        details.push([`${titleCase(sideName)} left / right`,centering.leftRight.join(' / ')],[`${titleCase(sideName)} top / bottom`,centering.topBottom.join(' / ')]);
      }
      details.push(['Profile dimensions',`${manifest.card.widthMm} × ${manifest.card.heightMm} mm`],['Report number',report.reportNumber],['Approved at',report.approvedAt],['Report hash',report.reportHash]);
      appendDetails(q('.ac-precision-content'),details);
      q('.ac-paper').setAttribute('aria-busy','false');
      await showSide(currentSide);
      await focusFinding(manifest.findings[0]);
    } catch(error){q('.ac-source-status').textContent='The approved sample is temporarily unavailable. Reload to try again.';q('.ac-paper').setAttribute('aria-busy','false');console.error('ATLAS report sample:',error);}
  }
  const ensure = () => initPromise ||= initialize();
  for(const button of section.querySelectorAll('[data-report-side]')) button.addEventListener('click',async()=>{await ensure();if(manifest){await showSide(button.dataset.reportSide);await focusFinding(findingsForSide(manifest,button.dataset.reportSide)[0]);}});
  onNear(section,ensure);
}

function initFingerprint(section) {
  let initPromise,manifest,currentSide='FRONT',request=0,overlay=true,reveal,visible=false;
  const q=selector=>section.querySelector(selector);
  const stage=q('.ac-fingerprint-stage');stage.dataset.overlay='true';
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  function stopReveal(){reveal?.cancel();reveal=null;}
  function replay(){
    stopReveal();
    overlay=true;stage.dataset.overlay='true';q('.ac-overlay-toggle').setAttribute('aria-pressed','true');q('.ac-overlay-toggle').textContent='Fingerprint on';
    const field=stage.querySelector('.ac-fingerprint-field');
    if(!field||!visible||document.hidden||reduced.matches||document.documentElement.classList.contains('motion-off'))return;
    const origin=findingsForSide(manifest,currentSide)[0]?.centroidCanonical||[635,889];
    const anchor=`${origin[0]/manifest.card.canonicalWidth*100}% ${origin[1]/manifest.card.canonicalHeight*100}%`;
    // A light sweep reveals the already verified field. It never moves or redraws contours.
    reveal=field.animate([{clipPath:`circle(0% at ${anchor})`},{clipPath:`circle(155% at ${anchor})`}],{duration:2600,easing:'cubic-bezier(.22,.7,.28,1)'});
  }
  async function showSide(sideName,animate=false){
    const token=++request;currentSide=sideName;stopReveal();pressed(section,'[data-fingerprint-side]','fingerprintSide',sideName);stage.setAttribute('aria-busy','true');
    try{
      const side=manifest.sides[sideName];
      const [photoUrl,fieldUrl]=await Promise.all([assetUrl(side.original),assetUrl(side.fingerprint)]);
      if(token!==request)return;
      const crop=side.originalCardCrop;
      const svg=svgEl('svg',{viewBox:`${crop.x} ${crop.y} ${crop.width} ${crop.height}`,'aria-hidden':'true'});
      // Both layers share the exact source-card crop; no photo alteration or fake wave field.
      svg.append(svgEl('image',{class:'ac-fingerprint-photo',href:photoUrl,x:0,y:0,width:side.original.width,height:side.original.height}));
      svg.append(svgEl('image',{class:'ac-fingerprint-field',href:fieldUrl,x:crop.x,y:crop.y,width:crop.width,height:crop.height}));
      stage.replaceChildren(svg);stage.setAttribute('aria-label',`${titleCase(sideName)} photograph of ${manifest.report.displayName} with its saved ATLAS fingerprint`);
      q('.ac-fingerprint-caption').textContent=`${manifest.report.displayName.toUpperCase()} / ${sideName}`;
      q('.ac-fingerprint-count').textContent=String(side.fingerprint.includedFindings);
      const area=side.fingerprint.occupiedPixels*(manifest.card.widthMm/manifest.card.canonicalWidth)*(manifest.card.heightMm/manifest.card.canonicalHeight);
      q('.ac-marked-area').textContent=`${decimal(area)} mm²`;q('.ac-marked-area').title=`${area} mm² recorded area`;
      q('.ac-fingerprint-status').textContent=`${titleCase(sideName)} · This card’s saved ATLAS fingerprint.`;
      if(animate)replay();
    }catch(error){q('.ac-fingerprint-status').textContent='This fingerprint could not be loaded. Choose the side again to retry.';console.error('ATLAS fingerprint:',error);}
    finally{if(token===request)stage.setAttribute('aria-busy','false');}
  }
  async function initialize(){try{manifest=await evidence();await showSide(currentSide);}catch(error){q('.ac-fingerprint-status').textContent='The fingerprint is temporarily unavailable. Reload to try again.';console.error('ATLAS fingerprint sample:',error);}}
  const ensure=()=>initPromise ||= initialize();
  for(const button of section.querySelectorAll('[data-fingerprint-side]'))button.addEventListener('click',async()=>{await ensure();if(manifest)showSide(button.dataset.fingerprintSide);});
  q('.ac-replay').addEventListener('click',async()=>{await ensure();replay();});
  q('.ac-overlay-toggle').addEventListener('click',async()=>{await ensure();stopReveal();overlay=!overlay;stage.dataset.overlay=String(overlay);q('.ac-overlay-toggle').setAttribute('aria-pressed',String(overlay));q('.ac-overlay-toggle').textContent=overlay?'Fingerprint on':'Show fingerprint';});
  const finishWhenHidden=()=>{if(document.hidden)stopReveal();};document.addEventListener('visibilitychange',finishWhenHidden);
  const stopOnPreference=()=>{if(reduced.matches)stopReveal();};reduced.addEventListener('change',stopOnPreference);
  const onMotionChange=()=>{if(document.documentElement.classList.contains('motion-off'))stopReveal();};document.addEventListener('atlas-motion-change',onMotionChange);
  let visibleObserver;
  if('IntersectionObserver' in window){visibleObserver=new IntersectionObserver(entries=>{visible=entries.some(entry=>entry.isIntersecting);if(!visible)stopReveal();});visibleObserver.observe(stage);}else visible=true;
  cleanups.push(()=>{stopReveal();visibleObserver?.disconnect();document.removeEventListener('visibilitychange',finishWhenHidden);document.removeEventListener('atlas-motion-change',onMotionChange);reduced.removeEventListener('change',stopOnPreference);});
  onNear(section,ensure);
}

if(reportSection)initReport(reportSection);
if(fingerprintSection)initFingerprint(fingerprintSection);

// Preserve the existing connection chapter layout while carrying the same approved card
// through its phone, slab and paired record. The hardware remains an illustrative scene.
function initConnectedContinuity() {
  const nfc=document.querySelector('.nfc-experience');
  const connected=document.querySelector('.connected-record');
  const phone=document.querySelector('.phone-report');
  if(!connected&&!phone)return;
  // Retire illustrative values immediately, including the failed-load case.
  if(connected){
    connected.setAttribute('aria-busy','true');
    connected.querySelector('.connected-card').removeAttribute('src');connected.querySelector('.connected-card').alt='';
    connected.querySelector('.connected-name').textContent='Approved sample';
    connected.querySelector('.connected-top small').textContent='APPROVED SAMPLE';
    connected.querySelector('.connected-findings').replaceChildren();connected.querySelector('.connected-print svg').replaceChildren();
    for(const id of connected.querySelectorAll('.connected-id'))id.textContent='';
    const note=connected.closest('#connected-proof')?.querySelector('.technology-note');if(note)note.textContent='The approved card’s photograph, findings and fingerprint share one saved record.';
  }
  if(phone){phone.querySelector('img').removeAttribute('src');phone.querySelector('strong').textContent='—';phone.querySelector(':scope > div > span').textContent='APPROVED SAMPLE';for(const row of phone.querySelectorAll(':scope > p'))row.textContent='';}
  let promise;
  const ensure=()=>promise ||= (async()=>{
    const manifest=await evidence();
    const front=manifest.sides.FRONT;
    const [presentationUrl,originalUrl,fingerprintUrl]=await Promise.all([assetUrl(front.presentation),assetUrl(front.original),assetUrl(front.fingerprint)]);
    if(connected){
      connected.querySelector('.connected-card').src=presentationUrl;
      connected.querySelector('.connected-card').alt=`${manifest.report.displayName} front photograph, approved grade ${manifest.report.finalGrade}`;
      connected.querySelector('.connected-name').textContent=manifest.report.displayName;
      connected.querySelector('.connected-top small').textContent='APPROVED SAMPLE';
      connected.querySelector('.connected-report-body .eyebrow').textContent=`AWARDED GRADE ${manifest.report.finalGrade}`;
      const summaries=new Map();
      for(const finding of manifest.findings){const label=`${finding.side} / ${finding.defectType==='LIGHT_SCRATCH_SCUFF'?'SCRATCH / SCUFF':'COATING LOSS'}`;summaries.set(label,(summaries.get(label)||0)+1);}
      connected.querySelector('.connected-findings').replaceChildren(...[...summaries].map(([label,count])=>{
        const row=el('p');row.append(el('span','',label),el('b','',`${count} ${count===1?'finding':'findings'}`));return row;
      }));
      for(const id of connected.querySelectorAll('.connected-id')){const key=el('b','connected-key',manifest.report.reportNumber);id.replaceChildren(document.createTextNode('REPORT '),key);}
      const field=connected.querySelector('.connected-print svg');
      const crop=front.originalCardCrop;
      field.setAttribute('viewBox',`${crop.x} ${crop.y} ${crop.width} ${crop.height}`);
      field.setAttribute('aria-label',`${manifest.report.displayName} front photograph and its actual fingerprint from the approved report`);
      field.setAttribute('overflow','hidden');
      field.replaceChildren(svgEl('image',{href:originalUrl,x:0,y:0,width:front.original.width,height:front.original.height,opacity:.67}),svgEl('image',{href:fingerprintUrl,x:crop.x,y:crop.y,width:crop.width,height:crop.height}));
      // Compare either side against its own saved pattern. No new evidence is generated.
      const toolbar=el('div','connected-compare');
      const caption=el('p','','Front photograph + its fingerprint');caption.setAttribute('aria-live','polite');
      const switches=el('div','connected-side-switch');switches.setAttribute('role','group');switches.setAttribute('aria-label','Compare the saved card and fingerprint');
      let sideRequest=0,disposed=false;
      for(const side of ['FRONT','BACK']){
        const button=el('button','',titleCase(side));button.type='button';button.dataset.connectedSide=side;button.setAttribute('aria-pressed',String(side==='FRONT'));
        button.addEventListener('click',async()=>{
          const request=++sideRequest;const saved=manifest.sides[side];caption.textContent=`Loading ${side.toLowerCase()}…`;
          try{
            const [photo,original,pattern]=await Promise.all([assetUrl(saved.presentation),assetUrl(saved.original),assetUrl(saved.fingerprint)]);
            if(disposed||request!==sideRequest)return;
            const bounds=saved.originalCardCrop,card=connected.querySelector('.connected-card');card.src=photo;card.alt=`${manifest.report.displayName} ${side.toLowerCase()} photograph, approved grade ${manifest.report.finalGrade}`;
            field.setAttribute('viewBox',`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`);
            field.setAttribute('aria-label',`${manifest.report.displayName} ${side.toLowerCase()} photograph and its actual fingerprint from the approved report`);
            field.replaceChildren(svgEl('image',{href:original,x:0,y:0,width:saved.original.width,height:saved.original.height,opacity:.67}),svgEl('image',{href:pattern,x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height}));
            pressed(switches,'[data-connected-side]','connectedSide',side);
            caption.textContent=`${titleCase(side)} photograph + its fingerprint`;
          }catch{if(request===sideRequest)caption.textContent='That side could not be loaded. Please try again.';}
        });switches.append(button);
      }
      toolbar.append(caption,switches);connected.before(toolbar);cleanups.push(()=>{disposed=true;sideRequest++;});
      const note=connected.closest('#connected-proof')?.querySelector('.technology-note');
      if(note)note.textContent='Approved Drake Maye sample report. The photograph, seven findings and fingerprint belong to the same saved record.';
      connected.setAttribute('aria-busy','false');
    }
    if(phone){
      phone.querySelector(':scope > span').textContent='ATLAS / APPROVED SAMPLE';
      phone.querySelector('img').src=presentationUrl;
      phone.querySelector('img').alt=`${manifest.report.displayName}, approved grade ${manifest.report.finalGrade}`;
      phone.querySelector('strong').textContent=String(manifest.report.finalGrade);
      phone.querySelector(':scope > div > span').replaceChildren(document.createTextNode(manifest.report.displayName.toUpperCase()),el('small','','APPROVED SAMPLE'));
      const rows=[['CENTERING',decimal(manifest.report.subgrades.centering)],['CORNERS / EDGES',`${decimal(manifest.report.subgrades.corners)} / ${decimal(manifest.report.subgrades.edges)}`],['SURFACE',decimal(manifest.report.subgrades.surface)]];
      [...phone.querySelectorAll(':scope > p')].forEach((row,index)=>row.replaceChildren(document.createTextNode(`${rows[index][0]} `),el('b','',rows[index][1])));
    }
    // Legacy NFC initialization reads this image before its event listener is installed.
    const legacyPhoto=document.querySelector('.hc-legacy .fingerprint-photo');
    if(legacyPhoto){legacyPhoto.src=presentationUrl;legacyPhoto.alt=`${manifest.report.displayName}, approved sample`;}
    if(nfc){
      const send=()=>nfc.dispatchEvent(new CustomEvent('atlas-nfc-specimen',{detail:{image:presentationUrl,name:manifest.report.displayName}}));
      send();
      const host=nfc.querySelector('#nfc-stage');
      if(host&&!host.classList.contains('has-canvas')){
        const observer=new MutationObserver(()=>{if(host.classList.contains('has-canvas')){observer.disconnect();send();}});
        observer.observe(host,{attributes:true,attributeFilter:['class']});cleanups.push(()=>observer.disconnect());
      }
    }
  })().catch(error=>{if(connected){connected.setAttribute('aria-busy','false');const note=connected.closest('#connected-proof')?.querySelector('.technology-note');if(note)note.textContent='The approved sample could not be loaded. Reload to try again.';}console.error('ATLAS connected sample:',error);});
  onNear(nfc||connected,ensure);
  if(connected)onNear(connected,ensure);
}
initConnectedContinuity();
// These retained short previews are illustrative; the kiosk depicts the future dropbox.
for(const [selector,copy]of [['.service-film-kiosk','CARD SHOP · 18 SECONDS'],['.service-film-fedex','MAIL-IN · 18 SECONDS']]){
  const host=document.querySelector(selector);if(host){const label=el('p','service-film-context',copy);host.append(label);}
}
function releaseContinuation(event){if(event.persisted)return;window.removeEventListener('pagehide',releaseContinuation);for(const cleanup of cleanups)cleanup();for(const url of urls)URL.revokeObjectURL(url);}
window.addEventListener('pagehide',releaseContinuation);
