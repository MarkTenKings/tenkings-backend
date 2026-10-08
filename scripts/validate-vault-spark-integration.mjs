import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { startSyntheticSparkServer } from "./vault-synthetic-spark-server.mjs";
import { startVaultNextTestServer } from "./vault-next-test-server.mjs";
import { createSparkIntegrationFixture, syntheticBinding, seedSyntheticAdministrator, until, delay } from "./vault-spark-integration-fixture.mjs";

assert.equal(process.env.AI_GRADER_NFC_DISPOSABLE_VALIDATION,"1","Disposable database acknowledgment required");
assert.equal(process.env.VAULT_SYNTHETIC_SPARK_VALIDATION,"1","Synthetic Spark acknowledgment required");
assert.equal(process.versions.node.split(".")[0],"20");
const target=new URL(process.env.DATABASE_URL??"invalid:");
assert.equal(target.protocol,"postgresql:");assert.equal(target.hostname,"127.0.0.1");assert.equal(target.username,"tenkings_nfc_validation");assert.equal(target.pathname,"/tenkings_ai_grader_nfc_validation");
const require=createRequire(import.meta.url), {prisma}=require("../packages/database");
const {chromium}=require("../frontend/vault-kiosk/node_modules/playwright");
const output=resolve(process.env.VAULT_SPARK_EVIDENCE_DIR??"outputs/vault-spark-integration");mkdirSync(output,{recursive:true});
const results=[], fixtures=[], errors=[];
const check=(label,value,expected)=>{assert.deepEqual(value,expected,label);results.push(label);};
const scenario=(label)=>console.log(`SPARK integration: ${label}`);
const bindings=Array.from({length:9},(_,i)=>syntheticBinding(i+1));
const administrator=await seedSyntheticAdministrator(prisma);
const provider=await startSyntheticSparkServer(bindings),secret=`synthetic_${randomBytes(32).toString("base64url")}`;
let next,browser;
const saleRow=(fixture,id)=>fixture.store.one("SELECT * FROM sale WHERE sale_id=?",id);
const paidCommands=(fixture)=>Number(fixture.store.one("SELECT count(*) AS count FROM command_intent WHERE authority='PAID_SALE'").count);
const providerCalls=(fixture,method)=>provider.calls.filter(call=>call.machineId===fixture.binding.machineId&&call.method===method).length;
async function fixture(label,index){const f=await createSparkIntegrationFixture({prisma,binding:bindings[index],provider,cloudOrigin:next.url,label,administrator});fixtures.push(f);return f;}
async function browserPage(f,{admin=false}={}){
  const context=await browser.newContext({viewport:{width:720,height:1280},reducedMotion:"reduce"});const page=await context.newPage();
  page.on("pageerror",error=>errors.push(error.message));
  await context.route("**/*",route=>[f.origin,next.url].includes(new URL(route.request().url()).origin)?route.continue():route.abort());
  if(admin)await page.addInitScript(session=>localStorage.setItem("tenkings.session",JSON.stringify(session)),administrator.session);
  await page.goto(admin?`${next.url}/admin/vault`:f.origin);return {context,page};
}
async function callback(f,sale,patch={},kind="TransactionCallback"){const receipt=provider.callback(sale.provider_session_id,patch,kind);const response=await provider.sendCallback(receipt,kind);check(`${f.label} callback HTTP`,response.status,200);return receipt;}
async function adminApi(path,body){const r=await fetch(`${next.url}/api/vault/v1/admin/${path}`,{method:body===undefined?"GET":"POST",headers:{Authorization:`Bearer ${administrator.token}`,"X-Vault-Contract-Version":"1","Content-Type":"application/json","X-Vault-Action-Reason":"Synthetic full-path verification"},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,body:await r.json()};}

try {
  next=await startVaultNextTestServer(process.env.DATABASE_URL,{bindings,callbackSecret:secret,ownerAdminUserId:administrator.id});provider.configureCallbacks(next.url,secret);
  browser=await chromium.launch({headless:true,...(process.platform==="darwin"?{channel:"chrome"}:{})});
  scenario("browser shopping, pending refresh, acquiring capture and single retry");
  const happy=await fixture("browser-success",0), kiosk=await browserPage(happy);
  await kiosk.page.locator('.door-cell[data-door-id="door-0001"]').waitFor();
  for(const [width,height] of [[720,1280],[1080,1920]]){
    await kiosk.page.setViewportSize({width,height});
    const geometry=await kiosk.page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth,doors:[...document.querySelectorAll('.door-cell')].map(el=>{const r=el.getBoundingClientRect();return [r.width,r.height];}),checkout:document.querySelector('.checkout-action').getBoundingClientRect().height}));
    assert.ok(geometry.width<=width&&geometry.doors.every(([w,h])=>w>=44&&h>=44)&&geometry.checkout>=56,JSON.stringify(geometry));results.push(`real browser ${width}x${height} portrait target/overflow`);
  }
  await kiosk.page.setViewportSize({width:720,height:1280});
  await kiosk.page.locator('.door-cell[data-door-id="door-0001"]').click();await kiosk.page.locator('.checkout-action').click();
  await until(()=>happy.store.maybeOne("SELECT * FROM sale WHERE provider_session_id IS NOT NULL"),"browser begins exactly one provider session");
  const sale=happy.store.one("SELECT * FROM sale");
  await kiosk.page.locator('.payment-unresolved').waitFor();await kiosk.page.reload();await kiosk.page.locator('.payment-unresolved').waitFor();
  check("pending reload keeps one TriggerTransaction",providerCalls(happy,"TriggerTransaction"),1);check("pending has no paid command",paidCommands(happy),0);
  await kiosk.page.screenshot({path:resolve(output,"01-pending.png"),fullPage:true});
  const good=await callback(happy,sale);await happy.cycle();await kiosk.page.getByText("Paid total",{exact:true}).waitFor();
  check("capture settles local sale",saleRow(happy,sale.sale_id).payment_state,"SETTLED");check("capture dispatches one exact initial command",paidCommands(happy),1);
  await kiosk.page.getByRole("button",{name:"OPEN DOORS",exact:true}).click();await kiosk.page.locator('.retry-action').waitFor({state:"detached"});
  check("one browser retry creates one additional paid command",paidCommands(happy),2);
  await kiosk.page.screenshot({path:resolve(output,"02-paid.png"),fullPage:true});
  await kiosk.page.getByRole("button",{name:"I GOT MY PACKS — DONE",exact:true}).click();await happy.cycle();
  check("exact int64 provider identity survives cloud evidence",provider.sessions.get(sale.provider_session_id).nayaxId,"9007199254740993");
  const projected=await prisma.vaultSale.findUniqueOrThrow({where:{id:sale.sale_id},include:{items:true}});
  check("cloud capture projected",projected.paymentState,"SETTLED");check("cloud single retry projected",projected.items[0].retryCommandState,"ACCEPTED");assert.ok(projected.customerDoneAt);results.push("customer Done persisted in real PostgreSQL");

  scenario("fresh human Admin browser full-sale void");
  const admin=await browserPage(happy,{admin:true});await admin.page.getByRole("heading",{name:"Vault Control",exact:true}).waitFor();
  await admin.page.getByRole("combobox").first().selectOption(happy.binding.machineId);
  await admin.page.getByLabel("Action reason (8–500 characters)").fill("Synthetic full paid-sale void verification");
  await admin.page.getByRole("button",{name:"sales",exact:true}).click();await admin.page.getByLabel("Include certification",{exact:true}).check();await admin.page.getByRole("button",{name:"Load records",exact:true}).click();
  const article=admin.page.locator("article").filter({has:admin.page.getByRole("heading",{name:projected.supportReference,exact:true})});await article.waitFor();
  await article.getByLabel(`Type VOID ${projected.supportReference} ${projected.totalCents} to confirm the exact sale and amount in cents`).fill(`VOID ${projected.supportReference} ${projected.totalCents}`);
  await article.getByRole("button",{name:"Approve full-sale void",exact:true}).click();await admin.page.getByText("Approve full-sale void completed.",{exact:true}).waitFor();
  // Explicit fixture-only technical hold models a restored/quarantined machine.
  // A still-fresh human approval must not create a provider effect through it.
  happy.store.run("UPDATE machine_meta SET automation_halted=1,recovery_required=1 WHERE singleton=1");await happy.cycle();await happy.cycle();
  check("technical recovery hold blocks actual void HTTP transport",providerCalls(happy,"CancelTransaction"),0);
  check("technical recovery hold prevents a new void intent",Number(happy.store.one("SELECT count(*) AS count FROM payment_void").count),0);
  check("financial polling preserves technical recovery flags",{...happy.store.one("SELECT automation_halted,recovery_required FROM machine_meta")},{automation_halted:1,recovery_required:1});
  happy.store.run("UPDATE machine_meta SET automation_halted=0,recovery_required=0 WHERE singleton=1");
  await happy.cycle();await happy.cycle();const action=await prisma.vaultPaymentAction.findFirstOrThrow({where:{originalSaleId:sale.sale_id}});
  check("human-approved full void reaches confirmed cloud outcome",action.state,"VOIDED");check("full void calls provider once",providerCalls(happy,"CancelTransaction"),1);
  const approvalReplay={actionId:action.id,saleId:sale.sale_id,amountCents:projected.totalCents,reason:action.action.reason,confirmFullSaleVoid:true};
  check("parallel approval retries preserve same immutable action",(await Promise.all(Array.from({length:4},()=>adminApi("payment-actions",approvalReplay)))).map(r=>r.status),[201,201,201,201]);
  check("approval retries never create another action",await prisma.vaultPaymentAction.count({where:{originalSaleId:sale.sale_id}}),1);
  check("approval identity rejects changed amount",(await adminApi("payment-actions",{...approvalReplay,amountCents:projected.totalCents+1})).status,409);check("void preserves exact paid door commands",paidCommands(happy),2);
  await happy.restart();await happy.cycle();check("void remains once after process restart",providerCalls(happy,"CancelTransaction"),1);
  await admin.page.screenshot({path:resolve(output,"03-admin-void.png"),fullPage:true});await admin.context.close();await kiosk.context.close();

  scenario("callback retries, invalid authority and conflicting post-fulfillment evidence");
  const countBefore=await prisma.vaultSparkObservation.count({where:{machineId:happy.binding.machineId}});
  const duplicate=await Promise.all(Array.from({length:8},()=>provider.sendCallback(good)));check("parallel callback retries all accepted",duplicate.map(r=>r.status),Array(8).fill(200));check("parallel callback retries persist one receipt",await prisma.vaultSparkObservation.count({where:{machineId:happy.binding.machineId}}),countBefore);
  check("invalid callback secret rejected",(await provider.sendCallback(good,"TransactionCallback",{secret:"synthetic_wrong"})).status,401);
  check("duplicate JSON keys rejected",(await provider.sendCallback(good,"TransactionCallback",{raw:'{"SparkTransactionId":"a","SparkTransactionId":"b"}'})).status,400);
  check("wrong binding rejected",(await provider.sendCallback({...good,HwSerial:"SYNTHETIC-WRONG"})).status,422);
  await callback(happy,sale,{AuthStatus:{Verdict:"Declined",ErrorCode:44}});await happy.cycle();
  check("conflict never reopens fulfilled doors",paidCommands(happy),2);assert.ok(happy.machine.paymentOperations.recovery.held());results.push("conflicting post-capture evidence holds financial automation");

  scenario("minimal documented decline and browser return");
  const decline=await fixture("decline",1), declined=await decline.start(), declinePage=await browserPage(decline);await callback(decline,declined,{},"DeclineCallback");await decline.cycle();
  check("minimal decline releases unpaid reservation",saleRow(decline,declined.sale_id).payment_state,"DECLINED");check("decline dispatches no paid command",paidCommands(decline),0);
  await declinePage.page.getByRole("button",{name:"Return to shopping",exact:true}).click();await declinePage.page.locator('.door-cell').first().waitFor();await declinePage.context.close();

  scenario("wrong amount and unsupported payment method fail closed");
  const amount=await fixture("wrong-amount",2), amountSale=await amount.start();await callback(amount,amountSale,{Amount:1});await amount.cycle();
  check("amount mismatch has zero paid commands",paidCommands(amount),0);assert.notEqual(saleRow(amount,amountSale.sale_id).payment_state,"SETTLED");results.push("wrong amount never becomes durable capture");
  const method=await fixture("unsupported-method",3), methodSale=await method.start();await callback(method,methodSale,{CardBrand:"SMC",CardUID:"123456"});await method.cycle();
  check("unsupported method has zero paid commands",paidCommands(method),0);assert.notEqual(saleRow(method,methodSale.sale_id).payment_state,"SETTLED");results.push("unsupported method never becomes durable capture");

  scenario("cloud outage, missing callback, restart and late exact callback");
  const outage=await fixture("outage-restart",4), late=await outage.start();outage.outage(true);await assert.rejects(()=>outage.runtime.synchronize());await outage.runtime.tickLocal();check("outage cannot authorize a paid command",paidCommands(outage),0);
  outage.outage(false);await outage.restart();await outage.cycle();const restartPage=await browserPage(outage);await restartPage.page.locator(".payment-unresolved").waitFor();check("restarted browser offers no new payment",await restartPage.page.locator(".checkout-action,.payment-continue-action").count(),0);await restartPage.context.close();check("pending restart cannot retrigger payment",providerCalls(outage,"TriggerTransaction"),1);
  await callback(outage,late);await outage.cycle();check("late exact callback settles same original sale",saleRow(outage,late.sale_id).payment_state,"SETTLED");check("late callback sends original paid door once",paidCommands(outage),1);await outage.done(late.sale_id);
  const missing=await fixture("missing-callback",5), missingSale=await missing.start();missing.advance(70000);await missing.cycle();
  check("missing callback leaves zero paid commands",paidCommands(missing),0);assert.notEqual(saleRow(missing,missingSale.sale_id).payment_state,"SETTLED");
  const missingPage=await browserPage(missing);await missingPage.page.locator('.payment-unresolved').waitFor();check("uncertain payment has no retry or new-payment action",await missingPage.page.locator('.retry-action,.payment-continue-action,.checkout-action').count(),0);await missingPage.page.screenshot({path:resolve(output,"04-missing-callback.png"),fullPage:true});await missingPage.context.close();results.push("real missing-callback browser offers no repeated payment");

  scenario("uncertain wire response survives restart without authentication replay");
  const disconnect=await fixture("wire-disconnect",6);provider.failNext("disconnect");const lost=await disconnect.start();check("disconnect has no paid commands",paidCommands(disconnect),0);await disconnect.restart();await disconnect.cycle();check("uncertain authentication is never repeated",providerCalls(disconnect,"StartAuthentication"),1);check("uncertain authentication never triggers",providerCalls(disconnect,"TriggerTransaction"),0);assert.notEqual(saleRow(disconnect,lost.sale_id).payment_state,"SETTLED");

  scenario("uncertain void and exact external human review through real Admin browser");
  const review=await fixture("uncertain-void-review",7), reviewSale=await review.start();await callback(review,reviewSale);await review.cycle();await review.done(reviewSale.sale_id);
  const uncertainId=randomUUID();check("uncertain-void approval created",(await adminApi("payment-actions",{actionId:uncertainId,saleId:reviewSale.sale_id,amountCents:reviewSale.total_cents,reason:"Synthetic uncertain-wire review",confirmFullSaleVoid:true})).status,201);
  provider.failNext("disconnect");await review.cycle();await review.cycle();
  check("lost void response remains UNKNOWN",(await prisma.vaultPaymentAction.findUniqueOrThrow({where:{id:uncertainId}})).state,"UNKNOWN");assert.ok(review.machine.paymentOperations.recovery.held());results.push("uncertain void holds financial automation");
  const reviewEvidence=await adminApi(`financial-recovery?machineId=${review.binding.machineId}`);check("real recovery snapshot has no technical blockers",reviewEvidence.body.snapshot.blockers,[]);
  const reviewPage=await browserPage(review,{admin:true});await reviewPage.page.getByRole("combobox").first().selectOption(review.binding.machineId);
  await reviewPage.page.getByLabel("Action reason (8–500 characters)").fill("Synthetic external evidence review; no monetary confirmation");await reviewPage.page.getByRole("button",{name:"financial recovery",exact:true}).click();await reviewPage.page.getByRole("button",{name:"Load current evidence",exact:true}).click();
  await reviewPage.page.getByLabel("External review evidence reference (no card details or credentials)").fill("synthetic-reviewed-wire-ledger");await reviewPage.page.getByLabel("Reviewed evidence SHA-256").fill("b".repeat(64));await reviewPage.page.getByLabel(`Type REVIEW ${reviewEvidence.body.snapshot.generation} after reviewing every listed notice and uncertain action`).fill(`REVIEW ${reviewEvidence.body.snapshot.generation}`);
  await reviewPage.page.getByRole("button",{name:"Approve this evidence for machine verification",exact:true}).click();await reviewPage.page.getByText("Approve exact financial review completed.",{exact:true}).waitFor();
  await review.cycle();await review.cycle();const reviewed=await prisma.vaultPaymentAction.findUniqueOrThrow({where:{id:uncertainId}});
  check("external review preserves original UNKNOWN action",[reviewed.id,reviewed.state],[uncertainId,"UNKNOWN"]);assert.ok(reviewed.externalReviewedAt);check("exact human review clears only the financial hold",review.machine.paymentOperations.recovery.held(),false);
  check("human review does not confirm compensation",reviewed.externalReview.verifiedFinancialAdjustmentCents,0);check("human review cannot dispatch more paid commands",paidCommands(review),1);
  await review.restart();await review.cycle();check("externally reviewed UNKNOWN action never repeats provider transport",providerCalls(review,"CancelTransaction"),1);
  await reviewPage.page.getByRole("button",{name:"Load current evidence",exact:true}).click();await reviewPage.page.getByText("Externally reviewed uncertain actions retain their original IDs and UNKNOWN financial outcomes. Their automated retries are permanently stopped.",{exact:true}).waitFor();await reviewPage.page.screenshot({path:resolve(output,"05-external-review.png"),fullPage:true});await reviewPage.context.close();

  scenario("expired unstarted approval, durable retirement proof and fresh replacement approval");
  const expired=await fixture("expired-unstarted",8), expiredSale=await expired.start();await callback(expired,expiredSale);await expired.cycle();await expired.done(expiredSale.sale_id);
  const expiredId=randomUUID(), expireInput={actionId:expiredId,saleId:expiredSale.sale_id,amountCents:expiredSale.total_cents,reason:"Synthetic expiry before provider intent",confirmFullSaleVoid:true};check("unstarted approval created",(await adminApi("payment-actions",expireInput)).status,201);
  // The explicit local fixture clock stays just inside the real cloud skew bound;
  // elapsed wall time crosses the five-minute action expiry without altering rows.
  expired.advance(299900);await delay(250);await expired.cycle();await expired.cycle();
  const retired=await prisma.vaultPaymentAction.findUniqueOrThrow({where:{id:expiredId}});check("expired approval retired only after machine proof",retired.state,"RETIRED_UNSTARTED");check("retirement releases active sale ownership and retains original",[retired.saleId,retired.originalSaleId],[null,expiredSale.sale_id]);check("retirement never calls provider cancellation",providerCalls(expired,"CancelTransaction"),0);
  check("retirement proof binds absent local and provider intent",[retired.retirementProof.mainIntentAbsent,retired.retirementProof.providerIntentAbsent,retired.retirementProof.providerTransportAbsent],[true,true,true]);
  const replacementId=randomUUID();check("replacement requires fresh distinct approval",(await adminApi("payment-actions",{...expireInput,actionId:replacementId})).status,201);check("retired and replacement authorities both retained",await prisma.vaultPaymentAction.count({where:{originalSaleId:expiredSale.sale_id}}),2);

  scenario("PostgreSQL retained authority and terminal-state immutability");
  await assert.rejects(()=>prisma.vaultPaymentAction.update({where:{id:action.id},data:{originalSaleId:randomUUID()}}),/immutable/i);results.push("real PostgreSQL rejects mutation of confirmed action authority");
  await assert.rejects(()=>prisma.vaultFinancialRecoveryDecision.update({where:{id:reviewed.externalReview.decisionId},data:{state:"APPROVED"}}),/immutable/i);results.push("real PostgreSQL rejects reactivation of applied human decision");
  await assert.rejects(()=>prisma.vaultPaymentAction.update({where:{id:retired.id},data:{state:"APPROVED",saleId:expiredSale.sale_id}}),/immutable/i);results.push("real PostgreSQL rejects reactivation of retired action");

  scenario("PostgreSQL commit-order cursor and per-machine concurrent lock");
  let release,locked;const gate=new Promise(r=>release=r),lockReady=new Promise(r=>locked=r);
  const transaction=prisma.$transaction(async tx=>{await tx.$queryRawUnsafe("SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended($1,0))",happy.binding.machineId);locked();await gate;},{timeout:20000});await lockReady;
  const blockedId=randomUUID(),independentId=randomUUID();let completed=false;
  const blocked=provider.sendCallback({...good,SparkTransactionId:blockedId}).then(result=>{completed=true;return result;});
  await delay(200);check("same-machine callback waits for existing transaction",completed,false);
  const other=provider.callback(declined.provider_session_id,{SparkTransactionId:independentId});check("other machine callback commits while first is locked",(await provider.sendCallback(other)).status,200);
  check("locked receipt is not visible ahead of commit",await prisma.vaultSparkObservation.count({where:{sparkTransactionId:blockedId}}),0);release();await transaction;check("waiting callback commits after release",(await blocked).status,200);
  const ordered=await prisma.vaultSparkObservation.findMany({where:{sparkTransactionId:{in:[blockedId,independentId]}}});assert.ok(ordered.find(r=>r.sparkTransactionId===blockedId).receiptSequence>ordered.find(r=>r.sparkTransactionId===independentId).receiptSequence);results.push("receipt allocation follows same-machine lock, cannot skip an uncommitted earlier receipt");
  const feed=await happy.cloud.sparkReceipts("0");assert.ok(feed.observations.some(r=>r.sparkTransactionId===blockedId));results.push("real authenticated receipt feed returns committed locked callback");
  check("synthetic peer verified all real wire requests",provider.errors,[]);check("real browser has no uncaught runtime errors",errors,[]);
  for(const name of readdirSync(output))if(/^failure-\d+\.png$/.test(name))unlinkSync(resolve(output,name));
  const evidence={syntheticOnly:true,createdAt:new Date().toISOString(),checks:results.length,results,providerCalls:provider.calls.map(({method,signatureProfile})=>({method,signatureProfile})),machineCount:fixtures.length,browser:"real Chromium, no mocked API responses",database:"real disposable PostgreSQL",externalPaymentCalls:0};writeFileSync(resolve(output,"evidence.json"),JSON.stringify(evidence,null,2)+"\n");console.log(JSON.stringify({result:"PASS",checks:results.length,machines:fixtures.length,providerWireCalls:provider.calls.length,evidence:output}));
} catch(error) {
  if(browser)for(const [index,page] of browser.contexts().flatMap(context=>context.pages()).entries()){await page.screenshot({path:resolve(output,`failure-${index}.png`),fullPage:true}).catch(()=>{});console.error("Synthetic browser failure state",(await page.locator("body").innerText().catch(()=>"unavailable")).slice(-1800));}
  console.error("Synthetic runtime codes",fixtures.map(f=>({scenario:f.label,codes:f.errors})));throw error;
} finally {
  await browser?.close();for(const fixture of fixtures.reverse())await fixture.close();await next?.close();await provider.close();await prisma.$disconnect();
}
