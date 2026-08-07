import { randomBytes } from "crypto";

import type { Prisma } from "@prisma/client";

const PUBLIC_TOKEN = /^tk2c_[A-Za-z0-9_-]{32}$/;
const TOKEN_ATTEMPTS = 8;

type CardPlatformV2Transaction = Prisma.TransactionClient;

type CardBackfillReadClient = Pick<
  Prisma.TransactionClient,
  "aiGraderV2Session" | "humanGradeLabel"
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

export async function createCardFromSpeedster(
  tx: CardPlatformV2Transaction,
  sessionId: string,
  humanGradeLabelId: string,
) {
  const session = await tx.aiGraderV2Session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      cardProfile: true,
      workflowState: true,
      ruleVersion: true,
      publicReportSlug: true,
      identity: true,
    },
  });
  if (!session || session.workflowState !== "COMPLETED" || !session.publicReportSlug) {
    throw new Error("A permanent V2 card requires a completed Speedster report");
  }
  if (session.cardProfile !== "SPORTS" && session.cardProfile !== "POKEMON") {
    throw new Error("Completed Speedster session has an unsupported card category");
  }

  const label = await tx.humanGradeLabel.findUnique({
    where: { id: humanGradeLabelId },
    select: {
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
    },
  });
  if (
    !label ||
    label.source !== "SPEEDSTER" ||
    label.sourceSessionId !== session.id ||
    !label.certificateNumber
  ) {
    throw new Error("A permanent V2 card requires the exact completed Speedster label");
  }
  const certificateNumber = label.certificateNumber;

  const identity = speedsterIdentity(session.identity);
  assertIdentityMatch(session.cardProfile, identity, label);
  const gradeSnapshot = buildGradeSnapshot(session.ruleVersion, { ...label, certificateNumber });

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
      select: {
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
      },
    });
    if (
      !creationEvent ||
      creationEvent.cardId !== existingBySession.id ||
      creationEvent.fromOwnerType !== null ||
      creationEvent.fromOwnerId !== null ||
      creationEvent.toOwnerType !== "HOUSE" ||
      creationEvent.toOwnerId !== null ||
      creationEvent.reason !== "GRADED_CREATED" ||
      creationEvent.referenceType !== "SYSTEM_CREATION" ||
      creationEvent.referenceId !== `speedster:${session.id}` ||
      creationEvent.pricePaidCents !== null ||
      creationEvent.tkdAmountCents !== null ||
      creationEvent.channel !== "ADMIN" ||
      creationEvent.actorAdminId !== label.createdByUserId
    ) {
      throw new Error("Existing Ten Kings V2 card is missing its immutable creation event");
    }
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
