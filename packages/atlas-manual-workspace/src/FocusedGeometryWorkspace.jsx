import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {sanitizeSpeedsterUnitQuad} from '@atlas/grading-core/geometry';
import {geometryBase} from './geometry-actions.mjs';
import {geometryImage} from './geometry-image.mjs';
import {useVerifiedImage, verifiedImageContentKey} from './verified-image.mjs';
import {usePrefetchVerifiedImages} from './VerifiedImageCacheBoundary.jsx';
import {gradientMapFromImage, snapSpeedsterPoint} from './gradient-snap';
import {focusedGeometryOutlines, geometryFocusBounds, geometryCamera, zoomGeometryAt, focusedCentering} from './geometry-focus.mjs';
export {sourceQuadToPrepared} from './geometry-focus.mjs';

const corners=['Top left','Top right','Bottom right','Bottom left'];
const directions=[{inwardX:1,inwardY:1},{inwardX:-1,inwardY:1},{inwardX:-1,inwardY:-1},{inwardX:1,inwardY:-1}];
const clamp=n=>Math.max(0,Math.min(1,n));
const ratio=value=>value.map(n=>Math.round(n)).join(' / ');

/** One source photo, two source-coordinate drafts and one explicit save gesture.
 * The host serializes durable edits and advances only after its promise resolves. */
export function FocusedGeometryWorkspace({workspace,images,side='FRONT',readOnly=false,busy:hostBusy=false,
  onApproveSide,onEditingChange,onReadyChange,onRefreshImages,onRetryDisplay,renderReviewActions,reviewObservations,reviewRecovery}) {
  const slot=workspace.sides[side], label=side==='FRONT'?'Front':'Back';
  const image=geometryImage(workspace,side,'PHYSICAL',images);
  const identity=JSON.stringify([workspace.cardId,side,slot.imageRevision,slot.image?.frameSha256]);
  return <FocusedSide key={identity} {...{workspace,images,side,readOnly,onApproveSide,onEditingChange,onReadyChange,onRefreshImages,onRetryDisplay,renderReviewActions,reviewObservations,reviewRecovery,slot,label,image,hostBusy}} />;
}

function FocusedSide({workspace,images,side,readOnly,onApproveSide,onEditingChange,onReadyChange,onRefreshImages,onRetryDisplay,renderReviewActions,reviewObservations,reviewRecovery,slot,label,image,hostBusy}) {
  const verified=useVerifiedImage(typeof image?.url==='string'&&image.url.length?image:null,{cacheScope:JSON.stringify([workspace.cardId,side])});
  const preview=useVerifiedImage(verified.url?null:image?.preview);
  const contentKey=verifiedImageContentKey(image);
  const [readyKey,setReadyKey]=useState(null),[draft,setDraft]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [placement,setPlacement]=useState(null);
  const [selected,setSelected]=useState({kind:'PHYSICAL',corner:0}),[snap,setSnap]=useState(false),[snapReady,setSnapReady]=useState(false),[dragging,setDragging]=useState(false),[handleFocused,setHandleFocused]=useState(false);
  const initial=focusedGeometryOutlines(workspace,side), outlines=draft??initial;
  const [bounds,setBounds]=useState(()=>slot.image?geometryFocusBounds(initial.physical,slot.image):null);
  const [size,setSize]=useState({width:640,height:680}),[view,setView]=useState({zoom:1,pan:{x:0,y:0}});
  const viewport=useRef(null),gradient=useRef(null),drag=useRef(null),panDrag=useRef(null),mounted=useRef(true),saving=useRef(false),loadGeneration=useRef(0);
  const ready=Boolean(verified.url&&contentKey&&readyKey===contentKey);
  // Warm only the exact next geometry image, after the visible photo is ready.
  // The pool verifies its bytes; Back still establishes its own display readiness.
  const nextImage=ready&&side==='FRONT'&&!hostBusy&&!readOnly
    ?geometryImage(workspace,'BACK','PHYSICAL',images):null;
  usePrefetchVerifiedImages(nextImage?.url?[nextImage]:[]);
  const inactive=readOnly||hostBusy||busy||!ready;
  const camera=image&&bounds?geometryCamera(bounds,size,image,view):null;
  const needsPlacement=Boolean(placement)||outlines.needsPhysicalPlacement||(!outlines.printedAbsent&&outlines.needsPrintedPlacement);
  const centering=!needsPlacement&&!outlines.printedAbsent?focusedCentering(outlines.physical,outlines.printedOriginal):null;
  const editing=Boolean(draft)||Boolean(placement)||busy;
  useEffect(()=>{onEditingChange?.(editing);return()=>onEditingChange?.(false);},[editing,onEditingChange]);
  useEffect(()=>{onReadyChange?.(ready);return()=>onReadyChange?.(false);},[ready,onReadyChange]);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;loadGeneration.current++;};},[]);
  useLayoutEffect(()=>{
    setReadyKey(null);gradient.current=null;setSnapReady(false);loadGeneration.current++;
  },[contentKey]);
  useLayoutEffect(()=>{
    if(!viewport.current||typeof ResizeObserver==='undefined')return;
    const observer=new ResizeObserver(([entry])=>setSize({width:entry.contentRect.width,height:entry.contentRect.height}));
    observer.observe(viewport.current);return()=>observer.disconnect();
  },[]);
  useEffect(()=>{
    const element=viewport.current;
    if(!element?.addEventListener)return;
    const wheel=event=>{
      if(!ready||drag.current)return;
      event.preventDefault();const rect=element.getBoundingClientRect();
      const unit=event.deltaMode===1?16:event.deltaMode===2?size.height:1;
      setView(previous=>zoomGeometryAt(previous,previous.zoom*Math.exp(-event.deltaY*unit*.002),
        {x:event.clientX-rect.left,y:event.clientY-rect.top},size));
    };
    element.addEventListener('wheel',wheel,{passive:false});
    return()=>element.removeEventListener('wheel',wheel);
  },[ready,size]);
  const fit=()=>{setBounds(geometryFocusBounds(outlines.physical,image));setView({zoom:1,pan:{x:0,y:0}});};
  const zoomBy=factor=>setView(previous=>zoomGeometryAt(previous,previous.zoom*factor,{x:size.width/2,y:size.height/2},size));
  function startPan(event){
    if(!ready||event.button!==0||event.target.closest?.('button'))return;
    if(placement){
      if(inactive||!camera)return;
      const rect=event.currentTarget.getBoundingClientRect();
      const point={x:(event.clientX-rect.left-camera.left)/camera.width,y:(event.clientY-rect.top-camera.top)/camera.height};
      if(point.x<0||point.x>1||point.y<0||point.y>1)return;
      const points=[...placement.points,point];event.preventDefault();
      if(points.length<4){setPlacement({...placement,points});return;}
      if(!sanitizeSpeedsterUnitQuad(points)){setError('Keep the corners in clockwise order. Place the bottom left corner again.');return;}
      const field=placement.kind==='PHYSICAL'?'physical':'printedOriginal',needsField=placement.kind==='PHYSICAL'?'needsPhysicalPlacement':'needsPrintedPlacement';
      setDraft({...capture(),[field]:points,[needsField]:false});setPlacement(null);setError('');return;
    }
    panDrag.current={id:event.pointerId,x:event.clientX,y:event.clientY,pan:view.pan};
    event.currentTarget.setPointerCapture(event.pointerId);event.preventDefault();
  }

  const capture=()=>draft??{...initial,base:geometryBase(workspace,side,'REVIEW')};
  function setPoint(kind,index,point,useSnap=false){
    if(inactive)return;
    let next={x:clamp(point.x),y:clamp(point.y)};
    if(useSnap&&snap&&gradient.current)next=snapSpeedsterPoint(gradient.current,next,{...directions[index],
      sampleStart:kind==='PRINTED'?4:slot.cornerShape==='ROUNDED_3_18_MM'?30:8,sampleLength:kind==='PRINTED'?90:125});
    const current=capture(),field=kind==='PHYSICAL'?'physical':'printedOriginal';
    const quad=current[field].map((p,i)=>i===index?next:{...p});
    if(!sanitizeSpeedsterUnitQuad(quad)){setError('Keep the corners in order. The last valid outline is retained.');return;}
    const placedField=kind==='PHYSICAL'?'physicalPlaced':'printedPlaced';
    const placed=[...new Set([...(current[placedField]??[]),index])];
    const needsField=kind==='PHYSICAL'?'needsPhysicalPlacement':'needsPrintedPlacement';
    setDraft({...current,[field]:quad,[placedField]:placed,[needsField]:current[needsField]&&placed.length<4});setError('');
  }
  const screenPoint=point=>({x:camera.left+point.x*camera.width,y:camera.top+point.y*camera.height});
  const borderLabels=centering&&camera?[
    {key:'top',name:'Top',points:[0,1],dx:0,dy:-25,value:centering.borders.topMm},
    {key:'right',name:'Right',points:[1,2],dx:52,dy:0,value:centering.borders.rightMm},
    {key:'bottom',name:'Bottom',points:[2,3],dx:0,dy:25,value:centering.borders.bottomMm},
    {key:'left',name:'Left',points:[3,0],dx:-52,dy:0,value:centering.borders.leftMm},
  ].map(item=>{const [a,b]=item.points.map(index=>screenPoint(outlines.physical[index]));return {...item,
    x:Math.max(42,Math.min(size.width-42,(a.x+b.x)/2+item.dx)),
    y:Math.max(22,Math.min(size.height-22,(a.y+b.y)/2+item.dy))};}):[];
  const activePoints=[{kind:'PHYSICAL',quad:outlines.physical},...(!outlines.printedAbsent?[{kind:'PRINTED',quad:outlines.printedOriginal}]:[])].filter(layer=>layer.quad);
  function pointerDown(event,kind,index){
    if(inactive||event.button!==0||!camera||!viewport.current)return;
    const rect=viewport.current.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top;
    // Overlapping invisible targets choose the nearest actual corner, so a
    // narrow printed border cannot make the physical corner unreachable.
    let nearest={kind,corner:index,distance:Infinity};
    for(const layer of activePoints)layer.quad.forEach((point,corner)=>{
      const p=screenPoint(point),distance=Math.hypot(p.x-x,p.y-y);
      if(distance<nearest.distance)nearest={kind:layer.kind,corner,distance};
    });
    const pick=nearest.distance<=30?nearest:{kind,corner:index};
    const field=pick.kind==='PHYSICAL'?'physical':'printedOriginal',point=outlines[field][pick.corner],p=screenPoint(point);
    setSelected({kind:pick.kind,corner:pick.corner});setDragging(true);
    drag.current={...pick,pointerId:event.pointerId,offsetX:p.x-x,offsetY:p.y-y};
    event.currentTarget.setPointerCapture(event.pointerId);event.preventDefault();event.stopPropagation();
  }
  function pointerMove(event){
    const panning=panDrag.current;
    if(panning?.id===event.pointerId){setView(previous=>({...previous,pan:{x:panning.pan.x+event.clientX-panning.x,y:panning.pan.y+event.clientY-panning.y}}));return;}
    const moving=drag.current;if(!moving||moving.pointerId!==event.pointerId||!viewport.current||!camera)return;
    const rect=viewport.current.getBoundingClientRect();
    setPoint(moving.kind,moving.corner,{x:(event.clientX-rect.left+moving.offsetX-camera.left)/camera.width,
      y:(event.clientY-rect.top+moving.offsetY-camera.top)/camera.height},true);
  }
  function endDrag(){drag.current=null;panDrag.current=null;setDragging(false);}
  async function approve(){
    if(inactive||saving.current||!onApproveSide||needsPlacement||(!outlines.printedAbsent&&!centering))return;
    const pending=capture();saving.current=true;setDraft(pending);setBusy(true);setError('');
    try{
      await onApproveSide({side,base:pending.base,physical:pending.physical,
        printedOriginal:pending.printedOriginal,printedAbsent:pending.printedAbsent});
      if(mounted.current)setDraft(null);
    }catch(failure){if(mounted.current)setError(/STALE|CONFLICT/.test(failure?.code??'')
      ? 'This card changed. Your adjustment is kept; reload the saved state before approving.'
      : 'Your adjustment is kept. Saving did not finish; try Approve again.');}
    finally{saving.current=false;if(mounted.current)setBusy(false);}
  }
  async function loaded(event){
    const img=event.currentTarget,generation=loadGeneration.current;
    if(img.naturalWidth!==image.width||img.naturalHeight!==image.height){setReadyKey(null);setError('This photo does not match its saved dimensions. Reload the photo.');return;}
    try{if(typeof img.decode==='function')await img.decode();}catch{if(mounted.current)setError('Photo unavailable. Reload the photo.');return;}
    if(!mounted.current||generation!==loadGeneration.current||img.isConnected===false)return;
    gradient.current=gradientMapFromImage(img);setSnapReady(Boolean(gradient.current));setReadyKey(contentKey);
  }
  async function retryPreparation(){
    if(!onRetryDisplay||busy||!image?.displayState?.retry)return;
    setBusy(true);setError('');try{await onRetryDisplay({side,...image.displayState.retry});}
    catch{setError('Photo preparation did not restart. Reload its status and try again.');}finally{if(mounted.current)setBusy(false);}
  }
  const selectedQuad=selected.kind==='PHYSICAL'?outlines.physical:outlines.printedOriginal,selectedPoint=selectedQuad?.[selected.corner];
  const progress=verified.progress?.totalBytes?`${Math.min(99,Math.floor(100*verified.progress.loadedBytes/verified.progress.totalBytes))}%`:'';
  const placementKind=outlines.needsPhysicalPlacement?'physical edge':'printed border';
  const placedCount=placement?.points.length??0;
  const retainedPrinted=outlines.needsPrintedPlacement&&slot.visualObservation?.printed.outlineLocated;
  const invalidCentering=!needsPlacement&&!outlines.printedAbsent&&!centering;
  const taskTitle=needsPlacement?`Place the ${placementKind}`:invalidCentering?'Correct the printed border':`Confirm ${label} geometry`;
  const taskStatus=busy?'Saving & checking':error?'Needs attention':!ready?'Verifying photograph':needsPlacement||invalidCentering?'Correction required':outlines.printedAbsent?'Border marked absent':draft?'Unsaved adjustments':'Human review required';
  const taskCopy=busy?'Your adjustments are being saved and measured. Keep this review open.':error?error:!ready?'The full photograph must be verified before you can adjust or approve it.':needsPlacement?`Position all four ${placementKind} corners on the photograph. ${placedCount} of 4 placed.`:invalidCentering?'Keep the printed border inside the physical edge so centering can be measured. Adjust the outline before approving.':outlines.printedAbsent?'Confirm that this card has no printed border. Centering and the final grade will remain unavailable.':'Check the physical edge and printed border against the photograph. Adjust a corner if needed, then approve.';
  const approvalMessage=!ready?'Loading the verified photo…':needsPlacement?`Place all four ${placementKind} corners to continue.`:outlines.printedAbsent?'No printed border. Centering and final grade will need attention.':!centering?'Keep the printed border inside the physical edge.':`${label} · ${side==='FRONT'?'Back is next':'Findings are next'}`;
  const action={approve,disabled:inactive||!onApproveSide||needsPlacement||(!outlines.printedAbsent&&!centering),busy,message:approvalMessage};
  return <section className="atlas-focused-geometry" aria-label={`${label} geometry`} data-review-target={`geometry-${side}`}>
    <div className="fg-body">
    <div className="fg-stage" ref={viewport} onPointerDown={startPan} onPointerMove={pointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
      <div className="fg-stage-label">{label} <span>Geometry</span></div>
      {image&&camera&&(verified.url||preview.url)&&<img key={`${contentKey}:${verified.url?'full':'preview'}`} className="fg-photo" src={verified.url??preview.url} draggable={false}
        alt={`${label} card${verified.url?', clean geometry view':' preview; full detail is loading'}`} onLoad={verified.url?loaded:undefined}
        onError={()=>{setReadyKey(null);setError('Photo unavailable. Reload the photo.');}}
        style={{left:camera.left,top:camera.top,width:camera.width,height:camera.height}} />}
      {ready&&camera&&<><svg className="fg-outlines" width={size.width} height={size.height} aria-hidden="true">
        {activePoints.map(({kind,quad})=><g key={kind} className={kind==='PHYSICAL'?'fg-physical':'fg-printed'}>
          <polygon className="fg-stroke-contrast" points={quad.map(p=>{const s=screenPoint(p);return `${s.x},${s.y}`;}).join(' ')}/>
          <polygon points={quad.map(p=>{const s=screenPoint(p);return `${s.x},${s.y}`;}).join(' ')}/></g>)}
        {placement?.points.map((point,index)=>{const p=screenPoint(point);return <circle key={`placed-${index}`} className="fg-human-point" cx={p.x} cy={p.y} r="5" fill="#cda955" stroke="white" strokeWidth="2"/>;})}
      </svg>{activePoints.flatMap(({kind,quad})=>quad.map((point,index)=>{const p=screenPoint(point);return <button type="button" key={`${kind}:${index}`}
        className={`fg-handle ${kind==='PRINTED'?'fg-inner':''} ${selected.kind===kind&&selected.corner===index?'fg-selected':''}`}
        aria-label={`${side} ${kind==='PHYSICAL'?'physical edge':'printed border'} ${corners[index]}`} disabled={inactive}
        style={{left:p.x,top:p.y}} onFocus={()=>{setSelected({kind,corner:index});setHandleFocused(true);}} onBlur={()=>setHandleFocused(false)} onPointerDown={event=>pointerDown(event,kind,index)}
        onKeyDown={event=>{const d={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];if(!d)return;event.preventDefault();const step=event.shiftKey?10:1;setPoint(kind,index,{x:point.x+d[0]*step/image.width,y:point.y+d[1]*step/image.height});}}><span/></button>;}))}</>}
      {ready&&borderLabels.map(item=><div key={item.key} className={`fg-border-value fg-border-${item.key}`} style={{left:item.x,top:item.y}}
        aria-label={`${item.name} average border ${item.value.toFixed(2)} millimeters, live`}><small>{item.name}</small><strong>{item.value.toFixed(2)} <span>mm</span></strong></div>)}
      {!ready&&<div className="fg-loading" role="status"><strong>{verified.error?'Photo needs attention':image?.displayState?.state==='FAILED'?'Photo preparation needs attention':`Loading ${label.toLowerCase()} ${progress}`}</strong><span>{preview.url?'Preview shown · Full detail is loading':'Your saved original is retained.'}</span>
        {verified.error&&<button type="button" onClick={verified.retry}>Retry photo</button>}
        {image?.displayState?.state==='FAILED'&&image.displayState.retry&&onRetryDisplay&&<button type="button" disabled={busy} onClick={retryPreparation}>Retry preparation</button>}
        {onRefreshImages&&<button type="button" disabled={busy} onClick={onRefreshImages}>Reload photo</button>}</div>}
    </div>
    <aside className="fg-inspector" aria-label={`${label} review inspector`}>
      <section className="atlas-review-task" aria-label="Your review">
        <span className="atlas-review-eyebrow">Your review</span><h3>{taskTitle}</h3>
        <span className="atlas-review-status" role="status">{taskStatus}</span><p className={error?'fg-error':undefined} role={error?'alert':undefined}>{taskCopy}</p>
        {needsPlacement&&ready&&<div className="atlas-review-hint">{placement?<><p>Click the {corners[placedCount].toLowerCase()} corner. {placedCount} of 4 placed.</p><button type="button" disabled={inactive} onClick={()=>{setPlacement(null);setError('');}}>Cancel placement</button></>:<><p>No substitute outline is shown. You can place the corners yourself.</p><button type="button" disabled={inactive} onClick={()=>{setPlacement({kind:outlines.needsPhysicalPlacement?'PHYSICAL':'PRINTED',points:[]});setError('');}}>Place {placementKind}</button></>}</div>}
      </section>
      {slot.visualObservation&&<section className="atlas-review-task" aria-label="Astra geometry observations">
        <span className="atlas-review-eyebrow">Astra · xhigh</span>
        {['physical','printed'].map(kind=>{const observation=slot.visualObservation[kind];return <p key={kind}><strong>{kind==='physical'?'Physical edge':'Printed border'} · {observation.outlineLocated?'outline proposed':'no outline proposed'}</strong><br/>{observation.observation}<br/><small>Uncertainty: {observation.uncertainty.toLowerCase()}</small></p>;})}
        {outlines.needsPrintedPlacement&&!outlines.printedAbsent&&<p>{retainedPrinted?'Astra returned a printed outline, but image preparation did not finish. The saved outline can be restored when preparation completes.':'Astra returned no printed outline. You can place its corners yourself.'}</p>}
      </section>}
      <div className="fg-precision" aria-label="Corner precision view"><div className="fg-precision-title"><strong>Precision view</strong><span>3×</span></div>
        {(dragging||handleFocused)&&selectedPoint&&ready&&camera?<div className="fg-loupe" aria-label={`${corners[selected.corner]} ${selected.kind==='PHYSICAL'?'physical edge':'printed border'} enlarged photograph`}>
          <img src={verified.url} alt="" draggable={false} style={{width:camera.width*3,height:camera.height*3,left:70-selectedPoint.x*camera.width*3,top:70-selectedPoint.y*camera.height*3}}/><span/>
        </div>:<p>Move or focus a corner to see its exact position.</p>}
      </div>
      <div className="fg-legend"><span><i/>Physical edge</span><span><i/>Printed border</span></div>
    <div className="fg-instruments"><div className="fg-measurements" aria-live="polite">{centering&&!outlines.printedAbsent?<><span>Left / right <strong>{ratio(centering.leftRight)}</strong></span><span>Top / bottom <strong>{ratio(centering.topBottom)}</strong></span><small>Live centering</small></>:<span>{outlines.printedAbsent?'No printed border':'Place both outlines to measure centering'}</span>}</div>
      <div className="fg-tools"><button type="button" disabled={!ready} onClick={fit}>Fit card</button>
        <button type="button" disabled={!ready} aria-label="Zoom out" onClick={()=>zoomBy(1/1.25)}>−</button><span aria-label="Image zoom">{Math.round(view.zoom*100)}%</span><button type="button" disabled={!ready} aria-label="Zoom in" onClick={()=>zoomBy(1.25)}>+</button>
        <button type="button" aria-pressed={snap} disabled={!ready||!snapReady||busy} onClick={()=>setSnap(value=>!value)}>Snap {snap?'on':'off'}</button>
        <details><summary>More</summary><div className="fg-options"><button type="button" disabled={inactive} aria-pressed={outlines.printedAbsent} onClick={()=>{setDraft({...capture(),printedAbsent:!outlines.printedAbsent});setError('');}}>No printed border</button>
          {draft&&<button type="button" disabled={busy||hostBusy} onClick={()=>{setDraft(null);setError('');}}>Discard unsaved adjustments</button>}
          <p>Drag a corner. Arrow keys move one pixel; Shift moves ten.</p></div></details></div>
    </div>
    {reviewRecovery}{reviewObservations}
    </aside></div>
    {renderReviewActions?renderReviewActions(action):<footer className="fg-actions"><span>{approvalMessage}</span><button type="button" disabled={action.disabled} onClick={approve}>{busy?'Saving…':'Approve'}</button></footer>}
  </section>;
}
