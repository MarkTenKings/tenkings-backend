import { randomUUID } from "node:crypto";
import type { SpeedsterCardSide } from "../ai-grader-v2/contracts";
import {
  SPEEDSTER_PREPARATION_VERSION,
  type SpeedsterPreparationExpectedHead,
  type SpeedsterPreparationInput,
  type SpeedsterPreparationManifestBody,
  type SpeedsterPreparationReference,
  type SpeedsterPreparationScope,
  type SpeedsterPreparationState,
} from "../ai-grader-v2/preparation";
import {
  assertPreparationInput,
  assertPreparationManifest,
  assertPreparationScope,
  preparationHash,
  preparationRequire,
  preparationUuid,
} from "./speedsterPreparationIntegrity";
import { verifySpeedsterPreparationManifestBytes, type SpeedsterPreparationStorage } from "./speedsterPreparationStorage";

export type PreparationOwner = Pick<SpeedsterPreparationScope, "sessionId" | "createdByUserId">;
export type PreparationHead = Readonly<{ sessionId: string; side: SpeedsterCardSide; sideRevision: number; activeAttemptId: string; adoptedManifestId: string | null }>;
export type PreparationAttempt = SpeedsterPreparationScope & Readonly<{
  id: string;
  sideRevision: number;
  idempotencyKey: string;
  requestSha256: string;
  expectedSideRevision: number;
  expectedAttemptId: string | null;
  input: SpeedsterPreparationInput;
  dispatchClaimId: string | null;
  dispatchClaimedAt: Date | null;
  terminalOutcome: "ADOPTED" | "FAILED" | null;
  terminalDetails: unknown;
  terminalAt: Date | null;
  createdAt: Date;
}>;
export type PreparationManifest = SpeedsterPreparationScope & Readonly<{
  id: string; sideRevision: number; attemptId: string; manifestSha256: string;
  body: SpeedsterPreparationManifestBody; createdAt: Date;
}>;
export type PreparationSession = Readonly<{
  id: string; createdByUserId: string; workflowState: string; cardProfile: string;
  identity: unknown; capture: unknown; mapRevisionId: string | null;
  mapRegistration: unknown; mapFilterPolicyVersion: string | null; updatedAt: Date;
}>;
export type PreparationSnapshot = Readonly<{
  session: PreparationSession;
  heads: Partial<Record<SpeedsterCardSide, PreparationHead>>;
  attempts: Partial<Record<SpeedsterCardSide, PreparationAttempt>>;
  manifests: Partial<Record<SpeedsterCardSide, PreparationManifest>>;
}>;
export type PreparationAudit = PreparationOwner & Readonly<{
  eventKey: string;
  eventType: "PREPARATION_BEGUN" | "PREPARATION_SUPERSEDED" | "PREPARATION_DISPATCH_CLAIMED" | "PREPARATION_ADOPTED" | "PREPARATION_FAILED" | "PREPARATION_CAPTURE_FROZEN";
  details: unknown;
}>;

/** The adapter acquires the owned session first, then FRONT/BACK heads in order. */
export type PreparationTransaction = Readonly<{
  snapshot: PreparationSnapshot;
  findAttempt: (id: string) => Promise<PreparationAttempt | null>;
  findIdempotentAttempt: (side: SpeedsterCardSide, key: string) => Promise<PreparationAttempt | null>;
  findManifest: (attemptId: string) => Promise<PreparationManifest | null>;
  insertAttempt: (attempt: PreparationAttempt) => Promise<void>;
  setHead: (head: PreparationHead) => Promise<void>;
  claimDispatch: (attemptId: string, claimId: string, at: Date) => Promise<void>;
  finishAttempt: (attemptId: string, outcome: "ADOPTED" | "FAILED", details: unknown, at: Date) => Promise<void>;
  insertManifest: (manifest: PreparationManifest) => Promise<void>;
  audit: (event: PreparationAudit) => Promise<void>;
}>;
export type PreparationStore<Tx extends PreparationTransaction = PreparationTransaction> = Readonly<{
  read: (owner: PreparationOwner) => Promise<PreparationSnapshot>;
  transaction: <Result>(owner: PreparationOwner, work: (tx: Tx) => Promise<Result>) => Promise<Result>;
}>;

function ownedSession(snapshot: PreparationSnapshot, owner: PreparationOwner, draft: boolean): void {
  preparationRequire(snapshot.session.id === owner.sessionId && snapshot.session.createdByUserId === owner.createdByUserId, "Preparation session ownership changed.");
  if (draft) preparationRequire(snapshot.session.workflowState === "DRAFT", "Only an owned DRAFT can change preparation authority.");
}

function assertAttemptScope(attempt: PreparationAttempt, scope: SpeedsterPreparationScope): void {
  preparationRequire(attempt.id && attempt.sessionId === scope.sessionId && attempt.createdByUserId === scope.createdByUserId && attempt.side === scope.side, "Preparation attempt belongs to a different session or side.");
  assertPreparationInput(scope, attempt.input);
}

function activeAttempt(snapshot: PreparationSnapshot, scope: SpeedsterPreparationScope, id: string, revision: number): PreparationAttempt {
  ownedSession(snapshot, scope, true);
  const head = snapshot.heads[scope.side];
  const attempt = snapshot.attempts[scope.side];
  preparationRequire(head && attempt && head.sessionId === scope.sessionId && head.side === scope.side
    && head.activeAttemptId === id && head.sideRevision === revision && attempt.id === id && attempt.sideRevision === revision,
  "Preparation attempt was superseded; its output cannot be adopted.");
  assertAttemptScope(attempt, scope);
  return attempt;
}

export function preparationAttemptState(attempt: PreparationAttempt, head?: PreparationHead): SpeedsterPreparationState {
  if (!head || head.activeAttemptId !== attempt.id || head.sideRevision !== attempt.sideRevision) return "SUPERSEDED";
  return attempt.terminalOutcome ?? (attempt.dispatchClaimId ? "RUNNING_OR_UNRESOLVED" : "READY");
}

export function preparationManifestReference(manifest: PreparationManifest): SpeedsterPreparationReference {
  assertPreparationManifest(manifest.body);
  preparationRequire(preparationHash(manifest.body) === manifest.manifestSha256
    && manifest.body.sessionId === manifest.sessionId && manifest.body.createdByUserId === manifest.createdByUserId
    && manifest.body.side === manifest.side && manifest.body.attemptId === manifest.attemptId && manifest.body.sideRevision === manifest.sideRevision,
  "Stored preparation manifest identity differs from its body.");
  return { version: SPEEDSTER_PREPARATION_VERSION, sessionId: manifest.sessionId, createdByUserId: manifest.createdByUserId,
    side: manifest.side, attemptId: manifest.attemptId, sideRevision: manifest.sideRevision, manifestId: manifest.id, manifestSha256: manifest.manifestSha256 };
}

export async function beginSpeedsterPreparation(input: Readonly<{
  scope: SpeedsterPreparationScope; expected: SpeedsterPreparationExpectedHead;
  idempotencyKey: string; input: SpeedsterPreparationInput;
}>, store: PreparationStore): Promise<Readonly<{ created: boolean; attempt: PreparationAttempt; state: SpeedsterPreparationState }>> {
  assertPreparationScope(input.scope);
  assertPreparationInput(input.scope, input.input);
  preparationRequire(preparationUuid(input.idempotencyKey) && Number.isSafeInteger(input.expected.sideRevision)
    && input.expected.sideRevision >= 0 && input.expected.sideRevision < 2147483647
    && (input.expected.sideRevision === 0 ? input.expected.attemptId === null : preparationUuid(input.expected.attemptId)), "Preparation begin identity is invalid.");
  const requestSha256 = preparationHash({ scope: input.scope, expected: input.expected, input: input.input });
  return store.transaction(input.scope, async (tx) => {
    ownedSession(tx.snapshot, input.scope, false);
    const head = tx.snapshot.heads[input.scope.side];
    const previousRequest = await tx.findIdempotentAttempt(input.scope.side, input.idempotencyKey);
    if (previousRequest) {
      assertAttemptScope(previousRequest, input.scope);
      preparationRequire(previousRequest.requestSha256 === requestSha256, "Preparation idempotency key was reused with different input.");
      return { created: false, attempt: previousRequest, state: preparationAttemptState(previousRequest, head) };
    }
    ownedSession(tx.snapshot, input.scope, true);
    preparationRequire((head?.sideRevision ?? 0) === input.expected.sideRevision && (head?.activeAttemptId ?? null) === input.expected.attemptId,
      "Preparation head changed before this request began.");
    const attempt: PreparationAttempt = {
      ...input.scope, id: randomUUID(), sideRevision: input.expected.sideRevision + 1,
      idempotencyKey: input.idempotencyKey, requestSha256, expectedSideRevision: input.expected.sideRevision,
      expectedAttemptId: input.expected.attemptId, input: structuredClone(input.input),
      dispatchClaimId: null, dispatchClaimedAt: null, terminalOutcome: null, terminalDetails: null, terminalAt: null, createdAt: new Date(),
    };
    await tx.insertAttempt(attempt);
    await tx.setHead({ sessionId: input.scope.sessionId, side: input.scope.side, sideRevision: attempt.sideRevision, activeAttemptId: attempt.id, adoptedManifestId: null });
    if (head) await tx.audit({ ...input.scope, eventKey: `preparation:${attempt.id}:supersede`, eventType: "PREPARATION_SUPERSEDED",
      details: { priorAttemptId: head.activeAttemptId, priorRevision: head.sideRevision, attemptId: attempt.id, side: input.scope.side } });
    await tx.audit({ ...input.scope, eventKey: `preparation:${attempt.id}:begin`, eventType: "PREPARATION_BEGUN",
      details: { attemptId: attempt.id, side: attempt.side, sideRevision: attempt.sideRevision, requestSha256 } });
    return { created: true, attempt, state: "READY" };
  });
}

/** A claim is consumed before grants/HTTP. Losing its response never issues a new claim. */
export async function claimSpeedsterPreparationDispatch(scope: SpeedsterPreparationScope, id: string, revision: number, store: PreparationStore): Promise<Readonly<{ claimed: boolean; attempt: PreparationAttempt }>> {
  return store.transaction(scope, async (tx) => {
    const attempt = activeAttempt(tx.snapshot, scope, id, revision);
    if (attempt.dispatchClaimId || attempt.terminalOutcome) return { claimed: false, attempt };
    const claimId = randomUUID();
    const at = new Date();
    await tx.claimDispatch(id, claimId, at);
    await tx.audit({ ...scope, eventKey: `preparation:${id}:dispatch`, eventType: "PREPARATION_DISPATCH_CLAIMED",
      details: { attemptId: id, side: scope.side, sideRevision: revision, requestSha256: attempt.requestSha256, claimId } });
    return { claimed: true, attempt: { ...attempt, dispatchClaimId: claimId, dispatchClaimedAt: at } };
  });
}

export async function adoptSpeedsterPreparation(body: SpeedsterPreparationManifestBody, claimId: string, store: PreparationStore): Promise<PreparationManifest> {
  assertPreparationManifest(body);
  const manifestSha256 = preparationHash(body);
  return store.transaction(body, async (tx) => {
    ownedSession(tx.snapshot, body, false);
    const attempt = await tx.findAttempt(body.attemptId);
    preparationRequire(attempt, "Preparation attempt is unavailable.");
    assertAttemptScope(attempt, body);
    preparationRequire(attempt.sideRevision === body.sideRevision && attempt.dispatchClaimId === claimId && preparationUuid(claimId)
      && preparationHash(attempt.input) === preparationHash(body.input), "Preparation result is not bound to the dispatched input.");
    const previous = await tx.findManifest(attempt.id);
    if (previous) {
      preparationManifestReference(previous);
      preparationRequire(previous.manifestSha256 === manifestSha256 && attempt.terminalOutcome === "ADOPTED", "A different result already finalized this preparation attempt.");
      return previous; // Read-only reconciliation also works after supersession/capture.
    }
    activeAttempt(tx.snapshot, body, body.attemptId, body.sideRevision);
    preparationRequire(!attempt.terminalOutcome, "Preparation attempt is already terminal.");
    const at = new Date();
    const manifest: PreparationManifest = { id: randomUUID(), sessionId: body.sessionId, createdByUserId: body.createdByUserId,
      side: body.side, sideRevision: body.sideRevision, attemptId: body.attemptId, manifestSha256, body: structuredClone(body), createdAt: at };
    await tx.insertManifest(manifest);
    await tx.finishAttempt(attempt.id, "ADOPTED", { manifestId: manifest.id, manifestSha256 }, at);
    await tx.setHead({ sessionId: body.sessionId, side: body.side, sideRevision: body.sideRevision, activeAttemptId: body.attemptId, adoptedManifestId: manifest.id });
    await tx.audit({ ...body, eventKey: `preparation:${attempt.id}:adopt`, eventType: "PREPARATION_ADOPTED",
      details: { ...preparationManifestReference(manifest), requestSha256: attempt.requestSha256 } });
    return manifest;
  });
}

export async function failSpeedsterPreparation(scope: SpeedsterPreparationScope, id: string, claimId: string, code: "INVALID_EVIDENCE" | "WORKER_REJECTED", store: PreparationStore): Promise<void> {
  await store.transaction(scope, async (tx) => {
    ownedSession(tx.snapshot, scope, true);
    const attempt = await tx.findAttempt(id);
    preparationRequire(attempt, "Preparation attempt is unavailable.");
    assertAttemptScope(attempt, scope);
    preparationRequire(attempt.dispatchClaimId === claimId && preparationUuid(claimId), "Preparation failure is not bound to its dispatch.");
    if (attempt.terminalOutcome) {
      preparationRequire(attempt.terminalOutcome === "FAILED" && preparationHash(attempt.terminalDetails) === preparationHash({ code }), "Preparation attempt already has a different terminal result.");
      return;
    }
    await tx.finishAttempt(id, "FAILED", { code }, new Date());
    await tx.audit({ ...scope, eventKey: `preparation:${id}:fail`, eventType: "PREPARATION_FAILED", details: { attemptId: id, code } });
    // Never reactivate a prior head, delete evidence, or dispatch a retry.
  });
}

export function currentPreparationPair(snapshot: PreparationSnapshot, owner: PreparationOwner): Readonly<Record<SpeedsterCardSide, PreparationManifest>> {
  ownedSession(snapshot, owner, true);
  const pair = {} as Record<SpeedsterCardSide, PreparationManifest>;
  for (const side of ["FRONT", "BACK"] as const) {
    const head = snapshot.heads[side];
    const attempt = snapshot.attempts[side];
    const manifest = snapshot.manifests[side];
    preparationRequire(head && attempt && manifest, "Both sides require adopted preparation evidence before capture.");
    activeAttempt(snapshot, { ...owner, side }, head.activeAttemptId, head.sideRevision);
    preparationManifestReference(manifest);
    preparationRequire(attempt.terminalOutcome === "ADOPTED" && head.adoptedManifestId === manifest.id
      && manifest.attemptId === attempt.id && manifest.sessionId === owner.sessionId && manifest.createdByUserId === owner.createdByUserId
      && manifest.side === side && manifest.sideRevision === head.sideRevision
      && preparationHash(manifest.body.input) === preparationHash(attempt.input), "Preparation pair contains conflicting durable authority.");
    pair[side] = manifest;
  }
  return pair;
}

function captureSnapshotBinding(snapshot: PreparationSnapshot, owner: PreparationOwner): string {
  const pair = currentPreparationPair(snapshot, owner);
  return preparationHash({ session: { ...snapshot.session, updatedAt: snapshot.session.updatedAt.toISOString() },
    front: preparationManifestReference(pair.FRONT), back: preparationManifestReference(pair.BACK) });
}

export type PreparationCapturePreflight<Validation> = Readonly<{
  owner: PreparationOwner; snapshotSha256: string; validationSha256: string; validation: Validation;
}>;

export async function preflightSpeedsterPreparationCapture<Validation>(input: Readonly<{
  owner: PreparationOwner; store: PreparationStore; storage?: SpeedsterPreparationStorage;
  validate: (snapshot: PreparationSnapshot, pair: Readonly<Record<SpeedsterCardSide, PreparationManifest>>) => Promise<Validation>;
}>): Promise<PreparationCapturePreflight<Validation>> {
  const snapshot = await input.store.read(input.owner);
  const pair = currentPreparationPair(snapshot, input.owner);
  await Promise.all([verifySpeedsterPreparationManifestBytes(pair.FRONT.body, input.storage), verifySpeedsterPreparationManifestBytes(pair.BACK.body, input.storage)]);
  const validation = await input.validate(snapshot, pair);
  return { owner: input.owner, snapshotSha256: captureSnapshotBinding(snapshot, input.owner), validationSha256: preparationHash(validation), validation: structuredClone(validation) };
}

/** Callback only performs locked database/pure validation; no storage or HTTP. */
export async function freezeSpeedsterPreparationCapture<Validation, Result, Tx extends PreparationTransaction>(input: Readonly<{
  preflight: PreparationCapturePreflight<Validation>; store: PreparationStore<Tx>;
  recheckAndPersist: (tx: Tx, validation: Validation, pair: Readonly<Record<SpeedsterCardSide, PreparationManifest>>) => Promise<Result>;
}>): Promise<Result> {
  const { preflight } = input;
  preparationRequire(preflight.validationSha256 === preparationHash(preflight.validation), "Capture validation binding changed.");
  return input.store.transaction(preflight.owner, async (tx) => {
    preparationRequire(captureSnapshotBinding(tx.snapshot, preflight.owner) === preflight.snapshotSha256, "Capture preparation or session authority changed after preflight.");
    const pair = currentPreparationPair(tx.snapshot, preflight.owner);
    const result = await input.recheckAndPersist(tx, preflight.validation, pair);
    await tx.audit({ ...preflight.owner,
      eventKey: `preparation:capture:${pair.FRONT.id}:${pair.BACK.id}`, eventType: "PREPARATION_CAPTURE_FROZEN",
      details: { snapshotSha256: preflight.snapshotSha256, validationSha256: preflight.validationSha256,
        front: preparationManifestReference(pair.FRONT), back: preparationManifestReference(pair.BACK) } });
    return result;
  });
}
