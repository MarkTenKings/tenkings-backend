import { randomUUID } from "node:crypto";
import { parseSpeedsterColorGeometryProposal } from "../../lib/ai-grader-v2/color-geometry";
import {
  SPEEDSTER_PREPARATION_DECODER, SPEEDSTER_PREPARATION_FRAME, SPEEDSTER_PREPARATION_VERSION, SPEEDSTER_PREPARATION_ROLES,
  type SpeedsterPreparationExpectedHead, type SpeedsterPreparationIdentity, type SpeedsterPreparationInput, type SpeedsterPreparationManifestBody, type SpeedsterPreparationScope,
} from "../../lib/ai-grader-v2/preparation";
import type { PreparationAttempt, PreparationAudit, PreparationHead, PreparationManifest, PreparationOwner, PreparationSnapshot, PreparationStore, PreparationTransaction } from "../../lib/server/speedsterPreparationAuthority";
import { preparationArtifactKey, preparationBytesHash, preparationHash, preparationSourceKey } from "../../lib/server/speedsterPreparationIntegrity";
import type { SpeedsterPreparationStorage } from "../../lib/server/speedsterPreparationStorage";

export const fixturePreparationIdentity: SpeedsterPreparationIdentity = {
  version: "speedster-preparation-identity-v1", sourceCommitSha: "a".repeat(40), sourceTreeSha: "b".repeat(40), ociDigest: `sha256:${"c".repeat(64)}`,
  buildId: "100-1", pythonVersion: "3.12.14", opencvVersion: "4.13.0", numpyVersion: "2.2.6",
  decoder: SPEEDSTER_PREPARATION_DECODER, rectification: "opencv-float32-source-width-height-card-1270x1778-context-40-v1",
  reveals: "lab-clahe-2-8-morph-9-sobel-v1", encoding: "opencv-webp-quality-92-v1",
};
export const fixturePreparationScope: SpeedsterPreparationScope = { sessionId: "preparation-fixture", createdByUserId: "operator-fixture", side: "FRONT" };

export const fixturePreparationColor = parseSpeedsterColorGeometryProposal({
  version: "speedster-color-geometry-proposal-v1", engineVersion: "speedster-color-geometry-v2", authority: "PROPOSER_ONLY",
  policyProvenance: "OWNER_APPROVED_VISIBLE_OUTLINE_V2", mode: "PRINTED_FRAME", outcome: "ABSTAIN", matColor: "BLACK", proposal: null,
  contrastFloorDeltaE: 12, minimumSideSupport: 0.55,
  sideEvidence: Object.fromEntries(["top", "right", "bottom", "left"].map((side) => [side, { medianContrastDeltaE: 0, supportFraction: 0, sampleCount: 0, candidateCount: 0, ambiguous: false }])),
  ambiguity: { candidateCount: 0, runnerUpScoreRatio: null, ambiguous: false }, advisory: null,
});

export function fixturePreparationInput(scope = fixturePreparationScope): SpeedsterPreparationInput {
  const sha256 = preparationBytesHash(Buffer.from("fixture source bytes"));
  const physicalQuad = [{ x: 0.125, y: 0.125 }, { x: 0.875, y: 0.125 }, { x: 0.875, y: 0.875 }, { x: 0.125, y: 0.875 }] as const;
  return { version: SPEEDSTER_PREPARATION_VERSION, source: { originalStorageKey: `ai-grader-v2/${scope.createdByUserId}/${scope.sessionId}/original/${scope.side.toLowerCase()}.jpg`,
    originalSha256: sha256, sha256, storageKey: preparationSourceKey(scope, sha256, "jpeg"), byteCount: Buffer.byteLength("fixture source bytes"), width: 800, height: 1000, format: "jpeg", orientation: 1, decoder: SPEEDSTER_PREPARATION_DECODER },
  physicalQuad, physicalQuadSha256: preparationHash(physicalQuad), matColor: "BLACK", preparationIdentity: fixturePreparationIdentity };
}

export function fixturePreparationTransform(input: SpeedsterPreparationInput): number[] {
  const left = Math.fround(input.physicalQuad[0].x * input.source.width);
  const right = Math.fround(input.physicalQuad[1].x * input.source.width);
  const top = Math.fround(input.physicalQuad[0].y * input.source.height);
  const bottom = Math.fround(input.physicalQuad[2].y * input.source.height);
  const xScale = 1269 / (right - left);
  const yScale = 1777 / (bottom - top);
  return [xScale, 0, -left * xScale, 0, yScale, -top * yScale, 0, 0, 1];
}

export function fixturePreparationBody(attempt: PreparationAttempt, variant = "one"): SpeedsterPreparationManifestBody {
  return { version: SPEEDSTER_PREPARATION_VERSION, sessionId: attempt.sessionId, createdByUserId: attempt.createdByUserId, side: attempt.side,
    attemptId: attempt.id, sideRevision: attempt.sideRevision, input: attempt.input,
    artifacts: Object.fromEntries(SPEEDSTER_PREPARATION_ROLES.map((role) => {
      const bytes = Buffer.from(`fixture ${role} ${variant}`);
      const sha256 = preparationBytesHash(bytes);
      return [role, { storageKey: preparationArtifactKey(attempt, attempt.id, role, sha256), sha256, byteCount: bytes.length,
        width: role === "RECTIFIED" ? 1270 : 1350, height: role === "RECTIFIED" ? 1778 : 1858, format: "webp" }];
    })) as SpeedsterPreparationManifestBody["artifacts"], transform: fixturePreparationTransform(attempt.input),
    inspectionFrame: structuredClone(SPEEDSTER_PREPARATION_FRAME), printedColorResultSha256: preparationHash(fixturePreparationColor), printedColorResult: fixturePreparationColor, printedColorReceipt: "fixture receipt for domain-only tests" };
}

export class FixturePreparationStorage implements SpeedsterPreparationStorage {
  readonly objects = new Map<string, Buffer>();
  readonly writes: string[] = [];
  beforeRead?: (key: string) => Promise<void> | void;
  beforeCreate?: (key: string, bytes: Buffer) => Promise<void> | void;
  read = async (key: string): Promise<Buffer> => {
    await this.beforeRead?.(key);
    const bytes = this.objects.get(key);
    if (!bytes) throw Object.assign(new Error("Fixture object missing"), { code: "ENOENT" });
    return bytes;
  };
  create: SpeedsterPreparationStorage["create"] = async (key, bytes) => {
    await this.beforeCreate?.(key, bytes);
    if (this.objects.has(key)) throw Object.assign(new Error("Fixture object already exists"), { code: "EEXIST" });
    this.writes.push(key);
    this.objects.set(key, Buffer.from(bytes));
  };
  installBody(body: SpeedsterPreparationManifestBody, variant = "one"): void {
    this.objects.set(body.input.source.storageKey, Buffer.from("fixture source bytes"));
    for (const role of SPEEDSTER_PREPARATION_ROLES) this.objects.set(body.artifacts[role].storageKey, Buffer.from(`fixture ${role} ${variant}`));
  }
}

/** Serial transactions with rollback; this is a domain fixture, not PostgreSQL proof. */
export class FixturePreparationStore implements PreparationStore {
  session = { id: fixturePreparationScope.sessionId, createdByUserId: fixturePreparationScope.createdByUserId, workflowState: "DRAFT", cardProfile: "SPORTS", identity: { playerName: "Synthetic fixture" }, capture: {},
    mapRevisionId: null, mapRegistration: null, mapFilterPolicyVersion: null, updatedAt: new Date("2026-09-07T00:00:00.000Z") } as PreparationSnapshot["session"];
  heads: PreparationSnapshot["heads"] = {};
  attempts = new Map<string, PreparationAttempt>();
  manifests = new Map<string, PreparationManifest>();
  events: PreparationAudit[] = [];
  locked = false;
  failAudit = false;
  private pending: Promise<void> = Promise.resolve();

  read = async (_owner: PreparationOwner): Promise<PreparationSnapshot> => {
    const snapshot: PreparationSnapshot = { session: this.session, heads: this.heads, attempts: {}, manifests: {} };
    for (const side of ["FRONT", "BACK"] as const) {
      const head = this.heads[side];
      if (head) snapshot.attempts[side] = this.attempts.get(head.activeAttemptId);
      if (head?.adoptedManifestId) snapshot.manifests[side] = this.manifests.get(head.adoptedManifestId);
    }
    return structuredClone(snapshot);
  };

  transaction: PreparationStore["transaction"] = async (owner, work) => {
    let release = () => {};
    const previous = this.pending;
    this.pending = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    this.locked = true;
    const original = structuredClone({ session: this.session, heads: this.heads, attempts: this.attempts, manifests: this.manifests, events: this.events });
    const updateAttempt = (id: string, update: Partial<PreparationAttempt>) => {
      const attempt = this.attempts.get(id);
      if (!attempt) throw new Error("Fixture attempt missing");
      this.attempts.set(id, { ...attempt, ...update });
    };
    try {
      const tx: PreparationTransaction = {
        snapshot: await this.read(owner),
        findAttempt: async (id) => structuredClone(this.attempts.get(id) ?? null),
        findIdempotentAttempt: async (side, key) => structuredClone([...this.attempts.values()].find((attempt) => attempt.sessionId === owner.sessionId && attempt.side === side && attempt.idempotencyKey === key) ?? null),
        findManifest: async (attemptId) => structuredClone([...this.manifests.values()].find((manifest) => manifest.attemptId === attemptId) ?? null),
        insertAttempt: async (attempt) => { this.attempts.set(attempt.id, structuredClone(attempt)); },
        setHead: async (head: PreparationHead) => { this.heads[head.side] = structuredClone(head); },
        claimDispatch: async (id, claimId, at) => { updateAttempt(id, { dispatchClaimId: claimId, dispatchClaimedAt: at }); },
        finishAttempt: async (id, outcome, details, at) => { updateAttempt(id, { terminalOutcome: outcome, terminalDetails: details, terminalAt: at }); },
        insertManifest: async (manifest) => { this.manifests.set(manifest.id, structuredClone(manifest)); },
        audit: async (event) => { if (this.failAudit) throw new Error("Fixture audit failure"); this.events.push(structuredClone(event)); },
      };
      return await work(tx);
    } catch (error) {
      Object.assign(this, original);
      throw error;
    } finally {
      this.locked = false;
      release();
    }
  };
}

export function fixturePreparationRequest(scope = fixturePreparationScope) {
  const expected: SpeedsterPreparationExpectedHead = { sideRevision: 0, attemptId: null };
  return { scope, expected, idempotencyKey: randomUUID(), input: fixturePreparationInput(scope) };
}
