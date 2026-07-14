import Head from "next/head";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "../../../hooks/useSession";
import { buildAdminHeaders } from "../../../lib/adminHeaders";
import {
  type AiGraderLabelSheetDto,
  type AiGraderLabelSheetsResult,
} from "../../../lib/aiGraderLabelSheets";

type RequestState = "idle" | "loading" | "ready" | "error";

const emptyResult: AiGraderLabelSheetsResult = {
  source: "persisted_records",
  orderedBy: "sheetNumber_asc_slot_asc",
  sheets: [],
  unassignedLabelCount: 0,
  stats: {
    totalSheets: 0,
    openSheets: 0,
    sealedSheets: 0,
    printedSheets: 0,
    totalLabels: 0,
  },
};

function responseSheet(value: unknown): AiGraderLabelSheetDto | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const candidate = source.sheet && typeof source.sheet === "object" ? (source.sheet as Record<string, unknown>) : source;
  return typeof candidate.sheetId === "string" && Array.isArray(candidate.labels) ? (candidate as AiGraderLabelSheetDto) : null;
}

function formatTimestamp(value?: string) {
  if (!value) return "Pending";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "Pending";
}

function formatMoneylessStatus(status: AiGraderLabelSheetDto["status"]) {
  if (status === "open") return "Open";
  if (status === "full") return "Full";
  if (status === "sealed") return "Ready to mark";
  return "Printed";
}

export default function AiGraderLabelSheetsPage() {
  const { session, loading: sessionLoading, ensureSession, logout } = useSession();
  const [result, setResult] = useState<AiGraderLabelSheetsResult>(emptyResult);
  const [requestState, setRequestState] = useState<RequestState>("idle");
  const [message, setMessage] = useState("Sign in to load AI Grader label sheets.");
  const [selectedSheetId, setSelectedSheetId] = useState<string | null>(null);
  const [preparedSheet, setPreparedSheet] = useState<AiGraderLabelSheetDto | null>(null);
  const [busyAction, setBusyAction] = useState<"prepare" | "mark" | "pdf" | "cut" | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const selectedSheet = useMemo(
    () => result.sheets.find((sheet) => sheet.sheetId === selectedSheetId) ?? null,
    [result.sheets, selectedSheetId]
  );
  const displaySheet = preparedSheet?.sheetId === selectedSheetId ? preparedSheet : selectedSheet;
  const productionOutputReady = displaySheet?.status === "sealed" || displaySheet?.status === "printed";

  const loadSheets = useCallback(async () => {
    if (!session?.token) return;
    setRequestState("loading");
    setMessage("Loading label sheets.");
    try {
      const response = await fetch("/api/admin/ai-grader/production/label-sheets", {
        method: "GET",
        headers: buildAdminHeaders(session.token),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok !== true) {
        if (response.status === 401) logout();
        throw new Error(payload.message ?? "Label sheets failed to load.");
      }
      const next = (payload.result ?? emptyResult) as AiGraderLabelSheetsResult;
      setResult(next);
      setSelectedSheetId((current) => {
        if (current && next.sheets.some((sheet) => sheet.sheetId === current)) return current;
        return next.openSheetId ?? next.sheets[next.sheets.length - 1]?.sheetId ?? null;
      });
      setRequestState("ready");
      setMessage(next.sheets.length ? `${next.stats.totalLabels} labels across ${next.stats.totalSheets} sheets.` : "No label sheets yet.");
    } catch (error) {
      setRequestState("error");
      setMessage(error instanceof Error ? error.message : "Label sheets failed to load.");
    }
  }, [logout, session?.token]);

  useEffect(() => {
    if (!sessionLoading && session?.token) void loadSheets();
  }, [loadSheets, session?.token, sessionLoading]);

  const signIn = async () => {
    setMessage("Waiting for Ten Kings sign-in.");
    try {
      await ensureSession({ force: Boolean(session), message: "Sign in to manage AI Grader label sheets." });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ten Kings sign-in failed.");
    }
  };

  const replaceSheet = (sheet: AiGraderLabelSheetDto) => {
    setResult((current) => ({
      ...current,
      sheets: current.sheets.map((candidate) => (candidate.sheetId === sheet.sheetId ? sheet : candidate)),
    }));
    setPreparedSheet(sheet);
  };

  const requestRenderedFile = useCallback(
    async (action: "render-label-sheet-pdf" | "render-label-sheet-cut-svg", sheet: AiGraderLabelSheetDto) => {
      if (!session?.token) throw new Error("Operator sign-in is required.");
      const response = await fetch(`/api/admin/ai-grader/production/${action}`, {
        method: "POST",
        headers: buildAdminHeaders(session.token, { "Content-Type": "application/json" }),
        body: JSON.stringify({ sheetId: sheet.sheetId, expectedRevision: sheet.revision }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message ?? "Label V1 file could not be rendered.");
      }
      return response.blob();
    },
    [session?.token]
  );

  useEffect(() => {
    if (!displaySheet || !session?.token || displaySheet.slotConflict || !productionOutputReady) {
      setPreviewUrl(null);
      return;
    }
    let active = true;
    let objectUrl: string | null = null;
    setPreviewUrl(null);
    void requestRenderedFile("render-label-sheet-pdf", displaySheet)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
      })
      .catch((error) => {
        if (active) setMessage(error instanceof Error ? error.message : "Label V1 preview could not be rendered.");
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [displaySheet, productionOutputReady, requestRenderedFile, session?.token]);

  const downloadRenderedFile = async (
    action: "render-label-sheet-pdf" | "render-label-sheet-cut-svg",
    sheet: AiGraderLabelSheetDto
  ) => {
    const blob = await requestRenderedFile(action, sheet);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download =
      action === "render-label-sheet-pdf"
        ? `${sheet.sheetId}-${sheet.revision}.pdf`
        : `${sheet.sheetId}-${sheet.revision}-cricut-cut.svg`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };

  const prepareAndDownloadPdf = async () => {
    if (!displaySheet || !session?.token || displaySheet.slotConflict) return;
    if (displaySheet.status === "sealed" || displaySheet.status === "printed") {
      setBusyAction("pdf");
      try {
        await downloadRenderedFile("render-label-sheet-pdf", displaySheet);
        setMessage(`Downloaded the authoritative Label V1 PDF for Sheet ${displaySheet.sheetNumber}.`);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Label V1 PDF could not be downloaded.");
      } finally {
        setBusyAction(null);
      }
      return;
    }
    setBusyAction("prepare");
    setMessage(`Preparing Sheet ${displaySheet.sheetNumber} for printing.`);
    try {
      const response = await fetch("/api/admin/ai-grader/production/prepare-label-sheet-print", {
        method: "POST",
        headers: buildAdminHeaders(session.token, { "Content-Type": "application/json" }),
        body: JSON.stringify({ sheetId: displaySheet.sheetId, expectedRevision: displaySheet.revision }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok !== true) {
        throw new Error(payload.message ?? "Sheet could not be prepared for printing.");
      }
      const nextSheet = responseSheet(payload.result);
      if (!nextSheet) throw new Error("Prepared sheet response is incomplete.");
      replaceSheet(nextSheet);
      await downloadRenderedFile("render-label-sheet-pdf", nextSheet);
      setMessage(`Sheet ${nextSheet.sheetNumber} is sealed; its authoritative Label V1 PDF was downloaded.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sheet could not be prepared for printing.");
      await loadSheets().catch(() => undefined);
    } finally {
      setBusyAction(null);
    }
  };

  const downloadCutSvg = async () => {
    if (!displaySheet || displaySheet.slotConflict || !productionOutputReady) return;
    setBusyAction("cut");
    try {
      await downloadRenderedFile("render-label-sheet-cut-svg", displaySheet);
      setMessage(`Downloaded the provisional Cricut cut SVG for Sheet ${displaySheet.sheetNumber}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Cricut cut SVG could not be downloaded.");
    } finally {
      setBusyAction(null);
    }
  };

  const markPrinted = async () => {
    if (!displaySheet || !session?.token || displaySheet.status !== "sealed" || displaySheet.slotConflict) return;
    setBusyAction("mark");
    setMessage(`Marking Sheet ${displaySheet.sheetNumber} printed.`);
    try {
      const response = await fetch("/api/admin/ai-grader/production/mark-label-sheet-printed", {
        method: "POST",
        headers: buildAdminHeaders(session.token, { "Content-Type": "application/json" }),
        body: JSON.stringify({ sheetId: displaySheet.sheetId, expectedRevision: displaySheet.revision }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok !== true) throw new Error(payload.message ?? "Sheet print status was not saved.");
      setPreparedSheet(null);
      await loadSheets();
      setMessage(`Sheet ${displaySheet.sheetNumber} and all ${displaySheet.labelCount} labels are marked printed.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sheet print status was not saved.");
      await loadSheets().catch(() => undefined);
    } finally {
      setBusyAction(null);
    }
  };

  const listedSheets = useMemo(() => [...result.sheets].sort((left, right) => right.sheetNumber - left.sheetNumber), [result.sheets]);

  return (
    <>
      <Head>
        <title>Ten Kings AI Grader Label Sheets</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <main className="page">
        <header className="topbar screen-only">
          <div>
            <p>Ten Kings AI Grader</p>
            <h1>Label Sheets</h1>
          </div>
          <nav>
            <Link href="/ai-grader/finish">Finish Cards</Link>
            {session ? <button type="button" onClick={logout}>Sign Out</button> : null}
          </nav>
        </header>

        {!sessionLoading && !session ? (
          <section className="auth-gate screen-only">
            <h2>Operator sign-in required</h2>
            <p>{message}</p>
            <button type="button" onClick={() => void signIn()}>Sign In</button>
          </section>
        ) : (
          <div className="workspace">
            <aside className="sheet-sidebar screen-only">
              <div className="summary">
                <strong>{result.stats.totalLabels}</strong>
                <span>Labels</span>
                <strong>{result.stats.openSheets}</strong>
                <span>Open</span>
                <strong>{result.stats.printedSheets}</strong>
                <span>Printed</span>
              </div>
              <div className="status-row">
                <span className={`request-dot ${requestState}`} />
                <p>{sessionLoading ? "Restoring sign-in." : message}</p>
              </div>
              <button type="button" className="refresh" onClick={() => void loadSheets()} disabled={!session || requestState === "loading"}>
                Refresh
              </button>
              <div className="sheet-list" aria-label="Label sheets">
                {listedSheets.map((sheet) => (
                  <button
                    type="button"
                    className={sheet.sheetId === selectedSheetId ? "sheet-row selected" : "sheet-row"}
                    key={sheet.sheetId}
                    onClick={() => {
                      setSelectedSheetId(sheet.sheetId);
                      setPreparedSheet(null);
                    }}
                  >
                    <span>
                      <strong>Sheet {sheet.sheetNumber}</strong>
                      <small>{formatTimestamp(sheet.firstAssignedAt)}</small>
                    </span>
                    <span className={`sheet-status ${sheet.status}`}>{formatMoneylessStatus(sheet.status)}</span>
                    <small>{sheet.labelCount} / {sheet.capacity}</small>
                  </button>
                ))}
                {requestState === "ready" && !listedSheets.length ? <p className="empty-list">No sheets assigned.</p> : null}
              </div>
            </aside>

            <section className="sheet-workarea">
              {displaySheet ? (
                <>
                  <div className="sheet-actions screen-only">
                    <div>
                      <p>Sheet {displaySheet.sheetNumber}</p>
                      <strong>{formatMoneylessStatus(displaySheet.status)} / {displaySheet.labelCount} labels</strong>
                    </div>
                    <button type="button" onClick={() => void prepareAndDownloadPdf()} disabled={busyAction !== null || displaySheet.slotConflict}>
                      {busyAction === "prepare" || busyAction === "pdf"
                        ? "Rendering PDF"
                        : displaySheet.status === "printed"
                          ? "Download PDF Copy"
                          : displaySheet.status === "sealed"
                            ? "Download PDF Copy"
                            : "Print Current Sheet"}
                    </button>
                    <button type="button" onClick={() => void downloadCutSvg()} disabled={busyAction !== null || displaySheet.slotConflict || !productionOutputReady}>
                      {busyAction === "cut" ? "Rendering SVG" : "Download Cricut SVG"}
                    </button>
                    <button
                      type="button"
                      className="mark-printed"
                      onClick={() => void markPrinted()}
                      disabled={
                        busyAction !== null ||
                        displaySheet.status !== "sealed" ||
                        displaySheet.slotConflict
                      }
                    >
                      {busyAction === "mark" ? "Saving" : displaySheet.status === "printed" ? "Printed" : "Mark Sheet Printed"}
                    </button>
                  </div>
                  {displaySheet.slotConflict ? <p className="conflict screen-only">Duplicate slot data detected. Printing is blocked until the queue is corrected.</p> : null}
                  <div className="sheet-scroll">
                    {productionOutputReady ? <div className="pdf-authority-note screen-only">
                      Exact-dimension PDF is the print authority. Print the downloaded file at 100% with every fit or scale option disabled.
                    </div> : null}
                    {!productionOutputReady ? (
                      <div className="open-sheet-summary screen-only">
                        <strong>OPEN SHEET — NOT AUTHORIZED FOR PRINT</strong>
                        <p>
                          This sheet currently contains {displaySheet.labelCount} of {displaySheet.capacity} labels. Choose Print Current Sheet to freeze these exact assignments; every unused position will remain blank.
                        </p>
                        <ol>
                          {displaySheet.labels.map((label) => (
                            <li key={label.labelId}>
                              <span>Slot {label.slot}</span>
                              <strong>{label.confirmedCardIdentity.playerName ?? label.confirmedCardIdentity.cardName ?? label.confirmedCardIdentity.title ?? label.reportId}</strong>
                              <small>{label.certId ?? label.reportId} / Grade {label.grade}</small>
                            </li>
                          ))}
                        </ol>
                      </div>
                    ) : previewUrl ? (
                      <iframe
                        className="sheet-pdf-preview"
                        src={`${previewUrl}#toolbar=0&navpanes=0&view=FitH`}
                        title={`Authoritative Label V1 preview for Sheet ${displaySheet.sheetNumber}`}
                      />
                    ) : (
                      <div className="preview-loading">Rendering authenticated Label V1 preview.</div>
                    )}
                  </div>
                </>
              ) : (
                <div className="empty-workarea screen-only">Select a label sheet.</div>
              )}
            </section>
          </div>
        )}
      </main>
      <style jsx global>{`
        * { box-sizing: border-box; }
        body { margin: 0; background: #eef0ed; color: #171917; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        button, a { font: inherit; }
        button { cursor: pointer; }
        button:disabled { cursor: not-allowed; opacity: 0.52; }
        .page { min-height: 100vh; }
        .topbar { min-height: 74px; padding: 14px 24px; display: flex; align-items: center; justify-content: space-between; gap: 20px; border-bottom: 1px solid #cfd4ce; background: #ffffff; }
        .topbar p, .sheet-actions p { margin: 0 0 3px; color: #526056; font-size: 11px; font-weight: 800; text-transform: uppercase; }
        .topbar h1 { margin: 0; font-size: 24px; line-height: 1.1; letter-spacing: 0; }
        .topbar nav { display: flex; align-items: center; gap: 10px; }
        .topbar a, .topbar button, .sheet-actions button, .auth-gate button, .refresh { min-height: 38px; padding: 8px 12px; border: 1px solid #1b211d; border-radius: 6px; background: #ffffff; color: #171917; text-decoration: none; font-weight: 750; }
        .workspace { display: grid; grid-template-columns: 292px minmax(0, 1fr); min-height: calc(100vh - 74px); }
        .sheet-sidebar { padding: 18px; border-right: 1px solid #cfd4ce; background: #f8f9f7; }
        .summary { display: grid; grid-template-columns: auto 1fr; gap: 5px 10px; padding-bottom: 14px; border-bottom: 1px solid #d9ddd7; }
        .summary strong { font-variant-numeric: tabular-nums; }
        .summary span { color: #596159; font-size: 13px; }
        .status-row { display: grid; grid-template-columns: 10px minmax(0, 1fr); gap: 8px; align-items: start; margin: 13px 0; }
        .status-row p { margin: 0; color: #4e554f; font-size: 12px; line-height: 1.45; }
        .request-dot { width: 8px; height: 8px; margin-top: 4px; border-radius: 50%; background: #8b918c; }
        .request-dot.loading { background: #a86f0b; }
        .request-dot.ready { background: #287a46; }
        .request-dot.error { background: #a42d2d; }
        .refresh { width: 100%; }
        .sheet-list { display: grid; gap: 6px; margin-top: 14px; }
        .sheet-row { width: 100%; min-height: 63px; padding: 9px 10px; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 5px 8px; text-align: left; border: 1px solid #d4d8d2; border-radius: 6px; background: #ffffff; color: #171917; }
        .sheet-row.selected { border-color: #1e5735; box-shadow: inset 3px 0 #1e5735; }
        .sheet-row > span:first-child { min-width: 0; display: grid; gap: 2px; }
        .sheet-row small { color: #656d66; font-size: 10px; overflow-wrap: anywhere; }
        .sheet-row > small { grid-column: 2; text-align: right; }
        .sheet-status { align-self: start; padding: 3px 6px; border-radius: 4px; background: #e7eae6; color: #485049; font-size: 10px; font-weight: 800; text-transform: uppercase; }
        .sheet-status.open { background: #dff0e5; color: #1e6339; }
        .sheet-status.full, .sheet-status.sealed { background: #f2e8ce; color: #72510e; }
        .sheet-status.printed { background: #dce7ef; color: #294e68; }
        .empty-list { color: #687069; font-size: 13px; }
        .sheet-workarea { min-width: 0; padding: 18px; }
        .sheet-actions { min-height: 56px; display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
        .sheet-actions > div { min-width: 180px; margin-right: auto; }
        .sheet-actions .mark-printed { background: #1c5a37; color: #ffffff; border-color: #1c5a37; }
        .conflict { margin: 0 0 12px; padding: 10px; border: 1px solid #b94242; background: #fff1f1; color: #8b2525; font-weight: 700; }
        .sheet-scroll { max-width: 100%; min-height: 760px; overflow: hidden; padding: 12px; border: 1px solid #cdd2cc; background: #dfe3de; }
        .pdf-authority-note { max-width: 850px; margin: 0 auto 10px; padding: 9px 11px; border: 1px solid #b7bdb7; background: #ffffff; color: #454d47; font-size: 12px; font-weight: 700; }
        .sheet-pdf-preview { display: block; width: min(100%, 850px); height: 720px; margin: 0 auto; border: 0; background: #ffffff; box-shadow: 0 8px 30px rgba(30, 35, 31, 0.16); }
        .preview-loading { width: min(100%, 850px); min-height: 720px; margin: 0 auto; display: grid; place-items: center; background: #ffffff; color: #606861; font-weight: 700; }
        .open-sheet-summary { width: min(100%, 850px); min-height: 520px; margin: 0 auto; padding: 28px; background: #ffffff; }
        .open-sheet-summary > strong { display: block; color: #8b2525; font-size: 18px; letter-spacing: 0.03em; }
        .open-sheet-summary > p { max-width: 680px; color: #535b55; line-height: 1.55; }
        .open-sheet-summary ol { margin: 22px 0 0; padding: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; list-style: none; }
        .open-sheet-summary li { min-height: 64px; padding: 9px 11px; display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 3px 10px; border: 1px solid #d9ddd7; border-radius: 5px; }
        .open-sheet-summary li span { color: #526056; font-size: 11px; font-weight: 800; text-transform: uppercase; }
        .open-sheet-summary li strong { overflow-wrap: anywhere; }
        .open-sheet-summary li small { grid-column: 2; color: #656d66; }
        .auth-gate, .empty-workarea { max-width: 460px; margin: 80px auto; padding: 24px; border: 1px solid #cdd2cc; border-radius: 6px; background: #ffffff; }
        .auth-gate h2 { margin: 0; font-size: 20px; }
        .auth-gate p { color: #596159; }
        @media (max-width: 820px) {
          .topbar { align-items: flex-start; padding: 12px 14px; }
          .topbar nav { align-items: flex-end; flex-direction: column; }
          .workspace { grid-template-columns: 1fr; }
          .sheet-sidebar { border-right: 0; border-bottom: 1px solid #cfd4ce; }
          .sheet-workarea { padding: 10px; }
          .sheet-actions { align-items: stretch; flex-wrap: wrap; }
          .sheet-actions > div { flex-basis: 100%; }
          .sheet-scroll { padding: 6px; }
          .sheet-pdf-preview, .preview-loading { height: 620px; }
          .open-sheet-summary ol { grid-template-columns: 1fr; }
        }
      `}</style>
    </>
  );
}
