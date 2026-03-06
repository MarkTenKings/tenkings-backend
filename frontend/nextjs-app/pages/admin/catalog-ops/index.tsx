import Head from "next/head";
import CatalogOpsCompatibilityNotice from "../../../components/catalogOps/CatalogOpsCompatibilityNotice";
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
        subtitle="Compatibility launchpad for the standalone set, review, QA, and AI admin surfaces."
      >
        {({ buildHref }) => (
          <CatalogOpsCompatibilityNotice
            eyebrow="Catalog Ops Overview"
            title="Use the standalone admin pages"
            description="Catalog Ops created duplicated workflows and cramped tables. The real operating surfaces now live on the standalone admin pages."
            rationale="Keep this route for old bookmarks only. Open the pages below when you need to search sets, run intake/review, curate refs, or investigate AI issues."
            actions={[
              {
                label: "Set Ops",
                href: buildHref("/admin/set-ops"),
                detail: "Search sets, inspect counts, and run archive, replace, or delete flows from the canonical control panel.",
              },
              {
                label: "Set Ops Review",
                href: buildHref("/admin/set-ops-review"),
                detail: "Queue source files, build drafts, approve rows, and monitor seed jobs in the guided review workspace.",
                tone: "gold",
              },
              {
                label: "Variant Ref QA",
                href: buildHref("/admin/variant-ref-qa"),
                detail: "Load seeded variants, process PhotoRoom crops, promote owned refs, and clean reference images.",
                tone: "sky",
              },
              {
                label: "AI Ops",
                href: buildHref("/admin/ai-ops"),
                detail: "Monitor OCR and LLM health, manage eval coverage, and work the quick attention queue.",
                tone: "emerald",
              },
            ]}
            notes={[
              "The standalone pages are canonical because they preserve full-width tables and full action toolbars.",
              "Variants cleanup has been absorbed into Variant Ref QA. The old Variants route remains compatibility-only.",
            ]}
          />
        )}
      </CatalogOpsWorkstationShell>
    </>
  );
}
