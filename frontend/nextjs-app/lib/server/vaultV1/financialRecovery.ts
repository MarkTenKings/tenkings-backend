import { z } from "zod";
import { type Prisma, vaultPayloadDigest } from "@tenkings/database";
import { VaultFinancialRecoverySnapshotSchema, VaultFinancialRecoveryDecisionSchema, VaultFinancialRecoveryAppliedSchema,
  VaultFinancialRecoverySupersededSchema, VaultPaymentVoidRetiredSchema, VaultPaymentVoidActionSchema, type VaultFinancialRecoverySnapshot } from "@tenkings/vault-contracts";
import { VaultApiError } from "./http";
import { vaultPaymentActionAdminDto } from "./paymentActions";

export const VaultFinancialRecoveryApprovalSchema = z.object({
  decisionId: z.string().uuid(), machineId: z.string().uuid(), snapshotId: z.string().uuid(), generation: z.number().int().positive(), stateDigest: z.string().regex(/^[a-f0-9]{64}$/),
  noticeIds: z.array(z.string().min(1).max(256)).max(100), unknownActionIds: z.array(z.string().uuid()).max(100),
  evidenceReference: z.string().trim().min(8).max(256), evidenceDigest: z.string().regex(/^[a-f0-9]{64}$/), reason: z.string().trim().min(8).max(500), confirmReviewed: z.literal(true),
}).strict();
const sameIds = (a: string[], b: string[]) => vaultPayloadDigest([...a].sort()) === vaultPayloadDigest([...b].sort());
const invalid = (code: string) => new VaultApiError(409, `FINANCIAL_RECOVERY_${code}`, "Review the current machine evidence before authorizing financial recovery.");

export function prepareFinancialRecoveryDecision(snapshot: VaultFinancialRecoverySnapshot, input: z.infer<typeof VaultFinancialRecoveryApprovalSchema>, adminId: string, now = new Date()) {
  if (snapshot.machineId !== input.machineId || snapshot.snapshotId !== input.snapshotId || snapshot.generation !== input.generation || snapshot.stateDigest !== input.stateDigest
    || snapshot.blockers.length || !sameIds(snapshot.noticeIds, input.noticeIds) || !sameIds(snapshot.unknownActionIds, input.unknownActionIds)
    || !input.noticeIds.length && !input.unknownActionIds.length) throw invalid("SNAPSHOT_CHANGED_OR_BLOCKED");
  const { confirmReviewed: _confirmation, ...fields } = input;
  return VaultFinancialRecoveryDecisionSchema.parse({ ...fields, noticeIds: [...input.noticeIds].sort(), unknownActionIds: [...input.unknownActionIds].sort(),
    approvedByAdminId: adminId, approvedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 300000).toISOString() });
}

export async function financialRecoveryHints(tx: Prisma.TransactionClient, machineId: string, now = new Date()) {
  const rows = await tx.vaultFinancialRecoveryDecision.findMany({ where: { machineId, state: "APPROVED", expiresAt: { gt: now } }, orderBy: { approvedAt: "asc" }, take: 101 });
  if (rows.length > 100) throw invalid("DECISION_LIMIT");
  return { instruction: "FINANCIAL_RECOVERY_ONLY" as const, decisions: rows.map(row => {
    const decision = VaultFinancialRecoveryDecisionSchema.parse(row.decision);
    if (decision.machineId !== machineId || decision.decisionId !== row.id) throw invalid("DECISION_BINDING_INVALID");
    return decision;
  }) };
}

/** Server receipt age is observational: an idle terminal may legitimately have
 * no recent callback. It is never proof of a missing, delayed or unpaid sale. */
export async function financialRecoveryOperationalSummary(tx: Prisma.TransactionClient, machineId: string, now = new Date()) {
  const [receipts, actions] = await Promise.all([
    tx.vaultSparkObservation.aggregate({ where: { machineId }, _count: { _all: true }, _max: { receivedAt: true, receiptSequence: true } }),
    tx.vaultPaymentAction.aggregate({ where: { machineId, externalReviewedAt: null, state: { in: ["APPROVED", "EXECUTING", "UNKNOWN"] } }, _count: { _all: true }, _min: { approvedAt: true } }),
  ]);
  const age = (at: Date | null) => at && Number.isFinite(at.getTime()) && now.getTime() >= at.getTime() ? Math.floor((now.getTime() - at.getTime()) / 1000) : null;
  return { observedAt: now.toISOString(), callbacks: { receiptCount: receipts._count._all,
    latestReceivedAt: receipts._max.receivedAt?.toISOString() ?? null, secondsSinceLatestReceipt: age(receipts._max.receivedAt),
    latestReceiptSequence: receipts._max.receiptSequence?.toString() ?? null },
    pendingActions: { count: actions._count._all, oldestApprovedAt: actions._min.approvedAt?.toISOString() ?? null, oldestApprovalAgeSeconds: age(actions._min.approvedAt) },
    timingMeaning: "Receipt age measures time since the cloud received a callback. An idle terminal may have no recent receipt; age alone does not establish a missing callback or payment outcome." };
}

export async function financialRecoveryAdminView(tx: Prisma.TransactionClient, machineId: string) {
  const latest = await tx.vaultFinancialRecoverySnapshot.findFirst({ where: { machineId }, orderBy: { generation: "desc" } });
  const snapshot = latest ? VaultFinancialRecoverySnapshotSchema.parse(latest.snapshot) : null;
  const actions = await tx.vaultPaymentAction.findMany({ where: { machineId }, orderBy: { approvedAt: "desc" }, take: 100 });
  const notices = await tx.vaultPaymentEvidenceAnomaly.findMany({ where: { machineId }, orderBy: { occurredAt: "desc" }, take: 100,
    select: { noticeId: true, saleId: true, code: true, amountCents: true, currency: true, captureConfirmed: true, occurredAt: true, resolvedAt: true } });
  const unresolvedOrphanCount = await tx.vaultPaymentEvidenceAnomaly.count({ where: { machineId, saleId: null, resolvedAt: null } });
  const decisions = await tx.vaultFinancialRecoveryDecision.findMany({ where: { machineId }, orderBy: { approvedAt: "desc" }, take: 100 });
  const operationalSummary = await financialRecoveryOperationalSummary(tx, machineId);
  return { machineId, operationalSummary, snapshot, snapshotReceivedAt: latest?.receivedAt ?? null, actions: actions.map(vaultPaymentActionAdminDto), notices, unresolvedOrphanCount,
    decisions: decisions.map(row => ({ ...VaultFinancialRecoveryDecisionSchema.parse(row.decision), state: row.state, appliedAt: row.appliedAt })),
    financialEvidencePolicy: "External human review does not establish provider-confirmed funds or release inventory.", truncatedAt: 100 };
}

export async function projectFinancialRecoverySnapshot(tx: Prisma.TransactionClient, machineId: string, payload: unknown) {
  const snapshot = VaultFinancialRecoverySnapshotSchema.parse(payload);
  if (snapshot.machineId !== machineId) throw invalid("MACHINE_MISMATCH");
  const existing = await tx.vaultFinancialRecoverySnapshot.findUnique({ where: { machineId_generation: { machineId, generation: snapshot.generation } } });
  if (existing) {
    if (existing.id !== snapshot.snapshotId || vaultPayloadDigest(existing.snapshot) !== vaultPayloadDigest(snapshot)) throw invalid("SNAPSHOT_CONFLICT");
    return;
  }
  const latest = await tx.vaultFinancialRecoverySnapshot.findFirst({ where: { machineId }, orderBy: { generation: "desc" } });
  if (latest && snapshot.generation <= latest.generation) throw invalid("GENERATION_ROLLBACK");
  await tx.vaultFinancialRecoverySnapshot.create({ data: { id: snapshot.snapshotId, machineId, generation: snapshot.generation, stateDigest: snapshot.stateDigest, snapshot: snapshot as Prisma.InputJsonValue } });
}

export async function projectFinancialRecoveryApplied(tx: Prisma.TransactionClient, machineId: string, payload: unknown, occurredAt: Date) {
  const outcome = VaultFinancialRecoveryAppliedSchema.parse(payload);
  const row = await tx.vaultFinancialRecoveryDecision.findUnique({ where: { id: outcome.decisionId } });
  if (!row || row.machineId !== machineId) throw invalid("APPROVAL_MISSING");
  const decision = VaultFinancialRecoveryDecisionSchema.parse(row.decision);
  if (decision.snapshotId !== outcome.snapshotId || decision.stateDigest !== outcome.stateDigest || decision.generation !== outcome.generation
    || !sameIds(decision.noticeIds, outcome.noticeIds) || !sameIds(decision.unknownActionIds, outcome.unknownActionIds)
    || decision.evidenceDigest !== outcome.evidenceDigest || decision.evidenceReference !== outcome.evidenceReference
    || Date.parse(outcome.startedAt) < row.approvedAt.getTime() || Date.parse(outcome.startedAt) > row.expiresAt.getTime() || Date.parse(outcome.startedAt) > occurredAt.getTime()) throw invalid("APPROVAL_MISMATCH");
  if (row.state === "APPLIED") return;
  if (row.state !== "APPROVED") throw invalid("APPROVAL_SUPERSEDED");
  for (const actionId of outcome.unknownActionIds) {
    const action = await tx.vaultPaymentAction.findUnique({ where: { id: actionId } });
    if (!action || action.machineId !== machineId || action.state !== "UNKNOWN" || action.externalReviewedAt) throw invalid("VOID_STATE_CHANGED");
    await tx.vaultPaymentAction.update({ where: { id: actionId }, data: { externalReviewedAt: occurredAt, externalReview: outcome as Prisma.InputJsonValue } });
  }
  await tx.vaultPaymentEvidenceAnomaly.updateMany({ where: { machineId, noticeId: { in: outcome.noticeIds }, resolvedAt: null }, data: { resolvedAt: occurredAt } });
  await tx.vaultFinancialRecoveryDecision.update({ where: { id: row.id }, data: { state: "APPLIED", appliedAt: occurredAt } });
}

export async function projectVoidRetiredUnstarted(tx: Prisma.TransactionClient, machineId: string, payload: unknown, occurredAt: Date) {
  const proof = VaultPaymentVoidRetiredSchema.parse(payload);
  const row = await tx.vaultPaymentAction.findUnique({ where: { id: proof.actionId } });
  if (!row || row.machineId !== machineId) throw invalid("RETIREMENT_ACTION_MISSING");
  const action = VaultPaymentVoidActionSchema.parse(row.action);
  if (proof.actionDigest !== vaultPayloadDigest(action) || proof.saleId !== action.saleId || proof.paymentBindingDigest !== action.paymentBindingDigest || proof.expiresAt !== action.expiresAt
    || Date.parse(proof.retiredAt) < row.expiresAt.getTime() || Date.parse(proof.retiredAt) > occurredAt.getTime()) throw invalid("RETIREMENT_BINDING_INVALID");
  if (row.state === "RETIRED_UNSTARTED") {
    if (vaultPayloadDigest(row.retirementProof) !== vaultPayloadDigest(proof)) throw invalid("RETIREMENT_CONFLICT");
    return;
  }
  if (row.state !== "APPROVED" || row.intentObservedAt || row.outcomeObservedAt || row.externalReviewedAt) throw invalid("RETIREMENT_STARTED");
  await tx.vaultPaymentAction.update({ where: { id: row.id }, data: { state: "RETIRED_UNSTARTED", saleId: null, retiredAt: new Date(proof.retiredAt), retirementProof: proof as Prisma.InputJsonValue } });
}

export async function projectFinancialRecoverySuperseded(tx: Prisma.TransactionClient, machineId: string, payload: unknown) {
  const outcome = VaultFinancialRecoverySupersededSchema.parse(payload);
  const row = await tx.vaultFinancialRecoveryDecision.findUnique({ where: { id: outcome.decisionId } });
  if (!row || row.machineId !== machineId) throw invalid("APPROVAL_MISSING");
  const decision = VaultFinancialRecoveryDecisionSchema.parse(row.decision);
  const current = await tx.vaultFinancialRecoverySnapshot.findUnique({ where: { id: outcome.currentSnapshotId } });
  if (decision.snapshotId !== outcome.snapshotId || decision.stateDigest !== outcome.stateDigest || decision.generation !== outcome.generation
    || !current || current.machineId !== machineId || current.stateDigest !== outcome.currentStateDigest) throw invalid("APPROVAL_MISMATCH");
  if (row.state === "SUPERSEDED") return;
  if (row.state !== "APPROVED") throw invalid("APPROVAL_ALREADY_APPLIED");
  await tx.vaultFinancialRecoveryDecision.update({ where: { id: row.id }, data: { state: "SUPERSEDED" } });
}
