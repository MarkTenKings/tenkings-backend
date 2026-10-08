import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Actual checkout/receipt components and CSS with entirely local synthetic replies.
// All external networking is forbidden. No real account, quote, payment or label is created.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(join(root,'package.json'));
const output=resolve(process.argv[3]??'/private/tmp/atlas-checkout-availability');
if(!process.argv[2])throw Error('Pass the bundled node_modules path for Playwright.');
const {chromium}=createRequire(join(resolve(process.argv[2]),'__checkout__.cjs'))('playwright');
const babel=require('next/dist/compiled/babel/core'),modules=new Map(),css=[];
for(const file of ['components/commerce/CommerceCheckout.jsx','components/commerce/OrderReceipt.jsx','components/dealer/CustomerHandoff.jsx'])modules.set(file,babel.transformSync(readFileSync(join(root,file),'utf8'),{filename:file,presets:[[require.resolve('next/babel'),{'preset-env':{targets:{chrome:'120'}},'transform-runtime':{helpers:false}}]],babelrc:false,configFile:false}).code);
for(const file of ['components/commerce/commerce.module.css','components/dealer/handoff.module.css']){
    const classes={},prefix=file.includes('/commerce/')?'commerce':'handoff';
    css.push(readFileSync(join(root,file),'utf8').replace(/\.([a-zA-Z_][\w-]*)/g,(_,name)=>{classes[name]=`${prefix}_${name}`;return `.${prefix}_${name}`;}));
    modules.set(file,`module.exports=${JSON.stringify(classes)};`);
}
modules.set('react','module.exports=window.React;');
modules.set('lib/client.mjs',"exports.request=()=>{throw Error('Unexpected fixture request');};");
const bundle=`const factories={${[...modules].map(([name,source])=>`${JSON.stringify(name)}:function(require,module,exports){${source}\n}`).join(',')}};
const cache={};function load(name){if(cache[name])return cache[name].exports;const module={exports:{}};cache[name]=module;factories[name](dependency=>{if(!dependency.startsWith('.'))return load(dependency);const parts=name.split('/');parts.pop();for(const part of dependency.split('/')){if(part==='..')parts.pop();else if(part!=='.')parts.push(part);}return load(parts.join('/'));},module,module.exports);return module.exports;}
const draft={id:'11111111-1111-4111-8111-111111111111',intakeMethod:'MAIL_IN',cards:[{id:'card-one',identity:{title:'Synthetic 2023 Pikachu 025/165'}}]};
window.fixture={phase:'cold',calls:[],paid:0,quotes:[],payments:[],confirmations:0};
const carriers=['USPS','UPS','FedEx'];
const choices=carriers.map((carrier,index)=>({packingPresetId:'synthetic-'+index,shippingServiceCode:'ground_'+index,carrierLabel:carrier,serviceLabel:'Ground service',label:'Your packed cards',inboundPackaging:'CUSTOMER_MEASURED'}));
window.Stripe=key=>{if(key!=='pk_test_synthetic_local')throw Error('Unexpected fixture key');return{elements:({clientSecret})=>{if(clientSecret!=='synthetic-local-secret')throw Error('Unexpected fixture secret');return{create:()=>{let mount;return{mount:element=>{mount=element;mount.textContent='Synthetic secure payment form — no payment details are collected';},on:(event,callback)=>{if(event==='ready')queueMicrotask(callback);},destroy:()=>{if(mount)mount.textContent='';}};}};},confirmPayment:async()=>{window.fixture.confirmations++;return{paymentIntent:{status:'succeeded'}};}};};
const request=async(path,options={})=>{window.fixture.calls.push({path,options});
if(window.fixture.phase==='multi'){
 if(path.includes('/checkout?'))return{draftId:draft.id,revision:4,channel:'MAIL_IN',cards:draft.cards,unitCents:4000,blockers:[],shippingOptions:choices};
 if(path.endsWith('/quotes')){const index=Number(options.body.shippingServiceCode.slice(-1)),rate=900+index*250,quote={id:'synthetic-quote-'+window.fixture.quotes.length,channel:'MAIL_IN',cards:draft.cards.map(card=>({...card,unitCents:4000})),shipping:[{leg:'INBOUND',carrierName:carriers[index],serviceName:'Ground service',amountCents:rate},{leg:'RETURN',carrierName:carriers[index],serviceName:'Ground service',amountCents:rate+150}],inboundPackage:options.body.inboundPackage,terms:{days:14,clockStart:'ATLAS_RECEIPT',mailChargedLegs:'BOTH_LEGS'},subtotalCents:4000,shippingCents:rate*2+150,taxCents:320,totalCents:4470+rate*2,expiresAt:'2050-01-01T00:00:00Z'};window.fixture.quotes.push(quote);return quote;}
 if(path.endsWith('/payments')){window.fixture.payments.push(options.body);if(window.fixture.payments.length===1)throw Object.assign(Error('Synthetic lost reply'),{code:'UNCONFIRMED_REPLY'});return{attemptId:'synthetic-attempt',state:'AWAITING_PAYMENT',publishableKey:'pk_test_synthetic_local',clientSecret:'synthetic-local-secret'};}
 if(path.endsWith('/reconcile'))return{attemptId:'synthetic-attempt',state:'PAID',order:{id:'synthetic-order',reference:'ATLAS-SYNTHETIC',receipt:window.fixture.quotes.at(-1),effects:[{id:'synthetic-order:shipstation:INBOUND:v1',kind:'SHIPSTATION_LABEL',state:'SUCCEEDED',carrierName:'UPS'},{id:'synthetic-order:shipstation:RETURN:v1',kind:'SHIPSTATION_LABEL',state:'PENDING'},{id:'receipt',kind:'EMAIL_RECEIPT',state:'SUCCEEDED',deliveryStatus:'ACCEPTED'}]}};
 throw Error('Unexpected synthetic checkout route');
}
if(options.method!=='GET'||options.body)throw Error('Fixture permits only checkout GET');if(window.fixture.phase==='offline')throw Object.assign(Error('offline'),{code:'UNCONFIRMED_REPLY'});if(window.fixture.phase==='slow')await new Promise(resolve=>{window.fixture.resolve=resolve;});return {draftId:draft.id,revision:4,channel:'MAIL_IN',cards:draft.cards,unitCents:4000,blockers:window.fixture.phase==='ready'?[]:['PAYMENT_NOT_CONFIGURED'],shippingOptions:[{packingPresetId:'synthetic',shippingServiceCode:'FEDEX_GROUND',label:'Synthetic measured package'}],activePayment:window.fixture.phase==='unknown'?{attemptId:'original-attempt',state:'UNKNOWN'}:null};};
let app;window.render=()=>{app?.unmount();app=ReactDOM.createRoot(document.getElementById('app'));app.render(React.createElement(load('components/commerce/CommerceCheckout.jsx').default,{draft,request,onPaid:()=>{window.fixture.paid++;},onBack:()=>{throw Error('Unexpected return to card review');}}));};window.render();`;
const assets=new Map([
    ['/react.js',readFileSync(join(dirname(require.resolve('react/package.json')),'umd/react.production.min.js'))],
    ['/react-dom.js',readFileSync(join(dirname(require.resolve('react-dom/package.json')),'umd/react-dom.production.min.js'))],
    ['/bundle.js',Buffer.from(bundle)],
    ['/style.css',Buffer.from(['customer.css','atlas-brand.css','atlas-theme.css','submission.css'].map(file=>readFileSync(join(root,'styles',file),'utf8')).join('\n')+'\n'+css.join('\n'))],
]);
for(const file of ['original-1.woff2','original-2.woff2','original-3.woff2','original-4.woff2'])assets.set(`/account/brand/fonts/${file}`,readFileSync(join(root,'public/brand/fonts',file)));
mkdirSync(output,{recursive:true});
const server=createServer((req,res)=>{const path=new URL(req.url,'http://127.0.0.1').pathname;if(path==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ATLAS local checkout fixture</title><link rel="stylesheet" href="/style.css"></head><body><main style="padding:24px 12px"><div id="app"></div></main><script src="/react.js"></script><script src="/react-dom.js"></script><script src="/bundle.js"></script></body></html>');return;}const value=assets.get(path);res.writeHead(value?200:404,{'Content-Type':path.endsWith('.css')?'text/css':path.endsWith('.woff2')?'font/woff2':'text/javascript'});res.end(value);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext(),page=await context.newPage(),errors=[],layouts=[];
page.on('pageerror',error=>errors.push(error.message));
await context.route(/^https?:\/\//,route=>{assert.equal(new URL(route.request().url()).origin,origin,'External requests are forbidden');return route.continue();});
try{
    await page.goto(origin);await page.getByRole('heading',{name:'Checkout is not open yet.'}).waitFor();
    for(const width of [1440,1024,390,320]){
        await page.setViewportSize({width,height:900});
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        const layout=await page.evaluate(()=>({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,buttonHeight:document.querySelector('button').getBoundingClientRect().height,panels:document.querySelectorAll('[aria-label="Saved submission draft"]').length}));
        assert.equal(layout.overflow,false);assert.equal(layout.panels,1);assert(layout.buttonHeight>=44);layouts.push(layout);
        await page.screenshot({path:join(output,`closed-${width}.jpg`),fullPage:true,type:'jpeg',quality:72});
    }
    assert.equal(await page.getByRole('button',{name:'View saved cards'}).count(),0);
    await page.evaluate(()=>{window.fixture.phase='slow';});await page.getByRole('button',{name:'Check checkout availability'}).click();
    await page.getByRole('button',{name:'Checking availability…',disabled:true}).waitFor();
    await page.evaluate(()=>{window.fixture.phase='cold';window.fixture.resolve();});await page.getByRole('button',{name:'Check checkout availability'}).waitFor();
    await page.evaluate(()=>{window.fixture.phase='offline';});await page.getByRole('button',{name:'Check checkout availability'}).click();await page.getByRole('alert').waitFor();
    assert.match(await page.getByRole('alert').innerText(),/could not finish/);
    await page.evaluate(()=>{window.fixture.phase='ready';});await page.getByRole('button',{name:'Check checkout availability'}).focus();await page.keyboard.press('Enter');
    await page.getByRole('combobox',{name:'Your package and shipping service'}).waitFor();await page.getByRole('button',{name:'Get exact total'}).waitFor();
    assert.equal(await page.getByRole('heading',{name:'Checkout is not open yet.'}).count(),0);
    await page.screenshot({path:join(output,'ready-320.jpg'),fullPage:true,type:'jpeg',quality:72});
    await page.evaluate(()=>{window.fixture.phase='unknown';window.render();});await page.getByRole('button',{name:'Check payment status'}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Get exact total'}).count(),0);assert.equal(await page.getByRole('heading',{name:'Checkout is not open yet.'}).count(),0);
    const evidence=await page.evaluate(()=>window.fixture);
    assert.equal(evidence.paid,0);assert.equal(evidence.calls.length,5);assert(evidence.calls.every(call=>call.options.method==='GET'&&!call.options.body));assert.deepEqual(errors,[]);
    await page.evaluate(()=>{window.fixture.phase='multi';window.render();});
    await page.getByRole('combobox',{name:'Your package and shipping service'}).selectOption('0');
    assert.equal(await page.getByRole('button',{name:'Get exact total'}).isDisabled(),true);
    for(const [name,value] of [['Package weight','7.25'],['Package length','8'],['Package width','6'],['Package height','2']])await page.getByRole('spinbutton',{name,exact:true}).fill(value);
    await page.getByRole('button',{name:'Get exact total'}).click();await page.getByRole('button',{name:'Pay $62.70'}).waitFor();
    await page.getByRole('combobox',{name:'Your package and shipping service'}).selectOption('1');
    assert.equal(await page.getByRole('button',{name:'Pay $62.70'}).count(),0);assert.equal(await page.locator('[aria-label="Selected shipping"]').count(),0);
    await page.getByRole('button',{name:'Get exact total'}).click();await page.getByRole('button',{name:'Pay $67.70'}).waitFor();
    const shippingLayouts=[];
    for(const width of [1440,390,320]){
        await page.setViewportSize({width,height:1100});
        await page.evaluate(()=>{window.scrollTo(0,0);return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
        const layout=await page.evaluate(()=>({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,panels:document.querySelectorAll('[aria-label="Review and checkout"]').length}));assert.equal(layout.overflow,false);assert.equal(layout.panels,1);shippingLayouts.push(layout);
        await page.screenshot({path:join(output,'carrier-quote-'+width+'.jpg'),fullPage:true,type:'jpeg',quality:80});
    }
    await page.locator('[aria-label="Selected shipping"]').scrollIntoViewIfNeeded();await page.screenshot({path:join(output,'carrier-total-320.jpg'),type:'jpeg',quality:85});
    await page.getByRole('button',{name:'Pay $67.70'}).click();await page.getByRole('button',{name:'Check original payment'}).waitFor();
    assert.equal(await page.getByRole('combobox',{name:'Your package and shipping service'}).isDisabled(),true);
    assert.equal(await page.getByRole('button',{name:'Back to cards'}).count(),0);
    await page.getByRole('button',{name:'Check original payment'}).click();await page.getByRole('button',{name:'Pay securely',exact:true,disabled:false}).waitFor();
    assert.equal(await page.getByRole('combobox',{name:'Your package and shipping service'}).count(),0);
    await page.getByRole('button',{name:'Pay securely',exact:true}).click();await page.getByRole('heading',{name:'Your cards have a place.'}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Download label to ATLAS'}).count(),1);assert.match(await page.locator('[aria-label="Order receipt"]').innerText(),/ATLAS handles return shipping after grading/);
    await page.screenshot({path:join(output,'carrier-paid-receipt-320.jpg'),fullPage:true,type:'jpeg',quality:80});
    const commerce=await page.evaluate(()=>window.fixture);assert.equal(commerce.quotes.length,2);assert.equal(commerce.payments.length,2);assert.deepEqual(commerce.payments[0],commerce.payments[1]);assert.equal(commerce.payments[0].quoteId,commerce.quotes[1].id);assert.equal(commerce.confirmations,1);assert.equal(commerce.paid,1);assert.deepEqual(errors,[]);
    const result={status:'PASS',syntheticOnly:true,layouts,shippingLayouts,browserErrors:errors,availabilityRequests:evidence.calls,readyInPlace:true,unknownPaymentPreserved:true,carrierChangesInvalidateQuote:true,measurements:commerce.quotes[1].inboundPackage,exactPaymentRequestRetried:true,stripeConfirmations:commerce.confirmations,paidCallbacks:commerce.paid};
    writeFileSync(join(output,'result.json'),JSON.stringify(result,null,2)+'\n');
    process.stdout.write(JSON.stringify({status:'PASS',output,layouts,shippingLayouts})+'\n');
}finally{await context.close();await browser.close();await new Promise(resolve=>server.close(resolve));}
