import type { WorkspaceSourceRequest } from './workspace.mjs';
export function admitWorkspaceSource<Tx, Source extends { id: string; createdByUserId: string; workflowState: string; updatedAt: Date }>(
    options: { client: { $transaction<T>(work: (tx: Tx) => Promise<T>, options?: { maxWait: number; timeout: number }): Promise<T> };
        authority: { load(request: WorkspaceSourceRequest): Promise<unknown>; recheck(request: WorkspaceSourceRequest, value: unknown, tx: Tx): Promise<unknown> };
        sourceConfigHash: string; transaction?: Tx; authorized?: unknown; ports: { loadSource(tx: Tx, source: { id: string; sourceType: string; sourceId: string; sourceOwnerId: string }): Promise<Source>;
            reportSource(source: Source): unknown; sourceEvidence(source: Source, revision: string): unknown;
            assertSourceAdmission(source: Source): void | Promise<void>; sourceAdmission(source: Source): unknown;
            sourceTitle(source: Source): { title: string; subtitle: string } } }, request: WorkspaceSourceRequest): Promise<{
        requestId: string; cardId: string; specimenId: string; sourceConfigHash: string; actorId: string; actorKind: 'HUMAN' | 'MACHINE';
        accessVersion: number; sourceRevision: string; sourceHash: string; evidenceHash: string; admissionHash: string; createdAt: Date }>;
