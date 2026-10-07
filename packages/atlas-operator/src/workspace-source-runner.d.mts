import type { WorkspaceSourceRequest } from '@atlas/service-bridge/workspace';
import type { OperatorEnqueueConfig } from './ledger.mjs';

export type WorkspaceSourceRunResult = Readonly<{ runId: string; actions: number;
    state: 'READY' | 'PAUSED' | 'TAKEN_OVER' | 'NEEDS_ATTENTION' | 'HELD' | 'STOPPED';
    reportRunId?: string; requestId?: string; code?: string }>;
export type WorkspaceSourceRunnerAuthority<Tx> = Readonly<{
    controls(tx: Tx): Promise<any>;
    current(tx: Tx, request: Pick<WorkspaceSourceRequest, 'cardId' | 'scope' | 'binding'>): Promise<any>;
    loadInTransaction(request: WorkspaceSourceRequest, tx: Tx): Promise<any>;
    recheck(request: WorkspaceSourceRequest, authorized: any, tx: Tx): Promise<void>;
}>;
export type WorkspaceSourceCommandAuthorization<Tx> = (tx: Tx,
    input: Readonly<{ run: any; card: any; intent: any | null; commandId: string }>) => Promise<void>;

/** Private composition only. Source must be the original authenticated source
 * service. A repeated committed intent invokes status only. The returned report
 * run is already linked by the existing admission helper; it is never executed
 * or approved by this coordinator. */
export function createWorkspaceSourceRunner<Tx>(options: Readonly<{
    client: { $transaction<T>(work: (tx: Tx) => Promise<T>, options?: { maxWait?: number; timeout?: number }): Promise<T> };
    authority: WorkspaceSourceRunnerAuthority<Tx>;
    source: Readonly<Record<'prepare' | 'finalize' | 'status',
        (request: WorkspaceSourceRequest, options?: { signal?: AbortSignal }) => Promise<unknown>>>;
    operatorConfig: OperatorEnqueueConfig;
    enqueueSuccessor?: (tx: Tx, config: OperatorEnqueueConfig, input: { requestId: string }) => Promise<{ id: string }>;
    /** Fixed bootstrap guard, called under the same authorized transaction
     * before new intent/permit writes. Configuring it requires commandId. */
    authorizeCommand?: WorkspaceSourceCommandAuthorization<Tx>;
}>): Readonly<{ run(input: { runId: string; commandId?: string; signal?: AbortSignal }): Promise<WorkspaceSourceRunResult> }>;
