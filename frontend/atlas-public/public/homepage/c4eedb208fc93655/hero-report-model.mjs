// A display adapter for immutable, human-approved public packets. Never calculates a new grade.
export const categories=['centering','corners','edges','surface'];
export const format=n=>Number.isFinite(n)?Number(n.toFixed(3)).toString():'—';
export function validateFeatured(entry){
 const p=entry?.packet,r=p?.report;
 if(p?.mode!=='PRODUCTION'||p.version!=='atlas-public-manual-report-v2'||!/^ar_[\w-]{24}$/.test(p.publicToken)||!Number.isInteger(p.approvalVersion)||p.approvalVersion<1||!Number.isFinite(r?.finalGrade)||r.finalGrade!==Math.round(r.grade.overall.rawGrade*2)/2)throw Error('Invalid approved report');
 for(const side of ['FRONT','BACK'])if(p.images[side].width!==1350||p.images[side].height!==1858||p.images[side].sha256!==r.inspection[side.toLowerCase()].imageSha256)throw Error('Image binding mismatch');
 return entry;
}
export function categoryFindings(entry,category,side){
 return entry.packet.report.findings.filter(f=>['ACCEPTED','CORRECTED'].includes(f.reviewResult)).flatMap(f=>(f.measurementRegions||[]).filter(r=>r.zone.toLowerCase()===category&&(!side||f.side===side)).map(r=>({finding:f,region:r})));
}
export function imagePoint(p){return {x:(40+p.x*1270)/1350,y:(40+p.y*1778)/1858};}
export function regionPath(points){return points.map((p,i)=>{const q=imagePoint(p);return `${i?'L':'M'}${q.x*1000} ${q.y*1000}`;}).join(' ')+' Z';}
export function categoryDetail(entry,category,side,index=0){
 const report=entry.packet.report,summary=entry.explanation.categories[category];
 const list=categoryFindings(entry,category,side),chosen=list[index%Math.max(1,list.length)];
 const points=category==='centering'?entry.packet.geometry[side].printedQuad:chosen?.region.canonicalContour||[];
 const projected=points.map(imagePoint),xs=projected.map(p=>p.x),ys=projected.map(p=>p.y);
 const box=projected.length?{x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)}:null;
 const center=box?{x:box.x+box.w/2,y:box.y+box.h/2}:{x:.5,y:.5};
 return {summary,list,chosen,points,box,center,path:points.length?regionPath(points):'',score:report.grade.subgrades[category]};
}
