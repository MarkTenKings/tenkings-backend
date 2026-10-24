import {createR1MarketplaceHost} from './host-r1.mjs';
import {createHostedFinance} from './host-finance.mjs';
import {hash, requireValue} from './contract.mjs';

// The canonical URI stays intact through every layer, including signed ingress.
// These mounts are already inside the existing staff/customer cookie scopes.
export const R1_MARKETPLACE_ROUTES=Object.freeze({
  public:Object.freeze({mountPath:'/marketplace/',catalogPath:'/marketplace/catalog'}),
  buyer:Object.freeze({mountPath:'/account/marketplace/',apiPath:'/account/marketplace/api'}),
  seller:Object.freeze({mountPath:'/account/marketplace/seller/',apiPath:'/account/marketplace/seller/api'}),
  staff:Object.freeze({mountPath:'/admin/marketplace/',apiPath:'/admin/marketplace/api'}),
});
const unavailable=res=>{res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end('{"error":"MARKETPLACE_UNAVAILABLE"}');};
const allRoots=['/marketplace','/account/marketplace','/admin/marketplace'];
function selected(url,surface) {
  if(typeof url!=='string'||url.length>8192||!url.startsWith('/')||/[\\#\s%]/.test(url.split('?')[0]))return false;
  const path=url.split('?')[0];
  const roots=surface==='public'?allRoots.slice(0,1):surface==='customer'?allRoots.slice(1,2):allRoots.slice(2);
  return roots.some(root=>path===root||path.startsWith(root+'/'));
}

/** Unregistered Node/Next raw-request composition. wrap() surrounds the supplied
 * existing handler; unrelated requests are forwarded with their original object
 * identities, body stream, headers, URI and socket. No env lookup or pool creation.
 * Import, construction and cold fallback never bootstrap canonical auth or jobs.
 * A hosting app must explicitly register the returned wrapper with raw bodies;
 * a JSON body-parser or rewritten URI is not compatible with signed ingress.
 */
export function createR1MarketplaceRouteComposition(options={}) {
  const enabled=options.enabled===true,hostOptions=options.host,financeOptions=options.finance;
  const nonPayment=hostOptions?.config?.operatingMode==='NON_PAYMENT';
  const maxConcurrent=options.maxConcurrent??16;
  if(enabled)requireValue(Number.isSafeInteger(maxConcurrent)&&maxConcurrent>=1&&maxConcurrent<=100,'R1_ROUTE_CONFIGURATION_INVALID');
  let closed=false,initialization=null,host=null,finance=null,active=0,closePromise=null;
  const drained=new Set();
  function current() {
    requireValue(enabled&&!closed&&options.enabled===true&&options.host===hostOptions&&options.finance===financeOptions,'R1_ROUTES_UNAVAILABLE');
    if(nonPayment)requireValue(financeOptions==null,'NON_PAYMENT_OWNER_REFUSED');
    requireValue(hostOptions?.enabled===true&&hash(hostOptions.config?.routes)===hash(R1_MARKETPLACE_ROUTES),'R1_ROUTE_CONFIGURATION_INVALID');
  }
  async function initialize() {
    current();
    if(!initialization)initialization=(async()=>{
      const owned=await createR1MarketplaceHost(hostOptions);host=owned;
      try {
        current();
        if(financeOptions?.enabled===true) {
          requireValue(!['store','provider','service','settlementCapability'].some(key=>Object.hasOwn(financeOptions,key)),'R1_ROUTE_CONFIGURATION_INVALID');
          finance=createHostedFinance({...financeOptions,store:owned.store,provider:owned.provider,service:owned.service,settlementCapability:owned.settlementCapability});
        }
        const handlers=await owned.createHandlers({finance});current();return handlers;
      }catch(error){await owned.close();throw error;}
    })();
    const handlers=await initialization;current();return handlers;
  }
  return Object.freeze({
    wrap(surface,existingHandler) {
      requireValue(['public','customer','staff'].includes(surface)&&typeof existingHandler==='function','R1_ROUTE_CONFIGURATION_INVALID');
      return async(req,res)=>{
        // Cold routes remain the existing application's responsibility. We do
        // not even inspect their request/configuration or catch their failures.
        if(!enabled||!selected(req.url,surface))return existingHandler(req,res);
        if(closed||active>=maxConcurrent)return unavailable(res);
        active++;
        try {const handlers=await initialize();return await handlers.listener(req,res);}
        catch {if(!res.headersSent)return unavailable(res);if(!res.writableEnded)res.end();}
        finally {if(--active===0){for(const resolve of drained)resolve();drained.clear();}}
      };
    },
    status(){return {enabled:enabled&&!closed,initialized:!!host,activeRequests:active,financeConfigured:!!finance,claimsEnabled:false,historyEnabled:false};},
    async prepare(){await initialize();return this.status();},
    async financeSnapshot(){await initialize();return finance?finance.snapshot():nonPayment?host.store.read(()=>null):null;},
    async startFinance(){await initialize();if(nonPayment)return{enabled:false,operatingMode:'NON_PAYMENT'};requireValue(finance,'R1_FINANCE_UNAVAILABLE');return finance.start();},
    async stopFinance(){await finance?.stop();},
    close(){
      if(!closePromise){closed=true;closePromise=(async()=>{
        if(active)await new Promise(resolve=>drained.add(resolve));
        try {await initialization;}catch{}
        if(host)await host.close();
      })();}return closePromise;
    },
  });
}
