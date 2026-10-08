import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
// Actual React/customer/camera/IndexedDB/lock behavior with synthetic server
// responses. No production contact details, providers, account or payment.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(join(root,'package.json'));
const {chromium}=createRequire(join(resolve(process.argv[2]),'fixture.cjs'))('playwright');
const output=resolve(process.argv[3]??'/private/tmp/atlas-submission-flow-browser');mkdirSync(output,{recursive:true});
const babel=require('next/dist/compiled/babel/core'), modules=new Map();
const files=['components/AccountWorkspace.jsx','components/intake/CustomerIntake.jsx','components/intake/ProfileFields.jsx','components/intake/ServiceChoice.jsx','components/intake/SubmissionProgress.jsx','components/intake/SubmissionStationFinder.jsx','components/intake/EmailVerificationPanel.jsx','lib/pending-submission.mjs','lib/progress.mjs','lib/capture-buffer.mjs','lib/capture-state.mjs','lib/intake-journal.mjs','lib/dealer-map.mjs','pages/verify-email.jsx'];
const compile=(path,key)=>modules.set(key,babel.transformSync(readFileSync(path,'utf8'),{filename:key,presets:[[require.resolve('next/babel'),{'preset-env':{targets:{chrome:'120'}},'transform-runtime':{helpers:false}}]],babelrc:false,configFile:false}).code);
for(const file of files)compile(join(root,file),file);
for(const file of ['RapidCardCamera.jsx','rapid-camera.mjs'])compile(join(root,'../atlas-shared',file),`atlas-shared/${file}`);
compile(join(root,'../../packages/atlas-manual-intake/src/photo-bytes.mjs'),'packages/atlas-manual-intake/src/photo-bytes.mjs');
compile(join(root,'../../packages/atlas-customer-intake/src/profile.mjs'),'@atlas/customer-intake/profile');
const cameraClasses={},cameraCss=readFileSync(join(root,'../atlas-shared/RapidCardCamera.module.css'),'utf8').replace(/\.([a-zA-Z_][\w-]*)/g,(_,n)=>{cameraClasses[n]=`camera_${n}`;return `.camera_${n}`;});
modules.set('atlas-shared/RapidCardCamera.module.css',`module.exports=${JSON.stringify(cameraClasses)};`);
modules.set('react','module.exports=window.React;');modules.set('next/head','module.exports=()=>null;');modules.set('next/link','module.exports=props=>React.createElement("a",props,props.children);');
modules.set('lib/client.mjs','exports.request=(...args)=>window.__request(...args);');modules.set('lib/server/page.mjs','exports.customerPage=()=>({props:{}});');
for(const name of ['components/intake/SubmissionHero.jsx','components/orders/CustomerOrderHistory.jsx','components/report-films/ReportFilmLibrary.jsx','components/notifications/ProgressPreferences.jsx','components/orders/CustomerOrderTracking.jsx'])modules.set(name,'module.exports=()=>null;');
modules.set('components/commerce/CommerceCheckout.jsx','module.exports=({draft})=>React.createElement("section",{"data-saved-checkout":draft.id},React.createElement("h1",null,"Saved checkout"),...draft.cards.map(c=>React.createElement("p",{key:c.id},c.identity.title)));');
const bundle=`const factories={${[...modules].map(([n,s])=>`${JSON.stringify(n)}:function(require,module,exports){${s}\n}`).join(',')}};const cache={};function load(n){if(cache[n])return cache[n].exports;if(!factories[n])throw Error('Unknown module '+n);const m=cache[n]={exports:{}};factories[n](d=>{if(!d.startsWith('.'))return load(d);const parts=n.split('/');parts.pop();for(const p of d.split('/')){if(p==='..')parts.pop();else if(p!=='.')parts.push(p)}const k=parts.join('/');return load([k,k+'.jsx',k+'.mjs'].find(x=>factories[x])??k)},m,m.exports);return m.exports}window.__load=load;`;
const home=readFileSync(join(root,'../../docs/atlas/design/experience/site/index.html'),'utf8');
const ctas=[...home.matchAll(/<a[^>]+href="([^"]+)"[^>]*>(Find an Authorized Dealer →|Choose mail-in →)<\/a>/g)];assert.equal(ctas.length,2);
const fixture=`
const id=n=>String(n).padStart(8,'0')+'-1111-4111-8111-111111111111';
const state=window.__fixture={signedIn:localStorage.signedIn==='yes',calls:[],draft:JSON.parse(localStorage.draft||'null'),customer:{id:id(1),profile:{}}};
const save=()=>{localStorage.signedIn=state.signedIn?'yes':'no';if(state.draft)localStorage.draft=JSON.stringify(state.draft);};
window.__request=async(path,o={})=>{state.calls.push({path,body:o.body});let result;
if(path==='/session')return{csrf:'fixture',customer:state.signedIn?state.customer:null};
if(path==='/auth/request')return{challengeId:'synthetic'};
if(path==='/auth/verify'){state.signedIn=true;save();return{customer:state.customer,csrf:'fixture'};}
if(path==='/submissions')return{submissions:[]};
if(path==='/intake/drafts'){if(o.body)state.draft??={id:id(3),state:'DRAFT',revision:1,...o.body,cards:[]};result=o.body?{draft:state.draft}:{drafts:state.draft?[state.draft]:[]};}
else if(path.startsWith('/intake/locations'))return{locations:[{id:id(2),name:'Synthetic Dealer',address:{line1:'1 Fixture Lane',city:'Test',region:'CA',postalCode:'90000'},schedule:{}}]};
else if(path==='/profile'){state.customer.profile=o.body.profile;return{customer:state.customer};}
else if(path==='/email/request')return{state:'SENT',verified:false};
else if(path.startsWith('/email/status'))return{state:localStorage.verified==='yes'?'VERIFIED':'UNSENT',verified:localStorage.verified==='yes',required:true,email:'fixture@example.invalid'};
else if(path==='/email/confirm'){localStorage.verified='yes';return{verified:true,resumeDraftId:state.draft.id};}
else if(path.endsWith('/cards')){if(!state.draft.cards.some(c=>c.id===o.body.cardId))state.draft.cards.push({id:o.body.cardId,revision:1,identityState:'UPLOADING',uploads:{FRONT:{id:o.body.front.uploadId,state:'PLANNED'},BACK:{id:o.body.back.uploadId,state:'PLANNED'}}});state.draft.revision++;result={draft:state.draft};}
else if(path.endsWith('/sign'))return{state:'UPLOAD',method:'PUT',url:'https://upload.synthetic.invalid/original',headers:{}};
else if(path.endsWith('/complete')){const uploadId=path.split('/').at(-2),card=state.draft.cards.find(c=>Object.values(c.uploads).some(u=>u.id===uploadId));Object.values(card.uploads).find(u=>u.id===uploadId).state='VERIFIED';if(Object.values(card.uploads).every(u=>u.state==='VERIFIED')){card.identityState='READY';card.identity={title:'Synthetic card '+(state.draft.cards.indexOf(card)+1),category:'SPORTS'};}state.draft.revision++;result={draft:state.draft};}
else if(path.endsWith('/review')){state.draft.state='REVIEW';state.draft.profileSnapshot=o.body.profile;state.draft.revision++;result={draft:state.draft};}
else if(path.startsWith('/intake/drafts/'))result={draft:JSON.parse(localStorage.draft)||state.draft};
else throw Error('Unexpected fixture API '+path);save();return structuredClone(result);
};
// The synthetic HTTPS descriptor exercises the unchanged production guard.
// Only this local fixture transports its bytes to loopback instead of a provider.
const fixtureFetch=window.fetch.bind(window);window.fetch=(url,options)=>fixtureFetch(url==='https://upload.synthetic.invalid/original'?location.origin+'/synthetic-upload':url,options);
window.__paint=0;let cameraCalls=0,frameCount=0;
Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{cameraCalls++;window.__cameraCalls=cameraCalls;const c=document.createElement('canvas');c.width=360;c.height=500;const ctx=c.getContext('2d');setInterval(()=>{ctx.fillStyle=['#8e3838','#38568e','#388e53','#8e7538'][window.__paint%4];ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle='#fff';ctx.font='22px sans-serif';ctx.fillText('Synthetic card '+window.__paint,20,100);ctx.fillText('Frame '+(++frameCount),20,140);},30);return c.captureStream(10);}});
const params=new URLSearchParams(location.search),route=params.get('route'),resumeDraftId=params.get('draft');
const props={initialView:'submit',resumeDraftId,initialService:route==='mail-in'?{intakeMethod:'MAIL_IN',kioskId:null}:route==='dealer'?{intakeMethod:'DEALER_DROP_OFF',kioskId:null}:null};
if(location.pathname==='/')document.getElementById('root').innerHTML=${JSON.stringify(ctas.map(m=>`<a href="${new URL(m[1]).pathname+new URL(m[1]).search}">${m[2]}</a>`).join(' '))};
else ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(window.__load(location.pathname.endsWith('verify-email')?'pages/verify-email.jsx':'components/AccountWorkspace.jsx').default,props));
`;
const css=['customer.css','atlas-brand.css','atlas-theme.css','submission.css'].map(f=>readFileSync(join(root,'styles',f),'utf8')).join('\n');
const reactPath=join(dirname(require.resolve('react/package.json')),'umd/react.development.js'),domPath=join(dirname(require.resolve('react-dom/package.json')),'umd/react-dom.development.js');
const server=createServer((req,res)=>{const path=new URL(req.url,'http://local').pathname;if(path==='/synthetic-upload'){req.resume();res.writeHead(200);res.end();return;}const assets={'/react.js':reactPath,'/react-dom.js':domPath};if(assets[path]){res.setHeader('Content-Type','text/javascript');res.end(readFileSync(assets[path]));return;}if(path.startsWith('/account/brand/')){try{res.end(readFileSync(join(root,'public',path.replace('/account/',''))));}catch{res.writeHead(404);res.end();}return;}if(path.endsWith('.jpg')||path.endsWith('.mp4')){res.writeHead(404);res.end();return;}res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'\n'+cameraCss+'</style><div id="root"></div><script src="/react.js"></script><script src="/react-dom.js"></script><script>'+bundle+'\n'+fixture+'</script></html>');});
await new Promise(r=>server.listen(Number(process.env.ATLAS_FIXTURE_PORT)||0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
if(process.argv.includes('--serve')){console.log(JSON.stringify({status:'LOCAL_FIXTURE_READY',origin,scope:'Synthetic account and uploads only; no provider requests'}));await new Promise(()=>{});}
const browser=await chromium.launch({channel:'chrome',headless:true}),results=[];
try{
 for(const route of ['mail-in','dealer']){
  const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
  await context.route(/^https?:/,r=>{if(r.request().url()==='https://upload.synthetic.invalid/original')return r.fulfill({status:200,body:''});assert.equal(new URL(r.request().url()).origin,origin,'No external network');return r.continue();});
  await page.goto(origin);await page.getByRole('link',{name:route==='mail-in'?'Choose mail-in →':'Find an Authorized Dealer →'}).click();
  await page.getByRole('heading',{name:'Start with your phone'}).waitFor();assert.equal(new URL(page.url()).search,`?route=${route}`);
  assert.equal(await page.getByRole('button',{name:'Continue with your phone'}).count(),0);assert.equal(await page.locator('.service-choice').count(),0);
  for(const width of [320,390,1024,1440]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:join(output,`${route}-signin-${width}.png`),fullPage:true});}
  await page.setViewportSize({width:390,height:844});await page.getByLabel('Mobile number').fill('2025550141');await page.getByRole('button',{name:'Send verification code'}).click();await page.getByLabel('Verification code').fill('424242');await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByRole('button',{name:'Capture Front',exact:true}).waitFor();assert.equal(await page.getByLabel('Full name',{exact:true}).count(),0);
  for(let n=0;n<2;n++){
   await page.evaluate(n=>window.__paint=n*2,n);await page.waitForTimeout(100);await page.getByRole('button',{name:'Capture Front',exact:true}).click();
   await page.getByRole('button',{name:'Capture Back',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Add another card',exact:true}).count(),0);
   await page.evaluate(n=>window.__paint=n*2+1,n);await page.waitForTimeout(100);await page.getByRole('button',{name:'Capture Back',exact:true}).click();await page.getByRole('heading',{name:'Card added.',exact:true}).waitFor();
   await page.waitForFunction(()=>document.activeElement?.textContent==='Add another card');
   assert.equal(await page.getByRole('button',{name:'Capture Front',exact:true}).count(),0);assert.equal(await page.evaluate(()=>window.__cameraCalls),1);
   await page.screenshot({path:join(output,`${route}-pair-${n+1}.png`)});
   if(n===0)await page.getByRole('button',{name:'Add another card',exact:true}).click();else await page.getByRole('button',{name:'Review cards (2)',exact:true}).click();
  }
  await page.getByRole('heading',{name:'Review your cards.'}).waitFor();
  if(route==='dealer')await page.getByRole('button',{name:'Choose this kiosk'}).click();
  await page.getByRole('heading',{name:'Synthetic card 2',exact:true}).waitFor();
  await page.getByRole('button',{name:'Continue to checkout →',exact:true}).click();await page.getByLabel('Full name',{exact:true}).fill('Synthetic Customer');await page.getByLabel('Email for your receipt',{exact:true}).fill('fixture@example.invalid');
  if(route==='mail-in')for(const [label,value] of [['Street address','1 Fixture Lane'],['City','Test'],['State / province / region','CA'],['Postal code','90000']])await page.getByLabel(label,{exact:true}).fill(value);
  await page.getByRole('button',{name:'Continue to checkout →',exact:true}).click();await page.getByRole('heading',{name:'Verify your email once.'}).waitFor();
  const before=await page.evaluate(()=>({draft:window.__fixture.draft,requests:window.__fixture.calls.filter(c=>c.path==='/email/request').length}));assert.equal(before.draft.cards.length,2);assert.equal(before.requests,1);
  assert((await page.evaluate(()=>navigator.locks.query())).held.some(l=>l.name.startsWith('atlas-customer-capture:')),'Original tab retains camera lock');
  const second=await context.newPage();second.on('pageerror',e=>errors.push(e.message));await second.goto(origin+'/account/verify-email#token='+'A'.repeat(43));await second.locator(`[data-saved-checkout="${before.draft.id}"]`).waitFor();
  assert.equal(new URL(second.url()).search,`?draft=${before.draft.id}`);assert.equal(await second.getByText('Synthetic card 2',{exact:true}).count(),1);assert.equal(await second.locator('.service-choice').count(),0);
  assert((await page.evaluate(()=>navigator.locks.query())).held.some(l=>l.name.startsWith('atlas-customer-capture:')),'Return does not steal original tab lock');
  await second.screenshot({path:join(output,`${route}-email-return.png`),fullPage:true});
  assert.deepEqual(errors,[]);results.push({route,oneClickPhone:true,twoPairedCards:true,oneCameraStream:true,cartBeforeDetails:true,exactDraftReturnWithOriginalLock:true,errors});await context.close();
 }
 writeFileSync(join(output,'result.json'),JSON.stringify({status:'PASS',scope:'Chromium synthetic UI with actual React camera and browser storage; no actual SMS/email/provider/payment or physical phone acceptance',results},null,2));console.log(JSON.stringify({status:'PASS',output,results}));
}finally{await browser.close();await new Promise(r=>server.close(r));}
