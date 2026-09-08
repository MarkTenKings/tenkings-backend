import type { CertificationStatus } from "../types";

export function observationEvidenceClass(status: CertificationStatus | null): "AUTOMATED" | "FULL_MACHINE" | null {
  // Older service DTOs only prove simulator provenance when payment is MOCK.
  // Official payment alone cannot establish the controller's evidence class.
  if (status?.adapterMode === "MOCK") return "AUTOMATED";
  return status?.observationEvidenceClass === "AUTOMATED" || status?.observationEvidenceClass === "FULL_MACHINE"
    ? status.observationEvidenceClass : null;
}
