import type { BinaryLike } from 'node:crypto';
export const BRIDGE_PATH: '/api/internal/atlas/bridge';
export const BRIDGE_PURPOSE: 'atlas-staff-grading-bridge-v1';
export const UUID: RegExp;
export const SHA: RegExp;
export function requireBridge(condition: unknown, code?: string): asserts condition;
export function canonical(value: unknown): string;
export function digest(value: BinaryLike): string;
export function keys(value: unknown, names: readonly string[]): void;
export function keyBytes(value: unknown): Buffer;
export function bridgeOrigin(value: unknown): string;
export type BridgeScope = { controlRevision: number; specimenId: string; actorId: string; sessionHash: string; assignmentFence: number; evidenceHash: string };
export type BridgeConfig = { origin: string; deploymentId: string; releaseSha: string; key: Buffer };
export type BridgeClaims = BridgeScope & { purpose: typeof BRIDGE_PURPOSE; audience: string; issuer: 'atlas-staff';
    deploymentId: string; releaseSha: string; issuedAt: number; expiresAt: number; nonce: string; payloadHash: string };
export type BridgePayload = { action: 'RUN_REVIEW'; operationId: string } | { action: 'READ_EVIDENCE'; side: 'FRONT' | 'BACK' }
    | { action: 'READ_TRACE'; findingId: string; analysisRevision: number };
export function validatePayload(value: unknown): BridgePayload;
export function signRequest(config: BridgeConfig, scope: BridgeScope, payload: BridgePayload, now?: number): { body: string; signature: string };
export function verifyRequest(config: Pick<BridgeConfig, 'key' | 'origin'>, body: string, signature: unknown, now?: number): { claims: BridgeClaims; payload: BridgePayload };
export type PilotPolicy = ({ version: 'atlas-grading-bridge-policy-v1'; specimenIds: string[] }
    | { version: 'atlas-workspace-bridge-policy-v1'; workspaceCardIds: string[] }) & { pilotId: string; expiresAt: string;
    maxOperationsPerCard: number; maxTotalMicroUsd: number; maxCardMicroUsd: number; reservationPerOperationMicroUsd: number;
    maxWorkerCalls: number; deadlineMs: number; budgetEnforcement?: 'ACCOUNTING_ONLY' };
export function parsePilotPolicy(value: unknown): PilotPolicy;
export function pilotDollarLimitsAllow(policy: PilotPolicy, usage: { total: string | number | bigint; card: string | number | bigint; overrun: boolean }, reserve?: bigint): boolean;
