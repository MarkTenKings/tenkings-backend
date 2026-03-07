import Link from "next/link";
import type { ReactNode } from "react";

export function adminCx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export const ADMIN_PAGE_FRAME_CLASS = "mx-auto flex w-full max-w-[1540px] flex-1 flex-col gap-6 px-4 py-6 lg:px-6";
export const ADMIN_EYEBROW_CLASS = "text-[11px] uppercase tracking-[0.32em] text-slate-500";
export const ADMIN_TITLE_CLASS = "font-heading text-[1.95rem] uppercase tracking-[0.12em] text-white";
export const ADMIN_COPY_CLASS = "max-w-3xl text-sm text-slate-300";

export function adminPanelClass(extra?: string) {
  return adminCx(
    "rounded-[28px] border border-white/12 bg-black/88 shadow-[0_24px_80px_rgba(0,0,0,0.48)] backdrop-blur-sm",
    extra
  );
}

export function adminSubpanelClass(extra?: string) {
  return adminCx("rounded-[22px] border border-white/10 bg-white/[0.03]", extra);
}

export function adminStatCardClass(extra?: string) {
  return adminCx("rounded-[22px] border border-white/12 bg-black/82", extra);
}

export function adminInputClass(extra?: string) {
  return adminCx(
    "h-11 rounded-xl border border-white/12 bg-black px-3 text-sm text-white outline-none transition focus:border-white/40",
    extra
  );
}

export function adminTextareaClass(extra?: string) {
  return adminCx(
    "rounded-xl border border-white/12 bg-black px-3 py-2 text-sm text-white outline-none transition focus:border-white/40",
    extra
  );
}

export function adminSelectClass(extra?: string) {
  return adminCx(
    "h-11 rounded-xl border border-white/12 bg-black px-3 text-sm text-white outline-none transition focus:border-white/40",
    extra
  );
}

type AdminPageHeaderProps = {
  backHref?: string;
  backLabel?: string;
  eyebrow: string;
  title: string;
  description?: ReactNode;
  badges?: ReactNode;
  actions?: ReactNode;
};

export function AdminPageHeader({
  backHref,
  backLabel,
  eyebrow,
  title,
  description,
  badges,
  actions,
}: AdminPageHeaderProps) {
  return (
    <header className={adminPanelClass("p-5 md:p-6")}>
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="space-y-3">
          {backHref && backLabel ? (
            <Link
              href={backHref}
              className="inline-flex text-[11px] uppercase tracking-[0.28em] text-slate-400 transition hover:text-white"
            >
              {backLabel}
            </Link>
          ) : null}
          <p className={ADMIN_EYEBROW_CLASS}>{eyebrow}</p>
          <h1 className={ADMIN_TITLE_CLASS}>{title}</h1>
          {description ? <div className={ADMIN_COPY_CLASS}>{description}</div> : null}
          {badges ? <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.18em]">{badges}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
