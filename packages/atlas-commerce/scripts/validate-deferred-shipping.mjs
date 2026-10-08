/** Synthetic behavioral proof inside the nonce-owned disposable harness only. */
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash,createHmac} from 'node:crypto';
import {PrismaClient} from '../../../frontend/atlas-app/.generated/staff-database/index.js';
import {CustomerAuth} from '../../../frontend/atlas-customer/lib/server/auth.mjs';
import {CustomerDatabase} from '../../../frontend/atlas-customer/lib/server/database.mjs';
import {localConfig,fixtureProvider} from '../../../frontend/atlas-customer/lib/server/fixture.mjs';
import {CommerceService} from '../src/service.mjs';
import {GatewayCommerceRepository} from '../src/repository.mjs';
import {digest} from '../src/contract.mjs';
import {consumeStripeWebhook} from '../src/webhook.mjs';
import {shippingExternalId} from '../src/shipstation.mjs';
import {source,payment,tax} from '../test/fixtures.mjs';
import {shipStationPlan,testPackage} from '../test/shipstation-fixtures.mjs';
export async function qualifyDeferredShipping({fixture,Client,checks}) {
 assert(fixture.source.staffMigrations.some(m=>m.name==='20261008004000_atlas_deferred_shipping_payments'));
 const db=await fixture.database(),sql=(q,v=[])=>fixture.sql(q,v,db.name),prisma=new PrismaClient({datasources:{db:{url:db.customerUrl}}});
 try {
 const config=localConfig({databaseUrl:db.customerUrl,sessionKey:randomBytes(32),phoneKey:randomBytes(32)});
 await sql('INSERT INTO atlas_customer."CustomerControl"(enabled,mode,origin,"deploymentId","releaseSha","configHash") VALUES(true,$1,$2,$3,$4,$5)',Object.values(config.binding));
 const auth=new CustomerAuth({config,database:new CustomerDatabase(prisma,config),provider:fixtureProvider(config)}),boot=await auth.bootstrap(undefined,'deferred-fixture'),browser=`${config.cookies.browser}=${boot.browserToken}`;
 const challenge=await auth.send(browser,boot.csrf,{phone:'+12025550148',requestId:randomUUID()},'deferred-fixture');
 const signed=await auth.verify(browser,boot.csrf,{challengeId:challenge.challengeId,code:'424242'},'deferred-fixture');
 const cookie=`${browser}; ${config.cookies.session}=${signed.token}`,authority={...auth.authority(cookie,signed.csrf),binding:config.binding};
 const draft=randomUUID(),card=randomUUID(),profile=source('MAIL_IN').profile;
 await sql('INSERT INTO atlas_customer."CustomerVerifiedEmail"("accountId",email) VALUES($1,$2)',[signed.customer.id,profile.email]);
 await sql('INSERT INTO atlas_customer."CustomerIntakeDraft"(id,"accountId","requestId","inputHash","intakeMethod",state,"profileSnapshot") VALUES($1,$2,$3,$4,\'MAIL_IN\',\'REVIEW\',$5)',[draft,signed.customer.id,randomUUID(),'a'.repeat(64),JSON.stringify(profile)]);
 const identity={category:'POKEMON',title:'Synthetic deferred card',playerName:'',year:'',manufacturer:'',setName:'',cardNumber:'',parallel:'',insert:''};
 await sql('INSERT INTO atlas_customer."CustomerIntakeCard"(id,"draftId","requestId","pairId","inputHash",identity) VALUES($1,$2,$3,$4,$5,$6)',[card,draft,randomUUID(),randomUUID(),'b'.repeat(64),JSON.stringify(identity)]);
 for(const side of ['FRONT','BACK'])await sql('INSERT INTO atlas_customer."CustomerIntakeUpload"(id,"cardId",side,"fileName",plan,verification) VALUES($1,$2,$3,$4,\'{"synthetic":true}\',\'{"synthetic":true}\')',[randomUUID(),card,side,'synthetic.jpg']);
 const merchant=payment().binding,binding={configHash:'e'.repeat(64),merchant},terms={mailClockStart:'ATLAS_RECEIPT',mailChargedLegs:'BOTH_LEGS',shippingPayment:'SEPARATE_PAYMENT'};
 await sql('INSERT INTO atlas_customer."CommerceControl"(enabled,binding,merchant,terms,"shippingPlans") VALUES(true,$1,$2,$3,\'[]\')',[JSON.stringify(binding),JSON.stringify(merchant),JSON.stringify(terms)]);
 await sql('INSERT INTO atlas_customer."CustomerServiceControl"(enabled,binding,"identificationEnabled") VALUES(true,$1,false)',[JSON.stringify(config.binding)]);
 const raw=async(name,input,authValue=authority)=>(await sql('SELECT atlas_customer.customer_private_call(\'commerce\',$1::jsonb,$2::jsonb) result',[JSON.stringify(config.binding),JSON.stringify({name,providerBinding:binding,input:{...input,...(authValue?{authority:authValue}:{})}})])).rows[0].result;
 const call=async(name,input)=>{const result=await raw(name,input);assert(!result.error,JSON.stringify({name,error:result.error}));return result;};
 const repository=new GatewayCommerceRepository((name,input)=>name==='commerce_weekly_capacity'?sql('SELECT atlas_customer.weekly_capacity_snapshot() result').then(r=>r.rows[0].result):call(name,input));
 let creates=0,retrieveFail=false,lostCreate=false,status='succeeded';const intents=new Map();
 const payments={binding:merchant,publishableKey:'pk_test_fixture',async create(a){creates++;const providerId='pi_'+a.id.replaceAll('-','');intents.set(a.id,providerId);if(lostCreate)throw Error('synthetic lost acknowledgement');return{state:'AWAITING_PAYMENT',providerId,clientSecret:providerId+'_secret_fixture'};},async retrieve(a){if(retrieveFail)throw Error('synthetic eventually consistent');return{...await payment(status).retrieve(a),providerId:intents.get(a.id),clientSecret:intents.get(a.id)+'_secret_fixture'};}};
 const taxes={shippingConfigured:true,async calculate(i){return{...await tax.calculate(i),expiresAt:new Date(Date.now()+900000).toISOString()};},async calculateShipping(i){assert.deepEqual(i.lines,[]);assert.equal(i.subtotalCents,0);return this.calculate(i);}};
 const service=new CommerceService({repository,payment:payments,tax:taxes,terms});
 const grading=await service.quote({draftId:draft,expectedRevision:1});assert.equal(grading.shippingStatus,'UNQUOTED_UNPAID');assert.equal(grading.subtotalCents,4000);assert.equal(grading.totalCents,4800);assert.deepEqual(grading.shipping,[]);
 const original=(await sql('SELECT snapshot FROM atlas_customer."CommerceQuote" WHERE id=$1',[grading.id])).rows[0].snapshot;
 for(const change of [q=>q.shippingStatus='PAID',q=>q.shippingCents=1,q=>q.shippingPlan={},q=>q.terms.shippingPayment='UPFRONT',q=>delete q.terms.days]){const q=structuredClone(original);q.id=randomUUID();change(q);q.contentHash=digest(Object.fromEntries(Object.entries(q).filter(([k])=>k!=='contentHash')));assert((await raw('commerce_save_quote',{expectedRevision:1,quote:q})).error);}
 const graded=await service.pay({quoteId:grading.id,requestId:randomUUID()}),orderId=graded.order.id;assert.equal(graded.state,'PAID');assert.equal(graded.order.shippingPayment.state,'UNQUOTED_UNPAID');assert.equal(graded.order.shippingPayment.labelReadyEmailEnabled,true);
 const frozen=(await sql('SELECT to_jsonb(o) v FROM atlas_customer."CommerceOrder" o WHERE id=$1',[orderId])).rows[0].v;
 const capacity=(await sql('SELECT to_jsonb(r) v FROM atlas_customer."WeeklyCapacityReservation" r WHERE "paymentId"=$1',[graded.attemptId])).rows[0].v;
 assert.equal(capacity.cardCount,1);assert.equal(capacity.state,'ACCEPTED');
 let effects=(await sql('SELECT kind,request FROM atlas_customer."CommerceEffect" WHERE "orderId"=$1 ORDER BY kind',[orderId])).rows;assert.deepEqual(effects.map(e=>e.kind),['EMAIL_RECEIPT','TAX_TRANSACTION']);assert.equal(effects[0].request.shippingPayment,'SEPARATE_PAYMENT');
 assert((await service.shippingCheckout({orderId})).blockers.includes('SHIPPING_NOT_CONFIGURED'));
 const forged={...authority,browserHash:'0'.repeat(64)};assert((await raw('commerce_shipping_checkout',{orderId},forged)).error);assert((await raw('commerce_shipping_checkout',{orderId:randomUUID()})).error);
 checks.push('grading-only real SQL quote/payment:4000 percard plus actual synthetic tax, shipping explicitly UNQUOTED_UNPAID with no label; no carrier or measurements required; forged owner/session rejected, modified quote rejected; immutable grading order and exactly one ACCEPTED capacity reservation');
 const plan=shipStationPlan();await sql('UPDATE atlas_customer."CommerceControl" SET "shippingPlans"=$1',[JSON.stringify([plan])]);
 const pdf=Buffer.from('%PDF-1.7\nSYNTHETIC DEFERRED\n%%EOF'),labelHash=createHash('sha256').update(pdf).digest('hex');let quotes=0,labels=0,reads=0,lostLabel=true;
 const label=(request,effectId,rate)=>({provider:'SHIPSTATION',providerId:'se-label-1',externalShipmentId:shippingExternalId(effectId),shipmentId:rate.shipmentId,carrierId:rate.carrierId,serviceCode:rate.serviceCode,carrierName:rate.carrierName,serviceName:rate.serviceName,purchasedRateId:rate.providerId,purchasedAmountCents:rate.amountCents,currency:'usd',trackingNumber:'1ZSYNTHETIC',labelBase64:pdf.toString('base64'),labelSha256:labelHash,mimeType:'application/pdf'});
 service.carrier={provider:'SHIPSTATION',async quote(request){quotes++;return{provider:'SHIPSTATION',providerId:'se-rate-'+quotes,shipmentId:'se-shipment-'+quotes,carrierId:request.shipment.carrier_id,serviceCode:request.shipment.service_code,carrierName:'UPS',serviceName:'UPS Ground',amountCents:1250,currency:'usd',requestHash:digest(request),expiresAt:new Date(Date.now()+900000).toISOString()};},async createLabel(...a){labels++;if(lostLabel)throw Error('synthetic lost paid label reply');return label(...a);},async retrieveLabel(...a){reads++;return label(...a);}};
 const quote=await service.shippingQuote({orderId,packingPresetId:plan.packingPresetId,shippingServiceCode:plan.shippingServiceCode,inboundPackage:testPackage});assert.equal(quote.purpose,'SHIPPING');assert.equal(quote.subtotalCents,0);assert.equal(quote.shippingCents,2500);assert.equal(quote.totalCents,3300);assert.equal(quotes,2);assert.equal(creates,1);assert.equal(labels,0);
 const saved=(await sql('SELECT snapshot FROM atlas_customer."CommerceShippingQuote" WHERE id=$1',[quote.id])).rows[0].snapshot;
 for(const change of [q=>q.orderId=randomUUID(),q=>q.shipping[0].request.shipment.ship_from.name='foreign',q=>q.cards[0].unitCents=1,q=>q.subtotalCents=4000,q=>q.tax.requestHash='f'.repeat(64)]){const q=structuredClone(saved);q.id=randomUUID();change(q);q.contentHash=digest(Object.fromEntries(Object.entries(q).filter(([k])=>k!=='contentHash')));assert((await raw('commerce_shipping_save_quote',{orderId,quote:q})).error);}
 lostCreate=true;retrieveFail=true;
 const pending=await service.shippingPay({orderId,quoteId:quote.id,requestId:randomUUID()});assert.equal(pending.state,'UNKNOWN');
 const attempts=await Promise.all(Array.from({length:8},()=>service.shippingPay({orderId,quoteId:quote.id,requestId:randomUUID()})));assert(attempts.every(a=>a.attemptId===pending.attemptId));assert.equal(creates,2);assert.equal(labels,0);
 const savedCarrier=service.carrier;service.carrier=null;service.tax={};await sql('UPDATE atlas_customer."CommerceControl" SET "shippingPlans"=\'[]\'');
 const recovered=await service.shippingCheckout({orderId});assert.equal(recovered.activePayment.attemptId,pending.attemptId);assert.equal(recovered.activePayment.state,'UNKNOWN');
 retrieveFail=false;status='requires_payment_method';const awaiting=await service.shippingReconcile({orderId,attemptId:pending.attemptId});assert.equal(awaiting.state,'AWAITING_PAYMENT');assert.match(awaiting.clientSecret,/_secret_fixture$/);
 status='succeeded';const event={id:'evt_deferred_fixture',type:'payment_intent.succeeded',livemode:false,data:{object:{id:intents.get(pending.attemptId),metadata:{atlas_attempt:pending.attemptId}}}},rawBody=Buffer.from(JSON.stringify(event)),secret='whsec_deferred_fixture',stamp=Math.floor(Date.now()/1000),signature=`t=${stamp},v1=${createHmac('sha256',secret).update(`${stamp}.`).update(rawBody).digest('hex')}`;
 for(let i=0;i<2;i++)assert.equal((await consumeStripeWebhook({rawBody,signature,secret,payment:payments,repository})).orderId,orderId);
 const done=await service.shippingReconcile({orderId,attemptId:pending.attemptId});assert.equal(done.order.shippingPayment.state,'PAID');assert.equal(done.order.shippingPayment.receipt.totalCents,3300);assert.equal(done.order.receipt.totalCents,4800);assert.equal(done.order.shippingPayment.labelReadyEmailEnabled,true);
 assert.equal((await sql('SELECT count(*)::int n FROM atlas_customer."CommerceShippingReceipt" WHERE "orderId"=$1',[orderId])).rows[0].n,1);
 assert.equal((await sql('SELECT count(*)::int n FROM atlas_customer."CommerceShippingProviderEvent" WHERE "paymentId"=$1',[pending.attemptId])).rows[0].n,1);
 assert.equal((await sql('SELECT count(*)::int n FROM atlas_customer."WeeklyCapacityReservation" WHERE "paymentId"=$1',[pending.attemptId])).rows[0].n,0);
 assert.deepEqual((await sql('SELECT to_jsonb(o) v FROM atlas_customer."CommerceOrder" o WHERE id=$1',[orderId])).rows[0].v,frozen);
 assert.deepEqual((await sql('SELECT to_jsonb(r) v FROM atlas_customer."WeeklyCapacityReservation" r WHERE "paymentId"=$1',[graded.attemptId])).rows[0].v,capacity);
 checks.push('separate shipping payment: saved actual two-leg quote plus shipping-only tax, explicit second payment,8 concurrent retries and UNKNOWN recovery dispatch once; carrier/config loss does not prevent original intent recovery; same Stripe webhook reconciles twice to one shipping receipt/event; original grading invoice and sole capacity reservation byte-identical');
 service.carrier=savedCarrier;service.tax=taxes;const inbound=orderId+':shipstation:INBOUND:v1',ret=orderId+':shipstation:RETURN:v1';
 assert(!(await call('commerce_pending_effects',{})).effects.includes(ret));await assert.rejects(service.runEffect(ret),/RETURN_LABEL_NOT_PREPARED/);
 const malformedId=orderId+':legacy-missing-leg';await sql('INSERT INTO atlas_customer."CommerceEffect"(id,"orderId",kind,request) VALUES($1,$2,\'FEDEX_LABEL\',\'{"historicalFixture":true}\')',[malformedId,orderId]);
 await sql('UPDATE atlas_customer."CommerceEffect" SET state=\'SUCCEEDED\',"claimId"=$1,result=$2 WHERE id=$3',[randomUUID(),JSON.stringify({trackingNumber:'SYNTHETIC-MISSING-LEG',mimeType:'application/pdf',labelBase64:pdf.toString('base64'),labelSha256:labelHash}),malformedId]);
 assert.equal((await sql('SELECT count(*)::int n FROM atlas_customer."CommerceEffect" WHERE "orderId"=$1 AND kind=\'EMAIL_LABEL_READY\'',[orderId])).rows[0].n,0,'A label without an explicit INBOUND leg must never notify');
 assert.equal((await service.runEffect(inbound)).state,'UNKNOWN');assert.equal((await sql('SELECT count(*)::int n FROM atlas_customer."CommerceEffect" WHERE "orderId"=$1 AND kind=\'EMAIL_LABEL_READY\'',[orderId])).rows[0].n,0);
 assert.equal((await service.reconcileEffect(inbound)).state,'SUCCEEDED');await service.reconcileEffect(inbound);await service.runEffect(inbound);assert.equal(labels,1);assert.equal(reads,1);
 const ready=(await sql('SELECT * FROM atlas_customer."CommerceEffect" WHERE "orderId"=$1 AND kind=\'EMAIL_LABEL_READY\'',[orderId])).rows;assert.equal(ready.length,1);assert.equal(ready[0].request.to,profile.email);assert.equal(ready[0].request.labelSha256,labelHash);
 let emails=0;service.notifications={canSend:k=>k==='EMAIL_LABEL_READY',async send(){emails++;return{provider:'SENDGRID',providerId:'synthetic-label-ready',deliveryStatus:'ACCEPTED'};}};await service.runEffect(ready[0].id);await service.runEffect(ready[0].id);assert.equal(emails,1);
 const view=await repository.order(orderId);assert(view.effects.some(e=>e.kind==='EMAIL_LABEL_READY'&&e.state==='SUCCEEDED'));assert(!JSON.stringify(view).includes('labelBase64'));assert(!JSON.stringify(view).includes('profile'));assert(!JSON.stringify(view).includes('clientSecret'));
 checks.push('label-ready email: no outbox at grading/shipping payment or UNKNOWN label; exact read-only same-label reconciliation validates PDF then inserts exactly one email effect atomically; replay neither repurchases nor resends; saved inbound PDF remains private; return stays unprepared until actual staff readiness');
 for(const table of ['CommerceShippingQuote','CommerceShippingReceipt','CommerceShippingProviderEvent','CommerceShippingPayment'])for(const command of [`DELETE FROM atlas_customer."${table}"`,`TRUNCATE atlas_customer."${table}"`])await assert.rejects(sql(command));
 const restricted=new Client({connectionString:db.customerUrl});await restricted.connect();try{for(const table of ['CommerceShippingQuote','CommerceShippingReceipt','CommerceShippingProviderEvent','CommerceShippingPayment'])await assert.rejects(restricted.query(`SELECT * FROM atlas_customer."${table}"`),{code:'42501'});await assert.rejects(restricted.query("SELECT atlas_customer.commerce_shipping_call('commerce_shipping_checkout','{}','{}')"),{code:'42501'});}finally{await restricted.end();}
 checks.push('new shipping ledgers immutable/no-truncate, new helpers owner-only, customer base role denied tables and provider gateway; authenticated private service uses explicit new allowlist only; historical ledger and callback paths retained');
 } finally {await prisma.$disconnect();}
}
