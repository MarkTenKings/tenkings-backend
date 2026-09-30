import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {publicationFixture} from '../../../packages/atlas-connected-manual/test/publication-fixture.mjs';
const require=createRequire(new URL('../../../packages/atlas-manual-workspace/package.json',import.meta.url));
const {buildSync}=require('esbuild'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const file=resolve(import.meta.dirname,'../../../docs/atlas/design/first-look/inspect-source/FinalReportReview.jsx');
const compiled=buildSync({entryPoints:[file],write:false,bundle:true,platform:'node',format:'cjs',jsx:'automatic',external:['react','react-dom','react/jsx-runtime'],alias:{'@atlas/grading-core/scoring':require.resolve('@atlas/grading-core/scoring'),'@atlas/grading-core/trace-codec':require.resolve('@atlas/grading-core/trace-codec')},logLevel:'silent'}).outputFiles[0].text;
const loaded={exports:{}};new Function('exports','require','module',compiled)(loaded.exports,require,loaded);const exports=loaded.exports;
const dir=new URL('../../../docs/atlas/design/first-look/reports/',import.meta.url),entries=JSON.parse(readFileSync(new URL('approved.json',dir))).reports;
test('hero uses actual ATLAS Inspect public renderer for all three approved packets',()=>{
 for(const e of entries){const html=renderToStaticMarkup(React.createElement(exports.ApprovedReportView,{report:e.packet.report,explanation:e.explanation,images:{},geometry:e.packet.geometry,publication:{version:e.packet.approvalVersion,reportHash:e.publicHash,reportNumber:e.packet.reportNumber}}));
 assert.match(html,/ATLAS <span>INSPECT/);assert.match(html,/HUMAN-APPROVED REPORT/);assert(html.includes(e.packet.report.identity.playerName||e.packet.report.identity.cardName));assert(html.includes('Measurement callouts'));assert(html.includes('Defect markings'));assert(!html.includes('review draft does not match'));
 }
});
test('Alakazam uses the same viewer but cannot present illustrative data as certified',()=>{
 const e=JSON.parse(readFileSync(new URL('alakazam-demo.json',dir)));const{explainAtlasManualReport}=require('@atlas/grading-core/manual-report');assert.equal(e.demo,true);assert.equal(e.report.finalGrade,9);assert.deepEqual(explainAtlasManualReport(e.report),e.explanation);
 const html=renderToStaticMarkup(React.createElement(exports.IllustrativeReportView,{report:e.report,explanation:e.explanation,geometry:e.geometry,images:{}}));assert.match(html,/ILLUSTRATIVE DEMO/);assert.match(html,/ILLUSTRATIVE GRADE/);assert(!html.includes('HUMAN-APPROVED REPORT'));assert(!html.includes('APPROVED GRADE'));assert(!html.includes('Approved ATLAS grading report'));assert(!html.includes('Your review, before approval'));assert.equal(e.report.cardProfile,'POKEMON');
});

const values=html=>[...html.matchAll(/<data value="([^"]+)"/g)].map(match=>Number(match[1]));
const paragraphs=html=>[...html.matchAll(/<p(?:\s[^>]*)?>[\s\S]*?<\/p>/g)].map(match=>match[0]);
test('embedded approved historical reports retain their saved policy, grades and original condition scale',()=>{
 const {explainAtlasManualReport}=require('@atlas/grading-core/manual-report');
 const before=JSON.stringify(entries);
 for(const e of entries){
  assert.deepEqual(explainAtlasManualReport(e.packet.report),e.explanation);
  const html=renderToStaticMarkup(React.createElement(exports.ApprovedReportView,{report:e.packet.report,explanation:e.explanation,images:{},geometry:e.packet.geometry,publication:{version:e.packet.approvalVersion,reportHash:e.publicHash}}));
  assert.equal((html.match(/10 band: ≤0\.2%/g)||[]).length,6);
  assert.equal((html.match(/10 band: ≤55%/g)||[]).length,2);
  assert(!html.includes('Scoring damage:'));assert(!html.includes('before the global multiplier'));
  const allowance=paragraphs(html).filter(p=>p.includes('Grade-10 allowance:')).map(p=>values(p)[0]);
  const expected=['CORNERS','EDGES','SURFACE'].flatMap(category=>['FRONT','BACK'].map(side=>e.explanation.sides[side][category].tenBandMaxWeightedAreaMm2)).filter(value=>value!==null);
  assert.equal(allowance.length,expected.length);allowance.forEach((value,index)=>assert(Math.abs(value-expected[index])<1e-12));
 }
 assert.equal(JSON.stringify(entries),before);
});
test('embedded new report displays base and globally adjusted percentages with the correct allowance and threshold scale',async()=>{
 const f=await publicationFixture(),{explainAtlasManualReport}=require('@atlas/grading-core/manual-report');
 const explanation=explainAtlasManualReport(f.full),before=JSON.stringify({report:f.full,explanation});
 assert.equal(explanation.policy.globalDamageMultiplier,1.5);
 const html=renderToStaticMarkup(React.createElement(exports.ApprovedReportView,{report:f.full,explanation,images:{},publication:{version:1,reportHash:'f'.repeat(64)}}));
 assert(!html.includes('review draft does not match'));
 assert.equal((html.match(/10 band: ≤0\.01%/g)||[]).length,6);
 assert.equal((html.match(/10 band: ≤55%/g)||[]).length,2);
 assert.equal((html.match(/<span>0\.1%<\/span>/g)||[]).length,6);
 assert(html.includes('Scoring damage in a category'));
 const sides=['CORNERS','EDGES','SURFACE'].flatMap(category=>['FRONT','BACK'].map(side=>explanation.sides[side][category]));
 const adjusted=paragraphs(html).filter(p=>p.includes('Scoring damage:')).map(values);
 assert.deepEqual(adjusted,sides.map(value=>[value.weightedDamagePercent,1.5,value.scoringDamagePercent]));
 const base=paragraphs(html).filter(p=>p.includes('Weighted damage:')&&p.includes('÷')).map(values);
 assert.deepEqual(base,sides.filter(value=>value.eligibleAreaMm2!==null).map(value=>[value.weightedAreaMm2,value.eligibleAreaMm2,value.weightedDamagePercent]));
 const allowance=paragraphs(html).filter(p=>p.includes('Grade-10 allowance:'));
 assert.equal(allowance.length,2);
 allowance.forEach((p,index)=>{assert(p.includes('before the global multiplier'));assert(Math.abs(values(p)[0]-sides.filter(value=>value.eligibleAreaMm2!==null)[index].eligibleAreaMm2*.01/100/1.5)<1e-12);});
 const displayedDamage=[...html.matchAll(/<span>Scoring category damage<\/span><strong>([\s\S]*?)<\/strong>/g)].map(match=>values(match[1])[0]);
 assert.deepEqual(displayedDamage,sides.map(value=>value.scoringDamagePercent));
 assert.equal(JSON.stringify({report:f.full,explanation}),before);
});
