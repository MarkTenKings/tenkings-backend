import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {buildCenteringInstruments,buildInspectionInstruments,formatMillimeters} from '../../../docs/atlas/design/experience/site/hero-metrology.mjs';
import {canonicalToSource,canonicalToCleanUV,cleanUVToSource} from '../../../docs/atlas/design/experience/site/hero-evidence.mjs';
const manifest=JSON.parse(fs.readFileSync(fileURLToPath(new URL('../../../docs/atlas/design/experience/site/hero-assets/manifest.json',import.meta.url))));
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
test('front and back four-border widths match actual saved printed geometry calibration',()=>{
 for(const [side,values]of [['FRONT',[3.4,3.2,3,4.3]],['BACK',[3.25,3.5,2.6,4.5]]]){
  const m=buildCenteringInstruments(side,manifest);assert.ok(m.balancesMatch);assert.deepEqual(m.gaps.map(g=>g.id),['left','right','top','bottom']);m.gaps.forEach((g,i)=>near(g.valueMm,values[i]));
  for(const [key,ratios]of Object.entries(m.ratios))ratios.forEach((n,i)=>near(n,manifest.sides[side].centering[key][i]));
 }
});
test('saved physical outline is retained separately from complete calibrated cell extents',()=>{
 const m=buildCenteringInstruments('FRONT',manifest);assert.deepEqual(m.physicalQuad,[[0,0],[1269,0],[1269,1777],[0,1777]]);assert.deepEqual(m.calibrationQuad,[[0,0],[1270,0],[1270,1778],[0,1778]]);
 assert.deepEqual(m.printedQuad,[[68,60],[1206,60],[1206,1692],[68,1692]]);
 const r=m.gaps.find(g=>g.id==='right');assert.deepEqual(r.from,[1270,876]);assert.deepEqual(r.to,[1206,876]);near(r.valueMm,3.2);
});
test('all four border instruments map back through presentation to the same source photograph',()=>{
 for(const side of ['FRONT','BACK']){const s=manifest.sides[side],m=buildCenteringInstruments(s,manifest);for(const g of m.gaps)for(const p of [g.from,g.to,g.labelPoint]){
  const expected=canonicalToSource(s,p),actual=cleanUVToSource(s,canonicalToCleanUV(s,p));near(actual[0],expected[0]);near(actual[1],expected[1]);
 }}
});
test('all9 saved region cell extents match the report measurements without union substitution',()=>{
 let count=0;for(const finding of manifest.findings){const result=buildInspectionInstruments(finding,manifest.sides[finding.side],manifest.card);assert.equal(result.regions.length,finding.regions.length);for(const [i,region]of result.regions.entries()){
  count++;assert.equal(region.calipersSupported,true);assert.deepEqual(region.measurement,finding.regions[i].measurement);const b=region.boundsCanonical;near((b[2]-b[0])*.05,region.measurement.widthMm);near((b[3]-b[1])*.05,region.measurement.heightMm);
 }}assert.equal(count,9);
});
test('mixed finding5 has separate edge and surface caliper bounds',()=>{
 const f=manifest.findings[4],m=buildInspectionInstruments(f,manifest.sides.BACK,manifest.card);
 assert.deepEqual(m.regions.map(r=>r.boundsCanonical),[[1230,1125,1249,1133],[1224,1126,1230,1134]]);
 assert.deepEqual(m.regions.map(r=>r.labels.width),['0.95 mm','0.30 mm']);assert.ok(m.regions.every(r=>r.labels.width!=='1.25 mm'));
});
test('main macro calipers align to1194,1309→1249,1510 with saved2.75×10.05mm',()=>{
 const f=manifest.findings.find(f=>f.id===manifest.selectedMacro.findingId),m=buildInspectionInstruments(f,manifest.sides.BACK,manifest.card),r=m.regions[0];
 assert.deepEqual(r.sourceQuad,[[1194,1309],[1249,1309],[1249,1510],[1194,1510]]);assert.equal(r.labels.width,'2.75 mm');assert.equal(r.labels.height,'10.05 mm');assert.equal(r.labels.area,'12.325 mm²');
});
test('unsupported geometry never receives a falsely aligned bracket',()=>{
 const f=JSON.parse(JSON.stringify(manifest.findings[0]));f.regions[0].measurement.widthMm=.9;
 const m=buildInspectionInstruments(f,manifest.sides.FRONT,manifest.card);assert.equal(m.regions[0].calipersSupported,false);assert.equal(m.regions[0].labels.width,'0.90 mm');
 const missing=JSON.parse(JSON.stringify(manifest));missing.card.widthMm=null;assert.equal(buildCenteringInstruments('FRONT',missing),null);
});
test('instrument construction leaves approved manifest untouched',()=>{
 const before=JSON.stringify(manifest);for(const side of ['FRONT','BACK'])buildCenteringInstruments(side,manifest);for(const f of manifest.findings)buildInspectionInstruments(f,manifest.sides[f.side],manifest.card);assert.equal(JSON.stringify(manifest),before);assert.equal(formatMillimeters(.6000000000000001),'0.60 mm');
});
