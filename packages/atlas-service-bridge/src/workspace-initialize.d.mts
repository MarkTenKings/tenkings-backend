import type { MachineInitializationConfig, MachineInitializationJob, MachineInitializationPorts } from './machine-initialize.mjs';

export type WorkspaceMachineInitializationJob = Omit<MachineInitializationJob, 'admittedSessionHash' | 'operationsGrantId'> & {
    admissionKind: 'WORKSPACE_CAPTURE'; workspaceSourceRequestId: string;
    admittedSessionHash: null; operationsGrantId: null;
};

/** Private source-host transaction, after the immutable source admission and
 * specimen are inserted. Reads the recorded MACHINE_SOURCE_ACTION and active
 * source permit; never accepts caller-selected actor, source, session or grant.
 * Returns the deterministic retained job without dispatching or settling costs.
 * The caller must commit its source bookkeeping and deferred SQL proof. */
export function enqueueWorkspaceMachineInitializationInTransaction<Tx, Source, Data>(
    tx: Tx, config: MachineInitializationConfig, ports: MachineInitializationPorts<Tx, Source, Data>, input: { requestId: string },
): Promise<WorkspaceMachineInitializationJob>;
