/** A photographic material outline is expressed in canonical card coordinates.
 * Raw model coordinates stay in its immutable receipt; this bounded contour
 * accompanies the exact prepared frame and is part of every measurement base. */
export function validMaterialContour(value) {
  if (!Array.isArray(value) || value.length < 3 || value.length > 128 || !value.every(p => p && Object.keys(p).sort().join(',') === 'x,y'
    && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)) return false;
  const cross = (a,b,c) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const on = (a,b,p) => Math.abs(cross(a,b,p)) < 1e-12 && p.x >= Math.min(a.x,b.x)-1e-12
    && p.x <= Math.max(a.x,b.x)+1e-12 && p.y >= Math.min(a.y,b.y)-1e-12 && p.y <= Math.max(a.y,b.y)+1e-12;
  const touches = (a,b,c,d) => cross(a,b,c)*cross(a,b,d)<0 && cross(c,d,a)*cross(c,d,b)<0
    || on(a,b,c) || on(a,b,d) || on(c,d,a) || on(c,d,b);
  if (new Set(value.map(p => `${p.x}:${p.y}`)).size !== value.length) return false;
  for (let i=0;i<value.length;i++) for(let j=i+1;j<value.length;j++) {
    if(j===i+1 || i===0&&j===value.length-1) continue;
    if(touches(value[i],value[(i+1)%value.length],value[j],value[(j+1)%value.length])) return false;
  }
  let area = 0;
  for (let i = 0; i < value.length; i++) { const p=value[i], q=value[(i+1)%value.length]; area += p.x*q.y-q.x*p.y; }
  return area > 1e-8;
}
