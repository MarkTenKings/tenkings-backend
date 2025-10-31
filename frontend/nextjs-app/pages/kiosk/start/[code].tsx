import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";

export default function KioskPackStartPage() {
  const router = useRouter();
  const { code } = router.query;
  const packCode = typeof code === "string" ? code : "";

  return (
    <div className="min-h-screen bg-night-950 text-white">
      <Head>
        <title>Kiosk Pack QR · Ten Kings</title>
        <meta name="robots" content="noindex" />
      </Head>

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-16">
        <header>
          <p className="text-xs uppercase tracking-[0.32em] text-slate-400">Kiosk Operations</p>
          <h1 className="mt-2 font-heading text-3xl uppercase tracking-[0.18em] text-white">Pack Activation QR</h1>
        </header>

        <div className="rounded-3xl border border-white/10 bg-night-900/70 p-6 text-sm text-slate-200">
          <p>
            This QR code unlocks a kiosk session for a specific sealed pack. Operators should scan it from the kiosk
            control tablet or the <Link href="/admin/packing" className="underline">packing console</Link> to start a
            new live rip.
          </p>

          <div className="mt-4 rounded-2xl border border-white/10 bg-night-900/80 p-4 font-mono text-sm text-slate-100">
            <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">Pack Code</p>
            <p className="mt-2 break-all">{packCode || "Loading…"}</p>
          </div>

          <ul className="mt-4 space-y-3 text-xs text-slate-300">
            <li>
              1. Verify the pack is sealed and has the matching QR sticker affixed.
            </li>
            <li>
              2. From the kiosk control device, POST to <code className="rounded bg-night-900 px-1 py-0.5">/api/kiosk/start</code>{" "}
              with <code>packCode</code> set to the value above and include your kiosk secret header.
            </li>
            <li>
              3. Once the live rip completes, deposit the card into the vault or hand it back to the collector.
            </li>
          </ul>

          <p className="mt-4 text-xs text-slate-400">
            Need help? Reach out to the Ten Kings ops channel and share the pack code shown here.
          </p>
        </div>
      </div>
    </div>
  );
}
