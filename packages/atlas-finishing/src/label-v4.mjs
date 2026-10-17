import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as fontkit from 'fontkit';

const root = new URL('../assets/v4/', import.meta.url);
const hash = value => createHash('sha256').update(value).digest('hex');
const stable = value => value && typeof value === 'object' ? Array.isArray(value) ? `[${value.map(stable).join(',')}]`
  : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}` : JSON.stringify(value);
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const n = value => Number(value.toFixed(6));
const provenance = JSON.parse(readFileSync(new URL('provenance.json', root)));
function asset(path) {
  const bytes = readFileSync(new URL(path, root));
  if (hash(bytes) !== provenance.files[path]) throw new Error('LABEL_V4_ASSET_HASH_MISMATCH');
  return bytes;
}
const vectors = JSON.parse(asset('vector-parts.json'));
const headline = fontkit.create(asset('fonts/Montserrat-variable.ttf')).getVariation({ wght: 900 });
const detailFont = fontkit.create(asset('fonts/RobotoCondensed-variable.ttf'));
const detail = detailFont.getVariation({ wght: 700 });
const halfGradeFont = detailFont.getVariation({ wght: 600 });
export const LABEL_V4_RENDERER_PROFILE = Object.freeze({
  version: 'atlas-v4-outlined-label-v1', physicalWidthMm: 68.342, physicalHeightMm: 20.082,
  fontkit: '2.0.4', headlineWeight: 900, detailWeight: 700, shaping: 'fontkit-layout-kern-disabled-v1',
  name: { boxWidthMm: 28.5, boxHeightMm: 7.65, targetInkHeightMm: 3.6, minimumInkHeightMm: 2.8 },
  grade: 'original-whole-grades-and-compact-full-height-half-grades-v2',
  halfGradeRules: { grades: [8.5, 9.5], weight: 600, widthMm: 8, inkHeightMm: 10.2, gapMm: 0.18, topMm: 4.5,
    apertureRightMm: 56.35, labelRightMm: 68.342, caption: false },
  certificate: 'full-cert-arc-v1', alpha: 'straight-rgba-alpha-threshold-128-v1',
  certificateRules: { baselineRadiusMm: 6.78, maximumArcDeg: 120, targetInkHeightMm: 0.99, minimumInkHeightMm: 0.85 },
  metadataRules: { widthMm: 28.5, targetInkHeightMm: 1.5, minimumInkHeightMm: 1, topMm: 12.8 },
  metadataOverflowRules: { version: 'full-identity-three-line-v1', leftMm: 15.8, widthMm: 28.5, topMm: 4.55, bottomMm: 14.3,
    maximumLines: 3, maximumTokens: 128, semanticReadabilityToleranceMm: 0.05,
    nameLineGapMm: 0.45, metadataLineGapMm: 0.2, nameMetadataGapMm: 0.3 },
  assetHashes: provenance.files,
});
export const LABEL_V4_RENDERER_PROFILE_HASH = hash(stable(LABEL_V4_RENDERER_PROFILE));

function shape(text, font) {
  const normalized = text.normalize('NFC');
  if ([...normalized].some(c => !font.hasGlyphForCodePoint(c.codePointAt(0)))) {
    const error = new Error('UNSUPPORTED_GLYPH'); error.text = text; throw error;
  }
  // The supplied V4 outlines use unkerned advances. There is no host font lookup.
  const run = font.layout(normalized, { kern: false });
  const b = run.bbox, width = b.maxX - b.minX, height = b.maxY - b.minY;
  if (!(height > 0 && width > 0)) throw new Error('EMPTY_GLYPH_OUTLINE');
  let x = 0, y = 0;
  const paths = run.glyphs.map((glyph, i) => {
    const position = run.positions[i];
    const path = `<path d="${glyph.path.toSVG()}" transform="translate(${n(x + position.xOffset)},${n(y + position.yOffset)})"/>`;
    x += position.xAdvance; y += position.yAdvance; return path;
  }).join('');
  return { run, paths, b, width, height };
}
function place(shape, x, top, inkHeight) {
  const scale = inkHeight / shape.height;
  return `<g transform="translate(${n(x)},${n(top)}) scale(${n(scale)},${n(-scale)}) translate(${n(-shape.b.minX)},${n(-shape.b.maxY)})">${shape.paths}</g>`;
}

export function fitLabelV4Name(fullName) {
  const text = fullName.normalize('NFC').trim().replace(/\s+/gu, ' ').toUpperCase();
  const single = shape(text, headline);
  let choices = [[text]];
  if (single.width / single.height * 3.6 > 28.5 && text.includes(' ')) {
    const words = text.split(' ');
    choices = words.slice(1).map((_, i) => [words.slice(0, i + 1).join(' '), words.slice(i + 1).join(' ')]);
  }
  const fits = choices.map(lines => {
    const shapes = lines.map(line => shape(line, headline));
    const inkHeightMm = Math.min(3.6, ...shapes.map(value => 28.5 * value.height / value.width));
    const widthsMm = shapes.map(value => value.width / value.height * inkHeightMm);
    return { lines, shapes, inkHeightMm, widthsMm, balance: Math.max(...widthsMm) - Math.min(...widthsMm) };
  }).sort((a, b) => b.inkHeightMm - a.inkHeightMm || a.balance - b.balance || a.lines.join(' ').localeCompare(b.lines.join(' '), 'en'));
  const fit = fits[0];
  return { ...fit, state: fit.inkHeightMm >= 2.8 ? 'READY' : 'NEEDS_LAYOUT' };
}

function certificateOutline(text, layout) {
  const shaped = shape(text, detail);
  if (layout === 'full-cert-under-name-v1') {
    const height = Math.min(1.1, 28.5 * shaped.height / shaped.width);
    if (height < 0.9) throw new Error('CERTIFICATE_OVERFLOW');
    return { paths: place(shaped, 15.8, 14.96, height), text, inkHeightMm: n(height), layout };
  }
  if (layout !== 'full-cert-arc-v1') throw new Error('CERTIFICATE_LAYOUT_INVALID');
  const radius = 6.78, maxAngle = LABEL_V4_RENDERER_PROFILE.certificateRules.maximumArcDeg * Math.PI / 180;
  const height = Math.min(0.99, radius * maxAngle * shaped.height / shaped.run.advanceWidth);
  if (height < 0.85) throw new Error('CERTIFICATE_OVERFLOW');
  const scale = height / shaped.height;
  let cursor = -shaped.run.advanceWidth * scale / 2;
  const paths = shaped.run.glyphs.map((glyph, i) => {
    const p = shaped.run.positions[i], advance = p.xAdvance * scale;
    const angle = (cursor + advance / 2) / radius;
    const x = 51.25 + radius * Math.sin(angle), y = 10.041 + radius * Math.cos(angle);
    cursor += advance;
    return `<g transform="translate(${n(x)},${n(y)}) rotate(${n(-angle * 180 / Math.PI)}) scale(${n(scale)},${n(-scale)})"><path d="${glyph.path.toSVG()}" transform="translate(${n(p.xOffset - p.xAdvance / 2)},${n(p.yOffset)})"/></g>`;
  }).join('');
  return { paths, text, inkHeightMm: n(height), layout, baselineRadiusMm: radius, angularSpanDeg: n(shaped.run.advanceWidth * scale / radius * 180 / Math.PI) };
}

function gradeOutline(grade) {
  if (grade === 10) return vectors.grade10;
  if (grade === 8.5 || grade === 9.5) {
    const rules = LABEL_V4_RENDERER_PROFILE.halfGradeRules;
    const glyphs = [...String(grade)].map(character => shape(character, halfGradeFont));
    const top = Math.max(...glyphs.map(glyph => glyph.b.maxY));
    const bottom = Math.min(...glyphs.map(glyph => glyph.b.minY));
    const sy = rules.inkHeightMm / (top - bottom);
    const sx = (rules.widthMm - 2 * rules.gapMm) / glyphs.reduce((width, glyph) => width + glyph.width, 0);
    // Pack visible ink bounds, not font advances, and center between the actual
    // NFC aperture and label edge. All glyphs share the same scale and baseline.
    let x = (rules.apertureRightMm + rules.labelRightMm - rules.widthMm) / 2;
    return glyphs.map(glyph => {
      const outline = `<g transform="translate(${n(x)},${rules.topMm}) scale(${n(sx)},${n(-sy)}) translate(${n(-glyph.b.minX)},${n(-top)})">${glyph.paths}</g>`;
      x += glyph.width * sx + rules.gapMm;
      return outline;
    }).join('');
  }
  const text = String(grade), full = shape(text, detail);
  // Keep each grade within the original 9.47 x 10.2 mm frame. Only numerals
  // use this explicit condensed recipe; headline glyphs are never stretched.
  const sx = Math.min(9.47 / full.width, 10.2 / full.height), sy = 10.2 / full.height;
  const width = full.width * sx;
  return `<g transform="translate(${n(57.25 + (9.47 - width) / 2)},4.5) scale(${n(sx)},${n(-sy)}) translate(${n(-full.b.minX)},${n(-full.b.maxY)})">${full.paths}</g>`;
}

function metadataFor(identity) {
  const variant = [...new Set([identity.parallel, identity.insert].filter(value => value && !/^(base|base card|none|n\/a)$/i.test(value)))].join(' · ');
  const product = [...new Set([identity.manufacturer, identity.productSet].filter(Boolean))].join(' ');
  return [[identity.cardNumber ? `#${identity.cardNumber.replace(/^#/, '')}` : null, variant].filter(Boolean).join(' '),
    [identity.year, product].filter(Boolean).join(' ')].filter(Boolean).join(' · ').toUpperCase();
}

// Only used when the original one-line metadata cannot meet its 1 mm minimum.
// Keep every approved field and use uniform glyph scaling in the original area.
// A semantic field break replaces its generated display delimiter with a newline;
// punctuation inside an approved field is retained verbatim.
function fitOverflowText(name, metadata, identity) {
  const rules = LABEL_V4_RENDERER_PROFILE.metadataOverflowRules;
  const words = metadata.trim().split(/\s+/u);
  if (words.length > rules.maximumTokens) return null;
  const nameWords = name === null ? [] : name.normalize('NFC').trim().replace(/\s+/gu, ' ').toUpperCase().split(' ');
  const nameChoices = nameWords.length ? [[nameWords.join(' ')], ...nameWords.slice(1).map((_, i) =>
    [nameWords.slice(0, i + 1).join(' '), nameWords.slice(i + 1).join(' ')])] : [[]];
  const measure = (text, font) => {
    const { bbox } = font.layout(text.normalize('NFC'), { kern: false });
    return (bbox.maxX - bbox.minX) / (bbox.maxY - bbox.minY);
  };
  const names = nameChoices.map(lines => ({ lines, ratios: lines.map(line => measure(line, headline)) }))
    .map(value => ({ ...value, maximumHeight: Math.min(3.6, ...value.ratios.map(ratio => rules.widthMm / ratio)) }))
    .filter(value => value.maximumHeight >= 2.8);
  const measured = new Map();
  const segment = (start, end) => {
    const key = `${start}:${end}`;
    if (!measured.has(key)) {
      const text = words.slice(start, end).join(' ');
      measured.set(key, { text, ratio: measure(text, detail) });
    }
    return measured.get(key);
  };
  const candidates = [];
  const consider = (lines, semantic = false) => {
    const maximumMetadataHeight = Math.min(1.5, ...lines.map(line => rules.widthMm / line.ratio));
    if (maximumMetadataHeight < 1) return;
    for (const choice of names) {
      const nameGaps = Math.max(0, choice.lines.length - 1) * rules.nameLineGapMm;
      const metadataGaps = (lines.length - 1) * rules.metadataLineGapMm;
      const between = choice.lines.length ? rules.nameMetadataGapMm : 0;
      const available = rules.bottomMm - rules.topMm - nameGaps - metadataGaps - between;
      const metadataHeight = Math.min(maximumMetadataHeight, (available - choice.lines.length * 2.8) / lines.length);
      if (metadataHeight < 1 - 1e-9) continue;
      const nameHeight = choice.lines.length ? Math.min(choice.maximumHeight, (available - lines.length * metadataHeight) / choice.lines.length) : 0;
      if (choice.lines.length && nameHeight < 2.8 - 1e-9) continue;
      const height = nameHeight * choice.lines.length + nameGaps + between + metadataHeight * lines.length + metadataGaps;
      const top = rules.topMm + (rules.bottomMm - rules.topMm - height) / 2;
      candidates.push({ name: choice.lines, metadata: lines.map(line => line.text), semantic, nameHeight, metadataHeight, nameTop: top,
        metadataTop: top + nameHeight * choice.lines.length + nameGaps + between,
        balance: Math.max(...lines.map(line => line.ratio)) - Math.min(...lines.map(line => line.ratio)),
        orphanSeparators: lines.filter(line => /^[·&]|[·&]$/u.test(line.text)).length });
    }
  };
  const variants = [...new Set([identity.parallel, identity.insert].filter(value => value && !/^(base|base card|none|n\/a)$/i.test(value)))];
  const products = [...new Set([identity.manufacturer, identity.productSet].filter(Boolean))];
  const semanticLines = [
    [identity.cardNumber ? `#${identity.cardNumber.replace(/^#/, '')}` : null, variants.join(' · ')].filter(Boolean).join(' '),
    [identity.year, products[0]].filter(Boolean).join(' '), products.slice(1).join(' '),
  ].filter(Boolean).map(text => text.toUpperCase());
  consider(semanticLines.map(text => ({ text, ratio: measure(text, detail) })), true);
  // At most 128 tokens: 8,128 possible two/three-line arrangements. Reject
  // prefixes/suffixes that cannot meet 1 mm before measuring their middles;
  // this uses actual font bounds, not character-count or average-width guesses.
  // Only the selected arrangement creates glyph paths.
  const prefixes = [], suffixes = [];
  for (let boundary = 1; boundary < words.length; boundary++) {
    const prefix = segment(0, boundary), suffix = segment(boundary, words.length);
    if (prefix.ratio <= rules.widthMm) prefixes.push({ boundary, line: prefix });
    if (suffix.ratio <= rules.widthMm) suffixes.push({ boundary, line: suffix });
    if (prefix.ratio <= rules.widthMm && suffix.ratio <= rules.widthMm) consider([prefix, suffix]);
  }
  for (const first of prefixes) for (const second of suffixes) {
    if (second.boundary <= first.boundary) continue;
    const middle = segment(first.boundary, second.boundary);
    if (middle.ratio <= rules.widthMm) consider([first.line, middle, second.line]);
  }
  const bestHeight = Math.max(...candidates.map(candidate => candidate.metadataHeight));
  const readable = candidates.filter(candidate => candidate.metadataHeight >= bestHeight - rules.semanticReadabilityToleranceMm);
  readable.sort((a, b) => a.orphanSeparators - b.orphanSeparators
    || b.metadataHeight - a.metadataHeight || b.nameHeight - a.nameHeight || a.metadata.length - b.metadata.length || a.balance - b.balance
    || a.metadata.join('\n').localeCompare(b.metadata.join('\n'), 'en'));
  // First avoid orphan separators at an equivalent readable size; then prefer
  // intact identity fields when they are within 0.05 mm of that actual result.
  // This avoids rewarding a malformed line merely for a tiny height gain.
  const semantic = candidates.filter(candidate => candidate.semantic
    && candidate.metadataHeight >= (readable[0]?.metadataHeight ?? Infinity) - rules.semanticReadabilityToleranceMm)
    .sort((a, b) => b.metadataHeight - a.metadataHeight || b.nameHeight - a.nameHeight);
  const chosen = semantic[0] ?? readable[0];
  if (!chosen) return null;
  const outlines = (lines, font, top, height, gap) => lines.map((text, index) => {
    const shaped = shape(text, font), y = top + index * (height + gap);
    return { text, xMm: rules.leftMm, yMm: n(y), widthMm: n(shaped.width / shaped.height * height), heightMm: n(height),
      paths: place(shaped, rules.leftMm, y, height) };
  });
  return { version: rules.version, wrapping: chosen.semantic ? 'SEMANTIC_FIELDS' : 'TOKEN_WRAP',
    name: outlines(chosen.name, headline, chosen.nameTop, chosen.nameHeight, rules.nameLineGapMm),
    metadata: outlines(chosen.metadata, detail, chosen.metadataTop, chosen.metadataHeight, rules.metadataLineGapMm) };
}

/** Pure authoritative-snapshot renderer. The caller must load and authenticate
 * the exact PUBLISHED report. This function never decides approval or material.
 */
export function renderLabelV4(input, { previewMaterial = 'gold', certificateLayout = 'full-cert-arc-v1' } = {}) {
  const { identity, finalGrade, reportNumber, approvalVersion, cardProfile } = input ?? {};
  if (!identity || !['SPORTS', 'POKEMON'].includes(cardProfile) || !Number.isFinite(finalGrade)
      || finalGrade < 1 || finalGrade > 10 || finalGrade * 2 % 1 !== 0
      || typeof reportNumber !== 'string' || !reportNumber.length || reportNumber.length > 100
      || !Number.isSafeInteger(approvalVersion) || approvalVersion < 1
      || !['gold', 'holo'].includes(previewMaterial)) throw new Error('LABEL_V4_SOURCE_INVALID');
  const name = cardProfile === 'SPORTS' ? identity.playerName : identity.cardName;
  if (name !== null && (typeof name !== 'string' || !name.trim()) || Object.values(identity).some(value => value != null && (typeof value !== 'string' || value.length > 512))) throw new Error('LABEL_V4_SOURCE_INVALID');
  const source = structuredClone({ identity, finalGrade, reportNumber, approvalVersion, cardProfile });
  const rendererProfileHash = certificateLayout === 'full-cert-arc-v1' ? LABEL_V4_RENDERER_PROFILE_HASH
    : hash(stable({ ...LABEL_V4_RENDERER_PROFILE, certificate: certificateLayout }));
  const diagnostics = { name: null, metadata: null, certificate: null, gradeRecipe: LABEL_V4_RENDERER_PROFILE.grade };
  const attention = code => ({ state: 'NEEDS_LAYOUT', source, rendererProfileHash, diagnostics: { ...diagnostics, code } });
  try {
    // Unknown identity stays absent in the artwork and source snapshot. The
    // immutable report number still identifies this graded physical specimen.
    const fitted = name === null ? { state: 'READY', lines: [], shapes: [], inkHeightMm: 0, widthsMm: [] } : fitLabelV4Name(name);
    diagnostics.name = { text: name, lines: fitted.lines, inkHeightMm: n(fitted.inkHeightMm), widthsMm: fitted.widthsMm.map(n) };
    if (fitted.state !== 'READY') return attention('NAME_OVERFLOW');
    const nameHeight = fitted.shapes.length * fitted.inkHeightMm + (fitted.shapes.length - 1) * 0.45;
    const nameTop = 4.55 + (7.65 - nameHeight) / 2;
    let namePaths = fitted.shapes.map((value, index) => place(value, 15.8, nameTop + index * (fitted.inkHeightMm + 0.45), fitted.inkHeightMm)).join('');
    const metadata = metadataFor(identity), metadataShape = metadata ? shape(metadata, detail) : null;
    const metadataHeight = metadataShape ? Math.min(1.5, 28.5 * metadataShape.height / metadataShape.width) : 0;
    diagnostics.metadata = { text: metadata, inkHeightMm: n(metadataHeight) };
    let metadataPaths = metadataShape ? place(metadataShape, 15.8, 12.8 + (1.5 - metadataHeight) / 2, metadataHeight) : '';
    if (metadataShape && metadataHeight < 1) {
      const overflow = fitOverflowText(name, metadata, identity);
      if (!overflow) return attention('METADATA_OVERFLOW');
      const boxes = values => values.map(({ paths, ...box }) => box);
      diagnostics.textLayout = { version: overflow.version, wrapping: overflow.wrapping, name: boxes(overflow.name), metadata: boxes(overflow.metadata) };
      diagnostics.name = { text: name, lines: overflow.name.map(line => line.text), inkHeightMm: overflow.name[0]?.heightMm ?? 0,
        widthsMm: overflow.name.map(line => line.widthMm) };
      diagnostics.metadata = { text: metadata, lines: overflow.metadata.map(line => line.text), inkHeightMm: overflow.metadata[0].heightMm };
      namePaths = overflow.name.map(line => line.paths).join('');
      metadataPaths = overflow.metadata.map(line => line.paths).join('');
    }
    const cert = certificateOutline(`${reportNumber} · V${approvalVersion}`, certificateLayout);
    diagnostics.certificate = { ...cert }; delete diagnostics.certificate.paths;
    const grade = gradeOutline(finalGrade), captionText = finalGrade === 10 ? 'GEM MINT' : 'GRADE';
    const captionShape = shape(captionText, detail);
    const caption = finalGrade === 8.5 || finalGrade === 9.5 ? ''
      : place(captionShape, 57.65, 15.25, Math.min(1.05, 8.4 * captionShape.height / captionShape.width));
    const clearance = `<mask id="grade-clearance" maskUnits="userSpaceOnUse" x="0" y="0" width="68.342" height="20.082"><rect width="68.342" height="20.082" fill="white"/><g fill="black" stroke="black" stroke-width=".75">${grade}</g></mask>`;
    const staticInk = certificateLayout === 'full-cert-under-name-v1' ? vectors.staticInkWithoutWaveform : vectors.staticInk;
    const defs = `${vectors.clips}${clearance}<mask id="ink" maskUnits="userSpaceOnUse" x="0" y="0" width="68.342" height="20.082"><rect width="68.342" height="20.082" fill="white"/><g fill="black" color="black">${staticInk}<g data-part="grade">${grade}</g><g data-part="caption">${caption}</g><g data-part="name">${namePaths}</g><g data-part="certificate">${cert.paths}</g></g></mask>`;
    const ink = `<g clip-path="url(#body)" mask="url(#ink)"><rect width="68.342" height="20.082" fill="#000000"/>${vectors.grayDetails}<g data-part="metadata" fill="white">${metadataPaths}</g></g>`;
    const title = `${name ? `${name}, ` : ''}grade ${finalGrade}, ${reportNumber}, version ${approvalVersion}`;
    const wrap = (purpose, content) => `<svg xmlns="http://www.w3.org/2000/svg" width="68.342mm" height="20.082mm" viewBox="0 0 68.342 20.082" data-atlas-artwork="${purpose}" data-renderer="atlas-v4-outlined-label-v1" role="img"><title>${esc(title)}</title>${content}</svg>`;
    const printSvg = wrap('PRINT', `<defs>${defs}</defs>${ink}`);
    const colors = previewMaterial === 'gold' ? ['#c99c3d', '#ecd296', '#b78b32'] : ['#7ddfe7', '#c8a4ec', '#f1b6d4'];
    const foil = `<linearGradient id="preview-foil">${colors.map((color, i) => `<stop offset="${i / 2}" stop-color="${color}"/>`).join('')}</linearGradient>`;
    const previewSvg = wrap('PREVIEW_ONLY', `<defs>${defs}${foil}</defs><g clip-path="url(#body)"><rect width="68.342" height="20.082" fill="url(#preview-foil)"/></g>${ink}`);
    return { state: 'READY', source, diagnostics, rendererProfileHash, artworkHash: hash(printSvg), printSvg, previewSvg, previewMaterial };
  } catch (error) {
    if (['UNSUPPORTED_GLYPH', 'EMPTY_GLYPH_OUTLINE', 'CERTIFICATE_OVERFLOW'].includes(error.message)) return attention(error.message);
    throw error;
  }
}

export async function renderLabelV4Png({ printSvg, artworkHash }, options) {
  const { renderLabelV4Png: rasterize } = await import('./label-sheet.mjs');
  return rasterize({ printSvg, artworkHash }, options);
}
