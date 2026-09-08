import type { OperatorImageRequest } from './operator-images.mjs';
export const OPERATOR_EVIDENCE_PATH: '/api/internal/atlas/operator-evidence';
export function signOperatorEvidenceRequest(config: any, scope: any, request?: OperatorImageRequest | null, now?: number): { body: string; signature: string };
export function verifyOperatorEvidenceRequest(config: any, body: string, signed: unknown, now?: number): any;
export function operatorEvidenceClient(config: any, fetchImpl?: typeof fetch): { read(scope: any, request: OperatorImageRequest | null, options?: { signal?: AbortSignal }): Promise<any>; verify(receipt: any, scope: any, request: OperatorImageRequest | null, run: any, now?: number): any };
export class OperatorEvidenceBridge {
    constructor(options: { client: any; config: any; ports: any });
    authorize(claims: any): Promise<any>;
    read(claims: any): Promise<{ text: string; signature: string }>;
}
