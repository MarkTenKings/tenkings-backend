// Compile-only consumer contract fixture; no provider or storage execution.
import { identifyCard, parseCardIdentificationResult, type IdentificationInput, type IdentificationEffects } from '@tenkings/card-identification-core';
import {
  identifyCardV2, parseCardIdentificationResultV2,
  type IdentificationEffectsV2, type IdentificationResultV2,
} from '@tenkings/card-identification-core/v2';

declare const input: IdentificationInput;
declare const legacyEffects: IdentificationEffects;
const effects: IdentificationEffectsV2 = {
  readPhoto: legacyEffects.readPhoto,
  async ocr(request, context) {
    const fields: string = request.responseFields;
    const body: Readonly<Record<string, unknown>> = request.body;
    const binding: string = context.inputHash + context.requestHash;
    void fields; void body; void binding;
    return new Uint8Array();
  },
  async model(_request, context) {
    if (context.pokemonDetail) {
      const side: 'front' = context.pokemonDetail.parent_side;
      const mime: 'image/png' = context.pokemonDetail.mime_type;
      void side; void mime;
    }
    return new Uint8Array();
  },
};
const legacy = await identifyCard(input, legacyEffects);
const current: IdentificationResultV2 = await identifyCardV2(input, effects);
parseCardIdentificationResult(legacy, input);
parseCardIdentificationResultV2(current, input);
const version: 'card-identification-v2' = current.provenance.engine_version;
void version;
// @ts-expect-error V2 cannot be assigned to persisted V1 result types.
const invalid: typeof legacy = current;
void invalid;
