import Head from "next/head";
import CatalogOpsCompatibilityNotice from "../../../components/catalogOps/CatalogOpsCompatibilityNotice";
import CatalogOpsWorkstationShell from "../../../components/catalogOps/CatalogOpsWorkstationShell";

export default function CatalogOpsVariantStudioPage() {
  return (
    <>
      <Head>
        <title>Ten Kings · Catalog Ops · Variant Studio</title>
        <meta name="robots" content="noindex" />
      </Head>
      <CatalogOpsWorkstationShell
        surface="variant-studio"
        title="Variant Studio"
        subtitle="Compatibility handoff into the standalone reference QA and set workflow pages."
      >
        {({ buildHref }) => (
          <CatalogOpsCompatibilityNotice
            eyebrow="Catalog Ops Variant Studio"
            title="Work variants and refs in Variant Ref QA"
            description="Variant Studio duplicated the old variants cleanup and reference QA surfaces. Those workflows now live on the standalone pages."
            rationale="Use Variant Ref QA for reference-image cleanup and manual curation. Use Set Ops Review for ingestion, draft approval, and seeding that feeds the QA queue."
            actions={[
              {
                label: "Open Variant Ref QA",
                href: buildHref("/admin/variant-ref-qa"),
                detail: "Load seeded variants, filter the queue, process PhotoRoom crops, upload replacements, and promote owned refs.",
                tone: "sky",
              },
              {
                label: "Open Set Ops Review",
                href: buildHref("/admin/set-ops-review"),
                detail: "Run the upstream intake, draft, and seed workflow that produces the variant buckets used by Variant Ref QA.",
                tone: "gold",
              },
              {
                label: "Open Set Ops",
                href: buildHref("/admin/set-ops"),
                detail: "Inspect set-level counts and control archive, replace, or delete operations outside the QA surface.",
                tone: "emerald",
              },
            ]}
            notes={[
              "The old Variants (Moved) workflow has been absorbed into Variant Ref QA and no longer needs a separate destination.",
              "Current query context is preserved when you open the standalone pages from this compatibility route.",
            ]}
          />
        )}
      </CatalogOpsWorkstationShell>
    </>
  );
}
