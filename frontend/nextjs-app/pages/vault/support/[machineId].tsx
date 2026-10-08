import Head from "next/head";
import type { GetServerSideProps } from "next";
import { publicVaultSupport, vaultSupportLinks, type PublicVaultSupport } from "../../../lib/vaultSupport";

export default function VaultSupportPage({ support }: { support: PublicVaultSupport }) {
  const links = vaultSupportLinks(support);
  return <>
    <Head><title>Ten Kings Vault Support</title><meta name="robots" content="noindex,nofollow" /><meta name="referrer" content="no-referrer" /></Head>
    <main className="min-h-screen bg-[#080706] px-5 py-12 text-[#fff8df]">
      <section className="mx-auto max-w-xl rounded-2xl border border-[#806329] bg-[#12100d] p-7">
        <p className="mb-3 text-sm tracking-widest text-[#f3d27b]">TEN KINGS · THE VAULT</p>
        <h1 className="mb-4 text-3xl font-semibold">How can we help?</h1>
        <p className="mb-6 text-[#b5aa92]">Choose email, text, or phone to contact Ten Kings. Keep your short reference handy. Never send your PIN or payment-card details.</p>
        {support.reference && <p className="mb-3">Support reference: <strong className="text-xl text-[#f3d27b]">{support.reference}</strong></p>}
        {support.doorIds.length > 0 && <p className="mb-3">Reported doors: {support.doorIds.join(" · ")}</p>}
        <p className="mb-6">Support hours: {support.hours}</p>
        <div className="grid gap-4">
          <a className="flex min-h-16 flex-col justify-center rounded-xl border border-[#806329] p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f3d27b]" href={links.email}><strong>Email</strong><span className="break-all text-[#f3d27b]">{support.email}</span></a>
          <a className="flex min-h-16 flex-col justify-center rounded-xl border border-[#806329] p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f3d27b]" href={links.text}><strong>Text message</strong><span className="text-[#f3d27b]">{support.textNumber}</span></a>
          <a className="flex min-h-16 flex-col justify-center rounded-xl border border-[#806329] p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f3d27b]" href={links.call}><strong>Phone call</strong><span className="text-[#f3d27b]">{support.phoneNumber}</span></a>
        </div>
        <p className="mt-6 text-sm text-[#b5aa92]">If the machine is checking your payment, do not pay again. The support team can review your reference. A reference on this page is not proof of payment.</p>
      </section>
    </main>
  </>;
}

export const getServerSideProps: GetServerSideProps<{ support: PublicVaultSupport }> = async ({ params, query, res }) => {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  const machineId = params?.machineId;
  if (typeof machineId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(machineId)) return { notFound: true };
  const [{ prisma }, { VaultConfigPayloadSchema, configDigest }] = await Promise.all([import("@tenkings/database"), import("@tenkings/vault-contracts")]);
  const machine = await prisma.vaultMachine.findUnique({ where: { id: machineId }, select: { activeConfig: { select: { canonicalPayload: true, digest: true, status: true } } } });
  // A draft or unpublished machine never exposes deployment configuration. Preserve
  // contact access after machine outages/decommission so existing customers can get help.
  if (!machine?.activeConfig || !["PUBLISHED", "SUPERSEDED"].includes(machine.activeConfig.status)) return { notFound: true };
  const parsed = VaultConfigPayloadSchema.safeParse(machine.activeConfig.canonicalPayload);
  if (!parsed.success || parsed.data.machineId !== machineId || configDigest(parsed.data) !== machine.activeConfig.digest) return { notFound: true };
  return { props: { support: publicVaultSupport(parsed.data.support, { ref: query.ref, doors: query.doors }) } };
};
