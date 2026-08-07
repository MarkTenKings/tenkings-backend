const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const {
  createCardFromSpeedster,
  generateCollectibleCardV2PublicToken,
  listSpeedsterCardBackfillCandidates,
  resyncIdentityFromSpeedster,
  voidCard,
} = require("../dist/database/src/cardPlatformV2");

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

test("V2 public card tokens use the permanent tk2c_ 192-bit URL-safe shape", () => {
  const tokens = new Set(Array.from({ length: 100 }, generateCollectibleCardV2PublicToken));
  assert.equal(tokens.size, 100);
  for (const token of tokens) assert.match(token, /^tk2c_[A-Za-z0-9_-]{32}$/);
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

test("backfill executable is zero-write by default and requires exact owner-approved IDs", () => {
  const source = readFileSync(join(__dirname, "../scripts/backfillCollectibleCardsV2.mjs"), "utf8");
  for (const required of [
    'apply: false',
    '--approved-session-id',
    'APPLY_APPROVED_TEN_KINGS_V2_CARD_BACKFILL',
    'if (!args.apply) return',
    'prisma.collectibleCardV2.findMany',
    'prisma.$transaction',
  ]) assert.equal(source.includes(required), true, `missing backfill safety contract: ${required}`);
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
