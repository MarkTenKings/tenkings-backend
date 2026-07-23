import type {
  AiGraderCalibrationActivationRegistryProjectionV1,
  AiGraderCalibrationActivationResolvedTrustedResponseV1,
  AiGraderCalibrationActivationStatusResponseV1,
} from "./aiGraderCalibrationActivationClient";

type HostedStatus = AiGraderCalibrationActivationStatusResponseV1;

export type AiGraderCalibrationRegistryResolutionV1 = {
  source: "exact_local_session" | "sole_hosted_trusted_snapshot";
  registry: AiGraderCalibrationActivationRegistryProjectionV1;
  status: HostedStatus;
};

export type AiGraderCalibrationRegistryResolverDependenciesV1 = {
  readLocalRigId(): Promise<string | undefined>;
  listByRigId(rigId: string): Promise<{ registry: AiGraderCalibrationActivationRegistryProjectionV1 }>;
  readStatusByRigId(rigId: string): Promise<AiGraderCalibrationActivationStatusResponseV1>;
  resolveSoleHostedTrusted(): Promise<AiGraderCalibrationActivationResolvedTrustedResponseV1>;
};

function assertExactProjection(
  registry: AiGraderCalibrationActivationRegistryProjectionV1,
  status: HostedStatus,
) {
  if (registry.registryRevision !== status.registryRevision) {
    throw new Error("Hosted registry changed while loading. Refresh before selecting a calibration.");
  }
}

export async function resolveAiGraderCalibrationRegistryForConsoleV1(
  dependencies: AiGraderCalibrationRegistryResolverDependenciesV1,
): Promise<AiGraderCalibrationRegistryResolutionV1> {
  let localRigId: string | undefined;
  try {
    localRigId = (await dependencies.readLocalRigId())?.trim() || undefined;
  } catch {
    localRigId = undefined;
  }
  if (localRigId) {
    const [listed, statusResponse] = await Promise.all([
      dependencies.listByRigId(localRigId),
      dependencies.readStatusByRigId(localRigId),
    ]);
    if (listed.registry.rigId !== localRigId) {
      throw new Error("The hosted registry did not match the exact local-session rig identity.");
    }
    assertExactProjection(listed.registry, statusResponse);
    return { source: "exact_local_session", registry: listed.registry, status: statusResponse };
  }

  const resolved = await dependencies.resolveSoleHostedTrusted();
  assertExactProjection(resolved.registry, resolved.status);
  const eligibleTrusted = resolved.registry.snapshots.filter((snapshot) =>
    snapshot.trustStatus === "TRUSTED" && snapshot.activationEligible);
  if (
    eligibleTrusted.length !== 1 ||
    eligibleTrusted[0]?.rigId !== resolved.registry.rigId ||
    resolved.registry.activeActivationId !== null ||
    resolved.registry.pendingActivationId !== null ||
    resolved.registry.activations.length !== 0 ||
    resolved.status.active !== null ||
    resolved.status.pending !== null ||
    resolved.status.authority !== null
  ) {
    throw new Error("Hosted trusted-snapshot resolution was ambiguous or already had competing activation authority.");
  }
  return {
    source: "sole_hosted_trusted_snapshot",
    registry: resolved.registry,
    status: resolved.status,
  };
}
