import Head from "next/head";
import CatalogOpsCompatibilityNotice from "../../../components/catalogOps/CatalogOpsCompatibilityNotice";
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
        subtitle="Compatibility handoff into the standalone Set Ops Review workflow."
      >
        {({ buildHref }) => {
          const baseHref = buildHref("/admin/set-ops-review");
          const ingestionHref = `${baseHref}${baseHref.includes("?") ? "&" : "?"}step=ingestion-queue`;
          const draftHref = `${baseHref}${baseHref.includes("?") ? "&" : "?"}step=draft-approval`;
          const seedHref = `${baseHref}${baseHref.includes("?") ? "&" : "?"}step=seed-monitor`;
          return (
            <CatalogOpsCompatibilityNotice
              eyebrow="Catalog Ops Ingest & Draft"
              title="Run intake and draft work in Set Ops Review"
              description="This route no longer embeds the stepper surface. Use the full standalone page so ingestion tables, draft editors, and seed controls keep their full working width."
              rationale="The underlying APIs and actions have not changed. Only the duplicated wrapper has been removed."
              actions={[
                {
                  label: "Open Ingestion Queue",
                  href: ingestionHref,
                  detail: "Queue source files, upload bulk imports, and select the job that should build the next draft.",
                },
                {
                  label: "Open Draft & Approval",
                  href: draftHref,
                  detail: "Edit draft rows, save a new version, and run approve or reject from the standalone review workspace.",
                  tone: "gold",
                },
                {
                  label: "Open Seed Monitor",
                  href: seedHref,
                  detail: "Launch set-list or parallel-list seeding and monitor seed job progress without the embedded wrapper.",
                  tone: "emerald",
                },
                {
                  label: "Open Set Ops",
                  href: buildHref("/admin/set-ops"),
                  detail: "Use the set-level control panel when you need archive, replace, delete, or footprint inspection instead of draft work.",
                  tone: "sky",
                },
              ]}
              notes={[
                "Set Ops Review is the canonical workflow for ingestion queue, draft approval, and seed monitoring.",
                "This compatibility route remains live so old bookmarks still resolve safely.",
              ]}
            />
          );
        }}
      </CatalogOpsWorkstationShell>
    </>
  );
}
