import { createHash } from "node:crypto";
import {
  canonicalProductOwnerOperationalAcceptanceIssueLedgerV1,
  canonicalProductOwnerOperationalAcceptancePayloadV1,
  productOwnerOperationalAcceptanceV1Schema,
  validateMathematicalCalibrationForOperationalUseV1 as validateStructure,
  type OperationalCalibrationValidationResultV1,
  type ProductOwnerOperationalAcceptanceV1,
} from "@tenkings/shared";

const SHA256 = /^[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{40}$/;

export function sha256ProductOwnerOperationalAcceptanceBytesV1(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function verifyProductOwnerOperationalAcceptanceV1(
  value: unknown,
  expected?: Readonly<{
    finalizerSha256?: string;
    authorityProducerSha256?: string;
    implementationGitSha?: string;
  }>,
): ProductOwnerOperationalAcceptanceV1 {
  const authority = productOwnerOperationalAcceptanceV1Schema.parse(value);
  const authoritySha256 = sha256ProductOwnerOperationalAcceptanceBytesV1(
    Buffer.from(canonicalProductOwnerOperationalAcceptancePayloadV1(authority), "utf8"),
  );
  const exceptionLedgerSha256 = sha256ProductOwnerOperationalAcceptanceBytesV1(
    Buffer.from(canonicalProductOwnerOperationalAcceptanceIssueLedgerV1(authority.exceptionLedger), "utf8"),
  );
  if (
    authority.authoritySha256 !== authoritySha256 ||
    authority.exceptionLedgerSha256 !== exceptionLedgerSha256
  ) {
    throw new Error("Product-owner operational-acceptance authority content hash does not reproduce.");
  }
  for (const [label, actual, expectedValue] of [
    ["finalizer", authority.implementation.finalizerSha256, expected?.finalizerSha256],
    ["authority producer", authority.implementation.authorityProducerSha256, expected?.authorityProducerSha256],
    ["implementation Git", authority.implementation.implementationGitSha, expected?.implementationGitSha],
  ] as const) {
    const identityPattern = label === "implementation Git" ? GIT_SHA : SHA256;
    if (expectedValue !== undefined && (!identityPattern.test(expectedValue) || actual !== expectedValue)) {
      throw new Error(`Product-owner operational-acceptance ${label} identity does not match.`);
    }
  }
  return authority;
}

export function validateMathematicalCalibrationForOperationalUseV1(
  value: unknown,
): OperationalCalibrationValidationResultV1 {
  const result = validateStructure(value);
  if (
    !result.valid || !result.profile || !result.isOperationallyAccepted ||
    !("operationalAcceptance" in result.profile)
  ) return result;
  try {
    verifyProductOwnerOperationalAcceptanceV1(result.profile.operationalAcceptance);
    return result;
  } catch (error) {
    return {
      valid: false,
      isCalibrated: false,
      isOperationallyAccepted: false,
      issues: [{
        path: "operationalAcceptance.authoritySha256",
        message: error instanceof Error ? error.message : String(error),
      }],
    };
  }
}
