import type { NextApiRequest } from "next";
import { prisma, SetAuditStatus, type Prisma } from "@tenkings/database";
import { normalizeSetLabel } from "@tenkings/shared";
import type { AdminSession } from "./admin";

export type SetOpsRole = "reviewer" | "approver" | "delete" | "admin";

type RoleConfig = {
  userIds: Set<string>;
  phones: Set<string>;
  configured: boolean;
};

export type SetOpsAuditEventInput = {
  req: NextApiRequest;
  admin: AdminSession | null;
  action: string;
  status: SetAuditStatus;
  setId?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
  draftId?: string | null;
  draftVersionId?: string | null;
  ingestionJobId?: string | null;
  approvalId?: string | null;
  seedJobId?: string | null;
};

export type SetDeleteImpactCounts = {
  cardVariants: number;
  cardVariantTaxonomyMaps: number;
  referenceImages: number;
  drafts: number;
  draftVersions: number;
  approvals: number;
  ingestionJobs: number;
  seedJobs: number;
  setReplaceJobs: number;
  taxonomySources: number;
  programs: number;
  cards: number;
  variations: number;
  parallels: number;
  parallelScopes: number;
  oddsRows: number;
  taxonomyConflicts: number;
  taxonomyAmbiguities: number;
  auditEvents: number;
  ocrFeedbackEvents: number;
  ocrFeedbackMemoryRows: number;
  ocrRegionTemplates: number;
  ocrRegionTeachEvents: number;
};

export type SetDeleteImpact = {
  setId: string;
  rowsToDelete: SetDeleteImpactCounts;
  totalRowsToDelete: number;
  auditEventsForSet: number;
};

type SetOpsDbClient = Pick<
  Prisma.TransactionClient,
  | "setDraft"
  | "setDraftVersion"
  | "setApproval"
  | "setIngestionJob"
  | "setSeedJob"
  | "setAuditEvent"
  | "cardVariant"
  | "cardVariantTaxonomyMap"
  | "cardVariantReferenceImage"
  | "setReplaceJob"
  | "setTaxonomySource"
  | "setProgram"
  | "setCard"
  | "setVariation"
  | "setParallel"
  | "setParallelScope"
  | "setOddsByFormat"
  | "setTaxonomyConflict"
  | "setTaxonomyAmbiguityQueue"
  | "ocrFeedbackEvent"
  | "ocrFeedbackMemoryAggregate"
  | "ocrRegionTemplate"
  | "ocrRegionTeachEvent"
>;

const asEntityVariants = (value: string) => {
  if (!value.includes("&")) return [];
  return [value.replace(/&/g, "&amp;"), value.replace(/&/g, "&#038;"), value.replace(/&/g, "&#38;")];
};

function buildSetDeleteTargets(setId: string) {
  const normalizedSetId = normalizeSetLabel(setId);
  const rawSetId = String(setId || "").trim();

  const setIdCandidates = Array.from(
    new Set(
      [rawSetId, normalizedSetId]
        .filter(Boolean)
        .flatMap((candidate) => [candidate, ...asEntityVariants(candidate)])
        .map((candidate) => normalizeSetLabel(candidate))
        .filter(Boolean)
    )
  );
  const setIdKeyCandidates = Array.from(new Set(setIdCandidates.map((candidate) => candidate.toLowerCase())));

  return {
    setId: normalizedSetId || rawSetId,
    setIdCandidates,
    setIdKeyCandidates,
  };
}

const ROLE_ENV: Record<SetOpsRole, { ids: string; phones: string }> = {
  reviewer: { ids: "SET_OPS_REVIEWER_USER_IDS", phones: "SET_OPS_REVIEWER_PHONES" },
  approver: { ids: "SET_OPS_APPROVER_USER_IDS", phones: "SET_OPS_APPROVER_PHONES" },
  delete: { ids: "SET_OPS_DELETE_USER_IDS", phones: "SET_OPS_DELETE_PHONES" },
  admin: { ids: "SET_OPS_ADMIN_USER_IDS", phones: "SET_OPS_ADMIN_PHONES" },
};

const normalizePhone = (value: string) => {
  const digits = value.replace(/[^0-9]/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
};

const parseSet = (value: string | undefined) =>
  new Set(
    String(value || "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
  );

const parsePhoneSet = (value: string | undefined) =>
  new Set(
    String(value || "")
      .split(",")
      .map((entry) => normalizePhone(entry.trim()))
      .filter(Boolean)
  );

const buildRoleConfig = (role: SetOpsRole): RoleConfig => {
  const env = ROLE_ENV[role];
  const userIds = parseSet(process.env[env.ids]);
  const phones = parsePhoneSet(process.env[env.phones]);
  return {
    userIds,
    phones,
    configured: userIds.size > 0 || phones.size > 0,
  };
};

const ROLE_CONFIG: Record<SetOpsRole, RoleConfig> = {
  reviewer: buildRoleConfig("reviewer"),
  approver: buildRoleConfig("approver"),
  delete: buildRoleConfig("delete"),
  admin: buildRoleConfig("admin"),
};

const roleMatches = (admin: AdminSession, role: SetOpsRole) => {
  const config = ROLE_CONFIG[role];
  if (config.userIds.has(admin.user.id)) return true;
  const phone = normalizePhone(String(admin.user.phone || ""));
  if (phone && config.phones.has(phone)) return true;
  return false;
};

const roleConfigured = (role: SetOpsRole) => ROLE_CONFIG[role].configured;

export function canPerformSetOpsRole(admin: AdminSession, role: SetOpsRole) {
  if (roleMatches(admin, role)) return true;
  if (role !== "admin" && roleMatches(admin, "admin")) return true;
  if (!roleConfigured(role) && !roleConfigured("admin")) return true;
  return false;
}

export function roleDeniedMessage(role: SetOpsRole) {
  if (role === "reviewer") return "Set Ops reviewer role required";
  if (role === "approver") return "Set Ops approver role required";
  if (role === "delete") return "Set Ops delete role required";
  return "Set Ops admin role required";
}

function firstHeaderValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}

export async function writeSetOpsAuditEvent(input: SetOpsAuditEventInput) {
  const forwardedFor = firstHeaderValue(input.req.headers["x-forwarded-for"]);
  const ipAddress = forwardedFor.split(",")[0]?.trim() || input.req.socket.remoteAddress || null;
  const userAgent = firstHeaderValue(input.req.headers["user-agent"]) || null;
  const requestId = firstHeaderValue(input.req.headers["x-request-id"]) || null;

  try {
    const event = await prisma.setAuditEvent.create({
      data: {
        setId: input.setId ?? null,
        draftId: input.draftId ?? null,
        draftVersionId: input.draftVersionId ?? null,
        ingestionJobId: input.ingestionJobId ?? null,
        approvalId: input.approvalId ?? null,
        seedJobId: input.seedJobId ?? null,
        actorId: input.admin?.user.id ?? null,
        action: input.action,
        status: input.status,
        reason: input.reason ?? null,
        requestId,
        ipAddress,
        userAgent,
        metadataJson: (input.metadata ?? null) as Prisma.InputJsonValue,
      },
      select: { id: true, createdAt: true, status: true, action: true },
    });
    return event;
  } catch (error) {
    console.error("[set-ops-audit] failed to persist event", error);
    return null;
  }
}

export async function computeSetDeleteImpact(db: SetOpsDbClient, setId: string): Promise<SetDeleteImpact> {
  const { setId: normalizedSetId, setIdCandidates, setIdKeyCandidates } = buildSetDeleteTargets(setId);
  if (setIdCandidates.length < 1) {
    return {
      setId: normalizedSetId,
      rowsToDelete: {
        cardVariants: 0,
        cardVariantTaxonomyMaps: 0,
        referenceImages: 0,
        drafts: 0,
        draftVersions: 0,
        approvals: 0,
        ingestionJobs: 0,
        seedJobs: 0,
        setReplaceJobs: 0,
        taxonomySources: 0,
        programs: 0,
        cards: 0,
        variations: 0,
        parallels: 0,
        parallelScopes: 0,
        oddsRows: 0,
        taxonomyConflicts: 0,
        taxonomyAmbiguities: 0,
        auditEvents: 0,
        ocrFeedbackEvents: 0,
        ocrFeedbackMemoryRows: 0,
        ocrRegionTemplates: 0,
        ocrRegionTeachEvents: 0,
      },
      totalRowsToDelete: 0,
      auditEventsForSet: 0,
    };
  }

  const drafts = await db.setDraft.findMany({
    where: { setId: { in: setIdCandidates } },
    select: { id: true },
  });
  const draftIds = drafts.map((draft) => draft.id);
  const draftFilter = draftIds.length ? { in: draftIds } : null;

  const [
    cardVariants,
    cardVariantTaxonomyMaps,
    referenceImages,
    draftCount,
    draftVersions,
    approvals,
    ingestionJobs,
    seedJobs,
    setReplaceJobs,
    taxonomySources,
    programs,
    cards,
    variations,
    parallels,
    parallelScopes,
    oddsRows,
    taxonomyConflicts,
    taxonomyAmbiguities,
    auditEventsForSet,
    ocrFeedbackEvents,
    ocrFeedbackMemoryRows,
    ocrRegionTemplates,
    ocrRegionTeachEvents,
  ] = await Promise.all([
    db.cardVariant.count({ where: { setId: { in: setIdCandidates } } }),
    db.cardVariantTaxonomyMap.count({ where: { setId: { in: setIdCandidates } } }),
    db.cardVariantReferenceImage.count({ where: { setId: { in: setIdCandidates } } }),
    db.setDraft.count({ where: { setId: { in: setIdCandidates } } }),
    draftFilter ? db.setDraftVersion.count({ where: { draftId: draftFilter } }) : Promise.resolve(0),
    draftFilter ? db.setApproval.count({ where: { draftId: draftFilter } }) : Promise.resolve(0),
    draftFilter ? db.setIngestionJob.count({ where: { draftId: draftFilter } }) : Promise.resolve(0),
    draftFilter ? db.setSeedJob.count({ where: { draftId: draftFilter } }) : Promise.resolve(0),
    db.setReplaceJob.count({ where: { setId: { in: setIdCandidates } } }),
    db.setTaxonomySource.count({ where: { setId: { in: setIdCandidates } } }),
    db.setProgram.count({ where: { setId: { in: setIdCandidates } } }),
    db.setCard.count({ where: { setId: { in: setIdCandidates } } }),
    db.setVariation.count({ where: { setId: { in: setIdCandidates } } }),
    db.setParallel.count({ where: { setId: { in: setIdCandidates } } }),
    db.setParallelScope.count({ where: { setId: { in: setIdCandidates } } }),
    db.setOddsByFormat.count({ where: { setId: { in: setIdCandidates } } }),
    db.setTaxonomyConflict.count({ where: { setId: { in: setIdCandidates } } }),
    db.setTaxonomyAmbiguityQueue.count({ where: { setId: { in: setIdCandidates } } }),
    db.setAuditEvent.count({ where: { setId: { in: setIdCandidates } } }),
    db.ocrFeedbackEvent.count({ where: { setId: { in: setIdCandidates } } }),
    db.ocrFeedbackMemoryAggregate.count({
      where: {
        OR: [{ setId: { in: setIdCandidates } }, { setIdKey: { in: setIdKeyCandidates } }],
      },
    }),
    db.ocrRegionTemplate.count({
      where: {
        OR: [{ setId: { in: setIdCandidates } }, { setIdKey: { in: setIdKeyCandidates } }],
      },
    }),
    db.ocrRegionTeachEvent.count({
      where: {
        OR: [{ setId: { in: setIdCandidates } }, { setIdKey: { in: setIdKeyCandidates } }],
      },
    }),
  ]);

  const rowsToDelete: SetDeleteImpactCounts = {
    cardVariants,
    cardVariantTaxonomyMaps,
    referenceImages,
    drafts: draftCount,
    draftVersions,
    approvals,
    ingestionJobs,
    seedJobs,
    setReplaceJobs,
    taxonomySources,
    programs,
    cards,
    variations,
    parallels,
    parallelScopes,
    oddsRows,
    taxonomyConflicts,
    taxonomyAmbiguities,
    auditEvents: auditEventsForSet,
    ocrFeedbackEvents,
    ocrFeedbackMemoryRows,
    ocrRegionTemplates,
    ocrRegionTeachEvents,
  };
  const totalRowsToDelete = Object.values(rowsToDelete).reduce((sum, count) => sum + count, 0);
  return {
    setId: normalizedSetId,
    rowsToDelete,
    totalRowsToDelete,
    auditEventsForSet,
  };
}

export async function performSetDelete(db: SetOpsDbClient, setId: string): Promise<SetDeleteImpact> {
  const impact = await computeSetDeleteImpact(db, setId);
  const { setIdCandidates, setIdKeyCandidates } = buildSetDeleteTargets(setId);

  if (setIdCandidates.length < 1) {
    return impact;
  }

  await db.cardVariantReferenceImage.deleteMany({
    where: {
      setId: { in: setIdCandidates },
    },
  });
  await db.cardVariantTaxonomyMap.deleteMany({
    where: {
      setId: { in: setIdCandidates },
    },
  });
  await db.cardVariant.deleteMany({
    where: {
      setId: { in: setIdCandidates },
    },
  });
  await db.setReplaceJob.deleteMany({
    where: {
      setId: { in: setIdCandidates },
    },
  });
  await db.setTaxonomyAmbiguityQueue.deleteMany({
    where: {
      setId: { in: setIdCandidates },
    },
  });
  await db.setTaxonomyConflict.deleteMany({
    where: {
      setId: { in: setIdCandidates },
    },
  });
  await db.setOddsByFormat.deleteMany({
    where: {
      setId: { in: setIdCandidates },
    },
  });
  await db.setParallelScope.deleteMany({
    where: {
      setId: { in: setIdCandidates },
    },
  });
  await db.setVariation.deleteMany({
    where: {
      setId: { in: setIdCandidates },
    },
  });
  await db.setCard.deleteMany({
    where: {
      setId: { in: setIdCandidates },
    },
  });
  await db.setParallel.deleteMany({
    where: {
      setId: { in: setIdCandidates },
    },
  });
  await db.setProgram.deleteMany({
    where: {
      setId: { in: setIdCandidates },
    },
  });
  await db.setTaxonomySource.deleteMany({
    where: {
      setId: { in: setIdCandidates },
    },
  });
  await db.setIngestionJob.deleteMany({
    where: {
      setId: { in: setIdCandidates },
    },
  });
  await db.setDraft.deleteMany({
    where: {
      setId: { in: setIdCandidates },
    },
  });
  await db.setAuditEvent.deleteMany({
    where: {
      setId: { in: setIdCandidates },
    },
  });
  await db.ocrFeedbackEvent.deleteMany({
    where: {
      setId: { in: setIdCandidates },
    },
  });
  await db.ocrFeedbackMemoryAggregate.deleteMany({
    where: {
      OR: [{ setId: { in: setIdCandidates } }, { setIdKey: { in: setIdKeyCandidates } }],
    },
  });
  await db.ocrRegionTemplate.deleteMany({
    where: {
      OR: [{ setId: { in: setIdCandidates } }, { setIdKey: { in: setIdKeyCandidates } }],
    },
  });
  await db.ocrRegionTeachEvent.deleteMany({
    where: {
      OR: [{ setId: { in: setIdCandidates } }, { setIdKey: { in: setIdKeyCandidates } }],
    },
  });

  return impact;
}
