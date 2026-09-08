import { z } from "zod";
import { VaultDoorIdSchema, VAULT_MAX_PROFILE_DOORS } from "./doors";

const identity = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/);
const dimension = z.number().finite().positive().max(100_000);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const VaultSizeMmSchema = z.object({ width: dimension, height: dimension, depth: dimension }).strict();
export const VaultDisplayRectSchema = z.object({
  x: z.number().finite().min(0).max(100_000), y: z.number().finite().min(0).max(100_000),
  width: dimension, height: dimension,
}).strict();
const cutoutSchema = z.object({
  id: identity, kind: z.enum(["TOUCHSCREEN", "PAYMENT_TERMINAL", "PRODUCT_DISPLAY", "TV", "SERVICE"]),
  rect: VaultDisplayRectSchema,
}).strict();
const doorSchema = z.object({
  doorId: VaultDoorIdSchema,
  label: z.string().trim().min(1).max(32).regex(/^[^\u0000-\u001f\u007f]+$/),
  displayRect: VaultDisplayRectSchema,
  openingMm: z.object({ width: dimension, height: dimension }).strict(),
  usableCompartmentMm: VaultSizeMmSchema,
}).strict();
const displayRoleSchema = z.object({
  model: z.string().min(1).max(160),
  orientation: z.enum(["PORTRAIT", "LANDSCAPE"]),
  widthPx: z.number().int().min(320).max(16_384), heightPx: z.number().int().min(320).max(16_384),
  scalePercent: z.number().int().min(50).max(300),
  touch: z.boolean(),
}).strict();

export const VaultMachineProfileSchema = z.object({
  schemaVersion: z.literal(1),
  profileId: identity, modelId: identity, revision: z.number().int().positive(),
  provenance: z.enum(["SYNTHETIC", "QUALIFIED"]),
  cabinetMm: VaultSizeMmSchema,
  display: z.object({ width: dimension, height: dimension, cutouts: z.array(cutoutSchema).max(32) }).strict(),
  doors: z.array(doorSchema).min(1).max(VAULT_MAX_PROFILE_DOORS),
  controller: z.object({
    interfaceVersion: z.literal("vault-controller-v1"), adapterId: identity,
    maxDoors: z.number().int().min(1).max(VAULT_MAX_PROFILE_DOORS),
    endpoints: z.array(z.object({ endpointId: identity, channelCount: z.number().int().min(1).max(VAULT_MAX_PROFILE_DOORS) }).strict()).min(1).max(32),
  }).strict(),
  hardware: z.object({
    computerModel: z.string().min(1).max(160), os: z.string().min(1).max(160),
    lockModel: z.string().min(1).max(160), paymentTerminalModel: z.string().min(1).max(160),
    touchscreen: displayRoleSchema, tv: displayRoleSchema,
  }).strict(),
  // Dimensions are descriptive until the operator checks the actual packaged product.
  productFitPolicy: z.literal("OPERATOR_CONFIRMED"),
  evidence: z.object({ geometryDigest: digest, wiringDigest: digest, capabilityDigest: digest, hardwareDigest: digest }).strict().nullable(),
}).strict().superRefine((profile, context) => {
  const issue = (message: string) => context.addIssue({ code: "custom", message });
  if (new Set(profile.doors.map((door) => door.doorId)).size !== profile.doors.length) issue("Profile door IDs must be unique");
  if (new Set(profile.doors.map((door) => door.label.toLocaleLowerCase("en-US"))).size !== profile.doors.length) issue("Printed door labels must be unique");
  if (new Set(profile.display.cutouts.map((cutout) => cutout.id)).size !== profile.display.cutouts.length) issue("Cutout IDs must be unique");
  if (new Set(profile.controller.endpoints.map((endpoint) => endpoint.endpointId)).size !== profile.controller.endpoints.length) issue("Controller endpoint IDs must be unique");
  if (profile.doors.length > profile.controller.maxDoors) issue("Profile exceeds its declared controller capacity");
  if (profile.doors.length > profile.controller.endpoints.reduce((total, endpoint) => total + endpoint.channelCount, 0)) issue("Insufficient declared controller channels");
  if (profile.provenance === "QUALIFIED" && !profile.evidence) issue("Qualified profiles require geometry, wiring, capability and hardware evidence bindings");
  if (!profile.hardware.touchscreen.touch || profile.hardware.tv.touch) issue("Display roles must identify the customer touch display and non-touch TV independently");
  const rectangles = [...profile.doors.map((door) => door.displayRect), ...profile.display.cutouts.map((cutout) => cutout.rect)];
  for (let index = 0; index < rectangles.length; index += 1) {
    const a = rectangles[index];
    if (index < profile.doors.length && (profile.display.width / a.width > 128 || profile.display.height / a.height > 128)) issue("Door display density exceeds the supported touch layout envelope");
    if (a.x + a.width > profile.display.width || a.y + a.height > profile.display.height) issue("Display geometry exceeds the profile canvas");
    for (let other = index + 1; other < rectangles.length; other += 1) {
      const b = rectangles[other];
      if (a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y) issue("Door and cutout display rectangles may not overlap");
    }
  }
});
export type VaultMachineProfile = z.infer<typeof VaultMachineProfileSchema>;
export type VaultProfileDoor = VaultMachineProfile["doors"][number];

/** Provisional physical data is an authoring artifact, never an executable configuration. */
export const VaultMachineProfileDraftSchema = z.object({
  schemaVersion: z.literal(1), status: z.literal("DRAFT"), profileId: identity, modelId: identity,
  revision: z.number().int().positive(),
  cabinetMm: z.object({ width: dimension.nullable(), height: dimension.nullable(), depth: dimension.nullable() }).strict().nullable(),
  doors: z.array(z.object({
    doorId: VaultDoorIdSchema, label: doorSchema.shape.label,
    displayRect: VaultDisplayRectSchema.nullable(), openingMm: doorSchema.shape.openingMm.nullable(),
    usableCompartmentMm: VaultSizeMmSchema.nullable(),
  }).strict()).max(VAULT_MAX_PROFILE_DOORS),
  unresolved: z.array(z.string().min(1).max(1000)).min(1).max(100),
}).strict();
