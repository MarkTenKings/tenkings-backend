import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import AppShell from "../../components/AppShell";
import { AssignToLocationModal } from "../../components/admin/AssignToLocationModal";
import {
  ADMIN_PAGE_FRAME_CLASS,
  AdminPageHeader,
  adminPanelClass,
  adminStatCardClass,
} from "../../components/admin/AdminPrimitives";
import { CardGrid } from "../../components/admin/CardGrid";
import { FilterBar } from "../../components/admin/FilterBar";
import { PaginationBar } from "../../components/admin/PaginationBar";
import { SelectionBar } from "../../components/admin/SelectionBar";
import {
  buildInventoryQueryState,
  formatCurrencyFromMinor,
  parseInventoryQueryState,
  type CollectibleCategoryValue,
  type InventoryCardSummary,
  type InventoryCardsResponse,
  type InventoryFilterOptionsResponse,
  type InventoryQueryState,
  type InventorySelectionSummary,
  type PackTierValue,
} from "../../lib/adminInventory";
import { buildAdminHeaders } from "../../lib/adminHeaders";
import { useSession } from "../../hooks/useSession";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../constants/admin";

type SelectedCardMeta = {
  valuationMinor: number | null;
  category: string | null;
};

const INITIAL_ASSIGN_FORM = {
  packCategory: "" as CollectibleCategoryValue | "",
  packTier: "" as PackTierValue | "",
  locationId: "",
  notes: "",
};

function sameSelection(selection: InventorySelectionSummary | null, selectedIds: Set<string>) {
  if (!selection || selection.ids.length !== selectedIds.size) {
    return false;
  }
  return selection.ids.every((id) => selectedIds.has(id));
}

export default function InventoryPage() {
  const router = useRouter();
  const { session, loading, ensureSession, logout } = useSession();
  const [filterOptions, setFilterOptions] = useState<InventoryFilterOptionsResponse | null>(null);
  const [cardsResponse, setCardsResponse] = useState<InventoryCardsResponse | null>(null);
  const [cardsLoading, setCardsLoading] = useState(false);
  const [filterLoading, setFilterLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ message: string; href?: string; hrefLabel?: string } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedMeta, setSelectedMeta] = useState<Record<string, SelectedCardMeta>>({});
  const [bulkSelection, setBulkSelection] = useState<InventorySelectionSummary | null>(null);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [assignForm, setAssignForm] = useState(INITIAL_ASSIGN_FORM);
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [returnBusy, setReturnBusy] = useState(false);
  const [purgeBusy, setPurgeBusy] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);

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
    const next: InventoryQueryState = {
      ...queryState,
      ...patch,
    };
    await router.push(
      {
        pathname: "/admin/inventory",
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
    if (!session?.token || !isAdmin) {
      return;
    }

    const controller = new AbortController();
    setFilterLoading(true);

    fetch("/api/admin/inventory/filter-options", {
      headers: adminHeaders,
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Failed to load filter options");
        }
        return (await response.json()) as InventoryFilterOptionsResponse;
      })
      .then((payload) => {
        setFilterOptions(payload);
        setAssignForm((current) =>
          current.locationId || !payload.locations[0]
            ? current
            : {
                ...current,
                locationId: payload.locations[0].id,
              }
        );
      })
      .catch((fetchError: unknown) => {
        if ((fetchError as Error).name === "AbortError") {
          return;
        }
        setError(fetchError instanceof Error ? fetchError.message : "Failed to load filters");
      })
      .finally(() => setFilterLoading(false));

    return () => controller.abort();
  }, [adminHeaders, isAdmin, session?.token]);

  useEffect(() => {
    if (!session?.token || !isAdmin) {
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams(buildInventoryQueryState(queryState));
    setCardsLoading(true);
    setError(null);

    fetch(`/api/admin/inventory/cards?${params.toString()}`, {
      headers: adminHeaders,
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Failed to load inventory cards");
        }
        return (await response.json()) as InventoryCardsResponse;
      })
      .then((payload) => {
        setCardsResponse(payload);
        setSelectedMeta((current) => {
          const next = { ...current };
          payload.cards.forEach((card) => {
            next[card.id] = {
              valuationMinor: card.valuationMinor,
              category: card.category,
            };
          });
          return next;
        });
      })
      .catch((fetchError: unknown) => {
        if ((fetchError as Error).name === "AbortError") {
          return;
        }
        setError(fetchError instanceof Error ? fetchError.message : "Failed to load cards");
      })
      .finally(() => setCardsLoading(false));

    return () => controller.abort();
  }, [adminHeaders, isAdmin, queryState, refreshNonce, session?.token]);

  const visibleCards = cardsResponse?.cards ?? [];
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

  const selectedCategories = useMemo(() => {
    if (bulkSelectionActive && bulkSelection) {
      return bulkSelection.categories;
    }

    const counts = new Map<string | null, number>();
    selectedIds.forEach((id) => {
      const category = selectedMeta[id]?.category ?? null;
      counts.set(category, (counts.get(category) ?? 0) + 1);
    });
    return [...counts.entries()].map(([category, count]) => ({ category, count }));
  }, [bulkSelection, bulkSelectionActive, selectedIds, selectedMeta]);

  const selectedCount = selectedIds.size;

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
    if (bulkSelectionActive) {
      setSelectedIds(new Set());
      setBulkSelection(null);
      return;
    }

    const params = new URLSearchParams(buildInventoryQueryState(queryState));
    params.set("includeSelection", "1");

    try {
      const response = await fetch(`/api/admin/inventory/cards?${params.toString()}`, {
        headers: adminHeaders,
      });
      if (!response.ok) {
        throw new Error("Failed to select all matching cards");
      }
      const payload = (await response.json()) as InventoryCardsResponse;
      if (!payload.selection) {
        throw new Error("Selection payload missing from response");
      }
      setSelectedIds(new Set(payload.selection.ids));
      setBulkSelection(payload.selection);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Failed to select cards");
    }
  };

  const handleAssign = async () => {
    setAssignBusy(true);
    setAssignError(null);
    try {
      const response = await fetch("/api/admin/inventory/assign", {
        method: "POST",
        headers: {
          ...adminHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          cardIds: [...selectedIds],
          locationId: assignForm.locationId,
          packCategory: assignForm.packCategory,
          packTier: assignForm.packTier,
          notes: assignForm.notes.trim() || undefined,
        }),
      });
      const payload = (await response.json()) as {
        message?: string;
        locationName?: string;
      };
      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to assign cards");
      }

      setAssignModalOpen(false);
      setAssignForm(INITIAL_ASSIGN_FORM);
      setSelectedIds(new Set());
      setBulkSelection(null);
      setNotice({
        message: `${selectedCount} cards assigned to ${payload.locationName ?? "selected location"}`,
        href: `/admin/assigned-locations/${assignForm.locationId}`,
        hrefLabel: "View in Assigned Locations",
      });
      setRefreshNonce((value) => value + 1);
    } catch (fetchError) {
      setAssignError(fetchError instanceof Error ? fetchError.message : "Failed to assign cards");
    } finally {
      setAssignBusy(false);
    }
  };

  const handleReturnToReview = async () => {
    if (selectedCount === 0 || !window.confirm(`Return ${selectedCount} cards to review?`)) {
      return;
    }

    setReturnBusy(true);
    try {
      const response = await fetch("/api/admin/inventory/return", {
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
      setNotice({ message: `${selectedCount} cards returned to review` });
      setRefreshNonce((value) => value + 1);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Failed to return cards");
    } finally {
      setReturnBusy(false);
    }
  };

  const handlePurge = async () => {
    if (
      selectedCount === 0 ||
      !window.confirm(`Delete ${selectedCount} inventory cards permanently?`) ||
      !window.confirm("This cannot be undone. Confirm permanent delete.")
    ) {
      return;
    }

    setPurgeBusy(true);
    try {
      const response = await fetch("/api/admin/inventory/purge", {
        method: "POST",
        headers: {
          ...adminHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ cardIds: [...selectedIds] }),
      });
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to purge cards");
      }
      setSelectedIds(new Set());
      setBulkSelection(null);
      setNotice({ message: `${selectedCount} cards permanently deleted` });
      setRefreshNonce((value) => value + 1);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Failed to purge cards");
    } finally {
      setPurgeBusy(false);
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
          <p className="max-w-md text-sm text-slate-400">
            Use your Ten Kings operator account to access inventory assignment tools.
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
          <title>Ten Kings · Inventory</title>
          <meta name="robots" content="noindex" />
        </Head>
        {gate}
      </AppShell>
    );
  }

  return (
    <AppShell>
      <Head>
        <title>Ten Kings · Inventory</title>
        <meta name="robots" content="noindex" />
      </Head>

      <div className={ADMIN_PAGE_FRAME_CLASS}>
        <AdminPageHeader
          backHref="/admin"
          backLabel="← Admin Home"
          eyebrow="Card Intake"
          title="Inventory"
          description="Inventory-ready cards live here until they are assigned to a location batch. Filter the queue, select cards across pages, and route them into assigned locations without touching the downstream minting or packing flow."
        />

        {notice ? (
          <section className={adminPanelClass("flex flex-col gap-3 border-emerald-400/25 bg-emerald-500/10 p-4 md:flex-row md:items-center md:justify-between")}>
            <p className="text-sm text-emerald-100">{notice.message}</p>
            {notice.href ? (
              <Link
                href={notice.href}
                className="text-[11px] uppercase tracking-[0.22em] text-emerald-100 transition hover:text-white"
              >
                {notice.hrefLabel ?? "Open"}
              </Link>
            ) : null}
          </section>
        ) : null}

        {error ? (
          <section className={adminPanelClass("border-rose-400/25 bg-rose-500/10 p-4")}>
            <p className="text-sm text-rose-200">{error}</p>
          </section>
        ) : null}

        <section className="grid gap-4 xl:grid-cols-3">
          <article className={adminStatCardClass("p-4")}>
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Matching Cards</p>
            <p className="mt-3 text-3xl font-semibold text-white">{cardsResponse?.pagination.totalCount ?? 0}</p>
          </article>
          <article className={adminStatCardClass("p-4")}>
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Matching Value</p>
            <p className="mt-3 text-3xl font-semibold text-emerald-300">
              {formatCurrencyFromMinor(cardsResponse?.aggregations.totalValue ?? 0)}
            </p>
          </article>
          <article className={adminStatCardClass("p-4")}>
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Categories in View</p>
            <p className="mt-3 text-3xl font-semibold text-white">
              {cardsResponse?.aggregations.categories.length ?? 0}
            </p>
          </article>
        </section>

        <FilterBar
          filters={queryState}
          filterOptions={filterOptions}
          loading={filterLoading}
          onChange={(patch) => {
            void syncQuery({
              ...patch,
              page: patch.page ?? 1,
            });
          }}
        />

        {selectedCount > 0 ? (
          <SelectionBar
            selectedCount={selectedCount}
            totalValue={selectedTotalValue}
            selectAllLabel={
              bulkSelectionActive
                ? `All ${selectedCount} matching selected`
                : `Select All ${cardsResponse?.pagination.totalCount ?? 0} Matching`
            }
            onSelectAll={handleSelectAll}
            onClearSelection={() => {
              setSelectedIds(new Set());
              setBulkSelection(null);
            }}
            actions={[
              {
                id: "assign",
                label: "Assign To Location",
                onClick: () => setAssignModalOpen(true),
                variant: "primary",
              },
              {
                id: "return",
                label: returnBusy ? "Returning..." : "Return to Review",
                onClick: handleReturnToReview,
                disabled: returnBusy,
              },
              {
                id: "purge",
                label: purgeBusy ? "Purging..." : "Purge",
                onClick: handlePurge,
                disabled: purgeBusy,
                variant: "danger",
              },
            ]}
          />
        ) : null}

        <CardGrid
          cards={visibleCards}
          selectedIds={selectedIds}
          loading={cardsLoading}
          onToggleCard={toggleCard}
          emptyState={
            <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
              <h2 className="font-heading text-3xl uppercase tracking-[0.12em] text-white">No cards in inventory</h2>
              <p className="max-w-xl text-sm text-slate-400">
                Cards appear here after they pass KingsReview. Currently 0 cards are ready for assignment.
              </p>
              <Link
                href="/admin/kingsreview"
                className="rounded-full border border-gold-400/50 px-5 py-3 text-[11px] uppercase tracking-[0.24em] text-gold-100 transition hover:border-gold-300 hover:text-white"
              >
                Go to KingsReview
              </Link>
            </div>
          }
        />

        {cardsResponse ? (
          <PaginationBar
            page={cardsResponse.pagination.page}
            pageSize={cardsResponse.pagination.pageSize}
            totalCount={cardsResponse.pagination.totalCount}
            totalPages={cardsResponse.pagination.totalPages}
            onChange={(page) => void syncQuery({ page })}
          />
        ) : null}
      </div>

      <button
        type="button"
        disabled
        className="fixed bottom-6 right-6 rounded-full border border-gold-400/45 bg-gold-500/85 px-5 py-3 text-[11px] uppercase tracking-[0.24em] text-night-950 shadow-[0_18px_40px_rgba(0,0,0,0.35)] opacity-80"
      >
        Auto-Fill Packs
      </button>

      {assignModalOpen ? (
        <AssignToLocationModal
          selectedCount={selectedCount}
          totalValue={selectedTotalValue}
          selectedCategories={selectedCategories}
          locations={filterOptions?.locations ?? []}
          values={assignForm}
          busy={assignBusy}
          error={assignError}
          onChange={(patch) => setAssignForm((current) => ({ ...current, ...patch }))}
          onClose={() => {
            setAssignModalOpen(false);
            setAssignError(null);
          }}
          onAssign={handleAssign}
        />
      ) : null}
    </AppShell>
  );
}
