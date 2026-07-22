import { calculateOverallGradeV1, mathematicalScoreV1Schema } from "@tenkings/shared";
import { useEffect, useMemo, useState } from "react";
import {
  AI_GRADER_REPORT_EDITABLE_ELEMENTS,
  normalizeAiGraderReportEditorialContent,
  parseAiGraderReportEditorialRevisionV1,
  type AiGraderReportEditableElement,
  type AiGraderReportEditorialContent,
  type AiGraderReportEditorialRevisionV1,
} from "../../lib/aiGraderReportRevision";

const EDITOR_API = "/api/admin/ai-grader/report-editor";

const CONTENT_FIELDS: Array<{
  key: keyof AiGraderReportEditorialContent;
  label: string;
  description: string;
  multiline?: boolean;
  maxLength: number;
}> = [
  { key: "cardTitle", label: "Card title", description: "Public report heading.", maxLength: 240 },
  { key: "reportSummary", label: "Report summary", description: "Primary human-reviewed report narrative.", multiline: true, maxLength: 2_000 },
  { key: "centeringExplanation", label: "Centering explanation", description: "Text shown with the effective centering score.", multiline: true, maxLength: 1_000 },
  { key: "cornersExplanation", label: "Corners explanation", description: "Text shown with the effective corners score.", multiline: true, maxLength: 1_000 },
  { key: "edgesExplanation", label: "Edges explanation", description: "Text shown with the effective edges score.", multiline: true, maxLength: 1_000 },
  { key: "surfaceExplanation", label: "Surface explanation", description: "Text shown with the effective surface score.", multiline: true, maxLength: 1_000 },
  { key: "strongestPositive", label: "Strongest positive", description: "Effective positive summary.", multiline: true, maxLength: 1_000 },
  { key: "strongestWarning", label: "Strongest warning", description: "Effective warning summary.", multiline: true, maxLength: 1_000 },
  { key: "whyNot10", label: "Why not 10?", description: "Effective public explanation for deductions.", multiline: true, maxLength: 2_000 },
];

type CompletionStatus =
  | "machine_complete"
  | "machine_failed"
  | "human_reviewed_complete";

export type AiGraderReportAdminEditorState = {
  reportId: string;
  visibilityStatus: "public" | "coming_soon";
  completionStatus: CompletionStatus;
  revisionToken: string;
  sourceReportSchemaVersion: string;
  sourceBundleSha256: string;
  baseScores: Partial<Record<AiGraderReportEditableElement, number>>;
  baseContent: AiGraderReportEditorialContent;
  applicableSevereDefectCap?: number;
  severeDefectCapProvenance:
    | "immutable_mathematical_v1_finding_ledger"
    | "none_source_report_has_no_v1_cap";
  machineFailure: { failed: boolean; codes: string[] };
  editorialRevision: AiGraderReportEditorialRevisionV1 | null;
};

type ScoreDraft = Record<AiGraderReportEditableElement, string>;
type ContentDraft = Record<keyof AiGraderReportEditorialContent, string>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function cleanMessage(value: unknown, fallback: string) {
  if (!isRecord(value) || typeof value.message !== "string") return fallback;
  const message = value.message.trim();
  return message && message.length <= 500 ? message : fallback;
}

function parsePartialScores(value: unknown) {
  if (!isRecord(value)) throw new Error("The report editor returned invalid base scores.");
  const unknownKeys = Object.keys(value).filter(
    (key) => !AI_GRADER_REPORT_EDITABLE_ELEMENTS.includes(key as AiGraderReportEditableElement),
  );
  if (unknownKeys.length) throw new Error("The report editor returned unsupported score fields.");
  return Object.fromEntries(
    AI_GRADER_REPORT_EDITABLE_ELEMENTS.flatMap((element) => {
      if (value[element] === undefined || value[element] === null) return [];
      const parsed = mathematicalScoreV1Schema.safeParse(value[element]);
      if (!parsed.success) throw new Error(`The ${element} base score is invalid.`);
      return [[element, parsed.data] as const];
    }),
  ) as Partial<Record<AiGraderReportEditableElement, number>>;
}

function parseEditorState(value: unknown, expectedReportId: string): AiGraderReportAdminEditorState {
  if (!isRecord(value)) throw new Error("The report editor returned an invalid state.");
  if (
    value.reportId !== expectedReportId ||
    (value.visibilityStatus !== "public" && value.visibilityStatus !== "coming_soon") ||
    (value.completionStatus !== "machine_complete" &&
      value.completionStatus !== "machine_failed" &&
      value.completionStatus !== "human_reviewed_complete") ||
    typeof value.revisionToken !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.revisionToken) ||
    typeof value.sourceReportSchemaVersion !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.sourceReportSchemaVersion) ||
    typeof value.sourceBundleSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.sourceBundleSha256) ||
    !isRecord(value.baseContent) ||
    !isRecord(value.machineFailure) ||
    typeof value.machineFailure.failed !== "boolean" ||
    !Array.isArray(value.machineFailure.codes) ||
    value.machineFailure.codes.some((code) => typeof code !== "string" || !code || code.length > 160)
  ) {
    throw new Error("The report editor returned an invalid state contract.");
  }
  const editorialRevision = value.editorialRevision === null
    ? null
    : parseAiGraderReportEditorialRevisionV1(value.editorialRevision, expectedReportId);
  if (value.editorialRevision !== null && !editorialRevision) {
    throw new Error("The saved human revision failed validation.");
  }
  const cap = value.applicableSevereDefectCap === undefined
    ? undefined
    : mathematicalScoreV1Schema.safeParse(value.applicableSevereDefectCap);
  if (cap !== undefined && !cap.success) {
    throw new Error("The report editor returned an invalid severe-defect cap.");
  }
  const severeDefectCapProvenance = value.severeDefectCapProvenance;
  if (
    (cap?.success && severeDefectCapProvenance !== "immutable_mathematical_v1_finding_ledger") ||
    (!cap?.success && severeDefectCapProvenance !== "none_source_report_has_no_v1_cap") ||
    (editorialRevision === null && value.completionStatus === "human_reviewed_complete") ||
    (editorialRevision !== null && value.completionStatus !== "human_reviewed_complete") ||
    (value.completionStatus === "machine_failed" && value.machineFailure.failed !== true) ||
    (value.completionStatus === "machine_complete" && value.machineFailure.failed !== false) ||
    (editorialRevision !== null && (
      editorialRevision.sourceReportSchemaVersion !== value.sourceReportSchemaVersion ||
      editorialRevision.sourceBundleSha256 !== value.sourceBundleSha256 ||
      editorialRevision.calculation.severeDefectCapProvenance !== severeDefectCapProvenance ||
      editorialRevision.calculation.applicableSevereDefectCap !== (cap?.success ? cap.data : undefined) ||
      JSON.stringify([...editorialRevision.adjudicatedMachineFailures].sort()) !==
        JSON.stringify([...(value.machineFailure.codes as string[])].sort())
    ))
  ) {
    throw new Error("The report editor returned contradictory revision authority.");
  }
  const normalizedSevereDefectCapProvenance = severeDefectCapProvenance as
    AiGraderReportAdminEditorState["severeDefectCapProvenance"];
  return {
    reportId: value.reportId,
    visibilityStatus: value.visibilityStatus,
    completionStatus: value.completionStatus,
    revisionToken: value.revisionToken,
    sourceReportSchemaVersion: value.sourceReportSchemaVersion,
    sourceBundleSha256: value.sourceBundleSha256,
    baseScores: parsePartialScores(value.baseScores),
    baseContent: normalizeAiGraderReportEditorialContent(value.baseContent),
    ...(cap?.success ? { applicableSevereDefectCap: cap.data } : {}),
    severeDefectCapProvenance: normalizedSevereDefectCapProvenance,
    machineFailure: {
      failed: value.machineFailure.failed,
      codes: [...value.machineFailure.codes] as string[],
    },
    editorialRevision,
  };
}

function parseSuccessState(value: unknown, expectedReportId: string) {
  if (!isRecord(value) || value.ok !== true || !isRecord(value.state)) {
    throw new Error("The report editor returned an invalid response.");
  }
  return parseEditorState(value.state, expectedReportId);
}

function emptyContentDraft(): ContentDraft {
  return Object.fromEntries(CONTENT_FIELDS.map(({ key }) => [key, ""])) as ContentDraft;
}

function draftsFromState(state: AiGraderReportAdminEditorState) {
  const effectiveScores = state.editorialRevision?.scores ?? state.baseScores;
  const effectiveContent = {
    ...state.baseContent,
    ...state.editorialRevision?.content,
  };
  return {
    scores: Object.fromEntries(
      AI_GRADER_REPORT_EDITABLE_ELEMENTS.map((element) => [
        element,
        typeof effectiveScores[element] === "number" ? String(effectiveScores[element]) : "",
      ]),
    ) as ScoreDraft,
    content: Object.fromEntries(
      CONTENT_FIELDS.map(({ key }) => [key, effectiveContent[key] ?? ""]),
    ) as ContentDraft,
  };
}

function completionLabel(status: CompletionStatus) {
  if (status === "human_reviewed_complete") return "Completed — human reviewed/admin adjudicated";
  if (status === "machine_complete") return "Machine grading complete";
  return "Machine grading failed — admin adjudication required";
}

export default function AiGraderReportAdminEditor({
  reportId,
  onStateChange,
}: {
  reportId: string;
  onStateChange?: (state: AiGraderReportAdminEditorState) => void;
}) {
  const [editorState, setEditorState] = useState<AiGraderReportAdminEditorState | null>(null);
  const [scoreDraft, setScoreDraft] = useState<ScoreDraft>(() => ({
    centering: "",
    corners: "",
    edges: "",
    surface: "",
  }));
  const [contentDraft, setContentDraft] = useState<ContentDraft>(emptyContentDraft);
  const [reason, setReason] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hidden, setHidden] = useState(false);
  const [busyAction, setBusyAction] = useState<"save" | "visibility" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const hydrate = (state: AiGraderReportAdminEditorState) => {
    const drafts = draftsFromState(state);
    setEditorState(state);
    setScoreDraft(drafts.scores);
    setContentDraft(drafts.content);
    onStateChange?.(state);
  };

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setHidden(false);
    setError(null);
    setNotice(null);
    fetch(`${EDITOR_API}/state?reportId=${encodeURIComponent(reportId)}`, {
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401 || response.status === 403) {
          setHidden(true);
          return;
        }
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(cleanMessage(payload, "Report Edit Mode is unavailable."));
        hydrate(parseSuccessState(payload, reportId));
      })
      .catch((caught) => {
        if (controller.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : "Report Edit Mode is unavailable.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // onStateChange is deliberately excluded: parent render identity must not refetch editor state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId]);

  const scorePreview = useMemo(() => {
    try {
      const scores = Object.fromEntries(
        AI_GRADER_REPORT_EDITABLE_ELEMENTS.map((element) => {
          if (!scoreDraft[element].trim()) throw new Error("missing");
          return [element, mathematicalScoreV1Schema.parse(Number(scoreDraft[element]))];
        }),
      ) as Record<AiGraderReportEditableElement, number>;
      const calculation = calculateOverallGradeV1(
        scores,
        editorState?.applicableSevereDefectCap === undefined
          ? []
          : [editorState.applicableSevereDefectCap],
      );
      return { scores, calculation };
    } catch {
      return null;
    }
  }, [editorState?.applicableSevereDefectCap, scoreDraft]);

  if (hidden || loading) return null;
  if (!editorState) {
    return error ? (
      <aside className="editor-error" role="alert">
        <strong>Edit Mode unavailable</strong>
        <span>{error}</span>
        <style jsx>{`
          .editor-error { position: fixed; z-index: 80; right: 18px; bottom: 18px; max-width: 360px; border: 1px solid #8f3030; border-radius: 10px; background: #fff5f5; color: #651f1f; padding: 12px 14px; box-shadow: 0 16px 44px rgba(0,0,0,.2); font: 13px/1.4 Inter, ui-sans-serif, system-ui, sans-serif; }
          strong, span { display: block; }
          span { margin-top: 4px; }
        `}</style>
      </aside>
    ) : null;
  }

  const submit = async (action: "save" | "visibility") => {
    const privateReason = reason.trim();
    if (!privateReason) {
      setError("A private audit reason is required before saving any change.");
      setExpanded(true);
      return;
    }
    if (action === "save" && !scorePreview) {
      setError("Enter and confirm all four scores from 1.00 through 10.00, with no more than two decimal places.");
      setExpanded(true);
      return;
    }
    setBusyAction(action);
    setError(null);
    setNotice(null);
    try {
      const content = normalizeAiGraderReportEditorialContent(contentDraft);
      const response = await fetch(`${EDITOR_API}/${action === "save" ? "save" : "visibility"}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "save"
          ? {
              reportId,
              expectedRevisionToken: editorState.revisionToken,
              expectedSourceBundleSha256: editorState.sourceBundleSha256,
              scores: scorePreview?.scores,
              content,
              reason: privateReason,
            }
          : {
              reportId,
              expectedRevisionToken: editorState.revisionToken,
              visibilityStatus: editorState.visibilityStatus === "public" ? "coming_soon" : "public",
              reason: privateReason,
            }),
      });
      if (response.status === 401 || response.status === 403) {
        setHidden(true);
        return;
      }
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(cleanMessage(
          payload,
          response.status === 409
            ? "This report changed after Edit Mode loaded. Reload this report before trying again."
            : "The report change was not saved.",
        ));
      }
      const nextState = parseSuccessState(payload, reportId);
      if (action === "save") {
        hydrate(nextState);
        setNotice("Human-reviewed report revision saved at this report URL.");
      } else {
        setEditorState(nextState);
        onStateChange?.(nextState);
        setNotice(nextState.visibilityStatus === "coming_soon"
          ? "Coming Soon wall is now on. The report bundle is hidden from public view."
          : "Coming Soon wall is now off. This report is public at the same URL.");
      }
      setReason("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The report change was not saved.");
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <aside className={`admin-editor ${expanded ? "expanded" : "collapsed"}`} aria-label="AI Grader report Edit Mode">
      <button
        className="editor-toggle"
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <span>Edit Mode</span>
        <small>{editorState.editorialRevision ? `Revision ${editorState.editorialRevision.revision}` : "Admin only"}</small>
      </button>

      {expanded ? (
        <div className="editor-body">
          <header>
            <div>
              <p>Private admin controls</p>
              <h2>Report Edit Mode</h2>
            </div>
            <button className="close" type="button" aria-label="Close Edit Mode" onClick={() => setExpanded(false)}>×</button>
          </header>

          <section className={`completion ${editorState.machineFailure.failed ? "failed" : "complete"}`}>
            <strong>{completionLabel(editorState.completionStatus)}</strong>
            {editorState.machineFailure.failed ? (
              <p>
                The machine result remains failed in immutable provenance. Complete all four scores to create an explicit admin adjudication.
                {editorState.machineFailure.codes.length ? ` Codes: ${editorState.machineFailure.codes.join(", ")}.` : ""}
              </p>
            ) : (
              <p>Machine evidence remains immutable. Saved values become the effective public human-reviewed result.</p>
            )}
          </section>

          <section>
            <div className="section-heading">
              <h3>Four required scores</h3>
              <span>1.00–10.00</span>
            </div>
            <div className="score-grid">
              {AI_GRADER_REPORT_EDITABLE_ELEMENTS.map((element) => (
                <label key={element}>
                  <span>{element}</span>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    step="0.01"
                    inputMode="decimal"
                    required
                    value={scoreDraft[element]}
                    onChange={(event) => setScoreDraft((current) => ({ ...current, [element]: event.target.value }))}
                  />
                  <small>
                    {typeof editorState.baseScores[element] === "number"
                      ? `Machine ${editorState.baseScores[element]?.toFixed(2)}`
                      : "No machine score — admin entry required"}
                  </small>
                </label>
              ))}
            </div>
            <div className={`overall-preview ${scorePreview ? "ready" : "incomplete"}`}>
              <span>Dynamic overall</span>
              <strong>{scorePreview ? scorePreview.calculation.overall.toFixed(2) : "—"}</strong>
              <small>
                30% centering + 25% corners + 25% edges + 20% surface, limited by weakest element + 0.50
                {editorState.applicableSevereDefectCap === undefined
                  ? "."
                  : ` and immutable severe-defect cap ${editorState.applicableSevereDefectCap.toFixed(2)}.`}
              </small>
            </div>
          </section>

          <section>
            <h3>Field-scoped public text</h3>
            <p className="section-copy">Plain text only. Machine measurements, evidence, hashes, and provenance are never edited.</p>
            <div className="content-grid">
              {CONTENT_FIELDS.map((field) => (
                <label key={field.key}>
                  <span>{field.label}</span>
                  <small>{field.description}</small>
                  {field.multiline ? (
                    <textarea
                      rows={field.key === "reportSummary" || field.key === "whyNot10" ? 4 : 3}
                      maxLength={field.maxLength}
                      value={contentDraft[field.key]}
                      onChange={(event) => setContentDraft((current) => ({ ...current, [field.key]: event.target.value }))}
                    />
                  ) : (
                    <input
                      type="text"
                      maxLength={field.maxLength}
                      value={contentDraft[field.key]}
                      onChange={(event) => setContentDraft((current) => ({ ...current, [field.key]: event.target.value }))}
                    />
                  )}
                </label>
              ))}
            </div>
          </section>

          <section className="audit-controls">
            <label>
              <span>Private reason <b>required</b></span>
              <textarea
                rows={3}
                maxLength={1_000}
                placeholder="Why are you changing this report? This is private audit history."
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            {error ? <p className="message error" role="alert">{error}</p> : null}
            {notice ? <p className="message notice" role="status">{notice}</p> : null}
            <div className="actions">
              <button
                className="save"
                type="button"
                disabled={busyAction !== null || !scorePreview || !reason.trim()}
                onClick={() => void submit("save")}
              >
                {busyAction === "save" ? "Saving…" : "Save reviewed report"}
              </button>
              <button
                className={editorState.visibilityStatus === "coming_soon" ? "visibility on" : "visibility"}
                type="button"
                aria-pressed={editorState.visibilityStatus === "coming_soon"}
                disabled={busyAction !== null || !reason.trim()}
                onClick={() => void submit("visibility")}
              >
                Coming Soon: {editorState.visibilityStatus === "coming_soon" ? "ON" : "OFF"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      <style jsx>{`
        .admin-editor { position: fixed; z-index: 80; right: 18px; bottom: 18px; width: min(520px, calc(100vw - 28px)); color: #171512; font: 14px/1.45 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        .admin-editor.expanded { top: 18px; bottom: 18px; }
        button, input, textarea { font: inherit; }
        button { cursor: pointer; }
        button:disabled { cursor: not-allowed; opacity: .5; }
        .editor-toggle { width: 100%; border: 1px solid rgba(255,208,100,.52); border-radius: 12px; background: #171512; color: #fff4d4; padding: 12px 16px; box-shadow: 0 18px 52px rgba(0,0,0,.3); text-align: left; }
        .editor-toggle span, .editor-toggle small { display: block; }
        .editor-toggle span { font-size: 15px; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; }
        .editor-toggle small { margin-top: 2px; color: #d8c58e; }
        .expanded > .editor-toggle { display: none; }
        .collapsed { width: 210px; }
        .editor-body { height: 100%; overflow-y: auto; border: 1px solid rgba(89,67,24,.28); border-radius: 14px; background: #f9f6ef; box-shadow: 0 24px 80px rgba(0,0,0,.34); }
        header { position: sticky; z-index: 2; top: 0; display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 18px 20px; border-bottom: 1px solid rgba(25,22,16,.12); background: rgba(249,246,239,.97); backdrop-filter: blur(12px); }
        header p, h2, h3, section p { margin: 0; }
        header p { color: #8a651e; font-size: 10px; font-weight: 900; letter-spacing: .16em; text-transform: uppercase; }
        h2 { margin-top: 2px; font-size: 23px; }
        h3 { font-size: 16px; }
        .close { border: 0; background: transparent; color: #555047; font-size: 30px; line-height: 1; }
        section { padding: 18px 20px; border-bottom: 1px solid rgba(25,22,16,.1); }
        .completion { margin: 16px 20px 0; border: 1px solid rgba(34,118,69,.24); border-radius: 9px; background: #eaf7ee; }
        .completion.failed { border-color: rgba(151,78,19,.28); background: #fff0d7; }
        .completion strong { display: block; }
        .completion p { margin-top: 5px; color: #554d41; font-size: 12px; }
        .section-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
        .section-heading > span { color: #746b5d; font-size: 12px; }
        .score-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px; }
        label { display: grid; gap: 5px; }
        label > span { font-size: 12px; font-weight: 850; text-transform: capitalize; }
        label > small, .section-copy { color: #716a5f; font-size: 11px; }
        input, textarea { width: 100%; box-sizing: border-box; border: 1px solid rgba(25,22,16,.22); border-radius: 7px; background: #fff; color: #171512; padding: 9px 10px; }
        input:focus, textarea:focus { border-color: #9c6c16; outline: 2px solid rgba(181,128,29,.18); }
        .score-grid input { font-size: 20px; font-weight: 850; }
        .overall-preview { display: grid; grid-template-columns: 1fr auto; gap: 2px 14px; align-items: center; margin-top: 14px; border-radius: 9px; padding: 12px 14px; background: #171512; color: #fff5d7; }
        .overall-preview > span { font-size: 11px; font-weight: 900; letter-spacing: .1em; text-transform: uppercase; }
        .overall-preview > strong { grid-row: span 2; font-size: 36px; line-height: 1; }
        .overall-preview > small { color: #d8c99e; }
        .overall-preview.incomplete { background: #5d574d; }
        .section-copy { margin-top: 5px; }
        .content-grid { display: grid; gap: 13px; margin-top: 13px; }
        .audit-controls { border-bottom: 0; }
        b { color: #a12e2e; }
        .message { margin-top: 10px; border-radius: 7px; padding: 9px 10px; font-size: 12px; }
        .message.error { background: #ffe5e5; color: #761e1e; }
        .message.notice { background: #e4f5e9; color: #17572d; }
        .actions { display: grid; grid-template-columns: 1.25fr 1fr; gap: 9px; margin-top: 12px; }
        .actions button { border-radius: 8px; padding: 11px 12px; font-weight: 850; }
        .save { border: 1px solid #171512; background: #171512; color: #fff; }
        .visibility { border: 1px solid rgba(132,88,7,.45); background: #fff6dc; color: #6b4605; }
        .visibility.on { border-color: #9b3c24; background: #9b3c24; color: #fff; }
        @media (max-width: 560px) {
          .admin-editor { right: 10px; bottom: 10px; width: calc(100vw - 20px); }
          .admin-editor.expanded { top: 10px; bottom: 10px; }
          .collapsed { width: 190px; }
          .score-grid, .actions { grid-template-columns: 1fr; }
        }
      `}</style>
    </aside>
  );
}
