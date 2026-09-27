import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ApprovedReportView, IllustrativeReportView } from './inspect-source/FinalReportReview.jsx';
let renderer,host,current;
export function mountReport(element,entry){
 if(host!==element){renderer?.unmount();host=element;renderer=createRoot(host);}
 current=entry.key;host.dataset.demo=String(Boolean(entry.demo));
 const report=entry.demo?entry.report:entry.packet.report;
 const images=Object.fromEntries(['FRONT','BACK'].map(side=>[side,{inspection:entry.demo?entry.image:{...entry.packet.images[side],url:entry.images[side]}}]));
 const props={report,explanation:entry.explanation,images,geometry:entry.demo?entry.geometry:entry.packet.geometry,brandSrc:'/brand/atlas-grading-logo.png'};
 const view=entry.demo?<IllustrativeReportView {...props}/>:<ApprovedReportView {...props} publication={{reportNumber:entry.packet.reportNumber,version:entry.packet.approvalVersion,approvedAt:entry.packet.approvedAt,reportHash:entry.publicHash,url:entry.source}}/>;
 flushSync(()=>renderer.render(<React.Fragment key={entry.key}>{entry.demo&&<p className="embed-demo-note">ALAKAZAM DEMO · Illustrative markings and measurements</p>}{view}</React.Fragment>));
 host.scrollTop=0;
 document.dispatchEvent(new Event('atlas-guidance-ready'));
 return new Promise(resolve=>{
  const ready=()=>{const img=host.querySelector('.rr-image-side:not([hidden]) .rr-plane img');return img?.complete&&img.naturalWidth>0?img:null;};
  const existing=ready();if(existing){resolve(existing);return;}
  let timer;const finish=img=>{clearTimeout(timer);observer.disconnect();host.removeEventListener('load',loaded,true);resolve(img);};
  const observer=new MutationObserver(()=>{const img=ready();if(img||current!==entry.key)finish(img);});observer.observe(host,{subtree:true,childList:true,attributes:true});
  const loaded=()=>{const img=ready();if(img)finish(img);};host.addEventListener('load',loaded,true);
  timer=setTimeout(()=>finish(ready()),6000);
 });
}
