import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import AppShell from "../../../components/AppShell";
import {
  ADMIN_PAGE_FRAME_CLASS,
  AdminPageHeader,
  adminPanelClass,
  adminStatCardClass,
} from "../../../components/admin/AdminPrimitives";
import { CardGrid } from "../../../components/admin/CardGrid";
import { FilterBar } from "../../../components/admin/FilterBar";
import { PaginationBar } from "../../../components/admin/PaginationBar";
import { SelectionBar } from "../../../components/admin/SelectionBar";
import {
  buildInventoryQueryState,
  formatCategoryLabel,
  formatCurrencyFromMinor,
  formatPackTierLabel,
  parseInventoryQueryState,
  type AssignedLocationBatchSummary,
  type AssignedLocationDetailResponse,
  type InventoryCardSummary,
  type InventoryCardsResponse,
  type InventoryFilterOptionsResponse,
  type InventoryQueryState,
  type InventorySelectionSummary,
} from "../../../lib/adminInventory";
import { buildAdminHeaders } from "../../../lib/adminHeaders";
import { useSession } from "../../../hooks/useSession";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../../constants/admin";

type SelectedCardMeta = {
  valuationMinor: number | null;
  category: string | null;
  frontPhotoUrl: string | null;
};

function sameSelection(selection: InventorySelectionSummary | null, selectedIds: Set<string>) {
  if (!selection || selection.ids.length !== selectedIds.size) {
    return false;
  }
  return selection.ids.every((id) => selectedIds.has(id));
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows
    .map((row) =>
      row
        .map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`)
        .join(",")
    )
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function ProgressBar({ packedCount, totalCount }: { packedCount: number; totalCount: number }) {
  const percent = totalCount > 0 ? Math.round((packedCount / totalCount) * 100) : 0;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.22em] text-slate-500">
        <span>Packing Progress</span>
        <span>
          {packedCount}/{totalCount} packed
        </span>
      </div>
      <div className="h-2 rounded-full bg-white/8">
        <div className="h-2 rounded-full bg-gold-400 transition-all" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export default function AssignedLocationDetailPage() {
  const router = useRouter();
  const { locationId } = router.query;
  const { session, loading, ensureSession, logout } = useSession();
  const [detail, setDetail] = useState<AssignedLocationDetailResponse | null>(null);
  const [filterOptions, setFilterOptions] = useState<InventoryFilterOptionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedMeta, setSelectedMeta] = useState<Record<string, SelectedCardMeta>>({});
  const [bulkSelection, setBulkSelection] = useState<InventorySelectionSummary | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [transitionBusy, setTransitionBusy] = useState<string | null>(null);
  const [returnBusy, setReturnBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);

  const isAdmin = useMemo(
    () => hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone),
    [session?.user.id, session?.user.phone]
  );
  const adminHeaders = useMemo(() => buildAdminHeaders(session?.token), [session?.token]);
  const queryState = useMemo(
    () => parseInventoryQueryState(router.query as Record<string, string | string[] | undefined>),
    [router.query]
  );
  const selectionScopeKey = useMemo(
    () =>
      JSON.stringify({
        batchId: queryState.batchId,
        category: queryState.category,
        subCategory: queryState.subCategory,
        minPrice: queryState.minPrice,
        maxPrice: queryState.maxPrice,
        year: queryState.year,
        brand: queryState.brand,
        parallel: queryState.parallel,
        search: queryState.search,
      }),
    [
      queryState.batchId,
      queryState.brand,
      queryState.category,
      queryState.maxPrice,
      queryState.minPrice,
      queryState.parallel,
      queryState.search,
      queryState.subCategory,
      queryState.year,
    ]
  );

  const syncQuery = async (patch: Partial<InventoryQueryState>) => {
    if (!locationId || typeof locationId !== "string") {
      return;
    }
    const next: InventoryQueryState = {
      ...queryState,
      ...patch,
    };
    await router.push(
      {
        pathname: `/admin/assigned-locations/${locationId}`,
        query: buildInventoryQueryState(next),
      },
      undefined,
      { shallow: true }
    );
  };

  useEffect(() => {
    setSelectedIds(new Set());
    setBulkSelection(null);
  }, [selectionScopeKey]);

  useEffect(() => {
    if (!session?.token || !isAdmin || typeof locationId !== "string") {
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams();
    params.set("locationId", locationId);
    if (queryState.batchId) {
      params.set("batchId", queryState.batchId);
    }

    setLoadingData(true);
    Promise.all([
      fetch(`/api/admin/assigned-locations/${locationId}?${new URLSearchParams(buildInventoryQueryState(queryState)).toString()}`, {
        headers: adminHeaders,
        signal: controller.signal,
      }).then(async (response) => {
        if (!response.ok) {
          throw new Error(response.status === 404 ? "Location not found" : "Failed to load assigned location");
        }
        return (await response.json()) as AssignedLocationDetailResponse;
      }),
      fetch(`/api/admin/inventory/filter-options?${params.toString()}`, {
        headers: adminHeaders,
        signal: controller.signal,
      }).then(async (response) => {
        if (!response.ok) {
          throw new Error("Failed to load filter options");
        }
        return (await response.json()) as InventoryFilterOptionsResponse;
      }),
    ])
      .then(([detailPayload, optionsPayload]) => {
        setDetail(detailPayload);
        setFilterOptions(optionsPayload);
        setSelectedMeta((current) => {
          const next = { ...current };
          detailPayload.cards.forEach((card) => {
            next[card.id] = {
              valuationMinor: card.valuationMinor,
              category: card.category,
              frontPhotoUrl: card.frontPhotoUrl,
            };
          });
          return next;
        });
        setError(null);
      })
      .catch((fetchError: unknown) => {
        if ((fetchError as Error).name === "AbortError") {
          return;
        }
        setError(fetchError instanceof Error ? fetchError.message : "Failed to load location");
      })
      .finally(() => setLoadingData(false));

    return () => controller.abort();
  }, [adminHeaders, isAdmin, locationId, queryState, refreshNonce, session?.token]);

  const bulkSelectionActive = useMemo(() => sameSelection(bulkSelection, selectedIds), [bulkSelection, selectedIds]);
  const selectedTotalValue = useMemo(() => {
    if (bulkSelectionActive && bulkSelection) {
      return bulkSelection.totalValue;
    }
    let total = 0;
    selectedIds.forEach((id) => {
      total += selectedMeta[id]?.valuationMinor ?? 0;
    });
    return total;
  }, [bulkSelection, bulkSelectionActive, selectedIds, selectedMeta]);

  const activeBatch = useMemo(
    () => detail?.batches.find((batch) => batch.id === detail.activeBatchId) ?? null,
    [detail]
  );
  const selectedPhotoUrl = useMemo(() => {
    for (const id of selectedIds) {
      const url = selectedMeta[id]?.frontPhotoUrl;
      if (url) {
        return url;
      }
    }
    return null;
  }, [selectedIds, selectedMeta]);

  const toggleCard = (cardId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(cardId)) {
        next.delete(cardId);
      } else {
        next.add(cardId);
      }
      return next;
    });
    setBulkSelection(null);
  };

  const handleSelectAll = async () => {
    if (!locationId || typeof locationId !== "string") {
      return;
    }

    if (bulkSelectionActive) {
      setSelectedIds(new Set());
      setBulkSelection(null);
      return;
    }

    const params = new URLSearchParams(buildInventoryQueryState(queryState));
    params.set("includeSelection", "1");

    try {
      const response = await fetch(`/api/admin/assigned-locations/${locationId}?${params.toString()}`, {
        headers: adminHeaders,
      });
      if (!response.ok) {
        throw new Error("Failed to load selection");
      }
      const payload = (await response.json()) as AssignedLocationDetailResponse;
      if (!payload.selection) {
        throw new Error("Selection payload missing from response");
      }
      setSelectedIds(new Set(payload.selection.ids));
      setBulkSelection(payload.selection);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Failed to select cards");
    }
  };

  const handleTransition = async (newStage: "SHIPPED" | "LOADED") => {
    if (!locationId || typeof locationId !== "string" || !activeBatch) {
      return;
    }

    setTransitionBusy(newStage);
    try {
      const response = await fetch(`/api/admin/assigned-locations/${locationId}/transition`, {
        method: "POST",
        headers: {
          ...adminHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          batchId: activeBatch.id,
          newStage,
        }),
      });
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to update batch stage");
      }
      setNotice(`Batch moved to ${newStage}`);
      setRefreshNonce((value) => value + 1);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Failed to update batch");
    } finally {
      setTransitionBusy(null);
    }
  };

  const handleReturnToInventory = async () => {
    if (!locationId || typeof locationId !== "string" || selectedIds.size === 0) {
      return;
    }
    if (!window.confirm(`Return ${selectedIds.size} cards to inventory?`)) {
      return;
    }

    setReturnBusy(true);
    try {
      const response = await fetch(`/api/admin/assigned-locations/${locationId}/return`, {
        method: "POST",
        headers: {
          ...adminHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ cardIds: [...selectedIds] }),
      });
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to return cards");
      }
      setSelectedIds(new Set());
      setBulkSelection(null);
      setNotice(`${selectedIds.size} cards returned to inventory`);
      setRefreshNonce((value) => value + 1);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Failed to return cards");
    } finally {
      setReturnBusy(false);
    }
  };

  const handleExportCsv = async () => {
    if (!locationId || typeof locationId !== "string") {
      return;
    }

    setExportBusy(true);
    try {
      let page = 1;
      const pageSize = 100;
      const rows: InventoryCardSummary[] = [];
      let totalPages = 1;

      while (page <= totalPages) {
        const params = new URLSearchParams(
          buildInventoryQueryState({
            ...queryState,
            page,
            pageSize,
          })
        );
        const response = await fetch(`/api/admin/assigned-locations/${locationId}?${params.toString()}`, {
          headers: adminHeaders,
        });
        if (!response.ok) {
          throw new Error("Failed to export cards");
        }
        const payload = (await response.json()) as AssignedLocationDetailResponse;
        rows.push(...payload.cards);
        totalPages = payload.pagination.totalPages;
        page += 1;
      }

      downloadCsv(
        `${detail?.location.slug ?? "assigned-location"}-${new Date().toISOString().slice(0, 10)}.csv`,
        [
          ["Card ID", "Player", "Set", "Year", "Brand", "Card Number", "Parallel", "Category", "Sub-Category", "Value", "Batch"],
          ...rows.map((card) => [
            card.id,
            card.playerName ?? "",
            card.setName ?? "",
            card.year ?? "",
            card.brand ?? "",
            card.cardNumber ?? "",
            card.parallel ?? "base",
            card.category ?? "",
            card.subCategory ?? "",
            String(card.valuationMinor ?? ""),
            card.inventoryBatch?.label ?? "",
          ]),
        ]
      );
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Failed to export CSV");
    } finally {
      setExportBusy(false);
    }
  };

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
      <AppShell>
        <Head>
          <title>Ten Kings · Assigned Location</title>
          <meta name="robots" content="noindex" />
        </Head>
        {gate}
      </AppShell>
    );
  }

  const canMarkShipped = Boolean(activeBatch && activeBatch.stage === "ASSIGNED" && !detail?.location.isOnline);
  const canMarkLoaded = Boolean(
    activeBatch &&
      ((activeBatch.stage === "ASSIGNED" && detail?.location.isOnline) || activeBatch.stage === "SHIPPED")
  );

  return (
    <AppShell>
      <Head>
        <title>Ten Kings · Assigned Location</title>
        <meta name="robots" content="noindex" />
      </Head>

      <div className={ADMIN_PAGE_FRAME_CLASS}>
        <AdminPageHeader
          backHref="/admin/assigned-locations"
          backLabel="← Assigned Locations"
          eyebrow="Inventory Routing"
          title={detail?.location.name ?? "Assigned Location"}
          description={
            detail ? (
              <>
                {detail.location.address} · {detail.location.isOnline ? "Online distribution flow" : "Physical location flow"}
              </>
            ) : (
              "Loading location details..."
            )
          }
          actions={
            <>
              <button
                type="button"
                onClick={() => handleTransition("SHIPPED")}
                disabled={!canMarkShipped || transitionBusy !== null}
                className="rounded-full border border-white/12 bg-white/[0.04] px-4 py-2 text-[11px] uppercase tracking-[0.22em] text-slate-200 transition hover:border-white/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
              >
                {transitionBusy === "SHIPPED" ? "Marking..." : "Mark as Shipped"}
              </button>
              <button
                type="button"
                onClick={() => handleTransition("LOADED")}
                disabled={!canMarkLoaded || transitionBusy !== null}
                className="rounded-full border border-gold-400/45 bg-gold-500 px-4 py-2 text-[11px] uppercase tracking-[0.22em] text-night-950 transition hover:bg-gold-400 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {transitionBusy === "LOADED" ? "Marking..." : "Mark as Loaded"}
              </button>
              <button
                type="button"
                onClick={handleExportCsv}
                disabled={exportBusy}
                className="rounded-full border border-white/12 bg-white/[0.04] px-4 py-2 text-[11px] uppercase tracking-[0.22em] text-slate-200 transition hover:border-white/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
              >
                {exportBusy ? "Exporting..." : "Export CSV"}
              </button>
            </>
          }
        />

        {notice ? (
          <section className={adminPanelClass("border-emerald-400/25 bg-emerald-500/10 p-4")}>
            <p className="text-sm text-emerald-100">{notice}</p>
          </section>
        ) : null}

        {error ? (
          <section className={adminPanelClass("border-rose-400/25 bg-rose-500/10 p-4")}>
            <p className="text-sm text-rose-200">{error}</p>
          </section>
        ) : null}

        <section className="grid gap-4 xl:grid-cols-4">
          <article className={adminStatCardClass("p-4")}>
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Cards</p>
            <p className="mt-3 text-3xl font-semibold text-white">{detail?.stats.cardCount ?? 0}</p>
          </article>
          <article className={adminStatCardClass("p-4")}>
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Value</p>
            <p className="mt-3 text-3xl font-semibold text-emerald-300">
              {formatCurrencyFromMinor(detail?.stats.totalValue ?? 0)}
            </p>
          </article>
          <article className={adminStatCardClass("p-4")}>
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Stage</p>
            <p className="mt-3 text-3xl font-semibold text-white">{detail?.stats.primaryStage ?? "N/A"}</p>
          </article>
          <article className={adminStatCardClass("p-4")}>
            <ProgressBar
              packedCount={detail?.stats.packingProgress.packedCount ?? 0}
              totalCount={detail?.stats.packingProgress.totalCount ?? 0}
            />
          </article>
        </section>

        <section className={adminPanelClass("p-4 md:p-5")}>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void syncQuery({ batchId: null, page: 1 })}
              className={[
                "rounded-full border px-4 py-2 text-[11px] uppercase tracking-[0.22em] transition",
                detail?.activeBatchId == null
                  ? "border-gold-400/45 bg-gold-500/15 text-gold-100"
                  : "border-white/12 bg-white/[0.04] text-slate-300 hover:border-white/25 hover:text-white",
              ].join(" ")}
            >
              All Batches
            </button>
            {detail?.batches.map((batch) => (
              <button
                key={batch.id}
                type="button"
                onClick={() => void syncQuery({ batchId: batch.id, page: 1 })}
                className={[
                  "rounded-full border px-4 py-2 text-[11px] uppercase tracking-[0.22em] transition",
                  detail.activeBatchId === batch.id
                    ? "border-gold-400/45 bg-gold-500/15 text-gold-100"
                    : "border-white/12 bg-white/[0.04] text-slate-300 hover:border-white/25 hover:text-white",
                ].join(" ")}
              >
                {(batch.label ?? "Unnamed Batch").slice(0, 36)}
              </button>
            ))}
          </div>

          {activeBatch ? (
            <div className="mt-4 grid gap-3 text-[11px] uppercase tracking-[0.22em] text-slate-400 md:grid-cols-4">
              <span className="rounded-full border border-white/10 px-3 py-2">
                {activeBatch.stage}
              </span>
              {activeBatch.category ? (
                <span className="rounded-full border border-white/10 px-3 py-2">
                  {formatCategoryLabel(activeBatch.category)}
                </span>
              ) : null}
              {activeBatch.tier ? (
                <span className="rounded-full border border-white/10 px-3 py-2">
                  {formatPackTierLabel(activeBatch.tier)}
                </span>
              ) : null}
              <span className="rounded-full border border-white/10 px-3 py-2">
                {activeBatch.cardCount} Cards
              </span>
            </div>
          ) : null}
        </section>

        <FilterBar
          filters={queryState}
          filterOptions={filterOptions}
          loading={loadingData}
          onChange={(patch) => {
            void syncQuery({
              ...patch,
              page: patch.page ?? 1,
            });
          }}
        />

        {selectedIds.size > 0 ? (
          <SelectionBar
            selectedCount={selectedIds.size}
            totalValue={selectedTotalValue}
            selectAllLabel={
              bulkSelectionActive
                ? `All ${selectedIds.size} matching selected`
                : `Select All ${detail?.pagination.totalCount ?? 0} Matching`
            }
            onSelectAll={handleSelectAll}
            onClearSelection={() => {
              setSelectedIds(new Set());
              setBulkSelection(null);
            }}
            actions={[
              {
                id: "return",
                label: returnBusy ? "Returning..." : "Return to Inventory",
                onClick: handleReturnToInventory,
                disabled: returnBusy,
              },
              {
                id: "details",
                label: "View Details",
                onClick: () => {
                  if (selectedPhotoUrl) {
                    window.open(selectedPhotoUrl, "_blank", "noopener,noreferrer");
                  }
                },
                disabled: !selectedPhotoUrl,
              },
            ]}
          />
        ) : null}

        <CardGrid
          cards={detail?.cards ?? []}
          selectedIds={selectedIds}
          loading={loadingData}
          onToggleCard={toggleCard}
          emptyState={
            <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
              <h2 className="font-heading text-3xl uppercase tracking-[0.12em] text-white">No cards match this view</h2>
              <p className="max-w-xl text-sm text-slate-400">
                Adjust the batch tabs or filters to find cards assigned to this location.
              </p>
              <Link
                href="/admin/inventory"
                className="rounded-full border border-gold-400/45 px-5 py-3 text-[11px] uppercase tracking-[0.24em] text-gold-100 transition hover:border-gold-300 hover:text-white"
              >
                Back to Inventory
              </Link>
            </div>
          }
        />

        {detail ? (
          <PaginationBar
            page={detail.pagination.page}
            pageSize={detail.pagination.pageSize}
            totalCount={detail.pagination.totalCount}
            totalPages={detail.pagination.totalPages}
            onChange={(page) => void syncQuery({ page })}
          />
        ) : null}
      </div>
    </AppShell>
  );
}
