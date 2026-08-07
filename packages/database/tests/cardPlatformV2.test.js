const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");

const {
  createCardFromSpeedster,
  createCardsFromSpeedster,
  generateCollectibleCardV2PublicToken,
  listSpeedsterCardBackfillCandidates,
  normalizeCompsSnapshotForWrite,
  saveCompsSnapshot,
  confirmMarketValue,
  setCompsPublic,
  markNfcVerified,
  resyncIdentityFromSpeedster,
  correctCompletedSpeedsterIdentity,
  verifySpeedsterCardMaterialization,
  verifySpeedsterCardMaterializations,
  voidCard,
} = require("../dist/database/src/cardPlatformV2");

const compsCandidate = (id, price, overrides = {}) => ({
  id,
  title: `Sold card ${id}`,
  listingUrl: `https://www.ebay.com/itm/${id}`,
  imageUrl: "https://i.ebayimg.com/images/g/example/s-l1600.jpg",
  soldPriceCents: price,
  soldDate: "2026-08-01",
  condition: "Graded",
  grader: "PSA",
  numericGrade: 9,
  raw: false,
  group: "PSA_TARGET",
  parallelMatch: "MATCH",
  matchScore: 90,
  matchReason: "identity match",
  included: true,
  ...overrides,
});

const compsSnapshot = (overrides = {}) => ({
  version: 1,
  source: "EBAY_SOLD",
  engineVersion: "ebay-sold-comps-v2.1.1",
  query: "1990 SkyBox Michael Jordan #41 PSA 9",
  retrievedAt: "2026-08-06T12:00:00.000Z",
  nextOffset: 30,
  hasMore: true,
  candidates: [
    compsCandidate("123456789001", 10000),
    compsCandidate("123456789002", 11000),
    compsCandidate("123456789003", 9000),
  ],
  selection: { includedCount: 999, averageSoldPriceCents: 1 },
  ...overrides,
});

const decimal = (value) => ({ toString: () => value });

function runtime(overrides = {}) {
  const session = {
    id: "speedster-session-0001",
    createdByUserId: "admin-1",
    cardProfile: "POKEMON",
    workflowState: "COMPLETED",
    ruleVersion: "speedster-v2",
    publicReportSlug: "speedster-speedster-session-0001",
    identity: {
      playerName: null,
      cardName: "Pikachu",
      year: "2024",
      manufacturer: null,
      productSet: "Scarlet & Violet",
      parallel: "Cosmos Holo",
      insert: null,
      cardNumber: "025",
    },
    ...overrides.session,
  };
  const label = {
    id: "label-1",
    source: "SPEEDSTER",
    sourceSessionId: session.id,
    certificateSequence: 643,
    certificateNumber: "TKH-000643",
    gradingFormulaVersion: "EQUAL_25",
    createdByUserId: "admin-label-completer",
    cardType: "POKEMON",
    playerName: null,
    cardName: "Pikachu",
    year: "2024",
    manufacturer: null,
    productSet: "Scarlet & Violet",
    parallel: "Cosmos Holo",
    insert: null,
    cardNumber: "025",
    centeringGrade: decimal("9.5"),
    cornersGrade: decimal("9.0"),
    edgesGrade: decimal("8.5"),
    surfaceGrade: decimal("9.0"),
    grade: decimal("9.0"),
    ...overrides.label,
  };
  const cards = [];
  const events = [];
  const tx = {
    aiGraderV2Session: {
      findUnique: async ({ where }) => where.id === session.id ? session : null,
    },
    humanGradeLabel: {
      findUnique: async ({ where }) => where.id === label.id ? label : null,
    },
    collectibleCardV2: {
      findUnique: async ({ where }) => {
        if (where.speedsterSessionId) return cards.find((card) => card.speedsterSessionId === where.speedsterSessionId) ?? null;
        if (where.humanGradeLabelId) return cards.find((card) => card.humanGradeLabelId === where.humanGradeLabelId) ?? null;
        if (where.publicToken) return cards.find((card) => card.publicToken === where.publicToken) ?? null;
        return null;
      },
      create: async ({ data }) => {
        const card = { id: "card-v2-1", ...data };
        cards.push(card);
        return card;
      },
    },
    cardOwnershipEventV2: {
      findUnique: async ({ where }) => {
        const key = where.referenceType_referenceId;
        return events.find((event) => event.referenceType === key.referenceType && event.referenceId === key.referenceId) ?? null;
      },
      create: async ({ data }) => {
        const event = {
          id: "ownership-event-1",
          pricePaidCents: null,
          tkdAmountCents: null,
          ...data,
        };
        events.push(event);
        return event;
      },
    },
  };
  return { tx, cards, events, session, label };
}

function batchRuntime() {
  const first = runtime();
  const secondSession = {
    ...first.session,
    id: "speedster-session-0002",
    publicReportSlug: "speedster-speedster-session-0002",
    identity: { ...first.session.identity, cardName: "Eevee", cardNumber: "133" },
  };
  const secondLabel = {
    ...first.label,
    id: "label-2",
    sourceSessionId: secondSession.id,
    certificateSequence: 644,
    certificateNumber: "TKH-000644",
    cardName: "Eevee",
    cardNumber: "133",
  };
  const sessions = [first.session, secondSession];
  const labels = [first.label, secondLabel];
  const cards = [];
  const events = [];
  const tx = {
    aiGraderV2Session: {
      async findMany({ where }) {
        return sessions.filter(({ id }) => where.id.in.includes(id));
      },
    },
    humanGradeLabel: {
      async findMany({ where }) {
        return labels.filter(({ id }) => where.id.in.includes(id));
      },
    },
    collectibleCardV2: {
      async findMany({ where }) {
        if (where.publicToken) {
          return cards.filter(({ publicToken }) => where.publicToken.in.includes(publicToken));
        }
        if (where.OR) {
          const sessionIds = where.OR[0].speedsterSessionId.in;
          const labelIds = where.OR[1].humanGradeLabelId.in;
          return cards.filter((card) =>
            sessionIds.includes(card.speedsterSessionId) || labelIds.includes(card.humanGradeLabelId));
        }
        if (where.speedsterSessionId) {
          return cards.filter(({ speedsterSessionId }) => where.speedsterSessionId.in.includes(speedsterSessionId));
        }
        return [];
      },
      async createMany({ data }) {
        data.forEach((row) => cards.push({ id: `card-v2-${cards.length + 1}`, ...row }));
        return { count: data.length };
      },
    },
    cardOwnershipEventV2: {
      async findMany({ where }) {
        if (where.referenceType) {
          return events.filter((event) =>
            event.referenceType === where.referenceType && where.referenceId.in.includes(event.referenceId));
        }
        return events.filter((event) =>
          where.cardId.in.includes(event.cardId) && event.reason === where.reason);
      },
      async createMany({ data }) {
        data.forEach((row) => events.push({
          id: `ownership-event-${events.length + 1}`,
          pricePaidCents: null,
          tkdAmountCents: null,
          ...row,
        }));
        return { count: data.length };
      },
    },
  };
  return {
    tx,
    sessions,
    labels,
    cards,
    events,
    bindings: sessions.map((session, index) => ({
      sessionId: session.id,
      humanGradeLabelId: labels[index].id,
    })),
  };
}

test("V2 public card tokens use the permanent tk2c_ 192-bit URL-safe shape", () => {
  const tokens = new Set(Array.from({ length: 100 }, generateCollectibleCardV2PublicToken));
  assert.equal(tokens.size, 100);
  for (const token of tokens) assert.match(token, /^tk2c_[A-Za-z0-9_-]{32}$/);
});

test("NFC verification is optional, token-bound, replay-safe, and writes only three informational facts", async () => {
  const token = `tk2c_${"A".repeat(32)}`;
  const transactionTime = new Date("2026-08-06T21:00:00.000Z");
  const locked = {
    id: "card-v2-1",
    publicToken: token,
    lifecycleState: "GRADED",
    nfcVerifiedAt: null,
    nfcVerifiedByAdminId: null,
    nfcVerifiedByWorkstationId: null,
    transactionTime,
  };
  const updates = [];
  const tx = {
    async $queryRaw() { return [locked]; },
    collectibleCardV2: {
      async update(input) {
        updates.push(input);
        return { ...locked, ...input.data };
      },
    },
  };
  const verification = {
    publicToken: token,
    jobIssuedAt: "2026-08-06T20:00:00.000Z",
    workstationKeyId: "f".repeat(64),
  };
  const result = await markNfcVerified(tx, locked.id, verification, "admin-1");
  assert.equal(result.outcome, "UPDATED");
  assert.deepEqual(updates[0].data, {
    nfcVerifiedAt: transactionTime,
    nfcVerifiedByAdminId: "admin-1",
    nfcVerifiedByWorkstationId: "f".repeat(64),
  });
  assert.equal("lifecycleState" in updates[0].data, false);

  locked.nfcVerifiedAt = transactionTime;
  locked.nfcVerifiedByAdminId = "admin-1";
  locked.nfcVerifiedByWorkstationId = "f".repeat(64);
  const replay = await markNfcVerified(tx, locked.id, verification, "admin-1");
  assert.equal(replay.outcome, "NOOP_REPLAY_OR_STALE");
  assert.equal(updates.length, 1);

  await assert.rejects(
    markNfcVerified(tx, locked.id, { ...verification, publicToken: `tk2c_${"B".repeat(32)}` }, "admin-1"),
    /no longer matches/,
  );
  locked.lifecycleState = "VOID";
  await assert.rejects(markNfcVerified(tx, locked.id, {
    ...verification,
    jobIssuedAt: "2026-08-06T22:00:00.000Z",
  }, "admin-1"), /not found/);
});

test("Speedster completion creates one permanent card and one immutable HOUSE creation event", async () => {
  const { tx, cards, events, session, label } = runtime();
  const first = await createCardFromSpeedster(tx, session.id, label.id);
  const retry = await createCardFromSpeedster(tx, session.id, label.id);

  assert.equal(first.id, retry.id);
  assert.match(first.publicToken, /^tk2c_[A-Za-z0-9_-]{32}$/);
  assert.equal(cards.length, 1);
  assert.equal(events.length, 1);
  assert.equal(cards[0].currentOwnerType, "HOUSE");
  assert.equal(cards[0].lifecycleState, "GRADED");
  assert.equal(cards[0].saleMode, "PACK");
  assert.equal(cards[0].nfcVerifiedAt, undefined);
  assert.equal(cards[0].compsSnapshot, undefined);
  assert.deepEqual(events[0], {
    id: "ownership-event-1",
    cardId: first.id,
    fromOwnerType: null,
    fromOwnerId: null,
    toOwnerType: "HOUSE",
    toOwnerId: null,
    reason: "GRADED_CREATED",
    referenceType: "SYSTEM_CREATION",
    referenceId: `speedster:${session.id}`,
    channel: "ADMIN",
    pricePaidCents: null,
    tkdAmountCents: null,
    actorAdminId: "admin-label-completer",
  });
  assert.equal(cards[0].createdByAdminId, "admin-label-completer");
});

test("materialization verifier proves exact card, immutable event, token, and one-row counts without writing", async () => {
  const { tx, cards, events, session, label } = runtime();
  await createCardFromSpeedster(tx, session.id, label.id);
  let writes = 0;
  tx.collectibleCardV2.count = async ({ where }) =>
    cards.filter((card) => card.speedsterSessionId === where.speedsterSessionId).length;
  tx.cardOwnershipEventV2.count = async ({ where }) =>
    events.filter((event) => event.cardId === where.cardId && event.reason === where.reason).length;
  const originalCardCreate = tx.collectibleCardV2.create;
  const originalEventCreate = tx.cardOwnershipEventV2.create;
  tx.collectibleCardV2.create = async (input) => { writes += 1; return originalCardCreate(input); };
  tx.cardOwnershipEventV2.create = async (input) => { writes += 1; return originalEventCreate(input); };

  const verified = await verifySpeedsterCardMaterialization(tx, session.id, label.id);
  assert.deepEqual(verified, {
    cardId: "card-v2-1",
    sessionId: session.id,
    humanGradeLabelId: label.id,
    certificateNumber: "TKH-000643",
    publicReportSlug: session.publicReportSlug,
    publicToken: cards[0].publicToken,
    publicPath: `/c/${cards[0].publicToken}`,
    lifecycleState: "GRADED",
    cardCount: 1,
    creationEventCount: 1,
  });
  assert.equal(writes, 0);

  cards[0].lifecycleState = "SHIPPED";
  assert.equal(
    (await verifySpeedsterCardMaterialization(tx, session.id, label.id)).lifecycleState,
    "SHIPPED",
  );
  cards[0].lifecycleState = "VOID";
  await assert.rejects(
    verifySpeedsterCardMaterialization(tx, session.id, label.id),
    /is VOID and has no public card page/,
  );
  cards[0].lifecycleState = "GRADED";
  tx.cardOwnershipEventV2.count = async () => 2;
  await assert.rejects(
    verifySpeedsterCardMaterialization(tx, session.id, label.id),
    /invalid card or creation-event count/,
  );
});

test("set-based materialization creates and replays exactly, then rejects drift, VOID, and duplicate creation events", async () => {
  const { tx, cards, events, bindings } = batchRuntime();
  const first = await createCardsFromSpeedster(tx, bindings);
  assert.equal(first.cards.length, 2);
  assert.equal(first.verified.length, 2);
  assert.equal(cards.length, 2);
  assert.equal(events.length, 2);
  const tokens = first.cards.map(({ publicToken }) => publicToken);

  const replay = await createCardsFromSpeedster(tx, bindings);
  assert.equal(cards.length, 2);
  assert.equal(events.length, 2);
  assert.deepEqual(replay.cards.map(({ publicToken }) => publicToken), tokens);
  assert.equal(replay.verified.every(({ cardCount, creationEventCount }) =>
    cardCount === 1 && creationEventCount === 1), true);
  assert.deepEqual(
    (await verifySpeedsterCardMaterializations(tx, bindings)).map(({ publicToken }) => publicToken),
    tokens,
  );

  events.push({
    ...events[0],
    id: "duplicate-graded-created",
    referenceType: "TEST_DUPLICATE",
    referenceId: "duplicate-graded-created",
  });
  await assert.rejects(
    verifySpeedsterCardMaterializations(tx, bindings),
    /invalid card or creation-event count/,
  );
  events.pop();

  cards[0].lifecycleState = "VOID";
  await assert.rejects(createCardsFromSpeedster(tx, bindings), /is VOID and has no public card page/);
  await assert.rejects(verifySpeedsterCardMaterializations(tx, bindings), /is VOID and has no public card page/);
  cards[0].lifecycleState = "GRADED";
  cards[0].productSet = "DRIFTED";
  await assert.rejects(
    createCardsFromSpeedster(tx, bindings),
    /conflicts with the completed Speedster identity/,
  );
  assert.equal(cards.length, 2);
  assert.equal(events.length, 2);
});

test("permanent card creation rejects a label identity that differs from Speedster", async () => {
  const { tx, session, label } = runtime({ label: { parallel: "Base" } });
  await assert.rejects(
    createCardFromSpeedster(tx, session.id, label.id),
    /does not match its Human Grade label/,
  );
});

test("completion retry fails closed if the permanent card identity drifted", async () => {
  const { tx, cards, session, label } = runtime();
  await createCardFromSpeedster(tx, session.id, label.id);
  cards[0].parallel = "Base";
  await assert.rejects(
    createCardFromSpeedster(tx, session.id, label.id),
    /conflicts with the completed Speedster identity/,
  );
});

test("completion retry fails closed if the immutable grade snapshot drifted", async () => {
  const { tx, cards, session, label } = runtime();
  await createCardFromSpeedster(tx, session.id, label.id);
  cards[0].gradeSnapshot = { ...cards[0].gradeSnapshot, finalGrade: "8.0" };
  await assert.rejects(
    createCardFromSpeedster(tx, session.id, label.id),
    /conflicts with the completed Speedster identity/,
  );
});

test("completion retry fails closed if immutable creation-event semantics drifted", async () => {
  const { tx, events, session, label } = runtime();
  await createCardFromSpeedster(tx, session.id, label.id);
  events[0].reason = "ADMIN_CORRECTION";
  await assert.rejects(
    createCardFromSpeedster(tx, session.id, label.id),
    /missing its immutable creation event/,
  );
});

test("category-invalid session and label identities are rejected even when they match", async () => {
  const sports = runtime({
    session: {
      cardProfile: "SPORTS",
      identity: {
        playerName: null,
        cardName: "Michael Jordan",
        year: "1997",
        manufacturer: "SkyBox",
        productSet: "Metal Universe",
        parallel: null,
        insert: null,
        cardNumber: "23",
      },
    },
    label: {
      cardType: "SPORTS",
      playerName: null,
      cardName: "Michael Jordan",
      year: "1997",
      manufacturer: "SkyBox",
      productSet: "Metal Universe",
      parallel: null,
      insert: null,
      cardNumber: "23",
    },
  });
  await assert.rejects(
    createCardFromSpeedster(sports.tx, sports.session.id, sports.label.id),
    /requires playerName and forbids cardName/,
  );

  const pokemon = runtime({
    session: {
      identity: {
        playerName: "Pikachu",
        cardName: null,
        year: "2024",
        manufacturer: null,
        productSet: "151",
        parallel: null,
        insert: null,
        cardNumber: null,
      },
    },
    label: {
      playerName: "Pikachu",
      cardName: null,
      year: "2024",
      manufacturer: null,
      productSet: "151",
      parallel: null,
      insert: null,
      cardNumber: null,
    },
  });
  await assert.rejects(
    createCardFromSpeedster(pokemon.tx, pokemon.session.id, pokemon.label.id),
    /requires cardName and forbids playerName/,
  );
});

test("historical-card dry run reports only completed unlinked sessions with exact Speedster labels", async () => {
  const candidates = await listSpeedsterCardBackfillCandidates({
    aiGraderV2Session: {
      async findMany(query) {
        assert.deepEqual(query.where, {
          workflowState: "COMPLETED",
          publicReportSlug: { not: null },
          collectibleCardV2: { is: null },
        });
        return [
          { id: "session-valid", publicReportSlug: "speedster-session-valid" },
          { id: "session-no-label", publicReportSlug: "speedster-session-no-label" },
        ];
      },
    },
    humanGradeLabel: {
      async findMany(query) {
        assert.deepEqual(query.where.sourceSessionId.in, ["session-valid", "session-no-label"]);
        return [{ id: "label-valid", sourceSessionId: "session-valid" }];
      },
    },
  });
  assert.deepEqual(candidates, [{
    sessionId: "session-valid",
    humanGradeLabelId: "label-valid",
    publicReportSlug: "speedster-session-valid",
  }]);
});

test("backfill executable is exact-27, zero-write by default, locked, transactional, and self-verifying", async () => {
  const source = readFileSync(join(__dirname, "../scripts/backfillCollectibleCardsV2.mjs"), "utf8");
  const databaseSource = readFileSync(join(__dirname, "../src/cardPlatformV2.ts"), "utf8");
  for (const required of [
    'apply: false',
    'APPLY_APPROVED_TEN_KINGS_V2_CARD_BACKFILL_EXACT_27',
    'if (!args.apply) return dryRun',
    'lockExactTargets',
    'TransactionIsolationLevel.Serializable',
    'createCardsFromSpeedster',
    'validateSpeedsterCardCreationSources',
    'verifySpeedsterCardMaterializations',
    'verifyIdempotentReplay',
    'legacyCounts',
    'may already be committed',
    'requiredAfterCommit: true',
    'performedByThisDatabaseScript: false',
    'publicPath',
    'TKH-000219 year 2019 vs TKH-000220/221 year 2021',
    'TKH-000226 card #036/195 vs TKH-000227 #035/195',
    'prisma.$transaction',
  ]) assert.equal(source.includes(required), true, `missing backfill safety contract: ${required}`);
  assert.equal(source.includes('--approved-session-id'), false);
  assert.equal(/createCardFromSpeedster\s*\(/.test(source), false);
  assert.equal(/validateSpeedsterCardCreationSource\s*\(/.test(source), false);
  assert.equal(/verifySpeedsterCardMaterialization\s*\(/.test(source), false);
  for (const required of [
    "createMany",
    "validateSpeedsterCardCreationSources",
    "verifySpeedsterCardMaterializations",
    "gradedCounts",
    'lifecycleState === "VOID"',
  ]) assert.equal(databaseSource.includes(required), true, `missing set-based card contract: ${required}`);

  const moduleUrl = pathToFileURL(join(__dirname, "../scripts/backfillCollectibleCardsV2.mjs")).href;
  const backfill = await import(moduleUrl);
  assert.equal(backfill.BACKFILL_TRANSACTION_TIMEOUT_MS, 600_000);
  const expected = [
    ["cmsanu8zn0000nw1oopkh0m2m", "TKH-000219"],
    ["cmsasqis10000117qzol1ly3a", "TKH-000220"],
    ["cmsaw2swp0000re4rbmgee3ym", "TKH-000221"],
    ["cmscq0ght000011tyoq07u2gc", "TKH-000226"],
    ["cmsdelcbq0000hgh9qmd5xyfl", "TKH-000227"],
    ["cmsdl8vwb00004yl0wft9cks5", "TKH-000228"],
    ["cmsduwr550000xdzsxn3ax6c9", "TKH-000229"],
    ["cmsf2e5b80000csqqnyvpw59s", "TKH-000230"],
    ["cmsf6xyr600009uceq8pvjlzz", "TKH-000231"],
    ["cmsf74wkc00008dvt5chy8ac8", "TKH-000232"],
    ["cmsf9l4g40004126faa2danrj", "TKH-000233"],
    ["cmshx9y64000ecbt295qd3v23", "TKH-000644"],
    ["cmshy2o940000141kri0kdu6k", "TKH-000645"],
    ["cmshyjuoz0016141kdkjqyspv", "TKH-000646"],
    ["cmsi1hppm0005hcv48xkzz3ix", "TKH-000655"],
    ["cmsi5j3y00003xonmngmtl96z", "TKH-000665"],
    ["cmsi67ubp000txonmr99wxbrr", "TKH-000670"],
    ["cmsi6qmpn001zxonmooq9rhbv", "TKH-000682"],
    ["cmsi92akd0000wf0pttvjo8os", "TKH-000692"],
    ["cmsi9p4wj0000pkzj8hx2ktro", "TKH-000693"],
    ["cmsi9tacr0006pkzj1vskuk6j", "TKH-000694"],
    ["cmsiaa5to0013pkzjqv1rfjgy", "TKH-000695"],
    ["cmsiajjru0006vcg05jmgy7hi", "TKH-000696"],
    ["cmsiatnrq000zvcg0cc0x3296", "TKH-000697"],
    ["cmsibaqq40028vcg0hsvzfhlg", "TKH-000698"],
    ["cmsibgsgm002yvcg0njplyzg3", "TKH-000699"],
    ["cmsic0c60003ivcg0o81sw44d", "TKH-000700"],
  ];
  assert.deepEqual(
    backfill.APPROVED_BACKFILL.map(({ sessionId, certificateNumber }) => [sessionId, certificateNumber]),
    expected,
  );
  assert.deepEqual(backfill.parseArgs([]), { apply: false, confirmation: null });
  assert.throws(
    () => backfill.parseArgs(["--apply", "--confirm", "wrong"]),
    /requires --confirm APPLY_APPROVED_TEN_KINGS_V2_CARD_BACKFILL_EXACT_27/,
  );
  assert.throws(
    () => backfill.parseArgs(["--approved-session-id", expected[0][0]]),
    /Unknown argument/,
  );
});

test("live validator is hard-bound to the exact disposable loopback database", () => {
  const source = readFileSync(join(__dirname, "../scripts/validateCardPlatformV2AgainstPostgres.mjs"), "utf8");
  for (const required of [
    'TEN_KINGS_V2_DISPOSABLE_VALIDATION',
    '127.0.0.1',
    'tenkings_ai_grader_nfc_validation',
    'TEN_KINGS_V2_EXPECTED_CARD_INSERT_FAILURE',
    'FOR UPDATE',
    'Promise.all([complete(), complete()])',
    'CardOwnershipEventV2 is append-only',
  ]) assert.equal(source.includes(required), true, `missing live-validator safety/evidence contract: ${required}`);
});

test("identity re-sync copies only the authoritative completed Speedster identity", async () => {
  const updates = [];
  const result = await resyncIdentityFromSpeedster({
    collectibleCardV2: {
      async findUnique() {
        return {
          id: "card-v2-1",
          speedsterSession: {
            cardProfile: "SPORTS",
            workflowState: "COMPLETED",
            identity: {
              playerName: "Michael Jordan",
              cardName: null,
              year: "1997",
              manufacturer: "SkyBox",
              productSet: "Metal Universe",
              parallel: "Precious Metal Gems Green",
              insert: null,
              cardNumber: "23",
            },
          },
        };
      },
      async update(input) { updates.push(input); return { id: input.where.id, ...input.data }; },
    },
  }, "card-v2-1", "admin-1");
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].data, {
    category: "SPORTS",
    playerName: "Michael Jordan",
    cardName: null,
    year: "1997",
    manufacturer: "SkyBox",
    productSet: "Metal Universe",
    parallel: "Precious Metal Gems Green",
    insert: null,
    cardNumber: "23",
  });
  assert.equal(result.publicToken, undefined);
});

test("identity re-sync rejects a category-invalid authoritative session", async () => {
  await assert.rejects(resyncIdentityFromSpeedster({
    collectibleCardV2: {
      async findUnique() {
        return {
          id: "card-v2-1",
          speedsterSession: {
            cardProfile: "SPORTS",
            workflowState: "COMPLETED",
            identity: { cardName: "Wrong field", year: "2024", productSet: "Set" },
          },
        };
      },
      async update() { throw new Error("must not update"); },
    },
  }, "card-v2-1", "admin-1"), /requires playerName and forbids cardName/);
});

test("completed identity correction updates the session, SPEEDSTER label, and linked card through one path", async () => {
  const sessionUpdates = [];
  const labelUpdates = [];
  const cardUpdates = [];
  const locks = [];
  const session = {
    id: "speedster-session-0001",
    cardProfile: "SPORTS",
    workflowState: "COMPLETED",
    identity: {
      playerName: "sheduer sanders",
      year: "2025",
      manufacturer: "Panini",
      productSet: "pheonix",
      parallel: "Silver",
      insert: null,
      cardNumber: "2",
    },
    collectibleCardV2: { id: "card-v2-1" },
  };
  const label = {
    id: "label-1",
    source: "SPEEDSTER",
    sourceSessionId: session.id,
    certificateNumber: "TKH-000696",
    cardType: "SPORTS",
    playerName: "Wrong direct label edit",
    cardName: null,
    year: "2025",
    manufacturer: "Panini",
    productSet: "PHOENIX",
    parallel: "Silver",
    insert: null,
    cardNumber: "2",
  };
  const card = {
    id: "card-v2-1",
    category: "SPORTS",
    playerName: "sheduer sanders",
    cardName: null,
    year: "2025",
    manufacturer: "Panini",
    productSet: "pheonix",
    parallel: "Silver",
    insert: null,
    cardNumber: "2",
    speedsterSession: {
      cardProfile: session.cardProfile,
      workflowState: session.workflowState,
      identity: session.identity,
    },
  };
  const tx = {
    async $queryRaw(strings) { locks.push(strings.join("?")); return [{ id: session.id }]; },
    aiGraderV2Session: {
      async findUnique() { return session; },
      async update(input) {
        sessionUpdates.push(input);
        session.identity = input.data.identity;
        card.speedsterSession.identity = session.identity;
        return session;
      },
    },
    humanGradeLabel: {
      async findUnique() { return label; },
      async update(input) { labelUpdates.push(input); Object.assign(label, input.data); return label; },
    },
    collectibleCardV2: {
      async findUnique() { return card; },
      async update(input) { cardUpdates.push(input); Object.assign(card, input.data); return card; },
    },
  };

  const result = await correctCompletedSpeedsterIdentity(tx, session.id, {
    playerName: "  SHEDEUR SANDERS  ",
    year: "2025",
    manufacturer: "Panini",
    productSet: " PHOENIX ",
    parallel: "Silver",
    insert: null,
    cardNumber: "2",
  }, "admin-1");

  assert.equal(result.certificateNumber, "TKH-000696");
  assert.equal(result.outcome, "UPDATED");
  assert.deepEqual(result.writes, { session: true, label: true, card: true });
  assert.equal(locks.length, 3);
  assert.match(locks[0], /AiGraderV2Session/);
  assert.match(locks[1], /HumanGradeLabel/);
  assert.match(locks[2], /CollectibleCardV2/);
  assert.deepEqual(sessionUpdates[0].data.identity, {
    playerName: "SHEDEUR SANDERS",
    year: "2025",
    manufacturer: "Panini",
    productSet: "PHOENIX",
    parallel: "Silver",
    insert: null,
    cardNumber: "2",
  });
  assert.deepEqual(labelUpdates[0].data, {
    cardType: "SPORTS",
    playerName: "SHEDEUR SANDERS",
    cardName: null,
    year: "2025",
    manufacturer: "Panini",
    productSet: "PHOENIX",
    parallel: "Silver",
    insert: null,
    cardNumber: "2",
  });
  assert.deepEqual(cardUpdates[0].data, {
    category: "SPORTS",
    playerName: "SHEDEUR SANDERS",
    cardName: null,
    year: "2025",
    manufacturer: "Panini",
    productSet: "PHOENIX",
    parallel: "Silver",
    insert: null,
    cardNumber: "2",
  });
});

test("completed identity correction rejects direct label authority and category-invalid identity", async () => {
  const session = {
    id: "speedster-session-0001",
    cardProfile: "POKEMON",
    workflowState: "COMPLETED",
    collectibleCardV2: null,
  };
  const writes = [];
  const tx = {
    async $queryRaw() { return [{ id: session.id }]; },
    aiGraderV2Session: {
      async findUnique() { return session; },
      async update(input) { writes.push(input); },
    },
    humanGradeLabel: {
      async findUnique() {
        return { id: "label-1", source: "HUMAN", sourceSessionId: session.id, certificateNumber: "TKH-000001" };
      },
      async update(input) { writes.push(input); },
    },
  };

  await assert.rejects(correctCompletedSpeedsterIdentity(tx, session.id, {
    cardName: "Pikachu",
    year: "2024",
    productSet: "151",
  }, "admin-1"), /exact issued label/);
  await assert.rejects(correctCompletedSpeedsterIdentity({
    ...tx,
    humanGradeLabel: {
      ...tx.humanGradeLabel,
      async findUnique() {
        return { id: "label-1", source: "SPEEDSTER", sourceSessionId: session.id, certificateNumber: "TKH-000001" };
      },
    },
  }, session.id, {
    playerName: "Wrong category field",
    cardName: "Pikachu",
    year: "2024",
    productSet: "151",
  }, "admin-1"), /requires cardName and forbids playerName/);
  assert.equal(writes.length, 0);
});

test("completed identity correction is an exact no-op after session, label, and card converge", async () => {
  const identity = {
    cardName: "PIKACHU V",
    year: "2022 POKEMON SWSH",
    manufacturer: null,
    productSet: "PIKACHU V BOX",
    parallel: "BSP",
    insert: null,
    cardNumber: "SWSH198",
  };
  const session = {
    id: "speedster-session-0001",
    cardProfile: "POKEMON",
    workflowState: "COMPLETED",
    identity,
    collectibleCardV2: { id: "card-v2-1" },
  };
  const writes = [];
  const tx = {
    async $queryRaw() { return [{ id: session.id }]; },
    aiGraderV2Session: {
      async findUnique() { return session; },
      async update(input) { writes.push(input); },
    },
    humanGradeLabel: {
      async findUnique() {
        return {
          id: "label-1",
          source: "SPEEDSTER",
          sourceSessionId: session.id,
          certificateNumber: "TKH-000457",
          cardType: "POKEMON",
          playerName: null,
          ...identity,
        };
      },
      async update(input) { writes.push(input); },
    },
    collectibleCardV2: {
      async findUnique() {
        return {
          id: "card-v2-1",
          category: "POKEMON",
          playerName: null,
          ...identity,
        };
      },
      async update(input) { writes.push(input); },
    },
  };
  const result = await correctCompletedSpeedsterIdentity(tx, session.id, identity, "admin-1");
  assert.equal(result.outcome, "NOOP");
  assert.deepEqual(result.writes, { session: false, label: false, card: false });
  assert.equal(writes.length, 0);
});

test("completed identity correction rejects unsupported keys and non-text fields before writing", async () => {
  const session = {
    id: "speedster-session-0001",
    cardProfile: "POKEMON",
    workflowState: "COMPLETED",
    identity: {},
    collectibleCardV2: null,
  };
  const writes = [];
  const tx = {
    async $queryRaw() { return [{ id: session.id }]; },
    aiGraderV2Session: {
      async findUnique() { return session; },
      async update(input) { writes.push(input); },
    },
  };
  await assert.rejects(correctCompletedSpeedsterIdentity(tx, session.id, {
    cardName: "Pikachu",
    year: "2024",
    productSet: "151",
    unsupportedField: "not allowed",
  }, "admin-1"), /unsupported fields: unsupportedField/);
  await assert.rejects(correctCompletedSpeedsterIdentity(tx, session.id, {
    cardName: "Pikachu",
    year: "2024",
    productSet: "151",
    cardType: "SPORTS",
  }, "admin-1"), /cardType does not match/);
  await assert.rejects(correctCompletedSpeedsterIdentity(tx, session.id, {
    cardName: "Pikachu",
    year: "2024",
    productSet: "151",
    parallel: 12,
  }, "admin-1"), /parallel must be text or null/);
  assert.equal(writes.length, 0);
});

test("approved identity executable pins every owner-approved certificate/session binding and safety gate", async () => {
  const moduleUrl = pathToFileURL(join(__dirname, "../scripts/correctApprovedSpeedsterIdentities.mjs")).href;
  const source = readFileSync(join(__dirname, "../scripts/correctApprovedSpeedsterIdentities.mjs"), "utf8");
  const operations = await import(moduleUrl);
  assert.deepEqual(
    operations.PHASE_A.map(({ sessionId, certificateNumber }) => [sessionId, certificateNumber]),
    [
      ["cmscq0ght000011tyoq07u2gc", "TKH-000226"],
      ["cmsdelcbq0000hgh9qmd5xyfl", "TKH-000227"],
      ["cmsf9l4g40004126faa2danrj", "TKH-000233"],
      ["cmsi92akd0000wf0pttvjo8os", "TKH-000692"],
      ["cmsi9p4wj0000pkzj8hx2ktro", "TKH-000693"],
      ["cmsiajjru0006vcg05jmgy7hi", "TKH-000696"],
      ["cmsibaqq40028vcg0hsvzfhlg", "TKH-000698"],
      ["cmsic0c60003ivcg0o81sw44d", "TKH-000700"],
    ],
  );
  assert.equal(operations.PHASE_A_WRITER_VALIDATION.length, 27);
  assert.equal(new Set(operations.PHASE_A_WRITER_VALIDATION.map(({ sessionId }) => sessionId)).size, 27);
  assert.deepEqual(
    operations.PHASE_A.find(({ sessionId }) => sessionId === "cmsiajjru0006vcg05jmgy7hi").allowedBefore,
    {
      playerName: ["sheduer sanders", "SHEDEUR SANDERS"],
      productSet: ["pheonix", "PHOENIX"],
    },
  );
  assert.deepEqual(operations.PHASE_A_LABEL_CONVERGENCE, [{
    sessionId: "cmsanu8zn0000nw1oopkh0m2m",
    certificateNumber: "TKH-000219",
    category: "SPORTS",
    allowedBefore: { year: ["2019"] },
    divergentLabelYear: "2021",
    divergentLabelUpdatedAt: "2026-08-07T17:37:12.782Z",
  }]);
  assert.deepEqual(operations.PHASE_A_OWNER_REVIEW_FLAGS, {
    nonblocking: true,
    flags: [
      "TKH-000219 year 2019 vs TKH-000220/221 year 2021",
      "TKH-000226 card #036/195 vs TKH-000227 #035/195",
    ],
  });
  assert.equal(operations.PHASE_A.length, 8);
  assert.equal(source.includes("labelOnlyConvergenceCount"), true);
  assert.equal(operations.CORRECTION_TRANSACTION_TIMEOUT_MS, 180_000);
  for (const required of [
    "jsonb_to_recordset",
    "applyLockedCorrectionsBatched",
    "auditSpeedsterCardCreationSources",
    "validateSpeedsterCardCreationSources",
  ]) assert.equal(source.includes(required), true, `missing set-based correction contract: ${required}`);
  assert.equal(/correctCompletedSpeedsterIdentity\s*\(/.test(source), false);
  assert.deepEqual(
    operations.PHASE_C.map(({ sessionId, certificateNumber }) => [sessionId, certificateNumber]),
    [
      ["cmsbljwvu00003ukrq95uzo69", "TKH-000222"],
      ["cmscaiief000411v4j4tyjkf4", "TKH-000223"],
      ["cmscebt1m0000accgrbn3etxz", "TKH-000224"],
      ["cmscem6960006accgpc69tgwp", "TKH-000225"],
      ["cmsgcozde0011b5szkktkx58r", "TKH-000457"],
    ],
  );
  assert.deepEqual(operations.parseArgs(["--phase", "A"]), {
    phase: "A", apply: false, confirmation: null, actorAdminId: null,
  });
  assert.throws(
    () => operations.parseArgs(["--phase", "A", "--apply", "--confirm", "wrong", "--actor-admin-id", "admin-1"]),
    /requires --confirm APPLY_OWNER_APPROVED_SPEEDSTER_IDENTITY_PHASE_A/,
  );
  assert.throws(
    () => operations.parseArgs(["--phase", "C", "--apply", "--confirm", operations.CONFIRMATIONS.C]),
    /requires --actor-admin-id/,
  );
  assert.match(source, /CAPTURED_COMMAND_OUTPUT_ONLY/);
  assert.match(source, /databaseAuditRecordCreated: false/);
  assert.match(source, /corrections may already be committed even though post-commit verification failed/);
  assert.match(source, /Do not assume rollback/);
  assert.match(source, /correction writer is idempotent/);
  assert.throws(
    () => operations.buildTarget({
      cardProfile: "POKEMON",
      identity: { cardName: "Cubone", year: "1999", productSet: "Jungle" },
    }, {
      sessionId: "session-1",
      replace: { unsupportedField: "value", cardName: "Pikachu", year: "2022", productSet: "Box" },
    }),
    /Unsupported identity fields: unsupportedField/,
  );
});

test("Phase A converges only the exact TKH-000219 label year while preserving its session", async () => {
  const moduleUrl = pathToFileURL(join(__dirname, "../scripts/correctApprovedSpeedsterIdentities.mjs")).href;
  const operations = await import(moduleUrl);
  const identity = {
    playerName: "NICK BOSA",
    year: "2019",
    manufacturer: "Panini",
    productSet: "OBSIDIAN",
    parallel: "ELECTRIC RED",
    insert: null,
    cardNumber: "90",
  };
  const label = {
    id: "label-219",
    source: "SPEEDSTER",
    sourceSessionId: "cmsanu8zn0000nw1oopkh0m2m",
    certificateNumber: "TKH-000219",
    updatedAt: new Date("2026-08-07T17:37:12.782Z"),
    cardType: "SPORTS",
    playerName: identity.playerName,
    cardName: null,
    year: "2021",
    manufacturer: identity.manufacturer,
    productSet: identity.productSet,
    parallel: identity.parallel,
    insert: identity.insert,
    cardNumber: identity.cardNumber,
  };
  const target = {
    instruction: operations.PHASE_A_LABEL_CONVERGENCE[0],
    row: {
      id: "cmsanu8zn0000nw1oopkh0m2m",
      cardProfile: "SPORTS",
      workflowState: "COMPLETED",
      identity,
      collectibleCardV2: null,
    },
    label,
    targetIdentity: identity,
  };
  let sessionWrites = 0;
  const labelUpdates = [];
  const tx = {
    aiGraderV2Session: {
      async update() { sessionWrites += 1; throw new Error("session must remain byte-for-byte unchanged"); },
    },
    humanGradeLabel: {
      async update(input) {
        labelUpdates.push(input);
        Object.assign(label, input.data);
        return label;
      },
    },
  };

  const result = await operations.convergeExactPhaseALabel(tx, target);
  assert.equal(result.outcome, "UPDATED");
  assert.equal(result.sessionIdentityUnchanged, true);
  assert.equal(result.sessionWrites, 0);
  assert.equal(result.labelWrites, 1);
  assert.equal(sessionWrites, 0);
  assert.equal(labelUpdates.length, 1);
  assert.equal(labelUpdates[0].data.year, "2019");
  assert.deepEqual(labelUpdates[0].data, {
    cardType: "SPORTS",
    playerName: identity.playerName,
    cardName: null,
    year: "2019",
    manufacturer: identity.manufacturer,
    productSet: identity.productSet,
    parallel: identity.parallel,
    insert: identity.insert,
    cardNumber: identity.cardNumber,
  });

  const replay = await operations.convergeExactPhaseALabel(tx, target);
  assert.equal(replay.outcome, "NOOP");
  assert.equal(labelUpdates.length, 1);
  assert.equal(sessionWrites, 0);

  label.year = "2022";
  await assert.rejects(
    operations.convergeExactPhaseALabel(tx, target),
    /beyond the exact approved TKH-000219 year divergence/,
  );
  label.year = "2021";
  label.updatedAt = new Date("2026-08-07T17:37:12.783Z");
  await assert.rejects(
    operations.convergeExactPhaseALabel(tx, target),
    /divergent label updatedAt was .* expected 2026-08-07T17:37:12.782Z/,
  );
  assert.equal(labelUpdates.length, 1);
  assert.equal(sessionWrites, 0);

  label.updatedAt = new Date("2026-08-07T17:37:12.782Z");
  let setBasedWrites = 0;
  tx.$executeRaw = async () => { setBasedWrites += 1; return 1; };
  const batched = await operations.applyLockedCorrectionsBatched(tx, [], [target]);
  assert.equal(setBasedWrites, 1);
  assert.deepEqual(batched.corrections, []);
  assert.equal(batched.labelOnlyConvergence[0].outcome, "UPDATED");
  assert.equal(batched.labelOnlyConvergence[0].sessionWrites, 0);
  assert.equal(sessionWrites, 0);
});

test("locked Phase A corrections use at most two set-based writes and enforce exact affected-row counts", async () => {
  const moduleUrl = pathToFileURL(join(__dirname, "../scripts/correctApprovedSpeedsterIdentities.mjs")).href;
  const operations = await import(moduleUrl);
  const before = {
    cardName: "articuna",
    year: "2022",
    manufacturer: null,
    productSet: "SWORD & SHEILD SOLVER TEMPEST",
    parallel: null,
    insert: null,
    cardNumber: "036/195",
  };
  const after = {
    ...before,
    cardName: "ARTICUNO",
    productSet: "SWORD & SHIELD SILVER TEMPEST",
  };
  const target = {
    instruction: operations.PHASE_A[0],
    row: {
      id: operations.PHASE_A[0].sessionId,
      cardProfile: "POKEMON",
      workflowState: "COMPLETED",
      identity: before,
      collectibleCardV2: null,
    },
    label: {
      id: "label-226",
      source: "SPEEDSTER",
      sourceSessionId: operations.PHASE_A[0].sessionId,
      certificateNumber: "TKH-000226",
      cardType: "POKEMON",
      playerName: null,
      cardName: before.cardName,
      year: before.year,
      manufacturer: before.manufacturer,
      productSet: before.productSet,
      parallel: before.parallel,
      insert: before.insert,
      cardNumber: before.cardNumber,
    },
    targetIdentity: after,
  };
  const writes = [];
  const tx = { async $executeRaw(statement) { writes.push(statement); return 1; } };
  const applied = await operations.applyLockedCorrectionsBatched(tx, [target], []);
  assert.equal(writes.length, 2);
  assert.equal(applied.corrections.length, 1);
  assert.deepEqual(applied.corrections[0].writes, { session: true, label: true, card: false });
  assert.equal(applied.labelOnlyConvergence.length, 0);

  let attempted = 0;
  await assert.rejects(
    operations.applyLockedCorrectionsBatched({
      async $executeRaw() { attempted += 1; return 0; },
    }, [target], []),
    /session update count changed unexpectedly/,
  );
  assert.equal(attempted, 1);
});

test("Phase C default mode runs an exact-five zero-write card-writer-equivalent validation", async () => {
  const moduleUrl = pathToFileURL(join(__dirname, "../scripts/correctApprovedSpeedsterIdentities.mjs")).href;
  const operations = await import(moduleUrl);
  const sessions = operations.PHASE_C.map(({ sessionId, certificateNumber }) => ({
    id: sessionId,
    cardProfile: "POKEMON",
    workflowState: "COMPLETED",
    ruleVersion: "speedster-v2",
    publicReportSlug: `speedster-${sessionId}`,
    identity: certificateNumber === "TKH-000457"
      ? {
        cardName: "PIKACHU V",
        year: "2022 POKEMON SWSH",
        manufacturer: null,
        productSet: "PIKACHU V BOX",
        parallel: "BSP",
        insert: null,
        cardNumber: "SWSH198",
      }
      : {
        cardName: `Pokemon ${certificateNumber}`,
        year: "2022",
        manufacturer: null,
        productSet: "Pokemon Set",
        parallel: null,
        insert: null,
        cardNumber: certificateNumber.slice(-3),
      },
    collectibleCardV2: null,
  }));
  const labels = sessions.map((session, index) => ({
    id: `label-${index}`,
    source: "SPEEDSTER",
    sourceSessionId: session.id,
    certificateSequence: 222 + index,
    certificateNumber: operations.PHASE_C[index].certificateNumber,
    gradingFormulaVersion: "EQUAL_25",
    createdByUserId: "admin-1",
    cardType: "POKEMON",
    playerName: null,
    cardName: session.identity.cardName,
    year: session.identity.year,
    manufacturer: session.identity.manufacturer,
    productSet: session.identity.productSet,
    parallel: session.identity.parallel,
    insert: session.identity.insert,
    cardNumber: session.identity.cardNumber,
    centeringGrade: decimal("9.0"),
    cornersGrade: decimal("9.0"),
    edgesGrade: decimal("9.0"),
    surfaceGrade: decimal("9.0"),
    grade: decimal("9.0"),
  }));
  let transactions = 0;
  const db = {
    aiGraderV2Session: {
      async findMany() { return sessions; },
      async findUnique({ where }) { return sessions.find(({ id }) => id === where.id) ?? null; },
    },
    humanGradeLabel: {
      async findMany() { return labels; },
      async findUnique({ where }) { return labels.find(({ id }) => id === where.id) ?? null; },
    },
    async $transaction() { transactions += 1; throw new Error("dry run must not open a write transaction"); },
  };
  const originalLog = console.log;
  console.log = () => {};
  try {
    const result = await operations.run({
      phase: "C",
      apply: false,
      confirmation: null,
      actorAdminId: null,
    }, db);
    assert.equal(result.rows.length, 5);
    assert.equal(result.writerEquivalentValidation.count, 5);
    assert.equal(result.writerEquivalentValidation.cleanCount, 5);
    assert.equal(result.writerEquivalentValidation.conflictCount, 0);
    assert.equal(transactions, 0);
  } finally {
    console.log = originalLog;
  }
});

test("voiding is idempotent, keeps the row, and requires an admin plus reason", async () => {
  let state = "GRADED";
  let updates = 0;
  const tx = {
    collectibleCardV2: {
      async findUnique() { return { id: "card-v2-1", lifecycleState: state }; },
      async update() { updates += 1; state = "VOID"; return { id: "card-v2-1", lifecycleState: state }; },
    },
  };
  assert.deepEqual(await voidCard(tx, "card-v2-1", "wrong physical card", "admin-1"), {
    id: "card-v2-1",
    lifecycleState: "VOID",
  });
  await voidCard(tx, "card-v2-1", "wrong physical card", "admin-1");
  assert.equal(updates, 1);
  await assert.rejects(voidCard(tx, "card-v2-1", "", "admin-1"), /Void reason is required/);
});

test("comps writer owns bounded normalization, discards unknown provider fields, and recomputes selected math", async () => {
  let stored = null;
  const tx = {
    collectibleCardV2: {
      async findUnique() { return { id: "card-v2-1", lifecycleState: "GRADED" }; },
      async update(input) { stored = input.data.compsSnapshot; return { id: input.where.id, compsSnapshot: stored, updatedAt: new Date() }; },
    },
  };
  const unsafe = compsSnapshot({
    provider: { shipping: "$999" },
    candidates: compsSnapshot().candidates.map((candidate) => ({ ...candidate, shipping: { raw: "$99" } })),
  });
  await saveCompsSnapshot(tx, "card-v2-1", unsafe, "admin-1");
  assert.equal(JSON.stringify(stored).toLowerCase().includes("shipping"), false);
  assert.deepEqual(stored.selection, {
    includedCandidateIds: ["123456789001", "123456789002", "123456789003"],
    includedCount: 3,
    averageSoldPriceCents: 10000,
    lowestSoldPriceCents: 9000,
    highestSoldPriceCents: 11000,
  });
});

test("comps writer rejects VOID cards, oversized snapshots, unsafe links, and included rows without a sold price", async () => {
  const mutable = (state = "GRADED") => ({
    collectibleCardV2: {
      async findUnique() { return { id: "card-v2-1", lifecycleState: state }; },
      async update() { throw new Error("must not update"); },
    },
  });
  await assert.rejects(saveCompsSnapshot(mutable("VOID"), "card-v2-1", compsSnapshot(), "admin-1"), /not found/);
  assert.throws(() => normalizeCompsSnapshotForWrite(compsSnapshot({ query: "x".repeat(300000) })), /bounded size/);
  assert.throws(() => normalizeCompsSnapshotForWrite(compsSnapshot({
    candidates: [compsCandidate("123456789001", 10000, { listingUrl: "https://evil.example/itm/123456789001" })],
  })), /candidate is invalid/);
  assert.throws(() => normalizeCompsSnapshotForWrite(compsSnapshot({
    candidates: [compsCandidate("123456789001", null)],
  })), /positive sold price/);
  assert.throws(() => normalizeCompsSnapshotForWrite(compsSnapshot({
    candidates: [compsCandidate("123456789001", 2_147_483_648)],
  })), /candidate is invalid/);
  const maxRows = Array.from({ length: 60 }, (_, index) => compsCandidate(String(123456780000 + index), 2_147_483_647));
  const maxSnapshot = normalizeCompsSnapshotForWrite(compsSnapshot({ candidates: maxRows }));
  assert.equal(maxSnapshot.selection.averageSoldPriceCents, 2_147_483_647);
  assert.equal(maxSnapshot.hasMore, false);
});

test("market-value and public-setting writers validate server-owned facts and remain unavailable for VOID cards", async () => {
  const updates = [];
  const tx = {
    collectibleCardV2: {
      async findUnique() { return { id: "card-v2-1", lifecycleState: "GRADED" }; },
      async update(input) { updates.push(input.data); return { id: input.where.id, ...input.data, updatedAt: new Date() }; },
    },
  };
  await confirmMarketValue(tx, "card-v2-1", 10000, "admin-1", new Date("2026-08-06T12:00:00.000Z"));
  await setCompsPublic(tx, "card-v2-1", true, "admin-1");
  assert.deepEqual(updates, [{
    marketValueCents: 10000,
    marketValueConfirmedAt: new Date("2026-08-06T12:00:00.000Z"),
    marketValueConfirmedByAdminId: "admin-1",
  }, { compsPublic: true }]);
  await assert.rejects(confirmMarketValue(tx, "card-v2-1", 0, "admin-1"), /positive PostgreSQL integer/);
  await assert.rejects(confirmMarketValue(tx, "card-v2-1", 2_147_483_648, "admin-1"), /positive PostgreSQL integer/);
});

test("admin-B fetch-more preserves admin-A confirmation provenance in snapshot and card facts", async () => {
  const state = {
    id: "card-v2-1",
    lifecycleState: "GRADED",
    compsSnapshot: null,
    marketValueCents: null,
    marketValueConfirmedAt: null,
    marketValueConfirmedByAdminId: null,
  };
  const tx = {
    collectibleCardV2: {
      async findUnique() { return { ...state }; },
      async update(input) { Object.assign(state, input.data); return { ...state, updatedAt: new Date() }; },
    },
  };
  const confirmedAt = new Date("2026-08-06T12:00:00.000Z");
  const confirmedSnapshot = compsSnapshot({ confirmation: {
    marketValueCents: 10000,
    confirmedAt: confirmedAt.toISOString(),
    confirmedByAdminId: "untrusted-client-value",
  } });
  await saveCompsSnapshot(tx, state.id, confirmedSnapshot, "admin-A", { confirmationMode: "CONFIRM" });
  await confirmMarketValue(tx, state.id, 10000, "admin-A", confirmedAt);
  await saveCompsSnapshot(tx, state.id, state.compsSnapshot, "admin-B");
  assert.equal(state.compsSnapshot.confirmation.confirmedByAdminId, "admin-A");
  assert.equal(state.marketValueConfirmedByAdminId, "admin-A");
  assert.equal(state.compsSnapshot.confirmation.confirmedAt, state.marketValueConfirmedAt.toISOString());
});

test("confirmation-mode snapshot save requires a nonempty selection and exact recomputed average", async () => {
  const tx = {
    collectibleCardV2: {
      async findUnique() { return { id: "card-v2-1", lifecycleState: "GRADED", marketValueCents: null, marketValueConfirmedAt: null, marketValueConfirmedByAdminId: null }; },
      async update(input) { return { id: input.where.id, ...input.data, updatedAt: new Date() }; },
    },
  };
  const confirmation = { marketValueCents: 9999, confirmedAt: "2026-08-06T12:00:00.000Z", confirmedByAdminId: "untrusted" };
  await assert.rejects(saveCompsSnapshot(tx, "card-v2-1", compsSnapshot({ confirmation }), "admin-A", { confirmationMode: "CONFIRM" }), /must equal/);
  await assert.rejects(saveCompsSnapshot(tx, "card-v2-1", compsSnapshot({
    candidates: compsSnapshot().candidates.map((row) => ({ ...row, included: false })),
    confirmation: { ...confirmation, marketValueCents: 10000 },
  }), "admin-A", { confirmationMode: "CONFIRM" }), /nonempty/);
  const accepted = await saveCompsSnapshot(tx, "card-v2-1", compsSnapshot({
    confirmation: { ...confirmation, marketValueCents: 10000 },
  }), "admin-A", { confirmationMode: "CONFIRM" });
  assert.equal(accepted.compsSnapshot.confirmation.marketValueCents, 10000);
  assert.equal(accepted.compsSnapshot.confirmation.confirmedByAdminId, "admin-A");
});

test("foundation migration contains only the approved two tables and permanent-card invariants", () => {
  const sql = readFileSync(join(
    __dirname,
    "../prisma/migrations/20260806120000_ten_kings_v2_card_foundation/migration.sql",
  ), "utf8");
  for (const required of [
    'CREATE TABLE "CollectibleCardV2"',
    'CREATE TABLE "CardOwnershipEventV2"',
    "^tk2c_[A-Za-z0-9_-]{32}$",
    "'VOID'",
    '"locationId" UUID',
    'UNIQUE INDEX "CardOwnershipEventV2_referenceType_referenceId_key"',
    'ON DELETE RESTRICT',
    'CONSTRAINT "CollectibleCardV2_category_identity_shape"',
    '"playerName" IS NOT NULL',
    '"cardName" IS NOT NULL',
    'CREATE TRIGGER "CardOwnershipEventV2_append_only"',
    'CardOwnershipEventV2 is append-only',
  ]) assert.equal(sql.includes(required), true, `missing migration contract: ${required}`);
  for (const forbidden of [
    '"IN_TRANSIT"',
    '"soldAt"',
    'PhysicalLinkV2',
    'CardMediaV2',
  ]) assert.equal(sql.includes(forbidden), false, `forbidden migration contract: ${forbidden}`);
});
