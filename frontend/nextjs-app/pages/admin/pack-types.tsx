import Head from "next/head";
import { useCallback, useEffect, useMemo, useState } from "react";
import AppShell from "../../components/AppShell";
import { PackTypeCard } from "../../components/admin/PackTypeCard";
import { PackTypeEditorModal, type PackTypeEditorSubmitValue } from "../../components/admin/PackTypeEditorModal";
import {
  ADMIN_PAGE_FRAME_CLASS,
  AdminPageHeader,
  adminPanelClass,
  adminStatCardClass,
} from "../../components/admin/AdminPrimitives";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../constants/admin";
import { useSession } from "../../hooks/useSession";
import { type AdminPackType } from "../../lib/adminPackTypes";
import { buildAdminHeaders } from "../../lib/adminHeaders";

type Notice = {
  tone: "success" | "error";
  message: string;
};

type EditorState =
  | { mode: "create"; packType: null }
  | { mode: "edit"; packType: AdminPackType };

export default function PackTypesPage() {
  const { session, loading, ensureSession, logout } = useSession();
  const [packTypes, setPackTypes] = useState<AdminPackType[]>([]);
  const [pageLoading, setPageLoading] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [editorState, setEditorState] = useState<EditorState | null>(null);
  const [editorBusy, setEditorBusy] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);

  const isAdmin = useMemo(
    () => hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone),
    [session?.user.id, session?.user.phone]
  );
  const adminHeaders = useMemo(() => buildAdminHeaders(session?.token), [session?.token]);

  const loadPackTypes = useCallback(async () => {
    if (!session?.token || !isAdmin) {
      return;
    }

    setPageLoading(true);
    setPageError(null);

    try {
      const response = await fetch("/api/admin/pack-types", {
        headers: adminHeaders,
      });
      const payload = (await response.json()) as { packTypes?: AdminPackType[]; message?: string };
      if (!response.ok || !payload.packTypes) {
        throw new Error(payload.message ?? "Failed to load pack types");
      }
      setPackTypes(payload.packTypes);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Failed to load pack types");
    } finally {
      setPageLoading(false);
    }
  }, [adminHeaders, isAdmin, session?.token]);

  useEffect(() => {
    void loadPackTypes();
  }, [loadPackTypes]);

  const activeCount = packTypes.filter((packType) => packType.isActive).length;
  const inactiveCount = packTypes.length - activeCount;

  const handleSubmit = async (value: PackTypeEditorSubmitValue) => {
    const currentEditor = editorState;
    if (!currentEditor) {
      return;
    }

    setEditorBusy(true);
    setEditorError(null);
    setNotice(null);

    let savedPackType: AdminPackType | null = null;

    try {
      const endpoint = currentEditor.mode === "create" ? "/api/admin/pack-types" : `/api/admin/pack-types/${currentEditor.packType.id}`;
      const method = currentEditor.mode === "create" ? "POST" : "PUT";
      const response = await fetch(endpoint, {
        method,
        headers: {
          ...adminHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: value.name,
          category: value.category,
          tier: value.tier,
          description: value.description,
          isActive: value.isActive,
        }),
      });
      const payload = (await response.json()) as { packType?: AdminPackType; message?: string };
      if (!response.ok || !payload.packType) {
        throw new Error(payload.message ?? "Failed to save pack type");
      }

      savedPackType = payload.packType;

      if (value.imageFile) {
        const form = new FormData();
        form.set("image", value.imageFile);
        const imageResponse = await fetch(`/api/admin/pack-types/${payload.packType.id}/image`, {
          method: "PUT",
          headers: adminHeaders,
          body: form,
        });
        const imagePayload = (await imageResponse.json()) as { packType?: AdminPackType; message?: string };
        if (!imageResponse.ok || !imagePayload.packType) {
          throw new Error(imagePayload.message ?? "Pack type saved, but image upload failed");
        }
        savedPackType = imagePayload.packType;
      }

      await loadPackTypes();
      setEditorState(null);
      setNotice({
        tone: "success",
        message: `${savedPackType.name} ${currentEditor.mode === "create" ? "created" : "updated"}.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save pack type";
      if (savedPackType) {
        await loadPackTypes();
        setEditorState({ mode: "edit", packType: savedPackType });
      }
      setEditorError(message);
    } finally {
      setEditorBusy(false);
    }
  };

  const gate = (() => {
    if (loading) {
      return (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm uppercase tracking-[0.32em] text-slate-500">Checking access...</p>
        </div>
      );
    }

    if (!session) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
          <p className="text-sm uppercase tracking-[0.32em] text-slate-400">Admin Access Only</p>
          <h1 className="font-heading text-4xl uppercase tracking-[0.18em] text-white">Sign in to continue</h1>
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
        <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
          <p className="text-sm uppercase tracking-[0.32em] text-rose-300">Access Denied</p>
          <h1 className="font-heading text-4xl uppercase tracking-[0.18em] text-white">You do not have admin rights</h1>
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

    return null;
  })();

  if (gate) {
    return (
      <AppShell>
        <Head>
          <title>Ten Kings · Pack Types</title>
          <meta name="robots" content="noindex" />
        </Head>
        {gate}
      </AppShell>
    );
  }

  return (
    <AppShell>
      <Head>
        <title>Ten Kings · Pack Types</title>
        <meta name="robots" content="noindex" />
      </Head>

      <div className={ADMIN_PAGE_FRAME_CLASS}>
        <AdminPageHeader
          backHref="/admin"
          backLabel="← Admin Home"
          eyebrow="Pack Management"
          title="Pack Types"
          description="Manage your pack definitions. Each pack type defines a category, price tier, and pack image used across the system."
          actions={
            <button
              type="button"
              onClick={() => {
                setEditorError(null);
                setEditorState({ mode: "create", packType: null });
              }}
              className="rounded-full border border-gold-400/60 bg-gold-500 px-5 py-3 text-[11px] uppercase tracking-[0.22em] text-night-950 transition hover:bg-gold-400"
            >
              + Create Pack Type
            </button>
          }
        />

        {notice ? (
          <section
            className={adminPanelClass(
              notice.tone === "success"
                ? "border-emerald-400/25 bg-emerald-500/10 p-4"
                : "border-rose-400/25 bg-rose-500/10 p-4"
            )}
          >
            <p className={notice.tone === "success" ? "text-sm text-emerald-100" : "text-sm text-rose-200"}>
              {notice.message}
            </p>
          </section>
        ) : null}

        {pageError ? (
          <section className={adminPanelClass("border-rose-400/25 bg-rose-500/10 p-4")}>
            <p className="text-sm text-rose-200">{pageError}</p>
          </section>
        ) : null}

        <section className="grid gap-4 xl:grid-cols-3">
          <article className={adminStatCardClass("p-4")}>
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Total Pack Types</p>
            <p className="mt-3 text-3xl font-semibold text-white">{packTypes.length}</p>
          </article>
          <article className={adminStatCardClass("p-4")}>
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Active</p>
            <p className="mt-3 text-3xl font-semibold text-emerald-300">{activeCount}</p>
          </article>
          <article className={adminStatCardClass("p-4")}>
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Inactive</p>
            <p className="mt-3 text-3xl font-semibold text-slate-200">{inactiveCount}</p>
          </article>
        </section>

        <section className={adminPanelClass("p-5 md:p-6")}>
          {pageLoading && packTypes.length === 0 ? (
            <div className="rounded-[24px] border border-white/10 bg-white/[0.02] px-5 py-16 text-center text-sm text-slate-400">
              Loading pack types...
            </div>
          ) : packTypes.length === 0 ? (
            <div className="rounded-[24px] border border-dashed border-white/12 bg-white/[0.02] px-5 py-16 text-center">
              <h2 className="font-heading text-3xl uppercase tracking-[0.12em] text-white">No pack types yet</h2>
              <p className="mt-3 text-sm text-slate-400">
                Create the first pack type so operators can use visual pack selection during inventory assignment.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {packTypes.map((packType) => (
                <PackTypeCard
                  key={packType.id}
                  packType={packType}
                  onEdit={() => {
                    setEditorError(null);
                    setEditorState({ mode: "edit", packType });
                  }}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      {editorState ? (
        <PackTypeEditorModal
          mode={editorState.mode}
          packType={editorState.packType}
          busy={editorBusy}
          error={editorError}
          onClose={() => {
            setEditorState(null);
            setEditorError(null);
          }}
          onSubmit={handleSubmit}
        />
      ) : null}
    </AppShell>
  );
}
