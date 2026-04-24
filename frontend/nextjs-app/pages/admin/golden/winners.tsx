import Head from "next/head";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { formatUsdMinor } from "../../../lib/formatters";
import type { AdminGoldenTicketWinnerListItem, AdminGoldenTicketWinnerSort } from "../../../lib/server/goldenAdminWinners";

const PAGE_LIMIT = 20;

type WinnersResponse = {
  winners?: AdminGoldenTicketWinnerListItem[];
  pagination?: {
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
    hasMore: boolean;
  };
  stats?: {
    totalCount: number;
    publishedCount: number;
    unpublishedCount: number;
    featuredCount: number;
    photoSubmittedCount: number;
    photoApprovedCount: number;
    photoPendingCount: number;
  };
  message?: string;
};

type UpdateWinnerResponse = {
  winner?: AdminGoldenTicketWinnerListItem;
  message?: string;
};

type Notice = {
  tone: "success" | "error";
  message: string;
};

const EMPTY_PAGINATION = {
  page: 1,
  limit: PAGE_LIMIT,
  totalCount: 0,
  totalPages: 1,
  hasMore: false,
};

const EMPTY_STATS = {
  totalCount: 0,
  publishedCount: 0,
  unpublishedCount: 0,
  featuredCount: 0,
  photoSubmittedCount: 0,
  photoApprovedCount: 0,
  photoPendingCount: 0,
};

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

function formatHandle(handle: string | null) {
  if (!handle) {
    return null;
  }
  return handle.startsWith("@") ? handle : `@${handle}`;
}

function normalizeCaption(value: string) {
  return value.trim();
}

export default function AdminGoldenWinnersPage() {
  const { session, loading, ensureSession, logout } = useSession();
  const [winners, setWinners] = useState<AdminGoldenTicketWinnerListItem[]>([]);
  const [pagination, setPagination] = useState(EMPTY_PAGINATION);
  const [stats, setStats] = useState(EMPTY_STATS);
  const [captionDrafts, setCaptionDrafts] = useState<Record<string, string>>({});
  const [pageLoading, setPageLoading] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<AdminGoldenTicketWinnerSort>("recent");
  const [actionStates, setActionStates] = useState<Record<string, boolean>>({});

  const isAdmin = useMemo(
    () => hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone),
    [session?.user.id, session?.user.phone]
  );
  const adminHeaders = useMemo(() => buildAdminHeaders(session?.token), [session?.token]);

  const syncCaptionDrafts = useCallback((rows: AdminGoldenTicketWinnerListItem[]) => {
    setCaptionDrafts((current) => {
      const next: Record<string, string> = {};
      for (const winner of rows) {
        next[winner.id] = current[winner.id] ?? winner.caption ?? "";
      }
      return next;
    });
  }, []);

  const loadWinners = useCallback(async () => {
    if (!session?.token || !isAdmin) {
      setWinners([]);
      setPagination(EMPTY_PAGINATION);
      setStats(EMPTY_STATS);
      setPageError(null);
      return;
    }

    setPageLoading(true);

    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_LIMIT),
        sort,
      });
      const response = await fetch(`/api/admin/golden/winners?${params.toString()}`, {
        headers: adminHeaders,
      });
      const payload = (await response.json().catch(() => ({}))) as WinnersResponse;
      if (!response.ok || !payload.winners || !payload.pagination || !payload.stats) {
        throw new Error(payload.message ?? "Failed to load Golden Ticket winners.");
      }

      setWinners(payload.winners);
      setPagination(payload.pagination);
      setStats(payload.stats);
      syncCaptionDrafts(payload.winners);
      setPageError(null);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Failed to load Golden Ticket winners.");
    } finally {
      setPageLoading(false);
    }
  }, [adminHeaders, isAdmin, page, session?.token, sort, syncCaptionDrafts]);

  useEffect(() => {
    void loadWinners();
  }, [loadWinners]);

  const applyWinnerUpdate = useCallback((winner: AdminGoldenTicketWinnerListItem) => {
    setWinners((current) => current.map((entry) => (entry.id === winner.id ? winner : entry)));
    setCaptionDrafts((current) => ({ ...current, [winner.id]: winner.caption ?? "" }));
  }, []);

  const updateWinner = useCallback(
    async (
      winnerId: string,
      payload: {
        caption?: string | null;
        featured?: boolean;
        winnerPhotoApproved?: boolean;
        unpublished?: boolean;
        publishedAt?: string | null;
      },
      actionKey: string,
      successMessage: string
    ) => {
      let activeSession = session;
      if (!activeSession) {
        activeSession = await ensureSession();
      }

      setActionStates((current) => ({ ...current, [actionKey]: true }));
      setNotice(null);

      try {
        const response = await fetch(`/api/admin/golden/winners/${winnerId}`, {
          method: "PATCH",
          headers: buildAdminHeaders(activeSession.token, {
            "Content-Type": "application/json",
          }),
          body: JSON.stringify(payload),
        });
        const result = (await response.json().catch(() => ({}))) as UpdateWinnerResponse;
        if (!response.ok || !result.winner) {
          throw new Error(result.message ?? "Failed to update Golden Ticket winner profile.");
        }

        applyWinnerUpdate(result.winner);
        setNotice({
          tone: "success",
          message: successMessage,
        });
        await loadWinners();
      } catch (error) {
        setNotice({
          tone: "error",
          message: error instanceof Error ? error.message : "Failed to update Golden Ticket winner profile.",
        });
      } finally {
        setActionStates((current) => ({ ...current, [actionKey]: false }));
      }
    },
    [applyWinnerUpdate, ensureSession, loadWinners, session]
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
          <title>Ten Kings · Golden Ticket Winners</title>
          <meta name="robots" content="noindex" />
        </Head>
        {gate}
      </AppShell>
    );
  }

  return (
    <AppShell background="black" brandVariant="collectibles">
      <Head>
        <title>Ten Kings · Golden Ticket Winners</title>
        <meta name="robots" content="noindex" />
      </Head>

      <div className={ADMIN_PAGE_FRAME_CLASS}>
        <AdminPageHeader
          backHref="/admin"
          backLabel="← Admin Home"
          eyebrow="Golden Ticket"
          title="Winners Moderation"
          description="Moderate Hall of Kings winner profiles, approve submitted photos, edit captions, and control whether a winner remains visible on public Golden Ticket surfaces."
          badges={
            <>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-slate-200">
                {stats.totalCount} winners
              </span>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-slate-400">
                {stats.publishedCount} published
              </span>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-slate-400">
                {stats.unpublishedCount} unpublished
              </span>
            </>
          }
          actions={
            <div className="flex flex-wrap gap-2">
              <Link
                href="/admin/golden/prizes"
                className="rounded-full border border-white/15 px-5 py-3 text-[11px] uppercase tracking-[0.22em] text-slate-200 transition hover:border-white/35 hover:text-white"
              >
                Prize Minting
              </Link>
              <Link
                href="/admin/golden/queue"
                className="rounded-full border border-white/15 px-5 py-3 text-[11px] uppercase tracking-[0.22em] text-slate-200 transition hover:border-white/35 hover:text-white"
              >
                Live Queue
              </Link>
              <button
                type="button"
                onClick={() => void loadWinners()}
                className="rounded-full border border-gold-400/40 px-5 py-3 text-[11px] uppercase tracking-[0.22em] text-gold-100 transition hover:border-gold-300 hover:text-white"
              >
                Refresh Now
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
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Published</p>
            <p className="mt-3 text-3xl font-semibold text-white">{stats.publishedCount}</p>
          </article>
          <article className={adminStatCardClass("p-4")}>
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Featured</p>
            <p className="mt-3 text-3xl font-semibold text-gold-200">{stats.featuredCount}</p>
          </article>
          <article className={adminStatCardClass("p-4")}>
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Photos Submitted</p>
            <p className="mt-3 text-3xl font-semibold text-sky-200">{stats.photoSubmittedCount}</p>
          </article>
          <article className={adminStatCardClass("p-4")}>
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Photos Pending</p>
            <p className="mt-3 text-3xl font-semibold text-amber-200">{stats.photoPendingCount}</p>
          </article>
        </section>

        <section className={adminPanelClass("p-4 md:p-5")}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="space-y-2">
              <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Sort</p>
              <select
                value={sort}
                onChange={(event) => {
                  const nextSort = event.target.value === "oldest" ? "oldest" : "recent";
                  setSort(nextSort);
                  setPage(1);
                }}
                className={adminSelectClass("min-w-[220px]")}
              >
                <option value="recent">Most Recent Claims</option>
                <option value="oldest">Oldest Claims</option>
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.24em] text-slate-400">
              <span>
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <span>{pagination.totalCount} total rows</span>
            </div>
          </div>
        </section>

        <section className={adminPanelClass("overflow-hidden")}>
          {pageLoading && winners.length === 0 ? (
            <div className="p-6 text-sm text-slate-400">Loading Golden Ticket winners...</div>
          ) : winners.length === 0 ? (
            <div className="p-6 text-sm text-slate-400">No Golden Ticket winners have been claimed yet.</div>
          ) : (
            <div className="divide-y divide-white/6">
              {winners.map((winner) => {
                const handle = formatHandle(winner.displayHandle);
                const captionDraft = captionDrafts[winner.id] ?? winner.caption ?? "";
                const captionDirty = normalizeCaption(captionDraft) !== normalizeCaption(winner.caption ?? "");
                const photoStatus = !winner.winnerPhotoUrl
                  ? "No photo submitted"
                  : winner.winnerPhotoApproved
                    ? "Approved"
                    : "Pending review";
                const publishLabel = winner.publishedAt ? "Published" : "Unpublished";

                return (
                  <article key={winner.id} className="grid gap-4 p-4 lg:grid-cols-[220px,1fr,240px]">
                    <div className="space-y-3">
                      <div className={adminSubpanelClass("overflow-hidden")}>
                        {winner.winnerPhotoUrl ? (
                          <div className="relative aspect-[4/5] bg-black">
                            <Image
                              src={winner.winnerPhotoUrl}
                              alt={`${winner.displayName} winner submission`}
                              fill
                              sizes="(min-width: 1024px) 14rem, 100vw"
                              className="object-cover"
                            />
                          </div>
                        ) : (
                          <div className="flex aspect-[4/5] items-center justify-center bg-black px-6 text-center text-sm text-slate-500">
                            No photo submitted
                          </div>
                        )}
                      </div>

                      <div className={adminSubpanelClass("p-3")}>
                        <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Photo Status</p>
                        <p className="mt-2 text-sm text-white">{photoStatus}</p>
                        <p className="mt-1 text-xs text-slate-400">
                          {winner.winnerPhotoUrl ? "Winner photo preview is live in moderation." : "Phase 4 will populate the winner photo later."}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-gold-400/30 bg-gold-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-gold-100">
                          {winner.ticketLabel}
                        </span>
                        <span
                          className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.18em] ${
                            winner.featured
                              ? "border-gold-400/35 bg-gold-500/10 text-gold-100"
                              : "border-white/10 bg-white/5 text-slate-300"
                          }`}
                        >
                          {winner.featured ? "Featured" : "Standard"}
                        </span>
                        <span
                          className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.18em] ${
                            winner.publishedAt
                              ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-100"
                              : "border-rose-400/25 bg-rose-500/10 text-rose-100"
                          }`}
                        >
                          {publishLabel}
                        </span>
                      </div>

                      <div>
                        <h2 className="font-heading text-3xl uppercase tracking-[0.1em] text-white">{winner.displayName}</h2>
                        {handle ? <p className="mt-2 text-sm text-gold-300">{handle}</p> : null}
                        <p className="mt-3 text-sm text-slate-300">
                          {winner.prize.name}
                          {winner.prize.estimatedValue != null ? ` · ${formatUsdMinor(winner.prize.estimatedValue)}` : ""}
                        </p>
                      </div>

                      <div className="grid gap-3 md:grid-cols-3">
                        <div className={adminSubpanelClass("p-3")}>
                          <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Claimed</p>
                          <p className="mt-2 text-sm text-white">{formatDateTime(winner.claimedAt)}</p>
                        </div>
                        <div className={adminSubpanelClass("p-3")}>
                          <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Published</p>
                          <p className="mt-2 text-sm text-white">{formatDateTime(winner.publishedAt)}</p>
                        </div>
                        <div className={adminSubpanelClass("p-3")}>
                          <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Found Through</p>
                          <p className="mt-2 text-sm text-white">{winner.sourceLocation?.name ?? "Location pending"}</p>
                        </div>
                      </div>

                      <div className={adminSubpanelClass("p-4")}>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Caption</p>
                            <p className="mt-1 text-xs text-slate-400">Edit the public Hall of Kings caption for this winner.</p>
                          </div>
                          {winner.publishedAt ? (
                            <Link
                              href={winner.winnerProfileUrl}
                              className="rounded-full border border-white/15 px-4 py-2 text-[11px] uppercase tracking-[0.22em] text-slate-200 transition hover:border-white/35 hover:text-white"
                            >
                              View Public Page
                            </Link>
                          ) : null}
                        </div>
                        <textarea
                          value={captionDraft}
                          onChange={(event) =>
                            setCaptionDrafts((current) => ({
                              ...current,
                              [winner.id]: event.target.value,
                            }))
                          }
                          rows={4}
                          placeholder="Add a winner caption..."
                          className={adminTextareaClass("mt-4 min-h-[110px] w-full")}
                        />
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={!captionDirty || actionStates[`caption:${winner.id}`] === true}
                            onClick={() =>
                              void updateWinner(
                                winner.id,
                                { caption: captionDraft },
                                `caption:${winner.id}`,
                                `Saved caption for ${winner.ticketLabel}.`
                              )
                            }
                            className="rounded-full border border-gold-400/40 px-4 py-2 text-[11px] uppercase tracking-[0.22em] text-gold-100 transition hover:border-gold-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {actionStates[`caption:${winner.id}`] ? "Saving..." : "Save Caption"}
                          </button>
                          <button
                            type="button"
                            disabled={!captionDirty}
                            onClick={() =>
                              setCaptionDrafts((current) => ({
                                ...current,
                                [winner.id]: winner.caption ?? "",
                              }))
                            }
                            className="rounded-full border border-white/15 px-4 py-2 text-[11px] uppercase tracking-[0.22em] text-slate-200 transition hover:border-white/35 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Reset
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-3">
                      <button
                        type="button"
                        disabled={actionStates[`featured:${winner.id}`] === true}
                        onClick={() =>
                          void updateWinner(
                            winner.id,
                            { featured: !winner.featured },
                            `featured:${winner.id}`,
                            `${winner.featured ? "Removed" : "Marked"} ${winner.ticketLabel} ${winner.featured ? "from" : "as"} featured.`
                          )
                        }
                        className="rounded-full border border-white/15 px-5 py-3 text-[11px] uppercase tracking-[0.22em] text-slate-100 transition hover:border-white/35 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {actionStates[`featured:${winner.id}`] ? "Saving..." : winner.featured ? "Remove Featured" : "Feature Winner"}
                      </button>

                      <button
                        type="button"
                        disabled={!winner.winnerPhotoUrl || actionStates[`photo:${winner.id}`] === true}
                        onClick={() =>
                          void updateWinner(
                            winner.id,
                            { winnerPhotoApproved: !winner.winnerPhotoApproved },
                            `photo:${winner.id}`,
                            `${
                              winner.winnerPhotoApproved ? "Rejected" : "Approved"
                            } the winner photo for ${winner.ticketLabel}.`
                          )
                        }
                        className="rounded-full border border-sky-400/35 bg-sky-500/10 px-5 py-3 text-[11px] uppercase tracking-[0.22em] text-sky-100 transition hover:border-sky-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {actionStates[`photo:${winner.id}`]
                          ? "Saving..."
                          : !winner.winnerPhotoUrl
                            ? "No Photo Submitted"
                            : winner.winnerPhotoApproved
                              ? "Reject Photo"
                              : "Approve Photo"}
                      </button>

                      <button
                        type="button"
                        disabled={actionStates[`publish:${winner.id}`] === true}
                        onClick={() =>
                          void updateWinner(
                            winner.id,
                            { unpublished: winner.publishedAt !== null },
                            `publish:${winner.id}`,
                            `${
                              winner.publishedAt ? "Unpublished" : "Republished"
                            } ${winner.ticketLabel} across public Golden Ticket surfaces.`
                          )
                        }
                        className={`rounded-full border px-5 py-3 text-[11px] uppercase tracking-[0.22em] transition disabled:cursor-not-allowed disabled:opacity-60 ${
                          winner.publishedAt
                            ? "border-rose-400/35 bg-rose-500/10 text-rose-100 hover:border-rose-300 hover:text-white"
                            : "border-emerald-400/35 bg-emerald-500/10 text-emerald-100 hover:border-emerald-300 hover:text-white"
                        }`}
                      >
                        {actionStates[`publish:${winner.id}`]
                          ? "Saving..."
                          : winner.publishedAt
                            ? "Unpublish"
                            : "Republish"}
                      </button>

                      <div className={adminSubpanelClass("space-y-3 p-3")}>
                        <div>
                          <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Prize Art</p>
                          <p className="mt-2 text-sm text-white">{winner.prize.name}</p>
                        </div>
                        {winner.prize.thumbnailUrl || winner.prize.imageUrl ? (
                          <div className="relative aspect-[16/10] overflow-hidden rounded-2xl bg-black">
                            <Image
                              src={winner.prize.thumbnailUrl ?? winner.prize.imageUrl ?? ""}
                              alt={winner.prize.name}
                              fill
                              sizes="(min-width: 1024px) 15rem, 100vw"
                              className="object-cover"
                            />
                          </div>
                        ) : (
                          <div className="flex aspect-[16/10] items-center justify-center rounded-2xl bg-black px-4 text-center text-xs text-slate-500">
                            No prize artwork uploaded.
                          </div>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className={adminPanelClass("p-4 md:p-5")}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-slate-400">
              Showing {(pagination.page - 1) * pagination.limit + (winners.length > 0 ? 1 : 0)}-
              {(pagination.page - 1) * pagination.limit + winners.length} of {pagination.totalCount}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={pagination.page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                className="rounded-full border border-white/15 px-5 py-3 text-[11px] uppercase tracking-[0.22em] text-slate-200 transition hover:border-white/35 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={!pagination.hasMore}
                onClick={() => setPage((current) => current + 1)}
                className="rounded-full border border-white/15 px-5 py-3 text-[11px] uppercase tracking-[0.22em] text-slate-200 transition hover:border-white/35 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
