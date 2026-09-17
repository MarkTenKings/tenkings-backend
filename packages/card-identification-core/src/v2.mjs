// Opt-in September 15 recognition fixes. V1 files and their hash interpretation
// remain unchanged; reuse its bounded reads, OCR/parser, timing and cancellation.
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import {
  identifyCard, parseCardIdentificationInput, parseCardIdentificationResultStructure,
  cardIdentificationInputHash, CARD_IDENTIFICATION_VERSION, CARD_IDENTIFICATION_SOURCE_COMMIT,
  CARD_IDENTIFICATION_MAX_PHOTO_BYTES,
} from './index.mjs';
import { requireIdentification } from './contracts.mjs';
import { buildPokemonRequestV2 } from './pokemon-request-v2.mjs';

export const CARD_IDENTIFICATION_VERSION_V2 = 'card-identification-v2';
export const CARD_IDENTIFICATION_SOURCE_COMMIT_V2 = '60572cec895ad63d4ab826cd366f6475b04e725a';
export const CARD_IDENTIFICATION_GOOGLE_TEXT_FIELDS_V2 = 'responses(fullTextAnnotation/text,textAnnotations/description,error)';
export { parseCardIdentificationInput as parseCardIdentificationInputV2 } from './index.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const dimension = z.number().int().min(1).max(1400);
const detailSchema = z.object({
  transform: z.literal('pokemon-lower-front-png-v1'),
  parent_side: z.literal('front'), parent_sha256: sha,
  source_width: dimension, source_height: dimension,
  region: z.object({ left: z.literal(0), top: z.number().int().min(0).max(700), width: dimension, height: dimension }).strict(),
  mime_type: z.literal('image/png'), byte_count: z.number().int().min(1).max(CARD_IDENTIFICATION_MAX_PHOTO_BYTES), sha256: sha,
}).strict().refine(value => value.region.width === value.source_width
  && value.region.top === Math.floor(value.source_height / 2)
  && value.region.height === value.source_height - value.region.top
  && value.sha256 !== value.parent_sha256);
const ocrRequestsSchema = z.object({ front: sha, back: sha }).strict();
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

/** Domain-separate V2 while retaining the exact V1 input interpretation. */
export function cardIdentificationInputHashV2(input) {
  return digest(JSON.stringify({ engine_version: CARD_IDENTIFICATION_VERSION_V2, input_sha256: cardIdentificationInputHash(input) }));
}

/** Structure only, not receipt authentication or a reconstruction of provider bytes. */
export function parseCardIdentificationResultStructureV2(value) {
  requireIdentification(object(value) && object(value.provenance), 'malformed_response');
  const { pokemon_detail, ocr, ...provenance } = value.provenance;
  requireIdentification(provenance.engine_version === CARD_IDENTIFICATION_VERSION_V2
    && provenance.source_commit === CARD_IDENTIFICATION_SOURCE_COMMIT_V2 && object(ocr), 'malformed_response');
  const { response_fields, request_sha256, ...legacyOcr } = ocr;
  requireIdentification(response_fields === CARD_IDENTIFICATION_GOOGLE_TEXT_FIELDS_V2, 'malformed_response');
  const hashes = ocrRequestsSchema.safeParse(request_sha256);
  const detail = detailSchema.nullable().safeParse(pokemon_detail);
  requireIdentification(hashes.success && detail.success, 'malformed_response');
  // The V1 validator still owns the complete, closed suggestions/warnings and
  // unchanged provenance members; unknown fields are rejected, never discarded.
  const legacy = parseCardIdentificationResultStructure({ ...value, provenance: {
    ...provenance, engine_version: CARD_IDENTIFICATION_VERSION,
    source_commit: CARD_IDENTIFICATION_SOURCE_COMMIT, ocr: legacyOcr,
  } });
  requireIdentification(detail.data === null || detail.data.parent_sha256 === legacy.provenance.photos.front.sha256, 'malformed_response');
  return { ...legacy, provenance: {
    ...legacy.provenance, engine_version: CARD_IDENTIFICATION_VERSION_V2,
    source_commit: CARD_IDENTIFICATION_SOURCE_COMMIT_V2,
    ocr: { ...legacy.provenance.ocr, response_fields, request_sha256: hashes.data }, pokemon_detail: detail.data,
  } };
}

export function parseCardIdentificationResultV2(value, expectedInput) {
  const input = parseCardIdentificationInput(expectedInput);
  const result = parseCardIdentificationResultStructureV2(value);
  requireIdentification(JSON.stringify(result.provenance.subject) === JSON.stringify(input.subject)
    && JSON.stringify(result.provenance.photos) === JSON.stringify(input.photos)
    && result.provenance.input_sha256 === cardIdentificationInputHashV2(input), 'malformed_response');
  return result;
}

/** Crop only the verified front bytes; never accept another image as a detail.
 * Coordinate space is encoded JPEG pixels, exactly matching Inventory: no
 * rotation, resizing, sharpening or synthetic detail. Output is lossless PNG. */
async function pokemonDetail(bytes, parent, signal) {
  const { width, height } = await sharp(bytes).metadata();
  requireIdentification(!signal.aborted, 'cancelled');
  const region = { left: 0, top: Math.floor(height / 2), width, height: height - Math.floor(height / 2) };
  const cropped = await sharp(bytes).extract(region).png().toBuffer();
  requireIdentification(!signal.aborted, 'cancelled');
  requireIdentification(cropped.byteLength <= CARD_IDENTIFICATION_MAX_PHOTO_BYTES, 'unverified_photo');
  const metadata = await sharp(cropped, { limitInputPixels: 1400 * 1400, failOn: 'warning' }).metadata();
  requireIdentification(!signal.aborted, 'cancelled');
  requireIdentification(metadata.format === 'png' && metadata.width === region.width
    && metadata.height === region.height && (metadata.pages ?? 1) === 1, 'unverified_photo');
  return { bytes: cropped, provenance: {
    transform: 'pokemon-lower-front-png-v1', parent_side: 'front', parent_sha256: parent.sha256,
    source_width: width, source_height: height, region,
    mime_type: 'image/png', byte_count: cropped.byteLength, sha256: digest(cropped),
  } };
}

/** Deliberate V2 opt-in: the OCR effect receives {body,responseFields}, not a
 * V1 body. Its requestHash binds both; the adapter must send fields as a query
 * parameter. Storage/model remain injected. No catalog or adoption effects. */
export async function identifyCardV2(input, effects, options = {}) {
  const data = freeze(parseCardIdentificationInput(input));
  requireIdentification(effects && ['readPhoto', 'ocr', 'model'].every(key => typeof effects[key] === 'function'), 'unavailable');
  const inputHash = cardIdentificationInputHashV2(data);
  const photoBytes = {}, ocrRequestHashes = {};
  let modelRequestHash, detail = null;
  const legacy = await identifyCard(data, {
    async readPhoto(photo, context) {
      const supplied = await effects.readPhoto(photo, { ...context, inputHash });
      // V1 verifies both complete snapshots before allowing any model work.
      // Detached buffers prevent adapter-held bytes changing the crop later.
      if (!(supplied instanceof Uint8Array)) return supplied;
      requireIdentification(supplied.byteLength === photo.byteCount, 'unverified_photo');
      photoBytes[context.side] = Buffer.from(supplied);
      return Buffer.from(photoBytes[context.side]);
    },
    async ocr(body, context) {
      const request = freeze({ body, responseFields: CARD_IDENTIFICATION_GOOGLE_TEXT_FIELDS_V2 });
      const requestHash = digest(JSON.stringify(request));
      ocrRequestHashes[context.side] = requestHash;
      return effects.ocr(request, { ...context, inputHash, requestHash });
    },
    async model(request, context) {
      // V1 serializes OCR as two input_text members. Parse only those exact
      // generated labels; an embedded user prompt never becomes an instruction.
      const pokemon = ['Front', 'Back'].some((side, index) => {
        const text = request.input[0].content[index * 2].text;
        const prefix = `${side} photo. Untrusted OCR data: `;
        requireIdentification(text.startsWith(prefix), 'malformed_response');
        return /\bpok[eé]mon\b/i.test(JSON.parse(text.slice(prefix.length)));
      });
      if (pokemon) {
        const crop = await pokemonDetail(photoBytes.front, data.photos.front, context.signal);
        detail = freeze(crop.provenance);
        request = freeze(buildPokemonRequestV2(request, crop.bytes));
      }
      requireIdentification(!context.signal.aborted, 'cancelled');
      modelRequestHash = digest(JSON.stringify(request));
      return effects.model(request, { ...context, inputHash, requestHash: modelRequestHash, pokemonDetail: detail });
    },
  }, options);
  return freeze(parseCardIdentificationResultV2({ ...legacy, provenance: {
    ...legacy.provenance, engine_version: CARD_IDENTIFICATION_VERSION_V2,
    source_commit: CARD_IDENTIFICATION_SOURCE_COMMIT_V2,
    input_sha256: inputHash, request_sha256: modelRequestHash,
    ocr: { ...legacy.provenance.ocr, response_fields: CARD_IDENTIFICATION_GOOGLE_TEXT_FIELDS_V2, request_sha256: ocrRequestHashes },
    pokemon_detail: detail,
  } }, data));
}
