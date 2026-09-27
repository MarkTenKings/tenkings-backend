import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
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
