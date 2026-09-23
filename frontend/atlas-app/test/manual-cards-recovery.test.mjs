import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import * as identity from '@atlas/grading-core/identity';
import * as defectAnalysisClient from '../lib/manual-defect-analysis-client.mjs';
import * as earlyGeometryClient from '../lib/early-geometry-client.mjs';
import { manualMessage } from '../lib/manual-client.mjs';

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
function harness(store, post, { readCard, intake = {}, message = error => error.code ?? 'Retained' } = {}) {
  const slots = [], effects = [], cleanups=[],timers=new Map(); let cursor = 0, tree, activeCardId='card';
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
    window: { addEventListener() {}, removeEventListener() {} },
    require(name) {
      if (name === 'react') return react;
      if (name === 'next/router') return { useRouter: () => ({ events: { on() {}, off() {} } }) };
      if (name === 'next/link' || name === './Shell') return { default: name };
      if (name === './EarlyGeometryPreview') return {default:name,EarlyGeometryStatus:'EarlyGeometryStatus'};
      if (name === './ReportPhotoUploader') return {__esModule:true,default:'ReportPhotoUploader'};
      if (name === './ReportMarketPicker') return {__esModule:true,default:'ReportMarketPicker'};
      if (name === './ManualFinishing') return {__esModule:true,default:'ManualFinishing',openManualLabelPrintWindow:()=>null};
      if (name === '@atlas/manual-intake/client') return { createBrowserIntakeJournal: () => ({ close() {} }), createIntakeClient: () => ({ pending: async () => [], ...intake }) };
      if (name === '@atlas/grading-core/identity') return identity;
      if (name.startsWith('@atlas/')) return {};
      if (name === '../lib/routes.mjs') return { STAFF_BASE_PATH: '/admin' };
      if (name === '../lib/manual-defect-analysis-client.mjs') return defectAnalysisClient;
      if (name === '../lib/early-geometry-client.mjs') return earlyGeometryClient;
      if (name === '../lib/manual-client.mjs') return { manualMessage: message, manualRequest: async (path, options = {}) => {
        if (options.method === 'POST') return post(path, options);
        return path.endsWith('/session') ? { staff: { id: 'reviewer' }, csrf: 'csrf' } : readCard ? readCard(path) : card;
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
  return { render, submit,async tick(){timers.get(2000)?.();await flush();render();},dispose(){cleanups.forEach(cleanup=>cleanup?.());}, navigate(cardId){activeCardId=cardId;render();}, upload(side,file={name:side}) { const target=field(`${side} original photo`);assert.ok(target);assert.notEqual(target.props.disabled,true);target.props.onChange({target:{files:[file],value:'picked'}}); }, workspace:()=>Boolean(find(tree,node=>node.type?.name==='ManualWorkspace')), click(label) { const target = button(label); assert.ok(target, label); assert.notEqual(target.props.disabled, true, label); target.props.onClick(); },
    has(label) { return Boolean(button(label)); }, disabled(label) { return button(label)?.props.disabled === true; }, text: () => text(tree), sideText:side=>text(find(tree,node=>node.type==='article'&&text(node).startsWith(side))), field,
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
  { label: 'Pokémon card kind', field: 'layoutType' },
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
  for(const [field,value]of [['Name',''],['Year',''],['Manufacturer',''],['Product / set','x'.repeat(121)]]){
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

test('actual intake reconciles first-side geometry before identity, then reads background progress without erasing typed details',async()=>{
  const calls=[];let card=pokemonCard();card.card.ready=false;card.identification.state='NOT_STARTED';card.details.fields.name='';
  card.card.sides.FRONT.upload={uploadId:'first-front',source:{ready:true}};
  card.earlyGeometry={FRONT:{state:'QUEUED',key:'front-work'},BACK:{state:'WAITING_PHOTO'}};
  const f=harness(storage(null),async(path,options)=>{calls.push({path,body:JSON.parse(JSON.stringify(options.body))});return {};},{readCard:()=>structuredClone(card)});
  try{
    f.render();await flush();f.render();await flush();f.render();
    assert.deepEqual(calls,[{path:'/api/staff/manual-connected/cards/card/geometry',body:{}}]);
    assert.equal(f.workspace(),false,'early preparation does not initialize a manual workspace');
    f.change('Name','My unsaved detail');f.render();
    card.earlyGeometry.FRONT.state='READY';await f.tick();f.render();
    assert.equal(f.field('Name').props.value,'My unsaved detail');assert.equal(calls.length,1);
  }finally{f.dispose();}
});
