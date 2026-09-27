import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validateFeatured,categoryDetail,categoryFindings,imagePoint,categories } from '../../../docs/atlas/design/first-look/hero-report-model.mjs';
const base=new URL('../../../docs/atlas/design/first-look/reports/',import.meta.url);
const entries=JSON.parse(readFileSync(new URL('approved.json',base))).reports;
test('featured grades are the exact human-approved awards, not decimal detail grades',()=>{
 assert.deepEqual(entries.map(e=>[validateFeatured(e).shortName,e.packet.report.finalGrade]),[['Maye',9.5],['Abomasnow',10],['Dart',10]]);
 for(const e of entries){const wrong=structuredClone(e);wrong.packet.report.finalGrade=8;assert.throws(()=>validateFeatured(wrong));}
});
test('all six local photographs match the immutable approved hash and bytes',()=>{
 for(const e of entries)for(const side of ['FRONT','BACK']){
  const bytes=readFileSync(fileURLToPath(new URL(e.images[side].split('/').pop(),base)));
  assert.equal(bytes.length,e.packet.images[side].byteCount);assert.equal(createHash('sha256').update(bytes).digest('hex'),e.packet.images[side].sha256);
  const wrong=structuredClone(e);wrong.packet.images[side].sha256='wrong';assert.throws(()=>validateFeatured(wrong));
 }
});
test('contours map to the actual padded photograph and empty categories stay empty',()=>{
 assert.deepEqual(imagePoint({x:0,y:0}),{x:40/1350,y:40/1858});
 assert.deepEqual(imagePoint({x:1,y:1}),{x:1310/1350,y:1818/1858});
 for(const e of entries)for(const category of categories)for(const side of ['FRONT','BACK']){
  const detail=categoryDetail(e,category,side);assert.equal(detail.score,e.packet.report.grade.subgrades[category]);
  for(const p of detail.points){const q=imagePoint(p);assert(q.x>=0&&q.x<=1&&q.y>=0&&q.y<=1);}
 }
 const dart=entries.find(e=>e.key==='dart');assert.equal(categoryFindings(dart,'surface').length,0);assert.equal(categoryDetail(dart,'surface','FRONT').path,'');
 const removed=structuredClone(entries[0]);removed.packet.report.findings.forEach(f=>f.reviewResult='REMOVED');assert.equal(categoryFindings(removed,'surface').length,0);
});
