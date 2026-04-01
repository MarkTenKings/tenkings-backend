const test = require("node:test");
const assert = require("node:assert/strict");
const {
  annotateAndSortKingsreviewComps,
  buildKingsreviewCompMatchContext,
  fuzzyPlayerMatch,
  scoreKingsreviewComp,
} = require("../dist/kingsreviewCompMatch");

test("fuzzyPlayerMatch tolerates accents and minor last-name typos", () => {
  assert.equal(fuzzyPlayerMatch("Victor Wembanyama", "Victor Wembanyam"), true);
  assert.equal(fuzzyPlayerMatch("Luis Gonzalez", "Luis González"), true);
  assert.equal(fuzzyPlayerMatch("Victor Wembanyama", "Scoot Henderson"), false);
});

test("buildKingsreviewCompMatchContext infers base parallel and grading data from classification payloads", () => {
  const context = buildKingsreviewCompMatchContext({
    resolvedPlayerName: "Victor Wembanyama",
    classification: {
      attributes: {
        playerName: "Victor Wembanyama",
        teamName: "San Antonio Spurs",
        year: "2025",
        brand: "Topps",
        setName: "2025 Topps Chrome Basketball",
        variantKeywords: [],
        numbered: null,
        rookie: false,
        autograph: false,
        memorabilia: false,
        gradeCompany: "PSA",
        gradeValue: "10",
      },
      normalized: {
        setName: "2025 Topps Chrome Basketball",
        cardNumber: "DD-11",
        setCode: "The Daily Dribble",
        year: "2025",
        sport: {
          graded: true,
          gradeCompany: "PSA",
          grade: "10",
        },
      },
    },
  });

  assert.equal(context?.playerName, "Victor Wembanyama");
  assert.equal(context?.parallel, "Base");
  assert.equal(context?.insertSet, "The Daily Dribble");
  assert.equal(context?.graded, true);
  assert.equal(context?.gradingCompany, "PSA");
  assert.equal(context?.gradeScore, "10");
});

test("scoreKingsreviewComp demotes graded mismatch into close range", () => {
  const context = {
    playerName: "Victor Wembanyama",
    setName: "2025 Topps Chrome Basketball",
    cardNumber: "DD-11",
    year: "2025",
    parallel: "Gold Refractor",
    insertSet: "The Daily Dribble",
    autograph: false,
    memorabilia: false,
    numbered: "12/50",
    graded: false,
    gradingCompany: null,
    gradeScore: null,
  };

  const result = scoreKingsreviewComp(context, {
    title: "2025 Topps Chrome Victor Wembanyam DD-11 The Daily Dribble Gold Refractor /50 PSA 10",
    condition: "Graded",
    itemSpecifics: {
      set: ["2025 Topps Chrome Basketball"],
      "card number": ["DD-11"],
    },
  });

  assert.ok(result);
  assert.equal(result.matchQuality, "close");
  assert.ok(result.score >= 65 && result.score < 80);
  assert.ok(result.penalties.includes("graded"));
  assert.deepEqual(result.keyComparison.graded, {
    expected: "Raw",
    actual: "PSA 10",
    matched: false,
  });
});

test("scoreKingsreviewComp extracts serial denominator from card-name specifics", () => {
  const context = {
    playerName: "Victor Wembanyama",
    setName: "2025 Topps Chrome Basketball",
    cardNumber: "DD-11",
    year: "2025",
    parallel: "Gold Refractor",
    insertSet: null,
    autograph: false,
    memorabilia: false,
    numbered: "7/10",
    graded: false,
    gradingCompany: null,
    gradeScore: null,
  };

  const result = scoreKingsreviewComp(context, {
    title: "2025 Topps Chrome Victor Wembanyama DD-11 Gold Refractor",
    condition: "Ungraded",
    itemSpecifics: {
      "card name": ["The Daily Dribble Gold Refractor /10"],
    },
  });

  assert.ok(result);
  assert.ok(result.matchedFields.includes("serialDenominator"));
  assert.deepEqual(result.keyComparison.numbered, {
    expected: "/10",
    actual: "/10",
    matched: true,
  });
});

test("annotateAndSortKingsreviewComps ranks exact matches above graded mismatches and wrong parallels", () => {
  const context = {
    playerName: "Victor Wembanyama",
    setName: "2025 Topps Chrome Basketball",
    cardNumber: "DD-11",
    year: "2025",
    parallel: "Gold Refractor",
    insertSet: "The Daily Dribble",
    autograph: false,
    memorabilia: false,
    numbered: "12/50",
    graded: false,
    gradingCompany: null,
    gradeScore: null,
  };

  const ranked = annotateAndSortKingsreviewComps(context, [
    {
      title: "2025 Topps Chrome Victor Wembanyama DD-11 The Daily Dribble Silver Refractor /99",
      condition: "Ungraded",
      url: "https://example.com/weak",
    },
    {
      title: "2025 Topps Chrome Victor Wembanyama DD-11 The Daily Dribble Gold Refractor /50 PSA 10",
      condition: "Graded",
      itemSpecifics: {
        set: ["2025 Topps Chrome Basketball"],
        "card number": ["DD-11"],
      },
      url: "https://example.com/close",
    },
    {
      title: "2025 Topps Chrome Victor Wembanyam DD-11 The Daily Dribble Gold Refractor /50",
      condition: "Ungraded",
      url: "https://example.com/exact",
    },
  ]);

  assert.equal(ranked[0].url, "https://example.com/exact");
  assert.equal(ranked[0].matchQuality, "exact");
  assert.equal(ranked[1].url, "https://example.com/close");
  assert.equal(ranked[1].matchQuality, "close");
  assert.equal(ranked[2].url, "https://example.com/weak");
  assert.equal(ranked[2].matchQuality, "weak");
  assert.ok((ranked[0].matchScore ?? 0) > (ranked[1].matchScore ?? 0));
  assert.ok((ranked[1].matchScore ?? 0) > (ranked[2].matchScore ?? 0));
});
