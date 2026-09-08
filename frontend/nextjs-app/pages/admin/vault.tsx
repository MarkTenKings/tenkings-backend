import Head from "next/head";
import { useCallback, useEffect, useMemo, useState } from "react";
import { roleMay, calculateTaxCents, parseTaxPercentageToBasisPoints, type VaultRole, type VaultPermission } from "@tenkings/vault-contracts/browser";
import AppShell from "../../components/AppShell";
import { ADMIN_PAGE_FRAME_CLASS, AdminPageHeader, adminInputClass, adminPanelClass } from "../../components/admin/AdminPrimitives";
import { useSession } from "../../hooks/useSession";

type Row = Record<string, any>;
type Access = { owner: boolean; allowed: boolean; machines: Array<{ machineId: string; role: VaultRole }> };
const initialProduct = { slug: "", name: "", photoUrl: "", description: "", priceCents: 2500, category: "SPORTS", taxClass: "GENERAL", active: true };
const initialMachine = { slug: "", serialNumber: "", displayName: "", locationLabel: "", timezone: "America/Los_Angeles", city: "", state: "", taxPercentage: "", pageUrl: "", email: "", textNumber: "", phoneNumber: "", hours: "" };
const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value / 100);
const pretty = (value: unknown) => JSON.stringify(value, null, 2);
function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return <label className="grid gap-1 text-sm text-slate-300"><span>{label}</span><input className={adminInputClass()} type={type} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}
function Button({ children, onClick, disabled = false }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button type="button" disabled={disabled} onClick={onClick} className="rounded-xl border border-gold-300/40 px-4 py-3 text-sm font-semibold text-gold-200 disabled:opacity-40">{children}</button>;
}
function Evidence({ value }: { value: unknown }) {
  return <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-xl bg-black/60 p-4 text-xs text-slate-300">{pretty(value)}</pre>;
}

export default function VaultAdminPage() {
  const { session, loading, ensureSession } = useSession();
  const [access, setAccess] = useState<Access | null>(null);
  const [machines, setMachines] = useState<Row[]>([]);
  const [products, setProducts] = useState<Row[]>([]);
  const [machineId, setMachineId] = useState("");
  const [tab, setTab] = useState("fleet");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [reason, setReason] = useState("");
  const [detail, setDetail] = useState<unknown>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [machineForm, setMachineForm] = useState(initialMachine);
  const [newProfile, setNewProfile] = useState("");
  const [newMapping, setNewMapping] = useState("");
  const [profileDraft, setProfileDraft] = useState("");
  const [mappingDraft, setMappingDraft] = useState("");
  const [profileProof, setProfileProof] = useState('{"bindings":[]}');
  const [settings, setSettings] = useState(initialMachine);
  const [product, setProduct] = useState(initialProduct);
  const [draftByMachine, setDraftByMachine] = useState<Record<string, string>>({});
  const [selectedDoors, setSelectedDoors] = useState<string[]>([]);
  const [planProduct, setPlanProduct] = useState("");
  const [planPreview, setPlanPreview] = useState<Row | null>(null);
  const [phrase, setPhrase] = useState("");
  const [grants, setGrants] = useState<Row[]>([]);
  const [credentials, setCredentials] = useState<Row[]>([]);
  const [tokens, setTokens] = useState<Row[]>([]);
  const [staff, setStaff] = useState({ userId: "", role: "RESTOCKER", pin: "", expiresAt: "" });
  const [records, setRecords] = useState<Row[]>([]);
  const [report, setReport] = useState<Row | null>(null);
  const [filters, setFilters] = useState({ from: "", through: "", productId: "", includeCertification: false });
  const [manifest, setManifest] = useState("{}");
  const [artifactRequest, setArtifactRequest] = useState('{"bindings":[]}');
  const [financial, setFinancial] = useState({ resolutionType: "NO_EXTERNAL_ACTION", amount: "", note: "" });
  const machine = machines.find((item) => item.id === machineId);
  const role = access?.machines.find((item) => item.machineId === machineId)?.role;
  const may = useCallback((permission: VaultPermission) => Boolean(access?.owner || role && roleMay(role, permission)), [access, role]);
  const api = useCallback(async (path: string, body?: unknown) => {
    const response = await fetch(`/api/vault/v1/admin/${path}`, { method: body === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${session?.token ?? ""}`, "X-Vault-Contract-Version": "1", ...(body === undefined ? {} : { "Content-Type": "application/json", "X-Vault-Action-Reason": reason }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(`${payload.error?.message ?? "Vault request failed"}${payload.error?.details ? `: ${pretty(payload.error.details)}` : ""}`);
    return payload;
  }, [session?.token, reason]);
  const refresh = useCallback(async () => {
    const permission = await api("access"); setAccess(permission);
    if (!permission.allowed) return;
    const [fleet, catalog] = await Promise.all([api("fleet"), api("products")]);
    setMachines(fleet.machines); setProducts(catalog.products);
    setMachineId((current) => fleet.machines.some((item: Row) => item.id === current) ? current : fleet.machines[0]?.id ?? "");
  }, [api]);
  const run = useCallback(async (label: string, work: () => Promise<unknown>, reload = true) => {
    setBusy(true); setMessage("");
    try { const result = await work(); if (reload) await refresh(); setMessage(`${label} completed.`); return result; }
    catch (error) { setMessage(error instanceof Error ? error.message : "Request failed"); return null; }
    finally { setBusy(false); }
  }, [refresh]);
  // Authentication changes reload authority; typing a reason never reloads forms.
  useEffect(() => { setSecret(null); setGrants([]); setCredentials([]); setTokens([]); setRecords([]); setDetail(null); setAccess(null); if (session?.token) void refresh().catch((error) => setMessage(String(error.message))); }, [session?.token]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!machine) return;
    setSettings({ ...initialMachine, city: machine.city, state: machine.state, taxPercentage: (machine.taxRateBasisPoints / 100).toFixed(2), pageUrl: machine.supportPageUrl ?? "", email: machine.supportEmail ?? "", textNumber: machine.supportTextNumber ?? "", phoneNumber: machine.supportPhoneNumber ?? "", hours: machine.supportHours ?? "" });
    setProfileDraft(machine.draftMachineProfile ? pretty(machine.draftMachineProfile) : ""); setMappingDraft(machine.draftDoorMapping ? pretty(machine.draftDoorMapping) : "");
    setSelectedDoors([]); setPlanPreview(null); setPhrase(""); setRecords([]); setReport(null); setSecret(null);
  }, [machineId]); // eslint-disable-line react-hooks/exhaustive-deps
  const configId = draftByMachine[machineId] ?? machine?.configs?.[0]?.id ?? "";
  const configVersions = machine?.configs ?? [];
  const assignments = selectedDoors.map((doorId) => ({ doorId, productId: planProduct || null }));
  const taxPreview = useMemo(() => { try { const bps = parseTaxPercentageToBasisPoints(settings.taxPercentage); return [2500, 5000, 10000, 25000].map((subtotal) => ({ subtotal: money(subtotal), tax: money(calculateTaxCents(subtotal, bps)), total: money(subtotal + calculateTaxCents(subtotal, bps)) })); } catch { return "Enter a valid percentage with at most two decimals."; } }, [settings.taxPercentage]);
  const loadStaff = async () => { const [a, b] = await Promise.all([api(`machines/${machineId}/staff-access`), api(`machines/${machineId}/enrollment`)]); setGrants(a.grants); setTokens(b.tokens); setCredentials(b.credentials); };
  const loadRecords = async (kind: string, cursor?: string) => {
    const query = new URLSearchParams({ machineId });
    if (kind === "sales") { for (const [key, value] of Object.entries(filters)) if (value) query.set(key, String(value)); if (cursor) query.set("cursor", cursor); }
    const data = await api(`${kind}?${query}`);
    setRecords(data.sales ?? data.restocks ?? data.sessions ?? data.cases ?? []); if (kind === "sales") setReport(data);
  };
  const supportFields = (form: typeof initialMachine) => ({ pageUrl: form.pageUrl, email: form.email, textNumber: form.textNumber, phoneNumber: form.phoneNumber, hours: form.hours });
  const recordTab = tab === "restocks" || tab === "certification" || tab === "support-cases" || tab === "sales";
  const sensitiveDisabled = busy || reason.trim().length < 8;
  const chooseDoors = (ids: string[]) => { setSelectedDoors(ids); setPlanPreview(null); setPhrase(""); };
  const visibleTabs = ["fleet", ...(may("CONFIG_PUBLISH") ? ["config"] : []), ...(access?.owner ? ["products"] : []), ...(may("STAFF_MANAGE") ? ["staff"] : []), ...(may("FINANCIAL_RESOLVE") ? ["sales", "support-cases"] : []), "restocks", ...(may("CERTIFICATION_COLLECT") ? ["certification"] : [])];

  if (loading) return <AppShell background="black"><main className={ADMIN_PAGE_FRAME_CLASS}>Loading…</main></AppShell>;
  if (!session || access?.allowed === false) return <AppShell background="black"><main className={ADMIN_PAGE_FRAME_CLASS}><h1>Vault staff access required</h1><p>{message}</p><Button onClick={() => void ensureSession({ force: true })}>Sign in</Button></main></AppShell>;
  return <AppShell background="black"><Head><title>Vault Control · Ten Kings</title></Head><main className={`${ADMIN_PAGE_FRAME_CLASS} space-y-5`}>
    <AdminPageHeader eyebrow="Ten Kings Vault V1" title="Vault Control" description="Machine configuration, fleet reporting, staff access and certification." />
    <div className="flex flex-wrap gap-3"><Button disabled={busy} onClick={() => void run("Refresh", refresh, false)}>Refresh</Button><Button onClick={() => void ensureSession({ force: true })}>Renew human sign-in for sensitive actions</Button></div>
    <p role="status">{message}</p>
    <Field label="Action reason (8–500 characters)" value={reason} onChange={setReason}/>
    <label>Machine <select disabled={busy} className={adminInputClass()} value={machineId} onChange={(event) => { setMachineId(event.target.value); setTab("fleet"); }}>{machines.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
    <nav className="flex flex-wrap gap-2">{visibleTabs.map((name) => <Button key={name} disabled={busy} onClick={() => { setTab(name); setRecords([]); setDetail(null); if (name === "staff") void run("Load staff", loadStaff, false); }}>{name.replaceAll("-", " ")}</Button>)}</nav>
    {secret && <section className={adminPanelClass("p-5")}><p>One-time enrollment token for {machine?.displayName}</p><code className="break-all">{secret}</code><Button onClick={() => setSecret(null)}>Clear token</Button></section>}
    {tab === "fleet" && <>
      <div className="grid gap-4 md:grid-cols-2">{machines.map((item) => <section key={item.id} className={adminPanelClass("p-5")}><h2>{item.displayName}</h2><p>{item.online ? "Online" : "Heartbeat stale / offline"} · {item.salesReady ? "Sales ready" : "Sales blocked"}</p><p>{item.health} · {item.readinessReasons?.join(", ")}</p><p>Last server observation: {item.lastCloudObservedAt ?? "Never"}</p><p>Config {item.activeConfig?.version ?? "None"} · Pending {item.pendingConfig?.version ?? "None"} · App {item.appVersion ?? "Unknown"}</p><p>{item.availableDoorCount} available doors · {item.outboxPendingCount} pending events · {item._count.supportCases} open support cases</p><Evidence value={item.stock}/></section>)}</div>
      {access?.owner && <section className={adminPanelClass("p-5 space-y-4")}><h2>Create machine profile</h2><div className="grid gap-3 md:grid-cols-3">{Object.entries(machineForm).map(([key, value]) => <Field key={key} label={key} value={value} onChange={(next) => setMachineForm((form) => ({ ...form, [key]: next }))}/>)}</div><p>Supply the reviewed profile or a provisional DRAFT with unknown measurements. Hardware addresses must be entered from a separately verified map.</p><label className="grid gap-2">Machine profile JSON<textarea className={adminInputClass("min-h-40 font-mono")} value={newProfile} onChange={(event) => setNewProfile(event.target.value)}/></label><label className="grid gap-2">Explicit door mapping JSON (required for an executable profile)<textarea className={adminInputClass("min-h-32 font-mono")} value={newMapping} onChange={(event) => setNewMapping(event.target.value)}/></label><Button disabled={sensitiveDisabled} onClick={() => void run("Create machine", () => api("machines", { slug: machineForm.slug, serialNumber: machineForm.serialNumber, displayName: machineForm.displayName, locationLabel: machineForm.locationLabel, timezone: machineForm.timezone, city: machineForm.city, state: machineForm.state, taxPercentage: machineForm.taxPercentage, support: supportFields(machineForm), machineProfile: JSON.parse(newProfile), ...(newMapping.trim() ? { doorMapping: JSON.parse(newMapping) } : {}), reason }))}>Create machine</Button></section>}
    </>}
    {tab === "config" && machine && <section className={adminPanelClass("p-5 space-y-4")}>
      <h2>Configuration draft</h2><div className="grid gap-3 md:grid-cols-3">{["city", "state", "taxPercentage", "pageUrl", "email", "textNumber", "phoneNumber", "hours"].map((key) => <Field key={key} label={key} value={settings[key as keyof typeof settings]} onChange={(value) => setSettings((form) => ({ ...form, [key]: value }))}/>)}</div><Evidence value={taxPreview}/>
      <label className="grid gap-2">Complete profile JSON<textarea className={adminInputClass("min-h-40 font-mono")} value={profileDraft} onChange={(event) => setProfileDraft(event.target.value)}/></label><label className="grid gap-2">Explicit door mapping JSON<textarea className={adminInputClass("min-h-32 font-mono")} value={mappingDraft} onChange={(event) => setMappingDraft(event.target.value)}/></label>
      <Button disabled={sensitiveDisabled} onClick={() => void run("Create draft", async () => { const result = await api(`machines/${machineId}/config/draft`, { ...(profileDraft.trim() ? { machineProfile: JSON.parse(profileDraft), doorMapping: JSON.parse(mappingDraft) } : {}), machineSettings: { city: settings.city, state: settings.state, taxPercentage: settings.taxPercentage, support: supportFields(settings) }, reason }); setDraftByMachine((current) => ({ ...current, [machineId]: result.config.id })); })}>Create draft</Button>
      <label>Draft <select className={adminInputClass()} value={configId} onChange={(event) => setDraftByMachine((current) => ({ ...current, [machineId]: event.target.value }))}><option value="">Select draft</option>{configVersions.map((config: Row) => <option key={config.id} value={config.id}>Version {config.version} · {config.status}</option>)}</select></label>
      <div className="flex gap-2">{["validate", "impact", "publish"].map((action) => <Button key={action} disabled={!configId || sensitiveDisabled} onClick={() => void run(`Config ${action}`, async () => { const result = await api(`machines/${machineId}/config/${action}`, { configId, reason }); setDetail(result.impact ?? result.validation ?? result.config); if (action === "publish") setDraftByMachine((current) => { const copy = { ...current }; delete copy[machineId]; return copy; }); })}>{action}</Button>)}</div>
      <label className="grid gap-2">Reviewed physical qualification reports (four scoped artifact keys and exact QUALIFY confirmation)<textarea className={adminInputClass("min-h-32 font-mono")} value={profileProof} onChange={(event) => setProfileProof(event.target.value)}/></label><Button disabled={!configId || sensitiveDisabled} onClick={() => void run("Verify profile qualification", async () => { const result = await api(`machines/${machineId}/config/verify-profile`, { ...JSON.parse(profileProof), configId, reason }); setDetail(result.profileEvidence); })}>Verify reviewed profile reports</Button>
      <h2>Planned assignment for next restock</h2><p>Filled inventory remains under local authority. Preview the exact plan, then type the machine confirmation.</p>
      <div className="flex flex-wrap gap-2"><Button onClick={() => chooseDoors((machine.doors ?? []).filter((door: Row) => !door.retiredAt).map((door: Row) => door.doorId))}>Select active profile doors</Button><Button onClick={() => chooseDoors([])}>Clear selection</Button></div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6" aria-label="Profile door assignment list">{(machine.doors ?? []).filter((door: Row) => !door.retiredAt).map((door: Row) => { const doorId = door.doorId; return <button key={doorId} aria-pressed={selectedDoors.includes(doorId)} onClick={() => chooseDoors(selectedDoors.includes(doorId) ? selectedDoors.filter((id) => id !== doorId) : [...selectedDoors, doorId])} className={`min-h-12 rounded border p-1 text-xs ${selectedDoors.includes(doorId) ? "border-gold-300 bg-gold-300/20" : "border-white/20"}`} title={`${door.state} · Active ${door.activeProductId ?? "empty"} · Planned ${door.plannedProductId ?? "empty"}`}>{door.doorLabel ?? doorId}<br/>{doorId} · {door.state}</button>; })}</div>
      <label>Planned product <select className={adminInputClass()} value={planProduct} onChange={(event) => { setPlanProduct(event.target.value); setPlanPreview(null); }}><option value="">Leave unassigned</option>{products.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <Button disabled={busy || !selectedDoors.length} onClick={() => void run("Preview plan", async () => setPlanPreview(await api(`machines/${machineId}/doors/plan`, { dryRun: true, assignments })), false)}>Preview selected {selectedDoors.length} doors</Button>
      {planPreview && <><Evidence value={planPreview.changed}/><Field label={`Type PLAN ${machine.slug}`} value={phrase} onChange={setPhrase}/><Button disabled={sensitiveDisabled || phrase !== `PLAN ${machine.slug}`} onClick={() => void run("Apply plan", async () => { await api(`machines/${machineId}/doors/plan`, { dryRun: false, assignments, confirmPhrase: phrase, impactDigest: planPreview.impactDigest, reason }); setPlanPreview(null); setPhrase(""); })}>Apply reviewed plan</Button></>}
    </section>}
    {tab === "products" && <section className={adminPanelClass("p-5 space-y-4")}><h2>Products</h2><label>Edit product <select className={adminInputClass()} defaultValue="" onChange={(event) => { const item = products.find((entry) => entry.id === event.target.value); setProduct(item ? { slug: item.slug, name: item.name, photoUrl: item.photoUrl, description: item.description, priceCents: item.priceCents, category: item.category, taxClass: item.taxClass, active: item.active } : initialProduct); }}><option value="">New product</option>{products.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.active ? "Active" : "Inactive"}</option>)}</select></label>
      <div className="grid gap-3 md:grid-cols-2">{["slug", "name", "photoUrl", "description", "taxClass"].map((key) => <Field key={key} label={key} value={String(product[key as keyof typeof product])} onChange={(value) => setProduct((form) => ({ ...form, [key]: value }))}/>)}</div>
      <label>Category <select className={adminInputClass()} value={product.category} onChange={(event) => setProduct((form) => ({ ...form, category: event.target.value }))}><option>SPORTS</option><option>POKEMON</option></select></label><label>Price <select className={adminInputClass()} value={product.priceCents} onChange={(event) => setProduct((form) => ({ ...form, priceCents: Number(event.target.value) }))}>{[2500, 5000, 10000, 25000].map((value) => <option key={value} value={value}>{money(value)}</option>)}</select></label><label><input type="checkbox" checked={product.active} onChange={(event) => setProduct((form) => ({ ...form, active: event.target.checked }))}/> Active</label><Evidence value={product}/><Button disabled={sensitiveDisabled} onClick={() => void run("Save product", () => api("products", { ...product, reason }))}>Save product; publish a config to distribute changes</Button>
    </section>}
    {tab === "staff" && machine && <section className={adminPanelClass("p-5 space-y-4")}><h2>Individual staff access</h2><div className="grid gap-3 md:grid-cols-3"><Field label="User ID" value={staff.userId} onChange={(userId) => setStaff((form) => ({ ...form, userId }))}/><Field label="Six-digit PIN" type="password" value={staff.pin} onChange={(pin) => setStaff((form) => ({ ...form, pin }))}/><Field label="Expires (local time)" type="datetime-local" value={staff.expiresAt} onChange={(expiresAt) => setStaff((form) => ({ ...form, expiresAt }))}/></div><label>Role <select className={adminInputClass()} value={staff.role} onChange={(event) => setStaff((form) => ({ ...form, role: event.target.value }))}><option>RESTOCKER</option><option>TECHNICIAN</option><option>ADMIN</option></select></label><Button disabled={sensitiveDisabled} onClick={() => void run("Grant staff", async () => { await api(`machines/${machineId}/staff-access`, { action: "grant", ...staff, validFrom: new Date().toISOString(), expiresAt: new Date(staff.expiresAt).toISOString(), reason }); setStaff((form) => ({ ...form, pin: "" })); await loadStaff(); })}>Issue individual grant</Button>
      {grants.filter((grant, index) => grants.findIndex((item) => item.grantId === grant.grantId) === index).map((grant) => <div key={grant.id} className="flex gap-3"><span>{grant.userId} · {grant.role} · {grant.status}</span>{grant.status === "ACTIVE" && <Button disabled={sensitiveDisabled} onClick={() => void run("Revoke grant", async () => { await api(`machines/${machineId}/staff-access`, { action: "revoke", grantId: grant.grantId, reason }); await loadStaff(); })}>Revoke</Button>}</div>)}
      <h2>Enrollment and credential lifecycle</h2><Button disabled={sensitiveDisabled} onClick={() => void run("Create enrollment token", async () => { const result = await api(`machines/${machineId}/enrollment`, { action: "create", expiresInMinutes: 60, reason }); setSecret(result.enrollmentToken); await loadStaff(); })}>Create one-time token for enrollment / rotation / recovery</Button>
      {tokens.filter((token) => token.status === "APPROVED").map((token) => <div key={token.id}>{token.id} expires {token.expiresAt}<Button disabled={sensitiveDisabled} onClick={() => void run("Revoke token", async () => { await api(`machines/${machineId}/enrollment`, { action: "revoke-token", tokenId: token.id, reason }); await loadStaff(); })}>Revoke token</Button></div>)}
      {credentials.map((credential) => <div key={credential.id}>Credential v{credential.version} · {credential.status}{credential.status === "ACTIVE" && <Button disabled={sensitiveDisabled} onClick={() => void run("Revoke credential", async () => { await api(`machines/${machineId}/enrollment`, { action: "revoke-credential", credentialId: credential.id, reason }); await loadStaff(); })}>Revoke credential</Button>}</div>)}
      <Field label={`Type DECOMMISSION ${machine.slug}`} value={phrase} onChange={setPhrase}/><Button disabled={sensitiveDisabled || phrase !== `DECOMMISSION ${machine.slug}`} onClick={() => void run("Decommission", () => api(`machines/${machineId}/enrollment`, { action: "decommission", confirmPhrase: phrase, reason }))}>Decommission machine</Button>
    </section>}
    {recordTab && <section className={adminPanelClass("p-5 space-y-4")}><h2>{tab}</h2>
      {tab === "sales" && <><div className="grid gap-3 md:grid-cols-3"><Field label="From (machine-local day)" type="date" value={filters.from} onChange={(from) => setFilters((value) => ({ ...value, from }))}/><Field label="Through (machine-local day)" type="date" value={filters.through} onChange={(through) => setFilters((value) => ({ ...value, through }))}/><label>Transactions containing product <select className={adminInputClass()} value={filters.productId} onChange={(event) => setFilters((value) => ({ ...value, productId: event.target.value }))}><option value="">All products</option>{products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div><label><input type="checkbox" checked={filters.includeCertification} onChange={(event) => setFilters((value) => ({ ...value, includeCertification: event.target.checked }))}/> Include certification</label></>}
      <Button disabled={busy || !machineId} onClick={() => void run("Load records", () => loadRecords(tab), false)}>Load records</Button>
      {report && tab === "sales" && <><p>{report.totalCount} matching transactions · Authorized {money(report.totals.authorizedCents)} · Settled {money(report.totals.settledCents)} · Settled tax {money(report.totals.taxCents)}</p>{report.nextCursor && <Button onClick={() => void run("Next page", () => loadRecords("sales", report.nextCursor), false)}>Next page</Button>}</>}
      {tab === "certification" && <label className="grid gap-2">Reviewed evidence manifest JSON<textarea className={adminInputClass("min-h-40 font-mono")} value={manifest} onChange={(event) => setManifest(event.target.value)}/></label>}
      {tab === "certification" && <label className="grid gap-2">Stored-artifact verification JSON (up to 25 exact session-scoped keys, plus optional automated proof)<textarea className={adminInputClass("min-h-32 font-mono")} value={artifactRequest} onChange={(event) => setArtifactRequest(event.target.value)}/></label>}
      {tab === "support-cases" && <div className="grid gap-3"><label>Financial record <select value={financial.resolutionType} className={adminInputClass()} onChange={(event) => setFinancial((value) => ({ ...value, resolutionType: event.target.value }))}>{["NO_EXTERNAL_ACTION", "REFUND_RECORDED", "VOID_RECORDED", "MANUAL_REVIEW_RECORDED"].map((value) => <option key={value}>{value}</option>)}</select></label><Field label="Amount cents, if applicable" value={financial.amount} onChange={(amount) => setFinancial((value) => ({ ...value, amount }))}/><Field label="Evidence note (no provider secrets)" value={financial.note} onChange={(note) => setFinancial((value) => ({ ...value, note }))}/><p>Records an already-completed external decision; no payment operation is executed.</p></div>}
      {records.map((record) => <article key={record.id} className="space-y-3 border-t border-white/20 pt-4"><h3>{record.supportReference ?? record.shortReference ?? record.localSessionId ?? record.id}</h3><Evidence value={record}/>
        {tab === "certification" && may("CERTIFICATION_APPROVE") && record.status === "REVIEW_REQUIRED" && !record.certificate && <Button disabled={sensitiveDisabled} onClick={() => void run("Verify stored artifacts", async () => { await api("certification", { ...JSON.parse(artifactRequest), action: "verify-artifacts", certificationId: record.id, reason }); await loadRecords(tab); }, false)}>Verify stored artifacts before manifest attachment</Button>}
        {tab === "certification" && may("CERTIFICATION_APPROVE") && <div className="flex gap-2">{!record.certificate && record.status === "REVIEW_REQUIRED" && <><Button disabled={sensitiveDisabled} onClick={() => void run("Attach manifest", async () => { await api("certification", { ...JSON.parse(manifest), action: "attach-manifest", certificationId: record.id, reason }); await loadRecords(tab); }, false)}>Attach verified manifest</Button><Button disabled={sensitiveDisabled} onClick={() => void run("Approve certification", async () => { await api("certification", { action: "approve", certificationId: record.id, reason }); await loadRecords(tab); }, false)}>Approve certificate</Button></>}<Button disabled={sensitiveDisabled || record.status === "INVALIDATED"} onClick={() => void run("Invalidate certificate", async () => { await api("certification", { action: "invalidate", certificationId: record.id, reason }); await loadRecords(tab); }, false)}>Invalidate</Button></div>}
        {tab === "support-cases" && <Button disabled={sensitiveDisabled || !financial.note} onClick={() => void run("Record support resolution", async () => { await api("support-cases", { caseId: record.id, status: "RESOLVED", resolutionReason: reason, financialResolution: { resolutionType: financial.resolutionType, amountCents: financial.amount ? Number(financial.amount) : null, currency: "USD", note: financial.note, recordedAt: new Date().toISOString() } }); await loadRecords(tab); }, false)}>Record resolution</Button>}
      </article>)}
    </section>}
    {detail !== null && <section aria-label="Action result"><h2>Validation / impact result</h2><Evidence value={detail}/></section>}
  </main></AppShell>;
}
