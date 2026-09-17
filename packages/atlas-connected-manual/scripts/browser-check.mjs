import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {chromium} from '../../atlas-manual-workspace/node_modules/playwright/index.mjs';

assert(process.env.ATLAS_CONNECTED_EVIDENCE,'An owned evidence directory is required');
const evidence=resolve(process.env.ATLAS_CONNECTED_EVIDENCE),photos=resolve(process.env.ATLAS_CONNECTED_PHOTO_DIR??join(evidence,'photos'));
const origin='http://127.0.0.1:4318',reuse=process.env.ATLAS_CONNECTED_CARD_ID??null;
if(reuse)assert.match(reuse,/^[a-f0-9-]{36}$/);
await mkdir(evidence,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1500,height:1050},
  ...(process.env.ATLAS_CONNECTED_STORAGE_STATE?{storageState:resolve(process.env.ATLAS_CONNECTED_STORAGE_STATE)}:{})}),page=await context.newPage();
page.setDefaultTimeout(30000);
const errors=[],requests=[],checks=[],actions=[],imageRequests=[];let cardId=reuse,lostApproval=null,loseLookup=false;
page.on('pageerror',error=>errors.push(error.message));
page.on('response',response=>{const url=new URL(response.url());if(url.pathname.includes('/api/staff/')){
  const entry={method:response.request().method(),path:url.pathname,status:response.status()};requests.push(entry);
  if(response.status()>=400)void response.json().then(body=>{entry.error=body.error;}).catch(()=>{});
}else if(url.origin==='https://127.0.0.1:4320'&&response.request().method()==='GET')imageRequests.push({path:url.pathname,status:response.status()});});
page.on('request',request=>{if(request.method()==='POST'&&/\/manual\/cards\/[^/]+\/actions$/.test(new URL(request.url()).pathname)){
  const body=request.postDataJSON();actions.push({actionId:body.actionId,expectedRevision:body.expectedRevision,type:body.action?.type});}});
const screenshot=name=>page.screenshot({path:join(evidence,`${name}.png`),fullPage:true});
const settled=()=>page.waitForFunction(()=>document.querySelector('.mc-review-nav span')?.textContent==='Saved'
  && ![...document.querySelectorAll('.am-side-heading')].some(node=>/Saving|Preparing/.test(node.textContent)),{},{timeout:120000});
const navigationLocked=()=>page.waitForFunction(()=>[...document.querySelectorAll('.mc-review-nav button')].find(button=>button.textContent==='Photos')?.disabled);
const readView=()=>page.evaluate(async path=>{const response=await fetch(path,{credentials:'same-origin',cache:'no-store'});if(!response.ok)throw new Error(`View ${response.status}`);return response.json();},`/admin/api/staff/manual/cards/${cardId}/view`);
try{
  await page.goto(`${origin}/admin`);
  await page.getByLabel('Phone number',{exact:true}).or(page.getByRole('heading',{name:'Your cards',exact:true})).waitFor({timeout:60000});
  if(await page.getByLabel('Phone number',{exact:true}).isVisible()){
    await page.getByLabel('Phone number',{exact:true}).fill('+12025550141');await page.getByRole('button',{name:'Request sign-in code'}).click();
    await page.getByLabel('Verification code').fill('424242');await page.getByRole('button',{name:'Verify & open workspace'}).click();
  }
  await page.getByRole('heading',{name:'Your cards'}).waitFor({timeout:60000});
  if(reuse)await page.goto(`${origin}/admin/manual/${reuse}`);
  else{
    await page.getByRole('button',{name:'+ Add card',exact:true}).click();await page.waitForURL(/\/admin\/manual\/[a-f0-9-]{36}$/);cardId=page.url().split('/').at(-1);
    await page.getByRole('heading',{name:'New card',exact:true}).waitFor();assert.match(cardId,/^[a-f0-9-]{36}$/);checks.push('ordinary Next staff SMS fixture sign-in and durable new card');
    for(const side of ['FRONT','BACK']){
      await page.getByLabel(`${side} original photo`).setInputFiles(join(photos,`${side.toLowerCase()}-original.png`));
      await page.getByAltText(`${side==='FRONT'?'Front':'Back'} SDR working view`).waitFor({timeout:120000});
      await page.waitForFunction(()=>!document.body.textContent.includes('Saving Front original…')&&!document.body.textContent.includes('Saving Back original…'));
    }
    await page.waitForFunction(()=>document.querySelector('input[aria-label="Name"]')?.value==='Synthetic Player',{},{timeout:60000});
    assert.equal(await page.getByLabel('Card family',{exact:true}).inputValue(),'SPORTS');checks.push('actual native browser upload, private HTTPS readback, rich/SDR preparation and synthetic shared-engine identification');
    await page.getByLabel('Name',{exact:true}).fill('Corrected Test Player');await page.getByRole('button',{name:'Save details',exact:true}).click();
    await page.waitForFunction(()=>!document.body.textContent.includes('Saving card details…'));
    await page.reload();await page.waitForFunction(()=>document.querySelector('input[aria-label="Name"]')?.value==='Corrected Test Player');
    checks.push('staff identity correction persists across reload without repeated identification');await screenshot('paired-native-intake');
    await page.getByRole('button',{name:'Review geometry →',exact:true}).click();
  }
  await page.getByRole('button',{name:'Confirm both sides',exact:true}).waitFor({timeout:120000});
  if(!reuse){
    await page.getByRole('button',{name:'Edit card details',exact:true}).click();await page.getByLabel('Player name',{exact:true}).fill('Reviewed Test Player');
    let releaseSave,committedSave;const gate=new Promise(resolve=>{releaseSave=resolve;}),committed=new Promise(resolve=>{committedSave=resolve;});
    const identityRoute=async route=>{if(route.request().method()==='POST'&&route.request().postDataJSON().action?.type==='IDENTITY_EDIT'){
      const response=await route.fetch();committedSave(response.status());await gate;await route.fulfill({response});
    }else await route.continue();};
    await page.route(`**/admin/api/staff/manual/cards/${cardId}/actions`,identityRoute);
    try{
      await page.getByRole('button',{name:'Save card details',exact:true}).click();assert.equal(await committed,200);
      assert.equal(await page.getByLabel('Player name',{exact:true}).isDisabled(),true);
      assert.equal(await page.getByRole('button',{name:'Discard changes',exact:true}).isDisabled(),true);
      assert.equal(await page.getByRole('button',{name:'Save card details',exact:true}).isDisabled(),true);
    }finally{releaseSave();}
    await settled();await page.getByRole('heading',{name:'Correct card details',exact:true}).waitFor({state:'hidden'});
    await page.unroute(`**/admin/api/staff/manual/cards/${cardId}/actions`,identityRoute);
    assert.equal((await readView()).identity.playerName,'Reviewed Test Player');checks.push('identity correction persists and freezes inputs, discard, and duplicate save while response is pending');
  }
  for(const side of ['FRONT','BACK']){
    const section=page.locator(`section[aria-label="${side==='FRONT'?'Front':'Back'} geometry"]`),start=section.getByRole('button',{name:'Start manual outline',exact:true});
    if(await start.count())await start.click();else await section.getByRole('button',{name:`${side} nudge right`,exact:true}).click();
    await navigationLocked();await section.getByRole('button',{name:'Save outline',exact:true}).click();await settled();
    const prepare=section.getByRole('button',{name:'Prepare this side',exact:true});if(await prepare.count()){await prepare.click();await settled();}
  }
  let denyImage=true;
  const expiredGrant=async route=>{const response=await route.fetch();const value=await response.json();
    if(denyImage){denyImage=false;assert(value.images.FRONT.rectified.url);value.images.FRONT.rectified.url+='?expired-proof=1';}
    await route.fulfill({response,json:value});};
  await page.route(`**/admin/api/staff/manual/cards/${cardId}/view`,expiredGrant);
  await page.getByRole('button',{name:'Reload images',exact:true}).click();await page.getByRole('button',{name:'Reload images',exact:true}).waitFor();
  await page.unroute(`**/admin/api/staff/manual/cards/${cardId}/view`,expiredGrant);
  await page.getByRole('button',{name:'Printed border',exact:true}).click();
  const frontGeometry=page.locator('section[aria-label="Front geometry"]'),backGeometry=page.locator('section[aria-label="Back geometry"]');
  await frontGeometry.getByText('Photo unavailable or its bytes did not match. Your saved work is retained.',{exact:true}).waitFor();
  await backGeometry.getByRole('button',{name:'BACK nudge right',exact:true}).click();await navigationLocked();
  const pendingCoordinate=await backGeometry.locator('.am-coordinate').textContent();await screenshot('unavailable-grant-with-unsaved-outline');
  await page.getByRole('button',{name:'Reload images',exact:true}).click();await frontGeometry.getByRole('img').waitFor();
  assert.match(await frontGeometry.getByRole('img').getAttribute('src'),/^blob:/);assert.equal(await backGeometry.locator('.am-coordinate').textContent(),pendingCoordinate);
  assert.equal(await backGeometry.getByRole('button',{name:'Save outline',exact:true}).isVisible(),true);await navigationLocked();
  await backGeometry.getByRole('button',{name:'Save outline',exact:true}).click();await settled();
  checks.push('unavailable direct grant fails closed; Reload images restores verified Blob pixels while retaining the other side’s unsaved outline');
  for(const side of ['FRONT','BACK']){
    const section=page.locator(`section[aria-label="${side==='FRONT'?'Front':'Back'} geometry"]`),start=section.getByRole('button',{name:'Start manual outline',exact:true});
    {
      if(await start.count())await start.click();else await section.getByRole('button',{name:`${side} nudge right`,exact:true}).click();
      await navigationLocked();
      assert.equal(await page.getByRole('button',{name:'Confirm both sides',exact:true}).isDisabled(),true);
      await section.getByRole('button',{name:'Save outline',exact:true}).click();await settled();
    }
  }
  await screenshot('paired-geometry');await page.getByRole('button',{name:'Confirm both sides',exact:true}).click();
  await page.getByRole('heading',{name:'Defects & condition',exact:true}).waitFor();await settled();
  checks.push('both physical/prepared/printed sides reviewed; unsaved geometry fences navigation; one atomic both-side confirmation');
  const before=await readView();assert.equal(before.approval,null);assert.equal(await page.getByRole('button',{name:'Confirm findings',exact:true}).isDisabled(),true);
  const front=page.locator('section[aria-label="Front defects"]');
  let releaseNavigation,readNavigation;const navigationGate=new Promise(resolve=>{releaseNavigation=resolve;}),navigationRead=new Promise(resolve=>{readNavigation=resolve;});
  const delayedNavigation=async route=>{const response=await route.fetch();readNavigation(response.status());await navigationGate;await route.fulfill({response});};
  await page.route(`**/admin/api/staff/manual/cards/${cardId}/view`,delayedNavigation);
  try{
    await page.getByRole('button',{name:'Geometry',exact:true}).click();assert.equal(await navigationRead,200);
    await front.getByRole('button',{name:'Add finding',exact:true}).click();await front.getByRole('button',{name:'Save trace',exact:true}).waitFor();
    const box=await front.locator('.ad-plane').boundingBox();assert(box);
    await page.mouse.move(box.x+box.width*.45,box.y+box.height*.45);await page.mouse.down();
    await page.mouse.move(box.x+box.width*.47,box.y+box.height*.47,{steps:6});await page.mouse.up();
    assert.equal(await front.getByRole('button',{name:'Save trace',exact:true}).isEnabled(),true);
  }finally{releaseNavigation();}
  await page.getByRole('button',{name:'Reload images',exact:true}).waitFor();await page.unroute(`**/admin/api/staff/manual/cards/${cardId}/view`,delayedNavigation);
  assert.equal(await page.getByRole('heading',{name:'Defects & condition',exact:true}).isVisible(),true);
  assert.equal(await front.getByRole('button',{name:'Save trace',exact:true}).isEnabled(),true);
  checks.push('an edit begun during delayed stage-navigation grant refresh cancels that navigation and preserves the new trace');
  await navigationLocked();
  await front.getByRole('button',{name:'Save trace',exact:true}).click();await settled();await front.getByRole('button',{name:'Add finding',exact:true}).waitFor();
  const measured=await readView();assert.equal(measured.defects.sides.FRONT.findings.length,before.defects.sides.FRONT.findings.length+1);
  assert.equal(measured.defects.sides.FRONT.pending,null);assert.deepEqual(measured.defects.sides.BACK,before.defects.sides.BACK);
  checks.push('human trace saves through actual CPU measurement, retains Back and gates navigation while unsaved');
  for(const side of ['Front','Back']){
    await page.getByRole('checkbox',{name:`I inspected ${side}`,exact:true}).click();
    await page.waitForFunction(label=>{const input=[...document.querySelectorAll('input[type="checkbox"]')].find(node=>node.getAttribute('aria-label')===label);return input?.checked;},`I inspected ${side}`);await settled();
  }
  await screenshot('paired-findings');await page.getByRole('button',{name:'Confirm findings',exact:true}).click();await settled();
  assert.equal(actions.filter(action=>action.type==='CONFIRM_FINDINGS').length,1);assert.equal((await readView()).approval,null);
  await page.getByRole('button',{name:'Review draft report',exact:true}).click();await page.getByRole('heading',{name:'Review draft report',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Approve final report',exact:true}).isVisible(),true);
  await screenshot('draft-report');checks.push('each side explicitly inspected, one findings confirmation, and a separate unapproved report preview');
  await page.route(`**/admin/api/staff/manual/cards/${cardId}/actions**`,async route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    if(request.method()==='POST'&&path.endsWith('/actions')&&request.postDataJSON().action?.type==='APPROVE_REPORT'&&!lostApproval){
      const response=await route.fetch();assert.equal(response.status(),200);lostApproval=request.postDataJSON();loseLookup=true;await route.abort('failed');return;
    }
    if(loseLookup&&request.method()==='GET'&&path.endsWith(`/actions/${lostApproval.actionId}`)){loseLookup=false;await route.abort('failed');return;}
    await route.continue();
  });
  await page.getByRole('button',{name:'Approve final report',exact:true}).click();await page.getByRole('button',{name:'Retry pending save',exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('.mc-review-nav span')?.textContent.includes('Save not confirmed'));
  const committed=await readView();assert(lostApproval);assert.equal(committed.approval.reportHash,lostApproval.action.reportHash);
  assert.equal(committed.approval.sourceHash,committed.card.contentHash);assert.equal(actions.filter(action=>action.type==='APPROVE_REPORT').length,1);
  await screenshot('approval-response-interrupted');await page.reload();
  await page.getByRole('heading',{name:'Defects & condition',exact:true}).waitFor({timeout:60000});await settled();
  await page.getByRole('button',{name:'Review draft report',exact:true}).click();await page.getByText('Report approved and saved.',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Approve final report',exact:true}).count(),0);
  const recovered=await readView();assert.deepEqual(recovered.approval,committed.approval);assert.equal(actions.filter(action=>action.type==='APPROVE_REPORT').length,1);
  checks.push('lost committed approval response and failed immediate lookup survive reload; exact approved report recovered with one approval dispatch');await screenshot('approved-report');
  await page.getByRole('button',{name:'Photos',exact:true}).click();await page.getByRole('button',{name:'Return to review',exact:true}).click();
  await page.getByRole('heading',{name:'Defects & condition',exact:true}).waitFor();await page.getByRole('button',{name:'Review draft report',exact:true}).click();
  await page.getByText('Report approved and saved.',{exact:true}).waitFor();await page.setViewportSize({width:390,height:844});await screenshot('mobile-approved-report');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));checks.push('Photos/review navigation retains approval; report has no horizontal overflow at 390 pixels');
  await context.storageState({path:join(evidence,'browser-storage-state.json')});
  assert.deepEqual(errors,[]);
  await writeFile(join(evidence,'browser-results.json'),JSON.stringify({status:'PASS',checks,errors,requests,imageRequests,actions,cardId,approval:{actionId:recovered.approval.actionId,reportHash:recovered.approval.reportHash,sourceHash:recovered.approval.sourceHash},at:new Date().toISOString()},null,2));
  console.log(JSON.stringify({checks,cardId}));
}catch(error){
  await screenshot('failure').catch(()=>{});await writeFile(join(evidence,'browser-failure.json'),JSON.stringify({error:String(error),errors,requests,imageRequests,actions,cardId,url:page.url(),text:(await page.locator('body').innerText()).slice(-8000)},null,2));throw error;
}finally{await browser.close();}
