import type {
  IdentificationInput, IdentificationPhotos, IdentificationResult, IdentificationEffects,
  IdentificationRequest, IdentificationEffectContext, IdentificationPhoto, IdentificationOptions,
} from './index.js';

export const CARD_IDENTIFICATION_VERSION_V2: 'card-identification-v2';
export const CARD_IDENTIFICATION_SOURCE_COMMIT_V2: '60572cec895ad63d4ab826cd366f6475b04e725a';
export const CARD_IDENTIFICATION_GOOGLE_TEXT_FIELDS_V2: 'responses(fullTextAnnotation/text,textAnnotations/description,error)';
export type IdentificationPokemonDetailV2 = {
  transform: 'pokemon-lower-front-png-v1'; parent_side: 'front'; parent_sha256: string;
  source_width: number; source_height: number;
  region: { left: 0; top: number; width: number; height: number };
  mime_type: 'image/png'; byte_count: number; sha256: string;
};
export type IdentificationOcrRequestV2 = Readonly<{
  body: IdentificationRequest; responseFields: typeof CARD_IDENTIFICATION_GOOGLE_TEXT_FIELDS_V2;
}>;
export type IdentificationEffectsV2 = {
  readPhoto: IdentificationEffects['readPhoto'];
  /** Send request.body as JSON and request.responseFields as Google's fields query.
   * requestHash covers JSON.stringify of the entire envelope, without secrets. */
  ocr(request: IdentificationOcrRequestV2, context: IdentificationEffectContext & {
    side: 'front' | 'back'; photo: IdentificationPhoto; requestHash: string;
  }): Promise<Uint8Array>;
  model(request: IdentificationRequest, context: IdentificationEffectContext & {
    photos: IdentificationPhotos; requestHash: string; pokemonDetail: IdentificationPokemonDetailV2 | null;
  }): Promise<Uint8Array>;
};
export type IdentificationResultV2 = Omit<IdentificationResult, 'provenance'> & {
  provenance: Omit<IdentificationResult['provenance'], 'engine_version' | 'source_commit' | 'ocr'> & {
    engine_version: 'card-identification-v2'; source_commit: typeof CARD_IDENTIFICATION_SOURCE_COMMIT_V2;
    ocr: IdentificationResult['provenance']['ocr'] & {
      response_fields: typeof CARD_IDENTIFICATION_GOOGLE_TEXT_FIELDS_V2;
      request_sha256: { front: string; back: string };
    };
    pokemon_detail: IdentificationPokemonDetailV2 | null;
  };
};
export function parseCardIdentificationInputV2(value: unknown): IdentificationInput;
export function cardIdentificationInputHashV2(input: IdentificationInput): string;
export function identifyCardV2(input: IdentificationInput, effects: IdentificationEffectsV2, options?: IdentificationOptions): Promise<IdentificationResultV2>;
export function parseCardIdentificationResultV2(value: unknown, expectedInput: IdentificationInput): IdentificationResultV2;
export function parseCardIdentificationResultStructureV2(value: unknown): IdentificationResultV2;
