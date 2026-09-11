export type OperatorEnqueueConfig = { mode: string; releaseSha: string; buildHash: string; configHash: string; providerBindingHash: string };
export function enqueueOperatorRun<Tx>(client: {
    $transaction<T>(work: (tx: Tx) => Promise<T>, options?: { maxWait?: number; timeout?: number }): Promise<T>;
}, config: OperatorEnqueueConfig, specimenId: string, options?: { machineInitializationId?: string | null; workspaceCardId?: string | null; captureRunId?: string | null }): Promise<{
    id: string; specimenId: string; pilotId: string; state: string; initializationId: string | null;
    expectedAnalysisRevision: number; expectedReviewRevision: number; runtimeHash: string;
}>;

export function enqueueCaptureOperatorRunInTransaction(tx: any, config: any, card: any): Promise<any>;
export function enqueueCaptureOperatorRun(client: any, config: any, workspaceCardId: string): Promise<any>;

export function enqueueOperatorRunInTransaction(tx: any, config: OperatorEnqueueConfig, specimenId: string, options?: { machineInitializationId?: string | null; workspaceCardId?: string | null; captureRunId?: string | null }): Promise<any>;

/** Private queue callback after exact source initialization and source permit
 * SUCCEEDED. Atomically relinks the existing claim and records its successor.
 * STEP successors start PAUSED without a new dispatch permit. Caller commits. */
export function enqueueWorkspaceReportSuccessorInTransaction(tx: any, config: OperatorEnqueueConfig, input: { requestId: string }): Promise<any>;

/** Exact retained human grant; never creates a recovery or repeats a request. */
export function readOperatorRecovery(tx: any, run: any, options?: { claiming?: boolean; commandId?: string }): Promise<any | null>;
