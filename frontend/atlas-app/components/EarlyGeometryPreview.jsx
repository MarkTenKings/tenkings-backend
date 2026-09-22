import React,{useState} from 'react';

const statusCopy={
  WAITING_PHOTO:['Awaiting photo','Geometry starts when the working photo is ready.'],
  QUEUED:['Geometry queued','Your saved photo is waiting for processing.'],
  RUNNING:['Finding every edge','Detecting the physical edge and printed border.'],
  READY:['Geometry ready','Physical edge and printed border are ready for your review.'],
  NEEDS_REVIEW:['Your eye is needed','Automatic detection needs review. You can retry or place the outline in Geometry.'],
  FAILED:['Processing paused','Your photo is saved. Retry geometry to continue.'],
};
export function EarlyGeometryStatus({status,settingsChanged=false,retrying=false,onRetry}){
  if(!status)return null;
  const [title,detail]=statusCopy[status.state]??statusCopy.WAITING_PHOTO;
  return <div className={`mc-geometry-status mc-geometry-${status.state.toLowerCase()}`}>
    <div role="status"><span className="mc-status-dot" aria-hidden="true"/><strong>{settingsChanged?'Photo settings changed':title}</strong></div>
    <p>{settingsChanged?'Save the new settings to update the automatic geometry.':detail}</p>
    {!settingsChanged&&status.canRetry&&<button type="button" disabled={retrying} onClick={onRetry}>{retrying?'Retrying geometry…':'Retry geometry'}</button>}
  </div>;
}
export default function EarlyGeometryPreview({src,side,status,settingsChanged=false}){
  const [size,setSize]=useState(null),[failed,setFailed]=useState(false);
  const quad=!settingsChanged&&status?.physical;
  const points=size&&Array.isArray(quad)&&quad.length===4&&quad.every(point=>Number.isFinite(point.x)&&Number.isFinite(point.y))
    ?quad.map(point=>`${point.x*size.width},${point.y*size.height}`).join(' '):null;
  return <div className="mc-photo-preview">
    <img alt={`${side} SDR working view`} src={src} onLoad={event=>{setFailed(false);setSize({width:event.currentTarget.naturalWidth,height:event.currentTarget.naturalHeight});}} onError={()=>{setSize(null);setFailed(true);}}/>
    {points&&<svg viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="xMidYMid meet" aria-label="Automatically detected physical edge"><polygon points={points} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke"/>{quad.map((point,i)=><circle key={i} cx={point.x*size.width} cy={point.y*size.height} r={Math.max(size.width,size.height)/160} fill="currentColor"/>)}</svg>}
    {failed&&<span className="mc-preview-unavailable" role="status">Photo preview unavailable. The saved original is retained.</span>}
    {points&&<span className="mc-preview-caption">Physical edge · automatic proposal</span>}
  </div>;
}
