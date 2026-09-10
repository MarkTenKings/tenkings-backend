import type { BridgeServerConfig, EvidenceDescriptor } from './executor.mjs';
export const MEDIA_PATH: '/api/internal/atlas/public-media';
export const MEDIA_PURPOSE: 'atlas-approved-public-image-v1';
export type PublicImageReference = { token: string; version: number; side: 'FRONT' | 'BACK'; publicHash: string; imageHash: string };
export type PublicMediaClaims = PublicImageReference & { purpose: typeof MEDIA_PURPOSE; issuer: 'atlas-public'; audience: string;
    deploymentId: string; releaseSha: string; configHash: string; issuedAt: number; expiresAt: number; nonce: string };
export type PublicMediaClientConfig = { mediaOrigin: string; mediaKey: Buffer; deploymentId: string; releaseSha: string; configHash: string };
export function parseApprovedImageDescriptor(value: unknown, mode: 'LOCAL_FIXTURE' | 'PRODUCTION'): EvidenceDescriptor;
export function signPublicMediaRequest(config: PublicMediaClientConfig, reference: PublicImageReference, now?: number): { body: string; signature: string };
export function verifyPublicMediaRequest(config: { origin: string; key: Buffer }, body: string, signature: unknown, now?: number): PublicMediaClaims;
export function publicMediaClient(config: PublicMediaClientConfig, fetchImpl?: typeof fetch): { read(reference: PublicImageReference, descriptor: EvidenceDescriptor): Promise<Buffer> };
export class ApprovedPublicMedia<Tx> {
    constructor(options: { client: { $transaction<T>(work: (tx: Tx) => Promise<T>, options?: { maxWait?: number; timeout?: number }): Promise<T> };
        config: Omit<BridgeServerConfig, 'gradingPolicyHash'>; readStorage: (sourceRef: string, limit: number) => Promise<Uint8Array> });
    read(claims: PublicMediaClaims): Promise<{ bytes: Buffer; contentType: string }>;
}
