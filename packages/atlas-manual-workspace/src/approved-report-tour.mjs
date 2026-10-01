import { measureSpeedsterCenteringBorders } from '@atlas/grading-core/scoring';
import { reportFindingRegions, reportFindingMask, reportTraceSpans } from './report-review-ui.mjs';
export const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const ease = (a, b, t) => { const x = clamp((t-a)/(b-a)); return x*x*x*(x*(x*6-15)+10); };
export function regionBounds(region) {
  const points = region.canonicalContour ?? [];
  if (!points.length) return null;
  const snap = v => Math.abs(v-Math.round(v)) < 1e-7 ? Math.round(v) : v;
  const xs = points.map(p => snap(p.x*1269)), ys = points.map(p => snap(p.y*1777));
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs)-Math.min(...xs)+1, height: Math.max(...ys)-Math.min(...ys)+1 };
}
export function createFilmScene(manifest) {
  const report = manifest.packet.report;
  const sides = Object.fromEntries(['FRONT','BACK'].map(side => {
    const findings = report.findings.filter(f => f.side === side);
    const shapes = findings.map(finding => {
      const spans=reportFindingMask(finding)?reportTraceSpans(reportFindingMask(finding)):null,regions=reportFindingRegions(finding);
      let count=0,x=0,y=0;for(const span of spans??[]){count+=span.width;x+=span.width*(span.x+span.width/2);y+=span.width*(span.y+.5);}
      const points=regions.flatMap(r=>r.canonicalContour??[]);
      return {finding,spans,regions,centroid:count?[x/count/1270,y/count/1778]:points.length?[points.reduce((n,p)=>n+p.x,0)/points.length,points.reduce((n,p)=>n+p.y,0)/points.length]:null};
    });
    const geometry = manifest.packet.geometry[side];
    return [side, { findings, shapes, geometry, borders: measureSpeedsterCenteringBorders(geometry.printedQuad),
      centering: report.grade[side.toLowerCase()].centering }];
  }));
  // One actual measured region, never a mixed-finding union labeled as one region.
  const candidates = report.findings.flatMap(finding => reportFindingRegions(finding).map(region => ({ finding, region, bounds: regionBounds(region) })))
    .filter(v => v.bounds && v.region.measurement?.areaMm2 > 0)
    .sort((a,b) => b.region.measurement.areaMm2-a.region.measurement.areaMm2 || a.finding.id.localeCompare(b.finding.id));
  const macro = candidates[0] ?? null;
  if (macro) {
    const b = macro.bounds, width = Math.min(1270, Math.max(100,b.width)*1.75), height = Math.min(1778,Math.max(140,b.height)*1.65);
    macro.crop = { x:40+clamp(b.x+b.width/2-width/2,0,1270-width),y:40+clamp(b.y+b.height/2-height/2,0,1778-height),width,height };
    macro.calibratedBounds = Math.abs(b.width/20-macro.region.measurement.widthMm)<1e-6 && Math.abs(b.height/20-macro.region.measurement.heightMm)<1e-6;
  }
  return { manifest, sides, macro, name: report.identity.playerName ?? report.identity.cardName, grade: report.finalGrade,
    subtitle: [report.identity.year,report.identity.productSet,report.identity.parallel].filter(Boolean).join(' · ') };
}
export function sampleFilm(scene,time) {
  const t = clamp(time,0,16), end=ease(13,14.5,t), inspect=ease(7,7.8,t)*(1-ease(10,10.7,t));
  const macroFront=scene.macro?.finding.side==='FRONT';
  const yaw=.12+Math.PI*ease(3.4,5,t) - (macroFront ? Math.PI*ease(6.3,7,t) : 0);
  return { t,yaw,tilt:.035*Math.sin(t*.55),roll:-.028,center:[.5-.16*inspect-.12*end,.52+.065*end],size:.95-.10*inspect-.18*end,
    inspect,fingerprint:ease(10.5,11.4,t)*(1-ease(13,14,t)),end,
    side: Math.cos(yaw)>0?'FRONT':'BACK',centerAmount:1-ease(2.8,3.4,t),
    chapter:t<3.4?'CENTERING':t<7?'RECORDED FINDINGS':t<10.7?'ORIGINAL EVIDENCE':t<13.4?'CARD FINGERPRINT':'KNOW WHAT YOU HAVE' };
}
/** Same projection for the photo plane, centering endpoints and evidence anchors. */
export function projectFilmPoint(uv,side,s,w,h) {
  const sign=side==='FRONT'?1:-1,x=(uv[0]-.5)*2*sign,y=(.5-uv[1])*2.8,z=.007*sign;
  const cy=Math.cos(s.yaw),sy=Math.sin(s.yaw),ct=Math.cos(s.tilt),st=Math.sin(s.tilt),cr=Math.cos(s.roll),sr=Math.sin(s.roll);
  const yy=y*ct-z*st,zz=y*st+z*ct,xx=x*cy+zz*sy,depth=4.5-(-x*sy+zz*cy)*s.size;
  const wx=(xx*cr-yy*sr)*s.size,wy=(xx*sr+yy*cr)*s.size;
  return {x:s.center[0]*w+wx/(depth*2*(w/h)*.62)*w,y:s.center[1]*h-wy/(depth*2*.62)*h,depth};
}
