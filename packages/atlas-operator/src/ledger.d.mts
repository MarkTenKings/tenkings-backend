export type OperatorEnqueueConfig = { mode: string; releaseSha: string; buildHash: string; configHash: string; providerBindingHash: string };
export function enqueueOperatorRun<Tx>(client: {
    $transaction<T>(work: (tx: Tx) => Promise<T>, options?: { maxWait?: number; timeout?: number }): Promise<T>;
}, config: OperatorEnqueueConfig, specimenId: string, options?: { machineInitializationId?: string | null }): Promise<{
    id: string; specimenId: string; pilotId: string; state: string; initializationId: string | null;
    expectedAnalysisRevision: number; expectedReviewRevision: number; runtimeHash: string;
}>;
