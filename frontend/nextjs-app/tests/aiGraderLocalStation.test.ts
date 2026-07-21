import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { AI_GRADER_REPORT_BUNDLE_V03_VERSION } from "@tenkings/shared";
import {
  AI_GRADER_STATION_STEPS,
  aiGraderAtomicBackQueueReleaseMatches,
  aiGraderApproveAndPublishEligible,
  aiGraderAuthoritativeLiveLightingDraft,
  aiGraderRapidQueueIdentityMatches,
  aiGraderRapidItemPublishable,
  aiGraderReviewActivationAvailable,
  aiGraderStartNewCardAvailable,
  assertAiGraderRapidItemPublishable,
  buildAiGraderLocalStationStatus,
  completeAiGraderExactPublicationHandoff,
  parseAiGraderStationAction,
  sanitizeAiGraderRapidCaptureQueue,
  sanitizeAiGraderPreviewCardGeometry,
  selectNextSerializedAiGraderOcrItem,
} from "../lib/aiGraderLocalStation";
import {
  AI_GRADER_QUEUED_OCR_ATTEMPT_OWNER_LOCK_PREFIX,
  AI_GRADER_QUEUED_OCR_ATTEMPT_OWNER_STORAGE_KEY,
  buildAiGraderQueuedOcrClaimRequest,
  buildAiGraderQueuedOcrCompletionRequest,
  buildAiGraderQueuedOcrFailureRequest,
  buildAiGraderRapidPublicationEvidence,
  buildAiGraderRapidQueueActivationRequest,
  fetchAiGraderStationBridgeHealth,
  initializeAiGraderQueuedOcrAttemptOwner,
  waitForAiGraderQueuedOcrAttemptOwnerLock,
  type AiGraderQueuedOcrAttemptOwnerLockManager,
} from "../lib/aiGraderStationBridgeClient";
import {
  aiGraderCaptureAssertionFromFrame,
  runAiGraderCapture,
} from "../lib/aiGraderStationOperations";

const OCR_ATTEMPT_OWNER_ID = "ocr-attempt-11111111-1111-4111-8111-111111111111";

function queuedOcrOwnerStorage(initialValue?: string) {
  const values = new Map<string, string>();
  if (initialValue) values.set(AI_GRADER_QUEUED_OCR_ATTEMPT_OWNER_STORAGE_KEY, initialValue);
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

class FakeQueuedOcrOwnerLockManager implements AiGraderQueuedOcrAttemptOwnerLockManager {
  readonly held = new Set<string>();
  readonly requests: Array<{ name: string; mode: string; ifAvailable: boolean }> = [];
  failure: Error | null = null;
  private readonly waiters = new Map<string, Array<() => void>>();

  async request(
    name: string,
    options:
      | { mode: "exclusive"; ifAvailable: true }
      | { mode: "exclusive"; signal: AbortSignal },
    callback: (lock: { name: string } | null) => void | Promise<void>,
  ): Promise<void> {
    const ifAvailable = "ifAvailable" in options;
    this.requests.push({ name, mode: options.mode, ifAvailable });
    if (this.failure) throw this.failure;
    if (ifAvailable && this.held.has(name)) {
      await callback(null);
      return;
    }
    if ("signal" in options && this.held.has(name)) {
      await new Promise<void>((resolve, reject) => {
        const signal = options.signal;
        const queued = this.waiters.get(name) ?? [];
        const start = () => {
          signal.removeEventListener("abort", abort);
          resolve();
        };
        const abort = () => {
          const current = this.waiters.get(name) ?? [];
          this.waiters.set(name, current.filter((entry) => entry !== start));
          const error = new Error("The queued owner lock wait was aborted.");
          error.name = "AbortError";
          reject(error);
        };
        if (signal.aborted) {
          abort();
          return;
        }
        queued.push(start);
        this.waiters.set(name, queued);
        signal.addEventListener("abort", abort, { once: true });
      });
    }
    this.held.add(name);
    try {
      await callback({ name });
    } finally {
      this.held.delete(name);
      const queued = this.waiters.get(name) ?? [];
      const next = queued.shift();
      if (queued.length > 0) this.waiters.set(name, queued);
      else this.waiters.delete(name);
      next?.();
    }
  }
}

async function settleQueuedOcrOwnerLockRelease() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

const stationPageSource = readFileSync(new URL("../pages/ai-grader/station.tsx", import.meta.url), "utf8");
const stationPageAst = ts.createSourceFile(
  "station.tsx",
  stationPageSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

function stationUseEffectExpression(marker: string) {
  let match: ts.CallExpression | undefined;
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "useEffect" &&
      node.arguments[0]?.getText(stationPageAst).includes(marker)
    ) {
      match = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(stationPageAst);
  if (!match || !match.arguments[0] || !match.arguments[1]) {
    throw new Error(`Station useEffect containing ${marker} was not found.`);
  }
  return {
    callback: match.arguments[0].getText(stationPageAst),
    dependencies: match.arguments[1].getText(stationPageAst),
  };
}

function stationVariableInitializerExpression(variableName: string) {
  let match: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === variableName &&
      node.initializer
    ) {
      match = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(stationPageAst);
  if (!match) throw new Error(`Station variable ${variableName} was not found.`);
  return match.getText(stationPageAst);
}

function evaluateStationExpression<T>(expression: string, scope: Record<string, unknown>): T {
  const parameterNames = Object.keys(scope);
  const output = ts.transpileModule(`const __stationExpression = ${expression};`, {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const evaluator = Function(...parameterNames, `${output}\nreturn __stationExpression;`);
  return evaluator(...parameterNames.map((name) => scope[name])) as T;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitForQueuedOcrBehavior(predicate: () => boolean, label: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.fail(`Timed out waiting for ${label}.`);
}

type BehavioralQueuedOcrState = "eligible" | "in_flight" | "failed" | "succeeded";
type BehavioralQueuedOcrItem = {
  queueItemId: string;
  sessionId: string;
  reportId: string;
  queuedAt: string;
  ocr: {
    state: BehavioralQueuedOcrState;
    attemptOwnerId?: string;
  };
};
type BehavioralStationStatus = {
  rapidCaptureQueue: {
    items: BehavioralQueuedOcrItem[];
  };
};

function behavioralStatus(items: BehavioralQueuedOcrItem[]): BehavioralStationStatus {
  return JSON.parse(JSON.stringify({ rapidCaptureQueue: { items } })) as BehavioralStationStatus;
}

function behavioralOcrItem(
  suffix: string,
  state: BehavioralQueuedOcrState = "eligible",
  attemptOwnerId?: string,
): BehavioralQueuedOcrItem {
  return {
    queueItemId: `queue-${suffix}`,
    sessionId: `session-${suffix}`,
    reportId: `report-${suffix}`,
    queuedAt: `2026-07-19T12:00:0${suffix}.000Z`,
    ocr: { state, ...(attemptOwnerId ? { attemptOwnerId } : {}) },
  };
}

function createEligibleOcrBehaviorHarness(input: {
  item?: BehavioralQueuedOcrItem;
  verifyProductionSession?: (token: string) => Promise<unknown>;
  runProvider?: (request: Record<string, unknown>) => Promise<unknown>;
  callBridge?: (request: { action: string; body?: Record<string, unknown> }) => Promise<unknown>;
  setStatus?: (status: BehavioralStationStatus) => void;
} = {}) {
  const item = input.item ?? behavioralOcrItem("1");
  const actions: string[] = [];
  const errors: string[] = [];
  const running = new Set<string>();
  const ownerClaim = {
    attemptOwnerId: OCR_ATTEMPT_OWNER_ID,
    reusedPersistedOwner: false,
    release() {},
  };
  const ownerRef = { current: ownerClaim as typeof ownerClaim | null };
  const defaultClaimedStatus = behavioralStatus([
    { ...item, ocr: { state: "in_flight", attemptOwnerId: OCR_ATTEMPT_OWNER_ID } },
  ]);
  const defaultCompletedStatus = behavioralStatus([
    { ...item, ocr: { state: "succeeded", attemptOwnerId: OCR_ATTEMPT_OWNER_ID } },
  ]);
  const scope: Record<string, unknown> = {
    nextEligibleOcrQueueItemId: item.queueItemId,
    nextEligibleOcrSessionId: item.sessionId,
    nextEligibleOcrReportId: item.reportId,
    bridgeConnected: true,
    bridgeUrl: "http://127.0.0.1:47652",
    stationToken: "station-token",
    sessionLoading: false,
    session: { token: "same-production-token" },
    queuedOcrAttemptOwner: {
      status: "ready",
      attemptOwnerId: OCR_ATTEMPT_OWNER_ID,
      error: null,
    },
    queuedOcrAttemptOwnerClaimRef: ownerRef,
    queuedOcrRunningRef: { current: running },
    queuedOcrSchedulerRevision: 0,
    setQueuedOcrSchedulerRevision(update: number | ((current: number) => number)) {
      const current = Number(scope.queuedOcrSchedulerRevision);
      scope.queuedOcrSchedulerRevision = typeof update === "function" ? update(current) : update;
    },
    setError(message: string | null) {
      if (message) errors.push(message);
    },
    verifyProductionSession: input.verifyProductionSession ?? (async () => ({
      displayName: "OCR Operator",
      role: "admin",
    })),
    setProductionAuthActor() {},
    setProductionAuthState() {},
    authFailureMessage(error: unknown) {
      return error instanceof Error ? error.message : "Production authorization failed.";
    },
    authStatusCode() {
      return null;
    },
    logout() {},
    callAiGraderStationBridge: async (request: { action: string; body?: Record<string, unknown> }) => {
      actions.push(request.action);
      if (input.callBridge) return input.callBridge(request);
      if (request.action === "begin-queued-ocr") return defaultClaimedStatus;
      if (request.action === "status") return defaultClaimedStatus;
      return defaultCompletedStatus;
    },
    buildAiGraderQueuedOcrClaimRequest(value: unknown) {
      return value;
    },
    buildAiGraderQueuedOcrCompletionRequest(value: unknown) {
      return value;
    },
    buildAiGraderQueuedOcrFailureRequest(value: unknown) {
      return value;
    },
    runAiGraderOcrPrefillFromLocalReport: input.runProvider ?? (async () => ({ safe: true })),
    buildAdminHeaders() {
      return {};
    },
    AiGraderOcrPrefillStageError: class AiGraderOcrPrefillStageError extends Error {},
    setStatus(status: BehavioralStationStatus) {
      input.setStatus?.(status);
    },
  };
  const eligibleEffect = stationUseEffectExpression('action: "begin-queued-ocr"');
  return {
    actions,
    errors,
    item,
    ownerClaim,
    ownerRef,
    running,
    scope,
    dependencies() {
      return evaluateStationExpression<unknown[]>(eligibleEffect.dependencies, scope);
    },
    invoke() {
      return evaluateStationExpression<() => void>(eligibleEffect.callback, scope)();
    },
  };
}

function stationDependenciesChanged(before: unknown[], after: unknown[]) {
  return before.length !== after.length || before.some((value, index) => !Object.is(value, after[index]));
}

test("station unmount before queued OCR authorization resolves makes zero durable claim calls", async () => {
  const authorization = deferred<unknown>();
  const harness = createEligibleOcrBehaviorHarness({
    verifyProductionSession: () => authorization.promise,
  });

  harness.invoke();
  harness.ownerRef.current = null;
  authorization.resolve({ displayName: "OCR Operator", role: "admin" });
  await waitForQueuedOcrBehavior(() => harness.running.size === 0, "the stale authorization continuation to settle");

  assert.equal(harness.actions.filter((action) => action === "begin-queued-ocr").length, 0);
});

test("station unmount after durable queued OCR claim prevents stale completion", async () => {
  const provider = deferred<unknown>();
  const harness = createEligibleOcrBehaviorHarness({
    runProvider: () => provider.promise,
  });

  harness.invoke();
  await waitForQueuedOcrBehavior(
    () => harness.actions.includes("begin-queued-ocr"),
    "the exact durable queued OCR claim",
  );
  harness.ownerRef.current = null;
  provider.resolve({ safe: true });
  await waitForQueuedOcrBehavior(() => harness.running.size === 0, "the stale OCR completion continuation to settle");

  assert.equal(harness.actions.filter((action) => action === "complete-queued-ocr").length, 0);
  assert.equal(harness.actions.filter((action) => action === "fail-queued-ocr").length, 0);
});

test("station unmount after durable queued OCR claim prevents stale terminal failure", async () => {
  const provider = deferred<unknown>();
  const harness = createEligibleOcrBehaviorHarness({
    runProvider: () => provider.promise,
  });

  harness.invoke();
  await waitForQueuedOcrBehavior(
    () => harness.actions.includes("begin-queued-ocr"),
    "the exact durable queued OCR claim",
  );
  harness.ownerRef.current = null;
  provider.reject(new Error("Hosted OCR failed after the station unmounted."));
  await waitForQueuedOcrBehavior(() => harness.running.size === 0, "the stale OCR failure continuation to settle");

  assert.equal(harness.actions.filter((action) => action === "complete-queued-ocr").length, 0);
  assert.equal(harness.actions.filter((action) => action === "fail-queued-ocr").length, 0);
});

test("rejected terminal OCR persistence reconciles the exact in-flight owner and advances the next eligible card", async () => {
  const first = behavioralOcrItem("1");
  const second = behavioralOcrItem("2");
  let serverStatus = behavioralStatus([first, second]);
  let localStatus = behavioralStatus([first, second]);
  let failCalls = 0;
  const bridgeActions: string[] = [];
  const providerCalls = new Map<string, number>();
  const snapshot = () => behavioralStatus(serverStatus.rapidCaptureQueue.items);
  const callBridge = async (request: { action: string; body?: Record<string, unknown> }) => {
    bridgeActions.push(request.action);
    const queueItemId = String(request.body?.queueItemId ?? "");
    const item = serverStatus.rapidCaptureQueue.items.find((candidate) => candidate.queueItemId === queueItemId);
    if (request.action === "status") return snapshot();
    if (!item) throw new Error("Exact queued OCR item was not found.");
    if (request.action === "begin-queued-ocr") {
      item.ocr = { state: "in_flight", attemptOwnerId: OCR_ATTEMPT_OWNER_ID };
      return snapshot();
    }
    if (request.action === "complete-queued-ocr") {
      item.ocr = { state: "succeeded", attemptOwnerId: OCR_ATTEMPT_OWNER_ID };
      return snapshot();
    }
    if (request.action === "fail-queued-ocr") {
      failCalls += 1;
      if (failCalls === 1) throw new Error("The Dell bridge rejected terminal failure persistence.");
      item.ocr = { state: "failed", attemptOwnerId: OCR_ATTEMPT_OWNER_ID };
      return snapshot();
    }
    throw new Error(`Unexpected bridge action ${request.action}.`);
  };
  const runProvider = async (request: Record<string, unknown>) => {
    const reportId = String(request.reportId);
    providerCalls.set(reportId, (providerCalls.get(reportId) ?? 0) + 1);
    if (reportId === first.reportId) throw new Error("Hosted OCR failed once.");
    return { safe: true };
  };
  const firstHarness = createEligibleOcrBehaviorHarness({
    item: first,
    callBridge,
    runProvider,
    setStatus(status) {
      localStatus = behavioralStatus(status.rapidCaptureQueue.items);
    },
  });

  firstHarness.invoke();
  await waitForQueuedOcrBehavior(
    () => failCalls === 1 && firstHarness.running.size === 0,
    "the rejected terminal failure mutation",
  );

  assert.equal(firstHarness.scope.queuedOcrSchedulerRevision, 1);
  assert.equal(localStatus.rapidCaptureQueue.items[0]?.ocr.state, "in_flight");

  Object.assign(firstHarness.scope, {
    interruptedOcrQueueItemId: first.queueItemId,
    interruptedOcrSessionId: first.sessionId,
    interruptedOcrReportId: first.reportId,
    interruptedOcrAttemptOwnerId: OCR_ATTEMPT_OWNER_ID,
    queuedOcrInterruptedHandledRef: { current: new Set<string>() },
    waitForAiGraderQueuedOcrAttemptOwnerLock: async () => ({ release() {} }),
  });
  const recoveryEffect = stationUseEffectExpression('code: "AI_GRADER_OCR_INTERRUPTED"');
  evaluateStationExpression<() => void>(recoveryEffect.callback, firstHarness.scope)();
  await waitForQueuedOcrBehavior(
    () => serverStatus.rapidCaptureQueue.items[0]?.ocr.state === "failed",
    "one exact interrupted-owner terminalization",
  );
  assert.equal(
    bridgeActions.filter((action) => action === "status").length,
    1,
    "the live exact owner must reconcile durable state before interrupted-owner terminalization",
  );

  const next = selectNextSerializedAiGraderOcrItem(
    serverStatus.rapidCaptureQueue.items as unknown as Parameters<typeof selectNextSerializedAiGraderOcrItem>[0],
  );
  assert.equal(next?.queueItemId, second.queueItemId);
  const secondHarness = createEligibleOcrBehaviorHarness({
    item: second,
    callBridge,
    runProvider,
    setStatus(status) {
      localStatus = behavioralStatus(status.rapidCaptureQueue.items);
    },
  });
  secondHarness.invoke();
  await waitForQueuedOcrBehavior(
    () => serverStatus.rapidCaptureQueue.items[1]?.ocr.state === "succeeded" && secondHarness.running.size === 0,
    "the next eligible queued OCR card",
  );

  assert.equal(providerCalls.get(first.reportId), 1);
  assert.equal(providerCalls.get(second.reportId), 1);
  assert.equal(failCalls, 2);
  assert.equal(localStatus.rapidCaptureQueue.items[1]?.ocr.state, "succeeded");
});

test("lost terminal OCR response already advances through persisted exact status without provider rerun", async () => {
  const first = behavioralOcrItem("1");
  const second = behavioralOcrItem("2");
  let serverStatus = behavioralStatus([first, second]);
  let failCalls = 0;
  const providerCalls = new Map<string, number>();
  const snapshot = () => behavioralStatus(serverStatus.rapidCaptureQueue.items);
  const callBridge = async (request: { action: string; body?: Record<string, unknown> }) => {
    const queueItemId = String(request.body?.queueItemId ?? "");
    const item = serverStatus.rapidCaptureQueue.items.find((candidate) => candidate.queueItemId === queueItemId);
    if (request.action === "status") return snapshot();
    if (!item) throw new Error("Exact queued OCR item was not found.");
    if (request.action === "begin-queued-ocr") {
      item.ocr = { state: "in_flight", attemptOwnerId: OCR_ATTEMPT_OWNER_ID };
      return snapshot();
    }
    if (request.action === "complete-queued-ocr") {
      item.ocr = { state: "succeeded", attemptOwnerId: OCR_ATTEMPT_OWNER_ID };
      return snapshot();
    }
    if (request.action === "fail-queued-ocr") {
      failCalls += 1;
      item.ocr = { state: "failed", attemptOwnerId: OCR_ATTEMPT_OWNER_ID };
      throw new Error("The terminal response was lost after durable persistence.");
    }
    throw new Error(`Unexpected bridge action ${request.action}.`);
  };
  const runProvider = async (request: Record<string, unknown>) => {
    const reportId = String(request.reportId);
    providerCalls.set(reportId, (providerCalls.get(reportId) ?? 0) + 1);
    if (reportId === first.reportId) throw new Error("Hosted OCR failed once.");
    return { safe: true };
  };
  const firstHarness = createEligibleOcrBehaviorHarness({ item: first, callBridge, runProvider });
  firstHarness.invoke();
  await waitForQueuedOcrBehavior(
    () => failCalls === 1 && firstHarness.running.size === 0,
    "the lost terminal response",
  );

  const polledStatus = snapshot();
  assert.equal(polledStatus.rapidCaptureQueue.items[0]?.ocr.state, "failed");
  const next = selectNextSerializedAiGraderOcrItem(
    polledStatus.rapidCaptureQueue.items as unknown as Parameters<typeof selectNextSerializedAiGraderOcrItem>[0],
  );
  assert.equal(next?.queueItemId, second.queueItemId);

  const secondHarness = createEligibleOcrBehaviorHarness({ item: second, callBridge, runProvider });
  secondHarness.invoke();
  await waitForQueuedOcrBehavior(
    () => serverStatus.rapidCaptureQueue.items[1]?.ocr.state === "succeeded" && secondHarness.running.size === 0,
    "the next eligible card after exact status polling",
  );

  assert.equal(providerCalls.get(first.reportId), 1);
  assert.equal(providerCalls.get(second.reportId), 1);
  assert.equal(failCalls, 1);
});

test("successful same-token Refresh Sign-In wakes one fresh authorization and queued OCR claim", async () => {
  let verificationCalls = 0;
  const harness = createEligibleOcrBehaviorHarness({
    verifyProductionSession: async () => {
      verificationCalls += 1;
      if (verificationCalls === 1) throw new Error("The saved Production authorization is not ready.");
      return { displayName: "OCR Operator", role: "admin" };
    },
  });

  harness.invoke();
  await waitForQueuedOcrBehavior(
    () => verificationCalls === 1 && harness.running.size === 0,
    "the initial unclaimed authorization failure",
  );
  assert.equal(harness.actions.filter((action) => action === "begin-queued-ocr").length, 0);
  const dependenciesBeforeRefresh = harness.dependencies();
  Object.assign(harness.scope, {
    requireProductionSession: async () => ({ token: "same-production-token" }),
  });
  const signInForProduction = evaluateStationExpression<() => Promise<void>>(
    stationVariableInitializerExpression("signInForProduction"),
    harness.scope,
  );
  await signInForProduction();
  const dependenciesAfterRefresh = harness.dependencies();
  if (stationDependenciesChanged(dependenciesBeforeRefresh, dependenciesAfterRefresh)) {
    harness.invoke();
    await waitForQueuedOcrBehavior(
      () => harness.running.size === 0 && harness.actions.includes("begin-queued-ocr"),
      "the refreshed same-token queued OCR claim",
    );
  }

  assert.equal(verificationCalls, 2);
  assert.equal(harness.actions.filter((action) => action === "begin-queued-ocr").length, 1);
  assert.equal(harness.actions.filter((action) => action === "complete-queued-ocr").length, 1);
});

test("operator station contract exposes the single retained grading workflow", () => {
  const labels = AI_GRADER_STATION_STEPS.map((step) => step.label);
  assert.deepEqual(labels, ["Start New Card", "Capture Front", "Capture Back", "Approve & Publish"]);
  assert.equal(labels.some((label) => /fixture|accept capture|safe off/i.test(label)), false);
});

test("removed browser safety, Single finalization, and separate queue mutation actions are absent", () => {
  for (const action of [
    "safe-off", "confirm-light-idle-off", "confirm-fixture-rulers", "accept-profile", "confirm-flip",
    "configure-rapid-capture", "queue-current-card", "run-diagnostics", "export-report-bundle",
    "calculate-final-grade", "finalize-report", "generate-label-data",
  ]) assert.equal(parseAiGraderStationAction(action), null);
  for (const action of ["activate-queue-item", "begin-queued-ocr", "complete-queued-ocr", "fail-queued-ocr"]) {
    assert.equal(parseAiGraderStationAction(action), action);
  }
  const status = buildAiGraderLocalStationStatus();
  const serialized = JSON.stringify(status);
  for (const removed of ["frontWorkflowAuthority", "lightingProfileAccepted", "coldDebugMode", "fallbackUsed"]) {
    assert.equal(serialized.includes(removed), false, `${removed} must be absent`);
  }
  assert.equal(status.captureProfile, "production_fast");
  assert.deepEqual(status.captureProfileGuard.availableCaptureProfiles, ["production_fast"]);
  assert.equal(status.captureProfileGuard.stationSettingRequired, false);
  assert.equal(status.captureProfileGuard.selectionSource, "bridge_required");
  assert.equal(status.captureProfileGuard.oneRoadProductionFastRequired, true);
  assert.equal(serialized.includes("productionFastOptIn"), false);
  assert.equal(status.rapidCapture.enabled, true);
  assert.equal(status.rapidCaptureQueue.enabled, true);
  assert.equal(status.rapidCaptureQueue.reportWorkerSerialized, true);
  assert.equal(status.liveLighting.safety.maxDutyPercent, 99.9);
  assert.equal(status.liveLighting.safety.watchdogOwnedByBridge, true);
});

test("Rapid Capture queue sanitization preserves bounded report state and strips local paths", () => {
  const queue = sanitizeAiGraderRapidCaptureQueue({
    enabled: true,
    activeQueueItemId: "session-1-rapid-card",
    activeReview: {
      queueItemId: "session-1-rapid-card",
      gradingSessionId: "session-1",
      reportId: "report-1",
      manifest: {
        latestReport: { reportId: "report-1", exists: true },
        reportBundle: {
          schemaVersion: AI_GRADER_REPORT_BUNDLE_V03_VERSION,
          reportId: "report-1",
          nested: { normalizedPath: "C:\\TenKings\\private\\normalized.png", safeMeasurement: 8.6 },
        },
        productionRelease: {
          reportId: "report-1",
          gradingSessionId: "session-1",
          nested: { serviceToken: "must-not-survive", safeStatus: "ready" },
        },
      },
    },
    items: [{
      queueItemId: "session-1-rapid-card",
      sessionId: "session-1",
      reportId: "report-1",
      state: "report_ready_needs_confirm",
      queuedAt: "2026-07-17T12:00:00.000Z",
      updatedAt: "2026-07-17T12:00:01.000Z",
      history: [],
      ocr: {
        state: "succeeded",
        updatedAt: "2026-07-17T12:00:02.000Z",
        attemptCount: 1,
        attemptOwnerId: OCR_ATTEMPT_OWNER_ID,
        eligibleAt: "2026-07-17T12:00:00.000Z",
        startedAt: "2026-07-17T12:00:01.000Z",
        completedAt: "2026-07-17T12:00:02.000Z",
        images: ["front", "back"].map((side) => ({
          side,
          artifactRole: "normalized_card",
          fileName: `${side}-normalized-card.png`,
          mimeType: "image/png",
          checksumSha256: side === "front" ? "a".repeat(64) : "b".repeat(64),
          byteSize: 1024,
          widthPx: 1200,
          heightPx: 1680,
        })),
        result: {
          queueItemId: "session-1-rapid-card",
          gradingSessionId: "session-1",
          reportId: "report-1",
          status: "prefill_ready",
        },
      },
      manifestPath: "C:\\TenKings\\private\\station-session.json",
      autoConfirmed: true,
    }],
  });
  assert.equal(queue.enabled, true);
  assert.equal(queue.reportWorkerSerialized, true);
  assert.equal(queue.items.length, 1);
  assert.equal(queue.items[0].reportId, "report-1");
  assert.equal("manifestPath" in queue.items[0], false);
  assert.equal(queue.items[0].autoConfirmed, false);
  assert.equal(queue.items[0].ocr.state, "succeeded");
  assert.equal(queue.items[0].ocr.attemptCount, 1);
  assert.equal(queue.items[0].ocr.attemptOwnerId, OCR_ATTEMPT_OWNER_ID);
  assert.equal(queue.items[0].ocr.result?.reportId, "report-1");
  assert.equal(queue.activeReview?.queueItemId, "session-1-rapid-card");
  assert.equal(queue.activeReview?.gradingSessionId, "session-1");
  assert.equal(queue.activeReview?.reportId, "report-1");
  assert.equal(queue.activeReview?.manifest.reportBundle?.schemaVersion, AI_GRADER_REPORT_BUNDLE_V03_VERSION);
  assert.doesNotMatch(JSON.stringify(queue.activeReview), /normalizedPath|C:\\\\TenKings|serviceToken|must-not-survive/);
  assert.equal((queue.activeReview?.manifest.reportBundle as any)?.nested?.safeMeasurement, 8.6);
  assert.equal(queue.activeReview?.manifest.productionRelease?.gradingSessionId, "session-1");
});

test("valid one-side normalized evidence remains waiting while the exact Back PNG is still processing", () => {
  const queue = sanitizeAiGraderRapidCaptureQueue({
    items: [{
      queueItemId: "queue-waiting-front",
      sessionId: "session-waiting-front",
      reportId: "report-waiting-front",
      state: "finalizing",
      queuedAt: "2026-07-20T05:40:58.639Z",
      updatedAt: "2026-07-20T05:40:59.000Z",
      history: [],
      ocr: {
        state: "waiting_for_normalized",
        updatedAt: "2026-07-20T05:40:59.000Z",
        attemptCount: 0,
        images: [{
          side: "front",
          artifactRole: "normalized_card",
          fileName: "front-normalized-card.png",
          mimeType: "image/png",
          checksumSha256: "a".repeat(64),
          byteSize: 1360997,
          widthPx: 1200,
          heightPx: 1680,
        }],
      },
    }],
  });

  assert.equal(queue.items[0].state, "finalizing");
  assert.equal(queue.items[0].ocr.state, "waiting_for_normalized");
  assert.deepEqual(queue.items[0].ocr.images?.map((image) => image.side), ["front"]);
  assert.equal(selectNextSerializedAiGraderOcrItem(queue.items), undefined);
});

test("malformed or cross-identity completed OCR becomes one explicit terminal item failure", () => {
  const queue = sanitizeAiGraderRapidCaptureQueue({
    activeQueueItemId: "queue-corrupt",
    activeReview: {
      queueItemId: "queue-corrupt",
      gradingSessionId: "session-corrupt",
      reportId: "report-corrupt",
      manifest: {
        latestReport: { reportId: "report-corrupt", exists: true },
        reportBundle: { reportId: "report-corrupt", gradingSessionId: "session-corrupt" },
        productionRelease: { reportId: "report-corrupt", gradingSessionId: "session-corrupt" },
      },
    },
    items: [{
      queueItemId: "queue-corrupt",
      sessionId: "session-corrupt",
      reportId: "report-corrupt",
      state: "report_ready_needs_confirm",
      queuedAt: "2026-07-17T12:00:00.000Z",
      updatedAt: "2026-07-17T12:00:02.000Z",
      history: [],
      ocr: {
        state: "succeeded",
        updatedAt: "2026-07-17T12:00:02.000Z",
        attemptCount: 1,
        completedAt: "2026-07-17T12:00:02.000Z",
        result: {
          queueItemId: "queue-other",
          gradingSessionId: "session-corrupt",
          reportId: "report-corrupt",
          status: "prefill_ready",
        },
      },
    }],
  });
  assert.equal(queue.items[0].state, "failed");
  assert.equal(queue.items[0].ocr.state, "failed");
  assert.equal(queue.items[0].ocr.failure?.code, "AI_GRADER_OCR_PERSISTED_STATE_INVALID");
  assert.match(queue.items[0].error ?? "", /will not retry automatically/);
  assert.equal(queue.activeReview, undefined);
});

test("browser lighting display follows only the authoritative acknowledged bridge state", () => {
  const status = buildAiGraderLocalStationStatus({ action: "start-session" });
  status.liveLighting.profile = {
    ...status.liveLighting.profile,
    enabled: true,
    acceptedForCapture: true,
    source: "accepted_station_profile",
  };
  assert.equal(aiGraderAuthoritativeLiveLightingDraft(status.liveLighting).enabled, false);

  status.liveLighting.status = "on";
  status.liveLighting.applied = {
    enabled: true,
    dutyPercent: status.liveLighting.profile.dutyPercent,
    actualLeimacPwmStep: status.liveLighting.profile.actualLeimacPwmStep,
    channels: [...status.liveLighting.profile.channels],
    verificationState: "verified",
    expectedWriteCount: 5,
    acknowledgedWriteCount: 4,
    verificationComplete: false,
    lastResponseKinds: ["mock", "mock", "mock", "mock"],
    verifiedAt: "2026-07-17T12:00:00.000Z",
  };
  status.liveLighting.physicalState = {
    state: "unverified",
    reason: "dynamic test incomplete acknowledgement",
    changedAt: "2026-07-17T12:00:00.000Z",
    expectedWriteCount: 5,
    acknowledgedWriteCount: 4,
    complete: false,
    verifiedAt: "2026-07-17T12:00:00.000Z",
  };
  assert.equal(aiGraderAuthoritativeLiveLightingDraft(status.liveLighting).enabled, false);

  status.liveLighting.applied.acknowledgedWriteCount = 5;
  status.liveLighting.applied.verificationComplete = true;
  status.liveLighting.applied.lastResponseKinds = ["mock", "mock", "mock", "mock", "mock"];
  status.liveLighting.physicalState.state = "positioning_light_verified";
  status.liveLighting.physicalState.reason = "dynamic test complete acknowledgement";
  status.liveLighting.physicalState.acknowledgedWriteCount = 5;
  status.liveLighting.physicalState.complete = true;
  assert.deepEqual(aiGraderAuthoritativeLiveLightingDraft(status.liveLighting), {
    enabled: true,
    dutyPercent: status.liveLighting.profile.dutyPercent,
    channels: status.liveLighting.profile.channels,
  });
});

test("a prepared Rapid item is eligible for the one Approve & Publish authority only with normal identity and sign-in", () => {
  assert.equal(aiGraderApproveAndPublishEligible({
    itemState: "report_ready_needs_confirm",
    reportReady: true,
    finalReady: true,
    productionSignedIn: true,
    identityReady: true,
    publishStatus: "idle",
  }), true);
  assert.equal(aiGraderApproveAndPublishEligible({
    itemState: "report_ready_needs_confirm",
    reportReady: true,
    finalReady: false,
    productionSignedIn: true,
    identityReady: true,
    publishStatus: "idle",
  }), false);
  assert.equal(aiGraderApproveAndPublishEligible({
    itemState: "report_ready_needs_confirm",
    reportReady: true,
    finalReady: true,
    productionSignedIn: false,
    identityReady: true,
    publishStatus: "idle",
  }), false);
});

test("manual geometry fallback cannot enter the display contract", () => {
  const geometry = sanitizeAiGraderPreviewCardGeometry({
    side: "front", placementState: "ready", geometrySource: "manual_override", captureMode: "manual_capture",
    confidenceBasis: "operator_confirmation", detectionUsed: false, confidence: 1,
  }, "front");
  assert.equal(geometry?.geometrySource, "none");
  assert.equal(geometry?.captureMode, "none");
});

test("capture request binds exact session, report, side, epoch, and frame without a browser intent gate", async () => {
  const assertion = aiGraderCaptureAssertionFromFrame({
    frame: { sessionId: "session-1", side: "front", sideEpoch: "front-epoch-1", frameId: "frame-9" },
    reportId: "report-1",
    geometryCaptureMode: "detected_geometry",
    captureTriggerMode: "operator",
  });
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  await runAiGraderCapture({
    baseUrl: "http://127.0.0.1:47652",
    stationToken: "paired-station-token",
    assertion,
    requestId: "capture-front-1234567890",
    captureTriggerAt: "2026-07-17T12:00:00.000Z",
  }, (async (url, init) => {
    capturedUrl = String(url);
    capturedInit = init;
    return new Response(JSON.stringify({ ok: true, result: buildAiGraderLocalStationStatus() }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch);
  assert.equal(capturedUrl, "http://127.0.0.1:47652/actions/capture-front");
  assert.deepEqual(JSON.parse(String(capturedInit?.body)), {
    idempotencyKey: "capture-front-1234567890",
    expectedSessionId: "session-1",
    expectedReportId: "report-1",
    expectedSide: "front",
    expectedSideEpoch: "front-epoch-1",
    expectedFrameId: "frame-9",
    geometryCaptureMode: "detected_geometry",
    captureTriggerMode: "operator",
    captureTriggerAt: "2026-07-17T12:00:00.000Z",
  });
});

test("Start New Card depends only on authoritative capture and lighting ownership", () => {
  const authoritative = {
    bridgeConnected: true,
    captureBusy: false,
    lightingRequestPending: false,
    captureLockHeld: false,
    warmRunnerStatus: "processing" as const,
    currentStep: "start_new_card" as const,
  };
  assert.equal(aiGraderStartNewCardAvailable(authoritative), true);
  assert.equal(aiGraderStartNewCardAvailable({ ...authoritative, captureLockHeld: true }), false);
  assert.equal(aiGraderStartNewCardAvailable({ ...authoritative, currentStep: "capture_back" }), false);
  assert.equal(aiGraderStartNewCardAvailable({ ...authoritative, currentStep: "session_complete" }), false);
  assert.equal(aiGraderStartNewCardAvailable({ ...authoritative, lightingRequestPending: true }), false);
});

test("queued OCR selects one eligible item only when no exact item is already in flight", () => {
  const eligible = {
    queueItemId: "queue-eligible",
    sessionId: "session-eligible",
    reportId: "report-eligible",
    state: "finalizing" as const,
    queuedAt: "2026-07-18T12:00:00.000Z",
    updatedAt: "2026-07-18T12:00:00.000Z",
    history: [],
    humanConfirmationRequired: true as const,
    autoConfirmed: false as const,
    autoPublished: false as const,
    ocr: {
      state: "eligible" as const,
      updatedAt: "2026-07-18T12:00:00.000Z",
      attemptCount: 0 as const,
    },
  };
  const inFlight = {
    ...eligible,
    queueItemId: "queue-in-flight",
    sessionId: "session-in-flight",
    reportId: "report-in-flight",
    ocr: {
      ...eligible.ocr,
      state: "in_flight" as const,
      attemptCount: 1 as const,
      attemptOwnerId: OCR_ATTEMPT_OWNER_ID,
    },
  };
  assert.equal(selectNextSerializedAiGraderOcrItem([eligible])?.queueItemId, eligible.queueItemId);
  assert.equal(selectNextSerializedAiGraderOcrItem([eligible, inFlight]), undefined);
  const oldest = {
    ...eligible,
    queueItemId: "queue-oldest",
    sessionId: "session-oldest",
    reportId: "report-oldest",
    queuedAt: "2026-07-18T11:59:58.000Z",
  };
  const tiedFirst = {
    ...eligible,
    queueItemId: "queue-a",
    sessionId: "session-a",
    reportId: "report-a",
  };
  const tiedSecond = {
    ...eligible,
    queueItemId: "queue-b",
    sessionId: "session-b",
    reportId: "report-b",
  };
  assert.equal(
    selectNextSerializedAiGraderOcrItem([eligible, oldest])?.queueItemId,
    oldest.queueItemId,
    "the serialized conveyor claims the oldest eligible card even when the helper prepends newer items",
  );
  assert.equal(
    selectNextSerializedAiGraderOcrItem([tiedSecond, tiedFirst])?.queueItemId,
    tiedFirst.queueItemId,
    "equal queued timestamps use the queue identity as a deterministic tie-breaker",
  );
});

test("Back cannot report clean capture release until the exact queue identity exists", () => {
  const status = buildAiGraderLocalStationStatus();
  const exact = { gradingSessionId: "session-atomic", reportId: "report-atomic" };
  assert.equal(aiGraderAtomicBackQueueReleaseMatches({ status, ...exact }), false);
  status.rapidCaptureQueue.items = [{
    queueItemId: "queue-atomic",
    sessionId: exact.gradingSessionId,
    reportId: exact.reportId,
    state: "finalizing",
    queuedAt: "2026-07-18T12:00:00.000Z",
    updatedAt: "2026-07-18T12:00:00.000Z",
    history: [],
    humanConfirmationRequired: true,
    autoConfirmed: false,
    autoPublished: false,
    ocr: {
      state: "waiting_for_normalized",
      updatedAt: "2026-07-18T12:00:00.000Z",
      attemptCount: 0,
    },
  }];
  assert.equal(aiGraderAtomicBackQueueReleaseMatches({ status, ...exact }), true);
  assert.equal(aiGraderAtomicBackQueueReleaseMatches({
    status,
    gradingSessionId: "session-other",
    reportId: exact.reportId,
  }), false);
});

test("published local items are read-only before hosted mutation while another ready item remains publishable", () => {
  let hostedCalls = 0;
  const enterHostedPublish = (state: "published" | "report_ready_needs_confirm") => {
    assertAiGraderRapidItemPublishable(state);
    hostedCalls += 1;
  };

  assert.equal(aiGraderRapidItemPublishable("published"), false);
  assert.throws(() => enterHostedPublish("published"), /unpublished exact item ready for review/i);
  assert.equal(hostedCalls, 0);
  assert.equal(aiGraderRapidItemPublishable("report_ready_needs_confirm"), true);
  assert.equal(aiGraderRapidItemPublishable("confirmed_needs_publish"), true);
  enterHostedPublish("report_ready_needs_confirm");
  assert.equal(hostedCalls, 1);
});

test("queue review activation requires the exact queue, grading-session, and report identity", () => {
  assert.deepEqual(buildAiGraderRapidQueueActivationRequest({
    queueItemId: "queue-1",
    gradingSessionId: "session-1",
    reportId: "report-1",
  }), {
    queueItemId: "queue-1",
    gradingSessionId: "session-1",
    reportId: "report-1",
  });
  assert.throws(() => buildAiGraderRapidQueueActivationRequest({
    queueItemId: "queue-1",
    gradingSessionId: "",
    reportId: "report-1",
  }), /gradingSessionId is invalid/);
});

test("one synchronous publication claim freezes review selection but never owns capture", () => {
  const cardOne = {
    queueItemId: "queue-1",
    gradingSessionId: "session-1",
    reportId: "report-1",
  };
  assert.equal(aiGraderReviewActivationAvailable(null), true);
  assert.equal(aiGraderReviewActivationAvailable(cardOne), false);
  assert.equal(aiGraderRapidQueueIdentityMatches(cardOne, { ...cardOne }), true);
  for (const drift of [
    { ...cardOne, queueItemId: "queue-2" },
    { ...cardOne, gradingSessionId: "session-2" },
    { ...cardOne, reportId: "report-2" },
  ]) {
    assert.equal(aiGraderRapidQueueIdentityMatches(cardOne, drift), false);
  }

  assert.equal(aiGraderStartNewCardAvailable({
    bridgeConnected: true,
    captureBusy: false,
    lightingRequestPending: false,
    captureLockHeld: false,
    warmRunnerStatus: "processing",
    currentStep: "start_new_card",
  }), true, "a hosted publication claim is not part of camera ownership");
});

test("validated hosted publication acknowledges only the exact local item once before route verification failure", async () => {
  const selected = {
    queueItemId: "queue-1",
    gradingSessionId: "session-1",
    reportId: "report-1",
  };
  const other = {
    queueItemId: "queue-2",
    gradingSessionId: "session-2",
    reportId: "report-2",
  };
  const acknowledged: typeof selected[] = [];
  const events: string[] = [];

  await assert.rejects(
    completeAiGraderExactPublicationHandoff({
      identity: selected,
      async acknowledgeExactLocalItem(identity) {
        events.push(`ack:${identity.queueItemId}`);
        acknowledged.push({ ...identity });
      },
      async verifyPublishedRoute(reportId) {
        events.push(`verify:${reportId}`);
        throw new Error("public route propagation delayed");
      },
    }),
    /public route propagation delayed/,
  );

  assert.deepEqual(events, ["ack:queue-1", "verify:report-1"]);
  assert.deepEqual(acknowledged, [selected]);
  assert.equal(acknowledged.some((identity) => aiGraderRapidQueueIdentityMatches(identity, other)), false);
});

test("selected publication evidence repeats only the exact activated identity after hosted success", () => {
  assert.deepEqual(buildAiGraderRapidPublicationEvidence({
    queueItemId: "queue-1",
    gradingSessionId: "session-1",
    reportId: "report-1",
    publishedAt: "2026-07-18T12:00:00.000Z",
  }), {
    queueItemId: "queue-1",
    gradingSessionId: "session-1",
    reportId: "report-1",
    publication: {
      queueItemId: "queue-1",
      gradingSessionId: "session-1",
      reportId: "report-1",
      publicationStatus: "published",
      publishedAt: "2026-07-18T12:00:00.000Z",
    },
  });
});

test("queued OCR terminal failure uses the helper's canonical exact failure body", () => {
  const body = buildAiGraderQueuedOcrFailureRequest({
    queueItemId: "queue-1",
    gradingSessionId: "session-1",
    reportId: "report-1",
    attemptOwnerId: OCR_ATTEMPT_OWNER_ID,
    failure: { code: "AI_GRADER_OCR_INTERNAL_FAILED", message: "Hosted OCR failed once." },
  });
  assert.deepEqual(body, {
    queueItemId: "queue-1",
    gradingSessionId: "session-1",
    reportId: "report-1",
    attemptOwnerId: OCR_ATTEMPT_OWNER_ID,
    failure: { code: "AI_GRADER_OCR_INTERNAL_FAILED", message: "Hosted OCR failed once." },
  });
  assert.equal("ocrFailure" in body, false);
  assert.throws(() => buildAiGraderQueuedOcrFailureRequest({
    queueItemId: "queue-1",
    gradingSessionId: "session-1",
    reportId: "report-1",
    attemptOwnerId: OCR_ATTEMPT_OWNER_ID,
    failure: { code: "AI_GRADER_OCR_PREFILL_FAILED", message: "Unsupported code." },
  }), /terminal failure evidence is invalid/);
});

test("queued OCR reload, back-forward, and station remount reuse the persisted owner only under its available origin lock", async () => {
  for (const navigationType of ["reload", "back_forward", "navigate"]) {
    const lockManager = new FakeQueuedOcrOwnerLockManager();
    const storage = queuedOcrOwnerStorage(OCR_ATTEMPT_OWNER_ID);
    let uuidCalls = 0;
    const claim = await initializeAiGraderQueuedOcrAttemptOwner({
      lockManager,
      storage,
      navigationType,
      createUuid() {
        uuidCalls += 1;
        return "22222222-2222-4222-8222-222222222222";
      },
    });
    const lockName = AI_GRADER_QUEUED_OCR_ATTEMPT_OWNER_LOCK_PREFIX + OCR_ATTEMPT_OWNER_ID;
    assert.equal(claim.attemptOwnerId, OCR_ATTEMPT_OWNER_ID);
    assert.equal(claim.reusedPersistedOwner, true);
    assert.equal(uuidCalls, 0);
    assert.equal(lockManager.held.has(lockName), true);
    claim.release();
    await settleQueuedOcrOwnerLockRelease();
    assert.equal(lockManager.held.has(lockName), false);
  }
});

test("a cloned tab that collides with the held persisted owner atomically claims one fresh UUID", async () => {
  const lockManager = new FakeQueuedOcrOwnerLockManager();
  const originalStorage = queuedOcrOwnerStorage();
  const originalClaim = await initializeAiGraderQueuedOcrAttemptOwner({
    lockManager,
    storage: originalStorage,
    navigationType: "navigate",
    createUuid: () => "11111111-1111-4111-8111-111111111111",
  });
  assert.equal(originalClaim.attemptOwnerId, OCR_ATTEMPT_OWNER_ID);

  const cloneStorage = queuedOcrOwnerStorage(OCR_ATTEMPT_OWNER_ID);
  const cloneClaim = await initializeAiGraderQueuedOcrAttemptOwner({
    lockManager,
    storage: cloneStorage,
    navigationType: "reload",
    createUuid: () => "22222222-2222-4222-8222-222222222222",
  });
  const cloneOwnerId = "ocr-attempt-22222222-2222-4222-8222-222222222222";
  assert.equal(cloneClaim.attemptOwnerId, cloneOwnerId);
  assert.equal(cloneClaim.reusedPersistedOwner, false);
  assert.equal(cloneStorage.getItem(AI_GRADER_QUEUED_OCR_ATTEMPT_OWNER_STORAGE_KEY), cloneOwnerId);
  assert.deepEqual(
    lockManager.requests.map((request) => request.name),
    [
      AI_GRADER_QUEUED_OCR_ATTEMPT_OWNER_LOCK_PREFIX + OCR_ATTEMPT_OWNER_ID,
      AI_GRADER_QUEUED_OCR_ATTEMPT_OWNER_LOCK_PREFIX + OCR_ATTEMPT_OWNER_ID,
      AI_GRADER_QUEUED_OCR_ATTEMPT_OWNER_LOCK_PREFIX + cloneOwnerId,
    ],
  );
  assert.equal(lockManager.held.size, 2);
  originalClaim.release();
  cloneClaim.release();
  await settleQueuedOcrOwnerLockRelease();
  assert.equal(lockManager.held.size, 0);
});

test("orphan recovery waits behind a live owner and acquires only after that station page releases", async () => {
  const lockManager = new FakeQueuedOcrOwnerLockManager();
  const liveClaim = await initializeAiGraderQueuedOcrAttemptOwner({
    lockManager,
    storage: queuedOcrOwnerStorage(),
    navigationType: "navigate",
    createUuid: () => "11111111-1111-4111-8111-111111111111",
  });
  const abortController = new AbortController();
  let recoveryAcquired = false;
  const recoveryPromise = waitForAiGraderQueuedOcrAttemptOwnerLock({
    attemptOwnerId: liveClaim.attemptOwnerId,
    lockManager,
    signal: abortController.signal,
  }).then((claim) => {
    recoveryAcquired = true;
    return claim;
  });
  await settleQueuedOcrOwnerLockRelease();
  assert.equal(recoveryAcquired, false, "a live tab's exact owner must not be terminalized");
  assert.equal(lockManager.requests.at(-1)?.ifAvailable, false);

  liveClaim.release();
  const recoveryClaim = await recoveryPromise;
  assert.equal(recoveryAcquired, true);
  assert.equal(
    lockManager.held.has(AI_GRADER_QUEUED_OCR_ATTEMPT_OWNER_LOCK_PREFIX + liveClaim.attemptOwnerId),
    true,
  );
  recoveryClaim.release();
  await settleQueuedOcrOwnerLockRelease();
  assert.equal(lockManager.held.size, 0);
});

test("orphan recovery aborts a pending wait and releases an acquired lock across the cleanup race", async () => {
  const lockManager = new FakeQueuedOcrOwnerLockManager();
  const liveClaim = await initializeAiGraderQueuedOcrAttemptOwner({
    lockManager,
    storage: queuedOcrOwnerStorage(),
    createUuid: () => "11111111-1111-4111-8111-111111111111",
  });
  const pendingAbort = new AbortController();
  const pending = waitForAiGraderQueuedOcrAttemptOwnerLock({
    attemptOwnerId: liveClaim.attemptOwnerId,
    lockManager,
    signal: pendingAbort.signal,
  });
  pendingAbort.abort();
  await assert.rejects(pending, /aborted/i);
  assert.equal(lockManager.held.size, 1);
  liveClaim.release();
  await settleQueuedOcrOwnerLockRelease();

  const acquiredAbort = new AbortController();
  const acquired = await waitForAiGraderQueuedOcrAttemptOwnerLock({
    attemptOwnerId: OCR_ATTEMPT_OWNER_ID,
    lockManager,
    signal: acquiredAbort.signal,
  });
  assert.equal(lockManager.held.size, 1);
  acquiredAbort.abort();
  await settleQueuedOcrOwnerLockRelease();
  assert.equal(lockManager.held.size, 0);
  acquired.release();
});

test("queued OCR owner initialization fails closed when Web Locks are unavailable or reject", async () => {
  const unavailableStorage = queuedOcrOwnerStorage();
  await assert.rejects(
    initializeAiGraderQueuedOcrAttemptOwner({
      storage: unavailableStorage,
      navigationType: "navigate",
      createUuid: () => "22222222-2222-4222-8222-222222222222",
    }),
    /owner initialization failed.*Web Locks API is unavailable.*OCR will not be claimed/i,
  );
  assert.equal(unavailableStorage.getItem(AI_GRADER_QUEUED_OCR_ATTEMPT_OWNER_STORAGE_KEY), null);

  const failingLockManager = new FakeQueuedOcrOwnerLockManager();
  failingLockManager.failure = new Error("injected lock initialization failure");
  const persistedStorage = queuedOcrOwnerStorage(OCR_ATTEMPT_OWNER_ID);
  let uuidCalls = 0;
  await assert.rejects(
    initializeAiGraderQueuedOcrAttemptOwner({
      lockManager: failingLockManager,
      storage: persistedStorage,
      navigationType: "reload",
      createUuid() {
        uuidCalls += 1;
        return "22222222-2222-4222-8222-222222222222";
      },
    }),
    /owner initialization failed.*injected lock initialization failure.*OCR will not be claimed/i,
  );
  assert.equal(failingLockManager.requests.length, 1);
  assert.equal(uuidCalls, 0, "a rejected persisted-owner lock must not fall back to a fresh owner");
  assert.equal(
    persistedStorage.getItem(AI_GRADER_QUEUED_OCR_ATTEMPT_OWNER_STORAGE_KEY),
    OCR_ATTEMPT_OWNER_ID,
  );
});

test("queued OCR owner cleanup releases the station-page lock and permits exact route-return reuse", async () => {
  const lockManager = new FakeQueuedOcrOwnerLockManager();
  const storage = queuedOcrOwnerStorage();
  const firstClaim = await initializeAiGraderQueuedOcrAttemptOwner({
    lockManager,
    storage,
    navigationType: "navigate",
    createUuid: () => "33333333-3333-4333-8333-333333333333",
  });
  const lockName = AI_GRADER_QUEUED_OCR_ATTEMPT_OWNER_LOCK_PREFIX + firstClaim.attemptOwnerId;
  assert.equal(lockManager.held.has(lockName), true);
  firstClaim.release();
  firstClaim.release();
  await settleQueuedOcrOwnerLockRelease();
  assert.equal(lockManager.held.has(lockName), false);

  const remountClaim = await initializeAiGraderQueuedOcrAttemptOwner({
    lockManager,
    storage,
    navigationType: "navigate",
    createUuid() {
      throw new Error("released owner should be reused without a fresh UUID");
    },
  });
  assert.equal(remountClaim.attemptOwnerId, firstClaim.attemptOwnerId);
  assert.equal(remountClaim.reusedPersistedOwner, true);
  remountClaim.release();
  await settleQueuedOcrOwnerLockRelease();
});

test("queued OCR carries its Web-Lock owner through every exact lifecycle mutation", () => {
  const identity = {
    queueItemId: "queue-1",
    gradingSessionId: "session-1",
    reportId: "report-1",
    attemptOwnerId: OCR_ATTEMPT_OWNER_ID,
  };
  assert.deepEqual(buildAiGraderQueuedOcrClaimRequest(identity), identity);
  const result = {
    queueItemId: identity.queueItemId,
    gradingSessionId: identity.gradingSessionId,
    reportId: identity.reportId,
    status: "prefill_ready",
  };
  assert.deepEqual(buildAiGraderQueuedOcrCompletionRequest({ ...identity, result }), { ...identity, result });
  assert.throws(
    () => buildAiGraderQueuedOcrClaimRequest({ ...identity, attemptOwnerId: "short-owner" }),
    /attemptOwnerId is invalid/,
  );
  assert.throws(
    () => buildAiGraderQueuedOcrCompletionRequest({
      ...identity,
      result: { ...result, reportId: "other-report" },
    }),
    /result identity is invalid/,
  );
  assert.throws(
    () => buildAiGraderQueuedOcrClaimRequest({ ...identity, attemptOwnerId: "not-a-uuid" }),
    /attemptOwnerId is invalid/,
  );
});

test("production station rejects a version-compatible mock or contract bridge", async () => {
  await assert.rejects(
    fetchAiGraderStationBridgeHealth(
      { baseUrl: "http://127.0.0.1:47652" },
      (async () => new Response(JSON.stringify({
        ok: true,
        bridgeVersion: "ai-grader-local-station-bridge-v0.10",
        reportProducerContractVersion: "ai-grader-report-producer-v0.2",
        mode: "mock",
        hardwareActionsEnabled: false,
      }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch,
    ),
    /requires the real paired Dell helper/,
  );
});

test("station source has no Single route, separate queue mutation, OCR retry, duplicate next control, or hosted mock station API", () => {
  const source = readFileSync(new URL("../pages/ai-grader/station.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /stationCaptureMode|configure-rapid-capture|queue-current-card|retryOcrPrefill|Retry OCR|Start Next Grade|callStationContract/);
  const startBlock = source.slice(source.indexOf("const startNewCard"), source.indexOf("const runStationCapture"));
  const backBlock = source.slice(source.indexOf("const captureBackAndContinue"), source.indexOf("const activateRapidQueueItem"));
  const prepublicationCardBlock = source.slice(source.indexOf("const createCardFromConfirmedIdentity"), source.indexOf("const searchCardItems"));
  const activationBlock = source.slice(source.indexOf("const activateRapidQueueItem"), source.indexOf("const productionReleaseBody"));
  const hostedPublishBlock = source.slice(source.indexOf("const publishToTenKingsSystem"), source.indexOf("const approveAndPublish"));
  const publicationBlock = source.slice(source.indexOf("const approveAndPublish"), source.indexOf("const loadFinishReportBundle"));
  const finishNavigationBlock = source.slice(
    source.indexOf('<div className="finish-top-actions">'),
    source.indexOf('</div>', source.indexOf('<div className="finish-top-actions">')),
  );
  assert.doesNotMatch(startBlock, /resetReviewUiState|setIdentityDraft|setSelectedCard/);
  assert.doesNotMatch(backBlock, /resetReviewUiState|setIdentityDraft|setSelectedCard/);
  assert.doesNotMatch(startBlock, /publicationReviewClaim/);
  assert.ok(
    activationBlock.indexOf("publicationReviewClaimRef.current") < activationBlock.indexOf("await runAction"),
    "review selection checks the synchronous publication claim before bridge activation",
  );
  assert.ok(
    activationBlock.indexOf("aiGraderRapidItemPublishable(item.state)") < activationBlock.indexOf("await runAction"),
    "published items stop before local review activation",
  );
  assert.ok(
    prepublicationCardBlock.indexOf("assertAiGraderRapidItemPublishable") < prepublicationCardBlock.indexOf("productionAuthHeaders"),
    "published items stop before card creation authentication or mutation",
  );
  assert.ok(
    hostedPublishBlock.indexOf("assertAiGraderRapidItemPublishable") < hostedPublishBlock.indexOf("publish-init"),
    "published items stop before hosted upload initialization",
  );
  assert.ok(
    hostedPublishBlock.indexOf("sanitizeProductionReleaseForProduction") <
      hostedPublishBlock.indexOf("embedAiGraderAuthoritativeProductionRelease") &&
      hostedPublishBlock.indexOf("embedAiGraderAuthoritativeProductionRelease") <
        hostedPublishBlock.indexOf("publish-init"),
    "publish re-embeds the exact sanitized authoritative release before either hosted mutation",
  );
  assert.match(hostedPublishBlock, /reportBundle: sanitizedBundle,[\s\S]{0,100}productionRelease: sanitizedRelease/g);
  assert.ok(
    publicationBlock.indexOf("assertAiGraderRapidItemPublishable") < publicationBlock.indexOf("publicationReviewClaimRef.current = publicationIdentity") &&
      publicationBlock.indexOf("publicationReviewClaimRef.current = publicationIdentity") < publicationBlock.indexOf("await createCardFromConfirmedIdentity"),
    "Approve & Publish claims the exact selected triple before its first hosted wait",
  );
  assert.doesNotMatch(source, /RAPID_REVIEWABLE_STATES[^;]+published/);
  assert.match(source, /disabled=\{!canApproveAndPublish \|\| Boolean\(publicationReviewClaim\)/);
  assert.match(finishNavigationBlock, /onClick=\{\(\) => setWorkArea\("grade"\)\}/);
  assert.doesNotMatch(
    finishNavigationBlock.slice(0, finishNavigationBlock.indexOf("Back to Grading")),
    /disabled=/,
    "hosted Finish work must not disable navigation back to capture",
  );
  assert.doesNotMatch(prepublicationCardBlock, /run-comps|launchConfirmedCardComps|downstreamComps|shouldStart/);
  assert.match(source, /OCR failure persistence failed for queue/);
  assert.doesNotMatch(source, /action: "fail-queued-ocr",[\s\S]{0,500}\.catch\(\(\) => null\)/);
  assert.equal(existsSync(new URL("../pages/api/ai-grader/station/[...action].ts", import.meta.url)), false);
});

test("queued OCR auto-verifies a restored Production session before the exact attempt claim and cannot adopt another tab's attempt", () => {
  const source = readFileSync(new URL("../pages/ai-grader/station.tsx", import.meta.url), "utf8");
  const ocrStart = source.indexOf("const nextEligibleOcrItem");
  const ocrEnd = source.indexOf("if (!activeReview || !activeReviewItem)", ocrStart);
  const ocrBlock = source.slice(ocrStart, ocrEnd);
  const authorizationIndex = ocrBlock.indexOf("await verifyProductionSession(authorizedToken)");
  const claimRequestIndex = ocrBlock.indexOf('action: "begin-queued-ocr"');
  const validatedStateIndex = ocrBlock.indexOf('claimedItem?.ocr.state !== "in_flight"');
  const validatedOwnerIndex = ocrBlock.indexOf("claimedItem.ocr.attemptOwnerId !== attemptOwnerId");
  const localOwnershipIndex = ocrBlock.indexOf("claimed = true");
  const unclaimedBranchIndex = ocrBlock.indexOf("if (!claimed)");
  const unclaimedReturnIndex = ocrBlock.indexOf("return;", unclaimedBranchIndex);
  const failureMutationIndex = ocrBlock.indexOf('action: "fail-queued-ocr"');
  const recoveryBlock = ocrBlock.slice(ocrBlock.indexOf("const interruptedOcrItem"));
  const recoveryWaitIndex = recoveryBlock.indexOf("await waitForAiGraderQueuedOcrAttemptOwnerLock");
  const recoveryRefreshIndex = recoveryBlock.indexOf('action: "status"', recoveryWaitIndex);
  const recoveryExactCheckIndex = recoveryBlock.indexOf("const exactInFlight", recoveryRefreshIndex);
  const recoveryFailureIndex = recoveryBlock.indexOf('action: "fail-queued-ocr"', recoveryExactCheckIndex);

  const effectPrecondition = ocrBlock.slice(ocrBlock.indexOf("useEffect(() =>"), ocrBlock.indexOf("const attemptOwnerId"));
  assert.equal(effectPrecondition.includes("sessionLoading"), true);
  assert.equal(effectPrecondition.includes("!session?.token"), true);
  assert.doesNotMatch(effectPrecondition, /productionSignedIn|productionAuthState/);
  assert.ok(
    authorizationIndex >= 0 && authorizationIndex < claimRequestIndex,
    "the hosted Production session must be freshly verified before the helper consumes the one OCR attempt",
  );
  assert.ok(
    validatedStateIndex >= 0 && validatedOwnerIndex >= 0 &&
      validatedStateIndex < localOwnershipIndex && validatedOwnerIndex < localOwnershipIndex,
    "this tab owns an attempt only after the exact durable in-flight owner is returned and validated",
  );
  assert.ok(
    unclaimedBranchIndex >= 0 && unclaimedBranchIndex < unclaimedReturnIndex && unclaimedReturnIndex < failureMutationIndex,
    "an unclaimed tab returns without writing a terminal failure",
  );
  assert.match(ocrBlock, /buildAiGraderQueuedOcrClaimRequest\(\{ \.\.\.identity, attemptOwnerId \}\)/);
  assert.match(ocrBlock, /buildAiGraderQueuedOcrCompletionRequest\(\{ \.\.\.identity, attemptOwnerId, result \}\)/);
  assert.match(ocrBlock, /buildAiGraderQueuedOcrFailureRequest\(\{[\s\S]{0,150}attemptOwnerId/);
  assert.match(ocrBlock, /An observed in-flight attempt can belong to another live tab/);
  assert.doesNotMatch(ocrBlock, /shouldFail\s*=|persisted\?\.ocr\.state === "in_flight"/);
  assert.doesNotMatch(source, /const nextInterruptedOcrItem/);
  assert.equal(recoveryBlock.includes("queuedOcrRunningRef.current.has(identityKey)"), true);
  assert.equal(recoveryBlock.includes("queuedOcrInterruptedHandledRef.current.has(recoveryKey)"), true);
  assert.match(ocrBlock, /AI_GRADER_OCR_INTERRUPTED/);
  assert.ok(
    recoveryWaitIndex >= 0 &&
      recoveryWaitIndex < recoveryRefreshIndex &&
      recoveryRefreshIndex < recoveryExactCheckIndex &&
      recoveryExactCheckIndex < recoveryFailureIndex,
    "foreign-owner recovery must wait for the lock, refresh, recheck the exact tuple and owner, then fail",
  );
  for (const exactCheck of [
    "item.queueItemId === identity.queueItemId",
    "item.sessionId === identity.gradingSessionId",
    "item.reportId === identity.reportId",
    'item.ocr.state === "in_flight"',
    "item.ocr.attemptOwnerId === attemptOwnerId",
  ]) assert.equal(recoveryBlock.includes(exactCheck), true, "missing exact recovery check " + exactCheck);
  assert.equal(recoveryBlock.includes("if (!currentDocumentOwnsAttempt)"), true);
  assert.equal(recoveryBlock.includes("abortController.abort()"), true);
  assert.equal(recoveryBlock.includes("recoveryClaim?.release()"), true);
});

test("queued OCR attempt ownership initializes only after browser mount and waits silently through SSR hydration", () => {
  const source = readFileSync(new URL("../pages/ai-grader/station.tsx", import.meta.url), "utf8");
  const ownerStateStart = source.indexOf("const [queuedOcrAttemptOwner, setQueuedOcrAttemptOwner]");
  const ownerStateEnd = source.indexOf("const [ocrPrefillState", ownerStateStart);
  const ownerStateBlock = source.slice(ownerStateStart, ownerStateEnd);
  const ownerMountMarker = source.indexOf("initializeAiGraderQueuedOcrAttemptOwner().then");
  const ownerMountStart = source.lastIndexOf("useEffect(() => {", ownerMountMarker);
  const ownerMountEnd = source.indexOf("  useEffect(() => {", ownerMountMarker);
  const ownerMountBlock = source.slice(ownerMountStart, ownerMountEnd);
  const ocrStart = source.indexOf("const nextEligibleOcrItem");
  const ocrEnd = source.indexOf("const interruptedOcrItem", ocrStart);
  const ocrBlock = source.slice(ocrStart, ocrEnd);
  const hydrationWaitIndex = ocrBlock.indexOf('queuedOcrAttemptOwner.status === "uninitialized"');
  const ownerErrorIndex = ocrBlock.indexOf("setError(", hydrationWaitIndex);

  assert.ok(ownerStateStart >= 0 && ownerStateEnd > ownerStateStart);
  assert.ok(ocrEnd > ocrStart);
  assert.match(ownerStateBlock, /status: "uninitialized"/);
  assert.match(ownerStateBlock, /attemptOwnerId: null/);
  assert.equal(ownerStateBlock.includes("initializeAiGraderQueuedOcrAttemptOwner"), false);
  assert.ok(ownerMountStart > ownerStateEnd && ownerMountEnd > ownerMountStart && ownerMountEnd < ocrStart);
  assert.equal(ownerMountBlock.includes("initializeAiGraderQueuedOcrAttemptOwner().then"), true);
  assert.match(ownerMountBlock, /setQueuedOcrAttemptOwner\(\{ status: "ready", attemptOwnerId, error: null \}\)/);
  assert.match(ownerMountBlock, /status: "failed"/);
  assert.equal(ownerMountBlock.includes("queuedOcrAttemptOwnerClaimRef.current?.release()"), true);
  assert.ok(
    hydrationWaitIndex >= 0 && hydrationWaitIndex < ownerErrorIndex,
    "the OCR effect must return silently while browser ownership is still uninitialized",
  );
});

test("existing-card selection bypasses exact creation only with both CardAsset and Item IDs", () => {
  const source = readFileSync(new URL("../pages/ai-grader/station.tsx", import.meta.url), "utf8");
  const selectionBlock = source.slice(
    source.indexOf("function exactCardItemSelection"),
    source.indexOf("function rapidQueueTerminalFailureCopy"),
  );
  const createBlock = source.slice(source.indexOf("const createCardFromConfirmedIdentity"), source.indexOf("const searchCardItems"));
  const publicationBlock = source.slice(source.indexOf("const approveAndPublish"), source.indexOf("const loadFinishReportBundle"));
  const searchBlock = source.slice(source.indexOf("Existing Card Search"), source.indexOf('<section className="status">', source.indexOf("Existing Card Search")));

  assert.match(selectionBlock, /selection\?\.cardAssetId && selection\.itemId/);
  assert.doesNotMatch(selectionBlock, /cardAssetId \|\| selection\.itemId/);
  assert.match(source, /const linkedCardReady = Boolean\(exactSelectedCard\)/);
  assert.match(createBlock, /buildReportBundleForProduction\(sourceBundle, null\)/);
  assert.match(publicationBlock, /const cardSelection = exactSelectedCard\s*\? exactSelectedCard\s*: await createCardFromConfirmedIdentity/);
  assert.match(searchBlock, /setSelectedCard\(exactSelection\)/);
  assert.match(searchBlock, /does not establish both the exact CardAsset and Item IDs/);
});

test("failed local queue copy does not promise an inaccessible review form", () => {
  const source = readFileSync(new URL("../pages/ai-grader/station.tsx", import.meta.url), "utf8");
  const copyBlock = source.slice(
    source.indexOf("function rapidQueueTerminalFailureCopy"),
    source.indexOf("function pointToward"),
  );
  const queueStart = source.indexOf('<div className="rapid-queue-list">');
  const queueBlock = source.slice(queueStart, source.indexOf('<section className={productionSignedIn', queueStart));

  assert.match(copyBlock, /\.replace\(/);
  assert.match(copyBlock, /This failed item is not available for review or publication in the station/);
  assert.match(queueBlock, /rapidQueueTerminalFailureCopy\(item\)/);
  assert.doesNotMatch(queueBlock, /item\.error \?\? item\.ocr\.failure\?\.message/);
});

test("prepublication card linkage cannot create a hosted report, valuation, or Finish job", () => {
  const source = readFileSync(new URL("../lib/server/aiGraderProductionApi.ts", import.meta.url), "utf8");
  const createBlock = source.slice(
    source.indexOf("export async function createAiGraderCardFromReportRuntime"),
    source.indexOf("export async function finalizeAiGraderSlabbedPhotoUploadRuntime"),
  );
  assert.doesNotMatch(createBlock, /aiGraderReport|aiGraderValuation|linkConfirmedAiGraderCardTx|run-comps|Finish/);
  const labelRuntime = readFileSync(new URL("../lib/server/aiGraderLabelSheetRuntime.ts", import.meta.url), "utf8");
  assert.doesNotMatch(labelRuntime, /linkConfirmedAiGraderCardTx|workflowStatus:\s*"queued"/);
});
