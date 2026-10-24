import {isIP} from 'node:net';
import {hash} from './contract.mjs';
import {R1_MARKETPLACE_ROUTES} from './routes-r1.mjs';

export const MARKETPLACE_PHYSICAL_RELEASE_SCHEMA='atlas-marketplace-owned-host-v2';
export const MARKETPLACE_RELEASE_SCHEMA='atlas-marketplace-owned-host-v1';
export const MARKETPLACE_EXTERNAL_GATES=Object.freeze({
  routing:'R1 owner must qualify the actual mounted gateways, TLS/proxy and unchanged grading routes.',
  canonicalAuth:'Qualify canonical staff/customer session gateways and least-privilege identities on the target release.',
  database:'Qualify the dedicated database, gateway grants, persistence, backup and restore on the target host.',
  provider:'Qualify the exact provider mode, platform, connected accounts and payout destinations.',
  webhook:'Deliver actual signed platform and connected events through the hosted raw-body route.',
  recovery:'Observe durable recovery across restart and the approved operating schedule.',
  alerts:'Observe delivery and lookup through the qualified operational alert destination.',
  authority:'Supply qualified sale/title/custody authority; configuration cannot promote the unavailable R1 adapter.',
  policy:'Approve and bind fees, returns, timing, transfers, withdrawal and legal policies.',
  fulfillment:'Retain physical custody, inventory, packing, carrier and return evidence.',
  activation:'R1 owner must independently authorize activation of the exact deployed release.'
});
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
const reference=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{0,199}$/.test(value)&&!/(?:sk|rk)_(?:test|live)_|whsec_|postgres(?:ql)?:\/\//i.test(value);
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const surfaces=['public','customer','staff'];
const safeHash=value=>{try{return hash(value);}catch{return null;}};

/** Pure configuration inspection. No assertion, canonical runtime import,
 * credential discovery, network or database access. Reports never echo input
 * values, arbitrary property names, errors, URLs, secrets or stack traces.
 * Evidence references are pointers for an operator, not verification results.
 */
export function inspectMarketplaceReleaseManifest(manifest) {
  const issues=[];
  const add=(path,code)=>issues.push({path,code});
  function closed(value,keys,path) {
    if(!plain(value)){add(path,'OBJECT_REQUIRED');return false;}
    if(Object.keys(value).some(key=>!keys.includes(key)))add(path,'UNKNOWN_FIELDS');
    for(const key of keys)if(!Object.hasOwn(value,key))add(`${path}.${key}`,'FIELD_REQUIRED');
    return true;
  }
  const physical=manifest?.schema===MARKETPLACE_PHYSICAL_RELEASE_SCHEMA,nonPayment=manifest?.operatingMode==='NON_PAYMENT';
  if(closed(manifest,[...(Object.hasOwn(manifest??{},'operatingMode')?['operatingMode']:[]),...(physical?['physicalConfigHash']:[]),'schema','environment','origin','platformAccountId','sourceRevision','releaseRef','bootstrapApprovalRef','networkApprovalRef','hostConfigHash','financeConfigHash','commerceConfigHash','marketplaceBindingHash','listeners','limits','externalEvidence'],'manifest')) {
    if(Object.hasOwn(manifest,'operatingMode')&&!['TRADING','NON_PAYMENT'].includes(manifest.operatingMode))add('manifest.operatingMode','OPERATING_MODE_REQUIRED');
    if(nonPayment&&manifest.environment==='PRODUCTION'&&!physical)add('manifest.schema','PHYSICAL_RELEASE_MANIFEST_REQUIRED');
    if(![MARKETPLACE_RELEASE_SCHEMA,MARKETPLACE_PHYSICAL_RELEASE_SCHEMA].includes(manifest.schema))add('manifest.schema','SCHEMA_MISMATCH');
    if(!['PROVIDER_SANDBOX','PRODUCTION'].includes(manifest.environment))add('manifest.environment','ENVIRONMENT_REQUIRED');
    if(manifest.origin!=='https://atlasgrading.com')add('manifest.origin','CANONICAL_ORIGIN_REQUIRED');
    if(typeof manifest.platformAccountId!=='string'||!/^acct_[A-Za-z0-9]+$/.test(manifest.platformAccountId))add('manifest.platformAccountId','PLATFORM_ACCOUNT_REQUIRED');
    if(typeof manifest.sourceRevision!=='string'||!/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(manifest.sourceRevision))add('manifest.sourceRevision','EXACT_REVISION_REQUIRED');
    for(const key of ['releaseRef','bootstrapApprovalRef','networkApprovalRef'])if(!reference(manifest[key]))add(`manifest.${key}`,'NONSECRET_REFERENCE_REQUIRED');
    for(const key of [...(physical?['physicalConfigHash']:[]),'hostConfigHash',...(!nonPayment?['financeConfigHash','commerceConfigHash']:[]),'marketplaceBindingHash'])if(!digest(manifest[key]))add(`manifest.${key}`,'CONFIGURATION_DIGEST_REQUIRED');
    if(nonPayment&&(manifest.financeConfigHash!==null||manifest.commerceConfigHash!==null))add('manifest','NON_PAYMENT_OWNER_REFUSED');
    if(closed(manifest.listeners,surfaces,'manifest.listeners')) {
      const ports=new Set();
      for(const surface of surfaces) {
        const row=manifest.listeners[surface],path=`manifest.listeners.${surface}`;
        if(!closed(row,['host','port'],path))continue;
        if(typeof row.host!=='string'||!isIP(row.host))add(`${path}.host`,'EXPLICIT_IP_REQUIRED');
        const ephemeral=manifest.environment==='PROVIDER_SANDBOX'&&['127.0.0.1','::1'].includes(row.host)&&row.port===0;
        if(!ephemeral&&(!Number.isSafeInteger(row.port)||row.port<1024||row.port>65535))add(`${path}.port`,'UNPRIVILEGED_PORT_REQUIRED');
        // 8070 belongs to the shared R1 private runtime, never this owned host.
        if(row.port===8070)add(`${path}.port`,'R1_SHARED_PORT_REFUSED');
        if(row.port!==0){if(ports.has(row.port))add(`${path}.port`,'DISTINCT_OWNED_PORT_REQUIRED');ports.add(row.port);}
      }
    }
    const bounds={maxConcurrent:[1,100],maxConnections:[1,10000],requestTimeoutMs:[1000,300000],headersTimeoutMs:[1000,60000],keepAliveTimeoutMs:[100,60000],shutdownGraceMs:[100,300000]};
    if(closed(manifest.limits,Object.keys(bounds),'manifest.limits')) {
      for(const [key,[min,max]]of Object.entries(bounds))if(!Number.isSafeInteger(manifest.limits[key])||manifest.limits[key]<min||manifest.limits[key]>max)add(`manifest.limits.${key}`,'FINITE_BOUND_REQUIRED');
      if(manifest.limits.headersTimeoutMs>manifest.limits.requestTimeoutMs)add('manifest.limits.headersTimeoutMs','HEADER_DEADLINE_EXCEEDS_REQUEST');
    }
    if(closed(manifest.externalEvidence,Object.keys(MARKETPLACE_EXTERNAL_GATES),'manifest.externalEvidence'))for(const key of Object.keys(MARKETPLACE_EXTERNAL_GATES))if(manifest.externalEvidence[key]!==null&&!reference(manifest.externalEvidence[key]))add(`manifest.externalEvidence.${key}`,'NONSECRET_REFERENCE_OR_NULL_REQUIRED');
  }
  const externalGates=Object.entries(MARKETPLACE_EXTERNAL_GATES).map(([id,requirement])=>({id,requirement,evidenceProvided:reference(manifest?.externalEvidence?.[id]),status:nonPayment&&['provider','webhook','alerts','authority','fulfillment'].includes(id)?'NOT_ENABLED':'EXTERNAL_VERIFICATION_REQUIRED'}));
  return {schema:'atlas-marketplace-release-inspection-v1',configurationComplete:issues.length===0,status:issues.length?'CONFIGURATION_INCOMPLETE':'CONFIGURATION_COMPLETE_UNVERIFIED',manifestHash:issues.length?null:safeHash(manifest),issues,externalGates,productionReady:false,saleAuthorityAvailable:false};
}

/** Structural server-port check. prepare() still invokes the actual canonical
 * composition and dedicated-store privilege qualification; this is no substitute.
 */
export function inspectMarketplaceHostInputs(options) {
  const report=inspectMarketplaceReleaseManifest(options?.manifest),issues=[...report.issues];
  const need=(condition,path,code='SERVER_PORT_REQUIRED')=>{if(!condition)issues.push({path,code});};
  const {host,finance,existingHandlers,assertReleaseReady}=options??{},manifest=options?.manifest,nonPayment=manifest?.operatingMode==='NON_PAYMENT';
  need((host?.config?.operatingMode==='NON_PAYMENT')===nonPayment,'host.config.operatingMode','OPERATING_MODE_MISMATCH');
  need(options?.enabled===true,'enabled','EXPLICIT_ENABLEMENT_REQUIRED');
  need(typeof assertReleaseReady==='function','assertReleaseReady');
  for(const surface of surfaces)need(typeof existingHandlers?.[surface]==='function',`existingHandlers.${surface}`);
  need(host?.enabled===true,'host.enabled','EXPLICIT_ENABLEMENT_REQUIRED');
  need(host?.config?.approved===true,'host.config.approved','APPROVAL_REQUIRED');
  need(safeHash(host?.config)===manifest?.hostConfigHash,'host.config','CONFIGURATION_DIGEST_MISMATCH');
  need(host?.config?.environment===manifest?.environment&&host?.config?.origin===manifest?.origin,'host.config','ENVIRONMENT_BINDING_MISMATCH');
  need(safeHash(host?.config?.routes)===hash(R1_MARKETPLACE_ROUTES),'host.config.routes','CANONICAL_ROUTES_REQUIRED');
  need(typeof host?.assertRuntimeReady==='function','host.assertRuntimeReady');
  if(!nonPayment)need(host?.config?.settlement?.enabled===true&&typeof host?.assertSettlementReady==='function','host.config.settlement','SETTLEMENT_CAPABILITY_REQUIRED');
  for(const name of ['staffState','customerState','manualClient','publicConfig'])need(!!host?.r1?.[name],`host.r1.${name}`);
  for(const name of ['admitRequest','admitPublicRequest'])need(typeof host?.r1?.[name]==='function',`host.r1.${name}`);
  need(typeof host?.database?.pool?.connect==='function','host.database.pool.connect');
  for(const name of ['expectedRole','expectedDatabase','expectedFunctionOwner'])need(reference(host?.database?.[name]),`host.database.${name}`,'DATABASE_BINDING_REQUIRED');
  const market=host?.marketplace;
  need(market?.platformAccountId===manifest?.platformAccountId,'host.marketplace.platformAccountId','PLATFORM_BINDING_MISMATCH');
  if(nonPayment){
    need(finance==null&&host?.config?.settlement?.enabled!==true&&host?.assertSettlementReady==null,'finance','NON_PAYMENT_OWNER_REFUSED');
    for(const name of ['provider','quoteProvider','destinations','taxLifecycle','createCommercePorts','commerceConfig','shippingLifecycle','feeCalculator','instantPolicy','assertInstantPayoutReady','quoteInstantPayoutFee','readInstantFeeSettlement','sellerAccount','onboarding','webhook','listingPolicy','financePolicy','fulfillmentPolicy'])need(market?.[name]==null,`host.marketplace.${name}`,'NON_PAYMENT_OWNER_REFUSED');
    need(typeof market?.assertRuntimeReady==='function'&&!!market.context&&!!market.runtimeApproval,'host.marketplace','EXPLICIT_POLICY_OR_BINDING_REQUIRED');
    if(manifest?.environment==='PRODUCTION')need(host?.config?.proofAuthority?.enabled===true&&!!host.proofAuthority&&market?.physicalConfig?.operatingMode==='NON_PAYMENT','host.proofAuthority','GENUINE_PROOF_OWNERS_REQUIRED');
  }else{
  for(const name of ['assertRuntimeReady','readEvidence','validateEvidence','sellerAccount'])need(typeof market?.[name]==='function',`host.marketplace.${name}`);
  for(const name of ['context','listingPolicy','financePolicy','fulfillmentPolicy','runtimeApproval','onboarding'])need(!!market?.[name],`host.marketplace.${name}`,'EXPLICIT_POLICY_OR_BINDING_REQUIRED');
  const commercial=market?.listingPolicy?.commercialTerms;
  if(commercial)need(Array.isArray(commercial.pendingDecisions)&&commercial.pendingDecisions.length===0&&commercial.returns?.status!=='DRAFT_INCOMPLETE','host.marketplace.listingPolicy.commercialTerms','COMMERCIAL_DECISIONS_PENDING');
  need(market?.feeCalculator?.enabled===true&&['preview','assertCurrent'].every(name=>typeof market.feeCalculator[name]==='function'),'host.marketplace.feeCalculator','APPROVED_FEE_CALCULATOR_REQUIRED');
  need(typeof market?.createCommercePorts==='function'&&market.createCommercePorts.binding?.schema==='atlas-marketplace-commerce-factory-v1','host.marketplace.createCommercePorts','DURABLE_COMMERCE_FACTORY_REQUIRED');
  need(!market?.quoteProvider&&!market?.destinations&&!market?.taxLifecycle,'host.marketplace','AMBIGUOUS_COMMERCE_PORTS');
  need(safeHash(market?.commerceConfig)===manifest?.commerceConfigHash&&market?.createCommercePorts?.binding?.configHash===manifest?.commerceConfigHash,'host.marketplace.commerceConfig','CONFIGURATION_DIGEST_MISMATCH');
  need(market?.createCommercePorts?.binding?.environment===manifest?.environment&&market?.createCommercePorts?.binding?.platformAccountId===manifest?.platformAccountId,'host.marketplace.createCommercePorts','ENVIRONMENT_BINDING_MISMATCH');
  }
  if(manifest?.schema===MARKETPLACE_PHYSICAL_RELEASE_SCHEMA) {
    need(typeof market?.createPhysicalPorts==='function'&&market.createPhysicalPorts.binding?.schema==='atlas-marketplace-physical-factory-v1','host.marketplace.createPhysicalPorts','DURABLE_PHYSICAL_FACTORY_REQUIRED');
    need(!market?.proofIntake&&!market?.shippingLifecycle,'host.marketplace','AMBIGUOUS_PHYSICAL_PORTS');
    need(safeHash(market?.physicalConfig)===manifest.physicalConfigHash&&market?.createPhysicalPorts?.binding?.configHash===manifest.physicalConfigHash,'host.marketplace.physicalConfig','CONFIGURATION_DIGEST_MISMATCH');
    need(market?.createPhysicalPorts?.binding?.environment===manifest.environment,'host.marketplace.createPhysicalPorts','ENVIRONMENT_BINDING_MISMATCH');
  } else need(!market?.createPhysicalPorts&&!market?.physicalConfig&&!market?.proofIntake&&!market?.shippingLifecycle,'host.marketplace','PHYSICAL_RELEASE_MANIFEST_REQUIRED');
  need(safeHash(market?.runtimeApproval?.binding)===manifest?.marketplaceBindingHash,'host.marketplace.runtimeApproval','CONFIGURATION_DIGEST_MISMATCH');
  if(!nonPayment){
  for(const name of ['acceptsAccount','getIdentity','getAccount','create','retrieve','discover','getPaymentCollection','createOnboardingLink','getAccountSnapshot','listBalanceTransactions','listRelatedObjects','retrieveDispute'])need(typeof market?.provider?.[name]==='function',`host.marketplace.provider.${name}`);
  need(finance?.enabled===true,'finance.enabled','EXPLICIT_ENABLEMENT_REQUIRED');
  need(typeof finance?.assertRuntimeReady==='function','finance.assertRuntimeReady');
  need(safeHash(finance?.config)===manifest?.financeConfigHash,'finance.config','CONFIGURATION_DIGEST_MISMATCH');
  need(finance?.config?.environment===manifest?.environment&&finance?.config?.platformAccountId===manifest?.platformAccountId,'finance.config','ENVIRONMENT_BINDING_MISMATCH');
  need(finance?.config?.ingress?.enabled===true&&market?.webhook?.ingress?.enabled===true,'finance.config.ingress','DURABLE_SIGNED_INGRESS_REQUIRED');
  need(finance?.config?.taxReporting?.enabled===true&&Number.isSafeInteger(finance.config.taxReporting.maxItems)&&finance.config.taxReporting.maxItems>=1&&finance.config.taxReporting.maxItems<=50&&reference(finance.config.taxReporting.approvalRef),'finance.config.taxReporting','SEPARATELY_APPROVED_TAX_REPORTING_REQUIRED');
  for(const scope of ['PLATFORM','CONNECTED'])need(market?.webhook?.endpoints?.some(row=>row.scope===scope&&typeof row.secret==='string'&&row.secret.startsWith('whsec_'))===true,`host.marketplace.webhook.${scope}`,'SCOPED_SIGNING_ENDPOINT_REQUIRED');
  for(const name of ['assertReady','send','lookup'])need(typeof finance?.alertSender?.[name]==='function',`finance.alertSender.${name}`,'QUALIFIED_ALERT_SENDER_REQUIRED');
  }
  return {...report,configurationComplete:issues.length===0,status:issues.length?'CONFIGURATION_INCOMPLETE':'CONFIGURATION_COMPLETE_UNVERIFIED',issues};
}
