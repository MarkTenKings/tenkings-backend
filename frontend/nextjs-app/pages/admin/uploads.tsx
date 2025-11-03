import Head from "next/head";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppShell from "../../components/AppShell";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../constants/admin";
import { useSession } from "../../hooks/useSession";
import { buildAdminHeaders } from "../../lib/adminHeaders";

type UploadStatus =
  | "pending"
  | "compressing"
  | "presigning"
  | "uploading"
  | "processing"
  | "recorded"
  | "error";

interface UploadResult {
  fileName: string;
  assetId: string | null;
  status: UploadStatus;
  message?: string;
  publicUrl?: string;
}

interface BatchAssignmentSummary {
  packDefinitionId: string;
  name: string;
  category: string;
  tier: string;
  price: number;
  count: number;
}

interface BatchSummary {
  id: string;
  label: string | null;
  status: string;
  totalCount: number;
  processedCount: number;
  createdAt: string;
  updatedAt: string;
  latestAssetAt: string | null;
  assignments: BatchAssignmentSummary[];
}

const CATEGORY_LABELS: Record<string, string> = {
  SPORTS: "Sports",
  POKEMON: "Pokémon",
  COMICS: "Comics",
};

const TIER_LABELS: Record<string, string> = {
  TIER_25: "$25 Pack",
  TIER_50: "$50 Pack",
  TIER_100: "$100 Pack",
  TIER_500: "$500 Pack",
};

export default function AdminUploads() {
  const { session, loading, ensureSession, logout } = useSession();
  const [files, setFiles] = useState<File[]>([]);
  const [results, setResults] = useState<UploadResult[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [batchesLoading, setBatchesLoading] = useState(false);
  const [batchesError, setBatchesError] = useState<string | null>(null);

  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [capturePreviewUrl, setCapturePreviewUrl] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const apiBase = useMemo(() => {
    const raw = process.env.NEXT_PUBLIC_ADMIN_API_BASE_URL ?? "";
    if (!raw) {
      return "";
    }
    return raw.endsWith("/") ? raw.slice(0, -1) : raw;
  }, []);

  const uploadConcurrency = useMemo(() => {
    const parsed = Number(process.env.NEXT_PUBLIC_UPLOAD_CONCURRENCY ?? "3");
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 3;
    }
    return Math.min(10, Math.max(1, Math.floor(parsed)));
  }, []);

  const statusLabels: Record<UploadStatus, string> = {
    pending: "Queued",
    compressing: "Optimizing",
    presigning: "Preparing",
    uploading: "Uploading",
    processing: "Recording",
    recorded: "Complete",
    error: "Error",
  };

  const statusTone: Record<UploadStatus, string> = {
    pending: "text-slate-500",
    compressing: "text-sky-300",
    presigning: "text-sky-300",
    uploading: "text-sky-300",
    processing: "text-sky-300",
    recorded: "text-emerald-300",
    error: "text-rose-300",
  };

  const uploadSummary = useMemo(() => {
    const total = results.length > 0 ? results.length : files.length;
    const completed = results.filter((result) => result.status === "recorded").length;
    const errors = results.filter((result) => result.status === "error").length;
    return { total, completed, errors };
  }, [results, files]);

  const appendFiles = useCallback((newFiles: File[]) => {
    if (!newFiles.length) {
      return;
    }
    setFiles((prev) => [...prev, ...newFiles]);
    setResults([]);
    setFlash(null);
    setBatchId(null);
  }, []);

  const stopCameraStream = useCallback(() => {
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  const closeCamera = useCallback(() => {
    if (capturePreviewUrl) {
      URL.revokeObjectURL(capturePreviewUrl);
    }
    setCapturePreviewUrl(null);
    setCapturedBlob(null);
    setCameraError(null);
    setCameraOpen(false);
    stopCameraStream();
  }, [capturePreviewUrl, stopCameraStream]);

  const openCamera = useCallback(async () => {
    if (cameraOpen) {
      return;
    }
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setCameraError("Camera capture is not supported on this device.");
      setCameraOpen(true);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      setCapturedBlob(null);
      setCapturePreviewUrl(null);
      setCameraError(null);
      setCameraOpen(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to access camera.";
      setCameraError(message);
      setCameraOpen(true);
    }
  }, [cameraOpen]);

  const handleCapture = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) {
      setCameraError("Camera not ready yet.");
      return;
    }
    const { videoWidth, videoHeight } = video;
    if (!videoWidth || !videoHeight) {
      setCameraError("Camera is warming up—try again.");
      return;
    }
    canvas.width = videoWidth;
    canvas.height = videoHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      setCameraError("Canvas not supported in this browser.");
      return;
    }
    context.drawImage(video, 0, 0, videoWidth, videoHeight);
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.92)
    );
    if (!blob) {
      setCameraError("Failed to capture image.");
      return;
    }
    if (capturePreviewUrl) {
      URL.revokeObjectURL(capturePreviewUrl);
    }
    setCapturedBlob(blob);
    setCapturePreviewUrl(URL.createObjectURL(blob));
  }, [capturePreviewUrl]);

  const handleRetake = useCallback(() => {
    if (capturePreviewUrl) {
      URL.revokeObjectURL(capturePreviewUrl);
    }
    setCapturePreviewUrl(null);
    setCapturedBlob(null);
    setCameraError(null);
  }, [capturePreviewUrl]);

  const handleConfirmCapture = useCallback(() => {
    if (!capturedBlob) {
      setCameraError("Capture an image first.");
      return;
    }
    const mime = capturedBlob.type || "image/jpeg";
    const extension = mime.endsWith("png") ? "png" : mime.endsWith("webp") ? "webp" : "jpg";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `capture-${timestamp}.${extension}`;
    const file = new File([capturedBlob], fileName, {
      type: mime,
      lastModified: Date.now(),
    });
    appendFiles([file]);
    closeCamera();
  }, [appendFiles, capturedBlob, closeCamera]);

  useEffect(() => {
    if (!cameraOpen) {
      return;
    }
    const video = videoRef.current;
    const stream = streamRef.current;
    if (video && stream) {
      video.srcObject = stream;
      video.play().catch(() => undefined);
    }
  }, [cameraOpen]);

  useEffect(() => {
    return () => {
      if (capturePreviewUrl) {
        URL.revokeObjectURL(capturePreviewUrl);
      }
      stopCameraStream();
    };
  }, [capturePreviewUrl, stopCameraStream]);

  const isAdmin = useMemo(
    () => hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone),
    [session?.user.id, session?.user.phone]
  );

  const missingConfig =
    typeof window !== "undefined" &&
    process.env.NEXT_PUBLIC_ADMIN_USER_IDS === undefined &&
    process.env.NEXT_PUBLIC_ADMIN_PHONES === undefined;

  useEffect(() => {
    if (!submitting) {
      return;
    }
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [submitting]);

  const fetchBatches = useCallback(
    async (signal?: AbortSignal) => {
      if (!session?.token || !isAdmin) {
        return;
      }

      setBatchesLoading(true);
      setBatchesError(null);
      try {
        const res = await fetch("/api/admin/batches?limit=20", {
          headers: buildAdminHeaders(session.token),
          signal,
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload?.message ?? "Failed to load batches");
        }
        const data = (await res.json()) as { batches: BatchSummary[] };
        setBatches(data.batches);
      } catch (error) {
        if (signal?.aborted) {
          return;
        }
        const message = error instanceof Error ? error.message : "Failed to load batches";
        setBatchesError(message);
      } finally {
        if (!signal?.aborted) {
          setBatchesLoading(false);
        }
      }
    },
    [session?.token, isAdmin]
  );

  useEffect(() => {
    const controller = new AbortController();
    fetchBatches(controller.signal).catch(() => undefined);
    return () => controller.abort();
  }, [fetchBatches]);

  const onFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      appendFiles(Array.from(event.target.files));
      event.target.value = "";
    }
  };

  const resolveApiUrl = useCallback(
    (path: string) => {
      if (/^https?:\/\//.test(path)) {
        return path;
      }
      if (!apiBase) {
        return path;
      }
      return `${apiBase}${path.startsWith("/") ? path : `/${path}`}`;
    },
    [apiBase]
  );

  const submitUploads = async (event: FormEvent) => {
    event.preventDefault();
    if (!files.length) {
      setFlash("Select one or more images first.");
      return;
    }

    const token = session?.token;
    if (!token) {
      setFlash("Your session expired. Sign in again and retry.");
      return;
    }

    setSubmitting(true);
    setFlash(null);

    const fileEntries = files.map((file, index) => ({ file, index }));
    const initialResults: UploadResult[] = fileEntries.map(({ file }) => ({
      fileName: file.name,
      assetId: null,
      status: "pending",
    }));
    setResults(initialResults);

    const resultsBuffer = initialResults.slice();

    const updateResult = (index: number, updates: Partial<UploadResult>) => {
      resultsBuffer[index] = { ...resultsBuffer[index], ...updates };
      setResults((prev) => {
        if (prev.length === resultsBuffer.length) {
          const next = [...prev];
          next[index] = { ...next[index], ...updates };
          return next;
        }
        return [...resultsBuffer];
      });
    };

    let sharedBatchId: string | null = null;
    let latestBatchId: string | null = null;

    const isRemoteApi =
      typeof window !== "undefined" && apiBase.length > 0 && !apiBase.startsWith(window.location.origin);

    const processEntry = async (entry: { file: File; index: number }) => {
      const { file, index } = entry;
      try {
        updateResult(index, { status: "compressing", message: undefined });
        const optimizedFile = await compressImage(file);

        updateResult(index, { status: "presigning" });
        const presignBody: {
          fileName: string;
          size: number;
          mimeType: string;
          batchId?: string;
        } = {
          fileName: optimizedFile.name,
          size: optimizedFile.size,
          mimeType: optimizedFile.type || file.type,
        };

        if (sharedBatchId) {
          presignBody.batchId = sharedBatchId;
        }

        const presignRes = await fetch(resolveApiUrl("/api/admin/uploads/presign"), {
          method: "POST",
          mode: isRemoteApi ? "cors" : "same-origin",
          headers: {
            "Content-Type": "application/json",
            ...buildAdminHeaders(token),
          },
          body: JSON.stringify(presignBody),
        });

        if (!presignRes.ok) {
          const payload = await presignRes.json().catch(() => ({}));
          throw new Error(payload?.message ?? "Failed to generate upload URL");
        }

        const presignPayload = (await presignRes.json()) as {
          assetId: string;
          batchId: string;
          uploadUrl: string;
          fields: Record<string, string>;
          publicUrl: string;
          storageMode: string;
        };

        if (!sharedBatchId) {
          sharedBatchId = presignPayload.batchId;
          latestBatchId = presignPayload.batchId;
          setBatchId(presignPayload.batchId);
        }

        if (presignPayload.storageMode !== "local" && presignPayload.storageMode !== "mock") {
          throw new Error("Unsupported storage mode returned by server");
        }

        updateResult(index, { status: "uploading" });
        const uploadRes = await fetch(resolveApiUrl(presignPayload.uploadUrl), {
          method: "PUT",
          mode: isRemoteApi ? "cors" : "same-origin",
          headers: {
            ...buildAdminHeaders(token),
            "Content-Type": optimizedFile.type || file.type,
          },
          body: optimizedFile,
        });

        if (!uploadRes.ok) {
          const text = await uploadRes.text().catch(() => "");
          throw new Error(text || "Failed to store file");
        }

        updateResult(index, { status: "processing" });
        const completeRes = await fetch(resolveApiUrl("/api/admin/uploads/complete"), {
          method: "POST",
          mode: isRemoteApi ? "cors" : "same-origin",
          headers: {
            "Content-Type": "application/json",
            ...buildAdminHeaders(token),
          },
          body: JSON.stringify({
            assetId: presignPayload.assetId,
            fileName: optimizedFile.name,
            mimeType: optimizedFile.type || file.type,
            size: optimizedFile.size,
          }),
        });

        if (!completeRes.ok) {
          const payload = await completeRes.json().catch(() => ({}));
          throw new Error(payload?.message ?? "Failed to record upload");
        }

        updateResult(index, {
          assetId: presignPayload.assetId,
          status: "recorded",
          publicUrl: presignPayload.publicUrl,
          message: undefined,
        });
        latestBatchId = sharedBatchId ?? presignPayload.batchId;
        return { success: true, batchId: presignPayload.batchId };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        updateResult(index, { status: "error", message });
        return { success: false, batchId: null };
      }
    };

    try {
      let nextIndex = 0;
      for (; nextIndex < fileEntries.length; nextIndex += 1) {
        await processEntry(fileEntries[nextIndex]);
        if (sharedBatchId) {
          nextIndex += 1;
          break;
        }
      }

      if (!sharedBatchId) {
        latestBatchId = null;
        return;
      }

      const queue = fileEntries.slice(nextIndex);
      let pointer = 0;

      const worker = async () => {
        while (pointer < queue.length) {
          const current = queue[pointer];
          pointer += 1;
          if (!current) {
            break;
          }
          await processEntry(current);
        }
      };

      const workerCount = Math.min(uploadConcurrency, queue.length);
      await Promise.all(Array.from({ length: workerCount }, worker));
      latestBatchId = sharedBatchId;
    } finally {
      const successes = resultsBuffer.filter((result) => result.status === "recorded").length;
      const errors = resultsBuffer.filter((result) => result.status === "error").length;
      if (successes === resultsBuffer.length && resultsBuffer.length > 0) {
        setFlash("Upload complete.");
      } else if (errors > 0) {
        setFlash(`Uploads finished with ${errors} error${errors === 1 ? "" : "s"}.`);
      } else if (resultsBuffer.length > 0) {
        setFlash("Uploads finished.");
      }

      setSubmitting(false);
      setBatchId(latestBatchId);
      fetchBatches().catch(() => undefined);
    }
  };

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
          <title>Ten Kings · Admin Uploads</title>
          <meta name="robots" content="noindex" />
        </Head>
        {gate}
      </AppShell>
    );
  }

  return (
    <AppShell>
      <Head>
        <title>Ten Kings · Admin Uploads</title>
        <meta name="robots" content="noindex" />
      </Head>

      <div className="flex flex-1 flex-col gap-10 px-6 py-12">
        <header className="space-y-3">
          <p className="text-sm uppercase tracking-[0.32em] text-violet-300">Processing Console</p>
          <h1 className="font-heading text-4xl uppercase tracking-[0.18em] text-white">Upload Batches</h1>
          <p className="max-w-3xl text-sm text-slate-300">
            Upload raw card imagery, create batches, and review intake history. OCR, AI classification, and valuation will plug into
            these batches next.
          </p>
          <Link className="inline-flex text-xs uppercase tracking-[0.28em] text-slate-400 transition hover:text-white" href="/admin">
            ← Back to console
          </Link>
        </header>

        <section className="flex flex-col gap-6 rounded-3xl border border-white/10 bg-night-900/70 p-6">
          <form className="flex flex-col gap-4" onSubmit={submitUploads}>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void openCamera()}
                disabled={submitting}
                className="rounded-full border border-white/15 px-4 py-2 text-xs uppercase tracking-[0.3em] text-slate-200 transition hover:border-white/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {cameraOpen ? "Camera active" : "Open camera"}
              </button>
              <span className="text-xs text-slate-500">Capture card photos directly from this device.</span>
            </div>
            <label className="flex flex-col gap-2 text-sm uppercase tracking-[0.24em] text-slate-300">
              Select card images
              <input
                type="file"
                multiple
                accept="image/*"
                onChange={onFileChange}
                className="rounded-2xl border border-dashed border-slate-500/60 bg-night-900/60 p-6 text-xs uppercase tracking-[0.3em] text-slate-400"
              />
            </label>
            <button
              type="submit"
              disabled={submitting || files.length === 0}
              className="inline-flex w-fit items-center justify-center rounded-full border border-gold-500/60 bg-gold-500 px-8 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-night-900 shadow-glow transition hover:bg-gold-400 disabled:cursor-not-allowed disabled:border-white/20 disabled:bg-white/10 disabled:text-slate-500"
            >
              {submitting
                ? `Uploading… (${uploadSummary.completed}/${uploadSummary.total || files.length})`
                : "Upload & queue"}
            </button>
          </form>

          {flash && <p className="text-sm text-slate-300">{flash}</p>}

          {batchId && (
            <p className="text-xs uppercase tracking-[0.28em] text-slate-400">
              Batch ID: <span className="font-mono tracking-normal text-slate-200">{batchId}</span>
            </p>
          )}

          {files.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Selected files</p>
              <ul className="grid gap-2 text-sm text-slate-300">
                {files.map((file, index) => (
                  <li key={`${file.name}-${index}`} className="rounded-2xl border border-white/10 bg-night-800/70 px-4 py-3">
                    {file.name} <span className="text-xs text-slate-500">· {Math.round(file.size / 1024)} KB</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {results.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Upload results</p>
              <ul className="grid gap-2 text-sm text-slate-300">
                {results.map((result, index) => (
                  <li
                    key={`${result.fileName}-${index}`}
                    className="rounded-2xl border border-white/10 bg-night-800/70 px-4 py-3"
                  >
                    <div className="flex items-center justify-between">
                      <span>{result.fileName}</span>
                      <span className={statusTone[result.status] ?? "text-slate-400"}>
                        {statusLabels[result.status] ?? result.status}
                      </span>
                    </div>
                    {result.assetId && <p className="text-xs text-slate-500">assetId: {result.assetId}</p>}
                    {result.publicUrl && (
                      <p className="text-xs text-slate-500">
                        preview: <span className="break-all">{result.publicUrl}</span>
                      </p>
                    )}
                    {result.message && result.status === "error" && (
                      <p className="text-xs text-rose-300">{result.message}</p>
                    )}
                    {result.message && result.status !== "error" && (
                      <p className="text-xs text-slate-400">{result.message}</p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-night-900/50 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Recent uploads</p>
              <h2 className="font-heading text-2xl uppercase tracking-[0.18em] text-white">Batches</h2>
            </div>
            <Link
              href="/admin"
              className="text-xs uppercase tracking-[0.28em] text-slate-500 transition hover:text-slate-200"
            >
              Dashboard
            </Link>
          </div>

          {batchesLoading && <p className="text-sm text-slate-400">Loading batches…</p>}
          {batchesError && <p className="text-sm text-rose-300">{batchesError}</p>}

          {!batchesLoading && !batchesError && batches.length === 0 && (
            <p className="text-sm text-slate-400">No batches yet. Upload card images to start a new batch.</p>
          )}

          {!batchesLoading && batches.length > 0 && (
            <ul className="grid gap-3">
              {batches.map((batch) => (
                <li key={batch.id} className="rounded-2xl border border-white/10 bg-night-900/70 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.28em] text-slate-400">
                          {batch.label ?? "Untitled Batch"}
                        </p>
                        <h3 className="font-heading text-lg uppercase tracking-[0.18em] text-white">{batch.id.slice(0, 8)}</h3>
                        <p className="text-xs text-slate-500">
                          Created {new Date(batch.createdAt).toLocaleString()} · {batch.totalCount} uploads
                        </p>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right text-xs text-slate-400">
                          <p>
                            Status: <span className={`text-slate-200 ${batch.status === "READY" ? "text-emerald-300" : "text-slate-200"}`}>
                              {batch.status}
                            </span>
                          </p>
                          <p>
                            {batch.status === "ASSIGNED" ? "Assigned" : "Processed"} {batch.processedCount}/{batch.totalCount}
                          </p>
                          {batch.latestAssetAt && (
                            <p>Last upload {new Date(batch.latestAssetAt).toLocaleString()}</p>
                          )}
                        </div>
                        <Link
                          href={`/admin/batches/${batch.id}`}
                          className="inline-flex items-center justify-center rounded-full border border-white/20 px-4 py-2 text-xs uppercase tracking-[0.3em] text-slate-200 transition hover:border-white/40 hover:text-white"
                        >
                          View
                        </Link>
                      </div>
                    </div>
                    {batch.assignments.length > 0 && (
                      <div className="mt-3 rounded-2xl border border-white/10 bg-night-900/60 p-3 text-xs text-slate-300">
                        <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">Pack Assignments</p>
                        <ul className="mt-2 flex flex-wrap gap-2">
                          {batch.assignments.map((assignment) => (
                            <li
                              key={`${batch.id}-${assignment.packDefinitionId}`}
                              className="rounded-full border border-emerald-400/30 px-3 py-1 text-[11px] uppercase tracking-[0.3em] text-emerald-200"
                            >
                              {CATEGORY_LABELS[assignment.category] ?? assignment.category} · {TIER_LABELS[assignment.tier] ?? assignment.tier}
                              <span className="ml-2 text-slate-300">×{assignment.count}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {cameraOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-10">
          <div className="absolute inset-0 bg-black/70" onClick={closeCamera} />
          <div className="relative z-10 w-full max-w-3xl space-y-4 rounded-3xl border border-white/10 bg-night-900/95 p-6 shadow-2xl">
            <div className="aspect-[4/3] w-full overflow-hidden rounded-2xl border border-white/10 bg-night-900/80">
              {capturePreviewUrl && capturedBlob ? (
                <img
                  src={capturePreviewUrl}
                  alt="Captured card preview"
                  className="h-full w-full object-contain"
                />
              ) : (
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="h-full w-full object-cover"
                />
              )}
            </div>
            {cameraError && (
              <p className="text-sm text-rose-300">{cameraError}</p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={closeCamera}
                className="rounded-full border border-white/20 px-4 py-2 text-xs uppercase tracking-[0.3em] text-slate-200 transition hover:border-white/40 hover:text-white"
              >
                Close
              </button>
              {capturedBlob ? (
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={handleRetake}
                    className="rounded-full border border-white/20 px-4 py-2 text-xs uppercase tracking-[0.3em] text-slate-200 transition hover:border-white/40 hover:text-white"
                  >
                    Retake
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmCapture}
                    className="rounded-full border border-gold-500/60 bg-gold-500 px-5 py-2 text-xs font-semibold uppercase tracking-[0.32em] text-night-900 shadow-glow transition hover:bg-gold-400"
                  >
                    Use photo
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleCapture}
                  className="rounded-full border border-white/20 px-4 py-2 text-xs uppercase tracking-[0.3em] text-slate-200 transition hover:border-white/40 hover:text-white"
                >
                  Capture
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <canvas ref={canvasRef} className="hidden" />

      {submitting && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-night-900/60 backdrop-blur-sm">
          <div className="rounded-3xl border border-white/10 bg-night-900/90 px-8 py-6 text-center text-slate-100">
            <p className="text-xs uppercase tracking-[0.32em] text-slate-400">Uploading</p>
            <p className="mt-2 text-sm text-white">
              {uploadSummary.completed}/{uploadSummary.total || files.length} files complete
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Keep this tab open until all uploads finish.
            </p>
          </div>
        </div>
      )}
    </AppShell>
  );
}

async function compressImage(file: File): Promise<File> {
  const MIN_BYTES_FOR_COMPRESSION = 1_200_000; // ~1.2 MB
  const MAX_DIMENSION = 2000;

  if (!file.type.startsWith("image/") || file.size <= MIN_BYTES_FOR_COMPRESSION) {
    return file;
  }

  if (typeof window === "undefined") {
    return file;
  }

  const drawToCanvas = async (
    dimensions: { width: number; height: number },
    draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void
  ) => {
    const scale = Math.min(1, MAX_DIMENSION / Math.max(dimensions.width, dimensions.height));
    const targetWidth = Math.max(1, Math.round(dimensions.width * scale));
    const targetHeight = Math.max(1, Math.round(dimensions.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas not supported");
    }
    draw(context, targetWidth, targetHeight);
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/webp", 0.82)
    );
    if (!blob || blob.size >= file.size) {
      return file;
    }
    const newName = file.name.replace(/\.[^.]+$/, "") + ".webp";
    return new File([blob], newName, { type: "image/webp", lastModified: Date.now() });
  };

  try {
    if (typeof createImageBitmap === "function") {
      const bitmap = await createImageBitmap(file);
      const optimized = await drawToCanvas(
        { width: bitmap.width, height: bitmap.height },
        (ctx, width, height) => ctx.drawImage(bitmap, 0, 0, width, height)
      );
      bitmap.close();
      return optimized;
    }
  } catch (error) {
    // fall through to HTMLImageElement path
  }

  try {
    const optimized = await new Promise<File>((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = async () => {
        URL.revokeObjectURL(url);
        try {
          const result = await drawToCanvas(
            { width: image.width, height: image.height },
            (ctx, width, height) => ctx.drawImage(image, 0, 0, width, height)
          );
          resolve(result);
        } catch (canvasError) {
          reject(canvasError);
        }
      };
      image.onerror = (event) => {
        URL.revokeObjectURL(url);
        reject(event);
      };
      image.src = url;
    });
    return optimized;
  } catch (error) {
    return file;
  }
}
