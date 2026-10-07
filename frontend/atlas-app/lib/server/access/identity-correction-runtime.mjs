import { makeIdentityCorrectionConfig, identityCorrectionClient } from '@atlas/service-bridge/identity-correction';
import { canonical, keyBytes, SHA } from '@atlas/service-bridge/protocol';
import { deny, hash } from '../policy.mjs';
import { StaffIdentityCorrection } from './identity-correction.mjs';

export function identityCorrectionRuntimeSettings(env,staffConfig){
    if(env.ATLAS_IDENTITY_CORRECTION_ENABLED!=='true')return null;
    if(staffConfig.mode!=='PRODUCTION'||env.NODE_ENV!=='production'||env.VERCEL_ENV!=='production'
        ||Object.keys(env).some(name=>name.startsWith('ATLAS_LOCAL_')))deny(503,'IDENTITY_NOT_CONFIGURED');
    const phones=[...staffConfig.phoneByHash.keys()].sort();
    if(!phones.length||phones.length>100||phones.some(v=>!SHA.test(v)))deny(503,'IDENTITY_NOT_CONFIGURED');
    // Staff phone hashes come from durable auth configuration. An optional env
    // roster must agree exactly; it cannot expand the authenticated staff roster.
    if(env.ATLAS_IDENTITY_CORRECTION_ALLOWED_PHONE_HASHES_JSON!==undefined){
        const body=env.ATLAS_IDENTITY_CORRECTION_ALLOWED_PHONE_HASHES_JSON;let provided;
        try{if(typeof body!=='string'||Buffer.byteLength(body)>8192)throw Error();provided=JSON.parse(body);}catch{deny(503,'IDENTITY_NOT_CONFIGURED');}
        if(!Array.isArray(provided)||provided.length!==phones.length||new Set(provided).size!==provided.length
            ||provided.some(v=>typeof v!=='string'||!SHA.test(v))||canonical([...provided].sort())!==canonical(phones))deny(503,'IDENTITY_NOT_CONFIGURED');
    }
    const gradingPolicyHash=env.ATLAS_IDENTITY_CORRECTION_GRADING_POLICY_HASH??staffConfig.gradingPolicyHash;
    if(staffConfig.gradingPolicyHash&&staffConfig.gradingPolicyHash!==gradingPolicyHash)deny(503,'IDENTITY_NOT_CONFIGURED');
    return makeIdentityCorrectionConfig({mode:'PRODUCTION',origin:env.ATLAS_IDENTITY_CORRECTION_ORIGIN,
        deploymentId:env.ATLAS_IDENTITY_CORRECTION_DEPLOYMENT_ID,releaseSha:env.ATLAS_IDENTITY_CORRECTION_RELEASE_SHA,
        key:keyBytes(env.ATLAS_IDENTITY_CORRECTION_KEY),gradingPolicyHash,phoneAllowlistHash:hash(canonical(phones)),
        otherKeyHashes:[hash(staffConfig.sessionKey),hash(staffConfig.phoneKey),...['ATLAS_GRADING_BRIDGE_KEY','ATLAS_INTAKE_KEY','ATLAS_TRUSTED_LEARNING_KEY',
            'ATLAS_OPERATOR_EVIDENCE_KEY','ATLAS_PUBLIC_MEDIA_KEY','ATLAS_MACHINE_ADMISSION_KEY','ATLAS_MACHINE_EXECUTION_KEY']
            .filter(name=>env[name]!==undefined).map(name=>hash(keyBytes(env[name])))]});
}
/** Retained service resolves current settings for each new request only after
 * durable replay; disabling or rotating private settings cannot hide receipts. */
export function createIdentityCorrectionRuntime({auth,review,staffConfig,env=process.env,fetchImpl}){
    return new StaffIdentityCorrection({auth,review,bridge:()=>{
        const settings=identityCorrectionRuntimeSettings(typeof env==='function'?env():env,staffConfig);
        return settings?identityCorrectionClient(settings,fetchImpl):null;
    }});
}
