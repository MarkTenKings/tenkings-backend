import Head from "next/head";
import Link from "next/link";
import QRCode from "qrcode";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "../../../hooks/useSession";
import { buildAdminHeaders } from "../../../lib/adminHeaders";
import {
  AI_GRADER_LABEL_SHEET_CAPACITY,
  type AiGraderLabelSheetDto,
  type AiGraderLabelSheetLabelDto,
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

function cardLines(label: AiGraderLabelSheetLabelDto) {
  const card = label.confirmedCardIdentity;
  const subject = card.playerName ?? card.cardName ?? card.title;
  const primary = [card.year, card.manufacturer, card.productSet ?? card.productLine, subject].filter(Boolean).join(" ");
  const secondary = [card.insertSet ?? card.insert, card.parallel, card.cardNumber ? `#${card.cardNumber}` : undefined]
    .filter(Boolean)
    .join(" / ");
  return {
    primary: primary || "Confirmed card",
    secondary: secondary || label.reportId,
  };
}

function LabelQr({ value }: { value?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    context?.clearRect(0, 0, canvas.width, canvas.height);
    if (!value) return;
    void QRCode.toCanvas(canvas, value, {
      errorCorrectionLevel: "M",
      margin: 0,
      width: 128,
      color: { dark: "#111111", light: "#ffffff" },
    });
  }, [value]);

  return value ? (
    <canvas ref={canvasRef} width={128} height={128} aria-label="Public report QR code" />
  ) : (
    <div className="qr-pending">QR pending</div>
  );
}

function PrintedLabel({ label }: { label: AiGraderLabelSheetLabelDto }) {
  const lines = cardLines(label);
  return (
    <div className="printed-label">
      <div className="grade-block">
        <span>AI GRADE</span>
        <strong className={label.grade.length > 4 ? "compact-grade" : undefined}>{label.grade}</strong>
      </div>
      <LabelQr value={label.qrPayloadUrl ?? label.publicReportUrl} />
      <div className="label-copy">
        <strong>Ten Kings AI Grader</strong>
        <span className="card-primary">{lines.primary}</span>
        <span className="card-secondary">{lines.secondary}</span>
        <span className="cert-line">{label.certId ?? label.reportId}</span>
      </div>
    </div>
  );
}

function SheetPaper({ sheet }: { sheet: AiGraderLabelSheetDto }) {
  const bySlot = new Map(sheet.labels.map((label) => [label.slot, label]));
  return (
    <section className="sheet-paper" aria-label={`AI Grader label sheet ${sheet.sheetNumber}`}>
      <div className="label-grid">
        {Array.from({ length: AI_GRADER_LABEL_SHEET_CAPACITY }, (_, index) => {
          const slot = index + 1;
          const label = bySlot.get(slot);
          return (
            <div className="label-slot" key={slot}>
              <span className="slot-number screen-only">{slot}</span>
              {label ? <PrintedLabel label={label} /> : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function AiGraderLabelSheetsPage() {
  const { session, loading: sessionLoading, ensureSession, logout } = useSession();
  const [result, setResult] = useState<AiGraderLabelSheetsResult>(emptyResult);
  const [requestState, setRequestState] = useState<RequestState>("idle");
  const [message, setMessage] = useState("Sign in to load AI Grader label sheets.");
  const [selectedSheetId, setSelectedSheetId] = useState<string | null>(null);
  const [preparedSheet, setPreparedSheet] = useState<AiGraderLabelSheetDto | null>(null);
  const [busyAction, setBusyAction] = useState<"prepare" | "mark" | null>(null);

  const selectedSheet = useMemo(
    () => result.sheets.find((sheet) => sheet.sheetId === selectedSheetId) ?? null,
    [result.sheets, selectedSheetId]
  );
  const displaySheet = preparedSheet?.sheetId === selectedSheetId ? preparedSheet : selectedSheet;
  const selectedPrintPrepared = Boolean(displaySheet && preparedSheet?.sheetId === displaySheet.sheetId);

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

  const prepareAndPrint = async () => {
    if (!displaySheet || !session?.token || displaySheet.slotConflict) return;
    if (displaySheet.status === "printed") {
      setPreparedSheet(displaySheet);
      window.setTimeout(() => window.print(), 80);
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
      setMessage(`Sheet ${nextSheet.sheetNumber} is sealed with ${nextSheet.labelCount} labels.`);
      window.setTimeout(() => window.print(), 120);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sheet could not be prepared for printing.");
      await loadSheets().catch(() => undefined);
    } finally {
      setBusyAction(null);
    }
  };

  const markPrinted = async () => {
    if (!displaySheet || !session?.token || displaySheet.status === "open" || displaySheet.slotConflict) return;
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
                    <button type="button" onClick={() => void prepareAndPrint()} disabled={busyAction !== null || displaySheet.slotConflict}>
                      {busyAction === "prepare" ? "Preparing" : displaySheet.status === "printed" ? "Print Copy" : "Print Sheet"}
                    </button>
                    <button
                      type="button"
                      className="mark-printed"
                      onClick={() => void markPrinted()}
                      disabled={
                        busyAction !== null ||
                        !selectedPrintPrepared ||
                        displaySheet.status === "open" ||
                        displaySheet.status === "printed" ||
                        displaySheet.slotConflict
                      }
                    >
                      {busyAction === "mark" ? "Saving" : displaySheet.status === "printed" ? "Printed" : "Mark Sheet Printed"}
                    </button>
                  </div>
                  {displaySheet.slotConflict ? <p className="conflict screen-only">Duplicate slot data detected. Printing is blocked until the queue is corrected.</p> : null}
                  <div className="sheet-scroll">
                    <SheetPaper sheet={displaySheet} />
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
        .sheet-scroll { max-width: 100%; overflow: auto; padding: 12px; border: 1px solid #cdd2cc; background: #dfe3de; }
        .sheet-paper { position: relative; width: 8.5in; height: 12in; margin: 0 auto; flex: none; overflow: hidden; background: #ffffff; box-shadow: 0 8px 30px rgba(30, 35, 31, 0.16); print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        .label-grid { position: absolute; top: 50%; left: 50%; width: 5.46in; height: 6.64in; display: grid; grid-template-columns: repeat(2, 2.73in); grid-template-rows: repeat(8, 0.83in); transform: translate(-50%, -50%); }
        .label-slot { position: relative; width: 2.73in; height: 0.83in; overflow: hidden; outline: 0.25pt solid #d0d3cf; background: #ffffff; }
        .slot-number { position: absolute; top: 2px; right: 3px; color: #a6aca7; font-size: 8px; z-index: 2; }
        .printed-label { width: 100%; height: 100%; padding: 0.045in; display: grid; grid-template-columns: 0.57in 0.62in minmax(0, 1fr); gap: 0.055in; align-items: center; color: #111111; }
        .grade-block { height: 0.7in; display: grid; align-content: center; justify-items: center; border-right: 0.7pt solid #202320; }
        .grade-block span { font-size: 5.5pt; font-weight: 900; line-height: 1; }
        .grade-block strong { font-size: 22pt; line-height: 1; font-variant-numeric: tabular-nums; }
        .grade-block strong.compact-grade { max-width: 0.52in; overflow: hidden; font-size: 7pt; text-overflow: ellipsis; white-space: nowrap; }
        .printed-label canvas, .qr-pending { width: 0.62in; height: 0.62in; display: block; }
        .qr-pending { display: grid; place-items: center; border: 0.5pt solid #777777; color: #555555; font-size: 5.5pt; font-weight: 800; text-align: center; text-transform: uppercase; }
        .label-copy { min-width: 0; height: 0.7in; display: grid; grid-template-rows: auto auto auto 1fr; align-content: center; overflow: hidden; }
        .label-copy > strong { font-size: 6.5pt; line-height: 1.1; text-transform: uppercase; }
        .label-copy > span { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .card-primary { margin-top: 2px; font-size: 7pt; font-weight: 800; line-height: 1.15; }
        .card-secondary { font-size: 6pt; line-height: 1.15; }
        .cert-line { align-self: end; font-size: 5.5pt; line-height: 1.1; color: #303430; }
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
        }
        @page { size: 8.5in 12in; margin: 0; }
        @media print {
          html, body, #__next { width: 8.5in !important; height: 12in !important; margin: 0 !important; padding: 0 !important; background: #ffffff !important; }
          body * { visibility: hidden !important; }
          .sheet-paper, .sheet-paper * { visibility: visible !important; }
          .screen-only { display: none !important; }
          .page, .workspace, .sheet-workarea, .sheet-scroll { width: 8.5in !important; height: 12in !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important; border: 0 !important; overflow: visible !important; background: #ffffff !important; }
          .sheet-paper { position: absolute !important; top: 0 !important; left: 0 !important; width: 8.5in !important; height: 12in !important; margin: 0 !important; box-shadow: none !important; page-break-after: always; }
          .label-slot { outline: none; }
        }
      `}</style>
    </>
  );
}
