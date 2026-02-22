import type { NextApiRequest } from "next";
import { prisma, SetAuditStatus, type Prisma } from "@tenkings/database";
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
  referenceImages: number;
  drafts: number;
  draftVersions: number;
  approvals: number;
  ingestionJobs: number;
  seedJobs: number;
};

export type SetDeleteImpact = {
  setId: string;
  rowsToDelete: SetDeleteImpactCounts;
  totalRowsToDelete: number;
  auditEventsForSet: number;
};

type SetOpsDbClient = Pick<
  typeof prisma,
  "setDraft" | "setDraftVersion" | "setApproval" | "setIngestionJob" | "setSeedJob" | "setAuditEvent" | "cardVariant" | "cardVariantReferenceImage"
>;

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
  const drafts = await db.setDraft.findMany({
    where: { setId },
    select: { id: true },
  });
  const draftIds = drafts.map((draft) => draft.id);
  const draftFilter = draftIds.length ? { in: draftIds } : null;

  const [cardVariants, referenceImages, draftCount, draftVersions, approvals, ingestionJobs, seedJobs, auditEventsForSet] =
    await Promise.all([
      db.cardVariant.count({ where: { setId } }),
      db.cardVariantReferenceImage.count({ where: { setId } }),
      db.setDraft.count({ where: { setId } }),
      draftFilter ? db.setDraftVersion.count({ where: { draftId: draftFilter } }) : Promise.resolve(0),
      draftFilter ? db.setApproval.count({ where: { draftId: draftFilter } }) : Promise.resolve(0),
      draftFilter ? db.setIngestionJob.count({ where: { draftId: draftFilter } }) : Promise.resolve(0),
      draftFilter ? db.setSeedJob.count({ where: { draftId: draftFilter } }) : Promise.resolve(0),
      db.setAuditEvent.count({ where: { setId } }),
    ]);

  const rowsToDelete: SetDeleteImpactCounts = {
    cardVariants,
    referenceImages,
    drafts: draftCount,
    draftVersions,
    approvals,
    ingestionJobs,
    seedJobs,
  };
  const totalRowsToDelete = Object.values(rowsToDelete).reduce((sum, count) => sum + count, 0);
  return {
    setId,
    rowsToDelete,
    totalRowsToDelete,
    auditEventsForSet,
  };
}
