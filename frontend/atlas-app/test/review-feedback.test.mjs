import test from 'node:test';
import assert from 'node:assert/strict';
import {createReviewSession,recordReviewCompletion,claimReviewVoice,ATLAS_LINES} from '../lib/review-feedback.mjs';
for(const random of [()=>0,()=>.999,(()=>{let n=17;return()=>((n=(n*16807)%2147483647)/2147483647)})()])test('100 cards stay within 10–20 voice appearances, spaced 5–10 cards apart',()=>{
 const session=createReviewSession('staff',random),appearances=[];
 for(let i=1;i<=100;i++){
  for(const stage of ['geometry','findings','report']){
   const cue=claimReviewVoice(session,{staffId:'staff',stage});
   if(cue){appearances.push(cue.ordinal);assert.equal(ATLAS_LINES[cue.voiceIndex].completionOnly,undefined);}
   assert.equal(claimReviewVoice(session,{staffId:'staff',stage}),null,'re-renders and Back do not repeat a cue');
  }
  const result=recordReviewCompletion(session,'staff',`approval-${i}`);assert.equal(result.count,i);
  if(result.voiceIndex!==null)appearances.push(result.ordinal);
  assert.equal(recordReviewCompletion(session,'staff',`approval-${i}`),null);
 }
 assert.ok(appearances.length>=10&&appearances.length<=20);
 for(let i=0;i<appearances.length;i++){const gap=appearances[i]-(appearances[i-1]??0);assert.ok(gap>=5&&gap<=10);}
});
test('missed stages fall back once at completion and sessions/reviewers remain independent',()=>{
 const a=createReviewSession('a',()=>0),b=createReviewSession('b',()=>0);
 for(let i=1;i<=5;i++)recordReviewCompletion(a,'a',`approval-${i}`);
 assert.equal(a.count,5);assert.equal(b.count,0);assert.equal(a.nextAt,10);
 assert.equal(claimReviewVoice(a,{staffId:'b',stage:'completion',completed:true}),null);
 assert.equal(recordReviewCompletion(a,'b','foreign'),null);
 assert.equal(createReviewSession('a',()=>0).count,0);
 assert.equal(recordReviewCompletion(a,'a',null),null);
});
test('muting does not block approvals, or consume the next voice cue',()=>{
 const session=createReviewSession('staff',()=>0);
 for(let i=1;i<=10;i++)assert.equal(recordReviewCompletion(session,'staff',String(i),false).voiceIndex,null);
 assert.equal(session.count,10);assert.equal(session.nextAt,5);
 assert.notEqual(claimReviewVoice(session,{staffId:'staff',stage:'geometry'}),null);
 assert.equal(claimReviewVoice(session,{staffId:'staff',stage:'geometry'}),null);
});
