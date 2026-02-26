import Head from "next/head";
import CatalogOpsOverviewSurface from "../../../components/catalogOps/CatalogOpsOverviewSurface";
import CatalogOpsWorkstationShell from "../../../components/catalogOps/CatalogOpsWorkstationShell";

export default function CatalogOpsOverviewPage() {
  return (
    <>
      <Head>
        <title>Ten Kings · Catalog Ops · Overview</title>
        <meta name="robots" content="noindex" />
      </Head>
      <CatalogOpsWorkstationShell
        surface="overview"
        title="Overview"
        subtitle="High-signal set health overview with panel-based replace/delete actions and workflow routing."
      >
        {({ context, buildHref }) => <CatalogOpsOverviewSurface context={context} buildHref={buildHref} />}
      </CatalogOpsWorkstationShell>
    </>
  );
}
