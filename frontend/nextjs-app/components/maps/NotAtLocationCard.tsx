import Link from "next/link";
import type { KingsHuntLocation } from "../../lib/kingsHunt";
import { getLocationTypeLabel } from "../../lib/kingsHunt";

type NotAtLocationCardProps = {
  location: Pick<KingsHuntLocation, "name" | "address" | "city" | "state" | "hours" | "locationType">;
  directionsHref: string;
  previewHref?: string;
};

export default function NotAtLocationCard({ location, directionsHref, previewHref = "#preview" }: NotAtLocationCardProps) {
  return (
    <div className="space-y-5 rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] p-6 shadow-[0_22px_60px_rgba(0,0,0,0.38)]">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-[rgba(212,168,67,0.24)] bg-[rgba(212,168,67,0.08)] text-[#d4a843]">
        <span className="text-2xl" aria-hidden>
          ?
        </span>
      </div>
      <div className="space-y-3 text-center">
        <h2 className="text-[2rem] font-semibold leading-tight text-[#f6f6f8]">You&apos;re not at {location.name}</h2>
        <p className="text-sm text-[#9d9da6]">Scan this QR code when you visit to unlock the guided experience.</p>
      </div>
      <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
        <p className="text-base font-semibold text-[#f4f4f7]">{location.name}</p>
        <p className="mt-1 text-xs uppercase tracking-[0.24em] text-[#d4a843]">{getLocationTypeLabel(location.locationType)}</p>
        <p className="mt-4 text-sm text-[#a7a7af]">{location.address}</p>
        {location.hours ? <p className="mt-2 text-xs uppercase tracking-[0.18em] text-[#73737b]">{location.hours}</p> : null}
      </div>
      <div className="space-y-3">
        <Link
          href={directionsHref}
          target="_blank"
          rel="noreferrer"
          className="flex w-full items-center justify-center rounded-[18px] bg-[#d4a843] px-4 py-3 text-sm font-semibold text-[#16130b] transition hover:bg-[#e0b84e]"
        >
          Get Directions
        </Link>
        <Link
          href="/locations"
          className="flex w-full items-center justify-center rounded-[18px] border border-white/10 bg-transparent px-4 py-3 text-sm font-medium text-[#f1f1f3] transition hover:border-white/20 hover:bg-white/[0.03]"
        >
          View All Locations
        </Link>
        <a
          href={previewHref}
          className="flex w-full items-center justify-center rounded-[18px] border border-dashed border-white/10 px-4 py-3 text-sm font-medium text-[#7f7f88] transition hover:border-[rgba(212,168,67,0.28)] hover:text-[#d4a843]"
        >
          Preview the Experience
        </a>
      </div>
    </div>
  );
}
