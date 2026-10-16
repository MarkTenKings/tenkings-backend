/** Actual staff components/client on loopback synthetic persistence and pixels.
 * Usage: ATLAS_FIXTURE_PYTHON=/absolute/python node this-file.mjs SOURCE_ROOT OUTPUT LABEL
 * ATLAS_PERF_TRIALS defaults to 10. ATLAS_PERF_PROFILE may select desktop or phone.
 * ATLAS_PERF_CACHE may select cold or warm for a predesignated replacement run.
 * Delays are controlled inputs, NOT measured production service latency.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createPerformanceFixture } from './human-review-performance-fixture.mjs';

const [sourceRoot, output, label] = process.argv.slice(2);
assert(sourceRoot?.startsWith('/') && output?.startsWith('/') && label, 'Absolute source, output and label required');
const trials = Number(process.env.ATLAS_PERF_TRIALS ?? 10);
assert(Number.isInteger(trials) && trials > 0 && trials <= 50);
await mkdir(output, { recursive: true });
const app = resolve(sourceRoot, 'frontend/atlas-app'), primaryFixture = await createPerformanceFixture({ pythonExecutable: process.env.ATLAS_FIXTURE_PYTHON });
const nextFixture = await createPerformanceFixture({ pythonExecutable: process.env.ATLAS_FIXTURE_PYTHON,cardId:'22222222-2222-4222-8222-222222222222',imageSeed:42 });
let fixture=primaryFixture;
const assets=new Map([...primaryFixture.assets,...nextFixture.assets]);
const hash = value => createHash('sha256').update(value).digest('hex');
const wait = ms => new Promise(done => setTimeout(done, ms));
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8' }).trim();
const { createWorkflowHandler } = await import(pathToFileURL(resolve(sourceRoot, 'packages/atlas-manual-workflow/src/http.mjs')));
const sourceFiles = Object.fromEntries(await Promise.all(['frontend/atlas-app/components/BatchGrading.jsx', 'frontend/atlas-app/components/ManualCards.jsx',
  'frontend/atlas-app/lib/manual-review-startup.mjs', 'packages/atlas-manual-workflow/src/client.mjs', 'packages/atlas-manual-workflow/src/http.mjs',
  'packages/atlas-manual-workflow/src/action-workspace.mjs', 'packages/atlas-manual-workspace/src/FocusedGeometryWorkspace.jsx',
  'packages/atlas-manual-workspace/src/rapid-review.mjs', 'packages/atlas-manual-workflow/src/workflow.mjs', 'packages/atlas-connected-manual/src/transport.mjs',
  'packages/atlas-manual-workspace/src/verified-image.mjs', 'packages/atlas-manual-workspace/src/verified-image-pool.mjs'].map(async file => [file, await readFile(resolve(sourceRoot,file)).then(hash,error => { if(error.code==='ENOENT')return null;throw error; })])));
const instrumented = [];
const stubs = {
  'next/router': `const router={pathname:'/batch',query:{tab:'REVIEW'},push:async()=>{},replace:async()=>{},events:{on(){},off(){},emit(){}}};export const useRouter=()=>router;`,
  'next/link': `import React from 'react';export default function Link(props){return <a {...props}/>;}`,
  './Shell': `import React from 'react';export default function Shell({children}){return <div className="mc-shell">{children}</div>;}`,
  './BatchImport': 'export default function BatchImport(){return null;}',
  './LabelSheets': 'export default function LabelSheets(){return null;}',
};
const source = `import React,{useContext} from 'react';import{createRoot}from'react-dom/client';import BatchGrading from './components/BatchGrading.jsx';import{VerifiedImageCacheBoundary}from'../../packages/atlas-manual-workspace/src/VerifiedImageCacheBoundary.jsx';import{VerifiedImageContext}from'../../packages/atlas-manual-workspace/src/verified-image-context.mjs';import{geometryImage}from'../../packages/atlas-manual-workspace/src/geometry-image.mjs';
function Fixture(){const{pool}=useContext(VerifiedImageContext);window.__warm=async()=>{const v=await(await fetch('/fixture/view')).json();const descriptors=['FRONT','BACK'].flatMap(side=>[geometryImage(v.geometry,side,'PHYSICAL',v.images),v.images[side].inspection]);await Promise.all(descriptors.map(d=>pool.borrow(d).then(a=>a.dispose())));};return <BatchGrading staff={{id:'fixture-reviewer',role:'REVIEWER'}}/>;}createRoot(document.getElementById('app')).render(<VerifiedImageCacheBoundary scope="performance-fixture-reviewer"><Fixture/></VerifiedImageCacheBoundary>);`;
const aliases = {
  '@atlas/manual-workspace/focused-geometry': 'packages/atlas-manual-workspace/src/FocusedGeometryWorkspace.jsx',
  '@atlas/manual-workspace/defects': 'packages/atlas-manual-workspace/src/DefectReviewWorkspace.jsx',
  '@atlas/manual-workspace/report-review': 'packages/atlas-manual-workspace/src/FinalReportReview.jsx',
  '@atlas/manual-workspace/image-cache': 'packages/atlas-manual-workspace/src/VerifiedImageCacheBoundary.jsx',
  '@atlas/manual-workflow/client': 'packages/atlas-manual-workflow/src/client.mjs',
};
const bundle = await build({ logLevel: 'error', stdin: { contents: source, resolveDir: app, sourcefile: 'human-review-performance-fixture.jsx', loader: 'jsx' }, bundle: true, jsx: 'automatic', write: false, outdir: '/fixture', format: 'esm', platform: 'browser', target: 'chrome120', define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'local-performance-fixture', setup(b) {
  b.onResolve({ filter: /.*/ }, args => aliases[args.path] ? { path: resolve(sourceRoot, aliases[args.path]) } : Object.hasOwn(stubs, args.path) ? { path: args.path, namespace: 'fixture' } : null);
  b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path], loader: 'jsx', resolveDir: app }));
  b.onLoad({ filter: /(?:FocusedGeometryWorkspace\.jsx|verified-image\.mjs)$/ }, async args => {
    let contents = await readFile(args.path, 'utf8');
    const before = hash(contents);
    if (args.path.endsWith('FocusedGeometryWorkspace.jsx')) {
      assert(contents.includes('gradient.current=gradientMapFromImage(img);'));
      contents = contents.replace('gradient.current=gradientMapFromImage(img);', '{const began=performance.now();gradient.current=gradientMapFromImage(img);window.__perf.preparation.push({kind:"gradient",side,start:began,end:performance.now()});}');
    } else {
      assert(contents.includes('let released = false;'));
      contents = contents.replace('let released = false;', 'window.__perf.blobs[url]={sha256,byteCount:length}; let released = false;');
    }
    instrumented.push({ file: args.path.slice(sourceRoot.length + 1), sha256: before });
    return { contents, loader: args.path.endsWith('.jsx') ? 'jsx' : 'js', resolveDir: resolve(args.path, '..') };
  });
} }] });
const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
const manifest = { sourceRoot, sourceCommit, sourceFiles, bundleSha256: hash(js), instrumented, node: process.version, observedAt: new Date().toISOString() };
await writeFile(resolve(output, `${label}-source-manifest.json`), JSON.stringify(manifest, null, 2)+'\n');
if (process.env.ATLAS_PERF_METADATA_ONLY === '1') { console.log(JSON.stringify({ metadataOnly: true, sourceCommit, bundleSha256: manifest.bundleSha256 })); process.exit(0); }
const css = (await Promise.all(['styles/global.css', 'styles/grading.css', '../../packages/atlas-report-view/src/report.css', '../../packages/atlas-manual-workspace/src/workspace.css', '../../packages/atlas-manual-workspace/src/defects.css', 'styles/manual.css', 'styles/atlas-brand.css', 'styles/atlas-theme.css', '../../packages/atlas-manual-workspace/src/report-review.css', '../../packages/atlas-manual-workspace/src/focused-geometry.css'].map(file => readFile(resolve(app, file), 'utf8')))).join('\n') + (bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '');
const bootstrap = `window.__perf={requests:[],digests:[],decodes:[],preparation:[],blobs:{},marks:[]};window.__armed=false;for(const type of ['click','change'])document.addEventListener(type,e=>{if(window.__armed){window.__armed=false;window.__start=performance.now();window.__event={type,target:e.target.getAttribute('aria-label')||e.target.textContent};}},true);const originalFetch=fetch;window.fetch=async(...args)=>{const url=typeof args[0]==='string'?args[0]:args[0].url;const row={url,method:args[1]?.method||'GET',start:performance.now()};window.__perf.requests.push(row);try{const value=await originalFetch(...args);row.headers=performance.now();row.status=value.status;return value;}catch(e){row.error=e.name;throw e;}};const originalDigest=crypto.subtle.digest.bind(crypto.subtle);crypto.subtle.digest=async(...args)=>{const start=performance.now();const value=await originalDigest(...args);window.__perf.digests.push({start,end:performance.now(),bytes:args[1]?.byteLength});return value;};const originalDecode=HTMLImageElement.prototype.decode;HTMLImageElement.prototype.decode=async function(){const start=performance.now();try{return await originalDecode.call(this);}finally{window.__perf.decodes.push({start,end:performance.now(),url:this.src});}};new PerformanceObserver(list=>{for(const e of list.getEntries())window.__perf.marks.push({name:e.name,start:e.startTime,detail:e.detail});}).observe({type:'mark',buffered:true});`;
let profile, records = [], currentStep = 'setup';
const receipts = new Map(), snapshots = new Map(), committedRequests = [];
const makeJob=(fixture,key)=>({ key: key.repeat(64), cardId: fixture.view().card.cardId, state: 'REVIEW', revision: 1, evidence: { name: 'Synthetic performance fixture', proposedGrade: 8 } });
let job=makeJob(fixture,'a');
const server = createServer(async (req, res) => {
  const began = performance.now(), row = { path: req.url, method: req.method, step: currentStep, start: began, phases: [] };
  records.push(row);
  const phase = async (name, work) => { const start = performance.now(); const result = await work(); row.phases.push({ name, start, durationMs: performance.now() - start }); return result; };
  const json = value => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value)); };
  try {
    if (req.url === '/') { res.setHeader('content-type', 'text/html'); res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="app"></div><script>${bootstrap}</script><script type="module" src="/bundle.js"></script>`); return; }
    if (req.url === '/bundle.js' || req.url === '/style.css') { res.setHeader('content-type', req.url.endsWith('.js') ? 'text/javascript' : 'text/css'); res.end(req.url.endsWith('.js') ? js : css); return; }
    if (req.url.startsWith('/admin/api/')) await phase('simulated-request-roundtrip', () => wait(profile.latencyMs));
    if (assets.has(req.url)) { const asset = assets.get(req.url); res.writeHead(200, { 'content-type': asset.mime, 'content-length': asset.bytes.length, 'cache-control': 'no-store' }); res.end(asset.bytes); row.bytes = asset.bytes.length; return; }
    if (req.url === '/fixture/view') { json(fixture.view()); return; }
    if (req.url.endsWith('/api/staff/session')) { json({ staff: { id: 'fixture-reviewer' }, csrf: 'fixture' }); return; }
    if (req.url.endsWith('/manual-connected/cards/batch')) { json({ jobs: [job] }); return; }
    if (req.url.endsWith(`/manual-connected/cards/batch/${job.key}`)) { json({ ...fixture.packet(), key: job.key, cardId: job.cardId }); return; }
    if (req.url.endsWith('/thumbnail')) { json({ images: {} }); return; }
    if (req.url.endsWith(`/manual-connected/cards/${job.cardId}`)) { await phase('connected-card-read', () => wait(profile.accessMs)); json({ manual: { current: true }, details: { fields: { name: 'Synthetic performance fixture' } } }); return; }
    if (req.url.startsWith(`/admin/api/staff/manual/cards/${job.cardId}/`)) {
      const write = req.method === 'POST'; let body;
      if (write) { let bytes=''; for await(const chunk of req) bytes+=chunk; body=JSON.parse(bytes); }
      const service = {
        read: async () => phase(write ? 'latest-revision-fence-read' : 'workspace-card-read', async () => { await wait(profile.cardReadMs); return fixture.view().card; }),
        latestApproval: async () => fixture.view().approval,
        previewReport: async () => phase('preview-generation', async () => { await wait(profile.previewMs); return fixture.preview(); }),
        status: async (_staff,_cardId,actionId) => { const result=receipts.get(actionId); return result?{state:'COMMITTED',result}:{state:'NOT_FOUND'}; },
        execute: async (_staff,_cardId,command) => {
          row.actionType=command.action.type; assert.notEqual(command.action.type,'APPROVE_REPORT','Final report approval excluded');
          if(receipts.has(command.actionId))return receipts.get(command.actionId);
          assert.equal(command.expectedRevision,fixture.view().card.revision,'Actual client must save from current revision');
          const saved=await phase('save-and-commit',async()=>{await wait(profile.commitMs);return fixture.execute(command.action);});
          snapshots.set(saved.card.revision,saved); committedRequests.push(command);
          const result={card:saved.card,receipt:{actionId:command.actionId,actorId:'fixture-reviewer',actorKind:'HUMAN',expectedRevision:command.expectedRevision,revision:saved.card.revision,requestHash:hash(JSON.stringify(command)),recordedAt:'2026-10-16T19:00:00.000Z'}};
          receipts.set(command.actionId,result);
          if(command.action.type==='CONFIRM_FINDINGS')await phase('post-commit-learning-memory',()=>wait(profile.postCommitMs));
          return result;
        },
      };
      const handler=createWorkflowHandler({origin,assertRequest(){},boundary:{authenticate:async()=>({id:'fixture-reviewer',role:'REVIEWER'})},workflow:{service,
        hydrate:async card=>phase('workspace-hydration',async()=>{await wait(profile.workspaceMs-profile.cardReadMs);const{card:_card,images:_images,approval:_approval,astra:_astra,variantVerification:_variant,provisional:_provisional,...state}=snapshots.get(card.revision);return state;}),
        readState:async()=>fixture.view(),
        assertViewCurrent:async(_staff,card)=>phase('latest-photo-revision-fence',async()=>{await wait(profile.cardReadMs*2);const latest=fixture.view().card;assert.equal(latest.revision,card.revision);assert.equal(latest.contentHash,card.contentHash);}),
      },imageDescriptors:async({card})=>phase('image-descriptors',async()=>snapshots.get(card.revision).images),
      workspaceExtras:async({card})=>phase('workspace-metadata',async()=>{const{astra,variantVerification,provisional}=snapshots.get(card.revision);return{astra,variantVerification,provisional};})});
      await handler({url:req.url.replace(/^\/admin/,''),method:req.method,headers:req.headers,body},{setHeader:(key,value)=>res.setHeader(key,value),status(code){res.statusCode=code;return this;},json});
      return;
    }
    // Cosmetic brand/audio assets have no grading authority in this fixture.
    if (/\/brand\//.test(req.url)) { res.writeHead(204); res.end(); return; }
    res.statusCode = 404; json({ error: 'FIXTURE_ROUTE_MISSING' });
  } catch (error) { row.error = String(error); res.statusCode = 500; json({ error: error.code ?? error.message }); }
  finally { row.end = performance.now(); row.durationMs = row.end - began; }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch({ channel: 'chrome', headless: true });
const profiles = [
  { name: 'desktop', viewport: { width: 1440, height: 1000 }, mbps: 25, latencyMs: 60, accessMs: 60, workspaceMs: 220, cardReadMs: 30, commitMs: 80, previewMs: 120, postCommitMs: 200 },
  { name: 'phone', viewport: { width: 390, height: 844 }, mbps: 10, latencyMs: 140, accessMs: 60, workspaceMs: 220, cardReadMs: 30, commitMs: 80, previewMs: 120, postCommitMs: 200 },
].filter(value => !process.env.ATLAS_PERF_PROFILE || value.name === process.env.ATLAS_PERF_PROFILE);
const caches = ['cold','warm'].filter(value => !process.env.ATLAS_PERF_CACHE || value === process.env.ATLAS_PERF_CACHE);
assert(profiles.length && caches.length, 'Unknown performance profile/cache selector');
const results = [];
const usable = async (page, target) => {
  await page.waitForFunction(({ target, expected }) => {
    const enabled = name => [...document.querySelectorAll('button')].some(b => b.getAttribute('aria-label') === name && !b.disabled);
    const image = (selector, sha256) => [...document.querySelectorAll(selector)].some(img => img.complete && img.naturalWidth > 0 && getComputedStyle(img).visibility !== 'hidden' && window.__perf.blobs[img.src]?.sha256 === sha256);
    if (target === 'geometry-front' || target === 'geometry-back') { const side = target.endsWith('front') ? 'FRONT' : 'BACK'; return enabled(`Approve ${side === 'FRONT' ? 'Front' : 'Back'} borders and centering`) && image('.fg-photo', expected[side].original.sha256); }
    if (target === 'findings-front' || target === 'findings-back') { const side = target.endsWith('front') ? 'FRONT' : 'BACK'; return enabled(`Approve ${side === 'FRONT' ? 'front' : 'back'} findings`) && image('.ad-plane img', expected[side].inspection.sha256) && document.querySelector(`select[aria-label="${side === 'FRONT' ? 'Front' : 'Back'} finding type"]`)?.disabled === false; }
    return enabled('Approve final grade and queue label') && ['FRONT','BACK'].every(side => image('img[alt$="saved inspection photograph"]', expected[side].inspection.sha256));
  }, { target, expected: fixture.images }, { timeout: 45000 });
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
};
try {
  for (profile of profiles) for (const cache of caches) for (let trial = 0; trial < trials; trial++) {
    fixture=primaryFixture;fixture.reset();job=makeJob(fixture,'a'); receipts.clear(); snapshots.clear(); snapshots.set(1,fixture.view()); committedRequests.length = 0; records = []; currentStep = 'setup';
    const context = await browser.newContext({ viewport: profile.viewport }), page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.route(/^https?:\/\//, route => { assert.equal(new URL(route.request().url()).origin, origin, 'Loopback traffic only'); return route.continue(); });
    await page.goto(origin); await page.getByRole('button', { name: 'Start review →', exact: true }).waitFor();
    const cdp = await context.newCDPSession(page); await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, downloadThroughput: profile.mbps * 1e6 / 8, uploadThroughput: profile.mbps * 1e6 / 8, latency: 0 });
    if (cache === 'warm') await page.evaluate(() => window.__warm());
    const measurements = [];
    const measure = async (name, action, target, expectedActions) => {
      currentStep = name; const recordIndex = records.length, actionIndex = committedRequests.length;
      await page.evaluate(() => { window.__armed = true; window.__start = null; });
      await action(); assert.notEqual(await page.evaluate(() => window.__start), null, 'Timing starts at the actual browser gesture');
      // Some edits stay on the same screen; wait for both real reducer actions.
      await page.waitForFunction(count => window.__perf.requests.filter(r => r.method === 'POST' && r.url.endsWith('/actions') && r.start >= window.__start).length >= count, expectedActions, { timeout: 45000 });
      await usable(page, target);
      const metrics = await page.evaluate(() => {
        const start = window.__start, end = performance.now(), overlap = row => row.start >= start && row.start <= end;
        return { start, end, startedAt: new Date(performance.timeOrigin + start).toISOString(), finishedAt: new Date(performance.timeOrigin + end).toISOString(), usableMs: end - start, event: window.__event, requests: window.__perf.requests.filter(overlap), digests: window.__perf.digests.filter(overlap), decodes: window.__perf.decodes.filter(overlap), preparation: window.__perf.preparation.filter(overlap), verifiedImageMarks: window.__perf.marks.filter(overlap), resources: performance.getEntriesByType('resource').filter(r => r.startTime >= start && r.startTime <= end).map(r => ({ name: r.name.replace(location.origin,''), start: r.startTime, durationMs: r.duration, transferBytes: r.encodedBodySize })) };
      });
      assert.equal(committedRequests.length - actionIndex, expectedActions);
      const saved = fixture.view();
      measurements.push({ name, ...metrics, serverRequests: records.slice(recordIndex).filter(r => r.step === name), actions: committedRequests.slice(actionIndex).map(c => c.action.type), revision: saved.card.revision, findingsHash: hash(JSON.stringify(saved.defects)), geometryHash: hash(JSON.stringify(saved.geometry)) });
      currentStep = 'reviewer-dwell';
      await page.waitForTimeout(name === 'open-review' ? 1500 : 250);
    };
    await measure('open-review', () => page.getByRole('button', { name: 'Start review →', exact: true }).click(), 'geometry-front', 0);
    await measure('approve-front-geometry', () => page.getByRole('button', { name: 'Approve Front borders and centering', exact: true }).click(), 'geometry-back', 0);
    await measure('approve-back-geometry', () => page.getByRole('button', { name: 'Approve Back borders and centering', exact: true }).click(), 'findings-front', 1);
    await measure('save-finding-type', () => page.getByLabel('Front finding type', { exact: true }).selectOption('LIGHT_SCRATCH_SCUFF'), 'findings-front', 2);
    assert.equal(fixture.view().defects.sides.FRONT.findings[0].defectType, 'LIGHT_SCRATCH_SCUFF');
    await measure('approve-front-findings', () => page.getByRole('button', { name: 'Approve front findings', exact: true }).click(), 'findings-back', 1);
    await measure('approve-back-findings', () => page.getByRole('button', { name: 'Approve back findings', exact: true }).click(), 'report', 2);
    assert.deepEqual(errors, []); assert.equal(receipts.size, 6); assert.equal(fixture.view().defects.confirmation.actor, 'HUMAN');
    assert.equal(await page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith('atlas-manual-pending:'))), false);
    const finalReportHash=fixture.preview().reportHash;
    // Load a separately seeded completed fixture; this does not execute final
    // approval/publication. The actual UI Next-card button then opens card two.
    fixture.seedPublished();snapshots.set(fixture.view().card.revision,fixture.view());currentStep='seeded-completed-card';
    await page.reload();await page.getByRole('button',{name:'Start review →',exact:true}).click();
    await page.getByRole('button',{name:'Next card →',exact:true}).waitFor();
    fixture=nextFixture;fixture.reset();job=makeJob(fixture,'b');snapshots.clear();snapshots.set(1,fixture.view());
    if(cache==='warm')await page.evaluate(()=>window.__warm());
    await measure('next-card',()=>page.getByRole('button',{name:'Next card →',exact:true}).click(),'geometry-front',0);
    assert.deepEqual(errors,[]);
    const result = { profile: profile.name, cache, trial, measurements, finalReportHash, errors, imageBytes: Object.fromEntries(Object.entries(fixture.images).map(([side, images]) => [side, Object.fromEntries(Object.entries(images).map(([kind, image]) => [kind, image.byteCount]))])) };
    results.push(result);
    if (trial === 0) await page.screenshot({ path: resolve(output, `${label}-${profile.name}-${cache}.png`), fullPage: true });
    await writeFile(resolve(output, `${label}-partial.json`), JSON.stringify(results, null, 2));
    console.log(JSON.stringify({ label, profile: profile.name, cache, trial, usableMs: Object.fromEntries(measurements.map(m => [m.name, Math.round(m.usableMs)])) }));
    await context.close();
  }
  const summary = [];
  for (const p of profiles) for (const cache of caches) for (const name of results[0].measurements.map(m => m.name)) {
    const samples = results.filter(r => r.profile === p.name && r.cache === cache).map(r => r.measurements.find(m => m.name === name));
    const times = samples.map(s => s.usableMs).sort((a,b) => a-b), median = times.length % 2 ? times[(times.length - 1) / 2] : (times[times.length/2 - 1] + times[times.length/2]) / 2;
    summary.push({ profile:p.name,cache,name,trials:samples.length,medianMs:median,maxMs:times.at(-1),requestCounts:samples.map(s=>s.requests.filter(r=>/\/manual\/cards\//.test(r.url)||/\/manual-connected\/cards\/[0-9a-f-]{36}$/.test(r.url)||name==='next-card'&&r.url.endsWith('/manual-connected/cards/batch')).length),allApiRequestCounts:samples.map(s=>s.requests.filter(r=>/\/api\//.test(r.url)).length),workspaceReads:samples.map(s=>s.requests.filter(r=>/\/view(?:\?|$)/.test(r.url)).length) });
  }
  const result = { pass:true,label,sourceRoot,sourceCommit,node:process.version,browser:browser.version(),bundleSha256:hash(js),instrumented,profiles,trials,scope:'Actual browser components, manual client, HTTP workflow handler, exact verified synthetic PNGs, existing deterministic reducers and native CPU remeasurement. In-memory persistence, controlled server delays and Chrome bandwidth simulation. Phone viewport/network simulation on this Mac; NOT actual phone hardware or production end-to-end latency. Initial open uses the actual batch entry path. The separate Next-card measurement clicks the actual completion control and includes queue reload, opening a second fixture card and its correct image. Its prior completed card is seeded outside the timed interval; final approval/publication and provider requests are never executed. Cold means initially empty verified-image pool; normal app prefetch remains enabled. Fixed reviewer dwell: 1500ms after entry, 250ms after other steps. Warm explicitly leases exact geometry/inspection images before entry.',postCommitQualification:'CONFIRM_FINDINGS follow-up delay is a fixed 200ms fixture input; not a measured production learning/memory cost or bottleneck claim. API roundtrip delay is deterministic in the server; CDP only shapes bandwidth. GET assembly costs30ms card read+190ms hydration. Embedded assembly costs190ms hydration+60ms two-read photo/revision fence, so enrichment is not assumed free.',summary,results };
  result.sourceFiles=sourceFiles;
  result.serverTimeOriginUtc=new Date(performance.timeOrigin).toISOString();
  result.finishedAt=new Date().toISOString();
  await writeFile(resolve(output,`${label}-result.json`),JSON.stringify(result,null,2)+'\n');
} catch(error) { await writeFile(resolve(output,`${label}-failure.json`),JSON.stringify({error:String(error),stack:error.stack,records,results},null,2));throw error; }
finally { await browser.close(); server.closeAllConnections(); await new Promise(done=>server.close(done)); }
