export const LEARNING_PATH: '/api/internal/atlas/trusted-learning/candidates';
export const LEARNING_PURPOSE: 'atlas-trusted-learning-candidates-v1';
export const LEARNING_GENERATOR_VERSION: 'speedster-learning-candidates-v1';
export type TrustedLearningConfig=Readonly<{purpose:typeof LEARNING_PURPOSE;mode:'PRODUCTION'|'LOCAL_FIXTURE';origin:string;deploymentId:string;
    releaseSha:string;key:Buffer;clientKeyHash:string;gradingPolicyHash:string;phoneAllowlistHash:string;generatorVersion:typeof LEARNING_GENERATOR_VERSION;configHash:string}>;
export type LearningScope={actorId:string;sessionHash:string;browserHash:string;accessVersion:number;controlRevision:number;staffOrigin:string;
    deploymentId:string;releaseSha:string;staffConfigHash:string;specimenId:string;approvalId:string;assignmentFence:number;analysisRevision:number;
    reviewRevision:number;evidenceHash:string;analysisHash:string;reviewHash:string;sourceRevision:string};
export type LearningSource={sourceType:'SPEEDSTER'|'LOCAL_FIXTURE';sourceId:string;sourceOwnerId:string};
export type LearningLesson={defectType:string;polarity:'POSITIVE'|'NEGATIVE';fingerprint:readonly number[];provenance:string;
    sourceViewId:string;proposalOrder:number;lessonOrder?:number};
export type LearningCandidate={candidateId:string;findingId:string;rawFindingHash:string;lesson:LearningLesson};
export type PublicLearningCandidate={candidateId:string;findingId:string;proposalOrder:number;lessonOrder:number;defectType:string;
    polarity:'POSITIVE'|'NEGATIVE';provenance:string;sourceViewId:string};
export type LearningCandidatesReceipt=LearningSource&{id:string;actorId:string;sessionHash:string;accessVersion:number;assignmentFence:number;
    controlRevision:number;specimenId:string;approvalId:string;analysisRevision:number;reviewRevision:number;evidenceHash:string;analysisHash:string;
    reviewHash:string;sourceRevision:string;rawFindingsHash:string;generatorVersion:string;fingerprintVersion:string;gradingPolicyHash:string;
    bridgeConfigHash:string;candidateCanonical:string;candidateHash:string;bundleHash:string;createdAt:Date;expiresAt:Date};
export function makeTrustedLearningConfig(input:{mode:'PRODUCTION'|'LOCAL_FIXTURE';origin:string;deploymentId:string;releaseSha:string;
    key:Buffer|string;gradingPolicyHash:string;phoneAllowlistHash:string;otherKeyHashes:string[]}):TrustedLearningConfig;
export function signTrustedLearningRequest(config:TrustedLearningConfig,scope:LearningScope,now?:number,nonce?:string):{body:string;signature:string};
export function verifyTrustedLearningRequest(config:TrustedLearningConfig,body:string,signature:string,now?:number):{
    purpose:typeof LEARNING_PURPOSE;audience:string;bridgeConfigHash:string;scope:LearningScope;nonce:string;issuedAt:number;expiresAt:number};
export function checkedLearningJSON(body:string,hash:string,limit?:number):any;
export function trustedLearningBundleHash(row:LearningCandidatesReceipt):string;
export function validateLearningCandidates(row:LearningCandidatesReceipt):LearningCandidate[];
export function publicLearningCandidates(row:LearningCandidatesReceipt):PublicLearningCandidate[];
export class ScopedTrustedLearningCandidates<Tx,Source extends {id:string;createdByUserId:string;workflowState:string;updatedAt:Date}> {
    constructor(options:{client:{$transaction<T>(work:(tx:Tx)=>Promise<T>,options?:{maxWait?:number;timeout?:number}):Promise<T>};config:TrustedLearningConfig;
        ports:{loadSource(tx:Tx,source:LearningSource):Promise<Source>;reportSource(source:Source):unknown|Promise<unknown>;
            sourceEvidence(source:Source,sourceRevision:string):unknown|Promise<unknown>;assertSourceAdmission(source:Source):void|Promise<void>;
            fingerprintVersion(sourceSnapshot:any):string|Promise<string>;
            generateCandidates(input:{fingerprintVersion:string;reviewedDefects:readonly unknown[]}):{lessons:readonly LearningLesson[];diagnostics?:unknown}|Promise<{lessons:readonly LearningLesson[];diagnostics?:unknown}>;
            isStaffPhoneAllowed(phoneHash:string):boolean}});
    receive(body:string,signature:string):Promise<{receiptId:string;bundleHash:string;candidates:PublicLearningCandidate[];expiresAt:string}>;
}
export function trustedLearningClient(config:TrustedLearningConfig,fetchImpl?:typeof fetch,options?:{timers?:{setTimeout:typeof setTimeout;clearTimeout:typeof clearTimeout}}):Readonly<{
    binding:Readonly<{bridgeConfigHash:string;gradingPolicyHash:string}>;call(scope:LearningScope):Promise<{receiptId:string;bundleHash:string}>}>;
