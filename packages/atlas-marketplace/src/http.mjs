import { requireValue } from './contract.mjs';
import { createMarketplaceHostCheck } from './host-boundary.mjs';

const commands = Object.freeze({
  '/consent':['SELLER','recordConsent',['requestId','cardId','choice','evidenceRef']],
  '/listings':['SELLER','publishListing',['requestId','cardId','askingPriceCents']],
  '/listings/revise':['SELLER','reviseListing',['requestId','listingId','expectedVersion','expectedBindingHash','askingPriceCents']],
  '/listings/withdraw':['SELLER','withdrawListing',['requestId','listingId','expectedVersion','expectedBindingHash']],
  '/reservations':['BUYER','reserve',['requestId','listingId','listingVersion','listingHash','quoteId']],
  '/reservations/cancel':['BUYER','cancelReservation',['requestId','reservationId']],
  '/payments':['BUYER','pay',['reservationId']],
  '/payments/collection':['BUYER','paymentCollection',['reservationId']],
  '/onboarding':['SELLER','onboard',[]],
  '/payments/reconcile':['BUYER','reconcilePayment',['reservationId']],
  '/fulfillment':['STAFF','fulfill',['requestId','orderId','action','evidence']],
  '/transfers/reconcile':['STAFF','resumeTransfer',['orderId']],
  '/withdrawals':['SELLER','withdraw',['requestId','amountCents','externalAccountId']],
  '/withdrawals/reconcile':['SELLER','reconcileWithdrawal',['intentId']],
  '/cases':['BUYER,SELLER,STAFF','openCase',['requestId','caseId','orderId','kind','evidenceRef']],
  '/cases/refund':['STAFF','refundCase',['orderId','caseId','amountCents','allocations','reviewRef']],
  '/cases/refund/reconcile':['STAFF','reconcileRefund',['orderId','caseId']],
  '/staff/reconcile':['STAFF','reconcileFinance',['intentIds','limit']],
  '/cases/resolve':['STAFF','resolveCase',['requestId','orderId','caseId','outcome','evidence']],
});
const baseHeaders=Object.freeze({'Cache-Control':'no-store','Content-Type':'application/json','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
const result=(status,body)=>({status,headers:{...baseHeaders},body});

// Inert framework-neutral handler. resolveSession and verifyCsrf are server-only
// R1 integration ports: no browser-provided actor, role, mode or session is used.
export function createMarketplaceHttpHandler({ enabled=false, origin, acceptedHosts, apiPath='/api/marketplace', service, resolveSession, verifyCsrf, issueCsrf, admitRequest, createAuthContext, clock=Date.now }={}) {
  const acceptsHost=enabled===true?createMarketplaceHostCheck({origin,acceptedHosts}):()=>false;
  let closed=false;
  return Object.freeze({ close(){closed=true;}, async handle(request){
    if(closed || enabled!==true) return result(503,{error:'MARKETPLACE_DISABLED'});
    let auth;
    try {
      const url=new URL(request.url,origin), headers=request.headers??{}, method=request.method;
      requireValue(url.origin===origin&&acceptsHost(headers.host),'HOST_REFUSED');
      requireValue(!headers.origin||headers.origin===origin,'ORIGIN_REFUSED');
      requireValue(!headers['sec-fetch-site']||['none','same-origin'].includes(headers['sec-fetch-site']),'CROSS_SITE_REFUSED');
      requireValue(/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(apiPath),'ROUTE_CONFIGURATION_UNAVAILABLE');
      const path=url.pathname.startsWith(apiPath+'/')?url.pathname.slice(apiPath.length):url.pathname;
      requireValue(path!==url.pathname&&!path.includes('%')&&!url.hash,'NOT_FOUND');
      // Preserve the original path/body for R1's signed ingress guard. The
      // request-scoped bridge retains its opaque session handle privately.
      auth=typeof createAuthContext==='function'?await createAuthContext(request):{resolveSession,verifyCsrf,issueCsrf,admitRequest};
      requireValue(typeof auth?.resolveSession==='function'&&typeof auth.verifyCsrf==='function'&&typeof auth.admitRequest==='function'&&(typeof createAuthContext!=='function'||typeof auth.withAuthorized==='function'),'AUTH_BOUNDARY_UNAVAILABLE');
      const principal=await auth.resolveSession({cookie:headers.cookie??'',method,path});
      requireValue(principal?.authenticated===true&&Number.isSafeInteger(principal.expiresAt)&&principal.expiresAt>clock()&&typeof principal.sessionId==='string'&&principal.actor&&['BUYER','SELLER','STAFF'].includes(principal.actor.role),'SIGN_IN_REQUIRED');
      requireValue(await auth.admitRequest({sessionId:principal.sessionId,actorId:principal.actor.id,method,path}),'RATE_LIMITED');
      if(method==='POST') requireValue(headers.origin===origin&&await auth.verifyCsrf({principal,token:headers['x-atlas-csrf']??'',method,path}),'CSRF_REFUSED');
      const dispatch=async(actor=principal.actor)=>{
      if(method==='GET') {
        requireValue(!request.rawBody?.length,'INVALID_REQUEST');
        if(path==='/workspace') { requireValue(url.search==='','INVALID_REQUEST'); requireValue(typeof auth.issueCsrf==='function','AUTH_BOUNDARY_UNAVAILABLE'); const csrfToken=await auth.issueCsrf(principal); requireValue(typeof csrfToken==='string'&&csrfToken.length>=32,'AUTH_BOUNDARY_UNAVAILABLE'); return result(200,{...await service.workspace(actor),csrfToken}); }
        if(path==='/catalog') return result(200,await service.catalog(actor,parseCatalogFilters(url.searchParams)));
        if(path.startsWith('/evidence/')) {
          requireValue(!url.search,'INVALID_REQUEST');
          const evidence=await service.evidence(actor,url.pathname);
          requireValue(evidence?.authorized===true&&Buffer.isBuffer(evidence.bytes)&&evidence.bytes.length<=10485760&&['image/png','image/jpeg','image/webp','application/pdf'].includes(evidence.contentType),'EVIDENCE_UNAVAILABLE');
          return {status:200,headers:{...baseHeaders,'Content-Type':evidence.contentType,'Content-Security-Policy':"default-src 'none'; sandbox"},body:evidence.bytes};
        }
        if(path==='/quote') { requireValue(actor.role==='BUYER'&&[...url.searchParams.keys()].length===1&&url.searchParams.has('listingId'),'FORBIDDEN'); return result(200,await service.quote(actor,url.searchParams.get('listingId'))); }
        if(path==='/staff/queue') { requireValue(actor.role==='STAFF','FORBIDDEN'); requireValue([...url.searchParams.keys()].every(key=>['status','kind','query','offset','limit'].includes(key))&&new Set(url.searchParams.keys()).size===[...url.searchParams.keys()].length,'FILTER_INVALID'); return result(200,await service.staffQueue(actor,Object.fromEntries(url.searchParams))); }
        if(path==='/staff/metrics') { requireValue(actor.role==='STAFF'&&url.search==='','FORBIDDEN'); return result(200,await service.metrics(actor)); }
        requireValue(false,'NOT_FOUND');
      }
      requireValue(method==='POST','METHOD_NOT_ALLOWED');
      requireValue(url.search===''&&headers['content-type']?.split(';')[0]==='application/json'&&Buffer.isBuffer(request.rawBody)&&request.rawBody.length<=16384,'INVALID_REQUEST');
      let input; try {input=JSON.parse(request.rawBody.toString('utf8'));}catch{requireValue(false,'INVALID_JSON');}
      const command=commands[path]; requireValue(command,'NOT_FOUND');
      const [roles,name,keys]=command; requireValue(roles.split(',').includes(actor.role),'FORBIDDEN');
      requireValue(input&&Object.getPrototypeOf(input)===Object.prototype&&Object.keys(input).every(key=>keys.includes(key)),'INVALID_REQUEST');
      const output=await service[name](actor,input);
      if(name==='paymentCollection'||name==='onboard'||name==='reconcileFinance') return result(200,output);
      return result(200,Object.fromEntries(['id','orderId','reservationId','status','version','bindingHash','outcome','kind','confirmed'].filter(key=>output?.[key]!==undefined).map(key=>[key,output[key]])));
      };
      return typeof auth.withAuthorized==='function'?await auth.withAuthorized(principal,dispatch):await dispatch();
    }catch(error){
      const code=error.code??'REQUEST_FAILED';
      const status=code==='SIGN_IN_REQUIRED'?401:code==='NOT_FOUND'?404:code==='METHOD_NOT_ALLOWED'?405:code==='RATE_LIMITED'?429:/REFUSED|FORBIDDEN/.test(code)?403:/UNAVAILABLE|DISABLED/.test(code)?503:409;
      return result(status,{error:code});
    } finally {auth?.close?.();}
  }});
}

export function parseCatalogFilters(params) {
  const filters={};
  for(const [key,value] of params) {
    requireValue(!Object.hasOwn(filters,key),'FILTER_INVALID');
    if(['minPriceCents','maxPriceCents','numberedDenominator','offset','limit'].includes(key)) {requireValue(/^(0|[1-9][0-9]*)$/.test(value),'FILTER_INVALID'); filters[key]=Number(value);}
    else if(key==='grade') {requireValue(/^(?:[0-9](?:\.[0-9]+)?|10(?:\.0+)?)$/.test(value),'FILTER_INVALID');filters[key]=Number(value);}
    else if(['autograph','relic'].includes(key)) {requireValue(['true','false'].includes(value),'FILTER_INVALID'); filters[key]=value==='true';}
    else {requireValue(['listingId','query','category','year','set'].includes(key),'FILTER_INVALID');filters[key]=value;}
  }
  return filters;
}
