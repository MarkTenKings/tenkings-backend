const test = require("node:test");
const assert = require("node:assert/strict");
const { generateKeyPairSync, randomUUID } = require("node:crypto");
const vault = require("../dist");
const { makeSyntheticProfile, makeSyntheticConfig } = require("./profile-fixtures");

test("signed profiles support varying mixed-size layouts and independent explicit wiring", () => {
  const keys = generateKeyPairSync("ed25519");
  for (const count of [1, 7, 32, 72, 125, 150, 256]) {
    const config = makeSyntheticConfig(randomUUID(), 1, keys.privateKey, count);
    assert.equal(vault.configDoorIds(config.payload).length, count);
    assert.equal(vault.verifySignedConfig(config, keys.publicKey.export({ type: "spki", format: "pem" })), true);
    assert.equal(config.payload.machineProfile.provenance, "SYNTHETIC");
    assert.notDeepEqual(config.payload.doorMapping.map((door) => door.doorId), count === 1 ? [] : vault.configDoorIds(config.payload));
    if (count > 1) assert.ok(new Set(config.payload.machineProfile.doors.map((door) => door.displayRect.width)).size > 1);
    const changed = structuredClone(config);
    changed.payload.machineProfile.doors[0].label = "Different printed label";
    assert.equal(vault.verifySignedConfig(changed, keys.publicKey.export({ type: "spki", format: "pem" })), false);
  }
});

test("profile geometry, identity, capacity and evidence validation reject ambiguous execution", () => {
  const fixture = makeSyntheticProfile(72).profile;
  const invalid = [
    (p) => { p.doors[1].doorId = p.doors[0].doorId; },
    (p) => { p.doors[1].label = p.doors[0].label.toLowerCase(); },
    (p) => { p.doors[0].displayRect.width = 0; },
    (p) => { p.doors[0].displayRect.width = 0.001; },
    (p) => { p.doors[0].displayRect.x = p.display.width; },
    (p) => { p.doors[1].displayRect = p.doors[0].displayRect; },
    (p) => { p.doors[0].displayRect = p.display.cutouts[0].rect; },
    (p) => { p.controller.maxDoors = 71; },
    (p) => { p.controller.endpoints[1].endpointId = p.controller.endpoints[0].endpointId; },
    (p) => { p.controller.endpoints = [{ endpointId: "only", channelCount: 1 }]; },
    (p) => { p.provenance = "QUALIFIED"; },
    (p) => { p.doors[0].usableCompartmentMm = null; },
    (p) => { p.hardware.touchscreen.touch = false; },
    (p) => { p.doors[0].doorId = "constructor"; },
  ];
  for (const corrupt of invalid) { const copy = structuredClone(fixture); corrupt(copy); assert.equal(vault.VaultMachineProfileSchema.safeParse(copy).success, false); }
  const draft = { schemaVersion: 1, status: "DRAFT", profileId: "physical-unverified", modelId: "candidate", revision: 1, cabinetMm: null,
    doors: [{ doorId: "door-1", label: "One", displayRect: null, openingMm: null, usableCompartmentMm: null }], unresolved: ["Geometry and wiring not verified"] };
  assert.equal(vault.VaultMachineProfileDraftSchema.safeParse(draft).success, true);
  assert.equal(vault.VaultMachineProfileSchema.safeParse(draft).success, false);
});

test("v2 config requires exact assignments and unique in-capacity endpoint addresses", () => {
  const keys = generateKeyPairSync("ed25519"), config = makeSyntheticConfig(randomUUID(), 1, keys.privateKey, 125);
  for (const corrupt of [
    (p) => { delete p.assignments["door-0001"]; },
    (p) => { p.assignments["not-a-member"] = "sports-25"; },
    (p) => { p.doorMapping.pop(); },
    (p) => { p.doorMapping[0].doorId = "not-a-member"; },
    (p) => { delete p.doorMapping[0].controllerEndpointId; },
    (p) => { p.doorMapping[0].controllerEndpointId = "not-an-endpoint"; },
    (p) => { p.doorMapping[0].controllerChannel = 65; },
    (p) => { p.doorMapping[1] = { ...p.doorMapping[0], doorId: p.doorMapping[1].doorId }; },
    (p) => { p.schemaVersion = 3; },
  ]) { const copy = structuredClone(config.payload); corrupt(copy); assert.equal(vault.VaultConfigPayloadSchema.safeParse(copy).success, false); }
  assert.equal(vault.isVaultDoorId("door-One"), true);
  assert.equal(vault.isVaultDoorId("../door"), false);
  assert.equal(vault.machineProfileDigest(config.payload.machineProfile).length, 64);
});
