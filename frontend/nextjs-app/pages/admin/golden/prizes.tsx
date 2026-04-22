import Head from "next/head";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import AppShell from "../../../components/AppShell";
import {
  ADMIN_PAGE_FRAME_CLASS,
  AdminPageHeader,
  adminInputClass,
  adminPanelClass,
  adminSelectClass,
  adminStatCardClass,
  adminSubpanelClass,
  adminTextareaClass,
} from "../../../components/admin/AdminPrimitives";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../../constants/admin";
import { useSession } from "../../../hooks/useSession";
import { buildAdminHeaders } from "../../../lib/adminHeaders";
import { CATEGORY_OPTIONS, formatCategoryLabel, type CollectibleCategoryValue } from "../../../lib/adminInventory";
import { formatUsdMinor } from "../../../lib/formatters";

type GoldenTicketStatus = "MINTED" | "PLACED" | "SCANNED" | "CLAIMED" | "FULFILLED" | "EXPIRED";

type UploadedAsset = {
  url: string;
  storageKey: string;
  contentType: string;
  size: number;
  kind: "video" | "thumbnail";
  fileName: string;
};

type GoldenPrizeSummary = {
  prizeGroupId: string;
  title: string;
  description: string | null;
  category: CollectibleCategoryValue | null;
  estimatedValue: number | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  photoGallery: string[];
  requiresSize: boolean;
  sizeOptions: string[];
  revealVideoAssetUrl: string | null;
  revealVideoPoster: string | null;
  ticketCount: number;
  statusBreakdown: Record<GoldenTicketStatus, number>;
  createdAt: string;
  updatedAt: string;
  tickets: Array<{
    id: string;
    ticketNumber: number;
    ticketLabel: string;
    code: string;
    claimUrl: string;
    status: GoldenTicketStatus;
    createdAt: string;
    claimedAt: string | null;
    pdfPath: string;
    pdfFileName: string;
  }>;
};

type PrizeStats = {
  prizeCount: number;
  ticketCount: number;
  mintedCount: number;
  claimedCount: number;
};

type Notice = {
  tone: "success" | "error";
  message: string;
};

type PrizeFormState = {
  title: string;
  description: string;
  estimatedValueUsd: string;
  category: CollectibleCategoryValue;
  requiresSize: boolean;
  sizeOptionsText: string;
  ticketCount: number;
  photoAssets: UploadedAsset[];
  revealVideoAsset: UploadedAsset | null;
  revealVideoPoster: UploadedAsset | null;
};

const GOLDEN_TICKET_STATUS_ORDER: GoldenTicketStatus[] = ["MINTED", "PLACED", "SCANNED", "CLAIMED", "FULFILLED", "EXPIRED"];

const STATUS_TONE_CLASS: Record<GoldenTicketStatus, string> = {
  MINTED: "border-emerald-400/30 bg-emerald-500/10 text-emerald-100",
  PLACED: "border-sky-400/30 bg-sky-500/10 text-sky-100",
  SCANNED: "border-amber-400/30 bg-amber-500/10 text-amber-100",
  CLAIMED: "border-gold-400/35 bg-gold-500/10 text-gold-100",
  FULFILLED: "border-fuchsia-400/30 bg-fuchsia-500/10 text-fuchsia-100",
  EXPIRED: "border-rose-400/30 bg-rose-500/10 text-rose-100",
};

const EMPTY_FORM: PrizeFormState = {
  title: "",
  description: "",
  estimatedValueUsd: "",
  category: "GOLDEN_TICKET_PRIZE",
  requiresSize: false,
  sizeOptionsText: "",
  ticketCount: 1,
  photoAssets: [],
  revealVideoAsset: null,
  revealVideoPoster: null,
};

function parseUsdToMinor(value: string) {
  const normalized = value.replace(/[^0-9.]/g, "").trim();
  if (!normalized) {
    throw new Error("Estimated value is required.");
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("Estimated value must be a valid dollar amount.");
  }
  return Math.round(parsed * 100);
}

function parseSizeOptions(value: string) {
  return [...new Set(value.split(/[\n,]/).map((entry) => entry.trim()).filter(Boolean))];
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "—";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

function readFileNameFromDisposition(headerValue: string | null, fallback: string) {
  if (!headerValue) {
    return fallback;
  }
  const match = headerValue.match(/filename="?([^"]+)"?/i);
  return match?.[1] ?? fallback;
}

function PrizeMediaGrid({ assets }: { assets: UploadedAsset[] }) {
  if (assets.length === 0) {
    return <p className="text-xs text-slate-500">No photos uploaded yet.</p>;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {assets.map((asset, index) => (
        <div key={`${asset.storageKey}-${index}`} className={adminSubpanelClass("overflow-hidden")}>
          <div className="relative aspect-[4/3] bg-black">
            <Image src={asset.url} alt="" fill sizes="(min-width: 1280px) 18vw, (min-width: 640px) 36vw, 90vw" className="object-cover" />
          </div>
          <div className="space-y-1 px-3 py-3">
            <p className="truncate text-xs font-medium text-white">{asset.fileName}</p>
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{index === 0 ? "Primary photo" : "Gallery photo"}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function GoldenPrizeAdminPage() {
  const { session, loading, ensureSession, logout } = useSession();
  const [prizes, setPrizes] = useState<GoldenPrizeSummary[]>([]);
  const [stats, setStats] = useState<PrizeStats>({
    prizeCount: 0,
    ticketCount: 0,
    mintedCount: 0,
    claimedCount: 0,
  });
  const [pageLoading, setPageLoading] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<PrizeFormState>(EMPTY_FORM);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [uploadingPoster, setUploadingPoster] = useState(false);
  const [downloadingTicketId, setDownloadingTicketId] = useState<string | null>(null);

  const isAdmin = useMemo(
    () => hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone),
    [session?.user.id, session?.user.phone]
  );
  const adminHeaders = useMemo(() => buildAdminHeaders(session?.token), [session?.token]);

  const loadPrizes = useCallback(async () => {
    if (!session?.token || !isAdmin) {
      return;
    }

    setPageLoading(true);
    setPageError(null);

    try {
      const response = await fetch("/api/admin/golden/prizes", {
        headers: adminHeaders,
      });
      const payload = (await response.json()) as { prizes?: GoldenPrizeSummary[]; stats?: PrizeStats; message?: string };
      if (!response.ok || !payload.prizes || !payload.stats) {
        throw new Error(payload.message ?? "Failed to load Golden Ticket prizes.");
      }
      setPrizes(payload.prizes);
      setStats(payload.stats);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Failed to load Golden Ticket prizes.");
    } finally {
      setPageLoading(false);
    }
  }, [adminHeaders, isAdmin, session?.token]);

  useEffect(() => {
    void loadPrizes();
  }, [loadPrizes]);

  const uploadMediaFile = useCallback(
    async (file: File, kind: "video" | "thumbnail") => {
      let activeSession = session;
      if (!activeSession) {
        activeSession = await ensureSession();
      }

      const params = new URLSearchParams({
        kind,
        fileName: file.name,
      });
      if (file.type) {
        params.set("contentType", file.type);
      }

      const headers = new Headers();
      headers.set("Authorization", `Bearer ${activeSession.token}`);
      headers.set("Content-Type", file.type || "application/octet-stream");

      const response = await fetch(`/api/admin/live-rips/upload?${params.toString()}`, {
        method: "PUT",
        headers,
        body: file,
      });

      const payload = (await response.json().catch(() => ({}))) as {
        url?: string;
        storageKey?: string;
        contentType?: string;
        size?: number;
        kind?: "video" | "thumbnail";
        message?: string;
      };

      if (!response.ok || !payload.url || !payload.storageKey || !payload.contentType || typeof payload.size !== "number" || !payload.kind) {
        throw new Error(payload.message ?? "Upload failed");
      }

      return {
        url: payload.url,
        storageKey: payload.storageKey,
        contentType: payload.contentType,
        size: payload.size,
        kind: payload.kind,
        fileName: file.name,
      } satisfies UploadedAsset;
    },
    [ensureSession, session]
  );

  const handlePhotoUpload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.currentTarget.files ?? []);
      event.currentTarget.value = "";
      if (files.length === 0) {
        return;
      }

      setUploadingPhotos(true);
      setCreateError(null);

      try {
        const uploaded: UploadedAsset[] = [];
        for (const file of files) {
          if (!file.type.startsWith("image/")) {
            throw new Error(`${file.name} is not an image.`);
          }
          uploaded.push(await uploadMediaFile(file, "thumbnail"));
        }
        setForm((current) => ({
          ...current,
          photoAssets: [...current.photoAssets, ...uploaded],
        }));
      } catch (error) {
        setCreateError(error instanceof Error ? error.message : "Failed to upload photo assets.");
      } finally {
        setUploadingPhotos(false);
      }
    },
    [uploadMediaFile]
  );

  const handleRevealVideoUpload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0] ?? null;
      event.currentTarget.value = "";
      if (!file) {
        return;
      }

      setUploadingVideo(true);
      setCreateError(null);

      try {
        if (!file.type.startsWith("video/")) {
          throw new Error("Reveal asset must be a video file.");
        }
        if (file.size > 100 * 1024 * 1024) {
          throw new Error("Reveal video must be 100MB or smaller.");
        }
        const uploaded = await uploadMediaFile(file, "video");
        setForm((current) => ({ ...current, revealVideoAsset: uploaded }));
      } catch (error) {
        setCreateError(error instanceof Error ? error.message : "Failed to upload reveal video.");
      } finally {
        setUploadingVideo(false);
      }
    },
    [uploadMediaFile]
  );

  const handleRevealPosterUpload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0] ?? null;
      event.currentTarget.value = "";
      if (!file) {
        return;
      }

      setUploadingPoster(true);
      setCreateError(null);

      try {
        if (!file.type.startsWith("image/")) {
          throw new Error("Reveal poster must be an image file.");
        }
        const uploaded = await uploadMediaFile(file, "thumbnail");
        setForm((current) => ({ ...current, revealVideoPoster: uploaded }));
      } catch (error) {
        setCreateError(error instanceof Error ? error.message : "Failed to upload reveal poster.");
      } finally {
        setUploadingPoster(false);
      }
    },
    [uploadMediaFile]
  );

  const resetModal = useCallback(() => {
    setForm(EMPTY_FORM);
    setCreateError(null);
    setCreateBusy(false);
    setUploadingPhotos(false);
    setUploadingVideo(false);
    setUploadingPoster(false);
  }, []);

  const closeModal = useCallback(() => {
    setModalOpen(false);
    resetModal();
  }, [resetModal]);

  const handleCreatePrize = useCallback(async () => {
    setCreateBusy(true);
    setCreateError(null);
    setNotice(null);

    try {
      if (form.photoAssets.length === 0) {
        throw new Error("Upload at least one prize photo.");
      }
      if (!form.revealVideoAsset) {
        throw new Error("Upload the reveal video before minting tickets.");
      }

      const estimatedValueMinor = parseUsdToMinor(form.estimatedValueUsd);
      const sizeOptions = parseSizeOptions(form.sizeOptionsText);

      const response = await fetch("/api/admin/golden/prizes", {
        method: "POST",
        headers: {
          ...adminHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: form.title.trim(),
          description: form.description.trim(),
          photoUrls: form.photoAssets.map((asset) => asset.url),
          estimatedValueMinor,
          category: form.category,
          requiresSize: form.requiresSize,
          sizeOptions,
          revealVideoAssetUrl: form.revealVideoAsset.url,
          revealVideoPoster: form.revealVideoPoster?.url ?? "",
          ticketCount: form.ticketCount,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        prize?: GoldenPrizeSummary;
        message?: string;
      };

      if (!response.ok || !payload.prize) {
        throw new Error(payload.message ?? "Failed to create Golden Ticket prize.");
      }

      await loadPrizes();
      setNotice({
        tone: "success",
        message: payload.message ?? `Created ${payload.prize.ticketCount} Golden Ticket(s).`,
      });
      closeModal();
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Failed to create Golden Ticket prize.");
    } finally {
      setCreateBusy(false);
    }
  }, [adminHeaders, closeModal, form, loadPrizes]);

  const handleDownloadPdf = useCallback(
    async (ticket: GoldenPrizeSummary["tickets"][number]) => {
      setDownloadingTicketId(ticket.id);
      setNotice(null);

      try {
        const response = await fetch(ticket.pdfPath, {
          headers: adminHeaders,
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { message?: string };
          throw new Error(payload.message ?? "Failed to download ticket PDF.");
        }
        const blob = await response.blob();
        const fileName = readFileNameFromDisposition(response.headers.get("Content-Disposition"), ticket.pdfFileName);
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = fileName;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(objectUrl);
      } catch (error) {
        setNotice({
          tone: "error",
          message: error instanceof Error ? error.message : "Failed to download ticket PDF.",
        });
      } finally {
        setDownloadingTicketId(null);
      }
    },
    [adminHeaders]
  );

  const gate = (() => {
    if (loading) {
      return (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm uppercase tracking-[0.32em] text-slate-500">Checking access...</p>
        </div>
      );
    }

    if (!session) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
          <p className="text-sm uppercase tracking-[0.32em] text-slate-400">Admin Access Only</p>
          <h1 className="font-heading text-4xl uppercase tracking-[0.18em] text-white">Sign in to continue</h1>
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

    if (!isAdmin) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
          <p className="text-sm uppercase tracking-[0.32em] text-rose-300">Access Denied</p>
          <h1 className="font-heading text-4xl uppercase tracking-[0.18em] text-white">You do not have admin rights</h1>
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
  })();

  if (gate) {
    return (
      <AppShell background="black" brandVariant="collectibles">
        <Head>
          <title>Ten Kings · Golden Ticket Prizes</title>
          <meta name="robots" content="noindex" />
        </Head>
        {gate}
      </AppShell>
    );
  }

  return (
    <AppShell background="black" brandVariant="collectibles">
      <Head>
        <title>Ten Kings · Golden Ticket Prizes</title>
        <meta name="robots" content="noindex" />
      </Head>

      <div className={ADMIN_PAGE_FRAME_CLASS}>
        <AdminPageHeader
          backHref="/admin"
          backLabel="← Admin Home"
          eyebrow="Golden Ticket"
          title="Prize Minting"
          description="Create house-owned Golden Ticket prize items, mint ticket QR codes, and download printable PDFs for packing."
          actions={
            <div className="flex flex-wrap gap-2">
              <Link
                href="/admin/golden/queue"
                className="rounded-full border border-white/15 px-5 py-3 text-[11px] uppercase tracking-[0.22em] text-slate-200 transition hover:border-white/35 hover:text-white"
              >
                Live Queue
              </Link>
              <button
                type="button"
                onClick={() => {
                  resetModal();
                  setModalOpen(true);
                }}
                className="rounded-full border border-gold-400/60 bg-gold-500 px-5 py-3 text-[11px] uppercase tracking-[0.22em] text-night-950 transition hover:bg-gold-400"
              >
                + New Prize
              </button>
            </div>
          }
        />

        {notice ? (
          <section
            className={adminPanelClass(
              notice.tone === "success"
                ? "border-emerald-400/25 bg-emerald-500/10 p-4"
                : "border-rose-400/25 bg-rose-500/10 p-4"
            )}
          >
            <p className={notice.tone === "success" ? "text-sm text-emerald-100" : "text-sm text-rose-200"}>{notice.message}</p>
          </section>
        ) : null}

        {pageError ? (
          <section className={adminPanelClass("border-rose-400/25 bg-rose-500/10 p-4")}>
            <p className="text-sm text-rose-200">{pageError}</p>
          </section>
        ) : null}

        <section className="grid gap-4 xl:grid-cols-4">
          <article className={adminStatCardClass("p-4")}>
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Prize Batches</p>
            <p className="mt-3 text-3xl font-semibold text-white">{stats.prizeCount}</p>
          </article>
          <article className={adminStatCardClass("p-4")}>
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Tickets Minted</p>
            <p className="mt-3 text-3xl font-semibold text-gold-200">{stats.ticketCount}</p>
          </article>
          <article className={adminStatCardClass("p-4")}>
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Still Minted</p>
            <p className="mt-3 text-3xl font-semibold text-emerald-300">{stats.mintedCount}</p>
          </article>
          <article className={adminStatCardClass("p-4")}>
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Claimed</p>
            <p className="mt-3 text-3xl font-semibold text-white">{stats.claimedCount}</p>
          </article>
        </section>

        <section className={adminPanelClass("p-5 md:p-6")}>
          {pageLoading && prizes.length === 0 ? (
            <div className="rounded-[24px] border border-white/10 bg-white/[0.02] px-5 py-16 text-center text-sm text-slate-400">
              Loading Golden Ticket prizes...
            </div>
          ) : prizes.length === 0 ? (
            <div className="rounded-[24px] border border-dashed border-white/12 bg-white/[0.02] px-5 py-16 text-center">
              <h2 className="font-heading text-3xl uppercase tracking-[0.12em] text-white">No Golden Ticket prizes yet</h2>
              <p className="mt-3 text-sm text-slate-400">
                Create the first prize batch to mint Golden Ticket QR codes and printable PDFs.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {prizes.map((prize) => (
                <article key={prize.prizeGroupId} className={adminSubpanelClass("overflow-hidden p-4 md:p-5")}>
                  <div className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
                    <div className="space-y-3">
                      <div className="relative aspect-[4/3] overflow-hidden rounded-[22px] border border-white/10 bg-black">
                        {prize.imageUrl ? (
                          <Image
                            src={prize.imageUrl}
                            alt=""
                            fill
                            sizes="(min-width: 1280px) 280px, 100vw"
                            className="object-cover"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center text-xs uppercase tracking-[0.28em] text-slate-500">No image</div>
                        )}
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className={adminSubpanelClass("px-3 py-3")}>
                          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Estimated Value</p>
                          <p className="mt-2 text-lg font-semibold text-gold-100">{formatUsdMinor(prize.estimatedValue)}</p>
                        </div>
                        <div className={adminSubpanelClass("px-3 py-3")}>
                          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Category</p>
                          <p className="mt-2 text-sm font-medium text-white">{formatCategoryLabel(prize.category)}</p>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="space-y-2">
                          <p className="text-[11px] uppercase tracking-[0.24em] text-gold-200">Prize Batch</p>
                          <h2 className="font-heading text-3xl uppercase tracking-[0.12em] text-white">{prize.title}</h2>
                          <p className="max-w-3xl text-sm text-slate-300">{prize.description || "No prize description recorded."}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <span className="rounded-full border border-white/12 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-slate-300">
                            {prize.ticketCount} ticket{prize.ticketCount === 1 ? "" : "s"}
                          </span>
                          {prize.requiresSize ? (
                            <span className="rounded-full border border-gold-400/30 bg-gold-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-gold-100">
                              Size Required
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {GOLDEN_TICKET_STATUS_ORDER.map((status) => (
                          <span key={status} className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.18em] ${STATUS_TONE_CLASS[status]}`}>
                            {status.replace(/_/g, " ")} · {prize.statusBreakdown[status] ?? 0}
                          </span>
                        ))}
                      </div>

                      <div className="grid gap-3 md:grid-cols-3">
                        <div className={adminSubpanelClass("px-3 py-3")}>
                          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Created</p>
                          <p className="mt-2 text-sm text-white">{formatDateTime(prize.createdAt)}</p>
                        </div>
                        <div className={adminSubpanelClass("px-3 py-3")}>
                          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Reveal Video</p>
                          <p className="mt-2 truncate text-sm text-white">{prize.revealVideoAssetUrl ?? "Missing"}</p>
                        </div>
                        <div className={adminSubpanelClass("px-3 py-3")}>
                          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Sizes</p>
                          <p className="mt-2 text-sm text-white">{prize.requiresSize ? prize.sizeOptions.join(", ") || "Configured later" : "Not required"}</p>
                        </div>
                      </div>

                      {prize.photoGallery.length > 1 ? (
                        <div className="space-y-2">
                          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Photo Gallery</p>
                          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-4">
                            {prize.photoGallery.slice(0, 4).map((url, index) => (
                              <div key={`${url}-${index}`} className="relative aspect-[4/3] overflow-hidden rounded-[18px] border border-white/10 bg-black">
                                <Image src={url} alt="" fill sizes="(min-width: 1280px) 12vw, 28vw" className="object-cover" />
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      <div className="space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Minted Tickets</p>
                          <p className="text-xs text-slate-500">Use the PDF action for print-ready QR sheets.</p>
                        </div>
                        <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
                          {prize.tickets.map((ticket) => (
                            <div key={ticket.id} className={adminSubpanelClass("space-y-3 px-3 py-3")}>
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="font-heading text-xl uppercase tracking-[0.12em] text-white">{ticket.ticketLabel}</p>
                                  <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">{ticket.code}</p>
                                </div>
                                <span className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.18em] ${STATUS_TONE_CLASS[ticket.status]}`}>
                                  {ticket.status.replace(/_/g, " ")}
                                </span>
                              </div>
                              <div className="space-y-1 text-xs text-slate-400">
                                <p>Created: {formatDateTime(ticket.createdAt)}</p>
                                <p>Claimed: {formatDateTime(ticket.claimedAt)}</p>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => void handleDownloadPdf(ticket)}
                                  disabled={downloadingTicketId === ticket.id}
                                  className="rounded-full border border-gold-400/35 bg-gold-500/10 px-3 py-2 text-[11px] uppercase tracking-[0.2em] text-gold-100 transition hover:bg-gold-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {downloadingTicketId === ticket.id ? "Preparing..." : "Download PDF"}
                                </button>
                                <Link
                                  href={ticket.claimUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="rounded-full border border-white/12 px-3 py-2 text-[11px] uppercase tracking-[0.2em] text-slate-200 transition hover:border-white/30 hover:text-white"
                                >
                                  Open Claim URL
                                </Link>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/80 px-4 py-8 backdrop-blur-sm">
          <div className="w-full max-w-5xl rounded-[32px] border border-white/12 bg-night-950 shadow-[0_30px_90px_rgba(0,0,0,0.55)]">
            <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-5 md:px-6">
              <div>
                <p className="text-[11px] uppercase tracking-[0.24em] text-gold-200">Golden Ticket</p>
                <h2 className="mt-2 font-heading text-3xl uppercase tracking-[0.12em] text-white">New Prize Batch</h2>
                <p className="mt-2 max-w-2xl text-sm text-slate-300">
                  Create house-owned prize inventory, mint one ticket QR code per ticket, and store printable PDFs for packing.
                </p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-full border border-white/12 px-4 py-2 text-[11px] uppercase tracking-[0.22em] text-slate-300 transition hover:border-white/30 hover:text-white"
              >
                Close
              </button>
            </div>

            <div className="space-y-6 px-5 py-5 md:px-6 md:py-6">
              {createError ? (
                <section className={adminPanelClass("border-rose-400/25 bg-rose-500/10 p-4")}>
                  <p className="text-sm text-rose-200">{createError}</p>
                </section>
              ) : null}

              <section className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Prize Name</span>
                  <input
                    value={form.title}
                    onChange={(event) => setForm((current) => ({ ...current, title: event.currentTarget.value }))}
                    className={adminInputClass()}
                    placeholder="Signed jersey, VIP trip, slabbed grail..."
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Estimated Value (USD)</span>
                  <input
                    value={form.estimatedValueUsd}
                    onChange={(event) => setForm((current) => ({ ...current, estimatedValueUsd: event.currentTarget.value }))}
                    className={adminInputClass()}
                    inputMode="decimal"
                    placeholder="2500.00"
                  />
                </label>
                <label className="space-y-2 md:col-span-2">
                  <span className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Prize Description</span>
                  <textarea
                    value={form.description}
                    onChange={(event) => setForm((current) => ({ ...current, description: event.currentTarget.value }))}
                    className={adminTextareaClass("min-h-[120px]")}
                    placeholder="Describe the reward, what the winner gets, and any relevant notes."
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Category</span>
                  <select
                    value={form.category}
                    onChange={(event) => setForm((current) => ({ ...current, category: event.currentTarget.value as CollectibleCategoryValue }))}
                    className={adminSelectClass()}
                  >
                    {CATEGORY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-2">
                  <span className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Tickets to Mint</span>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={form.ticketCount}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        ticketCount: Math.max(1, Math.min(100, Number.parseInt(event.currentTarget.value || "1", 10) || 1)),
                      }))
                    }
                    className={adminInputClass()}
                  />
                </label>
              </section>

              <section className={adminSubpanelClass("space-y-4 p-4")}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.22em] text-gold-200">Prize Photos</p>
                    <p className="mt-2 text-sm text-slate-300">Upload one or more prize images. The first image becomes the primary prize photo.</p>
                  </div>
                  <label className="rounded-full border border-white/12 px-4 py-2 text-[11px] uppercase tracking-[0.22em] text-slate-200 transition hover:border-white/30 hover:text-white">
                    <input type="file" accept="image/*" multiple className="hidden" onChange={handlePhotoUpload} disabled={uploadingPhotos || createBusy} />
                    {uploadingPhotos ? "Uploading..." : "Upload Photos"}
                  </label>
                </div>
                <PrizeMediaGrid assets={form.photoAssets} />
              </section>

              <section className="grid gap-4 lg:grid-cols-2">
                <div className={adminSubpanelClass("space-y-4 p-4")}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.22em] text-gold-200">Reveal Video</p>
                      <p className="mt-2 text-sm text-slate-300">Uses the existing live-rip upload pipeline. Keep files at 100MB or below.</p>
                    </div>
                    <label className="rounded-full border border-white/12 px-4 py-2 text-[11px] uppercase tracking-[0.22em] text-slate-200 transition hover:border-white/30 hover:text-white">
                      <input type="file" accept="video/mp4,video/*" className="hidden" onChange={handleRevealVideoUpload} disabled={uploadingVideo || createBusy} />
                      {uploadingVideo ? "Uploading..." : "Upload Video"}
                    </label>
                  </div>
                  <div className={adminSubpanelClass("px-3 py-3")}>
                    <p className="text-xs text-slate-400">{form.revealVideoAsset ? form.revealVideoAsset.fileName : "No reveal video uploaded yet."}</p>
                    {form.revealVideoAsset ? <p className="mt-2 text-[11px] uppercase tracking-[0.18em] text-slate-500">{form.revealVideoAsset.url}</p> : null}
                  </div>
                </div>

                <div className={adminSubpanelClass("space-y-4 p-4")}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.22em] text-gold-200">Reveal Poster</p>
                      <p className="mt-2 text-sm text-slate-300">Optional poster image used alongside the reveal video.</p>
                    </div>
                    <label className="rounded-full border border-white/12 px-4 py-2 text-[11px] uppercase tracking-[0.22em] text-slate-200 transition hover:border-white/30 hover:text-white">
                      <input type="file" accept="image/*" className="hidden" onChange={handleRevealPosterUpload} disabled={uploadingPoster || createBusy} />
                      {uploadingPoster ? "Uploading..." : "Upload Poster"}
                    </label>
                  </div>
                  <div className={adminSubpanelClass("overflow-hidden")}>
                    {form.revealVideoPoster ? (
                      <div className="space-y-3 p-3">
                        <div className="relative aspect-[16/9] overflow-hidden rounded-[16px] border border-white/10 bg-black">
                          <Image src={form.revealVideoPoster.url} alt="" fill sizes="(min-width: 1024px) 26vw, 90vw" className="object-cover" />
                        </div>
                        <p className="truncate text-xs text-slate-300">{form.revealVideoPoster.fileName}</p>
                      </div>
                    ) : (
                      <div className="px-3 py-8 text-center text-xs text-slate-500">No poster uploaded yet.</div>
                    )}
                  </div>
                </div>
              </section>

              <section className={adminSubpanelClass("space-y-4 p-4")}>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.22em] text-gold-200">Size Handling</p>
                    <p className="mt-2 text-sm text-slate-300">Enable this when the prize requires the winner to choose a size during claim.</p>
                  </div>
                  <label className="inline-flex items-center gap-3 text-sm text-white">
                    <input
                      type="checkbox"
                      checked={form.requiresSize}
                      onChange={(event) => setForm((current) => ({ ...current, requiresSize: event.currentTarget.checked }))}
                      className="h-4 w-4 rounded border-white/20 bg-black text-gold-400 focus:ring-gold-400"
                    />
                    Requires size
                  </label>
                </div>
                {form.requiresSize ? (
                  <label className="space-y-2">
                    <span className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Size Options</span>
                    <textarea
                      value={form.sizeOptionsText}
                      onChange={(event) => setForm((current) => ({ ...current, sizeOptionsText: event.currentTarget.value }))}
                      className={adminTextareaClass("min-h-[100px]")}
                      placeholder="S, M, L, XL or one option per line"
                    />
                  </label>
                ) : null}
              </section>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-5">
                <p className="text-xs text-slate-500">
                  Minting creates one house-owned `Item`, one `QrCode`, one `GoldenTicket`, and one printable PDF per ticket.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="rounded-full border border-white/12 px-4 py-3 text-[11px] uppercase tracking-[0.22em] text-slate-300 transition hover:border-white/30 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCreatePrize()}
                    disabled={createBusy || uploadingPhotos || uploadingVideo || uploadingPoster}
                    className="rounded-full border border-gold-400/60 bg-gold-500 px-5 py-3 text-[11px] uppercase tracking-[0.22em] text-night-950 transition hover:bg-gold-400 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {createBusy ? "Minting..." : "Create Prize + Mint Tickets"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
