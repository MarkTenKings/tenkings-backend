import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import { Prisma, PrismaClient } from "@prisma/client";

const require = createRequire(import.meta.url);
const {
  auditSpeedsterCardCreationSources,
  normalizeCompletedSpeedsterIdentity,
  validateSpeedsterCardCreationSources,
} = require("../dist/database/src/cardPlatformV2.js");

// After set-based reads/writes this transaction executes at most 13 bounded DB
// statements, independent of the 27-row manifest. Production needed ~68s for
// the former first 12 statements, so three minutes is bounded headroom rather
// than a substitute for eliminating the old per-row hot path.
export const CORRECTION_TRANSACTION_TIMEOUT_MS = 180_000;

export const CONFIRMATIONS = Object.freeze({
  A: "APPLY_OWNER_APPROVED_SPEEDSTER_IDENTITY_PHASE_A",
  C: "APPLY_OWNER_APPROVED_SPEEDSTER_IDENTITY_PHASE_C",
});

// These bindings are copied from Mark's explicit ID -> certificate authority.
// Never derive a session ID from certificate order or neighboring rows.
export const PHASE_A = Object.freeze([
  {
    sessionId: "cmscq0ght000011tyoq07u2gc",
    certificateNumber: "TKH-000226",
    changes: { cardName: "ARTICUNO", productSet: "SWORD & SHIELD SILVER TEMPEST" },
    allowedBefore: {
      cardName: ["articuna", "ARTICUNO"],
      productSet: ["SWORD & SHEILD SOLVER TEMPEST", "SWORD & SHIELD SILVER TEMPEST"],
    },
  },
  {
    sessionId: "cmsdelcbq0000hgh9qmd5xyfl",
    certificateNumber: "TKH-000227",
    changes: { productSet: "sword & shield silver tempest" },
    allowedBefore: {
      productSet: ["sword & sheild silver tempest", "sword & shield silver tempest"],
    },
  },
  {
    sessionId: "cmsf9l4g40004126faa2danrj",
    certificateNumber: "TKH-000233",
    changes: { cardName: "CUBONE" },
    allowedBefore: { cardName: ["carbone", "CUBONE"] },
  },
  {
    sessionId: "cmsi92akd0000wf0pttvjo8os",
    certificateNumber: "TKH-000692",
    changes: { productSet: "PHOENIX", insert: "THUNDERBIRDS" },
    allowedBefore: {
      productSet: ["PHEONIX", "PHOENIX"],
      insert: ["THUNDERBIRD", "THUNDERBIRDS"],
    },
  },
  {
    sessionId: "cmsi9p4wj0000pkzj8hx2ktro",
    certificateNumber: "TKH-000693",
    changes: { productSet: "PHOENIX" },
    allowedBefore: { productSet: ["PHEONIX", "PHOENIX"] },
  },
  {
    sessionId: "cmsiajjru0006vcg05jmgy7hi",
    certificateNumber: "TKH-000696",
    changes: { playerName: "SHEDEUR SANDERS", productSet: "PHOENIX" },
    allowedBefore: {
      playerName: ["sheduer sanders", "SHEDEUR SANDERS"],
      productSet: ["pheonix", "PHOENIX"],
    },
  },
  {
    sessionId: "cmsibaqq40028vcg0hsvzfhlg",
    certificateNumber: "TKH-000698",
    changes: { productSet: "PHOENIX" },
    allowedBefore: { productSet: ["PHEONIX", "PHOENIX"] },
  },
  {
    sessionId: "cmsic0c60003ivcg0o81sw44d",
    certificateNumber: "TKH-000700",
    changes: { productSet: "PHOENIX" },
    allowedBefore: { productSet: ["PHEONIX", "PHOENIX"] },
  },
]);

// TKH-000219 is not an authorized session correction. The completed session
// remains authoritative at 2019; only this exact directly edited label version
// may be regenerated from that unchanged session during Phase A.
export const PHASE_A_LABEL_CONVERGENCE = Object.freeze([Object.freeze({
  sessionId: "cmsanu8zn0000nw1oopkh0m2m",
  certificateNumber: "TKH-000219",
  category: "SPORTS",
  allowedBefore: Object.freeze({ year: Object.freeze(["2019"]) }),
  divergentLabelYear: "2021",
  divergentLabelUpdatedAt: "2026-08-07T17:37:12.782Z",
})]);

export const PHASE_A_OWNER_REVIEW_FLAGS = Object.freeze({
  nonblocking: true,
  flags: Object.freeze([
    "TKH-000219 year 2019 vs TKH-000220/221 year 2021",
    "TKH-000226 card #036/195 vs TKH-000227 #035/195",
  ]),
});

export const PHASE_C = Object.freeze([
  { sessionId: "cmsbljwvu00003ukrq95uzo69", certificateNumber: "TKH-000222", remove: ["playerName"] },
  { sessionId: "cmscaiief000411v4j4tyjkf4", certificateNumber: "TKH-000223", remove: ["playerName"] },
  { sessionId: "cmscebt1m0000accgrbn3etxz", certificateNumber: "TKH-000224", remove: ["playerName"] },
  { sessionId: "cmscem6960006accgpc69tgwp", certificateNumber: "TKH-000225", remove: ["playerName"] },
  {
    sessionId: "cmsgcozde0011b5szkktkx58r",
    certificateNumber: "TKH-000457",
    replace: {
      cardType: "POKEMON",
      cardName: "PIKACHU V",
      year: "2022 POKEMON SWSH",
      manufacturer: null,
      productSet: "PIKACHU V BOX",
      parallel: "BSP",
      insert: null,
      cardNumber: "SWSH198",
    },
  },
]);

export const PHASE_A_WRITER_VALIDATION = Object.freeze([
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
].map(([sessionId, certificateNumber]) => Object.freeze({ sessionId, certificateNumber })));

const ALLOWED_IDENTITY_KEYS = new Set([
  "playerName",
  "cardName",
  "year",
  "manufacturer",
  "productSet",
  "parallel",
  "insert",
  "cardNumber",
  "cardType",
]);

export function parseArgs(argv) {
  const args = { phase: null, apply: false, confirmation: null, actorAdminId: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--phase") {
      args.phase = argv[index + 1]?.toUpperCase() ?? null;
      index += 1;
      continue;
    }
    if (arg.startsWith("--phase=")) {
      args.phase = arg.slice("--phase=".length).toUpperCase();
      continue;
    }
    if (arg === "--apply") {
      args.apply = true;
      continue;
    }
    if (arg === "--confirm") {
      args.confirmation = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg.startsWith("--confirm=")) {
      args.confirmation = arg.slice("--confirm=".length);
      continue;
    }
    if (arg === "--actor-admin-id") {
      args.actorAdminId = argv[index + 1]?.trim() || null;
      index += 1;
      continue;
    }
    if (arg.startsWith("--actor-admin-id=")) {
      args.actorAdminId = arg.slice("--actor-admin-id=".length).trim() || null;
      continue;
    }
    if (arg === "--help" || arg === "-h") return { ...args, help: true };
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (args.phase !== "A" && args.phase !== "C") throw new Error("--phase must be A or C");
  if (!args.apply && (args.confirmation || args.actorAdminId)) {
    throw new Error("--confirm and --actor-admin-id are accepted only with --apply");
  }
  if (args.apply && args.confirmation !== CONFIRMATIONS[args.phase]) {
    throw new Error(`--apply requires --confirm ${CONFIRMATIONS[args.phase]}`);
  }
  if (args.apply && !args.actorAdminId) {
    throw new Error("--apply requires --actor-admin-id to identify the authorized operator in captured command output");
  }
  return args;
}

function usage() {
  console.log(`Usage:
  pnpm --filter @tenkings/database correct:speedster:identities --phase A
  pnpm --filter @tenkings/database correct:speedster:identities --phase A --apply \\
    --actor-admin-id <admin-user-id> \\
    --confirm ${CONFIRMATIONS.A}

Default mode is a zero-write dry run. Phase A changes exactly eight owner-approved
sessions, re-renders only TKH-000219's exact divergent SPEEDSTER label from its
unchanged authoritative session, and validates all 27 approved Phase B sources
through the real card-writer source validator. TKH-000219 remains a nonblocking
physical-card review flag and is not counted as a session correction. Phase C changes
exactly five approved conflict sessions and validates only those five. This executable
never creates a permanent card; Phase C backfill remains prohibited without separate
owner approval. --actor-admin-id is reported as captured command-output evidence only;
it does not create a database audit record for a pre-backfill correction.`);
}

export function trimIdentity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Session identity is not a JSON object");
  }
  const unsupported = Object.keys(value).filter((key) => !ALLOWED_IDENTITY_KEYS.has(key));
  if (unsupported.length) throw new Error(`Unsupported identity fields: ${unsupported.join(", ")}`);
  for (const [key, nested] of Object.entries(value)) {
    if (nested !== null && typeof nested !== "string") {
      throw new Error(`Identity field ${key} must be text or null`);
    }
  }
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [
    key,
    typeof nested === "string" ? nested.trim() : nested,
  ]));
}

function assertAllowedBefore(current, instruction) {
  for (const [field, values] of Object.entries(instruction.allowedBefore ?? {})) {
    if (!values.includes(current[field])) {
      throw new Error(
        `${instruction.sessionId} ${field} was ${JSON.stringify(current[field])}; expected one of ${values.map((value) => JSON.stringify(value)).join(", ")}`,
      );
    }
  }
}

export function buildTarget(row, instruction) {
  const current = trimIdentity(row.identity);
  assertAllowedBefore(current, instruction);
  const target = instruction.replace ? trimIdentity(instruction.replace) : { ...current };
  for (const key of instruction.remove ?? []) {
    if (!ALLOWED_IDENTITY_KEYS.has(key)) throw new Error(`Unsupported removal field: ${key}`);
    delete target[key];
  }
  Object.assign(target, instruction.changes ?? {});
  return normalizeCompletedSpeedsterIdentity(row.cardProfile, trimIdentity(target)).session;
}

function labelIdentity(label) {
  return {
    playerName: label.playerName,
    cardName: label.cardName,
    year: label.year,
    manufacturer: label.manufacturer,
    productSet: label.productSet,
    parallel: label.parallel,
    insert: label.insert,
    cardNumber: label.cardNumber,
  };
}

async function loadRows(db, instructions) {
  const ids = instructions.map(({ sessionId }) => sessionId);
  if (new Set(ids).size !== ids.length) throw new Error("Correction manifest contains duplicate session IDs");
  const rows = await db.aiGraderV2Session.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      cardProfile: true,
      workflowState: true,
      identity: true,
      collectibleCardV2: { select: { id: true, publicToken: true } },
    },
  });
  const labels = await db.humanGradeLabel.findMany({
    where: { sourceSessionId: { in: ids } },
    select: {
      id: true,
      source: true,
      sourceSessionId: true,
      certificateNumber: true,
      updatedAt: true,
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
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const labelsBySession = new Map(labels.map((label) => [label.sourceSessionId, label]));
  return instructions.map((instruction) => {
    const row = rowsById.get(instruction.sessionId);
    const label = labelsBySession.get(instruction.sessionId);
    if (!row) throw new Error(`Missing exact session ${instruction.sessionId}`);
    if (!label) throw new Error(`Missing exact label for ${instruction.sessionId}`);
    if (row.workflowState !== "COMPLETED") throw new Error(`${instruction.sessionId} is not COMPLETED`);
    if (row.cardProfile !== "SPORTS" && row.cardProfile !== "POKEMON") {
      throw new Error(`${instruction.sessionId} has unsupported category ${row.cardProfile}`);
    }
    if (label.source !== "SPEEDSTER" || label.sourceSessionId !== row.id) {
      throw new Error(`${instruction.sessionId} label is not the exact SPEEDSTER-owned label`);
    }
    if (label.certificateNumber !== instruction.certificateNumber) {
      throw new Error(`${instruction.sessionId} expected ${instruction.certificateNumber}, found ${label.certificateNumber ?? "no certificate"}`);
    }
    if (row.collectibleCardV2) {
      throw new Error(`${instruction.sessionId} already has permanent card ${row.collectibleCardV2.id}; stop before this pre-backfill operation`);
    }
    return {
      instruction,
      row,
      label,
      targetIdentity: buildTarget(row, instruction),
    };
  });
}

function canonicalLabelFromSession(target) {
  return {
    cardType: target.row.cardProfile,
    ...normalizeCompletedSpeedsterIdentity(target.row.cardProfile, target.targetIdentity).card,
  };
}

function labelUpdatedAtIso(label) {
  if (label.updatedAt instanceof Date) return label.updatedAt.toISOString();
  if (typeof label.updatedAt === "string") return label.updatedAt;
  throw new Error(`${label.sourceSessionId} exact label has no usable updatedAt evidence`);
}

export function inspectExactPhaseALabelConvergence(target) {
  const { instruction, row, label } = target;
  if (
    instruction.sessionId !== PHASE_A_LABEL_CONVERGENCE[0].sessionId ||
    instruction.certificateNumber !== PHASE_A_LABEL_CONVERGENCE[0].certificateNumber ||
    row.cardProfile !== instruction.category
  ) {
    throw new Error("Phase A label convergence is not the exact TKH-000219 authority");
  }
  const expectedLabel = canonicalLabelFromSession(target);
  const observedLabel = { cardType: label.cardType, ...labelIdentity(label) };
  if (stable(observedLabel) === stable(expectedLabel)) {
    return {
      outcome: "NOOP",
      sessionId: row.id,
      certificateNumber: instruction.certificateNumber,
      sessionIdentityUnchanged: true,
      sessionWrites: 0,
      labelWrites: 0,
      labelBefore: observedLabel,
      labelAfter: expectedLabel,
    };
  }
  const exactDivergentLabel = { ...expectedLabel, year: instruction.divergentLabelYear };
  if (stable(observedLabel) !== stable(exactDivergentLabel)) {
    throw new Error(
      `${row.id} label differs from its session beyond the exact approved TKH-000219 year divergence`,
    );
  }
  const observedUpdatedAt = labelUpdatedAtIso(label);
  if (observedUpdatedAt !== instruction.divergentLabelUpdatedAt) {
    throw new Error(
      `${row.id} divergent label updatedAt was ${observedUpdatedAt}; expected ${instruction.divergentLabelUpdatedAt}`,
    );
  }
  return {
    outcome: "LABEL_UPDATE_REQUIRED",
    sessionId: row.id,
    certificateNumber: instruction.certificateNumber,
    sessionIdentityUnchanged: true,
    sessionWrites: 0,
    labelWrites: 1,
    divergentLabelUpdatedAt: observedUpdatedAt,
    labelBefore: observedLabel,
    labelAfter: expectedLabel,
  };
}

export async function convergeExactPhaseALabel(tx, target) {
  const plan = inspectExactPhaseALabelConvergence(target);
  if (plan.outcome === "NOOP") return plan;
  const { cardType, ...identity } = plan.labelAfter;
  await tx.humanGradeLabel.update({
    where: { id: target.label.id },
    data: { cardType, ...identity },
  });
  return { ...plan, outcome: "UPDATED" };
}

function buildLockedCorrectionPlan(target) {
  const labelAfter = canonicalLabelFromSession(target);
  const labelBefore = { cardType: target.label.cardType, ...labelIdentity(target.label) };
  const sessionChanged = stable(target.row.identity) !== stable(target.targetIdentity);
  const labelChanged = stable(labelBefore) !== stable(labelAfter);
  return {
    outcome: sessionChanged || labelChanged ? "UPDATED" : "NOOP",
    sessionId: target.row.id,
    labelId: target.label.id,
    certificateNumber: target.instruction.certificateNumber,
    cardId: null,
    category: target.row.cardProfile,
    identity: normalizeCompletedSpeedsterIdentity(
      target.row.cardProfile,
      target.targetIdentity,
    ).card,
    sessionAfter: target.targetIdentity,
    labelAfter,
    writes: { session: sessionChanged, label: labelChanged, card: false },
  };
}

export async function applyLockedCorrectionsBatched(tx, correctionTargets, labelConvergenceTargets) {
  const corrections = correctionTargets.map(buildLockedCorrectionPlan);
  const labelOnlyConvergence = labelConvergenceTargets.map(inspectExactPhaseALabelConvergence);
  const sessionPatches = corrections
    .filter(({ writes }) => writes.session)
    .map(({ sessionId, sessionAfter }) => ({ id: sessionId, identity: sessionAfter }));
  const labelPatches = [
    ...corrections
      .filter(({ writes }) => writes.label)
      .map(({ labelId, labelAfter }) => ({ id: labelId, ...labelAfter })),
    ...labelConvergenceTargets.flatMap((target, index) =>
      labelOnlyConvergence[index]?.outcome === "LABEL_UPDATE_REQUIRED"
        ? [{ id: target.label.id, ...labelOnlyConvergence[index].labelAfter }]
        : []),
  ];
  if (new Set(labelPatches.map(({ id }) => id)).size !== labelPatches.length) {
    throw new Error("Exact correction batch contains a duplicate label patch");
  }
  if (sessionPatches.length) {
    const updated = await tx.$executeRaw(Prisma.sql`
      UPDATE "AiGraderV2Session" AS target
      SET "identity" = patch."identity", "updatedAt" = CURRENT_TIMESTAMP
      FROM jsonb_to_recordset(${JSON.stringify(sessionPatches)}::jsonb)
        AS patch("id" text, "identity" jsonb)
      WHERE target."id" = patch."id"
    `);
    if (Number(updated) !== sessionPatches.length) {
      throw new Error("Exact correction batch session update count changed unexpectedly");
    }
  }
  if (labelPatches.length) {
    const updated = await tx.$executeRaw(Prisma.sql`
      UPDATE "HumanGradeLabel" AS target
      SET
        "cardType" = patch."cardType"::"HumanGradeCardType",
        "playerName" = patch."playerName",
        "cardName" = patch."cardName",
        "year" = patch."year",
        "manufacturer" = patch."manufacturer",
        "productSet" = patch."productSet",
        "parallel" = patch."parallel",
        "insert" = patch."insert",
        "cardNumber" = patch."cardNumber",
        "updatedAt" = CURRENT_TIMESTAMP
      FROM jsonb_to_recordset(${JSON.stringify(labelPatches)}::jsonb)
        AS patch(
          "id" text,
          "cardType" text,
          "playerName" text,
          "cardName" text,
          "year" text,
          "manufacturer" text,
          "productSet" text,
          "parallel" text,
          "insert" text,
          "cardNumber" text
        )
      WHERE target."id" = patch."id"
    `);
    if (Number(updated) !== labelPatches.length) {
      throw new Error("Exact correction batch label update count changed unexpectedly");
    }
  }
  return {
    corrections,
    labelOnlyConvergence: labelOnlyConvergence.map((row) => ({
      ...row,
      outcome: row.outcome === "LABEL_UPDATE_REQUIRED" ? "UPDATED" : row.outcome,
    })),
  };
}

async function writerValidation(db, manifest) {
  const ids = manifest.map(({ sessionId }) => sessionId);
  const [sessions, labels] = await Promise.all([
    db.aiGraderV2Session.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        workflowState: true,
        collectibleCardV2: { select: { id: true } },
      },
    }),
    db.humanGradeLabel.findMany({
      where: { sourceSessionId: { in: ids } },
      select: { id: true, sourceSessionId: true, certificateNumber: true },
    }),
  ]);
  const sessionsById = new Map(sessions.map((row) => [row.id, row]));
  const labelsBySession = new Map(labels.map((row) => [row.sourceSessionId, row]));
  const bindings = [];
  for (const expected of manifest) {
    const session = sessionsById.get(expected.sessionId);
    const label = labelsBySession.get(expected.sessionId);
    if (!session) throw new Error(`Writer validation is missing ${expected.sessionId}`);
    if (session.workflowState !== "COMPLETED") throw new Error(`${expected.sessionId} is not COMPLETED`);
    if (session.collectibleCardV2) throw new Error(`${expected.sessionId} already has a permanent card`);
    if (!label || label.certificateNumber !== expected.certificateNumber) {
      throw new Error(`${expected.sessionId} writer validation expected ${expected.certificateNumber}`);
    }
    bindings.push({ sessionId: expected.sessionId, humanGradeLabelId: label.id });
  }
  const sources = await validateSpeedsterCardCreationSources(db, bindings);
  return manifest.map((expected, index) => {
    const source = sources[index];
    if (!source) throw new Error(`Writer validation lost ${expected.sessionId}`);
    return {
      sessionId: expected.sessionId,
      certificateNumber: expected.certificateNumber,
      humanGradeLabelId: source.label.id,
      publicReportSlug: source.session.publicReportSlug,
      category: source.session.cardProfile,
      identity: source.identity,
    };
  });
}

async function writerValidationAudit(db, manifest) {
  const ids = manifest.map(({ sessionId }) => sessionId);
  const labels = await db.humanGradeLabel.findMany({
    where: { sourceSessionId: { in: ids } },
    select: { id: true, sourceSessionId: true, certificateNumber: true },
  });
  const labelsBySession = new Map(labels.map((row) => [row.sourceSessionId, row]));
  const prepared = [];
  for (const expected of manifest) {
    const label = labelsBySession.get(expected.sessionId);
    if (!label || label.certificateNumber !== expected.certificateNumber) {
      prepared.push({
        ...expected,
        humanGradeLabelId: null,
        binding: null,
        directIssue: `expected exact label ${expected.certificateNumber}`,
      });
      continue;
    }
    prepared.push({
      ...expected,
      humanGradeLabelId: label.id,
      binding: { sessionId: expected.sessionId, humanGradeLabelId: label.id },
      directIssue: null,
    });
  }
  const auditable = prepared.filter(({ binding }) => binding).map(({ binding }) => binding);
  const audited = auditable.length ? await auditSpeedsterCardCreationSources(db, auditable) : [];
  const auditedBySession = new Map(audited.map((row) => [row.sessionId, row]));
  const rows = prepared.map(({ sessionId, certificateNumber, directIssue }) => {
    const audit = auditedBySession.get(sessionId);
    const issue = directIssue ?? audit?.error ?? null;
    return {
      sessionId,
      certificateNumber,
      technicallyCleanNow: issue === null,
      issue,
    };
  });
  return {
    count: rows.length,
    cleanCount: rows.filter(({ technicallyCleanNow }) => technicallyCleanNow).length,
    conflictCount: rows.filter(({ technicallyCleanNow }) => !technicallyCleanNow).length,
    rows,
  };
}

async function lockExactOperationRows(tx, manifest) {
  const ids = [...manifest.map(({ sessionId }) => sessionId)].sort();
  const lockedSessions = await tx.$queryRaw(Prisma.sql`
    SELECT "id"
    FROM "AiGraderV2Session"
    WHERE "id" IN (${Prisma.join(ids)})
    ORDER BY "id"
    FOR UPDATE
  `);
  const observedSessions = lockedSessions.map(({ id }) => id).sort();
  if (stable(observedSessions) !== stable(ids)) {
    throw new Error("Exact correction transaction could not lock every approved session");
  }
  const lockedLabels = await tx.$queryRaw(Prisma.sql`
    SELECT "id", "sourceSessionId"
    FROM "HumanGradeLabel"
    WHERE "sourceSessionId" IN (${Prisma.join(ids)})
    ORDER BY "sourceSessionId", "id"
    FOR UPDATE
  `);
  const observedLabelSessions = lockedLabels.map(({ sourceSessionId }) => sourceSessionId).sort();
  if (stable(observedLabelSessions) !== stable(ids)) {
    throw new Error("Exact correction transaction could not lock every approved label");
  }
  await tx.$queryRaw(Prisma.sql`
    SELECT "id"
    FROM "CollectibleCardV2"
    WHERE "speedsterSessionId" IN (${Prisma.join(ids)})
    ORDER BY "speedsterSessionId", "id"
    FOR UPDATE
  `);
}

function report(mode, phase, actorAdminId, rows, validation, labelOnlyConvergence = []) {
  return {
    mode,
    phase,
    authorizedOperator: {
      actorAdminId,
      evidence: "CAPTURED_COMMAND_OUTPUT_ONLY",
      databaseAuditRecordCreated: false,
    },
    count: rows.length,
    sessionCorrectionCount: rows.length,
    labelOnlyConvergenceCount: labelOnlyConvergence.length,
    labelOnlyConvergence,
    ownerReviewFlags: phase === "A" ? PHASE_A_OWNER_REVIEW_FLAGS : null,
    transactionTimeoutMs: CORRECTION_TRANSACTION_TIMEOUT_MS,
    permanentCardWrites: 0,
    writerEquivalentValidation: validation,
    sessions: rows.map(({ row, label, instruction, targetIdentity }) => ({
      sessionId: row.id,
      certificateNumber: instruction.certificateNumber,
      category: row.cardProfile,
      sessionBefore: trimIdentity(row.identity),
      labelBefore: { cardType: label.cardType, ...labelIdentity(label) },
      sessionAfter: targetIdentity,
      labelAfter: {
        cardType: row.cardProfile,
        ...normalizeCompletedSpeedsterIdentity(row.cardProfile, targetIdentity).card,
      },
      permanentCardBefore: null,
    })),
  };
}

const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stable(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

function verifyCorrectionRows(rows) {
  for (const target of rows) {
    if (stable(trimIdentity(target.row.identity)) !== stable(target.targetIdentity)) {
      throw new Error(`Post-apply session verification failed for ${target.row.id}`);
    }
    const expectedLabel = report("verification", "VERIFY", null, [target], null).sessions[0].labelAfter;
    const observedLabel = { cardType: target.label.cardType, ...labelIdentity(target.label) };
    if (stable(observedLabel) !== stable(expectedLabel)) {
      throw new Error(`Post-apply label verification failed for ${target.row.id}`);
    }
  }
}

export async function run(args, prisma) {
  const instructions = args.phase === "A" ? PHASE_A : PHASE_C;
  const operationInstructions = args.phase === "A"
    ? [...instructions, ...PHASE_A_LABEL_CONVERGENCE]
    : instructions;
  const validationManifest = args.phase === "A"
    ? PHASE_A_WRITER_VALIDATION
    : PHASE_C.map(({ sessionId, certificateNumber }) => ({ sessionId, certificateNumber }));
  const operationPreview = await loadRows(prisma, operationInstructions);
  const preview = operationPreview.slice(0, instructions.length);
  const labelConvergencePreview = args.phase === "A"
    ? operationPreview.slice(instructions.length).map(inspectExactPhaseALabelConvergence)
    : [];
  const currentValidation = await writerValidationAudit(prisma, validationManifest);
  console.log(JSON.stringify(report(
    args.apply ? "pre-apply" : "dry-run",
    args.phase,
    args.actorAdminId,
    preview,
    currentValidation,
    labelConvergencePreview,
  ), null, 2));
  if (!args.apply) {
    return {
      mode: "dry-run",
      rows: preview,
      labelOnlyConvergence: labelConvergencePreview,
      ownerReviewFlags: args.phase === "A" ? PHASE_A_OWNER_REVIEW_FLAGS : null,
      writerEquivalentValidation: currentValidation,
    };
  }

  const transactionResult = await prisma.$transaction(async (tx) => {
    await lockExactOperationRows(tx, validationManifest);
    const lockedOperationRows = await loadRows(tx, operationInstructions);
    const locked = lockedOperationRows.slice(0, instructions.length);
    const lockedLabelConvergence = args.phase === "A"
      ? lockedOperationRows.slice(instructions.length)
      : [];
    const applied = await applyLockedCorrectionsBatched(tx, locked, lockedLabelConvergence);
    const verifiedOperationRows = await loadRows(tx, operationInstructions);
    const corrected = verifiedOperationRows.slice(0, instructions.length);
    verifyCorrectionRows(corrected);
    if (args.phase === "A") {
      const convergedLabels = verifiedOperationRows.slice(instructions.length);
      for (const target of convergedLabels) {
        if (inspectExactPhaseALabelConvergence(target).outcome !== "NOOP") {
          throw new Error("TKH-000219 label convergence did not reach its session-authoritative identity");
        }
      }
    }
    const clean = await writerValidation(tx, validationManifest);
    return {
      results: applied.corrections,
      labelConvergenceResults: applied.labelOnlyConvergence,
      clean,
    };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 10_000,
    timeout: CORRECTION_TRANSACTION_TIMEOUT_MS,
  });

  let postCommitClean;
  let postCommitLabelConvergence = [];
  try {
    const verifiedOperationRows = await loadRows(prisma, operationInstructions);
    const verified = verifiedOperationRows.slice(0, instructions.length);
    verifyCorrectionRows(verified);
    if (args.phase === "A") {
      postCommitLabelConvergence = verifiedOperationRows.slice(instructions.length)
        .map(inspectExactPhaseALabelConvergence);
      if (postCommitLabelConvergence.some(({ outcome }) => outcome !== "NOOP")) {
        throw new Error("Post-commit TKH-000219 label convergence is incomplete");
      }
    }
    postCommitClean = await writerValidation(prisma, validationManifest);
    if (stable(postCommitClean) !== stable(transactionResult.clean)) {
      throw new Error("Post-commit writer-equivalent verification changed unexpectedly");
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown verification failure";
    throw new Error(
      `Phase ${args.phase} corrections may already be committed even though post-commit verification failed: ${detail}. ` +
      "Do not assume rollback. Inspect the exact manifest rows and rerun this exact phase safely; the correction writer is idempotent, as is the exact label-convergence write.",
    );
  }
  const result = {
    mode: "apply-complete",
    phase: args.phase,
    authorizedOperator: {
      actorAdminId: args.actorAdminId,
      evidence: "CAPTURED_COMMAND_OUTPUT_ONLY",
      databaseAuditRecordCreated: false,
    },
    correctionCount: transactionResult.results.length,
    corrections: transactionResult.results,
    labelOnlyConvergenceCount: transactionResult.labelConvergenceResults.length,
    labelOnlyConvergence: transactionResult.labelConvergenceResults,
    postCommitLabelConvergence,
    ownerReviewFlags: args.phase === "A" ? PHASE_A_OWNER_REVIEW_FLAGS : null,
    transactionTimeoutMs: CORRECTION_TRANSACTION_TIMEOUT_MS,
    writerEquivalentCleanCount: postCommitClean.length,
    writerEquivalentClean: postCommitClean,
    permanentCardWrites: 0,
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

export async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return usage();
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const prisma = new PrismaClient();
  try {
    return await run(args, prisma);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Unknown approved identity correction failure");
    process.exitCode = 1;
  });
}
