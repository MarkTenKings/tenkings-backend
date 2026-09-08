import type { BridgeClaims, PilotPolicy } from './protocol.mjs';
export type BridgeServerConfig = { mode: string; origin: string; deploymentId: string; releaseSha: string; configHash: string; clientKeyHash: string; gradingPolicyHash: string };
export type SourceIdentity = { sessionId: string; createdByUserId: string };
export type EvidenceDescriptor = { sourceRef: string; byteCount: number; sha256: string; contentType: string; width: number; height: number };
export type BridgeCase = { id: string; sourceId: string; sourceOwnerId: string; evidenceCanonical: string; evidenceHash: string };
export class ScopedGradingBridge<Tx, Source extends { id: string; createdByUserId: string; updatedAt: Date }, Action, Data> {
    constructor(options: {
        client: { $transaction<T>(work: (tx: Tx) => Promise<T>, options?: { maxWait?: number; timeout?: number }): Promise<T> };
        config: BridgeServerConfig;
        ports: {
            loadSource(tx: Tx, card: BridgeCase): Promise<Source>;
            sourceEvidence(source: Source, sourceRevision?: string): unknown;
            assertSourceAdmission(source: Source): void;
            assertFreshDetection(tx: Tx, source: Source): Promise<void>;
            reportSource(source: Source): unknown;
            readEvidence(descriptor: EvidenceDescriptor): Promise<Uint8Array>;
            perform(input: { source: Source; action: Action; policy: PilotPolicy; signal: AbortSignal;
                beforeSessionLock: (tx: Tx, identity: SourceIdentity, expectedUpdatedAt: Date, data: Data) => Promise<void>;
                afterPersist: (tx: Tx, identity: SourceIdentity, expectedUpdatedAt: Date, data: Data) => Promise<void> }): Promise<unknown>;
        };
    });
    run(claims: BridgeClaims, operationId: string): Promise<{ state: string; analysisRevision?: number; failureCode?: string }>;
    readEvidence(claims: BridgeClaims, side: 'FRONT' | 'BACK'): Promise<{ bytes: Buffer; contentType: string }>;
}
