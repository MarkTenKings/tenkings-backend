import {hash,requireValue} from './contract.mjs';
import {authorityContext} from './authority-context.mjs';
import {requireSyncApproval,exactKeys} from './fee-policy.mjs';
import {createMarketplaceDestinations} from './destinations.mjs';
import {createApprovedCheckoutQuoteProvider} from './checkout-quote.mjs';
import {createShipStationQuoteAdapter} from './provider-shipping-shipstation.mjs';
import {createStripeTaxQuoteAdapter} from './provider-tax-stripe.mjs';
import {createStripeTaxLifecycle} from './tax-lifecycle.mjs';

const factories=new WeakSet();
export function instantiateMarketplaceCommerce(factory,input){requireValue(factories.has(factory),'COMMERCE_FACTORY_UNQUALIFIED');return factory(input);}
// No pool, credential, profile, approval or shipping measurement discovery.
// The host supplies its newly owned store; every port shares that exact store.
export function createMarketplaceCommerceFactory({enabled=false,config,keyring,shippingApiKey,taxSecretKey,approvals,shippingFetch,taxFetch}={}) {
  if(!enabled)return null;
  requireValue(config&&approvals&&['commerce','destinations','shipping','tax','checkout','taxLifecycle'].every(key=>typeof approvals[key]==='function'),'COMMERCE_APPROVALS_REQUIRED');
  exactKeys(config,['environment','platformAccountId','destinations','shipping','tax','checkout','taxLifecycleApprovalRef'],'COMMERCE_CONFIGURATION_REQUIRED');
  const configHash=hash(config),pins={...approvals},binding=Object.freeze({schema:'atlas-marketplace-commerce-factory-v1',environment:config.environment,platformAccountId:config.platformAccountId,configHash});
  function ready(){requireValue(hash(config)===configHash&&Object.entries(pins).every(([key,fn])=>approvals[key]===fn),'COMMERCE_CONFIGURATION_CHANGED');requireSyncApproval(pins.commerce(binding),'COMMERCE_APPROVAL_REQUIRED');return true;}
  const factory=({store,context:suppliedContext,environment,platformAccountId,clock})=>{
    ready();const context=authorityContext(suppliedContext);requireValue(environment===binding.environment&&context.environment===environment&&platformAccountId===binding.platformAccountId,'COMMERCE_BINDING_MISMATCH');
    requireValue(config.tax.accountId===platformAccountId&&config.checkout.environment===environment&&config.destinations.environment===environment&&config.shipping.environment===environment&&config.tax.environment===environment,'COMMERCE_BINDING_MISMATCH');
    const checkoutHash=hash(config.checkout);requireValue(config.shipping.checkoutPolicyHash===checkoutHash&&config.tax.checkoutPolicyHash===checkoutHash&&config.shipping.policyRef===config.checkout.shippingPolicyRef&&config.tax.policyRef===config.checkout.taxPolicyRef,'COMMERCE_BINDING_MISMATCH');
    const owned=[];const own=value=>(owned.push(value),value);const approve=key=>value=>{ready();return pins[key](value);};
    try {
      const destinations=own(createMarketplaceDestinations({enabled:true,store,context,policy:config.destinations,keyring,assertReady:approve('destinations'),clock}));
      const shipping=own(createShipStationQuoteAdapter({enabled:true,store,config:config.shipping,apiKey:shippingApiKey,resolveDestination:destinations,assertReady:approve('shipping'),...(shippingFetch?{fetchImpl:shippingFetch}:{}),clock}));
      const tax=own(createStripeTaxQuoteAdapter({enabled:true,store,config:config.tax,secretKey:taxSecretKey,resolveDestination:destinations,assertReady:approve('tax'),...(taxFetch?{fetchImpl:taxFetch}:{}),clock}));
      const quoteProvider=own(createApprovedCheckoutQuoteProvider({enabled:true,context,policy:config.checkout,approvalRef:config.checkout.approvalRef,assertReady:approve('checkout'),resolveDestination:destinations,shipping,tax,clock}));
      const taxLifecycle=createStripeTaxLifecycle({enabled:true,store,taxAdapter:tax,approvalRef:config.taxLifecycleApprovalRef,assertReady:approve('taxLifecycle'),clock});
      let closed=false;return Object.freeze({destinations,quoteProvider,taxLifecycle,close(){if(closed)return;closed=true;for(const port of [...owned].reverse())port.close?.();}});
    }catch(error){for(const port of owned.reverse())port.close?.();throw error;}
  };
  Object.defineProperty(factory,'binding',{value:binding});factories.add(factory);return Object.freeze(factory);
}
