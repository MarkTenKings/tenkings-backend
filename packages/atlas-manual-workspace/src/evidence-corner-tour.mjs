import { reportFindingMask, reportFindingBounds, reportTraceSpans } from './report-review-ui.mjs';

// An identical visual inspection field at all four corners. It does not
// measure corner angles or change the saved finding's scoring category.
export const CORNER_FIELD_SIZE = 320;
const W=1270,H=1778,B=CORNER_FIELD_SIZE,full={x:675,y:929,size:1950};
const clamp=value=>Math.max(0,Math.min(1,value));
export const CORNER_FIELDS=Object.freeze([
  {id:'top-left',label:'Top left',x:40,y:40,width:B,height:B},
  {id:'top-right',label:'Top right',x:40+W-B,y:40,width:B,height:B},
  {id:'bottom-right',label:'Bottom right',x:40+W-B,y:40+H-B,width:B,height:B},
  {id:'bottom-left',label:'Bottom left',x:40,y:40+H-B,width:B,height:B},
].map(Object.freeze));

export function cornerContact(finding,field){
  if(!['ACCEPTED','CORRECTED'].includes(finding.reviewResult)||finding.geometryExclusion)return null;
  const mask=reportFindingMask(finding);if(!mask)return null;
  let first=Infinity,last=-Infinity;
  for(const span of reportTraceSpans(mask)){
    const y=span.y+40,x=span.x+40;
    if(y<field.y||y>=field.y+field.height||x>=field.x+field.width||x+span.width<=field.x)continue;
    first=Math.min(first,y);last=Math.max(last,y+1);
  }
  return Number.isFinite(first)?{finding,field,start:(first-field.y)/field.height,end:(last-field.y)/field.height}:null;
}

export function createCornerTour(findings){
  const segments=[],hits=[];let time=0,previous=full;
  const add=(seconds,kind,a,b,rest)=>{if(seconds<=0)return;segments.push({start:time,end:time+seconds,kind,a,b,...rest});time+=seconds;};
  for(const [index,field] of CORNER_FIELDS.entries()){
    const pose={x:field.x+B/2,y:field.y+B/2,size:430};
    add(index?1.6:2.5,'approach',previous,pose,{field,scan:0});
    const contacts=findings.map(f=>cornerContact(f,field)).filter(Boolean).sort((a,b)=>a.start-b.start||a.end-b.end);
    hits.push(...contacts);let scanned=0;
    for(const hit of contacts){
      const start=Math.max(scanned,hit.start),end=Math.max(start,hit.end),box=reportFindingBounds(hit.finding);
      add((start-scanned)*3,'scan',pose,pose,{field,sa:scanned,sb:start});
      add(.6,'scan',pose,pose,{field,sa:start,sb:end,finding:hit.finding});
      const close={x:40+(box.x+box.width/2)*W,y:40+(box.y+box.height/2)*H,size:Math.max(180,Math.max(box.width*W,box.height*H)*1.8+80)};
      add(.8,'focus',pose,close,{field,scan:end,finding:hit.finding});
      add(3.5,'inspect',close,close,{field,scan:end,finding:hit.finding});
      add(.8,'retreat',close,pose,{field,scan:end,finding:hit.finding});scanned=end;
    }
    add((1-scanned)*3,'scan',pose,pose,{field,sa:scanned,sb:1});
    add(.6,'field-complete',pose,pose,{field,scan:1});previous=pose;
  }
  add(2.5,'return',previous,full,{field:CORNER_FIELDS[3],scan:1});
  return {mode:'corners',hits,segments,duration:time,sample:sampleCornerTour};
}

export function sampleCornerTour(plan,progress){
  const time=clamp(progress)*plan.duration;
  const s=plan.segments.find(s=>time>=s.start&&time<s.end)??plan.segments.at(-1);
  const u=clamp((time-s.start)/(s.end-s.start)),q=u*u*(3-2*u),mix=(a,b)=>a+(b-a)*q;
  return {x:mix(s.a.x,s.b.x),y:mix(s.a.y,s.b.y),size:mix(s.a.size,s.b.size),time,kind:s.kind,field:s.field,scan:s.kind==='scan'?s.sa+(s.sb-s.sa)*u:s.scan,
    finding:s.finding,label:s.field.label,key:`corner:${s.kind}:${s.start}`};
}
