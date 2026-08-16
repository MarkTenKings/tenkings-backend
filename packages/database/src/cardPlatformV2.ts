import { randomBytes } from "crypto";

import { Prisma } from "@prisma/client";

const PUBLIC_TOKEN = /^tk2c_[A-Za-z0-9_-]{32}$/;
const TOKEN_ATTEMPTS = 8;

type CardPlatformV2Transaction = Prisma.TransactionClient;

type CardBackfillReadClient = Pick<
  Prisma.TransactionClient,
  "aiGraderV2Session" | "humanGradeLabel"
>;

type CardMaterializationReadClient = Pick<
  Prisma.TransactionClient,
  "aiGraderV2Session" | "humanGradeLabel" | "collectibleCardV2" | "cardOwnershipEventV2"
>;

type SpeedsterIdentity = {
  playerName: string | null;
  cardName: string | null;
  year: string;
  manufacturer: string | null;
  productSet: string;
  parallel: string | null;
  insert: string | null;
  cardNumber: string | null;
};

export type CompletedSpeedsterIdentityInput = {
  playerName?: string | null;
  cardName?: string | null;
  year: string;
  manufacturer?: string | null;
  productSet: string;
  parallel?: string | null;
  insert?: string | null;
  cardNumber?: string | null;
  layoutType?: "POKEMON" | "TRAINER" | "ENERGY" | null;
  cardType?: "SPORTS" | "POKEMON";
};

const SPEEDSTER_IDENTITY_KEYS = new Set([
  "playerName",
  "cardName",
  "year",
  "manufacturer",
  "productSet",
  "parallel",
  "insert",
  "cardNumber",
  "layoutType",
  "cardType",
]);

const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;

function speedsterIdentity(value: Prisma.JsonValue): SpeedsterIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Completed Speedster session has invalid identity data");
  }
  const identity = value as Record<string, unknown>;
  const year = text(identity.year);
  const productSet = text(identity.productSet);
  if (!year || !productSet) {
    throw new Error("Completed Speedster session is missing permanent card identity");
  }
  return {
    playerName: text(identity.playerName),
    cardName: text(identity.cardName),
    year,
    manufacturer: text(identity.manufacturer),
    productSet,
    parallel: text(identity.parallel),
    insert: text(identity.insert),
    cardNumber: text(identity.cardNumber),
  };
}

function assertCategoryIdentity(category: "SPORTS" | "POKEMON", identity: SpeedsterIdentity) {
  if (category === "SPORTS" && (!identity.playerName || identity.cardName)) {
    throw new Error("Sports V2 card identity requires playerName and forbids cardName");
  }
  if (category === "POKEMON" && (!identity.cardName || identity.playerName)) {
    throw new Error("Pokémon V2 card identity requires cardName and forbids playerName");
  }
}

function assertIdentityMatch(
  category: "SPORTS" | "POKEMON",
  identity: SpeedsterIdentity,
  label: {
    cardType: "SPORTS" | "POKEMON";
    playerName: string | null;
    cardName: string | null;
    year: string;
    manufacturer: string | null;
    productSet: string;
    parallel: string | null;
    insert: string | null;
    cardNumber: string | null;
  },
) {
  const labelIdentity: SpeedsterIdentity = {
    playerName: text(label.playerName),
    cardName: text(label.cardName),
    year: label.year.trim(),
    manufacturer: text(label.manufacturer),
    productSet: label.productSet.trim(),
    parallel: text(label.parallel),
    insert: text(label.insert),
    cardNumber: text(label.cardNumber),
  };
  if (label.cardType !== category || JSON.stringify(identity) !== JSON.stringify(labelIdentity)) {
    throw new Error("Speedster session identity does not match its Human Grade label");
  }
  assertCategoryIdentity(category, identity);
}

type GradeSnapshotLabel = {
  certificateSequence: number;
  certificateNumber: string;
  gradingFormulaVersion: string;
  centeringGrade: { toString(): string };
  cornersGrade: { toString(): string };
  edgesGrade: { toString(): string };
  surfaceGrade: { toString(): string };
  grade: { toString(): string };
};

const buildGradeSnapshot = (ruleVersion: string, label: GradeSnapshotLabel) => ({
  certificateSequence: label.certificateSequence,
  certificateNumber: label.certificateNumber,
  gradingFormulaVersion: label.gradingFormulaVersion,
  speedsterRuleVersion: ruleVersion,
  finalGrade: label.grade.toString(),
  subgrades: {
    centering: label.centeringGrade.toString(),
    corners: label.cornersGrade.toString(),
    edges: label.edgesGrade.toString(),
    surface: label.surfaceGrade.toString(),
  },
});

const speedsterSourceSessionSelect = {
  id: true,
  cardProfile: true,
  workflowState: true,
  ruleVersion: true,
  publicReportSlug: true,
  identity: true,
} satisfies Prisma.AiGraderV2SessionSelect;

const speedsterSourceLabelSelect = {
  id: true,
  source: true,
  sourceSessionId: true,
  certificateSequence: true,
  certificateNumber: true,
  gradingFormulaVersion: true,
  createdByUserId: true,
  cardType: true,
  playerName: true,
  cardName: true,
  year: true,
  manufacturer: true,
  productSet: true,
  parallel: true,
  insert: true,
  cardNumber: true,
  centeringGrade: true,
  cornersGrade: true,
  edgesGrade: true,
  surfaceGrade: true,
  grade: true,
} satisfies Prisma.HumanGradeLabelSelect;

type SpeedsterSourceSession = Prisma.AiGraderV2SessionGetPayload<{
  select: typeof speedsterSourceSessionSelect;
}>;
type SpeedsterSourceLabel = Prisma.HumanGradeLabelGetPayload<{
  select: typeof speedsterSourceLabelSelect;
}>;

export type SpeedsterCardCreationBinding = {
  sessionId: string;
  humanGradeLabelId: string;
};

function validateSpeedsterCardCreationSourceRows(
  session: SpeedsterSourceSession | null | undefined,
  label: SpeedsterSourceLabel | null | undefined,
) {
  if (!session || session.workflowState !== "COMPLETED" || !session.publicReportSlug) {
    throw new Error("A permanent V2 card requires a completed Speedster report");
  }
  if (session.cardProfile !== "SPORTS" && session.cardProfile !== "POKEMON") {
    throw new Error("Completed Speedster session has an unsupported card category");
  }
  if (
    !label ||
    label.source !== "SPEEDSTER" ||
    label.sourceSessionId !== session.id ||
    !label.certificateNumber
  ) {
    throw new Error("A permanent V2 card requires the exact completed Speedster label");
  }

  const identity = speedsterIdentity(session.identity);
  assertIdentityMatch(session.cardProfile, identity, label);
  const gradeSnapshot = buildGradeSnapshot(session.ruleVersion, {
    ...label,
    certificateNumber: label.certificateNumber,
  });
  return {
    session: {
      ...session,
      cardProfile: session.cardProfile,
      publicReportSlug: session.publicReportSlug,
    } as typeof session & {
      cardProfile: "SPORTS" | "POKEMON";
      publicReportSlug: string;
    },
    label,
    identity,
    gradeSnapshot: gradeSnapshot as Prisma.InputJsonValue,
  };
}

function assertExactSourceBindings(bindings: SpeedsterCardCreationBinding[]) {
  if (!Array.isArray(bindings) || !bindings.length) {
    throw new Error("Permanent V2 card source bindings are required");
  }
  const sessionIds = bindings.map(({ sessionId }) => sessionId);
  const labelIds = bindings.map(({ humanGradeLabelId }) => humanGradeLabelId);
  if (new Set(sessionIds).size !== sessionIds.length || new Set(labelIds).size !== labelIds.length) {
    throw new Error("Permanent V2 card source bindings must be one-to-one");
  }
}

async function loadSpeedsterCardCreationSourceRows(
  db: CardBackfillReadClient,
  bindings: SpeedsterCardCreationBinding[],
) {
  assertExactSourceBindings(bindings);
  const [sessions, labels] = await Promise.all([
    db.aiGraderV2Session.findMany({
      where: { id: { in: bindings.map(({ sessionId }) => sessionId) } },
      select: speedsterSourceSessionSelect,
    }),
    db.humanGradeLabel.findMany({
      where: { id: { in: bindings.map(({ humanGradeLabelId }) => humanGradeLabelId) } },
      select: speedsterSourceLabelSelect,
    }),
  ]);
  return {
    sessionsById: new Map(sessions.map((session) => [session.id, session])),
    labelsById: new Map(labels.map((label) => [label.id, label])),
  };
}

/**
 * Zero-write validation through the same source reader used by permanent-card
 * creation. Operations code uses this after session-authoritative corrections
 * so a dry run cannot accidentally substitute a weaker definition of clean.
 */
export async function validateSpeedsterCardCreationSource(
  db: CardBackfillReadClient,
  sessionId: string,
  humanGradeLabelId: string,
) {
  const session = await db.aiGraderV2Session.findUnique({
    where: { id: sessionId },
    select: speedsterSourceSessionSelect,
  });
  if (!session || session.workflowState !== "COMPLETED" || !session.publicReportSlug) {
    throw new Error("A permanent V2 card requires a completed Speedster report");
  }
  if (session.cardProfile !== "SPORTS" && session.cardProfile !== "POKEMON") {
    throw new Error("Completed Speedster session has an unsupported card category");
  }

  const label = await db.humanGradeLabel.findUnique({
    where: { id: humanGradeLabelId },
    select: speedsterSourceLabelSelect,
  });
  return validateSpeedsterCardCreationSourceRows(session, label);
}

/** The same writer source contract, loaded in two set-based reads. */
export async function validateSpeedsterCardCreationSources(
  db: CardBackfillReadClient,
  bindings: SpeedsterCardCreationBinding[],
) {
  const { sessionsById, labelsById } = await loadSpeedsterCardCreationSourceRows(db, bindings);
  return bindings.map(({ sessionId, humanGradeLabelId }) =>
    validateSpeedsterCardCreationSourceRows(
      sessionsById.get(sessionId),
      labelsById.get(humanGradeLabelId),
    ));
}

/** Zero-write per-binding audit with set-based reads and exact writer errors. */
export async function auditSpeedsterCardCreationSources(
  db: CardBackfillReadClient,
  bindings: SpeedsterCardCreationBinding[],
) {
  const { sessionsById, labelsById } = await loadSpeedsterCardCreationSourceRows(db, bindings);
  return bindings.map(({ sessionId, humanGradeLabelId }) => {
    try {
      return {
        sessionId,
        humanGradeLabelId,
        source: validateSpeedsterCardCreationSourceRows(
          sessionsById.get(sessionId),
          labelsById.get(humanGradeLabelId),
        ),
        error: null,
      };
    } catch (error) {
      return {
        sessionId,
        humanGradeLabelId,
        source: null,
        error: error instanceof Error ? error.message : "Unknown writer-equivalent validation failure",
      };
    }
  });
}

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

export function generateCollectibleCardV2PublicToken() {
  return `tk2c_${randomBytes(24).toString("base64url")}`;
}

export type SpeedsterCardBackfillCandidate = {
  sessionId: string;
  humanGradeLabelId: string;
  publicReportSlug: string;
};

export async function listSpeedsterCardBackfillCandidates(
  db: CardBackfillReadClient,
): Promise<SpeedsterCardBackfillCandidate[]> {
  const sessions = await db.aiGraderV2Session.findMany({
    where: {
      workflowState: "COMPLETED",
      publicReportSlug: { not: null },
      collectibleCardV2: { is: null },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      publicReportSlug: true,
    },
  });
  if (!sessions.length) return [];

  const labels = await db.humanGradeLabel.findMany({
    where: {
      source: "SPEEDSTER",
      sourceSessionId: { in: sessions.map(({ id }) => id) },
      certificateNumber: { not: null },
    },
    select: {
      id: true,
      sourceSessionId: true,
    },
  });
  const labelsBySession = new Map(
    labels.flatMap((label) => label.sourceSessionId ? [[label.sourceSessionId, label.id] as const] : []),
  );

  return sessions.flatMap((session) => {
    const humanGradeLabelId = labelsBySession.get(session.id);
    if (!humanGradeLabelId || !session.publicReportSlug) return [];
    return [{
      sessionId: session.id,
      humanGradeLabelId,
      publicReportSlug: session.publicReportSlug,
    }];
  });
}

async function uniquePublicToken(tx: CardPlatformV2Transaction) {
  for (let attempt = 0; attempt < TOKEN_ATTEMPTS; attempt += 1) {
    const publicToken = generateCollectibleCardV2PublicToken();
    if (!PUBLIC_TOKEN.test(publicToken)) {
      throw new Error("Generated Ten Kings V2 card token has an invalid shape");
    }
    const existing = await tx.collectibleCardV2.findUnique({
      where: { publicToken },
      select: { id: true },
    });
    if (!existing) return publicToken;
  }
  throw new Error("Could not allocate a unique Ten Kings V2 card token");
}

const cardSelection = {
  id: true,
  speedsterSessionId: true,
  humanGradeLabelId: true,
  publicReportSlug: true,
  publicToken: true,
  category: true,
  playerName: true,
  cardName: true,
  year: true,
  manufacturer: true,
  productSet: true,
  parallel: true,
  insert: true,
  cardNumber: true,
  gradeSnapshot: true,
  createdByAdminId: true,
  lifecycleState: true,
} satisfies Prisma.CollectibleCardV2Select;

function assertExistingCard(
  card: {
    speedsterSessionId: string;
    humanGradeLabelId: string;
    publicReportSlug: string;
    publicToken: string;
    category: "SPORTS" | "POKEMON";
    playerName: string | null;
    cardName: string | null;
    year: string;
    manufacturer: string | null;
    productSet: string;
    parallel: string | null;
    insert: string | null;
    cardNumber: string | null;
    gradeSnapshot: Prisma.JsonValue;
    createdByAdminId: string;
  },
  sessionId: string,
  labelId: string,
  publicReportSlug: string,
  category: "SPORTS" | "POKEMON",
  identity: SpeedsterIdentity,
  gradeSnapshot: Prisma.InputJsonValue,
  createdByAdminId: string,
) {
  const storedIdentity: SpeedsterIdentity = {
    playerName: card.playerName,
    cardName: card.cardName,
    year: card.year,
    manufacturer: card.manufacturer,
    productSet: card.productSet,
    parallel: card.parallel,
    insert: card.insert,
    cardNumber: card.cardNumber,
  };
  if (
    card.speedsterSessionId !== sessionId ||
    card.humanGradeLabelId !== labelId ||
    card.publicReportSlug !== publicReportSlug ||
    card.category !== category ||
    JSON.stringify(storedIdentity) !== JSON.stringify(identity) ||
    canonicalJson(card.gradeSnapshot) !== canonicalJson(gradeSnapshot) ||
    card.createdByAdminId !== createdByAdminId ||
    !PUBLIC_TOKEN.test(card.publicToken)
  ) {
    throw new Error("Existing Ten Kings V2 card conflicts with the completed Speedster identity");
  }
}

type CreationEventSnapshot = {
  cardId: string;
  fromOwnerType: "HOUSE" | "ACCOUNT" | "EXTERNAL" | null;
  fromOwnerId: string | null;
  toOwnerType: "HOUSE" | "ACCOUNT" | "EXTERNAL";
  toOwnerId: string | null;
  reason: "GRADED_CREATED" | "PACK_PURCHASE" | "DIRECT_PURCHASE" | "BUYBACK" | "ADMIN_CORRECTION";
  referenceType: string;
  referenceId: string;
  pricePaidCents: number | null;
  tkdAmountCents: number | null;
  channel: "ONLINE" | "KIOSK" | "STORE" | "ADMIN" | null;
  actorAdminId: string | null;
};

const creationEventSelection = {
  cardId: true,
  fromOwnerType: true,
  fromOwnerId: true,
  toOwnerType: true,
  toOwnerId: true,
  reason: true,
  referenceType: true,
  referenceId: true,
  pricePaidCents: true,
  tkdAmountCents: true,
  channel: true,
  actorAdminId: true,
} satisfies Prisma.CardOwnershipEventV2Select;

function assertCreationEvent(
  creationEvent: CreationEventSnapshot | null,
  cardId: string,
  sessionId: string,
  createdByAdminId: string,
) {
  if (
    !creationEvent ||
    creationEvent.cardId !== cardId ||
    creationEvent.fromOwnerType !== null ||
    creationEvent.fromOwnerId !== null ||
    creationEvent.toOwnerType !== "HOUSE" ||
    creationEvent.toOwnerId !== null ||
    creationEvent.reason !== "GRADED_CREATED" ||
    creationEvent.referenceType !== "SYSTEM_CREATION" ||
    creationEvent.referenceId !== `speedster:${sessionId}` ||
    creationEvent.pricePaidCents !== null ||
    creationEvent.tkdAmountCents !== null ||
    creationEvent.channel !== "ADMIN" ||
    creationEvent.actorAdminId !== createdByAdminId
  ) {
    throw new Error("Existing Ten Kings V2 card is missing its immutable creation event");
  }
}

/** Read-only exact postcondition/idempotency verification for one Speedster card. */
export async function verifySpeedsterCardMaterialization(
  db: CardMaterializationReadClient,
  sessionId: string,
  humanGradeLabelId: string,
) {
  const { session, label, identity, gradeSnapshot } =
    await validateSpeedsterCardCreationSource(db, sessionId, humanGradeLabelId);
  const card = await db.collectibleCardV2.findUnique({
    where: { speedsterSessionId: session.id },
    select: cardSelection,
  });
  if (!card) throw new Error("Ten Kings V2 card materialization is missing");
  if (card.lifecycleState === "VOID") {
    throw new Error("Ten Kings V2 card materialization is VOID and has no public card page");
  }
  assertExistingCard(
    card,
    session.id,
    label.id,
    session.publicReportSlug,
    session.cardProfile,
    identity,
    gradeSnapshot,
    label.createdByUserId,
  );
  const creationEvent = await db.cardOwnershipEventV2.findUnique({
    where: {
      referenceType_referenceId: {
        referenceType: "SYSTEM_CREATION",
        referenceId: `speedster:${session.id}`,
      },
    },
    select: creationEventSelection,
  });
  assertCreationEvent(creationEvent, card.id, session.id, label.createdByUserId);
  const [cardCount, creationEventCount] = await Promise.all([
    db.collectibleCardV2.count({ where: { speedsterSessionId: session.id } }),
    db.cardOwnershipEventV2.count({
      where: { cardId: card.id, reason: "GRADED_CREATED" },
    }),
  ]);
  if (cardCount !== 1 || creationEventCount !== 1) {
    throw new Error("Ten Kings V2 card materialization has an invalid card or creation-event count");
  }
  return {
    cardId: card.id,
    sessionId: session.id,
    humanGradeLabelId: label.id,
    certificateNumber: label.certificateNumber,
    publicReportSlug: card.publicReportSlug,
    publicToken: card.publicToken,
    publicPath: `/c/${card.publicToken}`,
    lifecycleState: card.lifecycleState,
    cardCount,
    creationEventCount,
  };
}

/** Set-based exact postcondition verification for a bounded Speedster batch. */
export async function verifySpeedsterCardMaterializations(
  db: CardMaterializationReadClient,
  bindings: SpeedsterCardCreationBinding[],
) {
  const sources = await validateSpeedsterCardCreationSources(db, bindings);
  const sessionIds = sources.map(({ session }) => session.id);
  const cards = await db.collectibleCardV2.findMany({
    where: { speedsterSessionId: { in: sessionIds } },
    select: cardSelection,
  });
  if (cards.length !== bindings.length) {
    throw new Error("Ten Kings V2 batch materialization does not contain exactly one card per session");
  }
  const cardsBySession = new Map(cards.map((card) => [card.speedsterSessionId, card]));
  const cardIds = cards.map(({ id }) => id);
  const [creationEvents, gradedCreationEvents] = await Promise.all([
    db.cardOwnershipEventV2.findMany({
      where: {
        referenceType: "SYSTEM_CREATION",
        referenceId: { in: sessionIds.map((id) => `speedster:${id}`) },
      },
      select: creationEventSelection,
    }),
    db.cardOwnershipEventV2.findMany({
      where: { cardId: { in: cardIds }, reason: "GRADED_CREATED" },
      select: { cardId: true },
    }),
  ]);
  const eventsByReference = new Map(creationEvents.map((event) => [event.referenceId, event]));
  const gradedCounts = new Map<string, number>();
  for (const event of gradedCreationEvents) {
    gradedCounts.set(event.cardId, (gradedCounts.get(event.cardId) ?? 0) + 1);
  }
  return sources.map(({ session, label, identity, gradeSnapshot }) => {
    const card = cardsBySession.get(session.id);
    if (!card) throw new Error(`Ten Kings V2 card materialization is missing for ${session.id}`);
    if (card.lifecycleState === "VOID") {
      throw new Error("Ten Kings V2 card materialization is VOID and has no public card page");
    }
    assertExistingCard(
      card,
      session.id,
      label.id,
      session.publicReportSlug,
      session.cardProfile,
      identity,
      gradeSnapshot,
      label.createdByUserId,
    );
    assertCreationEvent(
      eventsByReference.get(`speedster:${session.id}`) ?? null,
      card.id,
      session.id,
      label.createdByUserId,
    );
    if ((gradedCounts.get(card.id) ?? 0) !== 1) {
      throw new Error("Ten Kings V2 card materialization has an invalid card or creation-event count");
    }
    return {
      cardId: card.id,
      sessionId: session.id,
      humanGradeLabelId: label.id,
      certificateNumber: label.certificateNumber,
      publicReportSlug: card.publicReportSlug,
      publicToken: card.publicToken,
      publicPath: `/c/${card.publicToken}`,
      lifecycleState: card.lifecycleState,
      cardCount: 1,
      creationEventCount: 1,
    };
  });
}

export async function createCardFromSpeedster(
  tx: CardPlatformV2Transaction,
  sessionId: string,
  humanGradeLabelId: string,
) {
  const source = await validateSpeedsterCardCreationSource(tx, sessionId, humanGradeLabelId);
  const { session, label, identity, gradeSnapshot } = source;

  const existingBySession = await tx.collectibleCardV2.findUnique({
    where: { speedsterSessionId: session.id },
    select: cardSelection,
  });
  if (existingBySession) {
    assertExistingCard(
      existingBySession,
      session.id,
      label.id,
      session.publicReportSlug,
      session.cardProfile,
      identity,
      gradeSnapshot,
      label.createdByUserId,
    );
    const creationEvent = await tx.cardOwnershipEventV2.findUnique({
      where: {
        referenceType_referenceId: {
          referenceType: "SYSTEM_CREATION",
          referenceId: `speedster:${session.id}`,
        },
      },
      select: creationEventSelection,
    });
    assertCreationEvent(creationEvent, existingBySession.id, session.id, label.createdByUserId);
    return existingBySession;
  }

  const conflictingLabel = await tx.collectibleCardV2.findUnique({
    where: { humanGradeLabelId: label.id },
    select: cardSelection,
  });
  if (conflictingLabel) {
    throw new Error("Human Grade label is already linked to a different Ten Kings V2 card");
  }

  const publicToken = await uniquePublicToken(tx);
  const card = await tx.collectibleCardV2.create({
    data: {
      speedsterSessionId: session.id,
      humanGradeLabelId: label.id,
      publicReportSlug: session.publicReportSlug,
      publicToken,
      category: session.cardProfile,
      ...identity,
      gradeSnapshot,
      currentOwnerType: "HOUSE",
      currentOwnerId: null,
      saleMode: "PACK",
      lifecycleState: "GRADED",
      createdByAdminId: label.createdByUserId,
    },
    select: cardSelection,
  });

  await tx.cardOwnershipEventV2.create({
    data: {
      cardId: card.id,
      fromOwnerType: null,
      fromOwnerId: null,
      toOwnerType: "HOUSE",
      toOwnerId: null,
      reason: "GRADED_CREATED",
      referenceType: "SYSTEM_CREATION",
      referenceId: `speedster:${session.id}`,
      channel: "ADMIN",
      actorAdminId: label.createdByUserId,
    },
  });

  return card;
}

async function uniquePublicTokens(tx: CardPlatformV2Transaction, count: number) {
  if (count === 0) return [];
  for (let attempt = 0; attempt < TOKEN_ATTEMPTS; attempt += 1) {
    const tokens = Array.from({ length: count }, () => generateCollectibleCardV2PublicToken());
    if (new Set(tokens).size !== tokens.length || tokens.some((token) => !PUBLIC_TOKEN.test(token))) {
      continue;
    }
    const existing = await tx.collectibleCardV2.findMany({
      where: { publicToken: { in: tokens } },
      select: { publicToken: true },
    });
    if (!existing.length) return tokens;
  }
  throw new Error("Could not allocate unique Ten Kings V2 card tokens for the exact batch");
}

/**
 * Set-based form of the same idempotent writer for a bounded, already locked
 * historical batch. Source validation, existing-card checks, inserts, and
 * immutable creation-event checks use a constant number of database reads.
 */
export async function createCardsFromSpeedster(
  tx: CardPlatformV2Transaction,
  bindings: SpeedsterCardCreationBinding[],
) {
  const sources = await validateSpeedsterCardCreationSources(tx, bindings);
  const sessionIds = sources.map(({ session }) => session.id);
  const labelIds = sources.map(({ label }) => label.id);
  const existing = await tx.collectibleCardV2.findMany({
    where: {
      OR: [
        { speedsterSessionId: { in: sessionIds } },
        { humanGradeLabelId: { in: labelIds } },
      ],
    },
    select: cardSelection,
  });
  const sourcesBySession = new Map(sources.map((source) => [source.session.id, source]));
  for (const card of existing) {
    if (card.lifecycleState === "VOID") {
      throw new Error("Ten Kings V2 card materialization is VOID and has no public card page");
    }
    const source = sourcesBySession.get(card.speedsterSessionId);
    if (!source) {
      throw new Error("Human Grade label is already linked to a different Ten Kings V2 card");
    }
    assertExistingCard(
      card,
      source.session.id,
      source.label.id,
      source.session.publicReportSlug,
      source.session.cardProfile,
      source.identity,
      source.gradeSnapshot,
      source.label.createdByUserId,
    );
  }
  const existingSessions = new Set(existing.map(({ speedsterSessionId }) => speedsterSessionId));
  const missing = sources.filter(({ session }) => !existingSessions.has(session.id));
  const tokens = await uniquePublicTokens(tx, missing.length);
  if (missing.length) {
    const inserted = await tx.collectibleCardV2.createMany({
      data: missing.map(({ session, label, identity, gradeSnapshot }, index) => ({
        speedsterSessionId: session.id,
        humanGradeLabelId: label.id,
        publicReportSlug: session.publicReportSlug,
        publicToken: tokens[index],
        category: session.cardProfile,
        ...identity,
        gradeSnapshot,
        currentOwnerType: "HOUSE",
        currentOwnerId: null,
        saleMode: "PACK",
        lifecycleState: "GRADED",
        createdByAdminId: label.createdByUserId,
      })),
    });
    if (inserted.count !== missing.length) {
      throw new Error("Exact Speedster batch card insert count changed unexpectedly");
    }
  }
  const cards = await tx.collectibleCardV2.findMany({
    where: { speedsterSessionId: { in: sessionIds } },
    select: cardSelection,
  });
  if (cards.length !== bindings.length) {
    throw new Error("Exact Speedster batch does not have one permanent card per session");
  }
  const cardsBySession = new Map(cards.map((card) => [card.speedsterSessionId, card]));
  if (missing.length) {
    const insertedEvents = await tx.cardOwnershipEventV2.createMany({
      data: missing.map(({ session, label }) => {
        const card = cardsBySession.get(session.id);
        if (!card) throw new Error(`Created card disappeared for ${session.id}`);
        return {
          cardId: card.id,
          fromOwnerType: null,
          fromOwnerId: null,
          toOwnerType: "HOUSE",
          toOwnerId: null,
          reason: "GRADED_CREATED",
          referenceType: "SYSTEM_CREATION",
          referenceId: `speedster:${session.id}`,
          channel: "ADMIN",
          actorAdminId: label.createdByUserId,
        };
      }),
    });
    if (insertedEvents.count !== missing.length) {
      throw new Error("Exact Speedster batch creation-event insert count changed unexpectedly");
    }
  }
  const [creationEvents, gradedCreationEvents] = await Promise.all([
    tx.cardOwnershipEventV2.findMany({
      where: {
        referenceType: "SYSTEM_CREATION",
        referenceId: { in: sessionIds.map((id) => `speedster:${id}`) },
      },
      select: creationEventSelection,
    }),
    tx.cardOwnershipEventV2.findMany({
      where: { cardId: { in: cards.map(({ id }) => id) }, reason: "GRADED_CREATED" },
      select: { cardId: true },
    }),
  ]);
  const eventsByReference = new Map(creationEvents.map((event) => [event.referenceId, event]));
  const gradedCounts = new Map<string, number>();
  for (const event of gradedCreationEvents) {
    gradedCounts.set(event.cardId, (gradedCounts.get(event.cardId) ?? 0) + 1);
  }
  const orderedCards: typeof cards = [];
  const verified = sources.map((source) => {
    const card = cardsBySession.get(source.session.id);
    if (!card) throw new Error(`Exact Speedster card is missing for ${source.session.id}`);
    if (card.lifecycleState === "VOID") {
      throw new Error("Ten Kings V2 card materialization is VOID and has no public card page");
    }
    assertExistingCard(
      card,
      source.session.id,
      source.label.id,
      source.session.publicReportSlug,
      source.session.cardProfile,
      source.identity,
      source.gradeSnapshot,
      source.label.createdByUserId,
    );
    assertCreationEvent(
      eventsByReference.get(`speedster:${source.session.id}`) ?? null,
      card.id,
      source.session.id,
      source.label.createdByUserId,
    );
    if ((gradedCounts.get(card.id) ?? 0) !== 1) {
      throw new Error("Ten Kings V2 card materialization has an invalid card or creation-event count");
    }
    orderedCards.push(card);
    return {
      cardId: card.id,
      sessionId: source.session.id,
      humanGradeLabelId: source.label.id,
      certificateNumber: source.label.certificateNumber,
      publicReportSlug: card.publicReportSlug,
      publicToken: card.publicToken,
      publicPath: `/c/${card.publicToken}`,
      lifecycleState: card.lifecycleState,
      cardCount: 1,
      creationEventCount: 1,
    };
  });
  return { cards: orderedCards, verified };
}

const requireAdminText = (value: string, field: string) => {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
};

export async function resyncIdentityFromSpeedster(
  tx: CardPlatformV2Transaction,
  cardId: string,
  adminId: string,
) {
  requireAdminText(adminId, "Admin identity");
  const card = await tx.collectibleCardV2.findUnique({
    where: { id: cardId },
    select: {
      id: true,
      speedsterSession: {
        select: {
          cardProfile: true,
          workflowState: true,
          identity: true,
        },
      },
    },
  });
  if (!card || card.speedsterSession.workflowState !== "COMPLETED") {
    throw new Error("Ten Kings V2 card does not have an authoritative completed Speedster session");
  }
  if (card.speedsterSession.cardProfile !== "SPORTS" && card.speedsterSession.cardProfile !== "POKEMON") {
    throw new Error("Completed Speedster session has an unsupported card category");
  }
  const identity = speedsterIdentity(card.speedsterSession.identity);
  assertCategoryIdentity(card.speedsterSession.cardProfile, identity);
  return tx.collectibleCardV2.update({
    where: { id: card.id },
    data: {
      category: card.speedsterSession.cardProfile,
      ...identity,
    },
    select: cardSelection,
  });
}

export function normalizeCompletedSpeedsterIdentity(
  category: "SPORTS" | "POKEMON",
  value: CompletedSpeedsterIdentityInput,
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Completed Speedster identity must be a JSON object");
  }
  const unsupported = Object.keys(value).filter((key) => !SPEEDSTER_IDENTITY_KEYS.has(key));
  if (unsupported.length) {
    throw new Error(`Completed Speedster identity contains unsupported fields: ${unsupported.join(", ")}`);
  }
  for (const [key, nested] of Object.entries(value)) {
    if (nested !== null && typeof nested !== "string") {
      throw new Error(`Completed Speedster identity field ${key} must be text or null`);
    }
  }
  if (value.cardType !== undefined && value.cardType !== category) {
    throw new Error("Completed Speedster identity cardType does not match its authoritative session category");
  }
  if (category === "SPORTS" && text(value.layoutType)) {
    throw new Error("Sports identity cannot carry a Pokémon layout type");
  }
  const layoutType = text(value.layoutType);
  if (layoutType && layoutType !== "POKEMON" && layoutType !== "TRAINER" && layoutType !== "ENERGY") {
    throw new Error("Completed Speedster identity has an invalid Pokémon layout type");
  }
  const trimmed = Object.fromEntries(Object.entries(value).map(([key, nested]) => [
    key,
    typeof nested === "string" ? nested.trim() : nested,
  ])) as CompletedSpeedsterIdentityInput;
  const identity = speedsterIdentity(trimmed as Prisma.JsonValue);
  assertCategoryIdentity(category, identity);
  return {
    session: trimmed as Prisma.InputJsonValue,
    card: identity,
  };
}

const cardIdentityFromStored = (card: {
  playerName: string | null;
  cardName: string | null;
  year: string;
  manufacturer: string | null;
  productSet: string;
  parallel: string | null;
  insert: string | null;
  cardNumber: string | null;
}): SpeedsterIdentity => ({
  playerName: card.playerName,
  cardName: card.cardName,
  year: card.year,
  manufacturer: card.manufacturer,
  productSet: card.productSet,
  parallel: card.parallel,
  insert: card.insert,
  cardNumber: card.cardNumber,
});

const exactLabelIdentityMatches = (
  category: "SPORTS" | "POKEMON",
  label: { cardType: "SPORTS" | "POKEMON" } & SpeedsterIdentity,
  identity: SpeedsterIdentity,
) => label.cardType === category && canonicalJson(cardIdentityFromStored(label)) === canonicalJson(identity);

/**
 * The completed Speedster session is the sole editable identity authority.
 * Its existing SPEEDSTER label is re-rendered from that session in the same
 * transaction, and an existing permanent card is refreshed only through the
 * established V2 re-sync writer.
 */
export async function correctCompletedSpeedsterIdentity(
  tx: CardPlatformV2Transaction,
  sessionId: string,
  nextIdentity: CompletedSpeedsterIdentityInput,
  adminId: string,
) {
  const exactSessionId = requireAdminText(sessionId, "Speedster session identity");
  const exactAdminId = requireAdminText(adminId, "Admin identity");
  const lockedSession = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "AiGraderV2Session"
    WHERE "id" = ${exactSessionId}
    FOR UPDATE
  `;
  if (lockedSession.length !== 1 || lockedSession[0]?.id !== exactSessionId) {
    throw new Error("Completed Speedster session was not found");
  }
  const session = await tx.aiGraderV2Session.findUnique({
    where: { id: exactSessionId },
    select: {
      id: true,
      cardProfile: true,
      workflowState: true,
      identity: true,
      collectibleCardV2: { select: { id: true } },
    },
  });
  if (!session || session.workflowState !== "COMPLETED") {
    throw new Error("Only a completed Speedster session can correct permanent identity");
  }
  if (session.cardProfile !== "SPORTS" && session.cardProfile !== "POKEMON") {
    throw new Error("Completed Speedster session has an unsupported card category");
  }
  const storedIdentity = session.identity && typeof session.identity === "object" && !Array.isArray(session.identity)
    ? session.identity as Record<string, unknown>
    : {};
  if (text(storedIdentity.layoutType) !== text(nextIdentity.layoutType)) {
    throw new Error("Completed Pokémon layout type is immutable");
  }
  const normalized = normalizeCompletedSpeedsterIdentity(session.cardProfile, nextIdentity);
  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "HumanGradeLabel"
    WHERE "sourceSessionId" = ${session.id}
    FOR UPDATE
  `;
  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "CollectibleCardV2"
    WHERE "speedsterSessionId" = ${session.id}
    FOR UPDATE
  `;
  const label = await tx.humanGradeLabel.findUnique({
    where: { sourceSessionId: session.id },
    select: {
      id: true,
      source: true,
      sourceSessionId: true,
      certificateNumber: true,
      cardType: true,
      playerName: true,
      cardName: true,
      year: true,
      manufacturer: true,
      productSet: true,
      parallel: true,
      insert: true,
      cardNumber: true,
    },
  });
  if (
    !label ||
    label.source !== "SPEEDSTER" ||
    label.sourceSessionId !== session.id ||
    !label.certificateNumber
  ) {
    throw new Error("Completed Speedster identity correction requires its exact issued label");
  }

  const card = session.collectibleCardV2
    ? await tx.collectibleCardV2.findUnique({
      where: { id: session.collectibleCardV2.id },
      select: cardSelection,
    })
    : null;
  if (session.collectibleCardV2 && !card) {
    throw new Error("Completed Speedster identity correction lost its linked permanent card");
  }

  const sessionChanged = canonicalJson(session.identity) !== canonicalJson(normalized.session);
  const labelChanged = !exactLabelIdentityMatches(session.cardProfile, label, normalized.card);
  const cardChanged = Boolean(card && (
    card.category !== session.cardProfile ||
    canonicalJson(cardIdentityFromStored(card)) !== canonicalJson(normalized.card)
  ));

  if (sessionChanged) {
    await tx.aiGraderV2Session.update({
      where: { id: session.id },
      data: { identity: normalized.session },
    });
  }
  if (labelChanged) {
    await tx.humanGradeLabel.update({
      where: { id: label.id },
      data: {
        cardType: session.cardProfile,
        playerName: normalized.card.playerName,
        cardName: normalized.card.cardName,
        year: normalized.card.year,
        manufacturer: normalized.card.manufacturer,
        productSet: normalized.card.productSet,
        parallel: normalized.card.parallel,
        insert: normalized.card.insert,
        cardNumber: normalized.card.cardNumber,
      },
    });
  }
  if (card && cardChanged) {
    await resyncIdentityFromSpeedster(tx, card.id, exactAdminId);
  }
  return {
    outcome: sessionChanged || labelChanged || cardChanged ? "UPDATED" as const : "NOOP" as const,
    sessionId: session.id,
    labelId: label.id,
    certificateNumber: label.certificateNumber,
    cardId: card?.id ?? null,
    category: session.cardProfile,
    identity: normalized.card,
    writes: {
      session: sessionChanged,
      label: labelChanged,
      card: cardChanged,
    },
  };
}

export async function voidCard(
  tx: CardPlatformV2Transaction,
  cardId: string,
  reason: string,
  adminId: string,
) {
  requireAdminText(reason, "Void reason");
  requireAdminText(adminId, "Admin identity");
  const card = await tx.collectibleCardV2.findUnique({
    where: { id: cardId },
    select: { id: true, lifecycleState: true },
  });
  if (!card) throw new Error("Ten Kings V2 card was not found");
  if (card.lifecycleState === "VOID") return card;
  return tx.collectibleCardV2.update({
    where: { id: card.id },
    data: { lifecycleState: "VOID" },
    select: { id: true, lifecycleState: true },
  });
}

async function requireMutableCompsCard(tx: CardPlatformV2Transaction, cardId: string) {
  const id = requireAdminText(cardId, "Card identity");
  const card = await tx.collectibleCardV2.findUnique({
    where: { id },
    select: {
      id: true,
      lifecycleState: true,
      marketValueCents: true,
      marketValueConfirmedAt: true,
      marketValueConfirmedByAdminId: true,
    },
  });
  if (!card || card.lifecycleState === "VOID") {
    throw new Error("Ten Kings V2 card was not found");
  }
  return card;
}

const COMPS_SNAPSHOT_MAX_BYTES = 256 * 1024;
const COMPS_SNAPSHOT_MAX_CANDIDATES = 60;
const COMPS_MAX_CENTS = 2_147_483_647;
const COMPS_GROUPS = new Set(["PSA_TARGET", "PSA_OTHER", "OTHER_GRADED", "RAW"]);
const COMPS_PARALLEL_MATCHES = new Set(["MATCH", "CONTRADICTORY", "UNKNOWN"]);
const COMPS_GRADERS = new Set(["PSA", "BGS", "SGC", "CGC"]);

const compsRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const compsText = (value: unknown, maximum: number) =>
  typeof value === "string" && value.trim() && value.trim().length <= maximum ? value.trim() : null;
const positiveSafeCents = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= COMPS_MAX_CENTS;
const normalizedEbayListingUrl = (value: unknown) => {
  const raw = compsText(value, 500);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    const match = url.pathname.match(/^\/itm\/(\d{6,20})\/?$/);
    return url.protocol === "https:" && !url.username && !url.password &&
      (host === "ebay.com" || host.endsWith(".ebay.com")) && match?.[1] && !url.search && !url.hash
      ? `https://www.ebay.com/itm/${match[1]}`
      : null;
  } catch {
    return null;
  }
};
const normalizedEbayImageUrl = (value: unknown) => {
  if (value === null) return null;
  const raw = compsText(value, 1000);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    const approved = host === "ebayimg.com" || host.endsWith(".ebayimg.com") || host === "ebaystatic.com" || host.endsWith(".ebaystatic.com");
    return url.protocol === "https:" && !url.username && !url.password && approved ? url.toString() : undefined;
  } catch {
    return undefined;
  }
};
const canonicalIsoTimestamp = (value: unknown) => {
  const raw = compsText(value, 40);
  if (!raw) return null;
  const epoch = Date.parse(raw);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === raw ? raw : null;
};
const canonicalSoldDate = (value: unknown) => {
  const raw = compsText(value, 10);
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const epoch = Date.parse(`${raw}T00:00:00.000Z`);
  return Number.isFinite(epoch) && new Date(epoch).toISOString().slice(0, 10) === raw ? raw : null;
};

export function normalizeCompsSnapshotForWrite(snapshot: Prisma.InputJsonValue, authoritativeAdminId?: string): Prisma.InputJsonValue {
  const candidateSnapshot: unknown = snapshot;
  if (!compsRecord(candidateSnapshot) || candidateSnapshot.version !== 1 || candidateSnapshot.source !== "EBAY_SOLD" || !Array.isArray(candidateSnapshot.candidates)) {
    throw new Error("Comps snapshot has an invalid bounded structure");
  }
  const source = candidateSnapshot;
  const sourceCandidates = source.candidates as unknown[];
  if (Buffer.byteLength(JSON.stringify(snapshot), "utf8") > COMPS_SNAPSHOT_MAX_BYTES) {
    throw new Error("Comps snapshot exceeds the bounded size limit");
  }
  if (sourceCandidates.length > COMPS_SNAPSHOT_MAX_CANDIDATES) {
    throw new Error("Comps snapshot exceeds the candidate limit");
  }
  const query = compsText(source.query, 400);
  const engineVersion = compsText(source.engineVersion, 100);
  const retrievedAt = canonicalIsoTimestamp(source.retrievedAt);
  const nextOffset = Number.isSafeInteger(source.nextOffset) && Number(source.nextOffset) >= 0 ? Number(source.nextOffset) : null;
  if (!query || !engineVersion || !retrievedAt || nextOffset === null) {
    throw new Error("Comps snapshot metadata is invalid");
  }

  const seen = new Set<string>();
  const candidates = sourceCandidates.map((candidateValue: unknown) => {
    if (!compsRecord(candidateValue)) throw new Error("Comps snapshot candidate is invalid");
    const id = compsText(candidateValue.id, 100);
    const title = compsText(candidateValue.title, 500);
    const listingUrl = normalizedEbayListingUrl(candidateValue.listingUrl);
    const imageUrl = normalizedEbayImageUrl(candidateValue.imageUrl);
    const group = compsText(candidateValue.group, 30);
    const parallelMatch = compsText(candidateValue.parallelMatch, 30);
    const grader = candidateValue.grader === null ? null : compsText(candidateValue.grader, 10);
    const soldPriceCents = candidateValue.soldPriceCents === null ? null : positiveSafeCents(candidateValue.soldPriceCents) ? candidateValue.soldPriceCents : undefined;
    const soldDate = candidateValue.soldDate === null ? null : canonicalSoldDate(candidateValue.soldDate);
    const numericGrade = candidateValue.numericGrade === null ? null : typeof candidateValue.numericGrade === "number" && Number.isFinite(candidateValue.numericGrade) && candidateValue.numericGrade >= 1 && candidateValue.numericGrade <= 10 ? candidateValue.numericGrade : undefined;
    if (
      !id || seen.has(id) || !title || !listingUrl || imageUrl === undefined || soldPriceCents === undefined ||
      !group || !COMPS_GROUPS.has(group) || !parallelMatch || !COMPS_PARALLEL_MATCHES.has(parallelMatch) ||
      (grader !== null && !COMPS_GRADERS.has(grader)) || numericGrade === undefined ||
      (candidateValue.soldDate !== null && soldDate === null) || typeof candidateValue.included !== "boolean"
    ) throw new Error("Comps snapshot candidate is invalid");
    seen.add(id);
    const matchScore = typeof candidateValue.matchScore === "number" && Number.isFinite(candidateValue.matchScore)
      ? Math.max(0, Math.min(100, Math.round(candidateValue.matchScore)))
      : 0;
    return {
      id,
      title,
      listingUrl,
      imageUrl,
      soldPriceCents,
      soldDate,
      condition: candidateValue.condition === null ? null : compsText(candidateValue.condition, 200),
      grader,
      numericGrade,
      raw: candidateValue.raw === true,
      group,
      parallelMatch,
      matchScore,
      matchReason: compsText(candidateValue.matchReason, 500) ?? "Human review required",
      included: candidateValue.included,
    };
  });
  const included = candidates.filter((candidate) => candidate.included);
  if (included.some((candidate) => !positiveSafeCents(candidate.soldPriceCents))) {
    throw new Error("An included comp requires one positive sold price");
  }
  const prices: number[] = included.map((candidate) => candidate.soldPriceCents as number);
  const divisor = BigInt(prices.length || 1);
  const total = prices.reduce((sum, price) => sum + BigInt(price), 0n);
  const selection = prices.length ? {
    includedCandidateIds: included.map((candidate) => candidate.id),
    includedCount: prices.length,
    averageSoldPriceCents: Number((total + divisor / 2n) / divisor),
    lowestSoldPriceCents: Math.min(...prices),
    highestSoldPriceCents: Math.max(...prices),
  } : {
    includedCandidateIds: [],
    includedCount: 0,
    averageSoldPriceCents: null,
    lowestSoldPriceCents: null,
    highestSoldPriceCents: null,
  };
  const confirmationSource = source.confirmation;
  const confirmation = confirmationSource === null || confirmationSource === undefined
    ? null
    : compsRecord(confirmationSource) && positiveSafeCents(confirmationSource.marketValueCents) &&
      canonicalIsoTimestamp(confirmationSource.confirmedAt) && compsText(confirmationSource.confirmedByAdminId, 256)
      ? {
        marketValueCents: confirmationSource.marketValueCents,
        confirmedAt: canonicalIsoTimestamp(confirmationSource.confirmedAt)!,
        confirmedByAdminId: authoritativeAdminId
          ? requireAdminText(authoritativeAdminId, "Admin identity")
          : compsText(confirmationSource.confirmedByAdminId, 256)!,
      }
      : undefined;
  if (confirmation === undefined) throw new Error("Comps snapshot confirmation metadata is invalid");
  return {
    version: 1,
    source: "EBAY_SOLD",
    engineVersion,
    query,
    retrievedAt,
    nextOffset,
    hasMore: candidates.length < COMPS_SNAPSHOT_MAX_CANDIDATES && source.hasMore === true,
    candidates,
    selection,
    confirmation,
  } as Prisma.InputJsonValue;
}

export async function saveCompsSnapshot(
  tx: CardPlatformV2Transaction,
  cardId: string,
  snapshot: Prisma.InputJsonValue,
  adminId: string,
  options: { confirmationMode?: "PRESERVE" | "CONFIRM" } = {},
) {
  const authenticatedAdminId = requireAdminText(adminId, "Admin identity");
  const card = await requireMutableCompsCard(tx, cardId);
  const confirmationMode = options.confirmationMode ?? "PRESERVE";
  const normalizedSnapshot = normalizeCompsSnapshotForWrite(
    snapshot,
    confirmationMode === "CONFIRM" ? authenticatedAdminId : undefined,
  );
  const normalized = normalizedSnapshot as unknown as Record<string, unknown>;
  const incoming = compsRecord(normalized.confirmation) ? normalized.confirmation : null;
  const selection = compsRecord(normalized.selection) ? normalized.selection : null;
  if (confirmationMode === "CONFIRM" && (
    !incoming || !selection || !Number.isSafeInteger(selection.includedCount) || Number(selection.includedCount) <= 0 ||
    !positiveSafeCents(selection.averageSoldPriceCents) || incoming.marketValueCents !== selection.averageSoldPriceCents
  )) throw new Error("Confirmed market value must equal the nonempty selected-price arithmetic average");
  if (confirmationMode === "PRESERVE") {
    const persisted = positiveSafeCents(card.marketValueCents) && card.marketValueConfirmedAt instanceof Date &&
      Number.isFinite(card.marketValueConfirmedAt.getTime()) && compsText(card.marketValueConfirmedByAdminId, 256)
      ? {
        marketValueCents: card.marketValueCents,
        confirmedAt: card.marketValueConfirmedAt.toISOString(),
        confirmedByAdminId: card.marketValueConfirmedByAdminId,
      }
      : null;
    if (
      Boolean(incoming) !== Boolean(persisted) ||
      (incoming && persisted && (
        incoming.marketValueCents !== persisted.marketValueCents ||
        incoming.confirmedAt !== persisted.confirmedAt ||
        incoming.confirmedByAdminId !== persisted.confirmedByAdminId
      ))
    ) throw new Error("Comps snapshot confirmation provenance must be preserved");
  }
  return tx.collectibleCardV2.update({
    where: { id: card.id },
    data: { compsSnapshot: normalizedSnapshot },
    select: { id: true, compsSnapshot: true, updatedAt: true },
  });
}

export async function confirmMarketValue(
  tx: CardPlatformV2Transaction,
  cardId: string,
  valueCents: number,
  adminId: string,
  confirmedAt = new Date(),
) {
  const confirmedBy = requireAdminText(adminId, "Admin identity");
  if (!positiveSafeCents(valueCents)) {
    throw new Error("Confirmed market value must fit one positive PostgreSQL integer in cents");
  }
  if (!Number.isFinite(confirmedAt.getTime())) {
    throw new Error("Market-value confirmation time is invalid");
  }
  const card = await requireMutableCompsCard(tx, cardId);
  return tx.collectibleCardV2.update({
    where: { id: card.id },
    data: {
      marketValueCents: valueCents,
      marketValueConfirmedAt: confirmedAt,
      marketValueConfirmedByAdminId: confirmedBy,
    },
    select: {
      id: true,
      marketValueCents: true,
      marketValueConfirmedAt: true,
      marketValueConfirmedByAdminId: true,
      updatedAt: true,
    },
  });
}

export async function setCompsPublic(
  tx: CardPlatformV2Transaction,
  cardId: string,
  isPublic: boolean,
  adminId: string,
) {
  requireAdminText(adminId, "Admin identity");
  if (typeof isPublic !== "boolean") throw new Error("Public comps setting must be boolean");
  const card = await requireMutableCompsCard(tx, cardId);
  return tx.collectibleCardV2.update({
    where: { id: card.id },
    data: { compsPublic: isPublic },
    select: { id: true, compsPublic: true, updatedAt: true },
  });
}

const NFC_WORKSTATION_KEY_ID = /^[a-f0-9]{64}$/;
const CANONICAL_UTC_MILLIS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

type NfcLockedCard = {
  id: string;
  publicToken: string;
  lifecycleState: string;
  nfcVerifiedAt: Date | null;
  nfcVerifiedByAdminId: string | null;
  nfcVerifiedByWorkstationId: string | null;
  transactionTime: Date;
};

export type MarkNfcVerifiedResult = {
  outcome: "UPDATED" | "NOOP_REPLAY_OR_STALE";
  card: {
    id: string;
    publicToken: string;
    lifecycleState: string;
    nfcVerifiedAt: Date | null;
    nfcVerifiedByAdminId: string | null;
    nfcVerifiedByWorkstationId: string | null;
  };
};

/**
 * Persists only the three owner-approved, informational NFC facts. The row lock
 * makes replacement and replay decisions deterministic without an attempt,
 * audit, tag-history, or failed-tag table.
 */
export async function markNfcVerified(
  tx: CardPlatformV2Transaction,
  cardId: string,
  verification: {
    publicToken: string;
    jobIssuedAt: string;
    workstationKeyId: string;
  },
  adminId: string,
): Promise<MarkNfcVerifiedResult> {
  const normalizedCardId = requireAdminText(cardId, "Card identity");
  const normalizedAdminId = requireAdminText(adminId, "Admin identity");
  if (!PUBLIC_TOKEN.test(verification.publicToken)) {
    throw new Error("NFC verification has an invalid permanent card token");
  }
  if (!NFC_WORKSTATION_KEY_ID.test(verification.workstationKeyId)) {
    throw new Error("NFC verification has an invalid workstation identity");
  }
  if (!CANONICAL_UTC_MILLIS.test(verification.jobIssuedAt)) {
    throw new Error("NFC verification has an invalid signed job time");
  }
  const issuedAt = new Date(verification.jobIssuedAt);
  if (!Number.isFinite(issuedAt.getTime()) || issuedAt.toISOString() !== verification.jobIssuedAt) {
    throw new Error("NFC verification has an invalid signed job time");
  }

  const rows = await tx.$queryRaw<NfcLockedCard[]>(Prisma.sql`
    SELECT
      "id",
      "publicToken",
      "lifecycleState"::text AS "lifecycleState",
      "nfcVerifiedAt",
      "nfcVerifiedByAdminId",
      "nfcVerifiedByWorkstationId",
      CURRENT_TIMESTAMP AS "transactionTime"
    FROM "CollectibleCardV2"
    WHERE "id" = ${normalizedCardId}
    FOR UPDATE
  `);
  const locked = rows[0];
  if (!locked || locked.lifecycleState === "VOID") {
    throw new Error("Permanent Ten Kings V2 card was not found");
  }
  if (locked.publicToken !== verification.publicToken) {
    throw new Error("NFC verification no longer matches the permanent card token");
  }

  if (locked.nfcVerifiedAt && issuedAt.getTime() <= locked.nfcVerifiedAt.getTime()) {
    return {
      outcome: "NOOP_REPLAY_OR_STALE",
      card: {
        id: locked.id,
        publicToken: locked.publicToken,
        lifecycleState: locked.lifecycleState,
        nfcVerifiedAt: locked.nfcVerifiedAt,
        nfcVerifiedByAdminId: locked.nfcVerifiedByAdminId,
        nfcVerifiedByWorkstationId: locked.nfcVerifiedByWorkstationId,
      },
    };
  }

  const card = await tx.collectibleCardV2.update({
    where: { id: locked.id },
    data: {
      nfcVerifiedAt: locked.transactionTime,
      nfcVerifiedByAdminId: normalizedAdminId,
      nfcVerifiedByWorkstationId: verification.workstationKeyId,
    },
    select: {
      id: true,
      publicToken: true,
      lifecycleState: true,
      nfcVerifiedAt: true,
      nfcVerifiedByAdminId: true,
      nfcVerifiedByWorkstationId: true,
    },
  });
  return { outcome: "UPDATED", card };
}
