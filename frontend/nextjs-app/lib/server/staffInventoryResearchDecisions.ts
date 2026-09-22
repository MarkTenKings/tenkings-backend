import { normalizeEbaySoldCompsV2Text as normalized } from '@tenkings/ebay-sold-comps-v2';
import type {
  StaffInventoryResearchCandidate, StaffInventoryResearchComparison, StaffInventoryResearchDescription,
  StaffInventoryResearchReference, StaffInventoryResearchResult,
} from '../staffInventoryResearch';

/** Private Inventory decisions only. None of these helpers resolve catalog
 * identity, verify a sale/amount, or change the shared/public comps parser. */
export type StaffInventoryResearchDecisionReason =
  | 'unsupported_card_product' | 'unsupported_choice_listing' | 'unsupported_price_range'
  | 'release_year_conflict' | 'release_year_ambiguous' | 'release_year_missing' | 'season_alias_supported' | 'design_year_supported'
  | 'card_number_conflict' | 'card_number_missing' | 'name_anchor_missing' | 'product_anchor_missing'
  | 'manufacturer_anchor_missing' | 'sport_conflict' | 'product_title_conflict' | 'descriptive_suffix_omitted' | 'reference_anchor_conflict'
  | 'variant_title_conflict' | 'listing_grade_explicit' | 'listing_grade_unmarked' | 'listing_grade_unresolved'
  | 'condition_mismatch' | 'target_condition_unresolved' | 'listing_image_missing' | 'comparison_not_completed'
  | 'model_identity_mismatch' | 'model_variant_mismatch' | 'model_visual_mismatch' | 'model_condition_mismatch'
  | 'model_decision_inconsistent' | 'model_match_retained';

type Grader = NonNullable<StaffInventoryResearchCandidate['grader']>;
type Condition = StaffInventoryResearchResult['target_condition'];
type Listing = Pick<StaffInventoryResearchCandidate, 'title' | 'condition' | 'sold_price'>;
const span = (value: string, expected: string) => expected.length > 0 && ` ${value} `.includes(` ${expected} `);
const unique = <T>(values: T[]) => [...new Set(values)];
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const dashes = (value: string) => value.replace(/[\u2010-\u2015\u2212]/g, '-');
const numberIdentity = (value: string) => dashes(value).replace(/^#\s*/, '').replace(/\s*([/-])\s*/g, '$1').trim().toLowerCase();

export type StaffInventoryResearchGradeEvidence = {
  status: 'raw' | 'graded' | 'unresolved';
  grader: Grader | null;
  numeric_grade: number | null;
  reason_codes: StaffInventoryResearchDecisionReason[];
};

function gradeText(value: string) {
  return dashes(value).replace(/professional sports authenticator/gi, 'PSA').replace(/beckett grading services?/gi, 'BGS')
    .replace(/sportscard guaranty(?: corporation)?/gi, 'SGC').replace(/certified guaranty company/gi, 'CGC');
}
const graderMarker = /\b(?:PSA|BGS|SGC|CGC|HGA|GMA|AGS|TAG|graded|slab(?:bed)?)\b/i;
// Hyphens are allowed between recognized label words, never between numeric
// alternatives. A card number/certification is not a fallback numeric grade.
const gradePattern = /\b(PSA|BGS|SGC|CGC)\b[\s:-]*(?:(?:GEM|MINT|PRISTINE|BLACK|LABEL|NEAR|NM|MT|EX|EXCELLENT|VG|VERY|GOOD|FAIR|POOR)[\s-]+)*(10|[1-9])(?:\.([05]))?(?![\d.A-Za-z])/gi;
function gradeMatches(value: string) { return [...gradeText(value).matchAll(new RegExp(gradePattern))]; }

export function readStaffInventoryResearchGradeEvidence(title: string, condition: string | null): StaffInventoryResearchGradeEvidence {
  const text = gradeText(`${title} ${condition ?? ''}`), matches = gradeMatches(text);
  const unresolved = (): StaffInventoryResearchGradeEvidence => ({ status: 'unresolved', grader: null, numeric_grade: null, reason_codes: ['listing_grade_unresolved'] });
  if (!graderMarker.test(text)) return { status: 'raw', grader: null, numeric_grade: null, reason_codes: ['listing_grade_unmarked'] };
  if (!matches.length) return unresolved();
  const markers = [...text.matchAll(/\b(?:PSA|BGS|SGC|CGC|HGA|GMA|AGS|TAG)\b/gi)];
  if (markers.length !== matches.length || matches.some(match => {
    const after = text.slice(match.index! + match[0].length);
    const before = text.slice(Math.max(0, match.index! - 16), match.index!);
    return /^(?:\s*(?:[/?+]|-(?:\s*\d)|(?:or|to)\b|[,&]\s*(?:10|[1-9])(?:\.[05])?\b)|\s*\(?\s*(?:OC|MC|MK|ST|PD|OF)\b)/i.test(after) || /\b(?:not|like|possible|maybe)\s*$/i.test(before);
  })) return unresolved();
  const grades = matches.map(match => ({ grader: match[1].toUpperCase() as Grader, numeric_grade: Number(`${match[2]}${match[3] ? `.${match[3]}` : ''}`) }));
  if (grades.some(grade => grade.numeric_grade > 10 || grade.grader !== grades[0].grader || grade.numeric_grade !== grades[0].numeric_grade)) return unresolved();
  return { status: 'graded', ...grades[0], reason_codes: ['listing_grade_explicit'] };
}

/** These are the same adjacent-season spellings permitted for retrieval. An
 * individual year is an alias only when the saved identity names that season. */
export function staffInventoryResearchYearForms(year: string | null): string[] {
  if (!year) return [];
  const cleaned = dashes(year).replace(/\s*([/-])\s*/g, '$1'), forms = [cleaned];
  const season = cleaned.match(/^(\d{4})[-/](\d{2}|\d{4})$/);
  if (season) {
    const start = Number(season[1]);
    let end = season[2].length === 2 ? Math.floor(start / 100) * 100 + Number(season[2]) : Number(season[2]);
    if (season[2].length === 2 && end < start) end += 100;
    if (end === start + 1) forms.push(String(start), String(end), `${start}-${end}`, `${start}-${String(end).slice(-2)}`, `${start}/${end}`, `${start}/${String(end).slice(-2)}`);
  }
  return unique(forms);
}

export type StaffInventoryResearchYearEvidence = {
  status: 'matched' | 'missing' | 'conflicting' | 'ambiguous';
  matched: string[];
  design: string[];
  conflicting: string[];
  ambiguous: string[];
};

function yearEvidence(description: StaffInventoryResearchDescription, title: string): StaffInventoryResearchYearEvidence {
  const text = dashes(title), forms = staffInventoryResearchYearForms(description.year).map(normalized);
  const years = [...text.matchAll(/\b(?:19|20)\d{2}(?:\s*[-/]\s*(?:\d{4}|\d{2}))?\b/g)].filter(match => {
    // A prefixed card/cert number or the denominator of another number is not a release year.
    const before = text.slice(0, match.index!);
    return !/[#/]\s*$/.test(before) && !/\b(?:cert|certificate|certification)(?:\s+(?:number|no\.?))?\s*#?\s*$/i.test(before);
  });
  const evidence: StaffInventoryResearchYearEvidence = { status: 'missing', matched: [], design: [], conflicting: [], ambiguous: [] };
  if (!forms.length) return evidence;
  const matched = years.filter(match => forms.includes(normalized(match[0])));
  evidence.matched = unique(matched.map(match => match[0]));
  const releaseYears = matched.flatMap(match => {
    const years = staffInventoryResearchYearForms(match[0]).filter(form => /^\d{4}$/.test(form));
    return years.map(Number);
  });
  for (const match of years.filter(match => !forms.includes(normalized(match[0])))) {
    const after = text.slice(match.index! + match[0].length), before = text.slice(0, match.index!);
    const anniversary = after.match(/^\s+(\d{1,3})(?:st|nd|rd|th)\s+anniversary\b/i);
    const explicitDesign = /^\s+(?:design|throwback|tribute)\b/i.test(after) || /\b(?:design(?:ed)?(?:\s+in)?|throwback\s+to)\s*$/i.test(before);
    // The stated anniversary must agree with an independently printed matching
    // release year; the saved year alone cannot supply that missing evidence.
    if (/^\d{4}$/.test(match[0]) && matched.length && (explicitDesign && releaseYears.some(year => year > Number(match[0])) || anniversary && releaseYears.some(year => year - Number(match[0]) === Number(anniversary[1])))) {
      evidence.design.push(match[0]);
    } else {
      const beginsListing = before.trim().length === 0;
      const precedesMaker = description.manufacturer !== null && normalized(after).startsWith(`${normalized(description.manufacturer)} `);
      if (!explicitDesign && !anniversary && (!matched.length || beginsListing || precedesMaker)) evidence.conflicting.push(match[0]);
      else evidence.ambiguous.push(match[0]);
    }
  }
  evidence.status = evidence.conflicting.length ? 'conflicting' : evidence.ambiguous.length ? 'ambiguous' : evidence.matched.length ? 'matched' : 'missing';
  return evidence;
}

const sportWords = ['baseball', 'basketball', 'football', 'hockey', 'soccer', 'tennis', 'golf', 'racing', 'wrestling'];
function productAnchor(description: StaffInventoryResearchDescription) {
  let product = normalized(description.set_name);
  for (const prefix of [normalized(description.year), normalized(description.manufacturer)]) {
    if (prefix && (product === prefix || product.startsWith(`${prefix} `))) product = product.slice(prefix.length).trim();
  }
  const original = product;
  // Only category labels at the end can be omitted. University, Chrome,
  // Heritage, Update, Optic, Select levels, insert names, etc. remain anchors.
  product = product.replace(/(?:^|\s)(?:trading\s+)?cards?$/, '').trim();
  if (description.category === 'Sports cards') product = product.replace(new RegExp(`(?:^|\\s)(?:${sportWords.join('|')})$`), '').trim();
  return { product, original, removed: original !== product };
}

function cardNumberEvidence(description: StaffInventoryResearchDescription, title: string) {
  const expected = description.card_number && numberIdentity(description.card_number), text = gradeText(title);
  if (!expected) return { matched: false, conflicting: [] as string[] };
  const isCert = (index: number) => /\b(?:cert|certificate|certification)(?:\s+(?:number|no\.?))?\s*$/i.test(text.slice(Math.max(0, index - 30), index));
  const explicit = [...text.matchAll(/(?:^|[\s(])#\s*([A-Za-z0-9]+(?:\s*[-/]\s*[A-Za-z0-9]+)*)(?=$|[\s),.;:])/g)]
    .filter(match => !isCert(match.index! + match[0].indexOf('#'))).map(match => {
      // For a saved single numeric sports number, "#302 /99" names #302
      // followed by a serial limit. Keep joined fractions and every saved
      // fractional/alphanumeric number intact, including Pokémon denominators.
      const serial = description.category === 'Sports cards' && /^\d+$/.test(expected) ? match[1].match(/^(\d+)\s+\/\s*\d+$/) : null;
      return numberIdentity(serial ? serial[1] : match[1]);
    });
  // A Pokémon denominator is part of the card number. A serial /35 is not #35.
  const numerator = expected.split('/')[0];
  const denominatorConflicts = expected.includes('/') ? [...text.matchAll(/\b([A-Za-z0-9]+\s*\/\s*[A-Za-z0-9]+)\b/g)]
    .map(match => numberIdentity(match[1])).filter(number => number.split('/')[0] === numerator && number !== expected) : [];
  const gradeSpans = gradeMatches(text).map(match => [match.index!, match.index! + match[0].length]);
  const expectedPattern = escape(expected).replace(/\//g, '\\s*/\\s*').replace(/-/g, '\\s*-\\s*');
  const found = [...text.matchAll(new RegExp(`(^|[^A-Za-z0-9/#-])#?(${expectedPattern})(?=$|[^A-Za-z0-9/#-])`, 'gi'))].some(match => {
    const index = match.index! + match[1].length;
    const before = text.slice(Math.max(0, index - 24), index);
    return !gradeSpans.some(([start, end]) => index >= start && index < end) && !isCert(index) && !/(?:[/$£€]|\b(?:USD|GBP|EUR|serial))\s*$/i.test(before);
  });
  return { matched: found, conflicting: unique([...explicit.filter(number => number !== expected), ...denominatorConflicts]) };
}

const unsupportedProduct = /\b(?:lot|bundle|reprint|replica|proxy|custom|facsimile|digital)\b|\b(?:sealed|unopened|booster|blaster)\s+(?:box|pack)s?\b|\b(?:complete|full)\s+set\b|\b(?:[2-9]|[1-9]\d+)\s+(?:cards|packs)\b/i;
const choiceListing = /\b(?:choose|pick|select)\s+(?:(?:your|the|a|one|any)\s+)?(?:cards?|players?|variations?|singles?)\b|\b(?:you|u)\s+(?:pick|choose)\b|\b(?:pick|choose)\s+from\b|\bcomplete\s+your\s+set\b/i;
const sourcePriceRange = /\d[\d,.]*\s*(?:-|to)\s*(?:[$£€]\s*)?\d/i;
const titlePriceRange = /(?:[$£€]|\b(?:USD|GBP|EUR)\s*)\s*\d[\d,.]*\s*(?:-|to)\s*(?:[$£€]\s*)?\d/i;
export function inspectStaffInventoryResearchSale(candidate: Listing): { supported: boolean; reason_codes: StaffInventoryResearchDecisionReason[] } {
  const title = dashes(`${candidate.title} ${candidate.condition ?? ''}`), reasons: StaffInventoryResearchDecisionReason[] = [];
  if (unsupportedProduct.test(title)) reasons.push('unsupported_card_product');
  if (choiceListing.test(title.replace(/[-/]/g, ' '))) reasons.push('unsupported_choice_listing');
  if (titlePriceRange.test(title) || sourcePriceRange.test(dashes(candidate.sold_price ?? ''))) reasons.push('unsupported_price_range');
  return { supported: reasons.length === 0, reason_codes: reasons };
}

function variantTitleConflict(description: StaffInventoryResearchDescription, title: string): boolean {
  if (!description.variant) return false;
  const expected = normalized(description.variant);
  const normalizedTitle = normalized(title).replace(normalized(description.name), '').replace(normalized(description.set_name), '');
  // Bound this check to explicit color + finish phrases. Bare colors may be
  // player/team names (Josh Green, Blue Jays), not contradictory parallels.
  const phrases = [...normalizedTitle.matchAll(/\b(blue|red|green|gold|black|white|pink|purple|orange|yellow|silver)\s+(ice|cracked ice|prizm|refractor|wave|shimmer|mojo|disco|pulsar)\b/g)];
  const expectedPhrase = expected.match(/\b(blue|red|green|gold|black|white|pink|purple|orange|yellow|silver)\s+(ice|cracked ice|prizm|refractor|wave|shimmer|mojo|disco|pulsar)\b/);
  if (/^(?:base|base card|regular|standard)$/.test(expected) && phrases.length) return true;
  return !!expectedPhrase && phrases.some(match => match[0] !== expectedPhrase[0]);
}

function productTitleConflict(description: StaffInventoryResearchDescription, product: string, title: string): boolean {
  // These explicit product qualifiers are not disposable category labels.
  // Keeping them avoids converting Contenders Optic to Contenders or Topps
  // Chrome to a brand-only Topps Baseball match when the sport is omitted.
  if (!description.set_name) return false;
  const manufacturer = normalized(description.manufacturer);
  const titleWithoutName = normalized(title.replace(normalized(description.name), ''));
  // Do not treat every extra title word as an identity contradiction. For
  // example, NSCC Silver Pack titles may also describe their Chrome stock.
  const qualifiers = !product && manufacturer === 'topps' ? ['chrome', 'heritage', 'archives', 'finest', 'update', 'stadium club']
    : product === 'contenders' || product === 'donruss' ? ['optic', 'draft picks']
      : product === 'prizm' || product === 'select' ? ['draft picks']
        : product === 'chrome' && manufacturer === 'topps' ? ['update'] : [];
  const anchor = product || manufacturer;
  return qualifiers.some(qualifier => span(titleWithoutName, `${anchor} ${qualifier}`));
}

export type StaffInventoryResearchTitleEvidence = {
  research_anchored: boolean;
  estimate_anchored: boolean;
  reason_codes: StaffInventoryResearchDecisionReason[];
  year: StaffInventoryResearchYearEvidence;
  name_anchored: boolean;
  product_anchored: boolean;
  number_anchored: boolean;
  manufacturer_anchored: boolean;
};

export function inspectStaffInventoryResearchTitle(description: StaffInventoryResearchDescription, candidate: Pick<StaffInventoryResearchCandidate, 'title'>, reference?: StaffInventoryResearchReference): StaffInventoryResearchTitleEvidence {
  const title = normalized(candidate.title), reasons: StaffInventoryResearchDecisionReason[] = [];
  const product = productAnchor(description), year = yearEvidence(description, candidate.title), number = cardNumberEvidence(description, candidate.title);
  const titleTokens = new Set(title.split(' '));
  const hasAllTokens = (value: string) => value.length > 0 && value.split(' ').every(token => titleTokens.has(token));
  const nameAnchored = hasAllTokens(normalized(description.name));
  const manufacturerAnchored = description.manufacturer === null || span(title, normalized(description.manufacturer));
  // A base "Topps Baseball" product may reduce to its brand after removing the
  // repeated manufacturer and sport. It still needs that exact brand in title.
  const brandOnlyProduct = description.category === 'Sports cards' && ['topps', 'donruss', 'score', 'fleer', 'ud'].includes(normalized(description.manufacturer)) && manufacturerAnchored;
  const productAnchored = description.set_name !== null && (product.product ? hasAllTokens(product.product) : brandOnlyProduct);
  const expectedSports = description.category === 'Sports cards' ? sportWords.filter(sport => span(product.original, sport) || span(normalized(description.card_type), sport)) : [];
  const sportConflict = expectedSports.length > 0 && sportWords.some(sport => !expectedSports.includes(sport) && span(title, sport));
  const variantConflict = variantTitleConflict(description, candidate.title);
  const productConflict = productTitleConflict(description, product.product, title);
  if (!nameAnchored) reasons.push('name_anchor_missing');
  if (!productAnchored) reasons.push('product_anchor_missing');
  if (!manufacturerAnchored) reasons.push('manufacturer_anchor_missing');
  if (product.removed && productAnchored && !span(title, product.original)) reasons.push('descriptive_suffix_omitted');
  if (sportConflict) reasons.push('sport_conflict');
  if (productConflict) reasons.push('product_title_conflict');
  if (variantConflict) reasons.push('variant_title_conflict');
  if (year.status === 'conflicting') reasons.push('release_year_conflict');
  if (year.status === 'ambiguous') reasons.push('release_year_ambiguous');
  if (year.status === 'missing') reasons.push('release_year_missing');
  if (year.design.length) reasons.push('design_year_supported');
  if (year.matched.length && !year.matched.some(value => normalized(value) === normalized(description.year))) reasons.push('season_alias_supported');
  if (number.conflicting.length) reasons.push('card_number_conflict');
  if (!number.matched) reasons.push('card_number_missing');
  const referenceProduct = reference && productAnchor({ ...description, set_name: reference.identity.set_name });
  const referenceSportConflict = referenceProduct && expectedSports.length > 0 && sportWords.some(sport => span(referenceProduct.original, sport) && !expectedSports.includes(sport));
  const referenceCompatible = !reference || (
    span(normalized(description.name), normalized(reference.identity.name)) &&
    normalized(reference.identity.year) === normalized(description.year) &&
    normalized(reference.identity.manufacturer) === normalized(description.manufacturer) &&
    reference.identity.card_number !== null && description.card_number !== null && numberIdentity(reference.identity.card_number) === numberIdentity(description.card_number) &&
    (reference.identity.category === null || normalized(reference.identity.category) === normalized(description.category)) &&
    reference.identity.set_name !== null && referenceProduct?.product === product.product && !referenceSportConflict
  );
  if (!referenceCompatible) reasons.push('reference_anchor_conflict');
  // A compatible exact catalog row may extract its full printed name from a
  // composite staff description (year + brand + player + number). It cannot
  // supply a different player or discard any contradictory saved anchor.
  const exactName = reference && referenceCompatible ? reference.identity.name : description.name;
  const exactTitleSpans = span(title, normalized(exactName)) && (product.product ? span(title, product.product) : brandOnlyProduct);
  const researchAnchored = nameAnchored && productAnchored && !sportConflict && !productConflict && !variantConflict && year.status !== 'conflicting' && year.status !== 'ambiguous' && number.conflicting.length === 0;
  return {
    research_anchored: researchAnchored,
    // Title sufficiency is only one estimate prerequisite; the caller must also
    // verify catalog/photo diagnostics, exact condition, sold status and price.
    estimate_anchored: researchAnchored && exactTitleSpans && manufacturerAnchored && year.status === 'matched' && number.matched && referenceCompatible,
    reason_codes: reasons, year, name_anchored: nameAnchored, product_anchored: productAnchored,
    number_anchored: number.matched, manufacturer_anchored: manufacturerAnchored,
  };
}

export function compareStaffInventoryResearchCondition(condition: Condition, grade: StaffInventoryResearchGradeEvidence): 'matched' | 'conflicting' | 'unresolved' {
  if (condition.status === 'unresolved' || grade.status === 'unresolved') return 'unresolved';
  if (condition.status === 'raw') return grade.status === 'raw' ? 'matched' : 'conflicting';
  return grade.status === 'graded' && grade.grader === condition.grader && grade.numeric_grade === condition.numeric_grade ? 'matched' : 'conflicting';
}

export function assessStaffInventoryResearchComparison(
  candidate: StaffInventoryResearchCandidate,
  description: StaffInventoryResearchDescription,
  condition: Condition,
  comparison?: StaffInventoryResearchComparison,
  options: { comparisonCompleted?: boolean } = {},
): {
  assessment: StaffInventoryResearchComparison;
  reason_codes: StaffInventoryResearchDecisionReason[];
  evidence: { title: StaffInventoryResearchTitleEvidence; grade: StaffInventoryResearchGradeEvidence; condition: 'matched' | 'conflicting' | 'unresolved'; image: 'missing' | 'acquired_unassessed' | 'compared' };
} {
  const assessment: StaffInventoryResearchComparison = comparison ? { ...comparison } : {
    candidate_id: candidate.id, classification: 'possible', identity_match: false, variant_match: false, visual_match: false, condition_match: false,
    reason: 'This source result has not received a complete visual comparison.',
  };
  const title = inspectStaffInventoryResearchTitle(description, candidate), sale = inspectStaffInventoryResearchSale(candidate);
  const grade = readStaffInventoryResearchGradeEvidence(candidate.title, candidate.condition), conditionEvidence = compareStaffInventoryResearchCondition(condition, grade);
  const syntheticReason = comparison?.reason === 'The listing image is unavailable for a verified visual comparison.' || comparison?.reason === 'This source result has not received a complete visual comparison.' || comparison?.reason === 'The listing image was acquired but has not received a complete visual comparison.';
  const comparisonCompleted = options.comparisonCompleted ?? (!!comparison && !syntheticReason);
  const image = !candidate.image ? 'missing' : comparisonCompleted ? 'compared' : 'acquired_unassessed';
  const reasons = unique([...sale.reason_codes, ...title.reason_codes, ...grade.reason_codes]);
  const finish = (changes: Partial<StaffInventoryResearchComparison> = {}, extra: StaffInventoryResearchDecisionReason[] = []) => ({
    assessment: { ...assessment, ...changes }, reason_codes: unique([...reasons, ...extra]), evidence: { title, grade, condition: conditionEvidence, image } as const,
  });
  if (!sale.supported) return finish({ classification: 'rejected', identity_match: false, reason: sale.reason_codes.includes('unsupported_choice_listing') ? 'The listing offers a choice of cards and does not establish one exact sold card.' : sale.reason_codes.includes('unsupported_price_range') ? 'The listing reports a price range rather than one exact card sale.' : 'The listing describes a lot or unsupported card product.' });
  if (title.reason_codes.includes('release_year_conflict')) return finish({ classification: 'rejected', identity_match: false, reason: 'The listing identifies a release year outside the saved card year or season.' });
  if (title.reason_codes.includes('card_number_conflict')) return finish({ classification: 'rejected', identity_match: false, reason: 'The listing identifies a different card number.' });
  if (title.reason_codes.includes('sport_conflict')) return finish({ classification: 'rejected', identity_match: false, reason: 'The listing identifies a different sport from the saved product.' });
  if (title.reason_codes.includes('product_title_conflict')) return finish({ classification: 'rejected', identity_match: false, reason: 'The listing explicitly names a different product or product edition.' });
  if (title.reason_codes.includes('variant_title_conflict')) return finish({ classification: 'rejected', variant_match: false, reason: 'The listing explicitly names a different parallel from the saved variant.' });
  if (conditionEvidence === 'conflicting') return finish({ classification: 'rejected', condition_match: false, reason: 'The listing raw/graded condition or exact grader and grade differs from the uploaded card.' }, ['condition_mismatch']);
  if (conditionEvidence === 'unresolved') return finish({ classification: 'possible', condition_match: false, reason: condition.status === 'unresolved' ? 'The uploaded card condition remains unresolved.' : 'The listing mentions grading but does not establish one unambiguous grader and numeric grade.' }, condition.status === 'unresolved' ? ['target_condition_unresolved'] : []);
  if (image === 'missing') return finish({ classification: 'possible', visual_match: false, reason: 'The listing image is unavailable for a verified visual comparison.' }, ['listing_image_missing']);
  if (image === 'acquired_unassessed') return finish({ classification: 'possible', visual_match: false, reason: 'The listing image was acquired but has not received a complete visual comparison.' }, ['comparison_not_completed']);
  if (!title.research_anchored && assessment.classification !== 'rejected') return finish({ classification: 'possible', reason: title.reason_codes.includes('release_year_ambiguous') ? 'An additional title year is ambiguous; it is not established as the release year or a design year.' : 'The listing title does not establish the saved name and product identity; visual evidence remains tentative.' });
  const modelReasons: StaffInventoryResearchDecisionReason[] = [];
  if (!assessment.identity_match) modelReasons.push('model_identity_mismatch');
  if (!assessment.variant_match) modelReasons.push('model_variant_mismatch');
  if (!assessment.visual_match) modelReasons.push('model_visual_mismatch');
  if (!assessment.condition_match) modelReasons.push('model_condition_mismatch');
  if (assessment.classification === 'matched' && modelReasons.length) return finish({ classification: 'possible' }, modelReasons);
  if (assessment.classification === 'rejected' && !modelReasons.length) return finish({ classification: 'possible' }, ['model_decision_inconsistent']);
  return finish({}, assessment.classification === 'matched' ? ['model_match_retained'] : modelReasons);
}
