import { readFileSync } from 'node:fs';
import * as fontkit from 'fontkit';
import { APPROVED_B_ASSETS, APPROVED_B_LAYOUT, approvedBHash,
  approvedBColors, colorApprovedBArtwork, renderApprovedBBack } from './label-approved-b-artwork.mjs';
import { LABEL_STYLE_FONT_CATALOG, LABEL_STYLE_PAINT_VERSION, shapeLabelStyleText } from './label-style-paint.mjs';
import { LABEL_STYLE_ARTWORK, buildLabelStyleFront } from './label-style-artwork.mjs';
import { LABEL_STYLE_WORDMARK_VERSION, shapeLabelStyleWordmark } from './label-style-wordmark.mjs';
import { LABEL_STYLE_CONTRAST_VERSION, labelStyleContrast } from './label-style-contrast.mjs';
import { LABEL_STYLE_PREFERENCES_VERSION, LABEL_STYLE_PREFERENCES_SHA256 } from './label-style-preferences.mjs';

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
const certificateFace = font('RobotoCondensed', 500);
const vectorBytes = readFileSync(new URL('../assets/approved-b/vectors.json', import.meta.url));
if (approvedBHash(vectorBytes) !== APPROVED_B_ASSETS.files['vectors.json']?.sha256) throw new Error('APPROVED_B_ASSET_HASH_MISMATCH');
const vectors = JSON.parse(vectorBytes);
export const LABEL_APPROVED_B_RENDERER_PROFILE = Object.freeze({
  version: APPROVED_B_LAYOUT, format: 'atlas-approved-b-label-v1', widthMm: 68.342, heightMm: 20.082,
  assets: Object.fromEntries(Object.entries(APPROVED_B_ASSETS.files).map(([name, value]) => [name, value.sha256])),
  fonts: { headline: fontProvenance.files['fonts/Montserrat-variable.ttf'], detail: fontProvenance.files['fonts/RobotoCondensed-variable.ttf'],
    headlineWeight: 900, detailWeight: 700, variant: LABEL_STYLE_FONT_CATALOG.knewave.sha256, variantFace: 'Knewave-Regular',
    shaping: 'fontkit-2.0.4-kern-disabled-uniform-v1', baseFontsAccepted: '2026-10-22' },
  nfcClearance: { x: 51.8, y: 9.75, radius: 5.1, padding: .75, fitting: 'per-line-outline-box-v1' },
  name: { x: 17.5, width: 29, targetHeight: 3.35, minimumHeight: 1.9, oneLineTop: 4.8, twoLineTop: 3.05, gap: .62 },
  detail: { x: 17.5, top: 11, bottom: 16.6, width: 29, targetCapHeight: 1.6, minimumCapHeight: 1.3, minimumSecondaryInkHeight: 1.3,
    lineGap: .25, semanticLines: 2, maximumLines: 2, maximumTokens: 128, fitting: 'optical-role-hierarchy-v4',
    variant: { targetCapHeight: 2.5, heavyInkHeight: 2.3, brushInkHeight: 2.6,
      nameGap: .3, secondaryGap: .2, minimumSecondaryGap: .1, casing: 'uppercase', color: 'photo-style', font: 'Knewave' } },
  certificate: { x: 1.9, centerY: 18.35, maxWidth: 13.9, capHeight: 1.3, weight: 500 },
  metadata: 'number-year-brand-set-and-confirmed-features-v2',
  metadataRules: { brand: 'exact-maker-alias-prefix-dedupe-bowman-v1', subset: 'sports-final-spaced-hyphen-v1',
    redundantProduct: 'sports-exact-player-then-variant-prefix-v1',
    abbreviations: ['sports-topps-chrome-basketball-to-topps-chrome', 'overflow-1955-anniversary-to-1955-anniv'],
    features: 'reviewed-serial-real-autograph-explicit-patch-special-features-v1' },
  displayName: 'alakazam-ex-omission-v1',
  colors: approvedBColors, grade: 'retained-grade10-uniform-roboto-other-grades-v1', backQr: 'https://atlasgrading.com/',
  photoStyle: {version: LABEL_STYLE_PAINT_VERSION, wordmark:LABEL_STYLE_WORDMARK_VERSION, contrastVersion:LABEL_STYLE_CONTRAST_VERSION,
    sourceTexturePolicy:'atlas-label-source-texture-v3', originalRasterPolicy:'atlas-label-wordmark-near-monochrome-v1',
    wordmarkEdge:'actual-fitted-physical-radius-v1',
    reviewedPreferences:{version:LABEL_STYLE_PREFERENCES_VERSION,sha256:LABEL_STYLE_PREFERENCES_SHA256},
    fonts:LABEL_STYLE_FONT_CATALOG, artwork:LABEL_STYLE_ARTWORK,
    wholeNumberGrades:true, contrast:'shared-below-10-black-exact10-exposed-foil-v1', variantTargetCapMm:2.5,
    certificate:'full-12hex-under-logo-cap1.3mm-weight500', grade10Accent:'retain-photo-hue-dark-outline-v1'},
});
export const LABEL_APPROVED_B_RENDERER_PROFILE_HASH = approvedBHash(stable(LABEL_APPROVED_B_RENDERER_PROFILE));
// Retained approved-B artwork owns the same physical template and shared back.
// Recognizing it never rerenders or replaces its saved front bytes.
export const LABEL_APPROVED_B_LEGACY_RENDERER_PROFILE_HASH = 'a0491ff4f0a86166371f950c658c3e08397e688fe13f9e60f28abbda88b764ab';
export const LABEL_APPROVED_B_SUPPORTED_PROFILE_HASHES = Object.freeze([
  LABEL_APPROVED_B_LEGACY_RENDERER_PROFILE_HASH, 'b8bb56e7e816b1324b6ba3a1b5d9b683e761fc084ae986f253ae113e88ea6a0a',
    'df5054cb6e777409dcef8b5938c87df3ec76e980c8553c6edb77567c2f9defbe',
    'be7680a176376a245fee5ef4d54efbb96dad37ae9799e7378a533bced0f3d5fd', LABEL_APPROVED_B_RENDERER_PROFILE_HASH,
]);
export const isApprovedBRendererProfile = hash => LABEL_APPROVED_B_SUPPORTED_PROFILE_HASHES.includes(hash);
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
// Fit actual outlined bounds to the left of the padded NFC circle. The line is
// centered in its own slot, so another line never shrinks to accommodate it.
function fitClearLine(value, { x, width, centerY, height }) {
  const circle = LABEL_APPROVED_B_RENDERER_PROFILE.nfcClearance;
  const radius = circle.radius + circle.padding;
  const fits = candidate => {
    const distanceY = Math.max(0, Math.abs(centerY - circle.y) - candidate / 2);
    const right = distanceY >= radius ? x + width
      : Math.min(x + width, circle.x - Math.sqrt(radius * radius - distanceY * distanceY));
    return x + value.width / value.height * candidate <= right;
  };
  let low = 0, high = height;
  if (!fits(high)) {
    for (let step = 0; step < 48; step++) {
      const middle = (low + high) / 2;
      if (fits(middle)) low = middle; else high = middle;
    }
    height = low;
  }
  return { x, y: centerY - height / 2, height, width: value.width / value.height * height, scale: height / value.height };
}
const clean = value => value?.normalize('NFC').trim().replace(/\s+/gu, ' ') ?? '';
const absentVariant = value => !value || /^(?:base(?: card)?|none|n\/a)$/i.test(value);
const manufacturerAliases = Object.freeze({
  TOPPS: 'Topps', 'TOPPS COMPANY': 'Topps', 'THE TOPPS COMPANY': 'Topps', 'THE TOPPS COMPANY, INC.': 'Topps',
  PANINI: 'Panini', 'PANINI AMERICA': 'Panini', 'PANINI AMERICA, INC.': 'Panini',
  'UPPER DECK': 'Upper Deck', 'UPPER DECK COMPANY': 'Upper Deck', 'THE UPPER DECK COMPANY': 'Upper Deck',
  BOWMAN: 'Bowman', FLEER: 'Fleer', POKEMON: 'Pokémon', 'POKÉMON': 'Pokémon',
  'THE POKEMON COMPANY': 'Pokémon', 'THE POKÉMON COMPANY': 'Pokémon',
  'THE POKEMON COMPANY INTERNATIONAL': 'Pokémon', 'THE POKÉMON COMPANY INTERNATIONAL': 'Pokémon',
});
const specialFeatures = Object.freeze({ CASE_HIT: 'Case Hit', SHORT_PRINT: 'SP', SUPER_SHORT_PRINT: 'SSP' });
const patchMaterials = new Set(['patch', 'jersey patch', 'logo patch', 'embroidered patch', 'patch fabric',
  'patch material', 'multicolor patch', 'multi-color patch', 'multi-colour patch']);
const same = (a, b) => a.toUpperCase() === b.toUpperCase();
const withoutPrefix = (value, prefix) => prefix && same(value, prefix) ? ''
  : prefix && value.toUpperCase().startsWith(`${prefix.toUpperCase()} `) ? value.slice(prefix.length).trim() : value;
const unique = values => values.filter((value, index) => value && values.findIndex(other => same(value, other)) === index);

function confirmedFeatures(attributes) {
  if (attributes == null) return { serial: '', tokens: [] };
  // loadPacket parses the complete public report before rendering. Keep this
  // pure renderer bounded too; it does not infer facts from product names.
  if (!['atlas-sports-attributes-v1', 'atlas-sports-attributes-public-v1'].includes(attributes.version))
    throw new Error('LABEL_V4_SOURCE_INVALID');
  const tokens = [], serial = attributes.serial;
  let numbering = '';
  if (serial?.presence === 'PRESENT') {
    const match = typeof serial.printed === 'string' && /^(\d{1,6})\s*\/\s*(\d{1,6})$/.exec(serial.printed);
    if (!match || !Number.isSafeInteger(serial.numerator) || !Number.isSafeInteger(serial.denominator)
      || serial.numerator < 1 || serial.denominator > 999999 || serial.numerator > serial.denominator
      || Number(match[1]) !== serial.numerator || Number(match[2]) !== serial.denominator) throw new Error('LABEL_V4_SOURCE_INVALID');
    numbering = `/${serial.denominator}`;
  }
  if (attributes.autograph?.presence === 'PRESENT' && ['ON_CARD', 'STICKER', 'CUT'].includes(attributes.autograph.type)) tokens.push('AUTO');
  const relic = attributes.relic;
  if (relic?.presence === 'PRESENT') {
    if (!Array.isArray(relic.windows) || !relic.windows.length || relic.windows.length > 12) throw new Error('LABEL_V4_SOURCE_INVALID');
    if (relic.windows.some(window => typeof window.material === 'string' && patchMaterials.has(clean(window.material).toLowerCase()))) tokens.push('PATCH');
  }
  if (Object.hasOwn(attributes, 'specialFeatures')) {
    if (!Array.isArray(attributes.specialFeatures) || !attributes.specialFeatures.length || attributes.specialFeatures.length > 3
      || new Set(attributes.specialFeatures.map(feature => feature?.kind)).size !== attributes.specialFeatures.length
      || attributes.specialFeatures.some(feature => !Object.hasOwn(specialFeatures, feature?.kind))) throw new Error('LABEL_V4_SOURCE_INVALID');
    for (const kind of Object.keys(specialFeatures)) if (attributes.specialFeatures.some(feature => feature.kind === kind)) tokens.push(specialFeatures[kind]);
  }
  return { serial: numbering, tokens };
}

/** Display-only projection of the exact approved identity. Unknown brands and
 * facts remain unknown; source identity and stored artwork are never mutated. */
function metadataProjection(identity, { cardProfile = 'SPORTS', abbreviate = false } = {}) {
  const number = clean(identity.cardNumber).replace(/^#+/, ''), year = clean(identity.year);
  const rawMaker = clean(identity.manufacturer), makerKey = rawMaker.toUpperCase();
  let maker = manufacturerAliases[makerKey] ?? rawMaker, product = clean(identity.productSet), subset = '';
  const abbreviations = [];
  product = withoutPrefix(product, year);
  const makerNames = unique([rawMaker, maker, ...Object.keys(manufacturerAliases).filter(key => manufacturerAliases[key] === maker)])
    .sort((a, b) => b.length - a.length);
  for (const prefix of makerNames) {
    const stripped = withoutPrefix(product, prefix);
    if (stripped !== product) { product = stripped; break; }
  }
  // Bowman is explicitly present in this saved product; corporate Topps is
  // retained in source but not redundantly prepended to that consumer brand.
  if (cardProfile === 'SPORTS' && maker === 'Topps' && /^Bowman(?:\s|$)/i.test(product)) maker = '';
  if (cardProfile === 'SPORTS') {
    // Some reviewed one-off cards store the player and variant in productSet.
    // Drop only exact repeated prefixes; qualifiers such as (unlicensed) stay.
    const withoutPlayer = withoutPrefix(product, clean(identity.playerName));
    if (withoutPlayer !== product) {
      product = withoutPlayer;
      for (const prefix of unique([clean(identity.insert), clean(identity.parallel)]).filter(value => !absentVariant(value)))
        product = withoutPrefix(product, prefix);
    }
    const split = product.lastIndexOf(' - ');
    if (split > 0 && split + 3 < product.length) { subset = product.slice(split + 3); product = product.slice(0, split); }
    const combined = [maker, product].filter(Boolean).join(' ');
    if (same(combined, 'Topps Chrome Basketball')) {
      abbreviations.push({ field: 'productSet', from: combined, to: 'Topps Chrome', reason: 'approved-sports-display-alias' });
      maker = 'Topps'; product = 'Chrome';
    }
    if (abbreviate && /\b1955 Anniversary$/i.test(product)) {
      const abbreviated = product.replace(/\b1955 Anniversary$/i, '1955 Anniv.');
      abbreviations.push({ field: 'productSet', from: product, to: abbreviated, reason: 'readable-two-line-fit' }); product = abbreviated;
    }
  }
  const features = cardProfile === 'SPORTS' ? confirmedFeatures(identity.sportsAttributes) : { serial: '', tokens: [] };
  let parallel = clean(identity.parallel);
  const namedRefractor = /^(\S(?:.*\S)?)\s+Refractor$/iu.exec(parallel);
  if (namedRefractor && (namedRefractor[1].match(/[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*/gu)??[]).length>=2
    && !/^(?:base|standard|regular)\b/iu.test(namedRefractor[1])) {
    abbreviations.push({field:'parallel',from:parallel,to:namedRefractor[1],reason:'specific-parallel-omit-refractor-v1'});
    parallel=namedRefractor[1];
  }
  const variants = unique([subset, clean(identity.insert), parallel].filter(value => !absentVariant(value)));
  let variant = variants.join(' · ');
  if (features.serial && !variants.some(value => new RegExp(`(?:^|\\s)/${features.serial.slice(1)}(?:$|\\s)`).test(value)))
    variant = [variant, features.serial].filter(Boolean).join(' ');
  variant = unique([variant, ...features.tokens.filter(token => !variants.some(value => same(value, token)))]).join(' · ').toUpperCase();
  const prefix = [number ? `#${number}` : '', year, maker].filter(Boolean).join(' ');
  return { identity: [prefix, product].filter(Boolean).join(' '), variant, abbreviations, identityParts: [prefix, product].filter(Boolean) };
}
export function approvedBMetadataLines(identity, options) {
  const { identity: line, variant, abbreviations } = metadataProjection(identity, options);
  return { identity: line, variant, abbreviations };
}
export function approvedBMetadata(identity, options) {
  const lines = approvedBMetadataLines(identity, options);
  return [lines.identity, lines.variant].filter(Boolean).join(' · ');
}
export function approvedBStyleInputLines(identity, options) {
  const semantic=metadataProjection(identity,options);
  return ['identity','variant'].filter(role=>semantic[role]).map(role=>({role,text:semantic[role],
    styleableSpans:role==='variant'?[{start:0,end:semantic[role].length}]:!semantic.variant&&semantic.identityParts[1]
      ?[{start:semantic.identity.lastIndexOf(semantic.identityParts[1]),end:semantic.identity.length}]:[]}));
}

function styledRow(line, semantic, styleSpec, textures) {
  const original = styleSpec?.lines?.find(value=>value.role===line.role);
  const offset = semantic[line.role].indexOf(line.text);
  const crop = values => (values??[]).flatMap(value=>{
    const start=Math.max(value.start,offset),end=Math.min(value.end,offset+line.text.length);
    return start<end?[{...value,start:start-offset,end:end-offset}]:[];
  });
  const allowed = original ? crop(original.styleableSpans) : [];
  const usable = original && offset>=0 && allowed.length>0;
  const fontId = usable ? original.fontId : line.role==='variant'?'knewave':'roboto-condensed';
  const fontEntry=LABEL_STYLE_FONT_CATALOG[fontId];
  const recipe={...(usable?original:{}),text:line.text,fontId,fontSha256:fontEntry?.sha256,
    spans:usable?crop(original.spans):[],protectedSpans:original?crop(original.protectedSpans):[],
    styleableSpans:usable?allowed:[{start:0,end:line.text.length}],emphasis:usable?original.emphasis:'NORMAL'};
  const allTextures=textures?.lines?.find(value=>value.role===line.role)?.spanTextures;
  const spanTextures=usable && allTextures ? original.spans.flatMap((value,i)=>crop([value]).length?[allTextures[i]]:[]):undefined;
  return {recipe,spanTextures};
}
function metadataFit(lines, semantic, styleSpec, textures, inverted, wordmarks, nameHeight) {
  const box=LABEL_APPROVED_B_RENDERER_PROFILE.detail;
  const slotHeight=lines.length?(box.bottom-box.top-box.lineGap*(lines.length-1))/lines.length:0;
  const recipes=lines.map(line=>styledRow(line,semantic,styleSpec,textures));
  const contrast=recipes.map(({recipe})=>labelStyleContrast({recipe,inverted}));
  const shapeOptions=lines.map((line,index)=>({text:line.text,...recipes[index],spanColors:contrast[index].spanColors,
    ...(line.role==='variant'&&contrast[index].spanColors[0]?{protectedColor:contrast[index].spanColors[0].baseColor}:{}),
    defaultColor:inverted?'#090a0b':'#ffffff'}));
  const wordmarkOptions=index=>({...shapeOptions[index],wordmark:wordmarks?.[lines[index].role],expectedSourceHash:styleSpec.specHash,
    outlineColor:contrast[index].outlineColor});
  const shapes=shapeOptions.map((options,index)=>{
    return options.recipe.letteringMode==='ORIGINAL_WORDMARK'
      ? shapeLabelStyleWordmark(wordmarkOptions(index))
      : shapeLabelStyleText(options);
  });
  const fitRow=(index,maximumInkHeight)=>{
    let value=shapes[index];
    const variant=lines[index].role==='variant', styled=recipes[index].recipe.spans.length>0;
    const reviewedCap=recipes[index].recipe.reviewedCapMm;
    if(reviewedCap!==undefined&&(!Number.isFinite(reviewedCap)||reviewedCap<1.3||reviewedCap>2.5))throw Error('LABEL_STYLE_REVIEWED_CAP_INVALID');
    const target=reviewedCap??(variant?2.5:styled&&value.emphasis==='LARGE'?2.3:box.targetCapHeight);
    const traits=recipes[index].recipe.letteringTraits??[];
    const opticalTarget=variant&&reviewedCap===undefined
      ? traits.includes('HEAVY')||traits.includes('WIDE')||recipes[index].recipe.fontId==='montserrat-black'
        ? box.variant.heavyInkHeight
        : traits.includes('BRUSH')||traits.includes('HAND_DRAWN')?box.variant.brushInkHeight:null
      : null;
    // Weight and proportions change apparent size even at identical cap height.
    // Bound actual ink, while retaining the accepted cap fit for neutral faces.
    const inkLimit=Math.min(maximumInkHeight,opticalTarget??Infinity);
    if(value.representation==='ALPHA_MASK') {
      // Fit the real ink plus a fixed physical edge. Original assets may have
      // any measured cap height; neither 256 units nor a 2.5mm final fit is assured.
      const edge=contrast[index].outlineMm,centerY=box.top+index*(slotHeight+box.lineGap)+slotHeight/2;
      const circle=LABEL_APPROVED_B_RENDERER_PROFILE.nfcClearance,radius=circle.radius+circle.padding;
      const fits=scale=>{
        const height=value.height*scale+2*edge,width=value.width*scale+2*edge;
        const distanceY=Math.max(0,Math.abs(centerY-circle.y)-height/2);
        const right=distanceY>=radius?box.x+box.width:Math.min(box.x+box.width,circle.x-Math.sqrt(radius*radius-distanceY*distanceY));
        return box.x+width<=right;
      };
      let scale=Math.min(opticalTarget===null?target/value.capHeight:Infinity,
        (inkLimit-2*edge)/value.height,(box.width-2*edge)/value.width,(slotHeight-2*edge)/value.height);
      if(!fits(scale)) {
        let low=0,high=scale;
        for(let step=0;step<48;step++){const middle=(low+high)/2;if(fits(middle))low=middle;else high=middle;}
        scale=low;
      }
      // An unreadable fit is rejected by fitMetadata, before generating an
      // oversized dilation. Accepted caps >=1.3mm and assets <=512px require
      // at most .045*512/1.3 = 17.724 units, within the strict 20-unit bound.
      if(edge&&scale*value.capHeight>=box.minimumCapHeight)
        value=shapes[index]=shapeLabelStyleWordmark({...wordmarkOptions(index),outlineRadiusUnits:edge/scale});
      const height=value.height*scale,width=value.width*scale;
      const outer={x:box.x,y:centerY-height/2,width,height,scale};
      return {...outer,outerBounds:outer,pad:0,outlineColor:contrast[index].outlineColor,
        capHeight:scale*value.capHeight,fontSizePt:scale*value.unitsPerEm/25.4*72,font:value.fontFamily};
    }
    const pad=value.representation!=='ALPHA_MASK' ? contrast[index].outlineMm : 0;
    const scale=Math.min(opticalTarget===null?target/value.capHeight:Infinity,
      inkLimit/value.height,(box.width-2*pad)/value.width,(slotHeight-2*pad)/value.height);
    const outer=fitClearLine({...value,width:value.width+2*pad/scale,height:value.height+2*pad/scale},
      {x:box.x,width:box.width,centerY:box.top+index*(slotHeight+box.lineGap)+slotHeight/2,height:value.height*scale+2*pad});
    const innerScale=(outer.height-2*pad)/value.height;
    return {...outer,x:outer.x+pad,y:outer.y+pad,width:outer.width-2*pad,height:outer.height-2*pad,scale:innerScale,
      outerBounds:outer,pad,outlineColor:contrast[index].outlineColor,capHeight:innerScale*value.capHeight,fontSizePt:innerScale*(value.unitsPerEm??1000)/25.4*72,font:value.fontFamily};
  };
  const nameLimit=nameHeight-box.variant.nameGap;
  const placements=shapes.map((_,index)=>fitRow(index,nameLimit));
  const variants=placements.filter((_,index)=>lines[index].role==='variant');
  if(variants.length) {
    const variantHeight=Math.min(...variants.map(p=>p.height));
    const secondaryLimit=Math.min(variantHeight-box.variant.minimumSecondaryGap,
      Math.max(box.minimumSecondaryInkHeight,variantHeight-box.variant.secondaryGap));
    for(const [index,line] of lines.entries())if(line.role!=='variant'&&placements[index].height>secondaryLimit)
      placements[index]=fitRow(index,secondaryLimit);
  }
  return {lines,shapes,placements,capHeight:placements.length?Math.min(...placements.map(p=>p.capHeight)):0,
    widths:placements.map(p=>p.width),heights:placements.map(p=>p.height)};
}
function fitMetadata(identity, cardProfile, styleSpec, textures, inverted, wordmarks, nameHeight) {
  const box=LABEL_APPROVED_B_RENDERER_PROFILE.detail;
  // Mixed-case metadata can have taller ink than its H cap. Judge its minimum
  // by the actual printed height so a long variant need not force tiny text or
  // unnecessary layout attention merely to satisfy a font-specific metric.
  const readable=fit=>fit.placements.every((p,index)=>fit.lines[index].role==='variant'||!fit.lines.some(line=>line.role==='variant')
    ? p.capHeight>=box.minimumCapHeight-1e-6 : p.height>=box.minimumSecondaryInkHeight-1e-6);
  let semantic=metadataProjection(identity,{cardProfile});
  const rows=()=>['identity','variant'].filter(role=>semantic[role]).map(role=>({role,text:semantic[role]}));
  const fitRows=lines=>{
    const fit=metadataFit(lines,semantic,styleSpec,textures,inverted,wordmarks,nameHeight);
    if(!semantic.variant&&semantic.identityParts.length===2) {
      const productRows=metadataFit(semantic.identityParts.map(text=>({role:'identity',text})),semantic,styleSpec,textures,inverted,wordmarks,nameHeight);
      if(productRows.capHeight>fit.capHeight||styleSpec?.lines?.some(line=>line.role==='identity'&&line.emphasis==='LARGE'))return productRows;
    }
    return fit;
  };
  let lines=rows();
  if(!lines.length)return {...metadataFit([],semantic,styleSpec,textures,inverted,wordmarks,nameHeight),semantic};
  if(lines.reduce((sum,line)=>sum+line.text.split(' ').length,0)>box.maximumTokens)return null;
  let fit=fitRows(lines);
  // Display aliases are selected before model analysis. Never apply a different
  // text projection after retaining a source-bound style recipe.
  const unstyledIdentity=!styleSpec||styleSpec.lines.every(line=>line.role!=='identity'
    ||line.letteringMode==='CATALOG'&&line.styleableSpans.length===0&&line.spans.length===0);
  if(fit.capHeight<box.minimumCapHeight&&unstyledIdentity){semantic=metadataProjection(identity,{cardProfile,abbreviate:true});lines=rows();fit=fitRows(lines);}
  if(readable(fit))return {...fit,semantic};
  const choices=[];
  for(const [row,line] of lines.entries()){
    if(styleSpec?.lines?.some(value=>value.role===line.role&&value.letteringMode==='ORIGINAL_WORDMARK'))continue;
    const words=line.text.split(' ');
    for(let index=1;index<words.length;index++){
      if(words[index-1]==='·'||words[index]==='·')continue;
      const wrapped=[...lines.slice(0,row),{role:line.role,text:words.slice(0,index).join(' ')},{role:line.role,text:words.slice(index).join(' ')},...lines.slice(row+1)];
      if(wrapped.length<=box.maximumLines)choices.push(metadataFit(wrapped,semantic,styleSpec,textures,inverted,wordmarks,nameHeight));
    }
  }
  choices.sort((a,b)=>b.capHeight-a.capHeight);
  const chosen=choices.find(readable);
  return chosen?{...chosen,semantic}:null;
}

const descriptors = { 1: 'POOR', 1.5: 'FAIR', 2: 'GOOD', 2.5: 'GOOD+', 3: 'VERY GOOD', 3.5: 'VG+',
  4: 'VG-EX', 4.5: 'VG-EX+', 5: 'EXCELLENT', 5.5: 'EX+', 6: 'EX-MT', 6.5: 'EX-MT+',
  7: 'NEAR MINT', 7.5: 'NM+', 8: 'NM-MINT', 8.5: 'NM-MINT+', 9: 'MINT', 9.5: 'MINT+', 10: 'GEM MINT' };

/** Deterministic label rendering only. Approval authority and exact source
 * packet authentication remain with the existing finishing service. */
export function renderApprovedBLabel(input, { previewMaterial = 'gold', styleSpec = null, textures = null, wordmarks = null } = {}) {
  const { identity, finalGrade, reportNumber, approvalVersion, cardProfile } = input ?? {};
  if (!identity || Object.getPrototypeOf(identity) !== Object.prototype || !['SPORTS', 'POKEMON'].includes(cardProfile)
    || !Number.isInteger(finalGrade) || finalGrade < 1 || finalGrade > 10
    || typeof reportNumber !== 'string' || !reportNumber.trim() || reportNumber.length > 100
    || !Number.isSafeInteger(approvalVersion) || approvalVersion < 1 || !['gold', 'holo'].includes(previewMaterial)) throw new Error('LABEL_V4_SOURCE_INVALID');
  for (const key of ['playerName', 'cardName', 'year', 'manufacturer', 'productSet', 'cardNumber', 'parallel', 'insert'])
    if (identity[key] != null && (typeof identity[key] !== 'string' || identity[key].length > 512)) throw new Error('LABEL_V4_SOURCE_INVALID');
  if(styleSpec) {
    const {specHash,...body}=styleSpec, expected=approvedBStyleInputLines(identity,{cardProfile});
    if(styleSpec.version!=='atlas-photo-informed-label-style-v1'||approvedBHash(stable(body))!==specHash
      ||!Array.isArray(styleSpec.lines)||styleSpec.lines.length!==expected.length
      ||styleSpec.lines.some((line,index)=>line.role!==expected[index].role||line.text!==expected[index].text
        ||stable(line.styleableSpans)!==stable(expected[index].styleableSpans)
        ||line.fontSha256!==LABEL_STYLE_FONT_CATALOG[line.fontId]?.sha256))throw Error('LABEL_STYLE_SPEC_CHANGED');
    if(textures&&textures.recipeHash!==approvedBHash(stable(styleSpec)))throw Error('LABEL_STYLE_TEXTURE_BINDING_INVALID');
  } else if(textures||wordmarks)throw Error('LABEL_STYLE_SPEC_REQUIRED');
  const source = structuredClone({ identity, finalGrade, reportNumber, approvalVersion, cardProfile });
  const diagnostics = { layoutVersion: APPROVED_B_LAYOUT, typography: 'photo-informed-selected-a-v1', name: null, metadata: null, certificate: null };
  const attention = code => ({ state: 'NEEDS_LAYOUT', source, rendererProfileHash: LABEL_APPROVED_B_RENDERER_PROFILE_HASH, diagnostics: { ...diagnostics, code } });
  try {
    let name = clean(cardProfile === 'SPORTS' ? identity.playerName : identity.cardName).toUpperCase();
    if (cardProfile === 'POKEMON' && name === 'ALAKAZAM EX') name = 'ALAKAZAM';
    const candidates = name ? [[name]] : [[]], words = name.split(' ');
    if (words.length > 1) for (let i = 1; i < words.length; i++) candidates.push([words.slice(0, i).join(' '), words.slice(i).join(' ')]);
    const nameBox = LABEL_APPROVED_B_RENDERER_PROFILE.name;
    const fits = candidates.map(lines => {
      const shapes = lines.map(line => shape(line, headline));
      const baseHeight = Math.min(nameBox.targetHeight, ...shapes.map(value => nameBox.width * value.height / value.width));
      const top = lines.length > 1 ? nameBox.twoLineTop + nameBox.targetHeight - baseHeight
        : nameBox.oneLineTop + (nameBox.targetHeight - baseHeight) / 2;
      const placements = shapes.map((value, index) => fitClearLine(value, { x: nameBox.x, width: nameBox.width,
        centerY: top + index * (baseHeight + nameBox.gap) + baseHeight / 2, height: baseHeight }));
      const widths = placements.map(p => p.width), height = Math.min(baseHeight, ...placements.map(p => p.height));
      return { lines, shapes, height, widths, placements, imbalance: widths.length ? Math.max(...widths) - Math.min(...widths) : 0 };
    }).sort((a, b) => b.height - a.height || a.lines.length - b.lines.length || a.imbalance - b.imbalance);
    const fit = fits[0];
    if (fit.height < nameBox.minimumHeight) return attention('NAME_OVERFLOW');
    diagnostics.name = { text: name, lines: fit.lines, inkHeightMm: round(fit.height), widthsMm: fit.widths.map(round),
      heightsMm: fit.placements.map(p => round(p.height)),
      bounds: fit.placements.map(p => ({ x: p.x, y: round(p.y), width: round(p.width), height: round(p.height) })) };
    const names = fit.shapes.map((value, i) => {
      const p = fit.placements[i]; return place(value, p.x, p.y, p.height);
    }).join('');
    const metadata = fitMetadata(identity, cardProfile, styleSpec, textures, finalGrade===10, wordmarks, fit.height);
    if (!metadata) return attention('METADATA_OVERFLOW');
    const bounds = [], metadataPaths = { identity: '', variant: '' };
    metadata.shapes.forEach((value, index) => {
      const p = metadata.placements[index], role = metadata.lines[index].role;
      bounds.push({ role, x: p.x, y: round(p.y), width: round(p.width), height: round(p.height),
        font: p.font, capHeightMm: round(p.capHeight), fontSizePt: round(p.fontSizePt),
        outerBounds:{x:p.outerBounds.x,y:round(p.outerBounds.y),width:round(p.outerBounds.width),height:round(p.outerBounds.height)} });
      const outlined=p.pad>0?{...value,paths:`<g stroke="${p.outlineColor}" stroke-width="${round(p.pad*2/p.scale)}" stroke-linejoin="round" paint-order="stroke fill">${value.paths}</g>`}:value;
      metadataPaths[role] += place(outlined, p.x, p.y, p.height);
    });
    diagnostics.metadata = { text: [metadata.semantic.identity, metadata.semantic.variant].filter(Boolean).join('\n'),
      semanticLines: { identity: metadata.semantic.identity, variant: metadata.semantic.variant },
      lines: metadata.lines.map(line => line.text), lineRoles: metadata.lines.map(line => line.role),
      abbreviations: metadata.semantic.abbreviations, capHeightMm: round(metadata.capHeight),
      fontSizePt: round(metadata.placements.length ? Math.min(...metadata.placements.map(p => p.fontSizePt)) : 0),
      inkHeightMm: round(Math.max(0, ...metadata.heights)), bounds };
    const certificate=/^ATLAS-([A-F0-9]{12})$/.exec(reportNumber);
    const certText=`#${certificate?certificate[1]:reportNumber}`,cert=shape(certText,certificateFace);
    const certScale=1.3/shape('H',certificateFace).height,certHeight=cert.height*certScale,certWidth=cert.width*certScale;
    if(certWidth>13.9||certHeight>1.6)return attention('CERTIFICATE_OVERFLOW');
    const certPaths=place(cert,1.9+(13.9-certWidth)/2,18.35-certHeight/2,certHeight);
    diagnostics.certificate={text:certText,canonical:reportNumber,capHeightMm:1.3,inkHeightMm:round(certHeight),weight:500,
      bounds:{x:round(1.9+(13.9-certWidth)/2),y:round(18.35-certHeight/2),width:round(certWidth),height:round(certHeight)}};
    let grade = vectors.grade10;
    if (finalGrade !== 10) {
      const value = shape(String(finalGrade), detail), height = Math.min(10.2, 9.47 * value.height / value.width), width = value.width / value.height * height;
      grade = place(value, 58.35 + (9.47 - width) / 2, 4.65 + (10.2 - height) / 2, height);
    }
    const descriptor = descriptors[finalGrade], descriptorShape = shape(descriptor, detail);
    const descHeight = Math.min(1.35, 8.8 * descriptorShape.height / descriptorShape.width);
    const descWidth = descriptorShape.width / descriptorShape.height * descHeight;
    diagnostics.grade = { value: finalGrade, descriptor, uniformScaling: true };
    const primary=`<g data-part="name">${names}</g><g data-part="grade">${grade}</g><g data-part="descriptor">${place(descriptorShape,58.35+(8.8-descWidth)/2,16.15+(1.35-descHeight)/2,descHeight)}</g>`;
    const reportShape=shape('GRADE',detail),reportShape2=shape('REPORT',detail);
    const reportPaths=[reportShape,reportShape2].map((value,i)=>{const h=1.05,w=value.width/value.height*h;return place(value,51.8-w/2,15.25+i*1.2,h);}).join('');
    const support=`<g data-part="certificate">${certPaths}</g><g data-part="grade-report">${reportPaths}</g>`;
    const accents=`<g data-part="metadata">${metadataPaths.identity}</g><g data-part="variant">${metadataPaths.variant}</g>`;
    diagnostics.style={version:LABEL_STYLE_PAINT_VERSION,specHash:styleSpec?.specHash??null,provenance:styleSpec?.provenance??{kind:'DETERMINISTIC_FALLBACK'},
      contrast:finalGrade===10?'exact10-exposed-foil':'shared-below10-black',textures:textures?.receipts??[],
      lettering:metadata.shapes.map((value,index)=>({role:metadata.lines[index].role,font:value.fontFamily,
        representation:value.representation??'FONT_OUTLINES',wordmarkArtifactHash:value.wordmarkArtifactHash??null,
        provenance:value.wordmarkArtifactHash?'ORIGINAL_GENERATED_LETTERING':'PACKAGED_FONT'}))};
    const printSvg=buildLabelStyleFront({title:`${name}, grade ${finalGrade}, ${reportNumber}, version ${approvalVersion}`,primary,support,accents,
      defs:metadata.shapes.map(value=>value.defs??'').join(''),inverted:finalGrade===10});
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
