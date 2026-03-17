import { useState } from "react";
import { slugify } from "../../lib/slugify";
import { adminInputClass } from "./AdminPrimitives";

type AddLocationModalProps = {
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onCreate: (value: { name: string; address: string; slug: string }) => void;
};

export function AddLocationModal({ busy = false, error, onClose, onCreate }: AddLocationModalProps) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);

  const handleNameChange = (value: string) => {
    setName(value);
    setSlug((current) => {
      if (!slugTouched || current === slugify(name)) {
        return slugify(value);
      }
      return current;
    });
  };

  const submit = () => {
    const trimmedName = name.trim();
    const trimmedAddress = address.trim();
    const normalizedSlug = slugify(slug || trimmedName);

    if (!trimmedName) {
      setClientError("Location name is required.");
      return;
    }
    if (!trimmedAddress) {
      setClientError("Address is required.");
      return;
    }
    if (!normalizedSlug) {
      setClientError("Slug is required.");
      return;
    }

    setClientError(null);
    onCreate({
      name: trimmedName,
      address: trimmedAddress,
      slug: normalizedSlug,
    });
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 px-4 py-8 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-[30px] border border-white/10 bg-night-900 p-6 shadow-[0_28px_90px_rgba(0,0,0,0.55)]">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-[0.3em] text-slate-500">Assigned Locations</p>
            <h2 className="font-heading text-2xl uppercase tracking-[0.12em] text-white">Add New Location</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-full border border-white/12 px-3 py-2 text-[11px] uppercase tracking-[0.22em] text-slate-300 transition hover:border-white/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
          >
            Close
          </button>
        </div>

        <div className="mt-6 grid gap-4">
          <label className="flex flex-col gap-2 text-sm text-slate-200">
            <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Name</span>
            <input
              value={name}
              onChange={(event) => handleNameChange(event.currentTarget.value)}
              className={adminInputClass()}
              placeholder="Dallas Stars CoAmerica Center"
            />
          </label>

          <label className="flex flex-col gap-2 text-sm text-slate-200">
            <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Address</span>
            <input
              value={address}
              onChange={(event) => setAddress(event.currentTarget.value)}
              className={adminInputClass()}
              placeholder="2601 Avenue of the Stars, Frisco, TX 75034"
            />
          </label>

          <label className="flex flex-col gap-2 text-sm text-slate-200">
            <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Slug</span>
            <input
              value={slug}
              onChange={(event) => {
                setSlugTouched(true);
                setSlug(event.currentTarget.value);
              }}
              className={adminInputClass()}
              placeholder="dallas-stars-coamerica-center"
            />
            <span className="text-xs text-slate-500">Auto-generated from the name, but you can edit it.</span>
          </label>
        </div>

        {clientError || error ? (
          <p className="mt-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {clientError ?? error}
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-full border border-white/12 px-5 py-3 text-[11px] uppercase tracking-[0.22em] text-slate-200 transition hover:border-white/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="rounded-full border border-gold-400/60 bg-gold-500 px-5 py-3 text-[11px] uppercase tracking-[0.22em] text-night-950 transition hover:bg-gold-400 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {busy ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
