import sharp from 'sharp';
import { digest } from '@atlas/manual-service/contract';
import { prepareLabelStyleRequest, LABEL_STYLE_MODEL } from '../src/label-style-contract.mjs';
import { createLabelStyleCache } from '../src/label-style-cache.mjs';

export const styleFonts = [
  { id: 'knewave', family: 'Knewave', sha256: 'a'.repeat(64), traits: ['bold brush display'], weight: 400, license: 'OFL-1.1', approximation: true },
  { id: 'sans', family: 'Geometric Sans', sha256: 'b'.repeat(64), traits: ['heavy geometric sans'], weight: 900, license: 'OFL-1.1', approximation: true },
];
export async function styleFixture(overrides = {}) {
  const images = {};
  for (const [side, background] of [['FRONT', '#235BA9'], ['BACK', '#DDDDDD']]) {
    const bytes = await sharp({ create: { width: 32, height: 48, channels: 3, background } }).png().toBuffer();
    images[side] = { bytes, sha256: digest(bytes), contentType: 'image/png' };
  }
  const input = {
    approval: { cardId: '8d63e0e2-41f8-4cd0-bad4-54e06e247ec4', actionId: '6d964eee-65a4-442a-b6c5-f92e1bbb460c',
      approvalVersion: 2, publicHash: 'c'.repeat(64), reportHash: 'd'.repeat(64) },
    cardProfile: 'SPORTS',
    identity: { playerName: 'New Player', manufacturer: 'Example', year: '2026', productSet: 'Faceted Collection',
      parallel: 'Cobalt Crystal', insert: null, cardNumber: '42' },
    photos: Object.entries(images).map(([side, image]) => ({ side, sha256: image.sha256, contentType: image.contentType, width: 32, height: 48, byteCount: image.bytes.length })),
    lines: [{ role: 'identity', text: '#42 2026 Example Faceted Collection', styleableSpans: [{ start: 17, end: 35 }] },
      { role: 'variant', text: 'COBALT CRYSTAL /199' }], ...overrides,
  };
  // Compute exact product span, preserving numbering/year/maker outside it.
  if (!overrides.lines) input.lines[0].styleableSpans = [{ start: input.lines[0].text.indexOf('Faceted'), end: input.lines[0].text.length }];
  const request = prepareLabelStyleRequest(input, { fontCatalog: styleFonts, defaultFontId: 'knewave' });
  return { input, request, images, readApprovedImage: async ({ photo }) => images[photo.side] };
}
export function styleSource(request, overrides = {}) {
  return { side: 'FRONT', sha256: request.source.photos[0].sha256, box: { x: 0.1, y: 0.2, width: 0.15, height: 0.3 },
    basis: 'CARD_BORDER', confidence: 'HIGH', observation: 'Visible blue faceted border field.', ...overrides };
}
export function styleObservation(request) {
  return { lines: request.source.lines.map(line => ({ role: line.role, letteringMode: 'CATALOG', letteringDescription: '', letteringTraits: [],
    fontId: 'sans', fontSource: styleSource(request, { basis: 'PRINTED_LETTERING', observation: 'Heavy geometric lettering is visible.' }),
    emphasis: 'LARGE', normalizeWordInkHeight: true,
    spans: [{ start: line.styleableSpans[0].start, end: line.styleableSpans[0].end,
      baseColor: '#235ba9', accentColor: '#dbe9ff', pattern: 'DIAMOND', opticalScale: 1.1, source: styleSource(request) }] })) };
}
export function styleResponse(request, observation = styleObservation(request)) {
  return { id: 'resp_synthetic_style', model: LABEL_STYLE_MODEL, status: 'completed', output: [
    { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(observation) }] }], usage: { total_tokens: 24 } };
}
export function memoryStyleCache() {
  const values = new Map();
  const cache = createLabelStyleCache({
    read: async key => values.has(key) ? Buffer.from(values.get(key)) : null,
    putIfAbsent: async (key, bytes) => { if (values.has(key)) return false; values.set(key, Buffer.from(bytes)); return true; },
  });
  return { cache, values };
}
