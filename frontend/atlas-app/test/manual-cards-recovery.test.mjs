import {reviewImagePreview} from '@atlas/manual-workspace';
import * as reviewIdentity from '../lib/review-identity.mjs';
import * as reviewAttention from '../lib/manual-review-attention.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import * as identity from '@atlas/grading-core/identity';
import * as defectAnalysisClient from '../lib/manual-defect-analysis-client.mjs';
import { manualMessage } from '../lib/manual-client.mjs';
import * as discard from '../lib/card-discard.mjs';
import * as reviewFeedback from '../lib/review-feedback.mjs';
import * as variantReview from '../lib/variant-review-client.mjs';

const require = createRequire(import.meta.url);
const babel = require('next/dist/compiled/babel/core');
const nextRequire = createRequire(require.resolve('next/package.json'));
const compiled = babel.transformSync(readFileSync(new URL('../components/ManualCards.jsx', import.meta.url), 'utf8'), {
  filename: 'ManualCards.jsx', presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } } }]],
  babelrc: false, configFile: false,
}).code;
const key = 'atlas-connected-command:reviewer:card';
const command = { path: '/api/staff/manual-connected/cards/card/details', body: { actionId: 'first', expectedRevision: 1, changes: { name: 'First' } } };
const storage = (initial = command) => { const values = new Map(initial ? [[key, JSON.stringify(initial)]] : []); return {
  getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k),
}; };
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function harness(store, post, { readCard, intake = {}, message = error => error.code ?? 'Retained', fromBatch = false } = {}) {
  const slots = [], effects = [], cleanups=[],timers=new Map(),listeners=new Map(),navigations=[]; let cursor = 0, tree, activeCardId='card';
  const react = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), Fragment: 'fragment',
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useEffect(action, deps) { const i = cursor++, before = slots[i]; if (!before || deps.some((v, n) => v !== before[n])) { slots[i] = deps; effects.push(()=>{cleanups[i]?.();cleanups[i]=action();}); } },
    useCallback: action => action,
  };
  const card = { revision: 1, card: { ready: false, sourceHash: 'source', sides: { FRONT: { version: 0 }, BACK: { version: 0 } } },
    identification: { state: 'UNAVAILABLE' }, details: { fields: {}, profile: 'SPORTS' } };
  const exports = {};
  vm.runInNewContext(compiled, { exports, crypto: { randomUUID }, localStorage: store, setInterval:(callback,ms)=>{timers.set(ms,callback);return ms;}, clearInterval:ms=>timers.delete(ms),
    window: { addEventListener(name,action) {listeners.set(name,action);}, removeEventListener(name) {listeners.delete(name);} },
    require(name) {
      if (name === 'react') return react;
      if (name === '../lib/variant-review-client.mjs') return variantReview;
      if (name === '../lib/manual-review-attention.mjs') return reviewAttention;
      if (name === '../lib/review-identity.mjs') return reviewIdentity;
      if (name === './ReviewIdentityPanel') return {__esModule:true,default:'ReviewIdentityPanel'};
      if (name === './ReviewAttention') return {__esModule:true,default:'ReviewAttention'};
      if (name === './CompletionNextSteps') return {__esModule:true,default:'CompletionNextSteps'};
      if (name === './RapidReviewControls') return {RapidActionDock:'RapidActionDock',RapidEditDock:'RapidEditDock',DirectCardReviewShell:'DirectCardReviewShell'};
      if (name === '../lib/review-feedback.mjs') return {...reviewFeedback,primeReviewAudio(){},playReviewCompletion(){},playAtlasVoice(){}};
      if (name === '../lib/card-discard.mjs') return {...discard,createWorkspaceDiscarder:()=>({pending:()=>false,reconcile:async()=>null})};
      if (name === '../lib/batch-import.mjs') return {createBrowserBatchImportJournal:()=>({close(){}})};
      if (name === 'next/router') return { useRouter: () => ({ query:fromBatch?{from:'batch'}:{}, replace:async path=>{navigations.push(path);},events: { on() {}, off() {} } }) };
      if (name === 'next/link' || name === './Shell') return { default: name };
      if (name === './ReportPhotoUploader') return {__esModule:true,default:'ReportPhotoUploader'};
      if (name === './VariantIdentityReview') return {__esModule:true,default:'VariantIdentityReview'};
      if (name === './ReportMarketPicker') return {__esModule:true,default:'ReportMarketPicker'};
      if (name === './ReportResearchPicker') return {__esModule:true,default:'ReportResearchPicker'};
      if (name === './DealerOfferPicker') return {__esModule:true,default:'DealerOfferPicker'};
      if (name === './ManualFinishing') return {__esModule:true,default:'ManualFinishing',openManualLabelPrintWindow:()=>null};
      if (name === '@atlas/manual-intake/client') return { createBrowserIntakeJournal: () => ({ close() {} }), createIntakeClient: () => ({ pending: async () => [], ...intake }) };
      if (name === '@atlas/grading-core/identity') return identity;
      if (name === '@atlas/manual-workspace') return {reviewImagePreview};
      if (name.startsWith('@atlas/')) return {};
      if (name === '../lib/routes.mjs') return { STAFF_BASE_PATH: '/admin' };
      if (name === '../lib/manual-defect-analysis-client.mjs') return defectAnalysisClient;
      if (name === '../lib/manual-client.mjs') return { manualMessage: message, manualRequest: async (path, options = {}) => {
        if (options.method === 'POST') return post(path, options);
        return path.endsWith('/session') ? { staff: { id: 'reviewer' }, csrf: 'csrf' } : readCard ? readCard(path, options) : card;
      } };
      return nextRequire(name.startsWith('@babel/runtime/') ? `next/dist/compiled/${name}` : name);
    },
  });
  const text = node => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : node ?? '';
  function find(node, matches) {
    if (Array.isArray(node)) { for (const child of node) { const hit = find(child, matches); if (hit) return hit; } }
    else if (node && typeof node === 'object') { if (matches(node)) return node; return find(node.props?.children, matches); }
  }
  const button = label => find(tree, node => node.type === 'button' && text(node) === label);
  const field = label => find(tree, node => node.props?.['aria-label'] === label);
  const submit = () => { const form=find(tree,node=>node.type==='form'); assert.ok(form,'details form');form.props.onSubmit({preventDefault(){}}); };
  const render = () => { cursor = 0; tree = exports.default({ staff: { id: 'reviewer', role: 'REVIEWER' }, cardId: activeCardId }); for (const effect of effects.splice(0)) effect(); };
  return { render, submit,navigations,event(name,value){listeners.get(name)?.(value);},async tick(){timers.get(2000)?.();await flush();render();},dispose(){cleanups.forEach(cleanup=>cleanup?.());}, navigate(cardId){activeCardId=cardId;render();}, upload(side,file={name:side}) { const target=field(`${side} original photo`);assert.ok(target);assert.notEqual(target.props.disabled,true);target.props.onChange({target:{files:[file],value:'picked'}}); }, workspace:()=>Boolean(find(tree,node=>node.type?.name==='ManualWorkspace')), click(label) { const target = button(label); assert.ok(target, label); assert.notEqual(target.props.disabled, true, label); target.props.onClick(); },
    workspaceProps:()=>find(tree,node=>node.type?.name==='ManualWorkspace')?.props,
    directShell:()=>find(tree,node=>node.type==='DirectCardReviewShell')?.props,
    previewSrc:side=>find(tree,node=>node.type==='img'&&[`${side} background-removed grading image`,`${side} original grading photo`].includes(node.props.alt))?.props.src,
    previewAlt:side=>find(tree,node=>node.type==='img'&&String(node.props.alt).startsWith(`${side} `))?.props.alt,
    attention:key=>find(tree,node=>node.props?.['data-review-target']===key)?.props?.['data-review-attention'],reviewIssues:()=>find(tree,node=>node.type==='ReviewAttention')?.props?.issues??[],has(label) { return Boolean(button(label)); }, disabled(label) { return button(label)?.props.disabled === true; }, text: () => text(tree), sideText:side=>text(find(tree,node=>node.type==='article'&&text(node).startsWith(side))), field,
    change(label, value) { const target = field(label); assert.ok(target, label); target.props.onChange({ target: { value } }); } };
}

for (const status of [200, 409]) test(`actual photo/details recovery preserves a newer uncertain save after an older ${status} reply`, async () => {
  const store = storage(); let finish;
  const late = harness(store, () => new Promise((resolve, reject) => { finish = () => status === 200 ? resolve({}) : reject({ status }); }));
  const fast = harness(store, async () => ({}));
  late.render(); fast.render(); await flush(); late.render(); fast.render();
  late.click('Resume saved request'); fast.click('Resume saved request'); await flush();
  assert.equal(store.getItem(key), null, 'the first recovery finished');
  const newer = { ...command, body: { ...command.body, actionId: 'second', changes: { name: 'Second' } } };
  store.setItem(key, JSON.stringify(newer));
  finish(); await flush(); late.render();
  assert.deepEqual(JSON.parse(store.getItem(key)), newer, 'late completion must retain the exact next command');
  assert.equal(late.has('Resume saved request'), true, 'the pending command remains visible');
});

test('a stale rendered recovery button cannot redispatch a replaced journal command', async () => {
  const store = storage(); let posts = 0;
  const f = harness(store, async () => { posts++; return {}; });
  f.render(); await flush(); f.render();
  const newer = { ...command, body: { ...command.body, actionId: 'second' } };
  store.setItem(key, JSON.stringify(newer));
  f.click('Resume saved request'); await flush(); f.render();
  assert.equal(posts, 0);
  assert.deepEqual(JSON.parse(store.getItem(key)), newer);
  assert.equal(f.has('Resume saved request'), true);
});

test('an unavailable photo/details reply retains the exact original request for retry', async () => {
  const store = storage(), original = store.getItem(key);
  const f = harness(store, async () => { throw { status: 503 }; });
  f.render(); await flush(); f.render(); f.click('Resume saved request'); await flush(); f.render();
  assert.equal(store.getItem(key), original);
  assert.equal(f.has('Resume saved request'), true);
});

const pokemonCard = () => ({ revision: 7,
  card: { ready: true, sourceHash: 'pokemon-source', sides: { FRONT: { version: 1 }, BACK: { version: 1 } } },
  identification: { state: 'COMPLETE' },
  details: { profile: 'POKEMON', layoutType: 'TRAINER', fields: { name: 'Saved name', year:'2024', set_name: 'Saved set', card_number:'' }, parallel:'',insert:'' },
});

for (const { label, field } of [
  { label: 'Card family', field: 'profile' },
]) test(`actual card details keep a cleared saved ${field} blank and explain required fields before combined submission`, async () => {
  const store = storage(null), posts = []; let card = pokemonCard();
  const f = harness(store, async (path, options) => {
    posts.push({ path, body: JSON.parse(JSON.stringify(options.body)) });
    card = { ...card, revision: 8, details: { ...card.details, [field]: null } };
    return {};
  }, { readCard: () => card });
  f.render(); await flush(); f.render();
  assert.equal(f.field('Card family').props.value, 'POKEMON');
  assert.equal(f.field('Pokémon card kind').props.value, 'TRAINER');
  f.change(label, ''); f.render();
  assert.equal(f.field(label).props.value, '', 'the explicit clear must not fall back to the saved value');
  assert.equal(Boolean(f.field('Pokémon card kind')), field !== 'profile', 'layout visibility follows the edited family');
  f.submit(); await flush(); f.render();
  assert.equal(posts.length,0,'invalid identity is explained without saving or initializing');
  assert.equal(f.field(label).props['aria-invalid'],true);
  assert.equal(f.field(label).props.value, '');
  assert.equal(store.getItem(key), null, 'no invalid command is journaled');
});

test('actual pending null selections and empty text survive a later recognition refresh', async () => {
  const store = storage(null), posts = []; let finishIdentification;
  let card = { ...pokemonCard(), identification: { state: 'NOT_STARTED' } };
  const f = harness(store, async (path, options) => {
    if (path.endsWith('/identify')) return new Promise(resolve => { finishIdentification = resolve; });
    posts.push({ path, body: JSON.parse(JSON.stringify(options.body)) });
    return {};
  }, { readCard: () => card });
  f.render(); await flush(); f.render();
  assert.equal(typeof finishIdentification, 'function', 'recognition is in flight while details are editable');
  f.change('Pokémon card kind', ''); f.change('Card family', ''); f.change('Name', ''); f.render();
  card = { ...pokemonCard(), revision: 9, details: { ...pokemonCard().details,
    fields: { name: 'Recognized name', set_name: 'Recognized set' } } };
  finishIdentification({}); await flush(); f.render();
  assert.equal(f.field('Card family').props.value, '');
  assert.equal(f.field('Pokémon card kind'), undefined);
  assert.equal(f.field('Name').props.value, '');
  assert.equal(f.field('Product / set').props.value, 'Recognized set', 'untouched fields receive the new recognition');
  f.submit(); await flush(); f.render();
  assert.equal(posts.length,0);
  assert.equal(f.field('Card family').props.value,'');
  assert.equal(f.field('Name').props.value,'');
});

const rejectedCard = () => ({ ...pokemonCard(), identification: { state: 'UNKNOWN', attemptId: 'rejected-attempt',
  rejection: { code: 'API_CREDIT_BALANCE_EXHAUSTED', canRetry: true } } });

test('a verified credit rejection explains the billing failure without automatically retrying', async () => {
  const store = storage(null); let posts = 0;
  const f = harness(store, async () => { posts++; return {}; }, { readCard: rejectedCard });
  f.render(); await flush(); f.render(); await flush(); f.render();
  assert.match(f.text(), /identification request was rejected because the ATLAS API credit balance was exhausted/);
  assert.match(f.text(), /original photos are saved/);
  assert.equal(f.has('Retry identification'), true);
  assert.equal(posts, 0);
  assert.equal(store.getItem(key), null);
});

test('explicit identification retry journals one action and resumes that same action after a lost reply', async () => {
  const store = storage(null), posts = []; let card = rejectedCard();
  const f = harness(store, async (path, options) => {
    posts.push({ path, body: JSON.parse(JSON.stringify(options.body)) });
    assert.deepEqual(JSON.parse(store.getItem(key)), posts.at(-1), 'journal exists before dispatch');
    if (posts.length === 1) throw { status: 503 };
    card = pokemonCard();
    return { state: 'COMPLETE' };
  }, { readCard: () => card });
  f.render(); await flush(); f.render(); f.click('Retry identification'); await flush(); f.render();
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0], { path: '/api/staff/manual-connected/cards/card/identify', body: {
    actionId: posts[0].body.actionId, expectedAttemptId: 'rejected-attempt', sourceHash: 'pokemon-source',
  } });
  assert.match(posts[0].body.actionId, /^[0-9a-f-]{36}$/);
  assert.equal(f.disabled('Retry identification'), true);
  assert.equal(f.has('Resume saved request'), true);
  f.click('Resume saved request'); await flush(); f.render();
  assert.deepEqual(posts[1], posts[0], 'resuming cannot create a replacement action');
  assert.equal(store.getItem(key), null);
  assert.equal(f.has('Retry identification'), false);
});

test('a second retry click before rerender cannot dispatch another action', async () => {
  const store = storage(null), posts = []; let finish;
  const f = harness(store, async (path, options) => {
    posts.push({ path, body: JSON.parse(JSON.stringify(options.body)) });
    return new Promise(resolve => { finish = resolve; });
  }, { readCard: rejectedCard });
  f.render(); await flush(); f.render(); f.click('Retry identification'); f.click('Retry identification'); await flush();
  assert.equal(posts.length, 1);
  assert.deepEqual(JSON.parse(store.getItem(key)), posts[0]);
  finish({ state: 'UNKNOWN' }); await flush(); f.render();
});

test('unconfirmed or non-retryable identification outcomes offer no retry action', async () => {
  for (const identification of [
    { state: 'UNKNOWN', attemptId: 'uncertain' },
    { state: 'UNKNOWN', attemptId: 'rejected', rejection: { code: 'API_REQUEST_REJECTED', canRetry: false } },
    { state: 'UNKNOWN', attemptId: 'rejected', rejection: { code: 'API_CREDIT_BALANCE_EXHAUSTED', canRetry: false } },
  ]) {
    const f = harness(storage(null), async () => { assert.fail('must not dispatch'); },
      { readCard: () => ({ ...pokemonCard(), identification }) });
    f.render(); await flush(); f.render();
    assert.equal(f.has('Retry identification'), false);
  }
});

test('unsaved human card details disable identification retry and remain visible', async () => {
  const f = harness(storage(null), async () => { assert.fail('must not dispatch'); }, { readCard: rejectedCard });
  f.render(); await flush(); f.render();
  f.change('Name', 'Human correction'); f.render();
  assert.equal(f.disabled('Retry identification'), true);
  assert.equal(f.field('Name').props.value, 'Human correction');
});

const sportsCard = () => ({ ...pokemonCard(), revision:3,
  card:{...pokemonCard().card,revision:5,sourceHash:'sports-source'},
  details:{profile:'SPORTS',layoutType:null,cornerShape:'SQUARE',matColor:'WHITE',parallel:'',insert:'',
    fields:{name:'Jamal Murray',year:'2023-24',manufacturer:'Panini',set_name:'Donruss Optic',card_number:'111',category:'Sports cards',variant:'',card_type:''}} });
const plain = value => JSON.parse(JSON.stringify(value));

test('one combined action initializes valid saved Sports details without requiring another details save',async()=>{
  const store=storage(null),posts=[];let card=sportsCard();
  const f=harness(store,async(path,options)=>{posts.push({path,body:plain(options.body)});card={...card,manual:{current:true,revision:1}};return {};},{readCard:()=>card});
  f.render();await flush();f.render();
  assert.equal(f.has('Save details'),false);assert.equal(f.has('Save & Review Geometry →'),true);
  f.submit();await flush();f.render();
  assert.deepEqual(posts,[{path:'/api/staff/manual-connected/cards/card/initialize',body:{sourceHash:'sports-source',detailsRevision:3}}]);
  assert.equal(store.getItem(key),null);assert.equal(f.workspace(),true);
});

test('combined action saves exact human edits once then initializes the acknowledged details revision',async()=>{
  const store=storage(null),posts=[];let card=sportsCard();
  const f=harness(store,async(path,options)=>{
    posts.push({path,body:plain(options.body)});
    if(path.endsWith('/details')){assert.equal(JSON.parse(store.getItem(key)).intent,'REVIEW_GEOMETRY');card={...card,revision:4,details:{...card.details,fields:{...card.details.fields,...options.body.changes}}};}
    else {assert.equal(options.body.detailsRevision,4);card={...card,manual:{current:true,revision:1}};}
    return {};
  },{readCard:()=>card});
  f.render();await flush();f.render();f.change('Name','Human corrected name');f.render();f.submit();f.submit();await flush();f.render();
  assert.equal(posts.length,2);assert.deepEqual(posts[0].body.changes,{name:'Human corrected name'});
  assert.equal(posts[0].body.expectedRevision,3);assert.equal(f.workspace(),true);assert.equal(store.getItem(key),null);
});

test('lost details acknowledgement resumes the same save and continues the requested geometry step',async()=>{
  const store=storage(null),posts=[];let card=sportsCard();
  const f=harness(store,async(path,options)=>{
    posts.push({path,body:plain(options.body)});
    if(path.endsWith('/details')){card={...card,revision:4,details:{...card.details,fields:{...card.details.fields,name:'Corrected'}}};if(posts.length===1)throw {status:503,code:'LOST_REPLY'};}
    else card={...card,manual:{current:true,revision:1}};
    return {};
  },{readCard:()=>card});
  f.render();await flush();f.render();f.change('Name','Corrected');f.render();f.submit();await flush();f.render();
  assert.equal(f.has('Resume saved request'),true);assert.equal(f.field('Name').props.value,'Corrected');
  f.click('Resume saved request');await flush();f.render();
  assert.equal(posts.length,3);assert.deepEqual(posts[1],posts[0]);assert.equal(posts[2].body.detailsRevision,4);
  assert.equal(f.workspace(),true);assert.equal(store.getItem(key),null);
});

test('failed initialization retains exact recovery without pretending the earlier details save failed',async()=>{
  const store=storage(null),posts=[];let card=sportsCard();
  const f=harness(store,async(path,options)=>{posts.push({path,body:plain(options.body)});if(posts.length===1)throw {status:503,code:'PREPARATION_FAILED'};card={...card,manual:{current:true,revision:1}};return {};},{readCard:()=>card});
  f.render();await flush();f.render();f.submit();await flush();f.render();
  assert.equal(f.workspace(),false);assert.equal(f.field('Name').props.value,'Jamal Murray');assert.match(f.text(),/PREPARATION_FAILED/);
  assert.deepEqual(JSON.parse(store.getItem(key)),posts[0]);
  f.click('Resume saved request');await flush();f.render();
  assert.deepEqual(posts[1],posts[0]);assert.equal(f.workspace(),true);assert.equal(store.getItem(key),null);
});

test('an edit arriving during a details save is retained and cannot silently initialize the older identity',async()=>{
  const store=storage(null),posts=[];let card=sportsCard(),finish;
  const f=harness(store,(path,options)=>{posts.push({path,body:plain(options.body)});return new Promise(resolve=>{finish=()=>{card={...card,revision:4,details:{...card.details,fields:{...card.details.fields,name:'First edit'}}};resolve({});};});},{readCard:()=>card});
  f.render();await flush();f.render();f.change('Name','First edit');f.render();f.submit();
  f.change('Name','Newer edit');finish();await flush();f.render();
  assert.equal(posts.length,1);assert.equal(f.field('Name').props.value,'Newer edit');assert.equal(f.workspace(),false);assert.equal(store.getItem(key),null);
  assert.match(f.text(),/MANUAL_DETAILS_STALE/);
});

test('grading identity errors are explained inline before any journal or request',async()=>{
  for(const [field,value]of [['Name','x'.repeat(121)],['Year','x'.repeat(25)],['Manufacturer','x'.repeat(121)],['Product / set','x'.repeat(121)]]){
    const store=storage(null),f=harness(store,async()=>assert.fail('invalid identity must not write'),{readCard:sportsCard});
    f.render();await flush();f.render();f.change(field,value);f.render();f.submit();await flush();f.render();
    assert.equal(f.field(field).props['aria-invalid'],true);assert.match(f.text(),/Check the highlighted card details/);assert.equal(store.getItem(key),null);
  }
});

test('Front and Back upload independently while same-side rapid duplicate selection is fenced',async()=>{
  const store=storage(null),calls=[],finish={};let card={...sportsCard(),card:{...sportsCard().card,ready:false}};
  const f=harness(store,async()=>assert.fail('no details or analysis action'),{readCard:()=>card,intake:{upload:async(cardId,side,version,file)=>{calls.push({side,version,file});await new Promise(resolve=>{finish[side]=resolve;});}}});
  f.render();await flush();f.render();f.upload('FRONT');f.upload('FRONT');f.render();
  assert.equal(f.field('FRONT original photo').props.disabled,true);assert.equal(f.field('BACK original photo').props.disabled,false);
  f.upload('BACK');f.render();assert.equal(calls.length,2);assert.equal(f.disabled('Save & Review Geometry →'),true);
  finish.BACK();await flush();f.render();assert.equal(f.field('BACK original photo').props.disabled,false);assert.equal(f.field('FRONT original photo').props.disabled,true);
  finish.FRONT();await flush();f.render();assert.equal(f.field('FRONT original photo').props.disabled,false);
});

test('a late upload refresh cannot replace the newer complete photo pair with an earlier one-side snapshot',async()=>{
  let reads=0,resolveFrontRead;const finish={},calls=[];
  const empty={...sportsCard(),card:{...sportsCard().card,ready:false,revision:5,label:'Initial'}};
  const front={...empty,card:{...empty.card,revision:6,label:'Old one-side'}};
  const complete={...empty,card:{...empty.card,revision:7,ready:true,label:'Latest complete pair'}};
  const f=harness(storage(null),async()=>assert.fail('no provider action'),{readCard:()=>{
    reads++;if(reads===1)return empty;if(reads===2)return new Promise(resolve=>{resolveFrontRead=resolve;});return complete;
  },intake:{upload:async(_card,side)=>{calls.push(side);await new Promise(resolve=>{finish[side]=resolve;});}}});
  f.render();await flush();f.render();f.upload('FRONT');f.upload('BACK');finish.FRONT();await flush();finish.BACK();await flush();f.render();
  assert.match(f.text(),/Latest complete pair/);resolveFrontRead(front);await flush();f.render();
  assert.match(f.text(),/Latest complete pair/);assert.doesNotMatch(f.text(),/Old one-side/);assert.deepEqual(calls,['FRONT','BACK']);
});

test('one failed upload keeps its own error visible while the other side completes',async()=>{
  const finish={};let card={...sportsCard(),card:{...sportsCard().card,ready:false}};
  const f=harness(storage(null),async()=>assert.fail('no card command'),{readCard:()=>card,intake:{upload:async(_card,side)=>new Promise((resolve,reject)=>{finish[side]=side==='FRONT'?()=>reject({code:'FRONT_UPLOAD_FAILED'}):resolve;})}});
  f.render();await flush();f.render();f.upload('FRONT');f.upload('BACK');finish.FRONT();await flush();f.render();
  assert.match(f.text(),/FRONT_UPLOAD_FAILED/);assert.equal(f.field('BACK original photo').props.disabled,true);
  finish.BACK();await flush();f.render();assert.match(f.text(),/FRONT_UPLOAD_FAILED/);assert.equal(f.field('BACK original photo').props.disabled,false);
});

test('unsaved details do not block the missing Back upload when the combined action needs both photos',async()=>{
  let calls=0;const card={...sportsCard(),card:{...sportsCard().card,ready:false}};
  const f=harness(storage(null),async()=>assert.fail('no card command'),{readCard:()=>card,intake:{upload:async()=>{calls++;}}});
  f.render();await flush();f.render();f.change('Name','Human name before Back photo');f.render();
  assert.equal(f.field('BACK original photo').props.disabled,false);f.upload('BACK');await flush();f.render();
  assert.equal(calls,1);assert.equal(f.field('Name').props.value,'Human name before Back photo');
});

test('a late details acknowledgement after changing cards cannot initialize or overwrite the new card',async()=>{
  const posts=[];let finish;
  const f=harness(storage(null),(path,options)=>{posts.push({path,body:plain(options.body)});return new Promise(resolve=>{finish=resolve;});},{readCard:path=>({...sportsCard(),card:{...sportsCard().card,label:path.endsWith('/other')?'Other card':'Original card'}})});
  f.render();await flush();f.render();f.change('Name','Original edit');f.render();f.submit();
  f.navigate('other');await flush();f.render();assert.match(f.text(),/Other card/);
  finish({});await flush();f.render();assert.equal(posts.length,1);assert.match(f.text(),/Other card/);assert.equal(f.workspace(),false);
});

test('both preparation failures refresh verified originals and offer independent exact-journal recovery',async()=>{
  const pending=[],resumed=[],finish={};let reads=0;
  let card={...sportsCard(),card:{...sportsCard().card,ready:false,sides:{FRONT:{version:0},BACK:{version:0}}}};
  const f=harness(storage(null),async()=>assert.fail('no geometry or provider action'),{message:manualMessage,readCard:()=>{reads++;return plain(card);},intake:{
    pending:async()=>plain(pending),
    upload:async(_card,side)=>{await new Promise(resolve=>{finish[side]=resolve;});const uploadId=side+'-saved';
      pending.push({id:side+'-journal',value:{kind:'upload',cardId:'card',input:{side},uploadId,verified:true}});
      card={...card,card:{...card.card,revision:card.card.revision+1,sides:{...card.card.sides,[side]:{version:1,upload:{uploadId,verification:{sha256:side}}}}}};
      throw {code:'PHOTO_DECODE_TIMEOUT',status:422};},
    resume:async id=>{resumed.push(id);const index=pending.findIndex(item=>item.id===id),side=pending[index].value.input.side;
      pending.splice(index,1);card={...card,card:{...card.card,revision:card.card.revision+1,sides:{...card.card.sides,[side]:{...card.card.sides[side],upload:{...card.card.sides[side].upload,source:{saved:true}}}}}};},
    prepareSaved:async()=>assert.fail('existing journal identity must be used'),
  }});
  f.render();await flush();f.render();f.upload('FRONT');f.upload('BACK');finish.FRONT();finish.BACK();await flush();f.render();
  assert.equal(reads,3,'each failed side refreshes durable state');
  assert.doesNotMatch(f.text(),/Original photo needed/);assert.match(f.text(),/Original saved\. Resume image preparation/);
  assert.match(f.text(),/Preparing the working image timed out/);
  assert.equal(f.disabled('Resume Front photo'),false);assert.equal(f.disabled('Resume Back photo'),false);
  assert.equal(f.field('FRONT original photo').props.disabled,true);assert.equal(f.field('BACK original photo').props.disabled,true);
  f.click('Resume Back photo');await flush();f.render();
  assert.deepEqual(resumed,['BACK-journal']);assert.equal(pending.length,1);assert.equal(pending[0].id,'FRONT-journal');
  assert.equal(f.has('Resume Back photo'),false);assert.equal(f.has('Resume Front photo'),true);
  assert.match(f.text(),/Preparing the working image timed out/,'Front error is retained');
});

test('failed saved-state refresh retains preparation error and journal proof instead of claiming the photo is missing',async()=>{
  const pending=[];let reads=0;
  const f=harness(storage(null),async()=>assert.fail('no command'),{message:manualMessage,readCard:()=>{
    if(++reads>1)throw {code:'SIGN_IN_REQUIRED',status:401};return {...sportsCard(),card:{...sportsCard().card,ready:false}};
  },intake:{pending:async()=>pending,upload:async()=>{pending.push({id:'back-recovery',value:{kind:'upload',cardId:'card',input:{side:'BACK'},uploadId:'back-upload',verified:true}});throw {code:'PHOTO_DECODER_FAILED',status:422};}}});
  f.render();await flush();f.render();f.upload('BACK');await flush();f.render();
  assert.match(f.text(),/photo decoder could not finish the working image/);assert.match(f.text(),/saved photo status could not be refreshed/);
  assert.match(f.text(),/Your session ended/);assert.match(f.text(),/Original saved\. Resume image preparation/);
  assert.equal(f.has('Resume Back photo'),true);assert.equal(pending[0].id,'back-recovery');
});

test('a verified original on another device can explicitly resume preparation without a local Blob or new upload',async()=>{
  const calls=[];let card={...sportsCard(),card:{...sportsCard().card,ready:false,sides:{
    FRONT:{version:1,upload:{uploadId:'front-ready',verification:{},source:{saved:true}}},
    BACK:{version:1,upload:{uploadId:'back-verified',verification:{sha256:'original'}}}}}};
  const f=harness(storage(null),async()=>assert.fail('no unrelated command'),{readCard:()=>card,intake:{
    upload:async()=>assert.fail('must not upload again'),resume:async()=>assert.fail('no local journal'),
    prepareSaved:async(...input)=>{calls.push(input);card={...card,card:{...card.card,revision:6,ready:true,sides:{...card.card.sides,BACK:{...card.card.sides.BACK,upload:{...card.card.sides.BACK.upload,source:{saved:true}}}}}};},
  }});
  f.render();await flush();f.render();assert.deepEqual(calls,[]);assert.equal(f.has('Resume Front photo'),false);
  f.click('Resume Back photo');f.click('Resume Back photo');await flush();f.render();
  assert.deepEqual(calls,[['card','back-verified']]);assert.equal(f.has('Resume Back photo'),false);assert.equal(f.disabled('Save & Review Geometry →'),false);
});

test('late failed upload on an old card cannot refresh or attach its error to the current card',async()=>{
  let rejectUpload;const reads=[];
  const f=harness(storage(null),async()=>assert.fail('no command'),{readCard:path=>{reads.push(path);return {...sportsCard(),card:{...sportsCard().card,ready:false,label:path.endsWith('/other')?'Other card':'Original card'}};},
    intake:{upload:()=>new Promise((_resolve,reject)=>{rejectUpload=reject;})}});
  f.render();await flush();f.render();f.upload('BACK');f.navigate('other');await flush();f.render();
  const count=reads.length;rejectUpload({code:'OLD_PHOTO_ERROR'});await flush();f.render();
  assert.equal(reads.length,count);assert.match(f.text(),/Other card/);assert.doesNotMatch(f.text(),/OLD_PHOTO_ERROR/);
});

test('an earlier verified journal cannot represent or hide recovery of a newer selected original',async()=>{
  for(const verified of [false,true]){
    const old={id:'old-journal',value:{kind:'upload',cardId:'card',input:{side:'BACK'},uploadId:'old-upload',verified:true}},calls=[];
    const card={...sportsCard(),card:{...sportsCard().card,ready:false,sides:{...sportsCard().card.sides,BACK:{version:2,upload:{uploadId:'selected-upload',verification:verified?{sha256:'selected'}:null}}}}};
    const f=harness(storage(null),async()=>assert.fail('no unrelated command'),{readCard:()=>card,intake:{pending:async()=>[old],
      resume:async()=>assert.fail('must not resume an earlier upload as the selected photo'),prepareSaved:async(...args)=>{calls.push(args);}}});
    f.render();await flush();f.render();assert.match(f.text(),/Earlier upload; this is not the selected photo/);
    assert.equal(f.has('Check earlier upload'),true);
    if(verified){assert.equal(f.has('Resume Back photo'),true);f.click('Resume Back photo');await flush();f.render();assert.deepEqual(calls,[['card','selected-upload']]);}
    else {assert.equal(f.has('Resume Back photo'),false);assert.doesNotMatch(f.sideText('Back'),/Original (?:saved|verified)/);}
  }
});

test('known unsupported photo treatments explain retained originals without directing another identical upload',()=>{
  for(const code of ['PHOTO_MULTIFRAME_UNSUPPORTED','PHOTO_FORMAT_UNSUPPORTED','PHOTO_GEOMETRY_UNSUPPORTED','PHOTO_BIT_DEPTH_UNSUPPORTED','PHOTO_HEIC_UNSUPPORTED','PHOTO_HDR_UNSUPPORTED','PHOTO_COLOR_UNSUPPORTED']){
    const message=manualMessage({code});assert.match(message,/original is saved/i);assert.ok(message.includes(code));
    assert.doesNotMatch(message,/downsiz|compress|convert|try again|Resume this photo/i);
  }
});

test('photo setup does not run an obsolete browser geometry scheduler',async()=>{
  const calls=[];const card=pokemonCard();card.card.ready=false;card.identification.state='NOT_STARTED';
  card.card.sides.FRONT.upload={uploadId:'first-front',source:{ready:true}};
  card.earlyGeometry={FRONT:{state:'QUEUED',key:'front-work'},BACK:{state:'WAITING_PHOTO'}};
  const f=harness(storage(null),async(path)=>{calls.push(path);return {};},{readCard:()=>structuredClone(card)});
  f.render();await flush();f.render();await f.tick();
  assert.deepEqual(calls,[]);assert.equal(f.workspace(),false);f.dispose();
});

test('acknowledged deletion of another card leaves active upload finally handlers usable',async()=>{
 let finish;const f=harness(storage(null),async()=>({}),{intake:{upload:async()=>new Promise(resolve=>finish=resolve)}});
 f.render();await flush();f.render();f.upload('FRONT');await flush();f.render();
 f.event(discard.discardEvent,{type:discard.discardEvent,detail:{staffId:'reviewer',confirmed:{cardIds:['other'],createRequestIds:[]}}});
 await flush();finish({});await flush();f.render();assert.equal(f.field('FRONT original photo').props.disabled,false);assert.deepEqual(f.navigations,[]);
});
test('confirmed current-card deletion routes away instead of keeping a stale grading workspace',async()=>{
 const f=harness(storage(null),async()=>({}),{readCard:async()=>{throw {code:'INTAKE_CARD_DELETED',status:410};}});
 f.render();await flush();f.render();assert.deepEqual(f.navigations,['/manual']);assert.equal(f.workspace(),false);
});

test('geometry correction messages direct current outline review without restoring the previous outline',()=>{
  const geometryMessage=manualMessage({code:'ATLAS_DEFECT_GEOMETRY_REVIEW_REQUIRED'});
  assert.match(geometryMessage,/outline needs another adjustment.*Review the selected side/);
  assert.doesNotMatch(geometryMessage,/Restore the previous outline/);
  assert.match(manualMessage({code:'ATLAS_DEFECT_RETRACE_REQUIRED'}),/Add a new trace on the current photograph/);
  assert.match(manualMessage({code:'MANUAL_GEOMETRY_REVIEW_REQUIRED'}),/confirm both sides in Geometry/);
});


test('unknown Year and Manufacturer remain editable without blocking geometry or inventing metadata',async()=>{
  let card=sportsCard();card.details.fields.year='';card.details.fields.manufacturer='';const posts=[];
  const f=harness(storage(null),async(path,{body})=>{posts.push({path,body});if(path.endsWith('/initialize'))card={...card,manual:{current:true,revision:1}};return {};},{readCard:()=>card,fromBatch:true});
  f.render();await flush();f.render();
  assert.equal(f.field('Year').props['aria-invalid'],false);assert.equal(f.field('Manufacturer').props['aria-invalid'],false);
  assert.equal(f.attention('detail-year'),false);assert.equal(f.attention('detail-manufacturer'),false);
  f.submit();await flush();f.render();assert.equal(f.workspace(),true);assert.equal(Object.hasOwn(f.workspaceProps(),'rapid'),false);
  assert.equal(posts.filter(post=>post.path.endsWith('/initialize')).length,1);
  assert.equal(card.details.fields.year,'');assert.equal(card.details.fields.manufacturer,'');f.dispose();
});

test('batch correction marks only the retained unprepared Front, preserving the ready Back',async()=>{
  const card=sportsCard();card.card.ready=false;
  card.card.sides={FRONT:{version:1,upload:{uploadId:'front',verification:{verified:true}}},BACK:{version:1,upload:{uploadId:'back',source:{prepared:true},verification:{verified:true}}}};
  const f=harness(storage(null),async()=>assert.fail('No automatic replacement'),{readCard:()=>card,fromBatch:true});
  f.render();await flush();f.render();assert.equal(f.attention('photo-FRONT'),true);assert.equal(f.attention('photo-BACK'),false);
  assert.deepEqual(Array.from(f.reviewIssues(),issue=>issue.key),['photo-FRONT']);f.dispose();
});


test('intake uses the source-bound small context preview without downloading full review images',async()=>{
 const card=sportsCard(),sha='a'.repeat(64);card.card.sides.FRONT.upload={source:{ready:true}};
 card.previews={FRONT:{url:'/canonical.png',sha256:sha,byteCount:100000,mime:'image/png',display:{url:'/lossless.webp',sha256:'b'.repeat(64),byteCount:50000,mime:'image/webp',policyVersion:'atlas-review-display-lossless-v1',sourceSha256:sha,width:3024,height:4032,preview:{url:'/context.jpg',sha256:'c'.repeat(64),byteCount:500,mime:'image/jpeg',width:576,height:768}}}};
 const f=harness(storage(null),async()=>assert.fail('No image mutation'),{readCard:()=>card});f.render();await flush();f.render();assert.equal(f.previewSrc('Front'),'/context.jpg');f.dispose();
 card.previews.FRONT.display.sourceSha256='d'.repeat(64);
 const invalid=harness(storage(null),async()=>assert.fail('No image mutation'),{readCard:()=>card});invalid.render();await flush();invalid.render();assert.equal(invalid.previewSrc('Front'),'/canonical.png');invalid.dispose();
});

test('intake waits for a clean grading image without exposing an old context-only photograph',async()=>{
 const card=sportsCard();card.card.sides.FRONT.upload={source:{ready:true}};
 card.previews={FRONT:{sha256:'a'.repeat(64),preview:{url:'/old-context.jpg',sourceSha256:'a'.repeat(64)}}};
 const f=harness(storage(null),async()=>assert.fail('No image mutation'),{readCard:()=>card});f.render();await flush();f.render();
 assert.equal(f.previewSrc('Front'),undefined);assert.match(f.text(),/Preparing the background-removed grading image\./);f.dispose();
});

for(const state of ['FAILED','UNKNOWN'])test(`intake explains terminal ${state} background removal without replacing or retrying the saved request`,async()=>{
 const card=sportsCard();card.card.sides.FRONT.upload={uploadId:'front',source:{ready:true}};
 card.gradingImages={FRONT:{uploadId:'front',state,code:state==='FAILED'?'REPORT_IMAGE_ALPHA_INVALID':'REPORT_IMAGE_RESPONSE_UNKNOWN'}};
 const f=harness(storage(null),async()=>assert.fail('Terminal status must not send a provider request'),{readCard:()=>card});
 f.render();await flush();f.render();assert.equal(f.previewSrc('Front'),undefined);
 assert.match(f.text(),state==='FAILED'?/Background removal could not finish/ : /Background removal has no confirmed result/);
 assert.match(f.text(),state==='FAILED'?/returned image could not be used for grading/ : /saved request needs review before another image request/);
 assert.match(f.text(),/Check Front image status/);assert.doesNotMatch(f.text(),/Preparing the background-removed grading image/);f.dispose();
});

const failedPhotos = () => {
 const value=sportsCard();value.details.matColor='BLACK';value.details.sourceHash=value.card.sourceHash;
 value.card.sides=Object.fromEntries(['FRONT','BACK'].map(side=>[side,{version:1,upload:{uploadId:side,source:{saved:true}}}]));
 value.gradingImages=Object.fromEntries(['FRONT','BACK'].map(side=>[side,{uploadId:side,state:'READY'}]));
 value.earlyGeometry=Object.fromEntries(['FRONT','BACK'].map(side=>[side,{uploadId:side,key:side,state:'NEEDS_REVIEW',machineUsable:false,canRetry:true}]));
 return value;
};
const rejectedBackImage = () => {
 const card=failedPhotos();card.card.ready=false;
 card.gradingImages.BACK={uploadId:'BACK',state:'FAILED',code:'REPORT_IMAGE_REQUEST_REJECTED',
  rejection:{retryable:true,jobKey:'a'.repeat(64),failedRequestId:'failed-back-request'}};
 card.previews={FRONT:{url:'/saved-front.png',sha256:'b'.repeat(64)}};
 return card;
};
const imageRetryAck=body=>({state:'ACCEPTED',acknowledgedRequest:{...body,side:'BACK'}});
for(const failure of ['FAILED','UNKNOWN'])test(`terminal ${failure} uses the saved original beside a generated image without an edit retry`,async()=>{
 const card=failedPhotos();card.identification={state:'RUNNING'};
 card.gradingImages.FRONT={uploadId:'FRONT',state:'READY',source:'ORIGINAL',backgroundRemoval:{state:failure,code:failure==='FAILED'?'REPORT_IMAGE_REQUEST_REJECTED':'REPORT_IMAGE_RESPONSE_UNKNOWN'}};
 card.gradingImages.BACK={uploadId:'BACK',state:'READY',source:'GENERATED'};
 card.previews={FRONT:{url:'/original-front.png',sha256:'a'.repeat(64)},BACK:{url:'/generated-back.png',sha256:'b'.repeat(64)}};
 const f=harness(storage(null),async()=>assert.fail('Fallback display must not retry background removal'),{readCard:()=>card});
 try{
  f.render();await flush();f.render();
  assert.equal(f.previewSrc('Front'),'/original-front.png');assert.equal(f.previewAlt('Front'),'Front original grading photo');
  assert.equal(f.previewSrc('Back'),'/generated-back.png');assert.equal(f.previewAlt('Back'),'Back background-removed grading image');
  assert.match(f.sideText('Front'),/Grading image ready/);assert.match(f.sideText('Front'),/Grading continues with your original photo/);
  assert.doesNotMatch(f.text(),/Image needs attention/);assert.equal(f.has('Retry Front background removal'),false);
 }finally{f.dispose();}
});
test('mixed original and generated grading images enter ordinary review after identification',async()=>{
 let card=failedPhotos();card.gradingImages.FRONT={uploadId:'FRONT',state:'READY',source:'ORIGINAL',backgroundRemoval:{state:'FAILED',code:'REPORT_IMAGE_REQUEST_REJECTED'}};
 card.gradingImages.BACK.source='GENERATED';const posts=[];
 const f=harness(storage(null),async(path,{body})=>{posts.push(path);assert.ok(path.endsWith('/initialize'));card={...card,manual:{current:true,revision:1}};return {};},{readCard:()=>card,fromBatch:true});
 try{f.render();await flush();f.render();await flush();f.render();assert.equal(f.workspace(),true);assert.equal(posts.length,1);}
 finally{f.dispose();}
});
for(const side of ['FRONT','BACK'])for(const terminal of ['READY','FAILED','UNKNOWN'])test(`${side} image polling observes QUEUED to REQUESTED to ${terminal} with equal revisions and unsaved details`,async()=>{
 const card=failedPhotos(),store=storage(null),sideName=side==='FRONT'?'Front':'Back',other=side==='FRONT'?'BACK':'FRONT',otherName=other==='FRONT'?'Front':'Back';
 card.card.ready=false;card.gradingImages[side]={uploadId:side,state:'QUEUED'};
 card.previews={[other]:{url:'/saved-opposite.png',sha256:'b'.repeat(64)}};
 const originalPair=plain(card.card.sides),revisions=[card.card.revision,card.revision];let reads=0;
 const f=harness(store,async()=>assert.fail('Image polling must not dispatch a command'),{readCard:(path,options)=>{
  assert.equal(path,'/api/staff/manual-connected/cards/card');assert.equal(options.method??'GET','GET');
  reads++;return structuredClone(card);
 }});
 try{
  f.render();await flush();f.render();f.change('Name','Unsaved name');f.change('Year','2022-23');f.render();
  const initialReads=reads;card.gradingImages[side]={uploadId:side,state:'REQUESTED'};
  await f.tick();assert.equal(reads,initialReads+1);assert.match(f.sideText(sideName),/Preparing grading image/);
  await f.tick();assert.equal(reads,initialReads+2,'accepted image work remains observed while REQUESTED');
  card.gradingImages[side]={uploadId:side,state:terminal,...(terminal==='FAILED'?{
   code:'REPORT_IMAGE_REQUEST_REJECTED',rejection:{retryable:true,jobKey:'a'.repeat(64),failedRequestId:'terminal-request'},
  }:terminal==='UNKNOWN'?{code:'REPORT_IMAGE_RESPONSE_UNKNOWN'}:{})};
  if(terminal==='READY'){card.card.ready=true;card.previews[side]={url:'/new-generated.png',sha256:'c'.repeat(64)};}
  await f.tick();assert.equal(reads,initialReads+3,'terminal state is read without a revision bump');
  assert.doesNotMatch(f.sideText(sideName),/Preparing grading image/);
  if(terminal==='READY'){
   assert.match(f.sideText(sideName),/Grading image ready/);assert.equal(f.previewSrc(sideName),'/new-generated.png');
  }else{
   assert.match(f.sideText(sideName),/Image needs attention/);assert.equal(f.previewSrc(sideName),undefined);
   assert.match(f.sideText(sideName),terminal==='FAILED'?/Background removal was rejected/:/saved request needs review before another image request/);
   assert.equal(f.has(`Retry ${sideName} background removal`),false);
   assert.equal(f.has(`Check ${sideName} image status`),true);
  }
  assert.equal(f.previewSrc(otherName),'/saved-opposite.png');
  assert.equal(f.field('Name').props.value,'Unsaved name');assert.equal(f.field('Year').props.value,'2022-23');
  assert.deepEqual(plain(card.card.sides),originalPair);assert.deepEqual([card.card.revision,card.revision],revisions);
  assert.equal(store.getItem(key),null,'polling creates no retry or detail-save intent');
  const stopped=reads;await f.tick();await f.tick();assert.equal(reads,stopped,'terminal status removes the polling interval');
 }finally{f.dispose();}
});
test('opening REQUESTED image work observes failure without consuming or replaying an uncertain retry intent',async()=>{
 const card=rejectedBackImage(),savedRetry={path:'/api/staff/manual-connected/cards/card/grading-images/BACK/retry',intent:'RETRY_GRADING_IMAGE',
  body:{requestId:'saved-retry',uploadId:'BACK',jobKey:'a'.repeat(64),failedRequestId:'original-failed-request'}},store=storage(savedRetry);
 card.gradingImages.BACK={uploadId:'BACK',state:'REQUESTED'};let reads=0;
 const f=harness(store,async()=>assert.fail('Only explicit saved-retry reconciliation may POST'),{readCard:()=>{reads++;return structuredClone(card);}});
 try{
  f.render();await flush();f.render();assert.equal(f.has('Check saved retry'),true);
  const initialReads=reads;await f.tick();assert.equal(reads,initialReads+1,'REQUESTED starts polling on initial load');
  card.gradingImages.BACK={uploadId:'BACK',state:'FAILED',code:'REPORT_IMAGE_REQUEST_REJECTED',
   rejection:{retryable:true,jobKey:'a'.repeat(64),failedRequestId:'new-failed-request'}};
  await f.tick();assert.equal(reads,initialReads+2);assert.match(f.sideText('Back'),/Image needs attention/);
  assert.equal(f.has('Retry Back background removal'),false);assert.equal(f.has('Check saved retry'),true);
  assert.equal(store.getItem(key),JSON.stringify(savedRetry),'status cannot replace the exact uncertain retry with a newer failure');
  const stopped=reads;await f.tick();assert.equal(reads,stopped);
 }finally{f.dispose();}
});
for(const binding of ['old-upload','missing-upload'])test(`REQUESTED image polling requires the current upload binding: ${binding}`,async()=>{
 const card=rejectedBackImage();card.gradingImages.BACK={state:'REQUESTED',...(binding==='old-upload'?{uploadId:'old-back'}:{})};
 if(binding==='missing-upload')delete card.card.sides.BACK.upload.uploadId;
 let reads=0;const f=harness(storage(null),async()=>assert.fail('No image command'),{readCard:()=>{reads++;return structuredClone(card);}});
 try{
  f.render();await flush();f.render();const initialReads=reads;await f.tick();await f.tick();assert.equal(reads,initialReads);
  assert.equal(f.has('Retry Back background removal'),false);assert.equal(f.previewSrc('Front'),'/saved-front.png');
 }finally{f.dispose();}
});
test('historical retryable rejection offers status only and preserves the photo pair and unsaved details',async()=>{
 const card=rejectedBackImage(),store=storage(null),originalPair=plain(card.card.sides);
 const f=harness(store,async()=>assert.fail('No new background retry'),{readCard:()=>structuredClone(card)});
 try{
  f.render();await flush();f.render();assert.match(f.sideText('Back'),/Image needs attention/);
  assert.equal(f.has('Retry Back background removal'),false);assert.equal(f.has('Check Back image status'),true);
  f.change('Name','My unsaved name');f.render();f.click('Check Back image status');await flush();f.render();
  assert.equal(f.previewSrc('Front'),'/saved-front.png');assert.equal(f.field('Name').props.value,'My unsaved name');
  assert.deepEqual(plain(card.card.sides),originalPair);assert.equal(store.getItem(key),null);
 }finally{f.dispose();}
});
for(const uncertain of ['lost-response','wrong-ack'])test(`background retry ${uncertain} resumes the identical intent without buying another retry`,async()=>{
 const prior={path:'/api/staff/manual-connected/cards/card/grading-images/BACK/retry',intent:'RETRY_GRADING_IMAGE',body:{requestId:'saved-retry',uploadId:'BACK',jobKey:'a'.repeat(64),failedRequestId:'failed-back-request'}};
 const card=rejectedBackImage(),store=storage(prior),posts=[];
 const f=harness(store,async(path,{body})=>{
  posts.push({path,body:plain(body)});
  if(posts.length===1){if(uncertain==='lost-response')throw {status:503};return imageRetryAck({...body,uploadId:'unrelated'});}
  return imageRetryAck(body);
 },{readCard:()=>card});
 f.render();await flush();f.render();assert.equal(f.has('Retry Back background removal'),false);f.click('Check saved retry');await flush();f.render();
 assert.equal(posts.length,1);assert.equal(f.has('Check saved retry'),true);assert.equal(f.has('Retry Back background removal'),false);
 const retained=JSON.parse(store.getItem(key));assert.deepEqual(retained.body,posts[0].body);
 f.click('Check saved retry');await flush();f.render();assert.deepEqual(posts[1],posts[0]);assert.equal(store.getItem(key),null);f.dispose();
});
for(const state of ['UNKNOWN','READY','FAILED-STALE'])test(`background retry does not authorize ${state} image work`,async()=>{
 const card=rejectedBackImage();if(state==='FAILED-STALE')card.gradingImages.BACK.uploadId='old';else card.gradingImages.BACK.state=state;
 const f=harness(storage(null),async()=>assert.fail('No automatic image dispatch'),{readCard:()=>card});
 f.render();await flush();f.render();assert.equal(f.has('Retry Back background removal'),false);await f.tick();f.dispose();
});
test('image status refresh clears its own transient error and leaves current detail edits intact',async()=>{
 const card=rejectedBackImage();card.gradingImages.BACK={uploadId:'BACK',state:'RUNNING'};let unavailable=false;
 const f=harness(storage(null),async()=>assert.fail('Status polling cannot dispatch'),{readCard:()=>{if(unavailable)throw {code:'TEMPORARILY_UNAVAILABLE'};return structuredClone(card);}});
 f.render();await flush();f.render();f.change('Name','Still editing');f.render();
 unavailable=true;await f.tick();assert.match(f.text(),/grading image status could not be refreshed/);
 unavailable=false;await f.tick();assert.doesNotMatch(f.text(),/grading image status could not be refreshed/);
 assert.equal(f.field('Name').props.value,'Still editing');f.dispose();
});
for(const state of ['FAILED','NEEDS_REVIEW','READY','RUNNING'])test(`${state} automatic geometry enters the same sequential workspace without the retired paired review`,async()=>{
 let card=failedPhotos();for(const side of ['FRONT','BACK'])card.earlyGeometry[side].state=state;
 const posts=[],f=harness(storage(null),async(path,{body})=>{
  posts.push({path,body:plain(body)});
  assert.equal(path.endsWith('/initialize'),true,'review entry initializes only; no geometry retry or human approval');
  card={...card,manual:{current:true,revision:1}};return {};
 },{readCard:()=>card,fromBatch:true});
 f.render();await flush();f.render();
 assert.doesNotMatch(f.text(),/Edit (Front|Back) geometry|Original retained|PHOTOGRAPHS & IDENTITY/);
 await flush();f.render();assert.equal(f.workspace(),true);
 assert.deepEqual(posts.map(p=>p.path.split('/').at(-1)),['initialize']);
 assert.equal(posts[0].body.detailsRevision,card.revision);assert.equal(f.workspaceProps().initialGeometrySide,undefined);
 f.dispose();
});
test('unknown card family stays editable before entering the sequential workspace',async()=>{
 let card=failedPhotos();card.details.profile=null;const posts=[],f=harness(storage(null),async(path,{body})=>{
  posts.push({path,body:plain(body)});
  if(path.endsWith('/details'))card={...card,revision:4,details:{...card.details,...body.changes}};
  else if(path.endsWith('/initialize'))card={...card,manual:{current:true,revision:1}};
  else assert.fail(path);return {};
 },{readCard:()=>card,fromBatch:true});
 f.render();await flush();f.render();assert.equal(posts.length,0);assert.equal(f.field('Card family').props['aria-invalid'],true);
 assert.equal(f.has('Edit Front geometry'),false);f.change('Card family','SPORTS');f.render();f.submit();await flush();f.render();
 assert.deepEqual(posts.map(p=>p.path.split('/').at(-1)),['details','initialize']);assert.equal(posts[1].body.detailsRevision,4);assert.equal(f.workspace(),true);f.dispose();
});
test('direct review entry waits for both current generated photos, pending uploads, and exact pending commands',async()=>{
 for(const blocker of ['pair','upload','command','generation-failed','generation-unknown','stale-generated-photo']){
  const card=failedPhotos();if(blocker==='pair')card.card.ready=false;
  if(blocker==='generation-failed')card.gradingImages.FRONT.state='FAILED';
  if(blocker==='generation-unknown')card.gradingImages.FRONT.state='UNKNOWN';
  if(blocker==='stale-generated-photo')card.gradingImages.FRONT.uploadId='old-front';
  const posts=[],f=harness(storage(blocker==='command'?command:null),async path=>{posts.push(path);return {};},{readCard:()=>card,intake:{pending:async()=>blocker==='upload'?[{id:'pending',value:{cardId:'card',kind:'upload',input:{side:'FRONT'}}}]:[]}});
  f.render();await flush();f.render();await flush();f.render();assert.deepEqual(posts,[],blocker);
  assert.equal(f.has('Edit Front geometry'),false);assert.equal(f.has('Edit Back geometry'),false);f.dispose();
 }
});
test('explicit photo replacement returns to existing review without initialization or geometry changes',async()=>{
 const card={...failedPhotos(),manual:{current:true,revision:9}},posts=[];
 const f=harness(storage(null),async(path)=>{posts.push(path);return {};},{readCard:()=>card});
 f.render();await flush();f.render();f.workspaceProps().onPhotos();await flush();f.render();
 assert.equal(f.workspace(),false);assert.equal(f.has('Edit Back geometry'),false);assert.ok(f.field('BACK original photo'));
 f.click('Return to review');await flush();f.render();assert.equal(f.workspace(),true);assert.deepEqual(posts,[]);f.dispose();
});
test('direct review entry for replaced photos uses the exact existing replacement action',async()=>{
 let card={...failedPhotos(),manual:{current:false,revision:9}};const posts=[];
 const f=harness(storage(null),async(path,{body})=>{posts.push({path,body:plain(body)});card={...card,manual:{current:true,revision:10}};return {};},{readCard:()=>card});
 f.render();await flush();f.render();await flush();f.render();
 assert.equal(posts.length,1);assert.equal(posts[0].body.expectedRevision,9);assert.deepEqual(posts[0].body.action,{type:'REPLACE_SOURCES',sourceHash:'sports-source'});
 assert.equal(f.workspace(),true);f.dispose();
});
test('uncertain review initialization retains the exact request and never returns to retired geometry UI',async()=>{
 let card=failedPhotos();const store=storage(null),posts=[];
 const f=harness(store,async(path,{body})=>{posts.push({path,body:plain(body)});if(posts.length===1)throw {status:503,code:'UNCERTAIN'};card={...card,manual:{current:true,revision:1}};return {};},{readCard:()=>card});
 f.render();await flush();f.render();await flush();f.render();
 assert.equal(posts.length,1);assert.ok(store.getItem(key));assert.equal(f.has('Resume saved request'),true);
 assert.doesNotMatch(f.text(),/Edit (Front|Back) geometry|Original retained|PHOTOGRAPHS & IDENTITY/);
 f.click('Resume saved request');await flush();f.render();assert.equal(f.workspace(),true);assert.deepEqual(posts[1],posts[0]);f.dispose();
});

test('direct saved-card review mounts the bounded shell and carries its pending-work exit lock',async()=>{
 const card={...pokemonCard(),manual:{current:true,revision:7}};
 const f=harness(storage(null),async()=>{throw Error('Unexpected write');},{readCard:()=>card});
 f.render();await flush();f.render();
 assert.ok(f.workspace());assert.equal(Object.hasOwn(f.workspaceProps(),'rapid'),false);assert.ok(f.directShell(),'actual direct route owns the shared bounded shell');
 assert.equal(f.directShell().busy,false);
 f.workspaceProps().onBusyChange(true);f.render();assert.equal(f.directShell().busy,true,'pending saves/edits lock the direct exit');
 f.workspaceProps().onBusyChange(false);f.render();assert.equal(f.directShell().busy,false);f.dispose();
});


test('pending variant recheck explains its hold instead of suggesting a blind save retry',()=>{
 const message=manualMessage({code:'VARIANT_REPROCESS_REQUIRED'});
 assert.match(message,/confirmed variant is still being checked/);assert.match(message,/saved findings are retained/);
 assert.doesNotMatch(message,/Retry the saved request/);
});
test('direct review title uses authoritative photo-bound identification instead of the intake slot label',async()=>{
 const card=pokemonCard();card.card.label='Card 1';card.details.sourceHash=card.card.sourceHash;card.details.fields.name='Pikachu';card.manual={current:true,revision:1};
 const f=harness(storage(null),async()=>assert.fail('no command'),{readCard:()=>structuredClone(card)});
 f.render();await flush();f.render();assert.equal(f.directShell().title,'Pikachu');f.dispose();
 card.details.sourceHash='older-photographs';
 const stale=harness(storage(null),async()=>assert.fail('no command'),{readCard:()=>structuredClone(card)});
 stale.render();await flush();stale.render();assert.equal(stale.directShell().title,'Card 1');stale.dispose();
});


test('preparation failure reports retained evidence without claiming a new outline save',()=>{
 const message=manualMessage({code:'MANUAL_PREPARATION_FAILED'});
 assert.match(message,/saved outline and photos are kept/);assert.doesNotMatch(message,/Your outline is saved/);
});

for(const profile of ['SPORTS','POKEMON'])test(`${profile} partial identification enters grading with blank descriptive fields and no invented identity`,async()=>{
 let card=failedPhotos();card.details.profile=profile;card.details.layoutType=null;
 for(const field of ['name','set_name','year','manufacturer','card_number'])card.details.fields[field]='';
 const before=plain(card.details),posts=[],f=harness(storage(null),async(path,{body})=>{
  posts.push({path,body:plain(body)});assert.equal(path.endsWith('/initialize'),true);
  card={...card,manual:{current:true,revision:1}};return {};
 },{readCard:()=>card,fromBatch:true});
 f.render();await flush();f.render();await flush();f.render();
 assert.equal(f.workspace(),true);assert.equal(posts.length,1);assert.deepEqual(card.details,before);f.dispose();
});
test('partial identification message states that missing fields can stay blank',async()=>{
 const card=sportsCard();card.details.fields.set_name='';
 const f=harness(storage(null),async()=>assert.fail('No automatic initialization without ready grading images'),{readCard:()=>card});
 f.render();await flush();f.render();assert.match(f.text(),/Identification returned partial details/);
 assert.match(f.text(),/Unconfirmed fields can stay blank while grading continues/);
 assert.equal(f.field('Product / set').props['aria-invalid'],false);f.dispose();
});
