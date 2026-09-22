import assert from 'node:assert/strict';

// Independent ICC matrix/parametric-TRC oracle. It never calls Sharp/libvips to
// convert color; input and output samples are read with ICC handling disabled.
export function matrixProfile(icc) {
  const tags = new Map();
  for (let i = 0; i < icc.readUInt32BE(128); i++) {
    const at = 132 + i * 12, start = icc.readUInt32BE(at + 4), size = icc.readUInt32BE(at + 8);
    tags.set(icc.toString('ascii', at, at + 4), icc.subarray(start, start + size));
  }
  const fixed = (b, at) => b.readInt32BE(at) / 65536;
  const columns = ['rXYZ', 'gXYZ', 'bXYZ'].map(tag => [8, 12, 16].map(at => fixed(tags.get(tag), at)));
  const curves = ['rTRC', 'gTRC', 'bTRC'].map(tag => {
    const b = tags.get(tag); assert.equal(b.toString('ascii', 0, 4), 'para'); assert.equal(b.readUInt16BE(8), 3);
    return [12, 16, 20, 24, 28].map(at => fixed(b, at));
  });
  return { matrix: [0, 1, 2].map(row => columns.map(column => column[row])), curves };
}
function inverse3(m) {
  const [[a,b,c],[d,e,f],[g,h,i]] = m, det = a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);
  return [[e*i-f*h,c*h-b*i,b*f-c*e],[f*g-d*i,a*i-c*g,c*d-a*f],[d*h-e*g,b*g-a*h,a*e-b*d]].map(row=>row.map(v=>v/det));
}
export function colorOracle(sourceProfile, targetProfile, rgb) {
  const src = matrixProfile(sourceProfile), dst = matrixProfile(targetProfile);
  const linear = rgb.map((value, i) => {
    const x=value/255,[g,a,b,c,d]=src.curves[i]; return x>=d ? (a*x+b)**g : c*x;
  });
  const xyz = src.matrix.map(row => row.reduce((n,v,i)=>n+v*linear[i],0));
  return inverse3(dst.matrix).map((row,i)=>{
    const y=row.reduce((n,v,k)=>n+v*xyz[k],0),[g,a,b,c,d]=dst.curves[i];
    return Math.round(255*Math.max(0,Math.min(1,y>=c*d ? (Math.max(0,y)**(1/g)-b)/a : y/c)));
  });
}
