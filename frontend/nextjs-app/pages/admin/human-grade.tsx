import Head from "next/head";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppShell from "../../components/AppShell";
import SharedLabelEditor from "../../components/human-grade/SharedLabelEditor";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../constants/admin";
import { useSession } from "../../hooks/useSession";
import { buildAdminHeaders } from "../../lib/adminHeaders";
import {
  HUMAN_GRADE_SHEET_CAPACITY,
  EMPTY_HUMAN_GRADE_LABEL_EDITOR_VALUE,
  NEW_HUMAN_GRADE_FORMULA_VERSION,
  calculateHumanGrade,
  type HumanGradeLabelEditorValue,
  type HumanGradeLabelDto,
  type HumanGradeLabelSheetDto,
  type HumanGradeQueueDto,
} from "../../lib/humanGrade";

const EMPTY_QUEUE: HumanGradeQueueDto = {
  sheets: [],
  totals: { cards: 0, readySheets: 0 },
};

function pageTitle(sheet: HumanGradeLabelSheetDto) {
  return `Label Page ${String(sheet.sheetNumber).padStart(3, "0")}`;
}

function displayName(sheet: HumanGradeLabelSheetDto) {
  return sheet.status === "READY"
    ? `${pageTitle(sheet)} · Ready to print`
    : `${pageTitle(sheet)} · Filling ${sheet.labels.length}/${HUMAN_GRADE_SHEET_CAPACITY}`;
}

export default function HumanGradePage() {
  const { session, loading: sessionLoading, ensureSession } = useSession();
  const [queue, setQueue] = useState<HumanGradeQueueDto>(EMPTY_QUEUE);
  const [selectedSheetId, setSelectedSheetId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [deletingLabelId, setDeletingLabelId] = useState<string | null>(null);
  const [form, setForm] = useState<HumanGradeLabelEditorValue>(EMPTY_HUMAN_GRADE_LABEL_EDITOR_VALUE);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("Loading human-grade label pages.");
  const [loadingQueue, setLoadingQueue] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewFrameRef = useRef<HTMLIFrameElement | null>(null);

  const isAdmin = useMemo(
    () => hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone),
    [session?.user.id, session?.user.phone]
  );

  const selectedSheet = useMemo(
    () => queue.sheets.find((sheet) => sheet.id === selectedSheetId) ?? queue.sheets[0] ?? null,
    [queue.sheets, selectedSheetId]
  );
  const editingLabel = useMemo(
    () => queue.sheets.flatMap((sheet) => sheet.labels).find((label) => label.id === editingLabelId) ?? null,
    [editingLabelId, queue.sheets]
  );
  const calculatedGrade = useMemo(() => {
    const values = [form.centeringGrade, form.cornersGrade, form.edgesGrade, form.surfaceGrade];
    if (values.some((value) => !value.trim())) return null;
    try {
      return calculateHumanGrade(
        form,
        editingLabel?.gradingFormulaVersion ?? NEW_HUMAN_GRADE_FORMULA_VERSION
      ).labelGrade;
    } catch {
      return null;
    }
  }, [editingLabel?.gradingFormulaVersion, form]);

  const loadQueue = useCallback(async () => {
    if (!session?.token || !isAdmin) return;
    setLoadingQueue(true);
    try {
      const response = await fetch("/api/admin/human-grade", {
        headers: buildAdminHeaders(session.token),
      });
      const payload = (await response.json().catch(() => ({}))) as HumanGradeQueueDto & { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "Human-grade pages could not be loaded.");
      setQueue(payload);
      setSelectedSheetId((current) => {
        if (current && payload.sheets.some((sheet) => sheet.id === current)) return current;
        return payload.sheets[0]?.id ?? null;
      });
      setMessage(
        payload.sheets.length
          ? `${payload.totals.cards} human-graded card${payload.totals.cards === 1 ? "" : "s"} saved.`
          : "No human-graded cards yet."
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Human-grade pages could not be loaded.");
    } finally {
      setLoadingQueue(false);
    }
  }, [isAdmin, session?.token]);

  useEffect(() => {
    if (!sessionLoading && session?.token && isAdmin) void loadQueue();
  }, [isAdmin, loadQueue, session?.token, sessionLoading]);

  useEffect(() => {
    if (!selectedSheet || selectedSheet.status !== "READY" || !session?.token) {
      setPreviewUrl(null);
      return;
    }
    let active = true;
    let nextUrl: string | null = null;
    setPreviewLoading(true);
    setPreviewUrl(null);
    void fetch(`/api/admin/human-grade/sheets/${encodeURIComponent(selectedSheet.id)}`, {
      headers: buildAdminHeaders(session.token),
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { message?: string };
          throw new Error(payload.message ?? "The printable label page could not be rendered.");
        }
        return response.blob();
      })
      .then((blob) => {
        if (!active) return;
        nextUrl = URL.createObjectURL(blob);
        setPreviewUrl(nextUrl);
        setMessage(`${pageTitle(selectedSheet)} PDF rendered from its current saved labels.`);
      })
      .catch((error) => {
        if (active) setMessage(error instanceof Error ? error.message : "The printable label page could not be rendered.");
      })
      .finally(() => {
        if (active) setPreviewLoading(false);
      });
    return () => {
      active = false;
      if (nextUrl) URL.revokeObjectURL(nextUrl);
    };
  }, [selectedSheet, session?.token]);

  const updateForm = (field: keyof HumanGradeLabelEditorValue, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const openNewCard = () => {
    setEditingLabelId(null);
    setForm(EMPTY_HUMAN_GRADE_LABEL_EDITOR_VALUE);
    setFieldErrors({});
    setFormOpen(true);
    setMessage("Enter only the information that should print on the label.");
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingLabelId(null);
    setForm(EMPTY_HUMAN_GRADE_LABEL_EDITOR_VALUE);
    setFieldErrors({});
  };

  const openEditLabel = (label: HumanGradeLabelDto, sheetId: string) => {
    setEditingLabelId(label.id);
    setSelectedSheetId(sheetId);
    setForm({
      cardType: label.cardType,
      playerName: label.playerName ?? "",
      cardName: label.cardName ?? "",
      year: label.year,
      manufacturer: label.manufacturer ?? "",
      productSet: label.productSet,
      parallel: label.parallel ?? "",
      insert: label.insert ?? "",
      cardNumber: label.cardNumber ?? "",
      centeringGrade: String(label.centeringGrade),
      cornersGrade: String(label.cornersGrade),
      edgesGrade: String(label.edgesGrade),
      surfaceGrade: String(label.surfaceGrade),
    });
    setFieldErrors({});
    setFormOpen(true);
    setMessage(`Editing ${label.certificateNumber}. Its certificate and slot will stay unchanged.`);
  };

  const saveCard = async (event: FormEvent) => {
    event.preventDefault();
    if (!session?.token || saving) return;
    const editedId = editingLabelId;
    setSaving(true);
    setFieldErrors({});
    setMessage(editedId ? "Saving label changes." : "Saving human grade and assigning the next label slot.");
    try {
      const response = await fetch("/api/admin/human-grade", {
        method: editedId ? "PATCH" : "POST",
        headers: buildAdminHeaders(session.token, { "Content-Type": "application/json" }),
        body: JSON.stringify(editedId ? { ...form, id: editedId } : form),
      });
      const payload = (await response.json().catch(() => ({}))) as HumanGradeQueueDto & {
        message?: string;
        fields?: Record<string, string>;
      };
      if (!response.ok) {
        if (payload.fields) setFieldErrors(payload.fields);
        throw new Error(payload.message ?? "The human-grade label could not be saved.");
      }
      const newestSheet = payload.sheets[0] ?? null;
      const newestLabel = newestSheet?.labels[newestSheet.labels.length - 1];
      const savedSheet = editedId
        ? payload.sheets.find((sheet) => sheet.labels.some((label) => label.id === editedId)) ?? null
        : newestSheet;
      const savedLabel = editedId
        ? savedSheet?.labels.find((label) => label.id === editedId)
        : newestLabel;
      setQueue(payload);
      setSelectedSheetId(savedSheet?.id ?? null);
      closeForm();
      setMessage(
        savedLabel && savedSheet
          ? `${savedLabel.certificateNumber} ${editedId ? "updated" : "saved"} in ${pageTitle(savedSheet)}, slot ${savedLabel.slot}.`
          : "Human-grade label saved."
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The human-grade label could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const deleteLabel = async (label: HumanGradeLabelDto) => {
    if (!session?.token || deletingLabelId) return;
    if (!window.confirm(`Delete ${label.certificateNumber}? Later labels will move forward one slot.`)) return;

    setDeletingLabelId(label.id);
    setMessage(`Deleting ${label.certificateNumber}.`);
    try {
      const response = await fetch("/api/admin/human-grade", {
        method: "DELETE",
        headers: buildAdminHeaders(session.token, { "Content-Type": "application/json" }),
        body: JSON.stringify({ id: label.id }),
      });
      const payload = (await response.json().catch(() => ({}))) as HumanGradeQueueDto & { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "The human-grade label could not be deleted.");

      setQueue(payload);
      setSelectedSheetId((current) => {
        if (current && payload.sheets.some((sheet) => sheet.id === current)) return current;
        return payload.sheets[0]?.id ?? null;
      });
      if (editingLabelId === label.id) closeForm();
      setMessage(`${label.certificateNumber} deleted. Remaining labels shifted forward.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The human-grade label could not be deleted.");
    } finally {
      setDeletingLabelId(null);
    }
  };

  const printSelectedPage = () => {
    if (!previewUrl) return;
    const frameWindow = previewFrameRef.current?.contentWindow;
    if (frameWindow) {
      frameWindow.focus();
      frameWindow.print();
      return;
    }
    window.open(previewUrl, "_blank", "noopener,noreferrer");
  };

  const renderLabelSlots = (sheet: HumanGradeLabelSheetDto, allowDelete: boolean) => (
    <div className="slot-grid">
      {Array.from({ length: HUMAN_GRADE_SHEET_CAPACITY }, (_, index) => {
        const label = sheet.labels.find((candidate) => candidate.slot === index + 1);
        return (
          <div key={index} className={label ? "slot filled" : "slot"}>
            <span>Slot {index + 1}</span>
            {label ? (
              <>
                <strong>{label.playerName ?? label.cardName}</strong>
                <small>{label.certificateNumber} · Grade {label.grade}</small>
                <div className="slot-actions">
                  {label.source === "SPEEDSTER" ? (
                    label.sourceSessionId ? (
                      <Link href={`/admin/ai-grader-v2/completed/${encodeURIComponent(label.sourceSessionId)}`}>
                        Edit in Speedster
                      </Link>
                    ) : <span>Managed in Speedster</span>
                  ) : (
                    <button type="button" className="edit-label" onClick={() => openEditLabel(label, sheet.id)}>
                      Edit
                    </button>
                  )}
                  {allowDelete && label.source !== "SPEEDSTER" ? (
                    <button
                      type="button"
                      className="delete-label"
                      onClick={() => void deleteLabel(label)}
                      disabled={deletingLabelId === label.id}
                    >
                      {deletingLabelId === label.id ? "Deleting…" : "Delete"}
                    </button>
                  ) : null}
                </div>
              </>
            ) : <small>Waiting</small>}
          </div>
        );
      })}
    </div>
  );

  const renderGate = () => {
    if (sessionLoading) {
      return <div className="mx-auto mt-24 max-w-xl rounded-3xl border border-white/10 bg-black/40 p-8 text-slate-300">Loading admin session…</div>;
    }
    if (!session) {
      return (
        <div className="mx-auto mt-24 max-w-xl rounded-3xl border border-white/10 bg-black/40 p-8">
          <h1 className="font-heading text-3xl uppercase tracking-[0.12em] text-white">Human Grade</h1>
          <p className="mt-3 text-slate-300">Sign in with the existing Ten Kings admin account to continue.</p>
          <button
            type="button"
            onClick={() => void ensureSession({ message: "Sign in to use Human Grade." })}
            className="mt-6 rounded-xl bg-emerald-500 px-5 py-3 font-bold text-black"
          >
            Sign In
          </button>
        </div>
      );
    }
    if (!isAdmin) {
      return <div className="mx-auto mt-24 max-w-xl rounded-3xl border border-rose-400/30 bg-black/40 p-8 text-rose-200">Admin access is required.</div>;
    }
    return null;
  };

  const gate = renderGate();
  if (gate) {
    return (
      <AppShell background="black">
        <Head>
          <title>Human Grade | Ten Kings</title>
          <meta name="robots" content="noindex,nofollow" />
        </Head>
        {gate}
      </AppShell>
    );
  }

  return (
    <AppShell background="black">
      <Head>
        <title>Human Grade | Ten Kings</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <main className="human-grade-page">
        <header className="page-header">
          <div>
            <p className="eyebrow">Ten Kings Admin</p>
            <h1>Human Grade</h1>
            <p className="subtitle">Enter the printed label details, save the grade, and fill each 16-label page.</p>
          </div>
          <div className="header-actions">
            <Link href="/admin">Admin Home</Link>
            <button type="button" className="add-card-button" onClick={openNewCard}>
              Add New Graded Card
            </button>
          </div>
        </header>

        <section className="summary-row" aria-label="Human grade summary">
          <div><strong>{queue.totals.cards}</strong><span>Saved Cards</span></div>
          <div><strong>{queue.totals.readySheets}</strong><span>Ready Pages</span></div>
          <div><strong>{queue.sheets.find((sheet) => sheet.status === "OPEN")?.labels.length ?? 0}/16</strong><span>Current Page</span></div>
          <button type="button" onClick={() => void loadQueue()} disabled={loadingQueue}>
            {loadingQueue ? "Refreshing…" : "Refresh"}
          </button>
        </section>

        <p className="status-message" role="status">{message}</p>

        {formOpen ? (
          <SharedLabelEditor
            mode="HUMAN"
            value={form}
            onChange={updateForm}
            onSubmit={saveCard}
            onCancel={closeForm}
            certificateNumber={editingLabel?.certificateNumber ?? "TKH-AUTO"}
            calculatedGrade={calculatedGrade}
            fieldErrors={fieldErrors}
            saving={saving}
            editing={Boolean(editingLabelId)}
            primaryActionLabel={editingLabelId ? "Save Changes" : "Save Graded Card"}
            subgradeAriaLabel="Calculated grade and human subgrades"
          />
        ) : null}

        <div className="queue-layout">
          <aside className="page-list">
            <div className="list-heading">
              <div>
                <p className="eyebrow">Label Pages</p>
                <h2>Print Queue</h2>
              </div>
              <span>{queue.sheets.length}</span>
            </div>
            <div className="page-buttons">
              {queue.sheets.map((sheet) => (
                <button
                  type="button"
                  key={sheet.id}
                  className={selectedSheet?.id === sheet.id ? "page-button selected" : "page-button"}
                  onClick={() => setSelectedSheetId(sheet.id)}
                >
                  <span>
                    <strong>{pageTitle(sheet)}</strong>
                    <small>{sheet.labels.length} of 16 labels</small>
                  </span>
                  <em className={sheet.status.toLowerCase()}>{sheet.status === "READY" ? "Ready" : "Filling"}</em>
                </button>
              ))}
              {!queue.sheets.length ? <p className="empty-state">Save the first graded card to begin Page 001.</p> : null}
            </div>
          </aside>

          <section className="page-preview">
            {selectedSheet ? (
              <>
                <div className="preview-heading">
                  <div>
                    <p className="eyebrow">{displayName(selectedSheet)}</p>
                    <h2>{selectedSheet.status === "READY" ? "Ready to Print" : "Page in Progress"}</h2>
                  </div>
                  {selectedSheet.status === "READY" ? (
                    <div className="print-actions">
                      <button type="button" onClick={printSelectedPage} disabled={!previewUrl}>Print Page</button>
                      {previewUrl ? <a href={previewUrl} download={`ten-kings-human-grade-page-${selectedSheet.sheetNumber}.pdf`}>Download PDF</a> : null}
                    </div>
                  ) : null}
                </div>

                {selectedSheet.status === "READY" ? (
                  <div className="ready-page-content">
                    {previewUrl ? (
                      <iframe
                        ref={previewFrameRef}
                        src={`${previewUrl}#toolbar=1&navpanes=0&view=FitH`}
                        title={`Printable ${pageTitle(selectedSheet)}`}
                      />
                    ) : (
                      <div className="preview-placeholder">{previewLoading ? "Rendering the exact 16-label PDF…" : "Preview unavailable."}</div>
                    )}
                    <section className="completed-label-editor" aria-label="Edit completed page labels">
                      <div>
                        <p className="eyebrow">Completed Page Labels</p>
                        <h3>Edit Human Grade entries</h3>
                        <p>Human-owned edits regenerate this PDF; Speedster labels return to their completed card.</p>
                      </div>
                      {renderLabelSlots(selectedSheet, false)}
                    </section>
                  </div>
                ) : (
                  renderLabelSlots(selectedSheet, true)
                )}
              </>
            ) : (
              <div className="preview-placeholder">Add a graded card to start the first label page.</div>
            )}
          </section>
        </div>
      </main>

      <style jsx global>{`
        .human-grade-page {
          position: relative;
          z-index: 1;
          width: min(1500px, 100%);
          margin: 0 auto;
          padding: 42px 28px 80px;
          color: #f4f6f4;
        }
        .page-header, .preview-heading, .list-heading {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 24px;
        }
        .page-header h1 { margin: 2px 0 8px; font-size: clamp(36px, 5vw, 64px); line-height: 1; letter-spacing: -0.03em; }
        .eyebrow { margin: 0; color: #73d998; font-size: 11px; font-weight: 800; letter-spacing: 0.22em; text-transform: uppercase; }
        .subtitle { margin: 0; color: #aab3ac; }
        .header-actions, .print-actions { display: flex; align-items: center; gap: 10px; }
        .header-actions a, .header-actions button, .print-actions button, .print-actions a, .summary-row button {
          border: 1px solid #38423b;
          border-radius: 10px;
          padding: 11px 15px;
          background: #121713;
          color: #f4f6f4;
          font-weight: 800;
          text-decoration: none;
        }
        .header-actions .add-card-button, .print-actions button {
          border-color: #2c9e58;
          background: #32b764;
          color: #06130a;
          box-shadow: 0 8px 26px rgba(50, 183, 100, 0.18);
        }
        button:disabled { cursor: not-allowed; opacity: 0.5; }
        .summary-row {
          display: grid;
          grid-template-columns: repeat(3, minmax(120px, 180px)) 1fr;
          gap: 10px;
          margin: 30px 0 12px;
        }
        .summary-row > div, .summary-row > button {
          min-height: 68px;
          padding: 12px 16px;
          border: 1px solid #29322c;
          border-radius: 14px;
          background: #0e120f;
        }
        .summary-row > div { display: grid; }
        .summary-row strong { font-size: 22px; }
        .summary-row span { color: #879189; font-size: 11px; font-weight: 700; text-transform: uppercase; }
        .summary-row button { justify-self: end; align-self: center; min-height: auto; }
        .status-message { min-height: 24px; margin: 0 0 16px; color: #aeb6b0; font-size: 13px; }
        .page-list, .page-preview {
          border: 1px solid #29322c;
          border-radius: 18px;
          background: #0c100d;
          box-shadow: 0 20px 60px rgba(0,0,0,0.22);
        }
        .list-heading h2, .preview-heading h2 { margin: 3px 0 0; font-size: 20px; }
        .queue-layout { display: grid; grid-template-columns: 320px minmax(0, 1fr); gap: 18px; }
        .page-list, .page-preview { min-height: 650px; padding: 18px; }
        .list-heading { padding: 0 4px 14px; border-bottom: 1px solid #252c27; }
        .list-heading > span { display: grid; width: 34px; height: 34px; place-items: center; border-radius: 50%; background: #1b251e; color: #8feaaf; font-weight: 800; }
        .page-buttons { display: grid; gap: 8px; margin-top: 14px; }
        .page-button {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 12px;
          border: 1px solid #29322c;
          border-radius: 10px;
          background: #121713;
          color: #eef2ee;
          text-align: left;
        }
        .page-button.selected { border-color: #48bc70; box-shadow: inset 3px 0 #48bc70; }
        .page-button span { display: grid; gap: 3px; }
        .page-button small { color: #7f8981; }
        .page-button em { padding: 4px 7px; border-radius: 5px; font-size: 9px; font-style: normal; font-weight: 900; letter-spacing: 0.08em; text-transform: uppercase; }
        .page-button em.ready { background: #174e2c; color: #83e7a7; }
        .page-button em.open { background: #403415; color: #f1cb69; }
        .empty-state { color: #7f8981; font-size: 13px; line-height: 1.5; }
        .preview-heading { min-height: 50px; margin-bottom: 14px; }
        .print-actions a { display: inline-flex; align-items: center; }
        .page-preview iframe { width: 100%; height: 820px; border: 0; border-radius: 8px; background: white; }
        .preview-placeholder { min-height: 530px; display: grid; place-items: center; border: 1px dashed #2e3931; border-radius: 12px; color: #7f8981; }
        .ready-page-content { display: grid; gap: 20px; }
        .completed-label-editor {
          display: grid;
          gap: 14px;
          padding-top: 18px;
          border-top: 1px solid #29322c;
        }
        .completed-label-editor h3 { margin: 3px 0 4px; font-size: 18px; }
        .completed-label-editor p:last-child { margin: 0; color: #8d9890; font-size: 12px; }
        .slot-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }
        .slot { min-height: 92px; display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 12px; align-content: center; padding: 10px 12px; border: 1px dashed #303a33; border-radius: 8px; color: #5f6861; }
        .slot.filled { border-style: solid; border-color: #385642; background: #111a14; color: #eff4f0; }
        .slot > span { color: #65cb89; font-size: 10px; font-weight: 900; text-transform: uppercase; }
        .slot > strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .slot > small { grid-column: 2; color: #7f8981; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .slot-actions { grid-column: 2; display: flex; gap: 7px; }
        .slot-actions button {
          border: 1px solid #34443a;
          border-radius: 6px;
          padding: 5px 9px;
          background: #172019;
          color: #dce4de;
          font-size: 11px;
          font-weight: 800;
        }
        .slot-actions .edit-label { border-color: #397d50; color: #83e7a7; }
        .slot-actions .delete-label { border-color: #713838; color: #ffaaaa; }
        @media (max-width: 980px) {
          .queue-layout { grid-template-columns: 1fr; }
          .page-list, .page-preview { min-height: auto; }
          .page-buttons { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (max-width: 680px) {
          .human-grade-page { padding: 28px 14px 60px; }
          .page-header, .preview-heading { align-items: flex-start; flex-direction: column; }
          .header-actions, .print-actions { width: 100%; }
          .header-actions > *, .print-actions > * { flex: 1; text-align: center; }
          .summary-row { grid-template-columns: repeat(3, 1fr); }
          .summary-row > button { grid-column: 1 / -1; justify-self: stretch; }
          .page-buttons, .slot-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </AppShell>
  );
}
