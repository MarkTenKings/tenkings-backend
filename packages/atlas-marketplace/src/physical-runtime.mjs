import {hash,requireValue} from './contract.mjs';
import {authorityContext} from './authority-context.mjs';
import {exactKeys,requireSyncApproval} from './fee-policy.mjs';
import {createEncryptedProofStorage} from './proof-storage.mjs';
import {createProofImageValidator} from './proof-image.mjs';
import {createMarketplaceProofIntake} from './proof-intake.mjs';
import {createShipStationTrackingAdapter} from './provider-tracking-shipstation.mjs';
import {createShippingLifecycle} from './shipping-lifecycle.mjs';

const factories=new WeakSet();
export function instantiateMarketplacePhysical(factory,input){requireValue(factories.has(factory),'PHYSICAL_FACTORY_UNQUALIFIED');return factory(input);}

/** Explicit same-store construction. Never discovers credentials, creates a
 * storage directory, purchases a label, or assumes reviewer/coverage authority.
 * Approval of configuration alone is not qualification of decoder containment,
 * durable private storage, retention, measurements or the carrier account. */
export function createMarketplacePhysicalFactory({enabled=false,config,proofEncryptionKey,shippingApiKey,approvals,authorizeProof,resolveShipment,validateShipmentEvidence,shippingFetch}={}) {
  if(!enabled)return null;
  const nonPayment=config?.operatingMode==='NON_PAYMENT';
  exactKeys(config,nonPayment?['operatingMode','environment','proof','storage','decoder']:['environment','proof','storage','decoder','shipping','shippingLifecycleApprovalRef'],'PHYSICAL_CONFIGURATION_REQUIRED');
  if(nonPayment)requireValue([shippingApiKey,resolveShipment,validateShipmentEvidence,shippingFetch].every(value=>value==null),'NON_PAYMENT_OWNER_REFUSED');
  requireValue(['PROVIDER_SANDBOX','PRODUCTION'].includes(config.environment)&&config.proof?.environment===config.environment&&(nonPayment||config.shipping?.environment===config.environment),'PHYSICAL_BINDING_MISMATCH');
  exactKeys(config.storage,['directory','keyId','storageId','maxObjectBytes'],'PHYSICAL_STORAGE_REQUIRED');
  exactKeys(config.decoder,['maxObjectBytes','maxPixels','timeoutMs','maxConcurrent'],'PHYSICAL_DECODER_REQUIRED');
  requireValue(approvals&&(nonPayment?['physical','proof']:['physical','proof','tracking','shippingLifecycle']).every(key=>typeof approvals[key]==='function')&&(nonPayment?[authorizeProof]:[authorizeProof,resolveShipment,validateShipmentEvidence]).every(fn=>typeof fn==='function'),'PHYSICAL_AUTHORITY_REQUIRED');
  const configHash=hash(config),pins={...approvals},binding=Object.freeze({schema:'atlas-marketplace-physical-factory-v1',environment:config.environment,configHash});
  const ready=()=>{requireValue(hash(config)===configHash&&Object.entries(pins).every(([key,fn])=>approvals[key]===fn),'PHYSICAL_CONFIGURATION_CHANGED');requireSyncApproval(pins.physical(binding),'PHYSICAL_APPROVAL_REQUIRED');return true;};
  const factory=({store,context:suppliedContext,environment,clock})=>{
    ready();const context=authorityContext(suppliedContext);requireValue(context.environment===environment&&environment===binding.environment,'PHYSICAL_BINDING_MISMATCH');
    let closed=false;const owned=[],own=value=>(owned.push(value),value);
    const approve=key=>value=>{requireValue(!closed,'PHYSICAL_RUNTIME_CLOSED');ready();return pins[key](value);};
    try {
      const storage=own(createEncryptedProofStorage({...config.storage,encryptionKey:proofEncryptionKey,readOnly:nonPayment,environment,retentionRef:config.proof.retentionRef}));
      const validator=own(createProofImageValidator(config.decoder));
      const proofIntake=createMarketplaceProofIntake({enabled:true,store,context,policy:config.proof,storage,validator,canonicalAuthorityOnly:nonPayment,assertReady:approve('proof'),authorize:(...args)=>{ready();return authorizeProof(...args);},clock});
      let shippingLifecycle;
      if(!nonPayment){
      const trackingAdapter=own(createShipStationTrackingAdapter({enabled:true,config:config.shipping,apiKey:shippingApiKey,assertReady:approve('tracking'),...(shippingFetch?{fetchImpl:shippingFetch}:{}),clock}));
      shippingLifecycle=own(createShippingLifecycle({enabled:true,store,trackingAdapter,approvalRef:config.shippingLifecycleApprovalRef,assertReady:approve('shippingLifecycle'),resolveShipment:async input=>{ready();const value=await resolveShipment(input);ready();return value;},validateEvidence:async input=>{ready();const value=await validateShipmentEvidence(input);ready();return value;},clock}));
      }
      return Object.freeze({proofIntake,shippingLifecycle,async close(){if(closed)return;closed=true;for(const port of [...owned].reverse())await port.close?.();}});
    }catch(error){for(const port of owned.reverse())port.close?.();throw error;}
  };
  Object.defineProperty(factory,'binding',{value:binding});factories.add(factory);return Object.freeze(factory);
}
