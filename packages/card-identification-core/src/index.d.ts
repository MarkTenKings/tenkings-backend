export type IdentificationField = 'name' | 'category' | 'manufacturer' | 'card_number' | 'year' | 'set_name' | 'variant' | 'card_type';
export type IdentificationSuggestion = { value: string | null; confidence: 'high' | 'medium' | 'low' | 'unknown'; evidence: string | null };
export type IdentificationSuggestions = Record<IdentificationField, IdentificationSuggestion>;
export type IdentificationSubject = { id: string; revision: string };
/** An authorized opaque reference to a JPEG interpretation derivative, not a grading original. */
export type IdentificationPhoto = { ref: string; sha256: string; byteCount: number };
export type IdentificationPhotos = { front: IdentificationPhoto; back: IdentificationPhoto };
export type IdentificationInput = { subject: IdentificationSubject; photos: IdentificationPhotos; knowledge?: null };
export type IdentificationOcr = { text: string; status: 'read' | 'empty' | 'unavailable' };
export type IdentificationResult = {
  suggestions: IdentificationSuggestions;
  warnings: string[];
  provenance: {
    engine_version: 'card-identification-v1'; source_commit: string;
    subject: IdentificationSubject; photos: IdentificationPhotos;
    input_sha256: string; request_sha256: string; response_sha256: string;
    model: 'gpt-6-astra'; reasoning_effort: 'low'; identified_at: string; elapsed_ms: number;
    stage_timings_ms: { photo_read: number; ocr: number; model: number };
    ocr: { provider: 'google_vision'; front: IdentificationOcr['status']; back: IdentificationOcr['status'] };
    knowledge: null;
  };
};
export type IdentificationEffectContext = { subject: IdentificationSubject; inputHash: string; signal: AbortSignal };
export type IdentificationRequest = Readonly<Record<string, unknown>>;
export type IdentificationEffects = {
  /** Must authorize the subject/reference and bound its exact storage read; never follow caller URLs. */
  readPhoto(photo: IdentificationPhoto, context: IdentificationEffectContext & { side: 'front' | 'back' }): Promise<Uint8Array>;
  /** Return <=256 KiB raw JSON bytes. Adapter owns credentials, HTTP/stream status and usage receipts. */
  ocr(request: IdentificationRequest, context: IdentificationEffectContext & { side: 'front' | 'back'; photo: IdentificationPhoto; requestHash: string }): Promise<Uint8Array>;
  model(request: IdentificationRequest, context: IdentificationEffectContext & { photos: IdentificationPhotos; requestHash: string }): Promise<Uint8Array>;
};
export type IdentificationOptions = { signal?: AbortSignal; /** May shorten, never extend source deadlines. */ timeoutMs?: number };
export type IdentificationErrorCode = 'invalid_input' | 'unverified_photo' | 'unavailable' | 'provider_error' | 'malformed_response' | 'timeout' | 'cancelled' | 'unsupported_knowledge';
export class CardIdentificationError extends Error { constructor(code: IdentificationErrorCode); readonly code: IdentificationErrorCode; }
export const CARD_IDENTIFICATION_VERSION: 'card-identification-v1';
export const CARD_IDENTIFICATION_SOURCE_COMMIT: string;
export const CARD_IDENTIFICATION_MODEL: 'gpt-6-astra';
export const CARD_IDENTIFICATION_FIELDS: readonly IdentificationField[];
export const CARD_IDENTIFICATION_CATEGORIES: readonly ['Sports cards', 'Pokémon', 'Other trading cards'];
export const CARD_IDENTIFICATION_LIMITS: Readonly<Record<IdentificationField, number>>;
export const CARD_IDENTIFICATION_DEADLINES: Readonly<{ photo_read: 6000; ocr: 8000; model: 25000; overall: 40000 }>;
export const CARD_IDENTIFICATION_MAX_PHOTO_BYTES: number;
export const CARD_IDENTIFICATION_MAX_PROVIDER_BYTES: number;
export const CARD_IDENTIFICATION_MAX_OCR_CHARS: 6000;
export function identifyCard(input: IdentificationInput, effects: IdentificationEffects, options?: IdentificationOptions): Promise<IdentificationResult>;
export function cardIdentificationInputHash(input: IdentificationInput): string;
export function parseCardIdentificationInput(value: unknown): IdentificationInput;
export function parseCardIdentificationSuggestions(value: unknown): IdentificationSuggestions;
export function parseCardIdentificationOutput(value: unknown): IdentificationSuggestions;
export function parseCardIdentificationResult(value: unknown, expectedInput: IdentificationInput): IdentificationResult;
export function parseCardIdentificationResultStructure(value: unknown): IdentificationResult;
export function buildCardIdentificationOcrRequest(bytes: Uint8Array): IdentificationRequest;
export function parseCardIdentificationOcrOutput(value: unknown): IdentificationOcr;
