import type { BridgeServerConfig, BridgeCase, SourceIdentity } from './executor.mjs';
import type { PilotPolicy } from './protocol.mjs';
export type MachineInitializationClaims = { jobId: string; runtimeHash: string };
export type MachineInitializationConfig = BridgeServerConfig & { runtimeHash: string };
export type MachineInitializationJob = {
    id: string; specimenId: string; pilotId: string; gradingOperationId: string;
    runtimeHash: string; evidenceHash: string; operatorPolicyHash: string; bridgePolicyHash: string; gradingPolicyHash: string;
    sourceHash: string; sourceRevision: string; expectedAnalysisRevision: 0; expectedReviewRevision: number;
    controlRevision: number; operatorRevision: number; bridgeRevision: number; admittedById: string;
    admittedSessionHash: string; admittedAccessVersion: number; operationsGrantId: string;
    admissionReason: string; authorizationEvidenceHash: string;
    deadlineAt: Date; createdAt: Date; dispatchedAt?: Date | null; finishedAt?: Date | null;
    state: 'QUEUED' | 'DISPATCHED' | 'SUCCEEDED' | 'UNKNOWN' | 'FAILED'; failureCode?: string | null;
};
export type FreshDetection = { jobId: string; claimId: string; sourceRevision: string };
export type MachineInitializationPorts<Tx,Source,Data> = {
    afterExecutionClaim?(tx: Tx, execution: { operationId: string; claimId: string; sourceRevision: string; now: Date }): Promise<void>;
    loadSource(tx: Tx,card: BridgeCase): Promise<Source>;
    sourceEvidence(source: Source,sourceRevision?: string): unknown;
    reportSource(source: Source): unknown;
    assertSourceAdmission(source: Source): void | Promise<void>;
    /** Reject pre-existing source checkpoints; never delete/relabel them. */
    assertFreshDetection(tx: Tx,source: Source): Promise<void>;
    /** Reuse the original service, but reject any nonempty checkpoint lookup
     * for this INITIALIZE. Require its newly returned detectionPair. */
    perform(input: { source: Source; action: { type: 'INITIALIZE' }; policy: PilotPolicy; signal: AbortSignal; freshDetection: FreshDetection;
        beforeSessionLock(tx: Tx,identity: SourceIdentity,expectedUpdatedAt: Date,data: Data): Promise<void>;
        afterPersist(tx: Tx,identity: SourceIdentity,expectedUpdatedAt: Date,data: Data): Promise<void>;
    }): Promise<unknown>;
};
export class MachineInitializationBridge<Tx,Source extends { id:string;createdByUserId:string;updatedAt:Date },Data> {
    constructor(options: {
        client: { $transaction<T>(work:(tx:Tx)=>Promise<T>,options?:{maxWait?:number;timeout?:number}):Promise<T> };
        config: MachineInitializationConfig; ports: MachineInitializationPorts<Tx,Source,Data>;
        clock?: { now():number;setTimeout(callback:()=>void,ms:number):unknown;clearTimeout(timer:unknown):void };
    });
    run(claims:MachineInitializationClaims,options?:{signal?:AbortSignal}):Promise<{state:string;analysisRevision?:number}>;
}
export type MachineInitializationAdmission<Tx> = {
    tx: Tx; actorKind: 'HUMAN'; capability: 'OPERATIONS'; capabilityUntil: Date; operationsGrantId: string;
    identity: { id: string; accessVersion: number; revokedAt: Date | null };
    session: { identityId: string; tokenHash: string; accessVersion: number; revokedAt: Date | null;
        controlRevision: number; createdAt: Date; expiresAt: Date };
    control: { revision: number };
};
/** admin.transaction must authenticate fresh elevated HUMAN OPERATIONS access,
 * active browser/operations grant, and its exact database role; SQL repeats the
 * admission scope check. Database time is read again inside this callback. */
export function enqueueMachineInitialization<Tx,Source,Data>(options: {
    admin:{transaction<T>(staff:unknown,work:(context:MachineInitializationAdmission<Tx>)=>Promise<T>):Promise<T>};staff:unknown;
    config:MachineInitializationConfig;ports:MachineInitializationPorts<Tx,Source,Data>;
},input:{jobId:string;specimenId:string;reason:string;authorizationEvidenceHash:string}):Promise<MachineInitializationJob>;
