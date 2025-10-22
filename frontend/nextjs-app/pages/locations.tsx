import Head from "next/head";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import AppShell from "../components/AppShell";
import { useSession } from "../hooks/useSession";
import { hasAdminAccess, hasAdminPhoneAccess } from "../constants/admin";

interface RipEntry {
  title: string;
  videoUrl: string;
}

interface LocationRecord {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  address: string;
  mapsUrl: string | null;
  mediaUrl: string | null;
  recentRips: RipEntry[];
  createdAt: string;
  updatedAt: string;
}

interface LocationFormState {
  id?: string;
  name: string;
  slug: string;
  description: string;
  address: string;
  mapsUrl: string;
  mediaUrl: string;
  recentRips: RipEntry[];
}

const emptyFormState: LocationFormState = {
  name: "",
  slug: "",
  description: "",
  address: "",
  mapsUrl: "",
  mediaUrl: "",
  recentRips: [],
};

const normalizeRipList = (value: RipEntry[]): RipEntry[] =>
  value
    .map((entry) => ({
      title: entry.title.trim(),
      videoUrl: entry.videoUrl.trim(),
    }))
    .filter((entry) => entry.title && entry.videoUrl);

const embedForMedia = (mediaUrl: string | null) => {
  if (!mediaUrl) {
    return { type: "none" as const };
  }
  if (/youtu\.be|youtube\.com/.test(mediaUrl)) {
    const url = new URL(mediaUrl);
    const videoId = url.searchParams.get("v") ?? mediaUrl.split("/").pop();
    if (videoId) {
      return { type: "youtube" as const, id: videoId };
    }
  }
  if (mediaUrl.endsWith(".mp4")) {
    return { type: "video" as const, src: mediaUrl };
  }
  return { type: "link" as const, href: mediaUrl };
};

function LocationsPage() {
  const { session, ensureSession } = useSession();
  const [locations, setLocations] = useState<LocationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [editMode, setEditMode] = useState<"create" | "edit" | null>(null);
  const [formState, setFormState] = useState<LocationFormState>(emptyFormState);
  const [saving, setSaving] = useState(false);

  const isAdmin = useMemo(() => {
    if (!session) {
      return false;
    }
    return hasAdminAccess(session.user.id) || hasAdminPhoneAccess(session.user.phone);
  }, [session]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    const headers: Record<string, string> = {};
    if (session?.token) {
      headers.Authorization = `Bearer ${session.token}`;
    }
    fetch("/api/locations", { headers })
      .then(async (res) => {
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload?.message ?? "Failed to load locations");
        }
        const payload = (await res.json()) as { locations: LocationRecord[] };
        if (mounted) {
          const sanitized = (payload.locations ?? []).map((location) => ({
            ...location,
            recentRips: Array.isArray(location.recentRips)
              ? (location.recentRips as RipEntry[])
                  .map((rip) => ({
                    title: typeof rip.title === "string" ? rip.title : "",
                    videoUrl: typeof rip.videoUrl === "string" ? rip.videoUrl : "",
                  }))
                  .filter((rip) => rip.title && rip.videoUrl)
              : [],
          }));
          setLocations(sanitized);
        }
      })
      .catch((err: unknown) => {
        if (!mounted) return;
        const message = err instanceof Error ? err.message : "Failed to load locations";
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

  useEffect(() => {
    if (!flash) {
      return;
    }
    const timeout = window.setTimeout(() => setFlash(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [flash]);

  const beginCreate = useCallback(() => {
    setEditMode("create");
    setFormState({ ...emptyFormState });
  }, []);

  const beginEdit = useCallback((location: LocationRecord) => {
    setEditMode("edit");
    setFormState({
      id: location.id,
      name: location.name,
      slug: location.slug,
      description: location.description ?? "",
      address: location.address,
      mapsUrl: location.mapsUrl ?? "",
      mediaUrl: location.mediaUrl ?? "",
      recentRips: location.recentRips ?? [],
    });
  }, []);

  const closeEditor = useCallback(() => {
    setEditMode(null);
    setFormState({ ...emptyFormState });
  }, []);

  const handleFormChange = (field: keyof LocationFormState, value: string) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
  };

  const updateRip = (index: number, rip: RipEntry) => {
    setFormState((prev) => {
      const next = [...prev.recentRips];
      next[index] = rip;
      return { ...prev, recentRips: next };
    });
  };

  const addRip = () => {
    setFormState((prev) => ({ ...prev, recentRips: [...prev.recentRips, { title: "", videoUrl: "" }] }));
  };

  const removeRip = (index: number) => {
    setFormState((prev) => ({
      ...prev,
      recentRips: prev.recentRips.filter((_, idx) => idx !== index),
    }));
  };

  const handleSave = async () => {
    if (!editMode) {
      return;
    }
    setSaving(true);
    setFlash(null);

    let activeSession = session;
    if (!activeSession) {
      try {
        activeSession = await ensureSession();
      } catch (error) {
        if (!(error instanceof Error && error.message === "Authentication cancelled")) {
          setFlash("Sign in to manage locations.");
        }
        setSaving(false);
        return;
      }
    }

    if (!activeSession) {
      setSaving(false);
      return;
    }

    const body = {
      name: formState.name.trim(),
      slug: (formState.slug || formState.name).trim(),
      description: formState.description.trim(),
      address: formState.address.trim(),
      mapsUrl: formState.mapsUrl.trim(),
      mediaUrl: formState.mediaUrl.trim(),
      recentRips: normalizeRipList(formState.recentRips),
    };

    try {
      const endpoint = editMode === "create" ? "/api/locations" : `/api/locations/${formState.id}`;
      const method = editMode === "create" ? "POST" : "PUT";
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${activeSession.token}`,
      };

      const response = await fetch(endpoint, {
        method,
        headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.message ?? "Unable to save location");
      }

      const payload = await response.json();
      const location: LocationRecord = payload.location ?? payload?.location;

      if (!location) {
        throw new Error("Unexpected response from server");
      }

      setLocations((prev) => {
        if (editMode === "create") {
          return [...prev, location].sort((a, b) => a.name.localeCompare(b.name));
        }
        return prev.map((entry) => (entry.id === location.id ? location : entry));
      });

      setFlash("Location saved");
      closeEditor();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save location";
      setFlash(message);
    } finally {
      setSaving(false);
    }
  };

  const renderMedia = (mediaUrl: string | null) => {
    const media = embedForMedia(mediaUrl);
    switch (media.type) {
      case "youtube":
        return (
          <div className="relative w-full overflow-hidden rounded-3xl pt-[56.25%] shadow-card">
            <iframe
              className="absolute inset-0 h-full w-full"
              src={`https://www.youtube.com/embed/${media.id}`}
              title="Location video"
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
      case "link":
        return (
          <Link
            href={media.href}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center rounded-full border border-white/20 px-5 py-2 text-xs uppercase tracking-[0.28em] text-slate-200 transition hover:border-gold-300 hover:text-gold-200"
          >
            View media
          </Link>
        );
      default:
        return (
          <div className="flex h-48 w-full items-center justify-center rounded-3xl border border-dashed border-white/10 text-xs uppercase tracking-[0.32em] text-slate-500">
            Media coming soon
          </div>
        );
    }
  };

  return (
    <AppShell>
      <Head>
        <title>Ten Kings · Locations</title>
        <meta name="description" content="Find Ten Kings Collectibles machines and plan your next live rip." />
      </Head>

      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-12">
        <header className="space-y-4">
          <p className="text-sm uppercase tracking-[0.3em] text-violet-300">Find a location</p>
          <h1 className="font-heading text-4xl uppercase tracking-[0.2em] text-white md:text-5xl">Pick & Rip in Person</h1>
          <p className="text-sm text-slate-400">
            Ten Kings Collectibles machines are stocked, authenticated, and ready for live ripping. Visit a location, scan your
            code, and capture the moment.
          </p>
        </header>

        {flash && (
          <div className="rounded-2xl border border-sky-500/40 bg-sky-500/10 px-6 py-4 text-sm text-sky-200">{flash}</div>
        )}
        {error && (
          <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-6 py-4 text-sm text-rose-200">{error}</div>
        )}

        {isAdmin && (
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={beginCreate}
              className="rounded-full border border-gold-500/60 bg-gold-500 px-6 py-2 text-xs font-semibold uppercase tracking-[0.32em] text-night-900 shadow-glow transition hover:bg-gold-400"
            >
              Add location
            </button>
          </div>
        )}

        {loading ? (
          <div className="rounded-3xl border border-white/10 bg-night-900/60 px-6 py-12 text-center text-sm text-slate-400">
            Loading locations…
          </div>
        ) : locations.length === 0 ? (
          <div className="rounded-3xl border border-white/10 bg-night-900/60 px-6 py-12 text-center text-sm text-slate-400">
            Locations will be announced soon. Stay tuned!
          </div>
        ) : (
          <div className="space-y-16">
            {locations.map((location) => (
              <section
                key={location.id}
                id={location.slug}
                className="space-y-6 rounded-[2.5rem] border border-white/10 bg-night-900/70 p-6 shadow-card md:p-10"
              >
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="space-y-3">
                    <h2 className="font-heading text-3xl uppercase tracking-[0.24em] text-white">{location.name}</h2>
                    {location.description && <p className="text-sm text-slate-300">{location.description}</p>}
                    <p className="text-xs uppercase tracking-[0.3em] text-slate-400">{location.address}</p>
                    {location.mapsUrl && (
                      <Link href={location.mapsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center text-xs uppercase tracking-[0.3em] text-gold-300 underline">
                        Open in Google Maps
                      </Link>
                    )}
                  </div>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => beginEdit(location)}
                      className="self-start rounded-full border border-white/20 px-5 py-2 text-xs uppercase tracking-[0.3em] text-slate-300 transition hover:border-white/40 hover:text-white"
                    >
                      Edit location
                    </button>
                  )}
                </div>

                {renderMedia(location.mediaUrl)}

                <div className="space-y-4">
                  <h3 className="font-heading text-xl uppercase tracking-[0.24em] text-white">Recent live rips</h3>
                  {location.recentRips && location.recentRips.length > 0 ? (
                    <div className="grid gap-4 md:grid-cols-2">
                      {location.recentRips.map((rip, idx) => (
                        <div key={`${location.id}-rip-${idx}`} className="space-y-2 rounded-2xl border border-white/10 bg-night-900/80 p-5">
                          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">{rip.title}</p>
                          <Link
                            href={rip.videoUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-gold-300 underline"
                          >
                            Watch the rip
                            <span aria-hidden>→</span>
                          </Link>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Live rip videos will appear here after the next session.</p>
                  )}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {editMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6 py-10">
          <div className="absolute inset-0 bg-black/70" onClick={closeEditor} />
          <div className="relative z-10 w-full max-w-2xl space-y-6 rounded-3xl border border-white/10 bg-night-900/95 p-6 shadow-2xl md:p-10">
            <h3 className="font-heading text-2xl uppercase tracking-[0.24em] text-white">
              {editMode === "create" ? "Add location" : "Edit location"}
            </h3>
            <div className="grid gap-4 text-sm text-slate-200">
              <label className="flex flex-col gap-2">
                <span className="text-xs uppercase tracking-[0.3em] text-slate-400">Name</span>
                <input
                  value={formState.name}
                  onChange={(event) => handleFormChange("name", event.target.value)}
                  className="rounded-xl border border-white/10 bg-night-900/70 px-4 py-3 text-white outline-none focus:border-gold-400"
                  placeholder="Machine name"
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-xs uppercase tracking-[0.3em] text-slate-400">Slug</span>
                <input
                  value={formState.slug}
                  onChange={(event) => handleFormChange("slug", event.target.value)}
                  className="rounded-xl border border-white/10 bg-night-900/70 px-4 py-3 text-white outline-none focus:border-gold-400"
                  placeholder="internal-slug"
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-xs uppercase tracking-[0.3em] text-slate-400">Description</span>
                <textarea
                  value={formState.description}
                  onChange={(event) => handleFormChange("description", event.target.value)}
                  className="min-h-[90px] rounded-xl border border-white/10 bg-night-900/70 px-4 py-3 text-white outline-none focus:border-gold-400"
                  placeholder="What makes this location special?"
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-xs uppercase tracking-[0.3em] text-slate-400">Address</span>
                <input
                  value={formState.address}
                  onChange={(event) => handleFormChange("address", event.target.value)}
                  className="rounded-xl border border-white/10 bg-night-900/70 px-4 py-3 text-white outline-none focus:border-gold-400"
                  placeholder="Street, City, State"
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-xs uppercase tracking-[0.3em] text-slate-400">Google Maps URL</span>
                <input
                  value={formState.mapsUrl}
                  onChange={(event) => handleFormChange("mapsUrl", event.target.value)}
                  className="rounded-xl border border-white/10 bg-night-900/70 px-4 py-3 text-white outline-none focus:border-gold-400"
                  placeholder="https://maps.google.com/..."
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-xs uppercase tracking-[0.3em] text-slate-400">Primary media URL</span>
                <input
                  value={formState.mediaUrl}
                  onChange={(event) => handleFormChange("mediaUrl", event.target.value)}
                  className="rounded-xl border border-white/10 bg-night-900/70 px-4 py-3 text-white outline-none focus:border-gold-400"
                  placeholder="YouTube or MP4 URL"
                />
              </label>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase tracking-[0.3em] text-slate-400">Recent live rips</span>
                  <button
                    type="button"
                    onClick={addRip}
                    className="rounded-full border border-white/15 px-4 py-1 text-[10px] uppercase tracking-[0.3em] text-slate-300 transition hover:border-white/40 hover:text-white"
                  >
                    Add entry
                  </button>
                </div>
                {formState.recentRips.length === 0 ? (
                  <p className="text-xs text-slate-500">Add highlight videos or stream replays you want to showcase.</p>
                ) : (
                  <div className="space-y-3">
                    {formState.recentRips.map((rip, index) => (
                      <div key={`rip-${index}`} className="space-y-2 rounded-xl border border-white/10 bg-night-900/70 p-4">
                        <div className="grid gap-3 md:grid-cols-2">
                          <label className="flex flex-col gap-2 text-xs">
                            <span className="text-slate-400">Title</span>
                            <input
                              value={rip.title}
                              onChange={(event) => updateRip(index, { ...rip, title: event.target.value })}
                              className="rounded-lg border border-white/10 bg-night-900/70 px-3 py-2 text-white outline-none focus:border-gold-400"
                              placeholder="Live pull title"
                            />
                          </label>
                          <label className="flex flex-col gap-2 text-xs">
                            <span className="text-slate-400">Video URL</span>
                            <input
                              value={rip.videoUrl}
                              onChange={(event) => updateRip(index, { ...rip, videoUrl: event.target.value })}
                              className="rounded-lg border border-white/10 bg-night-900/70 px-3 py-2 text-white outline-none focus:border-gold-400"
                              placeholder="https://"
                            />
                          </label>
                        </div>
                        <div className="flex justify-end">
                          <button
                            type="button"
                            onClick={() => removeRip(index)}
                            className="rounded-full border border-white/15 px-4 py-1 text-[10px] uppercase tracking-[0.3em] text-slate-300 transition hover:border-rose-400/50 hover:text-rose-200"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
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
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

export default LocationsPage;
