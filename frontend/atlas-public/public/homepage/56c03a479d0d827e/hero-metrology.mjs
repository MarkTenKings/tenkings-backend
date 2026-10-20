import {canonicalToSource,transformPoint} from './hero-evidence.mjs';
const NS='http://www.w3.org/2000/svg';
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const clone=x=>JSON.parse(JSON.stringify(x));
const close=(a,b,tolerance=1e-8)=>Math.abs(a-b)<=tolerance;
const snap=n=>close(n,Math.round(n))?Math.round(n):n;
const mean=(a,b)=>[(a[0]+b[0])/2,(a[1]+b[1])/2];
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export const formatMillimeters=n=>`${Number(n).toFixed(2)} mm`;

/** Canonical pixels. Mirrors grading-core measureSpeedsterCenteringBorders:
 * opposite printed-corner averages, calibrated against the complete card cell
 * extent. Saved physical corner centers are retained separately (last pixel is
 * 1269/1777; full measured extents are1270/1778). No ratio-to-length inference.
 */
export function buildCenteringInstruments(side,manifest){
 const s=typeof side==='string'?manifest.sides[side]:side,card=manifest.card;
 const p=s?.geometry?.printedQuadCanonical,physical=s?.geometry?.physicalQuadCanonical;
 if(!p||p.length!==4||!physical||!finite(card.widthMm)||!finite(card.heightMm))return null;
 const W=card.canonicalWidth,H=card.canonicalHeight;
 const [tl,tr,br,bl]=p;
 const mids={left:mean(tl,bl),right:mean(tr,br),top:mean(tl,tr),bottom:mean(bl,br)};
 const values={left:mids.left[0]*card.widthMm/W,right:(W-mids.right[0])*card.widthMm/W,top:mids.top[1]*card.heightMm/H,bottom:(H-mids.bottom[1])*card.heightMm/H};
 if(Object.values(values).some(v=>!finite(v)||v<0))return null;
 const outer={left:[0,mids.left[1]],right:[W,mids.right[1]],top:[mids.top[0],0],bottom:[mids.bottom[0],H]};
 const offset={left:[-10,-12],right:[10,-12],top:[12,-10],bottom:[12,10]};
 const gaps=['left','right','top','bottom'].map(id=>({id,axis:id==='left'||id==='right'?'x':'y',valueMm:values[id],label:formatMillimeters(values[id]),from:outer[id],to:mids[id],labelPoint:mean(outer[id],mids[id]),labelOffsetPx:offset[id]}));
 const ratios={leftRight:[100*values.left/(values.left+values.right),100*values.right/(values.left+values.right)],topBottom:[100*values.top/(values.top+values.bottom),100*values.bottom/(values.top+values.bottom)]};
 const saved=s.centering;
 const balancesMatch=Boolean(saved)&&['leftRight','topBottom'].every(key=>ratios[key].every((v,i)=>close(v,saved[key][i],1e-8)));
 return {coordinateSpace:'canonical-pixels',physicalQuad:clone(physical),printedQuad:clone(p),calibrationQuad:[[0,0],[W,0],[W,H],[0,H]],gaps,ratios,savedRatios:saved?{leftRight:clone(saved.leftRight),topBottom:clone(saved.topBottom)}:null,balancesMatch,derivation:'saved printed geometry; calibrated corner averages matching grading-core',physicalOutlineConvention:'saved pixel-center quad',measurementExtentConvention:'complete canonical cell extent'};
}

/** Region dimensions are supplied by the saved report. Contour centers become
 * pixel-cell bounds with +1 at the right/bottom; never use the whole-finding
 * union as a substitute for a mixed-category region.
 */
export function buildInspectionInstruments(finding,side,card){
 const W=card.canonicalWidth,H=card.canonicalHeight;
 const regions=finding.regions.map((region,index)=>{
  const canonical=(region.canonicalContour||[]).map(p=>[snap(p.x*(W-1)),snap(p.y*(H-1))]);
  const xs=canonical.map(p=>p[0]),ys=canonical.map(p=>p[1]);
  const bounds=canonical.length?[Math.min(...xs),Math.min(...ys),Math.max(...xs)+1,Math.max(...ys)+1]:null;
  const m=region.measurement;
  const matchingCalibration=Boolean(bounds)&&finite(card.widthMm)&&finite(card.heightMm)
   &&close((bounds[2]-bounds[0])*card.widthMm/W,m.widthMm)
   &&close((bounds[3]-bounds[1])*card.heightMm/H,m.heightMm);
  const sourceQuad=bounds?[[bounds[0],bounds[1]],[bounds[2],bounds[1]],[bounds[2],bounds[3]],[bounds[0],bounds[3]]].map(p=>canonicalToSource(side,p)):null;
  const sourceContour=canonical.map(p=>canonicalToSource(side,p));
  return {index,zone:region.zone,measurement:clone(m),boundsCanonical:bounds,sourceQuad,sourceContour,calipersSupported:matchingCalibration,labels:{width:formatMillimeters(m.widthMm),height:formatMillimeters(m.heightMm),area:`${Number(m.areaMm2.toFixed(4))} mm²`}};
 });
 return {findingId:finding.id,regions,defaultRegion:0,coordinateSpace:'original-source-pixels'};
}
const pathFor=points=>points.map((p,i)=>`${i?'L':'M'}${p[0]} ${p[1]}`).join('')+'Z';
const screenPoint=(m,p)=>[m.a*p[0]+m.c*p[1]+m.e,m.b*p[0]+m.d*p[1]+m.f];
const linePath=(a,b)=>`M${a[0]} ${a[1]}L${b[0]} ${b[1]}`;

/** Owns one SVG group only. Call refresh after changing viewBox or dimensions.
 * All drawing uses screen CSS pixels through the inverse root CTM, retaining
 * legible labels and stable strokes at any inspection zoom. No photo mutation.
 * Return.destroy removes this overlay. Region chips support mouse/keyboard.
 */
export function renderInspectionInstruments(svgRoot,finding,side,card,{show=true,whole=false,regionIndex=0,onRegionChange}={}){
 svgRoot.querySelector(':scope > .hm-instruments')?.remove();
 const document=svgRoot.ownerDocument;
 const group=document.createElementNS(NS,'g');group.setAttribute('class','hm-instruments');group.setAttribute('data-finding',finding.id);svgRoot.append(group);
 const model=buildInspectionInstruments(finding,side,card);
 let selected=clamp(Math.trunc(regionIndex),0,Math.max(0,model.regions.length-1)),destroyed=false;
 const element=(tag,attrs={},text)=>{const el=document.createElementNS(NS,tag);for(const [k,v]of Object.entries(attrs))el.setAttribute(k,String(v));if(text!==undefined)el.textContent=text;return el;};
 function draw(){
  if(destroyed)return;group.replaceChildren();group.setAttribute('data-whole',String(whole));
  if(!show||!model.regions.length){group.setAttribute('display','none');return;}
  const ctm=svgRoot.getScreenCTM(),viewport=svgRoot.getBoundingClientRect();
  if(!ctm||!viewport.width||!viewport.height){group.setAttribute('display','none');return;}
  group.removeAttribute('display');
  const inverse=ctm.inverse();group.setAttribute('transform',`matrix(${inverse.a} ${inverse.b} ${inverse.c} ${inverse.d} ${inverse.e} ${inverse.f})`);
  const box={left:viewport.left+8,right:viewport.right-8,top:viewport.top+8,bottom:viewport.bottom-8};
  const region=model.regions[selected];
  group.setAttribute('aria-label',`${region.zone} saved measurements: ${region.labels.width} wide by ${region.labels.height} high`);
  const addPath=(d,kind)=>group.append(element('path',{d,class:`hm-${kind}`,fill:'none','vector-effect':'non-scaling-stroke'}));
  function label(value,x,y){
   const width=value.length*7.9+18,height=27;
   x=clamp(x,box.left+width/2,box.right-width/2);y=clamp(y,box.top+height/2,box.bottom-height/2);
   const g=element('g',{class:'hm-value','pointer-events':'none'});
   g.append(element('rect',{x:x-width/2,y:y-height/2,width,height,rx:4}),element('text',{x,y,'text-anchor':'middle','dominant-baseline':'central'},value));group.append(g);
  }
  if(region.calipersSupported){
   const points=region.sourceQuad.map(p=>screenPoint(ctm,p));
   const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),left=Math.min(...xs),right=Math.max(...xs),top=Math.min(...ys),bottom=Math.max(...ys);
   const below=box.bottom-bottom>=55||bottom-box.top<55;
   const yLine=below?Math.min(box.bottom-35,bottom+20):Math.max(box.top+35,top-20),originY=below?bottom:top;
   const leftSpace=left-box.left,rightSpace=box.right-right,onLeft=leftSpace>=94||leftSpace>=rightSpace;
   const xLine=onLeft?Math.max(box.left+73,left-20):Math.min(box.right-73,right+20),originX=onLeft?left:right;
   const tick=5;
   // Thin extension guides preserve the relation to the saved region corners.
   addPath(linePath([left,originY],[left,yLine])+linePath([right,originY],[right,yLine])+linePath([originX,top],[xLine,top])+linePath([originX,bottom],[xLine,bottom]),'extensions');
   addPath(linePath([left,yLine],[right,yLine])+linePath([left,yLine-tick],[left,yLine+tick])+linePath([right,yLine-tick],[right,yLine+tick])+linePath([xLine,top],[xLine,bottom])+linePath([xLine-tick,top],[xLine+tick,top])+linePath([xLine-tick,bottom],[xLine+tick,bottom]),'calipers');
   label(region.labels.width,(left+right)/2,yLine+(below?18:-18));
   label(region.labels.height,xLine+(onLeft?-42:42),(top+bottom)/2);
   if(model.regions.length>1)addPath(pathFor(region.sourceContour.map(p=>screenPoint(ctm,p))),'selected-region');
  }else{
   // A future unsupported contour must retain its saved values without a falsely
   // aligned bracket. Current approved fixture has9/9 exact matching regions.
   label(`${region.labels.width} × ${region.labels.height}`,viewport.left+viewport.width/2,box.bottom-20);
  }
  if(model.regions.length>1){
   let x=box.left+4;
   for(const r of model.regions){
    const name=r.zone==='EDGES'?'EDGE REGION':r.zone==='SURFACE'?'SURFACE REGION':`${r.zone} REGION`,width=name.length*7+24;
    const chip=element('g',{class:'hm-region-chip',transform:`translate(${x} ${box.top+4})`,role:'button',tabindex:0,'data-region':r.index,'aria-pressed':r.index===selected,'aria-label':`Show saved ${r.zone.toLowerCase()} region: ${r.labels.width} by ${r.labels.height}`});
    chip.append(element('rect',{width,height:30,rx:4}),element('text',{x:width/2,y:15,'text-anchor':'middle','dominant-baseline':'central'},name));
    const activate=()=>{api.selectRegion(r.index);group.querySelector(`[data-region="${r.index}"]`)?.focus();};
    chip.addEventListener('click',activate);chip.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();activate();}});
    group.append(chip);x+=width+7;
   }
  }
 }
 const api={group,model,refresh:draw,selectRegion(index){selected=clamp(Math.trunc(index),0,model.regions.length-1);draw();onRegionChange?.(model.regions[selected]);},destroy(){destroyed=true;group.remove();}};
 draw();return api;
}
