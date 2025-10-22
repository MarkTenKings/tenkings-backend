import Head from "next/head";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import AppShell from "../components/AppShell";
import { useSession } from "../hooks/useSession";
import { hasAdminAccess, hasAdminPhoneAccess } from "../constants/admin";

interface LocationRecord {
  id: string;
  name: string;
  slug: string;
}

interface LiveRipRecord {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  videoUrl: string;
  thumbnailUrl: string | null;
  featured: boolean;
  location: LocationRecord | null;
  createdAt: string;
}

interface LiveRipFormState {
  id?: string;
  title: string;
  slug: string;
  description: string;
  videoUrl: string;
  thumbnailUrl: string;
  locationId: string;
  featured: boolean;
}

const emptyFormState: LiveRipFormState = {
  title: "",
  slug: "",
  description: "",
  videoUrl: "",
  thumbnailUrl: "",
  locationId: "",
  featured: false,
};

const embedForMedia = (videoUrl: string) => {
  if (/youtu\.be|youtube\.com/.test(videoUrl)) {
    try {
      const url = new URL(videoUrl);
      const videoId = url.searchParams.get("v") ?? videoUrl.split("/").pop();
      if (videoId) {
        return { type: "youtube" as const, id: videoId };
      }
    } catch (error) {
      // fall through to link
    }
  }
  if (videoUrl.endsWith(".mp4")) {
    return { type: "video" as const, src: videoUrl };
  }
  return { type: "link" as const, href: videoUrl };
};

const renderMedia = (videoUrl: string) => {
  const media = embedForMedia(videoUrl);
  switch (media.type) {
    case "youtube":
      return (
        <div className="relative w-full overflow-hidden rounded-3xl pt-[56.25%] shadow-card">
          <iframe
            className="absolute inset-0 h-full w-full"
            src={`https://www.youtube.com/embed/${media.id}`}
            title="Live rip video"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      );
    case "video":
      return (
        <video controls className="w-full rounded-3xl border border-white/10 bg-night-900/70 shadow-card">
          <source src={media.src} type="video/mp4" />
          Your browser does not support embedded video.
        </video>
      );
    default:
      return (
        <Link
          href={media.href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center justify-center rounded-full border border-white/20 px-5 py-2 text-xs uppercase tracking-[0.28em] text-slate-200 transition hover:border-gold-300 hover:text-gold-200"
        >
          Open video
        </Link>
      );
  }
};

type EditMode = "create" | "edit" | null;

export default function LivePage() {
  const { session, ensureSession } = useSession();
  const [liveRips, setLiveRips] = useState<LiveRipRecord[]>([]);
  const [locations, setLocations] = useState<LocationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [editMode, setEditMode] = useState<EditMode>(null);
  const [formState, setFormState] = useState<LiveRipFormState>(emptyFormState);
  const [saving, setSaving] = useState(false);
  const [filterLocation, setFilterLocation] = useState<string>("");
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [uploadingThumbnail, setUploadingThumbnail] = useState(false);

  const isAdmin = useMemo(() => {
    if (!session) {
      return false;
    }
    return hasAdminAccess(session.user.id) || hasAdminPhoneAccess(session.user.phone);
  }, [session]);

  useEffect(() => {
    if (!flash) {
      return;
    }
    const timeout = window.setTimeout(() => setFlash(null), 4000);
    return () => window.clearTimeout(timeout);
  }, [flash]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);

    const headers: Record<string, string> = {};
    if (session?.token) {
      headers.Authorization = `Bearer ${session.token}`;
    }

    const loadLiveRips = async () => {
      const res = await fetch("/api/live-rips");
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = typeof payload?.message === "string" ? payload.message : "Failed to load live rips";
        throw new Error(message);
      }
      return payload as { liveRips?: LiveRipRecord[] };
    };

    const loadLocations = async () => {
      const res = await fetch("/api/locations", { headers });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = typeof payload?.message === "string" ? payload.message : "Failed to load locations";
        throw new Error(message);
      }
      return payload as { locations?: Array<{ id: string; name: string; slug: string }> };
    };

    Promise.allSettled([loadLiveRips(), loadLocations()])
      .then(([liveResult, locationResult]) => {
        if (!mounted) {
          return;
        }

        let liveError: string | null = null;
        if (liveResult.status === "fulfilled") {
          setLiveRips(liveResult.value.liveRips ?? []);
        } else {
          liveError = liveResult.reason instanceof Error ? liveResult.reason.message : "Failed to load live rips";
        }

        if (locationResult.status === "fulfilled") {
          const list = locationResult.value.locations ?? [];
          setLocations(
            list.map((location) => ({
              id: location.id,
              name: location.name,
              slug: location.slug,
            }))
          );
        } else {
          const message =
            locationResult.reason instanceof Error
              ? locationResult.reason.message
              : "Failed to load locations";
          setFlash(message);
        }

        setError(liveError);
      })
      .catch((err: unknown) => {
        if (!mounted) {
          return;
        }
        const message = err instanceof Error ? err.message : "Failed to load live rips";
        setError(message);
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [session?.token]);

  const filteredLiveRips = useMemo(() => {
    if (!filterLocation) {
      return liveRips;
    }
    return liveRips.filter((liveRip) => liveRip.location?.id === filterLocation);
  }, [liveRips, filterLocation]);

  const beginCreate = useCallback(() => {
    setEditMode("create");
    setFormState({ ...emptyFormState });
  }, []);

  const beginEdit = useCallback((liveRip: LiveRipRecord) => {
    setEditMode("edit");
    setFormState({
      id: liveRip.id,
      title: liveRip.title,
      slug: liveRip.slug,
      description: liveRip.description ?? "",
      videoUrl: liveRip.videoUrl,
      thumbnailUrl: liveRip.thumbnailUrl ?? "",
      locationId: liveRip.location?.id ?? "",
      featured: liveRip.featured,
    });
  }, []);

  const closeEditor = useCallback(() => {
    setEditMode(null);
    setFormState({ ...emptyFormState });
  }, []);

  const handleFormChange = (field: keyof LiveRipFormState, value: string | boolean) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
  };

  const uploadMediaFile = useCallback(
    async (file: File, kind: "video" | "thumbnail") => {
      let activeSession = session;
      if (!activeSession) {
        try {
          activeSession = await ensureSession();
        } catch (error) {
          if (!(error instanceof Error && error.message === "Authentication cancelled")) {
            setFlash("Sign in to upload media.");
          }
          return null;
        }
      }

      if (!activeSession) {
        return null;
      }

      const params = new URLSearchParams({
        kind,
        fileName: file.name,
      });
      if (file.type) {
        params.set("contentType", file.type);
      }

      const headers = new Headers();
      headers.set("Authorization", `Bearer ${activeSession.token}`);
      headers.set("Content-Type", file.type || "application/octet-stream");

      const response = await fetch(`/api/live-rips/upload?${params.toString()}`, {
        method: "PUT",
        headers,
        body: file,
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = typeof payload?.message === "string" ? payload.message : "Upload failed";
        throw new Error(message);
      }

      return payload as {
        url: string;
        storageKey: string;
        contentType: string;
        size: number;
        kind: "video" | "thumbnail";
      };
    },
    [ensureSession, session]
  );

  const handleFileUpload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>, kind: "video" | "thumbnail") => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) {
        return;
      }
      const setBusy = kind === "video" ? setUploadingVideo : setUploadingThumbnail;
      setBusy(true);
      try {
        const result = await uploadMediaFile(file, kind);
        if (!result) {
          return;
        }
        setFormState((prev) =>
          kind === "video"
            ? { ...prev, videoUrl: result.url }
            : { ...prev, thumbnailUrl: result.url }
        );
        setFlash(kind === "video" ? "Video uploaded" : "Thumbnail uploaded");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Upload failed";
        setFlash(message);
      } finally {
        setBusy(false);
      }
    },
    [uploadMediaFile]
  );

  const refreshLiveRips = useCallback(async () => {
    try {
      const res = await fetch("/api/live-rips");
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.message ?? "Failed to refresh live rips");
      }
      const payload = (await res.json()) as { liveRips: LiveRipRecord[] };
      setLiveRips(payload.liveRips ?? []);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to refresh live rips";
      setFlash(message);
    }
  }, []);

  const handleSave = useCallback(async () => {
    if (!editMode) {
      return;
    }
    setSaving(true);

    let activeSession = session;
    if (!activeSession) {
      try {
        activeSession = await ensureSession();
      } catch (authError) {
        const message =
          authError instanceof Error && authError.message === "Authentication cancelled"
            ? null
            : "Sign in to manage live rips.";
        if (message) {
          setFlash(message);
        }
        setSaving(false);
        return;
      }
    }

    if (!activeSession) {
      setSaving(false);
      return;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${activeSession.token}`,
    };

    const body = {
      title: formState.title.trim(),
      slug: (formState.slug || formState.title).trim(),
      description: formState.description.trim(),
      videoUrl: formState.videoUrl.trim(),
      thumbnailUrl: formState.thumbnailUrl.trim(),
      locationId: formState.locationId,
      featured: formState.featured,
    };

    try {
      const endpoint = editMode === "create" ? "/api/live-rips" : `/api/live-rips/${formState.id}`;
      const method = editMode === "create" ? "POST" : "PUT";
      const response = await fetch(endpoint, {
        method,
        headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.message ?? "Unable to save live rip");
      }

      await refreshLiveRips();
      setFlash("Live rip saved");
      closeEditor();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save live rip";
      setFlash(message);
    } finally {
      setSaving(false);
    }
  }, [editMode, formState, session?.token, refreshLiveRips, closeEditor, ensureSession, session]);

  const handleCopyLink = async (slug: string) => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const url = `${window.location.origin}/live/${slug}`;
      await navigator.clipboard.writeText(url);
      setFlash("Link copied to clipboard");
    } catch (error) {
      setFlash("Unable to copy link");
    }
  };

  return (
    <AppShell>
      <Head>
        <title>Ten Kings · Live Rips</title>
        <meta
          name="description"
          content="Watch Ten Kings live rips from our collectible vending machines and share the biggest hits."
        />
      </Head>

      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-12">
        <header className="space-y-4">
          <p className="text-sm uppercase tracking-[0.3em] text-violet-300">Ten Kings Live</p>
          <h1 className="font-heading text-4xl uppercase tracking-[0.2em] text-white md:text-5xl">Recent Live Rips</h1>
          <p className="text-sm text-slate-400">
            Relive the best pulls from Ten Kings locations. Share the hype or copy a link for your location page.
          </p>
        </header>

        {(flash || error) && (
          <div
            className={`rounded-2xl border px-6 py-4 text-sm ${
              error
                ? "border-rose-500/40 bg-rose-500/10 text-rose-200"
                : "border-sky-500/40 bg-sky-500/10 text-sky-200"
            }`}
          >
            {error ?? flash}
          </div>
        )}

        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs uppercase tracking-[0.3em] text-slate-400">
              Filter by location
              <select
                value={filterLocation}
                onChange={(event) => setFilterLocation(event.target.value)}
                className="ml-3 rounded-full border border-white/10 bg-night-900/70 px-4 py-2 text-xs uppercase tracking-[0.3em] text-slate-200 outline-none focus:border-gold-400"
              >
                <option value="">All locations</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {isAdmin && (
            <button
              type="button"
              onClick={beginCreate}
              className="self-start rounded-full border border-gold-500/60 bg-gold-500 px-6 py-2 text-xs font-semibold uppercase tracking-[0.32em] text-night-900 shadow-glow transition hover:bg-gold-400"
            >
              Add video
            </button>
          )}
        </div>

        {loading ? (
          <div className="rounded-3xl border border-white/10 bg-night-900/60 px-6 py-12 text-center text-sm text-slate-400">
            Loading live rips…
          </div>
        ) : filteredLiveRips.length === 0 ? (
          <div className="rounded-3xl border border-white/10 bg-night-900/60 px-6 py-12 text-center text-sm text-slate-400">
            No live rips yet. Add one to kick things off!
          </div>
        ) : (
          <div className="grid gap-8 md:grid-cols-2 xl:grid-cols-3">
            {filteredLiveRips.map((liveRip) => (
              <article
                key={liveRip.id}
                className="flex flex-col gap-4 rounded-[2.25rem] border border-white/10 bg-night-900/70 p-6 shadow-card transition hover:border-gold-400/60 hover:shadow-glow"
              >
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">{liveRip.location?.name ?? "Ten Kings"}</p>
                  <h2 className="font-heading text-2xl uppercase tracking-[0.2em] text-white">{liveRip.title}</h2>
                  <p className="text-xs text-slate-500">{new Date(liveRip.createdAt).toLocaleString()}</p>
                </div>

                {renderMedia(liveRip.videoUrl)}

                {liveRip.description && (
                  <p className="text-sm text-slate-300">{liveRip.description}</p>
                )}

                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <Link
                    href={`/live/${liveRip.slug}`}
                    className="rounded-full border border-white/20 px-4 py-2 text-[10px] uppercase tracking-[0.3em] text-slate-200 transition hover:border-gold-300 hover:text-gold-200"
                  >
                    View page
                  </Link>
                  <button
                    type="button"
                    onClick={() => handleCopyLink(liveRip.slug)}
                    className="rounded-full border border-white/20 px-4 py-2 text-[10px] uppercase tracking-[0.3em] text-slate-200 transition hover:border-gold-300 hover:text-gold-200"
                  >
                    Copy link
                  </button>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => beginEdit(liveRip)}
                      className="rounded-full border border-white/20 px-4 py-2 text-[10px] uppercase tracking-[0.3em] text-slate-200 transition hover:border-white/40 hover:text-white"
                    >
                      Edit
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {editMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6 py-10">
          <div className="absolute inset-0 bg-black/70" onClick={closeEditor} />
          <div className="relative z-10 w-full max-w-2xl space-y-6 rounded-3xl border border-white/10 bg-night-900/95 p-6 shadow-2xl md:p-10">
            <h3 className="font-heading text-2xl uppercase tracking-[0.24em] text-white">
              {editMode === "create" ? "Add live rip" : "Edit live rip"}
            </h3>
            <div className="grid gap-4 text-sm text-slate-200">
              <label className="flex flex-col gap-2">
                <span className="text-xs uppercase tracking-[0.3em] text-slate-400">Title</span>
                <input
                  value={formState.title}
                  onChange={(event) => handleFormChange("title", event.target.value)}
                  className="rounded-xl border border-white/10 bg-night-900/70 px-4 py-3 text-white outline-none focus:border-gold-400"
                  placeholder="Headline to show on the page"
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-xs uppercase tracking-[0.3em] text-slate-400">Slug</span>
                <input
                  value={formState.slug}
                  onChange={(event) => handleFormChange("slug", event.target.value)}
                  className="rounded-xl border border-white/10 bg-night-900/70 px-4 py-3 text-white outline-none focus:border-gold-400"
                  placeholder="unique-url-slug"
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-xs uppercase tracking-[0.3em] text-slate-400">Video URL</span>
                <input
                  value={formState.videoUrl}
                  onChange={(event) => handleFormChange("videoUrl", event.target.value)}
                  className="rounded-xl border border-white/10 bg-night-900/70 px-4 py-3 text-white outline-none focus:border-gold-400"
                  placeholder="https://"
                />
                <span className="text-[11px] text-slate-500">Paste a link or upload a file below.</span>
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-xs uppercase tracking-[0.3em] text-slate-400">Upload video</span>
                <input
                  type="file"
                  accept="video/mp4,video/*"
                  onChange={(event) => handleFileUpload(event, "video")}
                  disabled={uploadingVideo}
                  className="rounded-xl border border-dashed border-white/10 bg-night-900/60 px-4 py-3 text-xs text-slate-300 focus:border-gold-400"
                />
                {uploadingVideo ? (
                  <span className="text-[11px] uppercase tracking-[0.3em] text-slate-500">Uploading…</span>
                ) : formState.videoUrl ? (
                  <span className="text-[11px] text-emerald-300">Video ready</span>
                ) : null}
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-xs uppercase tracking-[0.3em] text-slate-400">Thumbnail URL (optional)</span>
                <input
                  value={formState.thumbnailUrl}
                  onChange={(event) => handleFormChange("thumbnailUrl", event.target.value)}
                  className="rounded-xl border border-white/10 bg-night-900/70 px-4 py-3 text-white outline-none focus:border-gold-400"
                  placeholder="https://"
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-xs uppercase tracking-[0.3em] text-slate-400">Upload thumbnail</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={(event) => handleFileUpload(event, "thumbnail")}
                  disabled={uploadingThumbnail}
                  className="rounded-xl border border-dashed border-white/10 bg-night-900/60 px-4 py-3 text-xs text-slate-300 focus:border-gold-400"
                />
                {uploadingThumbnail ? (
                  <span className="text-[11px] uppercase tracking-[0.3em] text-slate-500">Uploading…</span>
                ) : formState.thumbnailUrl ? (
                  <span className="text-[11px] text-emerald-300">Thumbnail ready</span>
                ) : (
                  <span className="text-[11px] text-slate-500">Optional image that shows in previews.</span>
                )}
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-xs uppercase tracking-[0.3em] text-slate-400">Description</span>
                <textarea
                  value={formState.description}
                  onChange={(event) => handleFormChange("description", event.target.value)}
                  className="min-h-[100px] rounded-xl border border-white/10 bg-night-900/70 px-4 py-3 text-white outline-none focus:border-gold-400"
                  placeholder="Optional summary or context"
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-xs uppercase tracking-[0.3em] text-slate-400">Location</span>
                <select
                  value={formState.locationId}
                  onChange={(event) => handleFormChange("locationId", event.target.value)}
                  className="rounded-xl border border-white/10 bg-night-900/70 px-4 py-3 text-white outline-none focus:border-gold-400"
                >
                  <option value="">Unassigned</option>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-slate-400">
                <input
                  type="checkbox"
                  checked={formState.featured}
                  onChange={(event) => handleFormChange("featured", event.target.checked)}
                  className="h-4 w-4 rounded border-white/20 bg-night-900/70"
                />
                Feature on top of list
              </label>
            </div>

            <div className="flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={closeEditor}
                className="rounded-full border border-white/15 px-6 py-2 text-xs uppercase tracking-[0.3em] text-slate-300 transition hover:border-white/40 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="rounded-full border border-gold-500/60 bg-gold-500 px-6 py-2 text-xs font-semibold uppercase tracking-[0.32em] text-night-900 shadow-glow transition hover:bg-gold-400 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/10 disabled:text-slate-500"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
