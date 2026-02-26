import Head from "next/head";
import CatalogOpsLegacyFrame from "../../../components/catalogOps/CatalogOpsLegacyFrame";
import CatalogOpsWorkstationShell from "../../../components/catalogOps/CatalogOpsWorkstationShell";

export default function CatalogOpsIngestDraftPage() {
  return (
    <>
      <Head>
        <title>Ten Kings · Catalog Ops · Ingest & Draft</title>
        <meta name="robots" content="noindex" />
      </Head>
      <CatalogOpsWorkstationShell
        surface="ingest-draft"
        title="Ingest & Draft"
        subtitle="Guided stepper surface for source intake, queue, draft approval, and seed monitor."
      >
        {({ buildHref }) => {
          const baseHref = buildHref("/admin/set-ops-review");
          const stepperHref = `${baseHref}${baseHref.includes("?") ? "&" : "?"}step=source-intake`;
          return (
            <CatalogOpsLegacyFrame
              title="Set Ops Review Stepper Surface"
              description="Phase 1 keeps existing APIs and actions while presenting the guided stepper workflow."
              legacyHref={stepperHref}
            />
          );
        }}
      </CatalogOpsWorkstationShell>
    </>
  );
}
