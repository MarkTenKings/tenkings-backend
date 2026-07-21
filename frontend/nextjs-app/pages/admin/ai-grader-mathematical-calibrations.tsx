import Head from "next/head";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { AiGraderMathematicalCalibrationSnapshotRow } from "@tenkings/database";
import AppShell from "../../components/AppShell";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../constants/admin";
import { useSession } from "../../hooks/useSession";

const API = "/api/admin/ai-grader/calibration-snapshots";

export default function AiGraderMathematicalCalibrationsPage() {
  const { session, loading, ensureSession } = useSession();
  const isAdmin = hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone);
  const [rigId, setRigId] = useState("");
  const [bundleStorageKey, setBundleStorageKey] = useState("");
  const [bundleManifestSha256, setBundleManifestSha256] = useState("");
  const [componentSerials, setComponentSerials] = useState('{"camera":"","lightController":""}');
  const [validityStartsAt, setValidityStartsAt] = useState("");
  const [reason, setReason] = useState("Controlled physical calibration lifecycle review.");
  const [priorId, setPriorId] = useState("");
  const [priorHash, setPriorHash] = useState("");
  const [priorBundleHash, setPriorBundleHash] = useState("");
  const [replacementId, setReplacementId] = useState("");
  const [replacementHash, setReplacementHash] = useState("");
  const [replacementBundleHash, setReplacementBundleHash] = useState("");
  const [snapshots, setSnapshots] = useState<AiGraderMathematicalCalibrationSnapshotRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    if (!loading && !session) ensureSession().catch(() => undefined);
  }, [ensureSession, loading, session]);

  const request = useCallback(async (action: string, payload: Record<string, unknown>) => {
    if (!session?.token) throw new Error("Admin session is required.");
    const response = await fetch(`${API}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok !== true) {
      throw new Error(body.message ?? "Calibration snapshot request failed.");
    }
    return body;
  }, [session?.token]);

  const list = useCallback(async () => {
    if (!rigId || !isAdmin) return;
    setBusy(true);
    try {
      const result = await request("list", { rigId });
      setSnapshots(result.snapshots ?? []);
      setMessage(`Loaded ${result.snapshots?.length ?? 0} Mathematical V1 snapshot(s).`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to list snapshots.");
    } finally {
      setBusy(false);
    }
  }, [isAdmin, request, rigId]);

  const importDraft = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await request("import", {
        rigId,
        bundleStorageKey,
        expectedBundleManifestSha256: bundleManifestSha256,
        componentSerials: JSON.parse(componentSerials),
        ...(validityStartsAt ? { validityStartsAt: new Date(validityStartsAt).toISOString() } : {}),
      });
      setMessage("Server-verified calibration snapshot imported as DRAFT. It cannot grade until separately trusted.");
      await list();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to import calibration snapshot.");
    } finally {
      setBusy(false);
    }
  };

  const transition = async (
    action: "trust" | "revoke",
    snapshot: AiGraderMathematicalCalibrationSnapshotRow,
  ) => {
    setBusy(true);
    try {
      await request(action, {
        snapshotId: snapshot.id,
        expectedArtifactSha256: snapshot.mathematicalArtifactSha256,
        expectedBundleManifestSha256: snapshot.mathematicalBundleManifestSha256,
        ...(action === "revoke" ? { reason } : {}),
      });
      setMessage(`${snapshot.id} ${action === "trust" ? "trusted" : "revoked"} by exact id and hash.`);
      await list();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Unable to ${action} snapshot.`);
    } finally {
      setBusy(false);
    }
  };

  const supersede = async () => {
    setBusy(true);
    try {
      await request("supersede", {
        priorSnapshotId: priorId,
        expectedPriorArtifactSha256: priorHash,
        expectedPriorBundleManifestSha256: priorBundleHash,
        replacementSnapshotId: replacementId,
        expectedReplacementArtifactSha256: replacementHash,
        expectedReplacementBundleManifestSha256: replacementBundleHash,
        reason,
      });
      setMessage("Replacement trusted and prior validity window closed atomically.");
      await list();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to supersede calibration.");
    } finally {
      setBusy(false);
    }
  };

  const inputClass = "rounded border border-zinc-700 bg-black px-3 py-2 text-white";
  return (
    <AppShell background="black" brandVariant="collectibles">
      <Head>
        <title>Mathematical Calibration Snapshots | Ten Kings</title>
        <meta name="robots" content="noindex" />
      </Head>
      <main className="mx-auto w-full max-w-6xl px-6 py-10 text-white">
        <p className="text-xs font-bold uppercase tracking-[.2em] text-[#d4a843]">Mathematical Grading V1</p>
        <h1 className="mt-2 text-3xl font-bold">Physical calibration snapshot authority</h1>
        <p className="mt-3 max-w-3xl text-sm text-zinc-400">
          Import one finalized twelve-member calibration bundle from private storage, review its
          server-recomputed manifest, member-ledger, and U95 evidence, then trust, revoke, or supersede by exact ID and hashes.
          Import never sets isCalibrated and never mutates production reports.
        </p>
        {!isAdmin && !loading ? <p className="mt-6 rounded border border-red-900 bg-red-950 p-4">Admin access required.</p> : null}

        <section className="mt-8 rounded border border-zinc-800 bg-[#111] p-5">
          <h2 className="text-xl font-bold">Rig scope</h2>
          <div className="mt-4 flex gap-3">
            <input className={`${inputClass} flex-1`} value={rigId} onChange={(event) => setRigId(event.target.value)} placeholder="Exact rig ID" />
            <button type="button" disabled={busy || !isAdmin} onClick={() => void list()} className="rounded bg-[#d4a843] px-4 py-2 font-bold text-black disabled:opacity-40">List snapshots</button>
          </div>
        </section>

        <form onSubmit={importDraft} className="mt-6 rounded border border-zinc-800 bg-[#111] p-5">
          <h2 className="text-xl font-bold">Import immutable draft</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <input className={inputClass} value={bundleStorageKey} onChange={(event) => setBundleStorageKey(event.target.value)} placeholder="Private mathematical-calibration-bundle-v1.json storage key" />
            <input className={inputClass} value={bundleManifestSha256} onChange={(event) => setBundleManifestSha256(event.target.value)} placeholder="Exact bundle manifest file SHA-256" />
            <textarea className={`${inputClass} font-mono text-xs md:col-span-2`} rows={3} value={componentSerials} onChange={(event) => setComponentSerials(event.target.value)} aria-label="Exact component serial JSON" />
            <input className={inputClass} type="datetime-local" value={validityStartsAt} onChange={(event) => setValidityStartsAt(event.target.value)} />
            <p className="rounded border border-emerald-900 bg-emerald-950/30 p-3 text-xs text-emerald-200">The server reads the manifest and all twelve members, verifies every exact file hash and cross-binding through the canonical loader, and stores the complete bundle authority and U95 residuals.</p>
          </div>
          <button disabled={busy || !isAdmin} className="mt-4 rounded bg-[#d4a843] px-5 py-3 font-bold text-black disabled:opacity-40">Import DRAFT</button>
        </form>

        <section className="mt-6 rounded border border-zinc-800 bg-[#111] p-5">
          <h2 className="text-xl font-bold">Lifecycle</h2>
          <input className={`${inputClass} mt-3 w-full`} value={reason} onChange={(event) => setReason(event.target.value)} aria-label="Lifecycle reason" />
          <div className="mt-4 grid gap-3">
            {snapshots.map((snapshot) => (
              <article key={snapshot.id} className="rounded border border-zinc-700 bg-black p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <strong>{snapshot.trustStatus} � {snapshot.mathematicalCalibrationVersion}</strong>
                    <p className="mt-1 break-all font-mono text-xs text-zinc-400">{snapshot.mathematicalArtifactSha256}</p>
                    <p className="mt-1 break-all font-mono text-xs text-zinc-500">bundle {snapshot.mathematicalBundleManifestSha256}</p>
                    <p className="mt-1 text-xs text-zinc-500">{snapshot.id}</p>
                  </div>
                  <div className="flex gap-2">
                    {snapshot.trustStatus === "DRAFT" ? <button type="button" disabled={busy} onClick={() => void transition("trust", snapshot)} className="rounded bg-emerald-700 px-3 py-2 text-sm font-bold">Trust exact draft</button> : null}
                    {snapshot.trustStatus === "TRUSTED" && !snapshot.supersededById ? <button type="button" disabled={busy} onClick={() => void transition("revoke", snapshot)} className="rounded bg-red-800 px-3 py-2 text-sm font-bold">Revoke exact snapshot</button> : null}
                  </div>
                </div>
              </article>
            ))}
          </div>
          <div className="mt-6 grid gap-3 md:grid-cols-2">
            <input className={inputClass} value={priorId} onChange={(event) => setPriorId(event.target.value)} placeholder="Prior TRUSTED snapshot ID" />
            <input className={inputClass} value={priorHash} onChange={(event) => setPriorHash(event.target.value)} placeholder="Prior exact artifact SHA-256" />
            <input className={inputClass} value={priorBundleHash} onChange={(event) => setPriorBundleHash(event.target.value)} placeholder="Prior exact bundle manifest SHA-256" />
            <input className={inputClass} value={replacementId} onChange={(event) => setReplacementId(event.target.value)} placeholder="Replacement DRAFT snapshot ID" />
            <input className={inputClass} value={replacementHash} onChange={(event) => setReplacementHash(event.target.value)} placeholder="Replacement exact artifact SHA-256" />
            <input className={inputClass} value={replacementBundleHash} onChange={(event) => setReplacementBundleHash(event.target.value)} placeholder="Replacement exact bundle manifest SHA-256" />
          </div>
          <button type="button" disabled={busy || !isAdmin} onClick={() => void supersede()} className="mt-4 rounded bg-blue-700 px-5 py-3 font-bold disabled:opacity-40">Trust replacement and supersede prior</button>
        </section>
        {message ? <p aria-live="polite" className="mt-6 rounded border border-zinc-700 bg-[#181818] p-4 text-sm">{message}</p> : null}
      </main>
    </AppShell>
  );
}
