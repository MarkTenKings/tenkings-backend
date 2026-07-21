import Head from "next/head";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { AiGraderDesignReferenceRow } from "@tenkings/database";
import { MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST } from "@tenkings/shared";
import AppShell from "../../components/AppShell";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../constants/admin";
import { useSession } from "../../hooks/useSession";

const PROFILE = "registered_design_template_v1" as const;
const API = "/api/admin/ai-grader/design-references";
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

export default function AiGraderDesignReferencesPage() {
  const { session, loading, ensureSession } = useSession();
  const isAdmin = hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone);
  const [identity, setIdentity] = useState(INITIAL_IDENTITY);
  const [references, setReferences] = useState<AiGraderDesignReferenceRow[]>([]);
  const [version, setVersion] = useState("1");
  const [artifactStorageKey, setArtifactStorageKey] = useState("");
  const [intendedDesignBoundary, setIntendedDesignBoundary] = useState('{"schemaVersion":"ai-grader-intended-design-boundary-v1","coordinateFrame":"design_reference_pixels","contour":[]}');
  const [provenance, setProvenance] = useState('{"schemaVersion":"ai-grader-design-reference-provenance-v1","sourceKind":"controlled_ten_kings_scan","approvedForPrecisionReference":true}');
  const [transformAcceptanceMetadata, setTransformAcceptanceMetadata] = useState(DEFAULT_TRANSFORM_ACCEPTANCE);
  const [retirementReason, setRetirementReason] = useState("Superseded by a newly approved exact reference.");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

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
      await request("draft", {
        ...exactIdentity(identity),
        version: Number(version),
        artifactStorageKey,
        intendedDesignBoundary: JSON.parse(intendedDesignBoundary),
        provenance: JSON.parse(provenance),
        transformAcceptanceMetadata: JSON.parse(transformAcceptanceMetadata),
      });
      setMessage("Exact design-reference draft created. It is not active until separately approved.");
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
          <h2 className="text-xl font-bold">Create immutable draft</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <input value={version} onChange={(event) => setVersion(event.target.value)} placeholder="Version" inputMode="numeric" className="rounded border border-zinc-700 bg-black px-3 py-2" />
            <input value={artifactStorageKey} onChange={(event) => setArtifactStorageKey(event.target.value)} placeholder="Private artifact storage key" className="rounded border border-zinc-700 bg-black px-3 py-2 md:col-span-2" />
            <p className="rounded border border-emerald-900 bg-emerald-950/30 p-3 text-xs text-emerald-200 md:col-span-3">The server reads the private object bytes and computes SHA-256, MIME type, width, and height. Operator-entered values cannot become artifact authority.</p>
            <textarea value={intendedDesignBoundary} onChange={(event) => setIntendedDesignBoundary(event.target.value)} aria-label="Intended design boundary JSON" rows={5} className="rounded border border-zinc-700 bg-black p-3 font-mono text-xs md:col-span-3" />
            <p className="text-xs text-zinc-400 md:col-span-3">The contour must contain 4-64 finite [x,y] points in design-reference pixels, remain inside the exact artifact dimensions, and enclose a non-zero measured area.</p>
            <textarea value={provenance} onChange={(event) => setProvenance(event.target.value)} aria-label="Controlled provenance JSON" rows={4} className="rounded border border-zinc-700 bg-black p-3 font-mono text-xs md:col-span-3" />
            <textarea value={transformAcceptanceMetadata} onChange={(event) => setTransformAcceptanceMetadata(event.target.value)} aria-label="Transform acceptance JSON" rows={4} className="rounded border border-zinc-700 bg-black p-3 font-mono text-xs md:col-span-3" />
          </div>
          <button disabled={busy || !isAdmin} className="mt-4 rounded bg-[#d4a843] px-5 py-3 font-bold text-black disabled:opacity-40">Create draft</button>
        </form>

        <section className="mt-6 rounded border border-zinc-800 bg-[#111] p-5">
          <h2 className="text-xl font-bold">Exact versions</h2>
          <input value={retirementReason} onChange={(event) => setRetirementReason(event.target.value)} aria-label="Retirement reason" className="mt-3 w-full rounded border border-zinc-700 bg-black px-3 py-2" />
          <div className="mt-4 grid gap-3">{references.map((row) => <article className="rounded border border-zinc-700 bg-black p-4" key={row.id}><div className="flex flex-wrap items-start justify-between gap-3"><div><strong>v{row.version} · {row.status}</strong><p className="mt-1 break-all font-mono text-xs text-zinc-400">{row.artifactSha256}</p><p className="mt-1 text-xs text-zinc-500">{row.id} · {row.artifactWidthPx}×{row.artifactHeightPx} · {row.artifactStorageKey}</p></div><div className="flex gap-2">{row.status === "draft" ? <button disabled={busy} type="button" onClick={() => void transition("approve", row)} className="rounded bg-emerald-700 px-3 py-2 text-sm font-bold">Approve exact draft</button> : null}{row.status === "approved" ? <button disabled={busy} type="button" onClick={() => void transition("retire", row)} className="rounded bg-red-800 px-3 py-2 text-sm font-bold">Retire exact reference</button> : null}</div></div></article>)}</div>
          {!references.length ? <p className="mt-4 text-sm text-zinc-500">No exact versions loaded.</p> : null}
        </section>
        {message ? <p aria-live="polite" className="mt-6 rounded border border-zinc-700 bg-[#181818] p-4 text-sm">{message}</p> : null}
      </main>
    </AppShell>
  );
}
