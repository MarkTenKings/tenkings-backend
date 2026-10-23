import {createServer} from 'node:http';
import {createR1MarketplaceRouteComposition} from '../src/routes-r1.mjs';
import {requireValue} from '../src/contract.mjs';
import {assertIsolatedHostFixture} from './isolated-host-fixture.mjs';

const surfaces=Object.freeze(['public','customer','staff']);
const bounds=Object.freeze({
  maxLifetimeMs:[15000,100,60000],maxRequests:[128,1,256],maxConcurrent:[4,1,8],maxConnections:[8,1,32],
  maxHeaderBytes:[8192,1024,16384],maxHeaders:[32,8,64],maxUrlBytes:[4096,256,8192],maxQueryFields:[16,1,32],maxBodyBytes:[16384,1,16384],
  requestTimeoutMs:[2000,50,5000],headersTimeoutMs:[1000,50,5000],keepAliveTimeoutMs:[100,1,1000],
  socketCloseGraceMs:[100,1,500],drainTimeoutMs:[1500,50,2000],shutdownTimeoutMs:[8000,6000,10000],
});
const code=error=>/^[A-Z0-9_]{1,100}$/.test(error?.code??'')?error.code:'ISOLATED_HOST_FAILED';
function limitsFor(input={}){
  requireValue(input&&Object.getPrototypeOf(input)===Object.prototype&&Object.keys(input).every(key=>Object.hasOwn(bounds,key)),'ISOLATED_HOST_LIMITS_INVALID');
  const limits=Object.fromEntries(Object.entries(bounds).map(([key,[value,min,max]])=>{value=input[key]??value;requireValue(Number.isSafeInteger(value)&&value>=min&&value<=max,'ISOLATED_HOST_LIMITS_INVALID');return[key,value];}));
  requireValue(limits.headersTimeoutMs<=limits.requestTimeoutMs&&limits.maxConcurrent<=limits.maxConnections&&limits.socketCloseGraceMs<limits.drainTimeoutMs,'ISOLATED_HOST_LIMITS_INVALID');
  return Object.freeze(limits);
}
function send(res,status,error){if(res.destroyed||res.writableEnded)return;if(res.headersSent){res.destroy();return;}res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',Connection:'close'});res.end(JSON.stringify({error}));}
async function within(promise,ms){let timer;try{return await Promise.race([Promise.resolve(promise).then(value=>({complete:true,value}),error=>({complete:true,error})),new Promise(resolve=>{timer=setTimeout(()=>resolve({complete:false}),Math.max(1,ms));})]);}finally{clearTimeout(timer);}}

/** Finite local qualification only. The sole executable input is a branded,
 * owned fixture. No environment, provider credentials, arbitrary handlers,
 * listener addresses, production bootstrap, or finance-start API is consumed.
 * Content-Length-only bodies are an intentional local QA transport restriction.
 */
export async function startIsolatedHostRunner(options={}){
  requireValue(options.enabled===true,'ISOLATED_HOST_DISABLED');
  requireValue(Object.keys(options).every(key=>['enabled','fixture','limits'].includes(key)),'ISOLATED_HOST_OPTIONS_INVALID');
  const limits=limitsFor(options.limits),fixture=assertIsolatedHostFixture(options.fixture);
  fixture.assertReady();
  let composition;
  try{composition=createR1MarketplaceRouteComposition({enabled:true,host:fixture.host,finance:fixture.finance,maxConcurrent:limits.maxConcurrent});}
  catch(error){await fixture.close();throw error;}
  const servers=new Map(),sockets=new Set(),work=new Set(),addresses={};
  const counts={requests:0,admitted:0,rejected:0,originalHandlers:0,requestTimeouts:0,connectionRefusals:0};
  let phase='PREPARING',reason=null,lastCode=null,closePromise=null,preparePromise=null,compositionClosed=false,fixtureClosed=false,resolveClosed;
  const closed=new Promise(resolve=>{resolveClosed=resolve;}),startedAt=Date.now(),expiresAt=startedAt+limits.maxLifetimeMs;
  function ready(){requireValue(!closePromise&&Date.now()<expiresAt,'ISOLATED_HOST_EXPIRED');assertIsolatedHostFixture(fixture);fixture.assertReady();}
  const original=surface=>(req,res)=>{counts.originalHandlers++;res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({original:true,surface,method:req.method,url:req.url}));};
  const wrapped=Object.fromEntries(surfaces.map(surface=>[surface,composition.wrap(surface,original(surface))]));
  const lifetime=setTimeout(()=>{void stop('LIFETIME_LIMIT');},limits.maxLifetimeMs);
  async function stop(why='EXPLICIT_CLOSE'){
    if(closePromise)return closePromise;
    reason=why;phase='STOPPING';clearTimeout(lifetime);
    closePromise=(async()=>{
      const shutdownDeadline=Date.now()+limits.shutdownTimeoutMs;
      const serverCloses=[...servers.values()].map(server=>new Promise(resolve=>{server.close(()=>resolve());server.closeIdleConnections();}));
      const force=setTimeout(()=>{for(const socket of sockets)socket.destroy();},limits.socketCloseGraceMs);
      const drain=await within(Promise.allSettled([...work,...(preparePromise?[preparePromise]:[])]),limits.drainTimeoutMs);
      const compositionClose=Promise.resolve().then(()=>composition.close()).then(()=>{compositionClosed=true;});
      // Stop the owned database even when an earlier handler/query did not drain.
      // Query timeout and cluster termination are fixture duties, separate from
      // the socket deadline. Durable files are always retained by fixture.close.
      const fixtureClose=Promise.resolve().then(()=>fixture.close()).then(()=>{fixtureClosed=true;});
      const completion=await within(Promise.allSettled([...serverCloses,...work,compositionClose,fixtureClose]),shutdownDeadline-Date.now());
      clearTimeout(force);for(const socket of sockets)socket.destroy();
      const failures=completion.complete?completion.value?.filter(item=>item.status==='rejected')??[]:[];
      if(!completion.complete)lastCode='ISOLATED_HOST_SHUTDOWN_TIMEOUT';else if(failures.length)lastCode=code(failures[0].reason);
      phase=completion.complete&&!failures.length&&compositionClosed&&fixtureClosed?'CLOSED':'FAILED';
      const receipt=Object.freeze({phase,reason,lastCode,listenersClosed:[...servers.values()].every(server=>!server.listening),openConnections:sockets.size,activeHandlers:work.size,handlerDrainComplete:drain.complete,forcedDrain:!drain.complete,compositionClosed,fixtureClosed,durableFilesRetained:true,elapsedMs:Date.now()-startedAt,shutdownBoundMs:limits.shutdownTimeoutMs});
      resolveClosed(receipt);return receipt;
    })();
    return closePromise;
  }
  try{
    preparePromise=(async()=>{await composition.prepare();ready();await composition.financeSnapshot();ready();})();
    await preparePromise;
    for(const surface of surfaces){
      ready();
      const server=createServer({maxHeaderSize:limits.maxHeaderBytes,requestTimeout:limits.requestTimeoutMs,headersTimeout:limits.headersTimeoutMs,keepAliveTimeout:limits.keepAliveTimeoutMs,connectionsCheckingInterval:Math.min(100,limits.headersTimeoutMs)},(req,res)=>{
        counts.requests++;
        try{
          ready();requireValue(phase==='RUNNING','ISOLATED_HOST_NOT_RUNNING');
          requireValue(counts.requests<=limits.maxRequests,'ISOLATED_HOST_REQUEST_LIMIT');
          requireValue(work.size<limits.maxConcurrent,'ISOLATED_HOST_CONCURRENCY_LIMIT');
          requireValue(req.rawHeaders.length/2<=limits.maxHeaders,'ISOLATED_HOST_HEADERS_LIMIT');
          requireValue(typeof req.url==='string'&&Buffer.byteLength(req.url)<=limits.maxUrlBytes,'ISOLATED_HOST_URL_LIMIT');
          const query=req.url.includes('?')?req.url.slice(req.url.indexOf('?')+1):'';
          requireValue(!query||query.split('&').length<=limits.maxQueryFields,'ISOLATED_HOST_QUERY_LIMIT');
          requireValue(req.headers['transfer-encoding']===undefined,'ISOLATED_HOST_LENGTH_REQUIRED');
          const length=req.headers['content-length'];
          requireValue(length===undefined||typeof length==='string'&&/^(?:0|[1-9][0-9]*)$/.test(length)&&Number(length)<=limits.maxBodyBytes,'ISOLATED_HOST_BODY_LIMIT');
          counts.admitted++;
          const deadline=setTimeout(()=>{counts.requestTimeouts++;req.destroy();res.destroy();},limits.requestTimeoutMs);
          const finish=()=>clearTimeout(deadline);res.once('finish',finish);res.once('close',finish);
          const operation=Promise.resolve().then(()=>{ready();return wrapped[surface](req,res);});work.add(operation);
          operation.catch(error=>{lastCode=code(error);send(res,503,'ISOLATED_HOST_UNAVAILABLE');}).finally(()=>{work.delete(operation);if(counts.requests>=limits.maxRequests&&!work.size)void stop('REQUEST_LIMIT');});
        }catch(error){counts.rejected++;lastCode=code(error);send(res,/BODY_LIMIT/.test(lastCode)?413:/HEADERS_LIMIT/.test(lastCode)?431:429,lastCode);if(counts.requests>=limits.maxRequests)void stop('REQUEST_LIMIT');}
      });
      server.maxHeadersCount=limits.maxHeaders+1;server.maxRequestsPerSocket=limits.maxRequests;server.maxConnections=limits.maxConnections;
      server.on('connection',socket=>{if(sockets.size>=limits.maxConnections||closePromise){counts.connectionRefusals++;socket.destroy();return;}sockets.add(socket);socket.setTimeout(limits.requestTimeoutMs,()=>socket.destroy());socket.once('close',()=>sockets.delete(socket));});
      server.on('clientError',(_error,socket)=>socket.destroy());
      server.on('checkContinue',(req,res)=>send(res,417,'ISOLATED_HOST_EXPECTATION_REFUSED'));
      server.on('checkExpectation',(req,res)=>send(res,417,'ISOLATED_HOST_EXPECTATION_REFUSED'));
      server.on('upgrade',(req,socket)=>socket.destroy());server.on('connect',(req,socket)=>socket.destroy());
      server.on('error',error=>{lastCode=code(error);if(phase==='RUNNING')void stop('LISTENER_ERROR');});
      servers.set(surface,server);
      await new Promise((resolve,reject)=>{const fail=error=>{server.removeListener('listening',listen);reject(error);},listen=()=>{server.removeListener('error',fail);resolve();};server.once('error',fail);server.once('listening',listen);server.listen(0,'127.0.0.1');});
      ready();const address=server.address();requireValue(address?.address==='127.0.0.1'&&address.port!==8070&&!Object.values(addresses).some(item=>item.port===address.port),'ISOLATED_HOST_LISTENER_REFUSED');addresses[surface]=Object.freeze({...address});
    }
    ready();phase='RUNNING';
    return Object.freeze({addresses:Object.freeze(addresses),closed,close:()=>stop(),async snapshot(){return {phase,reason,lastCode,limits:{...limits},startedAt,expiresAt,counts:{...counts},activeHandlers:work.size,openConnections:sockets.size,listeners:Object.fromEntries([...servers].map(([surface,server])=>[surface,{...addresses[surface],listening:server.listening}])),composition:composition.status(),fixture:await fixture.snapshot(),productionReady:false,saleAuthorityAvailable:false};}});
  }catch(error){lastCode=code(error);await stop('START_FAILED');throw error;}
}
