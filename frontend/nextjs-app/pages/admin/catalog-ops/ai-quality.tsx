import Head from "next/head";
import CatalogOpsCompatibilityNotice from "../../../components/catalogOps/CatalogOpsCompatibilityNotice";
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
        subtitle="Compatibility handoff into the standalone AI monitoring and review tools."
      >
        {({ buildHref }) => (
          <CatalogOpsCompatibilityNotice
            eyebrow="Catalog Ops AI Quality"
            title="Use AI Ops for live model health and retry work"
            description="The embedded AI quality surface duplicated the standalone dashboard and made the operating queue harder to scan."
            rationale="Use AI Ops for OCR and LLM monitoring, then jump into Add Cards or KingsReview when an attention case needs manual follow-up."
            actions={[
              {
                label: "Open AI Ops",
                href: buildHref("/admin/ai-ops"),
                detail: "Review live OCR and LLM health, eval coverage, teach-region telemetry, and the quick attention queue.",
                tone: "emerald",
              },
              {
                label: "Open Add Cards",
                href: "/admin/uploads",
                detail: "Work inbound uploads and investigate cards that need to be retried or reintroduced into the pipeline.",
                tone: "gold",
              },
              {
                label: "Open KingsReview",
                href: "/admin/kingsreview",
                detail: "Continue downstream human review when a card has already moved out of the intake queue.",
                tone: "sky",
              },
            ]}
            notes={[
              "This compatibility route stays live for bookmarks, but the standalone AI Ops page is the canonical monitoring surface.",
            ]}
          />
        )}
      </CatalogOpsWorkstationShell>
    </>
  );
}
