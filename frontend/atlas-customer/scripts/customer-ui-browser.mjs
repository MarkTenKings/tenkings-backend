import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CommerceService } from '../../../packages/atlas-commerce/src/service.mjs';

// Actual customer JSX/CSS and browser IndexedDB/File behavior. Authentication,
// uploaded subjects, provider replies and database records are synthetic only.
// No production session or external network is available to this harness.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), require = createRequire(join(root, 'package.json'));
const toolModules = process.argv[2], output = resolve(process.argv[3] ?? '/private/tmp/atlas-customer-ui-browser');
if (!toolModules) throw Error('Pass the bundled node_modules path for Playwright.');
const { chromium } = createRequire(join(resolve(toolModules), '__atlas_customer__.cjs'))('playwright');
const babel = require('next/dist/compiled/babel/core'), modules = new Map();
for (const file of ['components/AccountWorkspace.jsx', 'components/intake/SubmissionHero.jsx', 'components/intake/SubmissionProgress.jsx', 'components/intake/CustomerIntake.jsx', 'components/intake/ProfileFields.jsx', 'components/intake/ServiceChoice.jsx',
    'components/commerce/CommerceCheckout.jsx', 'components/commerce/OrderReceipt.jsx', 'components/orders/CustomerOrderHistory.jsx', 'components/orders/CustomerOrderTracking.jsx',
    'components/dealer/DealerWorkspace.jsx', 'components/dealer/DealerPortal.jsx', 'lib/progress.mjs', 'lib/pending-submission.mjs', 'lib/intake-journal.mjs', 'lib/capture-buffer.mjs', 'lib/capture-state.mjs']) {
    modules.set(file, babel.transformSync(readFileSync(join(root, file), 'utf8'), { filename: file, presets: [[require.resolve('next/babel'), {
        'preset-env': { targets: { chrome: '120' } }, 'transform-runtime': { helpers: false }
    }]], babelrc: false, configFile: false }).code);
}
for (const file of ['RapidCardCamera.jsx', 'rapid-camera.mjs']) modules.set(`atlas-shared/${file}`, babel.transformSync(readFileSync(join(root, '../atlas-shared', file), 'utf8'), {filename:file,presets:[[require.resolve('next/babel'),{'preset-env':{targets:{chrome:'120'}},'transform-runtime':{helpers:false}}]],babelrc:false,configFile:false}).code);
const cameraClasses = {};
const cameraCss = readFileSync(join(root, '../atlas-shared/RapidCardCamera.module.css'), 'utf8').replace(/\.([a-zA-Z_][\w-]*)/g, (_, name) => { cameraClasses[name] = `camera_${name}`; return `.camera_${name}`; });
modules.set('atlas-shared/RapidCardCamera.module.css', `module.exports=${JSON.stringify(cameraClasses)};`);
const classes = {};
const css = readFileSync(join(root, 'components/commerce/commerce.module.css'), 'utf8').replace(/\.([a-zA-Z_][\w-]*)/g, (_, name) => { classes[name] = `commerce_${name}`; return `.commerce_${name}`; });
modules.set('components/commerce/commerce.module.css', `module.exports=${JSON.stringify(classes)};`);
modules.set('react', 'module.exports=window.React;');
modules.set('next/head', 'module.exports=function Head(){return null};');
modules.set('next/link', 'module.exports=function Link(props){return React.createElement("a",props,props.children)};');
modules.set('lib/client.mjs', 'exports.request=(...args)=>window.__request(...args);');
const bundle = `const factories={${[...modules].map(([name, source]) => `${JSON.stringify(name)}:function(require,module,exports){${source}\n}`).join(',')}};
const cache={};function load(name){if(cache[name])return cache[name].exports;const factory=factories[name];if(!factory)throw Error('Unknown fixture module '+name);const module={exports:{}};cache[name]=module;factory(dependency=>{
if(!dependency.startsWith('.'))return load(dependency);const parts=name.split('/');parts.pop();for(const part of dependency.split('/')){if(part==='..')parts.pop();else if(part!=='.')parts.push(part)}const key=parts.join('/');return load([key,key+'.jsx',key+'.mjs'].find(value=>factories[value])??key);
},module,module.exports);return module.exports}window.__load=load;`;
// Exercise the actual disabled-provider service projection, not an invented error.
const coldDraftId='00000003-1111-4111-8111-111111111111';
const coldCheckout = await new CommerceService({repository:{loadCheckout:async()=>({version:'atlas-commerce-checkout-v1',draftId:coldDraftId,revision:1,channel:'MAIL_IN',cards:[],location:null,activePayment:null,shippingOptions:[]})},terms:{mailClockStart:'UNCONFIGURED',mailChargedLegs:'UNCONFIGURED'}}).checkout(coldDraftId);
assert(coldCheckout.blockers.includes('PAYMENT_NOT_CONFIGURED')&&!coldCheckout.blockers.includes('COMMERCE_NOT_CONFIGURED'));
const fixture = `
const actualColdCheckout=${JSON.stringify(coldCheckout)};
const copy=value=>structuredClone(value),id=n=>String(n).padStart(8,'0')+'-1111-4111-8111-111111111111';
const kioskLocation={id:id(2),name:'Synthetic Harbor Kiosk',address:{line1:'1 Fixture Street',city:'Testville',region:'CA',postalCode:'90210',country:'US'},timeZone:'America/Los_Angeles',nextCollection:'2026-09-30T17:00:00Z',projectedReturn:'2026-10-07T17:00:00Z',schedule:{timeZone:'America/Los_Angeles',nextCollectionAt:'2026-09-30T17:00:00Z',projectedReturnAt:'2026-10-07T17:00:00Z',cutoffAt:'2026-09-30T16:00:00Z',pickups:[{weekday:3,time:'10:00',cutoff:'09:00'}],returns:[{weekday:3,time:'10:00'}],exceptions:[]}};
const fresh=()=>({signedIn:false,customer:{id:id(1),phone:'+12025550141',profile:{}},calls:[],draft:null,payment:null,quote:null,order:null,uploads:{},settled:false,paymentCreates:0,dealer:false,deposited:false});
const state=window.__fixture=JSON.parse(sessionStorage.getItem('synthetic-state')||'null')||fresh();
const save=()=>sessionStorage.setItem('synthetic-state',JSON.stringify(state));window.__save=save;
const failure=code=>{throw Object.assign(Error(code),{code});};
window.__request=async(path,options={})=>{state.calls.push({path,body:copy(options.body)});const body=options.body;let result;
if(path==='/session')result={csrf:'synthetic-csrf',mode:'LOCAL_FIXTURE',customer:state.signedIn?state.customer:null};
else if(path==='/auth/request')result={challengeId:'synthetic-code'};
else if(path==='/auth/verify'){if(body.code!=='424242')failure('CODE_NOT_ACCEPTED');state.signedIn=true;result={csrf:'synthetic-csrf',customer:state.customer};}
else if(path==='/submissions')result={submissions:[],nextCursor:null};
else if(path==='/profile'){state.customer.profile=copy(body.profile);result={customer:state.customer};}
else if(path.startsWith('/intake/locations'))result={locations:[kioskLocation],...(path.includes('entry=')?{resolvedLocationId:kioskLocation.id}:{})};
else if(path==='/intake/drafts'){if(body&&!state.draft)state.draft={id:id(3),revision:1,state:'DRAFT',intakeMethod:body.intakeMethod,kioskId:body.kioskId,cards:[]};result=body?{draft:state.draft}:{drafts:state.draft?[state.draft]:[]};}
else if(path.endsWith('/cards')){let card=state.draft.cards.find(c=>c.id===body.cardId);if(!card){card={id:body.cardId,revision:1,identityState:'UPLOADING',uploads:{}};for(const side of ['FRONT','BACK'])card.uploads[side]={id:body[side.toLowerCase()].uploadId,state:'PLANNED'};state.draft.cards.push(card);state.draft.revision++;}result={draft:state.draft};}
else if(path.endsWith('/sign')){result={state:'UPLOAD',method:'PUT',url:'https://upload.synthetic.invalid/'+path.split('/').at(-2),headers:{}};}
else if(path.endsWith('/complete')){const uploadId=path.split('/').at(-2),card=state.draft.cards.find(c=>Object.values(c.uploads).some(u=>u.id===uploadId));const upload=Object.values(card.uploads).find(u=>u.id===uploadId);if(!state.uploads[uploadId])failure('NO_SYNTHETIC_BYTES');upload.state='VERIFIED';if(Object.values(card.uploads).every(u=>u.state==='VERIFIED')){card.identityState='READY';card.identity={category:'SPORTS',title:'Synthetic card '+(state.draft.cards.indexOf(card)+1),playerName:'Fixture Player',year:'2026',manufacturer:'Fixture',setName:'Synthetic Set',cardNumber:'1'};}state.draft.revision++;result={draft:state.draft};}
else if(path.endsWith('/correct')){const card=state.draft.cards.find(c=>c.id===path.split('/').at(-2));card.identity=copy(body.identity);card.revision++;state.draft.revision++;result={draft:state.draft};}
else if(path.endsWith('/review')){state.draft.state='REVIEW';state.draft.revision++;result={draft:state.draft};}
else if(path.startsWith('/intake/drafts/'))result={draft:state.draft};
else if(path.startsWith('/commerce/checkout'))result={draftId:state.draft.id,revision:state.draft.revision,channel:state.draft.intakeMethod==='MAIL_IN'?'MAIL_IN':'KIOSK',cards:state.draft.cards,location:kioskLocation,activePayment:state.payment,unitCents:5000,blockers:[],shippingOptions:[{packingPresetId:'fixture-box',shippingServiceCode:'FEDEX_GROUND',label:'Synthetic measured package'}]};
else if(path==='/commerce/quotes'){const kiosk=state.draft.intakeMethod!=='MAIL_IN',n=state.draft.cards.length;state.quote={id:id(4),draftId:state.draft.id,channel:kiosk?'KIOSK':'MAIL_IN',cards:state.draft.cards.map(c=>({...c,unitCents:kiosk?5000:4000})),location:kiosk?kioskLocation:null,terms:{days:kiosk?7:14,clockStart:kiosk?'ATLAS_COLLECTION':'ATLAS_RECEIPT',mailChargedLegs:kiosk?null:'BOTH_LEGS'},subtotalCents:n*(kiosk?5000:4000),shippingCents:kiosk?0:1350,taxCents:n*450,totalCents:n*(kiosk?5450:4450)+(kiosk?0:1350),expiresAt:new Date(Date.now()+600000).toISOString()};result=state.quote;}
else if(path==='/commerce/payments'){state.paymentCreates++;state.payment=state.quote.channel==='MAIL_IN'?{attemptId:id(5),state:'AWAITING_PAYMENT',clientSecret:'synthetic-only',publishableKey:'synthetic-only'}:{attemptId:id(5),state:'UNKNOWN'};result=state.payment;}
else if(path.endsWith('/reconcile')){if(state.settled){state.order??={id:id(6),reference:'ATLAS-SYNTHETIC',receipt:copy(state.quote),effects:[{id:'email',kind:'EMAIL_RECEIPT',state:'SUCCEEDED',deliveryStatus:'ACCEPTED'},{id:'sms',kind:'SMS_RECEIPT',state:'SUCCEEDED',deliveryStatus:'QUEUED'},{id:'label',kind:'PACKAGE_LABEL',state:'SUCCEEDED',artifactState:'GENERATED'}]};state.payment={attemptId:id(5),state:'PAID',order:state.order};state.draft.state='ORDERED';}result=state.payment;}
else if(path.startsWith('/commerce/orders/'))result=state.order;
else if(path==='/orders')result={orders:state.order?[{id:state.order.id,reference:state.order.reference,channel:state.order.receipt.channel,cardCount:state.order.receipt.cards.length}]:[],nextCursor:null};
else if(path.endsWith('/deposit')){state.deposited=true;result={};}
else if(path.startsWith('/orders/'))result={reference:state.order.reference,cards:state.order.receipt.cards.map(c=>({cardId:c.id,identity:c.identity,channel:state.order.receipt.channel,originalLocation:kioskLocation.name,originalSchedule:kioskLocation.schedule,currentProjection:{nextCollection:kioskLocation.nextCollection,projectedReturn:kioskLocation.projectedReturn},grading:'NOT_STARTED',events:state.deposited?[{id:'deposit',kind:'DEPOSIT_DECLARED',occurredAt:'2026-09-24T17:00:00Z'}]:[]}))};
else if(path==='/dealer/session'){if(body)state.dealer=true;if(!state.dealer)failure('DEALER_SIGN_IN_REQUIRED');result={csrf:'dealer-csrf',location:{name:kioskLocation.name},customerCount:1,orderCount:1,cardCount:2,commission:{accruedCents:1000,reversedCents:0},orders:[{reference:'ATLAS-SYNTHETIC',cardCount:2,cards:[{cardId:id(7),custody:'DEPOSIT_DECLARED',grading:'NOT_STARTED'},{cardId:id(8),custody:'ATLAS_RECEIVED',grading:'IN_GRADING'}]}]};}
else if(path==='/dealer/memberships')result={memberships:[{locationId:kioskLocation.id,name:kioskLocation.name}]};
else if(path==='/dealer/logout'){state.dealer=false;result={};}
else throw Error('Unexpected synthetic API '+path);save();return copy(result);};
const journal=__load('lib/intake-journal.mjs'),uploader=journal.createCustomerUploader;
journal.createCustomerUploader=options=>uploader({...options,put:async(signed,file)=>{state.uploads[signed.url.split('/').at(-1)]={name:file.name,size:file.size,bytes:Array.from(new Uint8Array(await file.arrayBuffer()))};save();}});
window.Stripe=()=>({elements:()=>({create:()=>({mount:node=>{node.textContent='Synthetic secure payment form. No card is collected.';},on:(name,callback)=>{if(name==='ready')queueMicrotask(callback);},destroy(){}})}),confirmPayment:async()=>{state.settled=true;save();return {};}});
let app;window.__render=(mode='account')=>{app?.unmount();app=ReactDOM.createRoot(document.getElementById('app'));const cold=mode.startsWith('cold-checkout'),component=cold?'components/commerce/CommerceCheckout.jsx':mode==='dealer'?'components/dealer/DealerWorkspace.jsx':mode==='receipt'?'components/commerce/OrderReceipt.jsx':'components/AccountWorkspace.jsx';app.render(React.createElement(__load(component).default,cold?{draft:{...state.draft,state:'REVIEW'},onBack:()=>{},request:async()=>{
 if(mode==='cold-checkout')throw Object.assign(Error('COMMERCE_NOT_CONFIGURED'),{code:'COMMERCE_NOT_CONFIGURED'});
 return {...copy(actualColdCheckout),draftId:state.draft.id,cards:copy(state.draft.cards),activePayment:mode==='cold-checkout-unknown'?{attemptId:id(5),state:'UNKNOWN'}:mode==='cold-checkout-paid'?copy(state.payment):null};
}}:mode==='receipt'?{orderId:state.order.id}:mode==='dealer'?{}:{initialView:mode==='dashboard'?'dashboard':'submit'}));};window.__render();`;
const assets = new Map([
    ['/react.js', readFileSync(join(dirname(require.resolve('react/package.json')), 'umd/react.production.min.js'))],
    ['/react-dom.js', readFileSync(join(dirname(require.resolve('react-dom/package.json')), 'umd/react-dom.production.min.js'))],
    ['/bundle.js', Buffer.from(bundle + '\n' + fixture)], ['/style.css', Buffer.from(['customer.css', 'atlas-brand.css', 'atlas-theme.css', 'submission.css'].map(file => readFileSync(join(root, 'styles', file), 'utf8')).join('\n') + '\n' + css + '\n' + cameraCss)],
    ['/account/brand/atlas-brand.png', readFileSync(join(root, 'public/brand/atlas-brand.png'))]
]);
for (const file of ['original-1.woff2', 'original-2.woff2', 'original-3.woff2', 'original-4.woff2']) assets.set(`/account/brand/fonts/${file}`, readFileSync(join(root, 'public/brand/fonts', file)));
mkdirSync(output, { recursive: true });
const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://127.0.0.1').pathname;
    if (path === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ATLAS synthetic customer verification</title><link rel="stylesheet" href="/style.css"></head><body><p style="text-align:center">SYNTHETIC LOCAL VERIFICATION · NO REAL EFFECTS</p><div id="app"></div><script src="/react.js"></script><script src="/react-dom.js"></script><script src="/bundle.js"></script></body></html>'); return; }
    let value = assets.get(path); if (!value && /^\/account\/(?:brand\/cards|atlas)\/[a-z-]+\.(?:jpg|mp4)$/.test(path)) { try { value = readFileSync(join(root, 'public', path.slice('/account/'.length))); } catch {} } response.writeHead(value ? 200 : 404, { 'Content-Type': path.endsWith('.jpg') ? 'image/jpeg' : path.endsWith('.mp4') ? 'video/mp4' : path.endsWith('.png') ? 'image/png' : path.endsWith('.woff2') ? 'font/woff2' : path.endsWith('.css') ? 'text/css' : 'text/javascript' }); response.end(value);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } }), page = await context.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
await context.route(/^https?:\/\//, route => { assert.equal(new URL(route.request().url()).origin, origin, 'External requests are prohibited'); return route.continue(); });
const shot = name => page.screenshot({ path: join(output, `${name}.png`), fullPage: true });
async function serviceLayout(width) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await page.evaluate(() => {
        const heading = document.querySelector('.service-choice-title'), spans = [...heading.children].map(element => { const rect = element.getBoundingClientRect(); return { y: rect.y, bottom: rect.bottom }; });
        return { title: heading.textContent, spans, overflow: document.documentElement.scrollWidth > innerWidth,
            films: [...document.querySelectorAll('.service-film video')].map(element => { const rect = element.getBoundingClientRect(); return { ratio: rect.width / rect.height, fit: getComputedStyle(element).objectFit }; }),
            labels: [...document.querySelectorAll('.service-card')].map(card => ({ text: card.querySelector('.service-speed-label h2').textContent, bottom: card.querySelector('.service-speed-label').getBoundingClientRect().bottom, filmTop: card.querySelector('.service-film').getBoundingClientRect().top })),
            metrics: [...document.querySelectorAll('.service-metrics')].map(element => [...element.querySelectorAll('dd strong')].map(value => parseFloat(getComputedStyle(value).fontSize))) };
    });
    assert.equal(layout.title, 'Two Speeds. Same Finish.'); assert.equal(layout.overflow, false, `No horizontal overflow at ${width}px`);
    if (width > 700) assert.equal(layout.spans[0].y, layout.spans[1].y, 'Desktop heading stays on one line');
    else assert(layout.spans[1].y >= layout.spans[0].bottom - 1, 'Mobile heading stacks the two phrases');
    for (const film of layout.films) { assert(Math.abs(film.ratio - 16 / 9) < .01, 'Film keeps its entire 16:9 frame'); assert.equal(film.fit, 'contain'); }
    assert.deepEqual(layout.labels.map(label => label.text), ['Super Fast', 'Fast']);
    for (const label of layout.labels) assert(label.bottom <= label.filmTop + 1, 'Speed labels appear above their films');
    for (const [price, speed] of layout.metrics) { assert.equal(price, speed, 'Price and speed have equal type size'); assert(price >= 34); }
    return { width, ...layout };
}
try {
    await page.goto(`${origin}/?kiosk=synthetic-entry`);
    await page.getByRole('heading',{name:'Super Fast', exact:true}).waitFor();
    assert.equal(await page.getByRole('navigation', {name:'Submission progress'}).count(), 0, 'Initial anonymous service comparison has no progress tracker');
    const serviceLayouts = [];
    for (const width of [320, 390, 820, 1280]) { serviceLayouts.push(await serviceLayout(width)); if(width===390)await shot('00-service-mobile'); if(width===1280)await shot('00-service-desktop'); }
    await page.setViewportSize({width:390,height:844});
    await page.getByRole('button', { name: 'Continue with your phone' }).click();
    await page.getByRole('textbox', { name: 'Mobile number' }).fill('2025550141');
    await page.getByRole('button', { name: 'Send verification code' }).click();
    await page.getByRole('textbox', { name: 'Verification code' }).fill('424242');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('heading', { name: 'Front. Back. Next.' }).waitFor();
    await page.getByRole('button', {name:'Close camera'}).click();
    await page.getByRole('navigation', {name:'Submission progress'}).waitFor();
    assert.equal(await page.getByRole('textbox', {name:'Card description'}).count(), 0);
    for (let i = 1; i <= 2; i++) {
        await page.getByLabel('Front photo', { exact: true }).setInputFiles({ name: `IMG_${i}F.jpg`, mimeType: 'image/jpeg', buffer: Buffer.concat([readFileSync(join(root,'public/brand/cards/kobe.jpg')),Buffer.from(String(i))]) });
        await page.getByLabel('Back photo', { exact: true }).setInputFiles({ name: `IMG_${i}B.jpg`, mimeType: 'image/jpeg', buffer: Buffer.concat([readFileSync(join(root,'public/brand/cards/brady.jpg')),Buffer.from(String(i))]) });
        await page.waitForFunction(n => window.__fixture.draft.cards.length === n && window.__fixture.draft.cards.every(c => c.identityState === 'READY'), i);
    }
    await shot('02-capture-mobile');
    await page.getByRole('button', { name: 'Done adding cards →' }).click();
    await page.getByRole('heading', { name: 'Where should they return?' }).waitFor(); await shot('01-profile-mobile');
    for (const [name, value] of [['Full name', 'Synthetic Customer'], ['Email for your receipt', 'synthetic@example.invalid'], ['Street address', '2 Fixture Way'], ['City', 'Testville'], ['State / province / region', 'CA'], ['Postal code', '90210']]) await page.getByRole('textbox', { name, exact: true }).fill(value);
    await page.getByRole('button', { name: 'Review submission →' }).click();
    await page.getByRole('heading', { name: 'Synthetic card 2' }).waitFor(); await shot('03-review-mobile');
    await page.getByRole('button', { name: 'Continue to checkout →' }).click();
    await page.getByRole('button', { name: 'Get exact total' }).click();
    await page.getByRole('button', { name: 'Pay $109.00', exact: true }).waitFor(); await shot('04-checkout-mobile');
    await page.getByRole('button', { name: 'Pay $109.00', exact: true }).click();
    await page.getByText('We are checking your original payment. Please do not pay again.').waitFor();
    await page.reload();
    await page.getByRole('button', { name: 'Check payment status' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Pay $109.00', exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => window.__fixture.paymentCreates), 1);
    await page.evaluate(() => { window.__fixture.settled = true; window.__save(); });
    await page.getByRole('button', { name: 'Check payment status' }).click();
    await page.getByRole('region', { name: 'Order receipt' }).waitFor();
    await page.getByText('Accepted for delivery', { exact: true }).waitFor(); await page.getByText('Queued for delivery', { exact: true }).waitFor();
    assert.equal(await page.getByText('Sent', { exact: true }).count(), 0);
    await shot('05-paid-receipt-mobile');
    await page.getByRole('button', { name: 'I placed this card in the kiosk dropbox' }).first().click();
    await page.getByText('This is your declaration. ATLAS collection and receipt are confirmed separately.').first().waitFor();
    await page.evaluate(() => window.__render('receipt'));
    await page.getByText('ATLAS-SYNTHETIC', { exact: true }).waitFor();
    await page.getByText('Drop-off cutoff:', { exact: false }).waitFor();
    assert.equal(await page.evaluate(() => window.__fixture.paymentCreates), 1);
    await page.setViewportSize({ width: 1280, height: 900 }); await shot('06-saved-receipt-desktop');
    await page.evaluate(() => window.__render('dealer'));
    await page.getByRole('button', { name: 'Synthetic Harbor Kiosk', exact: true }).click();
    await page.getByRole('heading', { name: 'Synthetic Harbor Kiosk' }).waitFor();
    await page.getByText('Customer reports dropbox deposit', { exact: false }).waitFor();
    assert.equal(await page.getByText('synthetic@example.invalid', { exact: false }).count(), 0); await shot('07-dealer-desktop');
    await page.setViewportSize({ width: 390, height: 844 }); await shot('08-dealer-mobile');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Mobile layout must not scroll horizontally');
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByRole('heading', { name: 'Choose your location' }).waitFor();
    assert.deepEqual(errors, []);
    const evidence = await page.evaluate(() => ({ cards: window.__fixture.draft.cards.length, originals: Object.values(window.__fixture.uploads).map(({ name, size }) => ({ name, size })), paymentCreates: window.__fixture.paymentCreates, reviewWrites: window.__fixture.calls.filter(c => c.path.endsWith('/review')).length, profileWrites: window.__fixture.calls.filter(c => c.path === '/profile').length, dealerEntries: window.__fixture.calls.filter(c => c.path === '/dealer/session' && c.body).length }));
    assert.equal(evidence.reviewWrites, 1); assert.equal(evidence.originals.length, 4);
    await page.evaluate(() => { Object.assign(window.__fixture, { draft: null, quote: null, payment: null, order: null, settled: false, deposited: false }); history.replaceState(null, '', '/'); window.__save(); window.__render('account'); });
    await page.getByRole('button', { name: 'Choose mail-in →' }).click();
    await page.getByRole('button', { name: /^Continue to camera/ }).click();
    await page.getByRole('heading', { name: 'Front. Back. Next.' }).waitFor();
    await page.getByRole('button', {name:'Close camera'}).click();
    assert.equal(await page.getByRole('heading', { name: 'Complete your details.' }).count(), 0, 'Returning complete profile skips entry');
    await page.getByLabel('Front photo', { exact: true }).setInputFiles({ name: 'mail-front.jpg', mimeType: 'image/jpeg', buffer: readFileSync(join(root,'public/brand/cards/kobe.jpg')) });
    await page.getByLabel('Back photo', {exact:true}).waitFor({state:'attached'});
    await page.getByLabel('Back photo', { exact: true }).setInputFiles({ name: 'mail-back.jpg', mimeType: 'image/jpeg', buffer: readFileSync(join(root,'public/brand/cards/brady.jpg')) });
    await page.getByLabel('Front photo', {exact:true}).waitFor({state:'attached'});
    await page.waitForFunction(() => window.__fixture.draft.cards[0]?.identityState === 'READY');
    await page.getByRole('button', { name: 'Done adding cards →' }).click();
    await page.getByRole('button', { name: 'Continue to checkout →' }).click();
    await page.getByRole('combobox', { name: 'Your package and FedEx service' }).selectOption('0');
    await page.getByRole('button', { name: 'Get exact total' }).click();
    await page.getByText('Two weeks from physical receipt at ATLAS.', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Pay $58.00', exact: true }).click();
    await page.getByRole('button', { name: 'Pay securely', exact: true }).click();
    await page.getByRole('heading', { name: 'Prepare your shipment' }).waitFor();
    await page.getByText('Shipping paid for the trip to ATLAS and the return trip.').waitFor(); await shot('09-mail-receipt-mobile');
    assert.equal(await page.evaluate(() => window.__fixture.paymentCreates), 2, 'Exactly one payment per distinct synthetic order');
    assert.equal(await page.evaluate(() => window.__fixture.calls.filter(c => c.path === '/profile').length), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    const mail = await page.evaluate(() => ({ cards: window.__fixture.draft.cards.length, paymentState: window.__fixture.payment.state, totalDistinctPaymentCreates: window.__fixture.paymentCreates, profileWrites: window.__fixture.calls.filter(c => c.path === '/profile').length }));
    await page.evaluate(() => window.__render('dashboard')); await page.getByRole('link', {name:/GRADE YOUR CARDS/}).waitFor(); await shot('10-hero-mobile');
    await page.addStyleTag({content:'.fixture-banner,body>p{display:none!important}'}); const mobileCTA=await page.locator('.hero-slab-button').boundingBox(); assert(mobileCTA.y+mobileCTA.height<844,'The grade-your-cards button must be visible without scrolling at390×844'); await shot('10-hero-mobile-production-layout');
    await page.setViewportSize({width:1280,height:900}); await shot('11-hero-desktop');
    await page.evaluate(() => window.__render('cold-checkout')); await page.getByRole('heading',{name:'Your draft is saved.'}).waitFor(); assert.equal(await page.getByRole('button',{name:'Get exact total'}).count(),0); await page.getByRole('link',{name:'Back to your account →'}).waitFor(); await shot('13-saved-draft-checkout-cold');
    await page.evaluate(() => window.__render('cold-checkout-200')); await page.getByRole('heading',{name:'Your draft is saved.'}).waitFor(); assert.equal(await page.getByRole('button',{name:'Get exact total'}).count(),0); await page.getByRole('link',{name:'Back to your account →'}).waitFor(); await shot('14-saved-draft-real-cold-dto');
    await page.evaluate(() => window.__render('cold-checkout-unknown')); await page.getByRole('button',{name:'Check payment status'}).waitFor(); assert.equal(await page.getByRole('heading',{name:'Your draft is saved.'}).count(),0,'Cold blockers must not hide an unresolved original payment');
    await page.evaluate(() => window.__render('cold-checkout-paid')); await page.getByRole('heading',{name:'Your cards have a place.'}).waitFor(); assert.equal(await page.getByRole('heading',{name:'Your draft is saved.'}).count(),0,'Cold blockers must not hide a paid receipt');
    const directoryContext = await browser.newContext({viewport:{width:390,height:844},geolocation:{latitude:34.09,longitude:-118.4},permissions:['geolocation']}), directory = await directoryContext.newPage();
    await directoryContext.route(/^https?:\/\//, route => { assert.equal(new URL(route.request().url()).origin, origin, 'External requests are prohibited'); return route.continue(); });
    await directory.goto(origin);
    await directory.evaluate(() => {
      const api=window.__request; window.__directoryMode='empty'; window.__directoryPaths=[];
      window.__request=async(path,...args)=>{if(path.startsWith('/intake/locations')){window.__directoryPaths.push(path);if(window.__directoryMode==='empty')return {locations:[]};if(window.__directoryMode==='contact')return {locations:[],dealerContacts:[window.__dealerContact]};if(window.__directoryMode==='error')throw Error('Synthetic directory outage');if(window.__directoryMode==='slow')return new Promise(resolve=>{window.__finishDirectory=()=>api(path,...args).then(resolve);});}return api(path,...args);};
      window.__render();
    });
    await directory.getByRole('button',{name:'Find an Authorized Dealer →'}).click();
    await directory.getByRole('heading',{name:'Find a Atlas Submission Station at an Authorized Dealer near you'}).waitFor();
    await directory.getByText('No ATLAS Submission Stations found yet.',{exact:true}).waitFor();
    assert(await directory.getByRole('button',{name:'Continue with your phone'}).isDisabled(), 'An empty directory cannot enable kiosk continuation');
    await directory.getByRole('textbox',{name:'ZIP code or city'}).fill('90210'); await directory.getByRole('button',{name:'Search',exact:true}).click();
    await directory.getByText('No ATLAS Submission Stations found for this search.',{exact:true}).waitFor();
    await directory.getByRole('button',{name:'Use my location'}).click();
    await directory.waitForFunction(()=>window.__directoryPaths.at(-1).includes('lat='));
    assert.equal(await directory.getByRole('textbox',{name:'ZIP code or city'}).inputValue(),'');
    assert.equal(new URL(await directory.evaluate(()=>window.__directoryPaths.at(-1)),origin).searchParams.has('query'),false,'Nearby search clears the previous text filter');
    await directory.evaluate(()=>{window.__directoryMode='full';}); await directory.getByRole('button',{name:'Search',exact:true}).click();
    await directory.getByRole('heading',{name:'Synthetic Harbor Kiosk'}).waitFor();
    await directory.evaluate(()=>{window.__directoryMode='error';}); await directory.getByRole('button',{name:'Search',exact:true}).click();
    await directory.getByText('We couldn’t load ATLAS Submission Stations. Please try again.').waitFor();
    assert.equal(await directory.locator('.location-option,.location-empty').count(),0,'A failed search shows neither stale locations nor a false empty-result message');
    await directory.evaluate(()=>{window.__directoryMode='slow';}); await directory.getByRole('button',{name:'Search',exact:true}).click();
    await directory.waitForFunction(()=>Boolean(window.__finishDirectory));
    await directory.evaluate(()=>{window.__directoryMode='empty';}); await directory.getByRole('button',{name:'Use my location'}).click();
    await directory.getByText('No ATLAS Submission Stations found yet.',{exact:true}).waitFor();
    await directory.evaluate(async()=>{await window.__finishDirectory();});
    assert.equal(await directory.locator('.location-option').count(),0,'An older search cannot overwrite the newer location result');
    await directory.screenshot({path:join(output,'00-service-empty-directory-mobile.png'),fullPage:true});
    const approvedContact = JSON.parse(readFileSync(join(root, '../atlas-public/config/authorized-dealers-20260923.json'), 'utf8')).dealers[0];
    await directory.evaluate(contact => { window.__dealerContact = contact; window.__directoryMode = 'contact'; }, { id: approvedContact.id, name: approvedContact.name, address: approvedContact.address, website: approvedContact.website, directionsUrl: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(Object.values(approvedContact.address).join(', '))}` });
    await directory.getByRole('textbox',{name:'ZIP code or city'}).fill('95678'); await directory.getByRole('button',{name:'Search',exact:true}).click();
    await directory.getByRole('heading',{name:'CenterCourt Cards',exact:true}).waitFor();
    await directory.getByText('Submission station setup in progress',{exact:true}).waitFor();
    assert.equal(await directory.locator('.dealer-contact button,.location-empty').count(),0,'An approved contact neither pretends to be selectable nor shows an empty-directory message');
    assert(await directory.getByRole('button',{name:'Continue with your phone'}).isDisabled(),'A contact-only dealer cannot enable kiosk continuation');
    assert.equal(await directory.getByRole('link',{name:'Visit dealer website ↗'}).getAttribute('href'),approvedContact.website);
    await directory.screenshot({path:join(output,'00-authorized-dealer-contact-mobile.png'),fullPage:true});
    await directoryContext.close();
    const rapidContext = await browser.newContext({viewport:{width:390,height:844}}), rapid = await rapidContext.newPage();
    await rapid.goto(origin); await rapid.evaluate(() => {
      window.__fixture.signedIn=true; window.__fixture.customer.profile={}; window.__fixture.calls=[]; window.__save();
      const api=window.__request; window.__request=async(path,options)=>{if(path==='/intake/drafts'&&options?.body){window.__blockedDraft=true;return new Promise(()=>{});}return api(path,options);};
      window.__render();
    });
    await rapid.getByRole('heading',{name:'Super Fast',exact:true}).waitFor();
    assert.equal(await rapid.getByRole('navigation',{name:'Submission progress'}).count(),0,'Initial signed-in service comparison has no progress tracker');
    await rapid.getByRole('button',{name:'Choose mail-in →'}).click(); await rapid.getByRole('button',{name:/^Continue to camera/}).click();
    await rapid.getByRole('button',{name:'Capture Front'}).waitFor(); const startedAt=Date.now();
    for(let i=0;i<10;i++){await rapid.getByRole('button',{name:'Capture Front'}).click();await rapid.getByRole('button',{name:'Capture Back'}).click();}
    await rapid.getByRole('button',{name:'Capture Front'}).waitFor();
    const rapidEvidence={cards:10,elapsedMs:Date.now()-startedAt,serverCreateStillBlocked:await rapid.evaluate(()=>window.__blockedDraft===true)};
    assert(rapidEvidence.elapsedMs<60000,'Twenty captures must be locally accepted within a minute even while server creation remains blocked');
    await rapid.screenshot({path:join(output,'12-continuous-camera-mobile.png')});
    await rapid.getByRole('button',{name:'Close camera'}).click(); await rapid.getByRole('button',{name:'Done adding cards →'}).click();
    await rapid.getByRole('heading',{name:'Where should they return?'}).waitFor();
    await rapid.reload(); await rapid.getByRole('heading',{name:'Front. Back. Next.'}).waitFor();
    assert.equal(await rapid.locator('.captured-pair').count(),10,'All ten pairs survive reload before any server acknowledgement');
    await rapid.getByRole('button',{name:'Keep capturing'}).click(); await rapid.getByRole('button',{name:'Capture Front'}).click(); await rapid.getByRole('button',{name:'Capture Back'}).waitFor();
    await rapid.reload(); await rapid.getByRole('button',{name:'Continue with the back'}).waitFor();
    await rapidContext.close();
    writeFileSync(join(output, 'result.json'), JSON.stringify({ status: 'PASS', syntheticOnly: true, browserErrors: errors, serviceLayouts, directory: {emptySelectionBlocked:true,nearbyClearsQuery:true,errorDistinctFromEmpty:true,staleResultIgnored:true,approvedDealerVisible:true,contactSelectionBlocked:true}, kiosk: evidence, mail, coldCheckout: {actualServiceBlockers:coldCheckout.blockers,savedCompletion:true,unknownPaymentPreserved:true,paidReceiptPreserved:true}, rapid: rapidEvidence }, null, 2) + '\n');
    process.stdout.write(JSON.stringify({ status: 'PASS', output, kiosk: evidence, mail }) + '\n');
} catch (error) {
    await shot('failure'); writeFileSync(join(output, 'failure.json'), JSON.stringify({ error: error.message, browserErrors: errors, text: await page.locator('body').innerText() }, null, 2)); throw error;
} finally { await context.close(); await browser.close(); await new Promise(resolve => server.close(resolve)); }
