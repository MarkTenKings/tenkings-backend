import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { buildEbaySoldUrlFromText, type CardAttributes } from "@tenkings/shared";
import AppShell from "../../../components/AppShell";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../../constants/admin";
import { useSession } from "../../../hooks/useSession";
import { buildAdminHeaders } from "../../../lib/adminHeaders";

type CardNote = {
  id: string;
  authorId: string;
  authorName: string | null;
  body: string;
  createdAt: string;
};

type CardDetail = {
  id: string;
  batchId: string;
  status: string;
  fileName: string;
  fileSize: number;
  imageUrl: string;
  thumbnailUrl: string | null;
  mimeType: string;
  ocrText: string | null;
  classification: CardAttributes | null;
  customTitle: string | null;
  customDetails: string | null;
  valuationMinor: number | null;
  valuationCurrency: string | null;
  valuationSource: string | null;
  marketplaceUrl: string | null;
  ebaySoldUrl: string | null;
  ebaySoldUrlVariant: string | null;
  ebaySoldUrlHighGrade: string | null;
  ebaySoldUrlPlayerComp: string | null;
  assignedDefinitionId: string | null;
  assignedAt: string | null;
  notes: CardNote[];
  createdAt: string;
  updatedAt: string;
  humanReviewedAt: string | null;
  humanReviewerName: string | null;
};

type CardFormState = {
  customTitle: string;
  customDetails: string;
  ocrText: string;
  valuation: string;
  valuationCurrency: string;
  valuationSource: string;
  marketplaceUrl: string;
  ebaySoldUrl: string;
  humanReviewed: boolean;
};

export default function AdminCardDetail() {
  const router = useRouter();
  const { session, loading, ensureSession, logout } = useSession();
  const [card, setCard] = useState<CardDetail | null>(null);
  const [form, setForm] = useState<CardFormState | null>(null);
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const comparables = useMemo(() => {
    if (!card) {
      return [] as Array<{ label: string; href: string }>;
    }
    return [
      card.ebaySoldUrl ? { label: "Exact match", href: card.ebaySoldUrl } : null,
      card.ebaySoldUrlVariant ? { label: "Variant search", href: card.ebaySoldUrlVariant } : null,
      card.ebaySoldUrlHighGrade ? { label: "High grade comps", href: card.ebaySoldUrlHighGrade } : null,
      card.ebaySoldUrlPlayerComp ? { label: "Player comps", href: card.ebaySoldUrlPlayerComp } : null,
    ].filter((link): link is { label: string; href: string } => Boolean(link));
  }, [card]);

  const humanReviewSummary = useMemo(() => {
    if (!card?.humanReviewedAt) {
      return null;
    }
    const reviewedAt = new Date(card.humanReviewedAt).toLocaleString();
    return card.humanReviewerName ? `${reviewedAt} · ${card.humanReviewerName}` : reviewedAt;
  }, [card]);

  const attributeEntries = useMemo(() => {
    const attributes = card?.classification;
    if (!attributes) {
      return [] as Array<{ label: string; value: string }>;
    }

    const entries: Array<{ label: string; value: string }> = [];

    if (attributes.playerName) {
      entries.push({ label: "Player", value: attributes.playerName });
    }
    if (attributes.teamName) {
      entries.push({ label: "Team", value: attributes.teamName });
    }
    if (attributes.year) {
      entries.push({ label: "Year", value: attributes.year });
    }
    if (attributes.brand) {
      entries.push({ label: "Brand", value: attributes.brand });
    }
    if (attributes.setName) {
      entries.push({ label: "Set", value: attributes.setName });
    }
    if (attributes.variantKeywords.length > 0) {
      entries.push({ label: "Variants", value: attributes.variantKeywords.join(", ") });
    }
    if (attributes.serialNumber) {
      entries.push({ label: "Serial", value: attributes.serialNumber });
    }
    if (attributes.gradeValue) {
      const gradeLabel = attributes.gradeCompany
        ? `${attributes.gradeCompany} ${attributes.gradeValue}`
        : attributes.gradeValue;
      entries.push({ label: "Grade", value: gradeLabel });
    }
    entries.push({ label: "Rookie", value: attributes.rookie ? "Yes" : "No" });
    entries.push({ label: "Autograph", value: attributes.autograph ? "Yes" : "No" });
    entries.push({ label: "Memorabilia", value: attributes.memorabilia ? "Yes" : "No" });

    return entries.filter((entry) => entry.value.trim().length > 0);
  }, [card?.classification]);

  const isAdmin = useMemo(
    () => hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone),
    [session?.user.id, session?.user.phone]
  );

  const missingConfig =
    typeof window !== "undefined" &&
    process.env.NEXT_PUBLIC_ADMIN_USER_IDS === undefined &&
    process.env.NEXT_PUBLIC_ADMIN_PHONES === undefined;

  useEffect(() => {
    if (!router.isReady) {
      return;
    }
    const cardId = router.query.cardId;
    if (typeof cardId !== "string" || !session?.token || !isAdmin) {
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const load = async () => {
      setFetching(true);
      setError(null);
      try {
        const res = await fetch(`/api/admin/cards/${cardId}`, {
          headers: buildAdminHeaders(session.token),
          signal: controller.signal,
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload?.message ?? "Failed to load card");
        }
        const data = (await res.json()) as CardDetail;
        if (!cancelled) {
          setCard(data);
          setForm({
            customTitle: data.customTitle ?? "",
            customDetails: data.customDetails ?? "",
            ocrText: data.ocrText ?? "",
            valuation: data.valuationMinor !== null ? (data.valuationMinor / 100).toFixed(2) : "",
            valuationCurrency: data.valuationCurrency ?? "USD",
            valuationSource: data.valuationSource ?? "",
            marketplaceUrl: data.marketplaceUrl ?? "",
            ebaySoldUrl: data.ebaySoldUrl ?? "",
            humanReviewed: data.humanReviewedAt !== null,
          });
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : "Failed to load card";
          setError(message);
        }
      } finally {
        if (!cancelled) {
          setFetching(false);
        }
      }
    };

    load();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [router.isReady, router.query.cardId, session?.token, isAdmin]);

  const renderGate = () => {
    if (loading) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <p className="text-sm uppercase tracking-[0.35em] text-slate-400">Checking access…</p>
        </div>
      );
    }

    if (!session) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
          <p className="text-sm uppercase tracking-[0.32em] text-slate-400">Admin Access Only</p>
          <h1 className="font-heading text-4xl uppercase tracking-[0.18em] text-white">Sign in to continue</h1>
          <p className="max-w-md text-sm text-slate-400">
            Use your Ten Kings phone number. Only approved operators can enter the processing console.
          </p>
          <button
            type="button"
            onClick={() => ensureSession().catch(() => undefined)}
            className="rounded-full border border-gold-500/60 bg-gold-500 px-8 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-night-900 shadow-glow transition hover:bg-gold-400"
          >
            Sign In
          </button>
          {missingConfig && (
            <p className="mt-6 max-w-md text-xs text-rose-300/80">
              Set <code className="font-mono">NEXT_PUBLIC_ADMIN_USER_IDS</code> or <code className="font-mono">NEXT_PUBLIC_ADMIN_PHONES</code> to authorize operators.
            </p>
          )}
        </div>
      );
    }

    if (!isAdmin) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
          <p className="text-sm uppercase tracking-[0.32em] text-rose-300">Access Denied</p>
          <h1 className="font-heading text-4xl uppercase tracking-[0.18em] text-white">You do not have admin rights</h1>
          <p className="max-w-md text-sm text-slate-400">
            This console is restricted to Ten Kings operators. Contact an administrator if you need elevated permissions.
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
      <AppShell>
        <Head>
          <title>Ten Kings · Card Detail</title>
          <meta name="robots" content="noindex" />
        </Head>
        {gate}
      </AppShell>
    );
  }

  const handleChange = (field: keyof CardFormState) => (event: FormEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (!form) return;
    setForm({ ...form, [field]: event.currentTarget.value });
  };

  const handleCheckboxChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (!form) {
      return;
    }
    setForm({ ...form, humanReviewed: event.currentTarget.checked });
  };

  const handleGenerateEbayUrl = () => {
    if (!form) return;
    const generated = buildEbaySoldUrlFromText(form.ocrText);
    setForm({ ...form, ebaySoldUrl: generated ?? "" });
    setMessage(generated ? "Generated eBay sold URL" : "Unable to generate eBay URL from OCR text");
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form || !card || !session?.token) {
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);

    let valuationMinor: number | null = null;
    if (form.valuation.trim().length > 0) {
      const parsed = Number.parseFloat(form.valuation);
      if (!Number.isFinite(parsed)) {
        setSaving(false);
        setError("Valuation must be a number (e.g. 125.00)");
        return;
      }
      valuationMinor = Math.round(parsed * 100);
    }

    const payload = {
      customTitle: form.customTitle.trim() || null,
      customDetails: form.customDetails.trim() || null,
      ocrText: form.ocrText.trim() || null,
      valuationMinor,
      valuationCurrency: form.valuationCurrency.trim() || null,
      valuationSource: form.valuationSource.trim() || null,
      marketplaceUrl: form.marketplaceUrl.trim() || null,
      ebaySoldUrl: form.ebaySoldUrl.trim() || null,
      humanReviewed: form.humanReviewed,
    };

    try {
      const res = await fetch(`/api/admin/cards/${card.id}`, {
        method: "PATCH",
        headers: buildAdminHeaders(session.token, { "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.message ?? "Failed to update card");
      }
      const updated = (await res.json()) as CardDetail;
      setCard(updated);
      setForm({
        customTitle: updated.customTitle ?? "",
        customDetails: updated.customDetails ?? "",
        ocrText: updated.ocrText ?? "",
        valuation: updated.valuationMinor !== null ? (updated.valuationMinor / 100).toFixed(2) : "",
        valuationCurrency: updated.valuationCurrency ?? "USD",
        valuationSource: updated.valuationSource ?? "",
        marketplaceUrl: updated.marketplaceUrl ?? "",
        ebaySoldUrl: updated.ebaySoldUrl ?? "",
        humanReviewed: updated.humanReviewedAt !== null,
      });
      setMessage("Card details saved");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update card";
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell>
      <Head>
        <title>Ten Kings · Card Detail</title>
        <meta name="robots" content="noindex" />
      </Head>

      <div className="flex flex-1 flex-col gap-8 px-6 py-12">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.32em] text-violet-300">Processing Console</p>
            <h1 className="font-heading text-4xl uppercase tracking-[0.18em] text-white">Card Detail</h1>
          </div>
          <div className="flex items-center gap-4 text-xs uppercase tracking-[0.28em] text-slate-400">
            <Link className="transition hover:text-white" href="/admin/uploads">
              ← Back to uploads
            </Link>
            <Link className="transition hover:text-white" href={`/admin/batches/${card?.batchId ?? ""}`}>
              ← Back to batch
            </Link>
          </div>
        </div>

        {fetching && <p className="text-sm text-slate-400">Loading card…</p>}
        {error && <p className="text-sm text-rose-300">{error}</p>}
        {message && <p className="text-sm text-emerald-300">{message}</p>}

        {card && form && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-night-900/70 p-6">
              <h2 className="font-heading text-xl uppercase tracking-[0.18em] text-white">Edit Details</h2>

              <label className="flex flex-col gap-2 text-xs text-slate-300">
                <span className="text-[11px] uppercase tracking-[0.3em] text-slate-400">Display Title</span>
                <input
                  value={form.customTitle}
                  onChange={handleChange("customTitle")}
                  placeholder="e.g. 2024 Select Neon Orange Braelon Allen PSA 8"
                  className="rounded-2xl border border-white/10 bg-night-800 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-400/60"
                />
              </label>

              <label className="flex flex-col gap-2 text-xs text-slate-300">
                <span className="text-[11px] uppercase tracking-[0.3em] text-slate-400">Manual Notes</span>
                <textarea
                  value={form.customDetails}
                  onChange={handleChange("customDetails")}
                  rows={4}
                  placeholder="Add important details, variants, or corrections"
                  className="rounded-2xl border border-white/10 bg-night-800 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-400/60"
                />
              </label>

              <label className="flex flex-col gap-2 text-xs text-slate-300">
                <span className="text-[11px] uppercase tracking-[0.3em] text-slate-400">OCR Text</span>
                <textarea
                  value={form.ocrText}
                  onChange={handleChange("ocrText")}
                  rows={4}
                  className="rounded-2xl border border-white/10 bg-night-800 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-400/60"
                />
              </label>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="flex flex-col gap-2 text-xs text-slate-300">
                  <span className="text-[11px] uppercase tracking-[0.3em] text-slate-400">Appraised Value</span>
                  <input
                    value={form.valuation}
                    onChange={handleChange("valuation")}
                    placeholder="e.g. 125.00"
                    className="rounded-2xl border border-white/10 bg-night-800 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-400/60"
                  />
                </label>
                <label className="flex flex-col gap-2 text-xs text-slate-300">
                  <span className="text-[11px] uppercase tracking-[0.3em] text-slate-400">Currency</span>
                  <input
                    value={form.valuationCurrency}
                    onChange={handleChange("valuationCurrency")}
                    className="rounded-2xl border border-white/10 bg-night-800 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-400/60"
                  />
                </label>
              </div>

              <label className="flex flex-col gap-2 text-xs text-slate-300">
                <span className="text-[11px] uppercase tracking-[0.3em] text-slate-400">Valuation Source</span>
                <input
                  value={form.valuationSource}
                  onChange={handleChange("valuationSource")}
                  placeholder="e.g. Manual review"
                  className="rounded-2xl border border-white/10 bg-night-800 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-400/60"
                />
              </label>

              <label className="flex flex-col gap-2 text-xs text-slate-300">
                <span className="text-[11px] uppercase tracking-[0.3em] text-slate-400">Marketplace URL</span>
                <input
                  value={form.marketplaceUrl}
                  onChange={handleChange("marketplaceUrl")}
                  placeholder="Link to comp or marketplace listing"
                  className="rounded-2xl border border-white/10 bg-night-800 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-400/60"
                />
              </label>

              <div className="flex flex-col gap-2 text-xs text-slate-300">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-[0.3em] text-slate-400">eBay Sold URL</span>
                  <button
                    type="button"
                    onClick={handleGenerateEbayUrl}
                    className="rounded-full border border-sky-400/40 px-4 py-1 text-[11px] uppercase tracking-[0.28em] text-sky-300 transition hover:border-sky-400 hover:text-sky-200"
                  >
                    Generate from OCR
                  </button>
                </div>
                <input
                  value={form.ebaySoldUrl}
                  onChange={handleChange("ebaySoldUrl")}
                  placeholder="https://www.ebay.com/sch/..."
                  className="rounded-2xl border border-white/10 bg-night-800 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-400/60"
                />
              </div>

              {comparables.length > 0 && (
                <div className="rounded-3xl border border-white/10 bg-night-900/60 p-4">
                  <p className="text-[11px] uppercase tracking-[0.3em] text-sky-300">eBay Sold Comparables</p>
                  <p className="mt-1 text-[11px] text-slate-400">
                    Generated from OCR attributes. Use these quick links when you need broader comps.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {comparables.map(({ label, href }) => (
                      <Link
                        key={`${card.id}-${label}`}
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center rounded-full border border-sky-400/40 px-4 py-1 text-[11px] uppercase tracking-[0.28em] text-sky-300 transition hover:border-sky-300 hover:text-sky-200"
                      >
                        {label}
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              <label className="mt-2 flex items-center gap-3 text-xs text-slate-300">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-emerald-400"
                  checked={form.humanReviewed}
                  onChange={handleCheckboxChange}
                />
                <span className="text-[11px] uppercase tracking-[0.3em] text-slate-400">Mark as human reviewed</span>
              </label>
              {humanReviewSummary && (
                <p className="text-[10px] uppercase tracking-[0.25em] text-emerald-200">
                  Current review: {humanReviewSummary}
                </p>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-full border border-emerald-400/40 bg-emerald-500/20 px-6 py-2 text-[11px] uppercase tracking-[0.3em] text-emerald-200 transition hover:border-emerald-300 hover:text-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save Changes"}
                </button>
              </div>
            </form>

            <div className="flex flex-col gap-4">
              <div className="rounded-3xl border border-white/10 bg-night-900/70 p-6">
                <p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">Card Preview</p>
                <div className="mt-3 aspect-[4/5] overflow-hidden rounded-2xl border border-white/10 bg-night-800">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={card.thumbnailUrl ?? card.imageUrl}
                    alt={card.fileName}
                    className="h-full w-full object-cover"
                  />
                </div>
                {humanReviewSummary ? (
                  <div className="mt-3 inline-flex flex-wrap items-center gap-2 rounded-full bg-emerald-500/15 px-3 py-1 text-[10px] uppercase tracking-[0.25em] text-emerald-200">
                    <span>Human reviewed</span>
                    <span className="text-[9px] uppercase tracking-[0.2em] text-emerald-100/80">{humanReviewSummary}</span>
                  </div>
                ) : form.humanReviewed ? (
                  <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1 text-[10px] uppercase tracking-[0.25em] text-emerald-200">
                    <span>Human review will be recorded on save</span>
                  </div>
                ) : null}
                <p className="mt-3 text-xs text-slate-400">{card.fileName}</p>
                <p className="text-xs text-slate-400">{(card.fileSize / 1024).toFixed(0)} KB · {card.mimeType}</p>
                {card.assignedDefinitionId && (
                  <p className="text-xs uppercase tracking-[0.25em] text-emerald-300">
                    Assigned to pack {card.assignedDefinitionId}
                  </p>
                )}

                {comparables.length > 0 && (
                  <div className="mt-4 rounded-2xl border border-white/5 bg-night-900/60 p-4">
                    <p className="text-[11px] uppercase tracking-[0.3em] text-sky-300">Quick eBay Links</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {comparables.map(({ label, href }) => (
                        <Link
                          key={`${card.id}-preview-${label}`}
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center rounded-full border border-sky-400/40 px-3 py-1 text-[10px] uppercase tracking-[0.3em] text-sky-300 transition hover:border-sky-300 hover:text-sky-200"
                        >
                          {label}
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {attributeEntries.length > 0 && (
                <div className="rounded-3xl border border-white/10 bg-night-900/70 p-6">
                  <p className="text-[11px] uppercase tracking-[0.3em] text-amber-300">Detected Attributes</p>
                  <dl className="mt-3 grid grid-cols-1 gap-2 text-xs text-slate-200">
                    {attributeEntries.map((entry) => (
                      <div key={entry.label} className="flex justify-between gap-4">
                        <dt className="uppercase tracking-[0.25em] text-slate-500">{entry.label}</dt>
                        <dd className="text-right text-slate-200">{entry.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}

              {card.notes.length > 0 && (
                <div className="rounded-3xl border border-white/10 bg-night-900/70 p-6">
                  <p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">Notes</p>
                  <ul className="mt-3 flex flex-col gap-3 text-xs text-slate-200">
                    {card.notes.map((note) => (
                      <li key={note.id} className="rounded-2xl border border-white/5 bg-night-900/60 p-3">
                        <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
                          {note.authorName ?? note.authorId} · {new Date(note.createdAt).toLocaleString()}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-slate-200">{note.body}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
