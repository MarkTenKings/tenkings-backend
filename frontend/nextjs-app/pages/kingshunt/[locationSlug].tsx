import Head from "next/head";
import type { GetServerSideProps, InferGetServerSidePropsType } from "next";
import AppShell from "../../components/AppShell";
import KingsHuntExperience from "../../components/kingshunt/KingsHuntExperience";
import type { KingsHuntLocation } from "../../lib/kingsHunt";
import { getKingsHuntLocationBySlug, resolveEntryMethod } from "../../lib/server/kingsHunt";

interface KingsHuntLocationPageProps {
  location: KingsHuntLocation;
  qrCodeId: string | null;
  entryMethod: string;
}

export const getServerSideProps: GetServerSideProps<KingsHuntLocationPageProps> = async ({ params, query }) => {
  const locationSlug = typeof params?.locationSlug === "string" ? params.locationSlug : null;
  if (!locationSlug) {
    return { notFound: true };
  }

  const location = await getKingsHuntLocationBySlug(locationSlug);
  if (!location) {
    return { notFound: true };
  }

  const qrCodeId = typeof query.qr === "string" ? query.qr : null;
  const entry = typeof query.entry === "string" ? query.entry : null;

  return {
    props: {
      location: JSON.parse(JSON.stringify(location)) as KingsHuntLocation,
      qrCodeId,
      entryMethod: resolveEntryMethod(entry, qrCodeId),
    },
  };
};

export default function KingsHuntLocationPage({
  location,
  qrCodeId,
  entryMethod,
}: InferGetServerSidePropsType<typeof getServerSideProps>) {
  return (
    <AppShell hideHeader hideFooter background="black">
      <Head>
        <title>Ten Kings · Kings Hunt · {location.name}</title>
        <meta
          name="description"
          content={`Live GPS wayfinding to the Ten Kings machine at ${location.name}, with checkpoint rewards and arrival tracking.`}
        />
      </Head>

      <KingsHuntExperience location={location} qrCodeId={qrCodeId} entryMethod={entryMethod} />
    </AppShell>
  );
}
