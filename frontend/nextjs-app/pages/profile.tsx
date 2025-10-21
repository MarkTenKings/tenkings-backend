import Head from "next/head";
import Image from "next/image";
import { FormEvent, useEffect, useMemo, useState, type ChangeEvent } from "react";
import AppShell from "../components/AppShell";
import { useSession } from "../hooks/useSession";
import { updateProfile as apiUpdateProfile } from "../lib/api";

const MAX_AVATAR_BYTES = 1024 * 512; // 512 KB
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export default function ProfilePage() {
  const { session, loading, ensureSession, updateProfile } = useSession();
  const [displayName, setDisplayName] = useState("");
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarPayload, setAvatarPayload] = useState<string | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!session) {
      setDisplayName("");
      setAvatarPreview(null);
      setAvatarPayload(undefined);
      return;
    }
    setDisplayName(session.user.displayName ?? "");
    setAvatarPreview(session.user.avatarUrl ?? null);
    setAvatarPayload(undefined);
  }, [session?.user.displayName, session?.user.avatarUrl, session]);

  const normalizedDisplayName = displayName.trim();
  const canSubmit = useMemo(() => {
    if (!session) {
      return false;
    }
    const nameChanged = normalizedDisplayName !== (session.user.displayName ?? "").trim();
    const avatarChanged = avatarPayload !== undefined;
    return !saving && (nameChanged || avatarChanged);
  }, [avatarPayload, normalizedDisplayName, saving, session]);

  const handleAvatarChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      setErrorMessage("Choose a JPG, PNG, or WebP image");
      event.target.value = "";
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setErrorMessage("Profile photos must be smaller than 512 KB");
      event.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setAvatarPreview(reader.result);
        setAvatarPayload(reader.result);
        setErrorMessage(null);
        setStatusMessage(null);
      }
    };
    reader.onerror = () => {
      setErrorMessage("Failed to read file");
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  };

  const handleAvatarRemove = () => {
    setAvatarPreview(null);
    setAvatarPayload(null);
    setStatusMessage(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!session || saving) {
      return;
    }
    setSaving(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const payload: { displayName?: string | null; avatarUrl?: string | null } = {};
      if (normalizedDisplayName !== (session.user.displayName ?? "").trim()) {
        payload.displayName = normalizedDisplayName.length > 0 ? normalizedDisplayName : null;
      }
      if (avatarPayload !== undefined) {
        payload.avatarUrl = avatarPayload;
      }
      if (Object.keys(payload).length === 0) {
        setStatusMessage("Nothing to update");
        return;
      }
      const result = await apiUpdateProfile(payload);
      updateProfile({
        displayName: result.user.displayName ?? null,
        avatarUrl: result.user.avatarUrl ?? null,
      });
      setStatusMessage("Profile updated");
      setAvatarPayload(undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Profile update failed";
      setErrorMessage(message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <AppShell>
        <div className="flex min-h-screen items-center justify-center">
          <p className="text-sm uppercase tracking-[0.32em] text-slate-400">Loading…</p>
        </div>
      </AppShell>
    );
  }

  if (!session) {
    return (
      <AppShell>
        <div className="flex min-h-screen items-center justify-center">
          <button
            type="button"
            onClick={() => ensureSession().catch(() => undefined)}
            className="rounded-full border border-gold-500/60 bg-gold-500 px-8 py-3 text-xs font-semibold uppercase tracking-[0.32em] text-night-900 shadow-glow transition hover:bg-gold-400"
          >
            Sign in to edit your profile
          </button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <Head>
        <title>Ten Kings · Profile</title>
        <meta name="robots" content="noindex" />
      </Head>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-12">
        <header className="space-y-2">
          <p className="text-sm uppercase tracking-[0.32em] text-violet-300">Account</p>
          <h1 className="font-heading text-4xl uppercase tracking-[0.2em] text-white">Profile</h1>
          <p className="text-sm text-slate-400">Update how your name and avatar appear in Recent Pulls and your public collection.</p>
        </header>

        {errorMessage && (
          <div className="rounded-2xl border border-rose-400/40 bg-rose-500/10 px-6 py-4 text-sm text-rose-200">{errorMessage}</div>
        )}
        {statusMessage && (
          <div className="rounded-2xl border border-emerald-400/40 bg-emerald-500/10 px-6 py-4 text-sm text-emerald-200">{statusMessage}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-10">
          <section className="space-y-4 rounded-3xl border border-white/10 bg-night-900/70 p-6">
            <h2 className="text-sm uppercase tracking-[0.3em] text-slate-400">Display name</h2>
            <p className="text-xs text-slate-500">Shown on Recent Pulls and when other collectors visit your collection.</p>
            <input
              type="text"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Add your name"
              maxLength={64}
              className="w-full rounded-2xl border border-white/10 bg-night-900/60 px-4 py-3 text-sm text-white shadow-inner focus:border-gold-400 focus:outline-none"
            />
          </section>

          <section className="space-y-4 rounded-3xl border border-white/10 bg-night-900/70 p-6">
            <h2 className="text-sm uppercase tracking-[0.3em] text-slate-400">Profile photo</h2>
            <p className="text-xs text-slate-500">Recommended square image, minimum 160×160. Max size 512 KB.</p>
            <div className="flex items-center gap-4">
              <div className="relative h-20 w-20 overflow-hidden rounded-full border border-violet-400/40">
                {avatarPreview ? (
                  <Image src={avatarPreview} alt="Profile preview" fill className="object-cover" sizes="80px" unoptimized />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-night-900/80 text-[10px] uppercase tracking-[0.28em] text-slate-500">
                    User
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <label className="inline-flex cursor-pointer items-center justify-center rounded-full border border-white/20 px-4 py-2 text-xs uppercase tracking-[0.28em] text-white transition hover:border-gold-400 hover:text-gold-200">
                  Upload photo
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={handleAvatarChange} />
                </label>
                {avatarPreview && (
                  <button
                    type="button"
                    onClick={handleAvatarRemove}
                    className="inline-flex items-center justify-center rounded-full border border-white/10 px-4 py-2 text-xs uppercase tracking-[0.28em] text-slate-300 transition hover:border-rose-400/50 hover:text-rose-200"
                  >
                    Remove photo
                  </button>
                )}
              </div>
            </div>
          </section>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={!canSubmit}
              className="rounded-full border border-gold-500/60 bg-gold-500 px-8 py-3 text-xs font-semibold uppercase tracking-[0.32em] text-night-900 shadow-glow transition hover:bg-gold-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
