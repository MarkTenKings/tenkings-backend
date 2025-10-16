import Head from "next/head";
import AppShell from "../components/AppShell";

export default function Terms() {
  return (
    <AppShell>
      <Head>
        <title>Ten Kings · Terms of Use</title>
        <meta name="description" content="Terms governing access to Ten Kings vending, marketplace, and closed-loop wallet services." />
      </Head>

      <section className="bg-night-900/80 py-16">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-6">
          <header className="space-y-4">
            <p className="uppercase tracking-[0.3em] text-violet-300">Legal</p>
            <h1 className="font-heading text-5xl uppercase tracking-[0.18em] text-white">Terms of Use</h1>
            <p className="text-sm text-slate-400">
              Updated {new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
            </p>
          </header>

          <article className="space-y-8 rounded-[2rem] border border-white/10 bg-slate-900/60 p-8 text-sm leading-relaxed text-slate-200 shadow-card">
            <section className="space-y-3">
              <h2 className="font-heading text-2xl uppercase tracking-[0.2em] text-white">1. Overview</h2>
              <p>
                Ten Kings operates a closed-loop collectibles platform providing vending machines, digital pack openings, a vault marketplace, and a TKD wallet.
                By using Ten Kings services, you agree to these Terms of Use, the Privacy Notice, and any supplemental policies posted within the app.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="font-heading text-2xl uppercase tracking-[0.2em] text-white">2. Eligibility & Account</h2>
              <p>
                You must be at least 18 years old (or the age of majority in your jurisdiction) and complete identity verification if prompted. You are
                responsible for maintaining the security of your account, including devices used for SMS verification.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="font-heading text-2xl uppercase tracking-[0.2em] text-white">3. Ten Kings Dollars (TKD)</h2>
              <ul className="list-disc space-y-2 pl-5 text-slate-300">
                <li>TKD are closed-loop store credits. They cannot be redeemed for fiat, converted into other tokens, or transferred outside Ten Kings.</li>
                <li>TKD balances increase through instant buybacks, marketplace sales, or promotional credits, and decrease when you purchase packs, vending items, or redemption services.</li>
                <li>TKD never expire, but accounts inactive for twelve months may be reviewed for compliance purposes.</li>
              </ul>
            </section>

            <section className="space-y-3">
              <h2 className="font-heading text-2xl uppercase tracking-[0.2em] text-white">4. Instant Buyback</h2>
              <p>
                When offered, instant buyback credits {Math.round(0.75 * 100)}% of the current Ten Kings market value to your TKD balance. Accepting a buyback immediately transfers ownership of the underlying item back to Ten Kings inventory.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="font-heading text-2xl uppercase tracking-[0.2em] text-white">5. Vaulted Collectibles</h2>
              <p>
                Physical collectibles remain in insured storage until you request redemption. Redemption requires TKD payment of handling and shipping fees.
                Ten Kings is not liable for delays caused by external carriers but will assist with claims when applicable.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="font-heading text-2xl uppercase tracking-[0.2em] text-white">6. Acceptable Use</h2>
              <p>
                You agree not to reverse engineer, interfere with security safeguards, or use Ten Kings services for unlawful activity. Accounts suspected of
                fraud, chargebacks, or abuse may be suspended pending review.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="font-heading text-2xl uppercase tracking-[0.2em] text-white">7. Disclaimers</h2>
              <p>
                Ten Kings provides services on an &ldquo;as-is&rdquo; basis without warranties of any kind. We do not guarantee future value of collectibles, and all
                odds disclosures represent historical or audited projections.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="font-heading text-2xl uppercase tracking-[0.2em] text-white">8. Contact</h2>
              <p>Questions? Email <a className="text-gold-300" href="mailto:support@tenkings.co">support@tenkings.co</a>.</p>
            </section>
          </article>
        </div>
      </section>
    </AppShell>
  );
}
