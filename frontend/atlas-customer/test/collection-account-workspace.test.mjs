import test from 'node:test';
import assert from 'node:assert/strict';
import { customerPage } from '../lib/server/page.mjs';
import { BoundaryError } from '../lib/server/policy.mjs';
import { CLAIM_ACCOUNT, CLAIM_OTHER_ACCOUNT, createOwnershipClaimsFixture, createOwnershipClaimHistoryFixture } from './ownership-claims-fixture.mjs';
import { createMountedCollectionFixture, all, words, click, button, deferred } from './collection-account-fixture.mjs';
const reportLinks=tree=>all(tree,x=>x.type==='a'&&x.props.href?.startsWith('/reports/'));
const status=tree=>all(tree,x=>x.props?.role==='status').map(words).join(' ');

test('actual mounted account session opens collection, exact report, v2 history and current changes, then rereads collection',async()=>{
  const f=createMountedCollectionFixture();try{
    assert.match(words(f.render()),/Opening your account/);let tree=await f.settle();
    assert.equal(reportLinks(tree).length,2);assert.match(reportLinks(tree)[0].props.href,/^\/reports\/ar_A{24}\?v=1$/);
    assert.deepEqual(f.calls.map(x=>x.path),['/account/api/customer/session','/account/api/customer/collection?limit=25']);
    click(tree,'Ownership claim history');tree=await f.settle();
    assert.equal(reportLinks(tree).length,7);assert.match(words(tree),/Verified No current ownership is recorded/);
    assert.match(words(tree),/Withdrawn/);assert.doesNotMatch(words(tree),/Current collection Loading your collection/);
    click(tree,'View recorded changes');tree=await f.settle();
    assert.match(words(tree),/Withdrawn.*Current claim revision 3/);assert.match(words(tree),/Claim submitted Revision 1 · Pending/);
    assert.match(words(tree),/Evidence replaced Revision 2 · Pending/);assert.match(words(tree),/Past actions below do not replace the current state/);
    click(tree,'Close changes');tree=f.render();assert.match(words(tree),/Withdrawn.*Current claim revision 3/);
    click(tree,'Current collection');tree=await f.settle();assert.equal(reportLinks(tree).length,2);assert.equal(f.reads.filter(x=>x[0]==='read_collection').length,2);
    assert(f.calls.every(x=>x.options.method==='GET'));assert(f.calls.every(x=>!/[?&]accountId=|configuration|target|reserve|withdraw|sign|complete/.test(x.path)));
  }finally{f.unmount();}
});

test('absent display configuration hides history; valid empty and unavailable collection are distinct and independent',async()=>{
  const off=createMountedCollectionFixture({history:false});try{off.collectionEmpty=true;off.render();const t=await off.settle();
    assert.equal(button(t,'Ownership claim history'),undefined);assert.match(words(t),/No verified cards/);assert.equal(off.calls.length,2);
  }finally{off.unmount();}
  const f=createMountedCollectionFixture();try{f.collectionUnavailable=true;f.render();let t=await f.settle();
    assert.match(status(t),/collection is unavailable/);assert.doesNotMatch(words(t),/No verified cards/);
    click(t,'Ownership claim history');t=await f.settle();assert.equal(reportLinks(t).length,7);
    f.historyUnavailable=true;click(t,'Refresh page');t=await f.settle();assert.match(status(t),/claim history is unavailable/);
    f.collectionUnavailable=false;f.collectionEmpty=true;click(t,'Current collection');t=await f.settle();assert.match(words(t),/No verified cards/);
  }finally{f.unmount();}
});

test('switching views aborts inactive requests and their late results cannot reappear',async()=>{
  for(const pendingView of ['collection','history']){
    const f=createMountedCollectionFixture(),entered=deferred(),release=deferred();try{
      f.hold={match:p=>p.includes(pendingView==='collection'?'/collection?':'/ownership/claims?'),entered,release};
      f.render();if(pendingView==='history'){await f.settle();click(f.render(),'Ownership claim history');}
      await f.settle(); const pending=await entered.promise;f.render();click(f.render(),pendingView==='collection'?'Ownership claim history':'Current collection');
      const current=await f.settle();assert.equal(pending.options.signal.aborted,true);const count=reportLinks(current).length;
      f.hold=null;release.resolve();await f.settle();assert.equal(reportLinks(f.render()).length,count);
      assert.equal(button(f.render(),pendingView==='collection'?'Ownership claim history':'Current collection').props['aria-pressed'],true);
    }finally{release.resolve();f.unmount();}
  }
});

test('each view shares a permanent account access-loss latch, including a foreign successful collection reply',async()=>{
  for(const mode of ['collection401','collection403','history401','history403','foreign']){
    const f=createMountedCollectionFixture();try{f.render();let t=await f.settle();
      if(mode.startsWith('history')){click(t,'Ownership claim history');t=await f.settle();}
      if(mode==='foreign')f.foreignCollection=true;else f.refusal=Number(mode.slice(-3));
      click(t,mode.startsWith('history')?'Refresh page':'Refresh collection');t=await f.settle();
      assert.equal(reportLinks(t).length,0);assert.match(words(t),/Collection access ended/);
      assert(button(t,'Current collection').props.disabled);assert(button(t,'Ownership claim history').props.disabled);
      const calls=f.calls.length;await f.settle();assert.equal(f.calls.length,calls);assert.doesNotMatch(words(t),/No verified cards|No submitted claims/);
    }finally{f.unmount();}
  }
});

test('account object and in-place identity changes close old view and stale controls; END cannot be reset on the same session',async()=>{
  for(const mutation of ['object','id']){
    const f=createMountedCollectionFixture();let customer={id:CLAIM_ACCOUNT};let props={customer,historyConfiguredForDisplay:true};
    f.useHub(props);try{f.render();const old=await f.settle();
      if(mutation==='object')customer={id:CLAIM_OTHER_ACCOUNT};else customer.id=CLAIM_OTHER_ACCOUNT;
      f.accountId=CLAIM_OTHER_ACCOUNT;props={...props,customer};
      assert.equal(reportLinks(f.render(props,{effects:false})).length,0);f.render(props);await f.settle();const calls=f.calls.length;
      button(old,'Ownership claim history').props.onClick();await f.settle();assert.equal(f.calls.length,calls);
      assert.equal(button(f.render(),'Current collection').props['aria-pressed'],true);
      f.render({...props,accessState:'ENDED'});assert.equal(reportLinks(f.render(props)).length,0);assert.match(words(f.render()),/access ended/);
    }finally{f.unmount();}
  }
});

test('pagehide and logout cancel active history; a later private reply cannot reopen the hub',async()=>{
  for(const mode of ['pagehide','logout','unmount']){
    const f=createMountedCollectionFixture(),entered=deferred(),release=deferred();try{
      f.render();let t=await f.settle();f.hold={match:p=>p.includes('/ownership/claims?'),entered,release};click(t,'Ownership claim history');
      await f.settle(); const pending=await entered.promise;f.render();if(mode==='pagehide')f.pagehide();else if(mode==='logout')click(f.render(),'Sign out');else f.unmount();
      if(mode!=='unmount')f.render();assert.equal(pending.options.signal.aborted,true);release.resolve();
      if(mode!=='unmount'){t=await f.settle();assert.equal(reportLinks(t).length,0);assert.match(words(t),/access ended/);}
      else await new Promise(resolve=>setImmediate(resolve));
    }finally{release.resolve();f.unmount();}
  }
});

test('legacy history, exact history pages and missing card links remain truthful inside mounted hub',async()=>{
  const f=createMountedCollectionFixture();try{
    f.historyPage=createOwnershipClaimsFixture({count:1}).page;f.historyPage.claims[0].bundleId=null;
    f.historyResult=createOwnershipClaimHistoryFixture({legacy:true,revision:1,state:'PENDING'}).history;
    f.render();await f.settle();click(f.render(),'Ownership claim history');await f.settle();click(f.render(),'View recorded changes');
    let t=await f.settle();assert.match(words(t),/began before v2 history/);assert.match(words(t),/No recorded v2 changes/);assert.doesNotMatch(words(t),/Claim submitted Revision/);
    f.historyResult=createOwnershipClaimHistoryFixture({revision:27,limit:25}).history;
    click(t,'Close changes');click(f.render(),'View recorded changes');t=await f.settle();assert.match(words(t),/Revision 25/);assert.doesNotMatch(words(t),/Revision 26/);
    f.historyResult=createOwnershipClaimHistoryFixture({revision:27,afterRevision:25,limit:25}).history;
    click(t,'Next changes');t=await f.settle();assert.match(words(t),/Revision 26/);assert.doesNotMatch(words(t),/Claim submitted Revision/);
    assert(f.calls.some(x=>x.path.includes('afterRevision=25')));
  }finally{f.unmount();}
});

test('only ingress-admitted collection pages receive a boolean display hint, never runtime credentials or readiness claims',async()=>{
  const res=()=>({setHeader(){}});let observed=0;
  const state={assertRequest(){observed++;},ownershipHistory:{configuredForDisplay:true,databaseUrl:'secret-do-not-serialize'}};
  assert.deepEqual(await customerPage({req:{},res:res()},{initialView:'collection'},async()=>state),{props:{initialView:'collection',historyConfiguredForDisplay:true}});
  for(const initialView of ['dashboard','submit','profile'])assert.deepEqual(await customerPage({req:{},res:res()},{initialView},async()=>state),{props:{initialView}});
  for(const selected of [undefined,false,'true',null])assert.equal((await customerPage({req:{},res:res()},{initialView:'collection',historyConfiguredForDisplay:true},async()=>({...state,ownershipHistory:{configuredForDisplay:selected}}))).props.historyConfiguredForDisplay,false);
  let touched=false;const refused={assertRequest(){throw new BoundaryError(403,'DENIED');},get ownershipHistory(){touched=true;throw Error('must not read');}};
  assert.deepEqual(await customerPage({req:{},res:res()},{initialView:'collection'},async()=>refused),{props:{unavailable:true}});assert.equal(touched,false);assert.equal(observed,8);
});


test('StrictMode effect replay restores mounted controls without reviving ended access; final cleanup rejects old controls',async()=>{
  const f=createMountedCollectionFixture();try{
    f.render();await f.settle();f.replayEffects();let t=await f.settle();
    const oldCollectionRefresh=button(t,'Refresh collection');
    click(t,'Ownership claim history');t=await f.settle();assert.equal(reportLinks(t).length,7);
    const oldHistoryRefresh=button(t,'Refresh page'); f.replayEffects();t=await f.settle();assert.equal(reportLinks(t).length,7);
    const count=f.calls.length;oldCollectionRefresh.props.onClick();await f.settle();assert.equal(f.calls.length,count);
    click(t,'View recorded changes');t=await f.settle();const oldClose=button(t,'Close changes'),oldHistory=button(t,'View recorded changes');
    click(t,'Current collection');t=await f.settle();const afterSwitch=f.calls.length;oldHistoryRefresh.props.onClick();oldClose.props.onClick();oldHistory.props.onClick();await f.settle();assert.equal(f.calls.length,afterSwitch);
    click(f.render(),'Ownership claim history');t=await f.settle();f.refusal=403;click(t,'Refresh page');t=await f.settle();assert.match(words(t),/Collection access ended/);
    f.replayEffects();t=await f.settle();assert.match(words(t),/Collection access ended/);assert(button(t,'Current collection').props.disabled);
  }finally{f.unmount();}
  const g=createMountedCollectionFixture();g.render();const old=await g.settle();const count=g.calls.length;g.unmount();
  button(old,'Ownership claim history').props.onClick();button(old,'Refresh collection').props.onClick();
  await new Promise(resolve=>setImmediate(resolve));assert.equal(g.calls.length,count);
});
