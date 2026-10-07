import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Actual JSX, CSS, browser File/IndexedDB and MediaStream lifetime. All server
// operations and camera subjects are explicitly synthetic, with no providers,
// account credentials, production database or network outside this localhost.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'package.json')), babel = require('next/dist/compiled/babel/core');
const toolModules = process.argv[2], output = resolve(process.argv[3] ?? '/private/tmp/atlas-rapid-intake-browser');
if (!toolModules) throw new Error('Pass the bundled node_modules path for Playwright.');
const { chromium } = createRequire(join(resolve(toolModules), '__atlas_browser__.cjs'))('playwright');
mkdirSync(output, { recursive: true });
const modules = new Map(), sheets = [];
const compile = (source, filename) => babel.transformSync(source, { filename, presets: [[require.resolve('next/babel'), {
    'preset-env': { targets: { chrome: '120' } }, 'transform-runtime': { helpers: false }
}]], babelrc: false, configFile: false }).code;
for (const file of ['components/PhotoIntake.jsx', 'components/RapidCardCamera.jsx', 'components/WorkspaceShared.jsx',
    'lib/rapid-camera.mjs', 'lib/rapid-intake.mjs', 'lib/workspace-client.mjs', 'lib/workspace-drafts.mjs', 'lib/workspace-identification.mjs',
    'lib/routes.mjs', 'lib/usePendingNavigation.js', 'lib/pending-navigation.mjs', 'lib/client-request.mjs', 'lib/grading-response.mjs']) {
    modules.set(file, compile(readFileSync(join(root, file), 'utf8'), file));
}
for (const file of ['components/PhotoIntake.module.css', 'components/WorkspaceUi.module.css']) {
    const prefix = file.includes('PhotoIntake') ? 'intake_' : 'workspace_', names = {};
    let css = readFileSync(join(root, file), 'utf8').replace(/:global\(([^)]+)\)/g, (_, value) => `GLOBALTOKEN${Buffer.from(value).toString('hex')}ENDTOKEN`);
    css = css.replace(/\.([a-zA-Z_][\w-]*)/g, (_, name) => { names[name] = `${prefix}${name}`; return `.${prefix}${name}`; })
        .replace(/GLOBALTOKEN([a-f0-9]+)ENDTOKEN/g, (_, value) => Buffer.from(value, 'hex').toString());
    sheets.push(css); modules.set(file, `module.exports=${JSON.stringify(names)};`);
}
modules.set('react', 'module.exports=window.React;');
modules.set('next/link', 'module.exports=function Link(props){return React.createElement("a",props,props.children)};');
modules.set('next/router', 'module.exports={events:{on(){},off(){},emit(){}},beforePopState(fn){this._bps=fn}};');
modules.set('components/Shell', 'exports.Notice=function Notice({children,error}){return React.createElement("div",{className:"notice "+(error?"error":""),role:error?"alert":"status"},children)};');
const compiled = `const factories={${[...modules].map(([name, source]) => `${JSON.stringify(name)}:function(require,module,exports){${source}\n}`).join(',')}};
const cache={}; function load(name){if(cache[name])return cache[name].exports; const factory=factories[name];if(!factory)throw new Error('Unknown fixture module '+name);const module={exports:{}};cache[name]=module;factory(dependency=>{
if(!dependency.startsWith('.'))return load(dependency);const parts=name.split('/');parts.pop();for(const part of dependency.split('/')){if(part==='..')parts.pop();else if(part!=='.')parts.push(part)}const key=parts.join('/');return load([key,key+'.jsx',key+'.js',key+'.mjs'].find(value=>factories[value])??key);
},module,module.exports);return module.exports}window.__load=load;`;
const fixture = `
const client=__load('lib/workspace-client.mjs'), identity=__load('lib/workspace-identification.mjs');
const state=window.__fixture={cards:new Map(), receipts:new Map(), uploads:new Map(), objects:new Map(), requests:[], streams:0, captures:0};
const copy=value=>structuredClone(value), sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
client.freshWorkspaceAccess=async()=>({csrf:'a'.repeat(64)});
client.uploadPhoto=async(grant,file,{onProgress})=>{onProgress(50);const descriptor=await client.describePhoto(file);state.objects.set(grant.id,{descriptor,file,url:URL.createObjectURL(file)});onProgress(100)};
client.originalImagePath=(id,side)=>{const card=state.cards.get(id),photo=card?.sides.find(value=>value.side===side);return state.objects.get(photo?.uploadId)?.url??''};
client.workspaceRequest=async(path,{body})=>{
state.requests.push({path,body:copy(body)}); const prior=state.receipts.get(body.operationId);if(prior)return {...copy(prior),card:copy(state.cards.get(prior.card.id))};
const action=path==='workspace/cards'?'create':path.split('/').at(-1);let card;
if(action==='create'){card={id:crypto.randomUUID(),title:body.title,identity:copy(body.identity),revision:1,state:'DRAFT',stage:'PHOTOS',sides:['FRONT','BACK'].map(side=>({side,status:'MISSING'}))};state.cards.set(card.id,card)}else{card=state.cards.get(path.split('/')[2]);if(card.revision!==body.expectedRevision)throw new Error('Fixture revision mismatch');card.revision++}
const result={card,operationId:body.operationId};
if(action==='upload-plan'){const id=crypto.randomUUID();state.uploads.set(id,copy(body.file));Object.assign(card.sides.find(value=>value.side===body.side),{status:'PLANNED',uploadId:id,sha256:body.file.sha256});result.upload={id}}
if(action==='upload-complete'){const photo=card.sides.find(value=>value.uploadId===body.uploadId),object=state.objects.get(body.uploadId);if(object.descriptor.sha256!==state.uploads.get(body.uploadId).sha256)throw new Error('Fixture bytes differ');const image=await createImageBitmap(object.file);Object.assign(photo,{status:'VERIFIED',width:image.width,height:image.height});image.close()}
if(action==='identify'){const suggestions=Object.fromEntries(identity.IDENTIFICATION_FIELDS.map(field=>[field,{value:null,confidence:'unknown',evidence:null}]));for(const [field,value]of Object.entries({name:'Synthetic camera card '+state.cards.size,category:'SPORTS',cardNumber:'007'}))suggestions[field]={value,confidence:'high',evidence:'Synthetic printed fixture'};
card.identity={category:'SPORTS',playerName:suggestions.name.value,cardNumber:'007'};card.title=card.title||card.identity.playerName;card.identityReview={status:'READY'};result.identification={status:'SUCCEEDED',photos:body.photos,pairHash:await sha(new TextEncoder().encode(identity.workspaceIdentificationPairKey(body.photos))),suggestions,warnings:[],provenance:{version:identity.IDENTIFICATION_VERSION,model:'gpt-6-astra',reasoningEffort:'low',maxOutputTokens:2400,authority:'MACHINE',elapsedMs:42}}}
if(action==='identity')card.identity=copy(body.identity);
if(action==='queue'){if(!body.pairConfirmed||!card.sides.every(side=>side.status==='VERIFIED'))throw new Error('Fixture pair incomplete');card.state='WAITING'}
state.receipts.set(body.operationId,copy(result));return copy(result)};
const camera=document.createElement('canvas');camera.width=1280;camera.height=960;const context=camera.getContext('2d');
window.__paint=number=>{context.fillStyle='#17291e';context.fillRect(0,0,1280,960);context.fillStyle=number%2?'#c3a46b':'#59744f';context.fillRect(380,70,520,800);context.strokeStyle='#f5e5bc';context.lineWidth=8;context.strokeRect(408,98,464,744);context.fillStyle='#fff';context.font='38px sans-serif';context.textAlign='center';context.fillText('SYNTHETIC',640,410);context.fillText('CARD '+Math.ceil(number/2),640,470);context.fillText(number%2?'FRONT':'BACK',640,530)};__paint(1);
const stream=camera.captureStream(10);Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{state.streams++;return stream}});Object.defineProperty(window,'ImageCapture',{value:undefined,configurable:true});
window.__cameraStream=stream;window.__app=ReactDOM.createRoot(document.getElementById('app'));window.__app.render(React.createElement(__load('components/PhotoIntake.jsx').default,{staff:{id:'synthetic-browser-reviewer',role:'REVIEWER'}}));`;
const assets = new Map([
    ['/react.js', readFileSync(join(dirname(require.resolve('react/package.json')), 'umd/react.production.min.js'))],
    ['/react-dom.js', readFileSync(join(dirname(require.resolve('react-dom/package.json')), 'umd/react-dom.production.min.js'))],
    ['/bundle.js', Buffer.from(compiled + '\n' + fixture)],
    ['/style.css', Buffer.from(readFileSync(join(root, 'styles/global.css'), 'utf8') + '\n' + sheets.join('\n') + '\nbody{padding:36px;background:#f7f8f1}main{max-width:1360px;margin:auto}@media(max-width:650px){body{padding:16px}}')],
    ['/lib/workspace-drafts.mjs', readFileSync(join(root, 'lib/workspace-drafts.mjs'))]
]);
const server = createServer((request, response) => {
    if (request.url === '/storage-fixture') { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end('<!doctype html><title>ATLAS synthetic storage fixture</title>'); return; }
    if (request.url === '/') { response.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()'); response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ATLAS synthetic rapid intake</title><link rel="stylesheet" href="/style.css"></head><body><main><p class="eyebrow">ATLAS · SYNTHETIC BROWSER VERIFICATION</p><div id="app"></div></main><script src="/react.js"></script><script src="/react-dom.js"></script><script src="/bundle.js"></script></body></html>'); return; }
    const body = assets.get(request.url); if (!body) { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Type', request.url.endsWith('.css') ? 'text/css' : 'text/javascript'); response.end(body);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } }), page = await context.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
await context.route(/^https?:\/\//, route => { assert.equal(new URL(route.request().url()).origin, origin, 'No external requests'); return route.continue(); });
try {
    await page.goto(origin); await page.getByRole('button', { name: 'Open rear camera' }).waitFor();
    const storage = await page.evaluate(async () => {
        const { createPhotoDraftStore } = await import('/lib/workspace-drafts.mjs');
        const file = new File(['original PNG bytes'], 'front.png', { type: 'image/png', lastModified: 123 }), heic = new File(['original HEIC bytes'], 'front.heic', { type: 'image/heic', lastModified: 456 });
        const open = () => new Promise((resolve, reject) => { const request = indexedDB.open('atlas-photo-drafts-v1', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
        const db = await open(); const old = [{ id: 'legacy', files: { FRONT: file }, sourceFiles: { FRONT: heic }, pending: { path: 'queue', body: { operationId: 'retained-id' } } }];
        await new Promise((resolve, reject) => { const tx = db.transaction('drafts', 'readwrite'); tx.objectStore('drafts').put({ version: 1, entries: old }, 'staff:storage-fixture'); tx.oncomplete = resolve; tx.onerror = reject; }); db.close();
        const store = createPhotoDraftStore('storage-fixture'), entries = await store.read(), originalPut = IDBObjectStore.prototype.put; let bodyWrites = 0;
        IDBObjectStore.prototype.put = function(value, ...rest) { if (value instanceof Blob) bodyWrites++; return originalPut.call(this, value, ...rest); };
        await store.write(entries); await store.write(entries.map(entry => ({ ...entry, title: 'Metadata change' })));
        const reopened = createPhotoDraftStore('storage-fixture'), recovered = await reopened.read();
        await reopened.write(recovered.map(entry => ({ ...entry, title: 'Another metadata change' })));
        const checks = { bodyWrites, fileName: recovered[0].files.FRONT.name, fileTime: recovered[0].files.FRONT.lastModified, bytes: await recovered[0].files.FRONT.text(), heic: await recovered[0].sourceFiles.FRONT.text(), operationId: recovered[0].pending.body.operationId };
        let aborted = false;
        IDBObjectStore.prototype.put = function(value, ...rest) { if (value?.version === 2) { this.transaction.abort(); throw new Error('Synthetic storage failure'); } return originalPut.call(this, value, ...rest); };
        try { await reopened.write([{ ...recovered[0], files: { FRONT: new File(['replacement'], 'replacement.png', { type: 'image/png' }) } }]); } catch { aborted = true; }
        IDBObjectStore.prototype.put = originalPut;
        const after = await createPhotoDraftStore('storage-fixture').read(); checks.aborted = aborted; checks.afterAbort = await after[0].files.FRONT.text();
        await reopened.write([{ ...recovered[0], files: { FRONT: null } }]);
        checks.heicAfterQueue = await (await createPhotoDraftStore('storage-fixture').read())[0].sourceFiles.FRONT.text();
        return checks;
    });
    assert.deepEqual(storage, { bodyWrites: 2, fileName: 'front.png', fileTime: 123, bytes: 'original PNG bytes', heic: 'original HEIC bytes', operationId: 'retained-id', aborted: true, afterAbort: 'original PNG bytes', heicAfterQueue: 'original HEIC bytes' });
    const storageTabs = await Promise.all([context.newPage(), context.newPage(), context.newPage()]);
    await Promise.all(storageTabs.map(tab => tab.goto(`${origin}/storage-fixture`)));
    await storageTabs[0].evaluate(async () => {
        const { createPhotoDraftStore } = await import('/lib/workspace-drafts.mjs');
        window.crossStore = createPhotoDraftStore('cross-tab-fixture');
        window.crossEntries = [{ id: 'one', files: { FRONT: new File(['original front bytes'], 'front.png', { type: 'image/png' }) }, sourceFiles: { FRONT: new File(['retained HEIC'], 'front.heic', { type: 'image/heic' }) } }];
        await crossStore.write(crossEntries);
    });
    await storageTabs[1].evaluate(async () => {
        const { createPhotoDraftStore } = await import('/lib/workspace-drafts.mjs');
        window.crossStore = createPhotoDraftStore('cross-tab-fixture'); window.crossEntries = await crossStore.read();
    });
    await storageTabs[0].evaluate(async () => {
        await crossStore.write([{ ...crossEntries[0], files: { FRONT: null }, card: { state: 'WAITING' } },
            { id: 'two', files: { FRONT: new File(['next card original'], 'next.png', { type: 'image/png' }) } }]);
    });
    const staleCode = await storageTabs[1].evaluate(async () => {
        crossEntries[0].title = 'Stale tab text correction';
        try { await crossStore.write(crossEntries); return 'ACCEPTED'; } catch (error) { return error.code; }
    });
    const crossTab = await storageTabs[2].evaluate(async () => {
        const { createPhotoDraftStore } = await import('/lib/workspace-drafts.mjs'), entries = await createPhotoDraftStore('cross-tab-fixture').read();
        const keys = await new Promise((resolve, reject) => {
            const open = indexedDB.open('atlas-photo-drafts-v1', 1); open.onerror = () => reject(open.error);
            open.onsuccess = () => { const db = open.result, tx = db.transaction('drafts', 'readonly'), request = tx.objectStore('drafts').getAllKeys(); tx.oncomplete = () => { db.close(); resolve(request.result.filter(key => key.startsWith('staff:cross-tab-fixture:photo:'))); }; };
        });
        return { cards: entries.length, released: entries[0].files.FRONT === null, state: entries[0].card.state,
            heic: await entries[0].sourceFiles.FRONT.text(), nextOriginal: await entries[1].files.FRONT.text(), retainedBodies: keys.length };
    });
    assert.equal(staleCode, 'PHOTO_DRAFT_CHANGED');
    assert.deepEqual(crossTab, { cards: 2, released: true, state: 'WAITING', heic: 'retained HEIC', nextOriginal: 'next card original', retainedBodies: 2 });
    await Promise.all(storageTabs.map(tab => tab.close()));
    await page.getByRole('button', { name: 'Open rear camera' }).click();
    for (let shot = 1; shot <= 4; shot++) {
        await page.evaluate(number => __paint(number), shot);
        // Wait for the synthetic canvas stream's next frame, never a provider.
        await page.waitForTimeout(140);
        const button = page.getByRole('button', { name: shot % 2 ? /^Capture Front/ : /^Capture Back/ });
        await button.waitFor(); await button.click();
        if (shot % 2 === 0) await page.waitForFunction(count => [...__fixture.cards.values()].filter(card => card.state === 'WAITING').length === count, shot / 2);
    }
    const camera = await page.evaluate(() => ({ streams: __fixture.streams, waiting: [...__fixture.cards.values()].filter(card => card.state === 'WAITING').length,
        dimensions: [...__fixture.cards.values()].flatMap(card => card.sides.map(side => [side.width, side.height])), live: __cameraStream.getTracks().every(track => track.readyState === 'live') }));
    assert.equal(camera.streams, 1); assert.equal(camera.waiting, 2); assert.equal(camera.live, true); assert.deepEqual(camera.dimensions, Array.from({ length: 4 }, () => [1280, 960]));
    assert.equal(await page.getByRole('checkbox').count(), 0);
    await page.screenshot({ path: join(output, 'rapid-intake-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: join(output, 'rapid-intake-mobile.png'), fullPage: true });
    await page.evaluate(() => __app.unmount());
    assert.equal(await page.evaluate(() => __cameraStream.getTracks().every(track => track.readyState === 'ended')), true);
    assert.deepEqual(errors, []);
    const result = { status: 'PASS', syntheticOnly: true, providers: 0, productionWrites: 0, actualIphoneLatency: 'UNMEASURED', storage, crossTab: { staleCode, ...crossTab }, camera, checks: ['v1 original-file migration', 'metadata-only progress writes', 'atomic failure retains prior photos', 'HEIC original retained after queue', 'stale tab cannot replace queued progress or new captures', 'released photo bodies are removed without dangling references', 'one stream across two Front/Back pairs', 'all delivered frame pixels retained', 'automatic queue', 'mobile overflow absent', 'camera cleanup'], output };
    writeFileSync(join(output, 'verification.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
