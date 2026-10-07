import type { KioskDoor, KioskPublicSnapshot, VaultDoorId } from "../types";

// This art-direction slice is deliberately restricted to the synthetic test appliance.
// It is a gallery of exact inventory IDs, not an inferred physical cabinet layout.
export function cinematicPreviewAllowed(
  snapshot: KioskPublicSnapshot,
  search: string,
): boolean {
  return (
    ["cinematic", "portrait"].includes(
      new URLSearchParams(search).get("experience") ?? "",
    ) &&
    snapshot.mode === "CERTIFICATION" &&
    snapshot.machineProfile?.provenance === "SYNTHETIC"
  );
}

export function galleryDoors(
  doors: readonly KioskDoor[],
  productId: string | null,
): KioskDoor[] {
  return doors.filter((door) => door.productId === productId);
}

export function previewRevealIds(snapshot: KioskPublicSnapshot): VaultDoorId[] {
  // Never let a reservation, unknown payment or a local animation imply authorization.
  const sale = snapshot.activeSale;
  if (
    snapshot.mode !== "CERTIFICATION" ||
    snapshot.machineProfile?.provenance !== "SYNTHETIC" ||
    !sale ||
    ![
      "AUTHORIZED",
      "VEND_RESULT_PENDING",
      "SETTLEMENT_PENDING",
      "SETTLED",
    ].includes(sale.paymentState) ||
    ![
      "RETRIEVAL",
      "GROUP_RETRY_AVAILABLE",
      "GROUP_RETRY_COMMITTED",
      "GROUP_RETRY_USED",
      "PAID_RESET_COUNTDOWN",
    ].includes(snapshot.publicState)
  )
    return [];
  return sale.paidDoorIds;
}

export type RenderQuality = "auto" | "rich" | "light";
export interface SceneMetrics {
  fps: number;
  p95: number;
  draws: number;
  triangles: number;
  scale: number;
  quality: string;
}
