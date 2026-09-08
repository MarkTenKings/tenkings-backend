const { createHash, randomUUID, sign } = require("node:crypto");
const vault = require("../dist");

/** Generated software fixtures only. Dimensions, models and wiring do not describe a cabinet. */
function makeSyntheticProfile(count = 72) {
  if (!Number.isInteger(count) || count < 1 || count > vault.VAULT_MAX_PROFILE_DOORS) throw new RangeError("Unsupported synthetic fixture count");
  const rows = Math.ceil(count / 4);
  const doors = Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / 4), column = index % 4;
    const widths = row % 2 ? [105, 75, 75, 105] : [75, 105, 105, 75];
    const x = [0, widths[0], 380, 380 + widths[2]][column];
    return {
      doorId: `door-${String(index + 1).padStart(4, "0")}`,
      label: `D${index + 1}`,
      displayRect: { x, y: row * 60, width: widths[column], height: 55 },
      openingMm: { width: widths[column] - 10, height: 45 },
      usableCompartmentMm: { width: widths[column] - 12, height: 43, depth: row % 2 ? 180 : 220 },
    };
  });
  const endpoints = Array.from({ length: Math.ceil(count / 64) }, (_, index) => ({ endpointId: `sim-board-${index + 1}`, channelCount: 64 }));
  const profile = {
    schemaVersion: 1, profileId: `synthetic-mixed-${count}`, modelId: "software-fixture", revision: 1,
    provenance: "SYNTHETIC", cabinetMm: { width: 600, height: Math.max(300, rows * 60 + 50), depth: 260 },
    display: { width: 560, height: rows * 60, cutouts: [
      { id: "touch", kind: "TOUCHSCREEN", rect: { x: 190, y: 0, width: 180, height: rows * 30 } },
      { id: "payment", kind: "PAYMENT_TERMINAL", rect: { x: 190, y: rows * 30, width: 85, height: rows * 30 } },
      { id: "display", kind: "PRODUCT_DISPLAY", rect: { x: 285, y: rows * 30, width: 85, height: rows * 30 } },
    ] },
    doors,
    controller: { interfaceVersion: "vault-controller-v1", adapterId: "ten-kings-deterministic-controller-simulator", maxDoors: count, endpoints },
    hardware: {
      computerModel: "SYNTHETIC SER test identity", os: "SYNTHETIC Windows test identity",
      lockModel: "SYNTHETIC lock", paymentTerminalModel: "SYNTHETIC Nayax contract mock",
      touchscreen: { model: "SYNTHETIC ViewSonic touch", orientation: "PORTRAIT", widthPx: 1080, heightPx: 1920, scalePercent: 100, touch: true },
      tv: { model: "SYNTHETIC ViewSonic TV", orientation: "LANDSCAPE", widthPx: 1920, heightPx: 1080, scalePercent: 100, touch: false },
    },
    productFitPolicy: "OPERATOR_CONFIRMED", evidence: null,
  };
  // Allocate an explicitly synthetic address ledger in hash order, separately from display position.
  const shuffled = [...doors].sort((a, b) => createHash("sha256").update(a.doorId).digest("hex").localeCompare(createHash("sha256").update(b.doorId).digest("hex")));
  const doorMapping = shuffled.map((door, index) => ({ doorId: door.doorId, controllerEndpointId: endpoints[Math.floor(index / 64)].endpointId, controllerChannel: index % 64 + 1 }));
  return { profile: vault.VaultMachineProfileSchema.parse(profile), doorMapping };
}

function makeSyntheticConfig(machineId = randomUUID(), version = 1, privateKey, count = 72) {
  const { profile, doorMapping } = makeSyntheticProfile(count);
  const payload = vault.VaultConfigPayloadSchema.parse({
    schemaVersion: 2, version, machineId, machineProfile: profile,
    timezone: "America/Los_Angeles", city: "Synthetic City", state: "CA", taxRateBasisPoints: 825, taxCalculationVersion: vault.VAULT_TAX_CALCULATION_VERSION,
    products: [{ id: "sports-25", name: "Synthetic sports pack", photoUrl: "https://example.test/fixture.jpg", description: "Software simulation only", category: "SPORTS", priceCents: 2500, taxClass: "GENERAL", active: true }],
    doorMapping, assignments: Object.fromEntries(profile.doors.map((door) => [door.doorId, "sports-25"])),
    support: { pageUrl: "https://example.test/support", email: "test@example.test", textNumber: "+15555550100", phoneNumber: "+15555550101", hours: "Synthetic test hours" },
    minimumAppVersion: "0.1.0", createdAt: "2026-08-16T00:00:00.000Z", expiresAt: "2027-08-16T00:00:00.000Z",
  });
  return { payload, digest: vault.configDigest(payload), keyId: "test-key", algorithm: "Ed25519", signature: sign(null, Buffer.from(vault.canonicalJson(payload)), privateKey).toString("base64") };
}

module.exports = { makeSyntheticProfile, makeSyntheticConfig };
