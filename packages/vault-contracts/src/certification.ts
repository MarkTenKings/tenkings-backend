import { z } from "zod";
import { VaultDoorIdSchema } from "./doors";
import { VaultRoleSchema } from "./domain";

export const CERTIFICATION_PURCHASE_CYCLES_PER_DOOR = 5;
export const CERTIFICATION_RESTOCK_CYCLES_PER_DOOR = 2;
export const CERTIFICATION_HUMAN_SESSIONS = 500;
export const CERTIFICATION_AUTOMATED_TRANSACTIONS = 1000;
export const CERTIFICATION_RETENTION_AFTER_SERVICE_YEARS = 3;

export const VaultCertificationOutcomeSchema = z.enum(["PASS", "FAIL", "CRITICAL"]);
export const VaultCertificationEvidenceSchema = z.object({
  evidenceId: z.string().uuid(),
  sessionId: z.string().uuid(),
  doorId: VaultDoorIdSchema.optional(),
  evidenceClass: z.enum(["AUTOMATED", "OFFICIAL_SDK", "BENCH", "FULL_MACHINE", "FIELD"]),
  outcome: VaultCertificationOutcomeSchema,
  expectedDoorIds: z.array(VaultDoorIdSchema),
  observedDoorIds: z.array(VaultDoorIdSchema),
  notes: z.string().max(4000),
  artifactDigest: z.string().regex(/^[a-f0-9]{64}$/),
  observedAt: z.string().datetime(),
});

export function nextUnderTestedDoor(
  counts: Readonly<Record<string, number>>,
  canonicalDoorIds: readonly string[],
): string {
  if (!canonicalDoorIds.length) throw new Error("At least one door is required");
  return [...canonicalDoorIds].sort((a, b) => (counts[a] ?? 0) - (counts[b] ?? 0) || a.localeCompare(b))[0];
}

export function mayApproveCertification(role: z.infer<typeof VaultRoleSchema>): boolean {
  return role === "TECHNICIAN" || role === "ADMIN";
}
