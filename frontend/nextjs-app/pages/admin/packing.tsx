import Head from "next/head";
import Image from "next/image";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import AppShell from "../../components/AppShell";
import { useSession } from "../../hooks/useSession";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../constants/admin";
import { buildAdminHeaders } from "../../lib/adminHeaders";
import { BatchStage, PackFulfillmentStatus, QrCodeState } from "@tenkings/database";

const ONLINE_OPTION = "ONLINE";

type PackCounts = {
  total: number;
  ready: number;
  packed: number;
  loaded: number;
};

type StageBatchSummary = {
  id: string;
  label: string | null;
  stage: BatchStage;
  notes: string | null;
  tags: string[];
  stageChangedAt: string | null;
  createdAt: string;
  updatedAt: string;
  counts: PackCounts;
  locations: Array<{
    id: string | null;
    name: string;
    counts: PackCounts;
  }>;
  latestEvents: Array<{
    id: string;
    stage: BatchStage;
    createdAt: string;
    note: string | null;
    actor: { id: string; label: string } | null;
  }>;
};

type StageColumnSummary = {
  id: BatchStage;
  label: string;
  description: string;
  totals: {
    batches: number;
    packs: number;
  };
  batches: StageBatchSummary[];
};

type StageStatsResponse = {
  stageOrder: BatchStage[];
  stages: StageColumnSummary[];
  timeline: TimelineEvent[];
};

type TimelineEvent = {
  id: string;
  batchId: string;
  batchLabel: string | null;
  stage: BatchStage;
  createdAt: string;
  note: string | null;
  actor: { id: string; label: string } | null;
};

type QrSummary = {
  id: string;
  code: string;
  serial: string | null;
  payloadUrl: string | null;
  state: QrCodeState;
};

type PackRow = {
  id: string;
  createdAt: string;
  fulfillmentStatus: PackFulfillmentStatus;
  packQrCodeId: string | null;
  packDefinition: {
    id: string;
    name: string;
    tier: string;
  } | null;
  item: {
    id: string;
    name: string | null;
    imageUrl: string | null;
    cardQrCodeId: string | null;
  } | null;
  label: {
    id: string;
    status: string;
    pairId: string;
    card: QrSummary;
    pack: QrSummary;
  } | null;
};

type BatchDetail = {
  id: string;
  label: string | null;
  notes: string | null;
  tags: string[];
  stage: BatchStage;
  stageChangedAt: string | null;
  createdAt: string;
  updatedAt: string;
  counts: PackCounts;
  latestEvents: Array<{
    id: string;
    stage: BatchStage;
    createdAt: string;
    note: string | null;
    actor: { id: string; label: string } | null;
  }>;
  packs: PackRow[];
};

type LocationResponse = {
  batches: BatchDetail[];
};

type LabelDownload = {
  url: string;
  filename: string;
};

type LabelStyle = "generic" | "premier";

type ViewMode = "tracker" | "timeline";

type StatusMessage = {
  type: "success" | "error";
  message: string;
};

const stageColorMap: Record<BatchStage, string> = {
  [BatchStage.INVENTORY_READY]: "border-sky-400/50 text-sky-200",
  [BatchStage.PACKING]: "border-emerald-400/50 text-emerald-200",
  [BatchStage.PACKED]: "border-gold-500/50 text-gold-200",
  [BatchStage.SHIPPING_READY]: "border-amber-400/50 text-amber-200",
  [BatchStage.SHIPPING_SHIPPED]: "border-amber-500/50 text-amber-100",
  [BatchStage.SHIPPING_RECEIVED]: "border-indigo-400/50 text-indigo-200",
  [BatchStage.LOADED]: "border-purple-400/50 text-purple-200",
};

const stageOptions: BatchStage[] = [
  BatchStage.INVENTORY_READY,
  BatchStage.PACKING,
  BatchStage.PACKED,
  BatchStage.SHIPPING_READY,
  BatchStage.SHIPPING_SHIPPED,
  BatchStage.SHIPPING_RECEIVED,
  BatchStage.LOADED,
];

const stageLabel = (stage: BatchStage) => {
  switch (stage) {
    case BatchStage.INVENTORY_READY:
      return "Inventory Ready";
    case BatchStage.PACKING:
      return "Packing";
    case BatchStage.PACKED:
      return "Packed";
    case BatchStage.SHIPPING_READY:
      return "Shipping Ready";
    case BatchStage.SHIPPING_SHIPPED:
      return "Shipped";
    case BatchStage.SHIPPING_RECEIVED:
      return "Received";
    case BatchStage.LOADED:
      return "Loaded";
    default:
      return stage;
  }
};

const stageDescription = (stage: BatchStage) => {
  switch (stage) {
    case BatchStage.INVENTORY_READY:
      return "Waiting on labels or packing.";
    case BatchStage.PACKING:
      return "Packing ops in progress.";
    case BatchStage.PACKED:
      return "Sealed and ready for shipping.";
    case BatchStage.SHIPPING_READY:
      return "Queued to ship to the field.";
    case BatchStage.SHIPPING_SHIPPED:
      return "In transit to the kiosk operator.";
    case BatchStage.SHIPPING_RECEIVED:
      return "Shipment received on site.";
    case BatchStage.LOADED:
      return "Inventory confirmed inside kiosk.";
    default:
      return "";
  }
};

const formatDate = (iso: string | null) => {
  if (!iso) return "";
  const date = new Date(iso);
  return date.toLocaleString();
};

const formatRelative = (iso: string | null) => {
  if (!iso) return "";
  const now = Date.now();
  const target = new Date(iso).getTime();
  const diff = now - target;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return "Just now";
  if (diff < hour) return `${Math.round(diff / minute)} min ago`;
  if (diff < day) return `${Math.round(diff / hour)} hr ago`;
  return `${Math.round(diff / day)} day${diff / day >= 2 ? "s" : ""} ago`;
};

const QrCanvas = ({ value }: { value: string }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const draw = async () => {
      if (!canvasRef.current) return;
      try {
        await QRCode.toCanvas(canvasRef.current, value, {
          width: 120,
          margin: 1,
          errorCorrectionLevel: "M",
        });
      } catch (error) {
        console.error("Failed to render QR code", error);
      }
    };
    void draw();
  }, [value]);

  return <canvas ref={canvasRef} className="h-28 w-28 rounded-xl border border-white/10 bg-night-900" />;
};

export default function AdminPackingConsole() {
  const { session, loading, ensureSession, logout } = useSession();

  const [stageOrder, setStageOrder] = useState<BatchStage[]>([]);
  const [stageColumns, setStageColumns] = useState<StageColumnSummary[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);

  const [selectedStageId, setSelectedStageId] = useState<BatchStage | null>(null);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState<string>(ONLINE_OPTION);
  const [pendingLocationId, setPendingLocationId] = useState<string>(ONLINE_OPTION);

  const [batchDetail, setBatchDetail] = useState<BatchDetail | null>(null);
  const [selectedPackIds, setSelectedPackIds] = useState<string[]>([]);
  const [stageMoveValue, setStageMoveValue] = useState<BatchStage | "">("");
  const [stageMoveSubmitting, setStageMoveSubmitting] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<ViewMode>("tracker");

  const [activePackId, setActivePackId] = useState<string | null>(null);
  const [cardCode, setCardCode] = useState("");
  const [packCode, setPackCode] = useState("");
  const [cardStatus, setCardStatus] = useState<StatusMessage | null>(null);
  const [packStatus, setPackStatus] = useState<StatusMessage | null>(null);

  const [printSubmitting, setPrintSubmitting] = useState(false);
  const [printSubmittingStyle, setPrintSubmittingStyle] = useState<LabelStyle | null>(null);
  const [printDownload, setPrintDownload] = useState<LabelDownload | null>(null);
  const downloadUrlRef = useRef<string | null>(null);
  const skipAutoFetchRef = useRef(false);
  const [reassignSubmitting, setReassignSubmitting] = useState(false);

  useEffect(() => {
    if (downloadUrlRef.current) {
      return () => {
        URL.revokeObjectURL(downloadUrlRef.current!);
        downloadUrlRef.current = null;
      };
    }
    return undefined;
  }, []);

  useEffect(() => {
    ensureSession().catch(() => undefined);
  }, [ensureSession]);

  const isAdmin = useMemo(
    () => hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone),
    [session?.user.id, session?.user.phone]
  );

  const adminHeaders = useCallback(
    () => buildAdminHeaders(session?.token, { "Content-Type": "application/json" }),
    [session?.token]
  );

  const fetchStats = useCallback(async () => {
    if (!session?.token || !isAdmin) {
      return;
    }
    setStatsLoading(true);
    setStatsError(null);
    try {
      const res = await fetch("/api/admin/packing/stats", {
        headers: buildAdminHeaders(session.token),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? "Failed to load packing stats");
      }
      const data = (await res.json()) as StageStatsResponse;
      setStageOrder(data.stageOrder);
      setStageColumns(data.stages);
      setTimeline(data.timeline);
      const firstStageWithBatches = data.stageOrder.find((stage) => {
        const column = data.stages.find((entry) => entry.id === stage);
        return column && column.batches.length > 0;
      });
      setSelectedStageId((current) => current ?? firstStageWithBatches ?? data.stageOrder[0] ?? null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load packing stats";
      setStatsError(message);
    } finally {
      setStatsLoading(false);
    }
  }, [isAdmin, session?.token]);

  useEffect(() => {
    if (!session?.token || !isAdmin) {
      return;
    }
    void fetchStats();
  }, [fetchStats, isAdmin, session?.token]);

  const selectedStageColumn = useMemo(() => {
    if (!selectedStageId) {
      return null;
    }
    return stageColumns.find((column) => column.id === selectedStageId) ?? null;
  }, [selectedStageId, stageColumns]);

  useEffect(() => {
    if (!selectedStageColumn) {
      setSelectedBatchId(null);
      return;
    }
    if (selectedStageColumn.batches.length === 0) {
      setSelectedBatchId(null);
      return;
    }
    setSelectedBatchId((current) => {
      if (current && selectedStageColumn.batches.some((batch) => batch.id === current)) {
        return current;
      }
      return selectedStageColumn.batches[0]?.id ?? null;
    });
  }, [selectedStageColumn]);

  useEffect(() => {
    if (!selectedBatchId || !selectedStageColumn) {
      setSelectedLocationId(ONLINE_OPTION);
      return;
    }
    const batch = selectedStageColumn.batches.find((entry) => entry.id === selectedBatchId);
    if (!batch || batch.locations.length === 0) {
      setSelectedLocationId(ONLINE_OPTION);
      return;
    }
    const primary = batch.locations.find((loc) => loc.id !== null && loc.counts.total > 0) ?? batch.locations[0];
    setSelectedLocationId(primary.id ?? ONLINE_OPTION);
  }, [selectedBatchId, selectedStageColumn]);

  useEffect(() => {
    setPendingLocationId(selectedLocationId);
  }, [selectedLocationId]);

  const fetchBatchDetail = useCallback(
    async (overrideLocationId?: string, options?: { preserveStatus?: boolean }) => {
      if (!session?.token || !isAdmin || !selectedBatchId) {
        setBatchDetail(null);
        return;
      }
      const locationForRequest = overrideLocationId ?? selectedLocationId ?? ONLINE_OPTION;
      setLocationLoading(true);
      setLocationError(null);
      try {
        const params = new URLSearchParams();
        params.set("locationId", locationForRequest);
        params.set("batchId", selectedBatchId);
        const res = await fetch(`/api/admin/packing/location?${params.toString()}`, {
          headers: buildAdminHeaders(session.token),
        });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.message ?? "Failed to load batch detail");
      }
      const data = (await res.json()) as LocationResponse;
      const detail = data.batches[0] ?? null;

      if (downloadUrlRef.current) {
        URL.revokeObjectURL(downloadUrlRef.current);
        downloadUrlRef.current = null;
      }
      setPrintDownload(null);

      setBatchDetail(detail);
      const firstReadyPack = detail?.packs.find((pack) => pack.fulfillmentStatus === PackFulfillmentStatus.READY_FOR_PACKING);
      const fallbackPack = detail?.packs[0] ?? null;
      setActivePackId(firstReadyPack?.id ?? fallbackPack?.id ?? null);
      setCardCode("");
      setPackCode("");
      if (!options?.preserveStatus) {
        setCardStatus(null);
        setPackStatus(null);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load batch detail";
      setLocationError(message);
      setBatchDetail(null);
    } finally {
      setLocationLoading(false);
    }
    }, [buildAdminHeaders, isAdmin, selectedBatchId, selectedLocationId, session?.token]);

  useEffect(() => {
    if (!session?.token || !isAdmin) {
      return;
    }
    if (skipAutoFetchRef.current) {
      skipAutoFetchRef.current = false;
      return;
    }
    void fetchBatchDetail();
  }, [fetchBatchDetail, isAdmin, session?.token]);

  useEffect(() => {
    if (!batchDetail) {
      setSelectedPackIds([]);
      return;
    }
    setSelectedPackIds((previous) => {
      if (!previous.length) {
        return batchDetail.packs.map((pack) => pack.id);
      }
      const available = batchDetail.packs.map((pack) => pack.id);
      const retained = available.filter((id) => previous.includes(id));
      return retained.length > 0 ? retained : available;
    });
  }, [batchDetail]);

  const activePack = useMemo(() => {
    if (!batchDetail || !activePackId) {
      return null;
    }
    return batchDetail.packs.find((pack) => pack.id === activePackId) ?? null;
  }, [activePackId, batchDetail]);

  const cardIsBound = useMemo(() => {
    if (!activePack || !activePack.item || !activePack.label) {
      return false;
    }
    return (
      activePack.item.cardQrCodeId === activePack.label.card.id && activePack.label.card.state === QrCodeState.BOUND
    );
  }, [activePack]);

  const packIsBound = useMemo(() => {
    if (!activePack || !activePack.label) {
      return false;
    }
    return activePack.packQrCodeId === activePack.label.pack.id && activePack.label.pack.state === QrCodeState.BOUND;
  }, [activePack]);

  const locationOptions = useMemo(() => {
    const options: Array<{ value: string; label: string }> = [];
    const seen = new Set<string>();

    const addOption = (value: string, label: string) => {
      if (seen.has(value)) {
        return;
      }
      options.push({ value, label });
      seen.add(value);
    };

    addOption(ONLINE_OPTION, "Online pool");

    if (selectedStageColumn && batchDetail) {
      const stageBatch = selectedStageColumn.batches.find((entry) => entry.id === batchDetail.id);
      stageBatch?.locations.forEach((location) => {
        const value = location.id ?? ONLINE_OPTION;
        const label =
          location.id === null
            ? "Online pool"
            : `${location.name}${location.counts.total > 0 ? ` · ${location.counts.total}` : ""}`;
        addOption(value, label);
      });
    }

    if (!seen.has(selectedLocationId)) {
      addOption(
        selectedLocationId,
        selectedLocationId === ONLINE_OPTION ? "Online pool" : "Current location"
      );
    }

    return options;
  }, [batchDetail, selectedLocationId, selectedStageColumn]);

  useEffect(() => {
    if (locationOptions.length > 0 && !locationOptions.some((option) => option.value === pendingLocationId)) {
      setPendingLocationId(locationOptions[0].value);
    }
  }, [locationOptions, pendingLocationId]);

  const registerDownload = useCallback((base64: string, filename: string) => {
    if (downloadUrlRef.current) {
      URL.revokeObjectURL(downloadUrlRef.current);
      downloadUrlRef.current = null;
    }
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    downloadUrlRef.current = url;
    setPrintDownload({ url, filename });
    if (typeof window !== "undefined") {
      const tempLink = document.createElement("a");
      tempLink.href = url;
      tempLink.download = filename;
      tempLink.rel = "noopener";
      document.body.appendChild(tempLink);
      tempLink.click();
      document.body.removeChild(tempLink);
    }
  }, []);

  const togglePackSelection = useCallback((packId: string) => {
    setSelectedPackIds((previous) =>
      previous.includes(packId) ? previous.filter((id) => id !== packId) : [...previous, packId]
    );
  }, []);

  const selectAllPacks = useCallback(() => {
    if (!batchDetail) {
      return;
    }
    setSelectedPackIds(batchDetail.packs.map((pack) => pack.id));
  }, [batchDetail]);

  const clearPackSelection = useCallback(() => {
    setSelectedPackIds([]);
  }, []);

  const handleDownloadLabels = useCallback(async (style: LabelStyle) => {
    if (!batchDetail || !session?.token || !isAdmin) {
      return;
    }
    if (selectedPackIds.length === 0) {
      setPackStatus({ type: "error", message: "Select at least one pack before downloading labels." });
      return;
    }

    const labelIds = batchDetail.packs
      .filter((pack) => selectedPackIds.includes(pack.id))
      .map((pack) => pack.label?.id)
      .filter((value): value is string => Boolean(value));
    if (labelIds.length === 0) {
      setPackStatus({ type: "error", message: "No labels available to print yet." });
      return;
    }

    setPrintSubmitting(true);
    setPrintSubmittingStyle(style);
    setPackStatus(null);
    try {
      const res = await fetch("/api/admin/packing/labels/print", {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({ labelIds, style }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.message ?? "Failed to generate label sheet");
      }
      const payload = await res.json();
      registerDownload(payload.pdf, payload.filename);
      setPackStatus({
        type: "success",
        message: `${style === "premier" ? "Premier" : "Generic"} label sheet ready. Downloading now.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to generate label sheet";
      setPackStatus({ type: "error", message });
    } finally {
      setPrintSubmitting(false);
      setPrintSubmittingStyle(null);
    }
  }, [adminHeaders, batchDetail, isAdmin, registerDownload, selectedPackIds, session?.token]);

  const handleMoveStage = useCallback(async () => {
    if (!batchDetail || !session?.token || !isAdmin) {
      return;
    }
    if (!stageMoveValue) {
      setPackStatus({ type: "error", message: "Select a stage before moving packs." });
      return;
    }
    if (selectedPackIds.length === 0) {
      setPackStatus({ type: "error", message: "Select at least one pack to move." });
      return;
    }

    setStageMoveSubmitting(true);
    setPackStatus(null);
    try {
      const res = await fetch("/api/admin/packing/stage", {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({
          stage: stageMoveValue,
          packIds: selectedPackIds,
          batchId: batchDetail.id,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        throw new Error(payload?.message ?? "Failed to move packs");
      }
      setPackStatus({
        type: "success",
        message: payload?.message ?? "Stage updated successfully.",
      });
      setStageMoveValue("");
      clearPackSelection();
      await refreshAllData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to move packs";
      setPackStatus({ type: "error", message });
    } finally {
      setStageMoveSubmitting(false);
    }
  }, [adminHeaders, batchDetail, clearPackSelection, isAdmin, refreshAllData, selectedPackIds, session?.token, stageMoveValue]);

  const handleReassignLocation = useCallback(async () => {
    if (!batchDetail || !session?.token || !isAdmin) {
      return;
    }
    if (pendingLocationId === selectedLocationId) {
      setPackStatus({ type: "success", message: "Batch already assigned to that location." });
      return;
    }

    setReassignSubmitting(true);
    setPackStatus(null);
    try {
      const res = await fetch("/api/admin/packing/location", {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({
          batchId: batchDetail.id,
          locationId: pendingLocationId === ONLINE_OPTION ? null : pendingLocationId,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.message ?? "Failed to update location");
      }

      skipAutoFetchRef.current = true;
      setSelectedLocationId(pendingLocationId);
      await fetchBatchDetail(pendingLocationId, { preserveStatus: true });
      await fetchStats();

      setPackStatus({
        type: "success",
        message:
          pendingLocationId === ONLINE_OPTION
            ? "Batch returned to the online pool."
            : "Batch moved to the selected location.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update location";
      setPackStatus({ type: "error", message });
    } finally {
      setReassignSubmitting(false);
    }
  }, [adminHeaders, batchDetail, fetchBatchDetail, fetchStats, isAdmin, pendingLocationId, selectedLocationId, session?.token]);

  const refreshAllData = useCallback(async () => {
    await Promise.all([fetchStats(), fetchBatchDetail()]);
  }, [fetchBatchDetail, fetchStats]);

  const handleCardSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!activePack || !activePack.item || !cardCode.trim() || !session?.token || !isAdmin) {
        return;
      }
      setCardStatus(null);
      try {
        const res = await fetch("/api/admin/packing/scan-card", {
          method: "POST",
          headers: adminHeaders(),
          body: JSON.stringify({ code: cardCode.trim(), itemId: activePack.item.id }),
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload?.message ?? "Failed to bind card QR");
        }
        const payload = await res.json();
        setCardStatus({
          type: "success",
          message: `Card QR ${payload.qrCode.serial ?? payload.qrCode.code} bound successfully`,
        });
        setCardCode("");
        await fetchBatchDetail();
        await fetchStats();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to bind card QR";
        setCardStatus({ type: "error", message });
      }
    },
    [activePack, adminHeaders, cardCode, fetchBatchDetail, fetchStats, isAdmin, session?.token]
  );

  const handlePackSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!activePack || !batchDetail || !packCode.trim() || !session?.token || !isAdmin) {
        return;
      }
      if (!batchDetail || selectedLocationId === ONLINE_OPTION) {
        setPackStatus({ type: "error", message: "Assign the batch to a physical location before sealing." });
        return;
      }
      setPackStatus(null);
      try {
        const res = await fetch("/api/admin/packing/scan-pack", {
          method: "POST",
          headers: adminHeaders(),
          body: JSON.stringify({
            code: packCode.trim(),
            packInstanceId: activePack.id,
            locationId: selectedLocationId,
          }),
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload?.message ?? "Failed to seal pack");
        }
        const payload = await res.json();
        setPackStatus({
          type: "success",
          message: `Pack ${payload.qrCode.serial ?? payload.qrCode.code} sealed`,
        });
        setPackCode("");
        await refreshAllData();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to seal pack";
        setPackStatus({ type: "error", message });
      }
    },
    [activePack, adminHeaders, batchDetail, isAdmin, packCode, refreshAllData, selectedLocationId, session?.token]
  );

  const hasAccess = !loading && isAdmin;

  const timelineByStage = useMemo(() => {
    const grouped = new Map<BatchStage, TimelineEvent[]>();
    for (const entry of timeline) {
      if (!grouped.has(entry.stage)) {
        grouped.set(entry.stage, []);
      }
      grouped.get(entry.stage)!.push(entry);
    }
    return grouped;
  }, [timeline]);

  return (
    <AppShell>
      <Head>
        <title>Operations Console · Ten Kings</title>
      </Head>

      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-10">
        <header className="flex flex-col gap-3">
          <p className="text-xs uppercase tracking-[0.32em] text-slate-400">Operations</p>
          <h1 className="font-heading text-3xl uppercase tracking-[0.18em] text-white">Packing & Inventory Console</h1>
          <p className="max-w-3xl text-sm text-slate-300">
            Monitor batches across the pipeline, generate slab labels, and seal packs for kiosk delivery. Toggle the timeline view to
            visualize every batch moving from upload to loaded-on-site.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setViewMode("tracker")}
              className={`rounded-full border px-4 py-2 text-xs uppercase tracking-[0.32em] transition ${
                viewMode === "tracker"
                  ? "border-emerald-400/60 bg-emerald-500/20 text-emerald-200"
                  : "border-white/20 text-slate-300 hover:border-white/40 hover:text-white"
              }`}
            >
              Stage Tracker
            </button>
            <button
              type="button"
              onClick={() => setViewMode("timeline")}
              className={`rounded-full border px-4 py-2 text-xs uppercase tracking-[0.32em] transition ${
                viewMode === "timeline"
                  ? "border-sky-400/60 bg-sky-500/20 text-sky-200"
                  : "border-white/20 text-slate-300 hover:border-white/40 hover:text-white"
              }`}
            >
              Timeline
            </button>
            <button
              type="button"
              onClick={() => void fetchStats()}
              className="rounded-full border border-white/20 px-4 py-2 text-xs uppercase tracking-[0.32em] text-slate-200 transition hover:border-white/40 hover:text-white"
            >
              Refresh Stats
            </button>
          </div>
        </header>

        {!hasAccess && (
          <div className="rounded-3xl border border-rose-400/40 bg-rose-500/10 p-6 text-sm text-rose-200">
            <p>Admin access is required. Ask a platform administrator to grant permissions to your account.</p>
            <button
              type="button"
              onClick={logout}
              className="mt-4 inline-flex items-center justify-center rounded-full border border-rose-400/40 px-5 py-2 text-xs uppercase tracking-[0.32em] text-rose-200 transition hover:border-rose-300 hover:text-rose-100"
            >
              Sign Out
            </button>
          </div>
        )}

        {hasAccess && (
          <>
            {statsError && (
              <div className="rounded-3xl border border-rose-400/40 bg-rose-500/10 p-4 text-sm text-rose-200">
                {statsError}
              </div>
            )}

            {viewMode === "tracker" && (
              <section className="grid gap-4 lg:grid-cols-3 xl:grid-cols-4">
                {stageOrder.map((stage) => {
                  const column = stageColumns.find((entry) => entry.id === stage);
                  const isSelected = stage === selectedStageId;
                  return (
                    <button
                      key={stage}
                      type="button"
                      onClick={() => {
                        setSelectedStageId(stage);
                        setSelectedBatchId(null);
                      }}
                      className={`flex h-full flex-col rounded-3xl border p-5 text-left transition ${
                        isSelected ? "border-white/60 bg-night-900/70" : "border-white/15 bg-night-900/40 hover:border-white/30"
                      }`}
                    >
                      <p className={`text-[11px] uppercase tracking-[0.32em] ${stageColorMap[stage]}`}>{stageLabel(stage)}</p>
                      <h3 className="mt-2 text-2xl font-semibold text-white">{column?.totals.batches ?? 0} batch{(column?.totals.batches ?? 0) === 1 ? "" : "es"}</h3>
                      <p className="text-sm text-slate-300">{column?.totals.packs ?? 0} packs</p>
                      <p className="mt-3 text-xs text-slate-400">{stageDescription(stage)}</p>
                    </button>
                  );
                })}
              </section>
            )}

            {viewMode === "timeline" && (
              <section className="rounded-3xl border border-white/10 bg-night-900/60 p-6">
                <h2 className="text-sm uppercase tracking-[0.3em] text-slate-400">Recent Stage Activity</h2>
                {timeline.length === 0 ? (
                  <p className="mt-3 text-sm text-slate-300">No stage changes recorded yet.</p>
                ) : (
                  <div className="mt-4 grid gap-4">
                    {stageOrder.map((stage) => {
                      const events = timelineByStage.get(stage) ?? [];
                      if (events.length === 0) {
                        return null;
                      }
                      return (
                        <div key={`timeline-${stage}`} className="rounded-2xl border border-white/10 bg-night-900/70 p-4">
                          <p className={`text-[11px] uppercase tracking-[0.32em] ${stageColorMap[stage]}`}>{stageLabel(stage)}</p>
                          <ul className="mt-3 space-y-2">
                            {events.slice(0, 10).map((event) => (
                              <li key={event.id} className="rounded-xl border border-white/10 bg-night-900/60 px-3 py-2 text-xs text-slate-200">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div>
                                    <p className="font-semibold uppercase tracking-[0.2em] text-white">
                                      {event.batchLabel ?? event.batchId.slice(0, 8)}
                                    </p>
                                    <p className="text-[10px] text-slate-400">{formatRelative(event.createdAt)}</p>
                                  </div>
                                  <div className="text-right text-[10px] text-slate-400">
                                    {event.actor ? <p>{event.actor.label}</p> : <p>Automated</p>}
                                  </div>
                                </div>
                                {event.note && <p className="mt-2 text-[10px] text-slate-300">{event.note}</p>}
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            )}

            {viewMode === "tracker" && selectedStageColumn && (
              <section className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
                <div className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-night-900/60 p-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.32em] text-slate-400">Batches in {stageLabel(selectedStageColumn.id)}</p>
                      <h2 className="font-heading text-xl uppercase tracking-[0.2em] text-white">
                        {selectedStageColumn.label}
                      </h2>
                    </div>
                    {selectedStageColumn.batches.length > 0 && (
                      <div className="text-right text-xs text-slate-400">
                        <p>{selectedStageColumn.batches.length} active batch{selectedStageColumn.batches.length === 1 ? "" : "es"}</p>
                        <p>{selectedStageColumn.totals.packs} packs total</p>
                      </div>
                    )}
                  </div>

                  {statsLoading && <p className="text-sm text-slate-400">Loading batches…</p>}

                  {!statsLoading && selectedStageColumn.batches.length === 0 && (
                    <p className="text-sm text-slate-400">No batches in this stage yet.</p>
                  )}

                  {!statsLoading && selectedStageColumn.batches.length > 0 && (
                    <div className="grid gap-3">
                      {selectedStageColumn.batches.map((batch) => {
                        const isActive = batch.id === selectedBatchId;
                        return (
                          <button
                            key={batch.id}
                            type="button"
                            onClick={() => setSelectedBatchId(batch.id)}
                            className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                              isActive ? "border-white/50 bg-night-900/80" : "border-white/15 bg-night-900/50 hover:border-white/30"
                            }`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                                  {batch.label ?? batch.id.slice(0, 8)}
                                </p>
                                <p className="text-sm text-slate-300">
                                  {batch.counts.total} pack{batch.counts.total === 1 ? "" : "s"} · {batch.tags.join(", ") || "No tags"}
                                </p>
                              </div>
                              <div className="text-right text-xs text-slate-400">
                                <p>Updated {formatRelative(batch.stageChangedAt ?? batch.updatedAt)}</p>
                                {batch.notes && <p className="text-[10px] text-slate-300">“{batch.notes}”</p>}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-night-900/60 p-6">
                  <p className="text-[11px] uppercase tracking-[0.32em] text-slate-400">Stage History</p>
                  {selectedStageColumn.batches.length === 0 && <p className="text-sm text-slate-400">Select a stage to view history.</p>}
                  {selectedStageColumn.batches.length > 0 && (
                    <ul className="space-y-3 overflow-auto">
                      {(selectedStageColumn.batches.find((batch) => batch.id === selectedBatchId)?.latestEvents ?? []).map((event) => (
                        <li key={event.id} className="rounded-2xl border border-white/10 bg-night-900/70 p-3 text-xs text-slate-200">
                          <div className="flex items-center justify-between gap-3">
                            <span className={`text-[10px] uppercase tracking-[0.3em] ${stageColorMap[event.stage]}`}>
                              {stageLabel(event.stage)}
                            </span>
                            <span className="text-[10px] text-slate-400">{formatRelative(event.createdAt)}</span>
                          </div>
                          {event.actor && <p className="mt-1 text-[10px] text-slate-400">{event.actor.label}</p>}
                          {event.note && <p className="mt-2 text-[10px] text-slate-300">{event.note}</p>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>
            )}

            {viewMode === "tracker" && batchDetail && (
              <section className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-night-900/60 p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.32em] text-slate-400">Batch Overview</p>
                    <h2 className="font-heading text-2xl uppercase tracking-[0.2em] text-white">
                      {batchDetail.label ?? batchDetail.id.slice(0, 8)}
                    </h2>
                    <p className="text-xs text-slate-400">{batchDetail.counts.total} pack{batchDetail.counts.total === 1 ? "" : "s"} queued in this location.</p>
                  </div>
                  <div className="text-right text-xs text-slate-400">
                    <p>Created {formatDate(batchDetail.createdAt)}</p>
                    <p>Updated {formatRelative(batchDetail.updatedAt)}</p>
                    {batchDetail.notes && <p className="mt-1 text-slate-300">Note: {batchDetail.notes}</p>}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {(batchDetail.tags.length > 0 ? batchDetail.tags : ["No tags assigned"]).map((tag, index) => (
                    <span
                      key={`${batchDetail.id}-tag-${index}`}
                      className="rounded-full border border-white/15 px-3 py-1 text-[10px] uppercase tracking-[0.3em] text-slate-200"
                    >
                      {tag}
                    </span>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  {batchDetail.counts.ready > 0 && (
                    <span className="rounded-full border border-sky-400/40 bg-sky-500/20 px-3 py-1 text-[11px] uppercase tracking-[0.3em] text-sky-200">
                      Ready {batchDetail.counts.ready}
                    </span>
                  )}
                  {batchDetail.counts.packed > 0 && (
                    <span className="rounded-full border border-gold-500/40 bg-gold-500/20 px-3 py-1 text-[11px] uppercase tracking-[0.3em] text-gold-200">
                      Packed {batchDetail.counts.packed}
                    </span>
                  )}
                  {batchDetail.counts.loaded > 0 && (
                    <span className="rounded-full border border-purple-400/40 bg-purple-500/20 px-3 py-1 text-[11px] uppercase tracking-[0.3em] text-purple-200">
                      Loaded {batchDetail.counts.loaded}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-xs uppercase tracking-[0.3em] text-slate-400">Packing Location</span>
                  <div className="flex flex-wrap gap-2">
                    {(selectedStageColumn?.batches.find((batch) => batch.id === batchDetail.id)?.locations ?? []).map((location) => {
                      const value = location.id ?? ONLINE_OPTION;
                      const isSelected = value === selectedLocationId;
                      return (
                        <button
                          key={`${batchDetail.id}-${value}`}
                          type="button"
                          onClick={() => setSelectedLocationId(value)}
                          className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.3em] transition ${
                            isSelected
                              ? "border-white/50 bg-night-900/80 text-white"
                              : "border-white/15 text-slate-300 hover:border-white/30 hover:text-white"
                          }`}
                        >
                          {location.name} · {location.counts.total}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {locationOptions.length > 0 && (
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-xs uppercase tracking-[0.3em] text-slate-400">Move batch</span>
                    <select
                      value={pendingLocationId}
                      onChange={(event) => setPendingLocationId(event.currentTarget.value)}
                      className="rounded-full border border-white/20 bg-night-900/80 px-4 py-2 text-xs uppercase tracking-[0.28em] text-slate-200 outline-none transition focus:border-emerald-400/60"
                    >
                      {locationOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => void handleReassignLocation()}
                      disabled={reassignSubmitting || pendingLocationId === selectedLocationId}
                      className="inline-flex items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-500/20 px-5 py-2 text-[11px] uppercase tracking-[0.32em] text-emerald-200 transition hover:border-emerald-300 hover:text-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {reassignSubmitting ? "Updating…" : "Update location"}
                    </button>
                  </div>
                )}

                {locationError && (
                  <div className="rounded-2xl border border-rose-400/40 bg-rose-500/10 p-3 text-sm text-rose-200">{locationError}</div>
                )}

                {locationLoading && <p className="text-sm text-slate-400">Loading packs for this location…</p>}

                {!locationLoading && batchDetail.packs.length === 0 && (
                  <p className="text-sm text-slate-400">No packs queued at this location yet.</p>
                )}

                {!locationLoading && batchDetail.packs.length > 0 && activePack && (
                  <div className="flex flex-col gap-4">
                    <div className="rounded-2xl border border-white/10 bg-night-900/70 p-4">
                      <p className="text-[11px] uppercase tracking-[0.32em] text-slate-400">Active Pack</p>
                      <h3 className="mt-2 text-lg font-semibold text-white">{activePack.packDefinition?.name ?? "Unassigned"}</h3>
                      <p className="text-xs text-slate-400">Pack ID {activePack.id.slice(0, 8)} • Status {activePack.fulfillmentStatus}</p>
                      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
                        <div className="flex items-start gap-4">
                          {activePack.item?.imageUrl ? (
                            <div className="relative h-32 w-24 overflow-hidden rounded-xl border border-white/10 bg-night-900">
                              <Image src={activePack.item.imageUrl} alt={activePack.item.name ?? "Card"} fill sizes="96px" className="object-cover" />
                            </div>
                          ) : (
                            <div className="flex h-32 w-24 items-center justify-center rounded-xl border border-white/10 bg-night-900 text-xs text-slate-500">
                              No image
                            </div>
                          )}
                          <div>
                            <p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">Card</p>
                            <p className="text-sm text-slate-100">{activePack.item?.name ?? "Pending metadata"}</p>
                            <p className="text-xs text-slate-500">Item {activePack.item?.id.slice(0, 8) ?? "—"}</p>
                            <p className="mt-2 text-xs text-slate-300">
                              {cardIsBound
                                ? `Card QR ${activePack.label?.card.serial ?? activePack.label?.card.code} auto-bound`
                                : "Needs card QR"}
                            </p>
                          </div>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-night-900/60 p-3 text-xs text-slate-200">
                          <p className="text-[11px] uppercase tracking-[0.32em] text-slate-400">Label Pair</p>
                          {activePack.label ? (
                            <div className="mt-2 grid gap-2">
                              <div>
                                <p className="text-[10px] uppercase tracking-[0.3em] text-sky-300">Card QR</p>
                                <p className="text-[11px] text-slate-100">{activePack.label.card.code}</p>
                                <p className="text-[10px] text-slate-500">Serial {activePack.label.card.serial ?? "—"}</p>
                              </div>
                              <div>
                                <p className="text-[10px] uppercase tracking-[0.3em] text-gold-300">Pack QR</p>
                                <p className="text-[11px] text-slate-100">{activePack.label.pack.code}</p>
                                <p className="text-[10px] text-slate-500">Serial {activePack.label.pack.serial ?? "—"}</p>
                              </div>
                            </div>
                          ) : (
                            <p className="text-[10px] text-amber-200">Label will auto-reserve once the card is assigned.</p>
                          )}
                        </div>
                      </div>

                      <div className="mt-4 grid gap-3 lg:grid-cols-2">
                        {cardIsBound ? (
                          <div className="flex flex-col gap-2 rounded-2xl border border-emerald-400/40 bg-emerald-500/10 p-4 text-xs text-emerald-100">
                            <span className="text-[11px] uppercase tracking-[0.3em] text-emerald-200">Card QR bound</span>
                            <p>Card QR {activePack.label?.card.serial ?? activePack.label?.card.code} was automatically bound.</p>
                          </div>
                        ) : (
                          <form onSubmit={handleCardSubmit} className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-night-900/70 p-4">
                            <span className="text-[11px] uppercase tracking-[0.3em] text-slate-400">1. Scan card QR</span>
                            <input
                              type="text"
                              inputMode="text"
                              autoComplete="off"
                              value={cardCode}
                              onChange={(event) => setCardCode(event.currentTarget.value)}
                              className="rounded-2xl border border-white/10 bg-night-800 px-4 py-2 text-sm text-white outline-none transition focus:border-emerald-400/60"
                              placeholder="tkc_…"
                              required
                            />
                            <button
                              type="submit"
                              className="inline-flex items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-500/20 px-5 py-2 text-[11px] uppercase tracking-[0.32em] text-emerald-200 transition hover:border-emerald-300 hover:text-emerald-100"
                            >
                              Bind Card
                            </button>
                            {cardStatus && (
                              <p
                                className={`rounded-2xl border px-3 py-2 text-[11px] uppercase tracking-[0.28em] ${
                                  cardStatus.type === "success"
                                    ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200"
                                    : "border-rose-400/40 bg-rose-500/10 text-rose-200"
                                }`}
                              >
                                {cardStatus.message}
                              </p>
                            )}
                          </form>
                        )}

                        {packIsBound ? (
                          <div className="flex flex-col gap-2 rounded-2xl border border-gold-500/40 bg-gold-500/10 p-4 text-xs text-gold-100">
                            <span className="text-[11px] uppercase tracking-[0.3em] text-gold-100">Pack sealed</span>
                            <p>Pack QR {activePack.label?.pack.serial ?? activePack.label?.pack.code} is sealed and ready.</p>
                          </div>
                        ) : (
                          <form onSubmit={handlePackSubmit} className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-night-900/70 p-4">
                            <span className="text-[11px] uppercase tracking-[0.3em] text-slate-400">2. Seal pack</span>
                            {selectedLocationId === ONLINE_OPTION && (
                              <p className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-[11px] uppercase tracking-[0.28em] text-amber-200">
                                Assign a physical location to auto-seal packs.
                              </p>
                            )}
                            <input
                              type="text"
                              inputMode="text"
                              autoComplete="off"
                              value={packCode}
                              onChange={(event) => setPackCode(event.currentTarget.value)}
                              className="rounded-2xl border border-white/10 bg-night-800 px-4 py-2 text-sm text-white outline-none transition focus:border-gold-400/60"
                              placeholder="tkp_…"
                              required
                            />
                            <button
                              type="submit"
                              className="inline-flex items-center justify-center rounded-full border border-gold-500/40 bg-gold-500/20 px-5 py-2 text-[11px] uppercase tracking-[0.32em] text-gold-200 transition hover:border-gold-400 hover:text-gold-100"
                            >
                              Seal Pack
                            </button>
                            {packStatus && (
                              <p
                                className={`rounded-2xl border px-3 py-2 text-[11px] uppercase tracking-[0.28em] ${
                                  packStatus.type === "success"
                                    ? "border-gold-500/40 bg-gold-500/10 text-gold-100"
                                    : "border-rose-400/40 bg-rose-500/10 text-rose-200"
                                }`}
                              >
                                {packStatus.message}
                              </p>
                            )}
                          </form>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        disabled={printSubmitting}
                        onClick={() => void handleDownloadLabels("generic")}
                        className="inline-flex items-center justify-center rounded-full border border-white/20 px-5 py-2 text-[11px] uppercase tracking-[0.32em] text-slate-200 transition hover:border-white/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {printSubmitting && printSubmittingStyle === "generic"
                          ? "Generating…"
                          : `Download generic (${selectedPackIds.length})`}
                      </button>
                      <button
                        type="button"
                        disabled={printSubmitting}
                        onClick={() => void handleDownloadLabels("premier")}
                        className="inline-flex items-center justify-center rounded-full border border-white/20 px-5 py-2 text-[11px] uppercase tracking-[0.32em] text-slate-200 transition hover:border-white/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {printSubmitting && printSubmittingStyle === "premier"
                          ? "Generating…"
                          : `Download premier (${selectedPackIds.length})`}
                      </button>
                      {printDownload && (
                        <a
                          href={printDownload.url}
                          download={printDownload.filename}
                          className="inline-flex items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-500/20 px-5 py-2 text-[11px] uppercase tracking-[0.32em] text-emerald-200 transition hover:border-emerald-300 hover:text-emerald-100"
                        >
                          Download PDF
                        </a>
                      )}
                      <div className="flex flex-wrap items-center gap-2 rounded-full border border-white/10 px-3 py-1">
                        <select
                          value={stageMoveValue}
                          onChange={(event) => setStageMoveValue(event.target.value as BatchStage | "")}
                          className="rounded-full bg-transparent px-3 py-1 text-[11px] uppercase tracking-[0.3em] text-slate-200 outline-none"
                        >
                          <option value="">Move to stage…</option>
                          {stageOptions.map((option) => (
                            <option key={option} value={option} className="bg-night-900 text-white">
                              {stageLabel(option)}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => void handleMoveStage()}
                          disabled={stageMoveSubmitting || !stageMoveValue || selectedPackIds.length === 0}
                          className="rounded-full border border-white/20 px-4 py-1 text-[11px] uppercase tracking-[0.3em] text-slate-200 transition hover:border-white/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {stageMoveSubmitting ? "Moving…" : "Apply"}
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={selectAllPacks}
                        className="inline-flex items-center justify-center rounded-full border border-white/15 px-4 py-2 text-[11px] uppercase tracking-[0.3em] text-slate-300 transition hover:border-white/30 hover:text-white"
                      >
                        Select all
                      </button>
                      <button
                        type="button"
                        onClick={clearPackSelection}
                        disabled={selectedPackIds.length === 0}
                        className="inline-flex items-center justify-center rounded-full border border-white/15 px-4 py-2 text-[11px] uppercase tracking-[0.3em] text-slate-300 transition hover:border-white/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Clear
                      </button>
                      <span className="text-[11px] uppercase tracking-[0.3em] text-slate-400">
                        {selectedPackIds.length} / {batchDetail.packs.length} selected
                      </span>
                    </div>

                    <div className="grid gap-4">
                      {batchDetail.packs.map((pack) => {
                        const isActive = pack.id === activePackId;
                        const isSelected = selectedPackIds.includes(pack.id);
                        const cardLabelBound =
                          !!pack.item?.cardQrCodeId &&
                          !!pack.label?.card &&
                          pack.item.cardQrCodeId === pack.label.card.id &&
                          pack.label.card.state === QrCodeState.BOUND;
                        const packLabelBound =
                          !!pack.packQrCodeId &&
                          !!pack.label?.pack &&
                          pack.packQrCodeId === pack.label.pack.id &&
                          pack.label.pack.state === QrCodeState.BOUND;
                        const rowClasses = isActive
                          ? "border-white/60 bg-night-900/80"
                          : isSelected
                            ? "border-sky-400/40 bg-night-900/70"
                            : "border-white/10 bg-night-900/50";

                        return (
                          <div key={pack.id} className={`rounded-2xl border px-4 py-4 transition ${rowClasses}`}>
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="flex items-start gap-3">
                                <input
                                  type="checkbox"
                                  className="mt-1 h-4 w-4 accent-sky-400"
                                  checked={isSelected}
                                  onChange={() => togglePackSelection(pack.id)}
                                  aria-label={`Select pack ${pack.id.slice(0, 8)}`}
                                />
                                <div>
                                  <p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">
                                    {pack.packDefinition?.name ?? "Unassigned definition"}
                                  </p>
                                  <p className="text-xs text-slate-500">Pack {pack.id.slice(0, 10)}</p>
                                  <p className="text-xs text-slate-300">Status {pack.fulfillmentStatus}</p>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => setActivePackId(pack.id)}
                                disabled={isActive}
                                className={`rounded-full border px-4 py-2 text-[11px] uppercase tracking-[0.32em] transition ${
                                  isActive
                                    ? "border-emerald-400/50 bg-emerald-500/10 text-emerald-200"
                                    : "border-white/20 text-slate-200 hover:border-white/40 hover:text-white"
                                }`}
                              >
                                {isActive ? "Active" : "Set active"}
                              </button>
                            </div>
                            <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
                              <div className="flex items-start gap-3">
                                {pack.item?.imageUrl ? (
                                  <div className="relative h-32 w-24 overflow-hidden rounded-xl border border-white/10 bg-night-900">
                                    <Image
                                      src={pack.item.imageUrl}
                                      alt={pack.item.name ?? "Card"}
                                      fill
                                      sizes="120px"
                                      className="object-cover"
                                    />
                                  </div>
                                ) : (
                                  <div className="flex h-32 w-24 items-center justify-center rounded-xl border border-white/10 bg-night-900 text-[10px] text-slate-500">
                                    No image
                                  </div>
                                )}
                                <div>
                                  <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">Card</p>
                                  <p className="text-sm text-slate-100">{pack.item?.name ?? "Pending metadata"}</p>
                                  <p className="text-[10px] text-slate-500">Item {pack.item?.id.slice(0, 10) ?? "—"}</p>
                                  <p className={`mt-2 text-[10px] ${cardLabelBound ? "text-emerald-300" : "text-slate-300"}`}>
                                    {cardLabelBound
                                      ? `Card QR ${pack.label?.card.serial ?? pack.label?.card.code} auto-bound`
                                      : "Needs card QR"}
                                  </p>
                                </div>
                              </div>
                              <div className="rounded-xl border border-white/10 bg-night-900/70 p-3 text-xs text-slate-200">
                                <div className="flex flex-wrap items-center gap-3">
                                  <div>
                                    <p className="text-[10px] uppercase tracking-[0.3em] text-sky-300">Card QR</p>
                                    <p className="text-[11px] text-slate-100">{pack.label?.card.code ?? "Pending"}</p>
                                    <p className="text-[10px] text-slate-500">Serial {pack.label?.card.serial ?? "—"}</p>
                                    <p className={`text-[10px] ${cardLabelBound ? "text-emerald-300" : "text-amber-200"}`}>
                                      {cardLabelBound ? "Bound" : "Reserved"}
                                    </p>
                                  </div>
                                  {pack.label && <QrCanvas value={pack.label.card.payloadUrl ?? pack.label.card.code} />}
                                </div>
                                <div className="mt-3 flex flex-wrap items-center gap-3">
                                  <div>
                                    <p className="text-[10px] uppercase tracking-[0.3em] text-gold-300">Pack QR</p>
                                    <p className="text-[11px] text-slate-100">{pack.label?.pack.code ?? "Pending"}</p>
                                    <p className="text-[10px] text-slate-500">Serial {pack.label?.pack.serial ?? "—"}</p>
                                    <p className={`text-[10px] ${packLabelBound ? "text-emerald-300" : "text-amber-200"}`}>
                                      {packLabelBound ? "Bound" : "Reserved"}
                                    </p>
                                  </div>
                                  {pack.label && <QrCanvas value={pack.label.pack.payloadUrl ?? pack.label.pack.code} />}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {viewMode === "tracker" && !batchDetail && !locationLoading && (
                  <p className="rounded-3xl border border-white/10 bg-night-900/60 p-4 text-sm text-slate-400">
                    Select a batch to view its cards and label pairs.
                  </p>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
