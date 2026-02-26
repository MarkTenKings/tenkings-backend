import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { FormEvent, useEffect, useState } from "react";
import CatalogOpsLegacyFrame from "../../../components/catalogOps/CatalogOpsLegacyFrame";
import CatalogOpsWorkstationShell from "../../../components/catalogOps/CatalogOpsWorkstationShell";

function normalizeTab(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === "reference-qa") return "reference-qa";
  return "catalog-dictionary";
}

function readQueryValue(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" ? raw.trim() : "";
}

export default function CatalogOpsVariantStudioPage() {
  const router = useRouter();
  const tab = normalizeTab(router.query.tab);
  const querySetId = readQueryValue(router.query.setId);
  const queryProgramId = readQueryValue(router.query.programId);
  const [setIdInput, setSetIdInput] = useState(querySetId);
  const [programIdInput, setProgramIdInput] = useState(queryProgramId);
  const legacyPath = tab === "reference-qa" ? "/admin/variant-ref-qa" : "/admin/variants";
  const surfaceTitle = tab === "reference-qa" ? "Reference QA" : "Catalog Dictionary";

  useEffect(() => {
    setSetIdInput(querySetId);
  }, [querySetId]);

  useEffect(() => {
    setProgramIdInput(queryProgramId);
  }, [queryProgramId]);

  return (
    <>
      <Head>
        <title>Ten Kings · Catalog Ops · Variant Studio</title>
        <meta name="robots" content="noindex" />
      </Head>
      <CatalogOpsWorkstationShell
        surface="variant-studio"
        title="Variant Studio"
        subtitle="Consolidated Catalog Dictionary + Reference QA subtabs with shared set/program context."
      >
        {({ buildHref, context }) => {
          const applyContext = (event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            const nextHref = buildHref("/admin/catalog-ops/variant-studio", {
              tab,
              setId: setIdInput.trim() || undefined,
              programId: programIdInput.trim() || undefined,
            });
            void router.replace(nextHref, undefined, { shallow: true });
          };

          const clearContext = () => {
            const nextHref = buildHref("/admin/catalog-ops/variant-studio", {
              tab,
              setId: undefined,
              programId: undefined,
            });
            void router.replace(nextHref, undefined, { shallow: true });
          };

          return (
            <div className="space-y-4">
              <section className="rounded-3xl border border-white/10 bg-night-900/70 p-4 shadow-card">
                <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Variant Studio Subtabs</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link
                    href={buildHref("/admin/catalog-ops/variant-studio", { tab: "catalog-dictionary" })}
                    className={`rounded-full border px-4 py-2 text-xs uppercase tracking-[0.24em] transition ${
                      tab === "catalog-dictionary"
                        ? "border-gold-500/50 bg-gold-500/15 text-gold-100"
                        : "border-white/20 text-slate-200 hover:border-white/40 hover:text-white"
                    }`}
                  >
                    Catalog Dictionary
                  </Link>
                  <Link
                    href={buildHref("/admin/catalog-ops/variant-studio", { tab: "reference-qa" })}
                    className={`rounded-full border px-4 py-2 text-xs uppercase tracking-[0.24em] transition ${
                      tab === "reference-qa"
                        ? "border-gold-500/50 bg-gold-500/15 text-gold-100"
                        : "border-white/20 text-slate-200 hover:border-white/40 hover:text-white"
                    }`}
                  >
                    Reference QA
                  </Link>
                </div>
              </section>

              <section className="rounded-3xl border border-white/10 bg-night-900/70 p-4 shadow-card">
                <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Shared Context</p>
                <form className="mt-3 grid gap-3 md:grid-cols-2" onSubmit={applyContext}>
                  <input
                    value={setIdInput}
                    onChange={(event) => setSetIdInput(event.target.value)}
                    placeholder="Set ID context (shared across subtabs)"
                    className="h-11 rounded-xl border border-white/15 bg-night-950/70 px-3 text-sm text-white outline-none focus:border-gold-500/70"
                  />
                  <input
                    value={programIdInput}
                    onChange={(event) => setProgramIdInput(event.target.value)}
                    placeholder="Program/Card Type context (optional)"
                    className="h-11 rounded-xl border border-white/15 bg-night-950/70 px-3 text-sm text-white outline-none focus:border-gold-500/70"
                  />
                  <div className="md:col-span-2 flex flex-wrap gap-2">
                    <button
                      type="submit"
                      className="h-10 rounded-xl border border-gold-500/60 bg-gold-500 px-4 text-xs font-semibold uppercase tracking-[0.16em] text-night-900 transition hover:bg-gold-400"
                    >
                      Apply Context
                    </button>
                    <button
                      type="button"
                      onClick={clearContext}
                      className="h-10 rounded-xl border border-white/20 px-4 text-xs font-semibold uppercase tracking-[0.16em] text-slate-100 transition hover:border-white/40"
                    >
                      Clear Context
                    </button>
                    <Link
                      href={buildHref("/admin/catalog-ops/ingest-draft", { tab: "draft-approval" })}
                      className="inline-flex h-10 items-center rounded-xl border border-white/20 px-4 text-xs font-semibold uppercase tracking-[0.16em] text-slate-100 transition hover:border-white/40"
                    >
                      Open Ingest & Draft
                    </Link>
                  </div>
                </form>
                <p className="mt-3 text-xs text-slate-400">
                  Active context: set=<span className="text-slate-200">{context.setId || "-"}</span> · program=
                  <span className="text-slate-200">{context.programId || "-"}</span>
                </p>
              </section>

              <CatalogOpsLegacyFrame
                title={`${surfaceTitle} Surface`}
                description="Phase 2 consolidates both variant workflows into this one route with shared context and subtabs while preserving current QA actions."
                legacyHref={buildHref(legacyPath, { tab })}
              />
            </div>
          );
        }}
      </CatalogOpsWorkstationShell>
    </>
  );
}
