import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,extname} from 'node:path';
import {createRequire} from 'node:module';
import config from '../next.config.mjs';
import {capacityView} from '../../../docs/atlas/design/experience/site/weekly-capacity.mjs';
const root=resolve(import.meta.dirname,'../public');
const html=readFileSync(resolve(root,'homepage/index.html'),'utf8');
const release=JSON.parse(readFileSync(resolve(root,'homepage/release.json')));
const source=resolve(import.meta.dirname,'../../../docs/atlas/design/experience');
const names=JSON.parse(readFileSync(resolve(source,'files.json')));
const {parse}=createRequire(import.meta.url)('next/dist/compiled/acorn');
function moduleSpecifiers(text){
 const pending=[parse(text,{ecmaVersion:'latest',sourceType:'module'})],specifiers=[];
 while(pending.length){
  const node=pending.pop();
  if(['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration','ImportExpression'].includes(node.type)&&typeof node.source?.value==='string')specifiers.push(node.source.value);
  for(const value of Object.values(node)){
   if(Array.isArray(value))for(const child of value){if(child?.type)pending.push(child);}
   else if(value?.type)pending.push(value);
  }
 }
 return specifiers;
}
test('homepage rewrite leaves service and report routes untouched',async()=>{
 assert.deepEqual(await config.rewrites(),{beforeFiles:[{source:'/',destination:'/homepage/index.html'}]});
 assert.match(readFileSync(resolve(import.meta.dirname,'../middleware.js'),'utf8'),/matcher: \['\/admin\/:path\*', '\/account\/:path\*'\]/);
});
test('homepage retains ATLAS identity, real evidence, and honest archived status',()=>{
 assert(html.includes('<span>SEE WHY</span><span>IT’S A <em>9.</em></span>'));
 for(const id of ['hero-title','fingerprint','slab','connected-proof','submit','capacity-title'])assert(html.includes(`id="${id}"`),id);
 assert(html.includes('WE SHOW YOU EVERYTHING.'));assert(html.includes('href="/account/submit"'));assert(!html.includes('127.0.0.1'));assert(!html.includes('DESIGN STUDY 10'));assert(!html.includes('noindex,nofollow'));assert(!html.includes('Interactive design preview'));
 const manifest=JSON.parse(readFileSync(resolve(root,'homepage',release.version,'hero-assets/manifest.json')));
 assert.equal(manifest.report.status,'ARCHIVED_APPROVED_SAMPLE');assert.equal(manifest.report.liveUrl,null);assert.equal(manifest.provenance.liveRecordRestored,false);
 assert.equal(manifest.report.finalGrade,9.5);assert.equal(manifest.report.findingCount,7);
 assert.equal(release.approvedReportCount,0);assert.equal(release.archivedSampleCount,1);
});
test('complete content digest includes every dependency and all local references resolve',()=>{
 const hash=createHash('sha256').update('atlas-experience-v1\n').update(readFileSync(resolve(import.meta.dirname,'../scripts/build-homepage.mjs')));
 for(const name of [...names].sort()){const bytes=readFileSync(resolve(source,'site',name));hash.update(name+'\0').update(String(bytes.length)+'\0').update(bytes);}
 assert.equal(release.version,hash.digest('hex').slice(0,16));assert.equal(release.sourceFileCount,names.length);
 for(const name of names){const p=resolve(root,'homepage',release.version,name);assert(existsSync(p),name);if(!['.html','.js','.mjs','.css','.json'].includes(extname(name)))continue;
  const s=readFileSync(p,'utf8');assert(!s.includes('/Users/'),name);assert(!s.includes('127.0.0.1'),name);
  for(const item of names)assert(!s.includes(`"/${item}"`)&&!s.includes(`'/${item}'`),`${name}: unreleased ${item}`);
 }
 for(const match of html.matchAll(/(?:src|href)="(\/[^"?#]+)(?:[?#][^"]*)?"/g)){const p=match[1];if(p==='/account/submit')continue;assert(existsSync(resolve(root,'.'+p)),p);}
});
test('packaged static and dynamic module imports resolve from their actual module URL',()=>{
 let checked=0;
 for(const name of names.filter(name=>/\.(?:m?js)$/.test(name))){
  const url=new URL(`/homepage/${release.version}/${name}`,'https://atlasgrading.com');
  // Parse actual imports: vendored documentation and prose strings may also
  // contain "from" or example imports, but are not executable dependencies.
  const text=readFileSync(resolve(root,'.'+url.pathname),'utf8');
  for(const specifier of moduleSpecifiers(text)){
   const target=new URL(specifier,url);assert.equal(target.origin,url.origin,`${name}: external module`);
   assert(target.pathname.startsWith(`/homepage/${release.version}/`),`${name}: module outside packaged closure`);
   assert(existsSync(resolve(root,'.'+target.pathname)),`${name}: unresolved module ${specifier}`);checked++;
  }
 }
 assert(checked>=7,'module graph must actually be checked');
 const hero=readFileSync(resolve(root,'homepage',release.version,'hero-controller.mjs'),'utf8');
 assert(hero.includes("from './hero-evidence.mjs'"));
});
const current={version:'atlas-weekly-capacity-v1',unit:'CARDS',timeZone:'America/Los_Angeles',resetLocalTime:'00:01',weekStartsAt:'2026-09-28T07:01:00Z',resetsAt:'2026-10-05T07:01:00Z',asOf:'2026-10-01T19:00:00Z',pools:[{channel:'MAIL_IN',state:'AVAILABLE',quotaCards:1000,heldCards:20,acceptedCards:800,remainingCards:180},{channel:'DEALER_DROP_OFF',state:'NOT_CONFIGURED',quotaCards:null,heldCards:0,acceptedCards:0,remainingCards:null}]};
test('capacity display never invents counts and clears stale or inconsistent data',()=>{
 const now=Date.parse(current.asOf);assert.equal(capacityView(current,now).pools[0].remaining,180);assert.equal(capacityView(current,now).pools[1].remaining,null);
 assert.equal(capacityView(current,now+121000),null);assert.equal(capacityView({...current,resetsAt:current.asOf},now),null);
 const invalid=structuredClone(current);invalid.pools[0].remainingCards=999;assert.equal(capacityView(invalid,now),null);
 const duplicate=structuredClone(current);duplicate.pools[1]=duplicate.pools[0];assert.equal(capacityView(duplicate,now),null);
});
