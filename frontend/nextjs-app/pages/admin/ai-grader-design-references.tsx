import Head from "next/head";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { AiGraderDesignReferenceRow } from "@tenkings/database";
import { MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST } from "@tenkings/shared";
import AppShell from "../../components/AppShell";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../constants/admin";
import { useSession } from "../../hooks/useSession";
import { uploadAiGraderArtifactDirectly } from "../../lib/aiGraderDirectUpload";
import { parseAiGraderIntendedDesignBoundaryDraft } from "../../lib/aiGraderDesignReferenceDraft";

const PROFILE = "registered_design_template_v1" as const;
const API = "/api/admin/ai-grader/design-references";
const MAXIMUM_REFERENCE_BYTES = 50 * 1024 * 1024;
const REGISTERED_TEMPLATE_POLICY = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.centering.registeredDesignTemplate;
const DEFAULT_TRANSFORM_ACCEPTANCE = JSON.stringify({
  schemaVersion: "ai-grader-design-reference-transform-acceptance-v1",
  registrationAlgorithmVersion: MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.algorithmVersion,
  maxResidualPx: REGISTERED_TEMPLATE_POLICY.maximumRegistrationResidualPx,
  minInlierFraction: REGISTERED_TEMPLATE_POLICY.minimumInlierFraction,
});

type IdentityState = {
  tenantId: string;
  setId: string;
  programId: string;
  cardNumber: string;
  variantId: string;
  parallelId: string;
  side: "front" | "back";
};

const INITIAL_IDENTITY: IdentityState = {
  tenantId: "",
  setId: "",
  programId: "",
  cardNumber: "",
  variantId: "",
  parallelId: "",
  side: "front",
};

function exactIdentity(value: IdentityState) {
  return {
    tenantId: value.tenantId,
    setId: value.setId,
    programId: value.programId,
    cardNumber: value.cardNumber,
    variantId: value.variantId || null,
    parallelId: value.parallelId || null,
    side: value.side,
    profile: PROFILE,
  };
}

type ArtifactInspection = {
  fileName: string;
  contentType: "image/png" | "image/jpeg";
  byteSize: number;
  widthPx: number;
  heightPx: number;
  sha256: string;
};

function fullCardMillimeters(point: readonly [number, number], inspection: ArtifactInspection) {
  return {
    x: point[0] / inspection.widthPx * 63.5,
    y: point[1] / inspection.heightPx * 88.9,
  };
}

export default function AiGraderDesignReferencesPage() {
  const { session, loading, ensureSession } = useSession();
  const isAdmin = hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone);
  const [identity, setIdentity] = useState(INITIAL_IDENTITY);
  const [references, setReferences] = useState<AiGraderDesignReferenceRow[]>([]);
  const [version, setVersion] = useState("1");
  const [artifactFile, setArtifactFile] = useState<File | null>(null);
  const [artifactInspection, setArtifactInspection] = useState<ArtifactInspection>();
  const [artifactPreviewUrl, setArtifactPreviewUrl] = useState<string>();
  const [artifactInspectionError, setArtifactInspectionError] = useState<string>();
  const [intendedDesignBoundary, setIntendedDesignBoundary] = useState('{"schemaVersion":"ai-grader-intended-design-boundary-v1","coordinateFrame":"design_reference_pixels","contour":[]}');
  const [provenance, setProvenance] = useState('{"schemaVersion":"ai-grader-design-reference-provenance-v1","sourceKind":"controlled_ten_kings_scan","approvedForPrecisionReference":true}');
  const [transformAcceptanceMetadata, setTransformAcceptanceMetadata] = useState(DEFAULT_TRANSFORM_ACCEPTANCE);
  const [retirementReason, setRetirementReason] = useState("Superseded by a newly approved exact reference.");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    if (!artifactFile) {
      setArtifactInspection(undefined);
      setArtifactPreviewUrl(undefined);
      setArtifactInspectionError(undefined);
      return;
    }
    let cancelled = false;
    const previewUrl = URL.createObjectURL(artifactFile);
    setArtifactPreviewUrl(previewUrl);
    setArtifactInspection(undefined);
    setArtifactInspectionError(undefined);
    const inspect = async () => {
      if ((artifactFile.type !== "image/png" && artifactFile.type !== "image/jpeg") ||
          artifactFile.size < 24 || artifactFile.size > MAXIMUM_REFERENCE_BYTES) {
        throw new Error("Select one PNG or JPEG reference from 24 bytes through 50 MiB.");
      }
      const dimensions = await new Promise<{ widthPx: number; heightPx: number }>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve({ widthPx: image.naturalWidth, heightPx: image.naturalHeight });
        image.onerror = () => reject(new Error("The selected reference could not be decoded as an image."));
        image.src = previewUrl;
      });
      if (!dimensions.widthPx || !dimensions.heightPx) {
        throw new Error("The selected reference has no readable pixel dimensions.");
      }
      const digest = await crypto.subtle.digest("SHA-256", await artifactFile.arrayBuffer());
      const sha256 = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
      if (!cancelled) setArtifactInspection({
        fileName: artifactFile.name,
        contentType: artifactFile.type,
        byteSize: artifactFile.size,
        widthPx: dimensions.widthPx,
        heightPx: dimensions.heightPx,
        sha256,
      });
    };
    void inspect().catch((error) => {
      if (!cancelled) setArtifactInspectionError(error instanceof Error ? error.message : "Reference inspection failed.");
    });
    return () => {
      cancelled = true;
      URL.revokeObjectURL(previewUrl);
    };
  }, [artifactFile]);

  const boundaryPreview = useMemo(() => {
    if (!artifactInspection) return { boundary: undefined, error: undefined };
    try {
      return {
        boundary: parseAiGraderIntendedDesignBoundaryDraft(
          intendedDesignBoundary,
          artifactInspection.widthPx,
          artifactInspection.heightPx,
        ),
        error: undefined,
      };
    } catch (error) {
      return { boundary: undefined, error: error instanceof Error ? error.message : "Boundary is invalid." };
    }
  }, [artifactInspection, intendedDesignBoundary]);

  const request = useCallback(async (action: string, body: Record<string, unknown>) => {
    if (!session?.token) throw new Error("Admin session is required.");
    const response = await fetch(`${API}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok !== true) throw new Error(payload.message ?? "Design-reference request failed.");
    return payload;
  }, [session?.token]);

  const list = useCallback(async () => {
    if (!isAdmin || !session?.token || !identity.tenantId || !identity.setId || !identity.programId || !identity.cardNumber) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const payload = await request("list", exactIdentity(identity));
      setReferences(payload.references ?? []);
      setMessage(`Loaded ${payload.references?.length ?? 0} exact reference version(s).`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to list references.");
    } finally {
      setBusy(false);
    }
  }, [identity, isAdmin, request, session?.token]);

  useEffect(() => {
    if (!loading && !session) ensureSession().catch(() => undefined);
  }, [ensureSession, loading, session]);

  const createDraft = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(undefined);
    try {
      if (!artifactFile || !artifactInspection) {
        throw new Error(artifactInspectionError ?? "Select and verify one exact controlled reference file.");
      }
      const boundary = parseAiGraderIntendedDesignBoundaryDraft(
        intendedDesignBoundary,
        artifactInspection.widthPx,
        artifactInspection.heightPx,
      );
      const exactVersion = Number(version);
      const planPayload = await request("upload-plan", {
        ...exactIdentity(identity),
        version: exactVersion,
        fileName: artifactInspection.fileName,
        contentType: artifactInspection.contentType,
        byteSize: artifactInspection.byteSize,
        checksumSha256: artifactInspection.sha256,
      }) as { uploadPlan?: Record<string, unknown> };
      const uploadPlan = planPayload.uploadPlan;
      if (!uploadPlan || "storageKey" in uploadPlan ||
          typeof uploadPlan.uploadReceipt !== "string" ||
          typeof uploadPlan.receiptExpiresAt !== "string" ||
          typeof uploadPlan.uploadUrl !== "string" || uploadPlan.uploadMethod !== "PUT" ||
          !uploadPlan.uploadHeaders || typeof uploadPlan.uploadHeaders !== "object" ||
          uploadPlan.contentType !== artifactInspection.contentType ||
          uploadPlan.byteSize !== artifactInspection.byteSize ||
          uploadPlan.checksumSha256 !== artifactInspection.sha256) {
        throw new Error("The server returned an invalid exact reference upload plan.");
      }
      await uploadAiGraderArtifactDirectly({
        purpose: "design-reference",
        uploadUrl: uploadPlan.uploadUrl,
        uploadMethod: "PUT",
        uploadHeaders: uploadPlan.uploadHeaders as Record<string, string>,
        contentType: artifactInspection.contentType,
        checksumSha256: artifactInspection.sha256,
        body: artifactFile,
      });
      const draftPayload = await request("draft", {
        ...exactIdentity(identity),
        version: exactVersion,
        uploadReceipt: uploadPlan.uploadReceipt,
        intendedDesignBoundary: boundary,
        provenance: JSON.parse(provenance),
        transformAcceptanceMetadata: JSON.parse(transformAcceptanceMetadata),
      }) as { reference?: AiGraderDesignReferenceRow };
      const created = draftPayload.reference;
      if (!created || created.artifactSha256 !== artifactInspection.sha256 ||
          created.artifactMimeType !== artifactInspection.contentType ||
          created.artifactWidthPx !== artifactInspection.widthPx ||
          created.artifactHeightPx !== artifactInspection.heightPx) {
        throw new Error("The created draft did not reproduce the imported file hash, type, and dimensions.");
      }
      setMessage(`Exact ${identity.side} design-reference draft v${exactVersion} created and server-verified (${created.artifactWidthPx}x${created.artifactHeightPx}, SHA-256 ${created.artifactSha256}). It remains unapproved.`);
      setArtifactFile(null);
      await list();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to create draft.");
    } finally {
      setBusy(false);
    }
  };

  const transition = async (action: "approve" | "retire", row: AiGraderDesignReferenceRow) => {
    setBusy(true);
    setMessage(undefined);
    try {
      await request(action, {
        ...exactIdentity(identity),
        referenceId: row.id,
        version: row.version,
        expectedArtifactSha256: row.artifactSha256,
        ...(action === "retire" ? { retirementReason } : {}),
      });
      setMessage(`${row.id} ${action === "approve" ? "approved" : "retired"} by exact id, identity, version, side, and SHA-256.`);
      await list();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Unable to ${action} reference.`);
    } finally {
      setBusy(false);
    }
  };

  const field = (key: keyof IdentityState, placeholder: string) => (
    <input value={identity[key]} onChange={(event) => setIdentity((current) => ({ ...current, [key]: event.target.value }))} placeholder={placeholder} className="rounded border border-zinc-700 bg-black px-3 py-2 text-white" />
  );

  return (
    <AppShell background="black" brandVariant="collectibles">
      <Head><title>AI Grader Design References | Ten Kings</title><meta name="robots" content="noindex" /></Head>
      <main className="mx-auto w-full max-w-6xl px-6 py-10 text-white">
        <p className="text-xs font-bold uppercase tracking-[.2em] text-[#d4a843]">Mathematical Grading V1</p>
        <h1 className="mt-2 text-3xl font-bold">Exact registered design references</h1>
        <p className="mt-3 max-w-3xl text-sm text-zinc-400">Create, inspect, approve, and retire controlled precision references for borderless or intentionally asymmetric cards. Every operation requires the complete card/set/program/variant/parallel identity, side, version, and artifact hash. Internet, eBay, marketplace, scraped, unknown, or loose-match sources are rejected.</p>
        {!isAdmin && !loading ? <p className="mt-6 rounded border border-red-900 bg-red-950 p-4">Admin access required.</p> : null}

        <section className="mt-8 rounded border border-zinc-800 bg-[#111] p-5">
          <h2 className="text-xl font-bold">Exact identity</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            {field("tenantId", "Tenant ID")}{field("setId", "Set ID")}{field("programId", "Program ID")}{field("cardNumber", "Card number")}
            {field("variantId", "Variant ID (blank = null)")}{field("parallelId", "Parallel ID (blank = null)")}
            <select value={identity.side} onChange={(event) => setIdentity((current) => ({ ...current, side: event.target.value as "front" | "back" }))} className="rounded border border-zinc-700 bg-black px-3 py-2"><option value="front">front</option><option value="back">back</option></select>
            <button type="button" disabled={busy || !isAdmin} onClick={() => void list()} className="rounded bg-[#d4a843] px-4 py-2 font-bold text-black disabled:opacity-40">List exact versions</button>
          </div>
        </section>

        <form onSubmit={createDraft} className="mt-6 rounded border border-zinc-800 bg-[#111] p-5">
          <h2 className="text-xl font-bold">Import exact controlled file as immutable draft</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <input value={version} onChange={(event) => setVersion(event.target.value)} placeholder="Version" inputMode="numeric" className="rounded border border-zinc-700 bg-black px-3 py-2" />
            <label className="rounded border border-zinc-700 bg-black px-3 py-2 text-sm md:col-span-2">
              Exact {identity.side} reference file
              <input
                type="file"
                accept="image/png,image/jpeg"
                onChange={(event) => setArtifactFile(event.target.files?.[0] ?? null)}
                className="mt-2 block w-full text-xs"
              />
            </label>
            <p className="rounded border border-emerald-900 bg-emerald-950/30 p-3 text-xs text-emerald-200 md:col-span-3">The browser hashes the exact selected bytes for a checksum-bound private upload. The server then rereads those private bytes and independently derives byte bounds, SHA-256, MIME type, width, and height. Browser declarations never become approval authority.</p>
            {artifactInspection ? (
              <div className="grid gap-4 md:col-span-3 lg:grid-cols-[minmax(0,1fr)_minmax(280px,.7fr)]">
                <figure className="rounded border border-zinc-700 bg-black p-3">
                  <div className="relative overflow-hidden rounded" style={{ aspectRatio: `${artifactInspection.widthPx}/${artifactInspection.heightPx}` }}>
                    {artifactPreviewUrl ? <img src={artifactPreviewUrl} alt={`Selected exact ${identity.side} controlled reference`} className="h-full w-full object-contain" /> : null}
                    {boundaryPreview.boundary ? (
                      <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${artifactInspection.widthPx} ${artifactInspection.heightPx}`}>
                        <path
                          d={`M0 0 H${artifactInspection.widthPx} V${artifactInspection.heightPx} H0 Z M${boundaryPreview.boundary.contour.map((point) => `${point[0]} ${point[1]}`).join(" L")} Z`}
                          fill="rgba(0,0,0,.52)"
                          fillRule="evenodd"
                        />
                        <polygon points={boundaryPreview.boundary.contour.map((point) => `${point[0]},${point[1]}`).join(" ")} fill="none" stroke="#00ff8c" strokeWidth={Math.max(2, artifactInspection.widthPx / 400)} />
                        {boundaryPreview.boundary.contour.map((point, index) => (
                          <g key={`${point[0]}-${point[1]}-${index}`}>
                            <circle cx={point[0]} cy={point[1]} r={Math.max(4, artifactInspection.widthPx / 180)} fill="#ffcc00" stroke="black" />
                            <text x={point[0] + artifactInspection.widthPx / 120} y={point[1] - artifactInspection.heightPx / 140} fontSize={Math.max(11, artifactInspection.widthPx / 55)} fill="white" stroke="black" strokeWidth="1">L{index + 1}</text>
                          </g>
                        ))}
                        <line x1={artifactInspection.widthPx / 2} y1={artifactInspection.heightPx * .1} x2={artifactInspection.widthPx / 2} y2={artifactInspection.heightPx * .025} stroke="#00e5ff" strokeWidth={Math.max(3, artifactInspection.widthPx / 300)} />
                        <path d={`M${artifactInspection.widthPx / 2} ${artifactInspection.heightPx * .015} l-${artifactInspection.widthPx * .012} ${artifactInspection.heightPx * .025} h${artifactInspection.widthPx * .024} Z`} fill="#00e5ff" />
                        <text x={artifactInspection.widthPx / 2 + artifactInspection.widthPx * .02} y={artifactInspection.heightPx * .06} fontSize={Math.max(11, artifactInspection.widthPx / 55)} fill="white" stroke="black" strokeWidth="1">PRINTED TOP</text>
                      </svg>
                    ) : null}
                  </div>
                  <figcaption className="mt-3 break-all text-xs text-zinc-400">{artifactInspection.fileName} · {artifactInspection.byteSize} bytes · {artifactInspection.widthPx}x{artifactInspection.heightPx}px<br />SHA-256 {artifactInspection.sha256}</figcaption>
                </figure>
                <div className="space-y-3 text-xs">
                  <p className="rounded border border-zinc-700 p-3"><strong>Boundary mask and landmarks</strong><br />{boundaryPreview.boundary ? `${boundaryPreview.boundary.contour.length} exact pixel landmarks; shaded pixels are outside the intended printed-design contour.` : boundaryPreview.error}</p>
                  <p className="rounded border border-zinc-700 p-3"><strong>Orientation</strong><br />Printed top maps to normalized portrait top. Runtime registration must determine the transform from captured evidence; this import does not rotate or mirror the file.</p>
                  <p className="rounded border border-zinc-700 p-3"><strong>Residual gate</strong><br />No residual is fabricated at import. Captured-card registration must compute residual ≤ {REGISTERED_TEMPLATE_POLICY.maximumRegistrationResidualPx}px, inlier fraction ≥ {Math.round(REGISTERED_TEMPLATE_POLICY.minimumInlierFraction * 100)}%, and publish its landmark ledger/overlay.</p>
                  <p className="rounded border border-zinc-700 p-3"><strong>Physical coordinate mapping</strong><br />Full reference frame: {artifactInspection.widthPx}px = 63.50mm X; {artifactInspection.heightPx}px = 88.90mm Y. Runtime report mapping remains bound to finalized calibration.</p>
                  {boundaryPreview.boundary ? <ol className="max-h-36 overflow-auto rounded border border-zinc-700 p-3 font-mono">{boundaryPreview.boundary.contour.map((point, index) => { const mm = fullCardMillimeters(point, artifactInspection); return <li key={index}>L{index + 1}: [{point[0]}, {point[1]}]px = [{mm.x.toFixed(4)}, {mm.y.toFixed(4)}]mm</li>; })}</ol> : null}
                </div>
              </div>
            ) : null}
            {artifactInspectionError ? <p className="rounded border border-red-900 bg-red-950/40 p-3 text-sm text-red-200 md:col-span-3">{artifactInspectionError}</p> : null}
            <textarea value={intendedDesignBoundary} onChange={(event) => setIntendedDesignBoundary(event.target.value)} aria-label="Intended design boundary JSON" rows={5} className="rounded border border-zinc-700 bg-black p-3 font-mono text-xs md:col-span-3" />
            <p className="text-xs text-zinc-400 md:col-span-3">The contour must contain 4-64 finite [x,y] points in design-reference pixels, remain inside the exact artifact dimensions, and enclose a non-zero measured area.</p>
            <textarea value={provenance} onChange={(event) => setProvenance(event.target.value)} aria-label="Controlled provenance JSON" rows={4} className="rounded border border-zinc-700 bg-black p-3 font-mono text-xs md:col-span-3" />
            <textarea value={transformAcceptanceMetadata} onChange={(event) => setTransformAcceptanceMetadata(event.target.value)} aria-label="Transform acceptance JSON" rows={4} className="rounded border border-zinc-700 bg-black p-3 font-mono text-xs md:col-span-3" />
          </div>
          <button disabled={busy || !isAdmin || !artifactInspection || !boundaryPreview.boundary} className="mt-4 rounded bg-[#d4a843] px-5 py-3 font-bold text-black disabled:opacity-40">Upload exact bytes and create unapproved draft</button>
        </form>

        <section className="mt-6 rounded border border-zinc-800 bg-[#111] p-5">
          <h2 className="text-xl font-bold">Exact versions</h2>
          <input value={retirementReason} onChange={(event) => setRetirementReason(event.target.value)} aria-label="Retirement reason" className="mt-3 w-full rounded border border-zinc-700 bg-black px-3 py-2" />
          <div className="mt-4 grid gap-3">{references.map((row) => <article className="rounded border border-zinc-700 bg-black p-4" key={row.id}><div className="flex flex-wrap items-start justify-between gap-3"><div><strong>v{row.version} · {row.status}</strong><p className="mt-1 break-all font-mono text-xs text-zinc-400">{row.artifactSha256}</p><p className="mt-1 text-xs text-zinc-500">{row.id} · {row.artifactWidthPx}×{row.artifactHeightPx} · private server-held object</p></div><div className="flex gap-2">{row.status === "draft" ? <button disabled={busy} type="button" onClick={() => void transition("approve", row)} className="rounded bg-emerald-700 px-3 py-2 text-sm font-bold">Approve exact draft</button> : null}{row.status === "approved" ? <button disabled={busy} type="button" onClick={() => void transition("retire", row)} className="rounded bg-red-800 px-3 py-2 text-sm font-bold">Retire exact reference</button> : null}</div></div></article>)}</div>
          {references.some((row) => row.status === "draft") ? (
            <div className="mt-4 rounded border border-amber-800/60 bg-amber-950/20 p-3">
              <p className="text-xs text-amber-100">Unapproved drafts are immutable too. Revoke a bad import; never delete or overwrite its bytes.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {references.filter((row) => row.status === "draft").map((row) => (
                  <button disabled={busy} key={row.id} type="button" onClick={() => void transition("retire", row)} className="rounded bg-red-800 px-3 py-2 text-sm font-bold">Revoke unapproved draft v{row.version}</button>
                ))}
              </div>
            </div>
          ) : null}
          {!references.length ? <p className="mt-4 text-sm text-zinc-500">No exact versions loaded.</p> : null}
        </section>
        {message ? <p aria-live="polite" className="mt-6 rounded border border-zinc-700 bg-[#181818] p-4 text-sm">{message}</p> : null}
      </main>
    </AppShell>
  );
}
