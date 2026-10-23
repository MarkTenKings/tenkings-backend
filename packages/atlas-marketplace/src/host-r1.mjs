import { createR1MarketplaceAuthBridge, assertMarketplaceSignedTarget } from './auth-r1.mjs';
import { createPostgresStore } from './store-postgres.mjs';
import { createMarketplacePilot } from './service.mjs';
import { createMarketplaceNodeHandler } from './runtime-node.mjs';
import { createMarketplacePublicNodeHandler } from './runtime-public-node.mjs';
import { createRecoverySettlementCapability } from './recovery-settlement.mjs';
import { createR1AuthorityCompatibilityAdapter } from './authority-r1.mjs';
import { authorityContext } from './authority-context.mjs';
import { clone, hash, requireValue } from './contract.mjs';
import {instantiateMarketplaceCommerce} from './commerce-runtime.mjs';
import {instantiateMarketplacePhysical} from './physical-runtime.mjs';

const check = condition => requireValue(condition, 'R1_HOST_UNAVAILABLE');
const ref = value => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 500;
const mount = value => typeof value === 'string' && /^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\/$/.test(value);
const path = value => typeof value === 'string' && /^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(value);
const immutable = value => {if(value&&typeof value==='object'){for(const child of Object.values(value))immutable(child);Object.freeze(value);}return value;};
const syncReady = (port,binding) => {
  check(typeof port === 'function'); const result = port(binding);
  if (result && typeof result.then === 'function') { void Promise.resolve(result).catch(()=>{}); check(false); }
  check(result === true);
};

/** Explicit, known canonical imports only. Never calls either R1 runtime(),
 * discovers environment or constructs their auth/database clients. Importing
 * this module alone does not even load these optional R1 dependencies. */
export async function loadR1CanonicalAuth() {
  const [staff,customer,database,boundary,routes] = await Promise.all([
    import('../../../frontend/atlas-app/lib/server/access/auth.mjs'),
    import('../../../frontend/atlas-customer/lib/server/auth.mjs'),
    import('../../../frontend/atlas-customer/lib/server/database.mjs'),
    import('../../atlas-manual-service/src/staff-auth.mjs'),
    import('../../../frontend/atlas-app/lib/routes.mjs'),
  ]);
  return Object.freeze({ DurableStaffAuth:staff.DurableStaffAuth, CustomerAuth:customer.CustomerAuth,
    CustomerDatabase:database.CustomerDatabase, createDurableStaffBoundary:boundary.createDurableStaffBoundary, STAFF_BASE_PATH:routes.STAFF_BASE_PATH });
}

const send = (res,status,body,headers={}) => {res.writeHead(status,{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Type':'application/json',...headers});res.end(Buffer.isBuffer(body)?body:JSON.stringify(body));};

/** Candidate composition, disabled by default. No listening, route registration,
 * pool creation, migration, grants, recovery timer, provider I/O or auth bootstrap.
 * Existing canonical R1 states and a separately provisioned PG pool are required.
 * The returned dependencies are server capabilities and never HTTP response data.
 */
export async function createR1MarketplaceHost(options={}) {
  if(options.enabled!==true) return Object.freeze({status:()=>({enabled:false,reason:'R1_HOST_DISABLED'}),close(){}});
  const {config,r1,database,marketplace,assertRuntimeReady,clock=Date.now}=options;
  check(config&&r1&&database&&marketplace&&['PROVIDER_SANDBOX','PRODUCTION'].includes(config.environment));
  check(config.origin==='https://atlasgrading.com'&&ref(config.approvalRef)&&config.approved===true);
  check(config.authPolicy?.approved===true&&ref(config.authPolicy.approvalRef)&&config.authPolicy.environment===config.environment
    &&Array.isArray(config.authPolicy.staffRoles)&&config.authPolicy.staffRoles.length===1&&config.authPolicy.staffRoles[0]==='REVIEWER'
    &&Array.isArray(config.authPolicy.customerRoles)&&config.authPolicy.customerRoles.length>0&&config.authPolicy.customerRoles.every(role=>['BUYER','SELLER'].includes(role))
    &&new Set(config.authPolicy.customerRoles).size===config.authPolicy.customerRoles.length
    &&(config.environment!=='PRODUCTION'||config.authPolicy.r1Mode==='PRODUCTION'));
  check(marketplace.runtimeApproval?.approved===true&&marketplace.financePolicy?.environment===(config.environment==='PRODUCTION'?'stripe-production':'stripe-sandbox'));
  const configHash=hash(config),env=config.environment;
  const canonical=await loadR1CanonicalAuth();
  const staffState=r1.staffState,customerState=r1.customerState,manualClient=r1.manualClient,publicConfig=r1.publicConfig;
  check(staffState?.auth instanceof canonical.DurableStaffAuth&&customerState?.auth instanceof canonical.CustomerAuth
    &&customerState.auth.database instanceof canonical.CustomerDatabase&&manualClient?.$transaction);
  check(staffState.auth.config.origin===config.origin&&customerState.config===customerState.auth.config&&customerState.config.origin===config.origin);
  check(staffState.auth.config.basePath===canonical.STAFF_BASE_PATH&&['PRODUCTION','LOCAL_FIXTURE'].includes(config.authPolicy?.r1Mode)
    &&staffState.auth.config.mode===config.authPolicy.r1Mode&&customerState.config.mode===config.authPolicy.r1Mode);
  check(publicConfig?.origin===config.origin&&publicConfig.mode===config.authPolicy.r1Mode);
  const routes=config.routes;
  check(routes&&mount(routes.public?.mountPath)&&path(routes.public.catalogPath)&&routes.public.mountPath.startsWith('/marketplace/')
    &&routes.public.catalogPath.startsWith('/marketplace/'));
  for(const role of ['buyer','seller','staff']) check(mount(routes[role]?.mountPath)&&path(routes[role].apiPath)
    &&routes[role].mountPath.startsWith(role==='staff'?canonical.STAFF_BASE_PATH+'/':'/account/')
    &&routes[role].apiPath.startsWith(routes[role].mountPath));
  check(new Set(Object.values(routes).map(row=>row.mountPath)).size===4&&new Set([routes.public.catalogPath,...['buyer','seller','staff'].map(role=>routes[role].apiPath)]).size===4);
  check(typeof r1.admitRequest==='function'&&typeof r1.admitPublicRequest==='function');
  check(database.pool?.connect&&database.pool!==manualClient&&database.pool!==customerState.auth.database.client&&database.pool!==staffState.auth.database.client);
  for(const auth of [staffState.auth,customerState.auth]) {
    // Compare only parsed database names; credentials are neither retained in
    // the public binding nor logged. An absent URL is not dedicated-storage proof.
    let name;try{name=decodeURIComponent(new URL(auth.config.databaseUrl).pathname.slice(1));}catch{check(false);}
    check(name&&name!==database.expectedDatabase);
  }
  const context=authorityContext(marketplace.context);
  check(context.environment===env&&context.evidenceOrigin===config.origin&&typeof marketplace.assertRuntimeReady==='function');
  const marketBinding={environment:env,platformAccountId:marketplace.platformAccountId,listingPolicyHash:hash(marketplace.listingPolicy),financePolicyHash:hash(marketplace.financePolicy),fulfillmentPolicyHash:hash(marketplace.fulfillmentPolicy),qualificationRefs:context.qualificationRefs};
  const authBinding=state=>({mode:state.auth.config.mode,origin:state.auth.config.origin,deploymentId:state.auth.config.deploymentId,releaseSha:state.auth.config.releaseSha,configHash:state.auth.config.configHash});
  const publicBinding=()=>({mode:publicConfig.mode,origin:publicConfig.origin,deploymentId:publicConfig.deploymentId,releaseSha:publicConfig.releaseSha,configHash:publicConfig.configHash});
  const deploymentHosts={buyer:customerState.config.deploymentHost,seller:customerState.config.deploymentHost,staff:staffState.auth.config.deploymentId,public:publicConfig.deploymentId};
  if(config.authPolicy.r1Mode==='PRODUCTION') check(Object.values(deploymentHosts).every(value=>typeof value==='string'&&/^[a-z0-9-]+\.vercel\.app$/.test(value)));
  const r1Pin=()=>hash([authBinding(staffState),authBinding(customerState),publicBinding(),customerState.config.deploymentHost??null,staffState.auth.config.basePath,staffState.auth.config.cookies,customerState.config.cookies]);
  const configIntegrity=value=>hash([value.mode,value.origin,value.deploymentId,value.releaseSha,value.configHash,value.databaseUrl??null,value.binding??null,value.cookies??null,value.basePath??null,value.deploymentHost??null,
    Buffer.isBuffer(value.sessionKey)?value.sessionKey.toString('hex'):null,Buffer.isBuffer(value.routerKey)?value.routerKey.toString('hex'):null,value.phoneByHash instanceof Map?[...value.phoneByHash.entries()]:null]);
  const staffAuth=staffState.auth,customerAuth=customerState.auth,staffConfig=staffAuth.config,customerConfig=customerAuth.config;
  const canonicalMethods=[canonical.DurableStaffAuth.prototype.authenticate,canonical.DurableStaffAuth.prototype.withStaff,canonical.DurableStaffAuth.prototype.digest,canonical.CustomerAuth.prototype.authority,canonical.CustomerAuth.prototype.digest,canonical.CustomerDatabase.prototype.call];
  const r1Ports=[staffState.assertRequest,customerState.assertRequest,staffAuth.database,customerAuth.database,staffAuth.database.client,customerAuth.database.client];
  const configIntegrityPin=hash([configIntegrity(staffConfig),configIntegrity(customerConfig)]);
  const pinnedR1=r1Pin(),pool=database.pool,connect=pool.connect,provider=marketplace.provider,marketReady=marketplace.assertRuntimeReady;
  const marketPorts=Object.fromEntries(['context','provider','quoteProvider','destinations','taxLifecycle','createCommercePorts','commerceConfig','proofIntake','shippingLifecycle','createPhysicalPorts','physicalConfig','feeCalculator','instantPolicy','assertInstantPayoutReady','quoteInstantPayoutFee','readInstantFeeSettlement','sellerAccount','onboarding','readEvidence','validateEvidence','webhook','runtimeApproval','assertRuntimeReady'].map(key=>[key,marketplace[key]]));
  const physicalHash=marketplace.physicalConfig?hash(marketplace.physicalConfig):null;
  if(marketplace.createPhysicalPorts)check(physicalHash&&marketplace.createPhysicalPorts.binding?.configHash===physicalHash&&!marketplace.proofIntake&&!marketplace.shippingLifecycle);
  const commerceHash=marketplace.commerceConfig?hash(marketplace.commerceConfig):null;
  if(marketplace.createCommercePorts)check(commerceHash&&marketplace.createCommercePorts.binding?.configHash===commerceHash&&!marketplace.quoteProvider&&!marketplace.destinations&&!marketplace.taxLifecycle);
  const webhookPin=()=>marketplace.webhook?hash({secret:marketplace.webhook.secret??null,endpoints:marketplace.webhook.endpoints??null,ingress:marketplace.webhook.ingress??null,allowedConnectedAccountIds:marketplace.webhook.allowedConnectedAccountIds??null}):null;
  const approvalPin=hash(marketplace.runtimeApproval),pinnedWebhook=webhookPin(),disputePolicy=marketplace.webhook?.resolveDisputePolicy;
  const databasePin=()=>hash([database.expectedRole,database.expectedDatabase,database.expectedFunctionOwner]);const pinnedDatabase=databasePin();
  const binding=immutable({schema:'atlas-r1-marketplace-host-v1',environment:env,origin:config.origin,approvalRef:config.approvalRef,
    configHash,database:{role:database.expectedRole,name:database.expectedDatabase,functionOwner:database.expectedFunctionOwner},
    staff:authBinding(staffState),customer:authBinding(customerState),public:publicBinding(),marketplace:clone(marketBinding)});
  let closed=false,handlers=null,finance=null;
  const marketPin=hash(marketBinding),admitPublicRequest=r1.admitPublicRequest,admitRequest=r1.admitRequest;
  function current() {
    check(!closed&&options.enabled===true&&options.config===config&&hash(config)===configHash&&options.r1===r1&&options.database===database&&options.marketplace===marketplace
      &&r1.staffState===staffState&&r1.customerState===customerState&&r1.manualClient===manualClient&&r1.publicConfig===publicConfig&&r1Pin()===pinnedR1
      &&r1.admitPublicRequest===admitPublicRequest&&r1.admitRequest===admitRequest&&database.pool===pool&&pool.connect===connect&&databasePin()===pinnedDatabase&&marketplace.provider===provider&&marketplace.assertRuntimeReady===marketReady);
    check(staffState.auth===staffAuth&&customerState.auth===customerAuth&&staffAuth.config===staffConfig&&customerAuth.config===customerConfig&&customerState.config===customerConfig
      &&hash([configIntegrity(staffConfig),configIntegrity(customerConfig)])===configIntegrityPin);
    check([staffState.assertRequest,customerState.assertRequest,staffAuth.database,customerAuth.database,staffAuth.database.client,customerAuth.database.client].every((value,index)=>value===r1Ports[index])
      &&[canonical.DurableStaffAuth.prototype.authenticate,canonical.DurableStaffAuth.prototype.withStaff,canonical.DurableStaffAuth.prototype.digest,canonical.CustomerAuth.prototype.authority,canonical.CustomerAuth.prototype.digest,canonical.CustomerDatabase.prototype.call].every((value,index)=>value===canonicalMethods[index]));
    check(Object.entries(marketPorts).every(([key,value])=>marketplace[key]===value)&&(!physicalHash||hash(marketplace.physicalConfig)===physicalHash)&&(!commerceHash||hash(marketplace.commerceConfig)===commerceHash)&&hash(marketplace.runtimeApproval)===approvalPin&&webhookPin()===pinnedWebhook&&marketplace.webhook?.resolveDisputePolicy===disputePolicy);
    check(hash({...marketBinding,listingPolicyHash:hash(marketplace.listingPolicy),financePolicyHash:hash(marketplace.financePolicy),fulfillmentPolicyHash:hash(marketplace.fulfillmentPolicy)})===marketPin
      &&marketplace.runtimeApproval?.approved===true&&hash(marketplace.runtimeApproval.binding)===marketPin);
    syncReady(assertRuntimeReady,binding);
    syncReady(marketplace.assertRuntimeReady,marketBinding);
  }
  current();
  const store=createPostgresStore({...database,environment:env,clock,enabled:true});
  let commerce=null,physical=null;
  try {
  let settlementCapability;
  if(config.settlement?.enabled===true) {
    check(ref(config.settlement.approvalRef)&&typeof options.assertSettlementReady==='function');
    settlementCapability=createRecoverySettlementCapability({enabled:true,store,environment:env,platformAccountId:marketplace.platformAccountId,
      approvalRef:config.settlement.approvalRef,assertRuntimeReady:scope=>{current();return options.assertSettlementReady(scope);}});
  } else check(config.settlement===undefined||config.settlement===null||config.settlement.enabled===false);
  if(marketplace.createCommercePorts)commerce=instantiateMarketplaceCommerce(marketplace.createCommercePorts,{store,context,environment:env,platformAccountId:marketplace.platformAccountId,clock});
  if(marketplace.createPhysicalPorts)physical=instantiateMarketplacePhysical(marketplace.createPhysicalPorts,{store,context,environment:env,clock});
  const service=createMarketplacePilot({...marketplace,...(physical?{proofIntake:physical.proofIntake,shippingLifecycle:physical.shippingLifecycle}:{}),...(commerce?{quoteProvider:commerce.quoteProvider,destinations:commerce.destinations,taxLifecycle:commerce.taxLifecycle}:{}),enabled:true,environment:env,store,clock,recoverySettlementCapability:settlementCapability,
    // R1 has not supplied qualified title/custody/Fingerprint sale authority.
    // No configuration ref or collection label may promote this candidate.
    eligibility:createR1AuthorityCompatibilityAdapter(),
    assertRuntimeReady:scope=>{current();return marketplace.assertRuntimeReady(scope);}});
  const boundary=canonical.createDurableStaffBoundary({auth:staffState.auth,manualClient});
  const bridge=createR1MarketplaceAuthBridge({enabled:true,environment:env,policy:config.authPolicy,
    staff:{state:staffState,boundary,DurableStaffAuth:canonical.DurableStaffAuth},
    customer:{state:customerState,CustomerAuth:canonical.CustomerAuth,CustomerDatabase:canonical.CustomerDatabase},
    admitRequest:r1.admitRequest,clock,requestTtlMs:config.requestTtlMs??30000,maxDatabaseClockSkewMs:config.maxDatabaseClockSkewMs??0});
  return Object.freeze({store,provider,service,settlementCapability,binding,
    status(){let enabled=false;try{current();enabled=true;}catch{}return {enabled,environment:env,claimsEnabled:false,historyEnabled:false,saleAuthorityAvailable:false};},
    async createHandlers({finance:hostedFinance}={}) {
      current();check(handlers===null);
      if(hostedFinance) {
        const {assertHostedFinanceBinding}=await import('./host-finance.mjs');
        assertHostedFinanceBinding(hostedFinance,{store,provider,service,settlementCapability,environment:env,platformAccountId:marketplace.platformAccountId});
        finance=hostedFinance;
      }
      current();
      const allowedHosts=role=>[...new Set([new URL(config.origin).host,...(config.authPolicy.r1Mode==='PRODUCTION'?[deploymentHosts[role]]:[])])];
      const catalog=createMarketplacePublicNodeHandler({enabled:true,origin:config.origin,...routes.public,acceptedHosts:allowedHosts('public'),customerPath:routes.buyer.mountPath,service,
        admitPublicRequest:async input=>{current();return r1.admitPublicRequest(input);}});
      const nodes={};
      for(const role of ['buyer','seller','staff']) {
        const node=createMarketplaceNodeHandler({enabled:true,origin:config.origin,...routes[role],service,clock,
        acceptedHosts:allowedHosts(role),
        createAuthContext:request=>{current();return bridge.open(request,{audience:role.toUpperCase()});},
        ...(role==='staff'&&finance?{receiveProviderWebhook:input=>{current();return finance.receiveProviderWebhook(input);}}:{})});
        nodes[role]=Object.freeze({close:node.close,async listener(req,res){
          try {
            current();
            const pathname=typeof req.url==='string'?req.url.split('?')[0]:'';
            if(req.method==='GET'&&!pathname.startsWith(routes[role].apiPath+'/')) {
              // Static private shell also retains signed R1 ingress. The auth
              // bridge performs the sole admission on API requests separately.
              const state=role==='staff'?staffState:customerState;
              check(typeof state.assertRequest==='function');const admitted=state.assertRequest(req);
              if(admitted&&typeof admitted.then==='function'){void Promise.resolve(admitted).catch(()=>{});check(false);}check(admitted===undefined);assertMarketplaceSignedTarget(req,{mode:state.auth.config.mode});current();
            }
            return node.listener(req,res);
          } catch {return send(res,503,{error:'R1_HOST_UNAVAILABLE'});}
        }});
      }
      const listener=async(req,res)=>{
        try {
          current();check(typeof req.url==='string'&&req.url.length<=8192&&req.url.startsWith('/')&&!/[\\#\s]/.test(req.url));
          const pathname=req.url.split('?')[0];
          check(!pathname.includes('%')&&!pathname.includes('//')&&!/(?:^|\/)\.{1,2}(?:\/|$)/.test(pathname));
          // Whole fixed mounts only. Never rewrite URL, signed headers, socket,
          // cookies or raw body before canonical admission.
          if(pathname===routes.public.catalogPath||pathname.startsWith(routes.public.mountPath)) return catalog.listener(req,res);
          const role=['seller','buyer','staff'].find(name=>pathname.startsWith(routes[name].mountPath));
          if(!role)return send(res,404,{error:'NOT_FOUND'});
          return nodes[role].listener(req,res);
        } catch {return send(res,503,{error:'R1_HOST_UNAVAILABLE'});}
      };
      handlers=Object.freeze({listener,publicCatalog:catalog,...nodes});return handlers;
    },
    async close(){if(closed)return;closed=true;handlers?.publicCatalog.close();for(const role of ['buyer','seller','staff'])handlers?.[role].close();try{await finance?.stop();}finally{await physical?.close();commerce?.close();store.close();}},
  });
  } catch(error) {try{await physical?.close();commerce?.close();}finally{store.close();}throw error;}
}
