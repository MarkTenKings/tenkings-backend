import { parseSpeedsterPreparationReference, SPEEDSTER_PREPARATION_VERSION, type SpeedsterPreparationManifestBody } from "../ai-grader-v2/preparation";
import type { SpeedsterCardSide } from "../ai-grader-v2/contracts";
import { sanitizeSpeedsterUnitQuad } from "../ai-grader-v2/geometry";
import { speedsterCenteringFromConfirmedQuad } from "./speedsterCenteringAuthority";
import { preparationManifestReference, type PreparationManifest, type PreparationOwner } from "./speedsterPreparationAuthority";
import { assertPreparationManifest, preparationCanonicalJson, preparationHash, preparationRequire } from "./speedsterPreparationIntegrity";

const trustedSides = new WeakMap<object, SpeedsterPreparationManifestBody>();
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
type Pair = Readonly<Record<SpeedsterCardSide, PreparationManifest>>;

/** Object identity is server-local. A browser JSON marker never grants authority. */
export function speedsterPreparationSideAuthority(value: unknown): SpeedsterPreparationManifestBody | undefined {
  return isRecord(value) ? trustedSides.get(value) : undefined;
}

function geometry(body: SpeedsterPreparationManifestBody) {
  return {
    originalStorageKey: body.input.source.originalStorageKey,
    rectifiedStorageKey: body.artifacts.RECTIFIED.storageKey,
    inspectionStorageKey: body.artifacts.INSPECTION.storageKey,
    sourceCorners: body.input.physicalQuad,
    inspectionFrame: body.inspectionFrame,
    transform: body.transform,
    viewStorageKeys: { NORMALIZED: body.artifacts.NORMALIZED.storageKey, MICRO_DEFECT: body.artifacts.MICRO_DEFECT.storageKey, DIRECTIONAL: body.artifacts.DIRECTIONAL.storageKey },
  };
}

function bindSide(raw: unknown, manifest: PreparationManifest): Record<string, unknown> {
  preparationRequire(isRecord(raw), `${manifest.side} capture is missing.`);
  const reference = preparationManifestReference(manifest);
  const submitted = parseSpeedsterPreparationReference(raw.preparation);
  preparationRequire(submitted && preparationHash(submitted) === preparationHash(reference), `${manifest.side} preparation was changed or superseded. Reload its saved state.`);
  const authoritative = geometry(manifest.body);
  // Detect stale browser state instead of combining one attempt's confirmations
  // with another attempt's images. All persisted fields come from the manifest.
  for (const [key, value] of Object.entries(authoritative)) {
    preparationRequire(raw[key] !== undefined && preparationHash(raw[key]) === preparationHash(value), `${manifest.side} ${key} differs from its adopted preparation.`);
  }
  const centeringQuad = sanitizeSpeedsterUnitQuad(raw.centeringQuad);
  preparationRequire(centeringQuad, `${manifest.side} printed geometry must be confirmed.`);
  const result = { ...raw, ...authoritative, preparation: reference, centeringQuad,
    centeringBorders: speedsterCenteringFromConfirmedQuad(centeringQuad, manifest.side) };
  trustedSides.set(result, manifest.body);
  return result;
}

/** Only call with the durable pair loaded by capture preflight/locked authority. */
export function bindSpeedsterPreparationCapture(raw: Record<string, unknown>, pair: Pair): Record<string, unknown> {
  preparationRequire(raw.preparationEvidenceCanonical === undefined, "Browser capture cannot supply stored preparation authority.");
  return { ...raw, front: bindSide(raw.front, pair.FRONT), back: bindSide(raw.back, pair.BACK) };
}

/** Store canonical text inside JSON so Prisma's JSONB numbers cannot alter hashes. */
export function persistSpeedsterPreparationCapture(input: Readonly<{
  owner: PreparationOwner; capture: Record<string, unknown>; pair: Pair; mapRegistration: unknown;
}>): Record<string, unknown> {
  const front = bindSide(input.capture.front, input.pair.FRONT);
  const back = bindSide(input.capture.back, input.pair.BACK);
  const evidence = {
    version: SPEEDSTER_PREPARATION_VERSION, ...input.owner,
    front: { reference: preparationManifestReference(input.pair.FRONT), manifest: input.pair.FRONT.body, capture: front },
    back: { reference: preparationManifestReference(input.pair.BACK), manifest: input.pair.BACK.body, capture: back },
    mapRegistration: input.mapRegistration ?? null,
  };
  return { ...input.capture, front, back, preparationEvidenceCanonical: preparationCanonicalJson(evidence) };
}

/**
 * Read boundary for a server-loaded persisted session, never request JSON. The
 * capture writer supplies this immutable snapshot from the locked typed pair.
 * Existing captures without the new envelope retain their legacy read path.
 */
export function resolvePersistedSpeedsterPreparationCapture<T extends Readonly<{ id: string; createdByUserId: string; capture: unknown; mapRegistration?: unknown }>>(record: T): T {
  if (!isRecord(record.capture) || record.capture.preparationEvidenceCanonical === undefined) return record;
  const canonical = record.capture.preparationEvidenceCanonical;
  preparationRequire(typeof canonical === "string" && canonical.length <= 500_000, "Stored preparation capture authority is malformed.");
  const evidence: unknown = JSON.parse(canonical);
  preparationRequire(isRecord(evidence) && preparationCanonicalJson(evidence) === canonical
    && evidence.version === SPEEDSTER_PREPARATION_VERSION && evidence.sessionId === record.id && evidence.createdByUserId === record.createdByUserId,
  "Stored preparation capture belongs to different authority.");
  const capture = { ...record.capture };
  for (const side of ["FRONT", "BACK"] as const) {
    const row = evidence[side.toLowerCase()];
    preparationRequire(isRecord(row), "Stored preparation side is missing.");
    const reference = parseSpeedsterPreparationReference(row.reference);
    const body = row.manifest as SpeedsterPreparationManifestBody;
    assertPreparationManifest(body);
    preparationRequire(reference && reference.sessionId === record.id && reference.createdByUserId === record.createdByUserId && reference.side === side,
      "Stored preparation reference is outside this session.");
    const manifest: PreparationManifest = { ...reference, id: reference.manifestId, body, createdAt: new Date(0) };
    const bound = bindSide(row.capture, manifest);
    const persistedSide = record.capture[side.toLowerCase()];
    // Presentation generation adds this metadata after capture/completion.
    if (isRecord(persistedSide) && typeof persistedSide.reportStorageKey === "string") bound.reportStorageKey = persistedSide.reportStorageKey;
    capture[side.toLowerCase()] = bound;
  }
  // The canonical registration is historical evidence. Later authorized TRAIN
  // operations may repin the session, so its current map columns remain current.
  return { ...record, capture };
}

export function preparationOriginalReadKey(value: unknown): string | null {
  const authority = speedsterPreparationSideAuthority(value);
  if (authority) return authority.input.source.storageKey;
  return isRecord(value) && typeof value.originalStorageKey === "string" ? value.originalStorageKey : null;
}
