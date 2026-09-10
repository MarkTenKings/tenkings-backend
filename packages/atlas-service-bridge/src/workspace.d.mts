export type WorkspaceAction = 'UPLOAD_GRANT' | 'VERIFY_UPLOAD' | 'READ_ORIGINAL' | 'PREPARE_SIDE' | 'INITIALIZE_REPORT' | 'READ_STATUS' | 'READ_PREPARED' | 'RESOLVE_MAP' | 'REGISTER_MAP' | 'CONTINUE_WITHOUT_MAP' | 'EXECUTE_ASTRA';
export type WorkspaceConfig = Readonly<{ origin: string; key: Uint8Array; configHash: string; releaseSha: string; deploymentId: string }>;
export type WorkspaceBinding = Readonly<{ captureRevision: number; captureHash: string; claimFence: number; workflowRevision: number }>;
export type WorkspaceHumanScope = Readonly<{ actorId: string; sessionHash: string; controlRevision: number }>;
export type WorkspaceMachineScope = Readonly<{ actorKind: 'MACHINE'; actorId: string; accessVersion: number; controlRevision: number;
    runId: string; runRevision: number; leaseFence: number; runControlRevision: number }>;
export type WorkspaceSourceRequest = Readonly<{ requestId: string; cardId: string; scope: WorkspaceHumanScope | WorkspaceMachineScope; binding: WorkspaceBinding }>;
export type WorkspacePreparedRequest = Readonly<{ cardId: string; side: 'FRONT' | 'BACK'; manifestHash: string; scope: WorkspaceHumanScope; binding: WorkspaceBinding }>;
export type WorkspaceUploadRequest = Readonly<{ cardId: string; uploadId: string }>;
export type WorkspaceInput = WorkspaceSourceRequest | WorkspacePreparedRequest | WorkspaceUploadRequest | Readonly<{ runId: string; commandId: string }>;
export type WorkspaceClaims = Readonly<{ purpose: string; audience: string; deploymentId: string; releaseSha: string; configHash: string;
    issuedAt: number; expiresAt: number; nonce: string; action: WorkspaceAction; inputHash: string }>;
export const WORKSPACE_SERVICE_PATH: '/workspace/v1';
export function signWorkspaceRequest(config: WorkspaceConfig, action: WorkspaceAction, input: WorkspaceInput, now?: number):
    { body: string; claims: WorkspaceClaims; signature: string };
export function verifyWorkspaceRequest(config: WorkspaceConfig, body: string, signature: string, now?: number):
    { claims: WorkspaceClaims; input: WorkspaceInput };
export function workspaceResponseSignature(config: WorkspaceConfig, claims: WorkspaceClaims, bytes: Uint8Array, contentType: string): string;
export function workspaceServiceClient(config: WorkspaceConfig, fetchImpl?: typeof fetch):
    { call<T = unknown>(action: WorkspaceAction, input: WorkspaceInput): Promise<T> };
