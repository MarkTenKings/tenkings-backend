import type { WorkspaceSourceRequest } from './workspace.mjs';
import type { MachineInitializationConfig } from './machine-initialize.mjs';
export type WorkspaceInitializationResult = { state: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN'; specimenId?: string; failureCode?: string };
export function createWorkspaceInitializationService(options: {
    client: unknown; authority: unknown; ports: unknown; ledger: unknown;
    config: MachineInitializationConfig & { staffDeploymentId: string; staffReleaseSha: string };
    sourceConfigHash: string; request: WorkspaceSourceRequest;
}): { status(): Promise<WorkspaceInitializationResult>; run(): Promise<WorkspaceInitializationResult> };
