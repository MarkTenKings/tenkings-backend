import Head from "next/head";
import CatalogOpsAiQualitySurface from "../../../components/catalogOps/CatalogOpsAiQualitySurface";
import CatalogOpsWorkstationShell from "../../../components/catalogOps/CatalogOpsWorkstationShell";

export default function CatalogOpsAiQualityPage() {
  return (
    <>
      <Head>
        <title>Ten Kings · Catalog Ops · AI Quality</title>
        <meta name="robots" content="noindex" />
      </Head>
      <CatalogOpsWorkstationShell
        surface="ai-quality"
        title="AI Quality"
        subtitle="Integrated AI quality surface with context-aware failure analysis and workflow deep links."
      >
        {({ context, buildHref }) => <CatalogOpsAiQualitySurface context={context} buildHref={buildHref} />}
      </CatalogOpsWorkstationShell>
    </>
  );
}
