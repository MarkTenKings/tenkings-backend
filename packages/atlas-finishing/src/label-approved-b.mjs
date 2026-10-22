import { readFileSync } from 'node:fs';
import * as fontkit from 'fontkit';
import { APPROVED_B_ASSETS, APPROVED_B_LAYOUT, approvedBHash, buildApprovedBFront,
  approvedBColors, colorApprovedBArtwork, renderApprovedBBack } from './label-approved-b-artwork.mjs';

const stable = value => value && typeof value === 'object' ? Array.isArray(value) ? `[${value.map(stable).join(',')}]`
  : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}` : JSON.stringify(value);
const fontsRoot = new URL('../assets/v4/', import.meta.url);
const fontProvenance = JSON.parse(readFileSync(new URL('provenance.json', fontsRoot)));
const font = (name, weight) => {
  const bytes = readFileSync(new URL(`fonts/${name}-variable.ttf`, fontsRoot));
  if (approvedBHash(bytes) !== fontProvenance.files[`fonts/${name}-variable.ttf`]) throw new Error('APPROVED_B_FONT_HASH_MISMATCH');
  return fontkit.create(bytes).getVariation({ wght: weight });
};
const headline = font('Montserrat', 900), detail = font('RobotoCondensed', 700);
const vectorBytes = readFileSync(new URL('../assets/approved-b/vectors.json', import.meta.url));
if (approvedBHash(vectorBytes) !== APPROVED_B_ASSETS.files['vectors.json']?.sha256) throw new Error('APPROVED_B_ASSET_HASH_MISMATCH');
const vectors = JSON.parse(vectorBytes);
export const LABEL_APPROVED_B_RENDERER_PROFILE = Object.freeze({
  version: APPROVED_B_LAYOUT, format: 'atlas-approved-b-label-v1', widthMm: 68.342, heightMm: 20.082,
  assets: Object.fromEntries(Object.entries(APPROVED_B_ASSETS.files).map(([name, value]) => [name, value.sha256])),
  fonts: { headline: fontProvenance.files['fonts/Montserrat-variable.ttf'], detail: fontProvenance.files['fonts/RobotoCondensed-variable.ttf'],
    headlineWeight: 900, detailWeight: 700, shaping: 'fontkit-2.0.4-kern-disabled-uniform-v1', ownerAccepted: '2026-10-22' },
  name: { x: 17.5, width: 29, targetHeight: 3.35, minimumHeight: 1.9, oneLineTop: 4.8, twoLineTop: 3.05, gap: .62 },
  detail: { x: 17.5, top: 12.7, width: 29, targetHeight: 1.74, minimumHeight: .7, lines: 1 },
  certificate: { x: 17.5, top: 17, maxWidth: 29.4, height: 2.1, stroke: .3 },
  metadata: 'number-year-set-optional-confirmed-variant-v1', displayName: 'alakazam-ex-omission-v1',
  colors: approvedBColors, grade: 'retained-grade10-uniform-roboto-other-grades-v1', backQr: 'https://atlasgrading.com/',
});
export const LABEL_APPROVED_B_RENDERER_PROFILE_HASH = approvedBHash(stable(LABEL_APPROVED_B_RENDERER_PROFILE));
const round = value => Number(value.toFixed(6));
function shape(text, face) {
  if ([...text].some(character => !face.hasGlyphForCodePoint(character.codePointAt(0)))) throw new Error('UNSUPPORTED_GLYPH');
  const run = face.layout(text.normalize('NFC'), { kern: false }), b = run.bbox;
  const width = b.maxX - b.minX, height = b.maxY - b.minY;
  if (!(width > 0 && height > 0)) throw new Error('EMPTY_GLYPH_OUTLINE');
  let x = 0, y = 0;
  const paths = run.glyphs.map((glyph, i) => {
    const position = run.positions[i];
    const path = `<path d="${glyph.path.toSVG()}" transform="translate(${round(x + position.xOffset)},${round(y + position.yOffset)})"/>`;
    x += position.xAdvance; y += position.yAdvance; return path;
  }).join('');
  return { text, b, width, height, paths };
}
function place(value, x, y, height) {
  const scale = height / value.height;
  return `<g transform="translate(${round(x)},${round(y)}) scale(${round(scale)},${round(-scale)}) translate(${round(-value.b.minX)},${round(-value.b.maxY)})">${value.paths}</g>`;
}
const clean = value => value?.normalize('NFC').trim().replace(/\s+/gu, ' ') ?? '';
const absentVariant = value => !value || /^(?:base(?: card)?|none|n\/a)$/i.test(value);
export function approvedBMetadata(identity) {
  const number = clean(identity.cardNumber).replace(/^#/, ''), year = clean(identity.year);
  let product = clean(identity.productSet);
  // Remove only exact duplicated approved field prefixes, not inferred brands.
  for (const prefix of [year, clean(identity.manufacturer)]) if (prefix && product.toUpperCase().startsWith(`${prefix.toUpperCase()} `)) product = product.slice(prefix.length).trim();
  const variant = [...new Set([identity.parallel, identity.insert].map(clean).filter(value => !absentVariant(value)))].join(' · ');
  return [number ? `#${number}` : '', [year, product || clean(identity.manufacturer)].filter(Boolean).join(' '), variant]
    .filter(Boolean).join(' · ').toUpperCase();
}
const descriptors = { 1: 'POOR', 1.5: 'FAIR', 2: 'GOOD', 2.5: 'GOOD+', 3: 'VERY GOOD', 3.5: 'VG+',
  4: 'VG-EX', 4.5: 'VG-EX+', 5: 'EXCELLENT', 5.5: 'EX+', 6: 'EX-MT', 6.5: 'EX-MT+',
  7: 'NEAR MINT', 7.5: 'NM+', 8: 'NM-MINT', 8.5: 'NM-MINT+', 9: 'MINT', 9.5: 'MINT+', 10: 'GEM MINT' };

/** Deterministic label rendering only. Approval authority and exact source
 * packet authentication remain with the existing finishing service. */
export function renderApprovedBLabel(input, { previewMaterial = 'gold' } = {}) {
  const { identity, finalGrade, reportNumber, approvalVersion, cardProfile } = input ?? {};
  if (!identity || Object.getPrototypeOf(identity) !== Object.prototype || !['SPORTS', 'POKEMON'].includes(cardProfile)
    || !Number.isFinite(finalGrade) || finalGrade < 1 || finalGrade > 10 || finalGrade * 2 % 1
    || typeof reportNumber !== 'string' || !reportNumber.trim() || reportNumber.length > 100
    || !Number.isSafeInteger(approvalVersion) || approvalVersion < 1 || !['gold', 'holo'].includes(previewMaterial)) throw new Error('LABEL_V4_SOURCE_INVALID');
  for (const key of ['playerName', 'cardName', 'year', 'manufacturer', 'productSet', 'cardNumber', 'parallel', 'insert'])
    if (identity[key] != null && (typeof identity[key] !== 'string' || identity[key].length > 512)) throw new Error('LABEL_V4_SOURCE_INVALID');
  const source = structuredClone({ identity, finalGrade, reportNumber, approvalVersion, cardProfile });
  const diagnostics = { layoutVersion: APPROVED_B_LAYOUT, typography: 'owner-accepted-existing-fonts-20261022', name: null, metadata: null, certificate: null };
  const attention = code => ({ state: 'NEEDS_LAYOUT', source, rendererProfileHash: LABEL_APPROVED_B_RENDERER_PROFILE_HASH, diagnostics: { ...diagnostics, code } });
  try {
    let name = clean(cardProfile === 'SPORTS' ? identity.playerName : identity.cardName).toUpperCase();
    if (cardProfile === 'POKEMON' && name === 'ALAKAZAM EX') name = 'ALAKAZAM';
    const candidates = name ? [[name]] : [[]], words = name.split(' ');
    if (words.length > 1) for (let i = 1; i < words.length; i++) candidates.push([words.slice(0, i).join(' '), words.slice(i).join(' ')]);
    const fits = candidates.map(lines => {
      const shapes = lines.map(line => shape(line, headline));
      const height = Math.min(3.35, ...shapes.map(value => 29 * value.height / value.width));
      const widths = shapes.map(value => value.width / value.height * height);
      return { lines, shapes, height, widths, imbalance: widths.length ? Math.max(...widths) - Math.min(...widths) : 0 };
    }).sort((a, b) => b.height - a.height || a.lines.length - b.lines.length || a.imbalance - b.imbalance);
    const fit = fits[0];
    if (fit.height < 1.9) return attention('NAME_OVERFLOW');
    diagnostics.name = { text: name, lines: fit.lines, inkHeightMm: round(fit.height), widthsMm: fit.widths.map(round) };
    const top = fit.lines.length > 1 ? 3.05 + (6.7 - 2 * fit.height) / 2 : 4.8 + (3.35 - fit.height) / 2;
    const names = fit.shapes.map((value, i) => place(value, 17.5, top + i * (fit.height + .62), fit.height)).join('');
    const metadata = approvedBMetadata(identity), metadataShape = metadata ? shape(metadata, detail) : null;
    const metadataHeight = metadataShape ? Math.min(1.74, 29 * metadataShape.height / metadataShape.width) : 0;
    if (metadataShape && metadataHeight < .7) return attention('METADATA_OVERFLOW');
    diagnostics.metadata = { text: metadata, lines: metadata ? [metadata] : [], inkHeightMm: round(metadataHeight) };
    const metadataPaths = metadataShape ? place(metadataShape, 17.5, 12.7 + (1.74 - metadataHeight) / 2, metadataHeight) : '';
    const certText = `CERT # ${reportNumber}`, cert = shape(certText, detail), certHeight = Math.min(1.35, 28.1 * cert.height / cert.width);
    if (certHeight < .8) return attention('CERTIFICATE_OVERFLOW');
    const certWidth = cert.width / cert.height * certHeight, frameWidth = certWidth + 1.3;
    diagnostics.certificate = { text: certText, inkHeightMm: round(certHeight), frame: { x: 17.5, y: 17, width: round(frameWidth), height: 2.1 } };
    const certPaths = place(cert, 18.15, 17 + (2.1 - certHeight) / 2, certHeight);
    let grade = vectors.grade10;
    if (finalGrade !== 10) {
      const value = shape(String(finalGrade), detail), height = Math.min(10.2, 9.47 * value.height / value.width), width = value.width / value.height * height;
      grade = place(value, 58.35 + (9.47 - width) / 2, 4.65 + (10.2 - height) / 2, height);
    }
    const descriptor = descriptors[finalGrade], descriptorShape = shape(descriptor, detail);
    const descHeight = Math.min(1.35, 8.8 * descriptorShape.height / descriptorShape.width);
    const descWidth = descriptorShape.width / descriptorShape.height * descHeight;
    diagnostics.grade = { value: finalGrade, descriptor, uniformScaling: true };
    const cutouts = `<g data-part="name">${names}</g><g data-part="grade">${grade}</g><g data-part="descriptor">${place(descriptorShape, 58.35 + (8.8 - descWidth) / 2, 16.15 + (1.35 - descHeight) / 2, descHeight)}</g><rect x="17.5" y="17" width="${round(frameWidth)}" height="2.1" rx=".85" fill="none" stroke="black" stroke-width=".3"/><path d="M16.9 18.08 C17.1 18.08 17.25 18.05 17.50 18.05" fill="none" stroke="black" stroke-width=".36" stroke-linecap="round"/>`;
    const support = `<g data-part="metadata">${metadataPaths}</g><g data-part="certificate">${certPaths}</g>`;
    const printSvg = buildApprovedBFront({ title: `${name}, grade ${finalGrade}, ${reportNumber}, version ${approvalVersion}`, cutouts, support });
    const previewSvg = colorApprovedBArtwork(printSvg, previewMaterial);
    if (Buffer.byteLength(previewSvg) > 1048576) return attention('ARTWORK_SIZE');
    return { state: 'READY', source, diagnostics, layoutVersion: APPROVED_B_LAYOUT,
      rendererProfileHash: LABEL_APPROVED_B_RENDERER_PROFILE_HASH, artworkHash: approvedBHash(printSvg), printSvg, previewSvg, previewMaterial,
      backPrintSvg: renderApprovedBBack(), backPreviewSvg: renderApprovedBBack({ previewMaterial }) };
  } catch (error) {
    if (['UNSUPPORTED_GLYPH', 'EMPTY_GLYPH_OUTLINE'].includes(error.message)) return attention(error.message);
    throw error;
  }
}
