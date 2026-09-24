import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(new URL('../package.json',import.meta.url)),babel=require('next/dist/compiled/babel/core'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const transform=path=>babel.transformSync(readFileSync(new URL(path,import.meta.url),'utf8'),{filename:path,presets:[[require.resolve('next/babel'),{'preset-env':{targets:{node:'current'}}}]],babelrc:false,configFile:false}).code;
const exports={};vm.runInNewContext(transform('../components/dealer/DealerPortal.jsx'),{exports,Intl,require:name=>name==='react'?React:require(name)});
test('dealer portal renders scoped counts/custody/commission without private grade, profile or transfer claims',()=>{
 const html=renderToStaticMarkup(React.createElement(exports.default,{initial:{location:{name:'Fixture kiosk'},customerCount:2,orderCount:1,cardCount:2,
  commission:{accruedCents:1000,reversedCents:500},orders:[{reference:'ATLAS-FIXTURE',cardCount:2,cards:[{cardId:'one',custody:'DEPOSIT_DECLARED',grading:'NOT_STARTED'},{cardId:'two',custody:'ATLAS_RECEIVED',grading:'HUMAN_APPROVED'}]}],
  profile:{email:'private@example.invalid'},grade:9.5,paymentDetails:'private-card'},request:()=>{}}));
 assert.match(html,/Customer reports dropbox deposit/);assert.match(html,/At ATLAS/);assert.match(html,/Grading approved/);assert.match(html,/Accrued \$10.00/);assert.match(html,/Reversed \$5.00/);assert.match(html,/payout timing is not yet configured/);
 assert.doesNotMatch(html,/private@example|9\.5|private-card|paid out/i);
});
test('new dealer route and location session workspace compile',()=>{
 assert(transform('../components/dealer/DealerWorkspace.jsx'));assert(transform('../pages/dealer.jsx'));
});
const orderExports={};vm.runInNewContext(transform('../components/orders/CustomerOrderTracking.jsx'),{exports:orderExports,Intl,require:name=>name==='react'?React:name==='../../lib/client.mjs'?{}:require(name)});
test('customer current-card tracker renders declared and actual custody as separate facts with no guessed approval',()=>{
 const card={cardId:'fixture',identity:{title:'Fixture card'},channel:'KIOSK',originalLocation:'Fixture kiosk',grading:'NOT_STARTED',originalSchedule:{timeZone:'America/Los_Angeles',nextCollectionAt:'2026-09-30T17:00:00Z',projectedReturnAt:'2026-10-07T17:00:00Z'},currentProjection:{nextCollection:'2026-10-07T17:00:00Z',projectedReturn:'2026-10-14T17:00:00Z'},scheduleChanged:true,
 events:[{id:'declaration',kind:'DEPOSIT_DECLARED',occurredAt:'2026-09-28T18:00:00Z'}]};
 const html=renderToStaticMarkup(React.createElement(orderExports.OrderCard,{card,onDeposit:()=>{}}));
 assert.match(html,/You reported a dropbox deposit/);assert.match(html,/ATLAS collection and receipt are confirmed separately/);assert.match(html,/Collection has not been recorded/);assert.match(html,/schedule changed after checkout/);
 assert.doesNotMatch(html,/ATLAS collected your card|Human report approval recorded|View your approved report|I placed this card/);
 const approved=renderToStaticMarkup(React.createElement(orderExports.OrderCard,{card:{...card,grading:'HUMAN_APPROVED',approvedAt:'2026-10-01T17:00:00Z',reportUrl:'/reports/ar_'+'A'.repeat(24)+'?v=1',events:[...card.events,{id:'pickup',kind:'COLLECTED',occurredAt:'2026-09-30T17:00:00Z'}],collectedAt:'2026-09-30T17:00:00Z',turnaroundTarget:'2026-10-07T17:00:00Z'}}));
 assert.match(approved,/ATLAS collected your card/);assert.match(approved,/Human report approval recorded/);assert.match(approved,/View your approved report/);
});
test('order detail/history and paid-receipt mount compile without replacing legacy tracker',()=>{
 for(const path of ['../components/orders/CustomerOrderHistory.jsx','../pages/orders/[id].jsx','../components/AccountWorkspace.jsx','../components/intake/CustomerIntake.jsx'])assert(transform(path));
});
