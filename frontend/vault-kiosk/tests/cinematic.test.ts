import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import type { VaultMachineProfile } from "@tenkings/vault-contracts/browser";
import {
  cinematicPreviewAllowed,
  galleryDoors,
  previewRevealIds,
} from "../src/cinematic/experience";
import { sale, snapshot } from "./fixtures";
const require = createRequire(import.meta.url);
const { makeSyntheticProfile } =
  require("../../../packages/vault-contracts/tests/profile-fixtures.js") as {
    makeSyntheticProfile(count: number): { profile: VaultMachineProfile };
  };
const fixture = () =>
  snapshot({
    mode: "CERTIFICATION",
    configSchemaVersion: 2,
    machineProfile: makeSyntheticProfile(72).profile,
  });
describe("Cinematic preview authority", () => {
  it("requires an explicit preview URL, certification mode and synthetic provenance", () => {
    const state = fixture();
    expect(cinematicPreviewAllowed(state, "?experience=cinematic")).toBe(true);
    expect(cinematicPreviewAllowed(state, "")).toBe(false);
    expect(cinematicPreviewAllowed(state, "?experience=portrait")).toBe(true);
    expect(
      cinematicPreviewAllowed(
        { ...state, mode: "PRODUCTION" },
        "?experience=portrait",
      ),
    ).toBe(false);
    expect(
      cinematicPreviewAllowed(
        { ...state, machineProfile: null },
        "?experience=portrait",
      ),
    ).toBe(false);
    expect(
      cinematicPreviewAllowed(
        { ...state, mode: "PRODUCTION" },
        "?experience=cinematic",
      ),
    ).toBe(false);
    expect(
      cinematicPreviewAllowed(
        { ...state, machineProfile: null },
        "?experience=cinematic",
      ),
    ).toBe(false);
    expect(
      cinematicPreviewAllowed(
        {
          ...state,
          machineProfile: {
            ...state.machineProfile!,
            provenance: "PHYSICAL" as VaultMachineProfile["provenance"],
          },
        },
        "?experience=cinematic",
      ),
    ).toBe(false);
  });
  it("retains stable IDs, unavailable inventory and service ordering when filtering products", () => {
    const ids = fixture().machineProfile!.doors;
    const doors = [
      {
        doorId: ids[16].doorId,
        state: "AVAILABLE",
        productId: "sports",
        selected: false,
      },
      {
        doorId: ids[0].doorId,
        state: "EMPTY",
        productId: "sports",
        selected: false,
      },
      {
        doorId: ids[8].doorId,
        state: "AVAILABLE",
        productId: "pokemon",
        selected: true,
      },
    ] as const;
    expect(galleryDoors(doors, "sports")).toEqual([doors[0], doors[1]]);
    expect(galleryDoors(doors, "missing")).toEqual([]);
  });
  it("never reveals a reservation or unresolved payment even with stale paid IDs", () => {
    for (const paymentState of [
      "NOT_REQUESTED",
      "REQUESTED",
      "UNKNOWN",
      "DECLINED",
      "CANCELLED",
      "RECONCILIATION_REQUIRED",
    ] as const) {
      expect(
        previewRevealIds({
          ...fixture(),
          publicState: "RETRIEVAL",
          activeSale: { ...sale, paymentState },
        }),
      ).toEqual([]);
    }
    expect(
      previewRevealIds({
        ...fixture(),
        publicState: "UNLOCK_QUEUED",
        activeSale: sale,
      }),
    ).toEqual([]);
  });
  it("reveals only the exact paid set once the synthetic service reports retrieval", () => {
    const state = {
      ...fixture(),
      publicState: "RETRIEVAL" as const,
      activeSale: sale,
    };
    expect(previewRevealIds(state)).toEqual(sale.paidDoorIds);
    expect(previewRevealIds({ ...state, mode: "PRODUCTION" })).toEqual([]);
    expect(previewRevealIds({ ...state, machineProfile: null })).toEqual([]);
  });
});
