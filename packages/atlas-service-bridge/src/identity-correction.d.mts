export type IdentityCorrectionConfig = Readonly<{purpose:string;mode:'PRODUCTION'|'LOCAL_FIXTURE';origin:string;deploymentId:string;releaseSha:string;
    clientKeyHash:string;gradingPolicyHash:string;phoneAllowlistHash:string;configHash:string;key:Buffer}>;
export type IdentityCorrectionScope = Readonly<{actorId:string;sessionHash:string;browserHash:string;accessVersion:number;controlRevision:number;
    staffOrigin:string;deploymentId:string;releaseSha:string;staffConfigHash:string;specimenId:string;assignmentFence:number}>;
export type IdentityCorrectionRequest = Readonly<{operationId:string;expectedAnalysisRevision:number;expectedReviewRevision:number;expectedEvidenceRevision:number;
    analysisHash:string;reviewHash:string;evidenceHash:string;sourceRevision:string;next:Readonly<{cardProfile:'SPORTS'|'POKEMON';identity:unknown}>;reason:string}>;
export type IdentityCorrectionExpected = Readonly<{sourceId:string;sourceOwnerId:string;sourceRevision:string;evidenceSourceRevision:string;
    sourceHash:string;evidenceHash:string;gradingPolicyHash:string}>;
export type IdentityCorrectionProposal = Readonly<{status:'NO_CHANGE'|'COMPATIBLE'|'REPROCESS_REQUIRED';reasons:readonly string[];changedFields:readonly string[];
    nextIdentityCanonical:string;proofCanonical:string;proofHash:string;requiresCurrentAuthorityRevalidation:true}>;
export type IdentityCorrectionLocator = Readonly<{sourceType:'SPEEDSTER'|'LOCAL_FIXTURE';sourceId:string;sourceOwnerId:string}>;
export type IdentityCorrectionSource = Readonly<{id:string;createdByUserId:string;workflowState:string;updatedAt:Date}>;
export type IdentityCorrectionPorts<Tx,Source extends IdentityCorrectionSource,Preflight=unknown> = Readonly<{
    loadRawSource(tx:Tx,exact:IdentityCorrectionLocator):Promise<Source>;
    classify(source:Source,expected:IdentityCorrectionExpected,next:IdentityCorrectionRequest['next']):IdentityCorrectionProposal;
    preflight(source:Source):Promise<Preflight>;
    assertCurrentAuthority(tx:Tx,source:Source,preflight:Preflight):Promise<void>;
    projectNext(source:Source,identity:unknown,updatedAt:Date):Source;
    reportSource(source:Source):unknown;sourceEvidence(source:Source,revision:string):unknown;previewReport(source:any):unknown;
    safeTitle(source:Source):{title:string;subtitle:string};compareAndSwap(tx:Tx,previous:Source,next:Source):Promise<Source>;
    isStaffPhoneAllowed(hash:string):boolean;
}>;
export const IDENTITY_CORRECTION_PATH:string;
export const IDENTITY_CORRECTION_PURPOSE:string;
export function makeIdentityCorrectionConfig(input:{mode:'PRODUCTION'|'LOCAL_FIXTURE';origin:string;deploymentId:string;releaseSha:string;key:Buffer|string;
    gradingPolicyHash:string;phoneAllowlistHash:string;otherKeyHashes:string[]}):IdentityCorrectionConfig;
export function validateIdentityCorrectionRequest(request:unknown):IdentityCorrectionRequest;
export function identityCorrectionRequestCanonical(specimenId:string,request:IdentityCorrectionRequest):string;
export function signIdentityCorrectionRequest(config:IdentityCorrectionConfig,scope:IdentityCorrectionScope,request:IdentityCorrectionRequest,now?:number,nonce?:string):{body:string;signature:string};
export function verifyIdentityCorrectionRequest(config:IdentityCorrectionConfig,body:string,signature:string,now?:number):{scope:IdentityCorrectionScope;request:IdentityCorrectionRequest};
export function identityCorrectionRawSource(source:IdentityCorrectionSource):Record<string,unknown>;
export function identityCorrectionReceipt(row:any):Record<string,unknown>;
export function identityCorrectionAudit(row:any):Record<string,unknown>;
export class ScopedIdentityCorrection<Tx,Source extends IdentityCorrectionSource,Preflight=unknown>{
    constructor(input:{client:{$transaction:<T>(fn:(tx:Tx)=>Promise<T>,options?:{maxWait:number;timeout:number})=>Promise<T>};config:IdentityCorrectionConfig;
        ports:IdentityCorrectionPorts<Tx,Source,Preflight>});
    receive(body:string,signature:string):Promise<any>;
}
export function identityCorrectionClient(config:IdentityCorrectionConfig,fetchImpl?:typeof fetch,options?:{timers?:{setTimeout:typeof setTimeout;clearTimeout:typeof clearTimeout}}):
    Readonly<{binding:Readonly<{bridgeConfigHash:string;gradingPolicyHash:string}>;call(scope:IdentityCorrectionScope,request:IdentityCorrectionRequest):Promise<any>}>;
