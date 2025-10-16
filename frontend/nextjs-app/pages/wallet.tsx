import Head from "next/head";
import { FormEvent, useState } from "react";
import AppShell from "../components/AppShell";
import { creditWallet, debitWallet, fetchWallet } from "../lib/api";
import { useSession } from "../hooks/useSession";
import { formatTkd } from "../lib/formatters";

export default function Wallet() {
  const { session, ensureSession } = useSession();
  const [userId, setUserId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [wallet, setWallet] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadWallet = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      setLoading(true);
      const data = await fetchWallet(userId);
      setWallet(data.wallet);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load wallet");
    } finally {
      setLoading(false);
    }
  };

  const mutate = async (kind: "credit" | "debit") => {
    if (!userId) return;
    setError(null);
    try {
      setLoading(true);
      const payload = { amount: Number(amount), note: note || undefined };
      if (kind === "credit") {
        await creditWallet(userId, payload);
      } else {
        await debitWallet(userId, payload);
      }
      const data = await fetchWallet(userId);
      setWallet(data.wallet);
      setAmount("");
      setNote("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update wallet");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppShell>
      <Head>
        <title>Ten Kings · Wallet & Collection</title>
        <meta name="description" content="Review your TKD balance, recent transactions, and manage vault credits." />
      </Head>

      <section className="bg-night-900/75 py-16">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-12 px-6">
          <header className="space-y-4">
            <p className="uppercase tracking-[0.3em] text-violet-300">Closed-loop balance</p>
            <h1 className="font-heading text-5xl uppercase tracking-[0.2em] text-white">Wallet & Collection</h1>
            <p className="max-w-3xl text-sm text-slate-300">
              Ten Kings Dollars (TKD) credit instantly on instant buybacks and marketplace sales. Use this dashboard to view your balance and, if you’re an
              operator, administer adjustments.
            </p>
          </header>

          <div className="grid gap-6 rounded-[2rem] border border-white/10 bg-slate-900/60 p-6 shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">My Wallet</p>
              <button
                type="button"
                onClick={() => ensureSession().catch(() => undefined)}
                className="rounded-full border border-gold-500/60 bg-gold-500 px-5 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-night-900 shadow-glow transition hover:bg-gold-400"
              >
                {session ? "Refresh" : "Sign in"}
              </button>
            </div>

            {session ? (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-night-900/70 p-5">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Account</p>
                  <h2 className="mt-3 text-sm text-slate-200">{session.user.displayName ?? session.user.phone ?? session.user.id}</h2>
                  <p className="mt-1 text-xs text-slate-500">Wallet ID · {session.wallet.id}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-night-900/70 p-5">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Balance</p>
                  <h2 className="mt-3 font-heading text-3xl uppercase tracking-[0.2em] text-gold-300">{formatTkd(session.wallet.balance)}</h2>
                  <p className="mt-1 text-xs text-slate-500">Closed-loop TKD · spend inside Ten Kings only</p>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-white/10 bg-night-900/70 p-6 text-sm text-slate-300">
                Sign in to view your balance and collection history.
              </div>
            )}
          </div>

          <div className="grid gap-6 rounded-[2rem] border border-white/10 bg-slate-900/60 p-6 shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Operator Console</p>
                <h2 className="font-heading text-2xl uppercase tracking-[0.2em] text-white">Lookup & Adjust TKD</h2>
              </div>
              <p className="text-xs text-slate-500">Amounts entered in minor units (100 = 1.00 TKD).</p>
            </div>

            <form onSubmit={loadWallet} className="grid gap-4 md:grid-cols-[1fr_auto]">
              <label className="flex flex-col gap-2 text-xs uppercase tracking-[0.3em] text-slate-400">
                User ID
                <input
                  required
                  value={userId}
                  onChange={(event) => setUserId(event.target.value)}
                  className="rounded-2xl border border-white/10 bg-night-900/70 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-500/40"
                />
              </label>
              <button
                type="submit"
                className="self-end rounded-full border border-gold-500/60 bg-gold-500 px-6 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-night-900 shadow-glow transition hover:bg-gold-400"
              >
                {loading ? "Loading…" : "Load Wallet"}
              </button>
            </form>

            <div className="grid gap-4 md:grid-cols-[repeat(3,minmax(0,1fr))]">
              <label className="flex flex-col gap-2 text-xs uppercase tracking-[0.3em] text-slate-400">
                Amount (minor units)
                <input
                  type="number"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  className="rounded-2xl border border-white/10 bg-night-900/70 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-500/40"
                />
              </label>
              <label className="flex flex-col gap-2 text-xs uppercase tracking-[0.3em] text-slate-400 md:col-span-2">
                Note
                <input
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  className="rounded-2xl border border-white/10 bg-night-900/70 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-500/40"
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => mutate("credit")}
                className="rounded-full border border-emerald-500/40 bg-emerald-500/20 px-6 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-emerald-200 transition hover:border-emerald-400 hover:bg-emerald-500/30"
                disabled={loading}
              >
                Credit TKD
              </button>
              <button
                type="button"
                onClick={() => mutate("debit")}
                className="rounded-full border border-rose-500/40 bg-rose-500/20 px-6 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-rose-200 transition hover:border-rose-400 hover:bg-rose-500/30"
                disabled={loading}
              >
                Debit TKD
              </button>
            </div>

            {error && <p className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</p>}

            {wallet && (
              <div className="space-y-4">
                <div className="rounded-2xl border border-white/10 bg-night-900/70 p-5">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Wallet Snapshot</p>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-300">
                    <span>Wallet ID · {wallet.id}</span>
                    <span>Balance · {formatTkd(wallet.balance)}</span>
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-night-900/70 p-5">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Recent Transactions</p>
                  <ul className="mt-3 grid gap-2 text-xs text-slate-300">
                    {wallet.transactions?.length ? (
                      wallet.transactions.map((tx: any) => (
                        <li key={tx.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/5 bg-night-900/70 px-4 py-3">
                          <span>{new Date(tx.createdAt).toLocaleString()}</span>
                          <span className="text-slate-400">{tx.type}</span>
                          <span className={tx.type === "DEBIT" ? "text-rose-300" : "text-emerald-300"}>
                            {tx.type === "DEBIT" ? "-" : "+"}
                            {formatTkd(tx.amount)}
                          </span>
                          <span className="text-slate-500">{tx.source}</span>
                          {tx.note && <span className="text-slate-500">{tx.note}</span>}
                        </li>
                      ))
                    ) : (
                      <li className="rounded-xl border border-white/10 bg-night-900/70 px-4 py-3 text-slate-500">No transactions yet.</li>
                    )}
                  </ul>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </AppShell>
  );
}
