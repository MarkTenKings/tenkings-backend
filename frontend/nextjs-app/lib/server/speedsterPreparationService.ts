import { z } from "zod";
import { sanitizeSpeedsterUnitQuad } from "../ai-grader-v2/geometry";
import { parseSpeedsterColorGeometryProposal } from "../ai-grader-v2/color-geometry";
import { parseSpeedsterPreparationReference, SPEEDSTER_PREPARATION_ROLES, SPEEDSTER_PREPARATION_VERSION, type SpeedsterPreparationIdentity, type SpeedsterPreparationScope, type SpeedsterPreparationWorkerEvidence } from "../ai-grader-v2/preparation";
import type { SpeedsterInspectionFrame } from "../ai-grader-v2/inspection-frame";
import {
  adoptSpeedsterPreparation, beginSpeedsterPreparation, claimSpeedsterPreparationDispatch, failSpeedsterPreparation,
  preparationAttemptState, preparationManifestReference, type PreparationAttempt, type PreparationManifest, type PreparationStore,
  type PreparationOwner,
} from "./speedsterPreparationAuthority";
import { SpeedsterPreparationConflict, assertPreparationIdentity, preparationHash, preparationRequire, preparationStagingKey } from "./speedsterPreparationIntegrity";
import { freezeSpeedsterPreparationSource, verifyAndFreezeSpeedsterPreparation, verifySpeedsterPreparationManifestBytes, type SpeedsterPreparationStorage } from "./speedsterPreparationStorage";
import { issueSpeedsterColorGeometryReceipt } from "./speedsterColorGeometryAuthority";

const uuid = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
const prepareRequestSchema = z.object({
  sessionId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/), side: z.enum(["FRONT", "BACK"]),
  sourceImageStorageKey: z.string().min(1).max(500), corners: z.unknown(), matColor: z.enum(["BLACK", "WHITE", "MAGENTA"]),
  imageUrl: z.string().optional(),
  preparationRequest: z.object({ idempotencyKey: uuid, expectedHead: z.object({ sideRevision: z.number().int().min(0).max(2147483646), attemptId: uuid.nullable() }).strict() }).strict(),
}).strict();

export type SpeedsterPreparationServiceDependencies = Readonly<{
  store: PreparationStore;
  storage?: SpeedsterPreparationStorage;
  approvedRelease: () => SpeedsterPreparationIdentity;
  readUrl: (key: string) => Promise<string>;
  stagingUpload: (key: string) => Promise<string>;
  invokeWorker: (body: Record<string, unknown>) => Promise<Readonly<{ ok: boolean; status: number; payload: unknown }>>;
  issueColorReceipt?: typeof issueSpeedsterColorGeometryReceipt;
}>;

export async function speedsterAdoptedPreparationResponse(manifest: PreparationManifest, deps: Pick<SpeedsterPreparationServiceDependencies, "readUrl" | "storage">) {
  const reference = preparationManifestReference(manifest);
  await verifySpeedsterPreparationManifestBytes(manifest.body, deps.storage);
  const body = manifest.body;
  const outputs = Object.fromEntries(await Promise.all(SPEEDSTER_PREPARATION_ROLES.map(async (role) => [role, {
    storageKey: body.artifacts[role].storageKey, readUrl: await deps.readUrl(body.artifacts[role].storageKey),
  }])));
  return {
    width: 1270, height: 1778, transform: body.transform, inspectionFrame: body.inspectionFrame,
    borders: body.printedColorResult.proposal,
    detectedBorders: body.printedColorResult.outcome === "ACCEPTED" ? ["top", "right", "bottom", "left"] : [],
    colorGeometry: body.printedColorResult, colorGeometryReceipt: body.printedColorReceipt,
    preparation: reference, preparationState: "ADOPTED" as const, outputs, frozenSourceReadUrl: await deps.readUrl(body.input.source.storageKey),
    input: { sourceImageStorageKey: body.input.source.originalStorageKey, corners: body.input.physicalQuad, matColor: body.input.matColor },
  };
}

export async function loadCurrentSpeedsterPreparation(rawReference: unknown, scope: SpeedsterPreparationScope, store: PreparationStore, allowCaptured = false): Promise<PreparationManifest> {
  const reference = parseSpeedsterPreparationReference(rawReference);
  preparationRequire(reference && reference.sessionId === scope.sessionId && reference.createdByUserId === scope.createdByUserId && reference.side === scope.side,
    "Preparation reference belongs to a different owner, session or side.");
  return store.transaction(scope, async (tx) => {
    const head = tx.snapshot.heads[scope.side];
    const manifest = await tx.findManifest(reference.attemptId);
    preparationRequire((tx.snapshot.session.workflowState === "DRAFT" || (allowCaptured && tx.snapshot.session.workflowState === "CAPTURED")) && head?.activeAttemptId === reference.attemptId
      && head.sideRevision === reference.sideRevision && manifest && head.adoptedManifestId === manifest.id
      && preparationHash(preparationManifestReference(manifest)) === preparationHash(reference), "Preparation was superseded or is unavailable. Reload its saved state.");
    return manifest;
  });
}

/** Read-only recovery never consumes a dispatch claim or renews a Color receipt. */
export async function readSpeedsterPreparationStatus(owner: PreparationOwner, deps: Pick<SpeedsterPreparationServiceDependencies, "store" | "storage" | "readUrl">) {
  const snapshot = await deps.store.read(owner);
  const entries = await Promise.all((["FRONT", "BACK"] as const).map(async (side) => {
    const head = snapshot.heads[side];
    const attempt = snapshot.attempts[side];
    const manifest = snapshot.manifests[side];
    return [side, {
      expectedHead: { sideRevision: head?.sideRevision ?? 0, attemptId: head?.activeAttemptId ?? null },
      state: attempt ? preparationAttemptState(attempt, head) : null,
      request: attempt ? { idempotencyKey: attempt.idempotencyKey,
        expectedHead: { sideRevision: attempt.expectedSideRevision, attemptId: attempt.expectedAttemptId },
        sourceImageStorageKey: attempt.input.source.originalStorageKey, corners: attempt.input.physicalQuad, matColor: attempt.input.matColor } : null,
      adopted: manifest ? await speedsterAdoptedPreparationResponse(manifest, deps) : null,
    }];
  }));
  return { workflowState: snapshot.session.workflowState, sides: Object.fromEntries(entries) };
}

function browserBinding(attempt: PreparationAttempt) {
  return { sourceImageStorageKey: attempt.input.source.originalStorageKey, corners: attempt.input.physicalQuad, matColor: attempt.input.matColor,
    expectedHead: { sideRevision: attempt.expectedSideRevision, attemptId: attempt.expectedAttemptId } };
}

/** Durable lookup precedes source reads; a retry never observes a changed alias or dispatches twice. */
export async function prepareSpeedsterSide(raw: unknown, createdByUserId: string, deps: SpeedsterPreparationServiceDependencies) {
  const parsed = prepareRequestSchema.safeParse(raw);
  preparationRequire(parsed.success, "Preparation requires an exact request ID and expected side revision.");
  const request = parsed.data;
  const corners = sanitizeSpeedsterUnitQuad(request.corners);
  preparationRequire(corners, "Preparation requires confirmed physical corners.");
  const scope: SpeedsterPreparationScope = { createdByUserId, sessionId: request.sessionId, side: request.side };
  const submittedBinding = { sourceImageStorageKey: request.sourceImageStorageKey, corners, matColor: request.matColor, expectedHead: request.preparationRequest.expectedHead };
  const reconcile = async () => deps.store.transaction(scope, async (tx) => {
    const prior = await tx.findIdempotentAttempt(scope.side, request.preparationRequest.idempotencyKey);
    if (!prior) return null;
    preparationRequire(prior.createdByUserId === createdByUserId && prior.sessionId === scope.sessionId && prior.side === scope.side
      && preparationHash(browserBinding(prior)) === preparationHash(submittedBinding), "Preparation request ID was reused with different input.");
    return { attempt: prior, state: preparationAttemptState(prior, tx.snapshot.heads[scope.side]), manifest: await tx.findManifest(prior.id) };
  });
  const prior = await reconcile();
  if (prior) {
    if (prior.manifest) return { ...await speedsterAdoptedPreparationResponse(prior.manifest, deps), preparationState: prior.state };
    throw new SpeedsterPreparationConflict(`This preparation is ${prior.state.toLowerCase().replaceAll("_", " ")}. Reload its saved state before explicitly starting another attempt.`);
  }
  const preparationIdentity = deps.approvedRelease();
  assertPreparationIdentity(preparationIdentity);
  const snapshot = await deps.store.read(scope);
  preparationRequire(snapshot.session.id === scope.sessionId && snapshot.session.createdByUserId === createdByUserId
    && snapshot.session.workflowState === "DRAFT", "Only an owned DRAFT can begin preparation.");
  const source = await freezeSpeedsterPreparationSource(scope, request.sourceImageStorageKey, deps.storage);
  const begun = await beginSpeedsterPreparation({ scope, idempotencyKey: request.preparationRequest.idempotencyKey,
    expected: request.preparationRequest.expectedHead, input: { version: SPEEDSTER_PREPARATION_VERSION, source, physicalQuad: corners,
      physicalQuadSha256: preparationHash(corners), matColor: request.matColor, preparationIdentity } }, deps.store);
  if (!begun.created) {
    const raced = await reconcile();
    if (raced?.manifest) return { ...await speedsterAdoptedPreparationResponse(raced.manifest, deps), preparationState: raced.state };
    throw new SpeedsterPreparationConflict("The same preparation request is already recorded. Reload its saved state.");
  }
  const claimed = await claimSpeedsterPreparationDispatch(scope, begun.attempt.id, begun.attempt.sideRevision, deps.store);
  preparationRequire(claimed.claimed && claimed.attempt.dispatchClaimId, "Preparation dispatch was already claimed.");
  const attempt = claimed.attempt;
  const outputUploads = Object.fromEntries(await Promise.all(SPEEDSTER_PREPARATION_ROLES.map(async (role) => {
    const workerRole = { RECTIFIED: "rectified", INSPECTION: "inspection", NORMALIZED: "normalized", MICRO_DEFECT: "microDefect", DIRECTIONAL: "directional" }[role];
    return [workerRole, await deps.stagingUpload(preparationStagingKey(scope, attempt.id, role))];
  })));
  // No catch around transport uncertainty: the persisted claim remains unresolved.
  const result = await deps.invokeWorker({ imageUrl: await deps.readUrl(source.storageKey), corners: attempt.input.physicalQuad,
    matColor: attempt.input.matColor, outputUploads,
    preparationBinding: { attemptId: attempt.id, dispatchClaimId: attempt.dispatchClaimId, requestSha256: attempt.requestSha256,
      inputSha256: preparationHash(attempt.input), sourceSha256: source.sha256 } });
  if (!result.ok) {
    if (result.status >= 400 && result.status < 500) await failSpeedsterPreparation(scope, attempt.id, attempt.dispatchClaimId!, "WORKER_REJECTED", deps.store);
    throw new SpeedsterPreparationConflict("Image preparation did not complete. The saved attempt and photos are preserved; reload before deciding whether to start another attempt.");
  }
  let body;
  try {
    preparationRequire(result.payload && typeof result.payload === "object" && !Array.isArray(result.payload), "Preparation response is malformed.");
    const payload = result.payload as Record<string, unknown>;
    const color = parseSpeedsterColorGeometryProposal(payload.colorGeometry, { mode: "PRINTED_FRAME", matColor: attempt.input.matColor });
    const borders = payload.borders === null ? null : sanitizeSpeedsterUnitQuad(payload.borders);
    preparationRequire(preparationHash(borders) === preparationHash(color.proposal) && payload.width === 1270 && payload.height === 1778,
      "Preparation response geometry does not match its Color result.");
    const printedColorReceipt = (deps.issueColorReceipt ?? issueSpeedsterColorGeometryReceipt)({ operatorAdminId: createdByUserId,
      sessionId: scope.sessionId, side: scope.side, mode: "PRINTED_FRAME", sourceImageStorageKey: source.originalStorageKey,
      sourceImageSha256: source.sha256, matColor: attempt.input.matColor, physicalQuadSha256: attempt.input.physicalQuadSha256, result: color });
    body = await verifyAndFreezeSpeedsterPreparation(attempt, { preparationIdentity: payload.preparationIdentity as SpeedsterPreparationIdentity,
      preparationEvidence: payload.preparationEvidence as SpeedsterPreparationWorkerEvidence,
      transform: payload.transform as readonly number[], inspectionFrame: payload.inspectionFrame as SpeedsterInspectionFrame,
      printedColorResult: color, printedColorReceipt }, deps.storage);
  } catch (error) {
    await failSpeedsterPreparation(scope, attempt.id, attempt.dispatchClaimId!, "INVALID_EVIDENCE", deps.store);
    throw error;
  }
  const manifest = await adoptSpeedsterPreparation(body, attempt.dispatchClaimId!, deps.store);
  return speedsterAdoptedPreparationResponse(manifest, deps);
}
