import { useEffect, useMemo, useState } from "react";
import { CATEGORY_OPTIONS, PACK_TIER_OPTIONS, buildPackDefinitionName, type CollectibleCategoryValue, type PackTierValue } from "../../lib/adminInventory";
import {
  PACK_TYPE_IMAGE_ACCEPT,
  PACK_TYPE_IMAGE_MAX_BYTES,
  buildPackTypePreviewName,
  type AdminPackType,
  type PackTypeUpsertPayload,
} from "../../lib/adminPackTypes";
import { adminCx, adminInputClass, adminSelectClass, adminTextareaClass } from "./AdminPrimitives";

export type PackTypeEditorSubmitValue = PackTypeUpsertPayload & {
  imageFile: File | null;
};

type PackTypeEditorModalProps = {
  mode: "create" | "edit";
  packType: AdminPackType | null;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (value: PackTypeEditorSubmitValue) => void;
};

type DraftState = {
  name: string;
  category: CollectibleCategoryValue;
  tier: PackTierValue;
  description: string;
  isActive: boolean;
};

function buildInitialDraft(packType: AdminPackType | null): DraftState {
  if (packType) {
    return {
      name: packType.name,
      category: packType.category,
      tier: packType.tier,
      description: packType.description ?? "",
      isActive: packType.isActive,
    };
  }

  return {
    name: buildPackTypePreviewName("SPORTS", "TIER_25"),
    category: "SPORTS",
    tier: "TIER_25",
    description: "",
    isActive: true,
  };
}

function validateImageFile(file: File | null) {
  if (!file) {
    return null;
  }

  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    return "Pack image must be a JPG, PNG, or WebP file.";
  }

  if (file.size > PACK_TYPE_IMAGE_MAX_BYTES) {
    return "Pack image must be 5MB or smaller.";
  }

  return null;
}

export function PackTypeEditorModal({
  mode,
  packType,
  busy,
  error,
  onClose,
  onSubmit,
}: PackTypeEditorModalProps) {
  const [draft, setDraft] = useState<DraftState>(() => buildInitialDraft(packType));
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [nameAutoManaged, setNameAutoManaged] = useState(mode === "create");

  useEffect(() => {
    setDraft(buildInitialDraft(packType));
    setImageFile(null);
    setImageError(null);
    setDragActive(false);
    setNameAutoManaged(mode === "create");
  }, [mode, packType]);

  useEffect(() => {
    if (!nameAutoManaged) {
      return;
    }

    setDraft((current) => ({
      ...current,
      name: buildPackDefinitionName(current.category, current.tier),
    }));
  }, [draft.category, draft.tier, nameAutoManaged]);

  const previewUrl = useMemo(() => {
    if (imageFile) {
      return URL.createObjectURL(imageFile);
    }
    return packType?.imageUrl ?? null;
  }, [imageFile, packType?.imageUrl]);

  useEffect(() => {
    return () => {
      if (previewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const submitDisabled = busy || !draft.name.trim();

  const handleFile = (file: File | null) => {
    const validationError = validateImageFile(file);
    setImageError(validationError);
    if (validationError) {
      return;
    }
    setImageFile(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4 py-8 backdrop-blur-sm">
      <div className="w-full max-w-3xl rounded-[30px] border border-white/12 bg-night-900 p-6 shadow-[0_32px_100px_rgba(0,0,0,0.58)]">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-[0.3em] text-slate-500">Pack Management</p>
            <h2 className="font-heading text-2xl uppercase tracking-[0.12em] text-white">
              {mode === "create" ? "Create Pack Type" : "Edit Pack Type"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/12 px-3 py-2 text-[11px] uppercase tracking-[0.22em] text-slate-300 transition hover:border-white/25 hover:text-white"
          >
            Close
          </button>
        </div>

        <div className="mt-6 space-y-5">
          <label
            className={adminCx(
              "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-[24px] border border-dashed p-6 text-center transition",
              dragActive ? "border-gold-300 bg-gold-500/10" : "border-white/14 bg-black/35 hover:border-white/24"
            )}
            onDragEnter={() => setDragActive(true)}
            onDragLeave={() => setDragActive(false)}
            onDragOver={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragActive(false);
              handleFile(event.dataTransfer.files?.[0] ?? null);
            }}
          >
            <input
              type="file"
              accept={PACK_TYPE_IMAGE_ACCEPT}
              className="hidden"
              onChange={(event) => handleFile(event.currentTarget.files?.[0] ?? null)}
            />
            {previewUrl ? (
              <div
                className="h-48 w-full rounded-[18px] border border-white/10 bg-cover bg-center"
                style={{ backgroundImage: `url("${previewUrl}")` }}
              />
            ) : (
              <div className="flex h-48 w-full items-center justify-center rounded-[18px] border border-white/10 bg-[radial-gradient(circle_at_top,rgba(212,175,55,0.16),transparent_60%),rgba(255,255,255,0.03)] px-6">
                <div className="space-y-2">
                  <p className="font-heading text-xl uppercase tracking-[0.14em] text-white">Click to upload pack image</p>
                  <p className="text-sm text-slate-400">Or drag and drop a JPG, PNG, or WebP file up to 5MB.</p>
                </div>
              </div>
            )}
            <div className="space-y-1">
              <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">
                {imageFile ? imageFile.name : packType?.imageUrl ? "Replace current image" : "Pack image"}
              </p>
              <p className="text-sm text-slate-500">Stored in the same Spaces bucket used for card photos.</p>
            </div>
          </label>

          {imageError ? (
            <p className="rounded-2xl border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {imageError}
            </p>
          ) : null}

          {error ? (
            <p className="rounded-2xl border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {error}
            </p>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm text-slate-200">
              <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Pack Name *</span>
              <input
                value={draft.name}
                onChange={(event) => {
                  setNameAutoManaged(false);
                  setDraft((current) => ({ ...current, name: event.currentTarget.value }));
                }}
                className={adminInputClass()}
                placeholder="Sports $50 Pack"
              />
            </label>

            <label className="flex flex-col gap-2 text-sm text-slate-200">
              <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Status</span>
              <select
                value={draft.isActive ? "active" : "inactive"}
                onChange={(event) => setDraft((current) => ({ ...current, isActive: event.currentTarget.value === "active" }))}
                className={adminSelectClass()}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>

            <label className="flex flex-col gap-2 text-sm text-slate-200">
              <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Category *</span>
              <select
                value={draft.category}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, category: event.currentTarget.value as CollectibleCategoryValue }))
                }
                className={adminSelectClass()}
              >
                {CATEGORY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-2 text-sm text-slate-200">
              <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Price Tier *</span>
              <select
                value={draft.tier}
                onChange={(event) => setDraft((current) => ({ ...current, tier: event.currentTarget.value as PackTierValue }))}
                className={adminSelectClass()}
              >
                {PACK_TIER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="flex flex-col gap-2 text-sm text-slate-200">
            <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Description</span>
            <textarea
              value={draft.description}
              onChange={(event) => setDraft((current) => ({ ...current, description: event.currentTarget.value }))}
              rows={4}
              className={adminTextareaClass("min-h-[120px] resize-y")}
              placeholder="Optional description for operators"
            />
          </label>
        </div>

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/12 px-5 py-3 text-[11px] uppercase tracking-[0.22em] text-slate-200 transition hover:border-white/25 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={submitDisabled}
            onClick={() =>
              onSubmit({
                name: draft.name.trim(),
                category: draft.category,
                tier: draft.tier,
                description: draft.description.trim() || null,
                isActive: draft.isActive,
                imageFile,
              })
            }
            className="rounded-full border border-gold-400/60 bg-gold-500 px-5 py-3 text-[11px] uppercase tracking-[0.22em] text-night-950 transition hover:bg-gold-400 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {busy ? "Saving..." : "Save Pack Type"}
          </button>
        </div>
      </div>
    </div>
  );
}
