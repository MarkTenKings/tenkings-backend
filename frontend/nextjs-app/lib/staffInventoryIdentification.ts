import { z } from 'zod';

export const STAFF_INVENTORY_IDENTIFICATION_MODEL = 'gpt-6-astra' as const;
export const STAFF_INVENTORY_IDENTIFICATION_FIELDS = ['name', 'category', 'manufacturer', 'card_number', 'year', 'set_name', 'variant', 'card_type'] as const;
export type StaffInventoryIdentificationField = typeof STAFF_INVENTORY_IDENTIFICATION_FIELDS[number];
export const STAFF_INVENTORY_IDENTIFICATION_CATEGORIES = ['Sports cards', 'Pokémon', 'Other trading cards'] as const;
export const STAFF_INVENTORY_IDENTIFICATION_LIMITS: Record<StaffInventoryIdentificationField, number> = {
  name: 160, category: 80, manufacturer: 160, card_number: 80, year: 20, set_name: 160, variant: 160, card_type: 160,
};

const photoKey = z.string().regex(/^inventory-photos\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\/[a-f0-9]{64}\.jpg$/);
export const StaffInventoryIdentificationRequestSchema = z.object({ front_photo_key: photoKey, back_photo_key: photoKey }).strict()
  .refine(value => value.front_photo_key !== value.back_photo_key, 'Choose a different photo for each side.');
export type StaffInventoryIdentificationRequest = z.infer<typeof StaffInventoryIdentificationRequestSchema>;
export type StaffInventoryIdentificationSuggestion = {
  value: string | null;
  confidence: 'high' | 'medium' | 'low' | 'unknown';
  /** Brief visible evidence, not instructions or an authoritative identity. */
  evidence: string | null;
};
export type StaffInventoryIdentificationSuggestions = Record<StaffInventoryIdentificationField, StaffInventoryIdentificationSuggestion>;
export type StaffInventoryIdentificationResponse = {
  suggestions: StaffInventoryIdentificationSuggestions;
  warnings: string[];
  provenance: {
    model: typeof STAFF_INVENTORY_IDENTIFICATION_MODEL;
    reasoning_effort: 'low';
    identified_at: string;
    elapsed_ms: number;
    photos: { front: { key: string; sha256: string }; back: { key: string; sha256: string } };
    ocr: { provider: 'google_vision'; front: 'read' | 'empty' | 'unavailable'; back: 'read' | 'empty' | 'unavailable' };
  };
};

function recordWithKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
}

function boundedText(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum && value === value.trim() &&
    !/[\u0000-\u001f\u007f]|https?:\/\/|data:|\b(?:sk|sess|proj)-[A-Za-z0-9_-]{8,}|(?:^|\s)(?:\/[\w.-]+){2,}|<\/?[a-z][^>]*>/i.test(value);
}

/** Validate the whole server result before changing a draft, bound to this exact pair. */
export function isStaffInventoryIdentificationResponse(value: unknown, expected: StaffInventoryIdentificationRequest): value is StaffInventoryIdentificationResponse {
  if (!StaffInventoryIdentificationRequestSchema.safeParse(expected).success ||
      !recordWithKeys(value, ['suggestions', 'warnings', 'provenance']) ||
      !recordWithKeys(value.suggestions, STAFF_INVENTORY_IDENTIFICATION_FIELDS)) return false;
  for (const field of STAFF_INVENTORY_IDENTIFICATION_FIELDS) {
    const suggestion = value.suggestions[field];
    if (!recordWithKeys(suggestion, ['value', 'confidence', 'evidence'])) return false;
    if (suggestion.value === null) {
      if (suggestion.confidence !== 'unknown' || suggestion.evidence !== null) return false;
    } else if (!boundedText(suggestion.value, STAFF_INVENTORY_IDENTIFICATION_LIMITS[field]) ||
        typeof suggestion.confidence !== 'string' || !['high', 'medium', 'low'].includes(suggestion.confidence) ||
        !boundedText(suggestion.evidence, 240) ||
        (field === 'category' && !STAFF_INVENTORY_IDENTIFICATION_CATEGORIES.some(category => category === suggestion.value))) return false;
  }
  if (!Array.isArray(value.warnings) || value.warnings.length > 4 || !value.warnings.every(warning => boundedText(warning, 240))) return false;
  const provenance = value.provenance;
  if (!recordWithKeys(provenance, ['model', 'reasoning_effort', 'identified_at', 'elapsed_ms', 'photos', 'ocr']) ||
      provenance.model !== STAFF_INVENTORY_IDENTIFICATION_MODEL || provenance.reasoning_effort !== 'low' ||
      typeof provenance.identified_at !== 'string' || provenance.identified_at.length !== 24 ||
      !Number.isFinite(Date.parse(provenance.identified_at)) || new Date(provenance.identified_at).toISOString() !== provenance.identified_at ||
      typeof provenance.elapsed_ms !== 'number' || !Number.isSafeInteger(provenance.elapsed_ms) || provenance.elapsed_ms < 0 || provenance.elapsed_ms > 45000 ||
      !recordWithKeys(provenance.photos, ['front', 'back']) || !recordWithKeys(provenance.ocr, ['provider', 'front', 'back']) || provenance.ocr.provider !== 'google_vision') return false;
  for (const side of ['front', 'back'] as const) {
    const photo = provenance.photos[side], expectedKey = expected[`${side}_photo_key`];
    if (!recordWithKeys(photo, ['key', 'sha256']) || photo.key !== expectedKey || photo.sha256 !== expectedKey.slice(expectedKey.lastIndexOf('/') + 1, -4) ||
        typeof provenance.ocr[side] !== 'string' || !['read', 'empty', 'unavailable'].includes(provenance.ocr[side] as string)) return false;
  }
  return (provenance.photos.front as { sha256: string }).sha256 !== (provenance.photos.back as { sha256: string }).sha256;
}

export const STAFF_INVENTORY_IDENTIFICATION_ERROR_MESSAGES = {
  invalid_input: 'Add one front photo and one different back photo to identify the card. Your entry is preserved.',
  unverified_photo: 'A card photo could not be verified. Select that photo again. Your entry is preserved.',
  unavailable: 'Card identification is not configured. You can enter the card details yourself. Your entry is preserved.',
  provider_error: 'Card identification could not finish. Please retry or enter the details yourself. Your entry is preserved.',
  malformed_response: 'Card identification returned unreadable suggestions. Please retry or enter the details yourself. Your entry is preserved.',
  timeout: 'Card identification took too long. Please retry or enter the details yourself. Your entry is preserved.',
  cancelled: 'Card identification was cancelled. Your entry is preserved.',
} as const;
export type StaffInventoryIdentificationErrorCode = keyof typeof STAFF_INVENTORY_IDENTIFICATION_ERROR_MESSAGES;
