import { z } from 'zod';

export const CARD_IDENTIFICATION_VERSION = 'card-identification-v1';
export const CARD_IDENTIFICATION_SOURCE_COMMIT = 'a319904273d4b4e4e81d721b699d3a2990975eda';
export const CARD_IDENTIFICATION_MODEL = 'gpt-6-astra';
export const CARD_IDENTIFICATION_FIELDS = Object.freeze(['name', 'category', 'manufacturer', 'card_number', 'year', 'set_name', 'variant', 'card_type']);
export const CARD_IDENTIFICATION_CATEGORIES = Object.freeze(['Sports cards', 'Pokémon', 'Other trading cards']);
// Property order and values are retained because the prompt serializes this object.
export const CARD_IDENTIFICATION_LIMITS = Object.freeze({
  name: 160, category: 80, manufacturer: 160, card_number: 80, year: 20, set_name: 160, variant: 160, card_type: 160,
});
export const CARD_IDENTIFICATION_DEADLINES = Object.freeze({ photo_read: 6000, ocr: 8000, model: 25000, overall: 40000 });
export const CARD_IDENTIFICATION_MAX_PHOTO_BYTES = 3 * 1024 * 1024;
export const CARD_IDENTIFICATION_MAX_PROVIDER_BYTES = 256 * 1024;
export const CARD_IDENTIFICATION_MAX_OCR_CHARS = 6000;

const messages = Object.freeze({
  invalid_input: 'Choose one front photo and one different back photo. Your entry is preserved.',
  unverified_photo: 'A card photo could not be verified. Your entry is preserved.',
  unavailable: 'Card identification is not configured. Your entry is preserved.',
  provider_error: 'Card identification could not finish. Your entry is preserved.',
  malformed_response: 'Card identification returned unreadable suggestions. Your entry is preserved.',
  timeout: 'Card identification took too long. Your entry is preserved.',
  cancelled: 'Card identification was cancelled. Your entry is preserved.',
  unsupported_knowledge: 'This identifier version does not accept additional knowledge context.',
});
export class CardIdentificationError extends Error {
  constructor(code) {
    const safeCode = Object.hasOwn(messages, code) ? code : 'provider_error';
    super(messages[safeCode]); this.name = 'CardIdentificationError'; this.code = safeCode;
  }
}
export function requireIdentification(ok, code = 'invalid_input') { if (!ok) throw new CardIdentificationError(code); }
export function unsafeText(value) {
  return /[\u0000-\u001f\u007f]|https?:\/\/|data:|\b(?:sk|sess|proj)-[A-Za-z0-9_-]{8,}|(?:^|\s)(?:\/[\w.-]+){2,}|<\/?[a-z][^>]*>/i.test(value);
}
const confidence = z.enum(['high', 'medium', 'low', 'unknown']);
function suggestionSchema(max) {
  return z.object({ value: z.string().min(1).max(max).nullable(), confidence, evidence: z.string().min(1).max(240).nullable() }).strict()
    .refine(field => field.value === null ? field.confidence === 'unknown' && field.evidence === null : field.confidence !== 'unknown' && field.evidence !== null);
}
const suggestionsSchema = z.object(Object.fromEntries(CARD_IDENTIFICATION_FIELDS.map(field => [field, suggestionSchema(CARD_IDENTIFICATION_LIMITS[field])]))).strict();

/** Same closed eight-field content as collect. Never trim, truncate, fill or adopt. */
export function parseCardIdentificationSuggestions(value) {
  const parsed = suggestionsSchema.safeParse(value);
  requireIdentification(parsed.success, 'malformed_response');
  for (const field of Object.values(parsed.data)) {
    requireIdentification(![field.value, field.evidence].some(text => text !== null && (text !== text.trim() || unsafeText(text))), 'malformed_response');
  }
  requireIdentification(parsed.data.category.value === null || CARD_IDENTIFICATION_CATEGORIES.includes(parsed.data.category.value), 'malformed_response');
  return parsed.data;
}

const opaque = z.string().min(1).max(512).refine(value => value === value.trim() && !/[\u0000-\u001f\u007f]|https?:\/\/|data:/i.test(value));
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const photoSchema = z.object({ ref: opaque, sha256: sha, byteCount: z.number().int().min(1).max(CARD_IDENTIFICATION_MAX_PHOTO_BYTES) }).strict();
const subjectSchema = z.object({ id: opaque, revision: opaque }).strict();
const inputSchema = z.object({
  subject: subjectSchema,
  photos: z.object({ front: photoSchema, back: photoSchema }).strict(),
  // The reviewed identifier never loads learned knowledge. Do not pretend that
  // a new nonempty context can be consumed with its unchanged request/prompt.
  knowledge: z.null().optional(),
}).strict().refine(value => value.photos.front.ref !== value.photos.back.ref && value.photos.front.sha256 !== value.photos.back.sha256);

export function parseCardIdentificationInput(value) {
  if (value && typeof value === 'object' && Object.hasOwn(value, 'knowledge') && value.knowledge !== null && value.knowledge !== undefined) throw new CardIdentificationError('unsupported_knowledge');
  const parsed = inputSchema.safeParse(value);
  requireIdentification(parsed.success);
  if (parsed.data.knowledge === undefined) delete parsed.data.knowledge;
  return parsed.data;
}

const safeText = max => z.string().min(1).max(max).refine(value => value === value.trim() && !unsafeText(value));
const duration = z.number().int().min(0).max(45000);
const provenanceSchema = z.object({
  engine_version: z.literal(CARD_IDENTIFICATION_VERSION), source_commit: z.literal(CARD_IDENTIFICATION_SOURCE_COMMIT),
  subject: subjectSchema, photos: z.object({ front: photoSchema, back: photoSchema }).strict(),
  input_sha256: sha, request_sha256: sha, response_sha256: sha,
  model: z.literal(CARD_IDENTIFICATION_MODEL), reasoning_effort: z.literal('low'),
  identified_at: z.string().datetime().refine(value => value.length === 24 && new Date(value).toISOString() === value),
  elapsed_ms: duration, stage_timings_ms: z.object({ photo_read: duration, ocr: duration, model: duration }).strict(),
  ocr: z.object({ provider: z.literal('google_vision'), front: z.enum(['read', 'empty', 'unavailable']), back: z.enum(['read', 'empty', 'unavailable']) }).strict(),
  knowledge: z.null(),
}).strict().refine(value => Object.values(value.stage_timings_ms).every(time => time <= value.elapsed_ms));
const resultSchema = z.object({ suggestions: suggestionsSchema, warnings: z.array(safeText(240)).max(4), provenance: provenanceSchema }).strict();

/** Structure only; use the main module's parseCardIdentificationResult to check input/hash binding. */
export function parseCardIdentificationResultStructure(value) {
  const parsed = resultSchema.safeParse(value);
  requireIdentification(parsed.success, 'malformed_response');
  parseCardIdentificationSuggestions(parsed.data.suggestions);
  return parsed.data;
}
