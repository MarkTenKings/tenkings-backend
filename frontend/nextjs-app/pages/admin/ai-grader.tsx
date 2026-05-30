import Head from "next/head";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import AppShell from "../../components/AppShell";
import {
  ADMIN_PAGE_FRAME_CLASS,
  AdminPageHeader,
  adminCx,
  adminPanelClass,
  adminStatCardClass,
  adminSubpanelClass,
  adminTextareaClass,
} from "../../components/admin/AdminPrimitives";
import { useSession } from "../../hooks/useSession";
import {
  AiGraderAdminApiError,
  type AiGraderAdminApiStatus,
  type AiGraderAdminOperation,
  type AiGraderSimulatedSessionWorkflowResult,
  type AiGraderSimulatorMode,
  type AiGraderSimulatorResult,
  fetchAiGraderAdminStatus,
  generateAiGraderSimulatedSessionWorkflow,
  generateAiGraderSimulatorManifest,
  postAiGraderAdminOperation,
} from "../../lib/aiGraderAdminClient";
import {
  canRunAiGraderSimulator,
  canSubmitAiGraderOperation,
  hasAiGraderAdminAccess,
  resolveAiGraderAdminGateState,
} from "../../lib/aiGraderAdminUi";
import { buildAdminHeaders } from "../../lib/adminHeaders";

type OperationDefinition = {
  key: AiGraderAdminOperation;
  title: string;
  description: string;
  section: string;
  template: Record<string, unknown>;
};

const OPERATION_DEFINITIONS: OperationDefinition[] = [
  {
    key: "captureSessionDraft",
    title: "Create Capture Session Draft",
    section: "Capture Session",
    description: "Creates a draft CaptureSession through the feature-gated admin API when enabled.",
    template: {
      tenantId: "tenant_dev",
      rigId: "rig_dev",
      locationId: "location_dev",
      operatorId: "operator_dev",
      helperInstanceId: "helper_dev",
      gradingMode: "STANDARD",
      rawCardOnly: true,
    },
  },
  {
    key: "orchestratorTransition",
    title: "Persist Orchestrator Transition",
    section: "Orchestrator",
    description: "Validates the shared FSM transition and persists session state/audit metadata.",
    template: {
      tenantId: "tenant_dev",
      captureSessionId: "capture_session_dev",
      event: "CAPTURE_MANIFEST_RECORDED",
      guardResults: {
        manifestValid: true,
        mode: "STANDARD",
      },
      actorOperatorId: "operator_dev",
      reasonCode: "ADMIN_UI_SHELL_TEST",
    },
  },
  {
    key: "macroSuspectRegions",
    title: "Persist Macro Suspect Regions",
    section: "Macro Pipeline",
    description: "Persists validated MacroSuspectRegion records for one session side.",
    template: {
      tenantId: "tenant_dev",
      captureSessionId: "capture_session_dev",
      side: "FRONT",
      regions: [],
    },
  },
  {
    key: "gradeRunDraft",
    title: "Create GradeRun Draft",
    section: "GradeRun",
    description: "Creates a PENDING/RUNNING GradeRun shell from existing capture and provenance ids.",
    template: {
      tenantId: "tenant_dev",
      captureSessionId: "capture_session_dev",
      captureManifestId: "capture_manifest_dev",
      algorithmVersionId: "algorithm_version_dev",
      thresholdSetVersionId: "threshold_set_dev",
      runtimeEnvironmentId: "runtime_env_dev",
      inputChecksum: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      macroMeasurements: {},
      microMeasurements: {},
    },
  },
  {
    key: "gradeRunFinalize",
    title: "Finalize GradeRun",
    section: "GradeRun",
    description: "Finalizes a GradeRun payload without computing grades in the UI.",
    template: {
      tenantId: "tenant_dev",
      gradeRunId: "grade_run_dev",
      outputChecksum: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      finalGrades: {
        surface: 9,
      },
      fusionActions: [
        {
          action: "HOLD",
          target: "SURFACE",
          reasonCode: "ADMIN_UI_SHELL_TEST",
          evidenceIds: [],
        },
      ],
      warnings: [],
    },
  },
  {
    key: "authRunDraft",
    title: "Create AuthRun Draft",
    section: "AuthRun / Profile Governance",
    description: "Creates an AuthRun draft and preserves REFERENCE_NEEDED behavior when no active profile exists.",
    template: {
      tenantId: "tenant_dev",
      captureSessionId: "capture_session_dev",
      captureManifestId: "capture_manifest_dev",
      cardIdentity: {
        cardSet: "set_dev",
        cardNumber: "1",
        printRun: "base",
      },
      algorithmVersionId: "auth_algorithm_dev",
      runtimeEnvironmentId: "runtime_env_dev",
      measurements: {},
      evidence: {},
    },
  },
  {
    key: "authRunFinalize",
    title: "Finalize AuthRun",
    section: "AuthRun / Profile Governance",
    description: "Finalizes an AuthRun verdict payload through the backend policy helper.",
    template: {
      tenantId: "tenant_dev",
      authRunId: "auth_run_dev",
      requestedVerdict: "REFERENCE_NEEDED",
      measurements: {},
      evidence: {},
      outputChecksum: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    },
  },
];

const PLACEHOLDER_SECTIONS = [
  {
    title: "Profile Governance",
    description:
      "Candidate, approval, quarantine, and retire helpers exist in the database service layer. Dedicated admin API routes are intentionally not exposed in this shell yet.",
  },
  {
    title: "Certificate Readiness",
    description:
      "Readiness and certificate issue/revoke helpers remain backend-only until a later approved certificate workflow slice. No report or PDF behavior is exposed here.",
  },
];

const CAPTURE_SIMULATOR_MODES: AiGraderSimulatorMode[] = ["QUICK", "STANDARD", "AUTH_ONLY"];

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function statusTone(status: AiGraderAdminApiStatus | null) {
  if (!status) return "border-slate-500/30 text-slate-300";
  if (status.enabled) return "border-emerald-400/50 text-emerald-200";
  return "border-amber-400/50 text-amber-200";
}

function simulatorTone(status: AiGraderAdminApiStatus | null) {
  if (!status) return "border-slate-500/30 text-slate-300";
  if (status.enabled && status.simulator?.enabled) return "border-emerald-400/50 text-emerald-200";
  return "border-amber-400/50 text-amber-200";
}

function SimulatorPanel({
  enabled,
  status,
  adminHeaders,
}: {
  enabled: boolean;
  status: AiGraderAdminApiStatus | null;
  adminHeaders: Record<string, string>;
}) {
  const [mode, setMode] = useState<AiGraderSimulatorMode>("STANDARD");
  const [result, setResult] = useState<AiGraderSimulatorResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const runSimulator = async (nextMode: AiGraderSimulatorMode) => {
    if (!enabled) {
      setError(status?.simulator?.message ?? "AI Grader simulator mode is disabled.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      setResult(await generateAiGraderSimulatorManifest(nextMode, adminHeaders));
    } catch (requestError) {
      if (requestError instanceof AiGraderAdminApiError) {
        setError(requestError.message);
      } else {
        setError(requestError instanceof Error ? requestError.message : "AI Grader simulator request failed.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const summary = result?.summary;

  return (
    <section className={adminPanelClass("p-5")}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">Simulator Mode</p>
          <h2 className="mt-2 text-xl font-semibold text-white">Capture Manifest Generator</h2>
        </div>
        <span className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.2em] ${simulatorTone(status)}`}>
          Simulator: {enabled ? "enabled" : "disabled"}
        </span>
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
        <div className={adminSubpanelClass("flex flex-col gap-4 p-4")}>
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Capture Mode</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {CAPTURE_SIMULATOR_MODES.map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  onClick={() => setMode(candidate)}
                  className={adminCx(
                    "rounded-full border px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] transition",
                    mode === candidate
                      ? "border-gold-500/70 bg-gold-500 text-night-900"
                      : "border-white/12 bg-white/[0.03] text-slate-300 hover:border-white/35 hover:text-white"
                  )}
                >
                  {candidate}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={!enabled || submitting}
              onClick={() => runSimulator(mode)}
              className={adminCx(
                "rounded-full border px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.24em] transition",
                enabled && !submitting
                  ? "border-gold-500/60 bg-gold-500 text-night-900 hover:bg-gold-400"
                  : "cursor-not-allowed border-white/12 bg-white/[0.03] text-slate-500"
              )}
            >
              {submitting ? "Generating" : "Generate Manifest"}
            </button>
            <button
              type="button"
              disabled={!enabled || submitting}
              onClick={() => runSimulator("DEVICE_CAPABILITIES")}
              className={adminCx(
                "rounded-full border px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.24em] transition",
                enabled && !submitting
                  ? "border-white/20 bg-white/[0.04] text-slate-100 hover:border-white/40"
                  : "cursor-not-allowed border-white/12 bg-white/[0.03] text-slate-500"
              )}
            >
              Device Capabilities
            </button>
          </div>

          <p className={adminCx("text-sm", enabled ? "text-slate-400" : "text-amber-100/80")}>
            {status?.simulator?.message ?? "Simulator status is unavailable until the API status endpoint responds."}
          </p>
          {error ? <p className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</p> : null}
        </div>

        <div className={adminSubpanelClass("p-4")}>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <article className="rounded-xl border border-white/10 bg-black/20 p-3">
              <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">Mode</p>
              <p className="mt-2 text-lg font-semibold text-white">{summary?.mode ?? mode}</p>
            </article>
            <article className="rounded-xl border border-white/10 bg-black/20 p-3">
              <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">Frames</p>
              <p className="mt-2 text-lg font-semibold text-white">{summary?.frameCount ?? 0}</p>
            </article>
            <article className="rounded-xl border border-white/10 bg-black/20 p-3">
              <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">Micro Packages</p>
              <p className="mt-2 text-lg font-semibold text-white">{summary?.microSpotPackageCount ?? 0}</p>
            </article>
            <article className="rounded-xl border border-white/10 bg-black/20 p-3">
              <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">Devices</p>
              <p className="mt-2 text-lg font-semibold text-white">{summary?.deviceCapabilityCount ?? 0}</p>
            </article>
            <article className="rounded-xl border border-white/10 bg-black/20 p-3">
              <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">Helper</p>
              <p className="mt-2 break-all text-sm font-semibold text-white">{summary?.helperInstanceId ?? "none"}</p>
            </article>
            <article className="rounded-xl border border-white/10 bg-black/20 p-3">
              <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">Validation</p>
              <p className={adminCx("mt-2 text-lg font-semibold", summary?.validation.valid ? "text-emerald-200" : "text-slate-400")}>
                {summary ? (summary.validation.valid ? "Valid" : "Invalid") : "Pending"}
              </p>
            </article>
          </div>

          {summary ? (
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div>
                <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">Calibration Snapshots</p>
                <ul className="mt-2 space-y-1 text-xs text-slate-300">
                  {summary.calibrationSnapshotIds.length ? (
                    summary.calibrationSnapshotIds.map((id) => (
                      <li key={id} className="break-all rounded-lg bg-white/[0.03] px-2 py-1">
                        {id}
                      </li>
                    ))
                  ) : (
                    <li className="text-slate-500">none</li>
                  )}
                </ul>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">Storage Key Examples</p>
                <ul className="mt-2 space-y-1 text-xs text-slate-300">
                  {summary.storageKeyExamples.length ? (
                    summary.storageKeyExamples.map((key) => (
                      <li key={key} className="break-all rounded-lg bg-white/[0.03] px-2 py-1">
                        {key}
                      </li>
                    ))
                  ) : (
                    <li className="text-slate-500">none</li>
                  )}
                </ul>
              </div>
            </div>
          ) : null}

          {result ? (
            <pre className="mt-4 max-h-[300px] overflow-auto rounded-xl border border-white/10 bg-black p-3 text-xs leading-5 text-slate-200">
              {formatJson(result)}
            </pre>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function SimulatedSessionPanel({
  enabled,
  status,
  adminHeaders,
}: {
  enabled: boolean;
  status: AiGraderAdminApiStatus | null;
  adminHeaders: Record<string, string>;
}) {
  const [result, setResult] = useState<AiGraderSimulatedSessionWorkflowResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const generateSession = async () => {
    if (!enabled) {
      setError(status?.simulator?.message ?? "AI Grader simulator mode is disabled.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      setResult(await generateAiGraderSimulatedSessionWorkflow(adminHeaders));
    } catch (requestError) {
      if (requestError instanceof AiGraderAdminApiError) {
        setError(requestError.message);
      } else {
        setError(requestError instanceof Error ? requestError.message : "AI Grader simulated session request failed.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className={adminPanelClass("p-5")}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">Simulated Session</p>
          <h2 className="mt-2 text-xl font-semibold text-white">STANDARD Workflow Preview</h2>
        </div>
        <span className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.2em] ${simulatorTone(status)}`}>
          No DB or hardware
        </span>
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.7fr_1.3fr]">
        <div className={adminSubpanelClass("flex flex-col gap-4 p-4")}>
          <p className="text-sm text-slate-400">
            Generates a deterministic STANDARD capture workflow from simulator data only. The payload stops at a draft GradeRun-like
            summary and certificate readiness placeholder.
          </p>
          <button
            type="button"
            disabled={!enabled || submitting}
            onClick={() => generateSession().catch(() => undefined)}
            className={adminCx(
              "w-fit rounded-full border px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.24em] transition",
              enabled && !submitting
                ? "border-gold-500/60 bg-gold-500 text-night-900 hover:bg-gold-400"
                : "cursor-not-allowed border-white/12 bg-white/[0.03] text-slate-500"
            )}
          >
            {submitting ? "Generating" : "Generate Session"}
          </button>
          {!enabled ? (
            <p className="text-sm text-amber-100/80">
              {status?.simulator?.message ?? "Simulator actions require both API and simulator flags."}
            </p>
          ) : null}
          {error ? <p className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</p> : null}
        </div>

        <div className={adminSubpanelClass("p-4")}>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <article className="rounded-xl border border-white/10 bg-black/20 p-3">
              <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">Session</p>
              <p className="mt-2 break-all text-sm font-semibold text-white">{result?.session.sessionId ?? "pending"}</p>
            </article>
            <article className="rounded-xl border border-white/10 bg-black/20 p-3">
              <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">Mode</p>
              <p className="mt-2 text-lg font-semibold text-white">{result?.session.mode ?? "STANDARD"}</p>
            </article>
            <article className="rounded-xl border border-white/10 bg-black/20 p-3">
              <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">Frames</p>
              <p className="mt-2 text-lg font-semibold text-white">{result?.manifest.frameCount ?? 0}</p>
            </article>
            <article className="rounded-xl border border-white/10 bg-black/20 p-3">
              <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">Validation</p>
              <p className={adminCx("mt-2 text-lg font-semibold", result?.validation.valid ? "text-emerald-200" : "text-slate-400")}>
                {result ? (result.validation.valid ? "Valid" : "Invalid") : "Pending"}
              </p>
            </article>
          </div>

          {result ? (
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div>
                <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">Manifest</p>
                <dl className="mt-2 space-y-2 text-xs text-slate-300">
                  <div className="rounded-lg bg-white/[0.03] px-2 py-1">
                    <dt className="text-slate-500">ID</dt>
                    <dd className="break-all text-white">{result.manifest.id}</dd>
                  </div>
                  <div className="rounded-lg bg-white/[0.03] px-2 py-1">
                    <dt className="text-slate-500">Checksum</dt>
                    <dd className="break-all text-white">{result.manifest.checksumSha256}</dd>
                  </div>
                  <div className="rounded-lg bg-white/[0.03] px-2 py-1">
                    <dt className="text-slate-500">Helper</dt>
                    <dd className="break-all text-white">{result.session.helperInstanceId}</dd>
                  </div>
                </dl>
              </div>

              <div>
                <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">Pipeline Summary</p>
                <dl className="mt-2 grid gap-2 text-xs text-slate-300 sm:grid-cols-2">
                  <div className="rounded-lg bg-white/[0.03] px-2 py-1">
                    <dt className="text-slate-500">Macro Frames</dt>
                    <dd className="text-white">{result.macro.frameCount}</dd>
                  </div>
                  <div className="rounded-lg bg-white/[0.03] px-2 py-1">
                    <dt className="text-slate-500">Micro Packages</dt>
                    <dd className="text-white">{result.micro.packageCount}</dd>
                  </div>
                  <div className="rounded-lg bg-white/[0.03] px-2 py-1">
                    <dt className="text-slate-500">Micro Evidence Frames</dt>
                    <dd className="text-white">{result.micro.evidenceFrameCount}</dd>
                  </div>
                  <div className="rounded-lg bg-white/[0.03] px-2 py-1">
                    <dt className="text-slate-500">Surface Suspects</dt>
                    <dd className="text-white">{result.micro.surfaceSuspectCount}</dd>
                  </div>
                </dl>
              </div>

              <div>
                <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">Macro Frames</p>
                <ul className="mt-2 space-y-1 text-xs text-slate-300">
                  {result.macro.frames.map((frame) => (
                    <li key={frame.frameId} className="rounded-lg bg-white/[0.03] px-2 py-1">
                      <span className="font-semibold text-white">{frame.kind}</span> · {frame.side}
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">Micro Spots</p>
                <ul className="mt-2 max-h-[156px] space-y-1 overflow-auto text-xs text-slate-300">
                  {result.micro.packages.map((microPackage) => (
                    <li key={microPackage.id} className="rounded-lg bg-white/[0.03] px-2 py-1">
                      <span className="font-semibold text-white">{microPackage.element}</span> {microPackage.spotIndex}/
                      {microPackage.totalSpots} · {microPackage.frameCount} frames
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">Draft GradeRun-like Summary</p>
                <dl className="mt-2 space-y-2 text-xs text-slate-300">
                  <div className="rounded-lg bg-white/[0.03] px-2 py-1">
                    <dt className="text-slate-500">Status</dt>
                    <dd className="text-white">{result.gradeRunDraft.status}</dd>
                  </div>
                  <div className="rounded-lg bg-white/[0.03] px-2 py-1">
                    <dt className="text-slate-500">Input Checksum</dt>
                    <dd className="break-all text-white">{result.gradeRunDraft.inputChecksum}</dd>
                  </div>
                </dl>
              </div>

              <div>
                <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">Certificate Readiness</p>
                <div className="mt-2 rounded-lg border border-amber-400/20 bg-amber-950/10 p-3 text-sm text-amber-100/85">
                  {result.certificateReadiness.message}
                </div>
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-500">Generate a simulated session to inspect the STANDARD workflow payload.</p>
          )}
        </div>
      </div>
    </section>
  );
}

function OperationCard({
  operation,
  enabled,
  adminHeaders,
}: {
  operation: OperationDefinition;
  enabled: boolean;
  adminHeaders: Record<string, string>;
}) {
  const [payloadText, setPayloadText] = useState(formatJson(operation.template));
  const [resultText, setResultText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!enabled) {
      setError("AI Grader API is disabled. This operation was not sent.");
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(payloadText);
    } catch {
      setError("Payload must be valid JSON.");
      return;
    }

    setSubmitting(true);
    setError(null);
    setResultText("");
    try {
      const result = await postAiGraderAdminOperation(operation.key, payload, adminHeaders);
      setResultText(formatJson(result));
    } catch (requestError) {
      if (requestError instanceof AiGraderAdminApiError) {
        const details = requestError.issues?.length ? ` ${formatJson(requestError.issues)}` : "";
        setError(`${requestError.message}${details}`);
      } else {
        setError(requestError instanceof Error ? requestError.message : "AI Grader request failed.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className={adminSubpanelClass("flex flex-col gap-4 p-4")}>
      <div className="space-y-2">
        <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">{operation.section}</p>
        <h3 className="text-base font-semibold text-white">{operation.title}</h3>
        <p className="text-sm text-slate-400">{operation.description}</p>
      </div>
      <textarea
        value={payloadText}
        onChange={(event) => setPayloadText(event.target.value)}
        spellCheck={false}
        className={adminTextareaClass("min-h-[220px] w-full font-mono text-xs leading-5 text-slate-100")}
      />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={!enabled || submitting}
          className={adminCx(
            "rounded-full border px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.24em] transition",
            enabled && !submitting
              ? "border-gold-500/60 bg-gold-500 text-night-900 hover:bg-gold-400"
              : "cursor-not-allowed border-white/12 bg-white/[0.03] text-slate-500"
          )}
        >
          {submitting ? "Sending" : "Send"}
        </button>
        {!enabled ? (
          <span className="text-xs text-amber-200/80">Feature gate disabled; no DB-backed call will be made.</span>
        ) : null}
      </div>
      {error ? <p className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</p> : null}
      {resultText ? (
        <pre className="max-h-[260px] overflow-auto rounded-xl border border-white/10 bg-black p-3 text-xs leading-5 text-slate-200">
          {resultText}
        </pre>
      ) : null}
    </form>
  );
}

export default function AiGraderAdminPage() {
  const { session, loading: sessionLoading, ensureSession, logout } = useSession();
  const [status, setStatus] = useState<AiGraderAdminApiStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const isAdmin = useMemo(() => hasAiGraderAdminAccess(session), [session]);
  const gateState = resolveAiGraderAdminGateState({ loading: sessionLoading, session, isAdmin });
  const adminHeaders = useMemo(() => buildAdminHeaders(session?.token), [session?.token]);
  const canSubmit = canSubmitAiGraderOperation(status);
  const canRunSimulator = canRunAiGraderSimulator(status);

  const refreshStatus = useCallback(async () => {
    if (!session?.token) {
      setStatusError("Session token missing. Sign in again.");
      return;
    }

    setStatusLoading(true);
    setStatusError(null);
    try {
      setStatus(await fetchAiGraderAdminStatus(adminHeaders));
    } catch (requestError) {
      setStatus(null);
      setStatusError(requestError instanceof Error ? requestError.message : "Failed to load AI Grader status.");
    } finally {
      setStatusLoading(false);
    }
  }, [adminHeaders, session?.token]);

  useEffect(() => {
    if (gateState !== "ready") return;
    refreshStatus().catch(() => undefined);
  }, [gateState, refreshStatus]);

  const renderGate = () => {
    if (gateState === "loading") {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <p className="text-sm uppercase tracking-[0.35em] text-slate-400">Checking access...</p>
        </div>
      );
    }

    if (gateState === "signed_out") {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
          <p className="text-sm uppercase tracking-[0.32em] text-slate-400">Admin Access Only</p>
          <h1 className="font-heading text-4xl uppercase tracking-[0.18em] text-white">Sign in to continue</h1>
          <p className="max-w-md text-sm text-slate-400">
            Use your Ten Kings phone number. Only approved operators can open the AI Grader shell.
          </p>
          <button
            type="button"
            onClick={() => ensureSession().catch(() => undefined)}
            className="rounded-full border border-gold-500/60 bg-gold-500 px-8 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-night-900 shadow-glow transition hover:bg-gold-400"
          >
            Sign In
          </button>
        </div>
      );
    }

    if (gateState === "forbidden") {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
          <p className="text-sm uppercase tracking-[0.32em] text-rose-300">Access Denied</p>
          <h1 className="font-heading text-4xl uppercase tracking-[0.18em] text-white">You do not have admin rights</h1>
          <p className="max-w-md text-sm text-slate-400">
            This shell is restricted to Ten Kings operators. Contact an administrator if you need elevated permissions.
          </p>
          <button
            type="button"
            onClick={logout}
            className="rounded-full border border-white/20 px-8 py-3 text-xs uppercase tracking-[0.3em] text-slate-200 transition hover:border-white/40 hover:text-white"
          >
            Sign Out
          </button>
        </div>
      );
    }

    return null;
  };

  const gate = renderGate();
  if (gate) {
    return (
      <AppShell background="black" brandVariant="collectibles">
        <Head>
          <title>Ten Kings · AI Grader</title>
          <meta name="robots" content="noindex" />
        </Head>
        {gate}
      </AppShell>
    );
  }

  return (
    <AppShell background="black" brandVariant="collectibles">
      <Head>
        <title>Ten Kings · AI Grader</title>
        <meta name="robots" content="noindex" />
      </Head>

      <div className={ADMIN_PAGE_FRAME_CLASS}>
        <AdminPageHeader
          backHref="/admin"
          backLabel="Back to Console"
          eyebrow="AI Grader"
          title="Admin UI Shell"
          description="Feature-gated operator shell for AI Grader persistence scaffolding. This page does not run capture, grading math, authentication algorithms, reports, or PDF generation."
          badges={
            <>
              <span className={`rounded-full border px-2 py-1 ${statusTone(status)}`}>
                API: {statusLoading ? "checking" : status?.enabled ? "enabled" : "disabled"}
              </span>
              <span className={`rounded-full border px-2 py-1 ${simulatorTone(status)}`}>
                SIM: {statusLoading ? "checking" : canRunSimulator ? "enabled" : "disabled"}
              </span>
              <span className="rounded-full border border-white/20 px-2 py-1 text-slate-400">admin only</span>
            </>
          }
          actions={
            <button
              type="button"
              onClick={() => refreshStatus().catch(() => undefined)}
              className="rounded-full border border-white/15 px-4 py-2 text-[11px] uppercase tracking-[0.22em] text-slate-200 transition hover:border-white/40 hover:text-white"
            >
              Refresh Status
            </button>
          }
        />

        <section className="grid gap-4 md:grid-cols-3">
          <article className={adminStatCardClass("p-4")}>
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Feature Gate</p>
            <p className={adminCx("mt-2 text-2xl font-semibold", status?.enabled ? "text-emerald-200" : "text-amber-200")}>
              {statusLoading ? "Checking" : status?.enabled ? "Enabled" : "Disabled"}
            </p>
            <p className="mt-2 text-sm text-slate-400">
              {status?.message ??
                (status?.enabled
                  ? "AI Grader admin API accepts gated persistence calls."
                  : "AI Grader admin API is disabled unless AI_GRADER_API_ENABLED=true.")}
            </p>
          </article>
          <article className={adminStatCardClass("p-4")}>
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Service</p>
            <p className="mt-2 text-2xl font-semibold text-white">{status?.service ?? "ai-grader-admin-api"}</p>
            <p className="mt-2 text-sm text-slate-400">Status checks are safe while disabled and run before any DB-backed helper action.</p>
          </article>
          <article className={adminStatCardClass("p-4")}>
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Simulator</p>
            <p className={adminCx("mt-2 text-2xl font-semibold", canRunSimulator ? "text-emerald-200" : "text-amber-200")}>
              {statusLoading ? "Checking" : canRunSimulator ? "Enabled" : "Disabled"}
            </p>
            <p className="mt-2 text-sm text-slate-400">{status?.simulator?.message ?? "Simulator actions require both API and simulator flags."}</p>
          </article>
        </section>

        {statusError ? (
          <section className={adminPanelClass("border-rose-400/30 bg-rose-950/20 p-4 text-sm text-rose-100")}>
            {statusError}
          </section>
        ) : null}

        {!canSubmit ? (
          <section className={adminPanelClass("border-amber-400/25 bg-amber-950/10 p-5")}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.28em] text-amber-200">Disabled State</p>
                <h2 className="mt-2 text-lg font-semibold text-white">Persistence actions are locked</h2>
                <p className="mt-2 max-w-3xl text-sm text-amber-100/80">
                  The shell is visible to admins for rollout review, but it will not send create/update requests while the API
                  returns a disabled feature-gate response.
                </p>
              </div>
              <Link href="/admin/ai-ops" className="text-xs uppercase tracking-[0.22em] text-slate-300 underline hover:text-white">
                AI Ops
              </Link>
            </div>
          </section>
        ) : null}

        <SimulatorPanel enabled={canRunSimulator} status={status} adminHeaders={adminHeaders} />

        <SimulatedSessionPanel enabled={canRunSimulator} status={status} adminHeaders={adminHeaders} />

        <section className={adminPanelClass("p-5")}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">Persistence Scaffolds</p>
              <h2 className="mt-2 text-xl font-semibold text-white">Gated API Calls</h2>
            </div>
            <span className="rounded-full border border-white/12 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-slate-400">
              No capture or grading logic
            </span>
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            {OPERATION_DEFINITIONS.map((operation) => (
              <OperationCard
                key={operation.key}
                operation={operation}
                enabled={canSubmit}
                adminHeaders={adminHeaders}
              />
            ))}
          </div>
        </section>

        <section className={adminPanelClass("p-5")}>
          <div className="mb-4">
            <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">Deferred Panels</p>
            <h2 className="mt-2 text-xl font-semibold text-white">Policy Views Not Exposed Yet</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {PLACEHOLDER_SECTIONS.map((section) => (
              <article key={section.title} className={adminSubpanelClass("p-4")}>
                <h3 className="text-base font-semibold text-white">{section.title}</h3>
                <p className="mt-2 text-sm text-slate-400">{section.description}</p>
              </article>
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
