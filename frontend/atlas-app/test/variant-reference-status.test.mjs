import test from 'node:test';
import assert from 'node:assert/strict';
import { variantReferenceNotices, variantSourceReleaseDetails } from '../lib/variant-reference-status.mjs';
const fixture = () => ({ state: 'READY', result: { catalog: { snapshotHash: 'current', problems: [], candidates: [{candidateId:'one'}],
  referencePhotos: [1,2,3,4].map(n=>({imageId:`image-${n}`,sha256:String(n).repeat(64)})) },
  referenceLabels: { version:'atlas-slab-label-associations/v1',catalogHash:'current',readings:[
    {imageId:'image-2',sha256:'2'.repeat(64),candidateId:null,labelText:null},
    {imageId:'image-3',sha256:'3'.repeat(64),candidateId:null,labelText:'Literal unresolved text'},
    {imageId:'image-4',sha256:'4'.repeat(64),candidateId:'one',labelText:'Literal matched text'},
  ] } } });
test('saved reading absence, unreadable text and unassociated text remain separate, without mutation',()=>{
  const value=fixture(),before=structuredClone(value),notices=variantReferenceNotices(value);
  assert.deepEqual(notices.map(n=>n.code),['REFERENCE_READING_NOT_SAVED','REFERENCE_TEXT_UNREADABLE','REFERENCE_TEXT_UNASSOCIATED']);
  assert(notices.every(n=>n.text.startsWith('1 saved')));assert.deepEqual(value,before);
});
test('stale hashes and mismatched image IDs never claim that current photos were read',()=>{
  const value=fixture();value.result.referenceLabels.catalogHash='old';
  assert.deepEqual(variantReferenceNotices(value).map(n=>n.code),['REFERENCE_READING_NOT_SAVED']);
  assert.match(variantReferenceNotices(value)[0].text,/4 saved/);
  value.result.referenceLabels.catalogHash='current';value.result.referenceLabels.readings[2].imageId='unrelated';
  assert.match(variantReferenceNotices(value)[0].text,/2 saved/);
});
test('duplicate display bytes and absent candidate targets do not hide unresolved photos',()=>{
  const value=fixture();value.result.catalog.referencePhotos.push(value.result.catalog.referencePhotos[0]);value.result.catalog.candidates=[];
  assert.match(variantReferenceNotices(value)[0].text,/1 saved/);
  assert.match(variantReferenceNotices(value).find(n=>n.code==='REFERENCE_TEXT_UNASSOCIATED').text,/2 saved/);
});
test('scope, no row, season ambiguity, failures and zero listings have distinct notices',()=>{
  const codes=['CHECKLIST_SCOPE_NOT_RETAINED','CHECKLIST_CARD_NOT_FOUND','CHECKLIST_SEASON_AMBIGUOUS','PROVIDER_UNAVAILABLE','LISTING_SOURCE_UNAVAILABLE','LISTING_SOURCE_OUTCOME_UNKNOWN','LISTING_NO_RESULTS','LISTING_IMAGES_INCOMPLETE'];
  const texts=codes.map(code=>variantReferenceNotices({result:{catalog:{problems:[code],candidates:[]}}})[0].text);
  assert.equal(new Set(texts).size,codes.length);
  assert.match(texts[0],/does not establish/);assert.match(texts[1],/coverage may be incomplete/);
  assert.match(texts[6],/A saved listing search/);assert.match(texts[7],/different from a search returning no listings/);
});
test('known choices remain choices; multiple variants alone are not an ambiguity error',()=>{
  assert.deepEqual(variantReferenceNotices({result:{catalog:{candidates:[{candidateId:'one'},{candidateId:'two'}],problems:[]}}}),[]);
  assert.deepEqual(variantReferenceNotices(null),[]);
});
test('competing source releases display literal scopes without changing candidate identity or labels',()=>{
  const choices=['baseball','football'].map(sport=>({candidateId:sport,label:'Base',parallel:'Base',
    source:{release:{manufacturer:'Leaf',sports:[sport],year:'2018',setName:`2018 Leaf ${sport}`}}}));
  const before=structuredClone(choices),details=variantSourceReleaseDetails(choices);
  assert.equal(details.size,2);assert.match(details.get('baseball'),/Leaf · 2018 Leaf baseball · baseball · 2018/);
  assert.match(details.get('football'),/football/);assert.deepEqual(choices,before);
});
test('a single release across sport classifications or unknown old scopes is not guessed or duplicated',()=>{
  const release={manufacturer:'Upper Deck',sports:['golf','basketball'],year:'2020',setName:'Goodwin Champions'};
  assert.equal(variantSourceReleaseDetails([{candidateId:'one',source:{release}},{candidateId:'two',source:{release:{...release,sports:['basketball','golf']}}}]).size,0);
  assert.equal(variantSourceReleaseDetails([{candidateId:'one',source:{release}},{candidateId:'old',identity:{year:'1900',setName:'Unknown'}}]).size,0);
});

test('product or sport scope ambiguity is distinct from abbreviated-season ambiguity',()=>{
  const notice=variantReferenceNotices({result:{catalog:{problems:['CHECKLIST_SCOPE_AMBIGUOUS'],candidates:[]}}});
  assert.deepEqual(notice,[{code:'CHECKLIST_SCOPE_AMBIGUOUS',text:'The saved checklist matches more than one product or sport. Review the source details before choosing a printing.'}]);
  assert.doesNotMatch(notice[0].text,/alias|season|does not exist/);
});
