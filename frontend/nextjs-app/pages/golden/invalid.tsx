import Head from "next/head";
import Link from "next/link";
import AppShell from "../../components/AppShell";

export default function GoldenTicketInvalidPage() {
  return (
    <AppShell background="gilded" brandVariant="collectibles">
      <Head>
        <title>Invalid Golden Ticket | Ten Kings</title>
      </Head>
      <div className="mx-auto flex min-h-[70vh] w-full max-w-3xl items-center px-6 py-16">
        <div className="w-full rounded-[2rem] border border-amber-300/20 bg-black/40 p-8 text-center shadow-2xl backdrop-blur">
          <p className="text-xs uppercase tracking-[0.36em] text-amber-300">Golden Ticket</p>
          <h1 className="mt-4 font-heading text-4xl uppercase tracking-[0.14em] text-white">This isn&apos;t a valid Golden Ticket.</h1>
          <p className="mt-4 text-sm text-slate-300">
            Check that you scanned the correct QR code. If this looks wrong, email support@tenkings.co and include a photo of the ticket.
          </p>
          <div className="mt-8">
            <Link
              href="/packs"
              className="inline-flex rounded-full border border-gold-500/60 bg-gold-500 px-6 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-black"
            >
              Shop Mystery Packs
            </Link>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
