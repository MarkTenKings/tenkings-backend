import type { EbaySoldCompsV2SearchInput, EbaySoldCompsV2ParallelMatch } from "./index";

/** Only positively supported target facts belong here. Omission is unknown,
 * never English, unlimited, non-holo, unsigned, or unnumbered by default. */
export type EbaySoldCompsV2VariantIdentity = {
  language?: string | null;
  edition?: string | null;
  finish?: string | null;
  promo?: boolean | null;
  stamp?: string | null;
  serialDenominator?: number | null;
  autograph?: boolean | null;
  memorabilia?: boolean | null;
};

export type EbaySoldCompsV2VariantEvidence = {
  status: EbaySoldCompsV2ParallelMatch;
  reasonCodes: string[];
  observed: {
    language: string[];
    edition: string[];
    finish: string[];
    stamp: string[];
    serialDenominators: number[];
    autograph: boolean | null;
    memorabilia: boolean | null;
    promo: boolean | null;
    parallelSignals: string[];
  };
};

export type EbaySoldCompsV2GradeEvidence = {
  status: "RAW" | "GRADED" | "UNRESOLVED";
  designation: "STANDARD" | "BLACK_LABEL" | "PRISTINE" | "PERFECT" | null;
  groupKey: string;
  label: string;
  reasonCodes: string[];
};

type Normalize = (value: unknown) => string;
const unique = <T>(values: T[]) => [...new Set(values)];
const has = (text: string, phrase: string) => Boolean(phrase) && ` ${text} `.includes(` ${phrase} `);
const remove = (text: string, phrase: string) => phrase ? ` ${text} `.split(` ${phrase} `).join(" ").trim() : text;
const gradeAliases = (value: string) => value.replace(/[\u2010-\u2015\u2212]/g, "-")
  .replace(/professional sports authenticator/gi, "PSA").replace(/beckett grading services?/gi, "BGS")
  .replace(/sportscard guaranty(?: corporation)?/gi, "SGC").replace(/certified guaranty company/gi, "CGC");
const gradePattern = /\b(PSA|BGS|SGC|CGC)(?=\b|\d)[\s:-]*(?:(?:GEM|MINT|PRISTINE|PERFECT|BLACK|LABEL|NEAR|NM|MT|EX|EXCELLENT|VG|VERY|GOOD|FAIR|POOR)[\s-]*)*(10|[1-9])(?:\.([05]))?(?![\d.A-Za-z])/gi;
const graderMarker = /\b(?:PSA|BGS|SGC|CGC|CSG|HGA|GMA|AGS|TAG|BCCG|BVG|KSA|ISA|ACE|ARS|Beckett|graded|slab(?:bed)?)(?=\b|\d)/i;

/** Listing claims, not slab authentication or an ATLAS-to-other-grader mapping.
 * Repeated identical claims are permitted; mixed graders/grades, qualifications,
 * predictions, and an autograph-only grade remain unresolved. */
export function readEbaySoldCompsV2GradeEvidence(title: string, condition?: string | null): {
  grader: "PSA" | "BGS" | "SGC" | "CGC" | null;
  numericGrade: number | null;
  evidence: EbaySoldCompsV2GradeEvidence;
} {
  const text = gradeAliases(`${title} ${condition ?? ""}`);
  const unresolved = (reason: string) => ({ grader: null, numericGrade: null, evidence: {
    status: "UNRESOLVED" as const, designation: null, groupKey: "UNRESOLVED", label: "Grade unconfirmed", reasonCodes: [reason],
  } });
  if (!graderMarker.test(text)) return { grader: null, numericGrade: null, evidence: {
    status: "RAW", designation: null, groupKey: "RAW", label: "Raw", reasonCodes: ["LISTING_GRADE_UNMARKED"],
  } };
  const matches = [...text.matchAll(new RegExp(gradePattern))];
  if (!matches.length) return unresolved("LISTING_GRADE_UNRESOLVED");
  const markers = [...text.matchAll(/\b(?:PSA|BGS|SGC|CGC|CSG|HGA|GMA|AGS|TAG|BCCG|BVG|KSA|ISA|ACE|ARS)(?=\b|\d)/gi)];
  if (markers.length !== matches.length || /\b(?:raw|ungraded)\b/i.test(text)) return unresolved("LISTING_GRADE_AMBIGUOUS");
  if (matches.some(match => {
    const after = text.slice(match.index! + match[0].length), before = text.slice(Math.max(0, match.index! - 24), match.index);
    return /^(?:\s*(?:[/?+]|-(?:\s*\d)|(?:or|to|candidate|potential|quality|ready)\b|[,&]\s*(?:10|[1-9])(?:\.[05])?\b)|\s*\(?\s*(?:OC|MC|MK|ST|PD|OF)\b)/i.test(after)
      || /\b(?:not|like|possible|possibly|maybe|potential|could be|looks like)\s*$/i.test(before);
  })) return unresolved("LISTING_GRADE_QUALIFIED_OR_PREDICTED");
  const claims = matches.map(match => ({ grader: match[1].toUpperCase() as "PSA" | "BGS" | "SGC" | "CGC",
    numericGrade: Number(`${match[2]}${match[3] ? `.${match[3]}` : ""}`) }));
  const first = claims[0];
  if (claims.some(claim => claim.numericGrade > 10 || claim.grader !== first.grader || claim.numericGrade !== first.numericGrade)) {
    return unresolved("LISTING_GRADE_CONFLICT");
  }
  const blackLabel = /\bblack[ -]+label\b/i.test(text), pristine = /\bpristine\b/i.test(text), perfect = /\bperfect\b/i.test(text);
  if ((blackLabel && (first.grader !== "BGS" || first.numericGrade !== 10))
    || (pristine && (!["BGS", "CGC"].includes(first.grader) || first.numericGrade !== 10))
    || (perfect && (first.grader !== "CGC" || first.numericGrade !== 10))
    || (perfect && (pristine || blackLabel))) return unresolved("LISTING_GRADE_DESIGNATION_CONFLICT");
  const designation = blackLabel ? "BLACK_LABEL" : perfect ? "PERFECT" : pristine ? "PRISTINE"
    : first.numericGrade === 10 && (first.grader === "CGC" || first.grader === "BGS") && !/\bgem[ -]+mint\b/i.test(text) ? null : "STANDARD";
  const suffix = designation && designation !== "STANDARD" ? `_${designation}` : "";
  const labelSuffix = designation === "BLACK_LABEL" ? " Black Label" : designation === "PRISTINE" ? " Pristine" : designation === "PERFECT" ? " Perfect" : "";
  return { ...first, evidence: { status: "GRADED", designation, groupKey: `${first.grader}_${String(first.numericGrade).replace(".", "_")}${suffix}`,
    label: `${first.grader} ${first.numericGrade}${labelSuffix}`, reasonCodes: ["LISTING_GRADE_EXPLICIT"] } };
}

const languages: Array<[string, RegExp]> = [
  ["english", /\b(?:english|eng|en)\b/], ["japanese", /\b(?:japanese|jpn|jp)\b/],
  ["german", /\b(?:german|deutsch)\b/], ["french", /\b(?:french|francais)\b/],
  ["italian", /\b(?:italian|italiano)\b/], ["spanish", /\b(?:spanish|espanol)\b/],
  ["portuguese", /\b(?:portuguese|portugues)\b/], ["korean", /\b(?:korean|kor)\b/],
  ["traditional chinese", /\btraditional chinese\b/], ["simplified chinese", /\bsimplified chinese\b/],
  ["chinese", /\bchinese\b/], ["thai", /\bthai\b/], ["indonesian", /\bindonesian\b/],
];
const languageFacts = (text: string, pokemon = false) => {
  const found = languages.filter(([, re]) => re.test(text)).map(([name]) => name);
  // FR is an explicit listing-language abbreviation in Pokémon. Do not apply
  // the short token to sports inserts or player initials.
  if (pokemon && /\bfr\b/.test(text) && !found.includes("french")) found.push("french");
  return found.length > 1 && found.some(name => name.endsWith(" chinese")) ? found.filter(name => name !== "chinese") : found;
};
const finishText = (text: string) => text
  .replace(/\bpokeball\b/g, "poke ball").replace(/\bmasterball\b/g, "master ball")
  .replace(/\bgame\s*stop(?:\s+stamp(?:ed)?)?\b/g, "gamestop")
  .replace(/\bcosmo\b/g, "cosmos")
  .replace(/\b(?:nonholo(?:graphic|foil)?|non holo(?:graphic|foil)?|nonfoil|non foil|no holo|not holo)\b/g, "non holo")
  .replace(/\b(?:holographic|holofoil|foil)\b/g, "holo")
  // Keep a separator when "reverse" precedes a named pattern: otherwise
  // "Reverse Cosmos Holo" becomes "reverse holocosmos holo" and loses Cosmos.
  .replace(/\b(?:reverse|rev)\s+(?:holo\b)?/g, "reverse holo ")
  .replace(/\s+/g, " ").trim();
const finishFacts = (text: string) => {
  const found: string[] = [];
  let remaining = finishText(text);
  for (const phrase of ["non holo", "poke ball", "master ball", "reverse holo", "cosmos holo", "cosmic holo", "cracked ice holo", "galaxy holo", "holo"]) {
    if (has(remaining, phrase)) { found.push(phrase); remaining = remove(remaining, phrase); }
  }
  for (const [word, finish] of [["cosmos", "cosmos holo"], ["cosmic", "cosmic holo"], ["cracked ice", "cracked ice holo"], ["galaxy", "galaxy holo"]]) {
    if (has(remaining, word)) found.push(finish);
  }
  if (found.some(value => !["holo", "non holo"].includes(value))) {
    const plain = found.indexOf("holo"); if (plain >= 0) found.splice(plain, 1);
  }
  if (found.includes("poke ball") || found.includes("master ball")) {
    const genericReverse = found.indexOf("reverse holo"); if (genericReverse >= 0) found.splice(genericReverse, 1);
  }
  return unique(found);
};
const editionFacts = (text: string) => [
  /\b(?:1st|first|1) edition\b/.test(text) ? "first edition" : null,
  /\bunlimited\b/.test(text) ? "unlimited" : null,
  /\bshadowless\b/.test(text) ? "shadowless" : null,
].filter((value): value is string => value !== null);
const stampFacts = (text: string) => [
  /\b(?:unstamped|no stamp|non stamped)\b/.test(text) ? "none" : null,
  /\bpokemon center\b/.test(text) ? "pokemon center" : null,
  /\bgame\s*stop\b/.test(text) ? "gamestop" : null,
  /\b(?:prerelease|pre release)\b/.test(text) ? "prerelease" : null,
  /\bstaff\b/.test(text) ? "staff" : null,
  /\b(?:league|play pokemon)\s+stamp(?:ed)?\b/.test(text) ? "league" : null,
  /\b(?:20th|25th|30th) anniversary\s+stamp(?:ed)?\b/.exec(text)?.[0].replace(/\s+stamp(?:ed)?$/, "") ?? null,
].filter((value): value is string => value !== null);
const booleanFact = (text: string, positive: RegExp, negative: RegExp) => negative.test(text) ? false : positive.test(text) ? true : null;
const sportsSignals = /\b(?:aqua|atomic|black|blue|bronze|camo|checkerboard|cosmic|cracked ice|crystal|diamond|disco|elephant|emerald|fluorescent|galactic|genesis|gold|green|holo|hyper|lava|laser|magma|marble|mojo|nebula|negative|neon|nova|orange|photon|pink|platinum|prism|prizm|pulsar|purple|rainbow|red|refractor|ruby|sapphire|scope|sepia|shimmer|silver|snake|speckle|stellar|superfractor|teal|tiger|velocity|wave|white|xfractor|yellow)\b/g;
const colors = new Set("aqua black blue bronze emerald gold green orange pink platinum purple rainbow red ruby sapphire silver teal white yellow".split(" "));
const explicitBase = /^(?:base(?: card)?|none|regular|standard)$/;

function residualTitle(input: EbaySoldCompsV2SearchInput, title: string, normalize: Normalize) {
  let text = normalize(gradeAliases(title)).replace(/\b(?:black label|pristine|perfect)\b/g, " ");
  const set = normalize(input.productSet);
  const setWithoutPrefix = remove(remove(set, normalize(input.year)), normalize(input.manufacturer));
  const identities = [input.category === "SPORTS" ? input.playerName : input.cardName, input.productSet, has(text, set) ? "" : setWithoutPrefix,
    input.manufacturer, input.year, input.insert, input.cardNumber].map(normalize).filter(Boolean).sort((a, b) => b.length - a.length);
  for (const identity of identities) text = ` ${text} `.replace(` ${identity} `, " ").trim();
  text = text.replace(/\b(?:psa|bgs|sgc|cgc)\s*(?:(?:gem|mint|nm|mt)\s*)*(?:10|[1-9])(?:\s+(?:0|5))?\b/g, " ");
  if (input.category === "POKEMON") text = text.replace(/\bblack\s+(?:and\s+)?white\b/g, " ");
  else text = text.replace(/\b(?:red sox|white sox|blue jays|golden state|golden knights)\b/g, " ");
  return text.replace(/\s+/g, " ").trim();
}

/** Category-aware title evidence. Does not infer the target printing from a
 * character, set, rarity, card-number prefix, or lack of a visible reflection.
 * Identity anchors are independently checked by the existing research engine. */
export function matchEbaySoldCompsV2VariantEvidence(input: EbaySoldCompsV2SearchInput, title: string, normalize: Normalize): EbaySoldCompsV2VariantEvidence {
  const target = input.variantIdentity ?? {}, evidence = residualTitle(input, title, normalize);
  const expected = normalize(input.parallel), expectedText = finishText(expected);
  const expectedDetails = finishText([expected, normalize(input.insert)].join(" "));
  const titleDetails = finishText(evidence);
  // Collector denominators belong to Pokémon identity. Only sports serial
  // print-run denominators are compared as variant facts, never the copy numerator.
  const serialText = gradeAliases(title).replace(gradePattern, "").replace(/\b(?:cert|certificate|certification)\s*#?\s*\d+/gi, "");
  const serialDenominators = input.category === "SPORTS" ? unique([...serialText.matchAll(/\/\s*(\d{1,6})\b/g)].map(match => Number(match[1])).filter(value => value > 0)) : [];
  const expectedSerial = target.serialDenominator ?? (input.category === "SPORTS" ? Number(/\/\s*(\d{1,6})\b/.exec(input.parallel ?? "")?.[1]) || null : null);
  const actualSignals = input.category === "SPORTS" ? unique((titleDetails.replace(/\bnon holo\b/g, "").match(sportsSignals) ?? [])) : finishFacts(titleDetails);
  const flagEvidence = finishText([evidence, has(normalize(title), normalize(input.insert)) ? normalize(input.insert) : ""].join(" "));
  const observed = {
    language: languageFacts(evidence, input.category === "POKEMON"), edition: editionFacts(evidence), finish: finishFacts(evidence), stamp: stampFacts(evidence), serialDenominators,
    autograph: booleanFact(flagEvidence, /\b(?:auto|autographs?|autographed|signed|signatures?)\b/, /\b(?:non auto|non autograph|no auto|no autograph|unsigned|facsimile)\b/),
    memorabilia: booleanFact(flagEvidence, /\b(?:relics?|patch|memorabilia|jersey|swatch)\b/, /\b(?:non relic|no relic|non memorabilia|no memorabilia)\b/),
    promo: booleanFact(flagEvidence, /\bpromo(?:tional)?\b/, /\b(?:non promo|not promo)\b/), parallelSignals: actualSignals,
  };
  const reasons: string[] = [], unknown: string[] = [];
  const compare = (field: string, expectedValues: string[], actualValues: string[]) => {
    if (!expectedValues.length) { if (actualValues.length) unknown.push(`${field}_TARGET_UNRESOLVED`); return; }
    if (!actualValues.length) { unknown.push(`${field}_UNDISCLOSED`); return; }
    if (actualValues.some(value => !expectedValues.includes(value))) reasons.push(`${field}_MISMATCH`);
    else if (expectedValues.some(value => !actualValues.includes(value))) unknown.push(`${field}_INCOMPLETE`);
  };
  const namedLanguage = target.language ? languageFacts(normalize(target.language), input.category === "POKEMON") : [];
  const expectedLanguage = target.language ? namedLanguage.length ? namedLanguage : [normalize(target.language)] : languageFacts(expected, input.category === "POKEMON");
  if (!expectedLanguage.length) unknown.push("LANGUAGE_TARGET_UNRESOLVED");
  compare("LANGUAGE", expectedLanguage, observed.language);
  compare("EDITION", target.edition ? editionFacts(normalize(target.edition)).length ? editionFacts(normalize(target.edition)) : [normalize(target.edition)] : editionFacts(expected), observed.edition);
  const expectedFinish = target.finish ? finishFacts(normalize(target.finish)).length ? finishFacts(normalize(target.finish)) : [normalize(target.finish)] : finishFacts(expected);
  const genericFinish = expectedFinish.length === 1 && observed.finish.length === 1 && expectedFinish[0] !== observed.finish[0]
    && (observed.finish[0] === "holo" && expectedFinish[0] !== "non holo"
      || observed.finish[0] === "reverse holo" && ["poke ball", "master ball"].includes(expectedFinish[0])
      || expectedFinish[0] === "reverse holo" && ["poke ball", "master ball"].includes(observed.finish[0]));
  if (genericFinish) unknown.push("FINISH_INCOMPLETE"); else compare("FINISH", expectedFinish, observed.finish);
  compare("STAMP", target.stamp ? stampFacts(normalize(target.stamp)).length ? stampFacts(normalize(target.stamp)) : [normalize(target.stamp)] : stampFacts(expected), observed.stamp);
  compare("SERIAL_DENOMINATOR", expectedSerial ? [String(expectedSerial)] : [], observed.serialDenominators.map(String));
  for (const [field, actual, positive, negative] of [
    ["autograph", observed.autograph, /\b(?:auto|autographs?|autographed|signed|signatures?)\b/, /\b(?:non auto|non autograph|no auto|no autograph|unsigned)\b/],
    ["memorabilia", observed.memorabilia, /\b(?:relics?|patch|memorabilia|jersey|swatch)\b/, /\b(?:non relic|no relic|non memorabilia|no memorabilia)\b/],
    ["promo", observed.promo, /\bpromo(?:tional)?\b/, /\b(?:non promo|not promo)\b/],
  ] as const) {
    const wanted = target[field] ?? booleanFact(expectedDetails, positive, negative);
    if (wanted === null) { if (actual !== null) unknown.push(`${field.toUpperCase()}_TARGET_UNRESOLVED`); }
    else if (actual === null) unknown.push(`${field.toUpperCase()}_UNDISCLOSED`);
    else if (wanted !== actual) reasons.push(`${field.toUpperCase()}_MISMATCH`);
  }
  if (!expected) unknown.push("VARIANT_TARGET_UNRESOLVED");
  else if (explicitBase.test(expected)) {
    // "Base" is not a synonym for non-holo in Pokémon. Its finish is separate.
    if (input.category === "SPORTS" && actualSignals.length) reasons.push("PARALLEL_MISMATCH");
    else if (!/\b(?:base|regular|standard)\b/.test(evidence)) unknown.push("PARALLEL_UNDISCLOSED");
  } else {
    const expectedSignals = input.category === "SPORTS" ? unique((expectedText.replace(/\bnon holo\b/g, "").match(sportsSignals) ?? [])) : finishFacts(expectedText);
    if (input.category === "SPORTS") {
      const expectedColors = expectedSignals.filter(value => colors.has(value)), actualColors = actualSignals.filter(value => colors.has(value));
      if (expectedColors.length && actualColors.some(value => !expectedColors.includes(value))) reasons.push("PARALLEL_COLOR_MISMATCH");
      const expectedPatterns = expectedSignals.filter(value => !colors.has(value)), actualPatterns = actualSignals.filter(value => !colors.has(value));
      if (expectedPatterns.length && actualPatterns.some(value => !expectedPatterns.includes(value))) reasons.push("PARALLEL_PATTERN_MISMATCH");
      if ((!expectedColors.length && actualColors.length) || (!expectedPatterns.length && actualPatterns.length)) unknown.push("PARALLEL_EXTRA_FEATURE");
    }
    // A known arbitrary catalog label still needs its complete phrase; token
    // overlap cannot turn Red White Blue into Red or Reverse Holo into Holo.
    let comparableExpected = finishText(normalize((input.parallel ?? "").replace(/\b\d*\s*\/\s*\d+\b/g, "")));
    // Supported orthogonal dimensions are compared above, including aliases.
    // What remains is the named parallel, which still needs its complete phrase.
    for (const [, re] of languages) comparableExpected = comparableExpected.replace(new RegExp(re.source, "g"), " ");
    if (input.category === "POKEMON") comparableExpected = comparableExpected.replace(/\bfr\b/g, " ");
    comparableExpected = comparableExpected.replace(/\b(?:1st|first|1) edition\b|\bunlimited\b|\bshadowless\b/g, " ");
    for (const phrase of [...finishFacts(comparableExpected), ...stampFacts(comparableExpected)]) comparableExpected = remove(comparableExpected, phrase);
    comparableExpected = comparableExpected.replace(/\b(?:auto|autographs?|autographed|signed|signatures?|unsigned|non auto|non autograph|no auto|no autograph|relics?|patch|memorabilia|jersey|swatch|promo(?:tional)?)\b/g, " ").replace(/\s+/g, " ").trim();
    if (comparableExpected && !has(titleDetails, comparableExpected)) unknown.push("PARALLEL_UNCONFIRMED");
  }
  const reasonCodes = unique([...reasons, ...unknown]);
  return { status: reasons.length ? "CONTRADICTORY" : unknown.length ? "UNKNOWN" : "MATCH",
    reasonCodes: reasonCodes.length ? reasonCodes : ["VARIANT_TITLE_MATCH"], observed };
}
