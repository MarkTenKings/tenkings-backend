import { ATLAS_CATEGORY_DAMAGE_MULTIPLIERS, calculateAtlasConditionScore, calculateAtlasScoringDamagePercent } from '@atlas/grading-core/atlas-policy';
const MULTIPLIERS = { FAINT_COLOR_VARIATION: .5, VISIBLE_WHITENING: 1, FRAYING: 1.25, CHIPPING_EXPOSED_STOCK: 1.5, LIFTING_DEFORMATION: 2,
  LIGHT_SCRATCH_SCUFF: 1, VISIBLE_SCRATCH_PRINT_COATING_LOSS: 1.25, DENT_MATERIAL_DAMAGE: 1.5, PEELING_HEAVY_DAMAGE: 2 };
export function findingImpact(findings, id) {
  const active=findings.filter(f=>f.reviewResult!=='REMOVED'&&!f.geometryExclusion);
  return ['CORNERS','EDGES','SURFACE'].flatMap(zone=>{
    const entries=active.flatMap(f=>(f.measurementRegions??[{zone:f.zone,measurement:f.measurement}]).filter(r=>r.zone===zone).map(r=>({id:f.id,weighted:r.measurement.zonePercent*MULTIPLIERS[f.defectType]})));
    if(!entries.some(e=>e.id===id))return [];
    // Match the server's type-weighted percentage normalization before scoring.
    const weighted=Math.round(entries.reduce((sum,e)=>sum+e.weighted,0)*1e12)/1e12;
    const without=Math.round(entries.filter(e=>e.id!==id).reduce((sum,e)=>sum+e.weighted,0)*1e12)/1e12;
    return [{zone,damageMultiplier:ATLAS_CATEGORY_DAMAGE_MULTIPLIERS[zone],score:calculateAtlasConditionScore(weighted,zone),withoutScore:calculateAtlasConditionScore(without,zone),scoringPercent:calculateAtlasScoringDamagePercent(weighted,zone)}];
  });
}
function insidePolygon(x,y,points){let inside=false;for(let i=0,j=points.length-1;i<points.length;j=i++){
  const a=points[i],b=points[j];if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)inside=!inside;
}return inside;}
/** Draft display only. The checked CPU result remains scoring authority. */
export function traceAreaPreview(trace,cornerShape,contour){let rawPixels=0,onCardPixels=0;
 for(let i=0;i<trace.length;i++)if(trace[i]){rawPixels++;const x=(i%1270+.5)*.05,y=(Math.floor(i/1270)+.5)*.05;
 const dx=Math.min(x,63.5-x),dy=Math.min(y,88.9-y);
 const inside=contour?insidePolygon(x/63.5,y/88.9,contour):cornerShape==='SQUARE'||dx>=3.18||dy>=3.18||(dx-3.18)**2+(dy-3.18)**2<=3.18**2;
 if(inside)onCardPixels++;
 }return {rawPixels,onCardPixels,outsidePixels:rawPixels-onCardPixels,rawAreaMm2:rawPixels*.0025,onCardAreaMm2:onCardPixels*.0025};
}
