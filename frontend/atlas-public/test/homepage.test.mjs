import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import config from '../next.config.mjs';
const root=resolve(import.meta.dirname,'../public');
const html=readFileSync(resolve(root,'homepage/index.html'),'utf8');
test('homepage rewrite is exact and leaves service/report routes untouched',async()=>{
 assert.deepEqual(await config.rewrites(),{beforeFiles:[{source:'/',destination:'/homepage/index.html'}]});
 const middleware=readFileSync(resolve(import.meta.dirname,'../middleware.js'),'utf8');
 assert.match(middleware,/matcher: \['\/admin\/:path\*', '\/account\/:path\*'\]/);
});
test('published document contains approved sections and honest sample disclosures',()=>{
 for(const id of ['hero-title','fingerprint','slab','connected-proof','submit'])assert(html.includes(`id="${id}"`));
 for(const text of ['ILLUSTRATIVE GRADE','Not measured from this photograph','SAMPLE / 001','SAME LABEL.','SAME CARD?' ])assert(html.includes(text),text);
 assert(!html.includes('DESIGN STUDY 09'));assert(!html.includes('127.0.0.1'));assert(html.includes('href="/account/submit"'));
});
test('every local document asset exists inside the public release',()=>{
 for(const match of html.matchAll(/(?:src|href)="(\/[^"?#]+)(?:[?#][^"]*)?"/g)){
  const p=match[1];if(p==='/account/submit')continue;
  assert(existsSync(resolve(root,'.'+p)),p);
 }
});
test('versioned scripts and styles do not retain loopback preview paths',()=>{
 const {version}=JSON.parse(readFileSync(resolve(root,'homepage/release.json')));
 for(const file of ['study.js','slab.js','study.css','submission-source.css','hero-reports.js','hero-report-model.mjs','report-guidance.js']){
  const s=readFileSync(resolve(root,'homepage',version,file),'utf8');
  assert(!s.includes('127.0.0.1'));assert(!s.includes('"/assets/'));assert(!s.includes("'/assets/"));
 }
});
