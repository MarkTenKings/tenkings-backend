import Head from "next/head";
import AppShell from "../components/AppShell";

export default function Privacy() {
  return (
    <AppShell>
      <Head>
        <title>Ten Kings · Privacy Notice</title>
        <meta name="description" content="How Ten Kings collects, stores, and protects your data." />
      </Head>

      <section className="bg-night-900/80 py-16">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-6">
          <header className="space-y-4">
            <p className="uppercase tracking-[0.3em] text-violet-300">Security & trust</p>
            <h1 className="font-heading text-5xl uppercase tracking-[0.18em] text-white">Privacy Notice</h1>
            <p className="text-sm text-slate-400">
              Updated {new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
            </p>
          </header>

          <article className="space-y-8 rounded-[2rem] border border-white/10 bg-slate-900/60 p-8 text-sm leading-relaxed text-slate-200 shadow-card">
            <section className="space-y-3">
              <h2 className="font-heading text-2xl uppercase tracking-[0.2em] text-white">1. What we collect</h2>
              <ul className="list-disc space-y-2 pl-5 text-slate-300">
                <li>Account identifiers such as phone number, display name, and wallet ID.</li>
                <li>Transaction metadata for TKD credits/debits, pack purchases, and marketplace activity.</li>
                <li>Device information (browser, IP address) used to secure login attempts.</li>
                <li>Images and metadata submitted during card ingestion for vaulting.</li>
              </ul>
            </section>

            <section className="space-y-3">
              <h2 className="font-heading text-2xl uppercase tracking-[0.2em] text-white">2. How we use data</h2>
              <ul className="list-disc space-y-2 pl-5 text-slate-300">
                <li>Authenticate access and deliver SMS one-time codes.</li>
                <li>Maintain the closed-loop ledger for TKD balances and instant buybacks.</li>
                <li>Verify collectibles, detect fraud, and comply with legal obligations.</li>
                <li>Provide customer support and respond to redemption or dispute requests.</li>
              </ul>
            </section>

            <section className="space-y-3">
              <h2 className="font-heading text-2xl uppercase tracking-[0.2em] text-white">3. Sharing</h2>
              <p>
                We share data with vetted providers that power payment processing, identity verification, card scanning, and cloud infrastructure. Each
                provider is contractually required to secure your information and process it only on Ten Kings instructions.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="font-heading text-2xl uppercase tracking-[0.2em] text-white">4. Security</h2>
              <p>
                Access to internal tools is role-based and audited. Sensitive data is encrypted in transit and at rest. We regularly test the platform for
                vulnerabilities and monitor for anomalous activity.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="font-heading text-2xl uppercase tracking-[0.2em] text-white">5. Your choices</h2>
              <ul className="list-disc space-y-2 pl-5 text-slate-300">
                <li>Update account information from the profile dashboard or by contacting support.</li>
                <li>Request a copy of your data by emailing <a className="text-gold-300" href="mailto:privacy@tenkings.co">privacy@tenkings.co</a>.</li>
                <li>Request deletion of your Ten Kings account (subject to retention required for compliance) by emailing support.</li>
              </ul>
            </section>

            <section className="space-y-3">
              <h2 className="font-heading text-2xl uppercase tracking-[0.2em] text-white">6. Contact</h2>
              <p>Privacy questions? Email <a className="text-gold-300" href="mailto:privacy@tenkings.co">privacy@tenkings.co</a>.</p>
            </section>
          </article>
        </div>
      </section>
    </AppShell>
  );
}
