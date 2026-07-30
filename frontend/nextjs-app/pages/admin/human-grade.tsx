import Head from "next/head";
import Image from "next/image";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import crownAsset from "../../assets/ai-grader-label-v1/ten-kings-crown-2026-monochrome-v1.png";
import AppShell from "../../components/AppShell";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../constants/admin";
import { useSession } from "../../hooks/useSession";
import { buildAdminHeaders } from "../../lib/adminHeaders";
import {
  HUMAN_GRADE_SHEET_CAPACITY,
  calculateHumanGrade,
  type HumanGradeCardType,
  type HumanGradeLabelDto,
  type HumanGradeLabelSheetDto,
  type HumanGradeQueueDto,
} from "../../lib/humanGrade";

type HumanGradeForm = {
  cardType: HumanGradeCardType;
  playerName: string;
  cardName: string;
  year: string;
  manufacturer: string;
  productSet: string;
  parallel: string;
  insert: string;
  cardNumber: string;
  centeringGrade: string;
  cornersGrade: string;
  edgesGrade: string;
  surfaceGrade: string;
};

const EMPTY_QUEUE: HumanGradeQueueDto = {
  sheets: [],
  totals: { cards: 0, readySheets: 0 },
};

const EMPTY_FORM: HumanGradeForm = {
  cardType: "SPORTS",
  playerName: "",
  cardName: "",
  year: "",
  manufacturer: "",
  productSet: "",
  parallel: "",
  insert: "",
  cardNumber: "",
  centeringGrade: "",
  cornersGrade: "",
  edgesGrade: "",
  surfaceGrade: "",
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
  const [form, setForm] = useState<HumanGradeForm>(EMPTY_FORM);
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
      return calculateHumanGrade(form).labelGrade;
    } catch {
      return null;
    }
  }, [form]);

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

  const updateForm = (field: keyof HumanGradeForm, value: string) => {
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
    setForm(EMPTY_FORM);
    setFieldErrors({});
    setFormOpen(true);
    setMessage("Enter only the information that should print on the label.");
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingLabelId(null);
    setForm(EMPTY_FORM);
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
                  <button type="button" className="edit-label" onClick={() => openEditLabel(label, sheet.id)}>
                    Edit
                  </button>
                  {allowDelete ? (
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
          <section className="composer-card">
            <div className="composer-heading">
              <div>
                <p className="eyebrow">{editingLabelId ? "Edit Label" : "New Label"}</p>
                <h2>Enter printed card information</h2>
              </div>
              <div className="type-switch" aria-label="Card type">
                {(["SPORTS", "POKEMON"] as const).map((cardType) => (
                  <button
                    key={cardType}
                    type="button"
                    className={form.cardType === cardType ? "selected" : ""}
                    onClick={() => updateForm("cardType", cardType)}
                  >
                    {cardType === "SPORTS" ? "Sports" : "Pokémon"}
                  </button>
                ))}
              </div>
            </div>

            <form onSubmit={saveCard}>
              <div className="label-composer" aria-label="Ten Kings human-grade label editor">
                <div className="brand-third">
                  <Image src={crownAsset} alt="" priority />
                  <strong>TEN KINGS</strong>
                  <span className="certificate-preview">{editingLabel?.certificateNumber ?? "TKH-AUTO"}</span>
                </div>
                <div className="identity-third">
                  <label className="primary-field">
                    <span>{form.cardType === "SPORTS" ? "Player Name" : "Card Name"}</span>
                    <input
                      value={form.cardType === "SPORTS" ? form.playerName : form.cardName}
                      onChange={(event) =>
                        updateForm(form.cardType === "SPORTS" ? "playerName" : "cardName", event.target.value)
                      }
                      placeholder={form.cardType === "SPORTS" ? "PLAYER NAME" : "CARD NAME"}
                      autoFocus
                    />
                  </label>
                  <div className="metadata-fields">
                    <label>
                      <span>Year</span>
                      <input value={form.year} onChange={(event) => updateForm("year", event.target.value)} placeholder="YEAR" />
                    </label>
                    {form.cardType === "SPORTS" ? (
                      <label>
                        <span>Manufacturer</span>
                        <input
                          value={form.manufacturer}
                          onChange={(event) => updateForm("manufacturer", event.target.value)}
                          placeholder="MANUFACTURER"
                        />
                      </label>
                    ) : null}
                    <label>
                      <span>{form.cardType === "SPORTS" ? "Product / Set" : "Set"}</span>
                      <input
                        value={form.productSet}
                        onChange={(event) => updateForm("productSet", event.target.value)}
                        placeholder={form.cardType === "SPORTS" ? "PRODUCT / SET" : "SET"}
                      />
                    </label>
                  </div>
                  <div className="descriptor-fields">
                    <label>
                      <span>Parallel</span>
                      <input value={form.parallel} onChange={(event) => updateForm("parallel", event.target.value)} placeholder="PARALLEL" />
                    </label>
                    {form.cardType === "SPORTS" ? (
                      <label>
                        <span>Insert</span>
                        <input value={form.insert} onChange={(event) => updateForm("insert", event.target.value)} placeholder="INSERT" />
                      </label>
                    ) : null}
                    <label className="card-number-field">
                      <span>Card Number</span>
                      <input value={form.cardNumber} onChange={(event) => updateForm("cardNumber", event.target.value)} placeholder="#CARD" />
                    </label>
                  </div>
                </div>
                <div className="grade-third">
                  <div className="grade-hud" aria-label="Portrait card grading HUD">
                    <div className="grade-hud-frame" aria-hidden="true">
                      <i className="hud-reticle top-left" />
                      <i className="hud-reticle top-right" />
                      <i className="hud-reticle bottom-left" />
                      <i className="hud-reticle bottom-right" />
                    </div>
                    <i className="hud-axis vertical" aria-hidden="true" />
                    <i className="hud-axis horizontal" aria-hidden="true" />
                    <output className="hud-final-grade" aria-label="Calculated Final Grade" aria-live="polite">
                      {calculatedGrade ?? "—"}
                    </output>
                    {([
                      ["centeringGrade", "top", "Centering"],
                      ["cornersGrade", "left", "Corners"],
                      ["edgesGrade", "right", "Edges"],
                      ["surfaceGrade", "bottom", "Surface"],
                    ] as const).map(([field, position, label]) => (
                      <label className={`hud-subgrade ${position}`} key={field}>
                        <input
                          type="number"
                          min="1"
                          max="10"
                          step="0.1"
                          inputMode="decimal"
                          required
                          value={form[field]}
                          onChange={(event) => updateForm(field, event.target.value)}
                          placeholder="—"
                          aria-label={label}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              {Object.keys(fieldErrors).length ? (
                <div className="field-errors" role="alert">
                  {Object.entries(fieldErrors).map(([field, error]) => <span key={field}>{error}</span>)}
                </div>
              ) : null}

              <div className="form-actions">
                <button type="button" className="cancel-button" onClick={closeForm} disabled={saving}>Cancel</button>
                <button type="submit" className="save-button" disabled={saving}>
                  {saving ? "Saving…" : editingLabelId ? "Save Changes" : "Save Graded Card"}
                </button>
              </div>
            </form>
          </section>
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
                        <h3>Edit any saved label</h3>
                        <p>Saving an edit regenerates this page’s PDF with the updated label.</p>
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
        .page-header, .composer-heading, .preview-heading, .list-heading {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 24px;
        }
        .page-header h1 { margin: 2px 0 8px; font-size: clamp(36px, 5vw, 64px); line-height: 1; letter-spacing: -0.03em; }
        .eyebrow { margin: 0; color: #73d998; font-size: 11px; font-weight: 800; letter-spacing: 0.22em; text-transform: uppercase; }
        .subtitle { margin: 0; color: #aab3ac; }
        .header-actions, .form-actions, .print-actions, .type-switch { display: flex; align-items: center; gap: 10px; }
        .header-actions a, .header-actions button, .form-actions button, .print-actions button, .print-actions a, .type-switch button, .summary-row button {
          border: 1px solid #38423b;
          border-radius: 10px;
          padding: 11px 15px;
          background: #121713;
          color: #f4f6f4;
          font-weight: 800;
          text-decoration: none;
        }
        .header-actions .add-card-button, .save-button, .print-actions button {
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
        .composer-card, .page-list, .page-preview {
          border: 1px solid #29322c;
          border-radius: 18px;
          background: #0c100d;
          box-shadow: 0 20px 60px rgba(0,0,0,0.22);
        }
        .composer-card { margin-bottom: 24px; padding: 22px; }
        .composer-heading { margin-bottom: 18px; }
        .composer-heading h2, .list-heading h2, .preview-heading h2 { margin: 3px 0 0; font-size: 20px; }
        .type-switch button { padding: 8px 12px; }
        .type-switch button.selected { border-color: #67ce8d; background: #183c26; color: #8feaaf; }
        .label-composer {
          width: min(100%, 1092px);
          aspect-ratio: 2.73 / 0.83;
          display: grid;
          grid-template-columns: 22.6% 45.1% 32.3%;
          margin: 0 auto;
          overflow: hidden;
          border-radius: 9px;
          background: rgba(255,255,255,0.98);
          color: #0f0f0f;
          box-shadow: 0 12px 36px rgba(0,0,0,0.35);
        }
        .brand-third, .identity-third, .grade-third { min-width: 0; padding: 12px; }
        .brand-third {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          border-right: 2px solid #0f0f0f;
        }
        .brand-third img { width: 60%; max-height: 50%; object-fit: contain; filter: brightness(0); }
        .brand-third strong { margin-top: 3px; font-family: Arial, sans-serif; font-size: clamp(12px, 2vw, 32px); letter-spacing: 0.02em; white-space: nowrap; }
        .brand-third .certificate-preview { margin-top: 8px; }
        .identity-third {
          display: grid;
          grid-template-rows: 1.2fr 1fr 0.85fr;
          gap: 7px;
          border-right: 2px solid #0f0f0f;
        }
        .label-composer label { min-width: 0; display: grid; align-content: center; }
        .label-composer label > span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
        .label-composer input {
          width: 100%;
          min-width: 0;
          border: 0;
          border-bottom: 1px solid #b9b9b9;
          border-radius: 0;
          outline: none;
          background: transparent;
          color: #0f0f0f;
          text-align: center;
          text-transform: uppercase;
        }
        .label-composer input:focus { border-color: #168a45; box-shadow: 0 2px 0 #168a45; }
        .primary-field input, .grade-field output {
          font-family: Impact, "Arial Narrow", sans-serif;
          font-size: clamp(20px, 3.2vw, 46px);
          line-height: 1;
        }
        .metadata-fields, .descriptor-fields { min-width: 0; display: flex; align-items: center; gap: 5px; }
        .metadata-fields label, .descriptor-fields label { flex: 1 1 0; }
        .metadata-fields input, .descriptor-fields input, .card-number-field input {
          font-family: Arial, sans-serif;
          font-size: clamp(8px, 1.2vw, 17px);
        }
        .grade-third { display: grid; place-items: center; }
        .grade-hud {
          position: relative;
          width: min(82%, 196px);
          aspect-ratio: 38 / 46.2;
          color: #0f0f0f;
          isolation: isolate;
        }
        .grade-hud-frame {
          position: absolute;
          inset: 5%;
          border: 1.3px solid #0f0f0f;
        }
        .hud-axis {
          position: absolute;
          z-index: 1;
          display: block;
          background: #0f0f0f;
        }
        .hud-axis.vertical { top: 10%; bottom: 10%; left: 50%; width: 1px; transform: translateX(-50%); }
        .hud-axis.horizontal { top: 50%; right: 10%; left: 10%; height: 1px; transform: translateY(-50%); }
        .hud-reticle {
          position: absolute;
          width: 13px;
          height: 13px;
          border: 1px solid #0f0f0f;
          border-radius: 50%;
          background: white;
          transform: translate(-50%, -50%);
        }
        .hud-reticle::before, .hud-reticle::after {
          position: absolute;
          top: 50%;
          left: 50%;
          content: "";
          background: #0f0f0f;
          transform: translate(-50%, -50%);
        }
        .hud-reticle::before { width: 19px; height: 1px; }
        .hud-reticle::after { width: 1px; height: 19px; }
        .hud-reticle.top-left { top: 0; left: 0; }
        .hud-reticle.top-right { top: 0; left: 100%; }
        .hud-reticle.bottom-left { top: 100%; left: 0; }
        .hud-reticle.bottom-right { top: 100%; left: 100%; }
        .hud-final-grade {
          position: absolute;
          top: 50%;
          left: 50%;
          z-index: 3;
          padding: 0 7px;
          background: white;
          color: #0f0f0f;
          font-family: Impact, "Arial Narrow", sans-serif;
          font-size: clamp(38px, 5vw, 72px);
          line-height: 0.9;
          transform: translate(-50%, -50%);
        }
        .hud-subgrade {
          position: absolute;
          z-index: 4;
          display: grid !important;
          width: clamp(32px, 3.8vw, 46px) !important;
          aspect-ratio: 1;
          place-items: center;
          border: 1.3px solid #0f0f0f;
          border-radius: 50%;
          background: white;
          transform: translate(-50%, -50%);
        }
        .label-composer .hud-subgrade input {
          width: 100%;
          height: 100%;
          padding: 0;
          border: 0;
          font-family: Impact, "Arial Narrow", sans-serif;
          font-size: clamp(18px, 1.9vw, 27px);
          line-height: 1;
          font-weight: 400;
        }
        .label-composer .hud-subgrade input::-webkit-inner-spin-button,
        .label-composer .hud-subgrade input::-webkit-outer-spin-button { margin: 0; appearance: none; }
        .label-composer .hud-subgrade input { appearance: textfield; }
        .hud-subgrade.top { top: 5%; left: 50%; }
        .hud-subgrade.left { top: 50%; left: 5%; }
        .hud-subgrade.right { top: 50%; left: 95%; }
        .hud-subgrade.bottom { top: 95%; left: 50%; }
        .certificate-preview { text-align: center; font-family: Arial, sans-serif; font-size: clamp(9px, 1.4vw, 19px); letter-spacing: 0.04em; white-space: nowrap; }
        .field-errors { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; color: #ff9f9f; font-size: 12px; }
        .field-errors span { padding: 6px 9px; border-radius: 6px; background: #321515; }
        .form-actions { justify-content: flex-end; margin-top: 18px; }
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
          .label-composer { min-height: 280px; }
        }
        @media (max-width: 680px) {
          .human-grade-page { padding: 28px 14px 60px; }
          .page-header, .composer-heading, .preview-heading { align-items: flex-start; flex-direction: column; }
          .header-actions, .print-actions { width: 100%; }
          .header-actions > *, .print-actions > * { flex: 1; text-align: center; }
          .summary-row { grid-template-columns: repeat(3, 1fr); }
          .summary-row > button { grid-column: 1 / -1; justify-self: stretch; }
          .label-composer { aspect-ratio: auto; grid-template-columns: 1fr; min-height: 0; }
          .brand-third { min-height: 130px; border-right: 0; border-bottom: 2px solid #0f0f0f; }
          .brand-third img { width: 110px; }
          .identity-third { min-height: 250px; border-right: 0; border-bottom: 2px solid #0f0f0f; }
          .grade-third { min-height: 230px; }
          .primary-field input, .grade-field output { font-size: 44px; }
          .metadata-fields input, .descriptor-fields input, .card-number-field input { font-size: 14px; }
          .certificate-preview { font-size: 15px; }
          .grade-hud { width: 170px; }
          .label-composer .hud-subgrade input { font-size: 23px; }
          .page-buttons, .slot-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </AppShell>
  );
}
