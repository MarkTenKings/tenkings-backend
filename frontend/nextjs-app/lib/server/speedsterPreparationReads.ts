import type { SpeedsterPreparationScope } from "../ai-grader-v2/preparation";
import { SPEEDSTER_PREPARATION_ROLES } from "../ai-grader-v2/preparation";
import { preparationManifestReference, type PreparationStore } from "./speedsterPreparationAuthority";
import { createPrismaSpeedsterPreparationStore } from "./speedsterPreparationStore";
import { preparationBytesHash, preparationRequire } from "./speedsterPreparationIntegrity";
import { readStorageBufferBounded } from "./storage";

export async function resolveSpeedsterPreparationOriginalRead(scope: SpeedsterPreparationScope, originalKey: string,
  store: PreparationStore = createPrismaSpeedsterPreparationStore(), read = readStorageBufferBounded): Promise<string> {
  const snapshot = await store.read(scope);
  const attempt = snapshot.attempts[scope.side];
  if (!attempt || attempt.input.source.originalStorageKey !== originalKey) return originalKey;
  const source = attempt.input.source;
  const bytes = await read(source.storageKey);
  preparationRequire(bytes.length === source.byteCount && preparationBytesHash(bytes) === source.sha256, "Frozen original bytes changed.");
  return source.storageKey;
}

/** Historical accepted artifacts remain readable without reactivating an attempt. */
export async function authorizeSpeedsterPreparationArtifactRead(scope: SpeedsterPreparationScope, storageKey: string,
  store: PreparationStore = createPrismaSpeedsterPreparationStore(), read = readStorageBufferBounded): Promise<boolean> {
  const prefix = `ai-grader-v2/${scope.createdByUserId}/${scope.sessionId}/prepared-evidence/${scope.side.toLowerCase()}/`;
  if (!storageKey.startsWith(prefix)) return false;
  const suffix = storageKey.slice(prefix.length);
  const attemptId = /^([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\/[^/]+\.webp$/.exec(suffix)?.[1];
  if (!attemptId) return false;
  const manifest = await store.transaction(scope, (tx) => tx.findManifest(attemptId));
  if (!manifest || manifest.side !== scope.side) return false;
  preparationManifestReference(manifest);
  const artifact = SPEEDSTER_PREPARATION_ROLES.map((role) => manifest.body.artifacts[role]).find((entry) => entry.storageKey === storageKey);
  if (!artifact) return false;
  const bytes = await read(storageKey);
  preparationRequire(bytes.length === artifact.byteCount && preparationBytesHash(bytes) === artifact.sha256, "Adopted artifact bytes changed.");
  return true;
}
