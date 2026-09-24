import sharp from 'sharp';
import { identifyCardV2 } from '@tenkings/card-identification-core/v2';
import { digest, identityInput, requireThat } from './contract.mjs';

/** Neutral identification engine only. No staff ownership, geometry, grading,
 * report approval or Inventory financial writer enters customer intake. */
export function createCustomerIdentifier({ readWorkingPhoto, ocr, model }) {
  requireThat([readWorkingPhoto, ocr, model].every(value => typeof value === 'function'), 500, 'IDENTIFICATION_CONFIGURATION_REQUIRED');
  return async ({ accountId, cardId, sourceHash, photos, effect }) => {
    const loaded = new Map(), descriptors = {};
    for (const side of ['FRONT', 'BACK']) {
      const working = photos[side].workingFrame;
      const bytes = await readWorkingPhoto(working, { accountId, cardId, side, photo: photos[side] });
      requireThat(bytes instanceof Uint8Array && bytes.length === working.raster.content.byteCount && digest(bytes) === working.raster.content.sha256, 409, 'INTAKE_UPLOAD_CONFLICT');
      const jpeg = await sharp(bytes).resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
      const ref = `customer:${cardId}:${side}:${sourceHash}`;
      loaded.set(ref, jpeg); descriptors[side.toLowerCase()] = { ref, sha256: digest(jpeg), byteCount: jpeg.length };
    }
    const result = await identifyCardV2({ subject: { id: cardId, revision: sourceHash }, photos: descriptors }, {
      readPhoto: descriptor => loaded.get(descriptor.ref),
      ocr: (request, context) => effect(`OCR_${context.side.toUpperCase()}`, request, () => ocr(request, context)),
      model: (request, context) => effect('MODEL', request, () => model(request, context)),
    });
    const field = key => result.suggestions[key]?.value ?? '';
    const category = field('category') === 'Pokémon' ? 'POKEMON' : field('category') === 'Sports cards' ? 'SPORTS' : null;
    const playerName = field('name'), title = [field('year'), field('set_name'), playerName, field('card_number')].filter(Boolean).join(' ').slice(0, 180);
    const identity = category && title ? identityInput({ category, title, playerName, year: field('year'), manufacturer: field('manufacturer'), setName: field('set_name'),
      cardNumber: field('card_number'), parallel: field('variant'), insert: '' }) : null;
    return { identity, suggestions: result.suggestions, warnings: result.warnings, provenance: result.provenance };
  };
}
