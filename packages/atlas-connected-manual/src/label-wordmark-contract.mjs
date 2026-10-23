import { canonical, digest, immutable, requireThat } from '@atlas/manual-service/contract';

export const LABEL_WORDMARK_POLICY = 'atlas-original-label-wordmark-v1';
export const LABEL_WORDMARK_IMAGE_MODEL = 'gpt-image-2.5-flare-2026-09-08';
export const LABEL_WORDMARK_VERIFY_MODEL = 'gpt-6-astra';
export const LABEL_WORDMARK_TRAITS = Object.freeze(['BRUSH', 'SCRIPT', 'HAND_DRAWN', 'BLOCK', 'SERIF', 'SANS',
  'CONDENSED', 'WIDE', 'UPRIGHT', 'ITALIC', 'LIGHT', 'MEDIUM', 'BOLD', 'HEAVY', 'CLEAN', 'ROUGH', 'DRY_BRUSH', 'TIGHT', 'OPEN']);
export const LABEL_WORDMARK_LIMITS = Object.freeze({ imageBytes: 8 * 1024 * 1024, responseBytes: 12 * 1024 * 1024,
  verificationResponseBytes: 256 * 1024, timeoutMs: 300000, width: 1536, height: 1024, words: 8, text: 100,
  outputWidth: 4096, outputHeight: 512, maskBytes: 256 * 1024, opticalHeight: 256 });
export const wordmarkHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const wordmarkFields = (value, names) => value && Object.getPrototypeOf(value) === Object.prototype
  && Object.keys(value).sort().join('|') === [...names].sort().join('|');
const check = (ok, code = 'LABEL_WORDMARK_REQUEST_INVALID') => requireThat(ok, 409, code);

/** Finite generic morphology only: never a font name, prompt, URL or source crop.
 * Text is literal approved display content. It is not changed or inferred here. */
export function prepareLabelWordmarkRequest(input) {
  check(wordmarkFields(input, ['sourceHash', 'role', 'text', 'traits', 'normalizeWordInkHeight']));
  check(wordmarkHash(input.sourceHash) && ['identity', 'variant'].includes(input.role)
    && typeof input.text === 'string' && input.text.length > 0 && input.text.length <= LABEL_WORDMARK_LIMITS.text
    && input.text === input.text.trim() && !/ {2}|[^\p{L}\p{M}\p{N} '\u2019&/.,:+#()\-]/u.test(input.text)
    && input.text.split(' ').length <= LABEL_WORDMARK_LIMITS.words && /[\p{L}\p{N}]/u.test(input.text)
    && typeof input.normalizeWordInkHeight === 'boolean');
  check(Array.isArray(input.traits) && input.traits.length > 0 && input.traits.length <= 8
    && new Set(input.traits).size === input.traits.length && input.traits.every(trait => LABEL_WORDMARK_TRAITS.includes(trait)));
  for (const group of [['BRUSH', 'SCRIPT', 'HAND_DRAWN', 'BLOCK', 'SERIF', 'SANS'], ['CONDENSED', 'WIDE'],
    ['UPRIGHT', 'ITALIC'], ['LIGHT', 'MEDIUM', 'BOLD', 'HEAVY'], ['CLEAN', 'ROUGH', 'DRY_BRUSH'], ['TIGHT', 'OPEN']]) {
    check(input.traits.filter(trait => group.includes(trait)).length <= 1);
  }
  const request = { policy: LABEL_WORDMARK_POLICY, model: LABEL_WORDMARK_IMAGE_MODEL, sourceHash: input.sourceHash,
    role: input.role, text: input.text, traits: [...input.traits].sort(), normalizeWordInkHeight: input.normalizeWordInkHeight,
    output: { width: LABEL_WORDMARK_LIMITS.width, height: LABEL_WORDMARK_LIMITS.height, format: 'png', quality: 'high', background: 'opaque' } };
  return immutable({ ...request, requestKey: `label-wordmark-generate:v1:${digest(canonical(request))}` });
}

export function validateLabelWordmarkRequest(raw) {
  check(raw && typeof raw === 'object');
  const expected = prepareLabelWordmarkRequest({ sourceHash: raw.sourceHash, role: raw.role, text: raw.text,
    traits: raw.traits, normalizeWordInkHeight: raw.normalizeWordInkHeight });
  check(canonical(expected) === canonical(raw), 'LABEL_WORDMARK_REQUEST_CHANGED');
  return expected;
}

export function prepareLabelWordmarkVerificationRequest(rawRequest, image) {
  const request = validateLabelWordmarkRequest(rawRequest);
  check(wordmarkHash(image?.sha256) && image.width === LABEL_WORDMARK_LIMITS.width && image.height === LABEL_WORDMARK_LIMITS.height
    && image.mimeType === 'image/png', 'LABEL_WORDMARK_IMAGE_INVALID');
  const value = { policy: LABEL_WORDMARK_POLICY, model: LABEL_WORDMARK_VERIFY_MODEL, reasoning: 'xhigh', sourceHash: request.sourceHash,
    generationRequestKey: request.requestKey, image: { sha256: image.sha256, width: image.width, height: image.height, mimeType: image.mimeType } };
  return immutable({ ...value, requestKey: `label-wordmark-verify:v1:${digest(canonical(value))}` });
}

const objectSchema = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
export const labelWordmarkVerificationSchema = () => objectSchema({ transcription: { type: 'string' }, singleLine: { type: 'boolean' },
  extraMarks: { type: 'boolean' }, confidence: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
  words: { type: 'array', maxItems: LABEL_WORDMARK_LIMITS.words, items: objectSchema({ text: { type: 'string' },
    x: { type: 'integer' }, y: { type: 'integer' }, width: { type: 'integer' }, height: { type: 'integer' } }) } });

/** Model confidence is a gate, never a measured accuracy or ownership claim. */
export function validateLabelWordmarkReading(raw, rawRequest, image) {
  const request = validateLabelWordmarkRequest(rawRequest), expectedWords = request.text.split(' ');
  check(wordmarkFields(raw, ['transcription', 'singleLine', 'extraMarks', 'confidence', 'words']), 'LABEL_WORDMARK_READING_INVALID');
  check(raw.transcription === request.text && raw.singleLine === true && raw.extraMarks === false && raw.confidence === 'HIGH',
    'LABEL_WORDMARK_SPELLING_UNVERIFIED');
  check(Array.isArray(raw.words) && raw.words.length === expectedWords.length, 'LABEL_WORDMARK_READING_INVALID');
  const words = raw.words.map((word, index) => {
    check(wordmarkFields(word, ['text', 'x', 'y', 'width', 'height']) && word.text === expectedWords[index]
      && ['x', 'y', 'width', 'height'].every(key => Number.isSafeInteger(word[key]))
      && word.x >= 0 && word.y >= 0 && word.width >= 8 && word.height >= 16
      && word.x + word.width <= image.width && word.y + word.height <= image.height,
    'LABEL_WORDMARK_BOX_INVALID');
    if (index) check(word.x > raw.words[index - 1].x + raw.words[index - 1].width, 'LABEL_WORDMARK_BOX_INVALID');
    return { ...word };
  });
  return immutable({ ...raw, words });
}
