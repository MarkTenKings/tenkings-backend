import type { OperatorEnqueueConfig } from './ledger.mjs';
import type { WorkspaceSourceRequest } from '@atlas/service-bridge/workspace';
import type { WorkspaceSourceRunResult, WorkspaceSourceRunnerAuthority, WorkspaceSourceCommandAuthorization } from './workspace-source-runner.mjs';

export type WorkspaceDispatchCommand = Readonly<{ runId: string; commandId: string }>;
export type WorkspaceDispatchInput = WorkspaceDispatchCommand & Readonly<{ signal?: AbortSignal }>;
export type WorkspaceOperatorInput = Readonly<{ runId: string; expectedControlRevision: number; signal?: AbortSignal }>;
export type WorkspaceDispatchResult = Readonly<{
    runId: string; commandId: string; activeRunId: string;
    phase: 'ADMISSION' | 'CAPTURE_REVIEW' | 'SOURCE' | 'REPORT_REVIEW';
    state: 'READY_FOR_HUMAN' | 'PAUSED' | 'TAKEN_OVER' | 'NEEDS_ATTENTION' | 'HELD' | 'STOPPED' | 'YIELDED';
    operatorRuns: number; sourceActions: number; stepsApplied: number; code: string | null;
}>;
export type WorkspaceDispatchAdmission = Readonly<{
    runId: string; commandId: string; commandHash: string | null; activeRunId: string | null; workspaceCardId: string | null;
    phase: WorkspaceDispatchResult['phase'];
    state: 'ADMITTED' | 'SETTLED' | 'IN_FLIGHT' | 'HELD';
    code: string | null;
}>;
export type WorkspaceDispatcherClient<Tx> = Readonly<{
    $transaction<T>(work: (tx: Tx) => Promise<T>, options?: { maxWait?: number; timeout?: number }): Promise<T>;
}>;
export type WorkspaceDispatcherSource = Readonly<Record<'prepare' | 'finalize' | 'status',
    (request: WorkspaceSourceRequest, options?: { signal?: AbortSignal }) => Promise<unknown>>>;
export type WorkspaceOperatorExecution = Readonly<{
    runId: string | null; state: string; code: string | null; stepsApplied: number;
    receipts: Readonly<{ total: number; persisted: number; unconfirmed: number; pending: number }>;
    disconnect: 'CLOSED' | 'NOT_OPENED' | 'UNCONFIRMED'; exitCode: number;
}>;
export type WorkspaceDispatcherOptions<Tx> = Readonly<{
    /** Dedicated COORDINATOR connection. Every transaction reasserts exact
     * effective grants, including transactions made by the source runner. */
    client: WorkspaceDispatcherClient<Tx>;
    /** Existing private authority with fixed settings and staff phone roster.
     * current rechecks the real admitting actor/access version and immutable
     * originals. Pre-lease reads retain the real leaseFence zero internally;
     * source transport requests are minted only by the settled source runner. */
    authority: WorkspaceSourceRunnerAuthority<Tx>;
    source: WorkspaceDispatcherSource;
    /** Exact output config of the independently verified operator runtime. */
    operatorConfig: OperatorEnqueueConfig;
    /** Fixed bootstrap closure over executeOperatorRun and its manifest,
     * artifact and separate pinned OPERATOR client factory. No per-request
     * config, credentials, actor, mode, source URL or execution adapter. */
    executeOperator(input: WorkspaceOperatorInput): Promise<WorkspaceOperatorExecution>;
}>;

/** Explicit Start/Resume/STEP consumes only this already-claimed run. A linked
 * capture predecessor may be supplied for recovery; immutable admission and
 * successor proof determine the current report run. No queue discovery, new
 * claim, control mutation, timer, scheduler, provider retry or human approval.
 * YIELDED means a STEP action ended while a newer human control is already
 * recorded; a separate explicit invocation can consume that newer control. */
export function createWorkspaceDispatcher<Tx>(options: WorkspaceDispatcherOptions<Tx>,
    composition?: Readonly<{
        /** Fixed test/packaging ports only; never derive these from input. */
        makeSourceRunner?: (options: Omit<WorkspaceDispatcherOptions<Tx>, 'executeOperator'> &
            Readonly<{ authorizeCommand: WorkspaceSourceCommandAuthorization<Tx> }>) => Readonly<{
            run(input: WorkspaceDispatchInput): Promise<WorkspaceSourceRunResult>;
        }>;
        verifySuccessor?: (tx: Tx, config: OperatorEnqueueConfig, input: { requestId: string }) => Promise<any>;
    }>): Readonly<{
        /** Read-only admission for a private trigger acknowledgment. ADMITTED
         * means the finite operation may start or recover. It reserves nothing;
         * run rechecks current authority. Invalid DTOs throw before database
         * access; failed authorization returns HELD with a safe code. */
        admit(input: WorkspaceDispatchCommand): Promise<WorkspaceDispatchAdmission>;
        run(input: WorkspaceDispatchInput): Promise<WorkspaceDispatchResult>;
    }>;
