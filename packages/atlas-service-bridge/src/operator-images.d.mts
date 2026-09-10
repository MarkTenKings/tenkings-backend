export type OperatorImageRect = { x: number; y: number; width: number; height: number };
export type OperatorImageRequest = { runId: string; expectedRevision: number; evidenceHash: string; manifestHash: string;
    assetId: string; sourceSha256: string; side: 'FRONT' | 'BACK'; purpose: 'OVERVIEW' | 'CROP'; rect: OperatorImageRect };
export type OperatorImageAsset = { assetId: string; sha256: string; side: 'FRONT' | 'BACK'; view: 'RECTIFIED' | 'ORIGINAL';
    width: number; height: number; byteCount: number; contentType: string };
export type OperatorImagePacket = { version: 'atlas-operator-image-v1'; imageId: string; request: OperatorImageRequest;
    transformCanonical: string; transformHash: string; decoder: string; contentType: 'image/png'; width: number; height: number;
    byteCount: number; sha256: string; bytesBase64: string };
export const IMAGE_TRANSFORM: string;
export const OPERATOR_IMAGE_DECODER: string;
export const MAX_OPERATOR_IMAGE_BYTES: number;
export const MAX_OPERATOR_CROP_PIXELS: number;
export const OVERVIEW_LONG_EDGE: number;
export function assertOperatorPngContainer(bytes: Buffer): void;
export function operatorImageTransform(request: OperatorImageRequest, asset: OperatorImageAsset, orientation: number): {
    output: { width: number; height: number }; rect: OperatorImageRect; [key: string]: unknown };
export function createOperatorImagePacket(input: { imageId: string; request: OperatorImageRequest; asset: OperatorImageAsset;
    orientation: number; decoder: string; bytes: Buffer }): OperatorImagePacket;
export function parseOperatorImagePacket(packet: OperatorImagePacket, request: OperatorImageRequest, asset: OperatorImageAsset): {
    packet: OperatorImagePacket; bytes: Buffer; transform: ReturnType<typeof operatorImageTransform>; dataUrl: string };
