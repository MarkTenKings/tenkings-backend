import { atlasPublicSportsAttributesSchema } from '@atlas/grading-core/identity';

export function sportsAttributeSearch(value) {
  if (!value) return { terms: [], variantIdentity: undefined };
  const attributes = atlasPublicSportsAttributesSchema.parse(value), terms = [], variantIdentity = {};
  if (attributes.serial.presence === 'PRESENT') { terms.push(`/${attributes.serial.denominator}`); variantIdentity.serialDenominator = attributes.serial.denominator; }
  if (attributes.autograph.presence !== 'UNKNOWN') variantIdentity.autograph = attributes.autograph.presence === 'PRESENT' && attributes.autograph.type !== 'FACSIMILE';
  if (attributes.autograph.presence === 'PRESENT') { terms.push('auto'); if (attributes.autograph.type === 'FACSIMILE') terms.push('facsimile'); }
  if (attributes.relic.presence !== 'UNKNOWN') variantIdentity.memorabilia = attributes.relic.presence === 'PRESENT';
  if (attributes.relic.presence === 'PRESENT') terms.push('relic');
  return { terms, variantIdentity };
}

/** Listing statements are evidence of comparability, never authentication.
 * Missing attributes stay unresolved; explicit contradictions exclude guidance. */
export function matchSportsAttributeEvidence(value, { title = '', labelText = '' } = {}) {
  if (!value) return null;
  const attributes = atlasPublicSportsAttributesSchema.parse(value), evidence = `${title} ${labelText}`.toLowerCase(), conflicts = [], missing = [];
  const compare = (name, expected, observed) => {
    if (!observed.length) missing.push(`${name}_UNDISCLOSED`);
    else if (observed.some(actual => !expected.includes(actual))) conflicts.push(`${name}_MISMATCH`);
    else if (expected.some(wanted => !observed.includes(wanted))) missing.push(`${name}_INCOMPLETE`);
  };
  if (attributes.serial.presence === 'PRESENT') compare('SERIAL_DENOMINATOR', [attributes.serial.denominator], [...evidence.matchAll(/\/\s*(\d{1,6})\b/g)].map(match => Number(match[1])));
  if (attributes.serial.presence === 'PRESENT' && /\b(?:(?:not|non|un)[ -]?(?:serial[ -]?)?numbered|no serial)\b/.test(evidence)) conflicts.push('SERIAL_PRESENCE_MISMATCH');
  if (attributes.serial.presence === 'ABSENT' && /\/\s*\d{1,6}\b/.test(evidence)) conflicts.push('SERIAL_PRESENCE_MISMATCH');
  const signatureTypes = [['ON_CARD', /\b(?:on[ -]card|hard[ -]signed)\b/], ['STICKER', /\b(?:sticker|label)[ -](?:auto|autograph|signature)\b/], ['CUT', /\bcut (?:auto|autograph|signature)\b/], ['FACSIMILE', /\b(?:facsimile|printed signature|reproduction signature)\b/]];
  const negatedSignatureType = /\bnot[ -]+(?:an?[ -]+)?(?:on[ -]card|hard[ -]signed|sticker|label|cut|facsimile)\b/.test(evidence);
  const types = signatureTypes.filter(([, pattern]) => !negatedSignatureType && pattern.test(evidence)).map(([type]) => type);
  const noAuto = /\b(?:unsigned|(?:no|non|not|without)[ -]+(?:an?[ -]+)?(?:auto|autographs?|autographed|signature|signed))\b/.test(evidence);
  const hasAuto = types.length > 0 || /\b(?:auto|autographs?|autographed|signature|signed)\b/.test(evidence);
  if (attributes.autograph.presence === 'PRESENT') {
    if (negatedSignatureType) missing.push('AUTOGRAPH_TYPE_NEGATED_OR_UNCLEAR');
    if (noAuto) conflicts.push('AUTOGRAPH_MISMATCH'); else if (!hasAuto) missing.push('AUTOGRAPH_UNDISCLOSED');
    if (attributes.autograph.type !== 'UNKNOWN') compare('AUTOGRAPH_TYPE', [attributes.autograph.type], types);
    else if (types.includes('FACSIMILE')) missing.push('AUTOGRAPH_TYPE_TARGET_UNKNOWN');
  } else if (attributes.autograph.presence === 'ABSENT' && hasAuto && !noAuto) conflicts.push('AUTOGRAPH_MISMATCH');
  const hasRelic = /\b(?:relic|patch|memorabilia|jersey|swatch|bat piece)\b/.test(evidence), noRelic = /\b(?:no|non|not|without)[ -]+(?:an?[ -]+)?(?:relic|patch|memorabilia|jersey|swatch)\b/.test(evidence);
  if (attributes.relic.presence === 'PRESENT') {
    if (noRelic) conflicts.push('RELIC_MISMATCH'); else if (!hasRelic) missing.push('RELIC_UNDISCLOSED');
    const notAssociated = /\bnot associated\b/.test(evidence);
    const negatedUse = /\b(?:not|never|no|non)[ -]+(?:(?:actually|necessarily|certified|guaranteed|confirmed)[ -]+)?(?:game|player|event)[ -]+(?:used|worn)\b/.test(evidence);
    const uses = [...(notAssociated ? ['NOT_ASSOCIATED'] : []), ...[['GAME_USED', /\bgame[ -](?:used|worn)\b/], ['PLAYER_WORN', /\bplayer[ -](?:used|worn)\b/], ['EVENT_WORN', /\bevent[ -](?:used|worn)\b/]].filter(([, pattern]) => !negatedUse && pattern.test(evidence)).map(([use]) => use)];
    if (negatedUse) missing.push('RELIC_USE_NEGATED_OR_UNCLEAR');
    // Text aggregated across several windows cannot establish which piece has
    // which material/use. Keep it unresolved until positional evidence exists.
    if (attributes.relic.windows.length > 1) missing.push('RELIC_WINDOW_ASSOCIATION_UNVERIFIED');
    const expectedUses = [...new Set(attributes.relic.windows.map(window => window.use).filter(use => !['UNKNOWN', 'UNSPECIFIED'].includes(use)))];
    if (expectedUses.length) compare('RELIC_USE', expectedUses, uses);
    const materials = ['fabric', 'patch', 'jersey', 'bat', 'wood', 'leather', 'metal', 'paper'];
    if (attributes.relic.windows.some(window => window.material && !materials.includes(window.material.toLowerCase()))) missing.push('RELIC_MATERIAL_TARGET_UNRESOLVED');
    const expectedMaterials = [...new Set(attributes.relic.windows.map(window => window.material?.toLowerCase()).filter(material => materials.includes(material)))];
    // Fabric/jersey/patch describe overlapping cloth details, so only a clear
    // different material is a contradiction. Missing text remains unresolved.
    const family = material => ['fabric', 'patch', 'jersey'].includes(material) ? 'cloth' : ['bat', 'wood'].includes(material) ? 'wood' : material;
    const observedMaterials = materials.filter(material => new RegExp(`\\b${material}\\b`).test(evidence));
    if (expectedMaterials.length) compare('RELIC_MATERIAL', [...new Set(expectedMaterials.map(family))], [...new Set(observedMaterials.map(family))]);
  } else if (attributes.relic.presence === 'ABSENT' && hasRelic && !noRelic) conflicts.push('RELIC_MISMATCH');
  return { status: conflicts.length ? 'CONTRADICTORY' : missing.length ? 'UNKNOWN' : 'MATCH', reasonCodes: [...new Set([...conflicts, ...missing])] };
}
