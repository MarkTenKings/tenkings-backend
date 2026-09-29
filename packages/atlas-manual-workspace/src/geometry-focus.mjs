import { sanitizeSpeedsterUnitQuad } from '@atlas/grading-core/geometry';
import { calculateCenteringBalance, measureSpeedsterCenteringBorders } from '@atlas/grading-core/scoring';
import { originalPointToPrepared, printedQuadOnOriginal } from './geometry-actions.mjs';

const canonicalCorners = [{x:0,y:0},{x:1269/1270,y:0},{x:1269/1270,y:1777/1778},{x:0,y:1777/1778}];
const clone = quad => quad.map(point => ({...point}));
// Homography round trips may land a few floating-point units beyond an exact
// boundary. Correct only numerical noise; meaningful off-card points still fail.
const boundary = value => value < 0 && value >= -1e-12 ? 0 : value > 1 && value <= 1+1e-12 ? 1 : value;
const projectedPoint = point => ({x:boundary(point.x),y:boundary(point.y)});
const valid = quad => {
  const result = sanitizeSpeedsterUnitQuad(quad);
  if (!result) throw Object.assign(new Error('Invalid outline'), {code:'ATLAS_GEOMETRY_QUAD_INVALID'});
  return result;
};

/** Commit path: use the newly prepared frame, never a draft/display transform. */
export function sourceQuadToPrepared(geometry, side, quad) {
  valid(quad);
  const projected = quad.map(point => projectedPoint(originalPointToPrepared(geometry, side, point)));
  return valid(projected);
}

/** Only a local placement aid when no proposal exists; never saved until Approve. */
export function focusedGeometryOutlines(geometry, side) {
  const slot = geometry.sides[side];
  const physical = clone(slot.physical?.quad ?? [{x:.15,y:.12},{x:.85,y:.12},{x:.85,y:.88},{x:.15,y:.88}]);
  const center = physical.reduce((p,q) => ({x:p.x+q.x/4,y:p.y+q.y/4}),{x:0,y:0});
  const printedOriginal = slot.printed && slot.prepared ? printedQuadOnOriginal(geometry, side)
    : physical.map(p => ({x:center.x+(p.x-center.x)*.88,y:center.y+(p.y-center.y)*.88}));
  return {physical, printedOriginal, printedAbsent:Boolean(slot.printedAbsence),
    needsPhysicalPlacement:!slot.physical, needsPrintedPlacement:!slot.printed && !slot.printedAbsence};
}

/** Camera moves image and overlays together; handle size is in viewport pixels. */
export function geometryFocusBounds(quad, image) {
  valid(quad);
  const xs=quad.map(p=>p.x*image.width),ys=quad.map(p=>p.y*image.height);
  const x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
  const padX=(x1-x0)*.085,padY=(y1-y0)*.065;
  const x=Math.max(0,x0-padX),y=Math.max(0,y0-padY);
  return {x,y,width:Math.min(image.width,x1+padX)-x,height:Math.min(image.height,y1+padY)-y};
}
export function geometryCamera(bounds, viewport, image) {
  const scale=Math.min(Math.max(1,viewport.width-40)/bounds.width,Math.max(1,viewport.height-40)/bounds.height);
  return {scale,left:(viewport.width-bounds.width*scale)/2-bounds.x*scale,
    top:(viewport.height-bounds.height*scale)/2-bounds.y*scale,width:image.width*scale,height:image.height*scale};
}

/** Draft-only homography for responsive measurement. Persistence always uses
 * sourceQuadToPrepared against the authoritative preparation returned by server. */
export function draftPrintedQuad(physical, printed) {
  valid(physical); valid(printed);
  const rows=[];
  physical.forEach(({x,y},i)=>{
    const {x:u,y:v}=canonicalCorners[i];
    rows.push([x,y,1,0,0,0,-u*x,-u*y,u],[0,0,0,x,y,1,-v*x,-v*y,v]);
  });
  for(let col=0;col<8;col++){
    let pivot=col;
    for(let r=col+1;r<8;r++) if(Math.abs(rows[r][col])>Math.abs(rows[pivot][col]))pivot=r;
    if(Math.abs(rows[pivot][col])<1e-12)throw new Error('Degenerate outline');
    [rows[col],rows[pivot]]=[rows[pivot],rows[col]];
    const divisor=rows[col][col];for(let j=col;j<9;j++)rows[col][j]/=divisor;
    for(let r=0;r<8;r++)if(r!==col){const factor=rows[r][col];for(let j=col;j<9;j++)rows[r][j]-=factor*rows[col][j];}
  }
  const h=rows.map(row=>row[8]);
  return valid(printed.map(({x,y})=>{
    const d=h[6]*x+h[7]*y+1;
    if(!Number.isFinite(d)||Math.abs(d)<1e-12)throw new Error('Invalid projection');
    return projectedPoint({x:(h[0]*x+h[1]*y+h[2])/d,y:(h[3]*x+h[4]*y+h[5])/d});
  }));
}
export function focusedCentering(physical, printed) {
  try {
    const borders=measureSpeedsterCenteringBorders(draftPrintedQuad(physical,printed));
    return {borders,leftRight:calculateCenteringBalance(borders.leftMm,borders.rightMm),
      topBottom:calculateCenteringBalance(borders.topMm,borders.bottomMm)};
  }catch{return null;}
}
