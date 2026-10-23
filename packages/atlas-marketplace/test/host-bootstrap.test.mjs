import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,createHash} from 'node:crypto';
import {createServer,request} from 'node:http';
import {connect} from 'node:net';
import {mkdtemp,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {bootstrapFixture} from './host-bootstrap-fixtures.mjs';
import {createMarketplaceHostBootstrap} from '../src/host-bootstrap.mjs';
import {inspectMarketplaceReleaseManifest,inspectMarketplaceHostInputs} from '../src/release-readiness.mjs';
import {checkMarketplaceReleaseFile} from '../scripts/check-marketplace-release.mjs';

async function fetchNode(port,path,{method='GET',headers={},body}={}) {return new Promise((resolve,reject)=>{const req=request({host:'127.0.0.1',port,path,method,headers:{host:'atlasgrading.com',...headers}},res=>{const chunks=[];res.on('data',part=>chunks.push(part));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:JSON.parse(Buffer.concat(chunks).toString())}));});req.on('error',reject);req.end(body);});}
const signed=(f,event)=>{const rawBody=Buffer.from(JSON.stringify(event)),time=Math.floor(f.now/1000),signature=createHmac('sha256','whsec_isolated_platform_no_provider').update(`${time}.`).update(rawBody).digest('hex');return{rawBody,signature:`t=${time},v1=${signature}`};};

test('offline release inspection is bounded, actionable and redacted; complete metadata never supplies authority or starts runtime',async t=>{
  const f=await bootstrapFixture(),report=inspectMarketplaceHostInputs(f.bootstrapOptions);assert.equal(report.configurationComplete,true);assert.equal(report.productionReady,false);assert.equal(report.saleAuthorityAvailable,false);assert.ok(report.externalGates.every(row=>row.status==='EXTERNAL_VERIFICATION_REQUIRED'));
  const secret='sk_live_DO_NOT_ECHO_TEST_CANARY';const invalid={...f.bootstrapOptions.manifest,releaseRef:secret,unknown:secret};const refused=inspectMarketplaceReleaseManifest(invalid);assert.equal(refused.configurationComplete,false);assert.ok(refused.issues.some(row=>row.path==='manifest.releaseRef'));assert.ok(!JSON.stringify(refused).includes(secret));
  const missing=inspectMarketplaceHostInputs({enabled:true,manifest:f.bootstrapOptions.manifest});assert.ok(missing.issues.some(row=>row.path==='host.database.pool.connect'));assert.ok(missing.issues.some(row=>row.path==='finance.alertSender.lookup'));
  const noTax={...f.bootstrapOptions,finance:{...f.bootstrapOptions.finance,config:{...f.bootstrapOptions.finance.config,taxReporting:undefined}}};assert.ok(inspectMarketplaceHostInputs(noTax).issues.some(row=>row.code==='SEPARATELY_APPROVED_TAX_REPORTING_REQUIRED'));
  const pending={...f.bootstrapOptions,host:{...f.bootstrapOptions.host,marketplace:{...f.bootstrapOptions.host.marketplace,listingPolicy:{...f.bootstrapOptions.host.marketplace.listingPolicy,commercialTerms:{pendingDecisions:['RETURN_ELIGIBLE_REASONS','RETURN_SHIPPING_PAYER'],returns:{status:'DRAFT_INCOMPLETE'}}}}}};
  assert.ok(inspectMarketplaceHostInputs(pending).issues.some(row=>row.code==='COMMERCIAL_DECISIONS_PENDING'));
  assert.throws(()=>createMarketplaceHostBootstrap(pending),{code:'HOST_BOOTSTRAP_CONFIGURATION_REQUIRED'});
  const live=structuredClone(f.bootstrapOptions.manifest);live.environment='PRODUCTION';assert.equal(inspectMarketplaceReleaseManifest(live).configurationComplete,false);live.listeners.staff.port=8070;assert.ok(inspectMarketplaceReleaseManifest(live).issues.some(row=>row.code==='R1_SHARED_PORT_REFUSED'));
  const dir=await mkdtemp(join(tmpdir(),'atlas-release-check-'));t.after(()=>rm(dir,{recursive:true,force:true}));const path=join(dir,'manifest.json');await writeFile(path,JSON.stringify(f.bootstrapOptions.manifest));assert.equal((await checkMarketplaceReleaseFile(path)).configurationComplete,true);await symlink(path,join(dir,'link.json'));assert.equal((await checkMarketplaceReleaseFile(join(dir,'link.json'))).configurationComplete,false);await writeFile(path,secret);assert.ok(!JSON.stringify(await checkMarketplaceReleaseFile(path)).includes(secret));assert.equal((await checkMarketplaceReleaseFile('relative.json')).configurationComplete,false);
  assert.equal(f.connects,0);assert.equal(f.providerCalls,0);assert.equal(f.timerStarts,0);
});

test('default off is inert and prepare requires synchronous independent readiness plus actual dedicated database qualification',async()=>{
  const disabled=createMarketplaceHostBootstrap({manifest:new Proxy({},{get(){assert.fail('disabled manifest inspected');}})});assert.equal(disabled.status().phase,'DISABLED');await assert.rejects(disabled.start(),{code:'HOST_BOOTSTRAP_DISABLED'});await disabled.stop();
  const denied=await bootstrapFixture();denied.releaseReady=false;const blocked=createMarketplaceHostBootstrap(denied.bootstrapOptions);await assert.rejects(blocked.prepare(),{code:'HOST_RELEASE_UNQUALIFIED'});assert.equal(denied.connects,0);await blocked.stop();
  const asyncGate=await bootstrapFixture();asyncGate.bootstrapOptions.assertReleaseReady=async()=>{throw new Error('unqualified async gate');};const asynchronous=createMarketplaceHostBootstrap(asyncGate.bootstrapOptions);await assert.rejects(asynchronous.prepare(),{code:'HOST_RELEASE_UNQUALIFIED'});await asynchronous.stop();assert.equal(asyncGate.connects,0);
  const drift=await bootstrapFixture(),connect=drift.options.database.pool.connect;drift.options.database.pool.connect=async()=>{const client=await connect();const query=client.query;client.query=async(...args)=>{const result=await query(...args);if(args[0].startsWith('SELECT current_user AS role'))result.rows[0].rolsuper=true;return result;};return client;};const bad=createMarketplaceHostBootstrap(drift.bootstrapOptions);await assert.rejects(bad.prepare(),{code:'DATABASE_AUTHORITY_REFUSED'});assert.equal(bad.status().phase,'FAILED');assert.deepEqual(bad.status().listeners,{});assert.equal(drift.timerStarts,0);assert.equal(drift.providerCalls,0);await bad.stop();
});

test('owned listeners join canonical routes, original raw webhook retention and bounded finance lifecycle without provider effects',async t=>{
  const f=await bootstrapFixture();const raw=Buffer.from('unchanged raw request: { }\n');f.bootstrapOptions.existingHandlers.public=async(req,res)=>{assert.equal(req.url,'/grading-marker?original=1');assert.equal(req.rawBody,undefined);const chunks=[];for await(const chunk of req)chunks.push(chunk);f.fallback.push(req);res.end(JSON.stringify({hash:createHash('sha256').update(Buffer.concat(chunks)).digest('hex')}));};
  const host=createMarketplaceHostBootstrap(f.bootstrapOptions);t.after(()=>host.stop());assert.equal(f.connects,0);assert.equal(f.timerStarts,0);const prepared=await host.prepare();assert.equal(prepared.phase,'PREPARED');assert.ok(f.connects>0);assert.equal(f.providerCalls,0);assert.equal(f.timerStarts,0);assert.deepEqual(prepared.listeners,{});
  const [first,second]=await Promise.all([host.start(),host.start()]);assert.deepEqual(first.listeners,second.listeners);assert.equal(f.timerStarts,1);const ports=Object.fromEntries(Object.entries(first.listeners).map(([surface,row])=>[surface,row.port]));assert.equal(new Set(Object.values(ports)).size,3);
  const workspace=await fetchNode(ports.customer,'/account/marketplace/api/workspace',{headers:{cookie:f.cookie,'x-fixture-original-proof':'unchanged'}});assert.equal(workspace.status,200);assert.equal(workspace.body.scope.role,'BUYER');assert.equal(f.ingress[0].url,'/account/marketplace/api/workspace');
  const forwarded=await fetchNode(ports.public,'/grading-marker?original=1',{method:'POST',body:raw});assert.equal(forwarded.body.hash,createHash('sha256').update(raw).digest('hex'));
  const delivery=signed(f,{id:'evt_bootstrap_retained',object:'event',type:'balance.available',livemode:false,data:{object:{object:'balance'}}});const webhook=()=>fetchNode(ports.staff,'/admin/marketplace/api/provider/webhook',{method:'POST',body:delivery.rawBody,headers:{'stripe-signature':delivery.signature,'content-type':'application/json'}});
  assert.equal((await webhook()).status,200);assert.equal((await webhook()).status,200);const row=f.stateRow.document.financeWebhookIngress.evt_bootstrap_retained;assert.equal(row.status,'QUEUED');assert.equal(row.deliveryCount,2);assert.equal(row.rawHash,createHash('sha256').update(delivery.rawBody).digest('hex'));assert.equal(f.providerCalls,0);assert.equal(f.alertCalls,0);
  const before=f.connects;assert.equal((await fetchNode(ports.staff,'/admin/marketplace/api/provider/webhook',{method:'POST',body:delivery.rawBody,headers:{'stripe-signature':'invalid'}})).status,403);assert.equal(f.connects,before);assert.equal((await host.health()).finance.ingress.pending,1);
  f.releaseReady=false;assert.equal((await fetchNode(ports.customer,'/account/marketplace/api/workspace',{headers:{cookie:f.cookie,'x-fixture-original-proof':'unchanged'}})).status,503);assert.equal((await fetchNode(ports.public,'/grading-marker?original=1',{method:'POST',body:raw})).status,200);assert.equal(f.providerCalls,0);
  await Promise.all([host.stop(),host.stop()]);assert.equal(host.status().phase,'STOPPED');assert.equal(f.timerStops,1);assert.deepEqual(host.status().listeners,{});assert.throws(()=>host.start(),{code:'HOST_BOOTSTRAP_STOPPED'});
});

test('bind failure rolls back owned listeners and never takes over an existing port or starts recovery',async t=>{
  const occupied=createServer((_req,res)=>res.end('{}'));await new Promise(resolve=>occupied.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>occupied.close(resolve)));
  const f=await bootstrapFixture();f.bootstrapOptions.manifest.listeners.staff.port=occupied.address().port;const host=createMarketplaceHostBootstrap(f.bootstrapOptions);t.after(()=>host.stop());await assert.rejects(host.start(),{code:'EADDRINUSE'});assert.equal(host.status().phase,'FAILED');assert.deepEqual(host.status().listeners,{});assert.equal(f.timerStarts,0);assert.equal(f.providerCalls,0);assert.equal((await fetchNode(occupied.address().port,'/')).status,200);
});

test('stop during prepare joins the outstanding store read and admits no sockets, timers or abandoned writes',async()=>{
  const f=await bootstrapFixture();let release,entered;const gate=new Promise(resolve=>{release=resolve;}),observed=new Promise(resolve=>{entered=resolve;}),connect=f.options.database.pool.connect;f.options.database.pool.connect=async()=>{entered();await gate;return connect();};
  const host=createMarketplaceHostBootstrap(f.bootstrapOptions),starting=host.start();await observed;let stopped=false;const stopping=host.stop().then(()=>{stopped=true;});await new Promise(resolve=>setImmediate(resolve));assert.equal(stopped,false);release();await assert.rejects(starting,{code:'HOST_BOOTSTRAP_CHANGED'});await stopping;assert.equal(host.status().phase,'STOPPED');assert.deepEqual(host.status().listeners,{});assert.equal(f.timerStarts,0);assert.equal(f.providerCalls,0);assert.equal(f.queries.some(sql=>sql.startsWith('SELECT atlas_marketplace.commit_state')),false);
});

test('shutdown bounds a partial raw webhook upload, drains its handler and leaves no retained or financial action',async t=>{
  const f=await bootstrapFixture(),host=createMarketplaceHostBootstrap(f.bootstrapOptions);t.after(()=>host.stop());const started=await host.start();
  const socket=connect({host:'127.0.0.1',port:started.listeners.staff.port});socket.on('error',()=>{});await new Promise(resolve=>socket.once('connect',resolve));
  socket.write('POST /admin/marketplace/api/provider/webhook HTTP/1.1\r\nHost: atlasgrading.com\r\nContent-Type: application/json\r\nContent-Length: 1000\r\nStripe-Signature: deliberately-incomplete\r\n\r\n{');
  const until=Date.now()+500;while(host.status().activeHandlers===0&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,5));assert.equal(host.status().activeHandlers,1);
  const before=f.connects;await host.stop();assert.equal(host.status().phase,'STOPPED');assert.equal(host.status().activeHandlers,0);assert.equal(f.connects,before);assert.equal(f.stateRow.document.financeWebhookIngress,undefined);assert.equal(f.stateRow.document.journals.length,0);assert.equal(f.providerCalls,0);assert.equal(f.alertCalls,0);socket.destroy();
});
