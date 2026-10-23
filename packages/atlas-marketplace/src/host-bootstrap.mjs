import {createServer} from 'node:http';
import {createR1MarketplaceRouteComposition} from './routes-r1.mjs';
import {inspectMarketplaceHostInputs} from './release-readiness.mjs';
import {clone,hash,requireValue} from './contract.mjs';

const surfaces=['public','customer','staff'];
const safeCode=error=>/^[A-Z0-9_]{1,100}$/.test(error?.code??'')?error.code:'HOST_BOOTSTRAP_FAILED';
const unavailable=res=>{if(res.destroyed||res.writableEnded)return;try{if(res.headersSent){res.end();return;}res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end('{"error":"MARKETPLACE_UNAVAILABLE"}');}catch{res.destroy();}};
const immutable=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))immutable(child);Object.freeze(value);}return value;};

/** Explicit owned-host entrypoint. No env lookup, arbitrary runtime imports,
 * pool creation, signal registration or socket/timer effects on construction.
 * It owns only its newly created HTTP servers and the hardwired marketplace
 * composition. The caller retains ownership of canonical R1 states and pool.
 * This is not a shared R1/8070 installer or a TLS/proxy configuration tool.
 */
export function createMarketplaceHostBootstrap(options={}) {
  if(options.enabled!==true)return Object.freeze({status:()=>({enabled:false,phase:'DISABLED',productionReady:false,saleAuthorityAvailable:false}),async prepare(){requireValue(false,'HOST_BOOTSTRAP_DISABLED');},async start(){requireValue(false,'HOST_BOOTSTRAP_DISABLED');},async stop(){return{stopped:true};},async health(){return{enabled:false,phase:'DISABLED'};}});
  const inspection=inspectMarketplaceHostInputs(options);
  requireValue(inspection.configurationComplete,'HOST_BOOTSTRAP_CONFIGURATION_REQUIRED');
  const {manifest:providedManifest,host:hostOptions,finance:financeOptions,existingHandlers,assertReleaseReady}=options;
  const manifest=immutable(clone(providedManifest)),manifestHash=hash(manifest),hostReady=hostOptions.assertRuntimeReady,financeReady=financeOptions.assertRuntimeReady;
  const pin=value=>Object.entries(value),matches=(value,entries)=>Object.keys(value).length===entries.length&&entries.every(([key,item])=>value[key]===item);
  const hostPin=pin(hostOptions),financePin=pin(financeOptions);
  const originals=Object.fromEntries(surfaces.map(surface=>[surface,existingHandlers[surface]]));
  const binding=immutable({schema:manifest.schema,operation:'OWNED_MARKETPLACE_HOST',environment:manifest.environment,platformAccountId:manifest.platformAccountId,manifestHash,
    sourceRevision:manifest.sourceRevision,hostConfigHash:manifest.hostConfigHash,financeConfigHash:manifest.financeConfigHash,commerceConfigHash:manifest.commerceConfigHash,marketplaceBindingHash:manifest.marketplaceBindingHash});
  let phase='CREATED',lastCode=null,stopping=false,preparePromise=null,startPromise=null,stopPromise=null,disposePromise=null;
  const servers=new Map(),sockets=new Set(),work=new Set();
  const sync=(fn,value)=>{const result=fn(clone(value));if(result&&typeof result.then==='function')void Promise.resolve(result).catch(()=>{});requireValue(result===true,'HOST_RELEASE_UNQUALIFIED');};
  function ready() {
    requireValue(!stopping&&!['STOPPED','FAILED'].includes(phase)&&options.enabled===true&&options.manifest===providedManifest&&hash(providedManifest)===manifestHash
      &&options.host===hostOptions&&options.finance===financeOptions&&options.existingHandlers===existingHandlers&&options.assertReleaseReady===assertReleaseReady
      &&matches(hostOptions,hostPin)&&matches(financeOptions,financePin)&&surfaces.every(surface=>existingHandlers[surface]===originals[surface]),'HOST_BOOTSTRAP_CHANGED');
    requireValue(hash(hostOptions.config)===manifest.hostConfigHash&&hash(financeOptions.config)===manifest.financeConfigHash,'HOST_BOOTSTRAP_CHANGED');
    requireValue(hash(hostOptions.marketplace.commerceConfig)===manifest.commerceConfigHash&&hash(hostOptions.marketplace.runtimeApproval.binding)===manifest.marketplaceBindingHash,'HOST_BOOTSTRAP_CHANGED');
    sync(assertReleaseReady,binding);
  }
  // Wrapping the existing host gate confines revocation to marketplace routes.
  // Unrelated R1 requests still reach the exact original application handler.
  const composition=createR1MarketplaceRouteComposition({enabled:true,maxConcurrent:manifest.limits.maxConcurrent,
    host:{...hostOptions,assertRuntimeReady:value=>{ready();sync(hostReady,value);return true;}},
    finance:{...financeOptions,assertRuntimeReady:value=>{ready();sync(financeReady,value);return true;}}});
  const wrapped=Object.fromEntries(surfaces.map(surface=>[surface,composition.wrap(surface,originals[surface])]));
  async function dispose() {
    if(disposePromise)return disposePromise;
    disposePromise=(async()=>{
      // Stop admissions first. Active raw-body reads are bounded by the owned
      // network grace; existing reducer/DB promises are joined, never raced.
      const closes=[...servers.values()].map(server=>new Promise(resolve=>{server.close(()=>resolve());server.closeIdleConnections();}));
      const deadline=setTimeout(()=>{for(const socket of sockets)socket.destroy();},manifest.limits.shutdownGraceMs);
      try {try{await composition.stopFinance();}finally{await Promise.all(closes);await Promise.allSettled([...work]);await composition.close();}}
      finally {clearTimeout(deadline);}
    })();return disposePromise;
  }
  async function prepare() {
    ready();
    if(!preparePromise)preparePromise=(async()=>{
      phase='PREPARING';
      try {
        // Actual canonical classes and shared store/service/finance identities.
        await composition.prepare();ready();
        // Actual dedicated-store read qualifies current role/grants/state. No
        // provider GET, ledger reducer, scheduler or alert send runs here.
        await composition.financeSnapshot();ready();phase='PREPARED';return status();
      } catch(error) {lastCode=safeCode(error);phase='FAILED';await dispose();throw error;}
    })();
    return preparePromise;
  }
  function status() {
    let readyNow=false;try{ready();readyNow=true;}catch{}
    return {enabled:readyNow,phase,lastCode,binding:clone(binding),activeHandlers:work.size,openConnections:sockets.size,
      listeners:Object.fromEntries([...servers].filter(([,server])=>server.listening).map(([surface,server])=>[surface,server.address()])),
      routes:composition.status(),productionReady:false,saleAuthorityAvailable:false};
  }
  function start() {
    requireValue(!stopping&&!['STOPPED','FAILED'].includes(phase),'HOST_BOOTSTRAP_STOPPED');
    if(startPromise)return startPromise;
    startPromise=(async()=>{
      await prepare();ready();phase='STARTING';
      try {
        for(const surface of surfaces) {
          ready();const limit=manifest.limits;
          const server=createServer({maxHeaderSize:32768,requestTimeout:limit.requestTimeoutMs,headersTimeout:limit.headersTimeoutMs,keepAliveTimeout:limit.keepAliveTimeoutMs},(req,res)=>{
            if(phase!=='RUNNING'||stopping)return unavailable(res);
            const operation=Promise.resolve().then(()=>wrapped[surface](req,res));work.add(operation);
            operation.catch(()=>unavailable(res)).finally(()=>work.delete(operation));
          });
          server.maxConnections=limit.maxConnections;server.maxHeadersCount=100;
          server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
          server.on('clientError',(_error,socket)=>{socket.destroy();});
          server.on('error',error=>{lastCode=safeCode(error);if(phase==='RUNNING')void stop().catch(()=>{});});
          servers.set(surface,server);
          await new Promise((resolve,reject)=>{const failed=error=>{server.removeListener('listening',listening);reject(error);};const listening=()=>{server.removeListener('error',failed);resolve();};server.once('error',failed);server.once('listening',listening);server.listen(manifest.listeners[surface]);});
        }
        ready();await composition.startFinance();ready();phase='RUNNING';return status();
      }catch(error){lastCode=safeCode(error);phase='FAILED';await dispose();throw error;}
    })();return startPromise;
  }
  function stop() {
    if(stopPromise)return stopPromise;
    stopping=true;
    stopPromise=(async()=>{
      // Let an in-progress prepare/listen observe revocation and clean up.
      try{await(startPromise??preparePromise);}catch{}
      phase='STOPPING';try{await dispose();phase='STOPPED';return{stopped:true};}catch(error){lastCode=safeCode(error);phase='FAILED';throw error;}
    })();return stopPromise;
  }
  return Object.freeze({prepare,start,stop,status,async health(){ready();if(!preparePromise)return{...status(),finance:null};await preparePromise;ready();return{...status(),finance:await composition.financeSnapshot()};}});
}
