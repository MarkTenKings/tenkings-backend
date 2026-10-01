import test from 'node:test';
import assert from 'node:assert/strict';
import {cardJourney,orderJourney,safeReportPath} from '../lib/card-journey.mjs';
const time='2026-10-01T17:00:00Z';
const event=(kind,more={})=>({id:kind,kind,occurredAt:time,...more});
test('a paid photo submission never advances physical custody by schedule or time',()=>{
 const result=cardJourney({orderId:'paid',paidAt:time,channel:'KIOSK',grading:'NOT_STARTED',events:[event('DEPOSIT_DECLARED')],originalSchedule:{nextCollectionAt:'2020-01-01T00:00:00Z'}});
 assert.equal(result.current,'submission');assert.equal(result.steps.filter(s=>s.confirmed).length,1);assert.equal(result.complete,false);
});
test('recorded return takes priority over an approved report without inventing missing milestones',()=>{
 const result=cardJourney({orderId:'paid',channel:'KIOSK',grading:'HUMAN_APPROVED',events:[event('RETURNED_TO_KIOSK')]});
 assert.equal(result.label,'Ready for pickup');assert.equal(result.current,'return');assert.equal(result.complete,false);
 assert.equal(result.steps.find(s=>s.key==='received').confirmed,false);assert.equal(result.steps.find(s=>s.key==='home').confirmed,false);
});
test('each route requires its own actual final delivery or pickup event',()=>{
 assert.equal(cardJourney({channel:'KIOSK',events:[event('CUSTOMER_DELIVERED')]}).complete,false);
 assert.equal(cardJourney({channel:'KIOSK',events:[event('CUSTOMER_COLLECTED')]}).complete,true);
 assert.equal(cardJourney({channel:'MAIL_IN',events:[event('CUSTOMER_DELIVERED')]}).complete,true);
 assert.equal(cardJourney({channel:'MAIL_IN',events:[event('CUSTOMER_DELIVERED',{occurredAt:'bad-date'})]}).complete,false);
});
test('mixed order remains active and unresolved delay survives without a fabricated deadline',()=>{
 const cards=[{channel:'MAIL_IN',events:[event('CUSTOMER_DELIVERED')]},{channel:'MAIL_IN',grading:'IN_GRADING',events:[event('DELAY_REPORTED',{note:'Carrier delay'})]}];
 assert.deepEqual(orderJourney(cards),{complete:false,attention:1,approved:0,summary:[{label:'Back in your hands',count:1},{label:'Being graded',count:1}]});
 assert.equal(cardJourney({...cards[1],events:[...cards[1].events,event('DELAY_RESOLVED')]}).attention,null);
});
test('legacy tracker and safe report references retain their actual authority',()=>{
 const report='/reports/ar_abcdefghijklmnopqrstuvwx?v=3';
 const result=cardJourney({stage:'FINAL_REVIEW',events:[{kind:'RECEIVED',recordedAt:time}],reportUrl:report});
 assert.equal(result.current,'grading');assert.equal(result.reportUrl,report);
 assert.equal(safeReportPath('https://attacker.invalid/reports/ar_abcdefghijklmnopqrstuvwx'),null);
 assert.equal(safeReportPath(report+'&accountId=x'),null);assert.equal(orderJourney([]).complete,false);
});

test('staff shop receipt is visible but never starts the ATLAS collection clock',()=>{
 const journey=cardJourney({channel:'KIOSK',orderId:'paid-order',events:[{kind:'DEALER_RECEIVED',occurredAt:'2026-10-01T18:00:00Z'}]});
 assert.equal(journey.current,'handoff');assert.equal(journey.label,'Received by your card shop');
 assert.equal(journey.steps.find(s=>s.key==='collection').confirmed,false);
 assert.equal(journey.steps.find(s=>s.key==='received').confirmed,false);
});
