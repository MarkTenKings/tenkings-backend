import Head from "next/head";
import { FormEvent, useCallback, useEffect, useState } from "react";
import AppShell from "../../../components/AppShell";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../../constants/admin";
import { useSession } from "../../../hooks/useSession";
import type { StockerProfileData } from "../../../types/stocker";

type StockerRow = StockerProfileData & { lastShiftDate: string | null; _count: { shifts: number } };

export default function StockerManagementPage() {
  const { session, loading, ensureSession } = useSession();
  const isAdmin = hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone);
  const [stockers, setStockers] = useState<StockerRow[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);

  const hasSession = Boolean(session);
  const load = useCallback(async () => {
    if (!session?.token || !isAdmin) return;
    const response = await fetch("/api/admin/stocker/list?isActive=all", { headers: { Authorization: `Bearer ${session.token}` } });
    const payload = await response.json();
    setStockers(payload.data ?? []);
  }, [isAdmin, session?.token]);

  useEffect(() => {
    if (!loading && !hasSession) ensureSession().catch(() => undefined);
    void load();
  }, [ensureSession, hasSession, loading, load]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const response = await fetch("/api/admin/stocker/create", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.token}` },
      body: JSON.stringify({ name, phone }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setError(payload?.message ?? "Unable to create stocker");
      return;
    }
    setName("");
    setPhone("");
    await load();
  };

  const toggleActive = async (stocker: StockerRow) => {
    await fetch(`/api/admin/stocker/${stocker.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.token}` },
      body: JSON.stringify({ isActive: !stocker.isActive }),
    });
    await load();
  };

  return (
    <AppShell background="black" brandVariant="collectibles">
      <Head>
        <title>Stocker Management | Ten Kings</title>
      </Head>
      <main className="mx-auto w-full max-w-5xl px-6 py-10 text-white">
        <h1 className="font-heading text-3xl text-[#d4a843]">Stocker Management</h1>
        {!isAdmin && !loading ? <p className="mt-6 text-red-300">Admin access required.</p> : null}
        <form onSubmit={submit} className="mt-8 grid gap-3 rounded-md border border-zinc-800 bg-[#111] p-5 md:grid-cols-[1fr_1fr_auto]">
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Stocker name" className="rounded-md border border-zinc-800 bg-black px-3 py-3 outline-none focus:border-[#d4a843]" />
          <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+1 phone number" className="rounded-md border border-zinc-800 bg-black px-3 py-3 outline-none focus:border-[#d4a843]" />
          <button className="rounded-md bg-[#d4a843] px-5 py-3 font-semibold uppercase tracking-[0.14em] text-black">Add Stocker</button>
          {error ? <p className="text-sm text-red-300 md:col-span-3">{error}</p> : null}
        </form>
        <section className="mt-8 grid gap-4 md:grid-cols-2">
          {stockers.map((stocker) => (
            <article key={stocker.id} className="rounded-md border border-zinc-800 bg-[#111] p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-heading text-xl">{stocker.name}</h2>
                  <p className="mt-1 text-sm text-zinc-500">{stocker.phone}</p>
                </div>
                <span className={stocker.isActive ? "text-sm text-green-400" : "text-sm text-red-400"}>
                  {stocker.isActive ? "active" : "inactive"}
                </span>
              </div>
              <p className="mt-4 text-sm text-zinc-400">
                {stocker._count.shifts} shifts · Last shift {stocker.lastShiftDate ?? "none"}
              </p>
              <button type="button" onClick={() => toggleActive(stocker)} className="mt-4 rounded-md border border-zinc-700 px-3 py-2 text-xs uppercase tracking-[0.14em] text-zinc-300">
                {stocker.isActive ? "Deactivate" : "Reactivate"}
              </button>
            </article>
          ))}
        </section>
      </main>
    </AppShell>
  );
}
