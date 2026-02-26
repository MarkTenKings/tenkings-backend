import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useState } from "react";
import AppShell from "../AppShell";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../constants/admin";
import { useSession } from "../../hooks/useSession";
import { buildAdminHeaders } from "../../lib/adminHeaders";
import { readCatalogOpsFlags } from "../../lib/catalogOpsFlags";

type SetOpsPermissions = {
  reviewer: boolean;
  approver: boolean;
  delete: boolean;
  admin: boolean;
};

type AccessResponse =
  | {
      permissions: SetOpsPermissions;
    }
  | {
      message: string;
    };

type CatalogOpsSurfaceId = "overview" | "ingest-draft" | "variant-studio" | "ai-quality";

type CatalogOpsContext = {
  setId?: string;
  programId?: string;
  jobId?: string;
  tab?: string;
  queueFilter?: string;
};

type ShellRenderArgs = {
  context: CatalogOpsContext;
  buildHref: (pathname: string, overrides?: Partial<CatalogOpsContext>) => string;
};

const SURFACE_CONFIG: Record<
  CatalogOpsSurfaceId,
  {
    label: string;
    path: string;
    flagKey: "overviewV2" | "ingestStepper" | "variantStudio" | "aiQuality";
    legacyPath: string;
  }
> = {
  overview: {
    label: "Overview",
    path: "/admin/catalog-ops",
    flagKey: "overviewV2",
    legacyPath: "/admin/set-ops",
  },
  "ingest-draft": {
    label: "Ingest & Draft",
    path: "/admin/catalog-ops/ingest-draft",
    flagKey: "ingestStepper",
    legacyPath: "/admin/set-ops-review",
  },
  "variant-studio": {
    label: "Variant Studio",
    path: "/admin/catalog-ops/variant-studio",
    flagKey: "variantStudio",
    legacyPath: "/admin/variants",
  },
  "ai-quality": {
    label: "AI Quality",
    path: "/admin/catalog-ops/ai-quality",
    flagKey: "aiQuality",
    legacyPath: "/admin/ai-ops",
  },
};

function readQueryValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return typeof value[0] === "string" && value[0].trim() ? value[0].trim() : undefined;
  }
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function createHref(pathname: string, context: CatalogOpsContext, overrides: Partial<CatalogOpsContext> = {}) {
  const merged = {
    ...context,
    ...overrides,
  };

  const params = new URLSearchParams();
  const entries: Array<[keyof CatalogOpsContext, string | undefined]> = [
    ["setId", merged.setId],
    ["programId", merged.programId],
    ["jobId", merged.jobId],
    ["tab", merged.tab],
    ["queueFilter", merged.queueFilter],
  ];
  for (const [key, value] of entries) {
    if (!value) continue;
    params.set(key, value);
  }

  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function roleBadgeClass(enabled: boolean | null) {
  if (enabled == null) return "border-white/20 bg-night-900/60 text-slate-400";
  if (enabled) return "border-emerald-400/40 bg-emerald-500/10 text-emerald-200";
  return "border-rose-400/40 bg-rose-500/10 text-rose-200";
}

function envLabel() {
  if (process.env.NODE_ENV === "production") return "Production";
  if (process.env.NODE_ENV === "development") return "Development";
  return "Preview";
}

type CatalogOpsWorkstationShellProps = {
  surface: CatalogOpsSurfaceId;
  title: string;
  subtitle: string;
  children: (args: ShellRenderArgs) => React.ReactNode;
};

export default function CatalogOpsWorkstationShell({ surface, title, subtitle, children }: CatalogOpsWorkstationShellProps) {
  const router = useRouter();
  const { session, loading, ensureSession, logout } = useSession();
  const isAdmin = useMemo(
    () => hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone),
    [session?.user.id, session?.user.phone]
  );

  const flags = useMemo(() => readCatalogOpsFlags(), []);
  const surfaceConfig = SURFACE_CONFIG[surface];
  const surfaceEnabled = flags.workstation && flags[surfaceConfig.flagKey];
  const adminHeaders = useMemo(() => buildAdminHeaders(session?.token), [session?.token]);
  const [permissions, setPermissions] = useState<SetOpsPermissions | null>(null);
  const [accessBusy, setAccessBusy] = useState(false);

  const context = useMemo<CatalogOpsContext>(
    () => ({
      setId: readQueryValue(router.query.setId),
      programId: readQueryValue(router.query.programId),
      jobId: readQueryValue(router.query.jobId),
      tab: readQueryValue(router.query.tab),
      queueFilter: readQueryValue(router.query.queueFilter),
    }),
    [router.query.jobId, router.query.programId, router.query.queueFilter, router.query.setId, router.query.tab]
  );

  const buildHref = useCallback(
    (pathname: string, overrides: Partial<CatalogOpsContext> = {}) => createHref(pathname, context, overrides),
    [context]
  );

  useEffect(() => {
    if (!session || !isAdmin) return;
    const controller = new AbortController();
    setAccessBusy(true);

    fetch("/api/admin/set-ops/access", {
      headers: adminHeaders,
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as AccessResponse;
        if (!response.ok || !("permissions" in payload)) {
          return;
        }
        setPermissions(payload.permissions);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!controller.signal.aborted) {
          setAccessBusy(false);
        }
      });

    return () => controller.abort();
  }, [adminHeaders, isAdmin, session]);

  const legacyLinks = [
    { label: "Set Ops", href: buildHref("/admin/set-ops") },
    { label: "Set Ops Review", href: buildHref("/admin/set-ops-review") },
    { label: "Variants", href: buildHref("/admin/variants") },
    { label: "Variant Ref QA", href: buildHref("/admin/variant-ref-qa") },
    { label: "AI Ops", href: buildHref("/admin/ai-ops") },
  ];

  const roleItems: Array<{ label: string; value: boolean | null }> = [
    { label: "reviewer", value: permissions?.reviewer ?? null },
    { label: "approver", value: permissions?.approver ?? null },
    { label: "delete", value: permissions?.delete ?? null },
    { label: "admin", value: permissions?.admin ?? null },
  ];

  const contextItems = [
    { key: "Set", value: context.setId },
    { key: "Program", value: context.programId },
    { key: "Job", value: context.jobId },
    { key: "Tab", value: context.tab },
    { key: "Queue", value: context.queueFilter },
  ];

  const mainBody = () => {
    if (loading) {
      return (
        <div className="flex min-h-[60vh] items-center justify-center">
          <p className="text-sm uppercase tracking-[0.35em] text-slate-400">Checking access…</p>
        </div>
      );
    }

    if (!session) {
      return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-5 text-center">
          <p className="text-sm uppercase tracking-[0.32em] text-slate-400">Admin Access Only</p>
          <h1 className="font-heading text-4xl uppercase tracking-[0.18em] text-white">Sign in to continue</h1>
          <p className="max-w-md text-sm text-slate-400">
            Use your Ten Kings phone number. Only approved operators can access Catalog Ops.
          </p>
          <button
            type="button"
            onClick={() => ensureSession().catch(() => undefined)}
            className="rounded-full border border-gold-500/60 bg-gold-500 px-8 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-night-900 shadow-glow transition hover:bg-gold-400"
          >
            Sign In
          </button>
        </div>
      );
    }

    if (!isAdmin) {
      return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-5 text-center">
          <p className="text-sm uppercase tracking-[0.32em] text-rose-300">Access Denied</p>
          <h1 className="font-heading text-4xl uppercase tracking-[0.18em] text-white">You do not have admin rights</h1>
          <p className="max-w-md text-sm text-slate-400">
            This console is restricted to Ten Kings operators. Contact an administrator for access.
          </p>
          <button
            type="button"
            onClick={logout}
            className="rounded-full border border-white/20 px-8 py-3 text-xs uppercase tracking-[0.3em] text-slate-200 transition hover:border-white/40 hover:text-white"
          >
            Sign Out
          </button>
        </div>
      );
    }

    return (
      <div className="mx-auto flex w-full max-w-[1460px] flex-col gap-4 px-4 py-6 lg:px-6">
        <header className="rounded-3xl border border-white/10 bg-night-900/70 p-5 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-[0.34em] text-violet-300">Catalog Ops Workstation</p>
              <h1 className="font-heading text-3xl uppercase tracking-[0.16em] text-white">{title}</h1>
              <p className="text-sm text-slate-300">{subtitle}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-sky-300/40 bg-sky-500/10 px-3 py-1 text-xs uppercase tracking-[0.26em] text-sky-200">
                {envLabel()}
              </span>
              <button
                type="button"
                onClick={() => router.replace(router.asPath)}
                className="rounded-full border border-white/20 px-3 py-1 text-xs uppercase tracking-[0.22em] text-slate-200 transition hover:border-white/40 hover:text-white"
              >
                Global Refresh
              </button>
              <Link
                href="/admin"
                className="rounded-full border border-white/20 px-3 py-1 text-xs uppercase tracking-[0.22em] text-slate-200 transition hover:border-white/40 hover:text-white"
              >
                Admin Home
              </Link>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {roleItems.map((role) => (
              <span
                key={role.label}
                className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.2em] ${roleBadgeClass(role.value)}`}
              >
                {role.label}
                {role.value == null ? " · -" : role.value ? " · yes" : " · no"}
              </span>
            ))}
            {accessBusy && <span className="text-xs uppercase tracking-[0.22em] text-slate-400">loading roles…</span>}
          </div>
        </header>

        <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="rounded-3xl border border-white/10 bg-night-900/70 p-4 shadow-card">
            <p className="mb-3 text-xs uppercase tracking-[0.3em] text-slate-400">Workstation</p>
            <nav className="flex flex-col gap-2">
              {Object.values(SURFACE_CONFIG).map((item) => {
                const active = item.path === surfaceConfig.path;
                return (
                  <Link
                    key={item.path}
                    href={buildHref(item.path)}
                    className={`rounded-2xl border px-3 py-2 text-sm uppercase tracking-[0.2em] transition ${
                      active
                        ? "border-gold-500/50 bg-gold-500/15 text-gold-100"
                        : "border-white/10 bg-night-900/40 text-slate-300 hover:border-white/30 hover:text-white"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
            <div className="mt-5 space-y-2 border-t border-white/10 pt-4">
              <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Legacy Links</p>
              {legacyLinks.map((item) => (
                <Link key={item.href} href={item.href} className="block text-sm text-slate-300 underline hover:text-white">
                  {item.label}
                </Link>
              ))}
            </div>
          </aside>

          <main className="space-y-4">
            <section className="rounded-3xl border border-white/10 bg-night-900/70 p-4 shadow-card">
              <div className="flex flex-wrap items-center gap-2">
                {contextItems.map((item) => (
                  <span
                    key={item.key}
                    className="rounded-full border border-white/15 bg-night-900/60 px-3 py-1 text-xs uppercase tracking-[0.2em] text-slate-300"
                  >
                    {item.key}: {item.value ?? "-"}
                  </span>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-3">
                <Link href={buildHref(surfaceConfig.legacyPath)} className="text-xs uppercase tracking-[0.24em] text-gold-200 underline hover:text-gold-100">
                  Open Legacy Surface
                </Link>
                <Link
                  href={buildHref("/admin/catalog-ops", { tab: "overview" })}
                  className="text-xs uppercase tracking-[0.24em] text-slate-300 underline hover:text-white"
                >
                  Reset View Context
                </Link>
              </div>
            </section>

            {!surfaceEnabled ? (
              <section className="rounded-3xl border border-amber-400/40 bg-amber-500/10 p-6">
                <p className="text-xs uppercase tracking-[0.3em] text-amber-200">Surface disabled by feature flag</p>
                <h2 className="mt-2 font-heading text-2xl uppercase tracking-[0.14em] text-white">{surfaceConfig.label}</h2>
                <p className="mt-2 text-sm text-amber-100/90">
                  Enable <code className="font-mono">CATALOG_OPS_WORKSTATION</code> and this surface flag to use the shell route in this environment.
                </p>
                <div className="mt-4">
                  <Link
                    href={buildHref(surfaceConfig.legacyPath)}
                    className="inline-flex rounded-full border border-amber-300/60 px-4 py-2 text-xs uppercase tracking-[0.24em] text-amber-100 transition hover:border-amber-200 hover:text-white"
                  >
                    Open Legacy Route
                  </Link>
                </div>
              </section>
            ) : (
              children({ context, buildHref })
            )}
          </main>
        </div>
      </div>
    );
  };

  return <AppShell>{mainBody()}</AppShell>;
}
