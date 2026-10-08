import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Actual checkout/receipt components and CSS, with local synthetic GET replies.
// This fixture cannot reach an account, create a quote, or dispatch a payment.
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
window.fixture={phase:'cold',calls:[],paid:0};
const request=async(path,options)=>{window.fixture.calls.push({path,options});if(options.method!=='GET'||options.body)throw Error('Fixture permits only checkout GET');if(window.fixture.phase==='offline')throw Object.assign(Error('offline'),{code:'UNCONFIRMED_REPLY'});if(window.fixture.phase==='slow')await new Promise(resolve=>{window.fixture.resolve=resolve;});return {draftId:draft.id,revision:4,channel:'MAIL_IN',cards:draft.cards,unitCents:4000,blockers:window.fixture.phase==='ready'?[]:['PAYMENT_NOT_CONFIGURED'],shippingOptions:[{packingPresetId:'synthetic',shippingServiceCode:'FEDEX_GROUND',label:'Synthetic measured package'}],activePayment:window.fixture.phase==='unknown'?{attemptId:'original-attempt',state:'UNKNOWN'}:null};};
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
    await page.getByRole('combobox',{name:'Your package and FedEx service'}).waitFor();await page.getByRole('button',{name:'Get exact total'}).waitFor();
    assert.equal(await page.getByRole('heading',{name:'Checkout is not open yet.'}).count(),0);
    await page.screenshot({path:join(output,'ready-320.jpg'),fullPage:true,type:'jpeg',quality:72});
    await page.evaluate(()=>{window.fixture.phase='unknown';window.render();});await page.getByRole('button',{name:'Check payment status'}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Get exact total'}).count(),0);assert.equal(await page.getByRole('heading',{name:'Checkout is not open yet.'}).count(),0);
    const evidence=await page.evaluate(()=>window.fixture);
    assert.equal(evidence.paid,0);assert.equal(evidence.calls.length,5);assert(evidence.calls.every(call=>call.options.method==='GET'&&!call.options.body));assert.deepEqual(errors,[]);
    writeFileSync(join(output,'result.json'),JSON.stringify({status:'PASS',syntheticOnly:true,layouts,browserErrors:errors,requests:evidence.calls,readyInPlace:true,unknownPaymentPreserved:true,paidCallbacks:0},null,2)+'\n');
    process.stdout.write(JSON.stringify({status:'PASS',output,requests:evidence.calls.length,layouts})+'\n');
}finally{await context.close();await browser.close();await new Promise(resolve=>server.close(resolve));}
