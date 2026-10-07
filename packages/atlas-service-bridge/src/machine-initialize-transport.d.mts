import type { IntakeScope } from './intake.mjs';
export const MACHINE_INITIALIZATION_ADMISSION_PATH: '/api/internal/atlas/machine-initialize/admit';
export const MACHINE_INITIALIZATION_EXECUTION_PATH: '/api/internal/atlas/machine-initialize/execute';
export const MACHINE_INITIALIZATION_ADMISSION_PURPOSE: 'atlas-machine-initialize-admission-v1';
export const MACHINE_INITIALIZATION_EXECUTION_PURPOSE: 'atlas-machine-initialize-execution-v1';
export const MACHINE_INITIALIZATION_ADMISSION_SIGNATURE_HEADER: 'x-atlas-machine-admission-signature';
export const MACHINE_INITIALIZATION_EXECUTION_SIGNATURE_HEADER: 'x-atlas-machine-execution-signature';
export type MachineInitializationTransportConfig = Readonly<{ mode: 'PRODUCTION' | 'LOCAL_FIXTURE'; origin: string; runtimeHash: string;
    admissionKey: Buffer; executionKey: Buffer; admissionKeyHash: string; executionKeyHash: string }>;
export type MachineInitializationAdmissionConfig = Omit<MachineInitializationTransportConfig, 'executionKey'>;
export type MachineInitializationExecutionConfig = Omit<MachineInitializationTransportConfig, 'admissionKey'>;
export type MachineInitializationPurposeConfigInput = { mode: 'PRODUCTION' | 'LOCAL_FIXTURE'; origin: string; runtimeHash: string;
    key: Buffer | string; peerKeyHash: string; otherKeyHashes?: string[] };
export function makeMachineInitializationAdmissionConfig(input: MachineInitializationPurposeConfigInput): MachineInitializationAdmissionConfig;
export function makeMachineInitializationExecutionConfig(input: MachineInitializationPurposeConfigInput): MachineInitializationExecutionConfig;
export type MachineInitializationAdmissionInput = { jobId: string; specimenId: string; reason: string; authorizationEvidenceHash: string; runtimeHash: string };
export type MachineInitializationExecutionInput = { jobId: string; runtimeHash: string };
export type MachineInitializationAdmissionPacket = { purpose: typeof MACHINE_INITIALIZATION_ADMISSION_PURPOSE;
    audience: string; path: typeof MACHINE_INITIALIZATION_ADMISSION_PATH; scope: IntakeScope; input: MachineInitializationAdmissionInput;
    nonce: string; issuedAt: number; expiresAt: number };
export type MachineInitializationExecutionPacket = { purpose: typeof MACHINE_INITIALIZATION_EXECUTION_PURPOSE;
    audience: string; path: typeof MACHINE_INITIALIZATION_EXECUTION_PATH; input: MachineInitializationExecutionInput;
    nonce: string; issuedAt: number; expiresAt: number };
export type MachineInitializationAdmissionResponse = { jobId: string; specimenId: string; pilotId: string; gradingOperationId: string;
    runtimeHash: string; state: 'QUEUED' | 'DISPATCHED' | 'SUCCEEDED' | 'UNKNOWN' | 'FAILED'; deadlineAt: string };
export type MachineInitializationExecutionResponse = { jobId: string; runtimeHash: string } &
    ({ state: 'SUCCEEDED'; analysisRevision: 1; operatorRunId?: string } | { state: 'UNKNOWN' | 'FAILED' });
export function makeMachineInitializationTransportConfig(input: { mode: 'PRODUCTION' | 'LOCAL_FIXTURE'; origin: string; runtimeHash: string;
    admissionKey: Buffer | string; executionKey: Buffer | string; otherKeyHashes?: string[] }): MachineInitializationTransportConfig;
export function signMachineInitializationAdmission(config: MachineInitializationAdmissionConfig, scope: IntakeScope,
    input: MachineInitializationAdmissionInput, now?: number, nonce?: string): { body: string; signature: string };
export function verifyMachineInitializationAdmission(config: MachineInitializationAdmissionConfig, body: string, signature: string,
    now?: number): MachineInitializationAdmissionPacket;
export function signMachineInitializationExecution(config: MachineInitializationExecutionConfig, input: MachineInitializationExecutionInput,
    now?: number, nonce?: string): { body: string; signature: string };
export function verifyMachineInitializationExecution(config: MachineInitializationExecutionConfig, body: string, signature: string,
    now?: number): MachineInitializationExecutionPacket;
export function machineInitializationClient(config: MachineInitializationTransportConfig, fetchImpl?: typeof fetch,
    options?: { timers?: { setTimeout(callback: () => void, ms: number): unknown; clearTimeout(timer: unknown): void } }): Readonly<{
        binding: Readonly<{ origin: string; runtimeHash: string; admissionKeyHash: string; executionKeyHash: string }>;
        admit(scope: IntakeScope, input: MachineInitializationAdmissionInput, options?: { signal?: AbortSignal }): Promise<MachineInitializationAdmissionResponse>;
        execute(input: MachineInitializationExecutionInput, options?: { signal?: AbortSignal }): Promise<MachineInitializationExecutionResponse>;
    }>;
export function machineInitializationAdmissionClient(config: MachineInitializationAdmissionConfig, fetchImpl?: typeof fetch,
    options?: { timers?: { setTimeout(callback: () => void, ms: number): unknown; clearTimeout(timer: unknown): void } }):
    Omit<ReturnType<typeof machineInitializationClient>, 'execute'>;
export function machineInitializationExecutionClient(config: MachineInitializationExecutionConfig, fetchImpl?: typeof fetch,
    options?: { timers?: { setTimeout(callback: () => void, ms: number): unknown; clearTimeout(timer: unknown): void } }):
    Omit<ReturnType<typeof machineInitializationClient>, 'admit'>;
