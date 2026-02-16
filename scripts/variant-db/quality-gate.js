"use strict";

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9/+\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractYears(text) {
  const years = new Set();
  const source = String(text || "");
  const full = source.match(/\b(20\d{2})\b/g) || [];
  for (const y of full) years.add(y);
  const ranges = source.match(/\b(20\d{2})[-/](\d{2})\b/g) || [];
  for (const token of ranges) {
    const m = token.match(/\b(20\d{2})[-/](\d{2})\b/);
    if (!m) continue;
    years.add(m[1]);
    years.add(`20${m[2]}`);
  }
  return Array.from(years);
}

function extractDenominator(text) {
  const m = String(text || "").match(/\/\s*(\d{1,4})\b/);
  return m?.[1] ?? null;
}

function inferManufacturer(text) {
  const source = normalize(text);
  const checks = ["topps", "panini", "bowman", "upper deck", "leaf", "fleer", "donruss"];
  for (const name of checks) {
    if (source.includes(name)) return name;
  }
  return null;
}

function inferSport(text) {
  const source = normalize(text);
  if (source.includes("basketball") || source.includes("nba")) return "basketball";
  if (source.includes("football") || source.includes("nfl")) return "football";
  if (source.includes("baseball") || source.includes("mlb")) return "baseball";
  return null;
}

function tokenOverlap(a, b) {
  const aa = new Set(normalize(a).split(" ").filter((t) => t.length >= 3));
  const bb = new Set(normalize(b).split(" ").filter((t) => t.length >= 3));
  if (!aa.size || !bb.size) return 0;
  let hit = 0;
  for (const t of aa) if (bb.has(t)) hit += 1;
  return hit;
}

function gateStatus(score) {
  if (score >= 8) return "approved";
  if (score >= 6) return "weak";
  return "reject";
}

function scoreReferenceCandidate(input) {
  const setId = String(input?.setId || "");
  const parallelId = String(input?.parallelId || "");
  const keywords = Array.isArray(input?.keywords) ? input.keywords : [];
  const oddsInfo = String(input?.oddsInfo || "");
  const listingTitle = String(input?.listingTitle || "");
  const sourceUrl = String(input?.sourceUrl || "");
  const haystack = normalize(`${listingTitle} ${sourceUrl}`);

  const reasons = {
    parallelMatch: { matched: false, points: 0 },
    serialDenominatorMatch: { matched: false, points: 0 },
    setMatch: { matched: false, points: 0 },
    manufacturerMatch: { matched: false, points: 0 },
    yearMatch: { matched: false, points: 0 },
    sportMatch: { matched: false, points: 0 },
  };

  let score = 0;

  const parallelTokens = [parallelId, ...keywords].filter(Boolean).map(normalize);
  const hasParallel = parallelTokens.some((token) => token && haystack.includes(token));
  if (hasParallel) {
    reasons.parallelMatch = { matched: true, points: 2 };
    score += 2;
  }

  const targetDenominator = extractDenominator(`${parallelId} ${oddsInfo} ${keywords.join(" ")}`);
  const listingDenominator = extractDenominator(`${listingTitle} ${sourceUrl}`);
  if (targetDenominator && listingDenominator && targetDenominator === listingDenominator) {
    reasons.serialDenominatorMatch = { matched: true, points: 2 };
    score += 2;
  }

  const setOverlap = tokenOverlap(setId, `${listingTitle} ${sourceUrl}`);
  if (setOverlap >= 2) {
    reasons.setMatch = { matched: true, points: 2 };
    score += 2;
  }

  const targetManufacturer = inferManufacturer(`${setId} ${keywords.join(" ")}`);
  if (targetManufacturer && haystack.includes(targetManufacturer)) {
    reasons.manufacturerMatch = { matched: true, points: 1 };
    score += 1;
  }

  const years = extractYears(setId);
  if (years.some((y) => haystack.includes(y))) {
    reasons.yearMatch = { matched: true, points: 1 };
    score += 1;
  }

  const targetSport = inferSport(`${setId} ${keywords.join(" ")}`);
  if (targetSport && haystack.includes(targetSport)) {
    reasons.sportMatch = { matched: true, points: 1 };
    score += 1;
  }

  const hasUsefulMetadata = Boolean(normalize(listingTitle) || normalize(sourceUrl));
  if (!hasUsefulMetadata) {
    return {
      score: null,
      status: "unscored",
      reasons,
    };
  }

  return {
    score,
    status: gateStatus(score),
    reasons,
  };
}

module.exports = {
  scoreReferenceCandidate,
  extractDenominator,
};
