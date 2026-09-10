import type { OperatorImageRequest } from './operator-images.mjs';
export const OPERATOR_EVIDENCE_PATH: '/api/internal/atlas/operator-evidence';
export function signOperatorEvidenceRequest(config: any, scope: any, request?: OperatorImageRequest | null, now?: number): { body: string; signature: string };
export function verifyOperatorEvidenceRequest(config: any, body: string, signed: unknown, now?: number): any;
export function operatorEvidenceClient(config: any, fetchImpl?: typeof fetch): { read(scope: any, request: OperatorImageRequest | null, options?: { signal?: AbortSignal }): Promise<any>; verify(receipt: any, scope: any, request: OperatorImageRequest | null, run: any, now?: number): any };
export type OperatorCaptureDescriptor = Readonly<{ objectRef: string; sha256: string; byteCount: number;
    contentType: 'image/jpeg' | 'image/png' | 'image/webp'; width: number; height: number; versionId?: string }>;
export type OperatorCaptureEvidencePorts = {
    /** DB-only current source/storage admission; must return these exact
     * immutable original descriptors and capture hash. No caller-selected URL. */
    loadCapture(tx: any, input: { workspace: any; originals: Record<'FRONT' | 'BACK', OperatorCaptureDescriptor> }):
        Promise<{ captureHash: string; originals: Record<'FRONT' | 'BACK', OperatorCaptureDescriptor> }>;
    /** Fetch exact object bytes outside the authority transaction. Existing
     * decoder verifies hash/dimensions; the bridge reauthorizes after render. */
    readCapture(descriptor: OperatorCaptureDescriptor, signal: AbortSignal): Promise<Buffer>;
};
export class OperatorEvidenceBridge {
    constructor(options: { client: any; config: any; ports: any });
    authorize(claims: any): Promise<any>;
    read(claims: any): Promise<{ text: string; signature: string }>;
}
