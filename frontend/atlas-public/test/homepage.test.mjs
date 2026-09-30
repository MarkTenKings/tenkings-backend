import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import config from '../next.config.mjs';

const root=resolve(import.meta.dirname,'../public');
const homepage=resolve(root,'homepage');
const html=readFileSync(resolve(homepage,'index.html'),'utf8');

test('homepage rewrite is exact and leaves service/report routes untouched',async()=>{
 assert.deepEqual(await config.rewrites(),{beforeFiles:[{source:'/',destination:'/homepage/index.html'}]});
 const middleware=readFileSync(resolve(import.meta.dirname,'../middleware.js'),'utf8');
 assert.match(middleware,/matcher: \['\/admin\/:path\*', '\/account\/:path\*'\]/);
});

test('ungraded homepage keeps the marketing and submission journey without a fake graded card',()=>{
 for(const id of ['hero-title','empty-title','approach','signature-title','tap-title','services'])assert(html.includes(`id="${id}"`),id);
 for(const copy of ['No graded cards are published','A visual record of saved findings','not a cryptographic authenticity test','href="/account/submit"'])assert(html.includes(copy),copy);
 for(const old of ['Alakazam','Abomasnow','Maye','Dart','ILLUSTRATIVE GRADE','SAMPLE / 001','approved.json','alakazam-demo','<video','<figure'])assert(!html.includes(old),old);
 assert.deepEqual([...html.matchAll(/<img\s[^>]*src="([^"]+)"/g)].map(match=>match[1]),['/brand/atlas-grading-logo.png','/brand/atlas-grading-logo.png']);
});

test('published homepage package contains no card photographs, mock reports or old versioned assets',()=>{
 const release=JSON.parse(readFileSync(resolve(homepage,'release.json')));
 assert.equal(release.presentation,'ungraded-empty-state');
 assert.equal(release.illustrativeReport,false);
 assert.equal(release.approvedReportCount,0);
 assert.deepEqual(readdirSync(homepage).sort(),[release.version,'index.html','release.json'].sort());
 assert.deepEqual(readdirSync(resolve(homepage,release.version)),['site.css']);
 assert(html.includes(`/homepage/${release.version}/site.css`));
 for(const match of html.matchAll(/(?:src|href)="(\/[^"?#]+)(?:[?#][^"]*)?"/g)){
  const path=match[1];if(path==='/account/submit')continue;
  assert(existsSync(resolve(root,'.'+path)),path);
 }
});
